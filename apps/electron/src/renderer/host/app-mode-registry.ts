// LA-HOST-SEAM: app-mode-registry
/**
 * App 主模式注册表：模式顺序、回退标签、主区视图驻留、会话/项目恢复策略、
 * 键盘导航与 Agent Rail 可见性策略的唯一真源。
 *
 * ModeSwitcher / AppShell / useSwitchAppMode / WelcomeEmptyState 只消费本模块,
 * 不再写散落的 `mode === 'linguist'` 字面分支;新模式只改注册表。
 */

import type { ActiveView } from '@/atoms/active-view'
import type { AppMode } from '@/atoms/app-mode'
import { getAgentSessionLinguistProjectId } from '@/lib/agent-session-list'

export interface AppModeDefinition {
  mode: AppMode
  /** extension 未提供贡献标签/图标时的回退标签。 */
  fallbackLabel: string
  /** 该模式允许驻留的主区视图;其余视图回落到 fallbackView。 */
  allowedViews: readonly ActiveView[]
  fallbackView: ActiveView
  /** 切换到该模式时恢复上次同模式会话(Agent/Chat)。 */
  restoresSession: boolean
  /** 切换到该模式时恢复上次本地化项目标签(Linguist)。 */
  restoresProjectTab: boolean
  /** 该模式主区是否允许挂载 Agent Rail(右侧文件/改动面板)。 */
  allowsAgentRail: boolean
}

export const APP_MODE_DEFINITIONS: readonly AppModeDefinition[] = [
  {
    mode: 'agent',
    fallbackLabel: 'Agent',
    allowedViews: ['conversations', 'planning', 'agent-skills', 'vault'],
    fallbackView: 'conversations',
    restoresSession: true,
    restoresProjectTab: false,
    allowsAgentRail: true,
  },
  {
    mode: 'chat',
    fallbackLabel: 'Chat',
    allowedViews: ['conversations', 'planning', 'agent-skills', 'vault'],
    fallbackView: 'conversations',
    restoresSession: true,
    restoresProjectTab: false,
    allowsAgentRail: false,
  },
  {
    mode: 'linguist',
    fallbackLabel: 'Linguist',
    allowedViews: ['conversations', 'agent-skills', 'projects'],
    fallbackView: 'conversations',
    restoresSession: false,
    restoresProjectTab: true,
    allowsAgentRail: true,
  },
]

export function getAppModeDefinition(mode: AppMode): AppModeDefinition {
  const definition = APP_MODE_DEFINITIONS.find((item) => item.mode === mode)
  if (!definition) throw new Error(`未注册的 AppMode: ${mode}`)
  return definition
}

/** 主区视图驻留:不允许的视图回落到模式默认视图。 */
export function resolveActiveViewForMode(activeView: ActiveView, appMode: AppMode): ActiveView {
  const definition = getAppModeDefinition(appMode)
  return definition.allowedViews.includes(activeView) ? activeView : definition.fallbackView
}

// ===== 模式导航 =====

export type ModeNavigationKey = 'ArrowLeft' | 'ArrowRight' | 'Home' | 'End'

/** 键盘方向键在注册表顺序上循环,Home/End 跳到边界。 */
export function resolveModeNavigation(mode: AppMode, key: ModeNavigationKey): AppMode {
  if (key === 'Home') return APP_MODE_DEFINITIONS[0]!.mode
  if (key === 'End') return APP_MODE_DEFINITIONS.at(-1)!.mode

  const currentIndex = APP_MODE_DEFINITIONS.findIndex((item) => item.mode === mode)
  const direction = key === 'ArrowRight' ? 1 : -1
  const nextIndex = (currentIndex + direction + APP_MODE_DEFINITIONS.length) % APP_MODE_DEFINITIONS.length
  return APP_MODE_DEFINITIONS[nextIndex]!.mode
}

export function getModeSliderTranslateX(mode: AppMode): number {
  return APP_MODE_DEFINITIONS.findIndex((item) => item.mode === mode) * 100
}

// ===== 会话恢复 =====

interface RestorableSession {
  id: string
  title: string
  archived?: boolean
  linguistProjectId?: string
  parentSessionId?: string
  sourceDelegationId?: string
}

/** 项目归属只由模式组合入口裁决。 */
export function resolveSessionAppMode(session: RestorableSession, sessions: readonly RestorableSession[]): 'agent' | 'linguist' {
  return getAgentSessionLinguistProjectId(session, sessions) ? 'linguist' : 'agent'
}

interface RestorableTab {
  id?: string
  type: string
  title: string
  sessionId?: string
}

export function canRestoreSessionForMode(mode: AppMode): mode is 'agent' | 'chat' {
  return getAppModeDefinition(mode).restoresSession
}

/** 按上次会话、已打开标签、最近会话的顺序选择模式落点。 */
export function findSessionToRestore(
  mode: 'agent' | 'chat',
  sessions: readonly RestorableSession[],
  lastId: string | null,
  tabs: readonly RestorableTab[],
  draftSessionIds: ReadonlySet<string>,
): RestorableSession | null {
  // Agent 模式不复用 Linguist 项目绑定会话;Chat 无绑定会话概念,全量候选。
  const eligibleSessions = mode === 'agent'
    ? sessions.filter((session) => !getAgentSessionLinguistProjectId(session, sessions))
    : sessions
  const last = lastId ? eligibleSessions.find((session) => session.id === lastId) : undefined
  if (last) return last

  const eligibleIds = new Set(eligibleSessions.map((session) => session.id))
  const tab = tabs.find((item) => (
    item.type === mode
    && item.sessionId
    && eligibleIds.has(item.sessionId)
  ))
  if (tab?.sessionId) return { id: tab.sessionId, title: tab.title }

  return eligibleSessions.find((session) => !session.archived && !draftSessionIds.has(session.id)) ?? null
}

// ===== Agent Rail(右侧文件/改动面板)可见性策略 =====

export interface AgentRailContext {
  appMode: AppMode
  /** 是否存在当前 Agent 会话(无会话则无 Rail 内容)。 */
  hasAgentSession: boolean
  /** 定时任务表单打开时隐藏右侧文件面板(表单内含自己的右栏配置)。 */
  automationFormOpen: boolean
  activeView: ActiveView
}

/** Agent Rail 可见性:模式允许 + 有会话 + 会话视图上下文中显示。 */
export function resolveRightRailPolicy(context: AgentRailContext): boolean {
  if (!getAppModeDefinition(context.appMode).allowsAgentRail) return false
  if (!context.hasAgentSession) return false
  if (context.automationFormOpen) return false
  // 非会话视图均为全屏管理界面,不挂 Agent Rail。
  return context.activeView === 'conversations'
}

/** 视口放不下左右栏与最小主区时,让右栏暂时让位。 */
export function shouldSuppressAgentRail(
  viewportWidth: number,
  leftSidebarWidth: number,
  rightPanelWidth: number,
  minMainAreaWidth: number,
): boolean {
  return viewportWidth < leftSidebarWidth + rightPanelWidth + minMainAreaWidth
}

/** 极窄视口(如 200% zoom)下左栏折叠为图标栏,先保主区最小可用宽度。 */
export function shouldForceCollapseLeftSidebar(
  viewportWidth: number,
  leftSidebarWidth: number,
  minMainAreaWidth: number,
): boolean {
  return viewportWidth < leftSidebarWidth + minMainAreaWidth
}
