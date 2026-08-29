import type { useStore } from 'jotai'
import { activeViewAtom } from '@/atoms/active-view'
import { automationFormAtom } from '@/atoms/automation-atoms'
import { appModeAtom } from '@/atoms/app-mode'
import {
  agentDiffPanelTabAtom,
  agentSessionsAtom,
  agentSidePanelOpenAtomFamily,
  currentAgentSessionIdAtom,
  currentAgentWorkspaceIdAtom,
} from '@/atoms/agent-atoms'
import { currentConversationIdAtom } from '@/atoms/chat-atoms'
import {
  activeTabIdAtom,
  openTab,
  tabsAtom,
} from '@/atoms/tab-atoms'
import { getAgentSessionLinguistProjectId } from '@/lib/agent-session-list'

type JotaiStore = ReturnType<typeof useStore>

export function enterLinguistNavigation(
  store: JotaiStore,
  activeTabId: string | null,
  activeView: 'conversations' | 'projects',
): void {
  store.set(activeTabIdAtom, activeTabId)
  store.set(appModeAtom, 'linguist')
  store.set(activeViewAtom, activeView)
  store.set(automationFormAtom, { open: false, draft: null })
  store.set(currentConversationIdAtom, null)
  store.set(currentAgentSessionIdAtom, null)
}

export function restoreLastLocalizationProject(
  store: JotaiStore,
): string | null {
  const sessions = store.get(agentSessionsAtom)
  const currentSessionId = store.get(currentAgentSessionIdAtom)
  const current = sessions.find((session) => (
    session.id === currentSessionId
    && getAgentSessionLinguistProjectId(session, sessions) !== undefined
  ))
  const openSession = store.get(tabsAtom)
    .findLast((tab) => {
      if (tab.type !== 'agent') return false
      return sessions.some((session) => session.id === tab.sessionId
        && getAgentSessionLinguistProjectId(session, sessions) !== undefined)
    })
  const session = current
    ?? sessions.find((item) => item.id === (openSession?.type === 'agent' ? openSession.sessionId : undefined))
    ?? sessions.find((item) => getAgentSessionLinguistProjectId(item, sessions) !== undefined)

  if (!session) {
    enterLinguistNavigation(store, null, 'projects')
    return null
  }

  const opened = openTab(store.get(tabsAtom).filter((tab) => tab.type !== 'linguist-project'), {
    type: 'agent',
    sessionId: session.id,
    title: session.title,
  })
  store.set(tabsAtom, opened.tabs)
  enterLinguistNavigation(store, opened.activeTabId, 'conversations')
  store.set(currentAgentSessionIdAtom, session.id)
  if (session.workspaceId) store.set(currentAgentWorkspaceIdAtom, session.workspaceId)
  store.set(agentSidePanelOpenAtomFamily(session.id), true)
  store.set(agentDiffPanelTabAtom, (previous) => new Map(previous).set(session.id, 'linguist'))
  return session.id
}
