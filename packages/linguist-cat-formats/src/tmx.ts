import type { ImportWarning } from './adapter'
import { FormatParseError } from './errors'
import {
  descendants,
  directChildren,
  elementLocale,
  localName,
  parseXml,
  selectLocale,
  text,
  warning,
  type LocalizedElement,
  type XmlLocalePairOptions,
} from './xml-parser'

const TMX_PARSER_ID = 'tmx'

export interface TmxEntry {
  source: string
  target: string
  sourceLocale: string
  targetLocale: string
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
  const warnings: ImportWarning[] = []
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

    const key = unit.getAttribute('tuid') || String(index + 1)
    if (
      source.element.getElementsByTagName('*').length > 0
      || target.element.getElementsByTagName('*').length > 0
    ) {
      warnings.push(warning(
        'tmx.inline_markup_flattened',
        'TMX 内联标记已扁平化为纯文本',
        key,
      ))
    }

    entries.push({
      source: sourceText,
      target: targetText,
      sourceLocale: options.sourceLocale,
      targetLocale: options.targetLocale,
    })
  }

  if (entries.length === 0) {
    throw new FormatParseError(
      TMX_PARSER_ID,
      filename,
      `未找到有效的 ${options.sourceLocale} → ${options.targetLocale} 翻译对`,
    )
  }
  return { entries, warnings }
}
