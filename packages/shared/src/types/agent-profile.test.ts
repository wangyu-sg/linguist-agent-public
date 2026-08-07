import { describe, expect, test } from 'bun:test'
import { resolveAgentProfile } from './agent-profile'

describe('resolveAgentProfile', () => {
  test('Given 普通工作区会话 When 解析 Then 返回 general profile', () => {
    expect(resolveAgentProfile({ workspaceId: 'workspace-1' })).toEqual({
      kind: 'general',
      workspaceId: 'workspace-1',
    })
  })

  test('Given 未指定岗位的 Linguist 会话 When 解析 Then 默认 general', () => {
    expect(resolveAgentProfile({ linguistProjectId: 'project-1' })).toEqual({
      kind: 'linguist',
      projectId: 'project-1',
      role: 'general',
    })
  })

  test('Given 已切换岗位的 Linguist 会话 When 解析 Then 使用 metadata 岗位', () => {
    expect(resolveAgentProfile({
      workspaceId: 'must-not-win',
      linguistProjectId: 'project-1',
      linguistRole: 'proofreader',
    })).toEqual({
      kind: 'linguist',
      projectId: 'project-1',
      role: 'proofreader',
    })
  })
})
