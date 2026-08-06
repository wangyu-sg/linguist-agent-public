import * as React from 'react'
import { useAtomValue, useSetAtom, useStore } from 'jotai'
import type {
  LinguistIpcError,
  LinguistIpcResult,
  LinguistProjectGetSummaryRequest,
  LinguistProjectInfo,
  LinguistProjectOpenRequest,
  LinguistProjectOpenResult,
  LinguistProjectSummary,
} from '@proma/shared'
import {
  activeTabIdAtom,
  closeTab,
  createLocalizationProjectTabId,
  projectCurrentAgentSessionIdMapAtom,
  tabsAtom,
} from '@/atoms/tab-atoms'
import { SegmentEditor } from './SegmentEditor'
import { AssetNavigator } from './AssetNavigator'
import { LinguistBottomDock } from './LinguistBottomDock'
import { ProjectAgentRail } from './ProjectAgentRail'
import {
  LinguistWorkbenchShell,
  type WorkbenchSummaryState,
} from './LinguistWorkbenchShell'
import { describeLinguistIpcError } from './project-utils'
import { refreshLinguistProjectListAtom } from './project-list-atoms'
import {
  clearLinguistWorkbenchUiStateAtom,
  disposeLinguistWorkbenchAtomFamiliesAtom,
} from './cat-workspace-atoms'
import {
  getProjectMutationRefreshPlan,
  linguistProjectMutationStateAtomFamily,
  reduceProjectMutation,
  replayProjectMutations,
  subscribeToProjectMutations,
} from './project-mutation-atoms'
import {
  ProjectRunSummary,
  linguistProjectRunSummaryAtomFamily,
} from './ProjectRunSummary'

interface LoadingState {
  status: 'loading'
}

interface ReadyState {
  status: 'ready'
  project: LinguistProjectInfo
}

interface ErrorState {
  status: 'error'
  error: LinguistIpcError
}

export type LocalizationProjectWorkbenchState = LoadingState | ReadyState | ErrorState

type OpenProject = (
  request: LinguistProjectOpenRequest,
) => Promise<LinguistIpcResult<LinguistProjectOpenResult>>

type GetProjectSummary = (
  request: LinguistProjectGetSummaryRequest,
) => Promise<LinguistIpcResult<LinguistProjectSummary>>

export async function loadLocalizationProjectWorkbench(
  projectId: string,
  openProject: OpenProject = (request) => window.electronAPI.linguistProjectsOpen(request),
): Promise<LocalizationProjectWorkbenchState> {
  try {
    const result = await openProject({ projectId })
    return result.ok
      ? { status: 'ready', project: result.data.project }
      : { status: 'error', error: result.error }
  } catch {
    return {
      status: 'error',
      error: { code: 'INTERNAL', message: '与主进程通信异常' },
    }
  }
}

export async function loadLocalizationProjectSummary(
  projectId: string,
  getSummary: GetProjectSummary = (request) =>
    window.electronAPI.linguistProjectsGetSummary(request),
): Promise<WorkbenchSummaryState> {
  try {
    const result = await getSummary({ projectId })
    return result.ok
      ? { status: 'ready', summary: result.data }
      : { status: 'error' }
  } catch {
    return { status: 'error' }
  }
}

