/**
 * CsvAdapter tests (PB-023, CSV leg).
 *
 * Synthetic fixtures only (tests/linguist-fixtures/): mini_dialogue.csv
 * (game-dialogue flavor, quoted commas, embedded newlines, CJK, locked
 * row), terminology.csv (term base shape for later TB tickets). All code
 * and fixtures fresh-written for this repo.
 */

import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createAsset, createProject, createSeededEntropy } from '@linguist/cat-core'
import { bindImportedSegments, FormatExportError, FormatParseError } from '../index'
import { assertRoundTrip } from '../testing/index'
import { CsvAdapter } from './csv'

const FIXTURES = join(import.meta.dir, '../../../../tests/linguist-fixtures')

function fixtureBytes(name: string): Uint8Array {
  return new Uint8Array(readFileSync(join(FIXTURES, name)))
}

function encode(text: string): Uint8Array {
  return new TextEncoder().encode(text)
}

async function importBytes(bytes: Uint8Array, filename: string, adapter = new CsvAdapter()) {
  return adapter.import({ bytes, filename, sourceLocale: 'en-US', targetLocale: 'zh-CN' })
}

async function importFixture(name: string, adapter = new CsvAdapter()) {
  const bytes = fixtureBytes(name)
  const imported = await importBytes(bytes, name, adapter)
  return { adapter, bytes, imported }
}

const NOW = '2026-01-01T00:00:00.000Z'

