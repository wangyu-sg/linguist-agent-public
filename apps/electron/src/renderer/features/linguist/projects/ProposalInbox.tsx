import * as React from 'react'
import {
  AlertTriangle,
  Check,
  ChevronLeft,
  ChevronRight,
  Inbox,
  Loader2,
  Pencil,
  RefreshCw,
  RotateCcw,
  X,
} from 'lucide-react'
import { toast } from 'sonner'
import type {
  LinguistIpcResult,
  LinguistProposalDiff,
  LinguistProposalStatus,
  LinguistWorkflowStage,
} from '@proma/shared'
import { cn } from '@/lib/utils'
import { describeLinguistIpcError } from './project-utils'
import {
  PROPOSAL_STATUS_LABELS,
  bulkProposalReviewConfirmation,
  groupProposalRuns,
  isProposalConflictCode,
  proposalMutationPlan,
  textDiffParts,
} from './proposal-inbox-utils'
import { stageCompletionLabel } from './workflow-ui'

const PAGE_SIZE = 100

type ProposalFilter = 'all' | LinguistProposalStatus

type InboxState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | {
      status: 'ready'
      proposals: LinguistProposalDiff[]
      total: number
      offset: number
      hasMore: boolean
    }

type Mutation = 'accept' | 'reject' | 'edit' | 'reissue'
type BulkMutation = 'accept' | 'reject'

interface ProposalInboxProps {
  projectId: string
  archived: boolean
  onChanged: () => Promise<void>
  coverage?: ProposalReviewCoverage
}

export interface ProposalReviewCoverage {
  workflowStage: LinguistWorkflowStage
  totalSegments: number
  confirmedSegments: number
}

export function ProposalCoverageBanner({
  coverage,
}: {
  coverage: ProposalReviewCoverage
}): React.ReactElement {
  const uncovered = Math.max(0, coverage.totalSegments - coverage.confirmedSegments)
  return (
    <div
      role="status"
      className="rounded-xl bg-success/[0.06] px-3 py-2 text-[12px] leading-5 text-foreground/60"
    >
      <p className="font-medium text-foreground/75">
        本轮覆盖：{stageCompletionLabel(coverage.workflowStage)} {coverage.confirmedSegments} / {coverage.totalSegments}
        {' · '}未覆盖 {uncovered}
      </p>
      <p className="text-[11px] text-foreground/45">
        覆盖数来自当前阶段的人工确认，包含“检查后无需修改”的句段；没有提案本身不计为已覆盖。
      </p>
    </div>
  )
}

function mutationKey(operation: Mutation | `${BulkMutation}-selected`, proposalId = ''): string {
  return `${operation}:${proposalId}:${crypto.randomUUID()}`
}

function formatTimestamp(value: string): string {
  const timestamp = new Date(value)
  return Number.isNaN(timestamp.getTime()) ? value : timestamp.toLocaleString()
}

