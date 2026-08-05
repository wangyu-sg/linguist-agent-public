import * as React from 'react'
import { useAtomValue } from 'jotai'
import { Check, Loader2, RefreshCw, SkipForward } from 'lucide-react'
import { toast } from 'sonner'
import {
  LINGUIST_CAT_PAGE_MAX,
  type LinguistCatListQaFindingsRequest,
  type LinguistCatRunQaRequest,
  type LinguistIpcError,
  type LinguistQaFindingDisposition,
  type LinguistQaFindingInfo,
  type LinguistQaFindingSeverity,
  type LinguistQaFindingStatus,
} from '@proma/shared'
import { describeLinguistIpcError } from './project-utils'
import { userProfileAtom } from '@/atoms/user-profile'
import {
  QA_DISPOSITION_LABELS,
  QA_DISPOSITIONS,
  QA_SEVERITIES,
  QA_SEVERITY_BADGE_CLASSES,
  QA_SEVERITY_LABELS,
} from './qa-findings-utils'

const PAGE_SIZE = 100
const QA_WAIVER_REASON_MAX_LENGTH = 500

type WaiverScope = 'single' | 'rule'

interface QaPage {
  items: LinguistQaFindingInfo[]
  total: number
  offset: number
  hasMore: boolean
}

type QaState =
  | { status: 'loading'; scopeKey: string }
  | { status: 'error'; scopeKey: string; error: LinguistIpcError }
  | { status: 'ready'; scopeKey: string; data: QaPage }

export function qaFindingsScopeKey(projectId: string, segmentId?: string): string {
  return `${projectId}\0${segmentId ?? ''}`
}

export function qaStateMatchesScope(stateScopeKey: string, currentScopeKey: string): boolean {
  return stateScopeKey === currentScopeKey
}

export function buildQaFindingsRequest({
  projectId,
  segmentId,
  status,
  severity,
  disposition,
  offset,
}: {
  projectId: string
  segmentId?: string
  status: LinguistQaFindingStatus
  severity: LinguistQaFindingSeverity | ''
  disposition: LinguistQaFindingDisposition | ''
  offset: number
}): LinguistCatListQaFindingsRequest {
  return {
    projectId,
    ...(segmentId !== undefined ? { segmentId } : {}),
    status,
    ...(severity !== '' ? { severity } : {}),
    ...(disposition !== '' ? { disposition } : {}),
    limit: PAGE_SIZE,
    offset,
  }
}

export function buildQaRunRequest(projectId: string): LinguistCatRunQaRequest {
  return { projectId }
}

export function qaResolveDisabledReason(
  finding: LinguistQaFindingInfo,
  archived: boolean,
): string | undefined {
  if (archived) return '项目已归档，不能标记解决'
  if (finding.status !== 'open') return '该 Finding 已完成处置'
  if (finding.currentRevision <= finding.segmentRevision) {
    return '请先修改该片段的译文，再标记已解决'
  }
  return undefined
}

export function qaWaiveDisabledReason(
  finding: LinguistQaFindingInfo,
  archived: boolean,
): string | undefined {
  if (archived) return '项目已归档，不能豁免 Finding'
  if (finding.status !== 'open') return '该 Finding 已完成处置'
  return undefined
}

export function qaWaiverReasonError(reason: string): string | undefined {
  if (reason.trim().length === 0) return '豁免原因不能为空'
  if (reason.length > QA_WAIVER_REASON_MAX_LENGTH) {
    return `豁免原因不能超过 ${QA_WAIVER_REASON_MAX_LENGTH} 个字符`
  }
  return undefined
}

export function QaPanelScopeNotice({
  scopeId,
  segmentId,
  archived,
}: {
  scopeId: string
  segmentId?: string
  archived: boolean
}): React.ReactElement {
  return (
    <>
      <p id={`${scopeId}-run-note`} className="text-[11px] text-foreground/45">
        {segmentId === undefined
          ? '运行、筛选与人工审核'
          : '仅显示当前片段；运行 QA 仍会扫描整个项目'}
      </p>
      {archived && (
        <p id={`${scopeId}-archived-note`} role="status" className="mt-1 text-[10px] text-warning">
          项目已归档：仍可读取和跳转；运行、解决和豁免已禁用。
        </p>
      )}
    </>
  )
}

