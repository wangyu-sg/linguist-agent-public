/**
 * JsonAdapter — i18n JSON format adapter (plan §6.2, configurable key/value
 * mapping).
 *
 * Two source shapes are recognized:
 *
 * 1. FLAT / NESTED i18n key-value objects (the default shape):
 *      {"menu": {"start": "Start Game"}}
 *    Every string leaf reachable through nested objects becomes a segment;
 *    the segment key is the DOTTED PATH of the leaf (`menu.start`). Path
 *    segments are escaped (`\` -> `\\`, `.` -> `\.`) so a literal dot in a
 *    raw key can never collide with a nesting separator.
 *
 *    TARGET SEMANTICS (deliberate, matches game localization source files):
 *    a flat i18n file is a SOURCE file — there is no target concept in the
 *    shape. Import sets source = leaf value and target = ''. Export writes a
 *    changed target INTO the leaf value, producing the translated file
 *    (en.json in -> zh.json out, same keys). Re-importing an exported file
 *    therefore reads the translations as the new sources; that is the
 *    intended product flow, not data loss. Empty string leaves ARE segments
 *    (source '', target ''); a target equal to the template target ('') is
 *    left byte-untouched, so unmodified export is byte-stable. Flat shape
 *    has no lock concept — locked is always false.
 *
 * 2. ARRAY OF ENTRIES with configurable field mapping (the "configurable
 *    key/value mapping" of plan §6.2):
 *      [{"id": "greet", "source": "Hello", "target": "你好", "locked": false}]
 *    Field names default to id/source/target/locked and can be overridden
 *    via `new JsonAdapter({ arrayMapping: { id, source, target, locked } })`.
 *    The source field is REQUIRED per entry (string); entries that are not
 *    objects or lack a string source are skipped with a `json.entry_skipped`
 *    warning (never silently). Key: the id field (string, non-empty); a
 *    missing/empty/duplicate id gets a synthesized stable `#idx-<ordinal>`
 *    key plus a `json.synthesized_key` warning (same policy as the CSV leg).
 *    Missing or non-string target field -> target ''; `locked: true`
 *    (strict boolean) -> locked segment. On export a changed target rewrites
 *    the target field's raw value span; an entry WITHOUT a target field gets
 *    `"<targetField>": <value>` inserted right after its source field
 *    (whitespace style sniffed from the file).
 *
 * NON-SEGMENT CONTENT: numbers, booleans, nulls and nested arrays (anywhere
 * below the top level) are NOT segments. They carry no spans to edit, so
 * they round-trip byte-stably as part of the template.
 *
 * Parsing: a strict RFC-8259 parser (no JSON.parse) records the RAW BYTE
 * SPAN of every string/value token alongside its decoded value (escapes
 * `\"` `\\` `\/` `\b\f\n\r\t` `\uXXXX` incl. surrogate pairs are decoded for
 * the logical value; the raw text — e.g. a literal `\u00e9` — stays in the
 * template untouched). Duplicate decoded keys inside one object are tracked:
 * import keeps the LAST occurrence (JSON.parse semantics) with a
 * `json.duplicate_key` warning; export REFUSES any template containing a
 * duplicate key with a FormatExportError — splicing by key would be
 * ambiguous and is never done silently. UTF-8 BOM is stripped for parsing
 * and re-attached on export (byte-stable unmodified export). Any malformed
 * input (trailing comma, unclosed string, bad escape, trailing garbage,
 * top-level primitive, no i18n content) is a FORMAT_PARSE_ERROR.
 *
 * Status mapping (deliberately minimal, same as CSV): empty target ->
 * 'untranslated', non-empty target -> 'translated'. JSON carries no review
 * state.
 *
 * Export contract (template-based, plan §6.3):
 * - originalBytes is the template; rows are located by key with the same
 *   parsing/mapping pipeline as import;
 * - a segment whose target equals the template target is left
 *   BYTE-UNTOUCHED, so unmodified export reproduces the original bytes
 *   exactly (BOM, whitespace, key order, raw escape style included);
 * - a changed target replaces exactly the recorded span with
 *   JSON.stringify(target) (canonical JSON string escaping);
 * - unknown key, segment missing from input, source mismatch, a changed
 *   target on a locked entry, duplicate segment key in the export input, or
 *   duplicate raw keys anywhere in the template -> FormatExportError;
 *   nothing is ever skipped silently.
 *
 * Known limitations:
 * - nested arrays inside the flat shape are opaque template content; string
 *   values inside them are not segments (use the top-level array shape for
 *   entry lists);
 * - a target field inserted on export goes inline right after the source
 *   field (`, "target": "..."` or `,"target":"..."` matching the file's
 *   spacing style); it does not replicate multi-line indentation;
 * - the locked flag is read-only on export (lock-state changes are not
 *   written back; only target text is);
 * - edited leaves are re-encoded canonically (JSON.stringify): their escape
 *   style may differ from the original raw form (content identical after
 *   decoding); untouched leaves keep their exact raw bytes.
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

export const JSON_ADAPTER_ID = 'json_i18n'

const BOM = '\uFEFF'

/** Field names for the top-level array shape; each overrides the default for that field. */
export interface JsonArrayMapping {
  /** Default 'id'. */
  id?: string
  /** Default 'source'. */
  source?: string
  /** Default 'target'. */
  target?: string
  /** Default 'locked'. */
  locked?: string
}