export function ProposalInbox({
  projectId,
  archived,
  onChanged,
  coverage,
}: ProposalInboxProps): React.ReactElement {
  const [state, setState] = React.useState<InboxState>({ status: 'loading' })
  const [filter, setFilter] = React.useState<ProposalFilter>('all')
  const [page, setPage] = React.useState(0)
  const [selectedIds, setSelectedIds] = React.useState<Set<string>>(() => new Set())
  const [mutating, setMutating] = React.useState<Record<string, Mutation | undefined>>({})
  const [bulkMutating, setBulkMutating] = React.useState<BulkMutation | undefined>()

  const load = React.useCallback(async (): Promise<void> => {
    setState({ status: 'loading' })
    setSelectedIds(new Set())
    try {
      const list = await window.electronAPI.linguistProposalsList({
        projectId,
        ...(filter !== 'all' ? { status: filter } : {}),
        limit: PAGE_SIZE,
        offset: page * PAGE_SIZE,
      })
      if (!list.ok) {
        setState({ status: 'error', message: describeLinguistIpcError(list.error) })
        return
      }
      setState({
        status: 'ready',
        proposals: list.data.items,
        total: list.data.total,
        offset: list.data.offset,
        hasMore: list.data.hasMore,
      })
    } catch {
      setState({ status: 'error', message: '与主进程通信异常（INTERNAL）' })
    }
  }, [filter, page, projectId])

  React.useEffect(() => {
    void load()
  }, [load])

  const selectedDiffs = React.useMemo(
    () => state.status === 'ready'
      ? state.proposals.filter((diff) => selectedIds.has(diff.proposal.id))
      : [],
    [selectedIds, state],
  )
  const selectionContexts = React.useMemo(
    () => selectedDiffs.map((diff) => ({
      segment: {
        id: diff.proposal.segmentId,
        ordinal: diff.originalOrdinal - 1,
        revision: diff.currentRevision,
        locked: diff.locked,
      },
      ...(diff.proposal.status === 'pending'
        ? { pendingProposal: { id: diff.proposal.id, baseRevision: diff.baseRevision } }
        : {}),
    })),
    [selectedDiffs],
  )
  const acceptPlan = React.useMemo(
    () => proposalMutationPlan(selectionContexts, archived, 'accept'),
    [archived, selectionContexts],
  )
  const rejectPlan = React.useMemo(
    () => proposalMutationPlan(selectionContexts, archived, 'reject'),
    [archived, selectionContexts],
  )

  const finish = React.useCallback(
    async (
      proposalId: string,
      operation: Mutation,
      run: () => Promise<LinguistIpcResult<unknown>>,
    ) => {
      setMutating((current) => ({ ...current, [proposalId]: operation }))
      try {
        const result = await run()
        if (!result.ok) {
          toast.error(isProposalConflictCode(result.error.code) ? '建议已发生冲突' : '操作失败', {
            description: describeLinguistIpcError(result.error),
          })
          if (isProposalConflictCode(result.error.code)) await load()
          return
        }
        const successLabel: Record<Mutation, string> = {
          accept: '已接受建议',
          reject: '已拒绝建议',
          edit: '已接受编辑',
          reissue: '已生成新的待审提案',
        }
        toast.success(successLabel[operation])
        await Promise.all([load(), onChanged()])
      } catch {
        toast.error('操作失败', { description: '与主进程通信异常（INTERNAL）' })
      } finally {
        setMutating((current) => ({ ...current, [proposalId]: undefined }))
      }
    },
    [load, onChanged],
  )


  const runBulkMutation = React.useCallback(async (operation: BulkMutation): Promise<void> => {
    if (bulkMutating !== undefined || selectedDiffs.length === 0) return
    const plan = operation === 'accept' ? acceptPlan : rejectPlan
    if (plan.items.length === 0) return
    if (plan.items.length > 50) {
      toast.error('批量审核失败', {
        description: `实际可操作 ${plan.items.length} 条建议，单次最多执行 50 条。`,
      })
      return
    }
    if (!window.confirm(bulkProposalReviewConfirmation(
      operation,
      selectedDiffs.length,
      plan.items.length,
      plan.excluded,
    ))) return

    setBulkMutating(operation)
    try {
      const input = {
        projectId,
        items: plan.items,
        idempotencyKey: mutationKey(`${operation}-selected`),
      }
      const result = operation === 'accept'
        ? await window.electronAPI.linguistProposalsAcceptSelected(input)
        : await window.electronAPI.linguistProposalsRejectSelected(input)
      if (!result.ok) {
        toast.error(isProposalConflictCode(result.error.code) ? '所选建议已发生冲突' : '批量审核失败', {
          description: describeLinguistIpcError(result.error),
        })
        await load()
        return
      }
      toast.success(operation === 'accept'
        ? `已接受 ${plan.items.length} 条建议`
        : `已拒绝 ${plan.items.length} 条建议`)
      await Promise.all([load(), onChanged()])
    } catch {
      toast.error('批量审核失败', { description: '与主进程通信异常（INTERNAL）' })
    } finally {
      setBulkMutating(undefined)
    }
  }, [
    acceptPlan,
    bulkMutating,
    load,
    onChanged,
    projectId,
    rejectPlan,
    selectedDiffs.length,
  ])

  const content = (() => {
    if (state.status === 'loading') {
      return (
        <div className="flex items-center justify-center gap-2 py-12 text-[13px] text-foreground/45">
          <Loader2 size={15} className="animate-spin" />
          正在加载提案历史…
        </div>
      )
    }

    if (state.status === 'error') {
      return (
        <div role="alert" className="flex flex-col items-center gap-3 py-10 text-center">
          <AlertTriangle size={22} className="text-destructive" />
          <p className="text-[13px] text-foreground/60">{state.message}</p>
          <ActionButton
            icon={<RefreshCw size={13} />}
            label="重试"
            onClick={() => void load()}
          />
        </div>
      )
    }

    if (state.proposals.length === 0) {
      return (
        <div className="flex flex-col items-center gap-2 py-12 text-center">
          <div className="flex size-12 items-center justify-center rounded-2xl bg-foreground/[0.06] text-foreground/55">
            <Inbox size={22} />
          </div>
          <p className="text-[14px] font-medium text-foreground/70">当前筛选下没有提案</p>
          <p className="max-w-lg text-[12px] leading-5 text-foreground/45">
            没有提案只表示没有可展示的提案历史，不代表项目已经审校、QA 或交付验证通过。
          </p>
        </div>
      )
    }

    const runGroups = groupProposalRuns(state.proposals)
    return (
      <div className="flex flex-col gap-4">
        {runGroups.map((group) => (
          <section key={group.runId} aria-label={`提案批次 ${group.runId}`}>
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2 rounded-xl bg-foreground/[0.035] px-3 py-2">
              <div className="min-w-0">
                <p className="truncate font-mono text-[11px] font-medium text-foreground/60">
                  {group.runId}
                </p>
                <p className="mt-0.5 text-[11px] text-foreground/40">
                  {formatTimestamp(group.createdAt)}
                  {group.modelId ? ` · 模型 ${group.modelId}` : ''}
                  {group.sessionId ? ` · 会话 ${group.sessionId}` : ''}
                </p>
              </div>
              <div className="flex flex-wrap gap-1">
                {Object.entries(group.statusCounts).map(([status, count]) => (
                  <span
                    key={status}
                    className="rounded-full bg-background/70 px-2 py-0.5 text-[10px] text-foreground/50"
                  >
                    {PROPOSAL_STATUS_LABELS[status as LinguistProposalStatus]} {count}
                  </span>
                ))}
              </div>
            </div>
            <div className="flex flex-col gap-3">
              {group.items.map((diff) => (
                <ProposalCard
                  key={diff.proposal.id}
                  diff={diff}
                  archived={archived}
                  selected={selectedIds.has(diff.proposal.id)}
                  mutation={mutating[diff.proposal.id]}
                  onToggleSelection={(selected) => {
                    setSelectedIds((current) => {
                      const next = new Set(current)
                      if (selected) next.add(diff.proposal.id)
                      else next.delete(diff.proposal.id)
                      return next
                    })
                  }}
                  onAccept={() =>
                    void finish(diff.proposal.id, 'accept', () =>
                      window.electronAPI.linguistProposalsAccept({
                        projectId,
                        proposalId: diff.proposal.id,
                        expectedRevision: diff.currentRevision,
                        idempotencyKey: mutationKey('accept', diff.proposal.id),
                      }),
                    )
                  }
                  onReject={() =>
                    void finish(diff.proposal.id, 'reject', () =>
                      window.electronAPI.linguistProposalsReject({
                        projectId,
                        proposalId: diff.proposal.id,
                        expectedRevision: diff.currentRevision,
                        idempotencyKey: mutationKey('reject', diff.proposal.id),
                      }),
                    )
                  }
                  onEditAccept={(editedTarget) =>
                    void finish(diff.proposal.id, 'edit', () =>
                      window.electronAPI.linguistProposalsEditAndAccept({
                        projectId,
                        proposalId: diff.proposal.id,
                        expectedRevision: diff.currentRevision,
                        editedTarget,
                        idempotencyKey: mutationKey('edit', diff.proposal.id),
                      }),
                    )
                  }
                  onReissue={() => {
                    if (!window.confirm(
                      '将保留这条终态历史，并生成一条新的待审核提案。原记录不会被改回 pending。确定继续吗？',
                    )) return
                    void finish(diff.proposal.id, 'reissue', () =>
                      window.electronAPI.linguistProposalsReissue({
                        projectId,
                        proposalId: diff.proposal.id,
                        expectedRevision: diff.currentRevision,
                        idempotencyKey: mutationKey('reissue', diff.proposal.id),
                      }),
                    )
                  }}
                />
              ))}
            </div>
          </section>
        ))}
      </div>
    )
  })()

  const pageSummary = state.status === 'ready' && state.total > 0
    ? `${state.offset + 1}–${state.offset + state.proposals.length} / ${state.total}`
    : '0'

  return (
    <div className="flex min-h-0 flex-col gap-3">
      {archived && (
        <div className="rounded-xl bg-warning-soft/60 px-3 py-2 text-[12px] text-warning-foreground">
          项目已归档，提案历史仅可查看。
        </div>
      )}
      <div className="rounded-xl bg-primary/[0.055] px-3 py-2 text-[12px] leading-5 text-foreground/60">
        提案是当前最佳修改的可见载体。新建会话只会获得干净的对话上下文；
        项目中的 TM、术语、Context、提案与 QA 历史仍然保留。
      </div>
      {coverage !== undefined && <ProposalCoverageBanner coverage={coverage} />}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <label className="text-[12px] text-foreground/50" htmlFor="proposal-status-filter">
            状态
          </label>
          <select
            id="proposal-status-filter"
            value={filter}
            onChange={(event) => {
              setFilter(event.target.value as ProposalFilter)
              setPage(0)
            }}
            className="min-w-0 truncate rounded-lg bg-foreground/[0.055] py-1.5 pl-2.5 pr-7 text-[12px] text-foreground outline-none ring-1 ring-border/40 focus:ring-primary/45"
          >
            <option value="all">全部历史</option>
            {Object.entries(PROPOSAL_STATUS_LABELS).map(([value, label]) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </select>
          <span className="text-[11px] text-foreground/40">当前页 {pageSummary}</span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            aria-label="刷新提案历史"
            onClick={() => void load()}
            className="rounded-md p-1.5 text-foreground/45 hover:bg-foreground/[0.06] hover:text-foreground"
          >
            <RefreshCw size={14} />
          </button>
        </div>
      </div>
      {selectedDiffs.length > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-foreground/[0.04] px-3 py-2">
          <p className="text-[11px] text-foreground/50">
            已选 {selectedDiffs.length} 条历史 · 可接受 {acceptPlan.items.length} 条 ·
            可拒绝 {rejectPlan.items.length} 条
          </p>
          <div className="flex gap-2">
            <ActionButton
              icon={bulkMutating === 'reject' ? <Loader2 size={13} className="animate-spin" /> : <X size={13} />}
              label={`拒绝 ${rejectPlan.items.length}`}
              disabled={bulkMutating !== undefined || rejectPlan.items.length === 0}
              onClick={() => void runBulkMutation('reject')}
            />
            <ActionButton
              icon={bulkMutating === 'accept' ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />}
              label={`接受 ${acceptPlan.items.length}`}
              primary
              disabled={bulkMutating !== undefined || acceptPlan.items.length === 0}
              onClick={() => void runBulkMutation('accept')}
            />
          </div>
        </div>
      )}
      <div className="min-h-0">{content}</div>
      {state.status === 'ready' && (state.offset > 0 || state.hasMore) && (
        <nav aria-label="提案历史分页" className="flex items-center justify-end gap-2">
          <ActionButton
            icon={<ChevronLeft size={13} />}
            label="上一页"
            disabled={state.offset === 0}
            onClick={() => setPage((current) => Math.max(0, current - 1))}
          />
          <ActionButton
            icon={<ChevronRight size={13} />}
            label="下一页"
            disabled={!state.hasMore}
            onClick={() => setPage((current) => current + 1)}
          />
        </nav>
      )}
    </div>
  )
}

function ProposalCard({
  diff,
  archived,
  selected,
  mutation,
  onToggleSelection,
  onAccept,
  onReject,
  onEditAccept,
  onReissue,
}: {
  diff: LinguistProposalDiff
  archived: boolean
  selected: boolean
  mutation?: Mutation
  onToggleSelection: (selected: boolean) => void
  onAccept: () => void
  onReject: () => void
  onEditAccept: (editedTarget: string) => void
  onReissue: () => void
}): React.ReactElement {
  const [editing, setEditing] = React.useState(false)
  const [editedTarget, setEditedTarget] = React.useState(diff.proposedTarget)
  const pending = diff.proposal.status === 'pending'
  const conflicted = diff.currentRevision !== diff.baseRevision
  const blocked = archived || conflicted || diff.locked || mutation !== undefined
  const targetMatches = diff.currentTarget === diff.proposedTarget

  return (
    <article className="rounded-2xl bg-content-area p-4 shadow-sm ring-1 ring-border/35">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex min-w-0 items-start gap-2.5">
          <input
            type="checkbox"
            checked={selected}
            aria-label={`选择原始行 ${diff.originalOrdinal} 提案 ${diff.proposal.id}`}
            onChange={(event) => onToggleSelection(event.target.checked)}
            className="mt-0.5 size-4 shrink-0 accent-primary"
          />
          <div className="min-w-0">
            <p className="text-[11px] font-medium text-foreground/60">
              原始行 {diff.originalOrdinal}
              <span className="ml-2 font-mono font-normal text-foreground/35">
                {diff.proposal.segmentId}
              </span>
            </p>
            <p className="mt-0.5 font-mono text-[10px] text-foreground/35">
              {diff.proposal.id} · 基于 r{diff.baseRevision} · 当前 r{diff.currentRevision}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap gap-1">
          <span className="rounded-full bg-foreground/[0.06] px-2 py-1 text-[11px] text-foreground/55">
            {PROPOSAL_STATUS_LABELS[diff.proposal.status]}
          </span>
          {(conflicted || diff.locked) && (
            <span className="inline-flex items-center gap-1 rounded-full bg-destructive/10 px-2 py-1 text-[11px] text-destructive">
              <AlertTriangle size={11} />
              {diff.locked ? '片段已锁定' : '版本冲突'}
            </span>
          )}
        </div>
      </div>

      <div className="mt-4 grid gap-2 lg:grid-cols-3">
        <TextPane label="原文" text={diff.source} />
        <TextPane label="当前译文" text={diff.currentTarget || '（空）'} muted={!diff.currentTarget} />
        <TextPane label="建议译文" text={diff.proposedTarget} accent />
      </div>

      <div className="mt-3 rounded-xl bg-foreground/[0.035] px-3 py-2.5">
        <p className="mb-1.5 text-[10px] font-medium uppercase tracking-wider text-foreground/35">变化</p>
        <p className="whitespace-pre-wrap break-words text-[13px] leading-6 text-foreground/70">
          {textDiffParts(diff.currentTarget, diff.proposedTarget).map((part, index) => (
            <span
              key={`${part.kind}-${index}`}
              className={cn(
                part.kind === 'remove' && 'rounded-sm bg-red-500/10 text-red-600 line-through dark:text-red-400',
                part.kind === 'insert' && 'rounded-sm bg-emerald-500/12 text-emerald-700 dark:text-emerald-300',
              )}
            >
              {part.text}
            </span>
          ))}
        </p>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-1.5 text-[11px] text-foreground/45">
        <span className={cn(
          'rounded-full px-2 py-1',
          targetMatches ? 'bg-success/10 text-success' : 'bg-foreground/[0.055]',
        )}>
          {targetMatches ? '当前译文与此提案一致' : '当前译文与此提案不一致'}
        </span>
        {diff.proposal.warnings.map((warning) => (
          <span key={warning} className="rounded-full bg-warning/10 px-2 py-1 text-warning-foreground">
            {warning}
          </span>
        ))}
        {diff.proposal.evidenceRefs.length > 0 && (
          <span>证据：{diff.proposal.evidenceRefs.join('、')}</span>
        )}
        {diff.proposal.termRefs.length > 0 && (
          <span>术语：{diff.proposal.termRefs.join('、')}</span>
        )}
      </div>

      <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[10px] text-foreground/35">
        <span>创建：{formatTimestamp(diff.proposal.createdAt)}</span>
        <span>生成记录：{diff.issuanceCount ?? 1} 次</span>
        {(diff.latestIssuance?.modelId ?? diff.proposal.modelId) && (
          <span>模型：{diff.latestIssuance?.modelId ?? diff.proposal.modelId}</span>
        )}
        {(diff.latestIssuance?.sessionId ?? diff.proposal.sessionId) && (
          <span>会话：{diff.latestIssuance?.sessionId ?? diff.proposal.sessionId}</span>
        )}
        {(diff.latestIssuance?.runId ?? diff.proposal.runId) && (
          <span>批次：{diff.latestIssuance?.runId ?? diff.proposal.runId}</span>
        )}
        {diff.latestIssuance?.runtime && <span>Runtime：{diff.latestIssuance.runtime}</span>}
        {diff.latestIssuance?.modelProvider && (
          <span>Provider：{diff.latestIssuance.modelProvider}</span>
        )}
        {diff.latestIssuance?.toolCallId && (
          <span>Tool call：{diff.latestIssuance.toolCallId}</span>
        )}
        {diff.proposal.reissuedFromProposalId && (
          <span>重新提出自：{diff.proposal.reissuedFromProposalId}</span>
        )}
        {diff.proposal.supersedesProposalId && (
          <span>取代：{diff.proposal.supersedesProposalId}</span>
        )}
      </div>

      {editing && pending ? (
        <div className="mt-4 flex flex-col gap-2">
          <label className="text-[12px] font-medium text-foreground/60" htmlFor={`edit-${diff.proposal.id}`}>
            编辑后接受
          </label>
          <textarea
            id={`edit-${diff.proposal.id}`}
            value={editedTarget}
            onChange={(event) => setEditedTarget(event.target.value)}
            rows={4}
            className="w-full resize-y rounded-xl bg-background/70 px-3 py-2 text-[13px] leading-5 text-foreground outline-none ring-1 ring-border/60 focus:ring-primary/50"
          />
          <div className="flex justify-end gap-2">
            <ActionButton
              icon={<X size={13} />}
              label="取消"
              onClick={() => {
                setEditedTarget(diff.proposedTarget)
                setEditing(false)
              }}
            />
            <ActionButton
              icon={mutation === 'edit' ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />}
              label="接受编辑"
              primary
              disabled={blocked || editedTarget.trim().length === 0}
              onClick={() => onEditAccept(editedTarget)}
            />
          </div>
        </div>
      ) : (
        <div className="mt-4 flex flex-wrap justify-end gap-2">
          {pending ? (
            <>
              <ActionButton
                icon={mutation === 'reject' ? <Loader2 size={13} className="animate-spin" /> : <X size={13} />}
                label="拒绝"
                disabled={archived || mutation !== undefined}
                onClick={onReject}
              />
              <ActionButton
                icon={<Pencil size={13} />}
                label="编辑"
                disabled={blocked}
                onClick={() => setEditing(true)}
              />
              <ActionButton
                icon={mutation === 'accept' ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />}
                label="接受"
                primary
                disabled={blocked}
                onClick={onAccept}
              />
            </>
          ) : (
            <ActionButton
              icon={mutation === 'reissue' ? <Loader2 size={13} className="animate-spin" /> : <RotateCcw size={13} />}
              label="重新提出"
              disabled={archived || diff.locked || mutation !== undefined}
              title="保留当前终态记录，创建带 lineage 的新 pending 提案"
              onClick={onReissue}
            />
          )}
        </div>
      )}
    </article>
  )
}

function TextPane({
  label,
  text,
  muted = false,
  accent = false,
}: {
  label: string
  text: string
  muted?: boolean
  accent?: boolean
}): React.ReactElement {
  return (
    <div className={cn('rounded-xl px-3 py-2.5', accent ? 'bg-success/[0.07]' : 'bg-foreground/[0.035]')}>
      <p className="mb-1 text-[10px] font-medium uppercase tracking-wider text-foreground/35">{label}</p>
      <p className={cn('whitespace-pre-wrap break-words text-[13px] leading-5', muted ? 'text-foreground/35' : 'text-foreground/75')}>
        {text}
      </p>
    </div>
  )
}

function ActionButton({
  icon,
  label,
  primary = false,
  disabled = false,
  title,
  onClick,
}: {
  icon: React.ReactNode
  label: string
  primary?: boolean
  disabled?: boolean
  title?: string
  onClick: () => void
}): React.ReactElement {
  return (
    <button
      type="button"
      disabled={disabled}
      title={title}
      onClick={onClick}
      className={cn(
        'inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-[12px] font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40',
        primary
          ? 'bg-primary text-primary-foreground shadow-sm hover:bg-primary/90'
          : 'bg-foreground/[0.06] text-foreground/65 hover:bg-foreground/[0.1] hover:text-foreground',
      )}
    >
      {icon}
      {label}
    </button>
  )
}
