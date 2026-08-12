/**
 * PhraseMxliffAdapter tests (PB-087, Phrase/Memsource MXLIFF leg).
 *
 * Synthetic fixtures only: the MXLIFF fixture shapes are constructed inline,
 * adapted from the legacy repo's synthetic fixture in
 * tests/phrase_mxliff.test.ts (registered in SOURCE_PROVENANCE.md) — no
 * customer content. Plain-XLIFF fixtures (mini_game_ui.xliff,
 * sample.mqxliff) are reused for the detect non-contention assertions.
 */

import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createAsset, createProject, createSeededEntropy, type Segment } from '@linguist/cat-core'
import { bindImportedSegments, CatFormatRegistry, FormatExportError, FormatParseError } from '../index'
import { assertRoundTrip } from '../testing/index'
import {
  PhraseMxliffAdapter,
  probePhraseMasterPair,
  serializePhraseMxliffFormatConfig,
} from './phrasemxliff'
import { SdlXliffAdapter } from './sdlxliff'
import { XliffAdapter } from './xliff'
import { MqXliffAdapter } from './mqxliff'

const FIXTURES = join(import.meta.dir, '../../../../tests/linguist-fixtures')

function fixtureBytes(name: string): Uint8Array {
  return new Uint8Array(readFileSync(join(FIXTURES, name)))
}

/**
 * 合成 MXLIFF：group/context（x-key-note）+ m: 属性族全覆盖——
 * job:1 confirmed="1"（translated）+ {n} 占位符 + group note；
 * job:2 confirmed="2"（reviewed）；job:3 m:locked + confirmed="0"（draft）；
 * job:4 translate="no" + confirmed="false"；job:5 无 confirmed（draft）；
 * job:6 无 confirmed 但 state="final"（reviewed，state 回退偏差）+ tu note；
 * job:7 无 <target>（untranslated）+ resname。
 */
const MXLIFF_FIXTURE = `<?xml version="1.0" encoding="utf-8"?>
<xliff xmlns="urn:oasis:names:tc:xliff:document:1.2" xmlns:m="http://www.memsource.com/mxlf/2.0" version="1.2">
  <file original="demo.xlsx" source-language="zh-CN" target-language="en-US">
    <body>
      <group id="1" m:para-id="1">
        <context-group>
          <context context-type="x-key">1001</context>
          <context context-type="x-key-note">Sheet: Demo!F1</context>
        </context-group>
        <trans-unit id="job:1" m:para-id="1" m:locked="false" m:confirmed="1" m:trans-origin="TM">
          <source>获得{1}30%攻击速度{2}。</source>
          <target>Gain {1}30% Attack Speed{2}.</target>
        </trans-unit>
      </group>
      <group id="2" m:para-id="2">
        <trans-unit id="job:2" m:para-id="2" m:confirmed="2">
          <source>审核通过句</source>
          <target>Reviewed sentence</target>
        </trans-unit>
      </group>
      <group id="3" m:para-id="3">
        <trans-unit id="job:3" m:para-id="3" m:locked="true" m:confirmed="0">
          <source>锁定句</source>
          <target>Locked sentence</target>
        </trans-unit>
      </group>
      <trans-unit id="job:4" translate="no" m:confirmed="false">
        <source>品牌名</source>
        <target>BrandName</target>
      </trans-unit>
      <trans-unit id="job:5" m:confirmed="0">
        <source>草稿句</source>
        <target>Draft sentence</target>
      </trans-unit>
      <trans-unit id="job:6">
        <source>终态句</source>
        <target state="final">Final sentence</target>
        <note>tu-level note</note>
      </trans-unit>
      <trans-unit id="job:7" resname="res-7">
        <source>未译句</source>
      </trans-unit>
    </body>
  </file>
</xliff>`

/** 最小 SDLXLIFF 字节（仅用于 detect 不互抢断言）。 */
const SDL_BYTES = new TextEncoder().encode(
  '<?xml version="1.0"?><xliff xmlns:sdl="http://sdl.com/FileTypes/SdlXliff/1.0" version="1.2"><file><body><trans-unit id="a"><source>x</source></trans-unit></body></file></xliff>',
)

function phraseBytes(): Uint8Array {
  return new TextEncoder().encode(MXLIFF_FIXTURE)
}

async function importPhrase(bytes: Uint8Array, filename = 'sample.mxliff', sourceLocale = 'zh-CN', targetLocale = 'en-US') {
  const adapter = new PhraseMxliffAdapter()
  const imported = await adapter.import({ bytes, filename, sourceLocale, targetLocale })
  return { adapter, imported }
}

