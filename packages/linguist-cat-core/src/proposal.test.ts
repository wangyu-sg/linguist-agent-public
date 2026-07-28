import { describe, expect, test } from 'bun:test'
import {
  InvalidStateTransitionError,
  SegmentLockedError,
  StaleProposalError,
  UnknownSegmentError,
  acceptProposal,
  applyTargetEdit,
  createProposal,
  deriveSegmentId,
  expireProposal,
  lockSegment,
  rejectProposal,
  reissueProposal,
  supersedeProposal,
} from './index'
import { makeSegment } from './segment.test'

const NOW = '2026-07-25T00:00:00.000Z'

describe('提案生命周期', () => {
  test('创建 → pending，ID 内容派生且确定', () => {
    const seg = makeSegment()
    const p1 = createProposal({ segmentId: seg.id, baseRevision: 0, proposedTarget: '你好', now: NOW })
    const p2 = createProposal({ segmentId: seg.id, baseRevision: 0, proposedTarget: '你好', now: NOW })
    expect(p1.status).toBe('pending')
    expect(p1.id).toBe(p2.id)
    expect(p1.evidenceRefs).toEqual([])
    expect(p1.termRefs).toEqual([])
    expect(p1.warnings).toEqual([])
  })

  test('接受 → 段更新为 proposedTarget/translated + 提案 accepted + revision 条目 source=proposal', () => {
    const seg = makeSegment()
    const proposal = createProposal({
      segmentId: seg.id,
      baseRevision: 0,
      proposedTarget: '你好',
      evidenceRefs: ['tm:1'],
      now: NOW,
    })
    const { segment, revision, proposal: accepted } = acceptProposal(seg, proposal, { now: NOW })

    expect(segment.target).toBe('你好')
    expect(segment.status).toBe('translated')
    expect(segment.revision).toBe(1)
    expect(accepted.status).toBe('accepted')
    expect(revision).toEqual({
      revision: 1,
      target: '你好',
      status: 'translated',
      source: 'proposal',
      createdAt: NOW,
    })
    // 输入提案不被突变
    expect(proposal.status).toBe('pending')
  })

  test('陈旧提案（baseRevision 不匹配）→ StaleProposalError，绝不强应用', () => {
    const seg = makeSegment()
    const proposal = createProposal({ segmentId: seg.id, baseRevision: 0, proposedTarget: '你好', now: NOW })
    // 段先行被人工编辑，revision 前进
    const { segment: moved } = applyTargetEdit(seg, '人工译文', 0, { now: NOW })

    let caught: unknown
    try {
      acceptProposal(moved, proposal, { now: NOW })
    } catch (err) {
      caught = err
    }
    expect(caught).toBeInstanceOf(StaleProposalError)
    const stale = caught as StaleProposalError
    expect(stale.code).toBe('STALE_PROPOSAL')
    expect(stale.expectedRevision).toBe(0)
    expect(stale.currentRevision).toBe(1)
    expect(moved.target).toBe('人工译文')
  })

  test('锁定段拒绝接受提案', () => {
    const seg = lockSegment(makeSegment())
    const proposal = createProposal({ segmentId: seg.id, baseRevision: 0, proposedTarget: '你好', now: NOW })
    expect(() => acceptProposal(seg, proposal, { now: NOW })).toThrow(SegmentLockedError)
  })

  test('提案指向其他段 → UnknownSegmentError', () => {
    const seg = makeSegment()
    const other = makeSegment({ id: deriveSegmentId(seg.assetId, 99) })
    expect(other.id).not.toBe(seg.id)
    const proposal = createProposal({ segmentId: other.id, baseRevision: 0, proposedTarget: 'x', now: NOW })
    let caught: unknown
    try {
      acceptProposal(seg, proposal, { now: NOW })
    } catch (err) {
      caught = err
    }
    expect(caught).toBeInstanceOf(UnknownSegmentError)
    expect((caught as UnknownSegmentError).code).toBe('UNKNOWN_SEGMENT')
  })

  test('非 pending 提案不可再接受/拒绝/取代', () => {
    const seg = makeSegment()
    const proposal = createProposal({ segmentId: seg.id, baseRevision: 0, proposedTarget: '你好', now: NOW })
    const { proposal: accepted } = acceptProposal(seg, proposal, { now: NOW })

    expect(() => acceptProposal(makeSegment({ revision: 1 }), accepted, { now: NOW })).toThrow(
      InvalidStateTransitionError,
    )
    expect(() => rejectProposal(accepted)).toThrow(InvalidStateTransitionError)
    expect(() => supersedeProposal(accepted)).toThrow(InvalidStateTransitionError)
    try {
      rejectProposal(accepted)
    } catch (err) {
      expect((err as InvalidStateTransitionError).code).toBe('INVALID_STATE_TRANSITION')
      expect((err as InvalidStateTransitionError).from).toBe('accepted')
      expect((err as InvalidStateTransitionError).to).toBe('rejected')
    }
  })

  test('取代语义：pending → superseded，取代后不可接受', () => {
    const seg = makeSegment()
    const oldP = createProposal({ segmentId: seg.id, baseRevision: 0, proposedTarget: '旧译', now: NOW })
    const newP = createProposal({ segmentId: seg.id, baseRevision: 0, proposedTarget: '新译', now: NOW })
    expect(oldP.id).not.toBe(newP.id)

    const superseded = supersedeProposal(oldP)
    expect(superseded.status).toBe('superseded')
    expect(() => acceptProposal(seg, superseded, { now: NOW })).toThrow(InvalidStateTransitionError)

    // 新提案仍可正常接受
    const { segment, proposal: acceptedNew } = acceptProposal(seg, newP, { now: NOW })
    expect(segment.target).toBe('新译')
    expect(acceptedNew.status).toBe('accepted')
  })

  test('拒绝语义：pending → rejected，拒绝后不可接受', () => {
    const seg = makeSegment()
    const proposal = createProposal({ segmentId: seg.id, baseRevision: 0, proposedTarget: 'x', now: NOW })
    const rejected = rejectProposal(proposal)
    expect(rejected.status).toBe('rejected')
    expect(() => acceptProposal(seg, rejected, { now: NOW })).toThrow(InvalidStateTransitionError)
  })

  test('过期语义：pending → expired，过期后不可接受', () => {
    const seg = makeSegment()
    const proposal = createProposal({ segmentId: seg.id, baseRevision: 0, proposedTarget: 'x', now: NOW })
    const expired = expireProposal(proposal)
    expect(expired.status).toBe('expired')
    expect(() => acceptProposal(seg, expired, { now: NOW })).toThrow(InvalidStateTransitionError)
  })

  test('终态提案可显式重发：相同内容产生新 ID，旧历史不变且 lineage/run 可审计', () => {
    const original = rejectProposal(createProposal({
      segmentId: makeSegment().id,
      baseRevision: 0,
      proposedTarget: '最终确认仍正确的译文',
      modelId: 'old-model',
      sessionId: 'old-session',
      runId: 'old-run',
      now: NOW,
    }))
    const reissued = reissueProposal(original, {
      baseRevision: 0,
      reissueKey: 'human-reconcile-1',
      runId: 'reconcile-run-1',
      now: '2026-07-25T01:00:00.000Z',
    })

    expect(reissued.id).not.toBe(original.id)
    expect(reissued.proposedTarget).toBe(original.proposedTarget)
    expect(reissued.status).toBe('pending')
    expect(reissued.reissuedFromProposalId).toBe(original.id)
    expect(reissued.runId).toBe('reconcile-run-1')
    expect(reissued.modelId).toBe('old-model')
    expect(reissued.sessionId).toBe('old-session')
    expect(original.status).toBe('rejected')
    expect(() => reissueProposal(reissued, {
      baseRevision: 0,
      reissueKey: 'invalid-pending',
    })).toThrow(InvalidStateTransitionError)
  })
})
