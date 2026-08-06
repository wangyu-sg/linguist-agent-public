/**
 * CsvAdapter — RFC-4180-style CSV/TSV bilingual format adapter.
 *
 * Parsing (documented deviations from strict RFC 4180 are deliberate):
 * - quoted fields, escaped quotes (`""`), embedded CR/LF inside quotes,
 *   CRLF / LF / lone-CR line terminators, UTF-8 BOM strip (re-added on
 *   export so unmodified export stays byte-stable);
 * - a `"` is special ONLY as the first character of a field; a quote in
 *   the middle of an unquoted field is literal (lenient, matches common
 *   tooling). After a closing quote only delimiter/CR/LF/EOF is allowed —
 *   anything else is a FORMAT_PARSE_ERROR, as is an unclosed quote;
 * - blank lines (zero characters before the terminator) are skipped —
 *   they carry no data and their bytes stay in the export template;
 * - a row with FEWER fields than the header is padded with '' (typical
 *   for a trailing empty target cell); a row with MORE fields is a
 *   FORMAT_PARSE_ERROR (never silently drop data).
 *
 * TSV semantics: `.tsv` is the same parser with the tab delimiter —
 * quoting rules are still honored (some tools emit quoted TSV), and the
 * delimiter is always established by header sniffing, never by extension
 * alone. Tab is simply tried first for `.tsv` filenames.
 *
 * Delimiter sniffing: the header row is parsed with each candidate
 * (comma / tab / semicolon; tab first for `.tsv`) and the candidate
 * yielding the most header fields wins; a header with fewer than 2
 * fields under every candidate is a FORMAT_PARSE_ERROR (single-column
 * files carry no source/target pair). Candidates whose parse throws
 * count as 0 fields.
 *
 * Column mapping (all header matching is normalized: trim + lowercase +
 * strip [\s_/-], so `Source Text`, `source-text` and `SOURCE` all match):
 * - key:     key, id, segmentid, uniquekey, 唯一键
 * - source:  source, src, sourcetext, 源文, 原文        (REQUIRED)
 * - target:  target, tgt, translation, targettext, 译文, 翻译
 * - locked:  locked, lock, 锁定
 * - context: context, note, notes, comment, 备注        (-> context.note)
 * Any of these can be overridden with an explicit header name via
 * `new CsvAdapter({ columns: { ... } })`; an explicit name that is not
 * present in the header is a FORMAT_PARSE_ERROR. A missing source column
 * is a FORMAT_PARSE_ERROR; a missing target column means all targets are
 * '' (and no target can ever be written on export — FormatExportError if
 * one changed). The locked column maps true/yes/1 (case-insensitive) to
 * `locked: true`, everything else (false/no/0/empty) to false — export
 * never writes the locked column back; it only refuses to change a
 * locked row's target.
 *
 * Keys: from the key column (trimmed); a row without a key (or a file
 * without a key column) gets a synthesized stable `#row-<ordinal>` key
 * plus an import warning (code 'csv.synthesized_key'). Duplicate keys
 * are a FORMAT_PARSE_ERROR.
 *
 * Status mapping (deliberately minimal): empty target -> 'untranslated',
 * non-empty target -> 'translated'. CSV carries no review state.
 *
 * Export contract (template-based, plan §6.3):
 * - originalBytes is the template; rows are located by key with the same
 *   parsing/mapping pipeline as import;
 * - a segment whose target equals the template target is left
 *   BYTE-UNTOUCHED, so unmodified export reproduces the original bytes
 *   exactly (BOM, CRLF, quoting style of untouched rows included);
 * - a changed target rewrites only the target field's raw span (quoted
 *   iff it contains delimiter/quote/CR/LF, quotes doubled); a row that
 *   is shorter than the header gets the missing cells appended at the
 *   end of the record;
 * - unknown key, segment missing from input, source mismatch, a changed
 *   target on a locked row, or a changed target with no target column ->
 *   FormatExportError; nothing is ever skipped silently.
 *
 * Known limitations:
 * - header row is REQUIRED (first non-blank record); headerless CSV is
 *   rejected — pass a file with a header;
 * - multi-line header fields are tolerated by the parser but make the
 *   "header row" span multiple physical lines; don't do that;
 * - the locked column is read-only on export (lock state changes are not
 *   written back; only target text is);
 * - delimiter sniffing is per-file; a file whose data rows switch
 *   delimiters is malformed and will fail parsing.
 */

