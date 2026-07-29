import {
  FormatParseError,
  FormatUnsupportedError,
  normalizeDelimitedHeader,
  parseDelimitedTable,
  parseTbx,
  parseTmx,
} from '@linguist/cat-formats'
import type {
  SentencePatternInput,
  SentencePatternStatus,
  TermEntryImportInput,
  TermEntryStatus,
  TmUnitImportInput,
} from '@linguist/cat-store'
import type {
  ImportReferenceInput,
} from './project-service-types'

const CONTEXT_DOC_IMAGE_EXTENSIONS = new Set([
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.webp',
  '.svg',
  '.bmp',
])

const REFERENCE_SOURCE_COLUMNS = ['source', 'src', 'sourcetext', 'source text', '源文', '原文']
const REFERENCE_TARGET_COLUMNS = ['target', 'tgt', 'translation', 'targettext', 'target text', '译文', '翻译']
const REFERENCE_TERM_COLUMNS = ['term', 'source', '术语', '源术语']
const REFERENCE_STATUS_COLUMNS = ['status', 'termstatus', '状态']
const REFERENCE_CASE_COLUMNS = ['casesensitive', 'case sensitive', 'case_sensitive', '区分大小写']
const REFERENCE_NOTE_COLUMNS = ['note', 'notes', 'comment', '备注']

const PATTERN_SOURCE_COLUMNS = ['source', 'src', 'sourcetext', 'source text', '源文', '原文']
const PATTERN_DRAFT_COLUMNS = ['draft_target', 'drafttarget', 'draft', '草稿译文', '草稿']
const PATTERN_SUGGESTED_COLUMNS = ['suggested_target', 'suggestedtarget', 'suggested', 'target', '建议译文', '译文']
const PATTERN_TEXT_TYPE_COLUMNS = ['text_type', 'texttype', 'text type', '文本类型']
const PATTERN_MODULE_COLUMNS = ['module', '模块']
const PATTERN_REVIEWER_COLUMNS = ['reviewer', '评审', '审校']
const PATTERN_STATUS_COLUMNS = ['status', '状态']

export function isContextDocImageExtension(extension: string): boolean {
  return CONTEXT_DOC_IMAGE_EXTENSIONS.has(extension.toLowerCase())
}

function referenceColumn(headers: readonly string[], aliases: readonly string[]): number {
  const normalizedAliases = new Set(aliases.map(normalizeDelimitedHeader))
  return headers.findIndex((header) => normalizedAliases.has(normalizeDelimitedHeader(header)))
}

function requiredReferenceColumn(
  headers: readonly string[],
  aliases: readonly string[],
  filename: string,
  label: string,
): number {
  const index = referenceColumn(headers, aliases)
  if (index < 0) {
    throw new FormatParseError('reference_csv', filename, `缺少必需 ${label} 列`)
  }
  return index
}

function parseTermStatus(value: string, filename: string, row: number): TermEntryStatus {
  const normalized = value.trim().toLowerCase()
  if (normalized === '') return 'allowed'
  if (
    normalized === 'allowed'
    || normalized === 'preferred'
    || normalized === 'required'
    || normalized === 'forbidden'
    || normalized === 'deprecated'
  ) {
    return normalized
  }
  throw new FormatParseError('term_csv', filename, `第 ${row} 行的 status 无效`)
}

function parseBoolean(value: string, filename: string, row: number): boolean {
  const normalized = value.trim().toLowerCase()
  if (normalized === '' || normalized === 'false' || normalized === '0' || normalized === 'no') {
    return false
  }
  if (normalized === 'true' || normalized === '1' || normalized === 'yes') return true
  throw new FormatParseError('term_csv', filename, `第 ${row} 行的 case_sensitive 无效`)
}

export function parseTmReference(
  input: ImportReferenceInput,
  sourceLocale: string,
  targetLocale: string,
): { entries: TmUnitImportInput[]; warnings: string[] } {
  const lower = input.filename.toLowerCase()
  if (lower.endsWith('.tmx')) {
    const parsed = parseTmx(input.bytes, { sourceLocale, targetLocale, filename: input.filename })
    return {
      entries: parsed.entries.map((entry) => ({ ...entry, origin: 'imported' })),
      warnings: parsed.warnings.map((item) => item.message),
    }
  }
  if (!lower.endsWith('.csv')) throw new FormatUnsupportedError(input.filename, ['tmx', 'csv'])
  const table = parseDelimitedTable(input.bytes, input.filename)
  const sourceColumn = requiredReferenceColumn(
    table.headers,
    REFERENCE_SOURCE_COLUMNS,
    input.filename,
    'source',
  )
  const targetColumn = requiredReferenceColumn(
    table.headers,
    REFERENCE_TARGET_COLUMNS,
    input.filename,
    'target',
  )
  const entries = table.rows.map((row, index) => {
    const source = row[sourceColumn]!.trim()
    const target = row[targetColumn]!.trim()
    if (source === '' || target === '') {
      throw new FormatParseError('tm_csv', input.filename, `第 ${index + 2} 行的 source/target 不能为空`)
    }
    return { source, target, sourceLocale, targetLocale, origin: 'imported' }
  })
  return { entries, warnings: [] }
}

