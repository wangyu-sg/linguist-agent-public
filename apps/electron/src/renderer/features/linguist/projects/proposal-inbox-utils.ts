import type {
  LinguistIpcErrorCode,
  LinguistProposalDiff,
  LinguistProposalStatus,
} from '@proma/shared'

export interface TextDiffPart {
  kind: 'equal' | 'remove' | 'insert'
  text: string
}

/** 译文通常很短；共同前后缀已足够把单次人工建议的变化讲清楚。 */
export function textDiffParts(current: string, proposed: string): TextDiffPart[] {
  const before = Array.from(current)
  const after = Array.from(proposed)
  let prefix = 0
  while (prefix < before.length && prefix < after.length && before[prefix] === after[prefix]) {
    prefix += 1
  }
  let suffix = 0
  while (
    suffix < before.length - prefix &&
    suffix < after.length - prefix &&
    before[before.length - 1 - suffix] === after[after.length - 1 - suffix]
  ) {
    suffix += 1
  }

  const parts: TextDiffPart[] = []
  const push = (kind: TextDiffPart['kind'], chars: string[]): void => {
    if (chars.length > 0) parts.push({ kind, text: chars.join('') })
  }
  push('equal', before.slice(0, prefix))
  push('remove', before.slice(prefix, before.length - suffix))
  push('insert', after.slice(prefix, after.length - suffix))
  if (suffix > 0) push('equal', before.slice(before.length - suffix))
  return parts
}

export function isProposalConflictCode(code: LinguistIpcErrorCode): boolean {
  return (
    code === 'STALE_PROPOSAL' ||
    code === 'REVISION_CONFLICT' ||
    code === 'INVALID_STATE_TRANSITION'
  )
}

interface ProposalContextRevision {
  segment: {
    id: string
    ordinal: number
    revision: number
    locked: boolean
  }
  pendingProposal?: { id: string; baseRevision: number }
}

export type ProposalReviewExclusionReason =
  | 'no-pending-proposal'
  | 'archived'
  | 'locked'
  | 'stale'

export interface ProposalReviewExclusion {
  segmentId: string
  originalOrdinal: number
  reason: ProposalReviewExclusionReason
}

export interface ProposalMutationPlan {
  items: Array<{ proposalId: string; expectedRevision: number }>
  excluded: ProposalReviewExclusion[]
}

export function proposalReviewBlock(
  segment: { revision: number; locked: boolean },
  proposal: { baseRevision: number },
  archived: boolean,
  operation: 'accept' | 'reject',
): 'archived' | 'locked' | 'stale' | undefined {
  if (archived) return 'archived'
  if (operation === 'reject') return undefined
  if (segment.locked) return 'locked'
  if (segment.revision !== proposal.baseRevision) return 'stale'
  return undefined
}

/** 批量 mutation 只提交当前真正可审项，并使用当前 Segment revision 做 CAS。 */
export function proposalMutationPlan(
  contexts: readonly ProposalContextRevision[],
  archived = false,
  operation: 'accept' | 'reject' = 'accept',
): ProposalMutationPlan {
  const plan: ProposalMutationPlan = { items: [], excluded: [] }
  for (const { segment, pendingProposal } of contexts) {
    if (pendingProposal === undefined) {
      plan.excluded.push({
        segmentId: segment.id,
        originalOrdinal: segment.ordinal + 1,
        reason: 'no-pending-proposal',
      })
      continue
    }

    const reason = proposalReviewBlock(segment, pendingProposal, archived, operation)
    if (reason !== undefined) {
      plan.excluded.push({
        segmentId: segment.id,
        originalOrdinal: segment.ordinal + 1,
        reason,
      })
      continue
    }

    plan.items.push({
      proposalId: pendingProposal.id,
      expectedRevision: segment.revision,
    })
  }
  return plan
}

/** @deprecated 仅兼容旧调用方；需要解释排除项时使用 proposalMutationPlan。 */
export function proposalMutationItems(
  contexts: readonly ProposalContextRevision[],
  archived = false,
  operation: 'accept' | 'reject' = 'accept',
): Array<{ proposalId: string; expectedRevision: number }> {
  return proposalMutationPlan(contexts, archived, operation).items
}

