import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { StoreNotFoundError, StoreReadOnlyError } from './errors'
import { CatStore } from './store'
import { SCHEMA_VERSION } from './schema'
import { makeClock, makeEntropy, makeImportedAsset, makeTempDir } from './testkit'

const INPUT = { name: 'P', sourceLocale: 'en', targetLocale: 'zh-CN', promaWorkspaceId: 'ws' }

test('facade: full project lifecycle over injected root dir', () => {
  const rootDir = makeTempDir()
  const store = new CatStore({ rootDir, entropy: makeEntropy(), now: makeClock() })
  const project = store.createProject(INPUT)

  const db = store.openProject(project.id)
  assert.equal(db.schemaVersion, SCHEMA_VERSION)
  assert.ok(existsSync(store.index.projectDbPath(project.id)))
  const { asset } = db.assets.insertImported(makeImportedAsset({ segmentCount: 2 }))
  db.close()

  // data persists across opens
  const reopened = store.openProject(project.id)
  try {
    assert.equal(reopened.assets.get(asset.id)?.segmentCount, 2)
  } finally {
    reopened.close()
  }
})

test('facade: openProject on unknown id -> STORE_NOT_FOUND', () => {
  const store = new CatStore({ rootDir: makeTempDir(), entropy: makeEntropy(), now: makeClock() })
  assert.throws(() => store.openProject('prj-0000000000000000'), (err: unknown) => {
    assert.ok(err instanceof StoreNotFoundError)
    return true
  })
})

test('facade: read-only open rejects repository writes with STORE_READ_ONLY', () => {
  const store = new CatStore({ rootDir: makeTempDir(), entropy: makeEntropy(), now: makeClock() })
  const project = store.createProject(INPUT)
  const writable = store.openProject(project.id)
  const { segments } = writable.assets.insertImported(makeImportedAsset({ segmentCount: 1 }))
  writable.close()

  const db = store.openProject(project.id, { readOnly: true })
  try {
    assert.equal(db.readOnly, true)
    // reads fine
    assert.equal(db.segments.getById(segments[0]!.id)?.ordinal, 0)
    // every repository write path rejects
    assert.throws(() => db.assets.insertImported(makeImportedAsset({ segmentCount: 1 })), (err: unknown) => {
      assert.ok(err instanceof StoreReadOnlyError)
      assert.equal(err.code, 'STORE_READ_ONLY')
      return true
    })
    assert.throws(() => db.segments.applyTargetEdit(segments[0]!.id, 'x', 0), StoreReadOnlyError)
    assert.throws(() => db.segments.setLocked(segments[0]!.id, true), StoreReadOnlyError)
    assert.throws(
      () => db.proposals.insertPending({ segmentId: segments[0]!.id, baseRevision: 0, proposedTarget: 'x' }),
      StoreReadOnlyError,
    )
    assert.throws(
      () => db.qaFindings.replaceForSegment(segments[0]!.id, []),
      StoreReadOnlyError,
    )
    assert.throws(
      () => db.exports.record({ assetId: 'ast-0000000000000000', path: 'exports/x', sha256: 'd'.repeat(64), segmentCount: 0 }),
      StoreReadOnlyError,
    )
  } finally {
    db.close()
  }
})
