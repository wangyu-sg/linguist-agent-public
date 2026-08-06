import { describe, expect, test } from 'bun:test'
import { resolveAgentProfile, resolveLinguistExecutionPolicy } from './agent-profile'

describe('resolveAgentProfile', () => {
  test('Given 普通工作区会话 When 解析 Then 返回 general profile', () => {
    expect(resolveAgentProfile({ workspaceId: 'workspace-1' })).toEqual({
      kind: 'general',
      workspaceId: 'workspace-1',
    })
  })

  test('Given 历史 Linguist 会话（无任何策略字段）When 解析 Then 使用兼容的 assistant/off 默认值', () => {
    expect(resolveAgentProfile({ linguistProjectId: 'project-1' })).toEqual({
      kind: 'linguist',
      projectId: 'project-1',
      role: 'assistant',
      executionPolicy: { independentReview: 'off' },
    })
  })

  test('Given 带冻结角色和 Execution Policy 的 Linguist 会话 When 解析 Then 身份不依赖当前 UI', () => {
    expect(resolveAgentProfile({
      workspaceId: 'must-not-win',
      linguistProjectId: 'project-1',
      linguistSessionRole: 'reviewer',
      linguistExecutionPolicy: { independentReview: 'risk-based' },
    })).toEqual({
      kind: 'linguist',
      projectId: 'project-1',
      role: 'reviewer',
      executionPolicy: { independentReview: 'risk-based' },
    })
  })

  test('Given 旧质量档会话（legacy linguistStrategy）When 解析 Then best 映射 risk-based、其余映射 off', () => {
    expect(resolveAgentProfile({
      linguistProjectId: 'project-1',
      linguistStrategy: 'best',
    })).toEqual({
      kind: 'linguist',
      projectId: 'project-1',
      role: 'assistant',
      executionPolicy: { independentReview: 'risk-based' },
    })
    for (const legacy of ['fast', 'balanced'] as const) {
      expect(resolveAgentProfile({
        linguistProjectId: 'project-1',
        linguistStrategy: legacy,
      })).toEqual({
        kind: 'linguist',
        projectId: 'project-1',
        role: 'assistant',
        executionPolicy: { independentReview: 'off' },
      })
    }
  })

  test('Given 冻结 policy 与 legacy 档位同时在场 When 解析 Then 冻结 policy 优先', () => {
    expect(resolveLinguistExecutionPolicy({
      linguistExecutionPolicy: { independentReview: 'off' },
      linguistStrategy: 'best',
    })).toEqual({ independentReview: 'off' })
    expect(resolveLinguistExecutionPolicy(undefined)).toEqual({ independentReview: 'off' })
  })
})
