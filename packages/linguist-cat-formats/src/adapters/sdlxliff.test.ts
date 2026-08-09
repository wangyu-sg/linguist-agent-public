/**
 * SdlXliffAdapter tests (PB-086, Trados SDLXLIFF leg).
 *
 * Synthetic fixtures only: the segmented SDLXLIFF fixture shapes are
 * constructed inline, adapted from the legacy repo's synthetic fixture in
 * tests/sdlxliff.test.ts (registered in SOURCE_PROVENANCE.md) — no customer
 * content. Plain-XLIFF fixtures (mini_game_ui.xliff, sample.mqxliff) are
 * reused for the detect non-contention assertions.
 */

import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createAsset, createProject, createSeededEntropy, type Segment } from '@linguist/cat-core'
import { bindImportedSegments, CatFormatRegistry, FormatExportError, FormatParseError } from '../index'
import { assertRoundTrip } from '../testing/index'
import { SdlXliffAdapter } from './sdlxliff'
import { XliffAdapter } from './xliff'
import { MqXliffAdapter } from './mqxliff'

const FIXTURES = join(import.meta.dir, '../../../../tests/linguist-fixtures')

function fixtureBytes(name: string): Uint8Array {
  return new Uint8Array(readFileSync(join(FIXTURES, name)))
}

/**
 * 分段（seg-source/mrk）+ 非分段混合的合成 SDLXLIFF：
 * mid1 conf=Translated、mid2 locked+ApprovedTranslation、mid3 Draft、
 * mid4 ApprovedSignOff、mid5 translate="no"、tu4 非分段 state="final"、
 * mid6 无 <target>（未译）。
 */
const SDLXLIFF_FIXTURE = `<?xml version="1.0" encoding="utf-8"?>
<xliff xmlns="urn:oasis:names:tc:xliff:document:1.2" xmlns:sdl="http://sdl.com/FileTypes/SdlXliff/1.0" version="1.2">
  <sdl:doc-info>
    <sdl:seg-defs>
      <sdl:seg id="1" conf="Translated"><sdl:value key="modified_on">2026-07-20 10:00:00</sdl:value></sdl:seg>
      <sdl:seg id="2" conf="ApprovedTranslation" locked="true"><sdl:value key="modified_on">2026-07-20 10:00:00</sdl:value></sdl:seg>
      <sdl:seg id="3" conf="Draft"><sdl:value key="modified_on">2026-07-20 10:00:00</sdl:value></sdl:seg>
      <sdl:seg id="4" conf="ApprovedSignOff"><sdl:value key="modified_on">2026-07-20 10:00:00</sdl:value></sdl:seg>
    </sdl:seg-defs>
  </sdl:doc-info>
  <file original="sample.docx" source-language="zh-CN" target-language="en-US">
    <body>
      <trans-unit id="tu1">
        <source>点击开始与锁定文本</source>
        <seg-source><mrk mtype="seg" mid="1">点击 <ph id="1" equiv-text="{0}">{0}</ph> 开始</mrk><mrk mtype="seg" mid="2">锁定文本</mrk></seg-source>
        <target><mrk mtype="seg" mid="1">Click <ph id="1" equiv-text="{0}">{0}</ph> start</mrk><mrk mtype="seg" mid="2">Locked Text</mrk></target>
      </trans-unit>
      <trans-unit id="tu2">
        <source>草稿与签发</source>
        <seg-source><mrk mtype="seg" mid="3">草稿句</mrk><mrk mtype="seg" mid="4">签发句</mrk></seg-source>
        <target><mrk mtype="seg" mid="3">Draft sentence</mrk><mrk mtype="seg" mid="4">Signed off</mrk></target>
      </trans-unit>
      <trans-unit id="tu3" translate="no">
        <source>品牌名</source>
        <seg-source><mrk mtype="seg" mid="5">品牌名</mrk></seg-source>
        <target><mrk mtype="seg" mid="5">BrandName</mrk></target>
      </trans-unit>
      <trans-unit id="tu4">
        <source>Plain unit</source>
        <target state="final">Plain target</target>
        <note>tu-level note</note>
      </trans-unit>
      <trans-unit id="tu5">
        <source>未译</source>
        <seg-source><mrk mtype="seg" mid="6">未译句</mrk></seg-source>
      </trans-unit>
    </body>
  </file>
</xliff>`

