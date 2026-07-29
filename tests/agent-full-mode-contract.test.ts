import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = join(import.meta.dir, '..')

function source(path: string): string {
  return readFileSync(join(ROOT, path), 'utf8')
}

const agentView = source('apps/electron/src/renderer/components/agent/AgentView.tsx')
const agentMessages = source('apps/electron/src/renderer/components/agent/AgentMessages.tsx')
const agentHeader = source('apps/electron/src/renderer/components/agent/AgentHeader.tsx')
const askUserBanner = source('apps/electron/src/renderer/components/agent/AskUserBanner.tsx')
const stickyUserMessage = source(
  'apps/electron/src/renderer/components/ai-elements/sticky-user-message.tsx',
)
const chatView = source('apps/electron/src/renderer/components/chat/ChatView.tsx')
const tabContent = source('apps/electron/src/renderer/components/tabs/TabContent.tsx')
const mainArea = source('apps/electron/src/renderer/components/tabs/MainArea.tsx')
const leftSidebar = source('apps/electron/src/renderer/components/app-shell/LeftSidebar.tsx')
const agentSessionActionsMenu = source(
  'apps/electron/src/renderer/components/session-tree/AgentSessionActionsMenu.tsx',
)
const agentSessionTreeItem = source(
  'apps/electron/src/renderer/components/session-tree/AgentSessionTreeItem.tsx',
)
const linguistSidebarContent = source(
  'apps/electron/src/renderer/features/linguist/sidebar/LinguistSidebarContent.tsx',
)
const projectAgentRail = source(
  'apps/electron/src/renderer/features/linguist/projects/ProjectAgentRail.tsx',
)
const localizationWorkbench = source(
  'apps/electron/src/renderer/features/linguist/projects/LocalizationProjectWorkbench.tsx',
)
const linguistBindingBadge = source(
  'apps/electron/src/renderer/features/linguist/session-binding/LinguistSessionBindingBadge.tsx',
)

