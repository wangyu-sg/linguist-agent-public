import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createSeededEntropy, createStageEvidenceBaseline, type ProjectId, type StageEvidencePlan } from '@linguist/cat-core'
import { CatStore } from '@linguist/cat-store'
import { summarizeDeliveryEvidence } from './project-delivery'
import { readLinguistExportManifests, recordLinguistExportManifest } from './export-manifest'

test('交付证据汇总只阻断显式 blocking Gap，未映射 warning 仅随清单提醒', () => {
  const store = new CatStore({
    rootDir: mkdtempSync(join(tmpdir(), 'delivery-evidence-')),
    entropy: createSeededEntropy('delivery-evidence'),
  })
  const project = store.createProject({
    name: 'Delivery Evidence',
    sourceLocale: 'zh-CN',
    targetLocale: 'en',
    promaWorkspaceId: 'workspace-1',
  })
  const db = store.openProject(project.id)
  try {
    const imported = db.assets.insertImported({
      asset: {
        formatId: 'fixture',
        originalFilename: 'batch.xlf',
        sourceSha256: 'a'.repeat(64),
        segmentCount: 1,
      },
      segments: [{
        ordinal: 0,
        key: 'one',
        source: '一',
        target: 'One',
        sourceLocale: 'zh-CN',
        targetLocale: 'en',
        status: 'translated',
        locked: false,
        revision: 0,
        sourceHash: 'one',
      }],
      warnings: [],
      originalBytes: new Uint8Array([1]),
    })
    const segmentId = imported.segments[0]!.id
    const stageRunId = 'stage-delivery'
    const requirement = {
      evidence: { ref: { kind: 'asset' as const, id: imported.asset.id }, version: imported.asset.sourceSha256 },
      purpose: 'source-authority' as const,
      requiredness: 'required' as const,
      scope: { kind: 'assets' as const, assetIds: [imported.asset.id] },
      anchorIds: [],
      rationale: '主批次 Source',
    }
    const plan: StageEvidencePlan = {
      stageRunId,
      role: 'reviewer',
      stage: 'editing',
      assetIds: [imported.asset.id],
      segmentIds: [segmentId],
      requirements: [requirement],
    }
    const baseline = createStageEvidenceBaseline({
      stageRunId,
      discoveryScopeHash: 'scope',
      mappingRevision: 'mapping',
      ruleSetRevision: 'rules',
      segmentIds: plan.segmentIds,
      evidence: [requirement.evidence],
    })
    db.stageEvidence.create({ stageRunId, sessionId: 'reviewer', plan, baseline })
    db.segments.recordCurrentStageDecision(segmentId, 'editing', 0, 'unchanged')
    db.stageEvidence.recordReceipt({
      stageRunId,
      baselineHash: baseline.baselineHash,
      sessionId: 'reviewer',
      generationRunId: 'generation',
      segmentIds: [segmentId],
      evidence: [{ ref: requirement.evidence.ref, anchorIds: [] }],
    })
    db.stageEvidence.replaceStageGaps(stageRunId, [{
      id: 'gap-pm-confirm',
      code: 'UNMAPPED_CLIENT_VISIBLE_CONTENT',
      severity: 'warning',
      summary: '伴生表有未映射行',
      suggestedAction: '向 PM 确认，不自行改 CAT 文件',
    }])

    const warningOnly = summarizeDeliveryEvidence(db, imported.asset.id, 'editing')
    assert.equal(warningOnly.status, 'complete')
    assert.deepEqual(warningOnly.gaps.map((gap) => gap.severity), ['warning'])

    db.stageEvidence.replaceStageGaps(stageRunId, [{
      id: 'gap-required',
      code: 'REQUIRED_RESOURCE_MISSING',
      severity: 'blocking',
      summary: '用户声明的必需资料缺失',
      suggestedAction: '补充或显式豁免',
    }])
    assert.equal(summarizeDeliveryEvidence(db, imported.asset.id, 'editing').status, 'blocked')
  } finally {
    db.close()
  }
})

test('Export Manifest 区分 verified/as-is 并持久化非阻断证据提醒', () => {
  const root = mkdtempSync(join(tmpdir(), 'delivery-manifest-'))
  const stagingPath = join(root, 'staged.xlf')
  writeFileSync(stagingPath, 'result')
  const artifactId = `exp_v2_${'b'.repeat(64)}`
  const assetId = `ast_v2_${'a'.repeat(64)}`
  recordLinguistExportManifest({
    exportsDir: root,
    stagingPath,
    artifact: {
      id: artifactId,
      projectId: `prj_v2_${'c'.repeat(64)}` as ProjectId,
      assetId,
      path: 'exports/staged.xlf',
      sha256: 'd'.repeat(64),
      segmentCount: 1,
      createdAt: '2026-08-28T00:00:00.000Z',
    },
    projectRevision: `rev-${'e'.repeat(64)}`,
    validation: 'as-is',
    evidence: {
      status: 'complete',
      stageRuns: 1,
      required: 1,
      presented: 1,
      pending: 0,
      gaps: [{
        code: 'UNMAPPED_CLIENT_VISIBLE_CONTENT',
        severity: 'warning',
        summary: '伴生表有未映射行',
        suggestedAction: '向 PM 确认',
      }],
    },
  })

  const manifest = readLinguistExportManifests(root).get(artifactId)
  assert.equal(manifest?.validation, 'as-is')
  assert.equal(manifest?.evidence?.gaps[0]?.severity, 'warning')
})