function sdlBytes(): Uint8Array {
  return new TextEncoder().encode(SDLXLIFF_FIXTURE)
}

async function importSdl(bytes: Uint8Array, filename = 'sample.sdlxliff', sourceLocale = 'zh-CN', targetLocale = 'en-US') {
  const adapter = new SdlXliffAdapter()
  const imported = await adapter.import({ bytes, filename, sourceLocale, targetLocale })
  return { adapter, imported }
}

const NOW = '2026-01-01T00:00:00.000Z'

/** Binds imported segments to a deterministic asset (same pattern as xliff.test.ts). */
async function boundSegments(filename: string, imported: Awaited<ReturnType<SdlXliffAdapter['import']>>) {
  const project = createProject(
    { name: 'sdlxliff-test', sourceLocale: 'zh-CN', targetLocale: 'en-US', promaWorkspaceId: 'sdlxliff-test' },
    { entropy: createSeededEntropy(`sdlxliff-test:${filename}`), now: NOW },
  )
  const asset = createAsset({
    projectId: project.id,
    formatId: imported.asset.formatId,
    originalFilename: filename,
    sourceSha256: imported.asset.sourceSha256,
    segmentCount: imported.asset.segmentCount,
  })
  return { asset, segments: bindImportedSegments(imported.segments, asset.id) }
}

describe('SdlXliffAdapter detect（置信度设计：sdl 走 sdl 路径，plain xliff 不误判）', () => {
  test('sdl 命名空间 + .sdlxliff => 0.95；仅字节 => 0.7；无 sdl 命名空间的 .sdlxliff => 0.4；其余 => 0', async () => {
    const adapter = new SdlXliffAdapter()
    const bytes = sdlBytes()
    expect(await adapter.detect(bytes, 'sample.sdlxliff')).toBe(0.95)
    expect(await adapter.detect(bytes, 'renamed.bin')).toBe(0.7)
    expect(await adapter.detect(bytes, 'renamed.xliff')).toBe(0.7)
    // 无 sdl 命名空间的 .sdlxliff：plain XLIFF 伪装，低分让给 XliffAdapter
    expect(await adapter.detect(fixtureBytes('mini_game_ui.xliff'), 'fake.sdlxliff')).toBe(0.4)
    expect(await adapter.detect(fixtureBytes('mini_game_ui.xliff'), 'mini_game_ui.xliff')).toBe(0)
    expect(await adapter.detect(fixtureBytes('sample.mqxliff'), 'sample.mqxliff')).toBe(0)
    expect(await adapter.detect(new TextEncoder().encode('plain text'), 'a.sdlxliff')).toBe(0)
    expect(await adapter.detect(new Uint8Array([0, 1, 2, 60]), 'a.sdlxliff')).toBe(0)
  })

  test('registry 层不互抢：sdl 文件归 sdl，.xliff/.mqxliff 归 xliff，改名文件按置信度路由', async () => {
    const registry = new CatFormatRegistry().register(new MqXliffAdapter()).register(new XliffAdapter()).register(new SdlXliffAdapter())
    const sdl = sdlBytes()
    expect((await registry.detectBest(sdl, 'sample.sdlxliff')).id).toBe('sdlxliff_1_2')
    expect((await registry.detectBest(fixtureBytes('mini_game_ui.xliff'), 'mini_game_ui.xliff')).id).toBe('xliff_1_2')
    expect((await registry.detectBest(fixtureBytes('sample.mqxliff'), 'sample.mqxliff')).id).toBe('mqxliff_1_2')
    // sdl 字节 + 未知扩展名：0.7 > XliffAdapter 的 0.5 => sdl 路径
    expect((await registry.detectBest(sdl, 'renamed.bin')).id).toBe('sdlxliff_1_2')
    // sdl 字节 + 显式 .xliff 扩展名：0.7 < XliffAdapter 的 0.9 => 尊重扩展名
    expect((await registry.detectBest(sdl, 'renamed.xliff')).id).toBe('xliff_1_2')
    // 无 sdl 命名空间的 .sdlxliff：0.4 < 0.5 => plain XLIFF 处理
    expect((await registry.detectBest(fixtureBytes('mini_game_ui.xliff'), 'fake.sdlxliff')).id).toBe('xliff_1_2')
  })
})

