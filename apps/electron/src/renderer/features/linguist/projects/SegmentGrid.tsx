import * as React from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { useSetAtom } from 'jotai'
import { toast } from 'sonner'
import { AlertTriangle, Check, Loader2, Lock, Pencil, X } from 'lucide-react'
import type {
  LinguistProposalInfo,
  LinguistSegmentInfo,
  LinguistSegmentStatus,
  LinguistTagProfileInfo,
  LinguistWorkflowStage,
} from '@proma/shared'
import { cn } from '@/lib/utils'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from '@/components/ui/context-menu'
import {
  createSegmentAgentReference,
  linguistSegmentAgentReferenceAtomFamily,
} from './cat-workspace-atoms'
import { gridRowKeyAction, virtualRowKey } from './cat-virtual-utils'
import {
  QA_SEVERITY_BADGE_CLASSES,
  QA_SEVERITY_LABELS,
  type SegmentQaSummary,
} from './qa-findings-utils'
import {
  TargetEditor,
  splitProtectedText,
  type ProtectedTextPart,
  type TargetEditorHandle,
} from './TargetEditor'
import type { TargetSaveResult } from './cat-edit-utils'
import { proposalReviewBlock, textDiffParts } from './proposal-inbox-utils'
import { stageActionLabel, stageProgressLabel } from './workflow-ui'

const ESTIMATED_ROW_HEIGHT = 72
// ponytail: 以默认可视 8 行翻页；动态页步实测影响键盘效率时再从 viewport 计算。
const KEYBOARD_PAGE_SIZE = 8
const GRID_ROW_SHORTCUTS = 'ArrowUp ArrowDown Home End PageUp PageDown Enter F2 Space'

const STATUS_BADGE_CLASSES: Record<LinguistSegmentStatus, string> = {
  untranslated: 'text-foreground/60',
  draft: 'text-info',
  translated: 'text-success',
  reviewed: 'text-review',
}

export type SegmentTextPart = ProtectedTextPart
export const splitSegmentText = splitProtectedText

export interface SegmentGridProps {
  projectId: string
  total: number
  segmentIds: readonly string[]
  rows: ReadonlyMap<number, LinguistSegmentInfo>
  selectedIds: ReadonlySet<string>
  pendingBySegment: ReadonlyMap<string, LinguistProposalInfo>
  mutatingProposalIds: ReadonlySet<string>
  qaBySegment?: ReadonlyMap<string, SegmentQaSummary>
  activeSegmentId?: string
  focusIndex?: number
  archived: boolean
  workflowStage: LinguistWorkflowStage
  tagProfile?: LinguistTagProfileInfo
  onActiveSegmentChange: (segmentId: string, assetId: string) => void
  onOpenDetails: (segmentId: string, assetId: string) => void
  onOpenQa: (segmentId: string, assetId: string) => void
  onFocusIndex: (index: number) => void
  onFocusIndexSettled: (index: number) => void
  onToggleSelected: (segmentId: string) => void
  onVisibleRangeChange: (start: number, end: number) => void
  onSaveTarget: (
    index: number,
    segment: LinguistSegmentInfo,
    target: string,
  ) => Promise<TargetSaveResult>
  onReloadTarget: (
    segmentId: string,
    index: number,
  ) => Promise<LinguistSegmentInfo | undefined>
  onConfirmAndAdvance: (index: number, segment: LinguistSegmentInfo) => Promise<void>
  onUnconfirmStage: (index: number, segment: LinguistSegmentInfo) => Promise<void>
  onReviewProposal: (
    segment: LinguistSegmentInfo,
    proposal: LinguistProposalInfo,
    operation: 'accept' | 'reject',
  ) => Promise<void>
  onTargetEditorCapabilityChange: (
    segmentId: string,
    handle: TargetEditorHandle | undefined,
  ) => void
}

