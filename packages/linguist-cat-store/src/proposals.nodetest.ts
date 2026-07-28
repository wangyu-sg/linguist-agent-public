import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  InvalidStateTransitionError,
  SegmentLockedError,
  StaleProposalError,
  UnknownSegmentError,
  deriveSegmentId,
} from '@linguist/cat-core'
import { CatStore } from './store'
import { makeClock, makeEntropy, makeImportedAsset, makeTempDir } from './testkit'

function setup() {
  const store = new CatStore({ rootDir: makeTempDir(), entropy: makeEntropy(), now: makeClock() })
  const project = store.createProject({ name: 'P', sourceLocale: 'en', targetLocale: 'zh-CN', promaWorkspaceId: 'ws' })
  const db = store.openProject(project.id)
  const { segments } = db.assets.insertImported(makeImportedAsset({ segmentCount: 2 }))
  return { store, project, db, segments }
}

test('insertPending + list by segment/status', () => {
  const { db, segments } = setup()
  try {
    const p = db.proposals.insertPending({
      segmentId: segments[0]!.id,
      baseRevision: 0,
      proposedTarget: '提案译文',
      evidenceRefs: ['tm:1'],
      modelId: 'fake-model',
      now: '2026-01-02T00:00:00.000Z',
    })
    assert.equal(p.status, 'pending')
    assert.match(p.id, /^prp-[0-9a-f]{16}$/)
    assert.deepEqual(db.proposals.getById(p.id), p)
    assert.deepEqual(db.proposals.listBySegment(segments[0]!.id).map((x) => x.id), [p.id])
    assert.deepEqual(db.proposals.listBySegment(segments[0]!.id, 'pending').length, 1)
    assert.deepEqual(db.proposals.listBySegment(segments[0]!.id, 'accepted').length, 0)
    assert.deepEqual(db.proposals.listBySegment(segments[1]!.id).length, 0)
  } finally {
    db.close()
  }
})

test('duplicate pending proposal is idempotent and never creates a second row', () => {
  const { db, segments } = setup()
  try {
    const input = {
      segmentId: segments[0]!.id,
      baseRevision: 0,
      proposedTarget: '同一译文',
      now: '2026-01-02T00:00:00.000Z',
    }
    const first = db.proposals.insertPending(input)
    const duplicate = db.proposals.insertPending(input)
    assert.deepEqual(duplicate, first)
    assert.equal(db.proposals.listBySegment(segments[0]!.id).length, 1)
    db.proposals.reject(first.id)
    assert.throws(() => db.proposals.insertPending(input), InvalidStateTransitionError)
  } finally {
    db.close()
  }
})

test('multi-segment proposal creation is atomic when a later segment is locked', () => {
  const { db, segments } = setup()
  try {
    db.segments.setLocked(segments[1]!.id, true)
    assert.throws(
      () => db.proposals.insertPendingMany([
        { segmentId: segments[0]!.id, baseRevision: 0, proposedTarget: 'A' },
        { segmentId: segments[1]!.id, baseRevision: 0, proposedTarget: 'B' },
      ]),
      SegmentLockedError,
    )
    assert.equal(db.proposals.listBySegment(segments[0]!.id).length, 0)
    assert.equal(db.proposals.listBySegment(segments[1]!.id).length, 0)
  } finally {
    db.close()
  }
})

test('proposal creation rejects unknown and stale segments before writing', () => {
  const { db, segments } = setup()
  try {
    const unknownId = deriveSegmentId(segments[0]!.assetId, 99)
    assert.throws(
      () => db.proposals.insertPending({
        segmentId: unknownId,
        baseRevision: 0,
        proposedTarget: 'unknown',
      }),
      UnknownSegmentError,
    )
    db.segments.applyTargetEdit(segments[0]!.id, '人工译文', 0)
    assert.throws(
      () => db.proposals.insertPending({
        segmentId: segments[0]!.id,
        baseRevision: 0,
        proposedTarget: 'stale',
      }),
      StaleProposalError,
    )
    assert.equal(db.proposals.listBySegment(unknownId).length, 0)
    assert.equal(db.proposals.listBySegment(segments[0]!.id).length, 0)
  } finally {
    db.close()
  }
})

