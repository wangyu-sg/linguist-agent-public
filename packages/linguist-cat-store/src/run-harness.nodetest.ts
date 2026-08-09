import { test } from 'node:test'
import assert from 'node:assert/strict'
import { CatStore } from './store'
import {
  StoreAuthorityError,
  StoreIdempotencyConflictError,
  StoreJobStateError,
  StoreReadOnlyError,
} from './errors'
import type { ProjectDatabase } from './project-database'
import { translationJobScopeDigest } from './run-harness'
import { makeClock, makeEntropy, makeImportedAsset, makeTempDir } from './testkit'

function setup(segmentCount = 3) {
  const rootDir = makeTempDir()
  const store = new CatStore({ rootDir, entropy: makeEntropy(), now: makeClock() })
  const project = store.createProject({
    name: 'Harness',
    sourceLocale: 'en',
    targetLocale: 'zh-CN',
    promaWorkspaceId: 'ws',
  })
  const db = store.openProject(project.id)
  const { segments } = db.assets.insertImported(makeImportedAsset({ segmentCount }))
  return { store, project, db, segments }
}

test('translation job: durable checkpoint survives reopen and keeps frozen provenance', () => {
  const { store, project, db, segments } = setup()
  const segmentIds = segments.map((segment) => segment.id as string)
  const provenance = {
    schemaVersion: 1 as const,
    runtime: 'pi',
    modelId: 'model-1',
    promptVersion: 'linguist-v3',
    projectDigestHash: 'a'.repeat(64),
    contextSnapshotId: 'ctx-1',
  }
  const proposals = db.proposals.insertPendingMany(
    segments.slice(0, 2).map((segment, index) => ({
      segmentId: segment.id,
      baseRevision: segment.revision,
      proposedTarget: `译文 ${index}`,
      runId: 'run-1',
    })),
  )
  const proposalIds = proposals.map((proposal) => proposal.id as string)

  db.runs.createJob({
    jobId: 'job-1',
    runId: 'run-1',
    sessionId: 'session-1',
    strategy: 'balanced',
    segmentIds,
    provenance,
  })
  db.runs.transitionJob('job-1', { sessionId: 'session-1' }, 'running')
  db.runs.checkpointJob({
    jobId: 'job-1',
    sessionId: 'session-1',
    cursor: 2,
    completedSegmentIds: segmentIds.slice(0, 2),
    failedSegmentIds: [],
    proposalIds,
    openItemIds: ['ambiguity-1'],
  })
  db.close()

  const reopened = store.openProject(project.id)
  try {
    const job = reopened.runs.getJob('job-1', { sessionId: 'session-1' })
    assert.ok(job)
    assert.equal(job.status, 'running')
    assert.equal(job.cursor, 2)
    assert.deepEqual(job.segmentIds, segmentIds)
    assert.deepEqual(job.completedSegmentIds, segmentIds.slice(0, 2))
    assert.deepEqual(job.failedSegmentIds, [])
    assert.deepEqual(job.proposalIds, proposalIds)
    assert.deepEqual(job.openItemIds, ['ambiguity-1'])
    assert.deepEqual(job.provenance, provenance)
    assert.deepEqual(
      Object.fromEntries(job.segmentIds.map((segmentId) => [segmentId, job.baseRevisions[segmentId]])),
      Object.fromEntries(segmentIds.map((segmentId) => [segmentId, 0])),
    )
    assert.throws(
      () => reopened.runs.getJob('job-1', { sessionId: 'another-session' }),
      StoreAuthorityError,
    )
  } finally {
    reopened.close()
  }
})

