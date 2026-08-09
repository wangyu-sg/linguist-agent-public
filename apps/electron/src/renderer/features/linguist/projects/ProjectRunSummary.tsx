import * as React from 'react'
import { atom } from 'jotai'
import { useAtom } from 'jotai/react'
import { atomFamily } from 'jotai/utils'
import type {
  LinguistIpcResult,
  LinguistLatestRunSummaryResult,
  LinguistRunChangeSummary,
  LinguistRunSummaryRequest,
  LinguistRunUndoRequest,
  LinguistRunUndoResult,
} from '@proma/shared'
import { Button } from '@/components/ui/button'
import { describeLinguistIpcError } from './project-utils'

export interface ProjectRunSummaryState {
  status: 'loading' | 'ready' | 'error' | 'undoing'
  summary: LinguistRunChangeSummary | null
  undoResult?: LinguistRunUndoResult
  error?: string
}

type GetLatestRunSummary = (
  input: LinguistRunSummaryRequest,
) => Promise<LinguistIpcResult<LinguistLatestRunSummaryResult>>

type UndoLatestRun = (
  input: LinguistRunUndoRequest,
) => Promise<LinguistIpcResult<LinguistRunUndoResult>>

export const linguistProjectRunSummaryAtomFamily = atomFamily(
  (_projectId: string) => atom<ProjectRunSummaryState>({
    status: 'loading',
    summary: null,
  }),
)

export async function loadProjectRunSummary(
  projectId: string,
  request: GetLatestRunSummary = (input) =>
    window.electronAPI.linguistCatGetLatestRunSummary(input),
): Promise<ProjectRunSummaryState> {
  try {
    const result = await request({ projectId })
    return result.ok
      ? { status: 'ready', summary: result.data.summary }
      : { status: 'error', summary: null, error: describeLinguistIpcError(result.error) }
  } catch {
    return { status: 'error', summary: null, error: '与主进程通信异常' }
  }
}

export function undoLatestProjectRun(
  projectId: string,
  sessionId: string,
  expectedRunId: string,
  request: UndoLatestRun = (input) =>
    window.electronAPI.linguistCatUndoLatestRun(input),
): Promise<LinguistIpcResult<LinguistRunUndoResult>> {
  return request({ projectId, sessionId, expectedRunId })
}

export function mergeProjectRunSummaryState(
  next: ProjectRunSummaryState,
  current: ProjectRunSummaryState,
): ProjectRunSummaryState {
  return current.undoResult?.runId === next.summary?.runId
    ? { ...next, undoResult: current.undoResult }
    : next
}

function jobStatusLabel(status: NonNullable<LinguistRunChangeSummary['job']>['status']): string {
  switch (status) {
    case 'pending': return '待运行'
    case 'running': return '运行中'
    case 'paused': return '已暂停'
    case 'completed': return '已完成'
    case 'failed': return '失败'
    case 'cancelled': return '已取消'
  }
}

function undoStatusLabel(result: LinguistRunUndoResult): string {
  switch (result.status) {
    case 'completed':
      return `已撤销 ${result.reverted.length} 项 CAT 变更`
    case 'partial':
      return `部分完成：已撤销 ${result.reverted.length} 项，拒绝 ${result.refused.length} 项`
    case 'refused':
      return `未撤销：拒绝 ${result.refused.length} 项`
    case 'already-undone':
      return '本次可撤销变更已处理'
  }
}

export function describeRunUndoRefusal(reason: string): string {
  if (reason.startsWith('segment revision changed')) {
    return '片段已有后续修订，不会覆盖'
  }
  if (reason === 'proposal changed after this run') {
    return 'Proposal 在本次运行后已变化，不会覆盖'
  }
  if (reason === 'proposal is no longer pending') {
    return 'Proposal 已不再是待审状态，未撤销'
  }
  if (reason === 'proposal no longer exists') {
    return 'Proposal 已不存在，未撤销'
  }
  if (reason === 'file effects are recorded but not structurally reversible') {
    return '文件变更仅记录；请使用 Proma File Rewind'
  }
  if (reason.startsWith('unsupported structured change')) {
    return '该 CAT 记录不支持结构化撤销'
  }
  return reason
}

