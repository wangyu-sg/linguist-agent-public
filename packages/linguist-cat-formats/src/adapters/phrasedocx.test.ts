/**
 * PhraseDocxAdapter tests (PB-088, Phrase/Memsource bilingual DOCX leg).
 *
 * DOCX fixtures are built in-test with jszip — self-contained, no binary
 * files under tests/linguist-fixtures/ (same approach as xlsx.test.ts).
 * buildDocumentXml renders a multi-table WordprocessingML document (intro
 * metadata table + content table with header row + segment rows); packDocx
 * assembles the OOXML zip parts.
 */

import { describe, expect, test } from 'bun:test'
import JSZip from 'jszip'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createAsset, createProject, createSeededEntropy } from '@linguist/cat-core'
import {
  bindImportedSegments,
  CatFormatRegistry,
  FormatExportError,
  FormatParseError,
  FormatUnsupportedError,
} from '../index'
import { assertRoundTrip } from '../testing/index'
import { PhraseDocxAdapter } from './phrasedocx'
import { PhraseMxliffAdapter } from './phrasemxliff'
import { SdlXliffAdapter } from './sdlxliff'
import { XliffAdapter } from './xliff'
import { XlsxAdapter } from './xlsx'

const FIXTURES = join(import.meta.dir, '../../../../tests/linguist-fixtures')

function fixtureBytes(name: string): Uint8Array {
  return new Uint8Array(readFileSync(join(FIXTURES, name)))
}

// ---------------------------------------------------------------------------
// Fixture builders
// ---------------------------------------------------------------------------

