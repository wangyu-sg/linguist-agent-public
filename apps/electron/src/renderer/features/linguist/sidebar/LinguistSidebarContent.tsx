import * as React from 'react'
import { useAtomValue, useSetAtom, useStore } from 'jotai'
import { toast } from 'sonner'
import {
  AlertCircle,
  FolderOpen,
  Languages,
  Loader2,
  MessageSquare,
  Plus,
  RefreshCw,
} from 'lucide-react'
import type { AgentSessionMeta, LinguistProjectInfo } from '@proma/shared'
import { agentSessionsAtom } from '@/atoms/agent-atoms'
import { activeViewAtom } from '@/atoms/active-view'
import {
  activeTabAtom,
  projectCurrentAgentSessionIdMapAtom,
} from '@/atoms/tab-atoms'
import {
  linguistProjectListStateAtom,
  refreshLinguistProjectListAtom,
  type LinguistProjectListState,
} from '../projects/project-list-atoms'
import { describeLinguistIpcError } from '../projects/project-utils'
import { openLocalizationProject } from '../projects/open-localization-project'
import {
  registerCreatedProjectSession,
  selectProjectAgentSession,
} from '../projects/project-agent-session'

export {
  registerCreatedProjectSession,
  selectProjectAgentSession,
} from '../projects/project-agent-session'

interface LinguistSidebarContentViewProps {
  state: LinguistProjectListState
  onRetry: () => void
  activeProjectId?: string | null
  onOpenProject: (projectId: string) => void
  sessions?: readonly AgentSessionMeta[]
  currentSessionIds?: ReadonlyMap<string, string>
  projectManagementActive?: boolean
  creatingProjectId?: string | null
  sessionError?: { projectId: string; message: string } | null
  onOpenProjectManagement?: () => void
  onSelectSession?: (projectId: string, sessionId: string) => void
  onCreateSession?: (projectId: string) => void
}

