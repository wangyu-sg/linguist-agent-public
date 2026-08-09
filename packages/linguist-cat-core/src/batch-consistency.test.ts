import { describe, expect, test } from 'bun:test'
import {
  BATCH_CONSISTENCY_CODES,
  buildBatchConsistencyPass,
  selectedConsistencyProposalInputs,
  type BatchConsistencyPass,
} from './batch-consistency'
import type { AssetId, SegmentId } from './ids'
import { openQaFinding, transitionQaFinding, type QaFinding } from './qa-finding'
import type { Segment } from './segment'

function segment(index: number, patch: Partial<Segment>): Segment {
  return {
    id: `seg-${index.toString(16).padStart(16, '0')}` as SegmentId,
    assetId: 'ast-0000000000000001' as AssetId,
    ordinal: index,
    source: `Source ${index}`,
    target: `译文 ${index}`,
    sourceLocale: 'en',
    targetLocale: 'zh-CN',
    status: 'translated',
    locked: false,
    revision: 0,
    sourceHash: `hash-${index}`,
    ...patch,
  }
}

function finding(seg: Segment, code: string, message = `msg-${code}`): QaFinding {
  return openQaFinding({ segmentId: seg.id, code, severity: 'L2', message })
}

/** 三连同源组：甲/甲/乙，多数为甲。 */
function majorityFixture(): { segments: Segment[]; findings: QaFinding[] } {
  const segments = [
    segment(1, { source: 'Repeated', target: '译文甲' }),
    segment(2, { source: 'Repeated', target: '译文甲' }),
    segment(3, { source: 'Repeated', target: '译文乙', revision: 4 }),
  ]
  const findings = segments.map((seg) => finding(seg, 'INCONSISTENT_REPEATED_SOURCE'))
  return { segments, findings }
}

