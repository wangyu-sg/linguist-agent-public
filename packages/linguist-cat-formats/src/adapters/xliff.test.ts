/**
 * XliffAdapter tests (PB-023, XLIFF leg).
 *
 * Synthetic fixtures only (tests/linguist-fixtures/): mini_game_ui.xliff,
 * placeholder_cases.xliff, sample.mqxliff (verbatim copy from the legacy
 * repo's synthetic memoQ fixture, registered in SOURCE_PROVENANCE.md).
 */

import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createAsset, createProject, createSeededEntropy, type Segment } from '@linguist/cat-core'
import { bindImportedSegments, FormatExportError, FormatParseError } from '../index'
import { assertRoundTrip } from '../testing/index'
import { XliffAdapter } from './xliff'

const FIXTURES = join(import.meta.dir, '../../../../tests/linguist-fixtures')

function fixtureBytes(name: string): Uint8Array {
  return new Uint8Array(readFileSync(join(FIXTURES, name)))
}

async function importFixture(name: string, sourceLocale = 'en-US', targetLocale = 'zh-CN') {
  const adapter = new XliffAdapter()
  const bytes = fixtureBytes(name)
  const imported = await adapter.import({ bytes, filename: name, sourceLocale, targetLocale })
  return { adapter, bytes, imported }
}

const NOW = '2026-01-01T00:00:00.000Z'

