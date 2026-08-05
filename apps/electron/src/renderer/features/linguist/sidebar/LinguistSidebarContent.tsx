import * as React from 'react'
import { useAtomValue, useSetAtom, useStore } from 'jotai'
import { toast } from 'sonner'
import {
  AlertCircle,
  Archive,
  ArrowLeft,
  ChevronRight,
  FolderOpen,
  FolderX,
  Loader2,
  Plus,
  RefreshCw,
} from 'lucide-react'
import type { AgentSessionMeta, LinguistProjectInfo } from '@proma/shared'
import {
  agentSessionIndicatorMapAtom,
  agentSessionsAtom,
  type SessionIndicatorStatus,
} from '@/atoms/agent-atoms'
import {
  activeTabAtom,
  activeTabIdAtom,
  closeTab,
  createLocalizationProjectTabId,
  projectCurrentAgentSessionIdMapAtom,
  tabsAtom,
  updateTabTitle,
} from '@/atoms/tab-atoms'
import {
  deleteSessionTarget,
  type SessionDeleteTarget,
} from '@/components/session-tree/session-actions'
import {
  buildAgentSessionTrees,
  buildPinnedAgentSessionTrees,
  countCompletedDelegatedChildren,
  getSessionTreeStatus,
  hasPinnedVisibleParent,
  selectVisibleAgentSessionTrees,
  treeContainsSessionId,
} from '@/components/session-tree/agent-session-tree'
import { ProjectSessionTreeGroupHeader } from '@/components/session-tree/ProjectSessionTreeGroupHeader'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { replaceAgentSessionInFreshnessOrder } from '@/lib/agent-session-list'
import {
  linguistProjectListStateAtom,
  refreshLinguistProjectListAtom,
  type LinguistProjectListState,
} from '../projects/project-list-atoms'
import { projectCreateDialogOpenAtom } from '../projects/projects-atoms'
import {
  describeLinguistIpcError,
  validateProjectNameInput,
} from '../projects/project-utils'
import { openLocalizationProject } from '../projects/open-localization-project'
import { openLinguistAgentSession } from '../projects/open-linguist-session'
import {
  registerCreatedProjectSession,
  selectFallbackLinguistSession,
  selectProjectAgentSession,
} from '../projects/project-agent-session'
import {
  clearLinguistWorkbenchUiStateAtom,
  linguistWorkbenchUiStateAtomFamily,
} from '../projects/cat-workspace-atoms'
import { useProjectArchive } from '../projects/ProjectArchiveAction'
import { CopyLinguistSessionDialog } from './CopyLinguistSessionDialog'
import {
  LinguistProjectActionItems,
  LinguistProjectActionsMenu,
} from './LinguistProjectActionsMenu'

export {
  registerCreatedProjectSession,
  selectProjectAgentSession,
} from '../projects/project-agent-session'

const SESSION_EXPAND_STEP = 10

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

export interface SharedProjectSessionRowProps {
  session: AgentSessionMeta
  active: boolean
  indicatorStatus: SessionIndicatorStatus
  showPinIcon?: boolean
  delegationSummary?: {
    total: number
    completed: number
    expanded: boolean
    onToggle: () => void
  }
  leftAccent?: 'orange' | 'blue' | 'green'
  disableMiniMap?: boolean
  workspaceName?: string
  relativeTimeNow: number
  transferLabel?: string
  historyOnlyActions?: boolean
  onSelect: (id: string, title: string) => void
  onRequestDelete: (id: string) => void
  onRequestMove: (id: string) => void
  onRename: (id: string, newTitle: string) => Promise<void>
  onTogglePin: (id: string, cascade: boolean) => Promise<void>
  onToggleStar: (id: string) => Promise<void>
  onToggleArchive: (id: string) => Promise<void>
}

interface LinguistSidebarContentViewProps {
  state: LinguistProjectListState
  onRetry: () => void
  activeProjectId?: string | null
  archiveView?: boolean
  onCreateProject?: () => void
  onOpenProject: (projectId: string) => void
  sessions?: readonly AgentSessionMeta[]
  currentSessionIds?: ReadonlyMap<string, string>
  creatingProjectId?: string | null
  sessionError?: { projectId: string; message: string } | null
  SessionRowComponent?: React.ComponentType<SharedProjectSessionRowProps>
  indicatorMap?: ReadonlyMap<string, SessionIndicatorStatus>
  relativeTimeNow?: number
  draggingProjectId?: string | null
  projectDropIndicator?: { id: string; position: 'before' | 'after' } | null
  onShowArchived?: () => void
  onShowActive?: () => void
  onSelectSession?: (projectId: string, sessionId: string) => void
  onCreateSession?: (projectId: string) => void
  onOpenProjectSettings?: (projectId: string) => void
  onRenameProject?: (projectId: string, name: string) => Promise<string | null>
  onArchiveProject?: (project: LinguistProjectInfo) => void
  onDeleteProject?: (project: LinguistProjectInfo) => void
  onProjectDragStart?: (event: React.DragEvent, projectId: string) => void
  onProjectDragOver?: (event: React.DragEvent, projectId: string) => void
  onProjectDragLeave?: () => void
  onProjectDrop?: (event: React.DragEvent, projectId: string) => void
  onProjectDragEnd?: () => void
  onMoveProject?: (projectId: string, offset: -1 | 1) => void
  onRenameSession?: (projectId: string, sessionId: string, title: string) => void
  onTogglePinSession?: (projectId: string, sessionId: string) => void
  onToggleStarSession?: (projectId: string, sessionId: string) => void
  onCopySession?: (projectId: string, sessionId: string) => void
  onToggleArchiveSession?: (projectId: string, sessionId: string) => void
  onDeleteSession?: (projectId: string, sessionId: string) => void
}

