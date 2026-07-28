import { readFileSync } from 'node:fs'
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createLinguistCatWorkspaceIpc } from './cat-workspace-ipc'
import { INPUT, fixturePath, makeService } from './test/service-testkit'

test('PB-060 CAT query: assets + paged/filter/search/count share one snapshot', async () => {
  const service = makeService()
  try {
    const project = service.createProject(INPUT)
    const file = fixturePath('mini_items.json')
    await service.importAsset(project.id, {
      bytes: readFileSync(file),
      filename: 'mini_items.json',
    })
    const ipc = createLinguistCatWorkspaceIpc({ getService: () => service })

    const firstPage = await ipc.query({
      projectId: project.id,
      status: 'untranslated',
      includeIndex: true,
      limit: 3,
      offset: 0,
    })
    assert.equal(firstPage.ok, true)
    if (!firstPage.ok) return
    assert.equal(firstPage.data.assets.length, 1)
    assert.equal(firstPage.data.total, 8)
    assert.equal(firstPage.data.segmentIds.length, 8)
    assert.deepEqual(
      firstPage.data.segmentIds.slice(0, 3),
      firstPage.data.segments.map((segment) => segment.id),
    )
    assert.equal(firstPage.data.segments.length, 3)
    assert.equal(firstPage.data.segments[0]?.source, 'Health Potion')
    assert.equal(firstPage.data.hasMore, true)

    const searched = await ipc.query({
      projectId: project.id,
      search: 'Health',
      limit: 50,
      offset: 0,
    })
    assert.equal(searched.ok, true)
    if (searched.ok) {
      assert.equal(searched.data.total, 1)
      assert.deepEqual(searched.data.segments.map((segment) => segment.source), ['Health Potion'])
      assert.equal(searched.data.hasMore, false)
    }
  } finally {
    service.closeAll()
  }
})

test('CAT query: currentStageState 过滤本轮任务进度，拒绝未知阶段状态', async () => {
  const service = makeService()
  try {
    const project = service.createProject({ ...INPUT, workflowStage: 'editing' })
    await service.importAsset(project.id, {
      bytes: readFileSync(fixturePath('mini_items.json')),
      filename: 'mini_items.json',
    })
    const db = service.openProject(project.id)
    const segment = db.segments.query({ limit: 1 })[0]!
    db.segments.applyTargetEdit(segment.id, '已编辑', segment.revision)
    const ipc = createLinguistCatWorkspaceIpc({ getService: () => service })

    const draft = await ipc.query({
      projectId: project.id,
      currentStageState: 'draft',
      includeIndex: true,
    })
    assert.equal(draft.ok, true)
    if (draft.ok) {
      assert.equal(draft.data.total, 1)
      assert.deepEqual(draft.data.segmentIds, [segment.id])
    }

    const invalid = await ipc.query({
      projectId: project.id,
      currentStageState: 'reviewed',
    })
    assert.equal(invalid.ok, false)
    if (!invalid.ok) assert.equal(invalid.error.code, 'INVALID_INPUT')
  } finally {
    service.closeAll()
  }
})

test('PB-060 CAT query validates filters and pagination at the main-process boundary', async () => {
  const service = makeService()
  try {
    const project = service.createProject(INPUT)
    const ipc = createLinguistCatWorkspaceIpc({ getService: () => service })
    for (const input of [
      { projectId: project.id, status: 'done' },
      { projectId: project.id, limit: 0 },
      { projectId: project.id, limit: 201 },
      { projectId: project.id, offset: -1 },
      { projectId: project.id, search: 'x'.repeat(501) },
      { projectId: project.id, assetId: 'not-an-asset' },
      { projectId: project.id, includeIndex: 'yes' },
    ]) {
      const result = await ipc.query(input)
      assert.equal(result.ok, false)
      if (!result.ok) assert.equal(result.error.code, 'INVALID_INPUT')
    }
  } finally {
    service.closeAll()
  }
})