const NOW = '2026-01-01T00:00:00.000Z'

/** Binds imported segments to a deterministic asset (same pattern as sdlxliff.test.ts). */
async function boundSegments(filename: string, imported: Awaited<ReturnType<PhraseMxliffAdapter['import']>>) {
  const project = createProject(
    { name: 'phrase-mxliff-test', sourceLocale: 'zh-CN', targetLocale: 'en-US', promaWorkspaceId: 'phrase-mxliff-test' },
    { entropy: createSeededEntropy(`phrase-mxliff-test:${filename}`), now: NOW },
  )
  const asset = createAsset({
    projectId: project.id,
    formatId: imported.asset.formatId,
    originalFilename: filename,
    sourceSha256: imported.asset.sourceSha256,
    segmentCount: imported.asset.segmentCount,
    ...(imported.asset.formatConfigJson === undefined ? {} : { formatConfigJson: imported.asset.formatConfigJson }),
  })
  return { asset, segments: bindImportedSegments(imported.segments, asset.id) }
}

describe('PhraseMxliffAdapter detect（置信度设计：phrase 走 phrase 路径，plain xliff/mq/sdl 不误判）', () => {
  test('m: 命名空间优先；无 m: 命名空间的 .mxliff 不接管', async () => {
    const adapter = new PhraseMxliffAdapter()
    const bytes = phraseBytes()
    expect(await adapter.detect(bytes, 'sample.mxliff')).toBe(1)
    expect(await adapter.detect(bytes, 'renamed.bin')).toBe(0.95)
    expect(await adapter.detect(bytes, 'renamed.xliff')).toBe(0.95)
    expect(await adapter.detect(fixtureBytes('mini_game_ui.xliff'), 'fake.mxliff')).toBe(0)
    expect(await adapter.detect(fixtureBytes('mini_game_ui.xliff'), 'mini_game_ui.xliff')).toBe(0)
    expect(await adapter.detect(fixtureBytes('sample.mqxliff'), 'sample.mqxliff')).toBe(0)
    expect(await adapter.detect(SDL_BYTES, 'sample.sdlxliff')).toBe(0)
    expect(await adapter.detect(new TextEncoder().encode('plain text'), 'a.mxliff')).toBe(0)
    expect(await adapter.detect(new Uint8Array([0, 1, 2, 60]), 'a.mxliff')).toBe(0)
  })

  test('registry 层不互抢：phrase 归 phrase，.xliff/.mqxliff 归 xliff，.sdlxliff 归 sdl，改名文件按置信度路由', async () => {
    const registry = new CatFormatRegistry()
      .register(new MqXliffAdapter())
      .register(new XliffAdapter())
      .register(new SdlXliffAdapter())
      .register(new PhraseMxliffAdapter())
    const phrase = phraseBytes()
    expect((await registry.detectBest(phrase, 'sample.mxliff')).id).toBe('phrase_mxliff_1_2')
    expect((await registry.detectBest(fixtureBytes('mini_game_ui.xliff'), 'mini_game_ui.xliff')).id).toBe('xliff_1_2')
    expect((await registry.detectBest(fixtureBytes('sample.mqxliff'), 'sample.mqxliff')).id).toBe('mqxliff_1_2')
    expect((await registry.detectBest(SDL_BYTES, 'sample.sdlxliff')).id).toBe('sdlxliff_1_2')
    // 厂商内容优先于文件扩展名。
    expect((await registry.detectBest(phrase, 'renamed.bin')).id).toBe('phrase_mxliff_1_2')
    expect((await registry.detectBest(phrase, 'renamed.xliff')).id).toBe('phrase_mxliff_1_2')
    await expect(
      registry.detectBest(fixtureBytes('mini_game_ui.xliff'), 'fake.mxliff'),
    ).rejects.toThrow(/No format adapter accepts/)
  })
})