describe('SdlXliffAdapter import（mrk 分段 / sdl locked / conf 状态映射）', () => {
  test('seg-source mrk 拆段：key=mid，aggregate <source> 忽略，inline 标签逐字保留', async () => {
    const { imported } = await importSdl(sdlBytes())
    expect(imported.asset.formatId).toBe('sdlxliff_1_2')
    expect(imported.asset.segmentCount).toBe(7)
    expect(imported.segments.map((s) => s.ordinal)).toEqual([0, 1, 2, 3, 4, 5, 6])
    expect(imported.segments.map((s) => s.key)).toEqual(['1', '2', '3', '4', '5', 'tu4', '6'])
    const byKey = new Map(imported.segments.map((s) => [s.key, s]))
    expect(byKey.get('1')?.source).toBe('点击 <ph id="1" equiv-text="{0}">{0}</ph> 开始')
    expect(byKey.get('1')?.target).toBe('Click <ph id="1" equiv-text="{0}">{0}</ph> start')
    expect(byKey.get('3')?.source).toBe('草稿句')
  })

  test('sdl:seg locked / translate="no" => Segment.locked', async () => {
    const { imported } = await importSdl(sdlBytes())
    const byKey = new Map(imported.segments.map((s) => [s.key, s]))
    expect(byKey.get('2')?.locked).toBe(true) // <sdl:seg locked="true">
    expect(byKey.get('5')?.locked).toBe(true) // trans-unit translate="no"
    expect(byKey.get('1')?.locked).toBe(false)
    expect(byKey.get('6')?.locked).toBe(false)
    expect(byKey.get('tu4')?.locked).toBe(false)
  })

  test('conf => status：Translated=>translated，Approved*=>reviewed，Draft=>draft，空 target=>untranslated', async () => {
    const { imported } = await importSdl(sdlBytes())
    const byKey = new Map(imported.segments.map((s) => [s.key, s]))
    expect(byKey.get('1')?.status).toBe('translated') // conf="Translated"
    expect(byKey.get('2')?.status).toBe('reviewed') // conf="ApprovedTranslation"
    expect(byKey.get('3')?.status).toBe('draft') // conf="Draft"
    expect(byKey.get('4')?.status).toBe('reviewed') // conf="ApprovedSignOff"
    expect(byKey.get('5')?.status).toBe('draft') // 无 conf，非空 target
    expect(byKey.get('6')?.status).toBe('untranslated') // 无 target
    expect(byKey.get('6')?.target).toBe('')
  })

  test('非分段 trans-unit：复用 plain XLIFF 状态映射，note=>context.note', async () => {
    const { imported } = await importSdl(sdlBytes())
    const tu4 = imported.segments.find((s) => s.key === 'tu4')
    expect(tu4?.source).toBe('Plain unit')
    expect(tu4?.target).toBe('Plain target')
    expect(tu4?.status).toBe('reviewed') // state="final"
    expect(tu4?.context?.note).toBe('tu-level note')
  })

  test('mrk 缺 mid => import warning + 跳过（字节仍原地往返）；非分段缺 id => 合成 key + warning', async () => {
    const missingMid = `<?xml version="1.0"?>
<xliff xmlns:sdl="http://sdl.com/FileTypes/SdlXliff/1.0" version="1.2"><file><body>
  <trans-unit id="tu1"><source>x</source>
    <seg-source><mrk mtype="seg">无 mid</mrk><mrk mtype="seg" mid="9">有 mid</mrk></seg-source>
    <target><mrk mtype="seg" mid="9">Has mid</mrk></target>
  </trans-unit>
</body></file></xliff>`
    const a = await importSdl(new TextEncoder().encode(missingMid))
    expect(a.imported.segments).toHaveLength(1)
    expect(a.imported.segments[0]?.key).toBe('9')
    expect(a.imported.warnings).toHaveLength(1)
    expect(a.imported.warnings[0]?.code).toBe('sdlxliff.mrk_missing_mid')

    const missingId = `<?xml version="1.0"?>
<xliff xmlns:sdl="http://sdl.com/FileTypes/SdlXliff/1.0" version="1.2"><file><body>
  <trans-unit><source>no id here</source></trans-unit>
</body></file></xliff>`
    const b = await importSdl(new TextEncoder().encode(missingId))
    expect(b.imported.segments[0]?.key).toBe('#tu-0')
    expect(b.imported.warnings[0]?.code).toBe('sdlxliff.missing_id')
  })
})

