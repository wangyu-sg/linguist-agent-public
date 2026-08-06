/**
 * parseXlsxWorkbook — deterministic multi-sheet XLSX workbook reader with a
 * built-in Verification Report. Library-layer infrastructure for language
 * asset intake: no IPC, no store, no authority writes.
 *
 * Relationship to the XlsxAdapter (adapters/xlsx.ts): the adapter is a
 * single-sheet bilingual import/export adapter; this module is a sibling
 * pure-function reader (like parseTmx/parseTbx) that scans EVERY worksheet
 * and preserves physical evidence. Both share the same OOXML primitives
 * (scanElements / readSharedStrings / resolveZipPath / decodeXmlText /
 * unescapeOoxmlControls, <rPh> phonetic runs always excluded) imported from
 * ./adapters/xlsx — no second copy of the parsing logic.
 *
 * Row-number semantics (explicit contract, declared again in the report):
 * every row carries `rowNo` = the PHYSICAL Excel row number (the <row r>
 * attribute). Empty rows are never dropped-then-renumbered: physical rows
 * present in the XML are kept in document order with isEmpty=true, and rows
 * absent from the XML simply do not appear — a gap between rowNo values is
 * the truthful representation. When a writer omits the r attribute the row
 * number is inferred (first cell ref digits, else previous row + 1) and
 * counted in stats.inferredRowNumbers.
 *
 * Header detection: by default the first NON-EMPTY row is the (first) header
 * row; options.headerRowCount (default 1) declares a multi-row header block,
 * and options.headerRowNo pins the header to a specific physical row number
 * (for callers that already know the layout). Rows physically above the
 * header are NOT silently dropped — they are returned in
 * sheet.skippedRowsAboveHeader with their values.
 *
 * Sheet visibility: hidden/veryHidden sheets are parsed exactly like visible
 * ones and explicitly labeled via sheet.state (never silently skipped); each
 * non-visible sheet additionally yields an import warning
 * (code 'xlsx_workbook.nonvisible_sheet_scanned'). Parts that are not
 * worksheets (chartsheet/dialogsheet/macro sheet) cannot carry tabular data
 * and are listed in result.skippedSheets with a reason.
 *
 * Distortion accounting (per sheet + workbook totals in the report):
 * formula cells with/without cached values (formulas are never evaluated; a
 * formula without a cached value reads as '' plus a warning), error cells
 * (read as '' plus a warning), merged ranges and the non-anchor cells they
 * cover (which read empty), <rPh> phonetic runs excluded (pollution of the
 * returned values is impossible by construction — the shared primitives
 * strip them), and `_xHHHH_` control-escape restorations.
 *
 * Fail closed: corrupt zip/XML, an unresolvable sheet relationship, a
 * missing worksheet part, malformed cell/merge references, a duplicate
 * physical row number, or any read/emitted row-count mismatch throw a
 * FormatParseError — NO partial result is ever returned. The report's
 * `consistency` block states which reconciliations ran. Worksheet-part root
 * checks read the document head only (entity declarations rejected, first
 * start-tag after the prolog decides) instead of building a whole-document
 * DOM — a 200MB+ real part would otherwise amplify peak memory ~14x; the
 * structures the reader consumes are still fully validated by scanElements.
 */

import JSZip from 'jszip'
import type { ImportWarning } from './adapter'
import { FormatParseError } from './errors'
import { sha256Hex, type HashFn } from './hash'
import { descendants, localName, parseXml } from './xml-parser'
import { findFirst, parseAttrs } from './adapters/xliff-xml'
import {
  attrValue,
  CELL_REF_PATTERN,
  columnIndexFromLetters,
  columnLettersFromIndex,
  decodeXmlText,
  elementAttrByLocalName,
  FORMULA_PATTERN,
  hasZipMagic,
  inlineStringText,
  readSharedStrings,
  resolveZipPath,
  rootTagFromProlog,
  ROW_NUMBER_PATTERN,
  scanElements,
  SHARED_STRINGS_PATH,
  WORKBOOK_PATH,
  WORKBOOK_RELS_PATH,
  type ElementSpan,
  type OoxmlTextCounter,
} from './adapters/xlsx'

