/** Agent Rail 可见性策略；AppShell 只负责传入当前上下文。 */

import type { ActiveView } from '@/atoms/active-view'
import type { AppMode } from '@/atoms/app-mode'

export interface AgentRailContext {
  appMode: AppMode
  /** 是否存在当前 Agent 会话（无会话则无 Rail 内容）。 */
  hasAgentSession: boolean
  /** 定时任务表单打开时隐藏右侧文件面板（表单内含自己的右栏配置）。 */
  automationFormOpen: boolean
  activeView: ActiveView
}

/** Agent Rail 可见性：仅 Agent 模式 + 有会话 + 会话视图上下文中显示。 */
export function shouldShowAgentRail(context: AgentRailContext): boolean {
  if (context.appMode !== 'agent') return false
  if (!context.hasAgentSession) return false
  if (context.automationFormOpen) return false
  // 非会话视图均为全屏管理界面，不挂 Agent Rail。
  return context.activeView === 'conversations'
}

/** 视口放不下左右栏与最小主区时，让右栏暂时让位。 */
export function shouldSuppressAgentRail(
  viewportWidth: number,
  leftSidebarWidth: number,
  rightPanelWidth: number,
  minMainAreaWidth: number,
): boolean {
  return viewportWidth < leftSidebarWidth + rightPanelWidth + minMainAreaWidth
}
