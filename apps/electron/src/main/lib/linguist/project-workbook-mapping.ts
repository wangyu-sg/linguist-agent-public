import { readFile, realpath, stat } from 'node:fs/promises'
import { basename, isAbsolute, resolve } from 'node:path'
import {
  sha256Hex,
  type LinguistProject,
  type LinguistWorkbookMappingProfile,
  type WorkbookMappingColumns,
  type WorkbookMappingColumnRole,
} from '@linguist/cat-core'
import {
  normalizeDelimitedHeader,
  parseXlsxWorkbook,
  type XlsxWorkbookParseResult,
  type XlsxWorkbookSheet,
} from '@linguist/cat-formats'
import type {
  LinguistIntakeXlsxMapping,
  LinguistSaveWorkbookMappingInput,
  LinguistWorkbookMappingPreview,
  LinguistWorkbookMappingSuggestion,
} from '@linguist/cat-tools'
import { LinguistCatInvalidArgumentError } from '@linguist/cat-tools'
import { LINGUIST_IMPORT_MAX_BYTES } from '@proma/shared'

const SAMPLE_ROWS = 50
const SAMPLE_VALUE_CHARS = 300
const ROLE_ALIASES: Record<WorkbookMappingColumnRole, readonly string[]> = {
  key: ['id', 'key', 'stringid', 'segmentid', '唯一键'],
  source: ['source', 'src', 'original', 'sourcetext', '源文', '原文'],
  target: ['target', 'tgt', 'translation', 'targettext', '译文', '翻译'],
  context: ['context', 'note', 'notes', 'comment', '备注', '上下文'],
  speaker: ['speaker', 'character', 'voice', '说话人', '角色'],
  status: ['status', 'state', 'translationstatus', '状态'],
}

interface WorkbookFile {
  filename: string
  bytes: Uint8Array
}

async function readWorkbookFile(cwd: string, filePath: string): Promise<WorkbookFile> {
  try {
    const path = await realpath(isAbsolute(filePath) ? filePath : resolve(cwd, filePath))
    const info = await stat(path)
    if (!info.isFile() || info.size > LINGUIST_IMPORT_MAX_BYTES) throw new Error('invalid workbook file')
    return { filename: basename(path), bytes: await readFile(path) }
  } catch {
    throw new LinguistCatInvalidArgumentError('filePath', 'must resolve to a readable XLSX within the import size limit')
  }
}

function headerSignature(sheet: XlsxWorkbookSheet): string {
  const header = sheet.headers[0]
  const signature = (header?.cells ?? [])
    .map((cell) => `${cell.col}:${normalizeDelimitedHeader(cell.value)}`)
    .join('|')
  return sha256Hex(new TextEncoder().encode(signature))
}

function localeAliases(locale: string): string[] {
  const language = locale.toLowerCase().split(/[-_]/)[0] ?? ''
  if (language === 'en') return ['en', 'english']
  if (language === 'zh') return ['zh', 'chinese', '中文']
  return language === '' ? [] : [language]
}

function suggestMapping(
  sheet: XlsxWorkbookSheet,
  sourceLocale: string,
  targetLocale: string,
): LinguistWorkbookMappingSuggestion {
  const headers = sheet.headers[0]?.cells ?? []
  const normalized = headers.map((cell) => ({ value: cell.value, normalized: normalizeDelimitedHeader(cell.value), col: cell.col }))
  const used = new Set<number>()
  const columns: Partial<WorkbookMappingColumns> = {}
  const reasons: string[] = []
  let score = 0
  let scoredRoles = 0
  const aliases = {
    ...ROLE_ALIASES,
    source: [...ROLE_ALIASES.source, ...localeAliases(sourceLocale)],
    target: [...ROLE_ALIASES.target, ...localeAliases(targetLocale)],
  }
  for (const role of ['key', 'source', 'target', 'context', 'speaker', 'status'] as const) {
    const match = normalized.find((column) => !used.has(column.col) && aliases[role].includes(column.normalized))
    if (!match) continue
    used.add(match.col)
    columns[role] = match.value
    reasons.push(`${role} 命中列名 ${JSON.stringify(match.value)}`)
    if (role === 'source' || role === 'target') {
      score += 0.95
      scoredRoles += 1
    }
  }

  if (columns.source === undefined || columns.target === undefined) {
    const candidates = normalized.filter((column) => {
      if (used.has(column.col)) return false
      const values = sheet.rows
        .map((row) => row.cells.find((cell) => cell.col === column.col)?.value.trim() ?? '')
        .filter(Boolean)
      return values.length >= Math.min(2, Math.max(1, sheet.rows.length))
        && values.some((value) => /\p{L}/u.test(value))
    })
    for (const role of ['source', 'target'] as const) {
      if (columns[role] !== undefined) continue
      const candidate = candidates.find((column) => !used.has(column.col))
      if (!candidate) continue
      used.add(candidate.col)
      columns[role] = candidate.value
      reasons.push(`${role} 由前 ${SAMPLE_ROWS} 行的主要文本列推断为 ${JSON.stringify(candidate.value)}`)
      score += 0.55
      scoredRoles += 1
    }
  }
  return {
    columns,
    confidence: columns.source !== undefined && columns.target !== undefined
      ? Number((score / Math.max(2, scoredRoles)).toFixed(2))
      : 0,
    reasons,
  }
}

function filenameMatches(pattern: string, filename: string): boolean {
  const source = pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replaceAll('*', '.*')
  return new RegExp(`^${source}$`, 'i').test(filename)
}

