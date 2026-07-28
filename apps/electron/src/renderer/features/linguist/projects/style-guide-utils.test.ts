/**
 * style-guide-utils 纯函数测试（ticket PB-095）
 *
 * bun 安全：不触 React / DOM / IPC，只驱动纯函数。
 * 覆盖：groupKey 分组（未分组置后、首次出现序）、规则文本预校验。
 */

import { describe, expect, test } from 'bun:test'
import type { LinguistStyleGuideRuleInfo } from '@proma/shared'
import {
  groupStyleGuideRules,
  STYLE_GUIDE_UNGROUPED,
  validateStyleGuideRuleText,
} from './style-guide-utils'

function rule(overrides: Partial<LinguistStyleGuideRuleInfo>): LinguistStyleGuideRuleInfo {
  return {
    id: 'sgr-0000000000000000',
    ruleText: '规则',
    updatedAt: '2026-07-01T08:00:00.000Z',
    ...overrides,
  }
}

describe('groupStyleGuideRules', () => {
  test('按 groupKey 分组并保持首次出现顺序', () => {
    const rules = [
      rule({ id: 'sgr-0000000000000001', groupKey: '用词', ruleText: 'A' }),
      rule({ id: 'sgr-0000000000000002', groupKey: '标点', ruleText: 'B' }),
      rule({ id: 'sgr-0000000000000003', groupKey: '用词', ruleText: 'C' }),
    ]
    const groups = groupStyleGuideRules(rules)
    expect(groups.map((group) => group.groupKey)).toEqual(['用词', '标点'])
    expect(groups[0]!.rules.map((item) => item.ruleText)).toEqual(['A', 'C'])
    expect(groups[1]!.rules.map((item) => item.ruleText)).toEqual(['B'])
  })

  test('无 groupKey（含纯空白）的规则归未分组并置最后', () => {
    const rules = [
      rule({ id: 'sgr-0000000000000001', ruleText: 'U1' }),
      rule({ id: 'sgr-0000000000000002', groupKey: '标点', ruleText: 'G' }),
      rule({ id: 'sgr-0000000000000003', groupKey: '  ', ruleText: 'U2' }),
    ]
    const groups = groupStyleGuideRules(rules)
    expect(groups.map((group) => group.groupKey)).toEqual(['标点', STYLE_GUIDE_UNGROUPED])
    expect(groups[1]!.rules.map((item) => item.ruleText)).toEqual(['U1', 'U2'])
  })

  test('空列表与全未分组', () => {
    expect(groupStyleGuideRules([])).toEqual([])
    const groups = groupStyleGuideRules([rule({ ruleText: 'X' })])
    expect(groups).toEqual([{ groupKey: STYLE_GUIDE_UNGROUPED, rules: [rule({ ruleText: 'X' })] }])
  })
})

describe('validateStyleGuideRuleText（镜像 IPC）', () => {
  test('空串 / 纯空白被拒绝', () => {
    expect(validateStyleGuideRuleText('')).not.toBeNull()
    expect(validateStyleGuideRuleText('   ')).not.toBeNull()
  })

  test('超过 4000 字符被拒绝', () => {
    expect(validateStyleGuideRuleText('x'.repeat(4001))).not.toBeNull()
    expect(validateStyleGuideRuleText('x'.repeat(4000))).toBeNull()
  })

  test('正常规则通过', () => {
    expect(validateStyleGuideRuleText('中文对话不使用半角逗号')).toBeNull()
  })
})
