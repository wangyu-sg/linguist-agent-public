import { describe, expect, test } from 'bun:test'
import { createAsset, createProject, createSeededEntropy, type Segment } from '@linguist/cat-core'
import {
  bindImportedSegments,
  FormatExportError,
  FormatParseError,
} from '../index'
import { assertRoundTrip } from '../testing/index'
import {
  PHRASE_MXLIFF_ADAPTER_ID,
  PhraseMxliffAdapter,
  inspectPhraseRecovery,
  probePhraseMasterPair,
  serializePhraseMxliffFormatConfig,
} from './phrasemxliff'

const PHRASE_FIXTURE = `<?xml version="1.0" encoding="UTF-8"?>
<xliff version="1.2" xmlns="urn:oasis:names:tc:xliff:document:1.2" xmlns:m="http://www.memsource.com/mxlf/2.0">
  <file original="sample.docx" source-language="en-US" target-language="zh-CN"><body>
    <trans-unit id="one" m:para-id="p1"><source>Hello <ph id="1">{0}</ph></source><target>你好 <ph id="1">{0}</ph></target><alt-trans><target>备用一</target></alt-trans></trans-unit>
    <trans-unit id="two"><source>Missing target</source><alt-trans><target/></alt-trans></trans-unit>
    <trans-unit id="locked" m:locked="true"><source>Lock me</source><target>锁定</target></trans-unit>
  </body></file>
</xliff>`

const NOW = '2026-01-01T00:00:00.000Z'

function bytes(value: string): Uint8Array {
  return new TextEncoder().encode(value)
}

async function importedFixture(originalBytes = bytes(PHRASE_FIXTURE)) {
  const adapter = new PhraseMxliffAdapter()
  const imported = await adapter.import({
    bytes: originalBytes,
    filename: 'sample.mxliff',
    sourceLocale: 'en-US',
    targetLocale: 'zh-CN',
  })
  const project = createProject(
    { name: 'phrase-mxliff-test', sourceLocale: 'en-US', targetLocale: 'zh-CN', promaWorkspaceId: 'phrase-mxliff-test' },
    { entropy: createSeededEntropy('phrase-mxliff-test'), now: NOW },
  )
  const asset = createAsset({
    projectId: project.id,
    formatId: imported.asset.formatId,
    originalFilename: 'sample.mxliff',
    sourceSha256: imported.asset.sourceSha256,
    segmentCount: imported.asset.segmentCount,
  })
  return { adapter, originalBytes, imported, asset, segments: bindImportedSegments(imported.segments, asset.id) }
}

describe('PhraseMxliffAdapter direct-child targets and round-trip', () => {
  test('只读取 trans-unit 直接子级 target，alt-trans 不会被导入或改写', async () => {
    const { adapter, originalBytes, imported, asset, segments } = await importedFixture()
    expect(imported.asset.formatId).toBe(PHRASE_MXLIFF_ADAPTER_ID)
    expect(imported.segments.map((segment) => segment.target)).toEqual(['你好 <ph id="1">{0}</ph>', '', '锁定'])

    const unchanged = await adapter.export({ originalBytes, asset, segments })
    expect(Buffer.from(unchanged).equals(Buffer.from(originalBytes))).toBe(true)

    const changed = segments.map((segment) => segment.key === 'one'
      ? { ...segment, target: 'New <ph id="1">{0}</ph>' }
      : segment.key === 'two'
        ? { ...segment, target: '新建目标' }
        : segment)
    const exported = new TextDecoder().decode(await adapter.export({ originalBytes, asset, segments: changed }))
    expect(exported).toContain('<target state="translated">New <ph id="1">{0}</ph></target><alt-trans><target>备用一</target>')
    expect(exported).toContain('<source>Missing target</source><target state="translated">新建目标</target><alt-trans><target/></alt-trans>')

    const reimported = await adapter.import({
      bytes: bytes(exported),
      filename: 'sample.mxliff',
      sourceLocale: 'en-US',
      targetLocale: 'zh-CN',
    })
    expect(reimported.segments.map((segment) => segment.target)).toEqual(['New <ph id="1">{0}</ph>', '新建目标', '锁定'])
  })

  test('assertRoundTrip harness 覆盖 Phrase 标签与锁定段', async () => {
    const report = await assertRoundTrip(new PhraseMxliffAdapter(), bytes(PHRASE_FIXTURE), {
      filename: 'sample.mxliff',
      sourceLocale: 'en-US',
      targetLocale: 'zh-CN',
      invariants: [{
        name: 'inline tag set preserved',
        assert: (before: Segment, after: Segment) => {
          const tags = (value: string) => (value.match(/<\/?(?:ph|g|x|bpt|ept)\b[^>]*\/?/g) ?? []).join('|')
          if (tags(before.source) !== tags(after.source)) throw new Error('source inline tags changed')
        },
      }],
    })
    expect(report.segmentCount).toBe(3)
    expect(report.modifiedSegmentIds).toHaveLength(1)
  })

  test('锁定段的 Target 修改以 FormatExportError 拒绝', async () => {
    const { adapter, originalBytes, asset, segments } = await importedFixture()
    const changed = segments.map((segment) => segment.key === 'locked'
      ? { ...segment, target: '不应写回' }
      : segment)
    await expect(adapter.export({ originalBytes, asset, segments: changed }))
      .rejects.toBeInstanceOf(FormatExportError)
  })

  test('带 UTF-8 BOM 的未修改导出保持原始字节', async () => {
    const originalBytes = new Uint8Array([0xef, 0xbb, 0xbf, ...bytes(PHRASE_FIXTURE)])
    const { adapter, asset, segments } = await importedFixture(originalBytes)
    const exported = await adapter.export({ originalBytes, asset, segments })
    expect(Buffer.from(exported).equals(Buffer.from(originalBytes))).toBe(true)
  })
})

