import * as React from 'react'
import { useAtomValue, useSetAtom, useStore } from 'jotai'
import { appModeAtom, type AppMode } from '@/atoms/app-mode'
import { agentSessionsAtom, currentAgentSessionIdAtom } from '@/atoms/agent-atoms'
import { conversationsAtom, currentConversationIdAtom } from '@/atoms/chat-atoms'
import { draftSessionIdsAtom } from '@/atoms/draft-session-atoms'
import { tabsAtom } from '@/atoms/tab-atoms'
import {
  canRestoreSessionForMode,
  findSessionToRestore,
  getAppModeDefinition,
} from '@/host/app-mode-registry'
import { restoreLastLocalizationProject } from '@/lib/linguist-navigation'
import { useCreateSession } from './useCreateSession'
import { useOpenSession } from './useOpenSession'

export type SwitchAppMode = (targetMode: AppMode) => void

/** 所有模式入口共用同一套恢复策略，避免左栏与主区状态分裂。 */
export function useSwitchAppMode(): SwitchAppMode {
  const mode = useAtomValue(appModeAtom)
  const setMode = useSetAtom(appModeAtom)
  const conversations = useAtomValue(conversationsAtom)
  const agentSessions = useAtomValue(agentSessionsAtom)
  const currentConversationId = useAtomValue(currentConversationIdAtom)
  const currentAgentSessionId = useAtomValue(currentAgentSessionIdAtom)
  const tabs = useAtomValue(tabsAtom)
  const draftSessionIds = useAtomValue(draftSessionIdsAtom)
  const openSession = useOpenSession()
  const { createChat, createAgent } = useCreateSession()
  const store = useStore()

  return React.useCallback((targetMode: AppMode): void => {
    if (targetMode === mode) return
    if (getAppModeDefinition(targetMode).restoresProjectTab) {
      restoreLastLocalizationProject(store)
      return
    }
    if (!canRestoreSessionForMode(targetMode)) {
      setMode(targetMode)
      return
    }

    const isChat = targetMode === 'chat'
    const session = findSessionToRestore(
      targetMode,
      isChat ? conversations : agentSessions,
      isChat ? currentConversationId : currentAgentSessionId,
      tabs,
      draftSessionIds,
    )
    if (session) {
      openSession(targetMode, session.id, session.title)
      return
    }

    void (isChat ? createChat({ draft: true }) : createAgent({ draft: true }))
  }, [
    agentSessions,
    conversations,
    createAgent,
    createChat,
    currentAgentSessionId,
    currentConversationId,
    draftSessionIds,
    mode,
    openSession,
    setMode,
    store,
    tabs,
  ])
}
