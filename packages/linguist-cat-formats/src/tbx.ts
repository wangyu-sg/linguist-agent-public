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

const TBX_PARSER_ID = 'tbx'

export type TbxTermStatus = 'allowed' | 'preferred' | 'forbidden' | 'deprecated'

export interface TbxEntry {
  term: string
  translation: string
  status: TbxTermStatus
  note?: string
  caseSensitive: boolean
}

export interface TbxParseResult {
  entries: TbxEntry[]
  warnings: ImportWarning[]
}

interface TbxTerm {
  container: Element
  term: Element
  value: string
}

function normalizedType(element: Element): string {
  return (element.getAttribute('type') ?? '').replace(/[-_\s]/g, '').toLowerCase()
}

function parseStatus(container: Element): {
  status: TbxTermStatus
  raw?: string
  defaulted: boolean
} {
  const statusElement = descendants(container, 'termNote')
    .find((element) => normalizedType(element).includes('status'))
  const raw = (statusElement === undefined
    ? container.getAttribute('status')
    : text(statusElement))?.trim()
  const normalized = raw?.replace(/[-_\s]/g, '').toLowerCase()

  if (normalized === 'preferred' || normalized === 'preferredtermadmnsts') {
    return { status: 'preferred', raw, defaulted: false }
  }
  if (
    normalized === 'admitted'
    || normalized === 'admittedtermadmnsts'
    || normalized === 'allowed'
  ) return { status: 'allowed', raw, defaulted: false }
  if (normalized === 'deprecated' || normalized === 'deprecatedtermadmnsts') {
    return { status: 'deprecated', raw, defaulted: false }
  }
  if (
    normalized === 'superseded'
    || normalized === 'supersededtermadmnsts'
    || normalized === 'forbidden'
  ) return { status: 'forbidden', raw, defaulted: false }
  return {
    status: 'allowed',
    ...(raw === undefined || raw === '' ? {} : { raw }),
    defaulted: true,
  }
}

function parseBoolean(value: string | null): boolean {
  return value !== null && ['1', 'true', 'yes'].includes(value.trim().toLowerCase())
}

function isCaseSensitive(container: Element, term: Element): boolean {
  const declaration = descendants(container, 'descrip')
    .find((element) => normalizedType(element) === 'casesensitive')
  return (
    parseBoolean(term.getAttribute('caseSensitive'))
    || parseBoolean(container.getAttribute('caseSensitive'))
    || (declaration !== undefined && parseBoolean(text(declaration)))
  )
}

function firstNote(...containers: Element[]): string | undefined {
  for (const container of containers) {
    const note = descendants(container, 'note')[0]
      ?? descendants(container, 'descrip').find((element) => normalizedType(element) === 'note')
    if (note !== undefined && text(note) !== '') return text(note)
  }
  return undefined
}

function termsInLanguage(section: Element): TbxTerm[] {
  return directChildren(section, ['tig', 'ntig', 'termSec']).flatMap((container) => {
    const term = descendants(container, 'term')[0]
    return term === undefined || text(term) === '' ? [] : [{ container, term, value: text(term) }]
  })
}

export function parseTbx(
  bytes: Uint8Array,
  options: XmlLocalePairOptions,
): TbxParseResult {
  const filename = options.filename ?? 'termbase.tbx'
  const document = parseXml(bytes, TBX_PARSER_ID, filename)
  if (!['tbx', 'martif'].includes(localName(document.documentElement))) {
    throw new FormatParseError(TBX_PARSER_ID, filename, '根元素不是 TBX v2/v3')
  }

  const entries: TbxEntry[] = []
  const warnings: ImportWarning[] = []
  const concepts = descendants(document, 'termEntry').concat(descendants(document, 'conceptEntry'))
  for (const [index, concept] of concepts.entries()) {
    const sections: LocalizedElement[] = directChildren(concept, ['langSet', 'langSec']).flatMap((section) => {
      const locale = elementLocale(section)
      return locale === undefined ? [] : [{ element: section, locale }]
    })
    const sourceSection = selectLocale(sections, options.sourceLocale)
    const targetSection = selectLocale(sections, options.targetLocale)
    if (sourceSection === undefined || targetSection === undefined) continue

    const key = concept.getAttribute('id') || String(index + 1)
    const sourceTerms = termsInLanguage(sourceSection.element)
    const targetTerms = termsInLanguage(targetSection.element)
    for (const sourceTerm of sourceTerms) {
      for (const targetTerm of targetTerms) {
        const { status, raw, defaulted } = parseStatus(targetTerm.container)
        if (defaulted) {
          warnings.push(warning(
            'tbx.status_defaulted',
            raw === undefined
              ? 'TBX 术语状态缺失，已按 allowed 导入'
              : `未知 TBX 术语状态“${raw}”，已按 allowed 导入`,
            key,
          ))
        }

        const note = firstNote(targetTerm.container, targetSection.element, concept)
        entries.push({
          term: sourceTerm.value,
          translation: targetTerm.value,
          status,
          ...(note === undefined ? {} : { note }),
          caseSensitive: isCaseSensitive(targetTerm.container, targetTerm.term),
        })
      }
    }
  }

  if (entries.length === 0) {
    throw new FormatParseError(
      TBX_PARSER_ID,
      filename,
      `未找到有效的 ${options.sourceLocale} → ${options.targetLocale} 术语对`,
    )
  }
  return { entries, warnings }
}
