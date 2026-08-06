/**
 * linguist-preview-utils — 预览 Tab 的纯函数件（无 React / IPC 依赖，bun test 直驱）。
 *
 * 批次语义预览的「标签/占位符告警」只检查当前已加载页：源文的受保护
 * token（复用 TargetEditor 的 splitProtectedText 判定，与编辑器的「必须
 * 保留」规则同源）按 multiset 比对译文，缺失即告警。它是预览提示，
 * 不宣称替代完整 QA。
 */

import type {
  LinguistCurrentStageState,
  LinguistSegmentInfo,
  LinguistSegmentStatus,
} from '@proma/shared'
import { splitProtectedText } from './TargetEditor'

/** 片段状态中文标签（契约四值）。 */
export const SEGMENT_STATUS_LABELS: Record<LinguistSegmentStatus, string> = {
  untranslated: '未翻译',
  draft: '草稿',
  translated: '已翻译',
  reviewed: '已审校',
}

/** 当前 T/E/P 阶段状态中文标签（契约三值）。 */
export const CURRENT_STAGE_STATE_LABELS: Record<LinguistCurrentStageState, string> = {
  untouched: '未处理',
  draft: '草稿',
  confirmed: '已确认',
}

/** 把计数表格式化成「标签 n · 标签 n」；全零时返回 null（调用方隐藏该行）。 */
export function formatCountBreakdown<L extends string>(
  labels: Record<L, string>,
  counts: Record<L, number>,
): string | null {
  const parts = (Object.keys(labels) as L[])
    .filter((key) => counts[key] > 0)
    .map((key) => `${labels[key]} ${counts[key]}`)
  return parts.length > 0 ? parts.join(' · ') : null
}

export interface LinguistPreviewTokenWarning {
  segmentId: string
  ordinal: number
  missingTokens: string[]
}

function protectedTokenValues(text: string): string[] {
  return splitProtectedText(text)
    .filter((part) => part.kind === 'token')
    .map((part) => part.value)
}

/**
 * 检查给定页片段：源文的标签/占位符 token（multiset）是否全部保留在译文
 * 中。源文不含 token 的片段不参与告警；空译文且源文有 token 必然告警。
 */
export function findMissingProtectedTokens(
  segments: readonly Pick<LinguistSegmentInfo, 'id' | 'ordinal' | 'source' | 'target'>[],
): LinguistPreviewTokenWarning[] {
  const warnings: LinguistPreviewTokenWarning[] = []
  for (const segment of segments) {
    const sourceTokens = protectedTokenValues(segment.source)
    if (sourceTokens.length === 0) continue
    const remaining = protectedTokenValues(segment.target)
    const missing: string[] = []
    for (const token of sourceTokens) {
      const index = remaining.indexOf(token)
      if (index === -1) {
        missing.push(token)
      } else {
        remaining.splice(index, 1)
      }
    }
    if (missing.length > 0) {
      warnings.push({ segmentId: segment.id, ordinal: segment.ordinal, missingTokens: missing })
    }
  }
  return warnings
}

/** 分页页码文案：第 1–50 / 1234 段。 */
export function formatPageRange(offset: number, pageSize: number, total: number): string {
  if (total === 0) return '0 段'
  const end = Math.min(offset + pageSize, total)
  return `第 ${offset + 1}–${end} / ${total} 段`
}
