/**
 * XlsxAdapter — OOXML SpreadsheetML (.xlsx) bilingual format adapter (PB-081).
 *
 * Scope (deliberately single-sheet v1 — documented deviation):
 * - ONLY the FIRST worksheet (workbook.xml <sheet> document order) is
 *   imported; every additional sheet is ignored and reported once via an
 *   import warning (code 'xlsx.multi_sheet'). Game-localization handoffs
 *   ship multi-sheet workbooks, but v1 mirrors the CSV single-table model;
 * - the conventional fixed part names xl/workbook.xml and
 *   xl/_rels/workbook.xml.rels are required (everything Excel / LibreOffice
 *   / Numbers writes; exotic package layouts are rejected, not guessed);
 * - the first <row> in <sheetData> is the HEADER row. Column mapping reuses
 *   the CSV adapter's alias tables + normalizeDelimitedHeader (ONE shared
 *   table set imported from ./csv — no second copy):
 *   - key:     key, id, segmentid, uniquekey, 唯一键
 *   - source:  source, src, sourcetext, 源文, 原文        (REQUIRED)
 *   - target:  target, tgt, translation, targettext, 译文, 翻译
 *   - locked:  locked, lock, 锁定
 *   - context: context, note, notes, comment, 备注        (-> context.note)
 *   Explicit per-column overrides via `new XlsxAdapter({ columns: {...} })`
 *   behave exactly like the CSV adapter (unknown explicit name -> parse
 *   error); a missing source column is a FORMAT_PARSE_ERROR;
 * - keys: trimmed key-column value; a missing key column or an empty key
 *   cell yields a synthesized stable `#row-<ordinal>` key plus an import
 *   warning (code 'xlsx.synthesized_key'); duplicate keys are a
 *   FORMAT_PARSE_ERROR;
 * - status mapping (deliberately minimal, same as CSV): empty target ->
 *   'untranslated', non-empty target -> 'translated';
 * - locked column: true/yes/1 (case-insensitive) -> locked. Export never
 *   writes the locked column back; it only refuses to change a locked row's
 *   target.
 *
 * Cell reading (documented deviations — cells are read as TEXT; formatting
 * is never evaluated):
 * - t="s" shared strings (rich-text runs concatenated, <rPh> phonetic runs
 *   excluded), t="inlineStr" (<is><t>), t="str" formula string results, and
 *   numeric/plain <v> are all read as their stored text;
 * - NUMBERS stay their stored text and DATES stay serial numbers — no
 *   number/date format evaluation (deviation, documented);
 * - t="b" booleans read as 'TRUE'/'FALSE'; t="e" error cells read as ''
 *   plus an import warning (code 'xlsx.error_cell'); formula cells use the
 *   CACHED <v> value only — a formula without a cached value reads as ''
 *   plus an import warning (code 'xlsx.formula_no_cached_value'); formulas
 *   are never evaluated;
 * - rows whose cells are ALL empty are skipped like CSV blank lines (they
 *   exist in real files as formatting artifacts and carry no data);
 * - OOXML `_xHHHH_` control-character escapes (the ST_Xstring convention
 *   Excel itself uses) are unescaped on read and produced on write;
 *   standard entities and numeric character references are decoded.
 *
 * Export contract (template-based, plan §6.3):
 * - originalBytes is the template; rows are located by key with the same
 *   parsing/mapping pipeline as import;
 * - when NO target changed, export returns originalBytes VERBATIM — the
 *   byte-stability hard rule (zip recompression would otherwise
 *   legitimately change container bytes);
 * - a changed target rewrites ONLY its own cell element in the worksheet
 *   XML: the cell becomes t="inlineStr" with <is><t>escaped</t></is> (the r
 *   attribute is kept, and the s style attribute is kept when present).
 *   sharedStrings.xml is NEVER touched — old shared entries simply become
 *   unreferenced, which is valid OOXML that Excel reads fine;
 * - a row MISSING the target cell gets a new <c> inserted in column order
 *   (before the first higher-column cell, else at row end; a self-closing
 *   <row/> is expanded) with the correct r="<col><row>" reference;
 * - every other zip entry keeps byte-identical CONTENT; the zip CONTAINER
 *   bytes of a modified export may differ (jszip recompresses) — documented
 *   deviation, entry payloads are what stays stable;
 * - XML escaping on write: & < > " as entities, \r as &#xD; (a literal CR
 *   would be normalized to LF by any conforming parser), C0 control
 *   characters as OOXML `_xHHHH_`, and literal `_xHHHH_`-looking text is
 *   protected via `_x005F_` so the escapes invert; targets with
 *   leading/trailing whitespace get xml:space="preserve";
 * - unknown key, segment missing from input, source mismatch, a changed
 *   target on a locked row, or a changed target with no target column ->
 *   FormatExportError; nothing is ever skipped silently.
 *
 * Known limitations:
 * - single sheet only (see above); a chartsheet/dialog sheet as the first
 *   sheet fails with a typed parse error;
 * - worksheet markup is read with a namespace-prefix-tolerant scanner that
 *   expects machine-generated sheetML (no comments/PIs inside cells, no
 *   nested same-name elements); hand-crafted pathological XML may be
 *   rejected — it is NOT a general XML parser (same trade-off as the XLIFF
 *   adapter's regex layer);
 * - rewritten cells keep r/s attributes but drop any other exotic cell
 *   attributes (cm/vm/ph — virtually never present on bilingual data
 *   cells); untouched cells stay byte-for-byte intact;
 * - adversarial literal text containing nested `_x005F_xHHHH_` sequences
 *   may not invert perfectly (same ambiguity as Excel's own convention).
 */

