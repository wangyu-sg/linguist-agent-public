/**
 * Active View Atom - 主内容区视图状态
 *
 * 控制 MainArea 显示的内容：
 * - conversations: 对话视图（Chat/Agent 模式内容）
 * - planning: 任务、日程与定时任务统一视图
 * - agent-skills: Agent 技能（Skills/MCP）全屏管理视图
 * - projects: Linguist 侧栏次级入口打开的项目管理首页
 */

import { atom } from 'jotai'
import type { AppMode } from './app-mode'

export type ActiveView = 'conversations' | 'planning' | 'agent-skills' | 'projects'
export type AgentSkillsCapabilityTab = 'skills' | 'mcp' | 'memory'

/** Linguist 承载项目/工作台与只读的 Agent 能力管理视图（Skills/MCP/Memory）。 */
export function resolveActiveViewForMode(activeView: ActiveView, appMode: AppMode): ActiveView {
  if (appMode === 'linguist') {
    return activeView === 'projects' || activeView === 'agent-skills' ? activeView : 'conversations'
  }
  return activeView === 'projects' ? 'conversations' : activeView
}

/** 当前活跃视图（不持久化，每次启动默认显示对话） */
export const activeViewAtom = atom<ActiveView>('conversations')

/** Agent 技能视图当前子页，用于外部入口直达 MCP 管理 */
export const agentSkillsTabAtom = atom<AgentSkillsCapabilityTab>('skills')
