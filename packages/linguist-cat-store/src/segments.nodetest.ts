import { test } from 'node:test'
import assert from 'node:assert/strict'
import { RevisionConflictError, SegmentLockedError, UnknownSegmentError } from '@linguist/cat-core'
import { CatStore } from './store'
import { makeClock, makeEntropy, makeImportedAsset, makeTempDir } from './testkit'

function setup(segmentCount = 5) {
  const store = new CatStore({ rootDir: makeTempDir(), entropy: makeEntropy(), now: makeClock() })
  const project = store.createProject({ name: 'P', sourceLocale: 'en', targetLocale: 'zh-CN', promaWorkspaceId: 'ws' })
  const db = store.openProject(project.id)
  const { asset, segments } = db.assets.insertImported(makeImportedAsset({ segmentCount }))
  return { store, project, db, asset, segments }
}

test('query: pagination, asset/status filters, deterministic order', () => {
  const { db, asset, segments } = setup(5)
  try {
    const all = db.segments.query({ limit: 100 })
    assert.equal(all.length, 5)
    assert.deepEqual(all.map((s) => s.ordinal), [0, 1, 2, 3, 4])

    const page1 = db.segments.query({ assetId: asset.id, limit: 2, offset: 0 })
    const page2 = db.segments.query({ assetId: asset.id, limit: 2, offset: 2 })
    const page3 = db.segments.query({ assetId: asset.id, limit: 2, offset: 4 })
    assert.deepEqual([...page1, ...page2, ...page3].map((s) => s.id), segments.map((s) => s.id))
    assert.deepEqual(db.segments.queryIds({ assetId: asset.id }), segments.map((s) => s.id))

    assert.equal(db.segments.query({ assetId: 'ast-0000000000000000' }).length, 0)
    assert.equal(db.segments.query({ status: 'untranslated' }).length, 5)

    db.segments.applyTargetEdit(segments[1]!.id, 'done', 0)
    assert.equal(db.segments.query({ status: 'draft' }).length, 1)
    assert.equal(db.segments.query({ status: 'untranslated' }).length, 4)
  } finally {
    db.close()
  }
})

test('query/current-stage counts: 本轮进度过滤和项目/资产聚合不再借用绝对状态', () => {
  const { db, asset, segments } = setup(3)
  try {
    db.segments.applyTargetEdit(segments[0]!.id, 'draft target', 0)
    db.segments.applyTargetEdit(segments[1]!.id, 'confirmed target', 0)
    db.segments.confirmCurrentStage(segments[1]!.id, 'translation', 1)

    assert.deepEqual(
      db.segments.query({ currentStageState: 'untouched' }).map((segment) => segment.id),
      [segments[2]!.id],
    )
    assert.deepEqual(
      db.segments.query({ currentStageState: 'draft' }).map((segment) => segment.id),
      [segments[0]!.id],
    )
    assert.deepEqual(
      db.segments.query({ currentStageState: 'confirmed' }).map((segment) => segment.id),
      [segments[1]!.id],
    )
    assert.equal(db.segments.count({ currentStageState: 'confirmed' }), 1)
    assert.deepEqual(db.segments.queryIds({ currentStageState: 'draft' }), [segments[0]!.id])
    assert.deepEqual(db.segments.countByCurrentStageState(), {
      untouched: 1,
      draft: 1,
      confirmed: 1,
    })
    assert.deepEqual(db.segments.countByAssetAndCurrentStageState().get(asset.id), {
      untouched: 1,
      draft: 1,
      confirmed: 1,
    })
  } finally {
    db.close()
  }
})

test('query: search matches source and target substrings; LIKE wildcards are literal', () => {
  const { db, segments } = setup(3)
  try {
    assert.equal(db.segments.query({ search: 'text 2' }).length, 1)
    db.segments.applyTargetEdit(segments[0]!.id, '独一无二的译文', 0)
    const hits = db.segments.query({ search: '独一无二' })
    assert.equal(hits.length, 1)
    assert.equal(hits[0]?.id, segments[0]!.id)
    // '%' must not act as a wildcard
    assert.equal(db.segments.query({ search: '100%' }).length, 0)
  } finally {
    db.close()
  }
})