export function SegmentGrid({
  projectId,
  total,
  segmentIds,
  rows,
  selectedIds,
  pendingBySegment,
  mutatingProposalIds,
  qaBySegment,
  activeSegmentId,
  focusIndex,
  archived,
  workflowStage,
  tagProfile,
  onActiveSegmentChange,
  onOpenDetails,
  onOpenQa,
  onFocusIndex,
  onFocusIndexSettled,
  onToggleSelected,
  onVisibleRangeChange,
  onSaveTarget,
  onReloadTarget,
  onConfirmAndAdvance,
  onUnconfirmStage,
  onReviewProposal,
  onTargetEditorCapabilityChange,
}: SegmentGridProps): React.ReactElement {
  const scrollRef = React.useRef<HTMLDivElement>(null)
  const instructionsId = React.useId()
  const setSegmentAgentReference = useSetAtom(linguistSegmentAgentReferenceAtomFamily(projectId))
  /** 显式「为 Agent 引用」：唯一写入入口，滚动/焦点/恢复位置都不会触碰。 */
  const handleSegmentAgentReference = React.useCallback(
    (segmentId: string, assetId: string): void => {
      setSegmentAgentReference(createSegmentAgentReference(segmentId, assetId))
      toast.success('已为 Agent 引用该片段', {
        description: '引用片段 chip 会显示在项目 Agent 输入框上方，可随时移除。',
      })
    },
    [setSegmentAgentReference],
  )
  const rowVirtualizer = useVirtualizer({
    count: total,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ESTIMATED_ROW_HEIGHT,
    initialRect: { width: 0, height: ESTIMATED_ROW_HEIGHT * 8 },
    overscan: 8,
    getItemKey: React.useCallback(
      (index: number) => virtualRowKey(segmentIds, index),
      [segmentIds],
    ),
  })
  const virtualRows = rowVirtualizer.getVirtualItems()
  const firstVirtualIndex = virtualRows[0]?.index
  const lastVirtualIndex = virtualRows.at(-1)?.index

  React.useEffect(() => {
    if (firstVirtualIndex === undefined || lastVirtualIndex === undefined) return
    onVisibleRangeChange(firstVirtualIndex, lastVirtualIndex)
  }, [firstVirtualIndex, lastVirtualIndex, onVisibleRangeChange])

  React.useEffect(() => {
    if (focusIndex === undefined || focusIndex < 0 || focusIndex >= total) return
    rowVirtualizer.scrollToIndex(focusIndex, { align: 'auto' })
  }, [focusIndex, rowVirtualizer, total])

  React.useEffect(() => {
    if (
      focusIndex === undefined
      || !rows.has(focusIndex)
      || firstVirtualIndex === undefined
      || lastVirtualIndex === undefined
      || focusIndex < firstVirtualIndex
      || focusIndex > lastVirtualIndex
    ) return
    const row = scrollRef.current?.querySelector<HTMLElement>(
      `[data-cat-row-index="${focusIndex}"]`,
    )
    if (row === undefined || row === null) return
    const activeElement = document.activeElement
    const focusedRow = activeElement instanceof Element
      ? activeElement.closest<HTMLElement>('[data-cat-row-index]')
      : null
    if (focusedRow?.dataset.catRowIndex !== String(focusIndex)) row.focus()
    onFocusIndexSettled(focusIndex)
  }, [
    firstVirtualIndex,
    focusIndex,
    lastVirtualIndex,
    onFocusIndexSettled,
    rows,
  ])

  return (
    <div className="flex h-full min-h-0 w-full flex-col overflow-hidden rounded-xl bg-content-area shadow-sm ring-1 ring-border/35">
      <div
        role="grid"
        aria-rowcount={total + 1}
        aria-colcount={6}
        aria-multiselectable="true"
        aria-readonly={archived}
        aria-label="Segment Grid"
        aria-describedby={instructionsId}
        className="flex min-h-0 flex-1 flex-col"
      >
        <SegmentGridHeader />
        <VirtualSegmentViewport
          scrollRef={scrollRef}
          totalSize={rowVirtualizer.getTotalSize()}
        >
          {virtualRows.map((virtualRow) => {
            const segment = rows.get(virtualRow.index)
            const segmentId = segmentIds[virtualRow.index]
            return (
              <SegmentRow
                key={virtualRow.key}
                measureElement={rowVirtualizer.measureElement}
                index={virtualRow.index}
                start={virtualRow.start}
                total={total}
                segmentId={segmentId}
                segment={segment}
                selected={segmentId !== undefined && selectedIds.has(segmentId)}
                // active 只表示「键盘/编辑焦点」：未明确选中片段时不绘制任何假 active。
                active={segmentId !== undefined && activeSegmentId === segmentId}
                // roving tabindex 兜底：无 active 片段时首行仅保留键盘入口（不再伪装 active）。
                tabbable={
                  segmentId !== undefined
                  && (activeSegmentId === segmentId
                    || (activeSegmentId === undefined && virtualRow.index === 0))
                }
                archived={archived}
                workflowStage={workflowStage}
                tagProfile={tagProfile}
                proposal={segment === undefined ? undefined : pendingBySegment.get(segment.id)}
                proposalMutating={
                  segment !== undefined
                  && mutatingProposalIds.has(pendingBySegment.get(segment.id)?.id ?? '')
                }
                qaLoaded={qaBySegment !== undefined}
                qaSummary={segment === undefined ? undefined : qaBySegment?.get(segment.id)}
                onActiveSegmentChange={onActiveSegmentChange}
                onOpenDetails={onOpenDetails}
                onOpenQa={onOpenQa}
                onFocusIndex={onFocusIndex}
                onToggleSelected={onToggleSelected}
                onSegmentAgentReference={handleSegmentAgentReference}
                onSaveTarget={onSaveTarget}
                onReloadTarget={onReloadTarget}
                onConfirmAndAdvance={onConfirmAndAdvance}
                onUnconfirmStage={onUnconfirmStage}
                onReviewProposal={onReviewProposal}
                onTargetEditorCapabilityChange={onTargetEditorCapabilityChange}
              />
            )
          })}
        </VirtualSegmentViewport>
      </div>
      <GridLiveRegion
        total={total}
        activeIndex={
          activeSegmentId === undefined ? undefined : segmentIds.indexOf(activeSegmentId)
        }
        selectedCount={selectedIds.size}
      />
      <p id={instructionsId} className="sr-only">
        上下方向键切换片段，Home 和 End 跳到首尾，Page Up 和 Page Down 翻页，
        Enter 或 F2 编辑译文，空格选择当前片段。
      </p>
    </div>
  )
}

