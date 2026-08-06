/**
 * parseXlsxWorkbook tests — regression coverage for the legacy-repo XLSX
 * distortion classes (python/openpyxl subprocess pipeline, NOT migrated):
 *
 *  1. hidden/veryHidden sheets were silently parsed with no state ever read
 *     -> here every sheet is parsed AND explicitly labeled via sheet.state;
 *  2. formulas without a cached value silently read as '' with no warning
 *     -> here they read '' with kind 'formula-no-cache', a per-cell warning
 *     and a distortion counter (with/without cached value split);
 *  3. merged-range non-anchor cells read empty and data rows vanished with
 *     no warning -> merged ranges + covered-cell counts are disclosed;
 *  4. <rPh> phonetic runs polluted shared strings (Japanese terms) -> the
 *     shared primitives exclude rPh; the report counts exclusions, values
 *     stay clean (pollution is impossible by construction);
 *  5. row numbers were re-sequenced after dropping empty rows (index+2), so
 *     no rowNo was the physical Excel row -> here rowNo is the physical r
 *     attribute, gaps stay gaps, empty physical rows are kept with isEmpty;
 *  6. rows above the header were dropped with no record -> they are returned
 *     in skippedRowsAboveHeader with values;
 *  7. sampling/truncation was undisclosed -> maxRowsPerSheet truncation is
 *     disclosed in report.sampling (stats still cover the full sheet).
 *
 * Fixtures are minimal synthetic XLSX buffers built in-test with jszip — no
 * real customer files.
 */

import { describe, expect, test } from 'bun:test'
import JSZip from 'jszip'
import { sha256Hex } from '@linguist/cat-core'
import { FormatParseError } from './errors'
import { parseXlsxWorkbook } from './workbook'

// ---------------------------------------------------------------------------
// Fixture builders
// ---------------------------------------------------------------------------

const SHEET_NS = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'