export function QaFindingsPanel({
  projectId,
  segmentId,
  archived,
  onJump,
  onChanged,
  refreshToken,
}: {
  projectId: string
  segmentId?: string
  archived: boolean
  onJump: (finding: LinguistQaFindingInfo) => void
  onChanged: () => Promise<void>
  refreshToken: number
}): React.ReactElement {
  const [statusFilter, setStatusFilter] = React.useState<LinguistQaFindingStatus>('open')
  const [severityFilter, setSeverityFilter] = React.useState<LinguistQaFindingSeverity | ''>('')
  const [dispositionFilter, setDispositionFilter] = React.useState<LinguistQaFindingDisposition | ''>('')
  const [offset, setOffset] = React.useState(0)
  const scopeKey = qaFindingsScopeKey(projectId, segmentId)
  const [state, setState] = React.useState<QaState>({ status: 'loading', scopeKey })
  const [reloadToken, setReloadToken] = React.useState(0)
  const [running, setRunning] = React.useState(false)
  const [mutatingId, setMutatingId] = React.useState<string>()
  const [waiverAction, setWaiverAction] = React.useState<{
    findingId: string
    scope: WaiverScope
  }>()
  const [waiverReason, setWaiverReason] = React.useState('')
  const userProfile = useAtomValue(userProfileAtom)
  const accessibilityScopeId = `qa-findings-${projectId}-${segmentId ?? 'project'}`

  const load = React.useCallback(async (): Promise<QaState> => {
    try {
      const result = await window.electronAPI.linguistCatListQaFindings(buildQaFindingsRequest({
        projectId,
        segmentId,
        status: statusFilter,
        severity: severityFilter,
        disposition: dispositionFilter,
        offset,
      }))
      return result.ok
        ? { status: 'ready', scopeKey, data: result.data }
        : { status: 'error', scopeKey, error: result.error }
    } catch {
      return {
        status: 'error',
        scopeKey,
        error: { code: 'INTERNAL', message: '与主进程通信异常' },
      }
    }
  }, [
    dispositionFilter,
    offset,
    projectId,
    scopeKey,
    segmentId,
    severityFilter,
    statusFilter,
  ])

  React.useEffect(() => {
    let cancelled = false
    setState({ status: 'loading', scopeKey })
    void load().then((nextState) => {
      if (!cancelled) setState(nextState)
    })
    return () => {
      cancelled = true
    }
  }, [load, reloadToken, refreshToken])

  React.useEffect(() => {
    setOffset(0)
    setWaiverAction(undefined)
    setWaiverReason('')
  }, [scopeKey])

  const rerun = async (): Promise<void> => {
    if (running || archived) return
    setRunning(true)
    try {
      const result = await window.electronAPI.linguistCatRunQa(buildQaRunRequest(projectId))
      if (!result.ok) {
        toast.error('QA 运行失败', { description: describeLinguistIpcError(result.error) })
        return
      }
      toast.success(`QA 完成：${result.data.total} 条 Finding`)
      await onChanged()
      setReloadToken((value) => value + 1)
    } catch {
      toast.error('QA 运行失败', { description: '与主进程通信异常（INTERNAL）' })
    } finally {
      setRunning(false)
    }
  }

  const resolve = async (finding: LinguistQaFindingInfo): Promise<void> => {
    if (
      mutatingId !== undefined
      || qaResolveDisabledReason(finding, archived) !== undefined
      || (segmentId !== undefined && finding.segmentId !== segmentId)
    ) return
    setMutatingId(finding.id)
    try {
      const result = await window.electronAPI.linguistCatResolveQaFinding({ projectId, findingId: finding.id })
      if (!result.ok) {
        toast.error('无法标记已解决', { description: describeLinguistIpcError(result.error) })
        return
      }
      toast.success('已标记为已解决')
      await onChanged()
      setReloadToken((value) => value + 1)
    } catch {
      toast.error('无法标记已解决', { description: '与主进程通信异常（INTERNAL）' })
    } finally {
      setMutatingId(undefined)
    }
  }

  const waive = async (finding: LinguistQaFindingInfo): Promise<void> => {
    const reasonError = qaWaiverReasonError(waiverReason)
    const scope = waiverAction?.findingId === finding.id ? waiverAction.scope : 'single'
    if (
      mutatingId !== undefined
      || archived
      || qaWaiveDisabledReason(finding, archived) !== undefined
      || reasonError !== undefined
      || (segmentId !== undefined && finding.segmentId !== segmentId)
    ) return
    setMutatingId(scope === 'rule' ? `rule:${finding.code}` : finding.id)
    try {
      const operator = userProfile.userName.trim() || '本机用户'
      if (scope === 'rule') {
        const listed = await window.electronAPI.linguistCatListQaFindings({
          projectId,
          code: finding.code,
          status: 'open',
          limit: LINGUIST_CAT_PAGE_MAX,
          offset: 0,
        })
        if (!listed.ok) {
          toast.error('无法读取同规则 Finding', {
            description: describeLinguistIpcError(listed.error),
          })
          return
        }
        const findingIds = listed.data.items.map((item) => item.id)
        if (findingIds.length === 0) {
          toast.info('没有可豁免的同规则 Finding')
          return
        }
        const moreNotice = listed.data.hasMore
          ? `\n该规则共有 ${listed.data.total} 条，本批只处理前 ${findingIds.length} 条。`
          : ''
        if (!window.confirm(
          `将在整个项目中豁免规则 ${finding.code} 的 `
          + `${findingIds.length} 条开放 Finding。${moreNotice}\n\n`
          + `理由：${waiverReason.trim()}\n操作者：${operator}\n\n确定继续吗？`,
        )) return
        const result = await window.electronAPI.linguistCatWaiveQaFindingsBulk({
          projectId,
          findingIds,
          reason: waiverReason,
          operator,
        })
        if (!result.ok) {
          toast.error('无法批量豁免 Finding', {
            description: describeLinguistIpcError(result.error),
          })
          return
        }
        toast.success(`已豁免 ${result.data.length} 条 ${finding.code} Finding`)
      } else {
        const result = await window.electronAPI.linguistCatWaiveQaFinding({
          projectId,
          findingId: finding.id,
          reason: waiverReason,
          operator,
        })
        if (!result.ok) {
          toast.error('无法豁免 Finding', { description: describeLinguistIpcError(result.error) })
          return
        }
        toast.success('已豁免并记录原因与操作者')
      }
      setWaiverAction(undefined)
      setWaiverReason('')
      await onChanged()
      setReloadToken((value) => value + 1)
    } catch {
      toast.error('无法豁免 Finding', { description: '与主进程通信异常（INTERNAL）' })
    } finally {
      setMutatingId(undefined)
    }
  }

  const visibleState: QaState = qaStateMatchesScope(state.scopeKey, scopeKey)
    ? state
    : { status: 'loading', scopeKey }

  return (
    <section
      aria-label={segmentId === undefined ? 'QA Findings' : '当前片段 QA Findings'}
      aria-busy={running || mutatingId !== undefined}
      className="rounded-xl bg-content-area p-3 shadow-sm ring-1 ring-border/35"
    >
      <div className="flex items-center justify-between gap-2">
        <div>
          <h3 className="text-[12px] font-medium">QA Findings</h3>
          <QaPanelScopeNotice
            scopeId={accessibilityScopeId}
            segmentId={segmentId}
            archived={archived}
          />
        </div>
        <button
          type="button"
          disabled={archived || running}
          aria-label={segmentId === undefined ? '运行项目 QA' : '运行整个项目 QA'}
          aria-describedby={archived
            ? `${accessibilityScopeId}-archived-note`
            : `${accessibilityScopeId}-run-note`}
          title={archived ? '项目已归档，不能运行 QA' : undefined}
          onClick={() => void rerun()}
          className="inline-flex items-center gap-1 rounded-md bg-primary px-2 py-1 text-[11px] text-primary-foreground disabled:opacity-40"
        >
          {running
            ? <Loader2 aria-hidden="true" size={11} className="animate-spin" />
            : <RefreshCw aria-hidden="true" size={11} />}
          {running ? '运行中' : segmentId === undefined ? '运行 QA' : '运行项目 QA'}
        </button>
      </div>
      <div className="mt-3 grid grid-cols-3 gap-2">
        <label className="text-[10px] text-foreground/45">
          状态
          <select
            aria-label="QA 状态筛选"
            value={statusFilter}
            onChange={(event) => { setStatusFilter(event.target.value as LinguistQaFindingStatus); setOffset(0) }}
            className="mt-1 h-7 w-full rounded-md bg-background px-1.5 text-[11px] ring-1 ring-border/45"
          >
            <option value="open">待处理</option>
            <option value="resolved">已解决</option>
            <option value="waived">已豁免</option>
          </select>
        </label>
        <label className="text-[10px] text-foreground/45">
          严重度
          <select
            aria-label="QA 严重度筛选"
            value={severityFilter}
            onChange={(event) => { setSeverityFilter(event.target.value as LinguistQaFindingSeverity | ''); setOffset(0) }}
            className="mt-1 h-7 w-full rounded-md bg-background px-1.5 text-[11px] ring-1 ring-border/45"
          >
            <option value="">全部</option>
            {QA_SEVERITIES.map((severity) => (
              <option key={severity} value={severity}>{QA_SEVERITY_LABELS[severity]}</option>
            ))}
          </select>
        </label>
        <label className="text-[10px] text-foreground/45">
          处置
          <select
            aria-label="QA 处置筛选"
            value={dispositionFilter}
            onChange={(event) => { setDispositionFilter(event.target.value as LinguistQaFindingDisposition | ''); setOffset(0) }}
            className="mt-1 h-7 w-full rounded-md bg-background px-1.5 text-[11px] ring-1 ring-border/45"
          >
            <option value="">全部</option>
            {QA_DISPOSITIONS.map((disposition) => (
              <option key={disposition} value={disposition}>{QA_DISPOSITION_LABELS[disposition]}</option>
            ))}
          </select>
        </label>
      </div>
      <div className="mt-3 space-y-2">
        {visibleState.status === 'loading' ? (
          <p aria-live="polite" className="flex items-center gap-1.5 text-[11px] text-foreground/45"><Loader2 aria-hidden="true" size={11} className="animate-spin" />正在读取…</p>
        ) : visibleState.status === 'error' ? (
          <p role="alert" className="text-[11px] text-destructive">{describeLinguistIpcError(visibleState.error)}</p>
        ) : visibleState.data.total === 0 ? (
          <p className="text-[12px] text-foreground/45">尚无符合筛选的 Finding</p>
        ) : (
          <>
            <div className="flex items-center justify-between gap-2 text-[11px] text-foreground/45">
              <p>共 {visibleState.data.total} 条（{visibleState.data.offset + 1}–{visibleState.data.offset + visibleState.data.items.length}）</p>
              <div className="flex gap-1">
                <button type="button" aria-label="上一页 QA Finding" disabled={visibleState.data.offset === 0} onClick={() => setOffset((value) => Math.max(0, value - PAGE_SIZE))} className="rounded bg-foreground/[0.06] px-1.5 py-0.5 disabled:opacity-40">上一页</button>
                <button type="button" aria-label="下一页 QA Finding" disabled={!visibleState.data.hasMore} onClick={() => setOffset((value) => value + PAGE_SIZE)} className="rounded bg-foreground/[0.06] px-1.5 py-0.5 disabled:opacity-40">下一页</button>
              </div>
            </div>
            {visibleState.data.items.map((finding) => (
              <QaFindingCard
                key={finding.id}
                finding={finding}
                idPrefix={accessibilityScopeId}
                archived={archived}
                mutatingId={mutatingId}
                waiving={waiverAction?.findingId === finding.id}
                waiverScope={waiverAction?.findingId === finding.id
                  ? waiverAction.scope
                  : 'single'}
                waiverReason={waiverReason}
                onJump={() => onJump(finding)}
                onResolve={() => void resolve(finding)}
                onOpenWaiver={(scope) => setWaiverAction({
                  findingId: finding.id,
                  scope,
                })}
                onWaive={() => void waive(finding)}
                onCancelWaiver={() => {
                  setWaiverAction(undefined)
                  setWaiverReason('')
                }}
                onWaiverReasonChange={setWaiverReason}
              />
            ))}
          </>
        )}
      </div>
    </section>
  )
}

