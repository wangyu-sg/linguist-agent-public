/**
 * XlsxAdapter tests (PB-081).
 *
 * Fixtures are built in-test with jszip — self-contained, no binary files
 * under tests/linguist-fixtures/. buildSheetXml renders sheetML rows/cells,
 * packXlsx assembles the OOXML zip parts (content types, rels, workbook,
 * worksheets, sharedStrings); a few tests hand-write raw XML where the
 * builder cannot express the shape (rich text runs, empty rows).
 */

import { describe, expect, test } from 'bun:test'
import JSZip from 'jszip'
import { createAsset, createProject, createSeededEntropy } from '@linguist/cat-core'
import { bindImportedSegments, FormatExportError, FormatParseError } from '../index'
import { assertRoundTrip } from '../testing/index'
import { XlsxAdapter } from './xlsx'

// ---------------------------------------------------------------------------
// Fixture builders
// ---------------------------------------------------------------------------

type TestCell =
  | { s: string } // shared string (registered in the sst table)
  | { inline: string } // t="inlineStr"
  | { n: string | number } // numeric <v>
  | { str: string } // t="str" cached formula string
  | { b: boolean } // t="b"
  | { e: string } // t="e" error cell
  | { f: string; v?: string | number } // formula with optional cached value
  | { empty: true } // self-closing <c/>
  | null // no cell emitted at this position (sparse row)

interface SstRegistry {
  values: string[]
  index: Map<string, number>
}

function newSst(): SstRegistry {
  return { values: [], index: new Map() }
}

function sstIndex(registry: SstRegistry, value: string): number {
  const existing = registry.index.get(value)
  if (existing !== undefined) return existing
  const next = registry.values.length
  registry.values.push(value)
  registry.index.set(value, next)
  return next
}

