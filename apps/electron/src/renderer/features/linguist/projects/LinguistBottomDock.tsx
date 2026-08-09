import { useAtom, useAtomValue } from 'jotai'
import type { LinguistAssetInfo } from '@proma/shared'
import type { KeyboardEvent, ReactElement } from 'react'
import { toast } from 'sonner'
import { ExternalLink } from 'lucide-react'
import {
  type LinguistBottomDockTab,
  linguistQaFindingsCapabilityAtomFamily,
  linguistWorkbenchUiStateAtomFamily,
} from './cat-workspace-atoms'
import { ContextEvidencePanel } from './ContextEvidencePanel'
import { useOpenLinguistPreview } from './linguist-preview-open'
import { QaFindingsPanel } from './QaFindingsPanel'
import { PrepareDeliveryPanel } from './PrepareDeliveryPanel'
import { ProposalInbox, type ProposalReviewCoverage } from './ProposalInbox'
import { TermMatchPanel } from './TermMatchPanel'
import { TmMatchPanel } from './TmMatchPanel'

const TABS: ReadonlyArray<{ id: LinguistBottomDockTab; label: string }> = [
  { id: 'tm', label: 'TM 匹配' },
  { id: 'terms', label: '术语' },
  { id: 'qa', label: 'QA' },
  { id: 'context', label: '上下文/证据' },
  { id: 'preview', label: '预览' },
  { id: 'proposals', label: '待查看建议' },
  { id: 'delivery', label: '准备交付' },
]

const ignoreQaJump = (): void => undefined
const ignoreQaMutation = async (): Promise<void> => undefined

export function getNextBottomDockTab(
  current: LinguistBottomDockTab,
  key: string,
): LinguistBottomDockTab | undefined {
  const currentIndex = TABS.findIndex((tab) => tab.id === current)
  if (key === 'Home') return TABS[0]?.id
  if (key === 'End') return TABS.at(-1)?.id
  if (key !== 'ArrowLeft' && key !== 'ArrowRight') return undefined
  const step = key === 'ArrowRight' ? 1 : -1
  return TABS[(currentIndex + step + TABS.length) % TABS.length]?.id
}