import { fnv1a64 } from '@linguist/cat-core'
import JSZip from 'jszip'
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
import { descendants, localName, parseXml } from '../xml-parser'
import {
  CONTEXT_ALIASES,
  KEY_ALIASES,
  LOCKED_ALIASES,
  LOCKED_TRUTHY,
  normalizeDelimitedHeader,
  SOURCE_ALIASES,
  TARGET_ALIASES,
  type CsvColumnMapping,
} from './csv'
import { encodeXmlAttr, findFirst, parseAttrs } from './xliff-xml'

export const XLSX_ADAPTER_ID = 'xlsx_ooxml'
export const XLSX_FORMAT_CONFIG_VERSION = 1

const BOM = '\uFEFF'
export const WORKBOOK_PATH = 'xl/workbook.xml'
export const WORKBOOK_RELS_PATH = 'xl/_rels/workbook.xml.rels'
export const SHARED_STRINGS_PATH = 'xl/sharedStrings.xml'

export const FORMULA_PATTERN = /<(?:[\w.-]+:)?f[\s/>]/i
export const RPH_BLOCK_PATTERN = /<((?:[\w.-]+:)?rPh)\b[^>]*>[\s\S]*?<\/\1>/gi
const INLINE_T_PATTERN = /<(?:[\w.-]+:)?t\b[^>]*>([\s\S]*?)<\/(?:[\w.-]+:)?t>/gi
export const CELL_REF_PATTERN = /^([A-Za-z]+)([0-9]+)$/
export const ROW_NUMBER_PATTERN = /[0-9]+$/

const NAMED_ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }
const XML_TEXT_ESCAPES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }

export interface XlsxAdapterOptions {
  /** Explicit per-column header names (same shape/semantics as the CSV adapter). */
  columns?: CsvColumnMapping
  /** Exact workbook sheet name. Omitted preserves the legacy first-sheet rule. */
  sheetName?: string
  /** Injectable hasher; default is the built-in pure-TS SHA-256. */
  hash?: HashFn
}

/** 用户确认过的非标准工作簿映射；作为 adapter 版本化配置持久化。 */
export interface XlsxFormatConfig {
  version: typeof XLSX_FORMAT_CONFIG_VERSION
  sheetName: string
  columns: {
    key?: string
    source: string
    target: string
    locked?: string
    context?: string
  }
}

type XlsxConfigPhase = 'import' | 'export'

function xlsxConfigError(phase: XlsxConfigPhase, filename: string, detail: string): never {
  if (phase === 'export') throw new FormatExportError(XLSX_ADAPTER_ID, `invalid persisted mapping for ${filename}: ${detail}`)
  throw new FormatParseError(XLSX_ADAPTER_ID, filename, `invalid persisted mapping: ${detail}`)
}

function nonBlankString(value: unknown, label: string, phase: XlsxConfigPhase, filename: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    xlsxConfigError(phase, filename, `${label} must be a non-blank string`)
  }
  return value
}

function exactKeys(
  record: Record<string, unknown>,
  allowed: readonly string[],
  label: string,
  phase: XlsxConfigPhase,
  filename: string,
): void {
  for (const key of Object.keys(record)) {
    if (!allowed.includes(key)) xlsxConfigError(phase, filename, `${label} contains unknown field ${JSON.stringify(key)}`)
  }
}

function assertDistinctColumns(
  columns: XlsxFormatConfig['columns'],
  phase: XlsxConfigPhase,
  filename: string,
): void {
  const seen = new Set<string>()
  for (const [role, header] of Object.entries(columns)) {
    if (header === undefined) continue
    const normalized = normalizeDelimitedHeader(header)
    if (seen.has(normalized)) xlsxConfigError(phase, filename, `${role} reuses another mapped column`)
    seen.add(normalized)
  }
}

/** 严格解析 adapter 自有的 v1 JSON；未知版本或字段一律 fail closed。 */
export function parseXlsxFormatConfig(
  formatConfigJson: string,
  filename: string,
  phase: XlsxConfigPhase = 'import',
): XlsxFormatConfig {
  let value: unknown
  try {
    value = JSON.parse(formatConfigJson)
  } catch {
    return xlsxConfigError(phase, filename, 'not valid JSON')
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return xlsxConfigError(phase, filename, 'must be an object')
  }
  const record = value as Record<string, unknown>
  exactKeys(record, ['version', 'sheetName', 'columns'], 'mapping', phase, filename)
  if (record.version !== XLSX_FORMAT_CONFIG_VERSION) {
    return xlsxConfigError(phase, filename, `unsupported version ${JSON.stringify(record.version)}`)
  }
  const sheetName = nonBlankString(record.sheetName, 'sheetName', phase, filename)
  if (typeof record.columns !== 'object' || record.columns === null || Array.isArray(record.columns)) {
    return xlsxConfigError(phase, filename, 'columns must be an object')
  }
  const rawColumns = record.columns as Record<string, unknown>
  exactKeys(rawColumns, ['key', 'source', 'target', 'locked', 'context'], 'columns', phase, filename)
  const columns: XlsxFormatConfig['columns'] = {
    source: nonBlankString(rawColumns.source, 'columns.source', phase, filename),
    target: nonBlankString(rawColumns.target, 'columns.target', phase, filename),
  }
  for (const key of ['key', 'locked', 'context'] as const) {
    if (rawColumns[key] !== undefined) columns[key] = nonBlankString(rawColumns[key], `columns.${key}`, phase, filename)
  }
  assertDistinctColumns(columns, phase, filename)
  return { version: XLSX_FORMAT_CONFIG_VERSION, sheetName, columns }
}

export function serializeXlsxFormatConfig(config: XlsxFormatConfig): string {
  return JSON.stringify({
    version: XLSX_FORMAT_CONFIG_VERSION,
    sheetName: config.sheetName,
    columns: {
      ...(config.columns.key === undefined ? {} : { key: config.columns.key }),
      source: config.columns.source,
      target: config.columns.target,
      ...(config.columns.locked === undefined ? {} : { locked: config.columns.locked }),
      ...(config.columns.context === undefined ? {} : { context: config.columns.context }),
    },
  })
}