describe('PhraseMxliffAdapter import（扁平 trans-unit / m:locked / m:confirmed 状态映射）', () => {
  test('一段一 trans-unit：key=id，{n} 占位符与 inline 内容逐字保留', async () => {
    const { imported } = await importPhrase(phraseBytes())
    expect(imported.asset.formatId).toBe('phrase_mxliff_1_2')
    expect(imported.asset.segmentCount).toBe(7)
    expect(imported.segments.map((s) => s.ordinal)).toEqual([0, 1, 2, 3, 4, 5, 6])
    expect(imported.segments.map((s) => s.key)).toEqual(['job:1', 'job:2', 'job:3', 'job:4', 'job:5', 'job:6', 'job:7'])
    const byKey = new Map(imported.segments.map((s) => [s.key, s]))
    expect(byKey.get('job:1')?.source).toBe('获得{1}30%攻击速度{2}。')
    expect(byKey.get('job:1')?.target).toBe('Gain {1}30% Attack Speed{2}.')
  })

  test('m:locked / translate="no" => Segment.locked；m:locked="false" 不锁', async () => {
    const { imported } = await importPhrase(phraseBytes())
    const byKey = new Map(imported.segments.map((s) => [s.key, s]))
    expect(byKey.get('job:3')?.locked).toBe(true) // m:locked="true"
    expect(byKey.get('job:4')?.locked).toBe(true) // translate="no"
    expect(byKey.get('job:1')?.locked).toBe(false) // m:locked="false"
    expect(byKey.get('job:2')?.locked).toBe(false)
    expect(byKey.get('job:7')?.locked).toBe(false)
  })

  test('m:confirmed => status：1=>translated，>=2=>reviewed，0/false 不算确认；空 target=>untranslated', async () => {
    const { imported } = await importPhrase(phraseBytes())
    const byKey = new Map(imported.segments.map((s) => [s.key, s]))
    expect(byKey.get('job:1')?.status).toBe('translated') // m:confirmed="1"
    expect(byKey.get('job:2')?.status).toBe('reviewed') // m:confirmed="2"（工作流步骤 >=2）
    expect(byKey.get('job:3')?.status).toBe('draft') // m:confirmed="0" 非真值
    expect(byKey.get('job:4')?.status).toBe('draft') // m:confirmed="false" 非真值
    expect(byKey.get('job:5')?.status).toBe('draft') // 无 confirmed，非空 target
    expect(byKey.get('job:6')?.status).toBe('reviewed') // state="final"（state 回退偏差）
    expect(byKey.get('job:7')?.status).toBe('untranslated')
    expect(byKey.get('job:7')?.target).toBe('')
  })

  test('非数字 m:confirmed（"true"）=> translated（保守归入译员确认档）', async () => {
    const xml = `<?xml version="1.0"?>
<xliff xmlns:m="http://www.memsource.com/mxlf/2.0" version="1.2"><file><body>
  <trans-unit id="job:t" m:confirmed="true"><source>甲</source><target>Alpha</target></trans-unit>
</body></file></xliff>`
    const { imported } = await importPhrase(new TextEncoder().encode(xml))
    expect(imported.segments[0]?.status).toBe('translated')
  })

  test('context：tu <note> 优先，其次 group x-key-note；resname => context.origin', async () => {
    const { imported } = await importPhrase(phraseBytes())
    const byKey = new Map(imported.segments.map((s) => [s.key, s]))
    expect(byKey.get('job:1')?.context?.note).toBe('Sheet: Demo!F1') // group x-key-note
    expect(byKey.get('job:6')?.context?.note).toBe('tu-level note') // tu <note> 优先
    expect(byKey.get('job:7')?.context?.origin).toBe('res-7')
    expect(byKey.get('job:2')?.context).toBeUndefined()
  })

  test('缺 id/resname => 合成 key + warning', async () => {
    const missingId = `<?xml version="1.0"?>
<xliff xmlns:m="http://www.memsource.com/mxlf/2.0" version="1.2"><file><body>
  <trans-unit><source>no id here</source></trans-unit>
</body></file></xliff>`
    const { imported } = await importPhrase(new TextEncoder().encode(missingId))
    expect(imported.segments[0]?.key).toBe('#tu-0')
    expect(imported.warnings).toHaveLength(1)
    expect(imported.warnings[0]?.code).toBe('phrase_mxliff.missing_id')
  })
})