export const XLSX_WORKBOOK_PARSER_ID = 'xlsx_workbook'
export const XLSX_WORKBOOK_PARSER_VERSION = 1

/** Sheet visibility as declared by the workbook.xml `state` attribute. */
export type XlsxSheetState = 'visible' | 'hidden' | 'veryHidden'

/** How a cell's returned value was obtained (distortion-relevant). */
export type XlsxWorkbookCellKind =
  | 'text' // stored text (shared/inline/numeric/boolean/cached str)
  | 'formula-cached' // formula cell; the CACHED <v> value (formula never evaluated)
  | 'formula-no-cache' // formula cell without a cached value; reads as ''
  | 'error' // t="e" Excel error cell; reads as ''
  | 'empty' // no stored content at all

export interface XlsxWorkbookCell {
  /** A1 reference ('B7'); synthesized from position when the writer omitted r. */
  ref: string
  /** 0-based column index. */
  col: number
  value: string
  kind: XlsxWorkbookCellKind
}

export interface XlsxWorkbookRow {
  /** PHYSICAL Excel row number (see module header for the semantics contract). */
  rowNo: number
  /** true when every cell reads as '' (formatting-only row, kept, not renumbered). */
  isEmpty: boolean
  cells: XlsxWorkbookCell[]
}

export interface XlsxMergedRange {
  /** Merge reference as written, e.g. 'B2:D4'. */
  ref: string
  /** Top-left (anchor) cell reference, e.g. 'B2' — the only cell carrying a value. */
  anchor: string
  /** Non-anchor cells covered by this range (they read empty). */
  coveredCells: number
}

/** Distortion-risk counters, per sheet and (summed) for the whole workbook. */
export interface XlsxWorkbookDistortion {
  formulaCells: number
  formulaCellsWithCachedValue: number
  formulaCellsWithoutCachedValue: number
  errorCells: number
  mergedRanges: number
  /** Non-anchor cells covered by merged ranges (read empty). */
  mergedCoveredCells: number
  /** <rPh> phonetic runs excluded; values are never polluted by construction. */
  phoneticRunsExcluded: number
  /** `_xHHHH_` control-character escape sequences restored. */
  ooxmlEscapesRestored: number
}

export interface XlsxWorkbookSheetStats {
  /** Physical <row> elements (header + skipped-above + data, empty included). */
  totalRows: number
  headerRows: number
  /** Rows physically above the header (returned, never silently dropped). */
  skippedRowsAboveHeader: number
  dataRows: number
  nonEmptyDataRows: number
  /** Empty data rows kept with isEmpty=true (NOT renumbered away). */
  emptyDataRows: number
  /** Rows whose r attribute was missing/invalid (row number inferred). */
  inferredRowNumbers: number
}

export interface XlsxWorkbookSheet {
  name: string
  state: XlsxSheetState
  /** Zip part path inside the package (never a host filesystem path). */
  partPath: string
  /** Physical row numbers of the header block (multi-header disclosure). */
  headerRowNumbers: number[]
  headers: XlsxWorkbookRow[]
  /** Rows physically above the header, values included — nothing dropped silently. */
  skippedRowsAboveHeader: XlsxWorkbookRow[]
  /** Data rows below the header block, physical rowNo order (possibly truncated). */
  rows: XlsxWorkbookRow[]
  mergedRanges: XlsxMergedRange[]
  stats: XlsxWorkbookSheetStats
  distortion: XlsxWorkbookDistortion
}

/** A workbook sheet that could not be scanned as tabular data, with reason. */
export interface XlsxSkippedSheet {
  name: string
  state: XlsxSheetState
  reason: string
}

