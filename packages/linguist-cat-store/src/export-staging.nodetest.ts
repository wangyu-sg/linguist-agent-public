import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readFileSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { createSeededEntropy } from '@linguist/cat-core'
import {
  FormatExportError,
  FormatSegmentLostError,
  SdlXliffAdapter,
  type CatFormatExportInput,
} from '@linguist/cat-formats'
import { BadSegmentDropAdapter, FakeAdapter, encodeFakeTsv } from '@linguist/cat-formats/testing'
import { stageAssetExport } from './export-staging'
import { CatStore } from './store'

function createImportedAsset(adapter: FakeAdapter | BadSegmentDropAdapter) {
  const rootDir = mkdtempSync(join(tmpdir(), 'linguist-export-stage-'))
  const store = new CatStore({
    rootDir,
    entropy: createSeededEntropy('pb-072'),
    now: () => '2026-07-26T00:00:00.000Z',
  })
  const project = store.createProject({
    name: 'Export',
    sourceLocale: 'en',
    targetLocale: 'zh-CN',
    promaWorkspaceId: 'test',
  })
  const db = store.openProject(project.id)
  const originalBytes = encodeFakeTsv([
    { key: 'greeting', source: 'Hello' },
    { key: 'farewell', source: 'Bye' },
  ])
  return { rootDir, store, project, db, adapter, originalBytes }
}

test('staging export reimports and records a digest without modifying the source template', async () => {
  const fixture = createImportedAsset(new FakeAdapter())
  try {
    const imported = await fixture.adapter.import({
      bytes: fixture.originalBytes,
      filename: 'messages.ftsv',
      sourceLocale: fixture.project.sourceLocale,
      targetLocale: fixture.project.targetLocale,
    })
    const { asset, segments } = fixture.db.assets.insertImported(imported)
    fixture.db.saveAssetSource(asset.id, fixture.originalBytes)
    fixture.db.segments.applyTargetEdit(segments[0]!.id, '你好', 0)

    const staged = await stageAssetExport({
      project: fixture.project,
      projectDir: fixture.store.index.projectDir(fixture.project.id),
      db: fixture.db,
      assetId: asset.id,
      adapter: fixture.adapter,
    })

    assert.ok(staged.relativePath.startsWith('exports/'))
    assert.ok(existsSync(staged.stagingPath))
    assert.equal(staged.verifiedSegments, 2)
    assert.equal(staged.verification.verifiedSourceSegments, 2)
    assert.equal(staged.verification.verifiedTargetSegments, 2)
    assert.equal(staged.verification.verifiedNativeStatusSegments, 0)
    assert.equal(staged.verification.changedTargetSegments, 1)
    assert.equal(staged.verification.changedNativeStatusSegments, 0)
    assert.equal(staged.verification.tagsPreserved, true)
    assert.equal(staged.artifact.path, staged.relativePath)
    assert.equal(staged.suggestedFilename, 'messages.translated.zh-CN.ftsv')
    assert.deepEqual([...fixture.db.readAssetSource(asset.id)], [...fixture.originalBytes])
    assert.deepEqual(fixture.db.exports.listByAsset(asset.id), [staged.artifact])

    const stagedAgain = await stageAssetExport({
      project: fixture.project,
      projectDir: fixture.store.index.projectDir(fixture.project.id),
      db: fixture.db,
      assetId: asset.id,
      adapter: fixture.adapter,
    })
    assert.equal(stagedAgain.artifact.id, staged.artifact.id)
    assert.deepEqual(fixture.db.exports.listByAsset(asset.id), [staged.artifact])
  } finally {
    fixture.db.close()
  }
})

class EscapedInlineTagSdlAdapter extends SdlXliffAdapter {
  override async export(input: CatFormatExportInput): Promise<Uint8Array> {
    const bytes = await super.export(input)
    const text = new TextDecoder().decode(bytes)
    const escaped = text.replace(
      /(<target>[\s\S]*?)<ph\b([^>]*)>([\s\S]*?)<\/ph>/u,
      '$1&lt;ph$2&gt;$3&lt;/ph&gt;',
    )
    return new TextEncoder().encode(escaped)
  }
}

test('staging export rejects XML whose reimported text matches but inline tag structure was escaped', async () => {
  const rootDir = mkdtempSync(join(tmpdir(), 'linguist-export-tag-stage-'))
  const store = new CatStore({
    rootDir,
    entropy: createSeededEntropy('delivery-tag-verification'),
    now: () => '2026-07-29T00:00:00.000Z',
  })
  const project = store.createProject({
    name: 'SDL tag verification',
    sourceLocale: 'zh-CN',
    targetLocale: 'en-US',
    promaWorkspaceId: 'test',
  })
  const db = store.openProject(project.id)
  const adapter = new EscapedInlineTagSdlAdapter()
  try {
    const originalBytes = new Uint8Array(readFileSync(
      join(import.meta.dirname, '../../../tests/linguist-fixtures/minimal_delivery.sdlxliff'),
    ))
    const imported = await adapter.import({
      bytes: originalBytes,
      filename: 'minimal_delivery.sdlxliff',
      sourceLocale: project.sourceLocale,
      targetLocale: project.targetLocale,
    })
    const { asset } = db.assets.insertImported(imported)
    db.saveAssetSource(asset.id, originalBytes)

    await assert.rejects(
      () => stageAssetExport({
        project,
        projectDir: store.index.projectDir(project.id),
        db,
        assetId: asset.id,
        adapter,
      }),
      (error) => error instanceof FormatExportError
        && error.message.includes('inline tag structure'),
    )
    assert.deepEqual(db.exports.listByAsset(asset.id), [])
  } finally {
    db.close()
  }
})

test('staging export refuses to write an artifact when reimport loses segments', async () => {
  const fixture = createImportedAsset(new BadSegmentDropAdapter())
  try {
    const imported = await fixture.adapter.import({
      bytes: fixture.originalBytes,
      filename: 'messages.ftsv',
      sourceLocale: fixture.project.sourceLocale,
      targetLocale: fixture.project.targetLocale,
    })
    const { asset } = fixture.db.assets.insertImported(imported)
    fixture.db.saveAssetSource(asset.id, fixture.originalBytes)

    await assert.rejects(
      () => stageAssetExport({
        project: fixture.project,
        projectDir: fixture.store.index.projectDir(fixture.project.id),
        db: fixture.db,
        assetId: asset.id,
        adapter: fixture.adapter,
      }),
      FormatSegmentLostError,
    )
    assert.deepEqual(fixture.db.exports.listByAsset(asset.id), [])
    const exportsDir = join(fixture.store.index.projectDir(fixture.project.id), 'exports')
    assert.equal(existsSync(exportsDir), true)
    assert.deepEqual(readdirSync(exportsDir), [])
  } finally {
    fixture.db.close()
  }
})
