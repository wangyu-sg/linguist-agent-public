/**
 * PhraseDocxAdapter — Phrase (Memsource) bilingual DOCX (`.docx`) bilingual
 * format adapter (PB-088). A Phrase bilingual DOCX is a multi-table
 * WordprocessingML package: some metadata/intro tables plus one or more
 * content tables whose rows carry the segment pairs. This adapter only
 * claims files with the Phrase content-table shape (see detect scoring
 * below) — a plain DOCX is deliberately never claimed and falls through to
 * the registry's "no adapter" typed error.
 *
 * The segment-row model is cross-validated by two independent sources:
 * 1. the legacy repo's production write path (same author), which locates
 *    segment rows as `<w:tr>` with >= 5 `<w:tc>`, treats cells[0] trimmed as
 *    the segment id and cells[4] as the target, and rewrites only the
 *    target cell text on export;
 * 2. the third-party OSS Supervertaler-Workbench phrase_docx_handler
 *    (format knowledge only): content tables have >= 2 rows, 7 or 8 grid
 *    columns, and a first data cell holding a `<base32>:<index>` segment id
 *    (e.g. `SSOMDWjYi5xvD7wq_dc10:0`); the logical column layout is fixed
 *    as [ID, ICU, #, Source, Target, Status, Comment]; the header row reads
 *    `ID | ICU | # | Source (cs) | Target (de-de) | ...`. The 8-grid
 *    variant is a Source cell with gridSpan=2 — the raw XML still has 7
 *    `<w:tc>` per row, so the regex scan below is naturally compatible.
 *
 * PROVENANCE (docs/attribution/SOURCE_PROVENANCE.md, PB-088): the write-side
 * semantics — cellText (concatenated `<w:t>` runs, entities decoded),
 * rewriteCellText (first `<w:t>` written with xml:space="preserve" forced,
 * remaining `<w:t>` emptied; when no `<w:t>` exists a
 * `<w:p><w:r><w:t xml:space="preserve">` run is inserted before `</w:tc>`),
 * replaceNthCell, and the >= 5-cell row predicate — are adapted from the
 * legacy repo (wangyu-sg/linguist-agent @ la-v2-legacy-freeze-2026-07-25,
 * packages/cat-formats/src/phrase_bilingual_docx.ts, AGPL-3.0 same author).
 * Format knowledge (content-table detection, logical column layout, header
 * shape, segment-id shape) was cross-checked against
 * https://github.com/Supervertaler/Supervertaler-Workbench/blob/main/modules/phrase_docx_handler.py
 * — knowledge reference only, no code copied. The adapter itself (segment
 * model, template export, detect, contract glue) is new code on the
 * xliff-xml helper layer.
 *
 * Segment model:
 * - one segment per content-table row: a `<w:tr>` with >= 5 `<w:tc>` cells
 *   whose first cell trims to a non-empty id containing ':' (segment ids
 *   look like `<base32>:<index>`, e.g. `SSOMDWjYi5xvD7wq_dc10:0`);
 * - header rows (any cell text matching /\bSource\s*\(/i or /\bTarget\s*\(/i)
 *   are skipped, as are metadata/intro tables (< 5 cells) and non-segment
 *   rows (first cell without ':');
 * - key = cells[0] trimmed; duplicate keys are a FormatParseError;
 * - source = cells[3] concatenated `<w:t>` runs (entities decoded, same
 *   semantics as xliff-xml decodeXmlEntities / legacy cellText); target =
 *   cells[4] likewise; ordinal = document order; a document with no segment
 *   rows is a FormatParseError;
 * - Phrase placeholder family (`{N}`, `{N>text<N}`, `<N}`, `{N><N}`) lives
 *   as literal text inside the cell `<w:t>` runs and is preserved VERBATIM
 *   in segment strings — never rehydrated, never converted (same policy as
 *   PB-087 PhraseMxliffAdapter).
 *
 * Status mapping (documented conservative deviation): empty target ->
 * 'untranslated', non-empty target -> 'draft'. The Status cell value is NOT
 * interpreted: the Phrase status-code catalog is not publicly documented,
 * so nothing is guessed — the raw value is surfaced read-only via
 * context.note instead.
 *
 * Locked mapping: always false. DOCX has no segment-level lock concept (the
 * grey shading in Phrase bilingual tables marks locked COLUMNS, not rows).
 *
 * Context mapping (design choice): cells[5] (Status) non-empty ->
 * context.note = `Phrase status: <value>`; cells[2] (#) non-empty ->
 * context.origin = `#<value>`; when neither is present the context field is
 * omitted.
 *
 * detect scoring (the registry picks the highest-scoring adapter):
 * - not a zip, unreadable zip, or no word/document.xml -> 0 (an .xlsx is a
 *   zip too but carries xl/workbook.xml, so the two adapters never
 *   contend);
 * - Phrase content-table shape present (the segment-row predicate hits at
 *   least one row): `.docx` extension -> 0.9, any other extension -> 0.7;
 * - no Phrase shape -> 0 (a plain DOCX is never claimed — importing one
 *   lands on the registry's "no adapter" typed error, deliberately).
 *
 * Export contract (template-based, plan §6.3 — same hard rules as the
 * XlsxAdapter zip family):
 * - originalBytes is the template; when NO target changed, export returns
 *   originalBytes VERBATIM, so an unmodified export is byte-for-byte equal
 *   to the original;
 * - a changed target rewrites ONLY its own row's cells[4] text with the
 *   legacy rewriteCellText semantics (first `<w:t>` gets the encoded text
 *   and xml:space="preserve" forced/appended, remaining `<w:t>` runs are
 *   emptied; a cell without `<w:t>` gets
 *   `<w:p><w:r><w:t xml:space="preserve">` inserted before `</w:tc>`).
 *   Everything else — other cells, other rows, other tables, other zip
 *   entries — keeps its exact bytes;
 * - an empty-string target is a legal write (clears the translation);
 * - unknown key, segment missing from input, or source mismatch ->
 *   FormatExportError; nothing is ever skipped silently;
 * - source comparison uses the sourceText produced by the SAME parsing
 *   path as import;
 * - with changes the zip is repacked (jszip generateAsync DEFLATE, only
 *   word/document.xml replaced; every other entry keeps its payload) — the
 *   container byte shape may differ from the original while the content
 *   stays equivalent (documented deviation, same as PB-081).
 *
 * Known limitations:
 * - the Status cell catalog is not interpreted (see status mapping above);
 *   Comment cells (logical index 6) are not surfaced;
 * - plain DOCX documents are not supported (deliberate — see detect);
 * - the regex scan expects machine-generated WordprocessingML with the
 *   conventional `w:` namespace prefix (everything Phrase/Word writes);
 *   it is NOT a general XML parser (same trade-off as the other adapters);
 * - verified against synthetic fixtures only — no real customer Phrase
 *   DOCX files were used (customer data is never read into this repo).
 */