test('getById / getByIds: bulk fetch follows input order, unknown ids omitted', () => {
  const { db, segments } = setup(3)
  try {
    assert.equal(db.segments.getById(segments[2]!.id)?.ordinal, 2)
    assert.equal(db.segments.getById('seg-0000000000000000'), undefined)
    const sqlite = db.catDb.db
    const prepare = sqlite.prepare.bind(sqlite)
    let queryExecutions = 0
    sqlite.prepare = ((sql: string) => {
      const statement = prepare(sql)
      if (!sql.includes('FROM segments WHERE id')) return statement
      return new Proxy(statement, {
        get(target, property) {
          const value = Reflect.get(target, property, target)
          if (property !== 'get' && property !== 'all') {
            return typeof value === 'function' ? value.bind(target) : value
          }
          return (...args: unknown[]) => {
            queryExecutions += 1
            return Reflect.apply(value as (...values: unknown[]) => unknown, target, args)
          }
        },
      })
    }) as typeof sqlite.prepare
    const bulk = db.segments.getByIds([segments[2]!.id, 'seg-0000000000000000', segments[0]!.id])
    assert.deepEqual(bulk.map((s) => s.ordinal), [2, 0])
    assert.equal(queryExecutions, 1, 'bulk fetch must execute one SQL query')
  } finally {
    db.close()
  }
})

test('neighborsMany: two segment contexts execute one neighbor query and preserve local order', () => {
  const { db, segments } = setup(6)
  try {
    const sqlite = db.catDb.db
    const prepare = sqlite.prepare.bind(sqlite)
    let queryExecutions = 0
    sqlite.prepare = ((sql: string) => {
      const statement = prepare(sql)
      if (!sql.includes('WITH requested')) return statement
      return new Proxy(statement, {
        get(target, property) {
          const value = Reflect.get(target, property, target)
          if (property !== 'all') return typeof value === 'function' ? value.bind(target) : value
          return (...args: unknown[]) => {
            queryExecutions += 1
            return Reflect.apply(value as (...values: unknown[]) => unknown, target, args)
          }
        },
      })
    }) as typeof sqlite.prepare

    const neighbors = db.segments.neighborsMany([segments[2]!, segments[4]!], 2)
    assert.deepEqual(
      neighbors.get(segments[2]!.id)?.previous.map((segment) => segment.ordinal),
      [0, 1],
    )
    assert.deepEqual(
      neighbors.get(segments[2]!.id)?.next.map((segment) => segment.ordinal),
      [3, 4],
    )
    assert.deepEqual(
      neighbors.get(segments[4]!.id)?.previous.map((segment) => segment.ordinal),
      [2, 3],
    )
    assert.deepEqual(
      neighbors.get(segments[4]!.id)?.next.map((segment) => segment.ordinal),
      [5],
    )
    assert.equal(queryExecutions, 1, 'batch neighbors must execute one SQL query')
  } finally {
    db.close()
  }
})

test('applyTargetEdit: success updates target/status/revision and records history', () => {
  const { db, segments } = setup(2)
  try {
    const result = db.segments.applyTargetEdit(segments[0]!.id, '新译文', 0, { now: '2026-02-01T00:00:00.000Z' })
    assert.equal(result.segment.revision, 1)
    assert.equal(result.segment.status, 'draft')

    const stored = db.segments.getById(segments[0]!.id)
    assert.equal(stored?.target, '新译文')
    assert.equal(stored?.revision, 1)

    const revisions = db.segments.listRevisions(segments[0]!.id)
    assert.equal(revisions.length, 1)
    assert.deepEqual(revisions[0], {
      revision: 1,
      target: '新译文',
      status: 'draft',
      source: 'human',
      createdAt: '2026-02-01T00:00:00.000Z',
    })

    // second edit chains on the new revision
    db.segments.applyTargetEdit(segments[0]!.id, '修改后的译文', 1, { status: 'translated' })
    assert.equal(db.segments.listRevisions(segments[0]!.id).length, 2)
    assert.equal(db.segments.getById(segments[0]!.id)?.status, 'translated')
  } finally {
    db.close()
  }
})

test('manual segment edit advances the durable project event sequence only after commit', () => {
  const { db, segments } = setup(1)
  try {
    assert.equal(db.runs.latestEventSequence, 0)
    db.segments.getById(segments[0]!.id)
    db.segments.query()
    assert.equal(db.runs.latestEventSequence, 0, 'reads must not advance the project event sequence')

    assert.throws(
      () => db.segments.applyTargetEdit(segments[0]!.id, 'stale', 1),
      RevisionConflictError,
    )
    assert.equal(db.runs.latestEventSequence, 0, 'a rejected CAS must not append an event')

    db.segments.applyTargetEdit(segments[0]!.id, '已提交', 0)
    const [event] = db.runs.listEvents()
    assert.equal(db.runs.latestEventSequence, 1)
    assert.equal(event?.kind, 'segment-updated')
    assert.deepEqual(event?.segmentIds, [segments[0]!.id])
  } finally {
    db.close()
  }
})

