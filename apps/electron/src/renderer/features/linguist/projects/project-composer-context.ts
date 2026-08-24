import type { LinguistAssetInfo } from '@proma/shared'
import type { ComposerContextChip } from '@/features/linguist/composer/ComposerContextChips'
import {
  resolveVisibleSegmentAgentReference,
  type LinguistSegmentAgentReference,
  type LinguistWorkbenchUiState,
} from './cat-workspace-atoms'

interface BuildProjectComposerContextChipsInput {
  projectId: string
  projectName: string
  assets: readonly LinguistAssetInfo[]
  uiState: LinguistWorkbenchUiState
  segmentReference?: LinguistSegmentAgentReference
  onRemoveSegmentReference?: () => void
  onClearSelectedSegments: () => void
}

export function buildProjectComposerContextChips({
  projectId,
  projectName,
  assets,
  uiState,
  segmentReference,
  onRemoveSegmentReference,
  onClearSelectedSegments,
}: BuildProjectComposerContextChipsInput): readonly ComposerContextChip[] {
  const activeAsset = assets.find((asset) => asset.assetId === uiState.activeAssetId)
  const chips: ComposerContextChip[] = [{
    id: 'project',
    label: projectName,
    scope: `项目范围 · ${projectId}`,
  }]
  if (uiState.activeAssetId) {
    chips.push({
      id: 'asset',
      label: activeAsset?.filename ?? '当前批次',
      scope: `批次范围 · ${uiState.activeAssetId}`,
    })
  }
  const visibleSegmentReference = resolveVisibleSegmentAgentReference(segmentReference, assets)
  if (visibleSegmentReference) {
    chips.push({
      id: 'segment-reference',
      label: '引用片段',
      scope: `Agent 引用片段 · ${visibleSegmentReference.segmentId}`,
      onRemove: onRemoveSegmentReference,
    })
  }
  if (uiState.selectedSegmentIds.length > 0) {
    chips.push({
      id: 'selection',
      label: `已选 ${uiState.selectedSegmentIds.length} 段`,
      scope: `已选片段范围 · ${uiState.selectedSegmentIds.length} 段`,
      onRemove: onClearSelectedSegments,
    })
  }
  return chips
}
