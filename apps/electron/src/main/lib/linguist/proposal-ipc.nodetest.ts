import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { createLinguistProposalIpc } from './proposal-ipc'
import { INPUT, makeService, makeTempDir, readFixture } from './test/service-testkit'
import type { LinguistProjectMutationEvent } from '@proma/shared'

test('PB-053 Proposal IPC 覆盖人工 UI 的读写与批量审核通道', async () => {
  const service = makeService()
  try {
    const project = service.createProject(INPUT)
    await service.importAsset(project.id, {
      bytes: readFixture('mini_dialogue.csv'),
      filename: 'mini_dialogue.csv',
    })
    const db = service.openProject(project.id)
    const segments = db.segments.query({ limit: 3 })
    const proposals = db.proposals.insertPendingMany(
      segments.map((segment, index) => ({
        segmentId: segment.id,
        baseRevision: segment.revision,
        proposedTarget: ['人工建议译文', '建议译文乙', '建议译文丙\n续行'][index]!,
      })),
    )
    const mutations: LinguistProjectMutationEvent[] = []
    const ipc = createLinguistProposalIpc({
      getService: () => service,
      onProjectMutation: (event) => mutations.push(event),
    })

    const listed = await ipc.listPending({ projectId: project.id })
    assert.equal(listed.ok, true)
    if (listed.ok) assert.equal(listed.data.length, 3)

    const diff = await ipc.getDiff({ projectId: project.id, proposalId: proposals[0]!.id })
    assert.equal(diff.ok, true)
    if (diff.ok) {
      assert.equal(diff.data.currentRevision, segments[0]!.revision)
      assert.equal(diff.data.proposedTarget, '人工建议译文')
      assert.equal(diff.data.originalOrdinal, segments[0]!.ordinal + 1)
    }

    const accepted = await ipc.accept({
      projectId: project.id,
      proposalId: proposals[0]!.id,
      expectedRevision: 0,
      idempotencyKey: 'accept-1',
    })
    assert.equal(accepted.ok, true)
    if (accepted.ok) assert.equal(accepted.data.revision, 1)
    assert.equal(mutations.length, 1)
    assert.equal(mutations[0]!.kind, 'proposal-reviewed')
    assert.deepEqual(mutations[0]!.proposalIds, [proposals[0]!.id])
    assert.deepEqual(
      await ipc.accept({
        projectId: project.id,
        proposalId: proposals[0]!.id,
        expectedRevision: 0,
        idempotencyKey: 'accept-1',
      }),
      accepted,
    )
    assert.equal(mutations.length, 1, '幂等重放不得伪造第二次 mutation')

    const rejected = await ipc.reject({
      projectId: project.id,
      proposalId: proposals[1]!.id,
      expectedRevision: 0,
      idempotencyKey: 'reject-1',
    })
    assert.equal(rejected.ok, true)
    if (rejected.ok) assert.equal(rejected.data.status, 'rejected')
    assert.equal(mutations.length, 2)

    const editedTarget = '人工编辑后的建议译文\n很高兴认识你。'
    const edited = await ipc.editAndAccept({
      projectId: project.id,
      proposalId: proposals[2]!.id,
      expectedRevision: 0,
      editedTarget,
      idempotencyKey: 'edit-1',
    })
    assert.equal(edited.ok, true)
    if (edited.ok) assert.equal(edited.data.target, editedTarget)
    assert.equal(mutations.length, 3)

    const more = db.proposals.insertPendingMany(
      segments.slice(0, 2).map((segment, index) => ({
        segmentId: segment.id,
        baseRevision: index === 0 ? 1 : 0,
        proposedTarget: index === 0 ? '后续译文甲' : '后续译文乙',
      })),
    )
    const acceptedSelected = await ipc.acceptSelected({
      projectId: project.id,
      items: [{ proposalId: more[0]!.id, expectedRevision: 1 }],
      idempotencyKey: 'accept-selected-1',
    })
    assert.equal(acceptedSelected.ok, true)
    assert.equal(mutations.length, 4)

    const rejectedSelected = await ipc.rejectSelected({
      projectId: project.id,
      items: [{ proposalId: more[1]!.id, expectedRevision: 0 }],
      idempotencyKey: 'reject-selected-1',
    })
    assert.equal(rejectedSelected.ok, true)
    assert.equal(mutations.length, 5)
    for (let index = 1; index < mutations.length; index++) {
      assert.equal(mutations[index]!.revision, mutations[index - 1]!.revision + 1)
    }
    assert.ok(mutations.every((event) =>
      event.kind === 'proposal-reviewed'
      && (event.proposalIds?.length ?? 0) > 0
      && (event.segmentIds?.length ?? 0) > 0))

    const invalid = await ipc.accept({
      projectId: project.id,
      proposalId: 'not-a-proposal',
      expectedRevision: -1,
      idempotencyKey: '',
    })
    assert.equal(invalid.ok, false)
    if (!invalid.ok) assert.equal(invalid.error.code, 'INVALID_INPUT')

    const legacy = await ipc.getDiff({
      projectId: project.id,
      proposalId: 'prp-0000000000000000',
    })
    assert.equal(legacy.ok, false)
    if (!legacy.ok) assert.equal(legacy.error.code, 'STORE_NOT_FOUND')
    assert.equal(mutations.length, 5, '失败 mutation 不得广播成功事件')
  } finally {
    service.closeAll()
  }
})

