import { describe, expect, test } from 'bun:test'
import { resolveActiveViewForMode } from './active-view'

describe('resolveActiveViewForMode', () => {
  test('given 项目管理页 when 离开 Linguist then Agent/Chat 回到普通主区', () => {
    expect(resolveActiveViewForMode('projects', 'agent')).toBe('conversations')
    expect(resolveActiveViewForMode('projects', 'chat')).toBe('conversations')
    expect(resolveActiveViewForMode('projects', 'linguist')).toBe('projects')
  })

  test('given Agent 专属主区 when 进入 Linguist then 回到普通主区', () => {
    expect(resolveActiveViewForMode('planning', 'linguist')).toBe('conversations')
    expect(resolveActiveViewForMode('agent-skills', 'linguist')).toBe('conversations')
  })

  test('given 非 Linguist 模式 when 切换模式 then 不改写通用路由', () => {
    expect(resolveActiveViewForMode('conversations', 'agent')).toBe('conversations')
    expect(resolveActiveViewForMode('planning', 'chat')).toBe('planning')
    expect(resolveActiveViewForMode('agent-skills', 'agent')).toBe('agent-skills')
  })
})