export function ProjectRunSummary({
  projectId,
  sessionId,
  archived,
  refreshSequence,
}: {
  projectId: string
  sessionId?: string
  archived: boolean
  refreshSequence: number
}): React.ReactElement {
  const [state, setState] = useAtom(linguistProjectRunSummaryAtomFamily(projectId))

  React.useEffect(() => {
    let cancelled = false
    setState((current) => ({ ...current, status: 'loading', error: undefined }))
    void loadProjectRunSummary(projectId).then((next) => {
      if (!cancelled) {
        setState((current) => mergeProjectRunSummaryState(next, current))
      }
    })
    return () => {
      cancelled = true
    }
  }, [projectId, refreshSequence, setState])

  const undo = async (): Promise<void> => {
    if (sessionId === undefined || archived || state.summary?.canUndo !== true) return
    setState((current) => ({ ...current, status: 'undoing', error: undefined }))
    try {
      const result = await undoLatestProjectRun(projectId, sessionId, state.summary.runId)
      if (!result.ok) {
        setState((current) => ({
          ...current,
          status: 'error',
          error: describeLinguistIpcError(result.error),
        }))
        return
      }
      const refreshed = await loadProjectRunSummary(projectId)
      setState((current) => mergeProjectRunSummaryState(refreshed, {
        ...current,
        undoResult: result.data,
      }))
    } catch {
      setState((current) => ({
        ...current,
        status: 'error',
        error: '与主进程通信异常',
      }))
    }
  }

  const summary = state.summary
  const qaCount = (summary?.changes.qaFindingsCreated ?? 0)
    + (summary?.changes.qaFindingsUpdated ?? 0)
  const undoDisabled = archived
    || sessionId === undefined
    || summary?.canUndo !== true
    || state.status === 'undoing'

  return (
    <section
      aria-label="本次运行"
      className="shrink-0 border-b border-border/60 bg-content-area/65 px-4 py-2"
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h2 className="text-xs font-semibold text-foreground">本次运行</h2>
          {summary === null
            ? (
                <p className="mt-1 text-xs text-muted-foreground">
                  {state.status === 'loading' ? '正在读取最近运行…' : '暂无可展示的 CAT 运行记录'}
                </p>
              )
            : (
                <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
                  {summary.job !== undefined && (
                    <>
                      <span>{jobStatusLabel(summary.job.status)}</span>
                      <span>完成 {summary.job.completedSegments} / {summary.job.scopedSegments}</span>
                      {summary.job.failedSegments > 0 && <span>失败 {summary.job.failedSegments}</span>}
                    </>
                  )}
                  <span>Proposal {summary.changes.proposalsCreated}</span>
                  <span>QA {qaCount}</span>
                  <span>文件 {summary.changes.filesTouched}（仅记录）</span>
                </div>
              )}
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={undoDisabled}
          onClick={() => { void undo() }}
        >
          {state.status === 'undoing' ? '正在撤销…' : '撤销本次 CAT 变更'}
        </Button>
      </div>

      <p className="mt-1.5 text-[11px] leading-4 text-muted-foreground">
        仅撤销仍未变化的待审 Proposal；通用文件请使用 Proma File Rewind，外部 MCP / 程序副作用仅记录。
      </p>

      {state.error !== undefined && (
        <p role="alert" className="mt-1 text-xs text-destructive">{state.error}</p>
      )}
      {state.undoResult !== undefined && (
        <div aria-live="polite" className="mt-1 text-xs text-muted-foreground">
          <p>{undoStatusLabel(state.undoResult)}</p>
          {state.undoResult.refused.length > 0 && (
            <ul className="mt-1 list-disc space-y-0.5 pl-4">
              {state.undoResult.refused.map((item) => (
                <li key={`${item.entityType}:${item.entityId}`}>
                  <span className="font-mono">{item.entityId}</span>
                  {'：'}
                  {describeRunUndoRefusal(item.reason)}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  )
}