test('accept: proposal accepted, segment updated, revision recorded — atomically', () => {
  const { db, segments } = setup()
  try {
    const p = db.proposals.insertPending({
      segmentId: segments[0]!.id,
      baseRevision: 0,
      proposedTarget: '提案译文',
    })
    const result = db.proposals.accept(p.id, { now: '2026-01-02T00:00:00.000Z' })
    assert.equal(result.proposal.status, 'accepted')
    assert.equal(result.revision.source, 'proposal')

    assert.equal(db.proposals.getById(p.id)?.status, 'accepted')
    const segment = db.segments.getById(segments[0]!.id)
    assert.equal(segment?.target, '提案译文')
    assert.equal(segment?.status, 'translated')
    assert.equal(segment?.revision, 1)
    const revisions = db.segments.listRevisions(segments[0]!.id)
    assert.equal(revisions.length, 1)
    assert.equal(revisions[0]?.source, 'proposal')
    assert.equal(revisions[0]?.createdAt, '2026-01-02T00:00:00.000Z')
  } finally {
    db.close()
  }
})

test('accept: stale baseRevision -> STALE_PROPOSAL, nothing changes (rollback)', () => {
  const { db, segments } = setup()
  try {
    const p = db.proposals.insertPending({
      segmentId: segments[0]!.id,
      baseRevision: 0,
      proposedTarget: '提案译文',
    })
    db.segments.applyTargetEdit(segments[0]!.id, '人工译文', 0) // revision -> 1, proposal now stale
    assert.throws(
      () => db.proposals.accept(p.id),
      (err: unknown) => {
        assert.ok(err instanceof StaleProposalError)
        assert.equal(err.code, 'STALE_PROPOSAL')
        return true
      },
    )
    assert.equal(db.proposals.getById(p.id)?.status, 'pending', 'proposal status must be rolled back')
    assert.equal(db.segments.getById(segments[0]!.id)?.target, '人工译文')
    assert.equal(db.segments.listRevisions(segments[0]!.id).length, 1)
  } finally {
    db.close()
  }
})

test('accept: locked segment -> SEGMENT_LOCKED, proposal stays pending', () => {
  const { db, segments } = setup()
  try {
    const p = db.proposals.insertPending({
      segmentId: segments[0]!.id,
      baseRevision: 0,
      proposedTarget: '提案译文',
    })
    db.segments.setLocked(segments[0]!.id, true)
    assert.throws(
      () => db.proposals.accept(p.id),
      (err: unknown) => {
        assert.ok(err instanceof SegmentLockedError)
        assert.equal(err.code, 'SEGMENT_LOCKED')
        return true
      },
    )
    assert.equal(db.proposals.getById(p.id)?.status, 'pending')
  } finally {
    db.close()
  }
})

test('multi-segment acceptance is atomic when a later proposal fails', () => {
  const { db, segments } = setup()
  try {
    const proposals = db.proposals.insertPendingMany([
      { segmentId: segments[0]!.id, baseRevision: 0, proposedTarget: 'A' },
      { segmentId: segments[1]!.id, baseRevision: 0, proposedTarget: 'B' },
    ])
    db.segments.setLocked(segments[1]!.id, true)
    assert.throws(
      () => db.proposals.acceptMany(proposals.map((proposal) => proposal.id)),
      SegmentLockedError,
    )
    assert.equal(db.proposals.getById(proposals[0]!.id)?.status, 'pending')
    assert.equal(db.proposals.getById(proposals[1]!.id)?.status, 'pending')
    assert.equal(db.segments.getById(segments[0]!.id)?.target, '')
    assert.equal(db.segments.getById(segments[0]!.id)?.revision, 0)
    assert.equal(db.segments.listRevisions(segments[0]!.id).length, 0)
  } finally {
    db.close()
  }
})

test('multi-segment transaction accepts every selected proposal in input order', () => {
  const { db, segments } = setup()
  try {
    const proposals = db.proposals.insertPendingMany([
      { segmentId: segments[0]!.id, baseRevision: 0, proposedTarget: 'A' },
      { segmentId: segments[1]!.id, baseRevision: 0, proposedTarget: 'B' },
    ])
    const accepted = db.proposals.acceptMany(proposals.map((proposal) => proposal.id), {
      now: '2026-01-02T00:00:00.000Z',
    })
    assert.deepEqual(accepted.map((result) => result.proposal.id), proposals.map((proposal) => proposal.id))
    assert.deepEqual(
      segments.map((segment) => db.segments.getById(segment.id)?.target),
      ['A', 'B'],
    )
    assert.deepEqual(accepted.map((result) => result.proposal.status), ['accepted', 'accepted'])
  } finally {
    db.close()
  }
})

