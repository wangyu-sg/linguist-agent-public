import { describe, expect, test } from 'bun:test'
import {
  buildModelSwitchDividers,
  buildWorkedDividerLabel,
  countTurnSteps,
  formatWorkedDuration,
} from './turn-divider-utils'

describe('formatWorkedDuration', () => {
  test('不足 1 秒显示毫秒', () => {
    expect(formatWorkedDuration(0)).toBe('0ms')
    expect(formatWorkedDuration(999)).toBe('999ms')
  })

  test('不足 1 分钟显示秒（一位小数）', () => {
    expect(formatWorkedDuration(1000)).toBe('1.0s')
    expect(formatWorkedDuration(12345)).toBe('12.3s')
    expect(formatWorkedDuration(59999)).toBe('60.0s') // 59.999s < 60s → 走秒分支，四舍五入为 60.0s
  })

  test('超过 1 分钟显示分 + 秒', () => {
    expect(formatWorkedDuration(60000)).toBe('1m 0s')
    expect(formatWorkedDuration(92500)).toBe('1m 33s')
  })
})

describe('countTurnSteps', () => {
  test('只统计 tool_use 块', () => {
    const blocks = [
      { type: 'thinking' },
      { type: 'tool_use' },
      { type: 'text' },
      { type: 'tool_use' },
      { type: 'tool_use' },
    ]
    expect(countTurnSteps(blocks)).toBe(3)
  })

  test('空数组 / 无工具时为 0', () => {
    expect(countTurnSteps([])).toBe(0)
    expect(countTurnSteps([{ type: 'text' }])).toBe(0)
  })
})

describe('buildWorkedDividerLabel', () => {
  test('durationMs 缺失时不显示 divider', () => {
    expect(buildWorkedDividerLabel(undefined, 5)).toBeNull()
  })

  test('有工具调用时拼接 steps 段', () => {
    expect(buildWorkedDividerLabel(12300, 5)).toBe('Worked for 12.3s · 5 steps')
    expect(buildWorkedDividerLabel(65000, 1)).toBe('Worked for 1m 5s · 1 steps')
  })

  test('steps 为 0 时省略 steps 段', () => {
    expect(buildWorkedDividerLabel(2300, 0)).toBe('Worked for 2.3s')
  })
})

describe('buildModelSwitchDividers', () => {
  test('首个 assistant turn 不产生 divider', () => {
    const groups = [{ type: 'assistant-turn', model: 'a' }]
    expect(buildModelSwitchDividers(groups).size).toBe(0)
  })

  test('相邻 turn 模型相同时不产生 divider', () => {
    const groups = [
      { type: 'assistant-turn', model: 'a' },
      { type: 'user' },
      { type: 'assistant-turn', model: 'a' },
    ]
    expect(buildModelSwitchDividers(groups).size).toBe(0)
  })

  test('模型变化时在后一个 turn 下标处产生条目', () => {
    const groups = [
      { type: 'assistant-turn', model: 'claude-a' },
      { type: 'user' },
      { type: 'assistant-turn', model: 'gpt-b' },
    ]
    const result = buildModelSwitchDividers(groups)
    expect(result.size).toBe(1)
    expect(result.get(2)).toEqual({ prevModel: 'claude-a', nextModel: 'gpt-b' })
  })

  test('user / system 分组不参与比较也不重置上下文', () => {
    const groups = [
      { type: 'assistant-turn', model: 'a' },
      { type: 'system' },
      { type: 'user' },
      { type: 'assistant-turn', model: 'b' },
    ]
    const result = buildModelSwitchDividers(groups)
    expect(result.get(3)).toEqual({ prevModel: 'a', nextModel: 'b' })
  })

  test('model 缺失的 turn 不覆盖上一模型上下文', () => {
    const groups = [
      { type: 'assistant-turn', model: 'a' },
      { type: 'assistant-turn' },
      { type: 'assistant-turn', model: 'b' },
    ]
    const result = buildModelSwitchDividers(groups)
    expect(result.size).toBe(1)
    expect(result.get(2)).toEqual({ prevModel: 'a', nextModel: 'b' })
  })

  test('多次切换产生多个条目', () => {
    const groups = [
      { type: 'assistant-turn', model: 'a' },
      { type: 'assistant-turn', model: 'b' },
      { type: 'assistant-turn', model: 'a' },
    ]
    const result = buildModelSwitchDividers(groups)
    expect(result.size).toBe(2)
    expect(result.get(1)).toEqual({ prevModel: 'a', nextModel: 'b' })
    expect(result.get(2)).toEqual({ prevModel: 'b', nextModel: 'a' })
  })
})
