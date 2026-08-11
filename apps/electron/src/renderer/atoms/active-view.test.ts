import { describe, expect, test } from 'bun:test'
import { resolveActiveViewForMode } from './active-view'

describe('resolveActiveViewForMode', () => {
  test('given 项目管理页 when 离开 Linguist then Agent/Chat 回到普通主区', () => {
    expect(resolveActiveViewForMode('projects', 'agent')).toBe('conversations')
    expect(resolveActiveViewForMode('projects', 'chat')).toBe('conversations')
    expect(resolveActiveViewForMode('projects', 'linguist')).toBe('projects')
  })

  test('given Agent 专属主区 when 进入 Linguist then planning 改写、agent-skills 保留', () => {
    expect(resolveActiveViewForMode('planning', 'linguist')).toBe('conversations')
    // K3：Linguist 项目「Agent 能力」入口复用唯一 AgentSkillsView，不再改写。
    expect(resolveActiveViewForMode('agent-skills', 'linguist')).toBe('agent-skills')
  })

  test('given 非 Linguist 模式 when 切换模式 then 不改写通用路由', () => {
    expect(resolveActiveViewForMode('conversations', 'agent')).toBe('conversations')
    expect(resolveActiveViewForMode('planning', 'chat')).toBe('planning')
    expect(resolveActiveViewForMode('agent-skills', 'agent')).toBe('agent-skills')
  })
})