export function QaFindingCard({
  idPrefix,
  finding,
  archived,
  mutatingId,
  waiving,
  waiverScope,
  waiverReason,
  onJump,
  onResolve,
  onOpenWaiver,
  onWaive,
  onCancelWaiver,
  onWaiverReasonChange,
}: {
  idPrefix: string
  finding: LinguistQaFindingInfo
  archived: boolean
  mutatingId?: string
  waiving: boolean
  waiverScope: WaiverScope
  waiverReason: string
  onJump: () => void
  onResolve: () => void
  onOpenWaiver: (scope: WaiverScope) => void
  onWaive: () => void
  onCancelWaiver: () => void
  onWaiverReasonChange: (reason: string) => void
}): React.ReactElement {
  const resolveReason = qaResolveDisabledReason(finding, archived)
    ?? (mutatingId !== undefined ? '另一个 QA 操作正在进行' : undefined)
  const waiveReason = qaWaiveDisabledReason(finding, archived)
    ?? (mutatingId !== undefined ? '另一个 QA 操作正在进行' : undefined)
  const resolveReasonId = `${idPrefix}-resolve-reason-${finding.id}`
  const waiveReasonId = `${idPrefix}-waive-reason-${finding.id}`
  const waiverError = qaWaiverReasonError(waiverReason)
  const waiverHelpId = `${idPrefix}-waiver-help-${finding.id}`
  const waiverInputId = `${idPrefix}-waiver-${finding.id}`

  return (
    <article aria-label={`QA Finding ${finding.code} for ${finding.segmentId}`} className="rounded-lg bg-foreground/[0.035] p-2 text-[11px]">
      <div className="flex items-start justify-between gap-2">
        <p className="font-medium text-foreground/75">{finding.code}</p>
        <span className={QA_SEVERITY_BADGE_CLASSES[finding.severity]}>
          {QA_SEVERITY_LABELS[finding.severity]}
        </span>
      </div>
      <p className="mt-0.5 text-[10px] text-foreground/45">
        {finding.issueType} · {QA_DISPOSITION_LABELS[finding.disposition]}
      </p>
      <p className="mt-1 text-foreground/55">{finding.message}</p>
      {finding.waiverReason !== undefined && (
        <p className="mt-1 text-foreground/45">
          豁免：{finding.waiverReason}
          {finding.waivedBy ? ` · ${finding.waivedBy}` : ''}
          {finding.waivedAt ? ` · ${new Date(finding.waivedAt).toLocaleString()}` : ''}
        </p>
      )}
      <div className="mt-2 flex flex-wrap gap-1.5">
        <button
          type="button"
          onClick={onJump}
          className="inline-flex items-center gap-1 rounded-md bg-foreground/[0.06] px-2 py-1 hover:bg-foreground/[0.1]"
        >
          <SkipForward aria-hidden="true" size={10} />
          跳到片段
        </button>
        {finding.status === 'open' && (
          <>
            <button
              type="button"
              disabled={resolveReason !== undefined}
              aria-describedby={resolveReason === undefined ? undefined : resolveReasonId}
              title={resolveReason}
              onClick={onResolve}
              className="inline-flex items-center gap-1 rounded-md bg-foreground/[0.06] px-2 py-1 disabled:opacity-40"
            >
              {mutatingId === finding.id
                ? <Loader2 aria-hidden="true" size={10} className="animate-spin" />
                : <Check aria-hidden="true" size={10} />}
              标记解决
            </button>
            {resolveReason !== undefined && (
              <span id={resolveReasonId} className="sr-only">{resolveReason}</span>
            )}
            <button
              type="button"
              disabled={waiveReason !== undefined}
              aria-describedby={waiveReason === undefined ? undefined : waiveReasonId}
              title={waiveReason}
              onClick={() => onOpenWaiver('single')}
              className="rounded-md bg-foreground/[0.06] px-2 py-1 disabled:opacity-40"
            >
              豁免此条
            </button>
            <button
              type="button"
              disabled={waiveReason !== undefined}
              aria-describedby={waiveReason === undefined ? undefined : waiveReasonId}
              title={waiveReason}
              onClick={() => onOpenWaiver('rule')}
              className="rounded-md bg-foreground/[0.06] px-2 py-1 disabled:opacity-40"
            >
              豁免项目内同规则
            </button>
            {waiveReason !== undefined && (
              <span id={waiveReasonId} className="sr-only">{waiveReason}</span>
            )}
          </>
        )}
      </div>
      {waiving && (
        <div className="mt-2 space-y-1.5">
          <label className="sr-only" htmlFor={waiverInputId}>豁免原因</label>
          <textarea
            id={waiverInputId}
            value={waiverReason}
            onChange={(event) => onWaiverReasonChange(event.target.value)}
            maxLength={QA_WAIVER_REASON_MAX_LENGTH}
            aria-invalid={waiverError !== undefined}
            aria-describedby={waiverHelpId}
            placeholder={waiverScope === 'rule'
              ? `填写批量豁免 ${finding.code} 的原因`
              : '填写豁免原因'}
            className="min-h-14 w-full rounded-md bg-background p-1.5 text-[11px] ring-1 ring-border/45"
          />
          <p
            id={waiverHelpId}
            role={waiverError === undefined ? 'status' : 'alert'}
            className={waiverError === undefined ? 'text-foreground/45' : 'text-destructive'}
          >
            {waiverError ?? '豁免原因有效'} · {waiverReason.length}/{QA_WAIVER_REASON_MAX_LENGTH}
          </p>
          <div className="flex gap-1.5">
            <button
              type="button"
              disabled={archived || waiverError !== undefined || mutatingId !== undefined}
              aria-describedby={waiverHelpId}
              onClick={onWaive}
              className="rounded-md bg-primary px-2 py-1 text-primary-foreground disabled:opacity-40"
            >
              {waiverScope === 'rule' ? '确认按规则豁免' : '确认豁免'}
            </button>
            <button
              type="button"
              onClick={onCancelWaiver}
              className="rounded-md bg-foreground/[0.06] px-2 py-1"
            >
              取消
            </button>
          </div>
        </div>
      )}
    </article>
  )
}