/** Linguist 只适配项目分组；会话树行本身由 Agent 侧栏注入。 */
export function LinguistSidebarContentView({
  state,
  onRetry,
  activeProjectId = null,
  archiveView = false,
  onCreateProject,
  onOpenProject,
  sessions = [],
  currentSessionIds = new Map(),
  creatingProjectId = null,
  sessionError = null,
  SessionRowComponent,
  indicatorMap = new Map(),
  relativeTimeNow = Date.now(),
  draggingProjectId = null,
  projectDropIndicator = null,
  onShowArchived,
  onShowActive,
  onSelectSession,
  onCreateSession,
  onOpenProjectSettings,
  onRenameProject,
  onArchiveProject,
  onDeleteProject,
  onProjectDragStart,
  onProjectDragOver,
  onProjectDragLeave,
  onProjectDrop,
  onProjectDragEnd,
  onMoveProject,
  onRenameSession,
  onTogglePinSession,
  onToggleStarSession,
  onCopySession,
  onToggleArchiveSession,
  onDeleteSession,
}: LinguistSidebarContentViewProps): React.ReactElement {
  const allProjects = state.status === 'ready' ? state.projects : []
  const activeProjects = allProjects.filter((project) => project.archivedAt === undefined)
  const archivedProjects = allProjects.filter((project) => project.archivedAt !== undefined)
  const projectById = new Map(allProjects.map((project) => [project.id, project]))
  const activeProjectIds = new Set(activeProjects.map((project) => project.id))
  const projectNameMap = new Map(allProjects.map((project) => [project.id, project.name]))
  const boundSessions = sessions.filter((session) => !!session.linguistProjectId)
  const activeBoundSessions = boundSessions.filter((session) =>
    session.archived !== true && activeProjectIds.has(session.linguistProjectId!),
  )
  const pinnedSessionTrees = buildPinnedAgentSessionTrees(activeBoundSessions)
  const archivedSessionGroups = activeProjects
    .map((project) => ({
      project,
      sessions: boundSessions.filter((session) =>
        session.linguistProjectId === project.id && session.archived === true,
      ),
    }))
    .filter((group) => group.sessions.length > 0)
  const missingGroups = new Map<string, AgentSessionMeta[]>()
  for (const session of boundSessions) {
    const projectId = session.linguistProjectId!
    if (projectById.has(projectId)) continue
    const group = missingGroups.get(projectId) ?? []
    group.push(session)
    missingGroups.set(projectId, group)
  }
  const archiveCount = archivedSessionGroups.reduce(
    (count, group) => count + group.sessions.length,
    0,
  ) + archivedProjects.length + missingGroups.size

  const sessionRows = (input: {
    projectId: string
    projectName?: string
    groupSessions: readonly AgentSessionMeta[]
    historyOnlyActions?: boolean
  }): React.ReactNode => (
    <SessionTreeRows
      projectId={input.projectId}
      projectName={input.projectName}
      sessions={input.groupSessions}
      currentSessionId={input.projectId === activeProjectId
        ? currentSessionIds.get(input.projectId)
        : undefined}
      historyOnlyActions={input.historyOnlyActions}
      SessionRowComponent={SessionRowComponent}
      indicatorMap={indicatorMap}
      relativeTimeNow={relativeTimeNow}
      onSelectSession={onSelectSession}
      onRenameSession={onRenameSession}
      onTogglePinSession={onTogglePinSession}
      onToggleStarSession={onToggleStarSession}
      onCopySession={onCopySession}
      onToggleArchiveSession={onToggleArchiveSession}
      onDeleteSession={onDeleteSession}
    />
  )

  return (
    <div className="flex min-h-0 flex-1 flex-col titlebar-no-drag">
      <div className="flex items-center justify-between px-3 pb-1 pt-3">
        <h2 className="px-1.5 text-[13px] font-medium leading-[18px] text-foreground/60">
          {archiveView ? '已归档' : '项目'}
        </h2>
        {!archiveView && (
          <button
            type="button"
            aria-label="新建本地化项目"
            onClick={onCreateProject}
            className="flex size-6 items-center justify-center rounded-md text-foreground/40 hover:bg-foreground/[0.06] hover:text-foreground/60"
          >
            <Plus size={16} aria-hidden="true" />
          </button>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-3 scrollbar-thin">
        {state.status === 'loading' && (
          <div
            aria-label="正在加载本地化项目"
            aria-busy="true"
            className="flex flex-col gap-1.5 px-2"
          >
            {[0, 1, 2].map((item) => (
              <div key={item} className="h-7 animate-pulse rounded-md bg-foreground/[0.045]" />
            ))}
          </div>
        )}

        {state.status === 'error' && (
          <div
            role="alert"
            className="mx-2 flex flex-col items-start gap-2 rounded-xl bg-destructive/[0.07] p-3 text-xs"
          >
            <div className="flex items-start gap-2 text-destructive">
              <AlertCircle size={15} className="mt-0.5 flex-shrink-0" aria-hidden="true" />
              <span>{state.message}</span>
            </div>
            <button
              type="button"
              onClick={onRetry}
              className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 font-medium text-foreground/65 hover:bg-foreground/[0.06] hover:text-foreground"
            >
              <RefreshCw size={12} aria-hidden="true" />
              重新加载
            </button>
          </div>
        )}

        {state.status === 'ready' && !archiveView && activeProjects.length === 0 && (
          <div className="mx-2 flex flex-col items-center gap-2 rounded-xl bg-foreground/[0.025] px-4 py-8 text-center">
            <FolderOpen size={22} className="text-foreground/30" aria-hidden="true" />
            <p className="text-[13px] font-medium text-foreground/60">暂无本地化项目</p>
            <p className="text-xs leading-5 text-foreground/40">点击上方“+”创建第一个项目。</p>
          </div>
        )}

        {state.status === 'ready' && !archiveView && pinnedSessionTrees.length > 0 && (
          <div className="mb-2">
            <div className="px-2 pb-1 text-[13px] font-medium leading-[18px] text-foreground/40">
              置顶
            </div>
            <div className="ml-4 flex flex-col gap-0.5">
              {pinnedSessionTrees.map((tree) => {
                const projectId = tree.session.linguistProjectId!
                return (
                  <SessionTreeRows
                    key={tree.session.id}
                    projectId={projectId}
                    projectName={projectNameMap.get(projectId)
                      ?? tree.session.linguistProjectName}
                    sessions={[tree.session, ...tree.childSessions]}
                    currentSessionId={projectId === activeProjectId
                      ? currentSessionIds.get(projectId)
                      : undefined}
                    SessionRowComponent={SessionRowComponent}
                    indicatorMap={indicatorMap}
                    relativeTimeNow={relativeTimeNow}
                    alwaysShowAll
                    showProjectBadge
                    onSelectSession={onSelectSession}
                    onRenameSession={onRenameSession}
                    onTogglePinSession={onTogglePinSession}
                    onToggleStarSession={onToggleStarSession}
                    onCopySession={onCopySession}
                    onToggleArchiveSession={onToggleArchiveSession}
                    onDeleteSession={onDeleteSession}
                  />
                )
              })}
            </div>
          </div>
        )}

        {state.status === 'ready' && !archiveView && activeProjects.length > 0 && (
          <ul aria-label="本地化项目" className="flex flex-col gap-0.5">
            {activeProjects.map((project, index) => (
              <ProjectRow
                key={project.id}
                project={project}
                active={project.id === activeProjectId}
                onOpen={onOpenProject}
                sessions={boundSessions.filter((session) =>
                  session.linguistProjectId === project.id
                  && session.archived !== true
                  && !session.pinned
                  && !hasPinnedVisibleParent(session, activeBoundSessions),
                )}
                currentSessionId={project.id === activeProjectId
                  ? currentSessionIds.get(project.id)
                  : undefined}
                creating={creatingProjectId === project.id}
                error={sessionError?.projectId === project.id ? sessionError.message : null}
                onSelectSession={onSelectSession}
                onCreateSession={onCreateSession}
                onOpenSettings={onOpenProjectSettings}
                onRenameProject={onRenameProject}
                onArchiveProject={onArchiveProject}
                SessionRowComponent={SessionRowComponent}
                indicatorMap={indicatorMap}
                relativeTimeNow={relativeTimeNow}
                onRenameSession={onRenameSession}
                onTogglePinSession={onTogglePinSession}
                onToggleStarSession={onToggleStarSession}
                onCopySession={onCopySession}
                onToggleArchiveSession={onToggleArchiveSession}
                onDeleteSession={onDeleteSession}
                dragging={draggingProjectId === project.id}
                dropPosition={projectDropIndicator?.id === project.id
                  ? projectDropIndicator.position
                  : null}
                onDragStart={onProjectDragStart}
                onDragOver={onProjectDragOver}
                onDragLeave={onProjectDragLeave}
                onDrop={onProjectDrop}
                onDragEnd={onProjectDragEnd}
                canMoveUp={index > 0}
                canMoveDown={index < activeProjects.length - 1}
                onMoveProject={onMoveProject}
              />
            ))}
          </ul>
        )}

        {state.status === 'ready' && archiveView && archiveCount === 0 && (
          <div className="mx-2 rounded-xl bg-foreground/[0.025] px-4 py-8 text-center text-xs text-foreground/45">
            暂无已归档或缺失项目历史
          </div>
        )}

        {state.status === 'ready' && archiveView && archivedSessionGroups.length > 0 && (
          <ArchiveSection title="活跃项目中的已归档会话">
            {archivedSessionGroups.map(({ project, sessions: projectSessions }) => (
              <HistoryProjectGroup
                key={project.id}
                label={project.name}
                onOpen={() => onOpenProject(project.id)}
              >
                {sessionRows({
                  projectId: project.id,
                  projectName: project.name,
                  groupSessions: projectSessions,
                })}
              </HistoryProjectGroup>
            ))}
          </ArchiveSection>
        )}

        {state.status === 'ready' && archiveView && archivedProjects.length > 0 && (
          <ArchiveSection title="已归档项目">
            <ul className="flex flex-col gap-0.5">
              {archivedProjects.map((project) => (
                <ProjectRow
                  key={project.id}
                  project={project}
                  active={project.id === activeProjectId}
                  onOpen={onOpenProject}
                  sessions={boundSessions.filter((session) => session.linguistProjectId === project.id)}
                  currentSessionId={project.id === activeProjectId
                    ? currentSessionIds.get(project.id)
                    : undefined}
                  creating={false}
                  error={sessionError?.projectId === project.id ? sessionError.message : null}
                  historyOnlyActions
                  onSelectSession={onSelectSession}
                  onOpenSettings={onOpenProjectSettings}
                  onDeleteProject={onDeleteProject}
                  SessionRowComponent={SessionRowComponent}
                  indicatorMap={indicatorMap}
                  relativeTimeNow={relativeTimeNow}
                  onCopySession={onCopySession}
                  onDeleteSession={onDeleteSession}
                />
              ))}
            </ul>
          </ArchiveSection>
        )}

        {state.status === 'ready' && archiveView && missingGroups.size > 0 && (
          <ArchiveSection title="缺失或已删除的项目">
            {[...missingGroups.entries()].map(([projectId, projectSessions]) => {
              const label = projectSessions[0]?.linguistProjectName ?? projectId
              return (
                <HistoryProjectGroup
                  key={projectId}
                  label={label}
                  missing
                  onOpen={() => {
                    const first = projectSessions[0]
                    if (first) onSelectSession?.(projectId, first.id)
                  }}
                >
                  {sessionRows({
                    projectId,
                    projectName: label,
                    groupSessions: projectSessions,
                    historyOnlyActions: true,
                  })}
                </HistoryProjectGroup>
              )
            })}
          </ArchiveSection>
        )}
      </div>

      {state.status === 'ready' && (
        <div className="px-3 pb-1">
          {archiveView ? (
            <button
              type="button"
              onClick={onShowActive}
              className="flex w-full items-center gap-2 rounded-[10px] bg-foreground/[0.04] px-3 py-2 text-[12px] text-foreground/60 transition-colors hover:bg-foreground/[0.07] hover:text-foreground/80"
            >
              <ArrowLeft size={13} className="text-foreground/50" />
              返回活跃项目
            </button>
          ) : (
            <button
              type="button"
              onClick={onShowArchived}
              className="flex w-full items-center gap-2 rounded-[10px] px-3 py-2 text-[12px] text-foreground/40 transition-colors hover:bg-foreground/[0.04] hover:text-foreground/60"
            >
              <Archive size={13} className="text-foreground/30" />
              <span>已归档{archiveCount > 0 ? ` (${archiveCount})` : ''}</span>
            </button>
          )}
        </div>
      )}
    </div>
  )
}

export function LinguistSidebarContent({
  SessionRowComponent,
}: {
  SessionRowComponent: React.ComponentType<SharedProjectSessionRowProps>
}): React.ReactElement {
  const state = useAtomValue(linguistProjectListStateAtom)
  const refresh = useSetAtom(refreshLinguistProjectListAtom)
  const setProjectCreateDialogOpen = useSetAtom(projectCreateDialogOpenAtom)
  const clearWorkbenchUiState = useSetAtom(clearLinguistWorkbenchUiStateAtom)
  const activeTab = useAtomValue(activeTabAtom)
  const sessions = useAtomValue(agentSessionsAtom)
  const indicatorMap = useAtomValue(agentSessionIndicatorMapAtom)
  const setSessions = useSetAtom(agentSessionsAtom)
  const currentSessionIds = useAtomValue(projectCurrentAgentSessionIdMapAtom)
  const store = useStore()
  const [archiveView, setArchiveView] = React.useState(false)
  const [creatingProjectId, setCreatingProjectId] = React.useState<string | null>(null)
  const [relativeTimeNow, setRelativeTimeNow] = React.useState(() => Date.now())
  const [sessionError, setSessionError] = React.useState<{
    projectId: string
    message: string
  } | null>(null)
  const [pendingDeleteTarget, setPendingDeleteTarget] = React.useState<
    Extract<SessionDeleteTarget, { kind: 'linguist-session' }> | null
  >(null)
  const [pendingDeleteProject, setPendingDeleteProject] = React.useState<LinguistProjectInfo | null>(null)
  const [projectDeleteConfirmation, setProjectDeleteConfirmation] = React.useState('')
  const [deletingProject, setDeletingProject] = React.useState(false)
  const [copySession, setCopySession] = React.useState<AgentSessionMeta | null>(null)
  const [draggingProjectId, setDraggingProjectId] = React.useState<string | null>(null)
  const [projectDropIndicator, setProjectDropIndicator] = React.useState<{
    id: string
    position: 'before' | 'after'
  } | null>(null)
  const activeProjectId = activeTab?.type === 'linguist-project' ? activeTab.projectId : null
  const projects = state.status === 'ready' ? state.projects : []

  React.useEffect(() => {
    const timer = window.setInterval(() => setRelativeTimeNow(Date.now()), 60_000)
    return () => window.clearInterval(timer)
  }, [])

  const closeProjectTab = React.useCallback((projectId: string): void => {
    const closed = closeTab(
      store.get(tabsAtom),
      store.get(activeTabIdAtom),
      createLocalizationProjectTabId(projectId),
    )
    store.set(tabsAtom, closed.tabs)
    store.set(activeTabIdAtom, closed.activeTabId)
  }, [store])

  const handleOpenProject = React.useCallback((projectId: string): void => {
    store.set(linguistWorkbenchUiStateAtomFamily(projectId), {
      agentPresentation: 'closed',
    })
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

  const handleSelectSession = React.useCallback(async (
    projectId: string,
    sessionId: string,
  ): Promise<void> => {
    setSessionError(null)
    try {
      const result = await openLinguistAgentSession(store, sessionId)
      if (!result.ok) {
        setSessionError({ projectId, message: describeLinguistIpcError(result.error) })
      }
    } catch {
      setSessionError({ projectId, message: '与主进程通信异常（INTERNAL）' })
    }
  }, [store])

  const handleCreateSession = React.useCallback(async (
    projectId: string,
  ): Promise<void> => {
    if (creatingProjectId !== null) return
    setCreatingProjectId(projectId)
    setSessionError(null)
    try {
      if (activeProjectId !== projectId) {
        const opened = await openLocalizationProject(store, projectId)
        if (!opened.ok) {
          setSessionError({ projectId, message: describeLinguistIpcError(opened.error) })
          return
        }
      }
      const result = await window.electronAPI.linguistSessionsCreateForProject({ projectId })
      if (!result.ok) {
        setSessionError({ projectId, message: describeLinguistIpcError(result.error) })
        return
      }
      if (!registerCreatedProjectSession(store, projectId, result.data)) {
        setSessionError({ projectId, message: '项目会话绑定不一致' })
      } else {
        store.set(linguistWorkbenchUiStateAtomFamily(projectId), {
          agentPresentation: 'full',
        })
      }
    } catch {
      setSessionError({ projectId, message: '与主进程通信异常（INTERNAL）' })
    } finally {
      setCreatingProjectId(null)
    }
  }, [activeProjectId, creatingProjectId, store])

  const selectFallbackAfterMutation = React.useCallback((
    projectId: string,
    sessionId: string,
  ): void => {
    if (!selectFallbackLinguistSession(store, projectId, sessionId)) {
      store.set(linguistWorkbenchUiStateAtomFamily(projectId), {
        agentPresentation: 'closed',
      })
    }
  }, [store])

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
      store.set(tabsAtom, (current) => updateTabTitle(current, projectId, result.data.name))
      refresh()
      toast.success(`项目已重命名为「${result.data.name}」`)
      return null
    } catch {
      return '重命名失败：与主进程通信异常（INTERNAL）'
    }
  }, [refresh, store])

  const { requestArchive, archiveDialog } = useProjectArchive({
    onArchived: (project) => {
      refresh()
      if (activeProjectId === project.id) closeProjectTab(project.id)
    },
  })

  const handleRenameSession = React.useCallback(async (
    projectId: string,
    sessionId: string,
    title: string,
  ): Promise<void> => {
    try {
      const updated = await window.electronAPI.updateAgentSessionTitle(sessionId, title)
      setSessions((previous) => replaceAgentSessionInFreshnessOrder(previous, updated))
    } catch {
      setSessionError({ projectId, message: '重命名会话失败' })
    }
  }, [setSessions])

  const handleTogglePinSession = React.useCallback(async (
    projectId: string,
    sessionId: string,
  ): Promise<void> => {
    try {
      const updated = await window.electronAPI.togglePinAgentSession(sessionId)
      setSessions((previous) => replaceAgentSessionInFreshnessOrder(previous, updated))
    } catch {
      setSessionError({ projectId, message: '更新会话置顶状态失败' })
    }
  }, [setSessions])

  const handleToggleStarSession = React.useCallback(async (
    projectId: string,
    sessionId: string,
  ): Promise<void> => {
    try {
      const updated = await window.electronAPI.toggleStarAgentSession(sessionId)
      setSessions((previous) => replaceAgentSessionInFreshnessOrder(previous, updated))
    } catch {
      setSessionError({ projectId, message: '更新会话星标失败' })
    }
  }, [setSessions])

  const handleToggleArchiveSession = React.useCallback(async (
    projectId: string,
    sessionId: string,
  ): Promise<void> => {
    try {
      const updated = await window.electronAPI.toggleArchiveAgentSession(sessionId)
      const wasCurrent = store.get(projectCurrentAgentSessionIdMapAtom).get(projectId) === sessionId
      setSessions((previous) => replaceAgentSessionInFreshnessOrder(previous, updated))
      if (updated.archived && wasCurrent) selectFallbackAfterMutation(projectId, sessionId)
    } catch {
      setSessionError({ projectId, message: '更新会话归档状态失败' })
    }
  }, [selectFallbackAfterMutation, setSessions, store])

  const handleOpenProjectSettings = React.useCallback(async (
    projectId: string,
  ): Promise<void> => {
    try {
      if (activeProjectId !== projectId) {
        const opened = await openLocalizationProject(store, projectId)
        if (!opened.ok) {
          setSessionError({ projectId, message: describeLinguistIpcError(opened.error) })
          return
        }
      }
      store.set(linguistWorkbenchUiStateAtomFamily(projectId), {
        projectSettingsOpen: true,
      })
    } catch {
      setSessionError({ projectId, message: '打开项目设置失败' })
    }
  }, [activeProjectId, store])

  const handleConfirmDeleteSession = React.useCallback(async (): Promise<void> => {
    const target = pendingDeleteTarget
    if (!target) return
    try {
      await deleteSessionTarget(target, {
        deleteChatConversation: window.electronAPI.deleteConversation,
        deleteAgentSession: window.electronAPI.deleteAgentSession,
      })
      const wasCurrent = store.get(projectCurrentAgentSessionIdMapAtom)
        .get(target.projectId) === target.id
      const nextSessions = await window.electronAPI.listAgentSessions()
        .catch(() => store.get(agentSessionsAtom).filter((session) => session.id !== target.id))
      store.set(agentSessionsAtom, nextSessions)
      if (wasCurrent) {
        const fallbackId = selectFallbackLinguistSession(
          store,
          target.projectId,
          target.id,
        )
        if (fallbackId) {
          void openLinguistAgentSession(store, fallbackId)
        } else {
          closeProjectTab(target.projectId)
        }
      }
      toast.success('会话已删除')
    } catch {
      setSessionError({ projectId: target.projectId, message: '删除会话失败' })
    } finally {
      setPendingDeleteTarget(null)
    }
  }, [closeProjectTab, pendingDeleteTarget, store])

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

  const handleProjectDragStart = React.useCallback((
    event: React.DragEvent,
    projectId: string,
  ): void => {
    setDraggingProjectId(projectId)
    event.dataTransfer.effectAllowed = 'move'
    event.dataTransfer.setData('text/plain', projectId)
  }, [])

  const handleProjectDragOver = React.useCallback((
    event: React.DragEvent,
    projectId: string,
  ): void => {
    if (!draggingProjectId || draggingProjectId === projectId) return
    event.preventDefault()
    event.dataTransfer.dropEffect = 'move'
    const rect = event.currentTarget.getBoundingClientRect()
    setProjectDropIndicator({
      id: projectId,
      position: event.clientY < rect.top + rect.height / 2 ? 'before' : 'after',
    })
  }, [draggingProjectId])

  const handleProjectDrop = React.useCallback(async (
    event: React.DragEvent,
    targetProjectId: string,
  ): Promise<void> => {
    event.preventDefault()
    const sourceProjectId = draggingProjectId
    const position = projectDropIndicator?.id === targetProjectId
      ? projectDropIndicator.position
      : 'before'
    setDraggingProjectId(null)
    setProjectDropIndicator(null)
    if (!sourceProjectId || sourceProjectId === targetProjectId || state.status !== 'ready') return

    const orderedProjectIds = state.projects
      .filter((project) => project.archivedAt === undefined)
      .map((project) => project.id)
    const sourceIndex = orderedProjectIds.indexOf(sourceProjectId)
    const targetIndex = orderedProjectIds.indexOf(targetProjectId)
    if (sourceIndex < 0 || targetIndex < 0) {
      refresh()
      return
    }
    orderedProjectIds.splice(sourceIndex, 1)
    const nextTargetIndex = orderedProjectIds.indexOf(targetProjectId)
    orderedProjectIds.splice(nextTargetIndex + (position === 'after' ? 1 : 0), 0, sourceProjectId)
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
  }, [draggingProjectId, projectDropIndicator, refresh, state])

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

  return (
    <>
      <LinguistSidebarContentView
        state={state}
        onRetry={refresh}
        activeProjectId={activeProjectId}
        archiveView={archiveView}
        onShowArchived={() => setArchiveView(true)}
        onShowActive={() => setArchiveView(false)}
        onCreateProject={() => setProjectCreateDialogOpen(true)}
        onOpenProject={handleOpenProject}
        SessionRowComponent={SessionRowComponent}
        indicatorMap={indicatorMap}
        relativeTimeNow={relativeTimeNow}
        sessions={sessions}
        currentSessionIds={currentSessionIds}
        creatingProjectId={creatingProjectId}
        sessionError={sessionError}
        draggingProjectId={draggingProjectId}
        projectDropIndicator={projectDropIndicator}
        onSelectSession={(projectId, sessionId) => {
          void handleSelectSession(projectId, sessionId)
        }}
        onCreateSession={(projectId) => {
          void handleCreateSession(projectId)
        }}
        onOpenProjectSettings={(projectId) => {
          void handleOpenProjectSettings(projectId)
        }}
        onRenameProject={handleRenameProject}
        onArchiveProject={requestArchive}
        onDeleteProject={setPendingDeleteProject}
        onProjectDragStart={handleProjectDragStart}
        onProjectDragOver={handleProjectDragOver}
        onProjectDragLeave={() => setProjectDropIndicator(null)}
        onProjectDrop={(event, projectId) => {
          void handleProjectDrop(event, projectId)
        }}
        onProjectDragEnd={() => {
          setDraggingProjectId(null)
          setProjectDropIndicator(null)
        }}
        onMoveProject={(projectId, offset) => {
          void handleMoveProject(projectId, offset)
        }}
        onRenameSession={(projectId, sessionId, title) => {
          void handleRenameSession(projectId, sessionId, title)
        }}
        onTogglePinSession={(projectId, sessionId) => {
          void handleTogglePinSession(projectId, sessionId)
        }}
        onToggleStarSession={(projectId, sessionId) => {
          void handleToggleStarSession(projectId, sessionId)
        }}
        onCopySession={(_projectId, sessionId) => {
          setCopySession(store.get(agentSessionsAtom).find((session) => session.id === sessionId) ?? null)
        }}
        onToggleArchiveSession={(projectId, sessionId) => {
          void handleToggleArchiveSession(projectId, sessionId)
        }}
        onDeleteSession={(projectId, sessionId) => {
          setPendingDeleteTarget({ kind: 'linguist-session', projectId, id: sessionId })
        }}
      />

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
        open={pendingDeleteTarget !== null}
        onOpenChange={(open) => {
          if (!open) setPendingDeleteTarget(null)
        }}
        title="确认删除会话"
        description="删除后将无法恢复，确定要删除这个会话吗？"
        confirmLabel="删除"
        onConfirm={handleConfirmDeleteSession}
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
    </>
  )
}

function ProjectRow({
  project,
  active,
  onOpen,
  sessions,
  currentSessionId,
  creating,
  error,
  historyOnlyActions = false,
  onSelectSession,
  onCreateSession,
  onOpenSettings,
  onRenameProject,
  onArchiveProject,
  onDeleteProject,
  SessionRowComponent,
  indicatorMap,
  relativeTimeNow,
  onRenameSession,
  onTogglePinSession,
  onToggleStarSession,
  onCopySession,
  onToggleArchiveSession,
  onDeleteSession,
  dragging = false,
  dropPosition = null,
  onDragStart,
  onDragOver,
  onDragLeave,
  onDrop,
  onDragEnd,
  canMoveUp = false,
  canMoveDown = false,
  onMoveProject,
}: {
  project: LinguistProjectInfo
  active: boolean
  onOpen: (projectId: string) => void
  sessions: readonly AgentSessionMeta[]
  currentSessionId?: string
  creating: boolean
  error: string | null
  historyOnlyActions?: boolean
  onSelectSession?: (projectId: string, sessionId: string) => void
  onCreateSession?: (projectId: string) => void
  onOpenSettings?: (projectId: string) => void
  onRenameProject?: (projectId: string, name: string) => Promise<string | null>
  onArchiveProject?: (project: LinguistProjectInfo) => void
  onDeleteProject?: (project: LinguistProjectInfo) => void
  SessionRowComponent?: React.ComponentType<SharedProjectSessionRowProps>
  indicatorMap: ReadonlyMap<string, SessionIndicatorStatus>
  relativeTimeNow: number
  onRenameSession?: (projectId: string, sessionId: string, title: string) => void
  onTogglePinSession?: (projectId: string, sessionId: string) => void
  onToggleStarSession?: (projectId: string, sessionId: string) => void
  onCopySession?: (projectId: string, sessionId: string) => void
  onToggleArchiveSession?: (projectId: string, sessionId: string) => void
  onDeleteSession?: (projectId: string, sessionId: string) => void
  dragging?: boolean
  dropPosition?: 'before' | 'after' | null
  onDragStart?: (event: React.DragEvent, projectId: string) => void
  onDragOver?: (event: React.DragEvent, projectId: string) => void
  onDragLeave?: () => void
  onDrop?: (event: React.DragEvent, projectId: string) => void
  onDragEnd?: () => void
  canMoveUp?: boolean
  canMoveDown?: boolean
  onMoveProject?: (projectId: string, offset: -1 | 1) => void
}): React.ReactElement {
  const [collapsed, setCollapsed] = React.useState(false)
  const [renaming, setRenaming] = React.useState(false)
  const [name, setName] = React.useState(project.name)
  const [renameError, setRenameError] = React.useState<string | null>(null)
  const inputRef = React.useRef<HTMLInputElement>(null)
  const uiState = useAtomValue(linguistWorkbenchUiStateAtomFamily(project.id))
  const archived = project.archivedAt !== undefined

  const startRename = (): void => {
    setName(project.name)
    setRenameError(null)
    setRenaming(true)
    requestAnimationFrame(() => {
      inputRef.current?.focus()
      inputRef.current?.select()
    })
  }

  const commitRename = async (): Promise<void> => {
    if (!renaming) return
    const trimmed = name.trim()
    if (trimmed === project.name) {
      setRenaming(false)
      return
    }
    const validationError = validateProjectNameInput(trimmed)
    if (validationError) {
      setRenameError(validationError)
      return
    }
    const ipcError = await onRenameProject?.(project.id, trimmed)
    if (ipcError) {
      setRenameError(ipcError)
      return
    }
    setRenaming(false)
  }

  const handleProjectNameClick = (): void => {
    if (active && uiState.agentPresentation !== 'full') {
      setCollapsed((value) => !value)
      return
    }
    setCollapsed(false)
    onOpen(project.id)
  }

  return (
    <li
      onDragOver={(event) => onDragOver?.(event, project.id)}
      onDragLeave={onDragLeave}
      onDrop={(event) => onDrop?.(event, project.id)}
      onDragEnd={onDragEnd}
      className={`relative flex flex-col gap-0.5 rounded-md transition-opacity ${dragging ? 'opacity-45' : ''}`}
    >
      {dropPosition === 'before' && (
        <div className="absolute -top-0.5 left-3 right-3 z-10 h-0.5 rounded-full bg-primary" />
      )}
      <ProjectSessionTreeGroupHeader
        projectId={project.id}
        name={project.name}
        current={active}
        collapsed={collapsed}
        onSelect={handleProjectNameClick}
        onToggleCollapse={() => setCollapsed((value) => !value)}
        ariaLabel={`打开项目 ${project.name}`}
        title={`${project.name} · ${project.sourceLocale} → ${project.targetLocale}`}
        draggable={!archived}
        onDragStart={(event) => onDragStart?.(event, project.id)}
        nameButtonClassName="pr-12"
        editor={renaming ? (
          <input
            ref={inputRef}
            value={name}
            onChange={(event) => {
              setName(event.target.value)
              setRenameError(null)
            }}
            onBlur={() => {
              void commitRename()
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
                event.preventDefault()
                void commitRename()
              } else if (event.key === 'Escape') {
                setRenaming(false)
                setRenameError(null)
              }
            }}
            aria-label={`项目名称：${project.name}`}
            className="min-w-0 flex-1 border-b border-primary/50 bg-transparent text-[13px] font-medium leading-[18px] outline-none"
          />
        ) : undefined}
        contextMenuItems={(
          <LinguistProjectActionItems
            project={project}
            onOpen={() => onOpen(project.id)}
            onCreateSession={() => onCreateSession?.(project.id)}
            onRename={startRename}
            onArchive={() => onArchiveProject?.(project)}
            onOpenSettings={() => onOpenSettings?.(project.id)}
            onDelete={() => onDeleteProject?.(project)}
            canMoveUp={canMoveUp}
            canMoveDown={canMoveDown}
            onMoveUp={() => onMoveProject?.(project.id, -1)}
            onMoveDown={() => onMoveProject?.(project.id, 1)}
            variant="context"
          />
        )}
        actions={(
          <>
            {!archived && (
              <button
                type="button"
                aria-label={`在项目 ${project.name} 中新建会话`}
                aria-busy={creating || undefined}
                disabled={creating}
                onClick={() => onCreateSession?.(project.id)}
                className="absolute right-6 top-1/2 flex size-5 -translate-y-1/2 items-center justify-center rounded-md text-foreground/35 opacity-0 hover:bg-foreground/[0.055] hover:text-foreground/65 group-hover/project:opacity-100 disabled:cursor-wait disabled:opacity-50"
              >
                {creating
                  ? <Loader2 size={12} className="animate-spin" aria-hidden="true" />
                  : <Plus size={13} aria-hidden="true" />}
              </button>
            )}
            <LinguistProjectActionsMenu
              project={project}
              onOpen={() => onOpen(project.id)}
              onCreateSession={() => onCreateSession?.(project.id)}
              onRename={startRename}
              onArchive={() => onArchiveProject?.(project)}
              onOpenSettings={() => onOpenSettings?.(project.id)}
              onDelete={() => onDeleteProject?.(project)}
              canMoveUp={canMoveUp}
              canMoveDown={canMoveDown}
              onMoveUp={() => onMoveProject?.(project.id, -1)}
              onMoveDown={() => onMoveProject?.(project.id, 1)}
            />
          </>
        )}
      />

      {renameError && (
        <div role="alert" className="ml-7 px-2 text-[11px] text-destructive">{renameError}</div>
      )}

      {!collapsed && (
        <div id={`project-sessions-${project.id}`}>
          <SessionTreeRows
            projectId={project.id}
            projectName={project.name}
            sessions={sessions}
            currentSessionId={currentSessionId}
            historyOnlyActions={historyOnlyActions}
            SessionRowComponent={SessionRowComponent}
            indicatorMap={indicatorMap}
            relativeTimeNow={relativeTimeNow}
            onSelectSession={onSelectSession}
            onRenameSession={onRenameSession}
            onTogglePinSession={onTogglePinSession}
            onToggleStarSession={onToggleStarSession}
            onCopySession={onCopySession}
            onToggleArchiveSession={onToggleArchiveSession}
            onDeleteSession={onDeleteSession}
          />
        </div>
      )}

      {error && (
        <div role="alert" className="ml-4 flex items-start gap-1.5 px-2 py-1 text-[11px] text-destructive">
          <AlertCircle size={12} className="mt-0.5 flex-shrink-0" aria-hidden="true" />
          <span>{error}</span>
        </div>
      )}
      {dropPosition === 'after' && (
        <div className="absolute -bottom-0.5 left-3 right-3 z-10 h-0.5 rounded-full bg-primary" />
      )}
    </li>
  )
}