export function LocalizationProjectWorkbench({
  projectId,
}: {
  projectId: string
}): React.ReactElement {
  const store = useStore()
  const refreshProjectList = useSetAtom(refreshLinguistProjectListAtom)
  const clearWorkbenchUiState = useSetAtom(clearLinguistWorkbenchUiStateAtom)
  const disposeWorkbenchAtoms = useSetAtom(disposeLinguistWorkbenchAtomFamiliesAtom)
  const mutationAtom = linguistProjectMutationStateAtomFamily(projectId)
  const mutationState = useAtomValue(mutationAtom)
  const setMutationState = useSetAtom(mutationAtom)
  const currentAgentSessionId = useAtomValue(projectCurrentAgentSessionIdMapAtom).get(projectId)
  const mutationRefreshPlan = getProjectMutationRefreshPlan(mutationState)
  const [state, setState] = React.useState<LocalizationProjectWorkbenchState>({
    status: 'loading',
  })
  const [retryToken, setRetryToken] = React.useState(0)
  const [summaryRefreshToken, setSummaryRefreshToken] = React.useState(0)
  const [summaryState, setSummaryState] = React.useState<WorkbenchSummaryState>({
    status: 'loading',
  })
  const handledSummaryMutationRevisions = React.useRef(new Map<string, number>())
  const invalidateSummary = React.useCallback((): void => {
    setSummaryRefreshToken((current) => current + 1)
  }, [])

  React.useEffect(() => {
    let cancelled = false
    let syncing = false
    let resync = false
    const synchronize = async (): Promise<void> => {
      if (syncing) {
        resync = true
        return
      }
      syncing = true
      try {
        do {
          resync = false
          const replayed = await replayProjectMutations(projectId, store.get(mutationAtom))
          if (!cancelled) {
            setMutationState((current) =>
              current.lastSequence > replayed.lastSequence
                ? current
                : {
                    ...replayed,
                    lastRevision: Math.max(current.lastRevision, replayed.lastRevision),
                  })
          }
        } while (resync && !cancelled)
      } finally {
        syncing = false
      }
    }
    const unsubscribe = subscribeToProjectMutations(projectId, (event) => {
      if (event.sequence !== undefined) {
        void synchronize().catch(() => {
          if (!cancelled) {
            setMutationState((current) => reduceProjectMutation(projectId, current, event))
          }
        })
        return
      }
      setMutationState((current) => reduceProjectMutation(projectId, current, event))
    })
    void synchronize().catch(() => {})
    return () => {
      cancelled = true
      unsubscribe()
    }
  }, [mutationAtom, projectId, setMutationState, store])

  React.useEffect(() => () => {
    disposeWorkbenchAtoms(projectId)
    linguistProjectMutationStateAtomFamily.remove(projectId)
    linguistProjectRunSummaryAtomFamily.remove(projectId)
  }, [disposeWorkbenchAtoms, projectId])

  React.useEffect(() => {
    const lastHandledRevision = handledSummaryMutationRevisions.current.get(projectId)
    if (lastHandledRevision === undefined) {
      handledSummaryMutationRevisions.current.set(projectId, mutationState.lastRevision)
      return
    }
    if (
      mutationState.latest === undefined
      || mutationState.lastRevision <= lastHandledRevision
    ) return
    handledSummaryMutationRevisions.current.set(projectId, mutationState.lastRevision)
    if (mutationRefreshPlan.summary) invalidateSummary()
  }, [invalidateSummary, mutationRefreshPlan.summary, mutationState, projectId])

  React.useEffect(() => {
    let cancelled = false
    setState({ status: 'loading' })
    void loadLocalizationProjectWorkbench(projectId).then((nextState) => {
      if (!cancelled) setState(nextState)
    })
    return () => {
      cancelled = true
    }
  }, [projectId, retryToken])

  React.useEffect(() => {
    if (state.status !== 'ready') return
    let cancelled = false
    setSummaryState({ status: 'loading' })
    void loadLocalizationProjectSummary(projectId).then((nextSummaryState) => {
      if (!cancelled) setSummaryState(nextSummaryState)
    })
    return () => {
      cancelled = true
    }
  }, [projectId, state.status, summaryRefreshToken])

  if (state.status === 'loading') {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        正在打开本地化项目…
      </div>
    )
  }

  if (state.status === 'error') {
    return (
      <div role="alert" className="flex h-full flex-col items-center justify-center gap-3 text-center">
        <p className="text-sm font-medium text-foreground">项目打开失败</p>
        <p className="max-w-md text-xs text-muted-foreground">
          {describeLinguistIpcError(state.error)}
        </p>
        <button
          type="button"
          onClick={() => setRetryToken((current) => current + 1)}
          className="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90"
        >
          重试
        </button>
      </div>
    )
  }

  const currentProject = summaryState.status === 'ready'
    ? summaryState.summary.project
    : state.project

  return (
    <LinguistWorkbenchShell
      project={currentProject}
      summaryState={summaryState}
      onSummaryRefresh={invalidateSummary}
      onProjectArchived={(project) => {
        setState({ status: 'ready', project })
        refreshProjectList()
        invalidateSummary()
      }}
      onProjectDeleted={(deletedProjectId) => {
        clearWorkbenchUiState(deletedProjectId)
        linguistProjectMutationStateAtomFamily.remove(deletedProjectId)
        refreshProjectList()
        const closed = closeTab(
          store.get(tabsAtom),
          store.get(activeTabIdAtom),
          createLocalizationProjectTabId(deletedProjectId),
        )
        store.set(tabsAtom, closed.tabs)
        store.set(activeTabIdAtom, closed.activeTabId)
      }}
      assetNavigator={(
        <AssetNavigator
          projectId={state.project.id}
          summary={summaryState.status === 'ready' ? summaryState.summary : undefined}
        />
      )}
      agentRail={(
        <ProjectAgentRail
          projectId={currentProject.id}
          projectName={currentProject.name}
          executionPolicy={currentProject.executionPolicy}
          assets={summaryState.status === 'ready' ? summaryState.summary.assets : []}
        />
      )}
      bottomDock={(
        <LinguistBottomDock
          projectId={state.project.id}
          assets={summaryState.status === 'ready' ? summaryState.summary.assets : []}
          archived={state.project.archivedAt !== undefined}
          proposalCoverage={summaryState.status === 'ready'
            ? {
                workflowStage: summaryState.summary.project.workflowStage ?? 'translation',
                totalSegments: summaryState.summary.totalSegments,
                confirmedSegments: summaryState.summary.currentStageCounts.confirmed,
              }
            : undefined}
          onProjectChanged={invalidateSummary}
        />
      )}
    >
      <div className="flex h-full min-h-0 flex-col">
        <ProjectRunSummary
          projectId={currentProject.id}
          sessionId={currentAgentSessionId}
          archived={currentProject.archivedAt !== undefined}
          refreshSequence={mutationState.lastSequence}
        />
        <div className="min-h-0 flex-1">
          <SegmentEditor
            projectId={currentProject.id}
            archived={currentProject.archivedAt !== undefined}
            workflowStage={currentProject.workflowStage ?? 'translation'}
            onProjectSummaryInvalidated={invalidateSummary}
          />
        </div>
      </div>
    </LinguistWorkbenchShell>
  )
}
