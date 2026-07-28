/**
 * Batch Consistency Repair 投影（PB-084）。
 *
 * 提取自旧仓 linguist-agent@la-v2-legacy-freeze-2026-07-25
 * `packages/cat-data/src/batch_consistency_repair.ts`（79 行纯投影逻辑）。
 * 保留的核心语义：只看 status=open 且 code 属于一致性集合的 finding；
 * authority 烧死 advisory_finding / canCommit=false —— 投影绝不直接写段，
 * 修复一律走 Proposal 人工审核链。
 *
 * 类型对接（LEGACY_EXTRACTION_SPEC.md PB-084 小节定夺）：
 * - 新仓 QaFinding 无 evidenceSources 字段 → 首版丢弃该维度；
 * - 新仓 CreateProposalInput 无 changeType → 丢弃（不并入 warnings）；
 * - 一致性 code 集合对齐新仓规则目录 = 确定性 QA 4 码 ∪ critic 3 码（共 7 码）；
 * - QA 来源由旧 QualityAuditReport 改为调用方传入的 QaFinding[]
 *   （store qa-findings repository 查询结果与/或内存 runQa 输出）。
 *
 * 本票新增语义（旧仓没有、规格未写死，按「同 source 组内多数非空 target」
 * 落地并在此写明）：
 * - 投影按 source 文本分组；每组选出「建议修复 target」：组内段先按
 *   compareSegments 排序，对 NFKC+trim 归一化后的非空 target 计票，多数
 *   变体获胜，平票取排序后首个段的变体（归一化只用于计票，返回的是代表
 *   段的原文 target）。「最新」维度在 core 层无时间源，首版不取。
 * - 锁定段的 target 仍参与计票（已锁定译文通常是审校基准），但锁定段
 *   自身绝不生成修复 proposal。
 * - 组内全部 target 为空 → 无 suggestedTarget，该组只报告不修复。
 * - targetedRepairProposalInputs 只为「当前 target 与建议值归一化后不同」
 *   的未锁定段生成 CreateProposalInput（baseRevision 取段当前 revision，
 *   evidenceRefs 带该段在本组的 finding ids 供人审追溯）；当前值已与建议
 *   一致的段跳过 —— 重复运行幂等，不产生新 proposal。
 * - finding 引用了 segments 输入里不存在的段时，该 finding 被忽略
 *   （投影是只读操作，绝不因单条脏数据掀翻整批）。
 */

import type { QaFindingId, SegmentId } from './ids'
import type { CreateProposalInput } from './proposal'
import { QA_RULE_CODES } from './qa-core'
import type { QaFinding, QaFindingSeverity } from './qa-finding'
import { compareSegments, type Segment } from './segment'

/**
 * 一致性 code 集合：确定性 QA 4 码 ∪ independent critic 3 码。
 * critic 码由 tools 运行时以 `CRITIC_<CATEGORY>` 生成（见 cat-tools 工厂），
 * 本集合取其中 consistency/voice/terminology 三类。
 */
export const BATCH_CONSISTENCY_CODES = [
  QA_RULE_CODES.INCONSISTENT_REPEATED_SOURCE,
  QA_RULE_CODES.REQUIRED_TERM,
  QA_RULE_CODES.FORBIDDEN_TERM,
  QA_RULE_CODES.REPEATED_PUNCTUATION,
  'CRITIC_CONSISTENCY',
  'CRITIC_VOICE',
  'CRITIC_TERMINOLOGY',
] as const

export type BatchConsistencyCode = (typeof BATCH_CONSISTENCY_CODES)[number]

const CONSISTENCY_CODE_SET: ReadonlySet<string> = new Set(BATCH_CONSISTENCY_CODES)

export interface BatchConsistencyFindingItem {
  findingId: QaFindingId
  segmentId: SegmentId
  code: BatchConsistencyCode
  severity: QaFindingSeverity
  message: string
  locked: boolean
}

/** 组内段的修复决策所需状态快照。 */
export interface BatchConsistencyGroupSegment {
  segmentId: SegmentId
  revision: number
  target: string
  locked: boolean
}

export interface BatchConsistencyGroup {
  source: string
  segmentIds: SegmentId[]
  findingIds: QaFindingId[]
  /** 组内多数非空 target；组内全空时缺省（只报告，不生成修复）。 */
  suggestedTarget?: string
  segments: BatchConsistencyGroupSegment[]
  findings: BatchConsistencyFindingItem[]
}

export interface BatchConsistencyPass {
  schemaVersion: 1
  authority: 'advisory_finding'
  canCommit: false
  groups: BatchConsistencyGroup[]
  findingCount: number
}