import { fnv1a64 } from '@linguist/cat-core'
import type {
  CatFormatAdapter,
  CatFormatExportInput,
  CatFormatImportInput,
  ImportedCatAsset,
  ImportedCatSegment,
  ImportWarning,
} from '../adapter'
import { FormatExportError, FormatParseError } from '../errors'
import { sha256Hex, type HashFn } from '../hash'

export const CSV_ADAPTER_ID = 'csv_rfc4180'

// Exported so sibling delimited-table adapters (xlsx) share ONE alias table
// set instead of growing a second copy; semantics stay identical.
export const KEY_ALIASES = ['key', 'id', 'segmentid', 'uniquekey', '唯一键']
export const SOURCE_ALIASES = ['source', 'src', 'sourcetext', '源文', '原文']
export const TARGET_ALIASES = ['target', 'tgt', 'translation', 'targettext', '译文', '翻译']
export const LOCKED_ALIASES = ['locked', 'lock', '锁定']
export const CONTEXT_ALIASES = ['context', 'note', 'notes', 'comment', '备注']

export const LOCKED_TRUTHY: ReadonlySet<string> = new Set(['true', 'yes', '1'])
const BOM = '\uFEFF'

/** Explicit per-column header names; each overrides alias detection for that column. */
export interface CsvColumnMapping {
  key?: string
  source?: string
  target?: string
  locked?: string
  context?: string
}

export interface CsvAdapterOptions {
  columns?: CsvColumnMapping
  /** Injectable hasher; default is the built-in pure-TS SHA-256. */
  hash?: HashFn
}

interface RawField {
  value: string
  /** Raw span of the field (incl. quotes) in the BOM-stripped template text. */
  start: number
  end: number
}

interface RawRecord {
  fields: RawField[]
  /** Offset just past the record's content, before its line terminator. */
  end: number
}

interface ResolvedColumns {
  key: number
  source: number
  target: number
  locked: number
  context: number
}

interface ParsedRow {
  ordinal: number
  key: string
  keySynthesized: boolean
  source: string
  target: string
  locked: boolean
  note: string | undefined
  record: RawRecord
}

export function normalizeDelimitedHeader(value: string): string {
  return value.trim().toLowerCase().replace(/[\s_/-]+/g, '')
}

function looksBinary(bytes: Uint8Array): boolean {
  const probe = Math.min(bytes.length, 512)
  for (let i = 0; i < probe; i++) if (bytes[i] === 0) return true
  return false
}

/** RFC-4180-style record parser; `fail` receives a human-readable detail on malformed input. */
function parseRecords(text: string, delimiter: string, fail: (detail: string) => never): RawRecord[] {
  const records: RawRecord[] = []
  const n = text.length
  let i = 0
  let physical = 0
  while (i < n) {
    physical += 1
    const recordStart = i
    const fields: RawField[] = []
    for (;;) {
      const start = i
      let value = ''
      if (text[i] === '"') {
        i += 1
        let closed = false
        while (i < n) {
          const ch = text[i]!
          if (ch === '"') {
            if (text[i + 1] === '"') {
              value += '"'
              i += 2
              continue
            }
            i += 1
            closed = true
            break
          }
          value += ch
          i += 1
        }
        if (!closed) fail(`record #${physical}: unclosed quoted field`)
        if (i < n && text[i] !== delimiter && text[i] !== '\r' && text[i] !== '\n') {
          fail(`record #${physical}: unexpected character ${JSON.stringify(text[i])} after closing quote`)
        }
      } else {
        while (i < n && text[i] !== delimiter && text[i] !== '\r' && text[i] !== '\n') {
          value += text[i]
          i += 1
        }
      }
      fields.push({ value, start, end: i })
      if (i < n && text[i] === delimiter) {
        i += 1
        continue
      }
      const end = i
      if (i < n && text[i] === '\r') {
        i += 1
        if (i < n && text[i] === '\n') i += 1
      } else if (i < n && text[i] === '\n') {
        i += 1
      }
      if (end > recordStart) records.push({ fields, end }) // skip blank lines
      break
    }
  }
  return records
}