interface ResolvedColumns {
  key: number
  source: number
  target: number
  locked: number
  context: number
}

/** Raw span of one XML element in the worksheet text (incl. its markup). */
export interface ElementSpan {
  /** Tag name as written, including any namespace prefix ('c' or 'x:c'). */
  tagName: string
  /** Raw text between the tag name and '>' (may end with '/' when self-closing). */
  attrsRaw: string
  start: number
  /** One past the close tag's '>' (or the self-close '>'). */
  end: number
  /** One past the open tag's '>'. */
  innerStart: number
  /** Start of the close tag (== innerStart when self-closing). */
  innerEnd: number
  selfClosing: boolean
}

interface SheetCell {
  span: ElementSpan
  /** r attribute as written ('C7'); undefined when absent (positional fallback used). */
  ref: string | undefined
  colIndex: number
  /** t attribute lowercased ('' when absent => number/plain). */
  type: string
  /** s (style) attribute; preserved on rewrite. */
  style: string | undefined
}

interface SheetRow {
  span: ElementSpan
  /** Row digits for building cell refs (r attr, else first cell ref, else positional). */
  rowNumber: string
  cells: SheetCell[]
  byColumn: Map<number, SheetCell>
}

interface ParsedSheetRow {
  ordinal: number
  key: string
  source: string
  target: string
  locked: boolean
  note: string | undefined
  sheetRow: SheetRow
  targetCell: SheetCell | undefined
}

interface ParsedSheet {
  columns: ResolvedColumns
  rows: ParsedSheetRow[]
  warnings: ImportWarning[]
}

interface ParsedWorkbook {
  zip: JSZip
  sheetPath: string
  /** Worksheet XML as UTF-8 text, BOM stripped (re-attached on export). */
  sheetText: string
  sheetHadBom: boolean
  sharedStrings: string[]
  warnings: ImportWarning[]
}

type CellReadKind = 'ok' | 'error' | 'formula-no-cache'

function hasZipMagic(bytes: Uint8Array): boolean {
  if (bytes.length < 4 || bytes[0] !== 0x50 || bytes[1] !== 0x4b) return false
  // local file header (PK\x03\x04) or empty-archive end record (PK\x05\x06)
  return (bytes[2] === 0x03 && bytes[3] === 0x04) || (bytes[2] === 0x05 && bytes[3] === 0x06)
}

export { hasZipMagic }

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * Finds top-level <tag> elements between `from` and `to`, namespace-prefix
 * tolerant (`<x:c>` matches tag 'c', boundary-checked so `<cols>` never
 * matches 'c'). NOT a general XML parser — it covers the machine-generated
 * sheetML shape (quoted attrs, self-closing tags, no same-name nesting) and
 * fails loudly on anything else.
 */
export function scanElements(text: string, tag: string, from: number, to: number, fail: (detail: string) => never): ElementSpan[] {
  const spans: ElementSpan[] = []
  const openPattern = new RegExp(`<((?:[A-Za-z_][\\w.-]*:)?${tag})(?=[\\s/>])`, 'g')
  openPattern.lastIndex = from
  for (;;) {
    const open = openPattern.exec(text)
    if (open === null || open.index >= to) break
    const tagName = open[1]!
    let cursor = open.index + open[0].length
    let quote = ''
    while (cursor < to) {
      const ch = text[cursor]!
      if (quote !== '') {
        if (ch === quote) quote = ''
      } else if (ch === '"' || ch === "'") {
        quote = ch
      } else if (ch === '>') {
        break
      }
      cursor++
    }
    if (cursor >= to) fail(`<${tagName}> at offset ${open.index} is not closed`)
    const attrsRaw = text.slice(open.index + open[0].length, cursor)
    if (/\/\s*$/.test(attrsRaw)) {
      spans.push({ tagName, attrsRaw, start: open.index, end: cursor + 1, innerStart: cursor + 1, innerEnd: cursor + 1, selfClosing: true })
      openPattern.lastIndex = cursor + 1
    } else {
      const closePattern = new RegExp(`</${escapeRegExp(tagName)}\\s*>`, 'g')
      closePattern.lastIndex = cursor + 1
      const close = closePattern.exec(text)
      if (close === null || close.index >= to) fail(`<${tagName}> at offset ${open.index} has no closing </${tagName}>`)
      spans.push({ tagName, attrsRaw, start: open.index, end: close.index + close[0].length, innerStart: cursor + 1, innerEnd: close.index, selfClosing: false })
      openPattern.lastIndex = close.index + close[0].length
    }
  }
  return spans
}

/** Column letters -> 0-based index ('A' -> 0, 'Z' -> 25, 'AA' -> 26). */
export function columnIndexFromLetters(letters: string): number {
  let index = 0
  for (const ch of letters.toUpperCase()) index = index * 26 + (ch.charCodeAt(0) - 64)
  return index - 1
}

/** 0-based index -> column letters (0 -> 'A', 26 -> 'AA'). */
export function columnLettersFromIndex(index: number): string {
  let remaining = index + 1
  let letters = ''
  while (remaining > 0) {
    letters = String.fromCharCode(65 + ((remaining - 1) % 26)) + letters
    remaining = Math.floor((remaining - 1) / 26)
  }
  return letters
}

/** Prefix-tolerant attribute lookup on a raw attrs record ('r' also matches 'x:r'). */
export function attrValue(attrs: Record<string, string>, name: string): string | undefined {
  const direct = attrs[name]
  if (direct !== undefined) return direct
  const suffix = `:${name}`
  for (const key of Object.keys(attrs)) {
    if (key.endsWith(suffix)) return attrs[key]
  }
  return undefined
}

/** Prefix-tolerant attribute lookup on an xmldom Element (for r:id on <sheet>). */
export function elementAttrByLocalName(element: Element, name: string): string | undefined {
  for (let i = 0; i < element.attributes.length; i++) {
    const attr = element.attributes.item(i)!
    if ((attr.name.split(':').at(-1) ?? attr.name) === name) return attr.value
  }
  return undefined
}