export interface XlsxWorkbookVerificationReport {
  /** SHA-256 (hex) of the exact input bytes. */
  sourceSha256: string
  parserId: typeof XLSX_WORKBOOK_PARSER_ID
  parserVersion: typeof XLSX_WORKBOOK_PARSER_VERSION
  /** Explicit declaration: rowNo is the physical Excel row number. */
  rowNumberSemantics: 'physical-excel-row-number'
  totalSheets: number
  scannedSheets: number
  skippedSheets: number
  /** Per-sheet coverage entry (name, state, scanned/skipped + reason). */
  sheets: Array<{ name: string; state: XlsxSheetState; status: 'scanned' | 'skipped'; reason?: string }>
  /** Shared-strings table facts (workbook-global distortion sources). */
  sharedStrings: {
    entries: number
    entriesWithPhoneticRuns: number
    entriesWithEscapes: number
  }
  /** Workbook totals (sum over scanned sheets). */
  totals: {
    rows: number
    headerRows: number
    skippedRowsAboveHeader: number
    dataRows: number
    emptyDataRows: number
    cells: number
  }
  distortion: XlsxWorkbookDistortion
  /** Sampling/truncation disclosure (null when no limit was applied). */
  sampling: {
    maxRowsPerSheet: number | null
    truncatedSheets: Array<{ sheet: string; returnedRows: number; totalDataRows: number }>
  }
  /** Reconciliations that passed (failure throws, so these are always true here). */
  consistency: {
    /** Per-sheet: emitted rows + headers + skipped-above == physical rows read. */
    rowsReconciled: true
    /** scanned + skipped == sheets declared in workbook.xml. */
    sheetCoverageReconciled: true
  }
}

export interface XlsxWorkbookParseOptions {
  /** Logical filename used in error messages only. */
  filename?: string
  /** Declared header block size in rows (default 1; >1 for multi-row headers). */
  headerRowCount?: number
  /** Pin the header block to this PHYSICAL row number (default: first non-empty row). */
  headerRowNo?: number
  /** Cap on returned data rows per sheet; truncation is disclosed in the report. */
  maxRowsPerSheet?: number
  /** Injectable hasher; default is the built-in pure-TS SHA-256. */
  hash?: HashFn
}

export interface XlsxWorkbookParseResult {
  sheets: XlsxWorkbookSheet[]
  skippedSheets: XlsxSkippedSheet[]
  warnings: ImportWarning[]
  report: XlsxWorkbookVerificationReport
}

interface RawCell {
  ref: string | undefined
  colIndex: number
  type: string
  span: ElementSpan
}

interface RawRow {
  rowNo: number
  cells: RawCell[]
}

function emptyDistortion(): XlsxWorkbookDistortion {
  return {
    formulaCells: 0,
    formulaCellsWithCachedValue: 0,
    formulaCellsWithoutCachedValue: 0,
    errorCells: 0,
    mergedRanges: 0,
    mergedCoveredCells: 0,
    phoneticRunsExcluded: 0,
    ooxmlEscapesRestored: 0,
  }
}

/**
 * Deterministic multi-sheet XLSX workbook reader. Throws FormatParseError
 * (fail closed) on any corrupt or inconsistent input — a returned result is
 * always complete and internally reconciled.
 */