describe('PhraseMxliffAdapter master Tag Mapping', () => {
  test('区分原生标签、变化包装、待恢复占位符和 Target 独有标记', () => {
    const segment = (source: string, target: string) => ({ key: 'one', ordinal: 0, source, target })
    expect(inspectPhraseRecovery([segment('A <ph id="1">{0}</ph>', 'B <ph id="1">{0}</ph>')]).status).toBe('not-required')
    expect(inspectPhraseRecovery([segment('{u>A<u}', '{u>B<u}')]).status).toBe('not-required')
    expect(inspectPhraseRecovery([segment('{u>A', 'B')]).status).toBe('unsupported-representation')
    expect(inspectPhraseRecovery([segment('<u}A{u>', 'B')]).status).toBe('unsupported-representation')
    expect(inspectPhraseRecovery([segment('A', '{u>B<u}')]).status).toBe('unsupported-representation')
    expect(inspectPhraseRecovery([segment('A', 'B {0}')]).status).toBe('unsupported-representation')
    expect(inspectPhraseRecovery([segment('A {0}', 'B {1}')]).status).toBe('unsupported-representation')
    expect(inspectPhraseRecovery([segment('A {0}', 'B {0}')]).status).toBe('needs-master')
  })

  test('同文本文字变量由 master 验证；强身份冲突不退化成正文匹配', async () => {
    const literal = bytes('<xliff version="1.2" xmlns:m="http://www.memsource.com/mxlf/2.0"><file><body><trans-unit id="one"><source>Gain {0} points</source><target>获得 {0} 分</target></trans-unit></body></file></xliff>')
    const literalMaster = bytes('<xliff version="1.2"><file><body><trans-unit id="one"><source>Gain {0} points</source></trans-unit></body></file></xliff>')
    const literalProbe = await probePhraseMasterPair(literal, 'split.xlf', literalMaster, 'master.xlf')
    expect(literalProbe.status).toBe('not-required')
    expect(literalProbe.literalSegments).toBe(1)

    const split = bytes('<xliff version="1.2" xmlns:m="http://www.memsource.com/mxlf/2.0"><file><body><group m:para-id="p1"><context context-type="x-key">expected</context><trans-unit id="one" m:para-id="p1"><source>Open {0} world</source></trans-unit></group></body></file></xliff>')
    const wrongMaster = bytes('<xliff version="1.2"><file><body><trans-unit id="other"><source>Open <ph id="1">{0}</ph> world</source></trans-unit></body></file></xliff>')
    const conflict = await probePhraseMasterPair(split, 'split.mxliff', wrongMaster, 'wrong.xlf')
    expect(conflict.status).toBe('needs-master')
    expect(conflict.config.matchedSegments).toBe(0)
    expect(conflict.sampleKeys).toContain('one')

    const ambiguousMaster = bytes('<xliff version="1.2"><file><body><trans-unit id="literal"><source>Gain {0} points</source></trans-unit><trans-unit id="tag"><source>Gain <ph id="1">{0}</ph> points</source></trans-unit></body></file></xliff>')
    expect((await probePhraseMasterPair(literal, 'split.xlf', ambiguousMaster, 'master.xlf')).status).toBe('ambiguous')
    expect((await probePhraseMasterPair(literal, 'split.xlf', bytes('<xliff><file><body></body></file>'), 'broken.xlf')).status).toBe('parse-error')
    expect((await probePhraseMasterPair(literal, 'split.xlf', new Uint8Array([0xff]), 'broken.xlf')).status).toBe('parse-error')

    const partialSplit = bytes('<xliff version="1.2" xmlns:m="http://www.memsource.com/mxlf/2.0"><file><body><trans-unit id="a"><source>Open {0} world</source></trans-unit><trans-unit id="b"><source>Close {0} world</source></trans-unit></body></file></xliff>')
    const partialMaster = bytes('<xliff version="1.2"><file><body><trans-unit id="a"><source>Open <ph id="1">{0}</ph> world</source></trans-unit></body></file></xliff>')
    const partial = await probePhraseMasterPair(partialSplit, 'split.xlf', partialMaster, 'master.xlf')
    expect(partial.status).toBe('partial')
    expect(partial.sampleKeys).toContain('b')

    const repeatedTarget = bytes('<xliff version="1.2" xmlns:m="http://www.memsource.com/mxlf/2.0"><file><body><trans-unit id="one"><source>A {0}</source><target>B {0} and {0}</target></trans-unit></body></file></xliff>')
    const tagMaster = bytes('<xliff version="1.2"><file><body><trans-unit id="one"><source>A <ph id="1">{0}</ph></source></trans-unit></body></file></xliff>')
    const repeatedProbe = await probePhraseMasterPair(repeatedTarget, 'split.xlf', tagMaster, 'master.xlf')
    expect(repeatedProbe.status).toBe('unsupported-representation')
    expect(repeatedProbe.sampleKeys).toContain('one')
    const repeatedLiteral = bytes('<xliff version="1.2" xmlns:m="http://www.memsource.com/mxlf/2.0"><file><body><trans-unit id="one"><source>Gain {0} points</source><target>Gain {0} or {0} points</target></trans-unit></body></file></xliff>')
    expect((await probePhraseMasterPair(repeatedLiteral, 'split.xlf', literalMaster, 'master.xlf')).status).toBe('not-required')

    const mixedSplit = bytes('<xliff version="1.2" xmlns:m="http://www.memsource.com/mxlf/2.0"><file><body><trans-unit id="one" resname="strong"><source>x {0} {0}</source><target>x {0} {0}</target></trans-unit></body></file></xliff>')
    const mixedMaster = bytes('<xliff version="1.2"><file><body><trans-unit id="one" resname="strong"><source>x <ph id="1">{0}</ph> {0}</source></trans-unit></body></file></xliff>')
    expect((await probePhraseMasterPair(mixedSplit, 'split.xlf', mixedMaster, 'master.xlf')).status).toBe('ambiguous')
  })

  test('损坏的 Phrase XML 与反序包装不能通过预检', async () => {
    const adapter = new PhraseMxliffAdapter()
    const malformed = bytes('<xliff version="1.2" xmlns:m="http://www.memsource.com/mxlf/2.0"><file><body><trans-unit id="one"><source>A</source><target>B</target></trans-unit></file></xliff>')
    await expect(adapter.import({ bytes: malformed, filename: 'broken.mxliff', sourceLocale: 'en-US', targetLocale: 'zh-CN' }))
      .rejects.toBeInstanceOf(FormatParseError)
    const split = bytes('<xliff version="1.2" xmlns:m="http://www.memsource.com/mxlf/2.0"><file><body><trans-unit id="one"><source>A {0}</source></trans-unit></body></file></xliff>')
    expect((await probePhraseMasterPair(split, 'split.mxliff', malformed, 'broken.xlf')).status).toBe('parse-error')
  })

  test('master mapping 可 rehydrate/dehydrate，且 stale mapping 拒绝导入', async () => {
    const split = bytes(`<xliff version="1.2" xmlns:m="http://www.memsource.com/mxlf/2.0"><file><body><trans-unit id="s1"><source>Open {0} world</source><target>打开 {0} 世界</target></trans-unit></body></file></xliff>`)
    const master = bytes(`<xliff version="1.2"><file><body><trans-unit id="m1"><source>Open <ph id="1">{0}</ph> world</source></trans-unit></body></file></xliff>`)
    const probe = await probePhraseMasterPair(split, 'split.mxliff', master, 'master.xliff')
    expect(probe.config).toMatchObject({ placeholderSegments: 1, matchedSegments: 1, unmatchedSegments: 0, ambiguousSegments: 0 })

    const adapter = new PhraseMxliffAdapter()
    const imported = await adapter.import({
      bytes: split,
      filename: 'split.mxliff',
      sourceLocale: 'en-US',
      targetLocale: 'zh-CN',
      formatConfigJson: serializePhraseMxliffFormatConfig(probe.config),
    })
    expect(imported.segments[0]?.source).toBe('Open <ph id="1">{0}</ph> world')
    const project = createProject(
      { name: 'phrase-mapping-test', sourceLocale: 'en-US', targetLocale: 'zh-CN', promaWorkspaceId: 'phrase-mapping-test' },
      { entropy: createSeededEntropy('phrase-mapping-test'), now: NOW },
    )
    const asset = createAsset({
      projectId: project.id,
      formatId: imported.asset.formatId,
      originalFilename: 'split.mxliff',
      sourceSha256: imported.asset.sourceSha256,
      segmentCount: imported.asset.segmentCount,
      formatConfigJson: imported.asset.formatConfigJson,
    })
    const segments = bindImportedSegments(imported.segments, asset.id)
    const exported = new TextDecoder().decode(await adapter.export({
      originalBytes: split,
      asset,
      segments: segments.map((segment) => ({ ...segment, target: '已打开 <ph id="1">{0}</ph> 世界' })),
    }))
    expect(exported).toContain('<target state="translated">已打开 {0} 世界</target>')

    const stale = { ...probe.config, mappings: { ...probe.config.mappings, s1: { ...probe.config.mappings.s1!, splitSourceHash: 'stale' } } }
    await expect(adapter.import({
      bytes: split,
      filename: 'split.mxliff',
      sourceLocale: 'en-US',
      targetLocale: 'zh-CN',
      formatConfigJson: serializePhraseMxliffFormatConfig(stale),
    })).rejects.toBeInstanceOf(FormatParseError)
  })

  test('无 id/resname 的 placeholder 段使用与导入一致的合成 key', async () => {
    const split = bytes(`<xliff version="1.2" xmlns:m="http://www.memsource.com/mxlf/2.0"><file><body><trans-unit><source>Open {0} world</source><target>打开 {0} 世界</target></trans-unit></body></file></xliff>`)
    const master = bytes(`<xliff version="1.2"><file><body><trans-unit id="m1"><source>Open <ph id="1">{0}</ph> world</source></trans-unit></body></file></xliff>`)
    const probe = await probePhraseMasterPair(split, 'split.mxliff', master, 'master.xliff')
    expect(probe.config).toMatchObject({ placeholderSegments: 1, matchedSegments: 1, unmatchedSegments: 0 })
    expect(probe.config.mappings['#tu-0']).toBeDefined()
  })

  test('重复 Phrase placeholder 按出现顺序恢复对应 inline tag', async () => {
    const split = bytes(`<xliff version="1.2" xmlns:m="http://www.memsource.com/mxlf/2.0"><file><body><trans-unit id="s1"><source>A {0} {0}</source><target>A {0} {0}</target></trans-unit></body></file></xliff>`)
    const master = bytes(`<xliff version="1.2"><file><body><trans-unit id="m1"><source>A <ph id="1">{0}</ph> <ph id="2">{0}</ph></source></trans-unit></body></file></xliff>`)
    const probe = await probePhraseMasterPair(split, 'split.mxliff', master, 'master.xliff')
    const imported = await new PhraseMxliffAdapter().import({
      bytes: split,
      filename: 'split.mxliff',
      sourceLocale: 'en-US',
      targetLocale: 'zh-CN',
      formatConfigJson: serializePhraseMxliffFormatConfig(probe.config),
    })
    expect(imported.segments[0]?.source).toBe('A <ph id="1">{0}</ph> <ph id="2">{0}</ph>')
  })
})