function esc(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

interface TestSheetSpec {
  name: string
  state?: 'hidden' | 'veryHidden'
  /** Worksheet XML text; defaults to a minimal empty worksheet. */
  xml?: string
  /** Override part path + raw content (e.g. a chartsheet part). */
  partPath?: string
  partContent?: string
}

/** Rows as raw XML fragments: [rowNo, cellsXml][]; rowNo null omits the r attr. */
function sheetXml(rows: Array<[number | null, string]>, extra = ''): string {
  const rowsXml = rows
    .map(([rowNo, cells]) => (rowNo === null ? `<row>${cells}</row>` : `<row r="${rowNo}">${cells}</row>`))
    .join('')
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\r\n<worksheet xmlns="${SHEET_NS}">${extra}<sheetData>${rowsXml}</sheetData></worksheet>`
}

function sstXml(entries: string[]): string {
  const sis = entries.map((value) => `<si><t>${esc(value)}</t></si>`).join('')
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\r\n<sst xmlns="${SHEET_NS}" count="${entries.length}" uniqueCount="${entries.length}">${sis}</sst>`
}

/** Shared-string cell by sst index. */
const s = (index: number, col: string, row: number): string => `<c r="${col}${row}" t="s"><v>${index}</v></c>`
/** Shared-string row from sst indexes across columns A, B, C... */
const sRow = (row: number, indexes: number[]): string =>
  indexes.map((index, i) => s(index, String.fromCharCode(65 + i), row)).join('')

interface PackOptions {
  sheets: TestSheetSpec[]
  sharedStringsXml?: string
  /** Drop the rel entry for the 1-based sheet index (structure mismatch). */
  dropRelForSheet?: number
  /** Drop the worksheet part file for the 1-based sheet index. */
  dropPartForSheet?: number
}

async function packWorkbook(options: PackOptions): Promise<Uint8Array> {
  const zip = new JSZip()
  zip.file(
    '[Content_Types].xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\r\n<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/></Types>`,
  )
  zip.file(
    '_rels/.rels',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\r\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
  )
  const sheetsXml = options.sheets
    .map((sheet, index) => {
      const state = sheet.state === undefined ? '' : ` state="${sheet.state}"`
      return `<sheet name="${esc(sheet.name)}" sheetId="${index + 1}"${state} r:id="rId${index + 1}"/>`
    })
    .join('')
  zip.file(
    'xl/workbook.xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\r\n<workbook xmlns="${SHEET_NS}" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${sheetsXml}</sheets></workbook>`,
  )
  const relsXml = options.sheets
    .map((sheet, index) => {
      if (options.dropRelForSheet === index + 1) return ''
      const target = sheet.partPath !== undefined ? sheet.partPath.slice('xl/'.length) : `worksheets/sheet${index + 1}.xml`
      return `<Relationship Id="rId${index + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="${target}"/>`
    })
    .join('')
  zip.file(
    'xl/_rels/workbook.xml.rels',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\r\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${relsXml}</Relationships>`,
  )
  options.sheets.forEach((sheet, index) => {
    if (options.dropPartForSheet === index + 1) return
    const path = sheet.partPath ?? `xl/worksheets/sheet${index + 1}.xml`
    zip.file(path, sheet.partContent ?? sheet.xml ?? sheetXml([]))
  })
  if (options.sharedStringsXml !== undefined) zip.file('xl/sharedStrings.xml', options.sharedStringsXml)
  return zip.generateAsync({ type: 'uint8array' })
}

const HEADER = ['key', 'source', 'target']

/** One visible sheet with a standard 3-column bilingual header. */
async function standardWorkbook(dataRows: Array<[number | null, string]>): Promise<Uint8Array> {
  return packWorkbook({
    sheets: [{ name: 'Main', xml: sheetXml([[1, sRow(1, [0, 1, 2])], ...dataRows]) }],
    sharedStringsXml: sstXml([...HEADER, 'k1', 'Hello', '你好', 'k2', 'World', '世界']),
  })
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('parseXlsxWorkbook 多 sheet 与 sheet_state（失真 1）', () => {
  test('hidden/veryHidden sheet 被解析并显式标注 state，绝不静默跳过', async () => {
    const bytes = await packWorkbook({
      sheets: [
        { name: 'Visible', xml: sheetXml([[1, sRow(1, [0, 1, 2])], [2, sRow(2, [3, 4, 5])]]) },
        { name: 'Hidden', state: 'hidden', xml: sheetXml([[1, sRow(1, [0, 1, 2])], [2, sRow(2, [6, 7, 8])]]) },
        { name: 'VeryHidden', state: 'veryHidden', xml: sheetXml([[1, sRow(1, [0, 1, 2])]]) },
      ],
      sharedStringsXml: sstXml([...HEADER, 'k1', 'Hello', '你好', 'k2', 'Secret', '秘密']),
    })
    const result = await parseXlsxWorkbook(bytes, { filename: 'states.xlsx' })
    expect(result.sheets.map((sheet) => [sheet.name, sheet.state])).toEqual([
      ['Visible', 'visible'],
      ['Hidden', 'hidden'],
      ['VeryHidden', 'veryHidden'],
    ])
    // 隐藏 sheet 的数据真的被读出（不是空壳）
    expect(result.sheets[1]!.rows[0]!.cells.map((cell) => cell.value)).toEqual(['k2', 'Secret', '秘密'])
    expect(result.report.totalSheets).toBe(3)
    expect(result.report.scannedSheets).toBe(3)
    expect(result.report.skippedSheets).toBe(0)
    expect(result.report.sheets.map((entry) => [entry.name, entry.state, entry.status])).toEqual([
      ['Visible', 'visible', 'scanned'],
      ['Hidden', 'hidden', 'scanned'],
      ['VeryHidden', 'veryHidden', 'scanned'],
    ])
    const nonvisible = result.warnings.filter((warning) => warning.code === 'xlsx_workbook.nonvisible_sheet_scanned')
    expect(nonvisible).toHaveLength(2)
  })

  test('非 worksheet part（chartsheet）列入 skippedSheets 并给出原因', async () => {
    const bytes = await packWorkbook({
      sheets: [
        { name: 'Data', xml: sheetXml([[1, sRow(1, [0, 1, 2])], [2, sRow(2, [3, 4, 5])]]) },
        {
          name: 'Chart',
          partPath: 'xl/chartsheets/sheet2.xml',
          partContent: `<?xml version="1.0"?><chartsheet xmlns="${SHEET_NS}"/>`,
        },
      ],
      sharedStringsXml: sstXml([...HEADER, 'k1', 'Hello', '你好']),
    })
    const result = await parseXlsxWorkbook(bytes, { filename: 'chart.xlsx' })
    expect(result.sheets).toHaveLength(1)
    expect(result.skippedSheets).toHaveLength(1)
    expect(result.skippedSheets[0]!.name).toBe('Chart')
    expect(result.skippedSheets[0]!.reason).toContain('not a worksheet')
    expect(result.report.scannedSheets + result.report.skippedSheets).toBe(result.report.totalSheets)
    expect(result.report.consistency.sheetCoverageReconciled).toBe(true)
  })

  test('worksheet part 安全闸不依赖整棵 DOM：实体声明拒绝、非 UTF-8 拒绝（大表根检查只做头部扫描）', async () => {
    // 真实 200MB+ 工作表证明：为看根元素名而构建 xmldom DOM 会把峰值内存
    // 放大十几倍（55MB 文件实测峰值 18GB）。根检查改为头部扫描后，这两条
    // fail-closed 安全闸必须保持：实体声明（实体扩展攻击面）与非 UTF-8。
    const entityBytes = await packWorkbook({
      sheets: [
        {
          name: 'Evil',
          xml: '<?xml version="1.0"?><!DOCTYPE worksheet [<!ENTITY x "boom">]><worksheet xmlns="' + SHEET_NS + '"><sheetData/></worksheet>',
        },
      ],
    })
    await expect(parseXlsxWorkbook(entityBytes, { filename: 'entity.xlsx' })).rejects.toBeInstanceOf(FormatParseError)

    const badUtf8 = await packWorkbook({ sheets: [{ name: 'Bad', xml: sheetXml([[1, sRow(1, [0, 1, 2])]]) }] })
    const zip = await JSZip.loadAsync(badUtf8)
    zip.file('xl/worksheets/sheet1.xml', new Uint8Array([0x3c, 0x3f, 0x78, 0xff, 0xfe, 0x3e])) // 非法 UTF-8
    await expect(parseXlsxWorkbook(await zip.generateAsync({ type: 'uint8array' }), { filename: 'utf8.xlsx' })).rejects.toBeInstanceOf(FormatParseError)
  })
})

describe('parseXlsxWorkbook 公式与错误单元格（失真 2）', () => {
  test('无缓存公式 => 空值 + formula-no-cache + 逐单元格告警；有缓存 => 缓存值', async () => {
    const row2Xml =
      `<c r="A2" t="s"><v>3</v></c>` +
      `<c r="B2"><f>SUM(B9:B10)</f><v>7</v></c>` +
      `<c r="C2"><f>NOW()</f></c>`
    const row3Xml =
      `<c r="A3" t="s"><v>4</v></c>` +
      `<c r="B3" t="e"><v>#DIV/0!</v></c>` +
      `<c r="C3" t="str"><f>CONCAT(A3)</f><v>cached</v></c>`
    const bytes = await packWorkbook({
      sheets: [{ name: 'F', xml: sheetXml([[1, sRow(1, [0, 1, 2])], [2, row2Xml], [3, row3Xml]]) }],
      sharedStringsXml: sstXml([...HEADER, 'k1', 'k2']),
    })
    const result = await parseXlsxWorkbook(bytes, { filename: 'formula.xlsx' })
    const sheet = result.sheets[0]!
    const row2 = sheet.rows[0]!
    expect(row2.rowNo).toBe(2)
    expect(row2.cells[1]).toMatchObject({ ref: 'B2', value: '7', kind: 'formula-cached' })
    expect(row2.cells[2]).toMatchObject({ ref: 'C2', value: '', kind: 'formula-no-cache' })
    const row3 = sheet.rows[1]!
    expect(row3.cells[1]).toMatchObject({ ref: 'B3', value: '', kind: 'error' })
    expect(row3.cells[2]).toMatchObject({ ref: 'C3', value: 'cached', kind: 'formula-cached' })
    expect(sheet.distortion.formulaCells).toBe(3)
    expect(sheet.distortion.formulaCellsWithCachedValue).toBe(2)
    expect(sheet.distortion.formulaCellsWithoutCachedValue).toBe(1)
    expect(sheet.distortion.errorCells).toBe(1)
    const codes = result.warnings.map((warning) => warning.code)
    expect(codes).toContain('xlsx_workbook.formula_no_cached_value')
    expect(codes).toContain('xlsx_workbook.error_cell')
    expect(result.warnings.find((warning) => warning.code === 'xlsx_workbook.formula_no_cached_value')?.message).toContain('C2')
    expect(result.report.distortion.formulaCells).toBe(3)
  })
})

