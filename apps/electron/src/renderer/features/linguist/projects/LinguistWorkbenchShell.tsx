import * as React from 'react'
import { useAtom, useAtomValue, useStore } from 'jotai'
import { Archive, Bot, Languages, PanelBottom, PanelLeft, PanelRight, Settings } from 'lucide-react'
import type { LinguistProjectInfo, LinguistStageDecisionCoverage, LinguistWorkflowStage } from '@proma/shared'
import type { WorkbenchSummaryState } from './project-summary-atoms'

export type { WorkbenchSummaryState }
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import {
  AGENT_RAIL_DEFAULT_WIDTH,
  AGENT_RAIL_MAX_WIDTH,
  AGENT_RAIL_MIN_WIDTH,
  ASSET_NAVIGATOR_DEFAULT_WIDTH,
  ASSET_NAVIGATOR_MAX_WIDTH,
  ASSET_NAVIGATOR_MIN_WIDTH,
  BOTTOM_DOCK_DEFAULT_HEIGHT,
  BOTTOM_DOCK_MAX_HEIGHT,
  BOTTOM_DOCK_MIN_HEIGHT,
  clampAgentRailWidth,
  clampAssetNavigatorWidth,
  clampBottomDockHeight,
  linguistProjectSettingsTabAtomFamily,
  linguistWorkbenchUiStateAtomFamily,
} from './cat-workspace-atoms'
import { ProjectSettingsSheet } from './ProjectSettingsSheet'
import { UnknownTagNotice, unknownTagScanRevision } from './UnknownTagNotice'
import {
  COVERAGE_STAGES,
  formatStageCoverage,
  hasStageCoverageProgress,
  linguistStageCoverageAtomFamily,
  refreshLinguistStageCoverage,
  stageCoverageKey,
} from './stage-coverage-atoms'
import { stageProgressLabel, stageProgressSummary } from './workflow-ui'

const PANEL_KEYBOARD_STEP = 16
export const CAT_COLUMN_MIN_WIDTH = 512

export function getAssetNavigatorWidthFromKey(width: number, key: string): number | null {
  switch (key) {
    case 'ArrowLeft':
      return clampAssetNavigatorWidth(width - PANEL_KEYBOARD_STEP)
    case 'ArrowRight':
      return clampAssetNavigatorWidth(width + PANEL_KEYBOARD_STEP)
    case 'Home':
      return ASSET_NAVIGATOR_MIN_WIDTH
    case 'End':
      return ASSET_NAVIGATOR_MAX_WIDTH
    case 'Enter':
      return ASSET_NAVIGATOR_DEFAULT_WIDTH
    default:
      return null
  }
}

export function getAgentRailWidthFromKey(width: number, key: string): number | null {
  switch (key) {
    case 'ArrowLeft':
      return clampAgentRailWidth(width + PANEL_KEYBOARD_STEP)
    case 'ArrowRight':
      return clampAgentRailWidth(width - PANEL_KEYBOARD_STEP)
    case 'Home':
      return AGENT_RAIL_MIN_WIDTH
    case 'End':
      return AGENT_RAIL_MAX_WIDTH
    case 'Enter':
      return AGENT_RAIL_DEFAULT_WIDTH
    default:
      return null
  }
}

export function getBottomDockHeightFromKey(height: number, key: string): number | null {
  switch (key) {
    case 'ArrowUp':
      return clampBottomDockHeight(height + PANEL_KEYBOARD_STEP)
    case 'ArrowDown':
      return clampBottomDockHeight(height - PANEL_KEYBOARD_STEP)
    case 'Home':
      return BOTTOM_DOCK_MIN_HEIGHT
    case 'End':
      return BOTTOM_DOCK_MAX_HEIGHT
    case 'Enter':
      return BOTTOM_DOCK_DEFAULT_HEIGHT
    default:
      return null
  }
}