/** LF-021：Linguist 模式专属侧栏内容，不复刻 Agent / Chat 会话树。 */
export function LinguistSidebarContentView({
  state,
  onRetry,
  activeProjectId = null,
  onOpenProject,
  sessions = [],
  currentSessionIds = new Map(),
  projectManagementActive = false,
  creatingProjectId = null,
  sessionError = null,
  onOpenProjectManagement,
  onSelectSession,
  onCreateSession,
}: LinguistSidebarContentViewProps): React.ReactElement {
  const projects = state.status === 'ready'
    ? state.projects.filter((project) => project.archivedAt === undefined)
    : []

  return (
    <div className="flex min-h-0 flex-1 flex-col titlebar-no-drag">
      <div className="flex items-center gap-2 px-4 pb-2 pt-3">
        <Languages size={15} className="text-primary/75" aria-hidden="true" />
        <h2 className="text-[13px] font-medium text-foreground/65">本地化项目</h2>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-3 scrollbar-thin">
        {state.status === 'loading' && (
          <div
            aria-label="正在加载本地化项目"
            aria-busy="true"
            className="flex flex-col gap-1.5 px-2"
          >
            {[0, 1, 2].map((item) => (
              <div key={item} className="h-12 animate-pulse rounded-[10px] bg-foreground/[0.045]" />
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

        {state.status === 'ready' && projects.length === 0 && (
          <div className="mx-2 flex flex-col items-center gap-2 rounded-xl bg-foreground/[0.025] px-4 py-8 text-center">
            <FolderOpen size={22} className="text-foreground/30" aria-hidden="true" />
            <p className="text-[13px] font-medium text-foreground/60">暂无本地化项目</p>
            <p className="text-xs leading-5 text-foreground/40">可从下方“管理项目”入口创建或管理项目。</p>
          </div>
        )}

        {state.status === 'ready' && projects.length > 0 && (
          <ul aria-label="本地化项目" className="flex flex-col gap-1">
            {projects.map((project) => (
              <ProjectRow
                key={project.id}
                project={project}
                active={project.id === activeProjectId}
                onOpen={onOpenProject}
                sessions={sessions.filter(
                  (session) =>
                    session.linguistProjectId === project.id && session.archived !== true,
                )}
                currentSessionId={currentSessionIds.get(project.id)}
                creating={creatingProjectId === project.id}
                error={sessionError?.projectId === project.id ? sessionError.message : null}
                onSelectSession={onSelectSession}
                onCreateSession={onCreateSession}
              />
            ))}
          </ul>
        )}

        {/* LF-025：日常打开项目仍直达 Editor；管理操作保留为次级入口。 */}
        <div className="mx-2 mt-3 border-t border-border/50 pt-2">
          <button
            type="button"
            aria-label="管理项目"
            aria-current={projectManagementActive ? 'page' : undefined}
            onClick={onOpenProjectManagement}
            className={`flex w-full items-center gap-2.5 rounded-[10px] px-3 py-2 text-left text-[13px] transition-colors ${
              projectManagementActive
                ? 'bg-primary/[0.12] text-foreground'
                : 'text-foreground/60 hover:bg-foreground/[0.06] hover:text-foreground'
            }`}
          >
            <FolderOpen size={14} aria-hidden="true" />
            <span>管理项目</span>
          </button>
        </div>
      </div>
    </div>
  )
}

export function LinguistSidebarContent(): React.ReactElement {
  const state = useAtomValue(linguistProjectListStateAtom)
  const refresh = useSetAtom(refreshLinguistProjectListAtom)
  const activeView = useAtomValue(activeViewAtom)
  const setActiveView = useSetAtom(activeViewAtom)
  const activeTab = useAtomValue(activeTabAtom)
  const sessions = useAtomValue(agentSessionsAtom)
  const currentSessionIds = useAtomValue(projectCurrentAgentSessionIdMapAtom)
  const store = useStore()
  const [creatingProjectId, setCreatingProjectId] = React.useState<string | null>(null)
  const [sessionError, setSessionError] = React.useState<{
    projectId: string
    message: string
  } | null>(null)
  const activeProjectId = activeTab?.type === 'linguist-project' ? activeTab.projectId : null
  const handleOpenProjectManagement = React.useCallback((): void => {
    setActiveView('projects')
  }, [setActiveView])
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

  const handleSelectSession = React.useCallback(async (
    projectId: string,
    sessionId: string,
  ): Promise<void> => {
    setSessionError(null)
    try {
      if (activeProjectId !== projectId) {
        const opened = await openLocalizationProject(store, projectId)
        if (!opened.ok) {
          setSessionError({
            projectId,
            message: describeLinguistIpcError(opened.error),
          })
          return
        }
      }
      if (!selectProjectAgentSession(store, projectId, sessionId)) {
        setSessionError({ projectId, message: '项目会话已归档、丢失或绑定不一致' })
      }
    } catch {
      setSessionError({ projectId, message: '与主进程通信异常（INTERNAL）' })
    }
  }, [activeProjectId, store])

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
          setSessionError({
            projectId,
            message: describeLinguistIpcError(opened.error),
          })
          return
        }
      }
      const result = await window.electronAPI.linguistSessionsCreateForProject({ projectId })
      if (!result.ok) {
        setSessionError({
          projectId,
          message: describeLinguistIpcError(result.error),
        })
        return
      }
      if (!registerCreatedProjectSession(store, projectId, result.data)) {
        setSessionError({ projectId, message: '项目会话绑定不一致' })
      }
    } catch {
      setSessionError({ projectId, message: '与主进程通信异常（INTERNAL）' })
    } finally {
      setCreatingProjectId(null)
    }
  }, [
    activeProjectId,
    creatingProjectId,
    store,
  ])

  return (
    <LinguistSidebarContentView
      state={state}
      onRetry={refresh}
      activeProjectId={activeProjectId}
      projectManagementActive={activeView === 'projects'}
      onOpenProject={handleOpenProject}
      onOpenProjectManagement={handleOpenProjectManagement}
      sessions={sessions}
      currentSessionIds={currentSessionIds}
      creatingProjectId={creatingProjectId}
      sessionError={sessionError}
      onSelectSession={(projectId, sessionId) => {
        void handleSelectSession(projectId, sessionId)
      }}
      onCreateSession={(projectId) => {
        void handleCreateSession(projectId)
      }}
    />
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
  onSelectSession,
  onCreateSession,
}: {
  project: LinguistProjectInfo
  active: boolean
  onOpen: (projectId: string) => void
  sessions: readonly AgentSessionMeta[]
  currentSessionId?: string
  creating: boolean
  error: string | null
  onSelectSession?: (projectId: string, sessionId: string) => void
  onCreateSession?: (projectId: string) => void
}): React.ReactElement {
  return (
    <li className="flex flex-col gap-0.5">
      <div className={`flex items-center rounded-[10px] transition-colors ${
        active
          ? 'bg-primary/[0.12] text-foreground'
          : 'text-foreground/75 hover:bg-foreground/[0.06]'
      }`}
      >
        <button
          type="button"
          aria-label={`打开项目 ${project.name}`}
          aria-current={active ? 'page' : undefined}
          onClick={() => onOpen(project.id)}
          className="flex min-w-0 flex-1 items-center gap-2.5 px-3 py-2.5 text-left"
        >
          <span className="flex size-7 flex-shrink-0 items-center justify-center rounded-lg bg-primary/[0.08] text-primary/70">
            <FolderOpen size={14} aria-hidden="true" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[13px] font-medium">
              {project.name}
            </span>
            <span className="block truncate font-mono text-[11px] text-foreground/60">
              {project.sourceLocale} → {project.targetLocale}
            </span>
          </span>
        </button>
        <button
          type="button"
          aria-label={`在项目 ${project.name} 中新建会话`}
          aria-busy={creating || undefined}
          disabled={creating}
          onClick={() => onCreateSession?.(project.id)}
          className="mr-2 flex size-7 flex-shrink-0 items-center justify-center rounded-md text-foreground/45 hover:bg-foreground/[0.08] hover:text-foreground disabled:cursor-wait disabled:opacity-50"
        >
          {creating
            ? <Loader2 size={13} className="animate-spin" aria-hidden="true" />
            : <Plus size={14} aria-hidden="true" />}
        </button>
      </div>

      {sessions.length > 0 && (
        <ul aria-label={`${project.name} 的项目会话`} className="ml-9 flex flex-col gap-0.5">
          {sessions.map((session) => {
            const selected = session.id === currentSessionId
            return (
              <li key={session.id}>
                <button
                  type="button"
                  aria-label={`选择会话 ${session.title}`}
                  aria-current={selected || undefined}
                  onClick={() => onSelectSession?.(project.id, session.id)}
                  className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-xs transition-colors ${
                    selected
                      ? 'bg-primary/[0.1] text-foreground'
                      : 'text-foreground/55 hover:bg-foreground/[0.05] hover:text-foreground/75'
                  }`}
                >
                  <MessageSquare size={12} className="flex-shrink-0" aria-hidden="true" />
                  <span className="min-w-0 flex-1 truncate">{session.title}</span>
                  {session.linguistSessionRole === 'reviewer' && (
                    <span className="flex-shrink-0 rounded-full bg-review/10 px-1.5 py-0.5 text-[10px] text-review">
                      评审
                    </span>
                  )}
                  {session.linguistSessionRole === 'auditor' && (
                    <span className="flex-shrink-0 rounded-full bg-primary/10 px-1.5 py-0.5 text-[10px] text-primary">
                      盲审
                    </span>
                  )}
                </button>
              </li>
            )
          })}
        </ul>
      )}

      {error && (
        <div role="alert" className="ml-9 flex items-start gap-1.5 px-2 py-1 text-[11px] text-destructive">
          <AlertCircle size={12} className="mt-0.5 flex-shrink-0" aria-hidden="true" />
          <span>{error}</span>
        </div>
      )}
    </li>
  )
}