/** 供 CAT reference import 复用的 RFC-4180 读取器；不会复制第二套 CSV parser。 */
export function parseDelimitedTable(
  bytes: Uint8Array,
  filename: string,
): { headers: string[]; rows: string[][] } {
  let text: string
  try {
    text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes)
  } catch (err) {
    throw new FormatParseError(CSV_ADAPTER_ID, filename, 'input is not valid UTF-8', { cause: err })
  }
  const stripped = text.startsWith(BOM) ? text.slice(1) : text
  const delimiter = sniffDelimiter(stripped, filename)
  if (delimiter === undefined) {
    throw new FormatParseError(CSV_ADAPTER_ID, filename, 'header row has fewer than 2 columns')
  }
  const fail = (detail: string): never => {
    throw new FormatParseError(CSV_ADAPTER_ID, filename, detail)
  }
  const records = parseRecords(stripped, delimiter, fail)
  if (records.length < 2) fail('header row and at least one data row are required')
  const headers = records[0]!.fields.map((field) => field.value)
  return {
    headers,
    rows: records.slice(1).map((record, index) => {
      if (record.fields.length > headers.length) {
        fail(`record #${index + 2}: row has more fields than the header`)
      }
      return headers.map((_, column) => record.fields[column]?.value ?? '')
    }),
  }
}

/** Picks the delimiter whose parse yields the most header fields; undefined when none gives >= 2. */
function sniffDelimiter(text: string, filename: string): string | undefined {
  const candidates = filename.toLowerCase().endsWith('.tsv') ? ['\t', ',', ';'] : [',', '\t', ';']
  let best: string | undefined
  let bestCount = 0
  for (const delimiter of candidates) {
    let records: RawRecord[]
    try {
      records = parseRecords(text, delimiter, (detail) => {
        throw new Error(detail)
      })
    } catch {
      continue
    }
    const count = records[0]?.fields.length ?? 0
    if (count > bestCount) {
      best = delimiter
      bestCount = count
    }
  }
  return bestCount >= 2 ? best : undefined
}

/** Encodes one field for writing: quote iff it contains delimiter/quote/CR/LF. */
function encodeField(value: string, delimiter: string): string {
  if (value.includes(delimiter) || value.includes('"') || value.includes('\r') || value.includes('\n')) {
    return `"${value.replace(/"/g, '""')}"`
  }
  return value
}

export class CsvAdapter implements CatFormatAdapter {
  readonly id: string = CSV_ADAPTER_ID
  readonly extensions = ['.csv', '.tsv']

  private readonly columns: CsvColumnMapping
  private readonly hash: HashFn

  constructor(options: CsvAdapterOptions = {}) {
    this.columns = options.columns ?? {}
    this.hash = options.hash ?? sha256Hex
  }

  async detect(input: Uint8Array, filename: string): Promise<number> {
    if (looksBinary(input)) return 0
    const lower = filename.toLowerCase()
    if (!this.extensions.some((ext) => lower.endsWith(ext))) return 0
    try {
      const { headers } = parseDelimitedTable(input, filename)
      this.resolveColumns(headers, filename)
    } catch {
      return 0
    }
    return 0.9
  }