function SegmentGridHeader(): React.ReactElement {
  return (
    <div
      role="row"
      aria-rowindex={1}
      className="grid grid-cols-[32px_56px_minmax(0,1fr)_minmax(0,1fr)_100px_72px] gap-2 border-b border-border/40 px-3 py-2 text-[10px] font-medium uppercase tracking-wider text-foreground/60"
    >
      <span role="columnheader" aria-label="选择片段">
        <span className="sr-only">选择</span>
      </span>
      <span role="columnheader">ID</span>
      <span role="columnheader">Source</span>
      <span role="columnheader">Target</span>
      <span role="columnheader">Status</span>
      <span role="columnheader">QA</span>
    </div>
  )
}

function VirtualSegmentViewport({
  scrollRef,
  totalSize,
  children,
}: {
  scrollRef: React.RefObject<HTMLDivElement>
  totalSize: number
  children: React.ReactNode
}): React.ReactElement {
  return (
    <div
      ref={scrollRef}
      data-testid="cat-virtual-scroll"
      role="rowgroup"
      className="h-full min-h-0 flex-1 overflow-auto"
    >
      <div role="presentation" style={{ height: totalSize, position: 'relative' }}>
        {children}
      </div>
    </div>
  )
}

interface SegmentRowProps {
  index: number
  start: number
  total: number
  segmentId?: string
  segment?: LinguistSegmentInfo
  selected: boolean
  active: boolean
  tabbable: boolean
  archived: boolean
  workflowStage: LinguistWorkflowStage
  tagProfile?: LinguistTagProfileInfo
  proposal?: LinguistProposalInfo
  proposalMutating: boolean
  qaLoaded: boolean
  qaSummary?: SegmentQaSummary
  measureElement: (node: Element | null) => void
  onActiveSegmentChange: (segmentId: string, assetId: string) => void
  onOpenDetails: (segmentId: string, assetId: string) => void
  onOpenQa: (segmentId: string, assetId: string) => void
  onFocusIndex: (index: number) => void
  onToggleSelected: (segmentId: string) => void
  onSegmentAgentReference: (segmentId: string, assetId: string) => void
  onSaveTarget: (
    index: number,
    segment: LinguistSegmentInfo,
    target: string,
  ) => Promise<TargetSaveResult>
  onReloadTarget: (
    segmentId: string,
    index: number,
  ) => Promise<LinguistSegmentInfo | undefined>
  onConfirmAndAdvance: (index: number, segment: LinguistSegmentInfo) => Promise<void>
  onUnconfirmStage: (index: number, segment: LinguistSegmentInfo) => Promise<void>
  onReviewProposal: (
    segment: LinguistSegmentInfo,
    proposal: LinguistProposalInfo,
    operation: 'accept' | 'reject',
  ) => Promise<void>
  onTargetEditorCapabilityChange: (
    segmentId: string,
    handle: TargetEditorHandle | undefined,
  ) => void
}