interface LinguistWorkbenchShellProps {
  project: LinguistProjectInfo
  summaryState: WorkbenchSummaryState
  onSummaryRefresh: () => void
  onProjectArchived?: (project: LinguistProjectInfo) => void
  onProjectDeleted?: (projectId: string) => void
  assetNavigator?: React.ReactNode
  agentRail?: React.ReactNode
  bottomDock?: React.ReactNode
  children: React.ReactNode
}

export function LinguistWorkbenchShell({
  project,
  summaryState,
  onSummaryRefresh,
  onProjectArchived,
  onProjectDeleted,
  assetNavigator,
  agentRail,
  bottomDock,
  children,
}: LinguistWorkbenchShellProps): React.ReactElement {
  const [uiState, setUiState] = useAtom(linguistWorkbenchUiStateAtomFamily(project.id))
  const [settingsInitialTab, setSettingsInitialTab] = useAtom(
    linguistProjectSettingsTabAtomFamily(project.id),
  )
  const assetNavigatorResizeStart = React.useRef<{
    pointerId: number
    clientX: number
    width: number
  } | null>(null)
  const agentRailResizeStart = React.useRef<{
    pointerId: number
    clientX: number
    width: number
  } | null>(null)
  const bottomDockResizeStart = React.useRef<{
    pointerId: number
    clientY: number
    height: number
  } | null>(null)
  const summary = summaryState.status === 'ready' ? summaryState.summary : undefined
  const activeAsset = summary?.assets.find((asset) => asset.assetId === uiState.activeAssetId)
  const store = useStore()
  const stageCoverage = useAtomValue(
    linguistStageCoverageAtomFamily(
      stageCoverageKey(project.id, uiState.activeAssetId ?? ''),
    ),
  )
  // 批次切换或摘要刷新（含 Agent 确认触发的 mutation 刷新）后重拉覆盖统计。
  React.useEffect(() => {
    if (activeAsset === undefined) return
    void refreshLinguistStageCoverage(store, project.id, activeAsset.assetId)
  }, [store, project.id, activeAsset, summary])
  const agentOpen = uiState.agentPresentation !== 'closed'
  const agentFull = uiState.agentPresentation === 'full'
  const agentToggleRef = React.useRef<HTMLButtonElement>(null)
  /** 浮层脱困：scrim 点击 / ESC 关闭 rail 后焦点回到头部 Agent 开关。 */
  const closeAgentRail = React.useCallback((): void => {
    setUiState({ agentPresentation: 'closed' })
    agentToggleRef.current?.focus()
  }, [setUiState])
  // rail 内「收起项目 Agent」按钮直接改 uiState，不经过 closeAgentRail；
  // 统一在 open→closed 跳变时归还焦点，避免焦点随按钮卸载丢失到 body。
  const agentOpenRef = React.useRef(agentOpen)
  React.useEffect(() => {
    if (agentOpenRef.current && !agentOpen) agentToggleRef.current?.focus()
    agentOpenRef.current = agentOpen
  }, [agentOpen])
  const handleAgentRailEscape = React.useCallback(
    (event: React.KeyboardEvent<HTMLElement>): void => {
      if (event.key !== 'Escape') return
      // 输入控件内的 Esc 留给控件自身（取消编辑 / 收起补全），不关 rail。
      if (event.target instanceof HTMLElement
        && event.target.closest('input, textarea, [contenteditable="true"]') !== null) return
      event.stopPropagation()
      closeAgentRail()
    },
    [closeAgentRail],
  )
  // U-09：头部进度带口径前缀——选中批次时为「本批次」，尚无批次时投影为全项目零值。
  const progressLabel = summaryState.status === 'ready'
    ? activeAsset !== undefined || summaryState.summary.assets.length === 0
      ? `${activeAsset !== undefined ? '本批次' : '全项目'} · ${stageProgressSummary(
          project.workflowStage ?? 'translation',
          activeAsset?.currentStageCounts ?? summaryState.summary.currentStageCounts,
        )}`
      : '请选择批次'
    : summaryState.status === 'loading'
      ? '统计加载中…'
      : '统计不可用'
  const agentRailStyle = {
    width: uiState.agentRailWidth,
    '--agent-rail-inline-max': `calc(100% - ${
      CAT_COLUMN_MIN_WIDTH
      + (assetNavigator !== undefined && uiState.assetNavigatorOpen
        ? uiState.assetNavigatorWidth
        : 0)
    }px)`,
  } as React.CSSProperties

  const handleAssetNavigatorPointerDown = React.useCallback(
    (event: React.PointerEvent<HTMLDivElement>): void => {
      if (event.button !== 0) return
      event.preventDefault()
      event.currentTarget.focus()
      event.currentTarget.setPointerCapture(event.pointerId)
      assetNavigatorResizeStart.current = {
        pointerId: event.pointerId,
        clientX: event.clientX,
        width: uiState.assetNavigatorWidth,
      }
    },
    [uiState.assetNavigatorWidth],
  )

  const handleAssetNavigatorPointerMove = React.useCallback(
    (event: React.PointerEvent<HTMLDivElement>): void => {
      const start = assetNavigatorResizeStart.current
      if (start?.pointerId !== event.pointerId) return
      setUiState({
        assetNavigatorWidth: clampAssetNavigatorWidth(
          start.width + event.clientX - start.clientX,
        ),
      })
    },
    [setUiState],
  )

  const handleAssetNavigatorPointerEnd = React.useCallback(
    (event: React.PointerEvent<HTMLDivElement>): void => {
      if (assetNavigatorResizeStart.current?.pointerId !== event.pointerId) return
      assetNavigatorResizeStart.current = null
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId)
      }
    },
    [],
  )

  const handleAssetNavigatorKeyDown = React.useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>): void => {
      const width = getAssetNavigatorWidthFromKey(uiState.assetNavigatorWidth, event.key)
      if (width === null) return
      event.preventDefault()
      setUiState({ assetNavigatorWidth: width })
    },
    [setUiState, uiState.assetNavigatorWidth],
  )

  const handleAgentRailPointerDown = React.useCallback(
    (event: React.PointerEvent<HTMLDivElement>): void => {
      if (event.button !== 0) return
      event.preventDefault()
      event.currentTarget.focus()
      event.currentTarget.setPointerCapture(event.pointerId)
      agentRailResizeStart.current = {
        pointerId: event.pointerId,
        clientX: event.clientX,
        width: uiState.agentRailWidth,
      }
    },
    [uiState.agentRailWidth],
  )

  const handleAgentRailPointerMove = React.useCallback(
    (event: React.PointerEvent<HTMLDivElement>): void => {
      const start = agentRailResizeStart.current
      if (start?.pointerId !== event.pointerId) return
      setUiState({
        agentRailWidth: clampAgentRailWidth(start.width + start.clientX - event.clientX),
      })
    },
    [setUiState],
  )

  const handleAgentRailPointerEnd = React.useCallback(
    (event: React.PointerEvent<HTMLDivElement>): void => {
      if (agentRailResizeStart.current?.pointerId !== event.pointerId) return
      agentRailResizeStart.current = null
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId)
      }
    },
    [],
  )

  const handleAgentRailKeyDown = React.useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>): void => {
      const width = getAgentRailWidthFromKey(uiState.agentRailWidth, event.key)
      if (width === null) return
      event.preventDefault()
      setUiState({ agentRailWidth: width })
    },
    [setUiState, uiState.agentRailWidth],
  )

  const handleBottomDockPointerDown = React.useCallback(
    (event: React.PointerEvent<HTMLDivElement>): void => {
      if (event.button !== 0) return
      event.preventDefault()
      event.currentTarget.focus()
      event.currentTarget.setPointerCapture(event.pointerId)
      bottomDockResizeStart.current = {
        pointerId: event.pointerId,
        clientY: event.clientY,
        height: uiState.bottomDockHeight,
      }
    },
    [uiState.bottomDockHeight],
  )

  const handleBottomDockPointerMove = React.useCallback(
    (event: React.PointerEvent<HTMLDivElement>): void => {
      const start = bottomDockResizeStart.current
      if (start?.pointerId !== event.pointerId) return
      setUiState({
        bottomDockHeight: clampBottomDockHeight(start.height + start.clientY - event.clientY),
      })
    },
    [setUiState],
  )

  const handleBottomDockPointerEnd = React.useCallback(
    (event: React.PointerEvent<HTMLDivElement>): void => {
      if (bottomDockResizeStart.current?.pointerId !== event.pointerId) return
      bottomDockResizeStart.current = null
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId)
      }
    },
    [],
  )

  const handleBottomDockKeyDown = React.useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>): void => {
      const height = getBottomDockHeightFromKey(uiState.bottomDockHeight, event.key)
      if (height === null) return
      event.preventDefault()
      setUiState({ bottomDockHeight: height })
    },
    [setUiState, uiState.bottomDockHeight],
  )

  return (
    <section aria-label={`${project.name} 本地化工作台`} className="relative flex h-full min-h-0 flex-col bg-background">
      <header
        aria-label="本地化工作台工具栏"
        className="flex min-h-14 shrink-0 flex-wrap items-center justify-between gap-3 bg-content-area/90 px-4 py-2 shadow-[0_1px_0_hsl(var(--border)/0.45)] max-md:flex-col max-md:items-stretch max-md:gap-2"
      >
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <Languages aria-hidden="true" className="size-4" />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h1 className="truncate text-sm font-semibold text-foreground">{project.name}</h1>
              {project.archivedAt !== undefined && (
                <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-foreground/[0.06] px-2 py-0.5 text-[11px] text-muted-foreground">
                  <Archive aria-hidden="true" className="size-3" />
                  已归档 · 只读
                </span>
              )}
            </div>
            <p className="flex min-w-0 items-center gap-2 overflow-hidden text-xs text-muted-foreground">
              <span className="font-mono">{project.sourceLocale} → {project.targetLocale}</span>
              <span aria-hidden="true" className="max-sm:hidden">·</span>
              <span className="shrink-0 max-sm:hidden">{progressLabel}</span>
              <span aria-hidden="true" className="max-sm:hidden">·</span>
              <span className="max-w-44 truncate max-sm:hidden">
                {activeAsset?.filename ?? (summary?.assets.length === 0 ? '尚无批次' : '未选择批次')}
              </span>
            </p>
          </div>
        </div>

        <div aria-label="工作台面板开关" className="flex items-center gap-1 overflow-x-auto [&>button]:shrink-0">
          {assetNavigator !== undefined && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              aria-pressed={uiState.assetNavigatorOpen}
              onClick={() => setUiState({ assetNavigatorOpen: !uiState.assetNavigatorOpen })}
              className={cn(uiState.assetNavigatorOpen && 'bg-accent/70')}
            >
              <PanelLeft aria-hidden="true" />
              批次
            </Button>
          )}
          {bottomDock !== undefined && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              aria-pressed={uiState.bottomDockOpen}
              onClick={() => setUiState({ bottomDockOpen: !uiState.bottomDockOpen })}
              className={cn(uiState.bottomDockOpen && 'bg-accent/70')}
            >
              <PanelBottom aria-hidden="true" />
              语言资产
            </Button>
          )}
          {agentRail !== undefined && (
            <Button
              ref={agentToggleRef}
              type="button"
              variant="ghost"
              size="sm"
              aria-pressed={agentOpen}
              onClick={() => setUiState({
                agentPresentation: agentOpen ? 'closed' : 'rail',
              })}
              className={cn(agentOpen && 'bg-accent/70')}
            >
              {agentOpen
                ? <PanelRight aria-hidden="true" />
                : <Bot aria-hidden="true" />}
              Agent
            </Button>
          )}
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => setUiState({ projectSettingsOpen: true })}
          >
            <Settings aria-hidden="true" />
            项目设置
          </Button>
        </div>
      </header>

      <ProjectSettingsSheet
        open={uiState.projectSettingsOpen}
        project={project}
        summary={summaryState.status === 'ready' ? summaryState.summary : null}
        initialTab={settingsInitialTab}
        onOpenChange={(open) => {
          setUiState({ projectSettingsOpen: open })
          // 「直达分类」意图是一次性的；关闭后即消费完毕，下次打开回到默认分类。
          if (!open) setSettingsInitialTab(undefined)
        }}
        onSummaryRefresh={onSummaryRefresh}
        onProjectArchived={onProjectArchived}
        onProjectDeleted={onProjectDeleted}
      />

      <div className="relative flex min-h-0 flex-1">
        {!agentFull && assetNavigator !== undefined && uiState.assetNavigatorOpen && (
          <aside
            aria-label="批次导航"
            data-workbench-slot="asset-navigator"
            className="relative min-h-0 shrink-0 overflow-hidden bg-content-area/55 shadow-[1px_0_0_hsl(var(--border)/0.45)] max-md:absolute max-md:inset-y-0 max-md:left-0 max-md:z-20 max-md:max-w-72 max-md:bg-content-area max-md:shadow-xl"
            style={{ width: uiState.assetNavigatorWidth }}
          >
            <div
              role="separator"
              aria-label="调整批次导航宽度"
              aria-orientation="vertical"
              aria-valuemin={ASSET_NAVIGATOR_MIN_WIDTH}
              aria-valuemax={ASSET_NAVIGATOR_MAX_WIDTH}
              aria-valuenow={uiState.assetNavigatorWidth}
              aria-valuetext={`${uiState.assetNavigatorWidth} 像素`}
              tabIndex={0}
              title="拖动调整宽度；方向键微调；Enter 或双击复位"
              onPointerDown={handleAssetNavigatorPointerDown}
              onPointerMove={handleAssetNavigatorPointerMove}
              onPointerUp={handleAssetNavigatorPointerEnd}
              onPointerCancel={handleAssetNavigatorPointerEnd}
              onLostPointerCapture={() => {
                assetNavigatorResizeStart.current = null
              }}
              onKeyDown={handleAssetNavigatorKeyDown}
              onDoubleClick={() => setUiState({
                assetNavigatorWidth: ASSET_NAVIGATOR_DEFAULT_WIDTH,
              })}
              className="group absolute inset-y-0 right-0 z-10 w-2 translate-x-1/2 cursor-col-resize touch-none bg-transparent outline-none"
            >
              <span
                aria-hidden="true"
                data-resize-grip="true"
                className="pointer-events-none absolute inset-y-4 left-1/2 w-px -translate-x-1/2 rounded-full bg-transparent transition-colors group-hover:bg-primary/70 group-focus-visible:bg-primary"
              />
            </div>
            {assetNavigator}
          </aside>
        )}

        <div
          data-workbench-slot="cat-column"
          className={cn(
            'relative min-h-0 min-w-[32rem] flex-1 flex-col max-md:min-w-0',
            agentFull ? 'hidden' : 'flex',
          )}
          style={{
            // 语言资产面板在 max-lg 转为浮层时，把浮层高度传给网格滚动区让位。
            '--bottom-dock-overlay-height': !agentFull && bottomDock !== undefined && uiState.bottomDockOpen
              ? `${uiState.bottomDockHeight}px`
              : '0px',
          } as React.CSSProperties}
        >
          <UnknownTagNotice
            projectId={project.id}
            scanRevision={unknownTagScanRevision(project.updatedAt, summary?.assets ?? [])}
            archived={project.archivedAt !== undefined}
          />
          <main data-workbench-slot="segment-grid" className="min-h-0 min-w-0 flex-1 overflow-hidden">
            {children}
          </main>

          {!agentFull && bottomDock !== undefined && uiState.bottomDockOpen && (
            <section
              aria-label="语言资产面板"
              data-workbench-slot="bottom-dock"
              className="relative min-h-0 shrink-0 overflow-hidden bg-content-area/70 shadow-[0_-1px_0_hsl(var(--border)/0.45)] max-lg:absolute max-lg:inset-x-0 max-lg:bottom-0 max-lg:z-20 max-lg:shadow-xl"
              style={{ height: uiState.bottomDockHeight }}
            >
              <div
                role="separator"
                aria-label="调整语言资产面板高度"
                aria-orientation="horizontal"
                aria-valuemin={BOTTOM_DOCK_MIN_HEIGHT}
                aria-valuemax={BOTTOM_DOCK_MAX_HEIGHT}
                aria-valuenow={uiState.bottomDockHeight}
                aria-valuetext={`${uiState.bottomDockHeight} 像素`}
                tabIndex={0}
                title="拖动调整高度；方向键微调；Enter 或双击复位"
                onPointerDown={handleBottomDockPointerDown}
                onPointerMove={handleBottomDockPointerMove}
                onPointerUp={handleBottomDockPointerEnd}
                onPointerCancel={handleBottomDockPointerEnd}
                onLostPointerCapture={() => {
                  bottomDockResizeStart.current = null
                }}
                onKeyDown={handleBottomDockKeyDown}
                onDoubleClick={() => setUiState({
                  bottomDockHeight: BOTTOM_DOCK_DEFAULT_HEIGHT,
                })}
                className="group absolute inset-x-0 top-0 z-10 h-2 -translate-y-1/2 cursor-row-resize touch-none bg-transparent outline-none"
              >
                <span
                  aria-hidden="true"
                  data-resize-grip="true"
                  className="pointer-events-none absolute inset-x-6 top-1/2 h-px -translate-y-1/2 rounded-full bg-transparent transition-colors group-hover:bg-primary/70 group-focus-visible:bg-primary"
                />
              </div>
              {bottomDock}
            </section>
          )}
        </div>

        {agentRail !== undefined && agentOpen && !agentFull && (
          <div
            aria-hidden="true"
            data-workbench-slot="agent-rail-scrim"
            onClick={closeAgentRail}
            className="hidden max-2xl:block max-2xl:absolute max-2xl:inset-0 max-2xl:z-10 max-2xl:bg-foreground/25"
          />
        )}

        {agentRail !== undefined && agentOpen && (
          <aside
            aria-label="项目 Agent"
            aria-keyshortcuts="Escape"
            data-workbench-slot={agentFull ? 'agent-full' : 'agent-rail'}
            data-linguist-agent-presentation={uiState.agentPresentation}
            onKeyDown={handleAgentRailEscape}
            className={cn(
              'relative min-h-0 overflow-hidden bg-content-area/55',
              agentFull
                ? 'flex-1'
                : 'shrink-0 shadow-[-1px_0_0_hsl(var(--border)/0.45)] 2xl:max-w-[var(--agent-rail-inline-max)] max-2xl:absolute max-2xl:inset-y-0 max-2xl:right-0 max-2xl:z-20 max-2xl:max-w-[calc(100%-3rem)] max-2xl:bg-content-area max-2xl:shadow-xl',
            )}
            style={agentFull ? undefined : agentRailStyle}
          >
            {!agentFull && <div
              role="separator"
              aria-label="调整项目 Agent 宽度"
              aria-orientation="vertical"
              aria-valuemin={AGENT_RAIL_MIN_WIDTH}
              aria-valuemax={AGENT_RAIL_MAX_WIDTH}
              aria-valuenow={uiState.agentRailWidth}
              aria-valuetext={`${uiState.agentRailWidth} 像素`}
              tabIndex={0}
              title="拖动调整宽度；方向键微调；Enter 或双击复位"
              onPointerDown={handleAgentRailPointerDown}
              onPointerMove={handleAgentRailPointerMove}
              onPointerUp={handleAgentRailPointerEnd}
              onPointerCancel={handleAgentRailPointerEnd}
              onLostPointerCapture={() => {
                agentRailResizeStart.current = null
              }}
              onKeyDown={handleAgentRailKeyDown}
              onDoubleClick={() => setUiState({
                agentRailWidth: AGENT_RAIL_DEFAULT_WIDTH,
              })}
              className="group absolute inset-y-0 left-0 z-10 w-2 -translate-x-1/2 cursor-col-resize touch-none bg-transparent outline-none"
            >
              <span
                aria-hidden="true"
                data-resize-grip="true"
                className="pointer-events-none absolute inset-y-4 left-1/2 w-px -translate-x-1/2 rounded-full bg-transparent transition-colors group-hover:bg-primary/70 group-focus-visible:bg-primary"
              />
            </div>}
            {agentRail}
          </aside>
        )}
      </div>

      {!agentFull && <footer
        aria-label="本地化工作台状态栏"
        className="flex min-h-7 shrink-0 flex-wrap items-center justify-between gap-x-4 gap-y-1 bg-content-area px-4 py-1 text-[11px] text-muted-foreground shadow-[0_-1px_0_hsl(var(--border)/0.45)]"
      >
        <div className="flex flex-wrap items-center gap-x-3">
          {/* U-06：只渲染非零指标与当前阶段计数；整体进度与批次名由头部承载，不再重复。 */}
          {activeAsset !== undefined && activeAsset.currentStageCounts.draft > 0 && (
            <span>
              {stageProgressLabel(project.workflowStage ?? 'translation', 'draft', true)}
              {' '}
              {activeAsset.currentStageCounts.draft}
            </span>
          )}
          {activeAsset !== undefined && COVERAGE_STAGES.map((stage) => {
            const coverage = stageCoverage[stage]
            if (coverage === undefined) return null
            const currentStage = project.workflowStage ?? 'translation'
            if (stage !== currentStage && !hasStageCoverageProgress(coverage)) return null
            return <StageCoverageSpan key={stage} stage={stage} coverage={coverage} />
          })}
          {activeAsset !== undefined && activeAsset.sourceCharacters > 0 && (
            <span>源文 {activeAsset.sourceCharacters} 字符</span>
          )}
          {activeAsset !== undefined && activeAsset.targetCharacters > 0 && (
            <span>译文 {activeAsset.targetCharacters} 字符</span>
          )}
          <span title={uiState.activeSegmentId ?? undefined}>
            当前片段：{uiState.activeSegmentId === null || uiState.activeSegmentId === undefined
              ? '未选择片段'
              : `${uiState.activeSegmentId.slice(0, 12)}…`}
          </span>
          {uiState.selectedSegmentIds.length > 0 && (
            <span>已选择 {uiState.selectedSegmentIds.length}</span>
          )}
        </div>
        <span className="hidden sm:inline">↑↓ 切换片段 · Enter 编辑 · Esc 取消</span>
      </footer>}
    </section>
  )
}

/** 状态栏单阶段覆盖紧凑展示；阻塞 > 0 用警告色（明显但不惊扰）。 */
function StageCoverageSpan({
  stage,
  coverage,
}: {
  stage: LinguistWorkflowStage
  coverage: LinguistStageDecisionCoverage
}): React.ReactElement {
  const view = formatStageCoverage(stage, coverage)
  return (
    <span
      data-stage-coverage={stage}
      data-complete={view.complete}
      className={coverage.blocked > 0 ? 'text-warning' : undefined}
    >
      {view.text}
    </span>
  )
}