/** Binds imported segments to a deterministic asset (same pattern as the harness). */
async function boundSegments(name: string, imported: Awaited<ReturnType<CsvAdapter['import']>>) {
  const project = createProject(
    { name: 'csv-test', sourceLocale: 'en-US', targetLocale: 'zh-CN', promaWorkspaceId: 'csv-test' },
    { entropy: createSeededEntropy(`csv-test:${name}`), now: NOW },
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

describe('CsvAdapter detect', () => {
  test('扩展名 + 可导入双语表头 => 0.9；低置信内容嗅探和无效输入 => 0', async () => {
    const adapter = new CsvAdapter()
    const csv = fixtureBytes('mini_dialogue.csv')
    expect(await adapter.detect(csv, 'mini_dialogue.csv')).toBe(0.9)
    expect(await adapter.detect(encode('key\tsource\ttarget\na\tb\tc\n'), 'strings.tsv')).toBe(0.9)
    expect(await adapter.detect(csv, 'renamed.bin')).toBe(0)
    expect(await adapter.detect(encode('justonecolumn\nx\ny\n'), 'a.csv')).toBe(0)
    expect(await adapter.detect(new Uint8Array([0, 1, 2, 44]), 'a.csv')).toBe(0)
    expect(await adapter.detect(new Uint8Array([0xff, 0xfe, 0x2c]), 'a.csv')).toBe(0)
  })

  test('Markdown 管道表和无 source 表头的配置表不因分隔符而误中', async () => {
    const adapter = new CsvAdapter()
    expect(await adapter.detect(encode('| key | value |\n| --- | --- |\n| a | b |\n'), 'README.md')).toBe(0)
    expect(await adapter.detect(encode('name,version\napp,1\n'), 'config.csv')).toBe(0)
  })
})

describe('CsvAdapter import（默认映射/引号/CJK/锁定）', () => {
  test('mini_dialogue：默认列映射、quoted 逗号、嵌入换行、`""` 转义、空 target、locked、context', async () => {
    const { imported } = await importFixture('mini_dialogue.csv')
    expect(imported.asset.formatId).toBe('csv_rfc4180')
    expect(imported.asset.segmentCount).toBe(8)
    expect(imported.segments.map((s) => s.ordinal)).toEqual([0, 1, 2, 3, 4, 5, 6, 7])
    expect(imported.warnings).toHaveLength(0)

    const byKey = new Map(imported.segments.map((s) => [s.key, s]))
    // 引号内逗号是字段内容，不是分隔符
    expect(byKey.get('dlg.guard.gate')?.source).toBe('Halt! State your business, traveler.')
    expect(byKey.get('dlg.guard.gate')?.target).toBe('站住！说明你的来意，旅人。')
    expect(byKey.get('dlg.guard.gate')?.status).toBe('translated')
    expect(byKey.get('dlg.guard.gate')?.context?.note).toBe('Gate guard opening line; speaker: Guard')
    // 引号内嵌入换行（source 与 target 均保留 \n）
    expect(byKey.get('dlg.arya.intro')?.source).toBe("I'm Arya, a traveling merchant.\nNice to meet you.")
    expect(byKey.get('dlg.arya.intro')?.target).toBe('我是阿雅，一名旅行商人。\n很高兴认识你。')
    // `""` 转义为字面双引号
    expect(byKey.get('dlg.arya.shop')?.source).toBe(`Everything's for sale, friend — even this "lucky" charm.`)
    // 空 target => '' + untranslated
    expect(byKey.get('dlg.guard.bribe')?.target).toBe('')
    expect(byKey.get('dlg.guard.bribe')?.status).toBe('untranslated')
    // locked=yes => locked 段；锁定时 target 原样读取
    const eula = byKey.get('legal.eula')
    expect(eula?.locked).toBe(true)
    expect(eula?.target).toBe('© 2026 Fictional Studio. All rights reserved.')
    // source 内混排 CJK 原样保留
    expect(byKey.get('dlg.ghost.whisper')?.source).toBe('…you shouldn\'t be here, 凡人。')
  })

  test('显式列映射覆盖别名；映射名不在表头 => FormatParseError', async () => {
    const text = 'UniqueKey,ZH,EN,Lock,Comment\nu1,你好,Hello,yes,a note\nu2,世界,World,no,\n'
    const adapter = new CsvAdapter({
      columns: { key: 'UniqueKey', source: 'ZH', target: 'EN', locked: 'Lock', context: 'Comment' },
    })
    const imported = await importBytes(encode(text), 'explicit.csv', adapter)
    const byKey = new Map(imported.segments.map((s) => [s.key, s]))
    expect(byKey.get('u1')?.source).toBe('你好')
    expect(byKey.get('u1')?.target).toBe('Hello')
    expect(byKey.get('u1')?.locked).toBe(true)
    expect(byKey.get('u1')?.context?.note).toBe('a note')
    expect(byKey.get('u2')?.locked).toBe(false)

    const bad = new CsvAdapter({ columns: { source: 'does_not_exist' } })
    await expect(importBytes(encode(text), 'explicit.csv', bad)).rejects.toBeInstanceOf(FormatParseError)
  })

  test('terminology.csv：term/translation/note 走显式映射（TB 票复用此 fixture）', async () => {
    const adapter = new CsvAdapter({
      columns: { key: 'term', source: 'term', target: 'translation', context: 'note' },
    })
    const { imported } = await importFixture('terminology.csv', adapter)
    expect(imported.asset.segmentCount).toBe(6)
    const byKey = new Map(imported.segments.map((s) => [s.key, s]))
    expect(byKey.get('health potion')?.target).toBe('生命药水')
    expect(byKey.get('health potion')?.context?.note).toBe('Consumable item')
    expect(byKey.get('inventory')?.target).toBe('背包')
    // 默认映射下术语表没有 source 列 => typed error（而非静默导入）
    await expect(importFixture('terminology.csv')).rejects.toBeInstanceOf(FormatParseError)
  })

  test('缺 target 列 => 全部 target "" + untranslated；缺 key 列 => 合成 #row-<ordinal> + warning', async () => {
    const noTarget = await importBytes(encode('key,source\nm.one,Hello\nm.two,World\n'), 'notarget.csv')
    expect(noTarget.segments.map((s) => s.target)).toEqual(['', ''])
    expect(noTarget.segments.every((s) => s.status === 'untranslated')).toBe(true)

    const noKey = await importBytes(encode('source,target\nHello,你好\nWorld,世界\n'), 'nokey.csv')
    expect(noKey.segments.map((s) => s.key)).toEqual(['#row-0', '#row-1'])
    expect(noKey.warnings).toHaveLength(1)
    expect(noKey.warnings[0]?.code).toBe('csv.synthesized_key')

    const emptyKey = await importBytes(encode('key,source\n,Hello\nk2,World\n'), 'emptykey.csv')
    expect(emptyKey.segments[0]?.key).toBe('#row-0')
    expect(emptyKey.warnings[0]?.code).toBe('csv.synthesized_key')
    expect(emptyKey.warnings[0]?.segmentKey).toBe('#row-0')
  })

  test('TSV：tab 分隔 + 引号仍生效；分号 CSV 由表头 sniff 识别', async () => {
    const tsv = 'key\tsource\ttarget\nt.one\tHello\t你好\nt.two\t"Quoted\ttab"\t已翻译\n'
    const tsvImport = await importBytes(encode(tsv), 'strings.tsv')
    expect(tsvImport.segments).toHaveLength(2)
    expect(tsvImport.segments[1]?.source).toBe('Quoted\ttab')
    expect(tsvImport.segments[1]?.target).toBe('已翻译')

    const semi = 'key;source;target\ns.one;Hello;Hallo\ns.two;World;Welt\n'
    const semiImport = await importBytes(encode(semi), 'semicolons.csv')
    expect(semiImport.segments.map((s) => s.key)).toEqual(['s.one', 's.two'])
    expect(semiImport.segments[1]?.target).toBe('Welt')
  })

  test('UTF-8 BOM 被剥离（不进段文本）；CRLF 与引号内 CRLF 正确解析', async () => {
    const bom = await importBytes(encode('\uFEFFkey,source,target\nb.one,Hi,你好\n'), 'bom.csv')
    expect(bom.segments[0]?.key).toBe('b.one')
    expect(bom.segments[0]?.source).toBe('Hi')

    const crlf = 'key,source,target\r\nc.one,"line1\r\nline2",x\r\nc.two,plain,\r\n'
    const crlfImport = await importBytes(encode(crlf), 'crlf.csv')
    expect(crlfImport.segments).toHaveLength(2)
    expect(crlfImport.segments[0]?.source).toBe('line1\r\nline2')
    expect(crlfImport.segments[1]?.key).toBe('c.two')
  })
})

describe('CsvAdapter round-trip（assertRoundTrip harness）', () => {
  test('mini_dialogue.csv：字节稳定 + 修改子集写回（锁定段不被 harness 修改）', async () => {
    const report = await assertRoundTrip(new CsvAdapter(), fixtureBytes('mini_dialogue.csv'), {
      filename: 'mini_dialogue.csv',
      sourceLocale: 'en-US',
      targetLocale: 'zh-CN',
    })
    // 8 段中 even-index 4 段里 legal.eula（index 6）锁定被跳过 => 3 段被修改
    expect(report.segmentCount).toBe(8)
    expect(report.modifiedSegmentIds).toHaveLength(3)
    const out = new TextDecoder().decode(report.exportedBytes)
    // 修改后含逗号/换行的 target 被正确加引号且可重解析（harness 已逐段比对）
    expect(out).toContain('"[zh-CN] Halt! State your business, traveler."')
    expect(out).toContain('"[zh-CN] I\'m Arya, a traveling merchant.\nNice to meet you."')
    // 未修改行逐字节不动（含锁定行的 locked=yes 列与原始引号风格）
    expect(out).toContain('legal.eula,© 2026 Fictional Studio. All rights reserved.,© 2026 Fictional Studio. All rights reserved.,yes,Locked legal string; do not translate')
    expect(out).toContain('"A bribe? How dare you!"')
  })

  test('TSV 与 CRLF/BOM 变体经同一 adapter 往返（字节稳定）', async () => {
    const tsv = 'key\tsource\ttarget\nt.one\tHello, world\t你好\nt.two\t"Multi\nline"\t\n'
    const tsvReport = await assertRoundTrip(new CsvAdapter(), encode(tsv), {
      filename: 'sample.tsv',
      sourceLocale: 'en-US',
      targetLocale: 'zh-CN',
    })
    expect(tsvReport.segmentCount).toBe(2)

    const crlfBom = '\uFEFFkey,source,target,locked\r\nb.one,"A, B",甲,\r\nb.two,"x\r\ny",乙,\r\nb.three,locked,锁,yes\r\n'
    const crlfReport = await assertRoundTrip(new CsvAdapter(), encode(crlfBom), {
      filename: 'crlf_bom.csv',
      sourceLocale: 'en-US',
      targetLocale: 'zh-CN',
    })
    expect(crlfReport.segmentCount).toBe(3)
    expect(crlfReport.modifiedSegmentIds).toHaveLength(1) // index 2 锁定被跳过
  })

  test('未修改导出逐字节等于原始字节（含 BOM 与 CRLF 的显式抽查）', async () => {
    const { adapter, bytes, imported } = await importFixture('mini_dialogue.csv')
    const { asset, segments } = await boundSegments('mini_dialogue.csv', imported)
    const exported = await adapter.export({ originalBytes: bytes, asset, segments })
    expect(Buffer.from(exported).equals(Buffer.from(bytes))).toBe(true)

    const bomBytes = encode('\uFEFFkey,source,target\r\nb.one,Hi,你好\r\n')
    const bomImport = await importBytes(bomBytes, 'bom.csv')
    const bound = await boundSegments('bom.csv', bomImport)
    const bomExported = await adapter.export({ originalBytes: bomBytes, asset: bound.asset, segments: bound.segments })
    expect(Buffer.from(bomExported).equals(Buffer.from(bomBytes))).toBe(true)
  })

  test('短行（缺 target 单元格）修改后在记录末尾补写；导出可被重新导入', async () => {
    const bytes = encode('key,source,target\ns.one,Hello\ns.two,World,世界\n')
    const adapter = new CsvAdapter()
    const imported = await importBytes(bytes, 'short.csv', adapter)
    expect(imported.segments[0]?.target).toBe('')
    const { asset, segments } = await boundSegments('short.csv', imported)
    const edited = segments.map((s) => (s.key === 's.one' ? { ...s, target: '你好，世界' } : s))
    const exported = await adapter.export({ originalBytes: bytes, asset, segments: edited })
    const out = new TextDecoder().decode(exported)
    expect(out).toBe('key,source,target\ns.one,Hello,你好，世界\ns.two,World,世界\n')
    const reimported = await importBytes(exported, 'short.csv', adapter)
    expect(reimported.segments[0]?.target).toBe('你好，世界')
    expect(reimported.segments[1]?.target).toBe('世界')
  })
})

describe('CsvAdapter 错误路径（typed errors）', () => {
  test('畸形输入 => FormatParseError（FORMAT_PARSE_ERROR），绝不部分静默导入', async () => {
    const adapter = new CsvAdapter()
    const cases: Array<[string, Uint8Array]> = [
      ['empty.csv', encode('')],
      ['header-only.csv', encode('key,source,target\n')],
      ['single-column.csv', encode('justone\nx\ny\n')],
      ['unclosed-quote.csv', encode('key,source,target\nx.one,"unclosed\nstill open\n')],
      ['after-quote.csv', encode('key,source\nx.one,"ab"cd\n')],
      ['too-many-fields.csv', encode('key,source\nx.one,a,b\n')],
      ['dup-key.csv', encode('key,source\nx.one,a\nx.one,b\n')],
      ['no-source.csv', encode('key,foo\nx.one,a\n')],
      ['bad-utf8.csv', new Uint8Array([0xff, 0xfe, 0x2c])],
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
  })

  test('导出拒绝未知 key / 缺失段 / 源文被篡改 / 锁定段被改 / 重复 key => FormatExportError', async () => {
    const { adapter, bytes, imported } = await importFixture('mini_dialogue.csv')
    const { asset, segments } = await boundSegments('mini_dialogue.csv', imported)

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
    const bytes = encode('key,source\nm.one,Hello\n')
    const adapter = new CsvAdapter()
    const imported = await importBytes(bytes, 'notarget.csv', adapter)
    const { asset, segments } = await boundSegments('notarget.csv', imported)
    const unmodified = await adapter.export({ originalBytes: bytes, asset, segments })
    expect(Buffer.from(unmodified).equals(Buffer.from(bytes))).toBe(true)
    const edited = segments.map((s) => ({ ...s, target: '你好' }))
    await expect(adapter.export({ originalBytes: bytes, asset, segments: edited })).rejects.toBeInstanceOf(FormatExportError)
  })
})