/** Binds imported segments to a deterministic asset (same pattern as the harness). */
async function boundSegments(name: string, adapter: XliffAdapter, imported: Awaited<ReturnType<XliffAdapter['import']>>) {
  const project = createProject(
    { name: 'xliff-test', sourceLocale: 'en-US', targetLocale: 'zh-CN', promaWorkspaceId: 'xliff-test' },
    { entropy: createSeededEntropy(`xliff-test:${name}`), now: NOW },
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

describe('XliffAdapter detect', () => {
  test('扩展名 + 字节骨架 => 0.9；仅字节 => 0.5；非 XLIFF/二进制 => 0', async () => {
    const adapter = new XliffAdapter()
    const bytes = fixtureBytes('mini_game_ui.xliff')
    expect(await adapter.detect(bytes, 'mini_game_ui.xliff')).toBe(0.9)
    expect(await adapter.detect(bytes, 'mini_game_ui.xlf')).toBe(0.9)
    expect(await adapter.detect(fixtureBytes('sample.mqxliff'), 'sample.mqxliff')).toBe(0.5)
    expect(await adapter.detect(bytes, 'renamed.bin')).toBe(0.5)
    expect(await adapter.detect(new TextEncoder().encode('plain text'), 'a.xliff')).toBe(0)
    expect(await adapter.detect(new Uint8Array([0, 1, 2, 60]), 'a.xliff')).toBe(0)
  })
})

describe('XliffAdapter import（结构/标签/锁定/状态）', () => {
  test('mini_game_ui：id→key、note→context.note、状态映射、translate="no"→locked', async () => {
    const { imported } = await importFixture('mini_game_ui.xliff')
    expect(imported.asset.formatId).toBe('xliff_1_2')
    expect(imported.asset.segmentCount).toBe(7)
    const byKey = new Map(imported.segments.map((s) => [s.key, s]))
    expect(byKey.get('menu.start')?.status).toBe('translated')
    expect(byKey.get('menu.start')?.context?.note).toBe('Main menu primary button.')
    expect(byKey.get('menu.options')?.status).toBe('reviewed') // state="final"
    expect(byKey.get('legal.copyright')?.locked).toBe(true) // translate="no"
    expect(byKey.get('legal.copyright')?.status).toBe('reviewed')
    expect(imported.segments.map((s) => s.ordinal)).toEqual([0, 1, 2, 3, 4, 5, 6])
  })

  test('inline 标签（<g>/<x/>/<ph>/<bpt>/<ept>）与 {placeholder} 在段字符串中逐字保留', async () => {
    const { imported } = await importFixture('mini_game_ui.xliff')
    const byKey = new Map(imported.segments.map((s) => [s.key, s]))
    expect(byKey.get('hud.continue')?.source).toBe('Press <g id="1" ctype="bold">Enter</g> to continue')
    expect(byKey.get('hud.continue')?.target).toBe('按 <g id="1" ctype="bold">Enter</g> 继续')
    expect(byKey.get('hud.lives')?.source).toBe('Lives: <x id="1" equiv-text="{lives}"/>')
    expect(byKey.get('hud.score')?.source).toBe('Score: {score}')

    const edge = (await importFixture('placeholder_cases.xliff', 'zh-CN', 'en-US')).imported
    const edgeByKey = new Map(edge.segments.map((s) => [s.key, s]))
    expect(edgeByKey.get('edge.ph')?.source).toBe('获得第<ph id="1" equiv-text="{0}"/>枚徽章！')
    expect(edgeByKey.get('edge.bpt_ept')?.source).toContain('<bpt id="1" ctype="x-html-b">')
    expect(edgeByKey.get('edge.bpt_ept')?.source).toContain('</ept>')
  })

  test('Unicode/CJK、XML 实体与 CDATA 正确解码', async () => {
    const { imported } = await importFixture('placeholder_cases.xliff', 'zh-CN', 'en-US')
    const byKey = new Map(imported.segments.map((s) => [s.key, s]))
    expect(byKey.get('edge.cjk')?.source).toBe('合成占位符：玩家 {player} 获得了「传说之剑」')
    expect(byKey.get('edge.entities')?.source).toBe('Tom & Jerry <hint> score 5 > 3')
    expect(byKey.get('edge.cdata')?.source).toBe('Line A <not-a-tag> & raw "quotes"')
  })

  test('空/缺失 <target> => target "" + status untranslated（含自闭合 <target/>）', async () => {
    const { imported } = await importFixture('placeholder_cases.xliff', 'zh-CN', 'en-US')
    const byKey = new Map(imported.segments.map((s) => [s.key, s]))
    expect(byKey.get('edge.empty_target')?.target).toBe('')
    expect(byKey.get('edge.empty_target')?.status).toBe('untranslated')
    expect(byKey.get('edge.selfclosing_target')?.target).toBe('')
    expect(byKey.get('edge.selfclosing_target')?.status).toBe('untranslated')

    const mini = (await importFixture('mini_game_ui.xliff')).imported
    const welcome = mini.segments.find((s) => s.key === 'player.welcome')
    expect(welcome?.target).toBe('')
    expect(welcome?.status).toBe('untranslated')
  })

  test('resname 兜底为 key（+ context.origin），state-qualifier=reviewed => reviewed', async () => {
    const { imported } = await importFixture('placeholder_cases.xliff', 'zh-CN', 'en-US')
    const segment = imported.segments.find((s) => s.key === 'dialog/quit_confirm')
    expect(segment).toBeDefined()
    expect(segment?.context?.origin).toBe('dialog/quit_confirm')
    expect(segment?.context?.note).toBe('resname-only unit: key falls back to resname.')
    expect(segment?.status).toBe('reviewed')
  })

  test('无 id/resname 的 trans-unit => 合成 #tu-<ordinal> key + import warning', async () => {
    const xml = `<?xml version="1.0"?><xliff version="1.2"><file source-language="en" target-language="zh"><body>
      <trans-unit><source>no id here</source></trans-unit>
    </body></file></xliff>`
    const adapter = new XliffAdapter()
    const imported = await adapter.import({
      bytes: new TextEncoder().encode(xml),
      filename: 'noid.xliff',
      sourceLocale: 'en',
      targetLocale: 'zh',
    })
    expect(imported.segments[0]?.key).toBe('#tu-0')
    expect(imported.warnings).toHaveLength(1)
    expect(imported.warnings[0]?.code).toBe('xliff.missing_id')
  })

  test('MQXLIFF：mq:locked => locked，mq:status 保守映射，<ph> 载荷逐字保留', async () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<xliff version="1.2" xmlns="urn:oasis:names:tc:xliff:document:1.2" xmlns:mq="MQXliff">
  <file original="a.xlsx" source-language="zh-CN" target-language="en-US" datatype="x-synthetic">
    <body>
      <trans-unit id="1" mq:status="ConfirmedTranslator"><source>已确认</source><target>Confirmed</target></trans-unit>
      <trans-unit id="2" mq:status="Proofread"><source>已审校</source><target>Proofread</target></trans-unit>
      <trans-unit id="3" mq:status="PartiallyEdited" mq:locked="true"><source>锁定</source><target>Locked</target></trans-unit>
      <trans-unit id="4" mq:locked="1"><source>也锁定</source><target>Locked2</target></trans-unit>
    </body>
  </file>
</xliff>`
    const adapter = new XliffAdapter()
    const imported = await adapter.import({
      bytes: new TextEncoder().encode(xml),
      filename: 'inline.mqxliff',
      sourceLocale: 'zh-CN',
      targetLocale: 'en-US',
    })
    const byKey = new Map(imported.segments.map((s) => [s.key, s]))
    expect(byKey.get('1')?.status).toBe('translated')
    expect(byKey.get('2')?.status).toBe('reviewed')
    expect(byKey.get('3')?.status).toBe('draft') // PartiallyEdited -> 保守 draft
    expect(byKey.get('3')?.locked).toBe(true)
    expect(byKey.get('4')?.locked).toBe(true)

    const sample = (await importFixture('sample.mqxliff', 'zh-CN', 'en-US')).imported
    const badge = sample.segments.find((s) => s.key === '3')
    expect(badge?.source).toContain('<ph id="1">')
    expect(badge?.source).toContain('{0}')
    expect(sample.segments[0]?.context?.note).toBe('Synthetic fixture note; no customer content.')
  })
})

describe('XliffAdapter round-trip（assertRoundTrip harness）', () => {
  test('mini_game_ui.xliff：字节稳定 + 修改子集写回 + 标签不变量', async () => {
    const report = await assertRoundTrip(new XliffAdapter(), fixtureBytes('mini_game_ui.xliff'), {
      filename: 'mini_game_ui.xliff',
      sourceLocale: 'en-US',
      targetLocale: 'zh-CN',
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
    // 7 段中锁定 1 段（legal.copyright）不被 harness 修改
    expect(report.segmentCount).toBe(7)
    expect(report.modifiedSegmentIds).toHaveLength(3)
    const out = new TextDecoder().decode(report.exportedBytes)
    expect(out).toContain('[zh-CN] Start Game')
    // 未修改段保持原始字节形态（含 state 属性不被改写）
    expect(out).toContain('<target state="final">选项</target>')
  })

  test('placeholder_cases.xliff：实体/CDATA/空 target/自闭合 target/resname 全量往返', async () => {
    const report = await assertRoundTrip(new XliffAdapter(), fixtureBytes('placeholder_cases.xliff'), {
      filename: 'placeholder_cases.xliff',
      sourceLocale: 'zh-CN',
      targetLocale: 'en-US',
    })
    expect(report.segmentCount).toBe(9)
  })

  test('sample.mqxliff：memoQ 变体经同一 adapter 往返', async () => {
    const report = await assertRoundTrip(new XliffAdapter(), fixtureBytes('sample.mqxliff'), {
      filename: 'sample.mqxliff',
      sourceLocale: 'zh-CN',
      targetLocale: 'en-US',
    })
    expect(report.segmentCount).toBe(4)
    const out = new TextDecoder().decode(report.exportedBytes)
    expect(out).toContain('<mq:docinformation') // 模板其余部分字节不动
  })

  test('未修改导出逐字节等于原始字节（byte-stable，harness 默认断言之外的显式抽查）', async () => {
    const { adapter, bytes, imported } = await importFixture('mini_game_ui.xliff')
    const { asset, segments } = await boundSegments('mini_game_ui.xliff', adapter, imported)
    const exported = await adapter.export({ originalBytes: bytes, asset, segments })
    expect(Buffer.from(exported).equals(Buffer.from(bytes))).toBe(true)
  })
})

describe('XliffAdapter 错误路径（typed errors）', () => {
  test('畸形输入 => FormatParseError（FORMAT_PARSE_ERROR）', async () => {
    const adapter = new XliffAdapter()
    const cases: Array<[string, Uint8Array]> = [
      ['not-xml.xliff', new TextEncoder().encode('this is not xml at all')],
      ['v2.xliff', new TextEncoder().encode('<?xml version="1.0"?><xliff version="2.0" srcLang="en" trgLang="zh"><file id="f1"><unit id="u1"><segment><source>hi</source></segment></unit></file></xliff>')],
      ['empty.xliff', new TextEncoder().encode('<?xml version="1.0"?><xliff version="1.2"><file><body></body></file></xliff>')],
      ['dup.xliff', new TextEncoder().encode('<xliff version="1.2"><file><body><trans-unit id="a"><source>1</source></trans-unit><trans-unit id="a"><source>2</source></trans-unit></body></file></xliff>')],
      ['no-source.xliff', new TextEncoder().encode('<xliff version="1.2"><file><body><trans-unit id="a"><target>only target</target></trans-unit></body></file></xliff>')],
      ['bad-utf8.xliff', new Uint8Array([0xff, 0xfe, 0x3c])],
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

  test('导出拒绝未知 key / 缺失段 / 源文被篡改 => FormatExportError，绝不静默跳过', async () => {
    const { adapter, bytes, imported } = await importFixture('mini_game_ui.xliff')
    const { asset, segments } = await boundSegments('mini_game_ui.xliff', adapter, imported)

    const unknown = [{ ...segments[0]!, key: 'does.not.exist' }, ...segments.slice(1)]
    await expect(adapter.export({ originalBytes: bytes, asset, segments: unknown })).rejects.toBeInstanceOf(FormatExportError)

    await expect(adapter.export({ originalBytes: bytes, asset, segments: segments.slice(1) })).rejects.toBeInstanceOf(FormatExportError)

    const tamperedSource = segments.map((s, i) => (i === 0 ? { ...s, source: 'MUTATED' } : s))
    await expect(adapter.export({ originalBytes: bytes, asset, segments: tamperedSource })).rejects.toBeInstanceOf(FormatExportError)

    const tamperedLocked = segments.map((s) => (s.key === 'legal.copyright' ? { ...s, target: 'MUTATED' } : s))
    let lockedErr: unknown
    try {
      await adapter.export({ originalBytes: bytes, asset, segments: tamperedLocked })
    } catch (err) {
      lockedErr = err
    }
    expect(lockedErr).toBeInstanceOf(FormatExportError)
    expect((lockedErr as FormatExportError).code).toBe('FORMAT_EXPORT_ERROR')
    expect((lockedErr as FormatExportError).message).toContain('locked')
  })

  test('重复 key 的导出输入 => FormatExportError', async () => {
    const { adapter, bytes, imported } = await importFixture('mini_game_ui.xliff')
    const { asset, segments } = await boundSegments('mini_game_ui.xliff', adapter, imported)
    const dup = [...segments, { ...segments[0]! }]
    await expect(adapter.export({ originalBytes: bytes, asset, segments: dup })).rejects.toBeInstanceOf(FormatExportError)
  })
})