function SessionTreeRows({
  projectId,
  projectName,
  sessions,
  currentSessionId,
  historyOnlyActions = false,
  alwaysShowAll = false,
  showProjectBadge = false,
  SessionRowComponent,
  indicatorMap,
  relativeTimeNow,
  onSelectSession,
  onRenameSession,
  onTogglePinSession,
  onToggleStarSession,
  onCopySession,
  onToggleArchiveSession,
  onDeleteSession,
}: {
  projectId: string
  projectName?: string
  sessions: readonly AgentSessionMeta[]
  currentSessionId?: string
  historyOnlyActions?: boolean
  alwaysShowAll?: boolean
  showProjectBadge?: boolean
  SessionRowComponent?: React.ComponentType<SharedProjectSessionRowProps>
  indicatorMap: ReadonlyMap<string, SessionIndicatorStatus>
  relativeTimeNow: number
  onSelectSession?: (projectId: string, sessionId: string) => void
  onRenameSession?: (projectId: string, sessionId: string, title: string) => void
  onTogglePinSession?: (projectId: string, sessionId: string) => void
  onToggleStarSession?: (projectId: string, sessionId: string) => void
  onCopySession?: (projectId: string, sessionId: string) => void
  onToggleArchiveSession?: (projectId: string, sessionId: string) => void
  onDeleteSession?: (projectId: string, sessionId: string) => void
}): React.ReactElement | null {
  const [extraCount, setExtraCount] = React.useState(0)
  const [expandedDelegationIds, setExpandedDelegationIds] = React.useState<Set<string>>(new Set())
  if (!SessionRowComponent || sessions.length === 0) return null

  const trees = buildAgentSessionTrees(sessions)
  const selection = alwaysShowAll
    ? { visible: trees, hiddenCount: 0 }
    : selectVisibleAgentSessionTrees({
        trees,
        indicatorMap,
        currentSessionId,
        now: relativeTimeNow,
        extraCount,
      })
  const visible = selection.visible
  const hiddenCount = selection.hiddenCount

  return (
    <div
      aria-label={`${projectName ?? projectId} 的项目会话`}
      className="ml-4 flex flex-col gap-0.5"
    >
      {visible.map((tree) => {
        const status = getSessionTreeStatus(tree, indicatorMap)
        const selected = treeContainsSessionId(tree, currentSessionId)
        const expanded = expandedDelegationIds.has(tree.session.id)
          || tree.childSessions.some((child) => child.id === currentSessionId)
        return (
          <div key={tree.session.id} className="flex flex-col gap-0.5">
            <SessionRowComponent
              session={tree.session}
              active={selected}
              indicatorStatus={status}
              showPinIcon={!!tree.session.pinned}
              delegationSummary={tree.childSessions.length > 0 ? {
                total: tree.childSessions.length,
                completed: countCompletedDelegatedChildren(tree.childSessions),
                expanded,
                onToggle: () => setExpandedDelegationIds((previous) => {
                  const next = new Set(previous)
                  if (expanded) next.delete(tree.session.id)
                  else next.add(tree.session.id)
                  return next
                }),
              } : undefined}
              leftAccent={status === 'blocked'
                ? 'orange'
                : status === 'running'
                  ? 'blue'
                  : status === 'completed'
                    ? 'green'
                    : undefined}
              relativeTimeNow={relativeTimeNow}
              workspaceName={showProjectBadge ? projectName : undefined}
              transferLabel="复制到其他项目"
              historyOnlyActions={historyOnlyActions}
              onSelect={() => onSelectSession?.(projectId, tree.session.id)}
              onRequestDelete={() => onDeleteSession?.(projectId, tree.session.id)}
              onRequestMove={() => onCopySession?.(projectId, tree.session.id)}
              onRename={async (_id, title) => onRenameSession?.(projectId, tree.session.id, title)}
              onTogglePin={async () => onTogglePinSession?.(projectId, tree.session.id)}
              onToggleStar={async () => onToggleStarSession?.(projectId, tree.session.id)}
              onToggleArchive={async () => onToggleArchiveSession?.(projectId, tree.session.id)}
            />

            {expanded && tree.childSessions.length > 0 && (
              <div className="ml-3 flex flex-col gap-0.5 border-l border-foreground/10 pl-2">
                {tree.childSessions.map((child) => (
                  <SessionRowComponent
                    key={child.id}
                    session={child}
                    active={child.id === currentSessionId}
                    indicatorStatus={indicatorMap.get(child.id) ?? 'idle'}
                    showPinIcon={!!child.pinned}
                    relativeTimeNow={relativeTimeNow}
                    workspaceName={showProjectBadge ? projectName : undefined}
                    transferLabel="复制到其他项目"
                    historyOnlyActions={historyOnlyActions}
                    onSelect={() => onSelectSession?.(projectId, child.id)}
                    onRequestDelete={() => onDeleteSession?.(projectId, child.id)}
                    onRequestMove={() => onCopySession?.(projectId, child.id)}
                    onRename={async (_id, title) => onRenameSession?.(projectId, child.id, title)}
                    onTogglePin={async () => onTogglePinSession?.(projectId, child.id)}
                    onToggleStar={async () => onToggleStarSession?.(projectId, child.id)}
                    onToggleArchive={async () => onToggleArchiveSession?.(projectId, child.id)}
                  />
                ))}
              </div>
            )}
          </div>
        )
      })}
      {hiddenCount > 0 && (
        <button
          type="button"
          onClick={() => setExtraCount((count) => count + SESSION_EXPAND_STEP)}
          className="ml-2 rounded px-2 py-1 text-left text-[11px] text-foreground/45 hover:bg-foreground/[0.04] hover:text-foreground/65"
        >
          显示更多 ({hiddenCount})
        </button>
      )}
    </div>
  )
}

