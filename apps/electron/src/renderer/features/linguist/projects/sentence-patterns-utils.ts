/**
 * 句式（Sentence Patterns）纯函数助手（ticket PB-095）
 *
 * 本模块刻意不含任何 React / IPC 依赖：状态机（confirmed/pending/
 * rejected 的人工流转）、状态筛选、标签映射全部为纯函数，bun test
 * 直接驱动（sentence-patterns-utils.test.ts）。
 */

import type { LinguistSentencePatternInfo, LinguistSentencePatternStatus } from '@proma/shared'

export const SENTENCE_PATTERN_STATUSES: readonly LinguistSentencePatternStatus[] = [
  'pending',
  'confirmed',
  'rejected',
]

export const SENTENCE_PATTERN_STATUS_LABELS: Record<LinguistSentencePatternStatus, string> = {
  confirmed: '已确认',
  pending: '待评审',
  rejected: '已驳回',
}

/** 运行时类型守卫（IPC payload 防御）。 */
export function isSentencePatternStatus(value: unknown): value is LinguistSentencePatternStatus {
  return typeof value === 'string' && (SENTENCE_PATTERN_STATUSES as readonly string[]).includes(value)
}

/**
 * 状态机：人工评审流转。pending 可确认/驳回；confirmed 与 rejected
 * 可互转或打回 pending（人工操作无方向限制，但禁止原地自转）。
 */
export const SENTENCE_PATTERN_TRANSITIONS: Record<
  LinguistSentencePatternStatus,
  readonly LinguistSentencePatternStatus[]
> = {
  pending: ['confirmed', 'rejected'],
  confirmed: ['rejected', 'pending'],
  rejected: ['confirmed', 'pending'],
}

/** from → to 是否为允许的人工流转（自转恒不允许）。 */
export function canTransitionSentencePattern(
  from: LinguistSentencePatternStatus,
  to: LinguistSentencePatternStatus,
): boolean {
  return SENTENCE_PATTERN_TRANSITIONS[from].includes(to)
}

/** 状态筛选；'all' 原样返回（不改动入参数组）。 */
export function filterSentencePatternsByStatus(
  patterns: readonly LinguistSentencePatternInfo[],
  status: LinguistSentencePatternStatus | 'all',
): LinguistSentencePatternInfo[] {
  if (status === 'all') return [...patterns]
  return patterns.filter((pattern) => pattern.status === status)
}
