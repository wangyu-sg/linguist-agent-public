import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createSeededEntropy } from '@linguist/cat-core'
import { CatStore } from '@linguist/cat-store'
import type { ProjectDiscoveryScope } from './project-discovery-scope'
import { ensureStageEvidenceForSession } from './stage-evidence-host'

test('宿主冻结 Stage Plan，复用 delegation baseline，并把未映射数据行形成非阻断确认项', () => {
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
        sourceDelegationId: 'delegation-1',
        linguistDelegatedScope: { assetIds: [imported.asset.id], segmentIds: [imported.segments[0]!.id] },
      },
      db,
      discoveryScope: scope,
      fallbackSegmentIds: [],
    })!
    assert.equal(first.stageRunId, 'stage:delegation-1')
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
        id: 'child-2',
        linguistRole: 'reviewer',
        sourceDelegationId: 'delegation-1',
        linguistDelegatedScope: { assetIds: [], segmentIds: [imported.segments[0]!.id] },
      },
      db,
      discoveryScope: scope,
      fallbackSegmentIds: [],
    })!
    assert.equal(resumed.baseline.baselineHash, first.baseline.baselineHash)

    db.segments.applyTargetEdit(imported.segments[0]!.id, 'pulled down', 0)
    assert.notEqual(ensureStageEvidenceForSession({
      session: { id: 'child-2', linguistRole: 'reviewer', sourceDelegationId: 'delegation-1' },
      db,
      discoveryScope: scope,
      fallbackSegmentIds: [imported.segments[0]!.id],
    })?.status, 'stale')

    assert.equal(ensureStageEvidenceForSession({
      session: { id: 'child-2', linguistRole: 'reviewer', sourceDelegationId: 'delegation-1' },
      db,
      discoveryScope: { ...scope, hash: 'scope-2' },
      fallbackSegmentIds: [imported.segments[0]!.id],
    })?.status, 'stale')
  } finally {
    db.close()
  }
})