test('reject / supersede / invalid transitions', () => {
  const { db, segments } = setup()
  try {
    const p1 = db.proposals.insertPending({ segmentId: segments[0]!.id, baseRevision: 0, proposedTarget: 'A' })
    const p2 = db.proposals.insertPending({ segmentId: segments[0]!.id, baseRevision: 0, proposedTarget: 'B' })

    assert.equal(db.proposals.reject(p1.id).status, 'rejected')
    assert.equal(db.proposals.supersede(p2.id).status, 'superseded')
    assert.equal(db.proposals.getById(p1.id)?.status, 'rejected')
    assert.equal(db.proposals.getById(p2.id)?.status, 'superseded')

    for (const op of [
      () => db.proposals.accept(p1.id),
      () => db.proposals.reject(p1.id),
      () => db.proposals.supersede(p2.id),
    ]) {
      assert.throws(op, (err: unknown) => {
        assert.ok(err instanceof InvalidStateTransitionError)
        assert.equal(err.code, 'INVALID_STATE_TRANSITION')
        return true
      })
    }
  } finally {
    db.close()
  }
})

test('expireStale marks only revision-mismatched pending proposals and listPending excludes them', () => {
  const { db, segments } = setup()
  try {
    const stale = db.proposals.insertPending({
      segmentId: segments[0]!.id,
      baseRevision: 0,
      proposedTarget: 'A',
    })
    const current = db.proposals.insertPending({
      segmentId: segments[1]!.id,
      baseRevision: 0,
      proposedTarget: 'B',
    })
    db.segments.applyTargetEdit(segments[0]!.id, '人工译文', 0)

    assert.deepEqual(db.proposals.expireStale().map((proposal) => proposal.id), [stale.id])
    assert.equal(db.proposals.getById(stale.id)?.status, 'expired')
    assert.deepEqual(db.proposals.listPending().map((proposal) => proposal.id), [current.id])
  } finally {
    db.close()
  }
})

test('PB-053 idempotent acceptSelected replays once and rejects key reuse with another request', () => {
  const { db, segments } = setup()
  try {
    const proposals = db.proposals.insertPendingMany([
      { segmentId: segments[0]!.id, baseRevision: 0, proposedTarget: 'A' },
      { segmentId: segments[1]!.id, baseRevision: 0, proposedTarget: 'B' },
    ])
    const request = proposals.map((proposal) => ({ proposalId: proposal.id, expectedRevision: 0 }))
    const first = db.proposals.acceptSelected(request, 'accept-key-1', {
      now: '2026-01-02T00:00:00.000Z',
    })
    const replay = db.proposals.acceptSelected(request, 'accept-key-1', {
      now: '2026-01-02T00:00:00.000Z',
    })
    assert.equal(first.ok, true)
    assert.equal(first.ok && first.replayed, false)
    assert.equal(replay.ok && replay.replayed, true)
    if (first.ok && replay.ok) assert.deepEqual(replay.result, first.result)
    assert.equal(db.segments.listRevisions(segments[0]!.id).length, 1)
    assert.equal(db.segments.listRevisions(segments[1]!.id).length, 1)

    const conflict = db.proposals.acceptSelected(
      [{ proposalId: proposals[0]!.id, expectedRevision: 0 }],
      'accept-key-1',
    )
    assert.deepEqual(conflict, { ok: false, conflict: true })
  } finally {
    db.close()
  }
})