  async import(input: CatFormatImportInput): Promise<ImportedCatAsset> {
    const { bytes, filename, sourceLocale, targetLocale } = input
    const text = this.decode(bytes, filename)
    const parsed = this.parseTemplate(text, filename)
    const segments: ImportedCatSegment[] = parsed.rows.map((row) => ({
      ordinal: row.ordinal,
      key: row.key,
      source: row.source,
      target: row.target,
      sourceLocale,
      targetLocale,
      status: row.target === '' ? 'untranslated' : 'translated',
      locked: row.locked,
      revision: 0,
      sourceHash: fnv1a64(row.source),
      ...(row.note !== undefined ? { context: { note: row.note } } : {}),
    }))
    return {
      asset: {
        formatId: this.id,
        originalFilename: filename,
        sourceSha256: await this.hash(bytes),
        segmentCount: segments.length,
      },
      segments,
      warnings: parsed.warnings,
      originalBytes: bytes,
    }
  }

  async export(input: CatFormatExportInput): Promise<Uint8Array> {
    const { originalBytes, asset, segments } = input
    const filename = asset.originalFilename
    const text = this.decode(originalBytes, filename)
    const hadBom = text.startsWith(BOM)
    const stripped = hadBom ? text.slice(1) : text
    const parsed = this.parseTemplate(text, filename)

    const byKey = new Map<string, (typeof segments)[number]>()
    for (const segment of segments) {
      const key = segment.key ?? ''
      if (byKey.has(key)) {
        throw new FormatExportError(this.id, `duplicate segment key ${JSON.stringify(key)} in export input`)
      }
      byKey.set(key, segment)
    }
    const templateKeys = new Set(parsed.rows.map((row) => row.key))
    for (const key of byKey.keys()) {
      if (!templateKeys.has(key)) {
        throw new FormatExportError(this.id, `segment key ${JSON.stringify(key)} is not present in the original template`)
      }
    }

    // Splice edits over the BOM-stripped text; untouched rows keep exact bytes.
    const edits: Array<{ start: number; end: number; replacement: string }> = []
    for (const row of parsed.rows) {
      const segment = byKey.get(row.key)
      if (!segment) {
        throw new FormatExportError(
          this.id,
          `segment ${JSON.stringify(row.key)} missing from export input; refusing to skip it silently`,
        )
      }
      if (segment.source !== row.source) {
        throw new FormatExportError(
          this.id,
          `segment ${JSON.stringify(row.key)}: source text differs from the original template; sources are never rewritten on export`,
        )
      }
      if (segment.target === row.target) continue
      if (row.locked) {
        throw new FormatExportError(
          this.id,
          `segment ${JSON.stringify(row.key)} is locked but its target was changed; refusing to write or skip it`,
        )
      }
      if (parsed.columns.target < 0) {
        throw new FormatExportError(
          this.id,
          `segment ${JSON.stringify(row.key)}: template has no target column; cannot write the changed target`,
        )
      }
      const field = row.record.fields[parsed.columns.target]
      const encoded = encodeField(segment.target, parsed.delimiter)
      if (field) {
        edits.push({ start: field.start, end: field.end, replacement: encoded })
      } else {
        // Row is shorter than the header: append the missing cells at record end.
        const missing = parsed.columns.target - (row.record.fields.length - 1)
        edits.push({ start: row.record.end, end: row.record.end, replacement: `${parsed.delimiter.repeat(missing)}${encoded}` })
      }
    }

    let out = stripped
    for (let i = edits.length - 1; i >= 0; i--) {
      const edit = edits[i]!
      out = out.slice(0, edit.start) + edit.replacement + out.slice(edit.end)
    }
    return new TextEncoder().encode((hadBom ? BOM : '') + out)
  }