function findProfile(
  project: LinguistProject,
  parsed: XlsxWorkbookParseResult,
  filename: string,
): LinguistWorkbookMappingProfile | undefined {
  const profiles = project.workbookMappings ?? []
  return profiles.find((profile) => profile.workbookFingerprint === parsed.report.sourceSha256)
    ?? profiles.find((profile) => {
      const sheet = parsed.sheets.find((candidate) => candidate.name === profile.sheetName)
      return sheet !== undefined
        && filenameMatches(profile.filenamePattern, filename)
        && headerSignature(sheet) === profile.headerSignature
    })
}

function validateColumns(sheet: XlsxWorkbookSheet, columns: WorkbookMappingColumns): WorkbookMappingColumns {
  const header = sheet.headers[0]
  if (!header) throw new LinguistCatInvalidArgumentError('sheetName', 'selected sheet has no header row')
  const selected = new Set<string>()
  const next = { ...columns }
  for (const role of ['key', 'source', 'target', 'context', 'speaker', 'status'] as const) {
    const value = columns[role]
    if (value === undefined) continue
    const normalized = normalizeDelimitedHeader(value)
    const matches = header.cells.filter((cell) => normalizeDelimitedHeader(cell.value) === normalized)
    if (normalized === '' || matches.length !== 1 || selected.has(normalized)) {
      throw new LinguistCatInvalidArgumentError('columns', `${role} column is missing, ambiguous, or reused`)
    }
    selected.add(normalized)
    next[role] = matches[0]!.value
  }
  return next
}

async function parseWorkbook(file: WorkbookFile): Promise<XlsxWorkbookParseResult> {
  try {
    return await parseXlsxWorkbook(file.bytes, { filename: file.filename, maxRowsPerSheet: SAMPLE_ROWS })
  } catch (error) {
    throw new LinguistCatInvalidArgumentError(
      'filePath',
      error instanceof Error ? `XLSX parse failed: ${error.message}` : 'XLSX parse failed',
    )
  }
}

export async function previewProjectWorkbookMapping(
  project: LinguistProject,
  cwd: string,
  filePath: string,
): Promise<LinguistWorkbookMappingPreview> {
  const file = await readWorkbookFile(cwd, filePath)
  const parsed = await parseWorkbook(file)
  const truncated = new Set(parsed.report.sampling.truncatedSheets.map((entry) => entry.sheet))
  const matched = findProfile(project, parsed, file.filename)
  return {
    filename: file.filename,
    workbookFingerprint: parsed.report.sourceSha256,
    ...(matched === undefined ? {} : { matchedProfileId: matched.id }),
    sheets: parsed.sheets.map((sheet) => ({
      name: sheet.name,
      state: sheet.state,
      headerRowNumbers: sheet.headerRowNumbers,
      headerSignature: headerSignature(sheet),
      headers: (sheet.headers[0]?.cells ?? []).map((cell) => ({ ref: cell.ref, value: cell.value })),
      sampleRows: sheet.rows.map((row) => ({
        rowNo: row.rowNo,
        cells: row.cells.map((cell) => ({
          ref: cell.ref,
          value: cell.value.slice(0, SAMPLE_VALUE_CHARS),
          kind: cell.kind,
        })),
      })),
      mergedRanges: sheet.mergedRanges,
      truncated: truncated.has(sheet.name),
      suggestion: suggestMapping(sheet, project.sourceLocale, project.targetLocale),
    })),
    skippedSheets: parsed.skippedSheets,
  }
}

export async function createProjectWorkbookMappingProfile(
  project: LinguistProject,
  cwd: string,
  filePath: string,
  input: LinguistSaveWorkbookMappingInput,
  now: string,
): Promise<LinguistWorkbookMappingProfile> {
  const file = await readWorkbookFile(cwd, filePath)
  const parsed = await parseWorkbook(file)
  const sheet = parsed.sheets.find((candidate) => candidate.name === input.sheetName)
  if (!sheet) throw new LinguistCatInvalidArgumentError('sheetName', 'selected sheet does not exist')
  const filenamePattern = input.filenamePattern?.trim() || file.filename
  if (filenamePattern.includes('/') || filenamePattern.includes('\\')) {
    throw new LinguistCatInvalidArgumentError('filenamePattern', 'must be a basename pattern without path separators')
  }
  const signature = headerSignature(sheet)
  const id = `wbm_${sha256Hex(new TextEncoder().encode(`${parsed.report.sourceSha256}|${sheet.name}|${signature}|${filenamePattern}`)).slice(0, 24)}`
  const existing = project.workbookMappings?.find((profile) => profile.id === id)
  return {
    id,
    ...(input.name?.trim() ? { name: input.name.trim() } : {}),
    workbookFingerprint: parsed.report.sourceSha256,
    filenamePattern,
    sheetName: sheet.name,
    headerSignature: signature,
    columns: validateColumns(sheet, input.columns),
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  }
}

export async function resolveProjectWorkbookMapping(
  project: LinguistProject,
  bytes: Uint8Array,
  filename: string,
): Promise<LinguistIntakeXlsxMapping | undefined> {
  if ((project.workbookMappings?.length ?? 0) === 0) return undefined
  const parsed = await parseWorkbook({ bytes, filename })
  const profile = findProfile(project, parsed, filename)
  if (!profile) return undefined
  return {
    sheetName: profile.sheetName,
    columns: {
      ...(profile.columns.key === undefined ? {} : { key: profile.columns.key }),
      source: profile.columns.source,
      target: profile.columns.target,
      ...(profile.columns.context === undefined ? {} : { context: profile.columns.context }),
    },
  }
}