test('PB-062 CAT edit: multiline CAS succeeds; stale and locked edits never overwrite', async () => {
  const service = makeService()
  try {
    const project = service.createProject(INPUT)
    const file = fixturePath('mini_items.json')
    await service.importAsset(project.id, {
      bytes: readFileSync(file),
      filename: 'mini_items.json',
    })
    const ipc = createLinguistCatWorkspaceIpc({ getService: () => service })
    const db = service.openProject(project.id)
    const first = db.segments.query({ limit: 3 })
    const editable = first[0]!
    const stale = first[1]!
    const locked = first[2]!

    for (const input of [
      { projectId: project.id, segmentId: 'bad', target: 'x', expectedRevision: 0 },
      { projectId: project.id, segmentId: editable.id, target: 7, expectedRevision: 0 },
      { projectId: project.id, segmentId: editable.id, target: 'x', expectedRevision: -1 },
      { projectId: project.id, segmentId: editable.id, target: 'x', expectedRevision: 0.5 },
    ]) {
      const invalid = await ipc.edit(input)
      assert.equal(invalid.ok, false)
      if (!invalid.ok) assert.equal(invalid.error.code, 'INVALID_INPUT')
    }

    const edited = await ipc.edit({
      projectId: project.id,
      segmentId: editable.id,
      target: '生命\n药水',
      expectedRevision: 0,
    })
    assert.equal(edited.ok, true)
    if (edited.ok) {
      assert.equal(edited.data.target, '生命\n药水')
      assert.equal(edited.data.revision, 1)
    }

    db.segments.applyTargetEdit(stale.id, '并发写入', 0)
    const conflicted = await ipc.edit({
      projectId: project.id,
      segmentId: stale.id,
      target: '不得覆盖',
      expectedRevision: 0,
    })
    assert.equal(conflicted.ok, false)
    if (!conflicted.ok) assert.equal(conflicted.error.code, 'REVISION_CONFLICT')
    assert.equal(db.segments.getById(stale.id)?.target, '并发写入')

    db.segments.setLocked(locked.id, true)
    const rejected = await ipc.edit({
      projectId: project.id,
      segmentId: locked.id,
      target: '不得写入',
      expectedRevision: 0,
    })
    assert.equal(rejected.ok, false)
    if (!rejected.ok) assert.equal(rejected.error.code, 'SEGMENT_LOCKED')
    assert.equal(db.segments.getById(locked.id)?.target, '')
  } finally {
    service.closeAll()
  }
})

test('PB-063 Context Rail reads one Segment and its pending Proposal by opaque id', async () => {
  const service = makeService()
  try {
    const project = service.createProject(INPUT)
    const file = fixturePath('mini_items.json')
    await service.importAsset(project.id, {
      bytes: readFileSync(file),
      filename: 'mini_items.json',
    })
    const db = service.openProject(project.id)
    const segment = db.segments.query({ limit: 1 })[0]!
    const proposal = db.proposals.insertPending({
      segmentId: segment.id,
      baseRevision: segment.revision,
      proposedTarget: '生命药水',
      evidenceRefs: ['tm:health-potion'],
      termRefs: ['term:potion'],
      warnings: ['需复核术语'],
    })
    const ipc = createLinguistCatWorkspaceIpc({ getService: () => service })

    const context = await ipc.getContext({
      projectId: project.id,
      segmentId: segment.id,
    })
    assert.equal(context.ok, true)
    if (context.ok) {
      assert.equal(context.data.segment.id, segment.id)
      assert.equal(context.data.segment.source, 'Health Potion')
      assert.equal(context.data.pendingProposal?.id, proposal.id)
      assert.deepEqual(context.data.pendingProposal?.evidenceRefs, ['tm:health-potion'])
    }

    const invalid = await ipc.getContext({
      projectId: project.id,
      segmentId: 'bad',
    })
    assert.equal(invalid.ok, false)
    if (!invalid.ok) assert.equal(invalid.error.code, 'INVALID_INPUT')
  } finally {
    service.closeAll()
  }
})

test('CAT stage workflow: E 阶段单句确认/撤销可追溯，批量确认逐条报告失败', async () => {
  const service = makeService()
  try {
    const project = service.createProject({ ...INPUT, workflowStage: 'editing' })
    await service.importAsset(project.id, {
      bytes: readFileSync(fixturePath('mini_items.json')),
      filename: 'mini_items.json',
    })
    const db = service.openProject(project.id)
    const [editable, locked, empty] = db.segments.query({ limit: 3 })
    assert.ok(editable)
    assert.ok(locked)
    assert.ok(empty)
    db.segments.applyTargetEdit(editable.id, '生命药水', editable.revision)
    db.segments.applyTargetEdit(locked.id, '魔法药水', locked.revision)
    db.segments.setLocked(locked.id, true)
    const ipc = createLinguistCatWorkspaceIpc({ getService: () => service })

    const confirmed = await ipc.confirmStage({
      projectId: project.id,
      segmentId: editable.id,
      expectedRevision: 1,
    })
    assert.equal(confirmed.ok, true)
    if (confirmed.ok) {
      assert.equal(confirmed.data.currentStageState, 'confirmed')
      assert.equal(confirmed.data.revision, 1)
    }

    const repeated = await ipc.confirmStage({
      projectId: project.id,
      segmentId: editable.id,
      expectedRevision: 1,
    })
    assert.equal(repeated.ok, false)
    if (!repeated.ok) assert.equal(repeated.error.code, 'INVALID_STATE_TRANSITION')

    const reopened = await ipc.unconfirmStage({
      projectId: project.id,
      segmentId: editable.id,
      expectedRevision: 1,
    })
    assert.equal(reopened.ok, true)
    if (reopened.ok) assert.equal(reopened.data.currentStageState, 'draft')

    const batch = await ipc.confirmStageBulk({
      projectId: project.id,
      items: [
        { segmentId: editable.id, expectedRevision: 1 },
        { segmentId: locked.id, expectedRevision: 1 },
        { segmentId: empty.id, expectedRevision: 0 },
      ],
    })
    assert.equal(batch.ok, true)
    if (!batch.ok) return
    assert.deepEqual(batch.data.succeeded.map((segment) => segment.id), [editable.id])
    assert.deepEqual(
      batch.data.failed.map((failure) => [failure.segmentId, failure.code]),
      [
        [locked.id, 'SEGMENT_LOCKED'],
        [empty.id, 'INVALID_STATE_TRANSITION'],
      ],
    )

    const context = await ipc.getContext({
      projectId: project.id,
      segmentId: editable.id,
    })
    assert.equal(context.ok, true)
    if (context.ok) {
      assert.deepEqual(
        context.data.stageEvents?.map((event) => [event.stage, event.action]),
        [
          ['editing', 'confirmed'],
          ['editing', 'unconfirmed'],
          ['editing', 'confirmed'],
        ],
      )
    }

    for (const input of [
      { projectId: project.id, segmentId: 'bad', expectedRevision: 0 },
      { projectId: project.id, segmentId: editable.id, expectedRevision: -1 },
      { projectId: project.id, items: [] },
      { projectId: project.id, items: [{ segmentId: editable.id, expectedRevision: '1' }] },
    ]) {
      const result = 'items' in input
        ? await ipc.confirmStageBulk(input)
        : await ipc.confirmStage(input)
      assert.equal(result.ok, false)
      if (!result.ok) assert.equal(result.error.code, 'INVALID_INPUT')
    }
  } finally {
    service.closeAll()
  }
})