function esc(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function colName(index: number): string {
  let remaining = index + 1
  let letters = ''
  while (remaining > 0) {
    letters = String.fromCharCode(65 + ((remaining - 1) % 26)) + letters
    remaining = Math.floor((remaining - 1) / 26)
  }
  return letters
}

const SHEET_NS = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'

function buildSheetXml(rows: TestCell[][], sst: SstRegistry): string {
  const rowsXml = rows
    .map((cells, rowIndex) => {
      const cellsXml = cells
        .map((cell, colIndex) => {
          if (cell === null) return ''
          const ref = `${colName(colIndex)}${rowIndex + 1}`
          if ('s' in cell) return `<c r="${ref}" t="s"><v>${sstIndex(sst, cell.s)}</v></c>`
          if ('inline' in cell) return `<c r="${ref}" t="inlineStr"><is><t>${esc(cell.inline)}</t></is></c>`
          if ('n' in cell) return `<c r="${ref}"><v>${cell.n}</v></c>`
          if ('str' in cell) return `<c r="${ref}" t="str"><v>${esc(cell.str)}</v></c>`
          if ('b' in cell) return `<c r="${ref}" t="b"><v>${cell.b ? 1 : 0}</v></c>`
          if ('e' in cell) return `<c r="${ref}" t="e"><v>${cell.e}</v></c>`
          if ('empty' in cell) return `<c r="${ref}"/>`
          const cached = cell.v === undefined ? '' : `<v>${cell.v}</v>`
          return `<c r="${ref}"><f>${esc(cell.f)}</f>${cached}</c>`
        })
        .join('')
      return `<row r="${rowIndex + 1}">${cellsXml}</row>`
    })
    .join('')
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\r\n<worksheet xmlns="${SHEET_NS}"><sheetData>${rowsXml}</sheetData></worksheet>`
}

function buildSstXml(values: string[]): string {
  const sis = values.map((value) => `<si><t>${esc(value)}</t></si>`).join('')
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\r\n<sst xmlns="${SHEET_NS}" count="${values.length}" uniqueCount="${values.length}">${sis}</sst>`
}

interface PackXlsxOptions {
  sheets: Array<{ name: string; xml: string }>
  sharedStringsXml?: string
  extra?: Record<string, string>
}

async function packXlsx(options: PackXlsxOptions): Promise<Uint8Array> {
  const zip = new JSZip()
  const sheetOverrides = options.sheets
    .map(
      (_, index) =>
        `<Override PartName="/xl/worksheets/sheet${index + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`,
    )
    .join('')
  const sstOverride =
    options.sharedStringsXml === undefined
      ? ''
      : '<Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/>'
  zip.file(
    '[Content_Types].xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\r\n<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>${sheetOverrides}${sstOverride}</Types>`,
  )
  zip.file(
    '_rels/.rels',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\r\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
  )
  const sheetsXml = options.sheets
    .map((sheet, index) => `<sheet name="${esc(sheet.name)}" sheetId="${index + 1}" r:id="rId${index + 1}"/>`)
    .join('')
  zip.file(
    'xl/workbook.xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\r\n<workbook xmlns="${SHEET_NS}" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${sheetsXml}</sheets></workbook>`,
  )
  const relsXml = options.sheets
    .map(
      (_, index) =>
        `<Relationship Id="rId${index + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${index + 1}.xml"/>`,
    )
    .join('')
  zip.file(
    'xl/_rels/workbook.xml.rels',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\r\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${relsXml}</Relationships>`,
  )
  options.sheets.forEach((sheet, index) => zip.file(`xl/worksheets/sheet${index + 1}.xml`, sheet.xml))
  if (options.sharedStringsXml !== undefined) zip.file('xl/sharedStrings.xml', options.sharedStringsXml)
  for (const [path, content] of Object.entries(options.extra ?? {})) zip.file(path, content)
  return zip.generateAsync({ type: 'uint8array' })
}

/** One-sheet workbook whose cells are all shared strings; null = sparse (no cell). */
async function simpleXlsx(rows: Array<Array<string | null>>, options: { extra?: Record<string, string> } = {}): Promise<Uint8Array> {
  const sst = newSst()
  const xml = buildSheetXml(
    rows.map((row) => row.map((value) => (value === null ? null : { s: value }))),
    sst,
  )
  return packXlsx({ sheets: [{ name: 'Sheet1', xml }], sharedStringsXml: buildSstXml(sst.values), extra: options.extra })
}

async function entryBytes(zip: Uint8Array, path: string): Promise<Uint8Array> {
  const entry = (await JSZip.loadAsync(zip)).file(path)
  if (entry === null) throw new Error(`test zip is missing entry ${path}`)
  return entry.async('uint8array')
}

async function entryText(zip: Uint8Array, path: string): Promise<string> {
  return new TextDecoder().decode(await entryBytes(zip, path))
}

// ---------------------------------------------------------------------------
// Import/export helpers (same shape as csv.test.ts)
// ---------------------------------------------------------------------------

async function importBytes(bytes: Uint8Array, filename: string, adapter = new XlsxAdapter()) {
  return adapter.import({ bytes, filename, sourceLocale: 'en-US', targetLocale: 'zh-CN' })
}

const NOW = '2026-01-01T00:00:00.000Z'

/** Binds imported segments to a deterministic asset (same pattern as the harness). */
async function boundSegments(name: string, imported: Awaited<ReturnType<XlsxAdapter['import']>>) {
  const project = createProject(
    { name: 'xlsx-test', sourceLocale: 'en-US', targetLocale: 'zh-CN', promaWorkspaceId: 'xlsx-test' },
    { entropy: createSeededEntropy(`xlsx-test:${name}`), now: NOW },
  )
  const asset = createAsset({
    projectId: project.id,
    formatId: imported.asset.formatId,
    originalFilename: name,
    sourceSha256: imported.asset.sourceSha256,
    segmentCount: imported.asset.segmentCount,
    ...(imported.asset.formatConfigJson === undefined
      ? {}
      : { formatConfigJson: imported.asset.formatConfigJson }),
  })
  return { asset, segments: bindImportedSegments(imported.segments, asset.id) }
}

/** Game-dialogue flavored workbook: quoted CJK, multiline source, locked row. */
async function miniDialogueXlsx(options: { extra?: Record<string, string> } = {}): Promise<Uint8Array> {
  return simpleXlsx(
    [
      ['key', 'source', 'target', 'locked', 'context'],
      ['dlg.guard.gate', 'Halt! State your business, traveler.', '站住！说明你的来意，旅人。', '', 'Gate guard opening line'],
      ['dlg.arya.intro', "I'm Arya, a traveling merchant.\nNice to meet you.", '我是阿雅，一名旅行商人。\n很高兴认识你。', '', ''],
      ['dlg.guard.bribe', 'A bribe? How dare you!', '', '', ''],
      ['legal.eula', '© 2026 Fictional Studio. All rights reserved.', '© 2026 虚构工作室。保留所有权利。', 'yes', 'Locked legal string'],
    ],
    options,
  )
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('XlsxAdapter detect', () => {
  test('真 xlsx + .xlsx => 0.9；改名 => 0.5；无 workbook 的 zip / 非 zip / 假 xlsx => 0', async () => {
    const adapter = new XlsxAdapter()
    const real = await miniDialogueXlsx()
    expect(await adapter.detect(real, 'mini.xlsx')).toBe(0.9)
    expect(await adapter.detect(real, 'renamed.bin')).toBe(0.5)
    // 非 zip 字节（CSV 内容伪装 .xlsx）
    const fake = new TextEncoder().encode('key,source,target\na,Hello,你好\n')
    expect(await adapter.detect(fake, 'fake.xlsx')).toBe(0)
    // zip 但没有 xl/workbook.xml
    const plainZip = await new JSZip().file('hello.txt', 'hi').generateAsync({ type: 'uint8array' })
    expect(await adapter.detect(plainZip, 'archive.xlsx')).toBe(0)
    // PK 魔数但内容损坏
    expect(await adapter.detect(new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0, 0, 0]), 'broken.xlsx')).toBe(0)
    expect(await adapter.detect(new Uint8Array(0), 'empty.xlsx')).toBe(0)
  })
})

describe('XlsxAdapter import（表头映射/单元格类型/锁定/合成 key）', () => {
  test('默认列映射：key/source/target/locked/context；空 target => untranslated；locked 行', async () => {
    const imported = await importBytes(await miniDialogueXlsx(), 'mini.xlsx')
    expect(imported.asset.formatId).toBe('xlsx_ooxml')
    expect(imported.asset.segmentCount).toBe(4)
    expect(imported.segments.map((s) => s.ordinal)).toEqual([0, 1, 2, 3])
    expect(imported.warnings).toHaveLength(0)

    const byKey = new Map(imported.segments.map((s) => [s.key, s]))
    expect(byKey.get('dlg.guard.gate')?.source).toBe('Halt! State your business, traveler.')
    expect(byKey.get('dlg.guard.gate')?.target).toBe('站住！说明你的来意，旅人。')
    expect(byKey.get('dlg.guard.gate')?.status).toBe('translated')
    expect(byKey.get('dlg.guard.gate')?.context?.note).toBe('Gate guard opening line')
    // sharedStrings 里的换行原样保留
    expect(byKey.get('dlg.arya.intro')?.source).toBe("I'm Arya, a traveling merchant.\nNice to meet you.")
    expect(byKey.get('dlg.guard.bribe')?.target).toBe('')
    expect(byKey.get('dlg.guard.bribe')?.status).toBe('untranslated')
    const eula = byKey.get('legal.eula')
    expect(eula?.locked).toBe(true)
    expect(eula?.target).toBe('© 2026 虚构工作室。保留所有权利。')
  })

  test('中文别名表头与表头规范化（唯一键/Source Text/译文/锁定/备注）', async () => {
    const bytes = await simpleXlsx([
      ['唯一键', 'Source Text', '译文', '锁定', '备注'],
      ['u1', 'Hello world', '你好世界', '1', 'greeting'],
      ['u2', 'Bye', '再见', 'no', ''],
    ])
    const imported = await importBytes(bytes, 'cn.xlsx')
    const byKey = new Map(imported.segments.map((s) => [s.key, s]))
    expect(byKey.get('u1')?.source).toBe('Hello world')
    expect(byKey.get('u1')?.target).toBe('你好世界')
    expect(byKey.get('u1')?.locked).toBe(true)
    expect(byKey.get('u1')?.context?.note).toBe('greeting')
    expect(byKey.get('u2')?.locked).toBe(false)
  })

  test('显式列映射覆盖别名；映射名不在表头 => FormatParseError', async () => {
    const bytes = await simpleXlsx([
      ['UniqueKey', 'ZH', 'EN', 'Lock'],
      ['u1', '你好', 'Hello', 'yes'],
    ])
    const adapter = new XlsxAdapter({ columns: { key: 'UniqueKey', source: 'ZH', target: 'EN', locked: 'Lock' } })
    const imported = await importBytes(bytes, 'explicit.xlsx', adapter)
    expect(imported.segments[0]?.source).toBe('你好')
    expect(imported.segments[0]?.target).toBe('Hello')
    expect(imported.segments[0]?.locked).toBe(true)

    const bad = new XlsxAdapter({ columns: { source: 'does_not_exist' } })
    await expect(importBytes(bytes, 'explicit.xlsx', bad)).rejects.toBeInstanceOf(FormatParseError)
  })

  test('显式映射可选择非首个工作表，非标准表头不会退回首表', async () => {
    const sst = newSst()
    const first = buildSheetXml([
      [{ s: '说明' }],
      [{ s: '这个工作表不是翻译批次' }],
    ], sst)
    const selected = buildSheetXml([
      [{ s: '文本编号' }, { s: '中文原文' }, { s: '英文译文' }, { s: '备注' }],
      [{ s: 'ui.start' }, { s: '开始游戏' }, { s: 'Start' }, { s: '主菜单' }],
    ], sst)
    const bytes = await packXlsx({
      sheets: [{ name: '说明', xml: first }, { name: '本地化', xml: selected }],
      sharedStringsXml: buildSstXml(sst.values),
    })

    const adapter = new XlsxAdapter({
      sheetName: '本地化',
      columns: { key: '文本编号', source: '中文原文', target: '英文译文', context: '备注' },
    })
    const imported = await importBytes(bytes, 'non-standard.xlsx', adapter)

    expect(imported.segments).toHaveLength(1)
    expect(imported.asset.formatConfigJson).toBe(JSON.stringify({
      version: 1,
      sheetName: '本地化',
      columns: { key: '文本编号', source: '中文原文', target: '英文译文', context: '备注' },
    }))
    expect(imported.segments[0]).toMatchObject({
      key: 'ui.start',
      source: '开始游戏',
      target: 'Start',
      context: { note: '主菜单' },
    })
  })

  test('单元格类型：inlineStr / 数字 <v> / str / 布尔 / 错误 / 公式缓存值（含 warning）', async () => {
    const sst = newSst()
    const xml = buildSheetXml(
      [
        [{ s: 'key' }, { s: 'source' }, { s: 'target' }],
        [{ s: 'c.inline' }, { inline: 'Inline source' }, { inline: '内联译文' }],
        [{ s: 'c.number' }, { n: 42 }, { n: '3.14' }],
        [{ s: 'c.str' }, { str: 'Formula result' }, { s: 'ok' }],
        [{ s: 'c.bool' }, { b: true }, { b: false }],
        [{ s: 'c.err' }, { e: '#DIV/0!' }, { s: 'x' }],
        [{ s: 'c.formula' }, { f: 'SUM(B3:B4)', v: 7 }, { s: 'y' }],
        [{ s: 'c.nocache' }, { f: 'NOW()' }, { s: 'z' }],
      ],
      sst,
    )
    const imported = await importBytes(await packXlsx({ sheets: [{ name: 'Sheet1', xml }], sharedStringsXml: buildSstXml(sst.values) }), 'types.xlsx')
    const byKey = new Map(imported.segments.map((s) => [s.key, s]))
    expect(byKey.get('c.inline')?.source).toBe('Inline source')
    expect(byKey.get('c.inline')?.target).toBe('内联译文')
    // 数字按存储文本读取（不做数字/日期格式化）
    expect(byKey.get('c.number')?.source).toBe('42')
    expect(byKey.get('c.number')?.target).toBe('3.14')
    expect(byKey.get('c.str')?.source).toBe('Formula result')
    // 布尔按 TRUE/FALSE 读取
    expect(byKey.get('c.bool')?.source).toBe('TRUE')
    expect(byKey.get('c.bool')?.target).toBe('FALSE')
    // 错误单元格 => '' + warning；公式只读缓存值；无缓存 => '' + warning
    expect(byKey.get('c.err')?.source).toBe('')
    expect(byKey.get('c.formula')?.source).toBe('7')
    expect(byKey.get('c.nocache')?.source).toBe('')
    const codes = imported.warnings.map((w) => w.code)
    expect(codes).toContain('xlsx.error_cell')
    expect(codes).toContain('xlsx.formula_no_cached_value')
    expect(imported.warnings.find((w) => w.code === 'xlsx.error_cell')?.segmentKey).toBe('c.err')
    expect(imported.warnings.find((w) => w.code === 'xlsx.formula_no_cached_value')?.segmentKey).toBe('c.nocache')
  })

  test('sharedStrings：实体解码、富文本 run 拼接、<rPh> 拼音 run 排除', async () => {
    const sharedStringsXml =
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\r\n<sst xmlns="${SHEET_NS}" count="6" uniqueCount="6">` +
      '<si><t>key</t></si><si><t>source</t></si><si><t>target</t></si>' +
      '<si><t>Tom &amp; Jerry &lt;3</t></si>' +
      '<si><r><t>你好</t></r><r><t>世界</t></r></si>' +
      '<si><t>汉</t><rPh sb="0" eb="1"><t>han</t></rPh><t>字</t></si>' +
      '</sst>'
    const sheetXml =
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\r\n<worksheet xmlns="${SHEET_NS}"><sheetData>` +
      '<row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c><c r="C1" t="s"><v>2</v></c></row>' +
      '<row r="2"><c r="A2" t="s"><v>3</v></c><c r="B2" t="s"><v>4</v></c><c r="C2" t="s"><v>5</v></c></row>' +
      '</sheetData></worksheet>'
    const bytes = await packXlsx({ sheets: [{ name: 'Sheet1', xml: sheetXml }], sharedStringsXml })
    const imported = await importBytes(bytes, 'rich.xlsx')
    expect(imported.segments).toHaveLength(1)
    const segment = imported.segments[0]!
    expect(segment.key).toBe('Tom & Jerry <3') // 实体已解码
    expect(segment.source).toBe('你好世界') // 富文本 run 拼接
    expect(segment.target).toBe('汉字') // 拼音 run 不进文本
  })

  test('缺 key 列 => 合成 #row-<ordinal> + warning；key 单元格为空 => 同款', async () => {
    const noKey = await importBytes(
      await simpleXlsx([
        ['source', 'target'],
        ['Hello', '你好'],
        ['World', '世界'],
      ]),
      'nokey.xlsx',
    )
    expect(noKey.segments.map((s) => s.key)).toEqual(['#row-0', '#row-1'])
    expect(noKey.warnings).toHaveLength(1)
    expect(noKey.warnings[0]?.code).toBe('xlsx.synthesized_key')

    const emptyKey = await importBytes(
      await simpleXlsx([
        ['key', 'source'],
        ['', 'Hello'],
        ['k2', 'World'],
      ]),
      'emptykey.xlsx',
    )
    expect(emptyKey.segments.map((s) => s.key)).toEqual(['#row-0', 'k2'])
    expect(emptyKey.warnings[0]?.code).toBe('xlsx.synthesized_key')
    expect(emptyKey.warnings[0]?.segmentKey).toBe('#row-0')
  })

  test('全空单元格的行与自闭合空行像 CSV 空行一样被跳过', async () => {
    const sheetXml =
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\r\n<worksheet xmlns="${SHEET_NS}"><sheetData>` +
      '<row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c></row>' +
      '<row r="2"><c r="A2" t="s"><v>2</v></c><c r="B2" t="s"><v>3</v></c></row>' +
      '<row r="3"><c r="A3"/><c r="B3"/></row>' +
      '<row r="4"/>' +
      '<row r="5"><c r="A5" t="s"><v>4</v></c><c r="B5" t="s"><v>5</v></c></row>' +
      '</sheetData></worksheet>'
    const sharedStringsXml = buildSstXml(['key', 'source', 'k1', 'Hello', 'k2', 'World'])
    const bytes = await packXlsx({ sheets: [{ name: 'Sheet1', xml: sheetXml }], sharedStringsXml })
    const imported = await importBytes(bytes, 'gaps.xlsx')
    expect(imported.segments.map((s) => s.key)).toEqual(['k1', 'k2'])
    expect(imported.segments.map((s) => s.ordinal)).toEqual([0, 1])
    expect(imported.warnings).toHaveLength(0)
  })

  test('多 sheet：只导入第一表 + xlsx.multi_sheet warning', async () => {
    const sst = newSst()
    const sheet1 = buildSheetXml(
      [
        [{ s: 'key' }, { s: 'source' }, { s: 'target' }],
        [{ s: 'one' }, { s: 'First sheet' }, { s: '第一表' }],
      ],
      sst,
    )
    const sheet2 = buildSheetXml(
      [
        [{ s: 'key' }, { s: 'source' }, { s: 'target' }],
        [{ s: 'two' }, { s: 'Second sheet' }, { s: '第二表' }],
      ],
      sst,
    )
    const bytes = await packXlsx({
      sheets: [
        { name: 'Main', xml: sheet1 },
        { name: 'Extra', xml: sheet2 },
      ],
      sharedStringsXml: buildSstXml(sst.values),
    })
    const imported = await importBytes(bytes, 'multi.xlsx')
    expect(imported.segments.map((s) => s.key)).toEqual(['one'])
    expect(imported.segments[0]?.source).toBe('First sheet')
    expect(imported.warnings).toHaveLength(1)
    expect(imported.warnings[0]?.code).toBe('xlsx.multi_sheet')
    expect(imported.warnings[0]?.message).toContain('2')
    expect(imported.warnings[0]?.message).toContain('Main')
  })
})

