import { test } from 'node:test'
import assert from 'node:assert/strict'
import { CatStore } from './store'
import { makeClock, makeEntropy, makeImportedAsset, makeTempDir } from './testkit'

function setup() {
  const store = new CatStore({ rootDir: makeTempDir(), entropy: makeEntropy(), now: makeClock() })
  const project = store.createProject({ name: 'P', sourceLocale: 'en', targetLocale: 'zh-CN', promaWorkspaceId: 'ws' })
  const db = store.openProject(project.id)
  const { asset } = db.assets.insertImported(makeImportedAsset({ segmentCount: 3 }))
  return { store, project, db, asset }
}

test('record: identical staged artifact is idempotent; different content creates a new record', () => {
  const { db, asset, project } = setup()
  try {
    const record = db.exports.record({
      assetId: asset.id,
      path: 'exports/test.zh-CN.tsv',
      sha256: 'c'.repeat(64),
      segmentCount: 3,
      now: '2026-01-03T00:00:00.000Z',
    })
    assert.match(record.id, /^exp_v2_[0-9a-f]{64}$/)
    assert.equal(record.projectId, project.id)
    assert.equal(record.createdAt, '2026-01-03T00:00:00.000Z')

    // 相同资产内容的重复预检不产生重复审计行。
    const again = db.exports.record({
      assetId: asset.id,
      path: 'exports/test.zh-CN.tsv',
      sha256: 'c'.repeat(64),
      segmentCount: 3,
      now: '2026-01-03T00:00:01.000Z',
    })
    assert.deepEqual(again, record)

    const changed = db.exports.record({
      assetId: asset.id,
      path: 'exports/test-v2.zh-CN.tsv',
      sha256: 'd'.repeat(64),
      segmentCount: 3,
      now: '2026-01-03T00:00:02.000Z',
    })
    assert.notEqual(changed.id, record.id)

    assert.deepEqual(db.exports.listByAsset(asset.id).map((r) => r.id), [record.id, changed.id])
    assert.equal(db.exports.listByAsset('ast-0000000000000000').length, 0)
    assert.equal(db.exports.listByProject().length, 2)
  } finally {
    db.close()
  }
})