export interface JsonAdapterOptions {
  arrayMapping?: JsonArrayMapping
  /** Injectable hasher; default is the built-in pure-TS SHA-256. */
  hash?: HashFn
}

// ---------------------------------------------------------------------------
// Strict RFC-8259 template parser with raw span tracking.
// ---------------------------------------------------------------------------

interface JsonStringNode {
  kind: 'string'
  value: string
  /** Raw span INCLUDING the surrounding quotes. */
  start: number
  end: number
}

interface JsonPrimitiveNode {
  kind: 'number' | 'boolean' | 'null'
  start: number
  end: number
}

interface JsonObjectEntry {
  /** Decoded key. */
  key: string
  value: JsonNode
}

interface JsonObjectNode {
  kind: 'object'
  entries: JsonObjectEntry[]
  /** Decoded keys appearing more than once in THIS object (each listed once). */
  duplicateKeys: string[]
  start: number
  end: number
}

interface JsonArrayNode {
  kind: 'array'
  elements: JsonNode[]
  start: number
  end: number
}

type JsonNode = JsonStringNode | JsonPrimitiveNode | JsonObjectNode | JsonArrayNode

interface JsonTemplate {
  root: JsonNode
  /** All duplicate decoded keys found anywhere in the document. */
  duplicateKeys: string[]
}

function isDigit(ch: string | undefined): boolean {
  return ch !== undefined && ch >= '0' && ch <= '9'
}

function isHexDigit(ch: string | undefined): boolean {
  return (
    ch !== undefined &&
    ((ch >= '0' && ch <= '9') || (ch >= 'a' && ch <= 'f') || (ch >= 'A' && ch <= 'F'))
  )
}