function SegmentRow({
  index,
  start,
  total,
  segmentId,
  segment,
  selected,
  active,
  tabbable,
  archived,
  workflowStage,
  tagProfile,
  proposal,
  proposalMutating,
  qaLoaded,
  qaSummary,
  measureElement,
  onActiveSegmentChange,
  onOpenDetails,
  onOpenQa,
  onFocusIndex,
  onToggleSelected,
  onSegmentAgentReference,
  onSaveTarget,
  onReloadTarget,
  onConfirmAndAdvance,
  onUnconfirmStage,
  onReviewProposal,
  onTargetEditorCapabilityChange,
}: SegmentRowProps): React.ReactElement {
  const row = (
    <div
      ref={measureElement}
      role="row"
      tabIndex={tabbable ? 0 : -1}
      aria-rowindex={index + 2}
      aria-selected={selected}
      aria-current={active ? 'true' : undefined}
      aria-keyshortcuts={GRID_ROW_SHORTCUTS}
      aria-label={
        segment === undefined
          ? `结果 ${index + 1}/${total}，正在加载`
          : getSegmentRowLabel(
              index,
              total,
              segment,
              workflowStage,
              proposal,
              qaLoaded,
              qaSummary,
            )
      }
      data-index={index}
      data-segment-id={segmentId}
      data-cat-row-index={index}
      data-target-double-click={
        segment !== undefined && !archived && !segment.locked ? '' : undefined
      }
      onFocus={(event) => {
        if (event.target === event.currentTarget && segment !== undefined) {
          onActiveSegmentChange(segment.id, segment.assetId)
        }
      }}
      onKeyDown={(event) => {
        const target = event.target
        if (!(target instanceof Element) || target.closest('[data-target-editor]') !== null) return
        const action = gridRowKeyAction({
          key: event.key,
          currentIndex: index,
          total,
          pageSize: KEYBOARD_PAGE_SIZE,
          metaKey: event.metaKey,
          ctrlKey: event.ctrlKey,
          altKey: event.altKey,
        })
        if (action === null) return
        if (target !== event.currentTarget && action.type !== 'focus') return
        event.preventDefault()
        if (action.type === 'focus') {
          onFocusIndex(action.index)
        } else if (action.type === 'toggle-selection' && segmentId !== undefined) {
          onToggleSelected(segmentId)
        } else if (action.type === 'edit' && segment !== undefined && !archived && !segment.locked) {
          event.currentTarget.querySelector<HTMLButtonElement>('[data-target-edit]')?.click()
        }
      }}
      onDoubleClick={(event) => {
        const target = event.target
        if (
          segment === undefined
          || archived
          || segment.locked
          || !(target instanceof Element)
          || target.closest('button, input, [data-target-editor]') !== null
        ) return
        event.currentTarget.querySelector<HTMLButtonElement>('[data-target-edit]')?.click()
      }}
      className={cn(
        'absolute left-0 top-0 grid min-h-[72px] w-full grid-cols-[32px_56px_minmax(0,1fr)_minmax(0,1fr)_100px_72px] items-start gap-2 border-b border-border/30 px-3 py-2 text-[12px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary/60',
        selected && 'bg-primary/[0.055]',
        active && 'min-h-[104px] bg-primary/[0.025] ring-1 ring-inset ring-primary/30',
      )}
      style={{ transform: `translateY(${start}px)` }}
    >
      {segment === undefined || segmentId === undefined ? (
        <span
          role="gridcell"
          aria-colspan={6}
          className="col-span-6 self-center text-foreground/30"
        >
          正在加载…
        </span>
      ) : (
        <>
          <SelectionCell
            index={segment.ordinal}
            segmentId={segmentId}
            selected={selected}
            tabbable={tabbable}
            onActivate={() => onActiveSegmentChange(segment.id, segment.assetId)}
            onToggleSelected={onToggleSelected}
          />
          <IdCell
            ordinal={segment.ordinal}
            resultIndex={index}
            resultTotal={total}
          />
          <SourceCell
            index={segment.ordinal}
            segment={segment}
            expanded={active}
            tabbable={tabbable}
            onActivate={onActiveSegmentChange}
            tagProfile={tagProfile}
          />
          <TargetCell
            index={segment.ordinal}
            segment={segment}
            archived={archived}
            workflowStage={workflowStage}
            tagProfile={tagProfile}
            expanded={active}
            active={active}
            tabbable={tabbable}
            onActivate={() => onActiveSegmentChange(segment.id, segment.assetId)}
            onSave={(target) => onSaveTarget(index, segment, target)}
            onReload={() => onReloadTarget(segment.id, index)}
            onConfirmAndAdvance={() => onConfirmAndAdvance(index, segment)}
            onTargetEditorCapabilityChange={onTargetEditorCapabilityChange}
          />
          <StatusCell
            index={segment.ordinal}
            segment={segment}
            proposal={proposal}
            active={active}
            tabbable={tabbable}
            archived={archived}
            workflowStage={workflowStage}
            onActivate={() => onOpenDetails(segment.id, segment.assetId)}
            onConfirm={() => onConfirmAndAdvance(index, segment)}
            onUnconfirm={() => onUnconfirmStage(index, segment)}
          />
          <QaCell
            index={segment.ordinal}
            loaded={qaLoaded}
            summary={qaSummary}
            tabbable={tabbable}
            onActivate={() => onOpenQa(segment.id, segment.assetId)}
          />
          {active && proposal !== undefined && (
            <ProposalInlineReview
              segment={segment}
              proposal={proposal}
              archived={archived}
              mutating={proposalMutating}
              onReview={(operation) => onReviewProposal(segment, proposal, operation)}
            />
          )}
        </>
      )}
    </div>
  )

  // 「为 Agent 引用」行菜单：唯一显式 segment scope 入口；加载中的占位行不挂菜单。
  if (segment === undefined) return row
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>{row}</ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuItem
          onSelect={() => onSegmentAgentReference(segment.id, segment.assetId)}
        >
          为 Agent 引用
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  )
}