test('translation job: pause, restart, retry and resume continue from the durable checkpoint', () => {
  const { store, project, db, segments } = setup()
  const segmentIds = segments.map((segment) => segment.id as string)
  const authority = { sessionId: 'session-resume' }
  db.runs.createJob({
    jobId: 'job-resume',
    runId: 'run-resume',
    sessionId: authority.sessionId,
    strategy: 'balanced',
    segmentIds,
    provenance: { schemaVersion: 1, runtime: 'worker' },
  })
  db.runs.transitionJob('job-resume', authority, 'running')
  db.runs.checkpointJob({
    jobId: 'job-resume',
    ...authority,
    cursor: 1,
    completedSegmentIds: segmentIds.slice(0, 1),
    failedSegmentIds: [],
    proposalIds: [],
    openItemIds: [],
  })
  db.runs.transitionJob('job-resume', authority, 'paused')
  db.close()

  const reopened = store.openProject(project.id)
  try {
    const paused = reopened.runs.getJob('job-resume', authority)
    assert.equal(paused?.status, 'paused')
    assert.equal(paused?.cursor, 1)
    reopened.runs.transitionJob('job-resume', authority, 'running')
    reopened.runs.checkpointJob({
      jobId: 'job-resume',
      ...authority,
      cursor: segmentIds.length,
      completedSegmentIds: segmentIds,
      failedSegmentIds: [],
      proposalIds: [],
      openItemIds: [],
    })
    const completed = reopened.runs.transitionJob('job-resume', authority, 'completed')
    assert.equal(completed.status, 'completed')
    assert.equal(completed.cursor, segmentIds.length)
    assert.deepEqual(completed.completedSegmentIds, segmentIds)
    assert.deepEqual(
      reopened.runs.listEvents().map((event) => [event.sequence, event.kind, event.job?.status]),
      [
        [1, 'job-updated', 'pending'],
        [2, 'job-updated', 'running'],
        [3, 'job-updated', 'running'],
        [4, 'job-updated', 'paused'],
        [5, 'job-updated', 'running'],
        [6, 'job-updated', 'running'],
        [7, 'job-updated', 'completed'],
      ],
    )
  } finally {
    reopened.close()
  }
})

test('run mutation: same key replays after restart; conflicting payload fails closed', () => {
  const { store, project, db, segments } = setup()
  const segment = segments[0]!
  const identity = {
    runId: 'run-idempotent',
    toolCallId: 'tool-call-1',
    idempotencyKey: 'mutation-1',
  }
  const execute = (handle: ProjectDatabase, target: string, mutate = true) =>
    handle.runs.executeMutation({
      identity,
      operation: 'cat_propose_translations',
      payload: { segmentId: segment.id as string, baseRevision: 0, target },
      mutate: () => {
        assert.equal(mutate, true, 'replay/conflict must not execute the mutation callback')
        const proposal = handle.proposals.insertPending({
          segmentId: segment.id,
          baseRevision: 0,
          proposedTarget: target,
          runId: identity.runId,
        })
        return {
          result: { proposalId: proposal.id as string },
          changes: [{
            entityType: 'proposal',
            entityId: proposal.id as string,
            changeKind: 'created' as const,
            segmentId: segment.id as string,
            expectedRevision: 0,
            after: proposal,
          }],
          event: {
            kind: 'proposal-created',
            segmentIds: [segment.id as string],
            proposalIds: [proposal.id as string],
          },
        }
      },
    })

  const first = execute(db, '译文 0')
  assert.equal(first.replayed, false)
  assert.ok(first.event)
  assert.equal(first.event.sequence, 1)
  db.close()

  const reopened = store.openProject(project.id)
  try {
    const replay = execute(reopened, '译文 0', false)
    assert.equal(replay.replayed, true)
    assert.deepEqual(replay.result, first.result)
    assert.deepEqual(replay.event, first.event)
    assert.throws(
      () => execute(reopened, '另一译文 0', false),
      StoreIdempotencyConflictError,
    )
    assert.equal(reopened.proposals.count(), 1)
    assert.deepEqual(reopened.runs.listEvents(), [first.event])
  } finally {
    reopened.close()
  }
})