describe('XlsxAdapter import 错误路径（typed errors）', () => {
  test('持久映射的未知版本或字段 fail closed，不会退回默认首表', async () => {
    const bytes = await simpleXlsx([
      ['key', 'source', 'target'],
      ['cfg.one', 'Hello', ''],
    ])
    const adapter = new XlsxAdapter()
    await expect(adapter.import({
      bytes,
      filename: 'config.xlsx',
      sourceLocale: 'en-US',
      targetLocale: 'zh-CN',
      formatConfigJson: JSON.stringify({
        version: 2,
        sheetName: 'Sheet1',
        columns: { source: 'source', target: 'target' },
      }),
    })).rejects.toBeInstanceOf(FormatParseError)

    const imported = await importBytes(bytes, 'config.xlsx', adapter)
    const { asset, segments } = await boundSegments('config.xlsx', imported)
    await expect(adapter.export({
      originalBytes: bytes,
      asset: {
        ...asset,
        formatConfigJson: JSON.stringify({
          version: 1,
          sheetName: 'Sheet1',
          columns: { source: 'source', target: 'target', guessed: 'key' },
        }),
      },
      segments,
    })).rejects.toBeInstanceOf(FormatExportError)
  })

  test('空文件/非 zip/无表头/无数据行/无 source 列/重复 key/坏 sst 索引 => FormatParseError', async () => {
    const adapter = new XlsxAdapter()
    const emptySheet = await packXlsx({
      sheets: [{ name: 'S', xml: `<?xml version="1.0"?><worksheet xmlns="${SHEET_NS}"><sheetData/></worksheet>` }],
    })
    const badSstIndexSheet = await packXlsx({
      sheets: [
        {
          name: 'S',
          xml:
            `<?xml version="1.0"?><worksheet xmlns="${SHEET_NS}"><sheetData>` +
            '<row r="1"><c r="A1" t="s"><v>0</v></c></row>' +
            '<row r="2"><c r="A2" t="s"><v>99</v></c><c r="B2" t="s"><v>0</v></c></row>' +
            '</sheetData></worksheet>',
        },
      ],
      sharedStringsXml: buildSstXml(['key']),
    })
    const noSstFileSheet = await packXlsx({
      sheets: [
        {
          name: 'S',
          xml:
            `<?xml version="1.0"?><worksheet xmlns="${SHEET_NS}"><sheetData>` +
            '<row r="1"><c r="A1" t="s"><v>0</v></c></row>' +
            '</sheetData></worksheet>',
        },
      ],
    })
    const cases: Array<[string, Uint8Array]> = [
      ['empty.xlsx', new Uint8Array(0)],
      ['notzip.xlsx', new TextEncoder().encode('key,source\na,Hello\n')],
      ['header-only.xlsx', await simpleXlsx([['key', 'source', 'target']])],
      ['no-source.xlsx', await simpleXlsx([['key', 'foo'], ['x.one', 'a']])],
      ['dup-key.xlsx', await simpleXlsx([['key', 'source'], ['x.one', 'a'], ['x.one', 'b']])],
      ['empty-sheet.xlsx', emptySheet],
      ['bad-sst-index.xlsx', badSstIndexSheet],
      ['no-sst-file.xlsx', noSstFileSheet],
    ]
    for (const [filename, bytes] of cases) {
      let caught: unknown
      try {
        await adapter.import({ bytes, filename, sourceLocale: 'en', targetLocale: 'zh' })
      } catch (err) {
        caught = err
      }
      expect(caught, filename).toBeInstanceOf(FormatParseError)
      expect((caught as FormatParseError).code).toBe('FORMAT_PARSE_ERROR')
    }
    // zip 但没有 xl/workbook.xml
    const noWorkbook = await new JSZip().file('xl/worksheets/sheet1.xml', '<worksheet/>').generateAsync({ type: 'uint8array' })
    await expect(adapter.import({ bytes: noWorkbook, filename: 'nowb.xlsx', sourceLocale: 'en', targetLocale: 'zh' })).rejects.toBeInstanceOf(FormatParseError)
  })
})

