import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createAsset, createProject, createSeededEntropy } from '@linguist/cat-core'
import { bindImportedSegments } from '../adapter'
import { FormatExportError } from '../errors'
import { CatFormatRegistry } from '../registry'
import { XliffAdapter } from './xliff'
import { MqXliffAdapter, writeMqXliffDefects } from './mqxliff'

const FIXTURE_PATH = join(import.meta.dir, '../../../../tests/linguist-fixtures/sample.mqxliff')
const bytes = () => new Uint8Array(readFileSync(FIXTURE_PATH))

async function importedFixture() {
  const adapter = new MqXliffAdapter(undefined, () => '2026-08-10T12:34:56.000Z')
  const source = bytes()
  const imported = await adapter.import({
    bytes: source,
    filename: 'sample.mqxliff',
    sourceLocale: 'zh-CN',
    targetLocale: 'en-US',
  })
  const project = createProject({
    name: 'memoQ',
    sourceLocale: 'zh-CN',
    targetLocale: 'en-US',
    promaWorkspaceId: 'memoq',
  }, { entropy: createSeededEntropy('memoq'), now: '2026-08-10T00:00:00.000Z' })
  const asset = createAsset({
    projectId: project.id,
    formatId: imported.asset.formatId,
    originalFilename: imported.asset.originalFilename,
    sourceSha256: imported.asset.sourceSha256,
    segmentCount: imported.asset.segmentCount,
  })
  return { adapter, source, imported, asset, segments: bindImportedSegments(imported.segments, asset.id) }
}

describe('MqXliffAdapter', () => {
  test('memoQ namespace wins before generic XLIFF and imports native status/inline codes', async () => {
    const mq = new MqXliffAdapter()
    const generic = new XliffAdapter()
    const registry = new CatFormatRegistry().register(mq).register(generic)
    expect(await mq.detect(bytes(), 'sample.mqxliff')).toBe(1)
    expect(await mq.detect(bytes(), 'renamed.xliff')).toBe(0.8)
    expect((await registry.detectBest(bytes(), 'sample.mqxliff')).id).toBe('mqxliff_1_2')
    expect(await mq.detect(new TextEncoder().encode('<xliff version="1.2"><file/></xliff>'), 'plain.mqxliff')).toBe(0)

    const { imported } = await importedFixture()
    expect(imported.asset.formatId).toBe('mqxliff_1_2')
    expect(imported.segments).toHaveLength(4)
    expect(imported.segments[0]?.importedNativeStatus).toBe('PartiallyEdited')
    expect(imported.segments[0]?.status).toBe('draft')
    const tagged = imported.segments.find((segment) => segment.key === '4')!
    expect(tagged.source).toContain('<color=#5a9142>')
    expect(tagged.source).toContain('</color>')
    expect(tagged.source).toContain('{0}')
    expect(tagged.source).not.toContain('<bpt')
    expect(tagged.source).not.toContain('<mq:rxt')
  })

  test('unchanged units are byte-stable; modified inline units re-import stably with memoQ metadata', async () => {
    const { adapter, source, asset, segments } = await importedFixture()
    const unchanged = await adapter.export({ originalBytes: source, asset, segments })
    expect(Buffer.from(unchanged).equals(Buffer.from(source))).toBe(true)
    const originalText = new TextDecoder().decode(source)
    const untouchedUnit = /<trans-unit id="2"[\s\S]*?<\/trans-unit>/.exec(originalText)![0]
    const changed = segments.map((segment) => segment.key === '4'
      ? { ...segment, target: segment.target.replace('Synthetic tip', 'Edited tip') }
      : segment)
    const exported = await adapter.export({ originalBytes: source, asset, segments: changed })
    const output = new TextDecoder().decode(exported)
    expect(output).toContain('mq:status="ConfirmedTranslator"')
    expect(output).toContain('mq:lastchangedtimestamp="2026-08-10T12:34:56Z"')
    expect(output).toContain(untouchedUnit)
    expect(output).toContain('&lt;mq:rxt')
    expect(output).not.toContain('<mq:rxt displaytext=')
    const reimported = await adapter.import({
      bytes: exported,
      filename: 'out.mqxliff',
      sourceLocale: 'zh-CN',
      targetLocale: 'en-US',
    })
    expect(reimported.segments.find((segment) => segment.key === '4')?.target)
      .toBe(changed.find((segment) => segment.key === '4')?.target)
  })

  test('inline code loss fails closed and defect comments write only addressed units', async () => {
    const { adapter, source, asset, segments } = await importedFixture()
    const damaged = segments.map((segment) => segment.key === '4'
      ? { ...segment, target: segment.target.replace('<color=#5a9142>', '') }
      : segment)
    await expect(adapter.export({ originalBytes: source, asset, segments: damaged }))
      .rejects.toBeInstanceOf(FormatExportError)

    const original = new TextDecoder().decode(source)
    const untouched = /<trans-unit id="3"[\s\S]*?<\/trans-unit>/.exec(original)![0]
    const defects = writeMqXliffDefects(original, [{
      id: '1',
      suggested: 'Edited Synthetic Menu Title',
      severity: 'major',
      issueType: 'accuracy',
      disposition: 'defect',
      comment: 'Use the approved label.',
    }], '2026-08-10T12:34:56.000Z')
    expect(defects.updatedIds).toEqual(['1'])
    expect(defects.commentedIds).toEqual(['1'])
    expect(defects.content).toContain('mq:status="Edited"')
    expect(defects.content).toContain('origin="ai_review"')
    expect(defects.content).toContain(untouched)
  })
})