test('project event outbox: ordered replay is read-only and acknowledgements survive restart', () => {
  const { store, project, db, segments } = setup()
  segments.slice(0, 2).forEach((segment, index) => {
    const runId = `run-event-${index}`
    const toolCallId = `tool-event-${index}`
    const idempotencyKey = `mutation-event-${index}`
    db.runs.executeMutation({
      identity: { runId, toolCallId, idempotencyKey },
      operation: 'cat_propose_translations',
      payload: { segmentId: segment.id as string, target: `事件译文 ${index}` },
      mutate: () => {
        const proposal = db.proposals.insertPending({
          segmentId: segment.id,
          baseRevision: segment.revision,
          proposedTarget: `事件译文 ${index}`,
          runId,
        })
        return {
          result: { proposalId: proposal.id as string },
          changes: [{
            entityType: 'proposal' as const,
            entityId: proposal.id as string,
            changeKind: 'created' as const,
            segmentId: segment.id as string,
            expectedRevision: segment.revision,
            after: proposal,
          }],
          event: {
            kind: 'proposal-created' as const,
            segmentIds: [segment.id as string],
            proposalIds: [proposal.id as string],
          },
        }
      },
    })
  })

  assert.deepEqual(db.runs.listEvents().map((event) => event.sequence), [1, 2])
  assert.deepEqual(db.runs.listEvents(1).map((event) => event.sequence), [2])
  assert.equal(db.runs.getEventAck('renderer-1'), undefined, 'reading must not acknowledge')
  const firstAck = db.runs.ackEvents('renderer-1', 1)
  assert.deepEqual(db.runs.ackEvents('renderer-1', 1), firstAck)
  const secondAck = db.runs.ackEvents('renderer-1', 2)
  assert.equal(secondAck.sequence, 2)
  db.close()

  const reopened = store.openProject(project.id)
  try {
    assert.deepEqual(reopened.runs.listEvents().map((event) => event.sequence), [1, 2])
    assert.equal(reopened.runs.getEventAck('renderer-1')?.sequence, 2)
    assert.deepEqual(reopened.runs.listEvents(2), [])
  } finally {
    reopened.close()
  }
})

test('compaction capsule: versioned job state stays within budget and excludes customer text', () => {
  const { db, segments } = setup(24)
  const segmentIds = segments.map((segment) => segment.id as string)
  db.runs.createJob({
    jobId: 'job-capsule',
    runId: 'run-capsule',
    sessionId: 'session-capsule',
    strategy: 'best',
    segmentIds,
    provenance: {
      schemaVersion: 1,
      runtime: 'claude',
      modelProvider: 'anthropic',
      modelId: 'model-capsule',
      promptVersion: 'linguist-v3',
      projectDigestHash: 'b'.repeat(64),
      contextSnapshotId: 'ctx-capsule',
    },
  })
  db.runs.transitionJob('job-capsule', { sessionId: 'session-capsule' }, 'running')
  db.runs.checkpointJob({
    jobId: 'job-capsule',
    sessionId: 'session-capsule',
    cursor: 10,
    completedSegmentIds: segmentIds.slice(0, 9),
    failedSegmentIds: [segmentIds[9]!],
    proposalIds: [],
    openItemIds: Array.from({ length: 12 }, (_, index) => `ambiguity-${index}`),
  })

  try {
    const capsule = db.runs.createStateCapsule(
      'job-capsule',
      { sessionId: 'session-capsule' },
      { maxBytes: 700 },
    )
    const serialized = JSON.stringify(capsule)
    assert.ok(Buffer.byteLength(serialized, 'utf8') <= 700)
    assert.equal(capsule.schemaVersion, 1)
    assert.equal(capsule.projectId, db.projectId)
    assert.equal(capsule.jobId, 'job-capsule')
    assert.equal(capsule.scope.totalSegments, 24)
    assert.match(capsule.scope.digest, /^[a-f0-9]{64}$/)
    assert.equal(capsule.progress.cursor, 10)
    assert.equal(capsule.progress.completedCount, 9)
    assert.equal(capsule.progress.failedCount, 1)
    assert.equal(capsule.progress.pendingCount, 14)
    assert.equal(capsule.truncated, true)
    assert.equal(serialized.includes('Source text'), false)
    assert.equal(db.runs.getJob(capsule.jobId, { sessionId: 'session-capsule' })?.segmentIds.length, 24)
  } finally {
    db.close()
  }
})

test('scope digest: canonical hash binds frozen segment ids and base revisions', () => {
  const { db, segments } = setup()
  const segmentIds = segments.map((segment) => segment.id as string)
  const job = db.runs.createJob({
    jobId: 'job-digest',
    runId: 'run-digest',
    sessionId: 'session-digest',
    strategy: 'balanced',
    segmentIds,
    provenance: { schemaVersion: 1, runtime: 'pi' },
  })
  try {
    const digest = translationJobScopeDigest(job.segmentIds, job.baseRevisions)
    assert.match(digest, /^[a-f0-9]{64}$/)
    // 纯函数：同一冻结输入逐字节一致
    assert.equal(translationJobScopeDigest(job.segmentIds, job.baseRevisions), digest)
    // 与 state capsule 的 scope.digest 同源（同一 helper）
    const capsule = db.runs.createStateCapsule(
      'job-digest',
      { sessionId: 'session-digest' },
      { maxBytes: 1024 },
    )
    assert.equal(capsule.scope.digest, digest)
    // revision 或范围任一变化都必须改变 digest（traceability 敏感度）
    const [firstId] = segmentIds
    assert.notEqual(
      translationJobScopeDigest(segmentIds, { ...job.baseRevisions, [firstId!]: 1 }),
      digest,
    )
    assert.notEqual(
      translationJobScopeDigest(segmentIds.slice(1), { ...job.baseRevisions }),
      digest,
    )
  } finally {
    db.close()
  }
})