describe('PhraseMxliffAdapter round-trip（assertRoundTrip harness）', () => {
  test('split + master 按 x-key/源文/占位符绑定，编辑显示真实 Tag 且导出恢复 {n}', async () => {
    const split = phraseBytes()
    const master = new TextEncoder().encode(`<?xml version="1.0"?>
<xliff version="1.2"><file><body>
  <trans-unit id="1001"><source>获得&lt;color=#ffffff&gt;30%攻击速度&lt;/color&gt;。</source></trans-unit>
</body></file></xliff>`)
    const probe = await probePhraseMasterPair(split, 'split.mxliff', master, 'master.xliff')
    expect(probe.config.matchedSegments).toBe(1)
    expect(probe.config.unmatchedSegments).toBe(0)
    const formatConfigJson = serializePhraseMxliffFormatConfig(probe.config)
    const adapter = new PhraseMxliffAdapter()
    const imported = await adapter.import({
      bytes: split,
      filename: 'split.mxliff',
      sourceLocale: 'zh-CN',
      targetLocale: 'en-US',
      formatConfigJson,
    })
    expect(imported.segments[0]?.source).toBe('获得<color=#ffffff>30%攻击速度</color>。')
    const { asset, segments } = await boundSegments('split.mxliff', imported)
    const unchanged = await adapter.export({ originalBytes: split, asset, segments })
    expect(Buffer.from(unchanged).equals(Buffer.from(split))).toBe(true)
    const edited = segments.map((segment, index) => index === 0
      ? { ...segment, target: 'Gain <color=#ffffff>30% Attack Speed</color>.' }
      : segment)
    const exported = await adapter.export({ originalBytes: split, asset, segments: edited })
    expect(new TextDecoder().decode(exported)).toContain('Gain {1}30% Attack Speed{2}.')
    const reimported = await adapter.import({
      bytes: exported,
      filename: 'split.mxliff',
      sourceLocale: 'zh-CN',
      targetLocale: 'en-US',
      formatConfigJson,
    })
    expect(reimported.segments[0]?.target).toBe('Gain <color=#ffffff>30% Attack Speed</color>.')
  })

  test('混合 fixture：字节稳定 + 修改子集写回 + 锁定段不动 + m: 元数据不回写', async () => {
    const report = await assertRoundTrip(new PhraseMxliffAdapter(), phraseBytes(), {
      filename: 'sample.mxliff',
      sourceLocale: 'zh-CN',
      targetLocale: 'en-US',
      invariants: [
        {
          name: 'placeholder set preserved',
          assert: (before: Segment, after: Segment) => {
            const placeholders = (v: string) => (v.match(/\{\d+\}/g) ?? []).join('|')
            if (placeholders(after.source) !== placeholders(before.source)) {
              throw new Error('source placeholders changed')
            }
          },
        },
      ],
    })
    // 7 段中 index 0/4/6 被改（job:1/job:5/job:7），index 2（job:3）锁定跳过
    expect(report.segmentCount).toBe(7)
    expect(report.modifiedSegmentIds).toHaveLength(3)
    const out = new TextDecoder().decode(report.exportedBytes)
    // 修改的 target 只重写元素，{n} 占位符逐字，非空补 state="translated"
    expect(out).toContain('<target state="translated">[en-US] 获得{1}30%攻击速度{2}。</target>')
    expect(out).toContain('<target state="translated">[en-US] 草稿句</target>')
    // job:7 原本没有 <target>：在 </source> 后创建
    expect(out).toContain('<source>未译句</source><target state="translated">[en-US] 未译句</target>')
    // 锁定段字节不动
    expect(out).toContain('<target>Locked sentence</target>')
    expect(out).toContain('m:locked="true"')
    expect(out).toContain('<target>BrandName</target>')
    // m: 元数据不回写（confirmed 保持原值，绝不新增 modified-at/level-edited）
    expect(out).toContain('m:confirmed="1"')
    expect(out).toContain('m:confirmed="2"')
    expect(out).not.toContain('m:modified-at')
    expect(out).not.toContain('m:level-edited')
  })

  test('未修改导出逐字节等于原始字节（byte-stable 显式抽查）', async () => {
    const bytes = phraseBytes()
    const { adapter, imported } = await importPhrase(bytes)
    const { asset, segments } = await boundSegments('sample.mxliff', imported)
    const exported = await adapter.export({ originalBytes: bytes, asset, segments })
    expect(Buffer.from(exported).equals(Buffer.from(bytes))).toBe(true)
  })

  test('自闭合 <target/> 修改后展开成完整元素并补 state', async () => {
    const xml = `<?xml version="1.0"?>
<xliff xmlns:m="http://www.memsource.com/mxlf/2.0" version="1.2"><file><body>
  <trans-unit id="job:e" m:para-id="9"><source>空自闭合</source><target/></trans-unit>
</body></file></xliff>`
    const bytes = new TextEncoder().encode(xml)
    const { adapter, imported } = await importPhrase(bytes, 'selfclosing.mxliff')
    expect(imported.segments[0]?.status).toBe('untranslated')
    const { asset, segments } = await boundSegments('selfclosing.mxliff', imported)
    const edited = segments.map((s) => ({ ...s, target: 'Empty expanded' }))
    const out = new TextDecoder().decode(await adapter.export({ originalBytes: bytes, asset, segments: edited }))
    expect(out).toContain('<target state="translated">Empty expanded</target>')
    // m:para-id 等 trans-unit 属性字节不动
    expect(out).toContain('<trans-unit id="job:e" m:para-id="9">')
  })
})

