import { describe, expect, test } from 'bun:test'
import {
  bulkProposalReviewConfirmation,
  isProposalConflictCode,
  groupProposalRuns,
  proposalMutationItems,
  proposalMutationPlan,
  proposalReviewBlock,
  textDiffParts,
} from './proposal-inbox-utils'

describe('Proposal Inbox 文本差异（PB-054）', () => {
  test('相同前后文只标记真正替换的中段', () => {
    expect(textDiffParts('保存到文件', '保存到云端文件')).toEqual([
      { kind: 'equal', text: '保存到' },
      { kind: 'insert', text: '云端' },
      { kind: 'equal', text: '文件' },
    ])
    expect(textDiffParts('旧译文。', '新译文。')).toEqual([
      { kind: 'remove', text: '旧' },
      { kind: 'insert', text: '新' },
      { kind: 'equal', text: '译文。' },
    ])
  })

  test('稳定识别需要刷新 Proposal 的并发冲突码', () => {
    expect(isProposalConflictCode('STALE_PROPOSAL')).toBe(true)
    expect(isProposalConflictCode('REVISION_CONFLICT')).toBe(true)
    expect(isProposalConflictCode('INVALID_STATE_TRANSITION')).toBe(true)
    expect(isProposalConflictCode('STORE_READ_ONLY')).toBe(false)
  })

  test('批量审核使用当前 Segment revision，忽略没有 pending Proposal 的选择', () => {
    expect(proposalMutationItems([
      {
        segment: { id: 'seg-a', ordinal: 0, revision: 3, locked: false },
        pendingProposal: { id: 'prop-a', baseRevision: 3 },
      },
      {
        segment: { id: 'seg-b', ordinal: 1, revision: 4, locked: false },
      },
    ])).toEqual([{ proposalId: 'prop-a', expectedRevision: 3 }])
  })

  test('given stale、locked、archived when 计算可审项 then Accept fail closed，Reject 可清理非归档 pending', () => {
    expect(proposalReviewBlock({ revision: 2, locked: false }, { baseRevision: 1 }, false, 'accept')).toBe('stale')
    expect(proposalReviewBlock({ revision: 1, locked: true }, { baseRevision: 1 }, false, 'accept')).toBe('locked')
    expect(proposalReviewBlock({ revision: 1, locked: false }, { baseRevision: 1 }, true, 'accept')).toBe('archived')
    expect(proposalMutationItems([
      {
        segment: { id: 'seg-stale', ordinal: 0, revision: 2, locked: false },
        pendingProposal: { id: 'stale', baseRevision: 1 },
      },
      {
        segment: { id: 'seg-locked', ordinal: 1, revision: 1, locked: true },
        pendingProposal: { id: 'locked', baseRevision: 1 },
      },
    ])).toEqual([])
    expect(proposalMutationItems([
      {
        segment: { id: 'seg-stale', ordinal: 0, revision: 2, locked: false },
        pendingProposal: { id: 'stale', baseRevision: 1 },
      },
      {
        segment: { id: 'seg-locked', ordinal: 1, revision: 1, locked: true },
        pendingProposal: { id: 'locked', baseRevision: 1 },
      },
    ], false, 'reject')).toEqual([
      { proposalId: 'stale', expectedRevision: 2 },
      { proposalId: 'locked', expectedRevision: 1 },
    ])
    expect(proposalReviewBlock(
      { revision: 2, locked: true },
      { baseRevision: 1 },
      false,
      'reject',
    )).toBeUndefined()
  })

  test('given 选择中含无建议、锁定和过期项 when 计划批量审核 then 按原始行列出排除原因', () => {
    const plan = proposalMutationPlan([
      {
        segment: { id: 'seg-ok', ordinal: 46, revision: 3, locked: false },
        pendingProposal: { id: 'prop-ok', baseRevision: 3 },
      },
      {
        segment: { id: 'seg-none', ordinal: 95, revision: 1, locked: false },
      },
      {
        segment: { id: 'seg-locked', ordinal: 96, revision: 1, locked: true },
        pendingProposal: { id: 'prop-locked', baseRevision: 1 },
      },
      {
        segment: { id: 'seg-stale', ordinal: 97, revision: 2, locked: false },
        pendingProposal: { id: 'prop-stale', baseRevision: 1 },
      },
    ])

    expect(plan.items).toEqual([{ proposalId: 'prop-ok', expectedRevision: 3 }])
    expect(plan.excluded).toEqual([
      { segmentId: 'seg-none', originalOrdinal: 96, reason: 'no-pending-proposal' },
      { segmentId: 'seg-locked', originalOrdinal: 97, reason: 'locked' },
      { segmentId: 'seg-stale', originalOrdinal: 98, reason: 'stale' },
    ])
    const confirmation = bulkProposalReviewConfirmation(
      'accept',
      4,
      plan.items.length,
      plan.excluded,
    )
    expect(confirmation).toContain('已选择 4 个句段，实际接受 1 条建议')
    expect(confirmation).toContain('原始行 96（seg-none）：没有待查看建议')
    expect(confirmation).toContain('原始行 97（seg-locked）：片段已锁定')
    expect(confirmation).toContain('原始行 98（seg-stale）：建议基于旧 revision')
  })
})

describe('Proposal run 聚合（PB-082）', () => {
  test('项目 Inbox 按 run 聚合 provenance/status，旧数据不伪造批次', () => {
    const baseDiff = {
      originalOrdinal: 1,
      source: 'Source',
      currentTarget: 'Current',
      proposedTarget: 'Proposed',
      currentRevision: 0,
      baseRevision: 0,
      locked: false,
    }
    const groups = groupProposalRuns([
      {
        ...baseDiff,
        proposal: {
          id: 'prp-0000000000000001',
          segmentId: 'seg-0000000000000001',
          baseRevision: 0,
          proposedTarget: 'A',
          evidenceRefs: [],
          termRefs: [],
          warnings: [],
          modelId: 'model-a',
          sessionId: 'session-a',
          runId: 'run-a',
          createdAt: '2026-07-29T01:00:00.000Z',
          status: 'pending' as const,
        },
      },
      {
        ...baseDiff,
        originalOrdinal: 2,
        proposal: {
          id: 'prp-0000000000000002',
          segmentId: 'seg-0000000000000002',
          baseRevision: 0,
          proposedTarget: 'B',
          evidenceRefs: [],
          termRefs: [],
          warnings: [],
          runId: 'run-a',
          createdAt: '2026-07-29T01:00:00.000Z',
          status: 'accepted' as const,
        },
      },
      {
        ...baseDiff,
        originalOrdinal: 3,
        proposal: {
          id: 'prp-0000000000000003',
          segmentId: 'seg-0000000000000003',
          baseRevision: 0,
          proposedTarget: 'C',
          evidenceRefs: [],
          termRefs: [],
          warnings: [],
          createdAt: '2026-07-28T01:00:00.000Z',
          status: 'rejected' as const,
        },
      },
    ])
    expect(groups.map((group) => group.runId)).toEqual(['run-a', 'legacy（无 run ID）'])
    expect(groups[0]?.statusCounts).toEqual({ pending: 1, accepted: 1 })
    expect(groups[0]?.modelId).toBe('model-a')
    expect(groups[0]?.sessionId).toBe('session-a')
  })
})
