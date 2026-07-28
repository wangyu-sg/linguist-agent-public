import { describe, expect, test } from 'bun:test'
import {
  BATCH_CONSISTENCY_CODES,
  buildBatchConsistencyPass,
  targetedRepairProposalInputs,
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
  test('一致性 code 集合 = 确定性 4 码 ∪ critic 3 码（共 7 码）', () => {
    expect([...BATCH_CONSISTENCY_CODES].sort()).toEqual([
      'CRITIC_CONSISTENCY',
      'CRITIC_TERMINOLOGY',
      'CRITIC_VOICE',
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
    const otherCritic = finding(seg, 'CRITIC_FIDELITY')
    const pass = buildBatchConsistencyPass({
      findings: [open, resolved, waived, otherRule, otherCritic],
      segments: [seg],
    })
    expect(pass.authority).toBe('advisory_finding')
    expect(pass.canCommit).toBe(false)
    expect(pass.schemaVersion).toBe(1)
    expect(pass.findingCount).toBe(1)
    expect(pass.groups).toHaveLength(1)
    expect(pass.groups[0]!.findingIds).toEqual([open.id])
    // 全部 7 码都被纳入
    const allSeven = BATCH_CONSISTENCY_CODES.map((code) => finding(seg, code))
    const passAll = buildBatchConsistencyPass({ findings: allSeven, segments: [seg] })
    expect(passAll.findingCount).toBe(7)
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
        finding(b1, 'CRITIC_VOICE'),
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

  test('建议 target：多数获胜；平票取文档序首个；归一化只用于计票', () => {
    const { segments, findings } = majorityFixture()
    const pass = buildBatchConsistencyPass({ findings, segments })
    expect(pass.groups[0]!.suggestedTarget).toBe('译文甲')

    // 平票：甲/乙各一票 → 排序后首个段（ordinal 小者）的变体获胜
    const tie = buildBatchConsistencyPass({
      findings: [finding(segments[0]!, 'INCONSISTENT_REPEATED_SOURCE'), finding(segments[2]!, 'INCONSISTENT_REPEATED_SOURCE')],
      segments: [segments[0]!, segments[2]!],
    })
    expect(tie.groups[0]!.suggestedTarget).toBe('译文甲')

    // NFKC+trim 归一化：首尾空白/全半角差异不另立变体，但返回代表段原文
    const half = segment(5, { source: 'Repeated', target: '译文甲 ' })
    const full = segment(6, { source: 'Repeated', target: '译文甲' })
    const normalized = buildBatchConsistencyPass({
      findings: [finding(half, 'INCONSISTENT_REPEATED_SOURCE'), finding(full, 'INCONSISTENT_REPEATED_SOURCE')],
      segments: [half, full],
    })
    expect(normalized.groups[0]!.suggestedTarget).toBe('译文甲 ')
  })

  test('锁定段 target 参与计票；全空组无建议 target', () => {
    const unlockedA = segment(1, { source: 'Repeated', target: '译文乙' })
    const unlockedB = segment(2, { source: 'Repeated', target: '译文丙' })
    const locked = segment(3, { source: 'Repeated', target: '译文乙', locked: true })
    const pass = buildBatchConsistencyPass({
      findings: [unlockedA, unlockedB, locked].map((seg) => finding(seg, 'INCONSISTENT_REPEATED_SOURCE')),
      segments: [unlockedA, unlockedB, locked],
    })
    // 乙 2 票（含锁定段）胜 → 建议乙；锁定段自身不修复
    expect(pass.groups[0]!.suggestedTarget).toBe('译文乙')

    const emptyA = segment(4, { source: 'Empty', target: '', status: 'untranslated' })
    const emptyB = segment(5, { source: 'Empty', target: '  ', status: 'untranslated' })
    const emptyPass = buildBatchConsistencyPass({
      findings: [finding(emptyA, 'CRITIC_CONSISTENCY'), finding(emptyB, 'CRITIC_CONSISTENCY')],
      segments: [emptyA, emptyB],
    })
    expect(emptyPass.groups[0]!.suggestedTarget).toBeUndefined()
  })

  test('targetedRepairProposalInputs：只覆盖受影响段；锁定/已一致/无建议跳过', () => {
    const { segments, findings } = majorityFixture()
    const locked = segment(4, { source: 'Repeated', target: '译文丁', locked: true, revision: 9 })
    const noSuggestionA = segment(5, { source: 'Solo', target: '独立译文' })
    const pass = buildBatchConsistencyPass({
      findings: [
        ...findings,
        finding(locked, 'INCONSISTENT_REPEATED_SOURCE'),
        finding(noSuggestionA, 'REQUIRED_TERM'),
      ],
      segments: [...segments, locked, noSuggestionA],
    })
    const inputs = targetedRepairProposalInputs(pass)
    // Repeated 组：建议甲（甲3票 vs 乙/丁各1票）→ 仅乙段（revision 4）出 proposal；
    // 甲两段已一致、锁定段跳过；Solo 组单段自一致 → 无 proposal
    expect(inputs).toHaveLength(1)
    expect(inputs[0]).toEqual({
      segmentId: segments[2]!.id,
      baseRevision: 4,
      proposedTarget: '译文甲',
      evidenceRefs: [finding(segments[2]!, 'INCONSISTENT_REPEATED_SOURCE').id as string],
    })
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
    expect(targetedRepairProposalInputs(pass)).toEqual(targetedRepairProposalInputs(shuffled))
    expect(JSON.stringify({ segments, findings })).toBe(snapshot)
    expect(Object.isFrozen(pass)).toBe(true)
    expect(Object.isFrozen(pass.groups)).toBe(true)
    expect(Object.isFrozen(targetedRepairProposalInputs(pass))).toBe(true)
    // 幂等：修复提案被接受后（段 target 变为建议值），重跑不再生成新 proposal
    const repaired = segments.map((seg) => ({ ...seg, target: '译文甲', revision: seg.revision + 1 }))
    const converged: BatchConsistencyPass = buildBatchConsistencyPass({ findings, segments: repaired })
    expect(targetedRepairProposalInputs(converged)).toEqual([])
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