function esc(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

/** 单格：runs 为 null 时产出无 <w:t> 的空段落单元格（导出插入路径用例）。 */
function cellXml(runs: string[] | null): string {
  if (runs === null) return '<w:tc><w:p/></w:tc>'
  const runsXml = runs.map((run) => `<w:r><w:t>${esc(run)}</w:t></w:r>`).join('')
  return `<w:tc><w:p>${runsXml}</w:p></w:tc>`
}

function rowXml(cells: string[]): string {
  return `<w:tr>${cells.join('')}</w:tr>`
}

/** 内容表段行：逻辑列 [ID, ICU, #, Source, Target, Status, Comment]。 */
function segmentRowXml(
  id: string,
  num: string,
  source: string,
  targetRuns: string[] | null,
  status = '',
  comment = '',
): string {
  return rowXml([
    cellXml([id]),
    cellXml(['']),
    cellXml([num]),
    cellXml([source]),
    cellXml(targetRuns),
    cellXml([status]),
    cellXml([comment]),
  ])
}

const HEADER_ROW = rowXml(['ID', 'ICU', '#', 'Source (cs)', 'Target (de-de)', 'Status', 'Comment'].map((h) => cellXml([h])))

/** 2 列 metadata/intro 表（应被段行判定忽略）。 */
const INTRO_TABLE = `<w:tbl>${
  rowXml([cellXml(['Source language']), cellXml(['cs'])]) +
  rowXml([cellXml(['Target language']), cellXml(['de-de'])])
}</w:tbl>`

/**
 * 最小 Phrase bilingual DOCX 内容表：
 * dc10:0 正常段（Confirmed + #12 => context）；dc10:1 空 target（untranslated）
 * + 实体解码；dc10:2 占位符族 + target 双 <w:t> run；dc10:3 target 格无
 * <w:t>（插入路径）；外加一行首格无 ':' 的非段行（应跳过）。
 */
function buildDocumentXml(): string {
  const contentTable = `<w:tbl>${
    HEADER_ROW +
    segmentRowXml('SSOMDWjYi5xvD7wq_dc10:0', '12', 'Získejte {1}30 %{2} rychlost útoku.', ['Gain {1}30%{2} Attack Speed.'], 'Confirmed', 'gate guard') +
    segmentRowXml('SSOMDWjYi5xvD7wq_dc10:1', '', 'Tom & Jerry <3', [''], '', '') +
    segmentRowXml('SSOMDWjYi5xvD7wq_dc10:2', '', 'Barvy {2>bold<2} text', ['Hello ', 'World'], '', '') +
    segmentRowXml('SSOMDWjYi5xvD7wq_dc10:3', '', 'Empty run cell', null, '', '') +
    rowXml([cellXml(['footer note']), cellXml(['']), cellXml(['']), cellXml(['not a segment']), cellXml(['']), cellXml(['']), cellXml([''])])
  }</w:tbl>`
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\r\n<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${INTRO_TABLE}${contentTable}</w:body></w:document>`
}

/** 普通 DOCX：只有 metadata 表与正文段落，无 Phrase 内容表形状。 */
function buildPlainDocumentXml(): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\r\n<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${INTRO_TABLE}<w:p><w:r><w:t>Just a document.</w:t></w:r></w:p></w:body></w:document>`
}

interface PackDocxOptions {
  documentXml?: string
  extra?: Record<string, string>
}

async function packDocx(options: PackDocxOptions = {}): Promise<Uint8Array> {
  const zip = new JSZip()
  zip.file(
    '[Content_Types].xml',
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\r\n<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
  )
  zip.file(
    '_rels/.rels',
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\r\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
  )
  if (options.documentXml !== undefined) zip.file('word/document.xml', options.documentXml)
  for (const [path, content] of Object.entries(options.extra ?? {})) zip.file(path, content)
  return zip.generateAsync({ type: 'uint8array' })
}

async function miniPhraseDocx(options: PackDocxOptions = {}): Promise<Uint8Array> {
  return packDocx({ documentXml: buildDocumentXml(), ...options })
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
// Import/export helpers (same shape as xlsx.test.ts)
// ---------------------------------------------------------------------------

async function importBytes(bytes: Uint8Array, filename: string, adapter = new PhraseDocxAdapter()) {
  return adapter.import({ bytes, filename, sourceLocale: 'cs', targetLocale: 'de-DE' })
}

const NOW = '2026-01-01T00:00:00.000Z'

/** Binds imported segments to a deterministic asset (same pattern as the harness). */
async function boundSegments(name: string, imported: Awaited<ReturnType<PhraseDocxAdapter['import']>>) {
  const project = createProject(
    { name: 'phrase-docx-test', sourceLocale: 'cs', targetLocale: 'de-DE', promaWorkspaceId: 'phrase-docx-test' },
    { entropy: createSeededEntropy(`phrase-docx-test:${name}`), now: NOW },
  )
  const asset = createAsset({
    projectId: project.id,
    formatId: imported.asset.formatId,
    originalFilename: name,
    sourceSha256: imported.asset.sourceSha256,
    segmentCount: imported.asset.segmentCount,
  })
  return { asset, segments: bindImportedSegments(imported.segments, asset.id) }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('PhraseDocxAdapter detect（置信度设计：只认 Phrase 内容表形状，普通 DOCX 绝不认领）', () => {
  test('phrase docx + .docx => 0.9；改名 => 0.7；普通 docx / xlsx / 非 zip / 缺 document.xml => 0', async () => {
    const adapter = new PhraseDocxAdapter()
    const real = await miniPhraseDocx()
    expect(await adapter.detect(real, 'mini.docx')).toBe(0.9)
    expect(await adapter.detect(real, 'renamed.bin')).toBe(0.7)
    // 普通 DOCX（有 word/document.xml 但无 Phrase 段行）绝不认领
    const plain = await packDocx({ documentXml: buildPlainDocumentXml() })
    expect(await adapter.detect(plain, 'plain.docx')).toBe(0)
    // xlsx 字节（zip 但无 word/document.xml）
    const xlsxZip = await new JSZip().file('xl/workbook.xml', '<workbook/>').generateAsync({ type: 'uint8array' })
    expect(await adapter.detect(xlsxZip, 'fake.docx')).toBe(0)
    // 非 zip 字节
    expect(await adapter.detect(new TextEncoder().encode('key,source\na,Hello\n'), 'fake.docx')).toBe(0)
    // PK 魔数但内容损坏 / 空输入
    expect(await adapter.detect(new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0, 0, 0]), 'broken.docx')).toBe(0)
    expect(await adapter.detect(new Uint8Array(0), 'empty.docx')).toBe(0)
  })

  test('registry 层不互抢：phrase docx 归 phrase docx，xlsx/xliff/mxliff 各归各，普通 docx 无人认领', async () => {
    const registry = new CatFormatRegistry()
      .register(new XliffAdapter())
      .register(new SdlXliffAdapter())
      .register(new PhraseMxliffAdapter())
      .register(new XlsxAdapter())
      .register(new PhraseDocxAdapter())
    const phrase = await miniPhraseDocx()
    expect((await registry.detectBest(phrase, 'mini.docx')).id).toBe('phrase_bilingual_docx_1')
    // phrase docx 改名未知扩展名：0.7 仍然唯一命中
    expect((await registry.detectBest(phrase, 'renamed.bin')).id).toBe('phrase_bilingual_docx_1')
    // xlsx 字节归 xlsx（xl/ 与 word/ 条目不同，互不抢）
    const xlsxZip = await new JSZip().file('xl/workbook.xml', '<workbook/>').generateAsync({ type: 'uint8array' })
    expect((await registry.detectBest(xlsxZip, 'mini.xlsx')).id).toBe('xlsx_ooxml')
    // xliff / mxliff 字节路由不变
    expect((await registry.detectBest(fixtureBytes('mini_game_ui.xliff'), 'mini_game_ui.xliff')).id).toBe('xliff_1_2')
    expect((await registry.detectBest(fixtureBytes('sample.mqxliff'), 'sample.mqxliff')).id).toBe('xliff_1_2')
    // 普通 DOCX：所有 adapter 0 分 => FormatUnsupportedError（刻意如此）
    const plain = await packDocx({ documentXml: buildPlainDocumentXml() })
    await expect(registry.detectBest(plain, 'plain.docx')).rejects.toBeInstanceOf(FormatUnsupportedError)
  })
})

describe('PhraseDocxAdapter import（段行判定/状态保守映射/context 设计选择）', () => {
  test('段模型：intro 表/表头行/无冒号行跳过；key=首格 trim；ordinal 按文档顺序；status 保守映射', async () => {
    const imported = await importBytes(await miniPhraseDocx(), 'mini.docx')
    expect(imported.asset.formatId).toBe('phrase_bilingual_docx_1')
    expect(imported.asset.segmentCount).toBe(4)
    expect(imported.warnings).toHaveLength(0)
    expect(imported.segments.map((s) => s.ordinal)).toEqual([0, 1, 2, 3])
    expect(imported.segments.map((s) => s.key)).toEqual([
      'SSOMDWjYi5xvD7wq_dc10:0',
      'SSOMDWjYi5xvD7wq_dc10:1',
      'SSOMDWjYi5xvD7wq_dc10:2',
      'SSOMDWjYi5xvD7wq_dc10:3',
    ])
    const byKey = new Map(imported.segments.map((s) => [s.key, s]))
    // 空 target => untranslated；非空一律 draft（保守：状态码目录未解读）
    expect(byKey.get('SSOMDWjYi5xvD7wq_dc10:0')?.status).toBe('draft')
    expect(byKey.get('SSOMDWjYi5xvD7wq_dc10:1')?.status).toBe('untranslated')
    expect(byKey.get('SSOMDWjYi5xvD7wq_dc10:2')?.status).toBe('draft')
    expect(byKey.get('SSOMDWjYi5xvD7wq_dc10:3')?.status).toBe('untranslated')
    // DOCX 无段级锁定概念：一律 false
    expect(imported.segments.every((s) => s.locked === false)).toBe(true)
    // source/target locale 来自 import input
    expect(imported.segments[0]?.sourceLocale).toBe('cs')
    expect(imported.segments[0]?.targetLocale).toBe('de-DE')
  })

  test('占位符族逐字保留；多 <w:t> run 拼接；XML 实体解码', async () => {
    const imported = await importBytes(await miniPhraseDocx(), 'mini.docx')
    const byKey = new Map(imported.segments.map((s) => [s.key, s]))
    expect(byKey.get('SSOMDWjYi5xvD7wq_dc10:0')?.source).toBe('Získejte {1}30 %{2} rychlost útoku.')
    expect(byKey.get('SSOMDWjYi5xvD7wq_dc10:0')?.target).toBe('Gain {1}30%{2} Attack Speed.')
    // {2>bold<2} 不 rehydrate、不转换
    expect(byKey.get('SSOMDWjYi5xvD7wq_dc10:2')?.source).toBe('Barvy {2>bold<2} text')
    // 双 <w:t> run 拼接
    expect(byKey.get('SSOMDWjYi5xvD7wq_dc10:2')?.target).toBe('Hello World')
    // &amp;/&lt;/&gt; 解码
    expect(byKey.get('SSOMDWjYi5xvD7wq_dc10:1')?.source).toBe('Tom & Jerry <3')
  })

  test('context：Status 格 => note（"Phrase status: <值>"），# 格 => origin（"#<值>"）；两空则省略 context', async () => {
    const imported = await importBytes(await miniPhraseDocx(), 'mini.docx')
    const byKey = new Map(imported.segments.map((s) => [s.key, s]))
    const seg0 = byKey.get('SSOMDWjYi5xvD7wq_dc10:0')
    expect(seg0?.context?.note).toBe('Phrase status: Confirmed')
    expect(seg0?.context?.origin).toBe('#12')
    expect(byKey.get('SSOMDWjYi5xvD7wq_dc10:1')?.context).toBeUndefined()
    expect(byKey.get('SSOMDWjYi5xvD7wq_dc10:2')?.context).toBeUndefined()
  })

  test('重复段 id => FormatParseError', async () => {
    const xml = `<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:tbl>${
      segmentRowXml('dup:0', '', '一', ['']) + segmentRowXml('dup:0', '', '二', [''])
    }</w:tbl></w:body></w:document>`
    await expect(importBytes(await packDocx({ documentXml: xml }), 'dup.docx')).rejects.toBeInstanceOf(FormatParseError)
  })
})

describe('PhraseDocxAdapter import 错误路径（typed errors）', () => {
  test('非 zip / 缺 word/document.xml / 零段行 => FormatParseError', async () => {
    const adapter = new PhraseDocxAdapter()
    const noDocument = await packDocx({})
    const plain = await packDocx({ documentXml: buildPlainDocumentXml() })
    const cases: Array<[string, Uint8Array]> = [
      ['empty.docx', new Uint8Array(0)],
      ['notzip.docx', new TextEncoder().encode('key,source\na,Hello\n')],
      ['no-document.docx', noDocument],
      ['zero-segments.docx', plain],
    ]
    for (const [filename, bytes] of cases) {
      let caught: unknown
      try {
        await adapter.import({ bytes, filename, sourceLocale: 'cs', targetLocale: 'de-DE' })
      } catch (err) {
        caught = err
      }
      expect(caught, filename).toBeInstanceOf(FormatParseError)
      expect((caught as FormatParseError).code).toBe('FORMAT_PARSE_ERROR')
    }
  })
})

describe('PhraseDocxAdapter round-trip（assertRoundTrip harness）', () => {
  test('mini 内容表：字节稳定 + 修改子集写回 + 占位符逐字', async () => {
    const report = await assertRoundTrip(new PhraseDocxAdapter(), await miniPhraseDocx(), {
      filename: 'mini.docx',
      sourceLocale: 'cs',
      targetLocale: 'de-DE',
      invariants: [
        {
          name: 'placeholder set preserved',
          assert: (before, after) => {
            const placeholders = (v: string) => (v.match(/\{\d+\}/g) ?? []).join('|')
            if (placeholders(after.source) !== placeholders(before.source)) {
              throw new Error('source placeholders changed')
            }
          },
        },
      ],
    })
    // 4 段中 even-index 2 段（dc10:0/dc10:2）被修改；无锁定段
    expect(report.segmentCount).toBe(4)
    expect(report.modifiedSegmentIds).toHaveLength(2)
  })

  test('未修改导出逐字节等于原始字节（byte-stable 显式抽查）', async () => {
    const bytes = await miniPhraseDocx()
    const adapter = new PhraseDocxAdapter()
    const imported = await importBytes(bytes, 'mini.docx', adapter)
    const { asset, segments } = await boundSegments('mini.docx', imported)
    const exported = await adapter.export({ originalBytes: bytes, asset, segments })
    expect(Buffer.from(exported).equals(Buffer.from(bytes))).toBe(true)
  })

  test('修改导出：其他条目内容字节不变；首个 <w:t> 写入并强制 xml:space="preserve"，其余 run 清空；可重导入', async () => {
    const bytes = await miniPhraseDocx({ extra: { 'docProps/core.xml': '<?xml version="1.0"?><coreProperties/>' } })
    const adapter = new PhraseDocxAdapter()
    const imported = await importBytes(bytes, 'mini.docx', adapter)
    const { asset, segments } = await boundSegments('mini.docx', imported)
    const edited = segments.map((s) =>
      s.key === 'SSOMDWjYi5xvD7wq_dc10:1'
        ? { ...s, target: 'Tom & Jerry <3 übersetzt' }
        : s.key === 'SSOMDWjYi5xvD7wq_dc10:2'
          ? { ...s, target: 'NEU' }
          : s,
    )
    const exported = await adapter.export({ originalBytes: bytes, asset, segments: edited })

    // 未修改条目内容字节一致（zip 容器字节允许不同）
    expect(Buffer.from(await entryBytes(exported, '[Content_Types].xml')).equals(Buffer.from(await entryBytes(bytes, '[Content_Types].xml')))).toBe(true)
    expect(Buffer.from(await entryBytes(exported, 'docProps/core.xml')).equals(Buffer.from(await entryBytes(bytes, 'docProps/core.xml')))).toBe(true)

    const docAfter = await entryText(exported, 'word/document.xml')
    // 原本空 <w:t></w:t> 的单元格：首个 <w:t> 写入编码后文本并强制 preserve
    expect(docAfter).toContain('<w:t xml:space="preserve">Tom &amp; Jerry &lt;3 übersetzt</w:t>')
    // 双 run 单元格：首 run 写入，其余 run 清空
    expect(docAfter).toContain('<w:t xml:space="preserve">NEU</w:t>')
    expect(docAfter).toContain('<w:r><w:t></w:t></w:r>')
    expect(docAfter).not.toContain('Hello ')
    // 未修改段单元格字节不动
    expect(docAfter).toContain('Gain {1}30%{2} Attack Speed.')

    const reimported = await importBytes(exported, 'mini.docx', adapter)
    const byKey = new Map(reimported.segments.map((s) => [s.key, s]))
    expect(byKey.get('SSOMDWjYi5xvD7wq_dc10:1')?.target).toBe('Tom & Jerry <3 übersetzt')
    expect(byKey.get('SSOMDWjYi5xvD7wq_dc10:1')?.status).toBe('draft')
    expect(byKey.get('SSOMDWjYi5xvD7wq_dc10:2')?.target).toBe('NEU')
    expect(byKey.get('SSOMDWjYi5xvD7wq_dc10:0')?.target).toBe('Gain {1}30%{2} Attack Speed.')
  })

  test('target 格无 <w:t>：在 </w:tc> 前插入 <w:p><w:r><w:t xml:space="preserve"> 并可重导入', async () => {
    const bytes = await miniPhraseDocx()
    const adapter = new PhraseDocxAdapter()
    const imported = await importBytes(bytes, 'mini.docx', adapter)
    expect(imported.segments.find((s) => s.key === 'SSOMDWjYi5xvD7wq_dc10:3')?.target).toBe('')
    const { asset, segments } = await boundSegments('mini.docx', imported)
    const edited = segments.map((s) => (s.key === 'SSOMDWjYi5xvD7wq_dc10:3' ? { ...s, target: 'INSERTED' } : s))
    const exported = await adapter.export({ originalBytes: bytes, asset, segments: edited })
    const docAfter = await entryText(exported, 'word/document.xml')
    expect(docAfter).toContain('<w:tc><w:p/><w:p><w:r><w:t xml:space="preserve">INSERTED</w:t></w:r></w:p></w:tc>')
    const reimported = await importBytes(exported, 'mini.docx', adapter)
    expect(reimported.segments.find((s) => s.key === 'SSOMDWjYi5xvD7wq_dc10:3')?.target).toBe('INSERTED')
  })

  test('既有 xml:space 被强制为 preserve；多空格 target 往返一致', async () => {
    const xml = `<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:tbl>${
      `<w:tr>${[
        cellXml(['pad:0']),
        cellXml(['']),
        cellXml(['']),
        cellXml(['Padded']),
        '<w:tc><w:p><w:r><w:t xml:space="default"></w:t></w:r></w:p></w:tc>',
        cellXml(['']),
        cellXml(['']),
      ].join('')}</w:tr>`
    }</w:tbl></w:body></w:document>`
    const bytes = await packDocx({ documentXml: xml })
    const adapter = new PhraseDocxAdapter()
    const imported = await importBytes(bytes, 'pad.docx', adapter)
    const { asset, segments } = await boundSegments('pad.docx', imported)
    const edited = segments.map((s) => ({ ...s, target: '  padded   target  ' }))
    const exported = await adapter.export({ originalBytes: bytes, asset, segments: edited })
    const docAfter = await entryText(exported, 'word/document.xml')
    expect(docAfter).toContain('<w:t xml:space="preserve">  padded   target  </w:t>')
    expect(docAfter).not.toContain('xml:space="default"')
    const reimported = await importBytes(exported, 'pad.docx', adapter)
    expect(reimported.segments[0]?.target).toBe('  padded   target  ')
  })

  test('空字符串 target 是合法写入（清空译文），重导入回到 untranslated', async () => {
    const bytes = await miniPhraseDocx()
    const adapter = new PhraseDocxAdapter()
    const imported = await importBytes(bytes, 'mini.docx', adapter)
    const { asset, segments } = await boundSegments('mini.docx', imported)
    const edited = segments.map((s) => (s.key === 'SSOMDWjYi5xvD7wq_dc10:0' ? { ...s, target: '' } : s))
    const exported = await adapter.export({ originalBytes: bytes, asset, segments: edited })
    const docAfter = await entryText(exported, 'word/document.xml')
    expect(docAfter).toContain('<w:t xml:space="preserve"></w:t>')
    const reimported = await importBytes(exported, 'mini.docx', adapter)
    const seg = reimported.segments.find((s) => s.key === 'SSOMDWjYi5xvD7wq_dc10:0')
    expect(seg?.target).toBe('')
    expect(seg?.status).toBe('untranslated')
  })
})

describe('PhraseDocxAdapter 导出错误路径（typed errors）', () => {
  test('导出拒绝未知 key / 缺失段 / 源文被篡改 / 重复 key => FormatExportError，绝不静默跳过', async () => {
    const bytes = await miniPhraseDocx()
    const adapter = new PhraseDocxAdapter()
    const imported = await importBytes(bytes, 'mini.docx', adapter)
    const { asset, segments } = await boundSegments('mini.docx', imported)

    const unknown = [{ ...segments[0]!, key: 'nope:99' }, ...segments.slice(1)]
    await expect(adapter.export({ originalBytes: bytes, asset, segments: unknown })).rejects.toBeInstanceOf(FormatExportError)

    await expect(adapter.export({ originalBytes: bytes, asset, segments: segments.slice(1) })).rejects.toBeInstanceOf(FormatExportError)

    const tamperedSource = segments.map((s, i) => (i === 0 ? { ...s, source: 'MUTATED' } : s))
    await expect(adapter.export({ originalBytes: bytes, asset, segments: tamperedSource })).rejects.toBeInstanceOf(FormatExportError)

    const dup = [...segments, { ...segments[0]! }]
    await expect(adapter.export({ originalBytes: bytes, asset, segments: dup })).rejects.toBeInstanceOf(FormatExportError)
  })
})
