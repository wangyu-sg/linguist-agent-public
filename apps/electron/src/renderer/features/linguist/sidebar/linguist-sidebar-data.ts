import type { AgentSessionMeta, AgentWorkspace, LinguistProjectInfo } from '@proma/shared'
import { getAgentSessionLinguistProjectId, getAgentSessionLinguistProjectName } from '@/lib/agent-session-list'

export interface LinguistSidebarGroup {
  /** 仅供原生列表呈现；id 是领域项目 ID，不作为 workspace mutation 参数。 */
  workspace: AgentWorkspace
  project?: LinguistProjectInfo
  sessions: AgentSessionMeta[]
  historyOnly: boolean
}

/** 领域只提供分组与身份；滚动、归档切换、展开和会话行均由原生侧栏管理。 */
export function buildLinguistSidebarGroups(projects: readonly LinguistProjectInfo[], sessions: readonly AgentSessionMeta[], archived: boolean): LinguistSidebarGroup[] {
  const byId = new Map(projects.map(project => [project.id, project]))
  const groups = new Map<string, LinguistSidebarGroup>()
  for (const project of projects) {
    if (!archived && project.archivedAt !== undefined) continue
    groups.set(project.id, {
      workspace: { id: project.id, slug: project.id, name: project.name, createdAt: Date.parse(project.createdAt), updatedAt: Date.parse(project.updatedAt) },
      project, sessions: [], historyOnly: project.archivedAt !== undefined,
    })
  }
  for (const session of sessions) {
    const projectId = getAgentSessionLinguistProjectId(session, sessions)
    if (!projectId || session.isDraft) continue
    const project = byId.get(projectId)
    const historyOnly = !project || project.archivedAt !== undefined
    if (archived ? !historyOnly && !session.archived : historyOnly || session.archived || session.pinned || (!!session.sourceAutomationId && !session.automationGraduated)) continue
    let group = groups.get(projectId)
    if (!group) {
      group = { workspace: { id: projectId, slug: projectId, name: `${getAgentSessionLinguistProjectName(session, sessions) ?? projectId}（项目不可用）`, createdAt: 0, updatedAt: 0 }, sessions: [], historyOnly: true }
      groups.set(projectId, group)
    }
    group.sessions.push(session)
  }
  return [...groups.values()].filter(group => !archived || group.historyOnly || group.sessions.length > 0)
}