export async function parseXlsxWorkbook(
  bytes: Uint8Array,
  options: XlsxWorkbookParseOptions = {},
): Promise<XlsxWorkbookParseResult> {
  const filename = options.filename ?? 'memory.xlsx'
  // function declaration (not a const arrow): TS only narrows on
  // never-returning calls declared this way.
  function fail(detail: string): never {
    throw new FormatParseError(XLSX_WORKBOOK_PARSER_ID, filename, detail)
  }
  const headerRowCount = options.headerRowCount ?? 1
  if (!Number.isInteger(headerRowCount) || headerRowCount < 1) {
    fail(`headerRowCount must be a positive integer, got ${JSON.stringify(options.headerRowCount)}`)
  }
  const headerRowNo = options.headerRowNo
  if (headerRowNo !== undefined && (!Number.isInteger(headerRowNo) || headerRowNo < 1)) {
    fail(`headerRowNo must be a positive integer, got ${JSON.stringify(options.headerRowNo)}`)
  }
  const maxRows = options.maxRowsPerSheet
  if (maxRows !== undefined && (!Number.isInteger(maxRows) || maxRows < 1)) {
    fail(`maxRowsPerSheet must be a positive integer, got ${JSON.stringify(options.maxRowsPerSheet)}`)
  }
  const hash = options.hash ?? sha256Hex

  if (!hasZipMagic(bytes)) fail('not a ZIP container; .xlsx is an OOXML zip package (PK\\x03\\x04)')
  let zip: JSZip
  try {
    zip = await JSZip.loadAsync(bytes)
  } catch (err) {
    throw new FormatParseError(XLSX_WORKBOOK_PARSER_ID, filename, 'ZIP container could not be read', { cause: err })
  }
  const workbookEntry = zip.file(WORKBOOK_PATH)
  if (workbookEntry === null) fail(`${WORKBOOK_PATH} not found; not an OOXML spreadsheet package`)
  const workbookDoc = parseXml(await workbookEntry.async('uint8array'), XLSX_WORKBOOK_PARSER_ID, filename)
  if (localName(workbookDoc.documentElement) !== 'workbook') {
    fail(`${WORKBOOK_PATH} root is not <workbook>`)
  }
  const sheetElements = descendants(workbookDoc, 'sheet')
  if (sheetElements.length === 0) fail('workbook.xml lists no <sheet> elements')
  const relsEntry = zip.file(WORKBOOK_RELS_PATH)
  if (relsEntry === null) fail(`${WORKBOOK_RELS_PATH} missing; cannot resolve worksheet parts`)
  const relsDoc = parseXml(await relsEntry.async('uint8array'), XLSX_WORKBOOK_PARSER_ID, filename)
  const targets = new Map<string, { target: string; external: boolean }>()
  for (const rel of descendants(relsDoc, 'relationship')) {
    const id = rel.getAttribute('Id')
    const target = rel.getAttribute('Target')
    if (id !== null && id !== '' && target !== null && target !== '') {
      targets.set(id, { target, external: rel.getAttribute('TargetMode') === 'External' })
    }
  }

  const sstEntry = zip.file(SHARED_STRINGS_PATH)
  const sstCounters: OoxmlTextCounter[] = []
  const sharedStrings =
    sstEntry === null
      ? []
      : readSharedStrings(await sstEntry.async('uint8array'), XLSX_WORKBOOK_PARSER_ID, filename, sstCounters)

  const warnings: ImportWarning[] = []
  const sheets: XlsxWorkbookSheet[] = []
  const skippedSheets: XlsxSkippedSheet[] = []

  for (const sheetElement of sheetElements) {
    const name = sheetElement.getAttribute('name') ?? '(unnamed)'
    const rawState = sheetElement.getAttribute('state')
    if (rawState !== null && rawState !== '' && rawState !== 'visible' && rawState !== 'hidden' && rawState !== 'veryHidden') {
      fail(`sheet ${JSON.stringify(name)} has an unknown state ${JSON.stringify(rawState)}`)
    }
    const state: XlsxSheetState = rawState === 'hidden' || rawState === 'veryHidden' ? rawState : 'visible'
    const ridAttr = sheetElement.getAttribute('r:id')
    const relId =
      (ridAttr !== null && ridAttr !== '' ? ridAttr : undefined) ??
      elementAttrByLocalName(sheetElement, 'id') ??
      fail(`sheet ${JSON.stringify(name)} has no relationship id (r:id)`)
    const rel = targets.get(relId)
    if (rel === undefined) {
      fail(`relationship ${JSON.stringify(relId)} of sheet ${JSON.stringify(name)} is not in workbook.xml.rels`)
    }
    if (rel.external) {
      skippedSheets.push({ name, state, reason: `relationship ${relId} is external; no worksheet part in the package` })
      continue
    }
    const partPath = resolveZipPath('xl', rel.target)
    const part = zip.file(partPath)
    if (part === null) fail(`worksheet part ${JSON.stringify(partPath)} of sheet ${JSON.stringify(name)} not found in the package`)
    const partBytes = await part.async('uint8array')
    let sheetText: string
    try {
      // Default ignoreBOM:false consumes a BOM when present.
      sheetText = new TextDecoder('utf-8', { fatal: true }).decode(partBytes)
    } catch (err) {
      throw new FormatParseError(XLSX_WORKBOOK_PARSER_ID, filename, `worksheet part ${partPath} is not valid UTF-8`, { cause: err })
    }
    // Root check WITHOUT a whole-document DOM: a 200MB+ real worksheet part
    // amplified peak memory ~14x when parsed via xmldom just for the root
    // name (55MB zip -> 18GB peak RSS on a real file). The same two gates
    // parseXml used to provide are kept explicitly — entity declarations are
    // rejected, then the first start-tag after the prolog decides. Structures
    // the reader consumes (sheetData/row/c/mergeCell) are still validated by
    // scanElements, which fails loudly on malformed markup. Non-worksheet
    // parts (chartsheet etc.) cannot carry tabular data and are disclosed as
    // skipped, not guessed at.
    if (/<!ENTITY\b/i.test(sheetText)) {
      throw new FormatParseError(XLSX_WORKBOOK_PARSER_ID, filename, '不允许 XML 实体声明')
    }
    const rootTag = rootTagFromProlog(sheetText)
    if (rootTag === undefined) {
      fail(`worksheet part ${JSON.stringify(partPath)} of sheet ${JSON.stringify(name)} has no root element`)
    }
    if (rootTag.local !== 'worksheet') {
      skippedSheets.push({ name, state, reason: `part ${partPath} root is <${rootTag.raw}>, not a worksheet` })
      continue
    }
    const sheet = parseWorksheet({
      sheetText,
      name,
      state,
      partPath,
      sharedStrings,
      sstCounters,
      headerRowCount,
      headerRowNo,
      maxRows,
      warnings,
      fail,
    })
    if (state !== 'visible') {
      warnings.push({
        code: 'xlsx_workbook.nonvisible_sheet_scanned',
        message: `sheet ${JSON.stringify(name)} is ${state}; it was parsed and labeled, not silently skipped`,
      })
    }
    sheets.push(sheet)
  }

  // Workbook-level reconciliation: every declared sheet is accounted for.
  if (sheets.length + skippedSheets.length !== sheetElements.length) {
    fail(`sheet coverage mismatch: ${sheets.length} scanned + ${skippedSheets.length} skipped != ${sheetElements.length} declared`)
  }

  const totals = { rows: 0, headerRows: 0, skippedRowsAboveHeader: 0, dataRows: 0, emptyDataRows: 0, cells: 0 }
  const distortion = emptyDistortion()
  const truncatedSheets: Array<{ sheet: string; returnedRows: number; totalDataRows: number }> = []
  const countCells = (rows: readonly XlsxWorkbookRow[]): number => rows.reduce((sum, row) => sum + row.cells.length, 0)
  for (const sheet of sheets) {
    totals.rows += sheet.stats.totalRows
    totals.headerRows += sheet.stats.headerRows
    totals.skippedRowsAboveHeader += sheet.stats.skippedRowsAboveHeader
    totals.dataRows += sheet.stats.dataRows
    totals.emptyDataRows += sheet.stats.emptyDataRows
    totals.cells += countCells(sheet.headers) + countCells(sheet.skippedRowsAboveHeader) + countCells(sheet.rows)
    for (const key of Object.keys(distortion) as Array<keyof XlsxWorkbookDistortion>) {
      distortion[key] += sheet.distortion[key]
    }
    if (maxRows !== undefined && sheet.rows.length < sheet.stats.dataRows) {
      truncatedSheets.push({ sheet: sheet.name, returnedRows: sheet.rows.length, totalDataRows: sheet.stats.dataRows })
    }
  }

  const report: XlsxWorkbookVerificationReport = {
    sourceSha256: await hash(bytes),
    parserId: XLSX_WORKBOOK_PARSER_ID,
    parserVersion: XLSX_WORKBOOK_PARSER_VERSION,
    rowNumberSemantics: 'physical-excel-row-number',
    totalSheets: sheetElements.length,
    scannedSheets: sheets.length,
    skippedSheets: skippedSheets.length,
    sheets: [
      ...sheets.map((sheet) => ({ name: sheet.name, state: sheet.state, status: 'scanned' as const })),
      ...skippedSheets.map((sheet) => ({ name: sheet.name, state: sheet.state, status: 'skipped' as const, reason: sheet.reason })),
    ],
    sharedStrings: {
      entries: sharedStrings.length,
      entriesWithPhoneticRuns: sstCounters.filter((counter) => counter.rPhRunsExcluded > 0).length,
      entriesWithEscapes: sstCounters.filter((counter) => counter.escapesRestored > 0).length,
    },
    totals,
    distortion,
    sampling: { maxRowsPerSheet: maxRows ?? null, truncatedSheets },
    consistency: { rowsReconciled: true, sheetCoverageReconciled: true },
  }
  return { sheets, skippedSheets, warnings, report }
}