test('项目级提案历史与终态重发：状态筛选、provenance、lineage 和幂等事件完整', async () => {
  const service = makeService()
  try {
    const project = service.createProject(INPUT)
    await service.importAsset(project.id, {
      bytes: readFixture('mini_dialogue.csv'),
      filename: 'mini_dialogue.csv',
    })
    const db = service.openProject(project.id)
    const segment = db.segments.query({ limit: 1 })[0]!
    const original = db.proposals.insertPending({
      segmentId: segment.id,
      baseRevision: 0,
      proposedTarget: '重新确认的译文',
      modelId: 'candidate-model',
      sessionId: 'candidate-session',
      runId: 'candidate-run',
      now: '2026-07-29T00:00:00.000Z',
    })
    db.proposals.reject(original.id)
    const mutations: LinguistProjectMutationEvent[] = []
    const ipc = createLinguistProposalIpc({
      getService: () => service,
      onProjectMutation: (event) => mutations.push(event),
    })

    const rejected = await ipc.list({
      projectId: project.id,
      status: 'rejected',
      limit: 20,
      offset: 0,
    })
    assert.equal(rejected.ok, true)
    if (rejected.ok) {
      assert.equal(rejected.data.total, 1)
      assert.equal(rejected.data.items[0]?.proposal.runId, 'candidate-run')
      assert.equal(rejected.data.items[0]?.issuanceCount, 1)
      assert.equal(rejected.data.items[0]?.latestIssuance?.runId, 'candidate-run')
      assert.match(rejected.data.items[0]?.latestIssuance?.id ?? '', /^pis_v2_/)
      assert.equal(rejected.data.items[0]?.source, segment.source)
      assert.equal(rejected.data.items[0]?.currentRevision, segment.revision)
    }

    const input = {
      projectId: project.id,
      proposalId: original.id,
      expectedRevision: 0,
      idempotencyKey: 'ipc-reissue-1',
    }
    const first = await ipc.reissue(input)
    const replay = await ipc.reissue(input)
    assert.deepEqual(replay, first)
    assert.equal(first.ok, true)
    if (first.ok) {
      assert.notEqual(first.data.id, original.id)
      assert.equal(first.data.reissuedFromProposalId, original.id)
      assert.equal(first.data.status, 'pending')
      assert.equal(first.data.runId, 'human-reconcile:ipc-reissue-1')
    }
    assert.equal(db.proposals.getById(original.id)?.status, 'rejected')
    assert.equal(mutations.length, 1)
    assert.equal(mutations[0]?.kind, 'proposal-created')

    const all = await ipc.list({ projectId: project.id, limit: 20, offset: 0 })
    assert.equal(all.ok, true)
    if (all.ok) {
      assert.equal(all.data.total, 2)
      assert.deepEqual(
        new Set(all.data.items.map((item) => item.proposal.status)),
        new Set(['pending', 'rejected']),
      )
    }
  } finally {
    service.closeAll()
  }
})

