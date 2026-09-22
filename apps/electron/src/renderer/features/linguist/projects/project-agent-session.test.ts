import { expect, test } from 'bun:test'
import { createStore } from 'jotai'
import type { AgentSessionMeta } from '@proma/shared'
import { activeTabAtom, activeTabIdAtom, tabsAtom } from '@/atoms/tab-atoms'
import { agentSessionsAtom, currentAgentSessionIdAtom, currentAgentWorkspaceIdAtom } from '@/atoms/agent-atoms'
import { appModeAtom } from '@/atoms/app-mode'
import { createActiveLinguistProjectSession } from './project-agent-session'

test('新建入口沿用当前项目并打开新会话，无活跃项目时不创建', async () => {
  const store = createStore()
  const current = {
    id: 'current', title: '当前', createdAt: 1, updatedAt: 1,
    workspaceId: 'workspace-a', linguistProjectId: 'project-a',
  } as AgentSessionMeta
  const created = { ...current, id: 'created', title: '新会话', createdAt: 2, updatedAt: 2 }
  store.set(agentSessionsAtom, [current])
  store.set(tabsAtom, [{ id: 'active', type: 'agent', sessionId: current.id, title: current.title }])
  store.set(activeTabIdAtom, 'active')
  const result = await createActiveLinguistProjectSession(store, async (input) => {
    expect(input).toEqual({ projectId: 'project-a', role: 'general' })
    return { ok: true, data: created }
  })
  expect(result.ok).toBe(true)
  expect(store.get(activeTabAtom)).toMatchObject({ type: 'agent', sessionId: created.id })
  expect(store.get(currentAgentSessionIdAtom)).toBe(created.id)
  expect(store.get(currentAgentWorkspaceIdAtom)).toBe('workspace-a')
  expect(store.get(appModeAtom)).toBe('linguist')
  expect(store.get(agentSessionsAtom)).toHaveLength(2)

  store.set(activeTabIdAtom, null)
  const before = store.get(agentSessionsAtom)
  const absent = await createActiveLinguistProjectSession(store, async () => {
    throw new Error('无活跃项目不应请求创建')
  })
  expect(absent).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } })
  expect(store.get(agentSessionsAtom)).toBe(before)
})
