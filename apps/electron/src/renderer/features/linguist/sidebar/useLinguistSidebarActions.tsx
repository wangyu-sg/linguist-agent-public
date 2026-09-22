import * as React from 'react'
import { useAtomValue, useSetAtom, useStore } from 'jotai'
import { toast } from 'sonner'
import type { AgentSessionMeta, LinguistProjectInfo, LinguistRole } from '@proma/shared'
import { agentDiffPanelTabAtom, agentSessionsAtom, agentSidePanelOpenAtomFamily, currentAgentSessionIdAtom } from '@/atoms/agent-atoms'
import { activeTabAtom, activeTabIdAtom, closeTab, tabsAtom } from '@/atoms/tab-atoms'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { replaceAgentSessionInFreshnessOrder } from '@/lib/agent-session-list'
import { linguistProjectListStateAtom, refreshLinguistProjectListAtom } from '../projects/project-list-atoms'
import { describeLinguistIpcError, validateProjectNameInput } from '../projects/project-utils'
import { openLocalizationProject } from '../projects/open-localization-project'
import { openLinguistAgentSession } from '../projects/open-linguist-session'
import { beginProjectNavigationAtom, projectSwitchGenerationAtom } from '@/host/project-switch'
import { createProjectAgentSession, resolveActiveLinguistProjectId } from '../projects/project-agent-session'
import { clearLinguistWorkbenchUiStateAtom, linguistWorkbenchUiStateAtomFamily } from '../projects/cat-workspace-atoms'
import { useProjectArchive } from '../projects/ProjectArchiveAction'
import { CopyLinguistSessionDialog } from './CopyLinguistSessionDialog'
import { useSyncActiveTabSideEffects } from '@/hooks/useSyncActiveTabSideEffects'

export function moveProjectId(
  orderedProjectIds: readonly string[],
  projectId: string,
  offset: -1 | 1,
): string[] {
  const from = orderedProjectIds.indexOf(projectId)
  const to = from + offset
  if (from < 0 || to < 0 || to >= orderedProjectIds.length) {
    return [...orderedProjectIds]
  }
  const next = [...orderedProjectIds]
  const [moved] = next.splice(from, 1)
  next.splice(to, 0, moved!)
  return next
}