test('PB-053 rejectSelected checks every expected revision and rolls back partial selection', () => {
  const { db, segments } = setup()
  try {
    const proposals = db.proposals.insertPendingMany([
      { segmentId: segments[0]!.id, baseRevision: 0, proposedTarget: 'A' },
      { segmentId: segments[1]!.id, baseRevision: 0, proposedTarget: 'B' },
    ])
    assert.throws(
      () => db.proposals.rejectSelected([
        { proposalId: proposals[0]!.id, expectedRevision: 0 },
        { proposalId: proposals[1]!.id, expectedRevision: 1 },
      ], 'reject-key-stale'),
      StaleProposalError,
    )
    assert.deepEqual(proposals.map((proposal) => db.proposals.getById(proposal.id)?.status), [
      'pending',
      'pending',
    ])
    const rejected = db.proposals.rejectSelected(
      proposals.map((proposal) => ({ proposalId: proposal.id, expectedRevision: 0 })),
      'reject-key-ok',
    )
    assert.equal(rejected.ok, true)
    if (rejected.ok) {
      assert.deepEqual(rejected.result.map((proposal) => proposal.status), ['rejected', 'rejected'])
    }
  } finally {
    db.close()
  }
})

test('PB-053 editAndAccept supersedes the original, accepts a derived proposal, and is idempotent', () => {
  const { db, segments } = setup()
  try {
    const original = db.proposals.insertPending({
      segmentId: segments[0]!.id,
      baseRevision: 0,
      proposedTarget: 'Original 0',
      modelId: 'model',
      sessionId: 'session',
      now: '2026-01-01T00:00:00.000Z',
    })
    const first = db.proposals.editAndAccept({
      proposalId: original.id,
      expectedRevision: 0,
      editedTarget: '人工编辑 0',
      idempotencyKey: 'edit-key-1',
      now: '2026-01-02T00:00:00.000Z',
    })
    assert.equal(first.ok, true)
    if (first.ok) {
      assert.notEqual(first.result.proposal.id, original.id)
      assert.equal(first.result.proposal.status, 'accepted')
      assert.equal(first.result.proposal.proposedTarget, '人工编辑 0')
    }
    assert.equal(db.proposals.getById(original.id)?.status, 'superseded')
    assert.equal(db.segments.getById(segments[0]!.id)?.target, '人工编辑 0')
    assert.equal(db.segments.getById(segments[0]!.id)?.revision, 1)
    const replay = db.proposals.editAndAccept({
      proposalId: original.id,
      expectedRevision: 0,
      editedTarget: '人工编辑 0',
      idempotencyKey: 'edit-key-1',
      now: '2026-01-02T00:00:00.000Z',
    })
    assert.equal(replay.ok && replay.replayed, true)
    if (first.ok && replay.ok) assert.deepEqual(replay.result, first.result)
    assert.equal(db.segments.listRevisions(segments[0]!.id).length, 1)
  } finally {
    db.close()
  }
})

test('accept: mid-transaction failure rolls back all writes', () => {
  const { db, segments } = setup()
  try {
    const p = db.proposals.insertPending({ segmentId: segments[0]!.id, baseRevision: 0, proposedTarget: 'A' })
    // Induce a failure AFTER the first write of a manual two-statement flow:
    // the duplicate PK on segment_revisions must roll back the status update.
    assert.throws(() =>
      db.catDb.transaction('induced proposal failure', () => {
        db.catDb.db.prepare('UPDATE proposals SET status = ? WHERE id = ?').run('accepted', p.id)
        db.catDb.db
          .prepare('INSERT INTO segment_revisions (segment_id, revision, target, status, source, created_at) VALUES (?, ?, ?, ?, ?, ?)')
          .run(segments[0]!.id, 1, 'x', 'translated', 'proposal', 'now')
        // duplicate (segment_id, revision) PK
        db.catDb.db
          .prepare('INSERT INTO segment_revisions (segment_id, revision, target, status, source, created_at) VALUES (?, ?, ?, ?, ?, ?)')
          .run(segments[0]!.id, 1, 'y', 'translated', 'proposal', 'now')
      }),
    )
    assert.equal(db.proposals.getById(p.id)?.status, 'pending', 'first statement must be rolled back')
    assert.equal(db.segments.listRevisions(segments[0]!.id).length, 0)
  } finally {
    db.close()
  }
})

