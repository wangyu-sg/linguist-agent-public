import { describe, expect, test } from 'bun:test'
import { createStageEvidenceBaseline } from './stage-evidence'

describe('Stage Evidence Baseline', () => {
  test('只冻结证据、规则、映射、授权范围和 Segment Scope，不受 Target Revision 影响', () => {
    const first = createStageEvidenceBaseline({
      stageRunId: 'stage-run-1',
      discoveryScopeHash: 'scope-v1',
      mappingRevision: 'mapping-v1',
      ruleSetRevision: 'rules-v1',
      segmentIds: ['seg-b', 'seg-a'],
      evidence: [
        { ref: { kind: 'context-doc', id: 'ctx-b' }, version: 'sha-b' },
        { ref: { kind: 'asset', id: 'ast-a' }, version: 'sha-a' },
      ],
    })
    const sameFactsInAnotherOrder = createStageEvidenceBaseline({
      stageRunId: 'stage-run-1',
      discoveryScopeHash: 'scope-v1',
      mappingRevision: 'mapping-v1',
      ruleSetRevision: 'rules-v1',
      segmentIds: ['seg-a', 'seg-b'],
      evidence: [
        { ref: { kind: 'asset', id: 'ast-a' }, version: 'sha-a' },
        { ref: { kind: 'context-doc', id: 'ctx-b' }, version: 'sha-b' },
      ],
    })

    expect(sameFactsInAnotherOrder).toEqual(first)
    expect(first.segmentScopeHash).toHaveLength(64)
    expect(first.evidenceSetHash).toHaveLength(64)
    expect(first.baselineHash).toHaveLength(64)
  })
})
