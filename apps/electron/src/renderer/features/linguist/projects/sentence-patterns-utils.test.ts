/**
 * sentence-patterns-utils 纯函数测试（ticket PB-095）
 *
 * bun 安全：不触 React / DOM / IPC，只驱动纯函数。
 * 覆盖：状态守卫、状态机流转矩阵、状态筛选。
 */

import { describe, expect, test } from 'bun:test'
import type { LinguistSentencePatternInfo, LinguistSentencePatternStatus } from '@proma/shared'
import {
  canTransitionSentencePattern,
  filterSentencePatternsByStatus,
  isSentencePatternStatus,
  SENTENCE_PATTERN_STATUS_LABELS,
  SENTENCE_PATTERN_STATUSES,
  SENTENCE_PATTERN_TRANSITIONS,
} from './sentence-patterns-utils'

function pattern(status: LinguistSentencePatternStatus, id: string): LinguistSentencePatternInfo {
  return {
    id,
    source: 'src',
    status,
    createdAt: '2026-07-01T08:00:00.000Z',
    updatedAt: '2026-07-01T08:00:00.000Z',
  }
}

describe('isSentencePatternStatus', () => {
  test('三态通过，其余拒绝', () => {
    for (const status of SENTENCE_PATTERN_STATUSES) expect(isSentencePatternStatus(status)).toBe(true)
    for (const value of [undefined, null, '', 'bogus', 42, {}]) expect(isSentencePatternStatus(value)).toBe(false)
  })
})

describe('句式状态机', () => {
  test('pending 可确认/驳回；confirmed 与 rejected 可互转或打回 pending', () => {
    expect(canTransitionSentencePattern('pending', 'confirmed')).toBe(true)
    expect(canTransitionSentencePattern('pending', 'rejected')).toBe(true)
    expect(canTransitionSentencePattern('confirmed', 'rejected')).toBe(true)
    expect(canTransitionSentencePattern('rejected', 'confirmed')).toBe(true)
    expect(canTransitionSentencePattern('confirmed', 'pending')).toBe(true)
    expect(canTransitionSentencePattern('rejected', 'pending')).toBe(true)
  })

  test('自转恒不允许；转移表与三态一一对应', () => {
    for (const status of SENTENCE_PATTERN_STATUSES) {
      expect(canTransitionSentencePattern(status, status)).toBe(false)
      expect(SENTENCE_PATTERN_TRANSITIONS[status].length).toBeGreaterThan(0)
    }
    expect(Object.keys(SENTENCE_PATTERN_TRANSITIONS).sort()).toEqual([...SENTENCE_PATTERN_STATUSES].sort())
  })

  test('每个状态都有中文标签', () => {
    for (const status of SENTENCE_PATTERN_STATUSES) {
      expect(SENTENCE_PATTERN_STATUS_LABELS[status].length).toBeGreaterThan(0)
    }
  })
})

describe('filterSentencePatternsByStatus', () => {
  test("'all' 返回拷贝；指定状态只留匹配行且不改动入参", () => {
    const patterns = [pattern('pending', 'spn-0000000000000001'), pattern('confirmed', 'spn-0000000000000002'), pattern('rejected', 'spn-0000000000000003')]
    const all = filterSentencePatternsByStatus(patterns, 'all')
    expect(all.length).toBe(3)
    expect(all).not.toBe(patterns)
    expect(filterSentencePatternsByStatus(patterns, 'confirmed').map((item) => item.id)).toEqual(['spn-0000000000000002'])
    expect(patterns.length).toBe(3)
  })
})