describe('XlsxAdapter round-trip（assertRoundTrip harness）', () => {
  test('持久映射让重启后的默认 adapter 仍只写回用户确认的工作表', async () => {
    const sst = newSst()
    const cover = buildSheetXml([[{ s: '说明' }], [{ s: '不能作为翻译批次导入' }]], sst)
    const batch = buildSheetXml([
      [{ s: '编号' }, { s: '原文' }, { s: '译文' }],
      [{ s: 'menu.start' }, { s: '开始' }, { s: '' }],
    ], sst)
    const bytes = await packXlsx({
      sheets: [{ name: '封面', xml: cover }, { name: '批次', xml: batch }],
      sharedStringsXml: buildSstXml(sst.values),
    })
    const configured = new XlsxAdapter({
      sheetName: '批次',
      columns: { key: '编号', source: '原文', target: '译文' },
    })
    const imported = await importBytes(bytes, 'mapped.xlsx', configured)
    const { asset, segments } = await boundSegments('mapped.xlsx', imported)
    const edited = segments.map((segment) => ({ ...segment, target: 'Start' }))

    const exported = await new XlsxAdapter().export({ originalBytes: bytes, asset, segments: edited })
    expect(await entryText(exported, 'xl/worksheets/sheet1.xml')).toBe(await entryText(bytes, 'xl/worksheets/sheet1.xml'))
    const reimported = await new XlsxAdapter().import({
      bytes: exported,
      filename: 'mapped.xlsx',
      sourceLocale: 'en-US',
      targetLocale: 'zh-CN',
      formatConfigJson: asset.formatConfigJson,
    })
    expect(reimported.segments).toMatchObject([{ key: 'menu.start', target: 'Start' }])
  })

  test('mini_dialogue 工作簿：字节稳定 + 修改子集写回（锁定段不被 harness 修改）', async () => {
    const report = await assertRoundTrip(new XlsxAdapter(), await miniDialogueXlsx(), {
      filename: 'mini.xlsx',
      sourceLocale: 'en-US',
      targetLocale: 'zh-CN',
    })
    // 4 段中 even-index 2 段（0=gate, 2=bribe）非锁定 => 2 段被修改
    expect(report.segmentCount).toBe(4)
    expect(report.modifiedSegmentIds).toHaveLength(2)
  })

  test('混合单元格类型工作簿经同一 adapter 往返（字节稳定）', async () => {
    const sst = newSst()
    const xml = buildSheetXml(
      [
        [{ s: 'key' }, { s: 'source' }, { s: 'target' }],
        [{ s: 'r.inline' }, { inline: 'Inline & <mixed>' }, { inline: '内联' }],
        [{ s: 'r.number' }, { n: 42 }, null],
        [{ s: 'r.shared' }, { s: 'Shared source' }, { s: '共享译文' }],
      ],
      sst,
    )
    const bytes = await packXlsx({ sheets: [{ name: 'Sheet1', xml }], sharedStringsXml: buildSstXml(sst.values) })
    const report = await assertRoundTrip(new XlsxAdapter(), bytes, {
      filename: 'mixed.xlsx',
      sourceLocale: 'en-US',
      targetLocale: 'zh-CN',
    })
    expect(report.segmentCount).toBe(3)
  })

  test('未修改导出逐字节等于原始字节（显式抽查）', async () => {
    const bytes = await miniDialogueXlsx()
    const adapter = new XlsxAdapter()
    const imported = await importBytes(bytes, 'mini.xlsx', adapter)
    const { asset, segments } = await boundSegments('mini.xlsx', imported)
    const exported = await adapter.export({ originalBytes: bytes, asset, segments })
    expect(Buffer.from(exported).equals(Buffer.from(bytes))).toBe(true)
  })

  test('修改导出：sharedStrings/其他条目内容字节不变；目标单元格改写为 inlineStr；重导入 target 在', async () => {
    const bytes = await miniDialogueXlsx({ extra: { 'docProps/core.xml': '<?xml version="1.0"?><coreProperties/>' } })
    const adapter = new XlsxAdapter()
    const imported = await importBytes(bytes, 'mini.xlsx', adapter)
    const { asset, segments } = await boundSegments('mini.xlsx', imported)
    const edited = segments.map((s) => (s.key === 'dlg.guard.bribe' ? { ...s, target: '贿赂？你好大的胆子！' } : s))
    const exported = await adapter.export({ originalBytes: bytes, asset, segments: edited })

    // 未修改条目内容字节一致（zip 容器字节允许不同）
    expect(Buffer.from(await entryBytes(exported, 'xl/sharedStrings.xml')).equals(Buffer.from(await entryBytes(bytes, 'xl/sharedStrings.xml')))).toBe(true)
    expect(Buffer.from(await entryBytes(exported, 'docProps/core.xml')).equals(Buffer.from(await entryBytes(bytes, 'docProps/core.xml')))).toBe(true)
    expect(Buffer.from(await entryBytes(exported, 'xl/workbook.xml')).equals(Buffer.from(await entryBytes(bytes, 'xl/workbook.xml')))).toBe(true)

    // 目标单元格（bribe 在第 4 行 C 列）被改写为 inlineStr，其余单元格不动
    const sheetAfter = await entryText(exported, 'xl/worksheets/sheet1.xml')
    expect(sheetAfter).toContain('<c r="C4" t="inlineStr"><is><t>贿赂？你好大的胆子！</t></is></c>')
    expect(sheetAfter).toContain('<c r="C2" t="s"><v>7</v></c>') // 未修改的 shared-string 单元格原样

    const reimported = await importBytes(exported, 'mini.xlsx', adapter)
    const byKey = new Map(reimported.segments.map((s) => [s.key, s]))
    expect(byKey.get('dlg.guard.bribe')?.target).toBe('贿赂？你好大的胆子！')
    expect(byKey.get('dlg.guard.bribe')?.status).toBe('translated')
    expect(byKey.get('dlg.guard.gate')?.target).toBe('站住！说明你的来意，旅人。')
    expect(byKey.get('legal.eula')?.locked).toBe(true)
  })

  test('缺失的 target 单元格：按列序在行内插入新 <c>（r 属性正确）并可重导入', async () => {
    const sst = newSst()
    // target 在 C 列；数据行只有 A(key)/B(source)/D(context)，C 列单元格缺失
    const xml = buildSheetXml(
      [
        [{ s: 'key' }, { s: 'source' }, { s: 'target' }, { s: 'context' }],
        [{ s: 's.one' }, { s: 'Hello' }, null, { s: 'note1' }],
        [{ s: 's.two' }, { s: 'World' }, { s: '世界' }, { s: 'note2' }],
      ],
      sst,
    )
    const bytes = await packXlsx({ sheets: [{ name: 'Sheet1', xml }], sharedStringsXml: buildSstXml(sst.values) })
    const adapter = new XlsxAdapter()
    const imported = await importBytes(bytes, 'sparse.xlsx', adapter)
    expect(imported.segments[0]?.target).toBe('')
    const { asset, segments } = await boundSegments('sparse.xlsx', imported)
    const edited = segments.map((s) => (s.key === 's.one' ? { ...s, target: '你好，世界' } : s))
    const exported = await adapter.export({ originalBytes: bytes, asset, segments: edited })
    const sheetAfter = await entryText(exported, 'xl/worksheets/sheet1.xml')
    // 插入在 D2（context）之前以保持列序
    expect(sheetAfter).toContain('<c r="C2" t="inlineStr"><is><t>你好，世界</t></is></c><c r="D2"')
    const reimported = await importBytes(exported, 'sparse.xlsx', adapter)
    const byKey = new Map(reimported.segments.map((s) => [s.key, s]))
    expect(byKey.get('s.one')?.target).toBe('你好，世界')
    expect(byKey.get('s.one')?.context?.note).toBe('note1')
    expect(byKey.get('s.two')?.target).toBe('世界')
  })

  test('XML 转义：target 含 & < > " 与换行/回车/控制字符 => 转义正确且往返一致', async () => {
    const bytes = await simpleXlsx([
      ['key', 'source', 'target'],
      ['esc.one', 'Fish & Chips <fresh> "daily"', ''],
    ])
    const adapter = new XlsxAdapter()
    const imported = await importBytes(bytes, 'esc.xlsx', adapter)
    const { asset, segments } = await boundSegments('esc.xlsx', imported)
    const newTarget = '鱼 & 薯条 <标签> "引号"\n第二行\r\n第三行\x0B尾'
    const edited = segments.map((s) => ({ ...s, target: newTarget }))
    const exported = await adapter.export({ originalBytes: bytes, asset, segments: edited })
    const sheetAfter = await entryText(exported, 'xl/worksheets/sheet1.xml')
    expect(sheetAfter).toContain('鱼 &amp; 薯条 &lt;标签&gt; &quot;引号&quot;\n第二行&#xD;\n第三行_x000B_尾')
    const reimported = await importBytes(exported, 'esc.xlsx', adapter)
    expect(reimported.segments[0]?.target).toBe(newTarget)
  })

  test('首尾空白 target：写 xml:space="preserve" 且往返一致', async () => {
    const bytes = await simpleXlsx([
      ['key', 'source', 'target'],
      ['pad.one', 'Padded', ''],
    ])
    const adapter = new XlsxAdapter()
    const imported = await importBytes(bytes, 'pad.xlsx', adapter)
    const { asset, segments } = await boundSegments('pad.xlsx', imported)
    const edited = segments.map((s) => ({ ...s, target: '  padded  ' }))
    const exported = await adapter.export({ originalBytes: bytes, asset, segments: edited })
    const sheetAfter = await entryText(exported, 'xl/worksheets/sheet1.xml')
    expect(sheetAfter).toContain('<t xml:space="preserve">  padded  </t>')
    const reimported = await importBytes(exported, 'pad.xlsx', adapter)
    expect(reimported.segments[0]?.target).toBe('  padded  ')
  })

  test('多 sheet 工作簿修改导出：第二表条目内容字节不变', async () => {
    const sst = newSst()
    const sheet1 = buildSheetXml(
      [
        [{ s: 'key' }, { s: 'source' }, { s: 'target' }],
        [{ s: 'one' }, { s: 'First' }, null],
      ],
      sst,
    )
    const sheet2 = buildSheetXml(
      [
        [{ s: 'key' }, { s: 'source' }, { s: 'target' }],
        [{ s: 'two' }, { s: 'Second' }, { s: '第二' }],
      ],
      sst,
    )
    const bytes = await packXlsx({
      sheets: [
        { name: 'Main', xml: sheet1 },
        { name: 'Extra', xml: sheet2 },
      ],
      sharedStringsXml: buildSstXml(sst.values),
    })
    const adapter = new XlsxAdapter()
    const imported = await importBytes(bytes, 'multi.xlsx', adapter)
    const { asset, segments } = await boundSegments('multi.xlsx', imported)
    const edited = segments.map((s) => ({ ...s, target: '第一' }))
    const exported = await adapter.export({ originalBytes: bytes, asset, segments: edited })
    expect(Buffer.from(await entryBytes(exported, 'xl/worksheets/sheet2.xml')).equals(Buffer.from(await entryBytes(bytes, 'xl/worksheets/sheet2.xml')))).toBe(true)
    const reimported = await importBytes(exported, 'multi.xlsx', adapter)
    expect(reimported.segments[0]?.target).toBe('第一')
  })
})