describe('PhraseMxliffAdapter 错误路径（typed errors）', () => {
  test('畸形输入 => FormatParseError', async () => {
    const adapter = new PhraseMxliffAdapter()
    const cases: Array<[string, Uint8Array]> = [
      ['not-xml.mxliff', new TextEncoder().encode('this is not xml at all')],
      ['v2.mxliff', new TextEncoder().encode('<?xml version="1.0"?><xliff xmlns:m="http://www.memsource.com/mxlf/2.0" version="2.0"><file id="f1"><unit id="u1"><segment><source>hi</source></segment></unit></file></xliff>')],
      ['empty.mxliff', new TextEncoder().encode('<?xml version="1.0"?><xliff xmlns:m="http://www.memsource.com/mxlf/2.0" version="1.2"><file><body></body></file></xliff>')],
      ['dup-key.mxliff', new TextEncoder().encode('<xliff xmlns:m="http://www.memsource.com/mxlf/2.0" version="1.2"><file><body><trans-unit id="a"><source>一</source></trans-unit><trans-unit id="a"><source>二</source></trans-unit></body></file></xliff>')],
      ['no-source.mxliff', new TextEncoder().encode('<xliff xmlns:m="http://www.memsource.com/mxlf/2.0" version="1.2"><file><body><trans-unit id="a"><target>only target</target></trans-unit></body></file></xliff>')],
      ['bad-utf8.mxliff', new Uint8Array([0xff, 0xfe, 0x3c])],
    ]
    for (const [filename, bytes] of cases) {
      let caught: unknown
      try {
        await adapter.import({ bytes, filename, sourceLocale: 'zh-CN', targetLocale: 'en-US' })
      } catch (err) {
        caught = err
      }
      expect(caught, filename).toBeInstanceOf(FormatParseError)
      expect((caught as FormatParseError).code).toBe('FORMAT_PARSE_ERROR')
    }
  })

  test('导出拒绝未知 key / 缺失段 / 源文被篡改 / 锁定段被改 => FormatExportError，绝不静默跳过', async () => {
    const bytes = phraseBytes()
    const { adapter, imported } = await importPhrase(bytes)
    const { asset, segments } = await boundSegments('sample.mxliff', imported)

    const unknown = [{ ...segments[0]!, key: 'job:99' }, ...segments.slice(1)]
    await expect(adapter.export({ originalBytes: bytes, asset, segments: unknown })).rejects.toBeInstanceOf(FormatExportError)

    await expect(adapter.export({ originalBytes: bytes, asset, segments: segments.slice(1) })).rejects.toBeInstanceOf(FormatExportError)

    const tamperedSource = segments.map((s, i) => (i === 0 ? { ...s, source: 'MUTATED' } : s))
    await expect(adapter.export({ originalBytes: bytes, asset, segments: tamperedSource })).rejects.toBeInstanceOf(FormatExportError)

    for (const lockedKey of ['job:3', 'job:4']) {
      const tamperedLocked = segments.map((s) => (s.key === lockedKey ? { ...s, target: 'MUTATED' } : s))
      let lockedErr: unknown
      try {
        await adapter.export({ originalBytes: bytes, asset, segments: tamperedLocked })
      } catch (err) {
        lockedErr = err
      }
      expect(lockedErr, lockedKey).toBeInstanceOf(FormatExportError)
      expect((lockedErr as FormatExportError).code).toBe('FORMAT_EXPORT_ERROR')
      expect((lockedErr as FormatExportError).message).toContain('locked')
    }
  })

  test('重复 key 的导出输入 => FormatExportError', async () => {
    const bytes = phraseBytes()
    const { adapter, imported } = await importPhrase(bytes)
    const { asset, segments } = await boundSegments('sample.mxliff', imported)
    const dup = [...segments, { ...segments[0]! }]
    await expect(adapter.export({ originalBytes: bytes, asset, segments: dup })).rejects.toBeInstanceOf(FormatExportError)
  })
})
