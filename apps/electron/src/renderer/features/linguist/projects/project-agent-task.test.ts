import { describe, expect, test } from 'bun:test'
import { createStore } from 'jotai/vanilla'
import type { AgentSessionMeta } from '@proma/shared'
import { agentPendingPromptAtom, agentSessionsAtom } from '@/atoms/agent-atoms'
import { linguistWorkbenchUiStateAtomFamily } from './cat-workspace-atoms'
import { sendProjectAgentTask } from './project-agent-task'

const PROJECT_ID = 'prj-0000000000000001'

function session(overrides: Partial<AgentSessionMeta> = {}): AgentSessionMeta {
  return {
    id: 'session-a',
    title: '会话 A',
    linguistProjectId: PROJECT_ID,
    linguistProjectName: '项目 A',
    createdAt: 1,
    updatedAt: 2,
    ...overrides,
  }
}

describe('发送项目 Agent 自然语言任务', () => {
  test('已有会话：写入 pending prompt 并附带当前 scope 快照', async () => {
    const store = createStore()
    store.set(agentSessionsAtom, [session()])
    const uiAtom = linguistWorkbenchUiStateAtomFamily(PROJECT_ID)
    store.set(uiAtom, { activeProjectAgentSessionId: 'session-a', agentPresentation: 'rail' })

    const result = await sendProjectAgentTask(store, PROJECT_ID, '请整理本批术语')

    expect(result).toEqual({ status: 'sent', sessionId: 'session-a' })
    const pending = store.get(agentPendingPromptAtom)
    expect(pending?.sessionId).toBe('session-a')
    expect(pending?.message).toBe('请整理本批术语')
    expect(pending?.linguistContext?.projectId).toBe(PROJECT_ID)
    // rail 已可见时不改变呈现方式
    expect(store.get(uiAtom).agentPresentation).toBe('rail')
  })

  test('无会话：懒创建后发送；rail 关闭时自动展开', async () => {
    const store = createStore()
    let createCalls = 0
    const result = await sendProjectAgentTask(store, PROJECT_ID, '请识别未知 Tag', async () => {
      createCalls += 1
      return { ok: true, data: session() }
    })

    expect(createCalls).toBe(1)
    expect(result).toEqual({ status: 'sent', sessionId: 'session-a' })
    expect(store.get(agentPendingPromptAtom)?.sessionId).toBe('session-a')
    expect(store.get(linguistWorkbenchUiStateAtomFamily(PROJECT_ID)).agentPresentation).toBe('rail')
  })

  test('会话创建失败：不写入 pending prompt', async () => {
    const store = createStore()
    const result = await sendProjectAgentTask(store, PROJECT_ID, '任务', async () => ({
      ok: false,
      error: { code: 'PROJECT_ARCHIVED' as const, message: 'archived' },
    }))

    expect(result).toEqual({
      status: 'error',
      error: { code: 'PROJECT_ARCHIVED', message: 'archived' },
    })
    expect(store.get(agentPendingPromptAtom)).toBeNull()
    expect(store.get(linguistWorkbenchUiStateAtomFamily(PROJECT_ID)).agentPresentation).toBe('closed')
  })
})
