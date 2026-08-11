/**
 * QA Findings 面板纯函数助手（ticket PB-096）
 *
 * 本模块刻意不含任何 React / IPC 依赖：五档 severity 标签/徽标色、
 * disposition 与 issueType 展示、筛选维度全部为纯数据/纯函数，bun test
 * 直接驱动（qa-findings-utils.test.ts）。
 *
 * 徽标色一律走 PB-100 token 层状态色（destructive / warning / info /
 * foreground 派生），禁新 raw palette。
 */

import type {
  LinguistQaFindingInfo,
  LinguistQaFindingDisposition,
  LinguistQaFindingSeverity,
  LinguistQaIssueType,
} from '@proma/shared'

export const QA_SEVERITIES: readonly LinguistQaFindingSeverity[] = ['L0', 'L1', 'L2', 'L3', 'L4']

/** 五档严重度中文标签（契约《通用缺陷等级》）。 */
export const QA_SEVERITY_LABELS: Record<LinguistQaFindingSeverity, string> = {
  L0: 'L0 阻断',
  L1: 'L1 严重',
  L2: 'L2 重要',
  L3: 'L3 次要',
  L4: 'L4 建议',
}

/**
 * 五档徽标色（PB-100 token 层状态色）：L0/L1 危险色，L2 警告色，
 * L3 信息色，L4 弱化前景（建议项不计入缺陷率）。
 */
export const QA_SEVERITY_BADGE_CLASSES: Record<LinguistQaFindingSeverity, string> = {
  L0: 'text-destructive',
  L1: 'text-destructive',
  L2: 'text-warning',
  L3: 'text-info',
  L4: 'text-foreground/45',
}

/**
 * 三级展示（K4）：把五档 severity 折叠成用户可行动的三类。
 * 阻止写回 = 结构/placeholder/ICU/required/forbidden 等硬失败（L0/L1）；
 * 需要检查 = 数字/换行/长度/preferred 偏离等 QA 提示（L2/L3）；
 * 普通提示 = 建议项（L4，不计入缺陷率）。
 */
export type QaSeverityTier = 'blocking' | 'check' | 'notice'

export const QA_SEVERITY_TIERS: Record<LinguistQaFindingSeverity, QaSeverityTier> = {
  L0: 'blocking',
  L1: 'blocking',
  L2: 'check',
  L3: 'check',
  L4: 'notice',
}

export const QA_TIER_LABELS: Record<QaSeverityTier, string> = {
  blocking: '阻止写回',
  check: '需要检查',
  notice: '普通提示',
}

export function qaSeverityTier(severity: LinguistQaFindingSeverity): QaSeverityTier {
  return QA_SEVERITY_TIERS[severity]
}

export interface SegmentQaSummary {
  count: number
  highestSeverity: LinguistQaFindingSeverity
}

/**
 * Grid 只持有每个 Segment 的开放 QA 投影，不复制 Finding 正文或项目级总数。
 * QA_SEVERITIES 已按阻断到建议排序，因此较小的索引代表更高严重度。
 */
export function summarizeOpenQaFindingsBySegment(
  findings: readonly LinguistQaFindingInfo[],
): ReadonlyMap<string, SegmentQaSummary> {
  const summaries = new Map<string, SegmentQaSummary>()
  for (const finding of findings) {
    if (finding.status !== 'open') continue
    const current = summaries.get(finding.segmentId)
    if (current === undefined) {
      summaries.set(finding.segmentId, {
        count: 1,
        highestSeverity: finding.severity,
      })
      continue
    }
    summaries.set(finding.segmentId, {
      count: current.count + 1,
      highestSeverity: QA_SEVERITIES.indexOf(finding.severity)
        < QA_SEVERITIES.indexOf(current.highestSeverity)
        ? finding.severity
        : current.highestSeverity,
    })
  }
  return summaries
}

export const QA_DISPOSITIONS: readonly LinguistQaFindingDisposition[] = [
  'defect',
  'needs_review',
  'query',
  'info',
]

/** 处置四值中文标签。 */
export const QA_DISPOSITION_LABELS: Record<LinguistQaFindingDisposition, string> = {
  defect: '缺陷',
  needs_review: '待确认',
  query: '待提问',
  info: '提示',
}

/** issueType 29 枚举原样展示（机制枚举值即自描述）；此处仅做运行时守卫。 */
export function isQaIssueType(value: unknown): value is LinguistQaIssueType {
  return typeof value === 'string' && value.length > 0
}
