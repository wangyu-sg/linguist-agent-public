import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createStageEvidenceBaseline, type StageEvidencePlan } from '@linguist/cat-core'
import { CatStore } from './store'
import { makeClock, makeEntropy, makeImportedAsset, makeTempDir } from './testkit'

function setup() {
  const store = new CatStore({ rootDir: makeTempDir(), entropy: makeEntropy(), now: makeClock() })
  const project = store.createProject({
    name: 'Evidence',
    sourceLocale: 'en',
    targetLocale: 'zh-CN',
    promaWorkspaceId: 'workspace-1',
  })
  const db = store.openProject(project.id)
  const imported = db.assets.insertImported(makeImportedAsset({ segmentCount: 2 }))
  return { db, imported }
}

test('Stage Evidence state freezes evidence facts and scope without becoming stale after a normal Target edit', () => {
  const { db, imported } = setup()
  try {
    const stageRunId = 'stage-run-1'
    const plan: StageEvidencePlan = {
      stageRunId,
      role: 'reviewer',
      stage: 'editing',
      assetIds: [imported.asset.id],
      segmentIds: imported.segments.map((segment) => segment.id),
      requirements: [{
        evidence: {
          ref: { kind: 'asset', id: imported.asset.id },
          version: imported.asset.sourceSha256,
        },
        purpose: 'source-authority',
        requiredness: 'required',
        scope: { kind: 'assets', assetIds: [imported.asset.id] },
        anchorIds: [],
        rationale: '主批次是 Source authority',
      }],
    }
    const baseline = createStageEvidenceBaseline({
      stageRunId,
      discoveryScopeHash: 'scope-v1',
      mappingRevision: 'mapping-v1',
      ruleSetRevision: 'rules-v1',
      segmentIds: plan.segmentIds,
      evidence: plan.requirements.map((item) => item.evidence),
    })
    db.stageEvidence.create({
      stageRunId,
      sessionId: 'session-1',
      plan,
      baseline,
    })

    db.segments.applyTargetEdit(imported.segments[0]!.id, 'Edited target', 0)
    db.segments.applyTargetEdit(imported.segments[1]!.id, 'Second target', 0)

    const persisted = db.stageEvidence.get(stageRunId)
    assert.equal(persisted?.status, 'ready')
    assert.deepEqual(persisted?.baseline, baseline)
    assert.deepEqual(persisted?.plan.segmentIds, plan.segmentIds)

    const receipt = db.stageEvidence.recordReceipt({
      stageRunId,
      baselineHash: baseline.baselineHash,
      sessionId: 'child-session-1',
      generationRunId: 'generation-1',
      toolCallId: 'tool-1',
      segmentIds: [imported.segments[0]!.id],
      evidence: [{ ref: plan.requirements[0]!.evidence.ref, anchorIds: [] }],
    })
    assert.equal(receipt.sessionId, 'child-session-1')
    assert.deepEqual(db.stageEvidence.getPresentationCoverage(stageRunId), {
      required: 1,
      presented: 1,
      pending: [],
    })
    assert.equal(
      db.stageEvidence.recordReceipt({
        stageRunId,
        baselineHash: baseline.baselineHash,
        sessionId: 'child-session-1',
        generationRunId: 'generation-1',
        toolCallId: 'tool-1',
        segmentIds: [imported.segments[0]!.id],
        evidence: [{ ref: plan.requirements[0]!.evidence.ref, anchorIds: [] }],
      }).id,
      receipt.id,
    )
    assert.equal(db.stageEvidence.listReceipts(stageRunId).length, 1)

    db.segments.recordCurrentStageDecision(imported.segments[0]!.id, 'editing', 1, 'unchanged')
    db.segments.recordCurrentStageDecision(imported.segments[1]!.id, 'editing', 1, 'unchanged')
    db.stageEvidence.replaceStageGaps(stageRunId, [{
      id: 'gap-required',
      code: 'REQUIRED_RESOURCE_MISSING',
      severity: 'blocking',
      summary: '用户已声明的必需资料缺失',
      suggestedAction: '补充资料或由用户显式豁免',
    }])
    assert.equal(db.stageEvidence.refreshCompletion(
      stageRunId,
      db.segments.getStageDecisionCoverage('editing', plan.segmentIds),
    ).status, 'blocked')

    db.stageEvidence.replaceStageGaps(stageRunId, [{
      id: 'gap-pm-confirm',
      code: 'UNMAPPED_CLIENT_VISIBLE_CONTENT',
      severity: 'warning',
      summary: '伴生表有一行未映射',
      suggestedAction: '向 PM 确认，不自行修改 CAT 主文件',
    }])
    const completed = db.stageEvidence.refreshCompletion(
      stageRunId,
      db.segments.getStageDecisionCoverage('editing', plan.segmentIds),
    )
    assert.equal(completed.status, 'complete')
    assert.equal(completed.warnings.length, 1)
    assert.equal(db.stageEvidence.get(stageRunId)?.status, 'complete')

    assert.equal(db.stageEvidence.markStale(stageRunId, '参考资料已变化').status, 'stale')
  } finally {
    db.close()
  }
})

test('Project Evidence inventory gaps persist, resolve when absent, and reopen when rediscovered', () => {
  const { db } = setup()
  try {
    const gap = {
      id: 'gap-unmapped-brief',
      code: 'UNMAPPED_CLIENT_VISIBLE_CONTENT' as const,
      severity: 'warning' as const,
      summary: 'brief.bin 尚未识别',
      suggestedAction: '确认文件用途或显式排除',
    }

    assert.equal(db.stageEvidence.replaceProjectInventoryGaps([gap])[0]?.status, 'open')
    assert.equal(db.stageEvidence.replaceProjectInventoryGaps([])[0]?.status, 'resolved')
    assert.equal(db.stageEvidence.replaceProjectInventoryGaps([gap])[0]?.status, 'open')
  } finally {
    db.close()
  }
})