/** 与 runQa 的 INCONSISTENT_REPEATED_SOURCE 判定同一归一化口径。 */
function normalizeTarget(value: string): string {
  return value.normalize('NFKC').trim()
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child)
    Object.freeze(value)
  }
  return value
}

/**
 * 多数计票选建议 target（规则见模块头注释）。segments 必须已按
 * compareSegments 排序 —— 平票时首个段的变体获胜（Map 插入序 + 严格大于
 * 才替换，保证确定性）。
 */
function suggestTarget(segments: readonly Segment[]): string | undefined {
  const votes = new Map<string, { count: number; target: string }>()
  for (const segment of segments) {
    const key = normalizeTarget(segment.target)
    if (key === '') continue
    const entry = votes.get(key)
    if (entry === undefined) votes.set(key, { count: 1, target: segment.target })
    else entry.count += 1
  }
  let best: { count: number; target: string } | undefined
  for (const entry of votes.values()) {
    if (best === undefined || entry.count > best.count) best = entry
  }
  return best?.target
}

/**
 * 把 open 的一致性 finding 投影成按 source 分组的 advisory pass。
 * 纯投影：不重查、不重跑 QA，也绝不写任何状态。
 */
export function buildBatchConsistencyPass(input: {
  findings: readonly QaFinding[]
  segments: readonly Segment[]
}): BatchConsistencyPass {
  const segmentsById = new Map<string, Segment>(
    input.segments.map((segment) => [segment.id as string, segment]),
  )
  const groupsBySource = new Map<string, { segments: Map<string, Segment>; findings: QaFinding[] }>()
  for (const finding of input.findings) {
    if (finding.status !== 'open' || !CONSISTENCY_CODE_SET.has(finding.code)) continue
    const segment = segmentsById.get(finding.segmentId as string)
    if (segment === undefined) continue
    let group = groupsBySource.get(segment.source)
    if (group === undefined) {
      group = { segments: new Map(), findings: [] }
      groupsBySource.set(segment.source, group)
    }
    group.segments.set(segment.id as string, segment)
    group.findings.push(finding)
  }
  const groups: BatchConsistencyGroup[] = []
  for (const [source, group] of groupsBySource) {
    const segments = [...group.segments.values()].sort(compareSegments)
    const findings = [...group.findings].sort((left, right) =>
      (left.id as string).localeCompare(right.id as string),
    )
    const suggestedTarget = suggestTarget(segments)
    groups.push({
      source,
      segmentIds: segments.map((segment) => segment.id),
      findingIds: findings.map((finding) => finding.id),
      ...(suggestedTarget !== undefined ? { suggestedTarget } : {}),
      segments: segments.map((segment) => ({
        segmentId: segment.id,
        revision: segment.revision,
        target: segment.target,
        locked: segment.locked,
      })),
      findings: findings.map((finding) => ({
        findingId: finding.id,
        segmentId: finding.segmentId,
        code: finding.code as BatchConsistencyCode,
        severity: finding.severity,
        message: finding.message,
        locked: segmentsById.get(finding.segmentId as string)?.locked ?? false,
      })),
    })
  }
  // 组序 = 组内首个段的文档顺序（compareSegments 是全序，组间首段唯一；
  // 组成员必在 segmentsById 中——引用缺失段的 finding 已被跳过）。
  groups.sort((left, right) => {
    const a = segmentsById.get(left.segmentIds[0] as string)
    const b = segmentsById.get(right.segmentIds[0] as string)
    if (a === undefined || b === undefined) return left.source.localeCompare(right.source)
    return compareSegments(a, b)
  })
  const findingCount = groups.reduce((sum, group) => sum + group.findings.length, 0)
  return deepFreeze({
    schemaVersion: 1,
    authority: 'advisory_finding',
    canCommit: false,
    groups,
    findingCount,
  })
}

/**
 * 把分组结果转成定点修复 proposal 输入：只覆盖「当前 target 与组建议值
 * 不一致」的未锁定段，绝不碰其他段。纯函数；返回数组已冻结。
 */
export function targetedRepairProposalInputs(pass: BatchConsistencyPass): CreateProposalInput[] {
  const inputs: CreateProposalInput[] = []
  for (const group of pass.groups) {
    if (group.suggestedTarget === undefined) continue
    const suggested = normalizeTarget(group.suggestedTarget)
    for (const segment of group.segments) {
      if (segment.locked) continue
      if (normalizeTarget(segment.target) === suggested) continue
      inputs.push({
        segmentId: segment.segmentId,
        baseRevision: segment.revision,
        proposedTarget: group.suggestedTarget,
        evidenceRefs: group.findings
          .filter((finding) => finding.segmentId === segment.segmentId)
          .map((finding) => finding.findingId as string),
      })
    }
  }
  return deepFreeze(inputs)
}