function ProposalInlineReview({
  segment,
  proposal,
  archived,
  mutating,
  onReview,
}: {
  segment: LinguistSegmentInfo
  proposal: LinguistProposalInfo
  archived: boolean
  mutating: boolean
  onReview: (operation: 'accept' | 'reject') => void
}): React.ReactElement {
  const acceptBlocked = proposalReviewBlock(segment, proposal, archived, 'accept')
  const rejectBlocked = proposalReviewBlock(segment, proposal, archived, 'reject')
  const blockedReasonId = React.useId()
  const evidence = [...proposal.evidenceRefs, ...proposal.termRefs]
  const blockedLabel = acceptBlocked === 'archived'
    ? '项目已归档'
    : acceptBlocked === 'locked'
    ? '片段已锁定'
    : acceptBlocked === 'stale'
    ? `版本冲突：建议基于 r${proposal.baseRevision}，当前为 r${segment.revision}`
    : undefined

  return (
    <section
      aria-label="当前行翻译建议"
      className="col-span-4 col-start-3 mt-1 rounded-xl bg-review/[0.055] px-3 py-2.5 shadow-sm"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="rounded-full bg-review/10 px-2 py-0.5 text-[10px] font-medium text-review">
          待查看建议
        </span>
        {blockedLabel !== undefined && (
          <span
            id={blockedReasonId}
            role="alert"
            className="inline-flex items-center gap-1 text-[11px] text-destructive"
          >
            <AlertTriangle aria-hidden="true" className="size-3" />
            {blockedLabel}
          </span>
        )}
      </div>
      <div className="mt-2 grid gap-2 lg:grid-cols-2">
        <div>
          <p className="text-[10px] font-medium uppercase tracking-wider text-foreground/60">当前译文</p>
          <p className="mt-0.5 whitespace-pre-wrap break-words text-[12px] text-foreground/55">
            {segment.target || '（空）'}
          </p>
        </div>
        <div>
          <p className="text-[10px] font-medium uppercase tracking-wider text-review">建议译文</p>
          <p className="mt-0.5 whitespace-pre-wrap break-words text-[12px] text-foreground">
            {textDiffParts(segment.target, proposal.proposedTarget).map((part, index) => (
              part.kind === 'remove'
                ? <del key={`${part.kind}-${index}`} className="rounded-sm bg-destructive/10 text-destructive">{part.text}</del>
                : part.kind === 'insert'
                ? <ins key={`${part.kind}-${index}`} className="rounded-sm bg-success/10 text-success no-underline">{part.text}</ins>
                : <React.Fragment key={`${part.kind}-${index}`}>{part.text}</React.Fragment>
            ))}
          </p>
        </div>
      </div>
      <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
        <p className="text-[10px] text-foreground/60">
          {evidence.length > 0 ? `证据：${evidence.join(' · ')}` : '证据：未提供'}
          {proposal.warnings.length > 0 ? ` · ${proposal.warnings.join(' · ')}` : ''}
        </p>
        <div className="flex gap-1.5">
          <button
            type="button"
            disabled={rejectBlocked !== undefined || mutating}
            aria-describedby={rejectBlocked !== undefined ? blockedReasonId : undefined}
            onClick={() => onReview('reject')}
            className="inline-flex items-center gap-1 rounded-md bg-foreground/[0.06] px-2.5 py-1 text-[11px] font-medium disabled:cursor-not-allowed disabled:opacity-40"
          >
            {mutating ? <Loader2 aria-hidden="true" className="size-3 animate-spin" /> : <X aria-hidden="true" className="size-3" />}
            拒绝
          </button>
          <button
            type="button"
            disabled={acceptBlocked !== undefined || mutating}
            aria-describedby={acceptBlocked !== undefined ? blockedReasonId : undefined}
            onClick={() => onReview('accept')}
            className="inline-flex items-center gap-1 rounded-md bg-primary px-2.5 py-1 text-[11px] font-medium text-primary-foreground disabled:cursor-not-allowed disabled:opacity-40"
          >
            {mutating ? <Loader2 aria-hidden="true" className="size-3 animate-spin" /> : <Check aria-hidden="true" className="size-3" />}
            接受
          </button>
        </div>
      </div>
    </section>
  )
}