describe('parseXlsxWorkbook 合并单元格（失真 3）', () => {
  test('合并区域披露：非锚点覆盖单元格计数正确，被覆盖单元格读空且有告警', async () => {
    // B2:C3 合并（锚点 B2）：覆盖 B2 之外 3 个单元格；物理行上 C2/B3/C3 读空
    const xml = sheetXml(
      [
        [1, sRow(1, [0, 1, 2])],
        [2, `${s(3, 'A', 2)}${s(4, 'B', 2)}`],
        [3, s(5, 'A', 3)],
      ],
      '<mergeCells count="1"><mergeCell ref="B2:C3"/></mergeCells>',
    )
    const bytes = await packWorkbook({
      sheets: [{ name: 'M', xml }],
      sharedStringsXml: sstXml([...HEADER, 'k1', 'Anchor value', 'k2']),
    })
    const result = await parseXlsxWorkbook(bytes, { filename: 'merged.xlsx' })
    const sheet = result.sheets[0]!
    expect(sheet.mergedRanges).toEqual([{ ref: 'B2:C3', anchor: 'B2', coveredCells: 3 }])
    expect(sheet.distortion.mergedRanges).toBe(1)
    expect(sheet.distortion.mergedCoveredCells).toBe(3)
    // 数据行不消失：行 2/3 都在，物理行号保留；锚点值在 B2
    expect(sheet.rows.map((row) => row.rowNo)).toEqual([2, 3])
    expect(sheet.rows[0]!.cells.find((cell) => cell.ref === 'B2')?.value).toBe('Anchor value')
    expect(result.warnings.map((warning) => warning.code)).toContain('xlsx_workbook.merged_cells')
  })
})

