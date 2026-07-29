import { describe, expect, test } from 'bun:test'
import { resolveAgentProfile } from './agent-profile'

describe('resolveAgentProfile', () => {
  test('Given 普通工作区会话 When 解析 Then 返回 general profile', () => {
    expect(resolveAgentProfile({ workspaceId: 'workspace-1' })).toEqual({
      kind: 'general',
      workspaceId: 'workspace-1',
    })
  })

  test('Given 历史 Linguist 会话 When 解析 Then 使用兼容的 assistant/balanced 默认值', () => {
    expect(resolveAgentProfile({ linguistProjectId: 'project-1' })).toEqual({
      kind: 'linguist',
      projectId: 'project-1',
      role: 'assistant',
      strategy: 'balanced',
    })
  })

  test('Given 带冻结角色和策略的 Linguist 会话 When 解析 Then 身份不依赖当前 UI', () => {
    expect(resolveAgentProfile({
      workspaceId: 'must-not-win',
      linguistProjectId: 'project-1',
      linguistSessionRole: 'reviewer',
      linguistStrategy: 'best',
    })).toEqual({
      kind: 'linguist',
      projectId: 'project-1',
      role: 'reviewer',
      strategy: 'best',
    })
  })
})