test('run change summary: aggregates durable job progress and structured mutations without text', () => {
  const { db, segments } = setup()
  const runId = 'run-summary'
  db.runs.createJob({
    jobId: 'job-summary',
    runId,
    sessionId: 'session-summary',
    strategy: 'fast',
    segmentIds: segments.map((segment) => segment.id as string),
    provenance: { schemaVersion: 1, runtime: 'pi' },
  })
  db.runs.transitionJob('job-summary', { sessionId: 'session-summary' }, 'running')

  segments.slice(0, 2).forEach((segment, index) => {
    db.runs.executeMutation({
      identity: {
        runId,
        toolCallId: `summary-call-${index}`,
        idempotencyKey: `summary-key-${index}`,
      },
      operation: 'cat_propose_translations',
      payload: { segmentId: segment.id as string, proposedTarget: `摘要译文 ${index}` },
      mutate: () => {
        const proposal = db.proposals.insertPending({
          segmentId: segment.id,
          baseRevision: segment.revision,
          proposedTarget: `摘要译文 ${index}`,
          runId,
        })
        return {
          result: { proposalId: proposal.id as string },
          changes: [{
            entityType: 'proposal' as const,
            entityId: proposal.id as string,
            changeKind: 'created' as const,
            segmentId: segment.id as string,
            expectedRevision: segment.revision,
            after: proposal,
          }],
          event: {
            kind: 'proposal-created' as const,
            segmentIds: [segment.id as string],
            proposalIds: [proposal.id as string],
          },
        }
      },
    })
  })

  try {
    const summary = db.runs.getRunChangeSummary(runId)
    assert.deepEqual(summary.job, {
      jobId: 'job-summary',
      status: 'running',
      scopedSegments: 3,
      cursor: 0,
      completedSegments: 0,
      failedSegments: 0,
    })
    assert.equal(summary.mutationCount, 2)
    assert.deepEqual(summary.changes, {
      proposalsCreated: 2,
      qaFindingsCreated: 0,
      qaFindingsUpdated: 0,
      filesTouched: 0,
      total: 2,
      undone: 0,
    })
    assert.deepEqual(summary.eventSequence, { first: 1, last: 4 })
    assert.equal(summary.canUndo, true)
    assert.equal(JSON.stringify(summary).includes('摘要译文'), false)
  } finally {
    db.close()
  }
})

test('latest run change summary follows durable user events and ignores suppressed diagnostics jobs', () => {
  const { db, segments } = setup()
  const segmentIds = segments.map((segment) => segment.id as string)
  try {
    assert.equal(db.runs.getLatestRunChangeSummary(), undefined)
    db.runs.createJob({
      jobId: 'job-visible-1',
      runId: 'run-visible-1',
      sessionId: 'session-visible',
      strategy: 'balanced',
      segmentIds,
      provenance: { schemaVersion: 1, runtime: 'node-worker_threads' },
    })
    db.runs.createJob({
      jobId: 'job-diagnostics',
      runId: 'run-diagnostics',
      sessionId: 'session-diagnostics',
      strategy: 'balanced',
      segmentIds,
      provenance: {
        schemaVersion: 1,
        runtime: 'node-worker_threads',
        projectEventPolicy: 'suppress',
      },
    })
    assert.equal(db.runs.getLatestRunChangeSummary()?.runId, 'run-visible-1')

    db.runs.createJob({
      jobId: 'job-visible-2',
      runId: 'run-visible-2',
      sessionId: 'session-visible',
      strategy: 'best',
      segmentIds,
      provenance: { schemaVersion: 1, runtime: 'node-worker_threads' },
    })
    assert.equal(db.runs.getLatestRunChangeSummary()?.runId, 'run-visible-2')

    db.segments.applyTargetEdit(segmentIds[0]!, '人工编辑不应遮蔽最近 Run', 0)
    assert.equal(
      db.runs.getLatestRunChangeSummary()?.runId,
      'run-visible-2',
      'manual outbox events are not runnable agent summaries',
    )
  } finally {
    db.close()
  }
})