test('applyTargetEdit: stale expectedRevision -> REVISION_CONFLICT, row untouched', () => {
  const { db, segments } = setup(1)
  try {
    db.segments.applyTargetEdit(segments[0]!.id, 'first', 0)
    assert.throws(
      () => db.segments.applyTargetEdit(segments[0]!.id, 'second', 0),
      (err: unknown) => {
        assert.ok(err instanceof RevisionConflictError)
        assert.equal(err.code, 'REVISION_CONFLICT')
        assert.equal(err.currentRevision, 1)
        return true
      },
    )
    assert.equal(db.segments.getById(segments[0]!.id)?.target, 'first', 'conflict must never overwrite')
    assert.equal(db.segments.listRevisions(segments[0]!.id).length, 1)
  } finally {
    db.close()
  }
})

test('applyTargetEdit: locked segment -> SEGMENT_LOCKED', () => {
  const { db, segments } = setup(1)
  try {
    const locked = db.segments.setLocked(segments[0]!.id, true)
    assert.equal(locked.locked, true)
    assert.equal(db.segments.getById(segments[0]!.id)?.locked, true)
    assert.throws(
      () => db.segments.applyTargetEdit(segments[0]!.id, 'nope', 0),
      (err: unknown) => {
        assert.ok(err instanceof SegmentLockedError)
        assert.equal(err.code, 'SEGMENT_LOCKED')
        return true
      },
    )
    db.segments.setLocked(segments[0]!.id, false)
    db.segments.applyTargetEdit(segments[0]!.id, 'ok now', 0)
    assert.equal(db.segments.getById(segments[0]!.id)?.target, 'ok now')
  } finally {
    db.close()
  }
})

test('applyTargetEdit: unknown segment -> UNKNOWN_SEGMENT', () => {
  const { db } = setup(1)
  try {
    assert.throws(
      () => db.segments.applyTargetEdit('seg-0000000000000000', 'x', 0),
      (err: unknown) => {
        assert.ok(err instanceof UnknownSegmentError)
        assert.equal(err.code, 'UNKNOWN_SEGMENT')
        return true
      },
    )
  } finally {
    db.close()
  }
})

test('confirmCurrentStage: CAS confirms E stage without changing target revision and appends audit events', () => {
  const store = new CatStore({ rootDir: makeTempDir(), entropy: makeEntropy(), now: makeClock() })
  const project = store.createProject({
    name: 'E review',
    sourceLocale: 'en',
    targetLocale: 'zh-CN',
    promaWorkspaceId: 'ws',
    workflowStage: 'editing',
  })
  const db = store.openProject(project.id)
  const { segments } = db.assets.insertImported(makeImportedAsset({ segmentCount: 1, fillEvery: 1 }))
  const segment = segments[0]!
  try {
    assert.equal(db.segments.getById(segment.id)?.currentStageState, 'untouched')

    const confirmed = db.segments.confirmCurrentStage(segment.id, 'editing', 0, {
      actor: 'reviewer',
      now: '2026-07-29T01:00:00.000Z',
    })
    assert.equal(confirmed.segment.currentStageState, 'confirmed')
    assert.equal(confirmed.segment.revision, 0)
    assert.equal(confirmed.segment.status, 'translated')
    assert.throws(
      () => db.segments.confirmCurrentStage(segment.id, 'editing', 0),
      (error: unknown) => error instanceof Error
        && 'code' in error
        && error.code === 'INVALID_STATE_TRANSITION',
    )

    const reopened = db.segments.unconfirmCurrentStage(segment.id, 'editing', 0, {
      actor: 'reviewer',
      now: '2026-07-29T01:01:00.000Z',
    })
    assert.equal(reopened.segment.currentStageState, 'draft')
    assert.throws(
      () => db.segments.unconfirmCurrentStage(segment.id, 'editing', 0),
      (error: unknown) => error instanceof Error
        && 'code' in error
        && error.code === 'INVALID_STATE_TRANSITION',
    )
    assert.deepEqual(db.segments.listStageEvents(segment.id), [
      {
        stage: 'editing',
        action: 'confirmed',
        segmentRevision: 0,
        actor: 'reviewer',
        createdAt: '2026-07-29T01:00:00.000Z',
      },
      {
        stage: 'editing',
        action: 'unconfirmed',
        segmentRevision: 0,
        actor: 'reviewer',
        createdAt: '2026-07-29T01:01:00.000Z',
      },
    ])
  } finally {
    db.close()
  }
})

