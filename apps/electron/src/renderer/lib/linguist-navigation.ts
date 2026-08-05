import type { useStore } from 'jotai'
import { activeViewAtom } from '@/atoms/active-view'
import { automationFormAtom } from '@/atoms/automation-atoms'
import { appModeAtom } from '@/atoms/app-mode'
import { currentAgentSessionIdAtom } from '@/atoms/agent-atoms'
import { currentConversationIdAtom } from '@/atoms/chat-atoms'
import {
  activeTabIdAtom,
  getMostRecentLocalizationProjectTab,
  tabMruAtom,
  tabsAtom,
  type LocalizationProjectTab,
} from '@/atoms/tab-atoms'

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
): LocalizationProjectTab | null {
  const projectTab = getMostRecentLocalizationProjectTab(
    store.get(tabsAtom),
    store.get(tabMruAtom),
  )
  enterLinguistNavigation(
    store,
    projectTab?.id ?? null,
    projectTab ? 'conversations' : 'projects',
  )
  return projectTab
}