describe('parseXlsxWorkbook rPh 拼音注音与 _xHHHH_ 还原（失真 4）', () => {
  test('共享字符串中的 U+2028/U+2029 行分隔符按原样保留，不得被归一化为 LF（真实文件失真）', async () => {
    // 真实导出文件把游戏文本的软换行写成字面 U+2028；XML 1.0 只归一化
    // #xD/#xD#xA，U+2028/U+2029 是必须保留的合法字符。旧实现经 xmldom 读
    // sst，U+2028 被悄悄改成 U+000A —— 译文行分隔语义被改写。
    const sharedStringsXml =
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\r\n<sst xmlns="${SHEET_NS}" count="6" uniqueCount="6">` +
      '<si><t>key</t></si><si><t>source</t></si><si><t>target</t></si>' +
      '<si><t>k1</t></si>' +
      '<si><t>第一行\u2028第二行</t></si>' +
      '<si><r><t>甲</t></r><r><t>\u2029乙</t></r></si>' +
      '</sst>'
    const bytes = await packWorkbook({
      sheets: [
        {
          name: 'Soft',
          xml: sheetXml([
            [1, sRow(1, [0, 1, 2])],
            [2, `${s(3, 'A', 2)}${s(4, 'B', 2)}<c r="C2" t="inlineStr"><is><t>内联\u2028分隔</t></is></c>`],
            [3, sRow(3, [3, 5, 5])],
          ]),
        },
      ],
      sharedStringsXml,
    })
    const result = await parseXlsxWorkbook(bytes, { filename: 'softbreak.xlsx' })
    const rows = result.sheets[0]!.rows
    // sst 简单 <t> 条目：字面 U+2028 必须原样保留
    expect(rows[0]!.cells[1]!.value).toBe('第一行\u2028第二行')
    // sst 富文本 run 拼接：字面 U+2029 同样保留
    expect(rows[1]!.cells[1]!.value).toBe('甲\u2029乙')
    // 工作表 inlineStr 路径（raw 切片）一直是正确的，两侧必须一致
    expect(rows[0]!.cells[2]!.value).toBe('内联\u2028分隔')
  })

  test('XML 行尾归一化：字面 CR/CRLF 归为 LF；&#xD; 引用还原为 CR（真实文件失真回归）', async () => {
    // 真实文件（WPS 等写出）把单元格内换行存成 <t> 文本里的字面 0D 0A。
    // XML 1.0 §2.11：字面行尾必须归一化为 LF（Excel/ET/xmldom 均如此）；
    // 而以 &#xD; 字符引用写入的 CR 是有意内容，归一化之后再解码，必须保留。
    const sharedStringsXml =
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\r\n<sst xmlns="${SHEET_NS}" count="7" uniqueCount="7">` +
      '<si><t>key</t></si><si><t>source</t></si><si><t>target</t></si>' +
      '<si><t>k1</t></si>' +
      '<si><t>甲行\r\n乙行</t></si>' + // 字面 CRLF => \n
      '<si><t>丙行\r丁行</t></si>' + // 字面 lone CR => \n
      '<si><t>戊行&#xD;己行</t></si>' + // 有意 CR（引用） => 保留 \r
      '</sst>'
    const bytes = await packWorkbook({
      sheets: [
        {
          name: 'EOL',
          xml: sheetXml([
            [1, sRow(1, [0, 1, 2])],
            [2, `${s(3, 'A', 2)}${s(4, 'B', 2)}<c r="C2" t="inlineStr"><is><t>内联\r\n换行</t></is></c>`],
            [3, sRow(3, [3, 5, 6])],
          ]),
        },
      ],
      sharedStringsXml,
    })
    const result = await parseXlsxWorkbook(bytes, { filename: 'eol.xlsx' })
    const rows = result.sheets[0]!.rows
    expect(rows[0]!.cells[1]!.value).toBe('甲行\n乙行') // sst 字面 CRLF
    expect(rows[1]!.cells[1]!.value).toBe('丙行\n丁行') // sst 字面 lone CR
    expect(rows[1]!.cells[2]!.value).toBe('戊行\r己行') // sst &#xD; 引用
    expect(rows[0]!.cells[2]!.value).toBe('内联\n换行') // 工作表 inlineStr 同规则
  })

  test('<rPh> 不污染日文术语；还原/排除计数进入报告', async () => {
    const sharedStringsXml =
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\r\n<sst xmlns="${SHEET_NS}" count="5" uniqueCount="5">` +
      '<si><t>key</t></si><si><t>source</t></si><si><t>target</t></si>' +
      '<si><r><t>漢</t></r><rPh sb="0" eb="1"><t>かん</t></rPh><r><t>字</t></r></si>' +
      '<si><t>制御_x000B_文字</t></si>' +
      '</sst>'
    const bytes = await packWorkbook({
      sheets: [{ name: 'JP', xml: sheetXml([[1, sRow(1, [0, 1, 2])], [2, sRow(2, [3, 4, 4])]]) }],
      sharedStringsXml,
    })
    const result = await parseXlsxWorkbook(bytes, { filename: 'rph.xlsx' })
    const sheet = result.sheets[0]!
    const dataRow = sheet.rows[0]!
    // 回归保证：拼音 'かん' 绝不进入值（老仓 raw 引擎污染源）
    expect(dataRow.cells[0]!.value).toBe('漢字')
    // _x000B_ 控制字符转义被还原
    expect(dataRow.cells[1]!.value).toBe('制御\x0B文字')
    expect(sheet.distortion.phoneticRunsExcluded).toBe(1)
    expect(sheet.distortion.ooxmlEscapesRestored).toBe(2) // 两个单元格引用同一条目，各计一次
    expect(result.report.sharedStrings.entriesWithPhoneticRuns).toBe(1)
    expect(result.report.sharedStrings.entriesWithEscapes).toBe(1)
  })
})

describe('parseXlsxWorkbook 物理行号与表头上方跳过行（失真 5/6）', () => {
  test('rowNo = 物理 Excel 行号：空行不重编号、缺行保持空洞、空物理行 isEmpty 保留', async () => {
    const bytes = await packWorkbook({
      sheets: [
        {
          name: 'Rows',
          xml: sheetXml([
            [1, sRow(1, [0, 1, 2])],
            [2, sRow(2, [3, 4, 5])],
            // 物理行 3/4 在 XML 中完全缺失 => rowNo 2 之后直接是 5
            [5, ''],
            [6, sRow(6, [6, 7, 8])],
          ]),
        },
      ],
      sharedStringsXml: sstXml([...HEADER, 'k1', 'Hello', '你好', 'k2', 'World', '世界']),
    })
    const result = await parseXlsxWorkbook(bytes, { filename: 'rows.xlsx' })
    const sheet = result.sheets[0]!
    expect(sheet.headerRowNumbers).toEqual([1])
    expect(sheet.rows.map((row) => row.rowNo)).toEqual([2, 5, 6])
    expect(sheet.rows[0]!.isEmpty).toBe(false)
    expect(sheet.rows[1]!.isEmpty).toBe(true) // 空物理行保留，不被重编号吞掉
    expect(sheet.rows[2]!.cells.map((cell) => cell.value)).toEqual(['k2', 'World', '世界'])
    expect(sheet.stats.totalRows).toBe(4)
    expect(sheet.stats.dataRows).toBe(3)
    expect(sheet.stats.emptyDataRows).toBe(1)
    expect(sheet.stats.nonEmptyDataRows).toBe(2)
    expect(result.report.rowNumberSemantics).toBe('physical-excel-row-number')
  })

  test('表头上方有内容的行全部进入 skippedRowsAboveHeader（含值，绝不静默丢弃）', async () => {
    const bytes = await packWorkbook({
      sheets: [
        {
          name: 'Meta',
          xml: sheetXml([
            [1, sRow(1, [3, 4])], // 导出工具写的标题行
            [2, sRow(2, [5, 6])], // 导出时间戳行
            [4, sRow(4, [0, 1, 2])], // 真正的表头在物理第 4 行
            [5, sRow(5, [7, 8, 9])],
          ]),
        },
      ],
      sharedStringsXml: sstXml([...HEADER, 'TM Export', '2026-08-01', 'generated by', 'legacy-tool', 'k1', 'Hello', '你好']),
    })
    // 调用方已知版式 => headerRowNo 钉住物理表头行
    const result = await parseXlsxWorkbook(bytes, { filename: 'meta.xlsx', headerRowNo: 4 })
    const sheet = result.sheets[0]!
    expect(sheet.headerRowNumbers).toEqual([4])
    expect(sheet.headers).toHaveLength(1)
    expect(sheet.headers[0]!.cells.map((cell) => cell.value)).toEqual(HEADER)
    expect(sheet.skippedRowsAboveHeader.map((row) => row.rowNo)).toEqual([1, 2])
    expect(sheet.skippedRowsAboveHeader[0]!.cells.map((cell) => cell.value)).toEqual(['TM Export', '2026-08-01'])
    expect(sheet.skippedRowsAboveHeader[1]!.cells.map((cell) => cell.value)).toEqual(['generated by', 'legacy-tool'])
    expect(sheet.stats.skippedRowsAboveHeader).toBe(2)
    expect(sheet.rows.map((row) => row.rowNo)).toEqual([5])
    expect(result.report.totals.skippedRowsAboveHeader).toBe(2)
  })

  test('多表头：headerRowCount=2 时表头块两行，物理行号披露', async () => {
    const bytes = await packWorkbook({
      sheets: [
        {
          name: 'TwoHeader',
          xml: sheetXml([
            [1, sRow(1, [3, 4, 5])], // 组表头（Group / EN / ZH 之类）
            [2, sRow(2, [0, 1, 2])], // 列表头
            [3, sRow(3, [6, 7, 8])],
          ]),
        },
      ],
      sharedStringsXml: sstXml([...HEADER, 'Grp', 'EN', 'ZH', 'k1', 'Hello', '你好']),
    })
    const result = await parseXlsxWorkbook(bytes, { filename: 'two.xlsx', headerRowCount: 2 })
    const sheet = result.sheets[0]!
    expect(sheet.headerRowNumbers).toEqual([1, 2])
    expect(sheet.headers).toHaveLength(2)
    expect(sheet.stats.headerRows).toBe(2)
    expect(sheet.rows.map((row) => row.rowNo)).toEqual([3])
  })
})

describe('parseXlsxWorkbook 采样/截断披露（失真 7）', () => {
  test('maxRowsPerSheet 截断 payload 但统计仍覆盖全表，报告披露截断范围', async () => {
    const bytes = await standardWorkbook([
      [2, sRow(2, [3, 4, 5])],
      [3, sRow(3, [6, 7, 8])],
      [4, sRow(4, [3, 4, 5])],
    ])
    const result = await parseXlsxWorkbook(bytes, { filename: 'sample.xlsx', maxRowsPerSheet: 2 })
    const sheet = result.sheets[0]!
    expect(sheet.rows.map((row) => row.rowNo)).toEqual([2, 3])
    expect(sheet.stats.dataRows).toBe(3) // 统计覆盖全表
    expect(result.report.sampling.maxRowsPerSheet).toBe(2)
    expect(result.report.sampling.truncatedSheets).toEqual([{ sheet: 'Main', returnedRows: 2, totalDataRows: 3 }])
    expect(result.warnings.map((warning) => warning.code)).toContain('xlsx_workbook.rows_truncated')
  })

  test('无截断时 sampling.maxRowsPerSheet 为 null、truncatedSheets 为空', async () => {
    const result = await parseXlsxWorkbook(await standardWorkbook([[2, sRow(2, [3, 4, 5])]]), { filename: 'full.xlsx' })
    expect(result.report.sampling.maxRowsPerSheet).toBeNull()
    expect(result.report.sampling.truncatedSheets).toEqual([])
  })
})

describe('parseXlsxWorkbook Verification Report 字段', () => {
  test('sourceSha256/parser/行号语义/一致性声明/汇总统计', async () => {
    const bytes = await standardWorkbook([
      [2, sRow(2, [3, 4, 5])],
      [3, ''],
      [4, sRow(4, [6, 7, 8])],
    ])
    const result = await parseXlsxWorkbook(bytes, { filename: 'report.xlsx' })
    const report = result.report
    expect(report.sourceSha256).toBe(sha256Hex(bytes))
    expect(report.parserId).toBe('xlsx_workbook')
    expect(report.parserVersion).toBe(1)
    expect(report.rowNumberSemantics).toBe('physical-excel-row-number')
    expect(report.consistency).toEqual({ rowsReconciled: true, sheetCoverageReconciled: true })
    expect(report.totals.rows).toBe(4)
    expect(report.totals.headerRows).toBe(1)
    expect(report.totals.dataRows).toBe(3)
    expect(report.totals.emptyDataRows).toBe(1)
    expect(report.totals.cells).toBe(9)
    expect(report.sharedStrings.entries).toBe(9)
  })
})

describe('parseXlsxWorkbook 损坏输入 fail closed（typed errors，无部分数据）', () => {
  test('非 zip / 坏 zip / 缺 workbook.xml / 缺 rels / 缺 sheet part / rel 对账不一致 / 坏 XML => FormatParseError', async () => {
    const cases: Array<[string, Uint8Array]> = [
      ['empty.xlsx', new Uint8Array(0)],
      ['notzip.xlsx', new TextEncoder().encode('key,source\na,Hello\n')],
      ['broken.xlsx', new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0, 0, 0])],
      // zip 但没有 xl/workbook.xml
      ['nowb.xlsx', await new JSZip().file('xl/worksheets/sheet1.xml', '<worksheet/>').generateAsync({ type: 'uint8array' })],
      // workbook.xml 是坏 XML
      [
        'badxml.xlsx',
        await packWorkbook({ sheets: [{ name: 'S' }] }).then(async (bytes) => {
          const zip = await JSZip.loadAsync(bytes)
          zip.file('xl/workbook.xml', '<workbook><sheets>')
          return zip.generateAsync({ type: 'uint8array' })
        }),
      ],
      // rels 中缺 sheet 的 relationship（workbook 结构与 rels 对账不一致）
      ['missing-rel.xlsx', await packWorkbook({ sheets: [{ name: 'S' }], dropRelForSheet: 1 })],
      // rels 指向的 part 不存在（workbook 结构与包内容对账不一致）
      ['missing-part.xlsx', await packWorkbook({ sheets: [{ name: 'S' }], dropPartForSheet: 1 })],
    ]
    for (const [filename, bytes] of cases) {
      let caught: unknown
      try {
        await parseXlsxWorkbook(bytes, { filename })
      } catch (err) {
        caught = err
      }
      expect(caught, filename).toBeInstanceOf(FormatParseError)
      expect((caught as FormatParseError).code).toBe('FORMAT_PARSE_ERROR')
      expect((caught as FormatParseError).adapterId).toBe('xlsx_workbook')
    }
  })

  test('内部一致性：重复物理行号 / 非法单元格引用 / 非法合并引用 => FormatParseError', async () => {
    const dupRow = await packWorkbook({
      sheets: [
        {
          name: 'S',
          xml: sheetXml([
            [1, sRow(1, [0, 1, 2])],
            [2, sRow(2, [3, 4, 5])],
            [2, sRow(2, [3, 4, 5])],
          ]),
        },
      ],
      sharedStringsXml: sstXml([...HEADER, 'k1', 'Hello', '你好']),
    })
    await expect(parseXlsxWorkbook(dupRow, { filename: 'dup.xlsx' })).rejects.toBeInstanceOf(FormatParseError)

    const badCellRef = await packWorkbook({
      sheets: [{ name: 'S', xml: sheetXml([[1, sRow(1, [0, 1, 2])], [2, '<c r="R1C1"><v>9</v></c>']]) }],
      sharedStringsXml: sstXml(HEADER),
    })
    await expect(parseXlsxWorkbook(badCellRef, { filename: 'badref.xlsx' })).rejects.toBeInstanceOf(FormatParseError)

    const badMerge = await packWorkbook({
      sheets: [
        {
          name: 'S',
          xml: sheetXml([[1, sRow(1, [0, 1, 2])], [2, sRow(2, [3, 4, 5])]], '<mergeCells count="1"><mergeCell ref="B2"/></mergeCells>'),
        },
      ],
      sharedStringsXml: sstXml([...HEADER, 'k1', 'Hello', '你好']),
    })
    await expect(parseXlsxWorkbook(badMerge, { filename: 'badmerge.xlsx' })).rejects.toBeInstanceOf(FormatParseError)

    // headerRowCount 超过可用行数 => 结构对账失败
    const tooManyHeaders = await standardWorkbook([[2, sRow(2, [3, 4, 5])]])
    await expect(parseXlsxWorkbook(tooManyHeaders, { filename: 'hdr.xlsx', headerRowCount: 5 })).rejects.toBeInstanceOf(FormatParseError)

    // headerRowNo 指向不存在的物理行 => 结构对账失败
    await expect(parseXlsxWorkbook(tooManyHeaders, { filename: 'hdrno.xlsx', headerRowNo: 99 })).rejects.toBeInstanceOf(FormatParseError)
  })

  test('非法选项（headerRowCount/headerRowNo/maxRowsPerSheet 非正整数）=> FormatParseError', async () => {
    const bytes = await standardWorkbook([[2, sRow(2, [3, 4, 5])]])
    await expect(parseXlsxWorkbook(bytes, { headerRowCount: 0 })).rejects.toBeInstanceOf(FormatParseError)
    await expect(parseXlsxWorkbook(bytes, { headerRowNo: 0 })).rejects.toBeInstanceOf(FormatParseError)
    await expect(parseXlsxWorkbook(bytes, { maxRowsPerSheet: -1 })).rejects.toBeInstanceOf(FormatParseError)
  })
})