test('PB-071 QA: run/list are available to the Agent boundary, but resolve/waive remain human IPC actions', async () => {
  const service = makeService()
  try {
    const project = service.createProject(INPUT)
    await service.importAsset(project.id, {
      bytes: readFileSync(fixturePath('mini_items.json')),
      filename: 'mini_items.json',
    })
    const ipc = createLinguistCatWorkspaceIpc({ getService: () => service })

    const run = await ipc.runQa({ projectId: project.id })
    assert.equal(run.ok, true)
    if (!run.ok) return
    assert.equal(run.data.total, 7)
    // PB-096：7 条 EMPTY_TARGET 全部 L1 defect
    assert.deepEqual(run.data.severityCounts, { L0: 0, L1: 7, L2: 0, L3: 0, L4: 0 })
    assert.deepEqual(run.data.dispositionCounts, { defect: 7, needs_review: 0, query: 0, info: 0 })

    const findings = await ipc.listQaFindings({ projectId: project.id, status: 'open', limit: 2, offset: 0 })
    assert.equal(findings.ok, true)
    if (!findings.ok) return
    assert.equal(findings.data.total, 7)
    assert.equal(findings.data.items.length, 2)
    const first = findings.data.items[0]!

    const beforeEdit = await ipc.resolveQaFinding({ projectId: project.id, findingId: first.id })
    assert.equal(beforeEdit.ok, false)
    if (!beforeEdit.ok) assert.equal(beforeEdit.error.code, 'INVALID_STATE_TRANSITION')

    const edited = await ipc.edit({
      projectId: project.id,
      segmentId: first.segmentId,
      target: '健康药水',
      expectedRevision: first.currentRevision,
    })
    assert.equal(edited.ok, true)

    const resolved = await ipc.resolveQaFinding({ projectId: project.id, findingId: first.id })
    assert.equal(resolved.ok, true)
    if (resolved.ok) assert.equal(resolved.data.status, 'resolved')

    const waived = await ipc.waiveQaFinding({
      projectId: project.id,
      findingId: findings.data.items[1]!.id,
      reason: '本项目允许保留原文',
      operator: '测试审校员',
    })
    assert.equal(waived.ok, true)
    if (waived.ok) {
      assert.equal(waived.data.waiverReason, '本项目允许保留原文')
      assert.equal(waived.data.waivedBy, '测试审校员')
      assert.ok(waived.data.waivedAt)
    }

    const remaining = await ipc.listQaFindings({
      projectId: project.id,
      status: 'open',
      limit: 20,
      offset: 0,
    })
    assert.equal(remaining.ok, true)
    if (!remaining.ok) return
    const bulkIds = remaining.data.items.slice(0, 2).map((finding) => finding.id)
    const bulk = await ipc.waiveQaFindingsBulk({
      projectId: project.id,
      findingIds: bulkIds,
      reason: '同规则批量确认',
      operator: '测试审校员',
    })
    assert.equal(bulk.ok, true)
    if (bulk.ok) {
      assert.equal(bulk.data.length, bulkIds.length)
      assert.ok(bulk.data.every((finding) =>
        finding.status === 'waived'
        && finding.waiverReason === '同规则批量确认'
        && finding.waivedBy === '测试审校员'))
    }
  } finally {
    service.closeAll()
  }
})
