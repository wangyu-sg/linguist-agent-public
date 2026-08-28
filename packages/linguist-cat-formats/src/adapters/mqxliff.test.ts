import { describe, expect, test } from 'bun:test'
import { DOMParser } from '@xmldom/xmldom'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createAsset, createProject, createSeededEntropy } from '@linguist/cat-core'
import {
  bindImportedSegments,
  FormatExportError,
} from '../index'
import { assertRoundTrip } from '../testing/index'
import {
  MqXliffAdapter,
  writeMqXliffDefects,
} from './mqxliff'

const FIXTURES = join(import.meta.dir, '../../../../tests/linguist-fixtures')
const NOW = '2026-08-28T12:00:00.123Z'

function fixtureBytes(): Uint8Array {
  return new Uint8Array(readFileSync(join(FIXTURES, 'sample.mqxliff')))
}

function bytes(value: string): Uint8Array {
  return new TextEncoder().encode(value)
}

async function boundFixture() {
  const adapter = new MqXliffAdapter(undefined, () => NOW)
  const originalBytes = fixtureBytes()
  const imported = await adapter.import({
    bytes: originalBytes,
    filename: 'sample.mqxliff',
    sourceLocale: 'zh-CN',
    targetLocale: 'en-US',
  })
  const project = createProject(
    { name: 'mqxliff-test', sourceLocale: 'zh-CN', targetLocale: 'en-US', promaWorkspaceId: 'mqxliff-test' },
    { entropy: createSeededEntropy('mqxliff-test'), now: NOW },
  )
  const asset = createAsset({
    projectId: project.id,
    formatId: imported.asset.formatId,
    originalFilename: 'sample.mqxliff',
    sourceSha256: imported.asset.sourceSha256,
    segmentCount: imported.asset.segmentCount,
  })
  return { adapter, originalBytes, imported, asset, segments: bindImportedSegments(imported.segments, asset.id) }
}

describe('MqXliffAdapter round-trip', () => {
  test('sample.mqxliff 未修改导出逐字节稳定，修改后保持 Segment、Source、Target 和 inline code', async () => {
    const { adapter, originalBytes, imported, asset, segments } = await boundFixture()
    expect(await adapter.detect(originalBytes, 'sample.mqxliff')).toBe(1)
    const unchanged = await adapter.export({ originalBytes, asset, segments })
    expect(Buffer.from(unchanged).equals(Buffer.from(originalBytes))).toBe(true)

    const report = await assertRoundTrip(adapter, originalBytes, {
      filename: 'sample.mqxliff',
      sourceLocale: 'zh-CN',
      targetLocale: 'en-US',
      modify: (segment, index) => index === 3 ? null : `[en-US] ${segment.source}`,
      invariants: [{
        name: 'memoQ inline code sequence preserved',
        assert: (before, after) => {
          const tokens = (value: string) => value.match(/<color=[^>]+>|<\/color>|\\n|\{0\}/g) ?? []
          if (JSON.stringify(tokens(before.target)) !== JSON.stringify(tokens(after.target))) {
            throw new Error('memoQ inline code sequence changed')
          }
        },
      }],
    })
    expect(report.segmentCount).toBe(imported.segments.length)
    expect(report.modifiedSegmentIds).toHaveLength(3)
    const output = new TextDecoder().decode(report.exportedBytes)
    expect(output).toContain('mq:status="ConfirmedTranslator"')
    expect(output).toContain('mq:lastchangedtimestamp="2026-08-28T12:00:00Z"')
  })
})

