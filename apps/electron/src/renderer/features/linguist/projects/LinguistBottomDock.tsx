import { useAtom, useAtomValue } from 'jotai'
import type { LinguistAssetInfo } from '@proma/shared'
import type { KeyboardEvent, ReactElement } from 'react'
import {
  type LinguistBottomDockTab,
  linguistQaFindingsCapabilityAtomFamily,
  linguistWorkbenchUiStateAtomFamily,
} from './cat-workspace-atoms'
import { ContextEvidencePanel } from './ContextEvidencePanel'
import { LinguistAssetPreviewSurface } from './LinguistAssetPreview'
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
  { id: 'proposals', label: '提案' },
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
  const activeTab = TABS.find((tab) => tab.id === uiState.bottomDockTab) ?? TABS[0]!
  const previewAsset = assets.find((asset) => asset.assetId === uiState.activeAssetId)
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
      <div role="tablist" aria-label="语言资源" className="flex shrink-0 gap-1 overflow-x-auto px-3">
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
            <p>选择资产后显示只读格式预览</p>
          ) : (
            <LinguistAssetPreviewSurface
              projectId={projectId}
              asset={previewAsset}
              embedded
            />
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
            <span className="ml-2">{uiState.activeSegmentId ?? '选择片段后显示相关资源'}</span>
          </>
        )}
      </div>
    </div>
  )
}