/** Parses `text` (BOM already stripped) as strict JSON, recording raw spans. */
function parseJsonTemplate(text: string, fail: (detail: string) => never): JsonTemplate {
  const n = text.length
  let pos = 0
  const duplicateKeys: string[] = []

  const failAt = (detail: string): never => fail(`${detail} (at character ${pos})`)

  function skipWs(): void {
    while (pos < n && (text[pos] === ' ' || text[pos] === '\t' || text[pos] === '\n' || text[pos] === '\r')) {
      pos += 1
    }
  }

  function parseString(): JsonStringNode {
    const start = pos
    pos += 1 // opening quote
    let value = ''
    for (;;) {
      if (pos >= n) failAt('unclosed string')
      const ch = text[pos]!
      if (ch === '"') {
        pos += 1
        return { kind: 'string', value, start, end: pos }
      }
      if (ch === '\\') {
        const esc = text[pos + 1]
        switch (esc) {
          case '"':
          case '\\':
          case '/':
            value += esc
            pos += 2
            break
          case 'b':
            value += '\b'
            pos += 2
            break
          case 'f':
            value += '\f'
            pos += 2
            break
          case 'n':
            value += '\n'
            pos += 2
            break
          case 'r':
            value += '\r'
            pos += 2
            break
          case 't':
            value += '\t'
            pos += 2
            break
          case 'u': {
            const hex = text.slice(pos + 2, pos + 6)
            if (hex.length !== 4 || ![...hex].every(isHexDigit)) failAt('invalid \\u escape in string')
            let code = parseInt(hex, 16)
            pos += 6
            // Combine a high surrogate with a following \uDC00-\uDFFF escape;
            // lone surrogates pass through (JSON.parse semantics).
            if (code >= 0xd800 && code <= 0xdbff && text[pos] === '\\' && text[pos + 1] === 'u') {
              const hex2 = text.slice(pos + 2, pos + 6)
              if (hex2.length === 4 && [...hex2].every(isHexDigit)) {
                const code2 = parseInt(hex2, 16)
                if (code2 >= 0xdc00 && code2 <= 0xdfff) {
                  code = 0x10000 + ((code - 0xd800) << 10) + (code2 - 0xdc00)
                  pos += 6
                }
              }
            }
            value += String.fromCodePoint(code)
            break
          }
          default:
            failAt(`invalid escape ${JSON.stringify(`\\${esc ?? ''}`)} in string`)
        }
        continue
      }
      if (ch < ' ') failAt('unescaped control character in string')
      value += ch
      pos += 1
    }
  }

  function parseNumber(): JsonPrimitiveNode {
    const start = pos
    if (text[pos] === '-') pos += 1
    if (text[pos] === '0') {
      pos += 1
    } else if (text[pos] !== undefined && text[pos]! >= '1' && text[pos]! <= '9') {
      while (isDigit(text[pos])) pos += 1
    } else {
      failAt('invalid number')
    }
    if (text[pos] === '.') {
      pos += 1
      if (!isDigit(text[pos])) failAt('invalid number: digit required after decimal point')
      while (isDigit(text[pos])) pos += 1
    }
    if (text[pos] === 'e' || text[pos] === 'E') {
      pos += 1
      if (text[pos] === '+' || text[pos] === '-') pos += 1
      if (!isDigit(text[pos])) failAt('invalid number: digit required in exponent')
      while (isDigit(text[pos])) pos += 1
    }
    return { kind: 'number', start, end: pos }
  }

  function parseLiteral(literal: 'true' | 'false' | 'null', kind: JsonPrimitiveNode['kind']): JsonPrimitiveNode {
    const start = pos
    if (text.slice(pos, pos + literal.length) !== literal) failAt(`invalid literal, expected ${literal}`)
    pos += literal.length
    return { kind, start, end: pos }
  }

  function parseObject(): JsonObjectNode {
    const start = pos
    pos += 1 // '{'
    const entries: JsonObjectEntry[] = []
    const seen = new Set<string>()
    const duplicates: string[] = []
    skipWs()
    if (text[pos] === '}') {
      pos += 1
      return { kind: 'object', entries, duplicateKeys: duplicates, start, end: pos }
    }
    for (;;) {
      skipWs()
      if (text[pos] !== '"') failAt('object key must be a string')
      const keyNode = parseString()
      if (seen.has(keyNode.value)) {
        if (!duplicates.includes(keyNode.value)) {
          duplicates.push(keyNode.value)
          duplicateKeys.push(keyNode.value)
        }
      }
      seen.add(keyNode.value)
      skipWs()
      if (text[pos] !== ':') failAt('expected ":" after object key')
      pos += 1
      const value = parseValue()
      entries.push({ key: keyNode.value, value })
      skipWs()
      if (text[pos] === ',') {
        pos += 1
        continue
      }
      if (text[pos] === '}') {
        pos += 1
        return { kind: 'object', entries, duplicateKeys: duplicates, start, end: pos }
      }
      failAt('expected "," or "}" in object')
    }
  }

  function parseArray(): JsonArrayNode {
    const start = pos
    pos += 1 // '['
    const elements: JsonNode[] = []
    skipWs()
    if (text[pos] === ']') {
      pos += 1
      return { kind: 'array', elements, start, end: pos }
    }
    for (;;) {
      elements.push(parseValue())
      skipWs()
      if (text[pos] === ',') {
        pos += 1
        continue
      }
      if (text[pos] === ']') {
        pos += 1
        return { kind: 'array', elements, start, end: pos }
      }
      failAt('expected "," or "]" in array')
    }
  }

  function parseValue(): JsonNode {
    skipWs()
    const ch = text[pos]
    if (ch === '"') return parseString()
    if (ch === '{') return parseObject()
    if (ch === '[') return parseArray()
    if (ch === 't') return parseLiteral('true', 'boolean')
    if (ch === 'f') return parseLiteral('false', 'boolean')
    if (ch === 'n') return parseLiteral('null', 'null')
    if (ch === '-' || isDigit(ch)) return parseNumber()
    return failAt(`unexpected character ${JSON.stringify(ch ?? '<end of input>')}`)
  }

  const root = parseValue()
  skipWs()
  if (pos < n) failAt('unexpected trailing content after the JSON document')
  return { root, duplicateKeys }
}

// ---------------------------------------------------------------------------
// Template rows shared by import and export (same pattern as the CSV leg).
// ---------------------------------------------------------------------------

