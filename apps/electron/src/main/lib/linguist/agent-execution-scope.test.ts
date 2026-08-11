import { describe, expect, test } from 'bun:test'
import { resolveAgentExecutionScope } from './agent-execution-scope'

const deps = {
  homeDir: () => '/home/user',
  getWorkspace: (id: string) => id === 'workspace-1'
    ? { id, name: 'General', slug: 'general', createdAt: 0, updatedAt: 0 }
    : undefined,
  ensureWorkspaceSession: (slug: string, sessionId: string) => `/workspaces/${slug}/${sessionId}`,
  ensureLinguistSession: (projectId: string, sessionId: string) => `/linguist/${projectId}/${sessionId}`,
}

describe('resolveAgentExecutionScope', () => {
  test('Given Linguist 会话同时绑定 workspace When 解析 Then 保留 CAT cwd 与 workspace 能力上下文', () => {
    expect(resolveAgentExecutionScope({
      id: 'session-1',
      title: 'Session',
      workspaceId: 'workspace-1',
      linguistProjectId: 'project-1',
      createdAt: 0,
      updatedAt: 0,
    }, deps)).toEqual({
      kind: 'linguist-project',
      projectId: 'project-1',
      linguistRole: 'general',
      sessionId: 'session-1',
      workspaceId: 'workspace-1',
      workspaceSlug: 'general',
      workspaceName: 'General',
      cwd: '/linguist/project-1/session-1',
    })
  })

  test('Given 普通工作区会话 When 解析 Then 使用原生 session cwd', () => {
    expect(resolveAgentExecutionScope({
      id: 'session-1',
      title: 'Session',
      workspaceId: 'workspace-1',
      createdAt: 0,
      updatedAt: 0,
    }, deps)).toEqual({
      kind: 'agent-workspace',
      workspaceId: 'workspace-1',
      workspaceSlug: 'general',
      workspaceName: 'General',
      cwd: '/workspaces/general/session-1',
    })
  })

  test('Given 无有效绑定 When 解析 Then 明确回落 home', () => {
    expect(resolveAgentExecutionScope({
      id: 'session-1',
      title: 'Session',
      workspaceId: 'missing',
      createdAt: 0,
      updatedAt: 0,
    }, deps)).toEqual({ kind: 'home', cwd: '/home/user' })
  })
})