describe('SdlXliffAdapter round-trip（assertRoundTrip harness）', () => {
  test('混合 fixture：字节稳定 + 修改子集写回 + 锁定段不动 + sdl: 元数据不回写', async () => {
    const report = await assertRoundTrip(new SdlXliffAdapter(), sdlBytes(), {
      filename: 'sample.sdlxliff',
      sourceLocale: 'zh-CN',
      targetLocale: 'en-US',
      invariants: [
        {
          name: 'inline tag set preserved',
          assert: (before: Segment, after: Segment) => {
            const tags = (v: string) => (v.match(/<\/?(?:g|x|ph|bpt|ept)\b[^>]*\/?>/g) ?? []).join('|')
            if (tags(after.source) !== tags(before.source)) throw new Error('source inline tags changed')
          },
        },
      ],
    })
    // 7 段中 index 0/2/6 被改（mid 1/3/6），index 4（mid 5）锁定跳过
    expect(report.segmentCount).toBe(7)
    expect(report.modifiedSegmentIds).toHaveLength(3)
    const out = new TextDecoder().decode(report.exportedBytes)
    // 修改的 mrk 只重写 inner，标签逐字
    expect(out).toContain('<mrk mtype="seg" mid="1">[en-US] 点击 <ph id="1" equiv-text="{0}">{0}</ph> 开始</mrk>')
    expect(out).toContain('<mrk mtype="seg" mid="3">[en-US] 草稿句</mrk>')
    // 锁定段字节不动
    expect(out).toContain('<mrk mtype="seg" mid="2">Locked Text</mrk>')
    expect(out).toContain('<mrk mtype="seg" mid="5">BrandName</mrk>')
    // mid6 原本没有 <target>：在 </seg-source> 后创建
    expect(out).toContain('</seg-source><target><mrk mtype="seg" mid="6">[en-US] 未译句</mrk></target>')
    // sdl: 元数据不回写（conf 保持原值，与 memoQ 策略一致）
    expect(out).toContain('<sdl:seg id="1" conf="Translated">')
    expect(out).toContain('<sdl:seg id="3" conf="Draft">')
    expect(out).not.toContain('conf="translated"')
  })

  test('未修改导出逐字节等于原始字节（byte-stable 显式抽查）', async () => {
    const bytes = sdlBytes()
    const { adapter, imported } = await importSdl(bytes)
    const { asset, segments } = await boundSegments('sample.sdlxliff', imported)
    const exported = await adapter.export({ originalBytes: bytes, asset, segments })
    expect(Buffer.from(exported).equals(Buffer.from(bytes))).toBe(true)
  })

  test('status-only: E 阶段确认在目标文本不变时仍写回 ApprovedTranslation', async () => {
    const bytes = sdlBytes()
    const { adapter, imported } = await importSdl(bytes)
    const { asset, segments } = await boundSegments('sample.sdlxliff', imported)
    const confirmed = segments.map((segment) =>
      segment.key === '1'
        ? { ...segment, currentStageState: 'confirmed' as const }
        : segment,
    )

    const out = new TextDecoder().decode(await adapter.export({
      originalBytes: bytes,
      asset,
      segments: confirmed,
      workflow: { stage: 'editing' },
    }))

    expect(out).toContain('<sdl:seg id="1" conf="ApprovedTranslation">')
    expect(out).toContain('<mrk mtype="seg" mid="1">Click <ph id="1" equiv-text="{0}">{0}</ph> start</mrk>')
    expect(out).toContain('<sdl:seg id="3" conf="Draft">')
  })

  test('本 trans-unit 的 sdl:seg 无 conf 也可确认，且不串改其他 trans-unit 的同 id 定义', async () => {
    const xml = `<?xml version="1.0"?>
<xliff xmlns:sdl="http://sdl.com/FileTypes/SdlXliff/1.0" version="1.2"><file><body>
  <trans-unit id="shadow"><source>shadow</source><target>shadow</target><sdl:seg-defs><sdl:seg id="1" conf="Draft"/></sdl:seg-defs></trans-unit>
  <trans-unit id="real"><source>一</source><seg-source><mrk mtype="seg" mid="1">一</mrk></seg-source><target><mrk mtype="seg" mid="1">One</mrk></target><sdl:seg-defs><sdl:seg id="1"/></sdl:seg-defs></trans-unit>
</body></file></xliff>`
    const bytes = new TextEncoder().encode(xml)
    const { adapter, imported } = await importSdl(bytes, 'local-seg-def.sdlxliff')
    const { asset, segments } = await boundSegments('local-seg-def.sdlxliff', imported)
    const confirmed = segments.map((segment) =>
      segment.key === '1' ? { ...segment, currentStageState: 'confirmed' as const } : segment,
    )

    const out = new TextDecoder().decode(await adapter.export({
      originalBytes: bytes,
      asset,
      segments: confirmed,
      workflow: { stage: 'translation' },
    }))

    expect(out).toContain('<trans-unit id="shadow"><source>shadow</source><target>shadow</target><sdl:seg-defs><sdl:seg id="1" conf="Draft"/>')
    expect(out).toContain('<trans-unit id="real"><source>一</source><seg-source><mrk mtype="seg" mid="1">一</mrk></seg-source><target><mrk mtype="seg" mid="1">One</mrk></target><sdl:seg-defs><sdl:seg id="1" conf="Translated"/>')
  })

  test('T/E/P 阶段确认分别写回 Translated / ApprovedTranslation / ApprovedSignOff', async () => {
    const bytes = sdlBytes()
    const { adapter, imported } = await importSdl(bytes)
    const { asset, segments } = await boundSegments('sample.sdlxliff', imported)
    const cases = [
      ['translation', 'Translated'],
      ['editing', 'ApprovedTranslation'],
      ['proofreading', 'ApprovedSignOff'],
    ] as const

    for (const [stage, expected] of cases) {
      const confirmed = segments.map((segment) =>
        segment.key === '3'
          ? { ...segment, currentStageState: 'confirmed' as const }
          : segment,
      )
      const out = new TextDecoder().decode(await adapter.export({
        originalBytes: bytes,
        asset,
        segments: confirmed,
        workflow: { stage },
      }))
      expect(out).toContain(`<sdl:seg id="3" conf="${expected}">`)
    }
  })

  test('text+status: 同次导出改写目标文本和 E 状态，重新导入保持文本与 reviewed 状态', async () => {
    const bytes = sdlBytes()
    const { adapter, imported } = await importSdl(bytes)
    const { asset, segments } = await boundSegments('sample.sdlxliff', imported)
    const edited = segments.map((segment) =>
      segment.key === '3'
        ? {
            ...segment,
            target: 'Edited sentence',
            currentStageState: 'confirmed' as const,
          }
        : segment,
    )
    const exported = await adapter.export({
      originalBytes: bytes,
      asset,
      segments: edited,
      workflow: { stage: 'editing' },
    })
    const out = new TextDecoder().decode(exported)
    expect(out).toContain('<sdl:seg id="3" conf="ApprovedTranslation">')
    expect(out).toContain('<mrk mtype="seg" mid="3">Edited sentence</mrk>')

    const reimported = await adapter.import({
      bytes: exported,
      filename: 'sample.sdlxliff',
      sourceLocale: 'zh-CN',
      targetLocale: 'en-US',
    })
    const segment = reimported.segments.find((candidate) => candidate.key === '3')
    expect(segment?.target).toBe('Edited sentence')
    expect(segment?.status).toBe('reviewed')
    expect(segment?.importedNativeStatus).toBe('ApprovedTranslation')
  })

  test('target 缺对应 mrk => 在既有 <target> 末尾补 mrk，兄弟 mrk 字节不动', async () => {
    const xml = `<?xml version="1.0"?>
<xliff xmlns:sdl="http://sdl.com/FileTypes/SdlXliff/1.0" version="1.2"><file><body>
  <trans-unit id="tu1"><source>agg</source>
    <seg-source><mrk mtype="seg" mid="1">一</mrk><mrk mtype="seg" mid="2">二</mrk></seg-source>
    <target xml:space="preserve"><mrk mtype="seg" mid="1">One</mrk></target>
  </trans-unit>
</body></file></xliff>`
    const bytes = new TextEncoder().encode(xml)
    const { adapter, imported } = await importSdl(bytes, 'append.sdlxliff')
    expect(imported.segments.find((s) => s.key === '2')?.status).toBe('untranslated')
    const { asset, segments } = await boundSegments('append.sdlxliff', imported)
    const edited = segments.map((s) => (s.key === '2' ? { ...s, target: 'Two' } : s))
    const out = new TextDecoder().decode(await adapter.export({ originalBytes: bytes, asset, segments: edited }))
    expect(out).toContain('<target xml:space="preserve"><mrk mtype="seg" mid="1">One</mrk><mrk mtype="seg" mid="2">Two</mrk></target>')
  })

  test('自闭合 target mrk 原位展开，保留外层 g 与兄弟段顺序', async () => {
    const xml = `<?xml version="1.0"?>
<xliff xmlns:sdl="http://sdl.com/FileTypes/SdlXliff/1.0" version="1.2"><file><body>
  <trans-unit id="tu1"><source>agg</source>
    <seg-source><mrk mtype="seg" mid="1">一</mrk><mrk mtype="seg" mid="2">二</mrk></seg-source>
    <target><g id="10"><mrk mtype="seg" mid="1"/><mrk mtype="seg" mid="2"/></g></target>
  </trans-unit>
</body></file></xliff>`
    const bytes = new TextEncoder().encode(xml)
    const { adapter, imported } = await importSdl(bytes, 'self-closing-mrk.sdlxliff')
    const { asset, segments } = await boundSegments('self-closing-mrk.sdlxliff', imported)
    const edited = segments.map((segment) =>
      segment.key === '2' ? { ...segment, target: 'Two' } : segment,
    )
    const out = new TextDecoder().decode(await adapter.export({ originalBytes: bytes, asset, segments: edited }))
    expect(out).toContain('<g id="10"><mrk mtype="seg" mid="1"/><mrk mtype="seg" mid="2">Two</mrk></g>')
    expect((await adapter.import({
      bytes: new TextEncoder().encode(out),
      filename: 'self-closing-mrk.sdlxliff',
      sourceLocale: 'zh-CN',
      targetLocale: 'en-US',
    })).segments.map((segment) => segment.target)).toEqual(['', 'Two'])
  })

  test('非分段修改：只写 target（非空补 state="translated"），其余字节不动', async () => {
    const bytes = sdlBytes()
    const { adapter, imported } = await importSdl(bytes)
    const { asset, segments } = await boundSegments('sample.sdlxliff', imported)
    const edited = segments.map((s) => (s.key === 'tu4' ? { ...s, target: 'Plain rewritten' } : s))
    const out = new TextDecoder().decode(await adapter.export({ originalBytes: bytes, asset, segments: edited }))
    expect(out).toContain('<target state="translated">Plain rewritten</target>')
    expect(out).toContain('<note>tu-level note</note>')
  })
})

