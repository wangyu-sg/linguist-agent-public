import * as React from 'react'
import { useAtom } from 'jotai'
import { FileText, Search } from 'lucide-react'
import type { LinguistAssetInfo, LinguistProjectSummary } from '@proma/shared'
import { cn } from '@/lib/utils'
import { linguistWorkbenchUiStateAtomFamily, type LinguistWorkbenchUiState } from './cat-workspace-atoms'
import { stageProgressSummary } from './workflow-ui'

export function getAssetNavigatorSelectionPatch(
  state: LinguistWorkbenchUiState,
  assetId: string | undefined,
): Pick<LinguistWorkbenchUiState, 'activeAssetId' | 'activeSegmentId'> {
  return {
    activeAssetId: assetId,
    activeSegmentId: assetId === undefined ? undefined : state.assetActiveSegmentIds[assetId],
  }
}

interface AssetNavigatorProps {
  projectId: string
  summary: LinguistProjectSummary | undefined
}

export function AssetNavigator({ projectId, summary }: AssetNavigatorProps): React.ReactElement {
  const [uiState, setUiState] = useAtom(linguistWorkbenchUiStateAtomFamily(projectId))
  const query = uiState.assetNavigatorSearch.trim().toLocaleLowerCase()
  const assets = summary?.assets.filter((asset) => asset.filename.toLocaleLowerCase().includes(query)) ?? []
  const selectAsset = (assetId: string | undefined): void => {
    setUiState((current) => getAssetNavigatorSelectionPatch(current, assetId))
  }

  return (
    <section aria-label="资产导航器" className="flex h-full min-h-0 flex-col gap-3 p-3">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-foreground">资产</h2>
        {summary !== undefined && (
          <span className="text-xs text-muted-foreground">{summary.assetCount} 个文件</span>
        )}
      </div>
      <label className="relative">
        <Search aria-hidden="true" className="pointer-events-none absolute left-2.5 top-2.5 size-3.5 text-muted-foreground" />
        <span className="sr-only">搜索资产</span>
        <input
          value={uiState.assetNavigatorSearch}
          onChange={(event) => setUiState({ assetNavigatorSearch: event.target.value })}
          placeholder="搜索资产"
          maxLength={200}
          className="h-8 w-full rounded-md bg-background pl-8 pr-2 text-xs outline-none ring-1 ring-border/50 focus:ring-primary/50"
        />
      </label>
      {summary !== undefined && (
        <p className="text-xs text-muted-foreground">
          项目状态：{stageProgressSummary(
            summary.project.workflowStage ?? 'translation',
            summary.currentStageCounts,
          )}
        </p>
      )}
      <nav aria-label="项目资产" className="min-h-0 space-y-1 overflow-y-auto">
        <AssetButton
          active={uiState.activeAssetId === undefined}
          label="全部资产"
          detail={summary === undefined ? '加载中…' : `${summary.totalSegments} 段`}
          onClick={() => selectAsset(undefined)}
        />
        {summary === undefined ? (
          <p className="px-2 py-3 text-xs text-muted-foreground">正在加载资产…</p>
        ) : assets.length === 0 ? (
          <p className="px-2 py-3 text-xs text-muted-foreground">
            {summary.assetCount === 0 ? '尚未导入资产' : '没有匹配的资产'}
          </p>
        ) : assets.map((asset) => (
          <AssetButton
            key={asset.assetId}
            active={uiState.activeAssetId === asset.assetId}
            asset={asset}
            label={asset.filename}
            detail={`${stageProgressSummary(
              summary.project.workflowStage ?? 'translation',
              asset.currentStageCounts,
            )} · QA ${asset.openQaCount}`}
            onClick={() => selectAsset(asset.assetId)}
          />
        ))}
      </nav>
    </section>
  )
}

function AssetButton({
  active,
  asset,
  label,
  detail,
  onClick,
}: {
  active: boolean
  asset?: LinguistAssetInfo
  label: string
  detail: string
  onClick: () => void
}): React.ReactElement {
  return (
    <button
      type="button"
      aria-current={active ? 'page' : undefined}
      data-asset-id={asset?.assetId}
      onClick={onClick}
      className={cn(
        'flex w-full items-start gap-2 rounded-md px-2 py-2 text-left transition-colors hover:bg-accent/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50',
        active && 'bg-primary/10 text-primary',
      )}
    >
      <FileText aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-xs font-medium">{label}</span>
        <span className="block text-[11px] text-foreground/65">{detail}</span>
      </span>
    </button>
  )
}