interface JsonTemplateRow {
  ordinal: number
  key: string
  source: string
  target: string
  locked: boolean
  /**
   * Raw span replaced when the target changed: the leaf string span (flat
   * shape) or the target field's value span (array shape).
   */
  replaceStart: number
  replaceEnd: number
  /** Array shape only: target field missing -> insert the field at this offset. */
  insertAt: number | undefined
}

interface ResolvedMapping {
  id: string
  source: string
  target: string
  locked: string
}

/** Escapes one dotted-path segment so literal dots/backslashes can't collide with separators. */
function escapeKeySegment(segment: string): string {
  return segment.replace(/\\/g, '\\\\').replace(/\./g, '\\.')
}

function dottedKey(path: readonly string[]): string {
  return path.map(escapeKeySegment).join('.')
}

/** Last-wins lookup of an entry value by decoded key (matches duplicate handling). */
function findEntry(object: JsonObjectNode, key: string): JsonObjectEntry | undefined {
  for (let i = object.entries.length - 1; i >= 0; i--) {
    if (object.entries[i]!.key === key) return object.entries[i]
  }
  return undefined
}

export class JsonAdapter implements CatFormatAdapter {
  readonly id: string = JSON_ADAPTER_ID
  readonly extensions = ['.json']

  private readonly mapping: ResolvedMapping
  private readonly hash: HashFn

  constructor(options: JsonAdapterOptions = {}) {
    const mapping = options.arrayMapping ?? {}
    this.mapping = {
      id: mapping.id ?? 'id',
      source: mapping.source ?? 'source',
      target: mapping.target ?? 'target',
      locked: mapping.locked ?? 'locked',
    }
    this.hash = options.hash ?? sha256Hex
  }

