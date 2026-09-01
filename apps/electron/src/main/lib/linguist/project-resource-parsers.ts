import {
  FormatParseError,
  FormatUnsupportedError,
  normalizeDelimitedHeader,
  parseDelimitedTable,
  parseXlsxWorkbook,
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
import { parseSdltbReference, parseSdltmReference } from './trados-reference-parsers'

type ParsedTmUnitImportInput = Omit<TmUnitImportInput, 'sourceId'>

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
): Promise<{ entries: ParsedTmUnitImportInput[]; warnings: string[] }> {
  const lower = input.filename.toLowerCase()
  if (lower.endsWith('.tmx')) {
    const parsed = parseTmx(input.bytes, { sourceLocale, targetLocale, filename: input.filename })
    return Promise.resolve({
      entries: parsed.entries,
      warnings: parsed.warnings.map((item) => item.message),
    })
  }
  if (lower.endsWith('.sdltm')) {
    return Promise.resolve(parseSdltmReference(input.bytes, input.filename, sourceLocale, targetLocale))
  }
  if (lower.endsWith('.xlsx')) return parseXlsxTmReference(input, sourceLocale, targetLocale)
  if (!lower.endsWith('.csv')) throw new FormatUnsupportedError(input.filename, ['tmx', 'sdltm', 'xlsx', 'csv'])
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
    return { source, target, sourceLocale, targetLocale, occurrenceKey: String(index + 2) }
  })
  return Promise.resolve({ entries, warnings: [] })
}

export function parseTermReference(
  input: ImportReferenceInput,
  sourceLocale: string,
  targetLocale: string,
): Promise<{ entries: TermEntryImportInput[]; warnings: string[] }> {
  const lower = input.filename.toLowerCase()
  if (lower.endsWith('.tbx')) {
    const parsed = parseTbx(input.bytes, { sourceLocale, targetLocale, filename: input.filename })
    return Promise.resolve({ entries: parsed.entries, warnings: parsed.warnings.map((item) => item.message) })
  }
  if (lower.endsWith('.sdltb')) {
    return Promise.resolve(parseSdltbReference(input.bytes, input.filename, sourceLocale, targetLocale))
  }
  if (lower.endsWith('.xlsx')) return parseXlsxTermReference(input)
  if (!lower.endsWith('.csv')) throw new FormatUnsupportedError(input.filename, ['tbx', 'sdltb', 'xlsx', 'csv'])
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
  return Promise.resolve({ entries, warnings: [] })
}

async function mappedXlsxRows(input: ImportReferenceInput): Promise<{
  rows: Array<{ source: string; target: string; rowNo: number }>
  warnings: string[]
}> {
  const mapping = input.xlsxMapping
  if (mapping === undefined) {
    throw new FormatParseError('xlsx_reference', input.filename, 'XLSX TM/TB 导入需要明确 Sheet 和源/目标列映射')
  }
  const workbook = await parseXlsxWorkbook(input.bytes, { filename: input.filename })
  const sheet = workbook.sheets.find((candidate) => candidate.name === mapping.sheetName)
  if (sheet === undefined) {
    throw new FormatParseError('xlsx_reference', input.filename, `找不到 Sheet ${JSON.stringify(mapping.sheetName)}`)
  }
  const header = sheet.headers.at(-1)
  if (header === undefined) throw new FormatParseError('xlsx_reference', input.filename, 'Sheet 没有表头')
  const findColumn = (name: string): number => {
    const normalized = normalizeDelimitedHeader(name)
    const matches = header.cells.filter((cell) => normalizeDelimitedHeader(cell.value) === normalized)
    if (matches.length !== 1) {
      throw new FormatParseError('xlsx_reference', input.filename, `列 ${JSON.stringify(name)} 不存在或不唯一`)
    }
    return matches[0]!.col
  }
  const sourceColumn = findColumn(mapping.columns.source)
  const targetColumn = findColumn(mapping.columns.target)
  const rows = sheet.rows.flatMap((row) => {
    const source = row.cells.find((cell) => cell.col === sourceColumn)?.value.trim() ?? ''
    const target = row.cells.find((cell) => cell.col === targetColumn)?.value.trim() ?? ''
    return source === '' || target === '' ? [] : [{ source, target, rowNo: row.rowNo }]
  })
  if (rows.length === 0) {
    throw new FormatParseError('xlsx_reference', input.filename, '映射列中没有完整 source/target 数据行')
  }
  return { rows, warnings: workbook.warnings.map((warning) => warning.message) }
}

async function parseXlsxTmReference(
  input: ImportReferenceInput,
  sourceLocale: string,
  targetLocale: string,
): Promise<{ entries: ParsedTmUnitImportInput[]; warnings: string[] }> {
  const parsed = await mappedXlsxRows(input)
  return {
    entries: parsed.rows.map((row) => ({
      source: row.source,
      target: row.target,
      sourceLocale,
      targetLocale,
      occurrenceKey: String(row.rowNo),
    })),
    warnings: parsed.warnings,
  }
}

async function parseXlsxTermReference(
  input: ImportReferenceInput,
): Promise<{ entries: TermEntryImportInput[]; warnings: string[] }> {
  const parsed = await mappedXlsxRows(input)
  return {
    entries: parsed.rows.map((row) => ({
      term: row.source,
      translation: row.target,
      status: 'allowed',
      caseSensitive: false,
      note: `XLSX row ${row.rowNo}`,
    })),
    warnings: parsed.warnings,
  }
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