  private decode(bytes: Uint8Array, filename: string): string {
    try {
      // ignoreBOM: keep U+FEFF in the text so export can re-attach it and
      // unmodified export stays byte-stable (BOM is stripped for parsing).
      return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes)
    } catch (err) {
      throw new FormatParseError(this.id, filename, 'input is not valid UTF-8', { cause: err })
    }
  }

  /**
   * Parses the template into rows in document order. Shared by import and
   * export so both sides see identical keys/sources/targets.
   */
  private parseTemplate(
    text: string,
    filename: string,
  ): { delimiter: string; columns: ResolvedColumns; rows: ParsedRow[]; warnings: ImportWarning[] } {
    const stripped = text.startsWith(BOM) ? text.slice(1) : text
    const fail = (detail: string): never => {
      throw new FormatParseError(this.id, filename, detail)
    }
    const delimiter =
      sniffDelimiter(stripped, filename) ??
      fail('header row has fewer than 2 columns with every supported delimiter (comma/tab/semicolon); single-column files are not bilingual CSV')
    const records = parseRecords(stripped, delimiter, fail)
    if (records.length === 0) fail('file is empty; a header row is required')
    const header = records[0]!.fields.map((field) => field.value)
    const columns = this.resolveColumns(header, filename)
    const dataRecords = records.slice(1)
    if (dataRecords.length === 0) fail('header row found but no data rows')

    const warnings: ImportWarning[] = []
    if (columns.key < 0) {
      warnings.push({
        code: 'csv.synthesized_key',
        message: 'no key column found; every row gets a synthesized #row-<ordinal> key',
      })
    }
    const seenKeys = new Set<string>()
    const rows: ParsedRow[] = dataRecords.map((record, ordinal) => {
      if (record.fields.length > header.length) {
        fail(`record #${ordinal + 2}: row has ${record.fields.length} fields but the header has ${header.length}; refusing to drop data silently`)
      }
      const cell = (index: number): string => record.fields[index]?.value ?? ''
      let key = columns.key >= 0 ? cell(columns.key).trim() : ''
      const keySynthesized = key === ''
      if (keySynthesized) {
        key = `#row-${ordinal}`
        if (columns.key >= 0) {
          warnings.push({
            code: 'csv.synthesized_key',
            message: `record #${ordinal + 2} has an empty key; synthesized key ${JSON.stringify(key)}`,
            segmentKey: key,
          })
        }
      }
      if (seenKeys.has(key)) {
        fail(`record #${ordinal + 2}: duplicate key ${JSON.stringify(key)}`)
      }
      seenKeys.add(key)
      const lockedRaw = columns.locked >= 0 ? cell(columns.locked).trim().toLowerCase() : ''
      const note = columns.context >= 0 ? cell(columns.context) : ''
      return {
        ordinal,
        key,
        keySynthesized,
        source: cell(columns.source),
        target: columns.target >= 0 ? cell(columns.target) : '',
        locked: LOCKED_TRUTHY.has(lockedRaw),
        note: note !== '' ? note : undefined,
        record,
      }
    })
    return { delimiter, columns, rows, warnings }
  }

  private resolveColumns(header: string[], filename: string): ResolvedColumns {
    const pick = (aliases: string[], explicit: string | undefined, label: string): number => {
      if (explicit !== undefined) {
        const index = header.findIndex((name) => normalizeDelimitedHeader(name) === normalizeDelimitedHeader(explicit))
        if (index < 0) {
          throw new FormatParseError(
            this.id,
            filename,
            `explicit ${label} column ${JSON.stringify(explicit)} not found in header (${header.join(', ')})`,
          )
        }
        return index
      }
      return header.findIndex((name) => aliases.includes(normalizeDelimitedHeader(name)))
    }
    const key = pick(KEY_ALIASES, this.columns.key, 'key')
    const source = pick(SOURCE_ALIASES, this.columns.source, 'source')
    if (source < 0) {
      throw new FormatParseError(
        this.id,
        filename,
        `no source column found (aliases: ${SOURCE_ALIASES.join('/')}); pass an explicit column mapping for non-standard headers`,
      )
    }
    return {
      key,
      source,
      target: pick(TARGET_ALIASES, this.columns.target, 'target'),
      locked: pick(LOCKED_ALIASES, this.columns.locked, 'locked'),
      context: pick(CONTEXT_ALIASES, this.columns.context, 'context'),
    }
  }
}
