import { describe, expect, test } from 'bun:test'
import {
  nextStageItemLabel,
  segmentStatusBadgeTitle,
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

  test('U-13：同色不同义的徽标 title 同时给出阶段语义与颜色含义', () => {
    // 审计案例：「待确认」以绿色（translated）出现——title 说明这是翻译阶段语义。
    const pendingTranslation = segmentStatusBadgeTitle('translation', 'untouched', 'translated', true)
    expect(pendingTranslation).toContain('翻译阶段 · 待确认')
    expect(pendingTranslation).toContain('已有译文，等待确认翻译')
    expect(pendingTranslation).toContain('徽标颜色对应整体状态：已翻译')

    // 同一文案若出现在审校阶段（reviewed 紫），title 给出不同含义。
    const pendingEditing = segmentStatusBadgeTitle('editing', 'untouched', 'reviewed', true)
    expect(pendingEditing).toContain('审校阶段 · 待审校')
    expect(pendingEditing).toContain('等待审校')
    expect(pendingEditing).toContain('徽标颜色对应整体状态：已审校')
  })

  test('U-13：无译文的未翻译与已完成校对各有准确描述', () => {
    const untranslated = segmentStatusBadgeTitle('translation', 'untouched', 'untranslated', false)
    expect(untranslated).toContain('翻译阶段 · 未翻译')
    expect(untranslated).toContain('尚无译文')
    expect(untranslated).toContain('徽标颜色对应整体状态：未翻译')

    const proofread = segmentStatusBadgeTitle('proofreading', 'confirmed', 'reviewed', true)
    expect(proofread).toContain('校对阶段 · 已校对')
    expect(proofread).toContain('片段完成')
  })
})