describe('PB-084 batch consistency projection', () => {
  test('一致性 code 集合只含当前确定性 4 码', () => {
    expect([...BATCH_CONSISTENCY_CODES].sort()).toEqual([
      'FORBIDDEN_TERM',
      'INCONSISTENT_REPEATED_SOURCE',
      'REPEATED_PUNCTUATION',
      'REQUIRED_TERM',
    ])
  })

  test('只看 open 且 code 属于一致性集合的 finding；authority/canCommit 烧死', () => {
    const seg = segment(1, {})
    const open = finding(seg, 'REQUIRED_TERM')
    const resolved = transitionQaFinding(finding(seg, 'FORBIDDEN_TERM'), 'resolved')
    const waived = transitionQaFinding(finding(seg, 'REPEATED_PUNCTUATION'), 'waived')
    const otherRule = finding(seg, 'PLACEHOLDER_MISMATCH')
    const unknownRule = finding(seg, 'UNRELATED_RULE')
    const pass = buildBatchConsistencyPass({
      findings: [open, resolved, waived, otherRule, unknownRule],
      segments: [seg],
    })
    expect(pass.authority).toBe('advisory_finding')
    expect(pass.canCommit).toBe(false)
    expect(pass.schemaVersion).toBe(2)
    expect(pass.planId).toMatch(/^csp-[0-9a-f]{16}$/)
    expect(pass.findingCount).toBe(1)
    expect(pass.groups).toHaveLength(1)
    expect(pass.groups[0]!.findingIds).toEqual([open.id])
    const allCodes = BATCH_CONSISTENCY_CODES.map((code) => finding(seg, code))
    const passAll = buildBatchConsistencyPass({ findings: allCodes, segments: [seg] })
    expect(passAll.findingCount).toBe(4)
    expect(passAll.groups[0]!.findings.map((item) => item.code).sort()).toEqual(
      [...BATCH_CONSISTENCY_CODES].sort(),
    )
  })

  test('按 source 分组；segmentIds/findingIds 派生；锁定标记来自段状态', () => {
    const a1 = segment(1, { source: 'Alpha', target: '甲' })
    const a2 = segment(2, { source: 'Alpha', target: '乙' })
    const b1 = segment(3, { source: 'Beta', target: '丙', locked: true })
    const pass = buildBatchConsistencyPass({
      findings: [
        finding(b1, 'REQUIRED_TERM'),
        finding(a2, 'INCONSISTENT_REPEATED_SOURCE'),
        finding(a1, 'INCONSISTENT_REPEATED_SOURCE'),
      ],
      segments: [a1, a2, b1],
    })
    expect(pass.groups).toHaveLength(2)
    // 组序 = 组内首个段的文档顺序（ordinal 1 的 Alpha 在前）
    const [alpha, beta] = pass.groups
    expect(alpha!.source).toBe('Alpha')
    expect(alpha!.segmentIds).toEqual([a1.id, a2.id])
    expect(alpha!.findingIds).toEqual(
      [finding(a1, 'INCONSISTENT_REPEATED_SOURCE').id, finding(a2, 'INCONSISTENT_REPEATED_SOURCE').id].sort(),
    )
    expect(alpha!.findings.every((item) => !item.locked)).toBe(true)
    expect(beta!.source).toBe('Beta')
    expect(beta!.findings[0]!.locked).toBe(true)
    expect(beta!.segments[0]!.locked).toBe(true)
    expect(pass.findingCount).toBe(3)
  })

  test('候选 target 只报告计数，不自动成为修复真理', () => {
    const { segments, findings } = majorityFixture()
    const pass = buildBatchConsistencyPass({ findings, segments })
    expect(pass.groups[0]!.groupId).toMatch(/^csg-[0-9a-f]{16}$/)
    expect(pass.groups[0]!.candidateTargets).toEqual([
      { target: '译文甲', count: 2, lockedCount: 0 },
      { target: '译文乙', count: 1, lockedCount: 0 },
    ])
    expect(selectedConsistencyProposalInputs(pass, [])).toEqual([])

    // 平票只维持确定性展示顺序，不产生隐式选择。
    const tie = buildBatchConsistencyPass({
      findings: [finding(segments[0]!, 'INCONSISTENT_REPEATED_SOURCE'), finding(segments[2]!, 'INCONSISTENT_REPEATED_SOURCE')],
      segments: [segments[0]!, segments[2]!],
    })
    expect(tie.groups[0]!.candidateTargets.map((item) => item.target)).toEqual(['译文甲', '译文乙'])

    // NFKC+trim 归一化：首尾空白/全半角差异不另立变体，返回首个代表原文。
    const half = segment(5, { source: 'Repeated', target: '译文甲 ' })
    const full = segment(6, { source: 'Repeated', target: '译文甲' })
    const normalized = buildBatchConsistencyPass({
      findings: [finding(half, 'INCONSISTENT_REPEATED_SOURCE'), finding(full, 'INCONSISTENT_REPEATED_SOURCE')],
      segments: [half, full],
    })
    expect(normalized.groups[0]!.candidateTargets).toEqual([
      { target: '译文甲 ', count: 2, lockedCount: 0 },
    ])
  })

  test('锁定段仅作为标记过的候选上下文；全空组无候选 target', () => {
    const unlockedA = segment(1, { source: 'Repeated', target: '译文乙' })
    const unlockedB = segment(2, { source: 'Repeated', target: '译文丙' })
    const locked = segment(3, { source: 'Repeated', target: '译文乙', locked: true })
    const pass = buildBatchConsistencyPass({
      findings: [unlockedA, unlockedB, locked].map((seg) => finding(seg, 'INCONSISTENT_REPEATED_SOURCE')),
      segments: [unlockedA, unlockedB, locked],
    })
    expect(pass.groups[0]!.candidateTargets[0]).toEqual({
      target: '译文乙',
      count: 2,
      lockedCount: 1,
    })

    const emptyA = segment(4, { source: 'Empty', target: '', status: 'untranslated' })
    const emptyB = segment(5, { source: 'Empty', target: '  ', status: 'untranslated' })
    const emptyPass = buildBatchConsistencyPass({
      findings: [finding(emptyA, 'INCONSISTENT_REPEATED_SOURCE'), finding(emptyB, 'INCONSISTENT_REPEATED_SOURCE')],
      segments: [emptyA, emptyB],
    })
    expect(emptyPass.groups[0]!.candidateTargets).toEqual([])
  })

  test('apply 只接受显式 group/target/segment 选择，锁定与越界选择 fail closed', () => {
    const { segments, findings } = majorityFixture()
    const locked = segment(4, { source: 'Repeated', target: '译文丁', locked: true, revision: 9 })
    const pass = buildBatchConsistencyPass({
      findings: [
        ...findings,
        finding(locked, 'INCONSISTENT_REPEATED_SOURCE'),
      ],
      segments: [...segments, locked],
    })
    const group = pass.groups[0]!
    const inputs = selectedConsistencyProposalInputs(pass, [{
      groupId: group.groupId,
      proposedTarget: '人工审定译文',
      segmentIds: [segments[2]!.id],
    }])
    expect(inputs).toHaveLength(1)
    expect(inputs[0]).toEqual({
      segmentId: segments[2]!.id,
      baseRevision: 4,
      proposedTarget: '人工审定译文',
      evidenceRefs: [finding(segments[2]!, 'INCONSISTENT_REPEATED_SOURCE').id as string],
    })
    expect(() => selectedConsistencyProposalInputs(pass, [{
      groupId: group.groupId,
      proposedTarget: '不能改锁定段',
      segmentIds: [locked.id],
    }])).toThrow(/locked/)
    expect(() => selectedConsistencyProposalInputs(pass, [{
      groupId: 'csg-0000000000000000',
      proposedTarget: '未知组',
      segmentIds: [segments[2]!.id],
    }])).toThrow(/Unknown consistency group/)
  })

  test('确定性 + 幂等：乱序输入同输出；输入不被修改；返回已冻结', () => {
    const { segments, findings } = majorityFixture()
    const snapshot = JSON.stringify({ segments, findings })
    const pass = buildBatchConsistencyPass({ findings, segments })
    const shuffled = buildBatchConsistencyPass({
      findings: [...findings].reverse(),
      segments: [...segments].reverse(),
    })
    expect(pass).toEqual(shuffled)
    expect(JSON.stringify({ segments, findings })).toBe(snapshot)
    expect(Object.isFrozen(pass)).toBe(true)
    expect(Object.isFrozen(pass.groups)).toBe(true)
    const selection = [{
      groupId: pass.groups[0]!.groupId,
      proposedTarget: '译文甲',
      segmentIds: [segments[2]!.id],
    }]
    expect(selectedConsistencyProposalInputs(pass, selection)).toEqual(
      selectedConsistencyProposalInputs(shuffled, selection),
    )
    expect(Object.isFrozen(selectedConsistencyProposalInputs(pass, selection))).toBe(true)
    // 已与显式 target 一致的段不再生成重复 proposal。
    const repaired = segments.map((seg) => ({ ...seg, target: '译文甲', revision: seg.revision + 1 }))
    const converged: BatchConsistencyPass = buildBatchConsistencyPass({ findings, segments: repaired })
    expect(selectedConsistencyProposalInputs(converged, [{
      groupId: converged.groups[0]!.groupId,
      proposedTarget: '译文甲',
      segmentIds: repaired.map((segment) => segment.id),
    }])).toEqual([])
  })

  test('引用未知段的 finding 被忽略，不掀翻整批', () => {
    const seg = segment(1, { source: 'Alpha', target: '甲' })
    const ghost = finding(segment(99, {}), 'REQUIRED_TERM')
    const pass = buildBatchConsistencyPass({
      findings: [finding(seg, 'REQUIRED_TERM'), ghost],
      segments: [seg],
    })
    expect(pass.findingCount).toBe(1)
    expect(pass.groups[0]!.findingIds).not.toContain(ghost.id)
  })
})