import { fnv1a64, type SegmentStatus } from '@linguist/cat-core'
import JSZip from 'jszip'
import type {
  CatFormatAdapter,
  CatFormatExportInput,
  CatFormatImportInput,
  ImportedCatAsset,
  ImportedCatSegment,
} from '../adapter'
import { FormatExportError, FormatParseError } from '../errors'
import { sha256Hex, type HashFn } from '../hash'
import { decodeXmlEntities, encodeXmlText } from './xliff-xml'

export const PHRASE_DOCX_ADAPTER_ID = 'phrase_bilingual_docx_1'

const DOCUMENT_PATH = 'word/document.xml'
/** 表头行特征：单元格文本含 "Source (xx)"/"Target (xx)" 语言标注。 */
const HEADER_CELL_PATTERN = /\b(?:Source|Target)\s*\(/i
/** 段行目标列（逻辑列布局 [ID, ICU, #, Source, Target, Status, Comment]）。 */
const TARGET_CELL_INDEX = 4

interface ParsedSegmentRow {
  ordinal: number
  key: string
  sourceText: string
  targetText: string
  /** cells[2]（# 列）trim 后值；空 => undefined。 */
  numberText: string | undefined
  /** cells[5]（Status 列）trim 后值；空 => undefined。 */
  statusText: string | undefined
  /** 行在 document.xml 中的字节区间（导出原位替换用）。 */
  rowStart: number
  rowEnd: number
  rowXml: string
  targetCellXml: string
}

function hasZipMagic(bytes: Uint8Array): boolean {
  if (bytes.length < 4 || bytes[0] !== 0x50 || bytes[1] !== 0x4b) return false
  // local file header (PK\x03\x04) or empty-archive end record (PK\x05\x06)
  return (bytes[2] === 0x03 && bytes[3] === 0x04) || (bytes[2] === 0x05 && bytes[3] === 0x06)
}

/** Legacy cellText: concatenated `<w:t>` runs of one cell, entities decoded. */
function cellText(cellXml: string): string {
  let text = ''
  for (const match of cellXml.matchAll(/<w:t\b[^>]*>([\s\S]*?)<\/w:t>/g)) {
    text += decodeXmlEntities(match[1] ?? '')
  }
  return text
}

/** Legacy tableCells: raw `<w:tc>` markup of one row, in document order. */
function tableCells(rowXml: string): string[] {
  return Array.from(rowXml.matchAll(/<w:tc\b[\s\S]*?<\/w:tc>/g)).map((match) => match[0])
}

/** Legacy replaceNthCell: swap exactly one cell's markup inside a row. */
function replaceNthCell(rowXml: string, cellIndex: number, nextCell: string): string {
  let seen = 0
  return rowXml.replace(/<w:tc\b[\s\S]*?<\/w:tc>/g, (cell) => {
    if (seen === cellIndex) {
      seen += 1
      return nextCell
    }
    seen += 1
    return cell
  })
}

/** Legacy preserveSpaceAttrs: force (or append) xml:space="preserve". */
function preserveSpaceAttrs(attrs: string): string {
  if (/\bxml:space\s*=/.test(attrs)) {
    return attrs.replace(/\s+xml:space\s*=\s*(["']).*?\1/i, ' xml:space="preserve"')
  }
  return `${attrs} xml:space="preserve"`
}

/**
 * Legacy rewriteCellText: write the encoded text into the first `<w:t>`
 * (xml:space="preserve" forced), empty every remaining `<w:t>`; when the
 * cell has no `<w:t>` at all, insert `<w:p><w:r><w:t xml:space="preserve">`
 * before the closing `</w:tc>`.
 */
function rewriteCellText(cellXml: string, value: string): string {
  const text = encodeXmlText(value)
  let wrote = false
  let sawText = false
  const next = cellXml.replace(/<w:t\b([^>]*)>([\s\S]*?)<\/w:t>/g, (_full, attrs: string | undefined) => {
    sawText = true
    if (!wrote) {
      wrote = true
      return `<w:t${preserveSpaceAttrs(attrs ?? '')}>${text}</w:t>`
    }
    return `<w:t${attrs ?? ''}></w:t>`
  })
  if (sawText) return next
  const close = /<\/w:tc>\s*$/i
  const insert = `<w:p><w:r><w:t xml:space="preserve">${text}</w:t></w:r></w:p>`
  return close.test(cellXml) ? cellXml.replace(close, `${insert}</w:tc>`) : cellXml
}

/** 段行判定：>= 5 格、非表头、首格 trim 非空且含 ':'。 */
function segmentKeyOf(cellTexts: string[]): string | undefined {
  const id = (cellTexts[0] ?? '').trim()
  return id !== '' && id.includes(':') ? id : undefined
}

/**
 * Parses document.xml into segment rows in document order. Shared by import
 * and export so both sides see identical keys/sources/targets; export
 * additionally uses the kept row spans for raw surgery. `fail` raises the
 * caller's typed error (duplicate ids, ...).
 */
function parseSegmentRows(documentXml: string, fail: (detail: string) => never): ParsedSegmentRow[] {
  const rows: ParsedSegmentRow[] = []
  const seenKeys = new Set<string>()
  for (const rowMatch of documentXml.matchAll(/<w:tr\b[\s\S]*?<\/w:tr>/g)) {
    const rowXml = rowMatch[0]
    const cells = tableCells(rowXml)
    if (cells.length < 5) continue
    const texts = cells.map(cellText)
    if (texts.some((text) => HEADER_CELL_PATTERN.test(text))) continue
    const key = segmentKeyOf(texts)
    if (key === undefined) continue
    if (seenKeys.has(key)) fail(`duplicate segment id ${JSON.stringify(key)}`)
    seenKeys.add(key)
    const numberText = (texts[2] ?? '').trim()
    const statusText = (texts[5] ?? '').trim()
    const rowStart = rowMatch.index ?? 0
    rows.push({
      ordinal: rows.length,
      key,
      sourceText: texts[3] ?? '',
      targetText: texts[4] ?? '',
      numberText: numberText === '' ? undefined : numberText,
      statusText: statusText === '' ? undefined : statusText,
      rowStart,
      rowEnd: rowStart + rowXml.length,
      rowXml,
      targetCellXml: cells[4]!,
    })
  }
  return rows
}

/** Lenient detect-side scan: does at least one segment row exist? (Never throws.) */
function hasSegmentRowShape(documentXml: string): boolean {
  for (const rowMatch of documentXml.matchAll(/<w:tr\b[\s\S]*?<\/w:tr>/g)) {
    const cells = tableCells(rowMatch[0])
    if (cells.length < 5) continue
    const texts = cells.map(cellText)
    if (texts.some((text) => HEADER_CELL_PATTERN.test(text))) continue
    if (segmentKeyOf(texts) !== undefined) return true
  }
  return false
}

/** Conservative status mapping (see the file header for the deviation note). */
function statusFromTarget(target: string): SegmentStatus {
  return target === '' ? 'untranslated' : 'draft'
}

export class PhraseDocxAdapter implements CatFormatAdapter {
  readonly id: string = PHRASE_DOCX_ADAPTER_ID
  readonly extensions = ['.docx']

  constructor(private readonly hash: HashFn = sha256Hex) {}

  async detect(input: Uint8Array, filename: string): Promise<number> {
    if (!hasZipMagic(input)) return 0
    let zip: JSZip
    try {
      zip = await JSZip.loadAsync(input)
    } catch {
      return 0
    }
    const entry = zip.file(DOCUMENT_PATH)
    if (entry === null) return 0
    let documentXml: string
    try {
      documentXml = await entry.async('string')
    } catch {
      return 0
    }
    if (!hasSegmentRowShape(documentXml)) return 0
    return filename.toLowerCase().endsWith('.docx') ? 0.9 : 0.7
  }

  async import(input: CatFormatImportInput): Promise<ImportedCatAsset> {
    const { bytes, filename, sourceLocale, targetLocale } = input
    const { documentXml } = await this.openPackage(bytes, filename)
    const rows = this.parseDocument(documentXml, filename)
    const segments: ImportedCatSegment[] = rows.map((row) => ({
      ordinal: row.ordinal,
      key: row.key,
      source: row.sourceText,
      target: row.targetText,
      sourceLocale,
      targetLocale,
      status: statusFromTarget(row.targetText),
      locked: false,
      revision: 0,
      sourceHash: fnv1a64(row.sourceText),
      ...(row.statusText !== undefined || row.numberText !== undefined
        ? {
            context: {
              ...(row.statusText !== undefined ? { note: `Phrase status: ${row.statusText}` } : {}),
              ...(row.numberText !== undefined ? { origin: `#${row.numberText}` } : {}),
            },
          }
        : {}),
    }))
    return {
      asset: {
        formatId: this.id,
        originalFilename: filename,
        sourceSha256: await this.hash(bytes),
        segmentCount: segments.length,
      },
      segments,
      warnings: [],
      originalBytes: bytes,
    }
  }

  async export(input: CatFormatExportInput): Promise<Uint8Array> {
    const { originalBytes, asset, segments } = input
    const filename = asset.originalFilename
    const { zip, documentXml } = await this.openPackage(originalBytes, filename)
    const rows = this.parseDocument(documentXml, filename)

    const byKey = new Map<string, (typeof segments)[number]>()
    for (const segment of segments) {
      const key = segment.key ?? ''
      if (byKey.has(key)) {
        throw new FormatExportError(this.id, `duplicate segment key ${JSON.stringify(key)} in export input`)
      }
      byKey.set(key, segment)
    }
    const templateKeys = new Set(rows.map((row) => row.key))
    for (const key of byKey.keys()) {
      if (!templateKeys.has(key)) {
        throw new FormatExportError(this.id, `segment key ${JSON.stringify(key)} is not present in the original template`)
      }
    }

    // Splice edits over document.xml; untouched rows keep their exact bytes.
    const edits: Array<{ start: number; end: number; replacement: string }> = []
    for (const row of rows) {
      const segment = byKey.get(row.key)
      if (!segment) {
        throw new FormatExportError(
          this.id,
          `segment ${JSON.stringify(row.key)} missing from export input; refusing to skip it silently`,
        )
      }
      if (segment.source !== row.sourceText) {
        throw new FormatExportError(
          this.id,
          `segment ${JSON.stringify(row.key)}: source text differs from the original template; sources are never rewritten on export`,
        )
      }
      if (segment.target === row.targetText) continue
      edits.push({
        start: row.rowStart,
        end: row.rowEnd,
        replacement: replaceNthCell(row.rowXml, TARGET_CELL_INDEX, rewriteCellText(row.targetCellXml, segment.target)),
      })
    }

    // Byte-stability hard rule: with no target changes the original package
    // is returned verbatim (zip recompression would legitimately differ).
    if (edits.length === 0) return originalBytes

    edits.sort((a, b) => b.start - a.start)
    let out = documentXml
    for (const edit of edits) out = out.slice(0, edit.start) + edit.replacement + out.slice(edit.end)
    zip.file(DOCUMENT_PATH, out)
    return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' })
  }

  /** Opens the zip package and reads word/document.xml as UTF-8 text. */
  private async openPackage(bytes: Uint8Array, filename: string): Promise<{ zip: JSZip; documentXml: string }> {
    // function declaration (not a const arrow): TS only narrows on
    // never-returning calls declared this way.
    function fail(detail: string): never {
      throw new FormatParseError(PHRASE_DOCX_ADAPTER_ID, filename, detail)
    }
    if (!hasZipMagic(bytes)) fail('not a ZIP container; .docx is an OOXML zip package (PK\\x03\\x04)')
    let zip: JSZip
    try {
      zip = await JSZip.loadAsync(bytes)
    } catch (err) {
      throw new FormatParseError(this.id, filename, 'ZIP container could not be read', { cause: err })
    }
    const entry = zip.file(DOCUMENT_PATH)
    if (entry === null) fail(`${DOCUMENT_PATH} not found; not an OOXML word-processing package`)
    return { zip, documentXml: await entry.async('string') }
  }

  /** Strict shared parse (import + export); zero segment rows is a parse error. */
  private parseDocument(documentXml: string, filename: string): ParsedSegmentRow[] {
    function fail(detail: string): never {
      throw new FormatParseError(PHRASE_DOCX_ADAPTER_ID, filename, detail)
    }
    const rows = parseSegmentRows(documentXml, fail)
    if (rows.length === 0) {
      fail('no Phrase bilingual segment rows found (a content-table row needs >= 5 cells and a `<id>:<index>` first cell)')
    }
    return rows
  }
}
