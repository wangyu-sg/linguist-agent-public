/**
 * 项目设置「Agent 能力」区（K3）：Linguist 项目托管 workspace 的
 * Skills / MCP / AGENTS.md / Memory / Files 复用入口。
 *
 * 不复制任何管理系统：Skills/MCP 打开 Proma 现有 AgentSkillsView（含
 * WorkspaceMemoryTab 的 AGENTS.md 行），Memory 打开现有独立记忆窗口，
 * Files 进入项目会话的 Full AgentView 并展开原生 Files 面板；
 * 数据经项目 promWorkspaceId → agentWorkspacesAtom 解析 slug，与
 * 普通 Agent 工作区同一数据源。
 */

import * as React from 'react'
import { useAtomValue, useSetAtom, useStore } from 'jotai'
import { ChevronRight } from 'lucide-react'
import { toast } from 'sonner'
import type { LinguistProjectInfo, WorkspaceCapabilities } from '@proma/shared'
import { agentWorkspacesAtom } from '@/atoms/agent-atoms'
import { activeViewAtom, agentSkillsTabAtom, type AgentSkillsCapabilityTab } from '@/atoms/active-view'
import { useProjectActions } from '@/hooks/useProjectActions'
import { openLinguistProjectFilesPanel } from './open-linguist-session'
import { describeLinguistIpcError } from './project-utils'

/** 从 capabilities 摘要推导各行状态文案（纯函数，bun test 可驱动）。 */
export function describeCapabilities(capabilities: WorkspaceCapabilities): {
  skills: string
  mcp: string
  agentsMd: string
} {
  return {
    skills: `${capabilities.skills.filter((skill) => skill.enabled).length} 已启用`,
    mcp: `${capabilities.mcpServers.filter((server) => server.enabled).length} 已启用`,
    agentsMd: capabilities.memory.agentsMd.size > 0 ? '已配置' : '未配置',
  }
}

export function ProjectAgentCapabilitiesSection({
  project,
  onNavigate,
}: {
  project: LinguistProjectInfo
  /** 跳转能力管理界面前关闭设置 Sheet。 */
  onNavigate?: () => void
}): React.ReactElement {
  const workspaces = useAtomValue(agentWorkspacesAtom)
  const setAgentSkillsTab = useSetAtom(agentSkillsTabAtom)
  const setActiveView = useSetAtom(activeViewAtom)
  const { selectProject } = useProjectActions()
  const [capabilities, setCapabilities] = React.useState<WorkspaceCapabilities | null>(null)

  const workspace = workspaces.find((item) => item.id === project.promaWorkspaceId)
  const workspaceSlug = workspace?.slug

  React.useEffect(() => {
    if (workspaceSlug === undefined) return
    let cancelled = false
    window.electronAPI.getWorkspaceCapabilities(workspaceSlug)
      .then((result) => {
        if (!cancelled) setCapabilities(result)
      })
      .catch(() => {
        if (!cancelled) setCapabilities(null)
      })
    return () => {
      cancelled = true
    }
  }, [workspaceSlug])

  const openSkillsView = (tab: AgentSkillsCapabilityTab): void => {
    if (workspace === undefined) return
    selectProject(workspace.id, { resetView: false })
    setAgentSkillsTab(tab)
    setActiveView('agent-skills')
    onNavigate?.()
  }

  const openMemoryWindow = (): void => {
    if (workspaceSlug === undefined) return
    void window.electronAPI.openWorkspaceMemoryWindow(workspaceSlug)
      .catch(() => toast.error('打开 Memory 窗口失败'))
  }

  const store = useStore()
  /** Files 无独立管理视图：进入项目会话的 Full AgentView 并展开原生 Files 面板。 */
  const openFilesPanel = (): void => {
    onNavigate?.()
    void openLinguistProjectFilesPanel(store, project.id).then((result) => {
      if (!result.ok) {
        toast.error('打开 Files 失败', { description: describeLinguistIpcError(result.error) })
      }
    })
  }

  const summary = capabilities === null ? null : describeCapabilities(capabilities)
  const rows: ReadonlyArray<{
    key: string
    label: string
    value: string | null
    onOpen: () => void
  }> = [
    { key: 'skills', label: 'Skills', value: summary?.skills ?? null, onOpen: () => openSkillsView('skills') },
    { key: 'mcp', label: 'MCP', value: summary?.mcp ?? null, onOpen: () => openSkillsView('mcp') },
    { key: 'agents-md', label: 'AGENTS.md', value: summary?.agentsMd ?? null, onOpen: () => openSkillsView('memory') },
    { key: 'memory', label: 'Memory', value: '查看', onOpen: openMemoryWindow },
    { key: 'files', label: 'Files', value: '查看', onOpen: openFilesPanel },
  ]

  return (
    <section aria-labelledby="project-agent-capabilities-heading" className="mt-3 rounded-xl bg-muted/50 p-4 shadow-sm">
      <h3 id="project-agent-capabilities-heading" className="text-sm font-medium text-foreground">
        Agent 能力
      </h3>
      <p className="mt-1 text-[12px] leading-relaxed text-muted-foreground">
        项目 Agent 使用与普通工作区相同的 Skills、MCP、AGENTS.md、Memory 与 Files；术语、TM、Voice 等结构化语言资产在「语言资产」分类管理。
      </p>
      {workspace === undefined ? (
        <p className="mt-3 text-[12px] text-muted-foreground">
          托管工作区尚未创建；在项目里发起首个 Agent 会话后可用。
        </p>
      ) : (
        <div className="mt-3 divide-y divide-border/60 rounded-lg border border-border/60">
          {rows.map((row) => (
            <button
              key={row.key}
              type="button"
              data-capability={row.key}
              onClick={row.onOpen}
              className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm hover:bg-foreground/[0.04]"
            >
              <span className="text-foreground">{row.label}</span>
              <span className="flex items-center gap-1 text-[12px] text-muted-foreground">
                {row.value ?? '加载中…'}
                <ChevronRight size={13} aria-hidden />
              </span>
            </button>
          ))}
        </div>
      )}
    </section>
  )
}
