import * as React from 'react'
import { useAtomValue } from 'jotai'
import { AlertTriangle, Loader2 } from 'lucide-react'
import type {
  LinguistIpcError,
  LinguistSegmentInfo,
  LinguistTermMatchInfo,
  LinguistTermMatchType,
} from '@proma/shared'
import {
  linguistTargetEditorCapabilityAtomFamily,
  type LinguistTargetEditorCapability,
} from './cat-workspace-atoms'
import {
  getProjectMutationRefreshPlan,
  linguistProjectMutationStateAtomFamily,
} from './project-mutation-atoms'
import { describeLinguistIpcError } from './project-utils'
import { TERM_STATUS_LABELS } from './ReferenceManager'
import {
  getTmActionDisabledReason,
  tmStateMatchesActiveSegment,
  type TmEditorActionResult,
} from './TmMatchPanel'

interface TermMatchIdentity {
  projectId: string
  segmentId: string
}

type TermMatchState =
  | { status: 'idle' }
  | ({ status: 'loading' } & TermMatchIdentity)
  | ({ status: 'error'; error: LinguistIpcError } & TermMatchIdentity)
  | ({
      status: 'ready'
      segment: LinguistSegmentInfo
      matches: LinguistTermMatchInfo[]
    } & TermMatchIdentity)

const TERM_MATCH_LABELS: Record<LinguistTermMatchType, string> = {
  exact: 'Exact',
  contains: 'Contains',
}

export function termStateMatchesActiveContext(
  loadedProjectId: string,
  loadedSegmentId: string,
  activeProjectId: string,
  activeSegmentId: string | undefined,
): boolean {
  return activeProjectId.trim() !== ''
    && activeSegmentId?.trim() !== ''
    && loadedProjectId === activeProjectId
    && tmStateMatchesActiveSegment(loadedSegmentId, activeSegmentId)
}

export function getTermInsertDisabledReason({
  projectId,
  activeSegmentId,
  capability,
  locked,
  archived,
}: {
  projectId: string
  activeSegmentId: string | undefined
  capability?: LinguistTargetEditorCapability
  locked: boolean
  archived: boolean
}): string | undefined {
  if (projectId.trim() === '') return '项目不可用，不能修改译文草稿'
  if (activeSegmentId === undefined || activeSegmentId.trim() === '') {
    return '请先选择当前片段'
  }
  return getTmActionDisabledReason({
    activeSegmentId,
    capability,
    locked,
    archived,
  })
}

export function applyTermMatchToEditor({
  projectId,
  activeSegmentId,
  match,
  capability,
  locked,
  archived,
}: {
  projectId: string
  activeSegmentId: string | undefined
  match: LinguistTermMatchInfo
  capability?: LinguistTargetEditorCapability
  locked: boolean
  archived: boolean
}): TmEditorActionResult {
  if (
    getTermInsertDisabledReason({
      projectId,
      activeSegmentId,
      capability,
      locked,
      archived,
    }) !== undefined
    || capability === undefined
  ) {
    return 'unavailable'
  }
  if (!capability.handle.insert(match.translation)) return 'rejected'
  capability.handle.focus()
  return 'applied'
}

export function TermMatchPanel({
  projectId,
  activeSegmentId,
  archived,
}: {
  projectId: string
  activeSegmentId?: string
  archived: boolean
}): React.ReactElement {
  const capability = useAtomValue(linguistTargetEditorCapabilityAtomFamily(projectId))
  const projectMutationState = useAtomValue(
    linguistProjectMutationStateAtomFamily(projectId),
  )
  const [state, setState] = React.useState<TermMatchState>({ status: 'idle' })
  const [mutationRefreshToken, setMutationRefreshToken] = React.useState(0)
  const handledMutationRevisions = React.useRef(new Map<string, number>())

  React.useEffect(() => {
    const lastHandledRevision = handledMutationRevisions.current.get(projectId)
    if (lastHandledRevision === undefined) {
      handledMutationRevisions.current.set(projectId, projectMutationState.lastRevision)
      return
    }
    if (
      projectMutationState.latest === undefined
      || projectMutationState.lastRevision <= lastHandledRevision
    ) return
    handledMutationRevisions.current.set(projectId, projectMutationState.lastRevision)
    const refreshPlan = getProjectMutationRefreshPlan(projectMutationState)
    if (
      refreshPlan.context
      && (
        refreshPlan.resources
        || refreshPlan.segmentIds.length === 0
        || (
          activeSegmentId !== undefined
          && refreshPlan.segmentIds.includes(activeSegmentId)
        )
      )
    ) {
      setMutationRefreshToken((current) => current + 1)
    }
  }, [activeSegmentId, projectId, projectMutationState])

  React.useEffect(() => {
    if (
      projectId.trim() === ''
      || activeSegmentId === undefined
      || activeSegmentId.trim() === ''
    ) {
      setState({ status: 'idle' })
      return
    }
    let cancelled = false
    const identity = { projectId, segmentId: activeSegmentId }
    setState({ status: 'loading', ...identity })
    void window.electronAPI.linguistCatGetContext(identity).then((result) => {
      if (cancelled) return
      if (!result.ok) {
        setState({ status: 'error', ...identity, error: result.error })
        return
      }
      setState({
        status: 'ready',
        ...identity,
        segment: result.data.segment,
        matches: result.data.termMatches,
      })
    }).catch(() => {
      if (!cancelled) {
        setState({
          status: 'error',
          ...identity,
          error: { code: 'INTERNAL', message: '与主进程通信异常' },
        })
      }
    })
    return () => {
      cancelled = true
    }
  }, [activeSegmentId, mutationRefreshToken, projectId])

  if (projectId.trim() === '') {
    return (
      <p role="alert" className="text-xs text-destructive">
        项目不可用，无法读取术语匹配
      </p>
    )
  }
  if (
    activeSegmentId === undefined
    || activeSegmentId.trim() === ''
    || state.status === 'idle'
  ) {
    return <p className="text-xs text-muted-foreground">选择一个片段查看术语匹配</p>
  }
  if (
    state.status === 'loading'
    || !termStateMatchesActiveContext(
      state.projectId,
      state.segmentId,
      projectId,
      activeSegmentId,
    )
  ) {
    return (
      <div aria-live="polite" className="flex items-center gap-2 text-xs text-muted-foreground">
        <Loader2 aria-hidden="true" size={13} className="animate-spin" />
        正在读取术语匹配…
      </div>
    )
  }
  if (state.status === 'error') {
    return (
      <div role="alert" className="flex items-start gap-2 text-xs text-destructive">
        <AlertTriangle aria-hidden="true" size={13} className="mt-0.5 shrink-0" />
        {describeLinguistIpcError(state.error)}
      </div>
    )
  }
  return (
    <TermMatchView
      projectId={projectId}
      activeSegmentId={activeSegmentId}
      segment={state.segment}
      matches={state.matches}
      capability={capability}
      archived={archived}
    />
  )
}