test('structured undo: removes only the unchanged pending proposal created by the run', () => {
  const { db, segments } = setup()
  const segment = segments[0]!
  const runId = 'run-undo-success'
  const mutation = db.runs.executeMutation({
    identity: {
      runId,
      toolCallId: 'undo-success-call',
      idempotencyKey: 'undo-success-key',
    },
    operation: 'cat_propose_translations',
    payload: { segmentId: segment.id as string, proposedTarget: '待撤销译文 0' },
    mutate: () => {
      const proposal = db.proposals.insertPending({
        segmentId: segment.id,
        baseRevision: segment.revision,
        proposedTarget: '待撤销译文 0',
        runId,
      })
      return {
        result: { proposalId: proposal.id as string },
        changes: [{
          entityType: 'proposal' as const,
          entityId: proposal.id as string,
          changeKind: 'created' as const,
          segmentId: segment.id as string,
          expectedRevision: segment.revision,
          after: proposal,
        }],
        event: {
          kind: 'proposal-created' as const,
          segmentIds: [segment.id as string],
          proposalIds: [proposal.id as string],
        },
      }
    },
  })

  try {
    const result = db.runs.undoRun(runId, { actorId: 'human-1' })
    assert.equal(result.status, 'completed')
    assert.deepEqual(result.reverted, [{
      entityType: 'proposal',
      entityId: mutation.result.proposalId,
    }])
    assert.deepEqual(result.refused, [])
    assert.equal(db.proposals.getById(mutation.result.proposalId), undefined)
    assert.equal(result.event?.sequence, 2)
    assert.equal(result.event?.kind, 'run-undone')
    assert.equal(db.runs.getRunChangeSummary(runId).changes.undone, 1)
    assert.equal(db.runs.getRunChangeSummary(runId).canUndo, false)
    assert.equal(db.runs.undoRun(runId, { actorId: 'human-1' }).status, 'already-undone')
    assert.equal(db.runs.listEvents().length, 2)
  } finally {
    db.close()
  }
})

test('structured undo: later human revision is preserved and reported as a partial refusal', () => {
  const { db, segments } = setup()
  const runId = 'run-undo-partial'
  const mutation = db.runs.executeMutation({
    identity: {
      runId,
      toolCallId: 'undo-partial-call',
      idempotencyKey: 'undo-partial-key',
    },
    operation: 'cat_propose_translations',
    payload: {
      items: segments.slice(0, 2).map((segment, index) => ({
        segmentId: segment.id as string,
        proposedTarget: `候选 ${index}`,
      })),
    },
    mutate: () => {
      const proposals = db.proposals.insertPendingMany(
        segments.slice(0, 2).map((segment, index) => ({
          segmentId: segment.id,
          baseRevision: segment.revision,
          proposedTarget: `候选 ${index}`,
          runId,
        })),
      )
      return {
        result: { proposalIds: proposals.map((proposal) => proposal.id as string) },
        changes: proposals.map((proposal) => ({
          entityType: 'proposal' as const,
          entityId: proposal.id as string,
          changeKind: 'created' as const,
          segmentId: proposal.segmentId as string,
          expectedRevision: proposal.baseRevision,
          after: proposal,
        })),
        event: {
          kind: 'proposal-created' as const,
          segmentIds: proposals.map((proposal) => proposal.segmentId as string),
          proposalIds: proposals.map((proposal) => proposal.id as string),
        },
      }
    },
  })
  db.segments.applyTargetEdit(segments[1]!.id, '人工后续译文', 0)

  try {
    const result = db.runs.undoRun(runId, { actorId: 'human-2' })
    assert.equal(result.status, 'partial')
    assert.deepEqual(result.reverted, [{
      entityType: 'proposal',
      entityId: mutation.result.proposalIds[0],
    }])
    assert.deepEqual(result.refused, [{
      entityType: 'proposal',
      entityId: mutation.result.proposalIds[1],
      reason: 'segment revision changed from 0 to 1',
    }])
    assert.equal(db.proposals.getById(mutation.result.proposalIds[0]!), undefined)
    assert.equal(db.proposals.getById(mutation.result.proposalIds[1]!)?.status, 'pending')
    assert.equal(db.segments.getById(segments[1]!.id)?.target, '人工后续译文')
    assert.equal(db.segments.getById(segments[1]!.id)?.revision, 1)
    assert.equal(db.runs.undoRun(runId, { actorId: 'human-2' }).status, 'refused')
    assert.equal(db.runs.listEvents().length, 3, 'the later human segment edit is durable too')
  } finally {
    db.close()
  }
})