test('PB-097 editAndAccept：tagProfile 项目族违规拦截人工编辑后的目标，缺省仅内置族放行', () => {
  const { db } = setup()
  try {
    const imported = makeImportedAsset({ segmentCount: 1, sourceSha256: 'c'.repeat(64) })
    imported.segments[0] = { ...imported.segments[0]!, source: '获得 [Grm:Qty S=""] 个' }
    const { segments } = db.assets.insertImported(imported)
    const original = db.proposals.insertPending({
      segmentId: segments[0]!.id,
      baseRevision: 0,
      proposedTarget: '获得 [Grm:Qty S=""] 个',
    })
    const tagProfile = {
      families: [{ id: 'grm-qty', pattern: '\\[Grm:Qty[^\\]]*\\]', class: 'singleton' as const }],
    }
    // 编辑后丢项目族 tag：硬门拦截（与提案路径同一道 runDeterministicHardRules）
    assert.throws(
      () => db.proposals.editAndAccept({
        proposalId: original.id,
        expectedRevision: 0,
        editedTarget: '获得 个',
        idempotencyKey: 'edit-key-tag',
        tagProfile,
      }),
      InvalidStateTransitionError,
    )
    assert.equal(db.segments.getById(segments[0]!.id)?.target, '')
    // 缺省（仅内置族）：同一编辑放行
    const ok = db.proposals.editAndAccept({
      proposalId: original.id,
      expectedRevision: 0,
      editedTarget: '获得 个',
      idempotencyKey: 'edit-key-tag-2',
    })
    assert.equal(ok.ok, true)
  } finally {
    db.close()
  }
})

test('终态提案显式重发：保留旧裁决、建立 lineage/run，并支持幂等的新裁决', () => {
  const { db, segments } = setup()
  try {
    const original = db.proposals.insertPending({
      segmentId: segments[0]!.id,
      baseRevision: 0,
      proposedTarget: '曾被误拒绝、后来确认正确',
      modelId: 'candidate-model',
      sessionId: 'candidate-session',
      runId: 'candidate-run',
      now: '2026-07-29T00:00:00.000Z',
    })
    db.proposals.reject(original.id)

    const first = db.proposals.reissueTerminal({
      proposalId: original.id,
      expectedRevision: 0,
      idempotencyKey: 'reissue-key-1',
      runId: 'human-reconcile-run',
      now: '2026-07-29T01:00:00.000Z',
    })
    const replay = db.proposals.reissueTerminal({
      proposalId: original.id,
      expectedRevision: 0,
      idempotencyKey: 'reissue-key-1',
      runId: 'human-reconcile-run',
      now: '2026-07-29T01:00:00.000Z',
    })

    assert.equal(first.ok, true)
    assert.equal(replay.ok && replay.replayed, true)
    if (!first.ok || !replay.ok) return
    assert.deepEqual(replay.result, first.result)
    assert.notEqual(first.result.id, original.id)
    assert.equal(first.result.status, 'pending')
    assert.equal(first.result.reissuedFromProposalId, original.id)
    assert.equal(first.result.runId, 'human-reconcile-run')
    assert.equal(first.result.modelId, 'candidate-model')
    assert.equal(first.result.sessionId, 'candidate-session')
    assert.equal(db.proposals.getById(original.id)?.status, 'rejected')

    const accepted = db.proposals.acceptSelected(
      [{ proposalId: first.result.id, expectedRevision: 0 }],
      'accept-reissued-1',
    )
    assert.equal(accepted.ok, true)
    assert.equal(db.segments.getById(segments[0]!.id)?.target, original.proposedTarget)
    assert.deepEqual(
      db.proposals.list({}).map((proposal) => proposal.status).sort(),
      ['accepted', 'rejected'],
    )
  } finally {
    db.close()
  }
})

test('重发只接受终态与当前 revision；pending/stale 均 fail closed', () => {
  const { db, segments } = setup()
  try {
    const pending = db.proposals.insertPending({
      segmentId: segments[0]!.id,
      baseRevision: 0,
      proposedTarget: 'pending',
    })
    assert.throws(
      () => db.proposals.reissueTerminal({
        proposalId: pending.id,
        expectedRevision: 0,
        idempotencyKey: 'pending-cannot-reissue',
      }),
      InvalidStateTransitionError,
    )
    db.proposals.reject(pending.id)
    db.segments.applyTargetEdit(segments[0]!.id, 'moved', 0)
    assert.throws(
      () => db.proposals.reissueTerminal({
        proposalId: pending.id,
        expectedRevision: 0,
        idempotencyKey: 'stale-reissue',
      }),
      StaleProposalError,
    )
    assert.equal(db.proposals.list({ status: 'pending' }).length, 0)
  } finally {
    db.close()
  }
})