function SelectionCell({
  index,
  segmentId,
  selected,
  tabbable,
  onActivate,
  onToggleSelected,
}: {
  index: number
  segmentId: string
  selected: boolean
  tabbable: boolean
  onActivate: () => void
  onToggleSelected: (segmentId: string) => void
}): React.ReactElement {
  return (
    <span role="gridcell" className="pt-1">
      <input
        type="checkbox"
        tabIndex={tabbable ? 0 : -1}
        checked={selected}
        onChange={() => {
          onActivate()
          onToggleSelected(segmentId)
        }}
        aria-label={`选择原始行 ${index + 1}`}
      />
    </span>
  )
}

function IdCell({
  ordinal,
  resultIndex,
  resultTotal,
}: {
  ordinal: number
  resultIndex: number
  resultTotal: number
}): React.ReactElement {
  return (
    <span
      role="gridcell"
      aria-label={`原始行 ${ordinal + 1}，结果 ${resultIndex + 1}/${resultTotal}`}
      className="pt-1 font-mono text-foreground/60"
    >
      {ordinal + 1}
    </span>
  )
}

function SourceCell({
  index,
  segment,
  expanded,
  tabbable,
  onActivate,
  tagProfile,
}: {
  index: number
  segment: LinguistSegmentInfo
  expanded: boolean
  tabbable: boolean
  onActivate: (segmentId: string, assetId: string) => void
  tagProfile?: LinguistTagProfileInfo
}): React.ReactElement {
  return (
    <span role="gridcell" aria-label={`源文：${segment.source}`}>
      <button
        type="button"
        tabIndex={tabbable ? 0 : -1}
        aria-label={`查看原始行 ${index + 1} 上下文`}
        onClick={() => onActivate(segment.id, segment.assetId)}
        className={cn(
          'w-full whitespace-pre-wrap break-words rounded-md px-1.5 py-1 text-left text-foreground/60 hover:bg-foreground/[0.05] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50',
          !expanded && 'line-clamp-2',
        )}
      >
        <SegmentText text={segment.source} tagProfile={tagProfile} />
      </button>
    </span>
  )
}

