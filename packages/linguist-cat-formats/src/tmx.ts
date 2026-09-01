import type { ImportWarning } from './adapter'
import { XMLSerializer } from '@xmldom/xmldom'
import { FormatParseError } from './errors'
import {
  descendants,
  directChildren,
  elementLocale,
  localName,
  parseXml,
  selectLocale,
  text,
  type LocalizedElement,
  type XmlLocalePairOptions,
} from './xml-parser'

const TMX_PARSER_ID = 'tmx'

export interface TmxEntry {
  source: string
  target: string
  sourceLocale: string
  targetLocale: string
  occurrenceKey: string
  originalTuid?: string
  contextKey?: string
  previousSource?: string
  nextSource?: string
  metadata?: Record<string, string | string[]>
  sourceInline?: string
  targetInline?: string
}

export interface TmxParseResult {
  entries: TmxEntry[]
  warnings: ImportWarning[]
}

export function parseTmx(
  bytes: Uint8Array,
  options: XmlLocalePairOptions,
): TmxParseResult {
  const filename = options.filename ?? 'memory.tmx'
  const document = parseXml(bytes, TMX_PARSER_ID, filename)
  if (localName(document.documentElement) !== 'tmx') {
    throw new FormatParseError(TMX_PARSER_ID, filename, '根元素不是 TMX')
  }

  const entries: TmxEntry[] = []
  const serializer = new XMLSerializer()
  for (const [index, unit] of descendants(document, 'tu').entries()) {
    const localized: LocalizedElement[] = directChildren(unit, ['tuv']).flatMap((tuv) => {
      const locale = elementLocale(tuv)
      const segment = descendants(tuv, 'seg')[0]
      return locale === undefined || segment === undefined ? [] : [{ element: segment, locale }]
    })
    const source = selectLocale(localized, options.sourceLocale)
    const target = selectLocale(localized, options.targetLocale)
    if (source === undefined || target === undefined) continue

    const sourceText = text(source.element)
    const targetText = text(target.element)
    if (sourceText === '' || targetText === '') continue

    const metadata = collectMetadata(unit, source.element.parentNode, target.element.parentNode)
    const contextKey = findContextKey(metadata)
    entries.push({
      source: sourceText,
      target: targetText,
      sourceLocale: options.sourceLocale,
      targetLocale: options.targetLocale,
      occurrenceKey: unit.getAttribute('tuid')?.trim() || String(index + 1),
      ...(unit.getAttribute('tuid') === null ? {} : { originalTuid: unit.getAttribute('tuid')! }),
      ...(contextKey === undefined ? {} : { contextKey }),
      ...(Object.keys(metadata).length === 0 ? {} : { metadata }),
      sourceInline: serializer.serializeToString(source.element),
      targetInline: serializer.serializeToString(target.element),
    })
  }

  if (entries.length === 0) {
    throw new FormatParseError(
      TMX_PARSER_ID,
      filename,
      `未找到有效的 ${options.sourceLocale} → ${options.targetLocale} 翻译对`,
    )
  }
  return {
    entries: entries.map((entry, index) => ({
      ...entry,
      ...(index === 0 ? {} : { previousSource: entries[index - 1]!.source }),
      ...(index + 1 >= entries.length ? {} : { nextSource: entries[index + 1]!.source }),
    })),
    warnings: [],
  }
}

function attributes(element: Element): Record<string, string> {
  return Object.fromEntries(
    Array.from(element.attributes, (attribute) => [attribute.name, attribute.value]),
  )
}

function addMetadata(
  target: Record<string, string | string[]>,
  key: string,
  value: string,
): void {
  const existing = target[key]
  if (existing === undefined) target[key] = value
  else target[key] = Array.isArray(existing) ? [...existing, value] : [existing, value]
}

function collectMetadata(
  unit: Element,
  sourceTuv: Node | null,
  targetTuv: Node | null,
): Record<string, string | string[]> {
  const result: Record<string, string | string[]> = {}
  for (const [key, value] of Object.entries(attributes(unit))) addMetadata(result, `tu.${key}`, value)
  const pairs: ReadonlyArray<readonly [string, Node | null]> = [
    ['source', sourceTuv],
    ['target', targetTuv],
  ]
  for (const [label, tuv] of pairs) {
    if (tuv === null || tuv.nodeType !== 1) continue
    for (const [key, value] of Object.entries(attributes(tuv as Element))) addMetadata(result, `${label}.${key}`, value)
  }
  for (const prop of directChildren(unit, ['prop'])) {
    const key = prop.getAttribute('type')?.trim() || 'prop'
    addMetadata(result, key, text(prop))
  }
  return result
}

function findContextKey(metadata: Record<string, string | string[]>): string | undefined {
  const key = Object.keys(metadata).find((name) => /(?:context|string.?id|resname|segment.?id)/iu.test(name))
  if (key === undefined) return undefined
  const value = metadata[key]
  return (Array.isArray(value) ? value[0] : value)?.trim() || undefined
}
