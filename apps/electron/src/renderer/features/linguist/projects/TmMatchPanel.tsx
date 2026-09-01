import * as React from 'react'
import { useAtomValue } from 'jotai'
import { AlertTriangle, Loader2 } from 'lucide-react'
import type {
  LinguistIpcError,
  LinguistSegmentInfo,
  LinguistTmMatchClass,
  LinguistTmPanelItem,
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

type TmMatchState =
  | { status: 'idle' }
  | { status: 'loading'; segmentId: string }
  | { status: 'error'; segmentId: string; error: LinguistIpcError }
  | {
      status: 'ready'
      segmentId: string
      segment: LinguistSegmentInfo
      matches: LinguistTmPanelItem[]
    }

export type TmEditorAction = 'replace' | 'insert'
export type TmEditorActionResult = 'applied' | 'unavailable' | 'rejected'

const TM_MATCH_LABELS: Record<LinguistTmMatchClass, string> = {
  'double-context': '102 Context',
  context: '101 Context',
  exact: '100 Exact',
  'near-exact': 'Near Exact',
  fuzzy: 'Fuzzy',
}

export function tmStateMatchesActiveSegment(
  loadedSegmentId: string,
  activeSegmentId: string | undefined,
): boolean {
  return activeSegmentId !== undefined && loadedSegmentId === activeSegmentId
}

export function getTmActionDisabledReason({
  activeSegmentId,
  capability,
  locked,
  archived,
}: {
  activeSegmentId: string
  capability?: LinguistTargetEditorCapability
  locked: boolean
  archived: boolean
}): string | undefined {
  if (archived) return '项目已归档，不能修改译文草稿'
  if (locked) return '当前片段已锁定，不能修改译文草稿'
  if (capability?.segmentId !== activeSegmentId) {
    return '请先在 Segment Grid 中打开当前片段的 Target Editor'
  }
  return undefined
}

export function applyTmMatchToEditor({
  action,
  match,
  activeSegmentId,
  capability,
  locked,
  archived,
}: {
  action: TmEditorAction
  match: LinguistTmPanelItem
  activeSegmentId: string
  capability?: LinguistTargetEditorCapability
  locked: boolean
  archived: boolean
}): TmEditorActionResult {
  if (getTmActionDisabledReason({
    activeSegmentId,
    capability,
    locked,
    archived,
  }) !== undefined || capability === undefined) {
    return 'unavailable'
  }
  const applied = action === 'replace'
    ? capability.handle.replace(match.target)
    : capability.handle.insert(match.target)
  if (!applied) return 'rejected'
  capability.handle.focus()
  return 'applied'
}

export function TmMatchPanel({
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
  const [state, setState] = React.useState<TmMatchState>({ status: 'idle' })
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
    if (activeSegmentId === undefined) {
      setState({ status: 'idle' })
      return
    }
    let cancelled = false
    setState({ status: 'loading', segmentId: activeSegmentId })
    void window.electronAPI.linguistCatGetContext({
      projectId,
      segmentId: activeSegmentId,
    }).then((result) => {
      if (cancelled) return
      if (!result.ok) {
        setState({ status: 'error', segmentId: activeSegmentId, error: result.error })
        return
      }
      setState({
        status: 'ready',
        segmentId: activeSegmentId,
        segment: result.data.segment,
        matches: result.data.tm,
      })
    }).catch(() => {
      if (!cancelled) {
        setState({
          status: 'error',
          segmentId: activeSegmentId,
          error: { code: 'INTERNAL', message: '与主进程通信异常' },
        })
      }
    })
    return () => {
      cancelled = true
    }
  }, [activeSegmentId, mutationRefreshToken, projectId])

  if (activeSegmentId === undefined || state.status === 'idle') {
    return <p className="text-xs text-muted-foreground">选择一个片段查看 TM 匹配</p>
  }
  if (
    state.status === 'loading'
    || !tmStateMatchesActiveSegment(state.segmentId, activeSegmentId)
  ) {
    return (
      <div aria-live="polite" className="flex items-center gap-2 text-xs text-muted-foreground">
        <Loader2 aria-hidden="true" size={13} className="animate-spin" />
        正在读取 TM 匹配…
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
    <TmMatchView
      activeSegmentId={activeSegmentId}
      segment={state.segment}
      matches={state.matches}
      capability={capability}
      archived={archived}
    />
  )
}

export function TmMatchView({
  activeSegmentId,
  segment,
  matches,
  capability,
  archived,
}: {
  activeSegmentId: string
  segment: LinguistSegmentInfo
  matches: readonly LinguistTmPanelItem[]
  capability?: LinguistTargetEditorCapability
  archived: boolean
}): React.ReactElement {
  const [message, setMessage] = React.useState<{
    kind: 'status' | 'alert'
    text: string
  }>()
  const disabledReason = getTmActionDisabledReason({
    activeSegmentId,
    capability,
    locked: segment.locked,
    archived,
  })
  const reasonId = `tm-action-reason-${activeSegmentId}`

  const apply = (action: TmEditorAction, match: LinguistTmPanelItem): void => {
    const result = applyTmMatchToEditor({
      action,
      match,
      activeSegmentId,
      capability,
      locked: segment.locked,
      archived,
    })
    if (result === 'applied') {
      setMessage({
        kind: 'status',
        text: action === 'replace'
          ? '已替换当前未保存草稿'
          : '已插入当前未保存草稿',
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
    return <p className="text-xs text-muted-foreground">当前片段无 TM 匹配</p>
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
      <ul aria-label="当前片段 TM 匹配" className="space-y-2">
        {matches.map((match) => {
          const score = Math.round(Math.min(102, Math.max(0, match.score)))
          const origin = match.sourceLabel
          const actionDescription = `${score}% ${origin} ${TM_MATCH_LABELS[match.matchClass]} TM`
          return (
            <li
              key={match.id}
              className="grid gap-2 rounded-xl bg-foreground/[0.035] p-3 sm:grid-cols-[96px_minmax(0,1fr)_auto]"
            >
              <div className="flex flex-wrap content-start gap-1">
                <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-semibold text-primary">
                  {score}%
                </span>
                <span className="rounded-full bg-foreground/[0.06] px-2 py-0.5 text-[10px] font-medium text-foreground/65">
                  {TM_MATCH_LABELS[match.matchClass]}
                </span>
                <span className="w-full break-words text-[10px] text-muted-foreground">
                  {origin}
                </span>
                {match.provenanceCount > 1 && (
                  <span className="w-full text-[10px] text-muted-foreground">
                    {match.provenanceCount} 个来源
                  </span>
                )}
                {match.variantCount > 1 && (
                  <span className="w-full text-[10px] text-warning">
                    {match.variantCount} 个译文变体
                  </span>
                )}
                {match.safety === 'review' && (
                  <span className="w-full text-[10px] text-warning">
                    需人工审核
                  </span>
                )}
                {(match.warnings.length > 0 || match.differences.length > 0) && (
                  <span className="w-full break-words text-[10px] text-warning">
                    {[...match.warnings, ...match.differences].join(' · ')}
                  </span>
                )}
                {match.badges.length > 0 && (
                  <details className="w-full text-[10px] text-muted-foreground">
                    <summary className="cursor-pointer">匹配详情</summary>
                    <p className="mt-1 break-words whitespace-pre-wrap">{match.badges.join('\n')}</p>
                  </details>
                )}
              </div>
              <div className="min-w-0 space-y-1 text-xs">
                <p className="break-words text-foreground/55">
                  <span className="sr-only">Source：</span>
                  {match.matchedSource}
                </p>
                <p className="break-words font-medium text-foreground">
                  <span className="sr-only">Target：</span>
                  {match.target}
                </p>
              </div>
              <div className="flex items-start gap-1.5">
                <button
                  type="button"
                  disabled={disabledReason !== undefined}
                  aria-describedby={disabledReason === undefined ? undefined : reasonId}
                  aria-label={`使用 ${actionDescription} 替换当前译文草稿`}
                  title={disabledReason}
                  onClick={() => apply('replace', match)}
                  className="rounded-md bg-primary px-2.5 py-1.5 text-[11px] font-medium text-primary-foreground hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  替换
                </button>
                <button
                  type="button"
                  disabled={disabledReason !== undefined}
                  aria-describedby={disabledReason === undefined ? undefined : reasonId}
                  aria-label={`使用 ${actionDescription} 插入当前译文草稿`}
                  title={disabledReason}
                  onClick={() => apply('insert', match)}
                  className="rounded-md bg-foreground/[0.07] px-2.5 py-1.5 text-[11px] font-medium text-foreground hover:bg-foreground/[0.11] disabled:cursor-not-allowed disabled:opacity-40"
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
