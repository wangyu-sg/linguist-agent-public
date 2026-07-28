import { test } from 'node:test'
import assert from 'node:assert/strict'
import { CatStore } from './store'
import { makeClock, makeEntropy, makeImportedAsset, makeTempDir } from './testkit'

function setup() {
  const store = new CatStore({ rootDir: makeTempDir(), entropy: makeEntropy(), now: makeClock() })
  const project = store.createProject({ name: 'P', sourceLocale: 'en', targetLocale: 'zh-CN', promaWorkspaceId: 'ws' })
  const db = store.openProject(project.id)
  return { store, project, db }
}

test('insertImported: asset + segments in one transaction; ids are content-derived and stable', () => {
  const { db } = setup()
  try {
    const imported = makeImportedAsset({ segmentCount: 3, fillEvery: 2 })
    const { asset, segments } = db.assets.insertImported(imported)

    assert.equal(asset.segmentCount, 3)
    assert.match(asset.id, /^ast-[0-9a-f]{16}$/)
    assert.equal(segments.length, 3)
    for (const s of segments) {
      assert.equal(s.assetId, asset.id)
      assert.match(s.id, /^seg-[0-9a-f]{16}$/)
    }
    assert.equal(segments[0]?.context?.note, 'first segment')

    assert.deepEqual(db.assets.listByProject().map((a) => a.id), [asset.id])
    assert.equal(db.assets.get(asset.id)?.originalFilename, 'test.tsv')
    assert.equal(db.assets.get('ast-0000000000000000'), undefined)
  } finally {
    db.close()
  }
})

test('insertImported: 1000 segments in one transaction (perf sanity, not a benchmark)', () => {
  const { db } = setup()
  try {
    const imported = makeImportedAsset({ segmentCount: 1000 })
    const start = performance.now()
    const { asset } = db.assets.insertImported(imported)
    const elapsedMs = performance.now() - start
    assert.ok(elapsedMs < 5000, `1000-segment transactional import took ${elapsedMs.toFixed(0)}ms`)
    assert.equal(db.segments.query({ assetId: asset.id, limit: 2000 }).length, 1000)
  } finally {
    db.close()
  }
})

test('insert: partial failure rolls back the whole asset (no half-imported state)', () => {
  const { db } = setup()
  try {
    const imported = makeImportedAsset({ segmentCount: 3 })
    const { asset, segments } = db.assets.insertImported(imported)
    // Second asset whose segment ids collide with the first -> PK violation mid-transaction
    const dupe = makeImportedAsset({ segmentCount: 3, filename: 'dupe.tsv', sourceSha256: 'b'.repeat(64) })
    const dupeSegments = segments.map((s) => ({ ...s })) // same ids as the committed asset
    assert.throws(() => db.assets.insert({ ...asset, id: 'ast-ffffffffffffffff' as never, originalFilename: 'dupe.tsv' }, dupeSegments))
    assert.equal(db.assets.get('ast-ffffffffffffffff'), undefined, 'asset row must be rolled back')
    assert.equal(db.assets.listByProject().length, 1)
    assert.equal(db.segments.query({ limit: 100 }).length, 3)
  } finally {
    db.close()
  }
})

test('countByProject: COUNT(*) matches listByProject length, no row load (PB-031)', () => {
  const { db } = setup()
  try {
    assert.equal(db.assets.countByProject(), 0)
    db.assets.insertImported(makeImportedAsset({ segmentCount: 2 }))
    db.assets.insertImported(makeImportedAsset({ segmentCount: 3, filename: 'b.tsv', sourceSha256: 'c'.repeat(64) }))
    assert.equal(db.assets.countByProject(), 2)
    assert.equal(db.assets.countByProject(), db.assets.listByProject().length)
  } finally {
    db.close()
  }
})
