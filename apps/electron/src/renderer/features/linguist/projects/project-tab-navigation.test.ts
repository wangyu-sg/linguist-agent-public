import { afterEach, expect, test } from 'bun:test'
import { createStore } from 'jotai'
import type { AgentSessionMeta, LinguistIpcResult, LinguistProjectOpenResult } from '@proma/shared'
import { agentSessionsAtom, currentAgentSessionIdAtom, currentAgentWorkspaceIdAtom, unviewedCompletedSessionIdsAtom } from '@/atoms/agent-atoms'
import { currentConversationIdAtom } from '@/atoms/chat-atoms'
import { appModeAtom } from '@/atoms/app-mode'
import { projectCurrentAgentSessionIdMapAtom } from '@/atoms/project-agent-session-atoms'
import { activeTabAtom, activeTabIdAtom, tabsAtom, type TabItem } from '@/atoms/tab-atoms'
import { openLinguistAgentSession } from '@/features/linguist/projects/open-linguist-session'
import { syncActiveTabSideEffects } from '@/hooks/useSyncActiveTabSideEffects'

const originalWindow = globalThis.window
afterEach(() => { Object.assign(globalThis, { window: originalWindow }) })

const projectSession = (id: string): AgentSessionMeta => ({
  id, title: id, createdAt: 1, updatedAt: 1,
  workspaceId: 'workspace', linguistProjectId: 'project',
}) as AgentSessionMeta

test('原生标签切换和关闭后，先前等待中的项目打开不能抢回界面', async () => {
  for (const target of [
    { id: 'chat-tab', type: 'chat', sessionId: 'chat', title: 'chat' },
    { id: 'agent-tab', type: 'agent', sessionId: 'ordinary', title: 'ordinary' },
    null,
  ] satisfies Array<TabItem | null>) {
    const store = createStore()
    const project = projectSession('project-session')
    store.set(agentSessionsAtom, [project, { id: 'ordinary', title: 'ordinary', createdAt: 1, updatedAt: 1 } as AgentSessionMeta])
    let finishOpen!: (result: LinguistIpcResult<LinguistProjectOpenResult>) => void
    const opening = openLinguistAgentSession(store, project.id, () => new Promise((resolve) => { finishOpen = resolve }))

    store.set(tabsAtom, target ? [target] : [])
    store.set(activeTabIdAtom, target?.id ?? null)
    syncActiveTabSideEffects(store, target)
    finishOpen({ ok: false, error: { code: 'PROJECT_NOT_FOUND', message: '项目缺失' } })
    await opening

    expect(store.get(activeTabAtom)).toEqual(target)
    expect(store.get(currentAgentSessionIdAtom)).toBe(target?.type === 'agent' ? target.sessionId : null)
    expect(store.get(currentConversationIdAtom)).toBe(target?.type === 'chat' ? target.sessionId : null)
  }
})

test('切换项目会话/预览同步恢复偏好，解除绑定使用新元数据恢复普通模式', () => {
  Object.assign(globalThis, { window: { electronAPI: { updateSettings: async () => ({}) } } })
  const store = createStore()
  const a = projectSession('a')
  const b = projectSession('b')
  store.set(agentSessionsAtom, [a, b])
  store.set(projectCurrentAgentSessionIdMapAtom, new Map([['project', a.id]]))
  store.set(unviewedCompletedSessionIdsAtom, new Set([b.id]))
  const preview: TabItem = { id: 'preview', type: 'preview', sessionId: b.id, title: 'preview' }

  syncActiveTabSideEffects(store, preview)
  expect(store.get(appModeAtom)).toBe('linguist')
  expect(store.get(projectCurrentAgentSessionIdMapAtom).get('project')).toBe(b.id)
  expect(store.get(currentAgentSessionIdAtom)).toBe(b.id)
  expect(store.get(currentAgentWorkspaceIdAtom)).toBe('workspace')
  expect(store.get(unviewedCompletedSessionIdsAtom).has(b.id)).toBe(false)

  const detached = { ...b, linguistProjectId: undefined, linguistProjectName: undefined }
  store.set(agentSessionsAtom, [a, detached])
  syncActiveTabSideEffects(store, preview)
  expect(store.get(appModeAtom)).toBe('agent')
  expect(store.get(currentAgentSessionIdAtom)).toBe(b.id)
  expect(store.get(projectCurrentAgentSessionIdMapAtom).get('project')).toBe(a.id)
})