function TargetCell({
  index,
  segment,
  archived,
  workflowStage,
  tagProfile,
  expanded,
  active,
  tabbable,
  onActivate,
  onSave,
  onReload,
  onConfirmAndAdvance,
  onTargetEditorCapabilityChange,
}: {
  index: number
  segment: LinguistSegmentInfo
  archived: boolean
  workflowStage: LinguistWorkflowStage
  tagProfile?: LinguistTagProfileInfo
  expanded: boolean
  active: boolean
  tabbable: boolean
  onActivate: () => void
  onSave: (target: string) => Promise<TargetSaveResult>
  onReload: () => Promise<LinguistSegmentInfo | undefined>
  onConfirmAndAdvance: () => Promise<void>
  onTargetEditorCapabilityChange: (
    segmentId: string,
    handle: TargetEditorHandle | undefined,
  ) => void
}): React.ReactElement {
  const [editing, setEditing] = React.useState(false)
  const editButtonRef = React.useRef<HTMLButtonElement>(null)
  const restoreFocusRef = React.useRef(false)
  const handleCapabilityChange = React.useCallback(
    (handle: TargetEditorHandle | undefined): void => {
      onTargetEditorCapabilityChange(segment.id, handle)
    },
    [onTargetEditorCapabilityChange, segment.id],
  )

  React.useEffect(() => {
    if (editing || !restoreFocusRef.current) return
    restoreFocusRef.current = false
    if (active) editButtonRef.current?.focus()
  }, [active, editing])

  const closeEditor = (restoreFocus: boolean): void => {
    restoreFocusRef.current = restoreFocus
    setEditing(false)
  }

  if (!editing) {
    return (
      <span
        role="gridcell"
        aria-label={`译文：${segment.target || '空'}`}
        aria-readonly={archived || segment.locked}
      >
        <button
          ref={editButtonRef}
          type="button"
          tabIndex={tabbable ? 0 : -1}
          data-target-edit
          disabled={archived || segment.locked}
          aria-label={
            archived
              ? `项目已归档，原始行 ${index + 1} 无法编辑`
              : segment.locked
              ? `原始行 ${index + 1} 已锁定，无法编辑`
              : `编辑原始行 ${index + 1} 译文`
          }
          onClick={() => {
            onActivate()
            setEditing(true)
          }}
          className={cn(
            'group flex w-full items-start gap-1.5 rounded-md px-1.5 py-1 text-left hover:bg-foreground/[0.05] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 disabled:cursor-not-allowed disabled:hover:bg-transparent',
            segment.target ? 'text-foreground' : 'text-foreground/60',
          )}
        >
          <span
            className={cn(
              'flex-1 whitespace-pre-wrap break-words',
              !expanded && 'line-clamp-2',
            )}
          >
            {segment.target ? <SegmentText text={segment.target} tagProfile={tagProfile} /> : '—'}
          </span>
          {!archived && !segment.locked && (
            <Pencil
              aria-hidden="true"
              className="mt-0.5 size-3 shrink-0 opacity-0 group-hover:opacity-60 group-focus-visible:opacity-60"
            />
          )}
        </button>
      </span>
    )
  }

  return (
    <span role="gridcell">
      <TargetEditor
        index={index}
        segment={segment}
        archived={archived}
        tagProfile={tagProfile}
        confirmLabel={stageActionLabel(workflowStage)}
        onCancel={() => closeEditor(true)}
        onSave={onSave}
        onReload={onReload}
        onHandleChange={handleCapabilityChange}
        onSaved={(advance) => {
          closeEditor(!advance)
          if (advance) void onConfirmAndAdvance()
        }}
      />
    </span>
  )
}

function StatusCell({
  index,
  segment,
  proposal,
  active,
  tabbable,
  archived,
  workflowStage,
  onActivate,
  onConfirm,
  onUnconfirm,
}: {
  index: number
  segment: LinguistSegmentInfo
  proposal?: LinguistProposalInfo
  active: boolean
  tabbable: boolean
  archived: boolean
  workflowStage: LinguistWorkflowStage
  onActivate: () => void
  onConfirm: () => Promise<void>
  onUnconfirm: () => Promise<void>
}): React.ReactElement {
  const proposalLabel = getProposalLabel(segment, proposal)
  const stageState = segment.currentStageState ?? 'untouched'
  const stageLabel = stageProgressLabel(workflowStage, stageState, segment.target !== '')
  return (
    <span
      role="gridcell"
      aria-label={[
        `本轮状态：${segment.locked ? '已锁定' : stageLabel}`,
        segment.importedNativeStatus === undefined
          ? undefined
          : `导入状态：${segment.importedNativeStatus}`,
        proposalLabel,
      ].filter(Boolean).join('，')}
      className="min-w-0 pt-0.5"
    >
      <button
        type="button"
        tabIndex={tabbable ? 0 : -1}
        aria-label={`查看原始行 ${segment.ordinal + 1} 当前行详情`}
        title={[
          `本轮状态：${segment.locked ? '已锁定' : stageLabel}`,
          segment.importedNativeStatus === undefined
            ? undefined
            : `原生状态：${segment.importedNativeStatus}`,
        ].filter(Boolean).join('\n')}
        onClick={onActivate}
        className="flex w-full min-w-0 flex-col items-start gap-1 rounded-md px-1 py-0.5 text-left hover:bg-foreground/[0.05] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
      >
        {segment.locked ? (
          <span className="inline-flex items-center gap-1 truncate text-foreground/60">
            <Lock aria-hidden="true" className="size-3 shrink-0" />
            已锁定
          </span>
        ) : (
          <span className={cn('truncate font-medium', STATUS_BADGE_CLASSES[segment.status])}>
            {stageLabel}
          </span>
        )}
        {proposalLabel !== undefined && (
          <span className="rounded-full bg-review/10 px-1.5 py-0.5 text-[10px] text-review">
            {proposalLabel}
          </span>
        )}
      </button>
      {active && !archived && !segment.locked && segment.target !== '' && (
        <button
          type="button"
          className="mt-1 rounded-md bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-primary hover:bg-primary/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
          onClick={() => {
            void (stageState === 'confirmed' ? onUnconfirm() : onConfirm())
          }}
        >
          {stageState === 'confirmed' ? '撤销本轮确认' : stageActionLabel(workflowStage)}
        </button>
      )}
    </span>
  )
}