function ArchiveSection({
  title,
  children,
}: React.PropsWithChildren<{ title: string }>): React.ReactElement {
  return (
    <section className="mb-3">
      <h3 className="px-2 pb-1 text-[11px] font-medium text-foreground/40">{title}</h3>
      <div className="flex flex-col gap-1">{children}</div>
    </section>
  )
}

function HistoryProjectGroup({
  label,
  missing = false,
  onOpen,
  children,
}: React.PropsWithChildren<{
  label: string
  missing?: boolean
  onOpen: () => void
}>): React.ReactElement {
  const [collapsed, setCollapsed] = React.useState(false)
  return (
    <div className="flex flex-col gap-0.5">
      <div className="group/project relative flex items-center">
        <button
          type="button"
          aria-label={`${collapsed ? '展开' : '折叠'}项目 ${label}`}
          aria-expanded={!collapsed}
          onClick={() => setCollapsed((value) => !value)}
          className="absolute left-1 z-10 flex size-5 items-center justify-center rounded text-foreground/40 opacity-0 group-hover/project:opacity-100"
        >
          <ChevronRight
            size={13}
            className={`transition-transform ${collapsed ? '-rotate-90' : 'rotate-90'}`}
          />
        </button>
        <button
          type="button"
          onClick={onOpen}
          className="flex min-w-0 flex-1 items-center gap-1 rounded-md py-1 pl-[9px] pr-1 text-left text-foreground/65 transition-[padding,background-color] hover:bg-foreground/[0.025] group-hover/project:pl-7"
        >
          {missing
            ? <FolderX size={13} className="shrink-0 text-destructive/60" />
            : <FolderOpen size={13} className="shrink-0 text-foreground/40" />}
          <span className="truncate text-[13px] font-medium leading-[18px]">{label}</span>
        </button>
      </div>
      {!collapsed && children}
    </div>
  )
}
