/**
 * TabContent — 标签内容渲染器
 *
 * 根据标签类型渲染参数化的 ChatView 或 AgentView。
 * 直接传递 sessionId/conversationId prop，无需桥接全局 atoms。
 */

import * as React from 'react'
import { useAtomValue } from 'jotai'
import { tabsAtom } from '@/atoms/tab-atoms'
import { ChatView } from '@/components/chat'
import { AgentView } from '@/components/agent'
import { PreviewTabContent } from '@/components/diff/PreviewTabContent'
import { LocalizationProjectWorkbench } from '@/features/linguist/projects/LocalizationProjectWorkbench'
import { agentSidePanelLayoutAtomFamily } from '@/atoms/agent-atoms'
import { TabErrorBoundary } from './TabErrorBoundary'

export interface TabContentProps {
  tabId: string
}

export function TabContent({ tabId }: TabContentProps): React.ReactElement {
  const tabs = useAtomValue(tabsAtom)
  const tab = tabs.find((t) => t.id === tabId)

  // [FLASH-DEBUG] 监控 tab 查找失败（说明 tabId 指向了不存在的标签）
  React.useEffect(() => {
    if (!tab) {
      console.warn(`[FLASH-DEBUG] TabContent: tab not found for tabId="${tabId}"`, { tabIds: tabs.map(t => t.id) })
    }
  }, [tab, tabId, tabs])

  if (!tab) {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
        标签页不存在
      </div>
    )
  }

  if (tab.type === 'chat') {
    return (
      <TabErrorBoundary key={tab.sessionId} sessionId={tab.sessionId}>
        <ChatView conversationId={tab.sessionId} />
      </TabErrorBoundary>
    )
  }

  if (tab.type === 'preview') {
    return (
      <TabErrorBoundary key={tab.id} sessionId={tab.sessionId}>
        <PreviewTabContent sessionId={tab.sessionId} />
      </TabErrorBoundary>
    )
  }

  if (tab.type === 'linguist-project') {
    if (tab.repairState !== 'missing') {
      return <LocalizationProjectWorkbench projectId={tab.projectId} />
    }
    if (tab.historySessionId) {
      return (
        <div data-testid="linguist-missing-project-history" className="flex h-full min-h-0 flex-col">
          <div className="shrink-0 border-b border-destructive/20 bg-destructive/[0.06] px-4 py-2 text-xs text-destructive">
            项目目录不可用；当前仅显示会话历史，发送与 CAT 操作已阻断。
          </div>
          <div className="min-h-0 flex-1">
            <TabErrorBoundary key={tab.historySessionId} sessionId={tab.historySessionId}>
              <AgentView sessionId={tab.historySessionId} />
            </TabErrorBoundary>
          </div>
        </div>
      )
    }
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        项目不可用，请修复或关闭此标签页。
      </div>
    )
  }

  return (
    <AgentTabContent sessionId={tab.sessionId} />
  )
}

function AgentTabContent({ sessionId }: { sessionId: string }): React.ReactElement {
  const layout = useAtomValue(agentSidePanelLayoutAtomFamily(sessionId))
  return (
    <TabErrorBoundary key={sessionId} sessionId={sessionId}>
      <AgentView sessionId={sessionId} embedded={layout.expanded} />
    </TabErrorBoundary>
  )
}
