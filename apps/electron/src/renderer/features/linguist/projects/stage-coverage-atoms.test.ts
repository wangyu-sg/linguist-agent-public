import { describe, expect, test } from 'bun:test'
import type { LinguistStageDecisionCoverage } from '@proma/shared'
import { formatStageCoverage, stageCoverageKey } from './stage-coverage-atoms'

function coverage(partial: Partial<LinguistStageDecisionCoverage>): LinguistStageDecisionCoverage {
  return {
    total: 101,
    confirmed: 0,
    unchanged: 72,
    corrected: 29,
    blocked: 0,
    pending: 0,
    status: 'complete',
    ...partial,
  }
}

describe('formatStageCoverage（K2 验收）', () => {
  test('101 / 101 全部 decision 时显示完成', () => {
    const view = formatStageCoverage('editing', coverage({}))
    expect(view.decided).toBe(101)
    expect(view.total).toBe(101)
    expect(view.complete).toBe(true)
    expect(view.text).toBe('审校 101 / 101 · 未修改 72 · 已修正 29 · 阻塞 0')
  })

  test('100 / 101 不得显示完成', () => {
    const view = formatStageCoverage('editing', coverage({
      corrected: 28,
      pending: 1,
      status: 'in_progress',
    }))
    expect(view.decided).toBe(100)
    expect(view.complete).toBe(false)
    expect(view.text).toContain('审校 100 / 101')
  })

  test('blocked 数量原样来自后端聚合；校对阶段标签正确', () => {
    const view = formatStageCoverage('proofreading', coverage({
      unchanged: 89,
      corrected: 10,
      blocked: 2,
      status: 'completed_with_blocks',
    }))
    expect(view.blocked).toBe(2)
    expect(view.text).toBe('校对 101 / 101 · 未修改 89 · 已修正 10 · 阻塞 2')
  })

  test('K4 翻译阶段只显示确认口径与阻塞，不显示未修改/已修正', () => {
    const view = formatStageCoverage('translation', coverage({
      confirmed: 98,
      unchanged: 0,
      corrected: 0,
      blocked: 3,
      pending: 0,
      status: 'completed_with_blocks',
    }))
    expect(view.decided).toBe(101)
    expect(view.complete).toBe(true)
    expect(view.text).toBe('翻译 101 / 101 · 阻塞 3')

    const inProgress = formatStageCoverage('translation', coverage({
      confirmed: 95,
      unchanged: 0,
      corrected: 0,
      blocked: 3,
      pending: 3,
      status: 'in_progress',
    }))
    expect(inProgress.complete).toBe(false)
    expect(inProgress.text).toBe('翻译 98 / 101 · 阻塞 3')
  })

  test('覆盖统计严格属于当前批次键', () => {
    expect(stageCoverageKey('prj-a', 'asset-1')).toBe('prj-a:asset-1')
    expect(stageCoverageKey('prj-a', 'asset-2')).not.toBe(stageCoverageKey('prj-b', 'asset-2'))
  })
})