export function TermMatchView({
  projectId,
  activeSegmentId,
  segment,
  matches,
  capability,
  archived,
}: {
  projectId: string
  activeSegmentId: string
  segment: LinguistSegmentInfo
  matches: readonly LinguistTermMatchInfo[]
  capability?: LinguistTargetEditorCapability
  archived: boolean
}): React.ReactElement {
  const [message, setMessage] = React.useState<{
    kind: 'status' | 'alert'
    text: string
  }>()
  const disabledReason = getTermInsertDisabledReason({
    projectId,
    activeSegmentId,
    capability,
    locked: segment.locked,
    archived,
  })
  const reasonId = `term-insert-reason-${projectId}-${activeSegmentId}`

  const insert = (match: LinguistTermMatchInfo): void => {
    const result = applyTermMatchToEditor({
      projectId,
      activeSegmentId,
      match,
      capability,
      locked: segment.locked,
      archived,
    })
    if (result === 'applied') {
      setMessage({
        kind: 'status',
        text: '已插入当前未保存草稿',
      })
    } else if (result === 'rejected') {
      setMessage({
        kind: 'alert',
        text: '编辑器保护规则阻止了操作，草稿未修改',
      })
    } else {
      setMessage({
        kind: 'alert',
        text: disabledReason ?? '当前 Target Editor 不可用',
      })
    }
  }

  if (matches.length === 0) {
    return <p className="text-xs text-muted-foreground">当前片段无术语匹配</p>
  }

  return (
    <div className="min-h-0 overflow-auto pb-2">
      {disabledReason !== undefined && (
        <p id={reasonId} className="mb-2 text-[11px] text-muted-foreground">
          {disabledReason}
        </p>
      )}
      {message !== undefined && (
        <p
          role={message.kind}
          aria-live={message.kind === 'status' ? 'polite' : undefined}
          className={message.kind === 'alert'
            ? 'mb-2 text-[11px] text-destructive'
            : 'mb-2 text-[11px] text-success'}
        >
          {message.text}
        </p>
      )}
      <ul aria-label="当前片段术语匹配" className="space-y-2">
        {matches.map((match) => {
          const statusLabel = TERM_STATUS_LABELS[match.status]
          const matchLabel = TERM_MATCH_LABELS[match.matchType]
          const caseLabel = match.caseSensitive ? '区分大小写' : '不区分大小写'
          const conflictLabel = match.conflict ? '译文冲突' : '无冲突'
          const actionDescription =
            `${statusLabel} ${matchLabel} 术语 ${match.term} → ${match.translation}`
          return (
            <li
              key={match.id}
              className="grid gap-2 rounded-xl bg-foreground/[0.035] p-3 sm:grid-cols-[minmax(0,1fr)_auto]"
            >
              <div className="min-w-0 space-y-1.5">
                <div className="flex flex-wrap items-center gap-1">
                  <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-semibold text-primary">
                    {statusLabel}
                  </span>
                  <span className="rounded-full bg-foreground/[0.06] px-2 py-0.5 text-[10px] font-medium text-foreground/65">
                    {matchLabel}
                  </span>
                  <span className="text-[10px] text-muted-foreground">{caseLabel}</span>
                  <span
                    className={match.conflict
                      ? 'text-[10px] font-medium text-warning'
                      : 'text-[10px] text-muted-foreground'}
                  >
                    {conflictLabel}
                  </span>
                </div>
                <p className="break-words text-xs text-foreground/60">
                  <span className="sr-only">术语：</span>
                  {match.term}
                </p>
                <p className="break-words text-xs font-medium text-foreground">
                  <span className="sr-only">译文：</span>
                  {match.translation}
                </p>
                <p className="break-words text-[11px] text-muted-foreground">
                  <span className="sr-only">备注：</span>
                  {match.note?.trim() || '无备注'}
                </p>
              </div>
              <div className="flex items-start">
                <button
                  type="button"
                  disabled={disabledReason !== undefined}
                  aria-describedby={disabledReason === undefined ? undefined : reasonId}
                  aria-label={`插入${actionDescription}到当前译文草稿`}
                  title={disabledReason}
                  onClick={() => insert(match)}
                  className="rounded-md bg-primary px-2.5 py-1.5 text-[11px] font-medium text-primary-foreground hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  插入
                </button>
              </div>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