/**
 * OOXML 文本读取计数器（失真遥测）。可选地传入 unescapeOoxmlControls /
 * decodeXmlText / inlineStringText / readSharedStrings，调用方借此统计
 * `_xHHHH_` 还原与 <rPh> 排除事件；不传时行为与原实现完全一致。
 */
export interface OoxmlTextCounter {
  /** 还原的 `_xHHHH_` 控制字符转义序列数。 */
  escapesRestored: number
  /** 被排除的 <rPh> 拼音注音 run 数。 */
  rPhRunsExcluded: number
}

/**
 * Unescapes OOXML `_xHHHH_` control-character escapes (only C0 controls
 * other than tab/LF/CR — the exact set the write side produces) and then
 * restores `_x005F_`-protected literal `_xHHHH_` text. The order matters:
 * control unescape first, protection restore second, so written output
 * inverts exactly.
 */
export function unescapeOoxmlControls(value: string, counter?: OoxmlTextCounter): string {
  const unescaped = value.replace(/_x([0-9A-Fa-f]{4})_/g, (match, hex: string) => {
    const code = Number.parseInt(hex, 16)
    if (code < 0x20 && code !== 0x09 && code !== 0x0a && code !== 0x0d) {
      if (counter !== undefined) counter.escapesRestored += 1
      return String.fromCharCode(code)
    }
    return match
  })
  return unescaped.replace(/_x005F_x([0-9A-Fa-f]{4})_/gi, '_x$1_')
}

/**
 * Decodes text content per XML 1.0 rules: literal line endings are normalized
 * FIRST (#xD#xA and lone #xD in parsed entity text become #xA — what every
 * conforming parser, Excel included, does), then the five named entities plus
 * numeric character references (&#65; / &#x41; — xliff-xml's decodeXmlEntities
 * intentionally lacks numeric refs, and the write side here emits &#xD;, which
 * is expanded AFTER normalization so an intended CR survives), then the OOXML
 * `_xHHHH_` control escapes. Unknown/invalid entities are left verbatim
 * (lenient read).
 */
export function decodeXmlText(raw: string, counter?: OoxmlTextCounter): string {
  const normalized = raw.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
  const decoded = normalized.replace(/&(#x[0-9A-Fa-f]+|#[0-9]+|amp|lt|gt|quot|apos);/g, (match, body: string) => {
    let code: number | undefined
    if (body.startsWith('#x')) code = Number.parseInt(body.slice(2), 16)
    else if (body.startsWith('#')) code = Number.parseInt(body.slice(1), 10)
    if (code !== undefined) {
      return Number.isInteger(code) && code >= 0 && code <= 0x10ffff ? String.fromCodePoint(code) : match
    }
    return NAMED_ENTITIES[body] ?? match
  })
  return unescapeOoxmlControls(decoded, counter)
}

/**
 * Escapes a target text run for <is><t>: literal `_xHHHH_`-looking text is
 * protected first (`_x005F_`, the ST_Xstring convention), then & < > " as
 * entities, \r as &#xD; (literal CR would be parser-normalized to LF), and
 * XML-1.0-forbidden C0 controls as `_xHHHH_`.
 */
