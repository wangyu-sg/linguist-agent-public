/** 标签激活统一同步原生会话状态与项目选择，并取消较早的异步导航。 */

import { useCallback } from 'react'
import { useStore } from 'jotai'
import { appModeAtom } from '@/atoms/app-mode'
import { currentConversationIdAtom } from '@/atoms/chat-atoms'
import {
  agentSessionsAtom,
  currentAgentSessionIdAtom,
  currentAgentWorkspaceIdAtom,
  unviewedCompletedSessionIdsAtom,
} from '@/atoms/agent-atoms'
import { projectCurrentAgentSessionIdMapAtom } from '@/atoms/project-agent-session-atoms'
import type { TabItem } from '@/atoms/tab-atoms'
import { beginProjectNavigationAtom } from '@/host/project-switch'
import { getAgentSessionLinguistProjectId } from '@/lib/agent-session-list'

type JotaiStore = ReturnType<typeof useStore>
export type SyncActiveTabSideEffects = (newActiveTab: TabItem | null) => void

/** 也供会话解除项目绑定后使用；总是读取本次更新后的会话元数据。 */
export function syncActiveTabSideEffects(store: JotaiStore, newActiveTab: TabItem | null): void {
  store.set(beginProjectNavigationAtom)
  if (!newActiveTab) {
    store.set(currentConversationIdAtom, null)
    store.set(currentAgentSessionIdAtom, null)
    return
  }

  if (newActiveTab.type === 'chat') {
    store.set(appModeAtom, 'chat')
    store.set(currentConversationIdAtom, newActiveTab.sessionId)
    store.set(currentAgentSessionIdAtom, null)
    return
  }

  const sessions = store.get(agentSessionsAtom)
  const session = sessions.find((item) => item.id === newActiveTab.sessionId)
  const projectId = session ? getAgentSessionLinguistProjectId(session, sessions) : undefined
  store.set(appModeAtom, projectId ? 'linguist' : 'agent')
  store.set(currentAgentSessionIdAtom, newActiveTab.sessionId)
  store.set(currentConversationIdAtom, null)
  if (projectId) {
    store.set(projectCurrentAgentSessionIdMapAtom, (previous) => new Map(previous).set(projectId, newActiveTab.sessionId))
  }

  // 查看只清除未读角标；任务完成仍由用户确认。
  store.set(unviewedCompletedSessionIdsAtom, (previous) => {
    if (!previous.has(newActiveTab.sessionId)) return previous
    const next = new Set(previous)
    next.delete(newActiveTab.sessionId)
    return next
  })
  if (session?.workspaceId) {
    store.set(currentAgentWorkspaceIdAtom, session.workspaceId)
    window.electronAPI.updateSettings({ agentWorkspaceId: session.workspaceId }).catch(console.error)
  }
}

export function useSyncActiveTabSideEffects(): SyncActiveTabSideEffects {
  const store = useStore()
  return useCallback((newActiveTab) => syncActiveTabSideEffects(store, newActiveTab), [store])
}
