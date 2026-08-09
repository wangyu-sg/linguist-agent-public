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
 * - 一致性 code 集合只接受当前确定性 QA 规则；
 * - QA 来源由旧 QualityAuditReport 改为调用方传入的 QaFinding[]
 *   （store qa-findings repository 查询结果与/或内存 runQa 输出）。
 *
 * 当前语义：
 * - 按 NFKC/trim/空白归一后的 source 分组，并暴露现有 asset/context 维度；
 * - target 只作为带 count/lockedCount 的候选展示，多数票不是自动真理；
 * - planId 绑定 segment revision/target/lock 与 finding 快照；
 * - 只有 selectedConsistencyProposalInputs 的显式 group/target/segment 选择
 *   才生成 CreateProposalInput；锁定或越界选择 fail closed。
 * - finding 引用了 segments 输入里不存在的段时，该 finding 被忽略
 *   （投影是只读操作，绝不因单条脏数据掀翻整批）。
 */

import { fnv1a64, type QaFindingId, type SegmentId } from './ids'
import type { CreateProposalInput } from './proposal'
import { QA_RULE_CODES, runQa, type QaRunOptions } from './qa-core'
import { openQaFinding, type QaFinding, type QaFindingSeverity } from './qa-finding'
import { compareSegments, type Segment } from './segment'

/**
 * 一致性 code 集合只含当前确定性 QA 规则。
 */
export const BATCH_CONSISTENCY_CODES = [
  QA_RULE_CODES.INCONSISTENT_REPEATED_SOURCE,
  QA_RULE_CODES.REQUIRED_TERM,
  QA_RULE_CODES.FORBIDDEN_TERM,
  QA_RULE_CODES.REPEATED_PUNCTUATION,
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

export interface BatchConsistencyCandidateTarget {
  target: string
  count: number
  /** 仅作来源标记，锁定候选不获得额外权重。 */
  lockedCount: number
}

export interface BatchConsistencyDimensions {
  assetIds: string[]
  contextKeys: string[]
  domains: string[]
  stringTypes: string[]
  speakers: string[]
}

export interface BatchConsistencyGroup {
  groupId: string
  source: string
  normalizedSource: string
  segmentIds: SegmentId[]
  findingIds: QaFindingId[]
  candidateTargets: BatchConsistencyCandidateTarget[]
  dimensions: BatchConsistencyDimensions
  segments: BatchConsistencyGroupSegment[]
  findings: BatchConsistencyFindingItem[]
}

export interface BatchConsistencyPass {
  schemaVersion: 2
  planId: string
  authority: 'advisory_finding'
  canCommit: false
  groups: BatchConsistencyGroup[]
  findingCount: number
}

/**
 * 在纯快照上合并确定性 QA 与已持久化 finding，再生成只读一致性计划。
 * Worker 与无 Worker 的宿主共用同一计算，避免两条执行路径产生不同 planId。
 */
export function analyzeBatchConsistency(input: {
  segments: readonly Segment[]
  options?: QaRunOptions
  persistedFindings?: readonly QaFinding[]
}): BatchConsistencyPass {
  const merged = new Map<string, QaFinding>()
  for (const findingInput of runQa(input.segments, input.options)) {
    const finding = openQaFinding(findingInput)
    merged.set(finding.id as string, finding)
  }
  for (const finding of input.persistedFindings ?? []) {
    if (!merged.has(finding.id as string)) merged.set(finding.id as string, finding)
  }
  return buildBatchConsistencyPass({ findings: [...merged.values()], segments: input.segments })
}

function normalizeText(value: string): string {
  return value.normalize('NFKC').trim().replace(/\s+/gu, ' ')
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child)
    Object.freeze(value)
  }
  return value
}

/**
 * 候选计数只供 plan 展示，绝不隐式选择。segments 已按文档顺序排序，
 * 同票时保留首次出现顺序。
 */
function candidateTargets(segments: readonly Segment[]): BatchConsistencyCandidateTarget[] {
  const votes = new Map<
    string,
    BatchConsistencyCandidateTarget & { firstIndex: number }
  >()
  for (const segment of segments) {
    const key = normalizeText(segment.target)
    if (key === '') continue
    const entry = votes.get(key)
    if (entry === undefined) {
      votes.set(key, {
        count: 1,
        target: segment.target,
        lockedCount: segment.locked ? 1 : 0,
        firstIndex: votes.size,
      })
    } else {
      entry.count += 1
      if (segment.locked) entry.lockedCount += 1
    }
  }
  return [...votes.values()]
    .sort((left, right) => right.count - left.count || left.firstIndex - right.firstIndex)
    .map(({ firstIndex: _firstIndex, ...candidate }) => candidate)
}