interface ParseWorksheetInput {
  sheetText: string
  name: string
  state: XlsxSheetState
  partPath: string
  sharedStrings: readonly string[]
  sstCounters: readonly OoxmlTextCounter[]
  headerRowCount: number
  headerRowNo: number | undefined
  maxRows: number | undefined
  warnings: ImportWarning[]
  fail: (detail: string) => never
}

/** Parses one worksheet part into the sheet DTO (rows/headers/merges/stats). */
function parseWorksheet(input: ParseWorksheetInput): XlsxWorkbookSheet {
  const { sheetText, name, state, partPath, sharedStrings, sstCounters, headerRowCount, headerRowNo, maxRows, warnings, fail } = input
  const counter: OoxmlTextCounter = { escapesRestored: 0, rPhRunsExcluded: 0 }
  const distortion = emptyDistortion()

  const sheetDataSpans = scanElements(sheetText, 'sheetData', 0, sheetText.length, fail)
  const rawRows: RawRow[] = []
  let inferredRowNumbers = 0
  if (sheetDataSpans.length > 0 && !sheetDataSpans[0]!.selfClosing) {
    const sheetData = sheetDataSpans[0]!
    const rowSpans = scanElements(sheetText, 'row', sheetData.innerStart, sheetData.innerEnd, fail)
    const seenRowNumbers = new Set<number>()
    let previousRowNo = 0
    for (const rowSpan of rowSpans) {
      const rowAttrs = parseAttrs(rowSpan.attrsRaw)
      const rAttr = attrValue(rowAttrs, 'r')
      const cells: RawCell[] = []
      if (!rowSpan.selfClosing) {
        let nextColumn = 0
        for (const cellSpan of scanElements(sheetText, 'c', rowSpan.innerStart, rowSpan.innerEnd, fail)) {
          const cellAttrs = parseAttrs(cellSpan.attrsRaw)
          const ref = attrValue(cellAttrs, 'r')
          let colIndex: number
          if (ref === undefined) {
            colIndex = nextColumn
          } else {
            const refMatch = CELL_REF_PATTERN.exec(ref)
            // fail via a destructured property does not narrow — assert after it.
            if (refMatch === null) fail(`cell reference ${JSON.stringify(ref)} in sheet ${JSON.stringify(name)} is not a valid A1 reference`)
            colIndex = columnIndexFromLetters(refMatch![1]!)
          }
          cells.push({ ref, colIndex, type: (attrValue(cellAttrs, 't') ?? '').toLowerCase(), span: cellSpan })
          nextColumn = colIndex + 1
        }
      }
      let rowNo: number
      if (rAttr !== undefined && /^[0-9]+$/.test(rAttr)) {
        rowNo = Number(rAttr)
      } else {
        const firstRef = cells[0]?.ref
        const digits = firstRef === undefined ? undefined : ROW_NUMBER_PATTERN.exec(firstRef)?.[0]
        rowNo = digits === undefined ? previousRowNo + 1 : Number(digits)
        inferredRowNumbers += 1
      }
      if (seenRowNumbers.has(rowNo)) {
        fail(`duplicate physical row number ${rowNo} in sheet ${JSON.stringify(name)}; workbook structure is inconsistent`)
      }
      seenRowNumbers.add(rowNo)
      previousRowNo = rowNo
      rawRows.push({ rowNo, cells })
    }
  }

  const readCell = (cell: RawCell, rowNo: number): XlsxWorkbookCell => {
    const inner = sheetText.slice(cell.span.innerStart, cell.span.innerEnd)
    // Writers may omit the r attribute; the ref is then synthesized from position.
    const ref = cell.ref ?? `${columnLettersFromIndex(cell.colIndex)}${rowNo}`
    const out = (value: string, kind: XlsxWorkbookCellKind): XlsxWorkbookCell => ({ ref, col: cell.colIndex, value, kind })
    if (cell.type === 'inlinestr') {
      const is = findFirst(inner, 'is')
      return out(is === undefined ? '' : inlineStringText(is.inner, counter), 'text')
    }
    const vElement = findFirst(inner, 'v')
    const vText = vElement === undefined ? undefined : decodeXmlText(vElement.inner, counter)
    if (cell.type === 's') {
      if (vText === undefined) {
        if (cell.span.selfClosing) return out('', 'empty')
        fail(`cell ${ref} in sheet ${JSON.stringify(name)}: shared-string cell without a <v> index`)
      }
      const index = Number(vText)
      if (!Number.isInteger(index) || index < 0 || index >= sharedStrings.length) {
        fail(`cell ${ref} in sheet ${JSON.stringify(name)}: shared string index ${JSON.stringify(vText)} out of range (sharedStrings has ${sharedStrings.length} entries)`)
      }
      // Attribute sst-origin <rPh>/escape counts to every referencing cell.
      counter.rPhRunsExcluded += sstCounters[index]!.rPhRunsExcluded
      counter.escapesRestored += sstCounters[index]!.escapesRestored
      return out(sharedStrings[index]!, 'text')
    }
    if (cell.type === 'b') {
      const raw = (vText ?? '').trim()
      return out(raw === '1' ? 'TRUE' : raw === '0' ? 'FALSE' : raw, 'text')
    }
    if (cell.type === 'e') return out('', 'error')
    const hasFormula = FORMULA_PATTERN.test(inner)
    if (hasFormula) {
      return vText === undefined ? out('', 'formula-no-cache') : out(vText, 'formula-cached')
    }
    if (vText !== undefined) return out(vText, 'text')
    return out('', 'empty')
  }

  const materialize = (raw: RawRow): XlsxWorkbookRow => {
    const cells = raw.cells.map((cell) => readCell(cell, raw.rowNo))
    return { rowNo: raw.rowNo, isEmpty: cells.every((cell) => cell.value === ''), cells }
  }

  const allRows = rawRows.map(materialize)

  // Header detection: options.headerRowNo pins the header block to a physical
  // row; otherwise the first non-empty physical row opens it. Everything
  // physically above the header is disclosed, never dropped.
  let headerStart: number
  if (headerRowNo !== undefined) {
    headerStart = allRows.findIndex((row) => row.rowNo === headerRowNo)
    if (headerStart < 0) {
      fail(`sheet ${JSON.stringify(name)} has no physical row ${headerRowNo}; cannot honor the declared headerRowNo`)
    }
  } else {
    headerStart = allRows.findIndex((row) => !row.isEmpty)
  }
  let headers: XlsxWorkbookRow[] = []
  let skippedAbove: XlsxWorkbookRow[] = []
  let dataRows: XlsxWorkbookRow[] = []
  if (headerStart >= 0) {
    skippedAbove = allRows.slice(0, headerStart)
    headers = allRows.slice(headerStart, headerStart + headerRowCount)
    if (headers.length < headerRowCount) {
      fail(
        `sheet ${JSON.stringify(name)} has ${allRows.length - headerStart} row(s) from its first non-empty row, fewer than the declared headerRowCount ${headerRowCount}`,
      )
    }
    dataRows = allRows.slice(headerStart + headerRowCount)
  } else {
    dataRows = allRows // only formatting-empty rows (or none): no header exists
  }

  const mergedRanges: XlsxMergedRange[] = []
  for (const mergeSpan of scanElements(sheetText, 'mergeCell', 0, sheetText.length, fail)) {
    const mergeAttrs = parseAttrs(mergeSpan.attrsRaw)
    const ref = attrValue(mergeAttrs, 'ref')
    const rangeMatch = ref === undefined ? null : /^([A-Za-z]+[0-9]+):([A-Za-z]+[0-9]+)$/.exec(ref)
    // fail via a destructured property does not narrow — assert after it.
    if (rangeMatch === null) fail(`mergeCell reference ${JSON.stringify(ref)} in sheet ${JSON.stringify(name)} is not a valid range`)
    const from = CELL_REF_PATTERN.exec(rangeMatch![1]!)!
    const to = CELL_REF_PATTERN.exec(rangeMatch![2]!)!
    const covered =
      (Number(to[2]) - Number(from[2]) + 1) * (columnIndexFromLetters(to[1]!) - columnIndexFromLetters(from[1]!) + 1) - 1
    if (covered < 0) fail(`mergeCell reference ${JSON.stringify(ref)} in sheet ${JSON.stringify(name)} is reversed`)
    mergedRanges.push({ ref: ref!, anchor: rangeMatch![1]!, coveredCells: covered })
  }

  for (const row of [...headers, ...skippedAbove, ...dataRows]) {
    for (const cell of row.cells) {
      if (cell.kind === 'formula-cached') {
        distortion.formulaCells += 1
        distortion.formulaCellsWithCachedValue += 1
      } else if (cell.kind === 'formula-no-cache') {
        distortion.formulaCells += 1
        distortion.formulaCellsWithoutCachedValue += 1
        warnings.push({
          code: 'xlsx_workbook.formula_no_cached_value',
          message: `cell ${cell.ref} of sheet ${JSON.stringify(name)} (row ${row.rowNo}) has a formula without a cached value; read as empty`,
        })
      } else if (cell.kind === 'error') {
        distortion.errorCells += 1
        warnings.push({
          code: 'xlsx_workbook.error_cell',
          message: `cell ${cell.ref} of sheet ${JSON.stringify(name)} (row ${row.rowNo}) is an Excel error cell; read as empty`,
        })
      }
    }
  }
  distortion.mergedRanges = mergedRanges.length
  distortion.mergedCoveredCells = mergedRanges.reduce((sum, range) => sum + range.coveredCells, 0)
  if (mergedRanges.length > 0) {
    warnings.push({
      code: 'xlsx_workbook.merged_cells',
      message: `sheet ${JSON.stringify(name)} has ${mergedRanges.length} merged range(s) covering ${distortion.mergedCoveredCells} non-anchor cell(s); covered cells read empty, only the anchor carries a value`,
    })
  }
  distortion.phoneticRunsExcluded = counter.rPhRunsExcluded
  distortion.ooxmlEscapesRestored = counter.escapesRestored

  const totalDataRows = dataRows.length
  const returnedRows = maxRows === undefined ? dataRows : dataRows.slice(0, maxRows)
  if (returnedRows.length < totalDataRows) {
    warnings.push({
      code: 'xlsx_workbook.rows_truncated',
      message: `sheet ${JSON.stringify(name)}: returned ${returnedRows.length} of ${totalDataRows} data rows (maxRowsPerSheet=${maxRows}); stats and distortion counts still cover the full sheet`,
    })
  }

  const nonEmptyDataRows = dataRows.filter((row) => !row.isEmpty).length
  const stats: XlsxWorkbookSheetStats = {
    totalRows: allRows.length,
    headerRows: headers.length,
    skippedRowsAboveHeader: skippedAbove.length,
    dataRows: totalDataRows,
    nonEmptyDataRows,
    emptyDataRows: totalDataRows - nonEmptyDataRows,
    inferredRowNumbers,
  }
  // Row reconciliation (fail closed): emitted rows must account for every
  // physical row read; empty/non-empty must partition the data rows.
  if (stats.headerRows + stats.skippedRowsAboveHeader + stats.dataRows !== stats.totalRows) {
    fail(`row reconciliation failed in sheet ${JSON.stringify(name)}: ${stats.headerRows} header + ${stats.skippedRowsAboveHeader} skipped + ${stats.dataRows} data != ${stats.totalRows} physical rows`)
  }
  if (stats.nonEmptyDataRows + stats.emptyDataRows !== stats.dataRows) {
    fail(`row reconciliation failed in sheet ${JSON.stringify(name)}: empty/non-empty counts do not partition the data rows`)
  }

  return {
    name,
    state,
    partPath,
    headerRowNumbers: headers.map((row) => row.rowNo),
    headers,
    skippedRowsAboveHeader: skippedAbove,
    rows: returnedRows,
    mergedRanges,
    stats,
    distortion,
  }
}
