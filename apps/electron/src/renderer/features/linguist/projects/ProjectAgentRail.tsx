import * as React from 'react'
import { useAtom, useAtomValue, useSetAtom, useStore } from 'jotai'
import type { createStore } from 'jotai/vanilla'
import { ArrowLeft, Maximize2, PanelRightClose } from 'lucide-react'
import { createLinguistTurnContextV1 } from '@proma/shared'
import type {
  AgentSessionMeta,
  LinguistAssetInfo,
  LinguistIpcError,
  LinguistIpcResult,
  LinguistQualityProfile,
  LinguistSessionCreateForProjectRequest,
} from '@proma/shared'
import {
  agentPendingPromptAtom,
  agentSidePanelOpenAtom,
  agentSessionsAtom,
  type AgentPendingPrompt,
} from '@/atoms/agent-atoms'
import { agentSideChatMapAtom } from '@/atoms/chat-atoms'
import { projectCurrentAgentSessionIdMapAtom } from '@/atoms/project-agent-session-atoms'
import { AgentView } from '@/components/agent/AgentView'
import { SidePanel } from '@/components/agent/SidePanel'
import { extensionRegistry } from '@/host/extensions'
import { UNAVAILABLE_AGENT_HOST_CAPABILITIES } from '@/host/contracts'
import { getAgentSurfaceControls } from '@/host/extension-registry'
import type { ComposerContextChip } from '@/features/linguist/composer/ComposerContextChips'
import { Button } from '@/components/ui/button'
import {
  captureLinguistTurnContextSnapshot,
  linguistWorkbenchUiStateAtomFamily,
  type LinguistWorkbenchUiState,
} from './cat-workspace-atoms'
import { describeLinguistIpcError } from './project-utils'
import { ensureProjectAgentSession } from './project-agent-session'

type JotaiStore = ReturnType<typeof createStore>
type CreateProjectSession = (
  input: LinguistSessionCreateForProjectRequest,
) => Promise<LinguistIpcResult<AgentSessionMeta>>

export type ProjectAgentRailSessionState =
  | { status: 'ready'; sessionId: string }
  | { status: 'error'; error: LinguistIpcError }

export async function loadProjectAgentRailSession(
  store: JotaiStore,
  projectId: string,
  createSession?: CreateProjectSession,
): Promise<ProjectAgentRailSessionState> {
  try {
    const result = await ensureProjectAgentSession(store, projectId, createSession)
    return result.ok
      ? { status: 'ready', sessionId: result.data.id }
      : { status: 'error', error: result.error }
  } catch {
    return {
      status: 'error',
      error: { code: 'INTERNAL', message: '项目 Agent 会话创建失败' },
    }
  }
}

interface ProjectAgentRailFailure {
  projectId: string
  error: LinguistIpcError
}

interface BuildProjectComposerContextChipsInput {
  projectId: string
  projectName: string
  assets: readonly LinguistAssetInfo[]
  uiState: LinguistWorkbenchUiState
  onClearSelectedSegments: () => void
}

