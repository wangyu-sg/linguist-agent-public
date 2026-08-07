import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  FormatParseError,
  normalizeDelimitedHeader,
  parseDelimitedTable,
} from '@linguist/cat-formats'
import {
  loadDatabaseSync,
  type SqliteDatabase,
  type TermEntryImportInput,
  type TmUnitImportInput,
} from '@linguist/cat-store'

function withTempFile<T>(bytes: Uint8Array, extension: string, read: (path: string) => T): T {
  const dir = mkdtempSync(join(tmpdir(), 'linguist-trados-'))
  const path = join(dir, `source${extension}`)
  writeFileSync(path, bytes)
  try {
    return read(path)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

function localeMatches(actual: string, expected: string): boolean {
  const left = actual.toLowerCase()
  const right = expected.toLowerCase()
  return left === right || left.split('-', 1)[0] === right.split('-', 1)[0]
}

function decodeXmlText(value: string): string {
  return value
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/<[^>]+>/g, '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .trim()
}

function decodeSdlSegment(value: string): string {
  const values = Array.from(
    value.matchAll(/<Value\b[^>]*>([\s\S]*?)<\/Value>/g),
    (match) => decodeXmlText(match[1] ?? ''),
  ).filter(Boolean)
  return values.length > 0 ? values.join('') : decodeXmlText(value)
}

export function parseSdltmReference(
  bytes: Uint8Array,
  filename: string,
  sourceLocale: string,
  targetLocale: string,
): { entries: TmUnitImportInput[]; warnings: string[] } {
  return withTempFile(bytes, '.sdltm', (path) => {
    let db: SqliteDatabase | undefined
    try {
      const DatabaseSync = loadDatabaseSync()
      db = new DatabaseSync(path, { readOnly: true })
      const rows = db.prepare(`
        SELECT
          tu.source_segment AS source,
          tu.target_segment AS target,
          tm.source_language AS sourceLocale,
          tm.target_language AS targetLocale
        FROM translation_units tu
        JOIN translation_memories tm ON tm.id = tu.translation_memory_id
        WHERE COALESCE(tu.source_segment, '') <> ''
          AND COALESCE(tu.target_segment, '') <> ''
        ORDER BY tu.id
      `).all() as Array<{
        source: string
        target: string
        sourceLocale: string
        targetLocale: string
      }>
      const entries = rows.flatMap((row): TmUnitImportInput[] => {
        if (!localeMatches(row.sourceLocale, sourceLocale) || !localeMatches(row.targetLocale, targetLocale)) {
          return []
        }
        const source = decodeSdlSegment(row.source)
        const target = decodeSdlSegment(row.target)
        return source === '' || target === '' ? [] : [{
          source,
          target,
          sourceLocale,
          targetLocale,
          origin: 'imported',
        }]
      })
      if (entries.length === 0) {
        throw new FormatParseError('sdltm', filename, '没有匹配项目语言方向的有效翻译单元')
      }
      return { entries, warnings: [] }
    } catch (error) {
      if (error instanceof FormatParseError) throw error
      throw new FormatParseError('sdltm', filename, '不是可读取的 Trados SDLTM 数据库', { cause: error })
    } finally {
      db?.close()
    }
  })
}

function mdbTool(name: 'mdb-tables' | 'mdb-export'): string {
  for (const path of [`/opt/homebrew/bin/${name}`, `/usr/local/bin/${name}`]) {
    if (existsSync(path)) return path
  }
  return name
}

function runMdb(tool: 'mdb-tables' | 'mdb-export', args: string[], filename: string): string {
  try {
    return execFileSync(mdbTool(tool), args, {
      encoding: 'utf8',
      maxBuffer: 256 * 1024 * 1024,
    })
  } catch (error) {
    throw new FormatParseError('sdltb', filename, `${tool} 无法读取 SDLTB`, { cause: error })
  }
}

function column(headers: readonly string[], aliases: readonly string[]): number {
  const wanted = new Set(aliases.map(normalizeDelimitedHeader))
  return headers.findIndex((header) => wanted.has(normalizeDelimitedHeader(header)))
}

function parseSdltbIndex(csv: string, filename: string): Map<number, string[]> {
  const table = parseDelimitedTable(new TextEncoder().encode(csv), filename)
  const conceptColumn = column(table.headers, ['conceptid', 'concept id'])
  const termColumn = column(table.headers, ['origterm', 'term'])
  if (conceptColumn < 0 || termColumn < 0) {
    throw new FormatParseError('sdltb', filename, '语言索引表缺少 conceptid/origterm 列')
  }
  const result = new Map<number, string[]>()
  for (const row of table.rows) {
    const conceptId = Number(row[conceptColumn])
    const term = row[termColumn]?.trim() ?? ''
    if (!Number.isFinite(conceptId) || term === '') continue
    const terms = result.get(conceptId) ?? []
    if (!terms.includes(term)) terms.push(term)
    result.set(conceptId, terms)
  }
  return result
}

function languageTable(tables: readonly string[], locale: string, filename: string): string {
  const normalized = locale.toUpperCase()
  const exact = `I_${normalized}`
  if (tables.includes(exact)) return exact
  const primary = normalized.split('-', 1)[0]
  const matches = tables.filter((table) => table.toUpperCase().startsWith(`I_${primary}`))
  if (matches.length === 1) return matches[0]!
  throw new FormatParseError('sdltb', filename, `找不到语言 ${locale} 的唯一索引表`)
}

function conceptDescriptions(csv: string, filename: string): Map<number, string[]> {
  const table = parseDelimitedTable(new TextEncoder().encode(csv), filename)
  const conceptColumn = column(table.headers, ['conceptid', 'concept id'])
  const textColumn = column(table.headers, ['text'])
  const result = new Map<number, string[]>()
  if (conceptColumn < 0 || textColumn < 0) return result
  for (const row of table.rows) {
    const conceptId = Number(row[conceptColumn])
    if (!Number.isFinite(conceptId)) continue
    const descriptions = Array.from(
      (row[textColumn] ?? '').matchAll(/<d\b[^>]*\btype="Description"[^>]*>([\s\S]*?)<\/d>/gi),
      (match) => decodeXmlText(match[1] ?? ''),
    ).filter(Boolean)
    if (descriptions.length > 0) result.set(conceptId, descriptions)
  }
  return result
}

export function parseSdltbReference(
  bytes: Uint8Array,
  filename: string,
  sourceLocale: string,
  targetLocale: string,
): { entries: TermEntryImportInput[]; warnings: string[] } {
  return withTempFile(bytes, '.sdltb', (path) => {
    const tables = runMdb('mdb-tables', ['-1', path], filename)
      .split(/\r?\n/)
      .map((value) => value.trim())
      .filter(Boolean)
    const sourceTable = languageTable(tables, sourceLocale, filename)
    const targetTable = languageTable(tables, targetLocale, filename)
    const sources = parseSdltbIndex(runMdb('mdb-export', [path, sourceTable], filename), filename)
    const targets = parseSdltbIndex(runMdb('mdb-export', [path, targetTable], filename), filename)
    const descriptions = tables.includes('mtConcepts')
      ? conceptDescriptions(runMdb('mdb-export', [path, 'mtConcepts'], filename), filename)
      : new Map<number, string[]>()
    const entries: TermEntryImportInput[] = []
    for (const [conceptId, sourceTerms] of sources) {
      for (const term of sourceTerms) {
        for (const translation of targets.get(conceptId) ?? []) {
          const detail = descriptions.get(conceptId) ?? []
          entries.push({
            term,
            translation,
            status: 'allowed',
            caseSensitive: false,
            note: [`SDLTB concept ${conceptId}`, ...detail].join(' | '),
          })
        }
      }
    }
    if (entries.length === 0) {
      throw new FormatParseError('sdltb', filename, '没有匹配项目语言方向的有效术语对')
    }
    return { entries, warnings: [] }
  })
}