function QaCell({
  index,
  loaded,
  summary,
  tabbable,
  onActivate,
}: {
  index: number
  loaded: boolean
  summary?: SegmentQaSummary
  tabbable: boolean
  onActivate: () => void
}): React.ReactElement {
  const summaryLabel = !loaded
    ? 'QA 状态尚未加载'
    : summary === undefined
    ? '无开放 QA Finding'
    : `${summary.count} 个开放 QA，最高 ${QA_SEVERITY_LABELS[summary.highestSeverity]}`
  return (
    <span role="gridcell" className="pt-0.5">
      <button
        type="button"
        tabIndex={tabbable ? 0 : -1}
        aria-label={`查看原始行 ${index + 1} QA：${summaryLabel}`}
        onClick={onActivate}
        className="flex min-w-0 flex-col items-start rounded-md px-1.5 py-1 text-left text-foreground/60 hover:bg-foreground/[0.05] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
      >
        {!loaded ? (
          '…'
        ) : summary === undefined ? (
          '无'
        ) : (
          <>
            <span className="font-medium text-foreground">{summary.count} 个</span>
            <span className={cn(
              'text-[10px]',
              QA_SEVERITY_BADGE_CLASSES[summary.highestSeverity],
            )}>
              {QA_SEVERITY_LABELS[summary.highestSeverity]}
            </span>
          </>
        )}
      </button>
    </span>
  )
}

function getProposalLabel(
  segment: LinguistSegmentInfo,
  proposal?: LinguistProposalInfo,
): string | undefined {
  if (proposal === undefined) return undefined
  return segment.revision === proposal.baseRevision ? '建议待查看' : '建议已过期'
}

function getSegmentRowLabel(
  resultIndex: number,
  resultTotal: number,
  segment: LinguistSegmentInfo,
  workflowStage: LinguistWorkflowStage,
  proposal?: LinguistProposalInfo,
  qaLoaded = true,
  qaSummary?: SegmentQaSummary,
): string {
  const proposalLabel = getProposalLabel(segment, proposal)
  const qaLabel = !qaLoaded
    ? 'QA 状态尚未加载'
    : qaSummary === undefined
    ? '无开放 QA'
    : `${qaSummary.count} 个开放 QA，最高 ${QA_SEVERITY_LABELS[qaSummary.highestSeverity]}`
  const stageLabel = stageProgressLabel(
    workflowStage,
    segment.currentStageState ?? 'untouched',
    segment.target !== '',
  )
  return [
    `原始行 ${segment.ordinal + 1}`,
    `结果 ${resultIndex + 1}/${resultTotal}`,
    `segmentId ${segment.id}`,
    `源文：${segment.source}`,
    `译文：${segment.target || '空'}`,
    segment.locked ? '已锁定' : stageLabel,
    segment.importedNativeStatus === undefined
      ? undefined
      : `导入状态：${segment.importedNativeStatus}`,
    proposalLabel,
    qaLabel,
  ].filter(Boolean).join('，')
}

function SegmentText({ text, tagProfile }: { text: string; tagProfile?: LinguistTagProfileInfo }): React.ReactElement {
  return (
    <>
      {splitProtectedText(text, tagProfile).map((part, index) => (
        part.kind !== 'text' ? (
          <span
            key={`${index}:${part.value}`}
            data-segment-token={part.kind === 'token' ? true : undefined}
            data-segment-suspected-tag={part.kind === 'suspected' ? true : undefined}
            className={part.kind === 'token'
              ? 'mx-0.5 inline-flex max-w-full rounded bg-primary/10 px-1 py-0.5 font-mono text-[0.9em] leading-none text-primary'
              : 'mx-0.5 inline-flex max-w-full rounded bg-warning/10 px-1 py-0.5 font-mono text-[0.9em] leading-none text-warning'}
            title={part.kind === 'token' ? '已启用硬保护' : '疑似 Tag：仅软提示'}
          >
            {part.value}
          </span>
        ) : (
          <React.Fragment key={`${index}:${part.value}`}>{part.value}</React.Fragment>
        )
      ))}
    </>
  )
}

function GridLiveRegion({
  total,
  activeIndex,
  selectedCount,
}: {
  total: number
  activeIndex?: number
  selectedCount: number
}): React.ReactElement {
  return (
    <p aria-live="polite" aria-atomic="true" className="sr-only">
      {activeIndex === undefined || activeIndex < 0
        ? `共 ${total} 个片段，已选择 ${selectedCount} 项`
        : `活动片段 ${activeIndex + 1}，共 ${total} 个片段，已选择 ${selectedCount} 项`}
    </p>
  )
}