test('rebaseCurrentStage: switching T/E/P restores only a same-revision confirmation for that stage', () => {
  const store = new CatStore({ rootDir: makeTempDir(), entropy: makeEntropy(), now: makeClock() })
  const project = store.createProject({ name: 'P', sourceLocale: 'en', targetLocale: 'zh-CN', promaWorkspaceId: 'ws' })
  const db = store.openProject(project.id)
  const { segments } = db.assets.insertImported(makeImportedAsset({ segmentCount: 1, fillEvery: 1 }))
  const segment = segments[0]!
  try {
    db.segments.confirmCurrentStage(segment.id, 'editing', 0)
    db.segments.rebaseCurrentStage('proofreading')
    assert.equal(db.segments.getById(segment.id)?.currentStageState, 'untouched')

    db.segments.rebaseCurrentStage('editing')
    assert.equal(db.segments.getById(segment.id)?.currentStageState, 'confirmed')

    db.segments.applyTargetEdit(segment.id, 'new target', 0)
    db.segments.rebaseCurrentStage('editing')
    assert.equal(db.segments.getById(segment.id)?.currentStageState, 'untouched')
  } finally {
    db.close()
  }
})

test('countByStatus: GROUP BY counts with all statuses present, no row load (PB-031)', () => {
  const { db, segments } = setup(5)
  try {
    assert.deepEqual(db.segments.countByStatus(), {
      untranslated: 5,
      draft: 0,
      translated: 0,
      reviewed: 0,
    })

    db.segments.applyTargetEdit(segments[0]!.id, 'drafted', 0)
    db.segments.applyTargetEdit(segments[1]!.id, 'done', 0, { status: 'translated' })
    db.segments.applyTargetEdit(segments[2]!.id, 'ok', 0, { status: 'reviewed' })
    assert.deepEqual(db.segments.countByStatus(), {
      untranslated: 2,
      draft: 1,
      translated: 1,
      reviewed: 1,
    })
  } finally {
    db.close()
  }
})

test('countByStatus: empty project returns all zeros', () => {
  const store = new CatStore({ rootDir: makeTempDir(), entropy: makeEntropy(), now: makeClock() })
  const project = store.createProject({ name: 'P', sourceLocale: 'en', targetLocale: 'zh-CN', promaWorkspaceId: 'ws' })
  const db = store.openProject(project.id)
  try {
    assert.deepEqual(db.segments.countByStatus(), {
      untranslated: 0,
      draft: 0,
      translated: 0,
      reviewed: 0,
    })
  } finally {
    db.close()
  }
})

test('countByAssetAndStatus: GROUP BY keeps each asset independent', () => {
  const { db, asset, segments } = setup(3)
  try {
    const { asset: secondAsset, segments: secondSegments } = db.assets.insertImported(
      makeImportedAsset({ segmentCount: 2, filename: 'second.tsv', sourceSha256: 'b'.repeat(64) }),
    )
    db.segments.applyTargetEdit(segments[0]!.id, 'reviewed', 0, { status: 'reviewed' })
    db.segments.applyTargetEdit(secondSegments[0]!.id, 'translated', 0, { status: 'translated' })

    const counts = db.segments.countByAssetAndStatus()
    assert.deepEqual(counts.get(asset.id), { untranslated: 2, draft: 0, translated: 0, reviewed: 1 })
    assert.deepEqual(counts.get(secondAsset.id), { untranslated: 1, draft: 0, translated: 1, reviewed: 0 })
  } finally {
    db.close()
  }
})

test('countCharactersByAsset: SQLite length sums source and target characters per asset', () => {
  const { db, asset, segments } = setup(3)
  try {
    const { asset: secondAsset, segments: secondSegments } = db.assets.insertImported(
      makeImportedAsset({ segmentCount: 2, filename: 'second.tsv', sourceSha256: 'b'.repeat(64) }),
    )
    db.segments.applyTargetEdit(segments[0]!.id, '译文一', 0)
    db.segments.applyTargetEdit(secondSegments[0]!.id, 'done', 0)

    const counts = db.segments.countCharactersByAsset()
    assert.deepEqual(counts.get(asset.id), { sourceCharacters: 39, targetCharacters: 3 })
    assert.deepEqual(counts.get(secondAsset.id), { sourceCharacters: 26, targetCharacters: 4 })
  } finally {
    db.close()
  }
})
