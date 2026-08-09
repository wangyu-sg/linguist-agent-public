/**
 * Target 编辑器 Tag 行为原子化（纯函数，K8）。
 *
 * 单一 span 来源：硬保护来自 @linguist/cat-core 的 scanTags（内置族 +
 * 项目族统一扫描），软提示来自 tagProfile.candidates 中 status='candidate'
 * 的正则。所有下标均为 JS UTF-16 字符串下标，与 textarea selectionStart/
 * selectionEnd 同单位——emoji / surrogate pair 不需要额外换算。
 *
 * 行为语义：
 * - hard span：光标不得停留内部（snap 到最近边界）；方向键跨越整个
 *   span；拖选部分覆盖时扩展为完整 span；Backspace/Delete 不删单字符，
 *   先整体选中，删除是否允许交给既有的源文守恒守卫（required 自然不可删）。
 * - soft span：允许进入与编辑，不 snap、不扩展，仅由既有警告链路提示。
 */

import { compileTagFamilyRegex, scanTags } from '@linguist/cat-core'
import type { LinguistTagProfileInfo } from '@proma/shared'

export interface TargetTagSpan {
  start: number
  end: number
  protection: 'hard' | 'soft'
  /** 硬 span 的族 id（scanTags 提供）；软 span 为 null。 */
  familyId: string | null
  /** paired 族的配对锚；singleton/self 与软 span 为 null。 */
  pairKey: string | null
}

/**
 * 统一列出当前文本的 Tag span（hard + soft），按 start 升序。
 * soft 与 hard 重叠时丢弃 soft（与 splitProtectedText 同一约定）。
 */
export function listTargetTagSpans(
  text: string,
  tagProfile?: LinguistTagProfileInfo,
): TargetTagSpan[] {
  const spans: TargetTagSpan[] = scanTags(text, { profile: tagProfile })
    .map((tag) => ({
      start: tag.start,
      end: tag.end,
      protection: 'hard' as const,
      familyId: tag.familyId,
      pairKey: tag.pairKey,
    }))
  for (const candidate of tagProfile?.candidates ?? []) {
    if (candidate.status !== 'candidate') continue
    const regex = compileTagFamilyRegex(candidate.pattern)
    if (regex === null) continue
    regex.lastIndex = 0
    for (const match of text.matchAll(regex)) {
      const start = match.index ?? 0
      const end = start + match[0].length
      if (match[0].length === 0) continue
      const overlapsHard = spans.some((span) => !(end <= span.start || start >= span.end))
      if (!overlapsHard) {
        spans.push({ start, end, protection: 'soft', familyId: null, pairKey: null })
      }
    }
  }
  spans.sort((left, right) => left.start - right.start || left.end - right.end)
  return spans
}

function hardSpans(spans: readonly TargetTagSpan[]): TargetTagSpan[] {
  return spans.filter((span) => span.protection === 'hard')
}

/**
 * 折叠光标落在 hard span 内部时返回吸附目标（最近边界，等距取前边界）；
 * 不需要调整返回 null。soft span 永远返回 null。
 */
export function snapCaretOutOfHardSpan(
  caret: number,
  spans: readonly TargetTagSpan[],
): number | null {
  for (const span of hardSpans(spans)) {
    if (caret > span.start && caret < span.end) {
      return caret - span.start <= span.end - caret ? span.start : span.end
    }
  }
  return null
}

/**
 * 范围选择部分覆盖 hard span 时，把选区扩展为完整 span（可链式覆盖相邻
 * span，直到稳定）。无需扩展或折叠选区返回 null。
 */
export function extendSelectionOverHardSpans(
  start: number,
  end: number,
  spans: readonly TargetTagSpan[],
): { start: number; end: number } | null {
  if (start >= end) return null
  let nextStart = start
  let nextEnd = end
  let changed = false
  let stable = false
  while (!stable) {
    stable = true
    for (const span of hardSpans(spans)) {
      if (span.start < nextEnd && nextStart < span.end) {
        const grownStart = Math.min(nextStart, span.start)
        const grownEnd = Math.max(nextEnd, span.end)
        if (grownStart !== nextStart || grownEnd !== nextEnd) {
          nextStart = grownStart
          nextEnd = grownEnd
          changed = true
          stable = false
        }
      }
    }
  }
  return changed ? { start: nextStart, end: nextEnd } : null
}

/**
 * 无修饰方向键（折叠光标）跨越 hard span：
 * - 向左：光标处于 span 右边界（或意外处于内部）→ 跳到 span.start；
 * - 向右：光标处于 span 左边界（或内部）→ 跳到 span.end。
 * 不需要跨越返回 null。Shift+方向键走原生 + onSelect 扩展，不经本函数。
 */
export function skipHardSpanForArrow(
  caret: number,
  direction: 'left' | 'right',
  spans: readonly TargetTagSpan[],
): number | null {
  for (const span of hardSpans(spans)) {
    if (direction === 'left' && caret > span.start && caret <= span.end) return span.start
    if (direction === 'right' && caret >= span.start && caret < span.end) return span.end
  }
  return null
}

/**
 * Backspace/Delete 的「整单元删除」目标：
 * - backward：光标位于 span 右边界（原生将删 span 末字符）→ 返回该 span；
 * - forward：光标位于 span 左边界（原生将删 span 首字符）→ 返回该 span；
 * - 光标意外处于 span 内部时同样返回该 span（防御）。
 * 命中后调用方应整体选中 span 而不是删除单字符；未命中返回 null。
 */
export function hardSpanForUnitDeletion(
  caret: number,
  direction: 'backward' | 'forward',
  spans: readonly TargetTagSpan[],
): TargetTagSpan | null {
  for (const span of hardSpans(spans)) {
    if (caret > span.start && caret < span.end) return span
    if (direction === 'backward' && caret === span.end) return span
    if (direction === 'forward' && caret === span.start) return span
  }
  return null
}
