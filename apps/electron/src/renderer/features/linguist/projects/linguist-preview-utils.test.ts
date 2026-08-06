/**
 * linguist-preview-utils 纯函数回归（bun test）。
 *
 * 批次语义预览的「本页标签 / 占位符告警」与 TargetEditor 的「必须保留」
 * 判定同源（splitProtectedText）：multiset 比对，重复 token 逐一配对。
 */

import { describe, expect, test } from 'bun:test'
import type { LinguistCurrentStageState, LinguistSegmentStatus } from '@proma/shared'
import {
  CURRENT_STAGE_STATE_LABELS,
  SEGMENT_STATUS_LABELS,
  findMissingProtectedTokens,
  formatCountBreakdown,
  formatPageRange,
} from './linguist-preview-utils'

describe('linguist-preview-utils 标签 / 占位符告警', () => {
  test('given 源文不含标签或占位符 when 检查 then 不告警', () => {
    const warnings = findMissingProtectedTokens([
      { id: 'seg-1', ordinal: 0, source: '普通文本', target: '' },
    ])
    expect(warnings).toEqual([])
  })

  test('given 译文完整保留全部 token when 检查 then 不告警', () => {
    const warnings = findMissingProtectedTokens([
      { id: 'seg-1', ordinal: 0, source: '点击 <b>确定</b> 继续 {name}', target: 'Click <b>OK</b> to continue {name}' },
    ])
    expect(warnings).toEqual([])
  })

  test('given 译文缺失 token when 检查 then 按段列出缺失 token', () => {
    const warnings = findMissingProtectedTokens([
      { id: 'seg-1', ordinal: 4, source: '点击 <b>确定</b>', target: 'Click OK' },
      { id: 'seg-2', ordinal: 7, source: '你好 {name}', target: '' },
    ])
    expect(warnings).toHaveLength(2)
    expect(warnings[0]).toEqual({ segmentId: 'seg-1', ordinal: 4, missingTokens: ['<b>', '</b>'] })
    expect(warnings[1]).toEqual({ segmentId: 'seg-2', ordinal: 7, missingTokens: ['{name}'] })
  })

  test('given 重复 token when 检查 then 按 multiset 逐一配对', () => {
    const warnings = findMissingProtectedTokens([
      { id: 'seg-1', ordinal: 0, source: '{n} 个文件，共 {n} 页', target: '{n} files' },
    ])
    expect(warnings).toHaveLength(1)
    expect(warnings[0]?.missingTokens).toEqual(['{n}'])
  })
})

describe('linguist-preview-utils 统计与分页文案', () => {
  test('given 计数表 when 格式化 then 只列非零项；全零返回 null', () => {
    expect(
      formatCountBreakdown(SEGMENT_STATUS_LABELS, { untranslated: 3, draft: 0, translated: 2, reviewed: 0 }),
    ).toBe('未翻译 3 · 已翻译 2')
    expect(
      formatCountBreakdown(SEGMENT_STATUS_LABELS, { untranslated: 0, draft: 0, translated: 0, reviewed: 0 }),
    ).toBeNull()
  })

  test('given 状态枚举 when 取标签 then 契约全键都有中文标签', () => {
    const statuses: LinguistSegmentStatus[] = ['untranslated', 'draft', 'translated', 'reviewed']
    for (const status of statuses) expect(SEGMENT_STATUS_LABELS[status].length).toBeGreaterThan(0)
    const stages: LinguistCurrentStageState[] = ['untouched', 'draft', 'confirmed']
    for (const stage of stages) expect(CURRENT_STAGE_STATE_LABELS[stage].length).toBeGreaterThan(0)
  })

  test('given 分页位置 when 格式化 then 输出当前页范围与总数', () => {
    expect(formatPageRange(0, 50, 1234)).toBe('第 1–50 / 1234 段')
    expect(formatPageRange(50, 50, 1234)).toBe('第 51–100 / 1234 段')
    expect(formatPageRange(1200, 50, 1234)).toBe('第 1201–1234 / 1234 段')
    expect(formatPageRange(0, 50, 0)).toBe('0 段')
  })
})
