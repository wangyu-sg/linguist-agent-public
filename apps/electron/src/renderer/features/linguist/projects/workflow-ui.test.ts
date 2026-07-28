import { describe, expect, test } from 'bun:test'
import {
  nextStageItemLabel,
  stageActionLabel,
  stageBulkConfirmationSummary,
  stageCompletionLabel,
  stageFilterOptions,
  stageProgressLabel,
  stageProgressSummary,
} from './workflow-ui'

describe('阶段感知中文状态', () => {
  test('同一 untouched 译文在 E/P 项目中分别显示待审校和待校对', () => {
    expect(stageProgressLabel('editing', 'untouched', true)).toBe('待审校')
    expect(stageProgressLabel('proofreading', 'untouched', true)).toBe('待校对')
  })

  test('确认动作与结果按 T/E/P 使用一致文案', () => {
    expect(stageActionLabel('translation')).toBe('确认翻译')
    expect(stageActionLabel('editing')).toBe('确认审校')
    expect(stageActionLabel('proofreading')).toBe('确认校对')
    expect(stageCompletionLabel('translation')).toBe('已确认')
    expect(stageCompletionLabel('editing')).toBe('已审校')
    expect(stageCompletionLabel('proofreading')).toBe('已校对')
    expect(stageProgressLabel('editing', 'confirmed', true)).toBe('已审校')
  })

  test('批量阶段确认部分失败时明确说明当前 T/E/P 已完成的动作', () => {
    expect(stageBulkConfirmationSummary('translation', 2, 1)).toBe('已确认 2 段，1 段失败')
    expect(stageBulkConfirmationSummary('editing', 2, 1)).toBe('已审校 2 段，1 段失败')
    expect(stageBulkConfirmationSummary('proofreading', 2, 1)).toBe('已校对 2 段，1 段失败')
  })

  test('筛选、项目进度和下一个入口共用当前阶段词汇', () => {
    expect(stageFilterOptions('translation')).toEqual([
      { value: 'untouched', label: '未翻译 / 待确认' },
      { value: 'draft', label: '翻译草稿' },
      { value: 'confirmed', label: '已确认' },
    ])
    expect(stageFilterOptions('editing')).toEqual([
      { value: 'untouched', label: '待审校' },
      { value: 'draft', label: '审校草稿' },
      { value: 'confirmed', label: '已审校' },
    ])
    expect(stageProgressSummary('editing', { untouched: 7, draft: 2, confirmed: 11 })).toBe(
      '已审校 11 / 20',
    )
    expect(nextStageItemLabel('editing')).toBe('下一个待审校')
    expect(nextStageItemLabel('proofreading')).toBe('下一个待校对')
  })
})