describe('SdlXliffAdapter 错误路径（typed errors）', () => {
  test('畸形输入 => FormatParseError', async () => {
    const adapter = new SdlXliffAdapter()
    const cases: Array<[string, Uint8Array]> = [
      ['not-xml.sdlxliff', new TextEncoder().encode('this is not xml at all')],
      ['v2.sdlxliff', new TextEncoder().encode('<?xml version="1.0"?><xliff xmlns:sdl="http://sdl.com/FileTypes/SdlXliff/1.0" version="2.0"><file id="f1"><unit id="u1"><segment><source>hi</source></segment></unit></file></xliff>')],
      ['empty.sdlxliff', new TextEncoder().encode('<?xml version="1.0"?><xliff xmlns:sdl="http://sdl.com/FileTypes/SdlXliff/1.0" version="1.2"><file><body></body></file></xliff>')],
      ['dup-mid.sdlxliff', new TextEncoder().encode('<xliff xmlns:sdl="http://sdl.com/FileTypes/SdlXliff/1.0" version="1.2"><file><body><trans-unit id="a"><source>x</source><seg-source><mrk mtype="seg" mid="1">一</mrk><mrk mtype="seg" mid="1">二</mrk></seg-source></trans-unit></body></file></xliff>')],
      ['no-source.sdlxliff', new TextEncoder().encode('<xliff xmlns:sdl="http://sdl.com/FileTypes/SdlXliff/1.0" version="1.2"><file><body><trans-unit id="a"><target>only target</target></trans-unit></body></file></xliff>')],
      ['bad-utf8.sdlxliff', new Uint8Array([0xff, 0xfe, 0x3c])],
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
    const bytes = sdlBytes()
    const { adapter, imported } = await importSdl(bytes)
    const { asset, segments } = await boundSegments('sample.sdlxliff', imported)

    const unknown = [{ ...segments[0]!, key: '99' }, ...segments.slice(1)]
    await expect(adapter.export({ originalBytes: bytes, asset, segments: unknown })).rejects.toBeInstanceOf(FormatExportError)

    await expect(adapter.export({ originalBytes: bytes, asset, segments: segments.slice(1) })).rejects.toBeInstanceOf(FormatExportError)

    const tamperedSource = segments.map((s, i) => (i === 0 ? { ...s, source: 'MUTATED' } : s))
    await expect(adapter.export({ originalBytes: bytes, asset, segments: tamperedSource })).rejects.toBeInstanceOf(FormatExportError)

    for (const lockedKey of ['2', '5']) {
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
    const bytes = sdlBytes()
    const { adapter, imported } = await importSdl(bytes)
    const { asset, segments } = await boundSegments('sample.sdlxliff', imported)
    const dup = [...segments, { ...segments[0]! }]
    await expect(adapter.export({ originalBytes: bytes, asset, segments: dup })).rejects.toBeInstanceOf(FormatExportError)
  })
})