function escapeCellText(value: string): string {
  return value
    .replace(/_x([0-9A-Fa-f]{4})_/g, '_x005F_x$1_')
    .replace(/[&<>"]/g, (ch) => XML_TEXT_ESCAPES[ch]!)
    .replace(/\r/g, '&#xD;')
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, (ch) => `_x${ch.charCodeAt(0).toString(16).toUpperCase().padStart(4, '0')}_`)
}

/** Concatenated <t> runs inside an <is> block, <rPh> phonetic runs excluded. */
export function inlineStringText(isInner: string, counter?: OoxmlTextCounter): string {
  const stripped = isInner.replace(RPH_BLOCK_PATTERN, () => {
    if (counter !== undefined) counter.rPhRunsExcluded += 1
    return ''
  })
  let raw = ''
  for (const match of stripped.matchAll(INLINE_T_PATTERN)) raw += match[1]
  return decodeXmlText(raw, counter)
}

export interface RootTag {
  /** local name, lowercased, namespace prefix stripped ('worksheet'). */
  local: string
  /** Tag name as written, including any prefix ('x:worksheet'). */
  raw: string
}

/**
 * 不构建 DOM 的根元素识别：跳过 prolog（<?...?> / <!--...--> / <!DOCTYPE...>）
 * 后返回第一个开始标签；找不到开始标签返回 undefined。大 XML 部件（数百 MB
 * 工作表/共享字符串）若为看根名而构建整棵 DOM，峰值内存会放大十几倍；这里
 * 只读文档头部。输入必须先过 UTF-8 fatal 解码与 <!ENTITY 拒绝（调用方责任）。
 */
export function rootTagFromProlog(xml: string): RootTag | undefined {
  let cursor = 0
  for (;;) {
    const open = xml.indexOf('<', cursor)
    if (open < 0) return undefined
    if (xml.startsWith('<?', open)) {
      const end = xml.indexOf('?>', open + 2)
      if (end < 0) return undefined
      cursor = end + 2
      continue
    }
    if (xml.startsWith('<!--', open)) {
      const end = xml.indexOf('-->', open + 4)
      if (end < 0) return undefined
      cursor = end + 3
      continue
    }
    if (/^<!doctype\b/i.test(xml.slice(open, open + 10))) {
      const end = xml.indexOf('>', open + 2)
      if (end < 0) return undefined
      cursor = end + 1
      continue
    }
    const tagMatch = /^<([\w:.-]+)/.exec(xml.slice(open, open + 128))
    if (tagMatch === null) return undefined
    const raw = tagMatch[1]!
    return { local: (raw.split(':').at(-1) ?? raw).toLowerCase(), raw }
  }
}

/**
 * sharedStrings.xml -> string table (rich runs concatenated, phonetics excluded).
 *
 * 读取走与工作表相同的 raw-text 管线（scanElements + inlineStringText），
 * 不经过 DOM：XML 1.0 只归一化 #xD/#xD#xA，U+2028/U+2029 是合法字符且必须
 * 原样保留（真实导出文件把游戏文本的软换行写成字面 U+2028；经 xmldom 读
 * sst 会被悄悄改成 U+000A，译文行分隔语义被改写）。大 sst 也不再构建整棵
 * DOM，峰值内存大幅下降。
 *
 * When `perEntry` is given, one OoxmlTextCounter per <si> (same order as the
 * returned table) is pushed so callers can attribute <rPh> exclusions and
 * `_xHHHH_` restorations to the cells referencing each index.
 */
export function readSharedStrings(
  bytes: Uint8Array,
  adapterId: string,
  filename: string,
  perEntry?: OoxmlTextCounter[],
): string[] {
  let xml: string
  try {
    // Default ignoreBOM:false consumes a BOM when present.
    xml = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch (cause) {
    throw new FormatParseError(adapterId, filename, '文件不是有效的 UTF-8 XML', { cause })
  }
  // 与 parseXml 一致：拒绝内部实体声明，避免实体扩展攻击。
  if (/<!ENTITY\b/i.test(xml)) {
    throw new FormatParseError(adapterId, filename, '不允许 XML 实体声明')
  }
  // function declaration (not a const arrow): TS only narrows on
  // never-returning calls declared this way.
  function fail(detail: string): never {
    throw new FormatParseError(adapterId, filename, detail)
  }
  // 根元素必须是 <sst>：只做 prolog 头部扫描，不构建 DOM。
  if (rootTagFromProlog(xml)?.local !== 'sst') fail('xl/sharedStrings.xml root is not <sst>')
  const strings: string[] = []
  for (const si of scanElements(xml, 'si', 0, xml.length, fail)) {
    const counter: OoxmlTextCounter = { escapesRestored: 0, rPhRunsExcluded: 0 }
    strings.push(si.selfClosing ? '' : inlineStringText(xml.slice(si.innerStart, si.innerEnd), counter))
    perEntry?.push(counter)
  }
  return strings
}

/** Resolves a workbook relationship Target to a zip entry path (base dir 'xl'). */
export function resolveZipPath(baseDir: string, target: string): string {
  const combined = target.startsWith('/') ? target.slice(1) : `${baseDir}/${target}`
  const parts: string[] = []
  for (const segment of combined.split('/')) {
    if (segment === '' || segment === '.') continue
    if (segment === '..') parts.pop()
    else parts.push(segment)
  }
  return parts.join('/')
}

/** Reads one cell as text; `kind` flags error cells / uncached formulas for warnings. */
function readCellValue(
  sheetText: string,
  cell: SheetCell,
  sharedStrings: readonly string[],
  fail: (detail: string) => never,
): { value: string; kind: CellReadKind } {
  const inner = sheetText.slice(cell.span.innerStart, cell.span.innerEnd)
  if (cell.type === 'inlinestr') {
    const is = findFirst(inner, 'is')
    return { value: is === undefined ? '' : inlineStringText(is.inner), kind: 'ok' }
  }
  const vElement = findFirst(inner, 'v')
  const vText = vElement === undefined ? undefined : decodeXmlText(vElement.inner)
  if (cell.type === 's') {
    if (vText === undefined) {
      if (cell.span.selfClosing) return { value: '', kind: 'ok' }
      fail(`cell ${cell.ref ?? '?'}: shared-string cell without a <v> index`)
    }
    const index = Number(vText)
    if (!Number.isInteger(index) || index < 0 || index >= sharedStrings.length) {
      fail(`cell ${cell.ref ?? '?'}: shared string index ${JSON.stringify(vText)} out of range (sharedStrings has ${sharedStrings.length} entries)`)
    }
    return { value: sharedStrings[index]!, kind: 'ok' }
  }
  if (cell.type === 'b') {
    const raw = (vText ?? '').trim()
    return { value: raw === '1' ? 'TRUE' : raw === '0' ? 'FALSE' : raw, kind: 'ok' }
  }
  if (cell.type === 'e') return { value: '', kind: 'error' }
  // '' / 'n' / 'str' / 'd' / unknown types: the cached <v> text as-is.
  if (vText !== undefined) return { value: vText, kind: 'ok' }
  if (FORMULA_PATTERN.test(inner)) return { value: '', kind: 'formula-no-cache' }
  return { value: '', kind: 'ok' }
}

export class XlsxAdapter implements CatFormatAdapter {
  readonly id: string = XLSX_ADAPTER_ID
  readonly extensions = ['.xlsx']

  private readonly columns: CsvColumnMapping
  private readonly sheetName: string | undefined
  private readonly hash: HashFn

  constructor(options: XlsxAdapterOptions = {}) {
    this.columns = options.columns ?? {}
    this.sheetName = options.sheetName
    this.hash = options.hash ?? sha256Hex
  }

  async detect(input: Uint8Array, filename: string): Promise<number> {
    if (!hasZipMagic(input)) return 0
    let zip: JSZip
    try {
      zip = await JSZip.loadAsync(input)
    } catch {
      return 0
    }
    if (zip.file(WORKBOOK_PATH) === null) return 0
    return filename.toLowerCase().endsWith('.xlsx') ? 0.9 : 0.5
  }

  async import(input: CatFormatImportInput): Promise<ImportedCatAsset> {
    const { bytes, filename, sourceLocale, targetLocale } = input
    const config = this.importConfig(input)
    const workbook = await this.parseWorkbook(bytes, filename, config?.sheetName ?? this.sheetName)
    const sheet = this.parseSheet(workbook.sheetText, workbook.sharedStrings, filename, config?.columns ?? this.columns)
    const segments: ImportedCatSegment[] = sheet.rows.map((row) => ({
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
        ...(config === undefined ? {} : { formatConfigJson: serializeXlsxFormatConfig(config) }),
      },
      segments,
      warnings: [...workbook.warnings, ...sheet.warnings],
      originalBytes: bytes,
    }
  }

  async export(input: CatFormatExportInput): Promise<Uint8Array> {
    const { originalBytes, asset, segments } = input
    const filename = asset.originalFilename
    const config = this.exportConfig(asset.formatConfigJson, filename)
    const workbook = await this.parseWorkbook(originalBytes, filename, config?.sheetName ?? this.sheetName)
    const sheet = this.parseSheet(workbook.sheetText, workbook.sharedStrings, filename, config?.columns ?? this.columns)

    const byKey = new Map<string, (typeof segments)[number]>()
    for (const segment of segments) {
      const key = segment.key ?? ''
      if (byKey.has(key)) {
        throw new FormatExportError(this.id, `duplicate segment key ${JSON.stringify(key)} in export input`)
      }
      byKey.set(key, segment)
    }
    const templateKeys = new Set(sheet.rows.map((row) => row.key))
    for (const key of byKey.keys()) {
      if (!templateKeys.has(key)) {
        throw new FormatExportError(this.id, `segment key ${JSON.stringify(key)} is not present in the original template`)
      }
    }

    // Splice edits over the worksheet text; untouched cells keep exact bytes.
    const edits: Array<{ start: number; end: number; replacement: string }> = []
    for (const row of sheet.rows) {
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
      if (sheet.columns.target < 0) {
        throw new FormatExportError(
          this.id,
          `segment ${JSON.stringify(row.key)}: template has no target column; cannot write the changed target`,
        )
      }
      const spaceAttr = segment.target !== segment.target.trim() ? ' xml:space="preserve"' : ''
      const content = `<is><t${spaceAttr}>${escapeCellText(segment.target)}</t></is>`
      if (row.targetCell !== undefined) {
        // Rewrite only this cell element: r kept, s (style) kept, t forced to inlineStr.
        const ref = row.targetCell.ref ?? `${columnLettersFromIndex(sheet.columns.target)}${row.sheetRow.rowNumber}`
        const style = row.targetCell.style !== undefined ? ` s="${encodeXmlAttr(row.targetCell.style)}"` : ''
        const tag = row.targetCell.span.tagName
        edits.push({
          start: row.targetCell.span.start,
          end: row.targetCell.span.end,
          replacement: `<${tag} r="${ref}"${style} t="inlineStr">${content}</${tag}>`,
        })
      } else {
        // The row has no target cell: insert one in column order.
        const cellMarkup = `<c r="${columnLettersFromIndex(sheet.columns.target)}${row.sheetRow.rowNumber}" t="inlineStr">${content}</c>`
        if (row.sheetRow.span.selfClosing) {
          const attrsRaw = row.sheetRow.span.attrsRaw.replace(/\/\s*$/, '')
          edits.push({
            start: row.sheetRow.span.start,
            end: row.sheetRow.span.end,
            replacement: `<${row.sheetRow.span.tagName}${attrsRaw}>${cellMarkup}</${row.sheetRow.span.tagName}>`,
          })
        } else {
          const after = row.sheetRow.cells.find((cell) => cell.colIndex > sheet.columns.target)
          const at = after !== undefined ? after.span.start : row.sheetRow.span.innerEnd
          edits.push({ start: at, end: at, replacement: cellMarkup })
        }
      }
    }

    // Byte-stability hard rule: with no target changes the original package
    // is returned verbatim (zip recompression would legitimately differ).
    if (edits.length === 0) return originalBytes

    edits.sort((a, b) => b.start - a.start)
    let out = workbook.sheetText
    for (const edit of edits) out = out.slice(0, edit.start) + edit.replacement + out.slice(edit.end)
    const outBytes = new TextEncoder().encode((workbook.sheetHadBom ? BOM : '') + out)
    workbook.zip.file(workbook.sheetPath, outBytes)
    return workbook.zip.generateAsync({ type: 'uint8array' })
  }

  /**
   * Opens the zip package, resolves the selected worksheet (legacy default:
   * first workbook.xml sheet) and loads sharedStrings. Shared by import and
   * export so both sides see the identical template.
   */
  private async parseWorkbook(bytes: Uint8Array, filename: string, selectedSheetName?: string): Promise<ParsedWorkbook> {
    // function declaration (not a const arrow): TS only narrows on
    // never-returning calls declared this way.
    function fail(detail: string): never {
      throw new FormatParseError(XLSX_ADAPTER_ID, filename, detail)
    }
    if (!hasZipMagic(bytes)) fail('not a ZIP container; .xlsx is an OOXML zip package (PK\\x03\\x04)')
    let zip: JSZip
    try {
      zip = await JSZip.loadAsync(bytes)
    } catch (err) {
      throw new FormatParseError(this.id, filename, 'ZIP container could not be read', { cause: err })
    }
    const workbookEntry = zip.file(WORKBOOK_PATH)
    if (workbookEntry === null) fail(`${WORKBOOK_PATH} not found; not an OOXML spreadsheet package`)
    const workbookDoc = parseXml(await workbookEntry.async('uint8array'), this.id, filename)
    if (localName(workbookDoc.documentElement) !== 'workbook') {
      fail(`${WORKBOOK_PATH} root is not <workbook>`)
    }
    const sheets = descendants(workbookDoc, 'sheet')
    if (sheets.length === 0) fail('workbook.xml lists no <sheet> elements')
    const warnings: ImportWarning[] = []
    const selected = selectedSheetName === undefined
      ? sheets[0]!
      : sheets.find((sheet) => sheet.getAttribute('name') === selectedSheetName)
    if (selected === undefined) {
      fail(`worksheet ${JSON.stringify(selectedSheetName)} is not listed in ${WORKBOOK_PATH}`)
    }
    const sheetName = selected.getAttribute('name') ?? '(unnamed)'
    if (sheets.length > 1 && selectedSheetName === undefined) {
      warnings.push({
        code: 'xlsx.multi_sheet',
        message: `workbook has ${sheets.length} sheets; only the first (${JSON.stringify(sheetName)}) is imported, the rest are ignored (v1 single-sheet scope)`,
      })
    }
    const ridAttr = selected.getAttribute('r:id')
    const relId =
      (ridAttr !== null && ridAttr !== '' ? ridAttr : undefined) ??
      elementAttrByLocalName(selected, 'id') ??
      fail(`sheet ${JSON.stringify(sheetName)} has no relationship id (r:id)`)
    const relsEntry = zip.file(WORKBOOK_RELS_PATH)
    if (relsEntry === null) fail(`${WORKBOOK_RELS_PATH} missing; cannot resolve worksheet part`)
    const relsDoc = parseXml(await relsEntry.async('uint8array'), this.id, filename)
    const targets = new Map<string, string>()
    for (const rel of descendants(relsDoc, 'relationship')) {
      const id = rel.getAttribute('Id')
      const target = rel.getAttribute('Target')
      if (id !== null && id !== '' && target !== null && target !== '' && rel.getAttribute('TargetMode') !== 'External') {
        targets.set(id, target)
      }
    }
    const sheetTarget = targets.get(relId)
    if (sheetTarget === undefined) {
      fail(`relationship ${JSON.stringify(relId)} of sheet ${JSON.stringify(sheetName)} is not in workbook.xml.rels`)
    }
    const sheetPath = resolveZipPath('xl', sheetTarget)
    const sheetEntry = zip.file(sheetPath)
    if (sheetEntry === null) fail(`worksheet part ${JSON.stringify(sheetPath)} not found in the package`)
    const sheetBytes = await sheetEntry.async('uint8array')
    const sheetHadBom = sheetBytes.length >= 3 && sheetBytes[0] === 0xef && sheetBytes[1] === 0xbb && sheetBytes[2] === 0xbf
    let sheetText: string
    try {
      // Default ignoreBOM:false consumes the BOM; sheetHadBom re-attaches it on export.
      sheetText = new TextDecoder('utf-8', { fatal: true }).decode(sheetBytes)
    } catch (err) {
      throw new FormatParseError(this.id, filename, `worksheet part ${sheetPath} is not valid UTF-8`, { cause: err })
    }
    let sharedStrings: string[] = []
    const sharedEntry = zip.file(SHARED_STRINGS_PATH)
    if (sharedEntry !== null) {
      sharedStrings = readSharedStrings(await sharedEntry.async('uint8array'), this.id, filename)
    }
    return { zip, sheetPath, sheetText, sheetHadBom, sharedStrings, warnings }
  }

  /**
   * Parses the worksheet into header + data rows in document order. Shared
   * by import and export so both sides see identical keys/sources/targets;
   * export additionally uses the kept element spans for raw surgery.
   */
  private parseSheet(
    sheetText: string,
    sharedStrings: readonly string[],
    filename: string,
    explicitColumns: CsvColumnMapping,
  ): ParsedSheet {
    // function declaration (not a const arrow): TS only narrows on
    // never-returning calls declared this way.
    function fail(detail: string): never {
      throw new FormatParseError(XLSX_ADAPTER_ID, filename, detail)
    }
    const sheetDataSpans = scanElements(sheetText, 'sheetData', 0, sheetText.length, fail)
    if (sheetDataSpans.length === 0) {
      fail('worksheet XML has no <sheetData>; the first sheet part is not a spreadsheet worksheet')
    }
    const sheetData = sheetDataSpans[0]!
    const rowSpans = sheetData.selfClosing
      ? []
      : scanElements(sheetText, 'row', sheetData.innerStart, sheetData.innerEnd, fail)
    if (rowSpans.length === 0) fail('worksheet has no rows; the first row must be the bilingual header row')

    const parseRow = (span: ElementSpan, fallbackRowNumber: string): SheetRow => {
      const rowAttrs = parseAttrs(span.attrsRaw)
      const rAttr = attrValue(rowAttrs, 'r')
      const cells: SheetCell[] = []
      const byColumn = new Map<number, SheetCell>()
      if (!span.selfClosing) {
        let nextColumn = 0
        for (const cellSpan of scanElements(sheetText, 'c', span.innerStart, span.innerEnd, fail)) {
          const cellAttrs = parseAttrs(cellSpan.attrsRaw)
          const ref = attrValue(cellAttrs, 'r')
          const refMatch = ref === undefined ? null : CELL_REF_PATTERN.exec(ref)
          const colIndex = refMatch ? columnIndexFromLetters(refMatch[1]!) : nextColumn
          const cell: SheetCell = {
            span: cellSpan,
            ref,
            colIndex,
            type: (attrValue(cellAttrs, 't') ?? '').toLowerCase(),
            style: attrValue(cellAttrs, 's'),
          }
          cells.push(cell)
          if (!byColumn.has(colIndex)) byColumn.set(colIndex, cell)
          nextColumn = colIndex + 1
        }
      }
      const firstRef = cells[0]?.ref
      const firstRefDigits = firstRef === undefined ? undefined : ROW_NUMBER_PATTERN.exec(firstRef)?.[0]
      return { span, rowNumber: rAttr ?? firstRefDigits ?? fallbackRowNumber, cells, byColumn }
    }

    const headerRow = parseRow(rowSpans[0]!, '1')
    const headerValues = new Map<number, string>()
    let maxHeaderColumn = -1
    for (const cell of headerRow.cells) {
      headerValues.set(cell.colIndex, readCellValue(sheetText, cell, sharedStrings, fail).value)
      maxHeaderColumn = Math.max(maxHeaderColumn, cell.colIndex)
    }
    const header = Array.from({ length: maxHeaderColumn + 1 }, (_, index) => headerValues.get(index) ?? '')
    const columns = this.resolveColumns(header, filename, explicitColumns)

    const warnings: ImportWarning[] = []
    if (columns.key < 0) {
      warnings.push({
        code: 'xlsx.synthesized_key',
        message: 'no key column found; every row gets a synthesized #row-<ordinal> key',
      })
    }
    const seenKeys = new Set<string>()
    const rows: ParsedSheetRow[] = []
    for (let index = 1; index < rowSpans.length; index++) {
      const sheetRow = parseRow(rowSpans[index]!, String(index + 1))
      if (sheetRow.cells.length === 0) continue // formatting-only empty row
      // A row whose cells are ALL empty is skipped like a CSV blank line.
      let hasAnyValue = false
      for (const cell of sheetRow.cells) {
        if (readCellValue(sheetText, cell, sharedStrings, fail).value !== '') {
          hasAnyValue = true
          break
        }
      }
      if (!hasAnyValue) continue

      const read = (columnIndex: number): { value: string; kind: CellReadKind } => {
        if (columnIndex < 0) return { value: '', kind: 'ok' }
        const cell = sheetRow.byColumn.get(columnIndex)
        if (cell === undefined) return { value: '', kind: 'ok' }
        return readCellValue(sheetText, cell, sharedStrings, fail)
      }
      const ordinal = rows.length
      const keyRead = read(columns.key)
      let key = keyRead.value.trim()
      if (key === '') {
        key = `#row-${ordinal}`
        if (columns.key >= 0) {
          warnings.push({
            code: 'xlsx.synthesized_key',
            message: `row ${sheetRow.rowNumber} has an empty key; synthesized key ${JSON.stringify(key)}`,
            segmentKey: key,
          })
        }
      }
      if (seenKeys.has(key)) fail(`duplicate key ${JSON.stringify(key)} (row ${sheetRow.rowNumber})`)
      seenKeys.add(key)
      const sourceRead = read(columns.source)
      const targetRead = read(columns.target)
      const lockedRaw = read(columns.locked).value.trim().toLowerCase()
      const noteRead = read(columns.context)
      for (const [label, cellRead] of [
        ['key', keyRead],
        ['source', sourceRead],
        ['target', targetRead],
      ] as const) {
        if (cellRead.kind === 'error') {
          warnings.push({
            code: 'xlsx.error_cell',
            message: `${label} cell of row ${sheetRow.rowNumber} is an Excel error cell; read as empty`,
            segmentKey: key,
          })
        } else if (cellRead.kind === 'formula-no-cache') {
          warnings.push({
            code: 'xlsx.formula_no_cached_value',
            message: `${label} cell of row ${sheetRow.rowNumber} has a formula without a cached value; read as empty`,
            segmentKey: key,
          })
        }
      }
      rows.push({
        ordinal,
        key,
        source: sourceRead.value,
        target: targetRead.value,
        locked: LOCKED_TRUTHY.has(lockedRaw),
        note: noteRead.value !== '' ? noteRead.value : undefined,
        sheetRow,
        targetCell: columns.target < 0 ? undefined : sheetRow.byColumn.get(columns.target),
      })
    }
    if (rows.length === 0) fail('header row found but no data rows')
    return { columns, rows, warnings }
  }

  private resolveColumns(
    header: string[],
    filename: string,
    explicitColumns: CsvColumnMapping,
  ): ResolvedColumns {
    const pick = (
      aliases: readonly string[],
      explicit: string | undefined,
      label: keyof CsvColumnMapping,
    ): number => {
      if (explicit !== undefined) {
        const matches = header
          .map((name, index) => normalizeDelimitedHeader(name) === normalizeDelimitedHeader(explicit) ? index : -1)
          .filter((index) => index >= 0)
        if (matches.length !== 1) {
          throw new FormatParseError(
            this.id,
            filename,
            matches.length === 0
              ? `explicit ${label} column ${JSON.stringify(explicit)} not found in header (${header.join(', ')})`
              : `explicit ${label} column ${JSON.stringify(explicit)} is ambiguous in header`,
          )
        }
        return matches[0]!
      }
      return header.findIndex((name) => aliases.includes(normalizeDelimitedHeader(name)))
    }
    const key = pick(KEY_ALIASES, explicitColumns.key, 'key')
    const source = pick(SOURCE_ALIASES, explicitColumns.source, 'source')
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
      target: pick(TARGET_ALIASES, explicitColumns.target, 'target'),
      locked: pick(LOCKED_ALIASES, explicitColumns.locked, 'locked'),
      context: pick(CONTEXT_ALIASES, explicitColumns.context, 'context'),
    }
  }

  private importConfig(input: CatFormatImportInput): XlsxFormatConfig | undefined {
    if (input.formatConfigJson !== undefined) return parseXlsxFormatConfig(input.formatConfigJson, input.filename)
    return this.optionConfig(input.filename, 'import')
  }

  private exportConfig(formatConfigJson: string | undefined, filename: string): XlsxFormatConfig | undefined {
    if (formatConfigJson !== undefined) return parseXlsxFormatConfig(formatConfigJson, filename, 'export')
    return this.optionConfig(filename, 'export')
  }

  /** options 保留旧 adapter 兼容性；只有完整显式映射才会成为持久化配置。 */
  private optionConfig(filename: string, phase: XlsxConfigPhase): XlsxFormatConfig | undefined {
    if (this.sheetName === undefined || this.columns.source === undefined || this.columns.target === undefined) return undefined
    const config = parseXlsxFormatConfig(
      JSON.stringify({
        version: XLSX_FORMAT_CONFIG_VERSION,
        sheetName: this.sheetName,
        columns: this.columns,
      }),
      filename,
      phase,
    )
    return config
  }
}
