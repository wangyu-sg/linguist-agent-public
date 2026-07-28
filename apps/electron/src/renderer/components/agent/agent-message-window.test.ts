import { describe, expect, test } from 'bun:test'
import {
  AGENT_MESSAGE_WINDOW_SIZE,
  createInitialAgentMessageWindow,
  createTargetAgentMessageWindow,
  expandAgentMessageWindow,
  syncAgentMessageWindow,
} from './agent-message-window'

describe('Agent 长线程消息窗口', () => {
  test('首载只挂载最近一页，顶部补载保持尾部，跳转只挂载目标附近', () => {
    const initial = createInitialAgentMessageWindow(2_000)
    expect(initial).toEqual({
      start: 2_000 - AGENT_MESSAGE_WINDOW_SIZE,
      end: 2_000,
      total: 2_000,
    })

    expect(expandAgentMessageWindow(initial, 'older')).toEqual({
      start: 2_000 - AGENT_MESSAGE_WINDOW_SIZE * 2,
      end: 2_000,
      total: 2_000,
    })

    const target = createTargetAgentMessageWindow(999, 2_000)
    expect(target.end - target.start).toBe(AGENT_MESSAGE_WINDOW_SIZE)
    expect(target.start).toBeLessThanOrEqual(999)
    expect(target.end).toBeGreaterThan(999)

    expect(syncAgentMessageWindow(initial, 2_002)).toEqual({
      start: initial.start,
      end: 2_002,
      total: 2_002,
    })

    expect(syncAgentMessageWindow(createInitialAgentMessageWindow(0), 2_000)).toEqual(initial)
  })
})