export function parseTermReference(
  input: ImportReferenceInput,
  sourceLocale: string,
  targetLocale: string,
): { entries: TermEntryImportInput[]; warnings: string[] } {
  const lower = input.filename.toLowerCase()
  if (lower.endsWith('.tbx')) {
    const parsed = parseTbx(input.bytes, { sourceLocale, targetLocale, filename: input.filename })
    return { entries: parsed.entries, warnings: parsed.warnings.map((item) => item.message) }
  }
  if (!lower.endsWith('.csv')) throw new FormatUnsupportedError(input.filename, ['tbx', 'csv'])
  const table = parseDelimitedTable(input.bytes, input.filename)
  const termColumn = requiredReferenceColumn(
    table.headers,
    REFERENCE_TERM_COLUMNS,
    input.filename,
    'term',
  )
  const translationColumn = requiredReferenceColumn(
    table.headers,
    REFERENCE_TARGET_COLUMNS,
    input.filename,
    'translation',
  )
  const statusColumn = referenceColumn(table.headers, REFERENCE_STATUS_COLUMNS)
  const caseColumn = referenceColumn(table.headers, REFERENCE_CASE_COLUMNS)
  const noteColumn = referenceColumn(table.headers, REFERENCE_NOTE_COLUMNS)
  const entries = table.rows.map((row, index) => {
    const term = row[termColumn]!.trim()
    const translation = row[translationColumn]!.trim()
    if (term === '' || translation === '') {
      throw new FormatParseError(
        'term_csv',
        input.filename,
        `第 ${index + 2} 行的 term/translation 不能为空`,
      )
    }
    const note = noteColumn < 0 ? undefined : row[noteColumn]!.trim()
    return {
      term,
      translation,
      status: statusColumn < 0
        ? 'allowed'
        : parseTermStatus(row[statusColumn]!, input.filename, index + 2),
      caseSensitive: caseColumn >= 0
        && parseBoolean(row[caseColumn]!, input.filename, index + 2),
      ...(note === undefined || note === '' ? {} : { note }),
    }
  })
  return { entries, warnings: [] }
}

function parseSentencePatternStatus(
  value: string,
  filename: string,
  row: number,
): SentencePatternStatus {
  const normalized = value.trim().toLowerCase()
  if (normalized === '') return 'pending'
  if (normalized === 'confirmed' || normalized === 'pending' || normalized === 'rejected') {
    return normalized
  }
  throw new FormatParseError('sentence_pattern_csv', filename, `第 ${row} 行的 status 无效`)
}

function optionalCell(row: string[], index: number): string | undefined {
  if (index < 0) return undefined
  const value = row[index]!.trim()
  return value === '' ? undefined : value
}

/** 句式 CSV：source 列必需，其余可空；status 缺省 pending。 */
export function parseSentencePatternReference(
  input: ImportReferenceInput,
): { entries: SentencePatternInput[]; warnings: string[] } {
  const lower = input.filename.toLowerCase()
  if (!lower.endsWith('.csv')) throw new FormatUnsupportedError(input.filename, ['csv'])
  const table = parseDelimitedTable(input.bytes, input.filename)
  const sourceColumn = requiredReferenceColumn(
    table.headers,
    PATTERN_SOURCE_COLUMNS,
    input.filename,
    'source',
  )
  const draftColumn = referenceColumn(table.headers, PATTERN_DRAFT_COLUMNS)
  const suggestedColumn = referenceColumn(table.headers, PATTERN_SUGGESTED_COLUMNS)
  const textTypeColumn = referenceColumn(table.headers, PATTERN_TEXT_TYPE_COLUMNS)
  const moduleColumn = referenceColumn(table.headers, PATTERN_MODULE_COLUMNS)
  const reviewerColumn = referenceColumn(table.headers, PATTERN_REVIEWER_COLUMNS)
  const statusColumn = referenceColumn(table.headers, PATTERN_STATUS_COLUMNS)
  const entries = table.rows.map((row, index) => {
    const source = row[sourceColumn]!.trim()
    if (source === '') {
      throw new FormatParseError(
        'sentence_pattern_csv',
        input.filename,
        `第 ${index + 2} 行的 source 不能为空`,
      )
    }
    const draftTarget = optionalCell(row, draftColumn)
    const suggestedTarget = optionalCell(row, suggestedColumn)
    const textType = optionalCell(row, textTypeColumn)
    const module = optionalCell(row, moduleColumn)
    const reviewer = optionalCell(row, reviewerColumn)
    return {
      source,
      ...(draftTarget !== undefined ? { draftTarget } : {}),
      ...(suggestedTarget !== undefined ? { suggestedTarget } : {}),
      ...(textType !== undefined ? { textType } : {}),
      ...(module !== undefined ? { module } : {}),
      ...(reviewer !== undefined ? { reviewer } : {}),
      status: statusColumn < 0
        ? 'pending'
        : parseSentencePatternStatus(row[statusColumn]!, input.filename, index + 2),
    }
  })
  return { entries, warnings: [] }
}
