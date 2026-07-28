/**
 * StyleGuidePanel 纯函数助手（ticket PB-095）
 *
 * 本模块刻意不含任何 React / IPC 依赖：Style Guide 规则按 groupKey 分组、
 * 表单预校验全部为纯函数，bun test 直接驱动（style-guide-utils.test.ts）。
 * 预校验只提前给中文反馈，主进程仍是唯一权威校验方（计划 §7.4）。
 */

import type { LinguistStyleGuideRuleInfo } from '@proma/shared'

/** 未分组规则的兜底组名（展示层专用，不落库）。 */
export const STYLE_GUIDE_UNGROUPED = '未分组'

export interface StyleGuideGroup {
  /** 分组键；未分组规则归 STYLE_GUIDE_UNGROUPED。 */
  groupKey: string
  rules: LinguistStyleGuideRuleInfo[]
}

/**
 * 按 groupKey 分组：保持首次出现顺序，空/缺省 groupKey 的规则归入
 * 「未分组」并固定排最后（编辑面板的稳定展示序）。
 */
export function groupStyleGuideRules(rules: readonly LinguistStyleGuideRuleInfo[]): StyleGuideGroup[] {
  const groups = new Map<string, LinguistStyleGuideRuleInfo[]>()
  const ungrouped: LinguistStyleGuideRuleInfo[] = []
  for (const rule of rules) {
    const key = rule.groupKey?.trim() ?? ''
    if (key === '') {
      ungrouped.push(rule)
      continue
    }
    const bucket = groups.get(key) ?? []
    bucket.push(rule)
    groups.set(key, bucket)
  }
  const result: StyleGuideGroup[] = [...groups.entries()].map(([groupKey, groupRules]) => ({
    groupKey,
    rules: groupRules,
  }))
  if (ungrouped.length > 0) result.push({ groupKey: STYLE_GUIDE_UNGROUPED, rules: ungrouped })
  return result
}

/** 规则文本预校验（镜像 IPC readStyleGuideRuleInput：非空白 + ≤4000）。 */
export function validateStyleGuideRuleText(ruleText: string): string | null {
  const trimmed = ruleText.trim()
  if (trimmed.length === 0) return '规则内容不能为空'
  if (trimmed.length > 4_000) return '规则内容最长 4000 个字符'
  return null
}
