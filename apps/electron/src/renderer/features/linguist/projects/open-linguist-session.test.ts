import { describe, expect, test } from 'bun:test'
import { createStore } from 'jotai/vanilla'
import type { AgentSessionMeta, LinguistProjectInfo } from '@proma/shared'
import { agentSessionsAtom } from '@/atoms/agent-atoms'
import { appModeAtom } from '@/atoms/app-mode'
import { projectCurrentAgentSessionIdMapAtom } from '@/atoms/project-agent-session-atoms'
import { tabsAtom } from '@/atoms/tab-atoms'
import { linguistWorkbenchUiStateAtomFamily } from './cat-workspace-atoms'
import { openLinguistAgentSession } from './open-linguist-session'

const PROJECT_ID = 'prj-0000000000000001'

function session(overrides: Partial<AgentSessionMeta> = {}): AgentSessionMeta {
  return {
    id: 'session-a',
    title: '会话 A',
    agentRuntime: 'pi',
    linguistProjectId: PROJECT_ID,
    linguistProjectName: '项目 A',
    createdAt: 1,
    updatedAt: 2,
    ...overrides,
  }
}

function project(overrides: Partial<LinguistProjectInfo> = {}): LinguistProjectInfo {
  return {
    schemaVersion: 1,
    id: PROJECT_ID,
    name: '项目 A',
    sourceLocale: 'en',
    targetLocale: 'zh-CN',
    promaWorkspaceId: 'workspace-a',
    createdAt: '2026-07-30T00:00:00.000Z',
    updatedAt: '2026-07-30T00:00:00.000Z',
    ...overrides,
  }
}

describe('打开 Linguist 项目会话', () => {
  test('active 项目会话进入项目 Tab 的 Full Agent', async () => {
    const store = createStore()
    store.set(agentSessionsAtom, [session()])
    const result = await openLinguistAgentSession(store, 'session-a', async () => ({
      ok: true,
      data: {
        project: project(),
        health: {
          kind: 'quick',
          projectId: PROJECT_ID,
          healthy: true,
          checkedAt: '2026-07-30T00:00:00.000Z',
          checks: [],
        },
      },
    }))

    expect(result).toEqual({
      ok: true,
      data: { projectId: PROJECT_ID, readOnlyHistory: false },
    })
    expect(store.get(appModeAtom)).toBe('linguist')
    expect(store.get(projectCurrentAgentSessionIdMapAtom).get(PROJECT_ID)).toBe('session-a')
    expect(store.get(linguistWorkbenchUiStateAtomFamily(PROJECT_ID)).agentPresentation).toBe('full')
  })

  test('项目缺失时保留同一 AgentView 的只读历史入口', async () => {
    const store = createStore()
    store.set(agentSessionsAtom, [session({ archived: true })])
    const result = await openLinguistAgentSession(store, 'session-a', async () => ({
      ok: false,
      error: { code: 'PROJECT_NOT_FOUND', message: 'missing' },
    }))

    expect(result).toEqual({
      ok: true,
      data: { projectId: PROJECT_ID, readOnlyHistory: true },
    })
    expect(store.get(tabsAtom).at(-1)).toMatchObject({
      type: 'linguist-project',
      projectId: PROJECT_ID,
      repairState: 'missing',
      historySessionId: 'session-a',
    })
  })
})