const EXCLUSION_LABELS: Record<ProposalReviewExclusionReason, string> = {
  'no-pending-proposal': '没有 pending 提案',
  archived: '项目已归档',
  locked: '片段已锁定',
  stale: '提案基于旧 revision',
}

export function bulkProposalReviewConfirmation(
  operation: 'accept' | 'reject',
  selectedCount: number,
  actionableCount: number,
  excluded: readonly ProposalReviewExclusion[],
): string {
  const actionLabel = operation === 'accept' ? '接受' : '拒绝'
  const summary = `已选择 ${selectedCount} 个句段，实际${actionLabel} ${actionableCount} 条建议。`
  const exclusionSummary = excluded.length === 0
    ? ''
    : `\n\n以下 ${excluded.length} 项不会执行：\n${excluded
      .map((item) =>
        `- 原始行 ${item.originalOrdinal}（${item.segmentId}）：${EXCLUSION_LABELS[item.reason]}`,
      )
      .join('\n')}`
  return `${summary}${exclusionSummary}\n\n确定继续吗？`
}

// ===== 独立评审会话（PB-082；提案行「独立评审」按钮）=====

/** 评审会话标题：`评审 <proposalId 前 8 位>`（短 id 原样保留）。 */
export function buildReviewSessionTitle(proposalId: string): string {
  return `评审 ${proposalId.slice(0, 8)}`
}

/**
 * 发往新评审会话的首条消息：指明提案与段，要求用 cat_submit_critic_review
 * 提交 Finding。评审守则（project-reviewer Skill）由主进程按角色注入，
 * 消息本身不再重复纪律条款。
 */
export function buildReviewRequestMessage(proposalId: string, segmentId: string): string {
  return (
    `请独立评审提案 ${proposalId}（段 ${segmentId}）：读取候选与段上下文，`
    + '用 cat_submit_critic_review 提交 Finding。新会话只清空对话历史，项目证据与历史产物仍保留；'
    + '本次评审不会更新、替换或接受任何 Proposal，结束时只报告审计 Finding。'
  )
}

export function buildIndependentAuditRequestMessage(): string {
  return (
    '请执行一次项目独立盲审。系统已隐藏 pending Proposal、既有 QA Finding 与旧审计结论；'
    + '请只依据当前原文/译文、TM、术语、句式、Style Guide、Voice 和 Context 资料独立判断。'
    + '逐项引用 segmentId 与 originalOrdinal，最后明确已审范围、未审范围、发现与未发现问题的范围。'
    + '只报告审计结论，不要声称已更新提案、已修复、已通过 QA 或已交付。'
  )
}

export interface ProposalRunGroup {
  runId: string
  createdAt: string
  modelId?: string
  sessionId?: string
  items: LinguistProposalDiff[]
  statusCounts: Partial<Record<LinguistProposalStatus, number>>
}

/** 项目级 Inbox 按可信 run provenance 聚合；旧数据明确标成 legacy。 */
export function groupProposalRuns(
  diffs: readonly LinguistProposalDiff[],
): ProposalRunGroup[] {
  const groups = new Map<string, ProposalRunGroup>()
  for (const diff of diffs) {
    const proposal = diff.proposal
    const runId = proposal.runId ?? 'legacy（无 run ID）'
    const existing = groups.get(runId)
    if (existing === undefined) {
      groups.set(runId, {
        runId,
        createdAt: proposal.createdAt,
        ...(proposal.modelId !== undefined ? { modelId: proposal.modelId } : {}),
        ...(proposal.sessionId !== undefined ? { sessionId: proposal.sessionId } : {}),
        items: [diff],
        statusCounts: { [proposal.status]: 1 },
      })
      continue
    }
    existing.items.push(diff)
    existing.statusCounts[proposal.status] = (existing.statusCounts[proposal.status] ?? 0) + 1
    if (proposal.createdAt > existing.createdAt) existing.createdAt = proposal.createdAt
  }
  return [...groups.values()].sort((left, right) =>
    right.createdAt.localeCompare(left.createdAt) || right.runId.localeCompare(left.runId))
}

export const PROPOSAL_STATUS_LABELS: Record<LinguistProposalStatus, string> = {
  pending: '待审核',
  accepted: '已接受',
  rejected: '已拒绝',
  superseded: '已取代',
  expired: '已过期',
}