describe('MqXliffAdapter inline code and locked boundaries', () => {
  const DUPLICATE_CODE_XML = `<xliff version="1.2" xmlns:mq="MQXliff"><file><body>
    <trans-unit id="dup"><source>A<ph id="1">&lt;mq:rxt val=&quot;{0}&quot; /&gt;</ph><ph id="2">&lt;mq:rxt val=&quot;{0}&quot; /&gt;</ph>B</source><target>x<ph id="1">&lt;mq:rxt val=&quot;{0}&quot; /&gt;</ph><ph id="2">&lt;mq:rxt val=&quot;{0}&quot; /&gt;</ph>y</target></trans-unit>
    <trans-unit id="locked" mq:locked="true"><source>Lock</source><target>Old</target></trans-unit>
  </body></file></xliff>`

  test('重复相同 inline code 按原始 XML 队列确定性写回，缺少/重排 code 拒绝', async () => {
    const adapter = new MqXliffAdapter(undefined, () => NOW)
    const originalBytes = bytes(DUPLICATE_CODE_XML)
    const imported = await adapter.import({ bytes: originalBytes, filename: 'duplicate.mqxliff', sourceLocale: 'en', targetLocale: 'zh' })
    expect(imported.segments[0]?.source).toBe('A{0}{0}B')
    const project = createProject(
      { name: 'duplicate-mq', sourceLocale: 'en', targetLocale: 'zh', promaWorkspaceId: 'duplicate-mq' },
      { entropy: createSeededEntropy('duplicate-mq'), now: NOW },
    )
    const asset = createAsset({
      projectId: project.id,
      formatId: imported.asset.formatId,
      originalFilename: 'duplicate.mqxliff',
      sourceSha256: imported.asset.sourceSha256,
      segmentCount: imported.asset.segmentCount,
    })
    const segments = bindImportedSegments(imported.segments, asset.id)
    const exported = new TextDecoder().decode(await adapter.export({
      originalBytes,
      asset,
      segments: segments.map((segment) => segment.key === 'dup'
        ? { ...segment, target: 'z{0}{0}w' }
        : segment),
    }))
    const target = /<target\b[^>]*>([\s\S]*?)<\/target>/.exec(exported)?.[1] ?? ''
    const first = target.indexOf('<ph id="1">')
    const second = target.indexOf('<ph id="2">')
    expect(first).toBeGreaterThan(-1)
    expect(first).toBeLessThan(second)

    await expect(adapter.export({
      originalBytes,
      asset,
      segments: segments.map((segment) => segment.key === 'dup'
        ? { ...segment, target: 'z{0}w' }
        : segment),
    })).rejects.toBeInstanceOf(FormatExportError)

    await expect(adapter.export({
      originalBytes,
      asset,
      segments: segments.map((segment) => segment.key === 'locked'
        ? { ...segment, target: '不应写回' }
        : segment),
    })).rejects.toBeInstanceOf(FormatExportError)
  })
})

describe('memoQ defect comment write-back', () => {
  test('特殊字符可转义并保持 XML 可解析；locked 不写 target/comment，missingIds 明确返回', () => {
    const source = `<xliff version="1.2" xmlns:mq="MQXliff"><file><body>
      <trans-unit id="open"><source>Open</source><target>Old</target></trans-unit>
      <trans-unit id="locked" mq:locked="true"><source>Locked</source><target>Keep</target></trans-unit>
    </body></file></xliff>`
    const result = writeMqXliffDefects(source, [
      { id: 'open', suggested: 'New', severity: 'L1', issueType: 'tag', comment: '5 < 6 & "quote"', disposition: 'defect' },
      { id: 'locked', suggested: 'Nope', severity: 'L1', issueType: 'style', comment: 'must stay', disposition: 'defect' },
      { id: 'missing', severity: 'L2', issueType: 'typo', comment: 'not present' },
    ], NOW)

    expect(result).toMatchObject({
      updatedIds: ['open'],
      commentedIds: ['open'],
      skippedLockedIds: ['locked'],
      missingIds: ['missing'],
    })
    expect(result.content).toContain('5 &lt; 6 &amp; "quote"')
    expect(result.content).toContain('mq:status="Edited"')
    expect(result.content).toContain('mq:lastchangedtimestamp="2026-08-28T12:00:00Z"')
    expect(result.content).toContain('<target>Keep</target>')
    expect(result.content).not.toContain('must stay')
    const document = new DOMParser().parseFromString(result.content, 'text/xml')
    expect(document.getElementsByTagName('parsererror').length).toBe(0)
  })

  test('file-level translate="no" prevents target and comment write-back', () => {
    const source = `<xliff version="1.2" xmlns:mq="MQXliff"><file translate="no"><body><trans-unit id="open"><source>Open</source><target>Old</target></trans-unit></body></file></xliff>`
    const result = writeMqXliffDefects(source, [
      { id: 'open', suggested: 'New', severity: 'L1', issueType: 'tag', comment: 'must stay', disposition: 'defect' },
    ], NOW)

    expect(result).toMatchObject({ updatedIds: [], commentedIds: [], skippedLockedIds: ['open'], missingIds: [] })
    expect(result.content).toBe(source)
  })
})