describe('Agent Full 模式行为契约', () => {
  test('Given Agent Tab, When rendering content, Then it keeps the native AgentView route and stable Full root', () => {
    expect(tabContent).toMatch(/<AgentView\s+[^>]*sessionId=\{tab\.sessionId\}[^>]*\/>/)
    expect(agentView).toContain("presentation = 'full'")
    expect(agentView).toContain('data-agent-presentation={presentation}')
    expect(agentView).toContain('<AgentSessionProvider sessionId={sessionId}>')
    expect(agentView).toContain('<AgentHeader sessionId={sessionId} compact={compact} />')
    expect(agentView).toContain('<AgentMessages')
    expect(agentView).toContain('<RichTextInput')
    expect(agentView).toContain('<InputToolbarOverflow')
    expect(agentView).toContain('items={inputToolbarItems}')
    expect(agentView).toContain('trailing={inputTrailingNode}')
  })

  test('Given one Agent session, When rendered as a rail, Then only native presentation styles change', () => {
    expect(agentView).toContain("presentation?: 'full' | 'rail'")
    expect(agentView).toContain("const compact = presentation === 'rail'")
    expect(agentView).toContain('compact={compact}')
    expect(agentView).toContain("compact ? 'px-2 pb-2' : 'px-2.5 pb-2.5 md:px-[18px] md:pb-[18px]'")
    expect(agentView).toContain("compact ? 'h-11 px-1.5 gap-2' : undefined")
    expect(agentMessages).toContain("compact ? 'px-3 py-3' : undefined")
    expect(agentHeader).toContain("compact ? 'h-10 px-3' : 'h-[48px] px-4'")
    expect(agentHeader).toContain('{!compact && (')
    expect(agentView.match(/<AgentSessionProvider sessionId=\{sessionId\}>/g)).toHaveLength(1)
    expect(agentView.match(/<AgentMessages/g)).toHaveLength(1)
    expect(agentView.match(/<RichTextInput/g)).toHaveLength(1)
  })

  test('Given an empty project Agent rail, When it renders, Then it keeps Linguist context instead of exposing the global mode switch', () => {
    expect(agentMessages).toContain('<EmptyState compact={compact} />')
    expect(agentMessages).toContain('选择片段或输入任务')
    expect(agentMessages).toContain('return <WelcomeEmptyState />')
  })

  test('Given a narrow project Agent rail, When reviewing a tool card, Then sticky navigation stays useful without covering message controls', () => {
    expect(agentMessages).toContain('const stickyUserMessageHostRef = React.useRef<HTMLDivElement>(null)')
    expect(agentMessages).toContain('<div ref={stickyUserMessageHostRef}')
    expect(agentMessages).toContain('hostRef={stickyUserMessageHostRef}')
    expect(agentMessages).toContain('compact={compact}')
    expect(agentMessages).not.toContain('!compact && allUserMessagesData.length > 0')
    expect(stickyUserMessage).toContain('createPortal(')
    expect(stickyUserMessage).toContain("'pointer-events-none")
    expect(stickyUserMessage).toContain("'pointer-events-auto")
    expect(stickyUserMessage).toContain('className="line-clamp-1')
    expect(stickyUserMessage).not.toContain("'absolute left-0 right-0 top-0")
    expect(stickyUserMessage).not.toContain('hover:bg-accent/50')
  })

  test('Given Linguist mode, When rendering its project navigation, Then full Proma Automations stay in Agent and Chat only', () => {
    expect(leftSidebar.match(/AUTOMATIONS_VISIBLE && mode !== 'linguist'/g)).toHaveLength(2)
  })

  test('Given a Chat Tab, When Linguist Agent rail is available, Then Chat keeps its native route, stream and composer', () => {
    expect(tabContent).toContain("if (tab.type === 'chat')")
    expect(tabContent).toContain('<ChatView conversationId={tab.sessionId} />')
    expect(chatView).toContain('<ConversationProvider conversationId={conversationId}>')
    expect(chatView).toContain('<ChatMessages')
    expect(chatView).toContain('<ChatInput')
    expect(chatView).toContain('onSend={handleSend}')
    expect(chatView).toContain('onStop={handleStop}')
    expect(chatView).toContain('window.electronAPI.sendMessage(input)')
    expect(chatView).toContain('window.electronAPI.stopGeneration(conversationId)')
  })

  test('Given a Linguist project, When its Agent rail opens, Then the Workbench mounts the native AgentView', () => {
    expect(localizationWorkbench).toContain('<ProjectAgentRail')
    expect(projectAgentRail).toContain('<AgentView')
    expect(projectAgentRail).toContain('presentation={presentation}')
    expect(projectAgentRail).toContain('contextSummary={contextSummary}')
    expect(projectAgentRail).not.toContain('LinguistComposer')
    expect(projectAgentRail).not.toContain('LinguistAgentMessages')
  })

  test('Given a project Agent rail, When switching to Full and back, Then it reuses the same session and Project Tab seams', () => {
    expect(projectAgentRail).not.toContain('useOpenSession')
    expect(projectAgentRail).not.toContain("openSession('agent'")
    expect(projectAgentRail).toContain("setUiState({ agentPresentation: 'full' })")
    expect(projectAgentRail).toContain("setUiState({ agentPresentation: 'rail' })")
    expect(projectAgentRail).toContain('presentation={presentation}')
    expect(projectAgentRail).toContain('返回本地化工作台')
    expect(projectAgentRail).toContain("event.key !== 'Escape'")
    expect(projectAgentRail).toContain('aria-keyshortcuts="Escape"')
    expect(projectAgentRail).toContain('expandButtonRef.current?.focus()')
    expect(linguistBindingBadge).toContain('openLocalizationProject(store, projectId)')
    expect(linguistBindingBadge).toContain('返回 Linguist 项目')
    expect(projectAgentRail.match(/<AgentView/g)).toHaveLength(1)
    expect(agentView.match(/<AgentSessionProvider sessionId=\{sessionId\}>/g)).toHaveLength(1)
  })

  test('Given a compact project Agent rail, When the CAT task needs space, Then Hide and Full controls stay beside its one-row actions', () => {
    expect(projectAgentRail).toContain('aria-label="项目 Agent 快捷动作"')
    expect(projectAgentRail).toContain('aria-label="收起项目 Agent"')
    expect(projectAgentRail).toContain("setUiState({ agentPresentation: 'closed' })")
    expect(projectAgentRail).toContain('aria-label="在 Linguist 中展开项目 Agent"')
    expect(projectAgentRail).toContain('className="h-7 min-w-0 px-2 text-[11px]"')
    expect(projectAgentRail).not.toMatch(/<p className="text-\[11px\] leading-4 text-muted-foreground">/)
  })

  test('Given ordinary Agent and Linguist sessions, When rendering actions, Then they share one menu and Linguist cannot move projects', () => {
    expect(leftSidebar).toContain('<AgentSessionActionsMenu')
    expect(leftSidebar).toContain('<AgentSessionTreeItem')
    expect(leftSidebar).toContain('<LinguistSidebarContent SessionRowComponent={AgentSessionItem} />')
    expect(linguistSidebarContent).toContain('<SessionRowComponent')
    expect(agentSessionTreeItem).toContain("event.key === 'Escape'")
    expect(agentSessionActionsMenu).toContain('visible: hasAction && (canMove || transferLabel !== undefined)')
    expect(linguistSidebarContent).toContain('transferLabel="复制到其他项目"')
    expect(linguistSidebarContent).toContain('onRequestMove={() => onCopySession?.(')
    expect(linguistSidebarContent).not.toContain('迁移到其他项目')
    expect(leftSidebar).toContain("setPendingDeleteTarget({ kind: 'agent-session', id })")
    expect(leftSidebar).toContain("setPendingDeleteTarget({ kind: 'chat-conversation', id })")
  })

  test('Given a running conversation, When messages update, Then tool lifecycle and recovery actions stay on the native renderer', () => {
    expect(agentMessages).toContain('groupIntoTurns(allSDKMessages, sessionModelId)')
    expect(agentMessages).toContain('<MessageGroupRenderer')
    expect(agentMessages).toContain('allMessages={allSDKMessages}')
    expect(agentMessages).toContain('onRetry={shouldDisableActions ? undefined : onRetry}')
    expect(agentMessages).toContain('onRetryInNewSession={shouldDisableActions ? undefined : onRetryInNewSession}')
    expect(agentMessages).toContain('onFork={shouldDisableActions ? undefined : onFork}')
    expect(agentMessages).toContain('onRewind={shouldDisableActions ? undefined : onRewind}')
    expect(agentMessages).toContain('onCompact={shouldDisableActions ? undefined : onCompact}')
  })

  test('Given pending approval, When rendering the turn tail, Then all native banners remain inline and only modal questions replace the composer', () => {
    expect(agentView).toContain('<PermissionBanner sessionId={sessionId} />')
    expect(agentView).toContain('<AskUserBanner sessionId={sessionId} />')
    expect(agentView).toContain('<ExitPlanModeBanner sessionId={sessionId} />')
    expect(agentView).toContain('inlineBanner={hasBlockingRequests ? (')
    expect(agentMessages).toContain('{inlineBanner && (')
    expect(agentView).toContain('const hasBannerOverlay =')
    expect(agentView).toContain('(allAskUserRequests.get(sessionId)?.length ?? 0) > 0')
    expect(agentView).toContain('(allExitPlanRequests.get(sessionId)?.length ?? 0) > 0')
    expect(agentView).toContain('const hasBlockingRequests = hasBannerOverlay || (allPermissionRequests.get(sessionId)?.length ?? 0) > 0')
    expect(agentView).toContain('{!hasBannerOverlay && (')
  })

  test('Given AskUser in full Agent, When the banner renders, Then it does not leak Linguist branding', () => {
    expect(askUserBanner).toContain('Agent 需要你的输入')
    expect(askUserBanner).not.toContain('Linguist Agent 需要你的输入')
  })

  test('Given the same native AgentView in rail and full mode, When configuring a turn, Then model, thinking and permission controls remain available', () => {
    expect(agentView).toContain('<ModelSelector')
    expect(agentView).toContain('externalSelectedModel={externalSelectedModel}')
    expect(agentView).toContain('onModelSelect={handleModelSelect}')
    expect(agentView).toContain('<AgentThinkingPopover')
    expect(agentView).toContain('onThinkingLevelChange: (level) => { void updateOpenAIThinkingLevel(level) }')
    expect(agentView).toContain('<PermissionModeSelector sessionId={sessionId} />')
  })

  test('Given a busy Agent, When the user sends again, Then the existing queue/steer path and queue controls remain available', () => {
    expect(agentView).toContain('await window.electronAPI.queueAgentMessage({')
    expect(agentView).toContain('interrupt: interruptCurrentTurn')
    expect(agentView).toContain('queueMessageIntoActiveAgent(message, payload.rawText, payload.sdkText, payload.mentions, streaming)')
    expect(agentView).toContain('<AgentMessageQueue')
    expect(agentView).toContain('onSendNow={handleSendQueuedNow}')
    expect(agentView).toContain('onRecall={handleRecallQueuedMessage}')
    expect(agentView).toContain('onRemove={handleRemoveQueuedMessage}')
    expect(agentView).toContain('onMove={handleMoveQueuedMessage}')
  })

  test('Given an Agent session, When title or right-side preview changes, Then Tab/session sync and session-scoped preview remain intact', () => {
    expect(agentHeader).toContain('window.electronAPI.updateAgentSessionTitle(session.id, trimmed)')
    expect(agentHeader).toContain('updateTabTitle(prev, updated.id, updated.title)')
    expect(agentHeader).toContain('replaceAgentSessionInFreshnessOrder(prev, updated)')
    expect(mainArea).toContain("activeTab?.type === 'agent' && (previewOpenMap.get(activeTab.sessionId) ?? false)")
    expect(mainArea).toContain("const previewSessionId = activeTab?.type === 'agent' ? activeTab.sessionId : null")
    expect(mainArea).toContain('<PreviewPanel sessionId={previewSessionId} />')
  })
})