export function buildProjectComposerContextChips({
  projectId,
  projectName,
  assets,
  uiState,
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
      label: activeAsset?.filename ?? '当前资产',
      scope: `资产范围 · ${uiState.activeAssetId}`,
    })
  }
  if (uiState.activeSegmentId) {
    chips.push({
      id: 'active-segment',
      label: '当前片段',
      scope: `活动片段 · ${uiState.activeSegmentId}`,
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

export type ProjectAgentQuickActionId = 'translate' | 'review' | 'qa'

export interface ProjectAgentQuickAction {
  id: ProjectAgentQuickActionId
  label: string
  prompt: string
  scope: string
  disabled: boolean
}

const QUICK_ACTION_SEGMENT_LIMIT = 50

export function buildProjectAgentQuickActions(
  uiState: LinguistWorkbenchUiState,
): readonly ProjectAgentQuickAction[] {
  const selectedCount = uiState.selectedSegmentIds.length
  const hasTarget = selectedCount > 0 || uiState.activeSegmentId !== undefined
  const overLimit = selectedCount > QUICK_ACTION_SEGMENT_LIMIT
  const disabled = !hasTarget || overLimit
  const scope = overLimit
    ? `已选 ${selectedCount} 段，请缩小到 50 段以内。`
    : selectedCount > 0
      ? `将处理已选 ${selectedCount} 个片段。`
      : uiState.activeSegmentId
        ? '将处理当前片段。'
        : '请先选择片段或激活当前片段。'
  const target = selectedCount > 0
    ? `当前已选 ${selectedCount} 个片段`
    : '当前片段'

  return [
    {
      id: 'translate',
      label: selectedCount > 0 ? '翻译已选' : '翻译当前',
      prompt: `请翻译${target}。请使用当前项目上下文和现有 CAT Tools 创建 Proposal，只创建建议，不要直接覆盖或接受译文。`,
      scope,
      disabled,
    },
    {
      id: 'review',
      label: selectedCount > 0 ? '审校已选' : '审校当前',
      prompt: `请审校${target}。请使用当前项目上下文和现有 CAT Tools 创建 Proposal，只创建建议，不要直接覆盖或接受译文。`,
      scope,
      disabled,
    },
    {
      id: 'qa',
      label: '项目 QA',
      prompt: '请运行整个项目的确定性 QA。检查范围必须是整个项目，当前选择不限制检查范围；请使用现有 CAT Tools 报告发现的问题。',
      scope: 'QA 始终检查整个项目，当前选择不限制范围。',
      disabled: false,
    },
  ]
}

export function createProjectAgentQuickActionPendingPrompt(
  store: JotaiStore,
  projectId: string,
  sessionId: string,
  actionId: ProjectAgentQuickActionId,
  capturedAt = new Date().toISOString(),
): AgentPendingPrompt | null {
  const uiState = store.get(linguistWorkbenchUiStateAtomFamily(projectId))
  const action = buildProjectAgentQuickActions(uiState).find(({ id }) => id === actionId)!
  if (action.disabled) return null

  const snapshot = actionId === 'qa'
    ? createLinguistTurnContextV1({
      projectId,
      selectedSegmentIds: [],
      capturedAt,
      uiRevision: uiState.uiRevision,
    })
    : captureLinguistTurnContextSnapshot(store, projectId, capturedAt)
  if (snapshot.selectionTruncated) return null

  return {
    sessionId,
    message: action.prompt,
    linguistContext: snapshot.context,
  }
}

interface ProjectAgentRailProps {
  projectId: string
  projectName: string
  qualityProfile: LinguistQualityProfile
  assets?: readonly LinguistAssetInfo[]
}

export function ProjectAgentRail({
  projectId,
  projectName,
  qualityProfile,
  assets = [],
}: ProjectAgentRailProps): React.ReactElement {
  const store = useStore()
  const sessionId = useAtomValue(projectCurrentAgentSessionIdMapAtom).get(projectId)
  const sessions = useAtomValue(agentSessionsAtom)
  const sideChatConversationId = useAtomValue(agentSideChatMapAtom).get(sessionId ?? '') ?? null
  const sidePanelOpen = useAtomValue(agentSidePanelOpenAtom)
  const setPendingPrompt = useSetAtom(agentPendingPromptAtom)
  const [uiState, setUiState] = useAtom(linguistWorkbenchUiStateAtomFamily(projectId))
  const requestedSurfacePresentation = uiState.agentPresentation === 'full'
    ? 'linguist-full'
    : 'linguist-rail'
  const agentSurface = extensionRegistry.getAgentSurfaceContext({
    extensionId: 'linguist',
    sessionId: sessionId ?? `project:${projectId}`,
    presentation: requestedSurfacePresentation,
  })
  const hostCapabilities = agentSurface?.hostCapabilities ?? UNAVAILABLE_AGENT_HOST_CAPABILITIES
  const surfaceControls = getAgentSurfaceControls(hostCapabilities)
  const presentation = requestedSurfacePresentation === 'linguist-full' && surfaceControls.canExpandToFull
    ? 'full'
    : 'rail'
  const expandButtonRef = React.useRef<HTMLButtonElement>(null)
  const previousPresentation = React.useRef(presentation)
  const [failure, setFailure] = React.useState<ProjectAgentRailFailure | null>(null)
  const [retryToken, setRetryToken] = React.useState(0)
  const clearSelectedSegments = React.useCallback((): void => {
    setUiState({ selectedSegmentIds: [] })
  }, [setUiState])
  const contextSummary = React.useMemo(
    () => buildProjectComposerContextChips({
      projectId,
      projectName,
      assets,
      uiState,
      onClearSelectedSegments: clearSelectedSegments,
    }),
    [assets, clearSelectedSegments, projectId, projectName, uiState],
  )
  const quickActions = React.useMemo(
    () => buildProjectAgentQuickActions(uiState),
    [uiState],
  )
  const runQuickAction = React.useCallback((actionId: ProjectAgentQuickActionId): void => {
    if (!sessionId) return
    const pending = createProjectAgentQuickActionPendingPrompt(
      store,
      projectId,
      sessionId,
      actionId,
    )
    if (pending) setPendingPrompt(pending)
  }, [projectId, sessionId, setPendingPrompt, store])

  React.useEffect(() => {
    if (sessionId) return
    let cancelled = false
    void loadProjectAgentRailSession(store, projectId).then((state) => {
      if (!cancelled && state.status === 'error') {
        setFailure({ projectId, error: state.error })
      }
    })
    return () => {
      cancelled = true
    }
  }, [projectId, retryToken, sessionId, store])

  React.useEffect(() => {
    if (uiState.agentPresentation !== 'full' || surfaceControls.canExpandToFull) return
    setUiState({ agentPresentation: 'rail' })
  }, [setUiState, surfaceControls.canExpandToFull, uiState.agentPresentation])

  React.useEffect(() => {
    if (sideChatConversationId && presentation === 'rail' && surfaceControls.canExpandToFull) {
      setUiState({ agentPresentation: 'full' })
    }
  }, [presentation, setUiState, sideChatConversationId, surfaceControls.canExpandToFull])

  React.useEffect(() => {
    const wasFull = previousPresentation.current === 'full'
    previousPresentation.current = presentation
    if (presentation === 'full') {
      const handleKeyDown = (event: KeyboardEvent): void => {
        if (event.key !== 'Escape' || event.defaultPrevented) return
        event.preventDefault()
        setUiState({ agentPresentation: 'rail' })
      }
      window.addEventListener('keydown', handleKeyDown)
      return () => window.removeEventListener('keydown', handleKeyDown)
    }
    if (wasFull) requestAnimationFrame(() => expandButtonRef.current?.focus())
  }, [presentation, setUiState])

  if (sessionId) {
    const session = sessions.find((item) => item.id === sessionId)
    const role = session?.linguistSessionRole === 'reviewer'
      ? 'Reviewer'
      : session?.linguistSessionRole === 'auditor'
        ? 'Auditor'
        : 'Assistant'
    const strategy = qualityProfile === 'fast'
      ? 'Fast'
      : qualityProfile === 'best'
        ? 'Best'
        : 'Balanced'
    return (
      <div className="flex h-full min-h-0 flex-col">
        <div className="flex shrink-0 items-center gap-1 bg-content-area/70 px-2 py-1.5 shadow-sm">
          {presentation === 'full' && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              aria-label="返回本地化工作台"
              aria-keyshortcuts="Escape"
              onClick={() => setUiState({ agentPresentation: 'rail' })}
            >
              <ArrowLeft aria-hidden="true" />
              返回工作台
            </Button>
          )}
          {presentation === 'full' && (
            <div
              aria-label={`项目 ${projectName}，角色 ${role}，策略 ${strategy}`}
              className="min-w-0 flex-1 px-2"
            >
              <p className="truncate text-xs font-medium text-foreground">{projectName}</p>
              <p className="truncate text-[11px] text-muted-foreground">
                {[role, strategy, ...contextSummary.slice(1).map((chip) => chip.label)].join(' · ')}
              </p>
            </div>
          )}
          {presentation === 'rail' && (
            <div
              role="group"
              aria-label="项目 Agent 快捷动作"
              className="grid min-w-0 flex-1 grid-cols-3 gap-1"
            >
              {quickActions.map((action) => (
                <Button
                  key={action.id}
                  type="button"
                  variant="secondary"
                  size="sm"
                  disabled={action.disabled}
                  title={action.scope}
                  onClick={() => runQuickAction(action.id)}
                  className="h-7 min-w-0 px-2 text-[11px]"
                >
                  {action.label}
                </Button>
              ))}
            </div>
          )}
          {presentation === 'rail' && (
            <div
              role="group"
              aria-label="项目 Agent rail 控制"
              className="flex shrink-0 gap-0.5"
            >
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label="收起项目 Agent"
                title="收起项目 Agent"
                onClick={() => setUiState({ agentPresentation: 'closed' })}
              >
                <PanelRightClose aria-hidden="true" />
              </Button>
              {surfaceControls.canExpandToFull && (
                <Button
                  ref={expandButtonRef}
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  aria-label="在 Linguist 中展开项目 Agent"
                  title="在 Linguist 中展开项目 Agent"
                  onClick={() => setUiState({ agentPresentation: 'full' })}
                >
                  <Maximize2 aria-hidden="true" />
                </Button>
              )}
            </div>
          )}
        </div>
        <div className="flex min-h-0 flex-1">
          <div className="min-w-0 flex-1">
            <AgentView
              sessionId={sessionId}
              presentation={presentation}
              contextSummary={contextSummary}
              hostCapabilities={hostCapabilities}
            />
          </div>
          {sideChatConversationId && sidePanelOpen && (
            <SidePanel
              sessionId={sessionId}
              sessionPath={null}
              activeTab="chat"
              onTabChange={() => {}}
              chatOnly
              width={320}
            />
          )}
        </div>
      </div>
    )
  }

  const currentFailure = failure?.projectId === projectId ? failure : null
  if (currentFailure) {
    return (
      <div
        role="alert"
        className="flex h-full flex-col items-center justify-center gap-3 p-4 text-center"
      >
        <p className="text-sm font-medium text-foreground">项目 Agent 启动失败</p>
        <p className="text-xs text-muted-foreground">
          {describeLinguistIpcError(currentFailure.error)}
        </p>
        <Button
          type="button"
          size="sm"
          onClick={() => {
            setFailure(null)
            setRetryToken((current) => current + 1)
          }}
        >
          重试
        </Button>
      </div>
    )
  }

  return (
    <div
      role="status"
      aria-live="polite"
      className="flex h-full items-center justify-center p-4 text-xs text-muted-foreground"
    >
      正在准备项目 Agent…
    </div>
  )
}