/** 只保留领域 mutation 和确认弹窗；列表生命周期由 LeftSidebar 统一拥有。 */
export function useLinguistSidebarActions() {
  const state = useAtomValue(linguistProjectListStateAtom)
  const refresh = useSetAtom(refreshLinguistProjectListAtom)
  const clearWorkbenchUiState = useSetAtom(clearLinguistWorkbenchUiStateAtom)
  const activeTab = useAtomValue(activeTabAtom)
  const sessions = useAtomValue(agentSessionsAtom)
  const setSessions = useSetAtom(agentSessionsAtom)
  const store = useStore()
  const syncActiveTab = useSyncActiveTabSideEffects()
  const [creatingProjectId, setCreatingProjectId] = React.useState<string | null>(null)
  const [pendingDeleteProject, setPendingDeleteProject] = React.useState<LinguistProjectInfo | null>(null)
  const [projectDeleteConfirmation, setProjectDeleteConfirmation] = React.useState('')
  const [deletingProject, setDeletingProject] = React.useState(false)
  const [copySession, setCopySession] = React.useState<AgentSessionMeta | null>(null)
  const activeProjectId = resolveActiveLinguistProjectId(activeTab, sessions)
  const projects = state.status === 'ready' ? state.projects : []

  const closeProjectTab = React.useCallback((projectId: string): void => {
    let next = { tabs: store.get(tabsAtom), activeTabId: store.get(activeTabIdAtom) }
    const ids = new Set(store.get(agentSessionsAtom).filter(session => session.linguistProjectId === projectId).map(session => session.id))
    for (const id of ids) next = closeTab(next.tabs, next.activeTabId, id)
    store.set(tabsAtom, next.tabs)
    store.set(activeTabIdAtom, next.activeTabId)
    syncActiveTab(next.tabs.find(tab => tab.id === next.activeTabId) ?? null)
  }, [store, syncActiveTab])

  const handleOpenProject = React.useCallback((projectId: string): void => {
    void openLocalizationProject(store, projectId)
      .then((result) => {
        if (!result.ok) {
          toast.error('打开项目失败', { description: describeLinguistIpcError(result.error) })
        }
      })
      .catch(() => {
        toast.error('打开项目失败', { description: '与主进程通信异常（INTERNAL）' })
      })
  }, [store])

  const handleCreateSession = React.useCallback(async (
    projectId: string,
    role: LinguistRole,
  ): Promise<void> => {
    if (creatingProjectId !== null) return
    const generation = store.set(beginProjectNavigationAtom)
    setCreatingProjectId(projectId)
    try {
      if (activeProjectId !== projectId) {
        const opened = await openLocalizationProject(store, projectId, undefined, generation)
        if (!opened.ok) {
          toast.error(describeLinguistIpcError(opened.error))
          return
        }
      }
      const result = await createProjectAgentSession(store, projectId, role)
      if (!result.ok) {
        toast.error(describeLinguistIpcError(result.error))
        return
      }
      const opened = await openLinguistAgentSession(store, result.data.id, undefined, generation)
      if (!opened.ok) {
        toast.error(describeLinguistIpcError(opened.error))
      }
    } catch {
      toast.error('与主进程通信异常（INTERNAL）')
    } finally {
      setCreatingProjectId(null)
    }
  }, [activeProjectId, creatingProjectId, store])

  const handleRenameProject = React.useCallback(async (
    projectId: string,
    name: string,
  ): Promise<string | null> => {
    const validationError = validateProjectNameInput(name)
    if (validationError) return validationError
    try {
      const result = await window.electronAPI.linguistProjectsRename({
        projectId,
        name: name.trim(),
      })
      if (!result.ok) return describeLinguistIpcError(result.error)
      refresh()
      toast.success(`项目已重命名为「${result.data.name}」`)
      return null
    } catch {
      return '重命名失败：与主进程通信异常（INTERNAL）'
    }
  }, [refresh, store])

  const handleProjectArchived = React.useCallback((project: LinguistProjectInfo): void => {
    refresh()
    if (activeProjectId === project.id) closeProjectTab(project.id)
  }, [activeProjectId, closeProjectTab, refresh])
  const { requestArchive, archiveDialog } = useProjectArchive({
    onArchived: handleProjectArchived,
  })
  const handleOpenProjectSettings = React.useCallback(async (
    projectId: string,
  ): Promise<void> => {
    const generation = store.set(beginProjectNavigationAtom)
    try {
      if (activeProjectId !== projectId) {
        const opened = await openLocalizationProject(store, projectId, undefined, generation)
        if (!opened.ok) {
          toast.error(describeLinguistIpcError(opened.error))
          return
        }
      }
      if (store.get(projectSwitchGenerationAtom) !== generation) return
      const sessionId = store.get(currentAgentSessionIdAtom)!
      store.set(agentSidePanelOpenAtomFamily(sessionId), true)
      store.set(agentDiffPanelTabAtom, (previous) => new Map(previous).set(sessionId, 'linguist'))
      store.set(linguistWorkbenchUiStateAtomFamily(projectId), {
        projectSettingsOpen: true,
      })
    } catch {
      toast.error('打开项目设置失败')
    }
  }, [activeProjectId, store])

  const handleConfirmDeleteProject = React.useCallback(async (): Promise<void> => {
    const project = pendingDeleteProject
    if (
      !project
      || projectDeleteConfirmation !== project.name
      || deletingProject
    ) return
    setDeletingProject(true)
    try {
      const result = await window.electronAPI.linguistProjectsDelete({
        projectId: project.id,
        confirmationName: projectDeleteConfirmation,
      })
      if (!result.ok) {
        toast.error('删除失败', { description: describeLinguistIpcError(result.error) })
        return
      }
      closeProjectTab(project.id)
      clearWorkbenchUiState(project.id)
      refresh()
      toast.success(`已将「${project.name}」移入可恢复删除区`, {
        description: result.data.recoveryName
          ? `恢复目录：${result.data.recoveryName}`
          : '项目索引已清理；历史会话仍可从已归档查看。',
      })
      setPendingDeleteProject(null)
      setProjectDeleteConfirmation('')
    } catch {
      toast.error('删除失败', { description: '与主进程通信异常（INTERNAL）' })
    } finally {
      setDeletingProject(false)
    }
  }, [
    clearWorkbenchUiState,
    closeProjectTab,
    deletingProject,
    pendingDeleteProject,
    projectDeleteConfirmation,
    refresh,
  ])

  const handleMoveProject = React.useCallback(async (
    projectId: string,
    offset: -1 | 1,
  ): Promise<void> => {
    if (state.status !== 'ready') return
    const current = state.projects
      .filter((project) => project.archivedAt === undefined)
      .map((project) => project.id)
    const orderedProjectIds = moveProjectId(current, projectId, offset)
    if (orderedProjectIds.every((id, index) => id === current[index])) return
    try {
      const result = await window.electronAPI.linguistProjectsReorderActive({
        orderedProjectIds,
      })
      if (!result.ok) {
        toast.error('项目排序失败', { description: describeLinguistIpcError(result.error) })
      }
    } catch {
      toast.error('项目排序失败', { description: '与主进程通信异常（INTERNAL）' })
    } finally {
      refresh()
    }
  }, [refresh, state])

  return {
    projects, creatingProjectId,
    open: handleOpenProject, createSession: handleCreateSession, rename: handleRenameProject,
    archive: requestArchive, settings: handleOpenProjectSettings, move: handleMoveProject,
    requestDelete: setPendingDeleteProject,
    copy: (id: string) => setCopySession(store.get(agentSessionsAtom).find(session => session.id === id) ?? null),
    reorder: async (orderedProjectIds: string[]) => {
      const result = await window.electronAPI.linguistProjectsReorderActive({ orderedProjectIds })
      if (!result.ok) toast.error('项目排序失败', { description: describeLinguistIpcError(result.error) })
      refresh()
    },
    dialogs: <>
      {archiveDialog}

      <CopyLinguistSessionDialog
        session={copySession}
        projects={projects}
        onClose={() => setCopySession(null)}
        onCopied={(copy, target) => {
          setSessions((previous) => replaceAgentSessionInFreshnessOrder(previous, copy))
          toast.success(`已复制到「${target.name}」`, {
            description: '源会话保持不变。',
            action: {
              label: '打开副本',
              onClick: () => {
                void openLinguistAgentSession(store, copy.id)
              },
            },
          })
        }}
      />

      <ConfirmDialog
        open={pendingDeleteProject !== null}
        onOpenChange={(open) => {
          if (!open && !deletingProject) {
            setPendingDeleteProject(null)
            setProjectDeleteConfirmation('')
          }
        }}
        title={`删除项目「${pendingDeleteProject?.name ?? ''}」？`}
        confirmLabel="移入可恢复删除区"
        loadingLabel="正在删除…"
        loading={deletingProject}
        variant="destructive"
        confirmDisabled={projectDeleteConfirmation !== pendingDeleteProject?.name}
        onConfirm={handleConfirmDeleteProject}
      >
        <div className="space-y-3 text-sm text-muted-foreground">
          <p>项目目录会移入受管 Trash；历史 Agent 会话与工作目录保留为只读历史。</p>
          <label className="block space-y-1">
            <span>请输入完整项目名称：{pendingDeleteProject?.name}</span>
            <input
              value={projectDeleteConfirmation}
              onChange={(event) => setProjectDeleteConfirmation(event.target.value)}
              aria-label="输入项目名称以确认删除"
              autoComplete="off"
              className="w-full rounded-md bg-background px-3 py-2 text-foreground shadow-sm outline-none ring-1 ring-border focus:ring-2 focus:ring-ring"
            />
          </label>
        </div>
      </ConfirmDialog>
    </>,
  }
}
