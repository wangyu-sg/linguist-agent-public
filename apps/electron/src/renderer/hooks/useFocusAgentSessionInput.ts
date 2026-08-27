/**
 * 聚焦已有 Agent Tab，并把输入焦点交给该会话。
 *
 * 仅切换 activeTabId，不重建、关闭或改变预览 Tab / 分屏状态。
 */

import * as React from 'react'
import { useAtomValue, useSetAtom, useStore } from 'jotai'
import { activeTabIdAtom, tabsAtom } from '@/atoms/tab-atoms'
import { useSyncActiveTabSideEffects } from '@/hooks/useSyncActiveTabSideEffects'

type FocusAgentSessionInput = (sessionId: string) => boolean

export function useFocusAgentSessionInput(): FocusAgentSessionInput {
  const store = useStore()
  const tabs = useAtomValue(tabsAtom)
  const setActiveTabId = useSetAtom(activeTabIdAtom)
  const syncActiveTabSideEffects = useSyncActiveTabSideEffects()

  return React.useCallback((sessionId: string): boolean => {
    const agentTab = tabs.find((tab) => tab.type === 'agent' && tab.sessionId === sessionId)
    if (!agentTab) return false

    setActiveTabId(agentTab.id)
    syncActiveTabSideEffects(agentTab)

    // 等待 AgentView 成为当前内容，再复用其既有输入框聚焦事件。
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        if (store.get(activeTabIdAtom) !== agentTab.id) return
        window.dispatchEvent(new CustomEvent('proma:focus-input'))
      })
    })

    return true
  }, [
    setActiveTabId,
    store,
    syncActiveTabSideEffects,
    tabs,
  ])
}