export function LinguistBottomDock({
  projectId,
  assets = [],
  archived = false,
  proposalCoverage,
  onProjectChanged,
}: {
  projectId: string
  assets?: readonly LinguistAssetInfo[]
  archived?: boolean
  proposalCoverage?: ProposalReviewCoverage
  onProjectChanged?: () => void
}): ReactElement {
  const [uiState, setUiState] = useAtom(linguistWorkbenchUiStateAtomFamily(projectId))
  const qaCapability = useAtomValue(linguistQaFindingsCapabilityAtomFamily(projectId))
  /** 批次预览统一进 Proma Preview Tab；dock 只保留入口，不再内嵌第二套预览面。 */
  const openLinguistPreview = useOpenLinguistPreview()
  const activeTab = TABS.find((tab) => tab.id === uiState.bottomDockTab) ?? TABS[0]!
  const previewAsset = assets.find((asset) => asset.assetId === uiState.activeAssetId)
  const openActiveAssetPreview = (): void => {
    if (previewAsset === undefined) return
    const opened = openLinguistPreview({
      kind: 'batch',
      projectId,
      assetId: previewAsset.assetId,
      filename: previewAsset.filename,
      formatId: previewAsset.formatId,
      segmentCount: previewAsset.segmentCount,
      segmentCounts: previewAsset.segmentCounts,
      currentStageCounts: previewAsset.currentStageCounts,
      openQaCount: previewAsset.openQaCount,
    })
    if (!opened) toast('项目会话尚未就绪，请稍后重试')
  }
  const handleTabKeyDown = (
    event: KeyboardEvent<HTMLButtonElement>,
    tabId: LinguistBottomDockTab,
  ): void => {
    const nextTab = getNextBottomDockTab(tabId, event.key)
    if (nextTab === undefined) return
    event.preventDefault()
    setUiState({ bottomDockTab: nextTab })
    event.currentTarget.ownerDocument
      .getElementById(`linguist-dock-tab-${projectId}-${nextTab}`)
      ?.focus()
  }

  return (
    <div className="flex h-full min-h-0 flex-col pt-1">
      <div role="tablist" aria-label="语言资产" className="flex shrink-0 gap-1 overflow-x-auto px-3">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            id={`linguist-dock-tab-${projectId}-${tab.id}`}
            type="button"
            role="tab"
            aria-selected={activeTab.id === tab.id}
            aria-controls={`linguist-dock-panel-${projectId}`}
            tabIndex={activeTab.id === tab.id ? 0 : -1}
            onClick={() => setUiState({ bottomDockTab: tab.id })}
            onKeyDown={(event) => handleTabKeyDown(event, tab.id)}
            className="rounded-md px-2.5 py-1.5 text-xs font-medium text-muted-foreground hover:bg-accent hover:text-foreground aria-selected:bg-accent aria-selected:text-foreground"
          >
            {tab.label}
          </button>
        ))}
      </div>
      <div
        id={`linguist-dock-panel-${projectId}`}
        role="tabpanel"
        aria-labelledby={`linguist-dock-tab-${projectId}-${activeTab.id}`}
        data-bottom-dock-scroll="true"
        tabIndex={0}
        className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-3 text-sm text-muted-foreground"
      >
        {activeTab.id === 'tm' ? (
          <TmMatchPanel
            projectId={projectId}
            activeSegmentId={uiState.activeSegmentId}
            archived={archived}
          />
        ) : activeTab.id === 'terms' ? (
          <TermMatchPanel
            projectId={projectId}
            activeSegmentId={uiState.activeSegmentId}
            archived={archived}
          />
        ) : activeTab.id === 'qa' ? (
          <QaFindingsPanel
            projectId={projectId}
            segmentId={uiState.activeSegmentId}
            archived={archived}
            onJump={qaCapability?.jumpToFinding ?? ignoreQaJump}
            onChanged={qaCapability?.refreshAfterMutation ?? ignoreQaMutation}
            refreshToken={qaCapability?.refreshToken ?? 0}
          />
        ) : activeTab.id === 'context' ? (
          <ContextEvidencePanel
            projectId={projectId}
            activeSegmentId={uiState.activeSegmentId}
            onOpenTerms={() => setUiState({ bottomDockTab: 'terms' })}
          />
        ) : activeTab.id === 'preview' ? (
          previewAsset === undefined ? (
            <p>选择批次后可在此打开预览</p>
          ) : (
            <div className="flex flex-col gap-2">
              <p className="text-[12px] text-foreground/60">
                <span className="font-medium text-foreground">{previewAsset.filename}</span>
                <span className="ml-2 text-foreground/45">{previewAsset.formatId} · {previewAsset.segmentCount} 段 · 只读</span>
              </p>
              <div>
                <button
                  type="button"
                  onClick={openActiveAssetPreview}
                  className="inline-flex items-center gap-1.5 rounded-md bg-foreground/[0.06] px-2.5 py-1.5 text-[12px] font-medium text-foreground/70 hover:bg-foreground/[0.09] hover:text-foreground transition-colors duration-100"
                >
                  <ExternalLink size={12} />
                  在预览标签页中打开
                </button>
              </div>
            </div>
          )
        ) : activeTab.id === 'proposals' ? (
          <ProposalInbox
            projectId={projectId}
            archived={archived}
            coverage={proposalCoverage}
            onChanged={async () => {
              await qaCapability?.refreshAfterMutation()
              onProjectChanged?.()
            }}
          />
        ) : activeTab.id === 'delivery' ? (
          <PrepareDeliveryPanel
            projectId={projectId}
            assets={assets}
            initialAssetId={uiState.activeAssetId}
            archived={archived}
            onChanged={onProjectChanged}
          />
        ) : (
          <>
            <span className="font-medium text-foreground">{activeTab.label}</span>
            <span className="ml-2">{uiState.activeSegmentId ?? '选择片段后显示相关语言资产'}</span>
          </>
        )}
      </div>
    </div>
  )
}