describe('XlsxAdapter 导出错误路径（typed errors）', () => {
  test('导出拒绝未知 key / 缺失段 / 源文被篡改 / 锁定段被改 / 重复 key => FormatExportError', async () => {
    const bytes = await miniDialogueXlsx()
    const adapter = new XlsxAdapter()
    const imported = await importBytes(bytes, 'mini.xlsx', adapter)
    const { asset, segments } = await boundSegments('mini.xlsx', imported)

    const unknown = [{ ...segments[0]!, key: 'does.not.exist' }, ...segments.slice(1)]
    await expect(adapter.export({ originalBytes: bytes, asset, segments: unknown })).rejects.toBeInstanceOf(FormatExportError)

    await expect(adapter.export({ originalBytes: bytes, asset, segments: segments.slice(1) })).rejects.toBeInstanceOf(FormatExportError)

    const tamperedSource = segments.map((s, i) => (i === 0 ? { ...s, source: 'MUTATED' } : s))
    await expect(adapter.export({ originalBytes: bytes, asset, segments: tamperedSource })).rejects.toBeInstanceOf(FormatExportError)

    const tamperedLocked = segments.map((s) => (s.key === 'legal.eula' ? { ...s, target: 'MUTATED' } : s))
    let lockedErr: unknown
    try {
      await adapter.export({ originalBytes: bytes, asset, segments: tamperedLocked })
    } catch (err) {
      lockedErr = err
    }
    expect(lockedErr).toBeInstanceOf(FormatExportError)
    expect((lockedErr as FormatExportError).code).toBe('FORMAT_EXPORT_ERROR')
    expect((lockedErr as FormatExportError).message).toContain('locked')

    const dup = [...segments, { ...segments[0]! }]
    await expect(adapter.export({ originalBytes: bytes, asset, segments: dup })).rejects.toBeInstanceOf(FormatExportError)
  })

  test('无 target 列的模板：未修改导出字节稳定，修改 target => FormatExportError', async () => {
    const bytes = await simpleXlsx([
      ['key', 'source'],
      ['m.one', 'Hello'],
    ])
    const adapter = new XlsxAdapter()
    const imported = await importBytes(bytes, 'notarget.xlsx', adapter)
    const { asset, segments } = await boundSegments('notarget.xlsx', imported)
    const unmodified = await adapter.export({ originalBytes: bytes, asset, segments })
    expect(Buffer.from(unmodified).equals(Buffer.from(bytes))).toBe(true)
    const edited = segments.map((s) => ({ ...s, target: '你好' }))
    await expect(adapter.export({ originalBytes: bytes, asset, segments: edited })).rejects.toBeInstanceOf(FormatExportError)
  })
})
