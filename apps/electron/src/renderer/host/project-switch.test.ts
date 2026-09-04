import { expect, test } from 'bun:test'
import { createStore } from 'jotai'
import type { AgentSessionMeta } from '@proma/shared'
import { selectProjectAtom } from './project-switch'
import { agentSessionsAtom, currentAgentSessionIdAtom, currentAgentWorkspaceIdAtom } from '../atoms/agent-atoms'
import { activeTabAtom } from '../atoms/tab-atoms'
import { appModeAtom } from '../atoms/app-mode'
import { activeViewAtom } from '../atoms/active-view'

const session = (id: string, workspaceId: string, extra: Partial<AgentSessionMeta> = {}): AgentSessionMeta => ({ id, workspaceId, title: id, createdAt: 1, updatedAt: 1, ...extra } as AgentSessionMeta)

test('项目切换：权威刷新、创建、竞态和失败保持一致状态', async () => {
  const store = createStore()
  const a = session('a', 'A')
  let fetched = [a]
  let persisted = 'A'
  let failCreate = false
  let failSave = false
  let creates = 0
  const requests: Array<(sessions: AgentSessionMeta[]) => void> = []
  let defer = false
  Object.assign(globalThis, { window: { electronAPI: {
    listAgentSessions: () => defer ? new Promise<AgentSessionMeta[]>(resolve => requests.push(resolve)) : Promise.resolve(fetched),
    createAgentSession: async (_title: unknown, _channel: unknown, workspaceId: string) => {
      if (failCreate) throw new Error('create failed')
      creates++
      return session(`new-${workspaceId}`, workspaceId)
    },
    updateSettingsSync: ({ agentWorkspaceId }: { agentWorkspaceId: string }) => {
      if (failSave) return false
      persisted = agentWorkspaceId
      return true
    },
  } } })
  store.set(agentSessionsAtom, [a])
  store.set(currentAgentWorkspaceIdAtom, 'A')
  store.set(currentAgentSessionIdAtom, 'a')
  const assertState = (workspace: string, id: string) => {
    expect(store.get(currentAgentWorkspaceIdAtom)).toBe(workspace)
    expect(store.get(currentAgentSessionIdAtom)).toBe(id)
    const tab = store.get(activeTabAtom)
    expect(tab?.type === 'agent' ? tab.sessionId : undefined).toBe(id)
    expect(store.get(appModeAtom)).toBe('agent')
    expect(persisted).toBe(workspace)
  }
  await store.set(selectProjectAtom, { workspaceId: 'B' })
  assertState('B', 'new-B')
  expect(creates).toBe(1)
  fetched = [a, session('old', 'B', { updatedAt: 2 }), session('fresh', 'B', { updatedAt: 3 }),
    ...[{ archived: true }, { isDraft: true }, { sourceAutomationId: 'auto' }, { sourceDelegationId: 'child' }, { linguistProjectId: 'cat' }].map((extra, index) => session(`exclude-${index}`, 'B', { updatedAt: 10, ...extra }))]
  await store.set(selectProjectAtom, { workspaceId: 'B' })
  assertState('B', 'fresh')
  defer = true
  const toA = store.set(selectProjectAtom, { workspaceId: 'A' })
  const toB = store.set(selectProjectAtom, { workspaceId: 'B' })
  const backA = store.set(selectProjectAtom, { workspaceId: 'A' })
  requests[2]!([a]); await backA
  requests[1]!(fetched); await toB
  requests[0]!([a]); await toA
  assertState('A', 'a')
  defer = false; fetched = [a]; failCreate = true
  await expect(store.set(selectProjectAtom, { workspaceId: 'C' })).rejects.toThrow('create failed')
  assertState('A', 'a')
  failCreate = false; failSave = true
  await expect(store.set(selectProjectAtom, { workspaceId: 'C' })).rejects.toThrow()
  assertState('A', 'a')
  failSave = false
  store.set(activeViewAtom, 'agent-skills')
  const before = creates
  await store.set(selectProjectAtom, { workspaceId: 'B', resetView: false })
  expect(store.get(activeViewAtom)).toBe('agent-skills')
  expect(store.get(currentAgentSessionIdAtom)).toBe('a')
  expect(persisted).toBe('B')
  expect(creates).toBe(before)
})
