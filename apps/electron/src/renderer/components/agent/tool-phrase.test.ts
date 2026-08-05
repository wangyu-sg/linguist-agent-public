import { describe, expect, test } from 'bun:test'
import { getToolPhrase } from './tool-phrase'
import { getToolDisplayName } from './tool-utils'

describe('Linguist CAT 工具活动文案', () => {
  test('片段、术语、翻译记忆与项目工具不暴露内部函数名', () => {
    expect(getToolPhrase('cat_get_segments', { limit: 20 })).toEqual({
      label: '读取 20 个片段',
      loadingLabel: '正在读取 20 个片段...',
    })
    expect(getToolPhrase('cat_search_terms', { query: 'Break' }).label).toBe('搜索术语 “Break”')
    expect(getToolPhrase('cat_search_tm', { query: 'Break' }).label).toBe('查找翻译记忆')
    expect(getToolPhrase('cat_project_summary', {}).label).toBe('检查项目摘要')
    expect(getToolPhrase('cat_list_assets', {}).label).toBe('查看项目文件')
    expect(getToolPhrase('cat_propose_translations', {
      segmentProposals: [{}, {}],
    }).label).toBe('创建 2 条翻译建议')
    expect(getToolPhrase('cat_run_qa', {}).label).toBe('运行项目质检')
    expect(getToolPhrase('cat_get_qa_findings', {}).label).toBe('查看质检问题')
    expect(getToolPhrase('cat_submit_critic_review', { findings: [{}, {}] }).label).toBe('提交 2 条独立复核意见')
    expect(getToolPhrase('cat_run_batch_consistency', { mode: 'repair' }).label).toBe('创建批量一致性建议')

    for (const name of [
      'cat_get_segments',
      'cat_search_terms',
      'cat_search_tm',
      'cat_project_summary',
      'cat_list_assets',
      'cat_propose_translations',
      'cat_run_qa',
      'cat_get_qa_findings',
      'cat_submit_critic_review',
      'cat_run_batch_consistency',
    ]) {
      expect(getToolDisplayName(name)).not.toContain('cat_')
    }
  })

  test('缺少可选参数时仍给出自然文案', () => {
    expect(getToolPhrase('cat_get_segments', {}).label).toBe('读取项目片段')
    expect(getToolPhrase('cat_search_terms', {}).label).toBe('搜索项目术语')
    expect(getToolPhrase('cat_submit_critic_review', {}).label).toBe('提交独立复核')
    expect(getToolPhrase('cat_run_batch_consistency', {}).label).toBe('检查批量一致性')
  })
})