function uniqueSorted(values: Iterable<string | undefined>): string[] {
  return [...new Set([...values].filter((value): value is string => Boolean(value?.trim())))]
    .sort((left, right) => left.localeCompare(right))
}

function dimensions(segments: readonly Segment[]): BatchConsistencyDimensions {
  const meta = (segment: Segment, ...keys: string[]): string | undefined => {
    for (const key of keys) {
      const value = segment.context?.meta?.[key]
      if (value?.trim()) return value
    }
    return undefined
  }
  return {
    assetIds: uniqueSorted(segments.map((segment) => segment.assetId as string)),
    contextKeys: uniqueSorted(segments.map((segment) => segment.key)),
    domains: uniqueSorted(segments.map((segment) => meta(segment, 'domain'))),
    stringTypes: uniqueSorted(
      segments.map((segment) => meta(segment, 'stringType', 'string_type')),
    ),
    speakers: uniqueSorted(segments.map((segment) => meta(segment, 'speaker'))),
  }
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
    const normalizedSource = normalizeText(segment.source)
    let group = groupsBySource.get(normalizedSource)
    if (group === undefined) {
      group = { segments: new Map(), findings: [] }
      groupsBySource.set(normalizedSource, group)
    }
    group.segments.set(segment.id as string, segment)
    group.findings.push(finding)
  }
  const groups: BatchConsistencyGroup[] = []
  for (const [normalizedSource, group] of groupsBySource) {
    const segments = [...group.segments.values()].sort(compareSegments)
    const findings = [...group.findings].sort((left, right) =>
      (left.id as string).localeCompare(right.id as string),
    )
    const groupDimensions = dimensions(segments)
    groups.push({
      groupId: `csg-${fnv1a64(normalizedSource)}`,
      source: segments[0]!.source,
      normalizedSource,
      segmentIds: segments.map((segment) => segment.id),
      findingIds: findings.map((finding) => finding.id),
      candidateTargets: candidateTargets(segments),
      dimensions: groupDimensions,
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
    if (a === undefined || b === undefined) return left.normalizedSource.localeCompare(right.normalizedSource)
    return compareSegments(a, b)
  })
  const findingCount = groups.reduce((sum, group) => sum + group.findings.length, 0)
  const planId = `csp-${fnv1a64(JSON.stringify(groups.map((group) => ({
    groupId: group.groupId,
    segments: group.segments,
    findingIds: group.findingIds,
  }))))}`
  return deepFreeze({
    schemaVersion: 2,
    planId,
    authority: 'advisory_finding',
    canCommit: false,
    groups,
    findingCount,
  })
}

/**
 * 把显式选择转成 Proposal 输入。无选择即零写入；未知组/段和锁定段
 * fail closed，避免调用方把“候选多数”偷换成自动事实。
 */
export interface ConsistencyRepairSelection {
  groupId: string
  proposedTarget: string
  segmentIds: readonly SegmentId[]
}

export function selectedConsistencyProposalInputs(
  pass: BatchConsistencyPass,
  selections: readonly ConsistencyRepairSelection[],
): CreateProposalInput[] {
  const inputs: CreateProposalInput[] = []
  const groups = new Map(pass.groups.map((group) => [group.groupId, group]))
  const selectedGroups = new Set<string>()
  for (const selection of selections) {
    if (selectedGroups.has(selection.groupId)) {
      throw new Error(`Duplicate consistency group selection: ${selection.groupId}.`)
    }
    selectedGroups.add(selection.groupId)
    const group = groups.get(selection.groupId)
    if (group === undefined) throw new Error(`Unknown consistency group: ${selection.groupId}.`)
    if (selection.proposedTarget.trim() === '') {
      throw new Error(`Consistency target is empty for group ${selection.groupId}.`)
    }
    const segments = new Map(group.segments.map((segment) => [segment.segmentId as string, segment]))
    for (const segmentId of new Set(selection.segmentIds)) {
      const segment = segments.get(segmentId as string)
      if (segment === undefined) {
        throw new Error(`Segment ${segmentId} is outside consistency group ${selection.groupId}.`)
      }
      if (segment.locked) throw new Error(`Segment ${segmentId} is locked.`)
      if (normalizeText(segment.target) === normalizeText(selection.proposedTarget)) continue
      inputs.push({
        segmentId: segment.segmentId,
        baseRevision: segment.revision,
        proposedTarget: selection.proposedTarget,
        evidenceRefs: group.findings
          .filter((finding) => finding.segmentId === segment.segmentId)
          .map((finding) => finding.findingId as string),
      })
    }
  }
  return deepFreeze(inputs)
}