  async detect(input: Uint8Array, filename: string): Promise<number> {
    if (looksBinary(input)) return 0
    let text: string
    try {
      text = new TextDecoder('utf-8', { fatal: true }).decode(input)
    } catch {
      return 0
    }
    if (text.startsWith(BOM)) text = text.slice(1)
    let template: JsonTemplate
    try {
      template = parseJsonTemplate(text, (detail) => {
        throw new Error(detail)
      })
    } catch {
      return 0
    }
    if (!this.looksLikeI18n(template.root)) return 0
    const lower = filename.toLowerCase()
    if (this.extensions.some((ext) => lower.endsWith(ext))) return 0.8
    return 0.4
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

    if (parsed.duplicateKeys.length > 0) {
      throw new FormatExportError(
        this.id,
        `template contains duplicate object key(s) (${parsed.duplicateKeys.map((k) => JSON.stringify(k)).join(', ')}); splicing by key would be ambiguous, refusing to export`,
      )
    }

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

    // Splice edits over the BOM-stripped text; untouched leaves keep exact bytes.
    const spaced = stripped.includes('": "')
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
      const encoded = JSON.stringify(segment.target)
      if (row.insertAt !== undefined) {
        // Entry has no target field: insert `"<targetField>": <value>` after the source field.
        const insertion = spaced
          ? `, ${JSON.stringify(this.mapping.target)}: ${encoded}`
          : `,${JSON.stringify(this.mapping.target)}:${encoded}`
        edits.push({ start: row.insertAt, end: row.insertAt, replacement: insertion })
      } else {
        edits.push({ start: row.replaceStart, end: row.replaceEnd, replacement: encoded })
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

  /** Content check shared by detect and import: does this look like i18n JSON? */
  private looksLikeI18n(root: JsonNode): boolean {
    if (root.kind === 'object') return countObjectLeaves(root) > 0
    if (root.kind === 'array') {
      return root.elements.some(
        (element) =>
          element.kind === 'object' && findEntry(element, this.mapping.source)?.value.kind === 'string',
      )
    }
    return false
  }

  /**
   * Parses the template into rows in document order. Shared by import and
   * export so both sides see identical keys/sources/targets.
   */
  private parseTemplate(
    text: string,
    filename: string,
  ): { rows: JsonTemplateRow[]; warnings: ImportWarning[]; duplicateKeys: string[] } {
    const stripped = text.startsWith(BOM) ? text.slice(1) : text
    const fail = (detail: string): never => {
      throw new FormatParseError(this.id, filename, detail)
    }
    const template = parseJsonTemplate(stripped, fail)
    const warnings: ImportWarning[] = []
    const rows: JsonTemplateRow[] = []

    if (template.root.kind === 'object') {
      // Flat / nested i18n shape: every string leaf, keyed by dotted path.
      const leaves: Array<{ path: string[]; node: JsonStringNode }> = []
      const walk = (node: JsonNode, path: string[]): void => {
        if (node.kind === 'object') {
          for (const entry of node.entries) walk(entry.value, [...path, entry.key])
        } else if (node.kind === 'string') {
          leaves.push({ path, node })
        }
        // numbers/booleans/null/arrays: template content, never segments
      }
      walk(template.root, [])
      if (leaves.length === 0) {
        fail('top-level object has no string leaves; not i18n key-value content')
      }
      const indexByKey = new Map<string, number>()
      for (const leaf of leaves) {
        const key = dottedKey(leaf.path)
        // Duplicate decoded key in one object: keep the LAST occurrence
        // (JSON.parse semantics) with a warning; export refuses such files.
        if (indexByKey.has(key)) {
          warnings.push({
            code: 'json.duplicate_key',
            message: `duplicate object key resolves to segment key ${JSON.stringify(key)}; keeping the last occurrence`,
            segmentKey: key,
          })
          const row = rows[indexByKey.get(key)!]!
          row.source = leaf.node.value
          row.replaceStart = leaf.node.start
          row.replaceEnd = leaf.node.end
          continue
        }
        indexByKey.set(key, rows.length)
        rows.push({
          ordinal: rows.length,
          key,
          source: leaf.node.value,
          target: '',
          locked: false,
          replaceStart: leaf.node.start,
          replaceEnd: leaf.node.end,
          insertAt: undefined,
        })
      }
    } else if (template.root.kind === 'array') {
      // Array-of-entries shape with the configured field mapping.
      const seenKeys = new Set<string>()
      for (const element of template.root.elements) {
        if (element.kind !== 'object') {
          warnings.push({
            code: 'json.entry_skipped',
            message: 'top-level array entry is not an object; skipped',
          })
          continue
        }
        const sourceEntry = findEntry(element, this.mapping.source)
        if (!sourceEntry || sourceEntry.value.kind !== 'string') {
          warnings.push({
            code: 'json.entry_skipped',
            message: `entry has no string ${JSON.stringify(this.mapping.source)} field; skipped`,
          })
          continue
        }
        const sourceNode = sourceEntry.value
        const idEntry = findEntry(element, this.mapping.id)
        const rawId = idEntry?.value.kind === 'string' ? idEntry.value.value : ''
        const ordinal = rows.length
        let key = rawId
        if (key === '' || seenKeys.has(key)) {
          const reason = key === '' ? 'missing or empty' : 'duplicate'
          key = `#idx-${ordinal}`
          warnings.push({
            code: 'json.synthesized_key',
            message: `entry has a ${reason} ${JSON.stringify(this.mapping.id)} field; synthesized key ${JSON.stringify(key)}`,
            segmentKey: key,
          })
        }
        seenKeys.add(key)
        const targetEntry = findEntry(element, this.mapping.target)
        const lockedEntry = findEntry(element, this.mapping.locked)
        const locked =
          lockedEntry?.value.kind === 'boolean' &&
          stripped.slice(lockedEntry.value.start, lockedEntry.value.end) === 'true'
        if (targetEntry) {
          rows.push({
            ordinal,
            key,
            source: sourceNode.value,
            target: targetEntry.value.kind === 'string' ? targetEntry.value.value : '',
            locked,
            replaceStart: targetEntry.value.start,
            replaceEnd: targetEntry.value.end,
            insertAt: undefined,
          })
        } else {
          rows.push({
            ordinal,
            key,
            source: sourceNode.value,
            target: '',
            locked,
            replaceStart: sourceNode.end,
            replaceEnd: sourceNode.end,
            insertAt: sourceNode.end,
          })
        }
      }
      if (rows.length === 0) {
        fail(
          `top-level array has no entries with a string ${JSON.stringify(this.mapping.source)} field; not the configured entry shape`,
        )
      }
    } else {
      fail('top-level value must be an object (flat/nested i18n) or an array of entries')
    }

    return { rows, warnings, duplicateKeys: template.duplicateKeys }
  }
}

function countObjectLeaves(node: JsonObjectNode): number {
  let count = 0
  const walk = (value: JsonNode): void => {
    if (value.kind === 'object') {
      for (const entry of value.entries) walk(entry.value)
    } else if (value.kind === 'string') {
      count += 1
    }
  }
  for (const entry of node.entries) walk(entry.value)
  return count
}

function looksBinary(bytes: Uint8Array): boolean {
  const probe = Math.min(bytes.length, 512)
  for (let i = 0; i < probe; i++) if (bytes[i] === 0) return true
  return false
}