test('translation job: stale or locked segments cannot be checkpointed as completed', () => {
  const { db, segments } = setup()
  const segmentIds = segments.map((segment) => segment.id as string)
  db.runs.createJob({
    jobId: 'job-stale-locked',
    runId: 'run-stale-locked',
    sessionId: 'session-stale-locked',
    strategy: 'balanced',
    segmentIds,
    provenance: { schemaVersion: 1, runtime: 'pi' },
  })
  db.runs.transitionJob(
    'job-stale-locked',
    { sessionId: 'session-stale-locked' },
    'running',
  )
  db.segments.applyTargetEdit(segments[0]!.id, '人工修订', 0)
  db.segments.setLocked(segments[1]!.id, true)

  try {
    const checkpoint = (completedSegmentIds: string[]) => db.runs.checkpointJob({
      jobId: 'job-stale-locked',
      sessionId: 'session-stale-locked',
      cursor: 1,
      completedSegmentIds,
      failedSegmentIds: [],
      proposalIds: [],
      openItemIds: [],
    })
    assert.throws(() => checkpoint([segmentIds[0]!]), StoreJobStateError)
    assert.throws(() => checkpoint([segmentIds[1]!]), StoreJobStateError)
    assert.equal(
      db.runs.getJob('job-stale-locked', { sessionId: 'session-stale-locked' })?.cursor,
      0,
    )
    const skipped = db.runs.checkpointJob({
      jobId: 'job-stale-locked',
      sessionId: 'session-stale-locked',
      cursor: 2,
      completedSegmentIds: [],
      failedSegmentIds: segmentIds.slice(0, 2),
      proposalIds: [],
      openItemIds: [],
    })
    assert.equal(skipped.cursor, 2)
    assert.deepEqual(skipped.failedSegmentIds, segmentIds.slice(0, 2))
  } finally {
    db.close()
  }
})

test('archived/read-only project: recovery reads work and every harness write fails closed', () => {
  const { store, project, db, segments } = setup()
  db.runs.createJob({
    jobId: 'job-read-only',
    runId: 'run-read-only',
    sessionId: 'session-read-only',
    strategy: 'fast',
    segmentIds: [segments[0]!.id as string],
    provenance: { schemaVersion: 1, runtime: 'pi' },
  })
  db.close()

  const readOnly = store.openProject(project.id, { readOnly: true })
  try {
    assert.equal(
      readOnly.runs.getJob('job-read-only', { sessionId: 'session-read-only' })?.status,
      'pending',
    )
    assert.deepEqual(
      readOnly.runs.listEvents().map((event) => [event.sequence, event.kind, event.job?.status]),
      [[1, 'job-updated', 'pending']],
    )
    assert.throws(
      () => readOnly.runs.transitionJob(
        'job-read-only',
        { sessionId: 'session-read-only' },
        'running',
      ),
      StoreReadOnlyError,
    )
    assert.throws(() => readOnly.runs.ackEvents('renderer-read-only', 0), StoreReadOnlyError)
    assert.throws(
      () => readOnly.runs.executeMutation({
        identity: {
          runId: 'run-read-only',
          toolCallId: 'call-read-only',
          idempotencyKey: 'key-read-only',
        },
        operation: 'cat_propose_translations',
        payload: {},
        mutate: () => {
          assert.fail('read-only guard must run before mutation callback')
        },
      }),
      StoreReadOnlyError,
    )
    assert.throws(
      () => readOnly.runs.undoRun('run-read-only', { actorId: 'human-read-only' }),
      StoreReadOnlyError,
    )
  } finally {
    readOnly.close()
  }
})
