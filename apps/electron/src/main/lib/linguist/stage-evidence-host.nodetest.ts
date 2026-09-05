import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createSeededEntropy } from '@linguist/cat-core'
import { CatStore } from '@linguist/cat-store'
import type { ProjectDiscoveryScope } from './project-discovery-scope'
import { ensureStageEvidenceForSession } from './stage-evidence-host'

test('宿主冻结独立 Stage Plan，恢复本轮状态，并把未映射数据行形成非阻断确认项', () => {
  let tick = 0
  const store = new CatStore({
    rootDir: mkdtempSync(join(tmpdir(), 'stage-evidence-host-')),
    entropy: createSeededEntropy('stage-evidence-host'),
    now: () => new Date(Date.UTC(2026, 7, 28) + tick++ * 1000).toISOString(),
  })
  const project = store.createProject({
    name: 'Anonymous Evidence',
    sourceLocale: 'zh-CN',
    targetLocale: 'en',
    promaWorkspaceId: 'workspace-1',
  })
  const db = store.openProject(project.id)
  try {
    const imported = db.assets.insertImported({
      asset: {
        formatId: 'fixture',
        originalFilename: 'source.xlf',
        sourceSha256: 'a'.repeat(64),
        segmentCount: 1,
      },
      segments: [{
        ordinal: 0,
        key: 'scene-1',
        source: 'pull down',
        target: 'come crashing down',
        sourceLocale: 'zh-CN',
        targetLocale: 'en',
        status: 'translated',
        locked: false,
        revision: 0,
        sourceHash: 'source-1',
      }],
      warnings: [],
      originalBytes: new Uint8Array([1]),
    })
    const context = db.contextDocs.insert({
      kind: 'doc',
      originalFilename: 'visual-brief.xlsx',
      blobRelpath: 'blobs/visual-brief.xlsx',
      sha256: 'b'.repeat(64),
    })
    const image = db.contextDocs.insert({
      kind: 'image',
      originalFilename: 'frame.png',
      blobRelpath: 'blobs/frame.png',
      sha256: 'c'.repeat(64),
      parentContextDocId: context.id,
    })
    db.contextDocs.replaceExtraction(context.id, [{
      id: 'row-2-text',
      locator: { kind: 'sheet', sheet: 'Brief', row: 2, cell: 'B2', rowKind: 'data' },
      text: 'pull down',
    }, {
      id: 'row-2-image',
      locator: { kind: 'image', mediaId: image.id, sheet: 'Brief', row: 2, cell: 'B2' },
      mediaContextDocId: image.id,
    }, {
      id: 'row-3-unmapped',
      locator: { kind: 'sheet', sheet: 'Brief', row: 3, cell: 'B3', rowKind: 'data' },
      text: 'missing CAT segment',
    }])
    db.contextDocs.linkExtractionByExactText(context.id, 'mapping-1')

    const scope: ProjectDiscoveryScope = {
      roots: [],
      files: [],
      unavailable: [],
      managedEvidence: [{
        ref: { kind: 'asset', id: imported.asset.id },
        version: imported.asset.sourceSha256,
      }, {
        ref: { kind: 'context-doc', id: context.id },
        version: context.sha256!,
      }],
      hash: 'scope-1',
    }
    const first = ensureStageEvidenceForSession({
      session: {
        id: 'child-1',
        linguistRole: 'reviewer',
        linguistDelegatedScope: { assetIds: [imported.asset.id], segmentIds: [imported.segments[0]!.id] },
      },
      db,
      discoveryScope: scope,
      fallbackSegmentIds: [],
    })!
    assert.match(first.stageRunId, /^stage:[0-9a-f-]{36}$/)
    assert.equal(first.status, 'ready-with-gaps')
    assert.equal(first.plan.requirements.find((item) => item.evidence.ref.kind === 'context-doc')?.requiredness, 'required')
    assert.deepEqual(db.stageEvidence.getPresentationCoverage(first.stageRunId), {
      required: 2,
      presented: 0,
      pending: [
        { evidence: { kind: 'asset', id: imported.asset.id }, anchorIds: [] },
        { evidence: { kind: 'context-doc', id: context.id }, anchorIds: ['row-2-image', 'row-2-text'] },
      ],
    })
    assert.equal(db.stageEvidence.listOpenGaps(first.stageRunId).some((gap) =>
      gap.code === 'UNMAPPED_CLIENT_VISIBLE_CONTENT'
      && gap.severity === 'warning'
      && gap.summary.includes('第 3 行')
      && gap.suggestedAction.includes('向 PM 确认')), true)

    const resumed = ensureStageEvidenceForSession({
      session: {
        id: 'child-1',
        linguistRole: 'reviewer',
        linguistDelegatedScope: { assetIds: [], segmentIds: [imported.segments[0]!.id] },
      },
      db,
      discoveryScope: scope,
      fallbackSegmentIds: [],
    })!
    assert.equal(resumed.baseline.baselineHash, first.baseline.baselineHash)

    db.segments.applyTargetEdit(imported.segments[0]!.id, 'pulled down', 0)
    assert.notEqual(ensureStageEvidenceForSession({
      session: { id: 'child-1', linguistRole: 'reviewer' },
      db,
      discoveryScope: scope,
      fallbackSegmentIds: [imported.segments[0]!.id],
    })?.status, 'stale')

    assert.equal(ensureStageEvidenceForSession({
      session: { id: 'child-1', linguistRole: 'reviewer' },
      db,
      discoveryScope: { ...scope, hash: 'scope-2' },
      fallbackSegmentIds: [imported.segments[0]!.id],
    })?.stageRunId, first.stageRunId, '无关扫描 hash 不改变必要资料基线')

    const session = { id: 'child-1', linguistRole: 'reviewer' as const }
    const input = { session, db, discoveryScope: scope, fallbackSegmentIds: [imported.segments[0]!.id] }
    db.segments.recordCurrentStageDecision(imported.segments[0]!.id, 'editing', 1, 'unchanged', { actor: session.id })
    assert.equal(db.stageEvidence.getCompletion(first.stageRunId).decisions.pending, 0)
    const restarted = ensureStageEvidenceForSession({ ...input, restart: true, toolCallId: 'restart' })!
    assert.notEqual(restarted.stageRunId, first.stageRunId)
    assert.equal(db.stageEvidence.getCompletion(restarted.stageRunId).decisions.pending, 1, '本轮不得借用同 actor 的旧决定')
    assert.equal(ensureStageEvidenceForSession({ ...input, restart: true, toolCallId: 'restart' })!.stageRunId, restarted.stageRunId)
    db.segments.recordCurrentStageDecision(imported.segments[0]!.id, 'editing', 1, 'unchanged', { actor: 'other-session' })
    assert.equal(db.stageEvidence.getCompletion(restarted.stageRunId).decisions.pending, 1)
    db.segments.recordCurrentStageDecision(imported.segments[0]!.id, 'editing', 1, 'unchanged', { actor: session.id })
    assert.equal(db.stageEvidence.getCompletion(restarted.stageRunId).decisions.pending, 0)
    const untouched = db.stageEvidence.get(first.stageRunId)!.updatedAt
    db.stageEvidence.getCompletion(first.stageRunId)
    assert.equal(db.stageEvidence.get(first.stageRunId)!.updatedAt, untouched)
    assert.equal(db.stageEvidence.list()[0]?.stageRunId, restarted.stageRunId)

    db.contextDocs.setEvidenceLink({ contextDocId: context.id, anchorId: 'row-2-text', relation: { kind: 'segment', segmentId: imported.segments[0]!.id }, requiredness: 'required', mappingRevision: 'mapping-2' })
    const repaired = ensureStageEvidenceForSession(input)!
    assert.notEqual(repaired.stageRunId, restarted.stageRunId)
    assert.equal(db.stageEvidence.get(restarted.stageRunId)!.status, 'stale')
    assert.notEqual(repaired.status, 'stale')
    assert.equal(db.stageEvidence.getCompletion(repaired.stageRunId).decisions.pending, 1)
    const other = ensureStageEvidenceForSession({ ...input, session: { id: 'other-session', linguistRole: 'reviewer' } })!
    assert.notEqual(other.stageRunId, repaired.stageRunId)
    assert.equal(db.stageEvidence.getCompletion(other.stageRunId).decisions.pending, 1)
    const second = db.assets.insertImported({ asset: { formatId: 'fixture', originalFilename: 'second.xlf', sourceSha256: 'd'.repeat(64), segmentCount: 1 },
      segments: [{ ordinal: 0, key: 'second', source: 'second', target: '第二批', sourceLocale: 'zh-CN', targetLocale: 'en', status: 'translated', locked: false, revision: 0, sourceHash: 'second' }], warnings: [], originalBytes: new Uint8Array([2]) })
    const secondScope = { ...scope, managedEvidence: [...scope.managedEvidence, { ref: { kind: 'asset' as const, id: second.asset.id }, version: second.asset.sourceSha256 }] }
    const taskB = ensureStageEvidenceForSession({ ...input, discoveryScope: secondScope, fallbackSegmentIds: [second.segments[0]!.id] })!
    assert.notEqual(taskB.stageRunId, repaired.stageRunId)
    assert.deepEqual(taskB.plan.segmentIds, [second.segments[0]!.id])
    assert.notEqual(db.stageEvidence.get(repaired.stageRunId)!.status, 'stale', '新批次不破坏旧任务历史')
    const taskA = ensureStageEvidenceForSession({ ...input, discoveryScope: secondScope })!
    assert.notEqual(taskA.stageRunId, taskB.stageRunId)
    const optional = db.contextDocs.insert({ kind: 'doc', originalFilename: 'unrelated.txt', blobRelpath: 'blobs/unrelated.txt', textExtract: '无关批次参考' })
    const unrelatedScope = { ...secondScope, hash: 'unrelated', managedEvidence: [...secondScope.managedEvidence, { ref: { kind: 'context-doc' as const, id: optional.id }, version: 'optional' }] }
    assert.equal(ensureStageEvidenceForSession({ ...input, discoveryScope: unrelatedScope })!.stageRunId, taskA.stageRunId)
    const used = ensureStageEvidenceForSession({ ...input, discoveryScope: unrelatedScope, contextDocId: optional.id })!
    assert.notEqual(used.stageRunId, taskA.stageRunId, '本轮明确读取的 optional 资料进入新基线')
    assert.equal(ensureStageEvidenceForSession({ ...input, discoveryScope: unrelatedScope })!.stageRunId, used.stageRunId)
    db.contextDocs.replaceExtraction(optional.id, [{ id: 'new-extraction', locator: { kind: 'paragraph', index: 0 }, text: '已经使用的资料发生实质变化' }])
    assert.equal(db.stageEvidence.getCompletion(used.stageRunId).status, 'stale', '闲置期间的资料变化在交付查询时也须识别')
  } finally {
    db.close()
  }
})