test('PB-110 archived 项目：六个写通道 STORE_READ_ONLY 拒绝且无写入，三个读通道可用', async () => {
  const service = makeService()
  try {
    const project = service.createProject(INPUT)
    await service.importAsset(project.id, {
      bytes: readFixture('mini_dialogue.csv'),
      filename: 'mini_dialogue.csv',
    })
    const db = service.openProject(project.id)
    const segments = db.segments.query({ limit: 2 })
    const proposals = db.proposals.insertPendingMany(
      segments.map((segment, index) => ({
        segmentId: segment.id,
        baseRevision: segment.revision,
        proposedTarget: index === 0 ? '归档前建议甲' : '归档前建议乙',
      })),
    )
    const ipc = createLinguistProposalIpc({ getService: () => service })

    // archiveProject 会关闭服务缓存句柄；归档后重新打开（强制只读）做读断言
    service.archiveProject(project.id)
    const dbRo = service.openProject(project.id)
    assert.equal(dbRo.readOnly, true)
    const pendingBefore = dbRo.proposals.listPending().length

    const writeInputs = {
      projectId: project.id,
      proposalId: proposals[0]!.id,
      expectedRevision: 0,
      idempotencyKey: 'archived-write-1',
    }
    for (const attempt of [
      () => ipc.accept(writeInputs),
      () => ipc.reject(writeInputs),
      () => ipc.editAndAccept({ ...writeInputs, editedTarget: '归档后编辑' }),
      () => ipc.acceptSelected({
        projectId: project.id,
        items: [{ proposalId: proposals[0]!.id, expectedRevision: 0 }],
        idempotencyKey: 'archived-accept-selected-1',
      }),
      () => ipc.rejectSelected({
        projectId: project.id,
        items: [{ proposalId: proposals[1]!.id, expectedRevision: 0 }],
        idempotencyKey: 'archived-reject-selected-1',
      }),
      () => ipc.reissue({
        ...writeInputs,
        idempotencyKey: 'archived-reissue-1',
      }),
    ]) {
      const result = await attempt()
      assert.equal(result.ok, false)
      if (!result.ok) assert.equal(result.error.code, 'STORE_READ_ONLY')
    }

    // 六个写通道均未产生任何写入：pending 计数与段 revision 不变
    assert.equal(dbRo.proposals.listPending().length, pendingBefore)
    assert.equal(dbRo.segments.getById(segments[0]!.id)?.revision, 0)

    // 读通道在归档下仍可用（对齐 export-ipc 的归档腿模式）
    const listed = await ipc.listPending({ projectId: project.id })
    assert.equal(listed.ok, true)
    if (listed.ok) assert.equal(listed.data.length, pendingBefore)
    const history = await ipc.list({ projectId: project.id, limit: 20, offset: 0 })
    assert.equal(history.ok, true)
    if (history.ok) assert.equal(history.data.total, pendingBefore)
    const diff = await ipc.getDiff({ projectId: project.id, proposalId: proposals[0]!.id })
    assert.equal(diff.ok, true)
    if (diff.ok) assert.equal(diff.data.proposedTarget, '归档前建议甲')
  } finally {
    service.closeAll()
  }
})

test('PB-097 editAndAccept 从 projects.json 解析 tagProfile，项目族违规拦截人工编辑', async () => {
  const rootDir = makeTempDir()
  const service = makeService(rootDir)
  try {
    const project = service.createProject(INPUT)
    // 项目族手工登记（无 API 写路径，既定设计）：直接写 projects.json 索引项
    const indexPath = join(rootDir, 'projects.json')
    const index = JSON.parse(readFileSync(indexPath, 'utf8')) as {
      projects: Array<Record<string, unknown>>
    }
    index.projects[0]!.tagProfile = {
      families: [{ id: 'grm-qty', pattern: '\\[Grm:Qty[^\\]]*\\]', class: 'singleton' }],
    }
    writeFileSync(indexPath, JSON.stringify(index))
    const db = service.openProject(project.id)
    db.assets.insertImported({
      asset: {
        formatId: 'fake_tsv',
        originalFilename: 'tags.tsv',
        sourceSha256: 'e'.repeat(64),
        segmentCount: 1,
      },
      segments: [{
        ordinal: 0,
        key: 'grm',
        source: '获得 [Grm:Qty S=""] 个',
        target: '',
        sourceLocale: 'en',
        targetLocale: 'zh-CN',
        status: 'untranslated',
        locked: false,
        revision: 0,
        sourceHash: 'grm-hash',
      }],
      warnings: [],
      originalBytes: new TextEncoder().encode('fake'),
    })
    const segment = db.segments.query({ limit: 1 })[0]!
    const proposal = db.proposals.insertPending({
      segmentId: segment.id,
      baseRevision: 0,
      proposedTarget: '获得 [Grm:Qty S=""] 个',
    })
    const ipc = createLinguistProposalIpc({ getService: () => service })
    // 编辑后丢项目族 tag：IPC 从 project.json 解析 tagProfile 传进硬门，拦截
    const blocked = await ipc.editAndAccept({
      projectId: project.id,
      proposalId: proposal.id,
      expectedRevision: 0,
      editedTarget: '获得 个',
      idempotencyKey: 'edit-tag-1',
    })
    assert.equal(blocked.ok, false)
    if (!blocked.ok) assert.equal(blocked.error.code, 'INVALID_STATE_TRANSITION')
    assert.equal(db.segments.getById(segment.id)?.target, '')
  } finally {
    service.closeAll()
  }
})
