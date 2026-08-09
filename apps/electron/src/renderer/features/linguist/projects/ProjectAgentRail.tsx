import * as React from 'react'
import { useAtom, useAtomValue, useSetAtom, useStore } from 'jotai'
import type { createStore } from 'jotai/vanilla'
import { ArrowLeft, Maximize2, MoreHorizontal, PanelRightClose } from 'lucide-react'
import { toast } from 'sonner'
import { createLinguistTurnContextV1 } from '@proma/shared'
import type {
  AgentSessionMeta,
  LinguistAssetInfo,
  LinguistIpcError,
  LinguistIpcResult,
  LinguistRole,
  LinguistSessionCreateForProjectRequest,
} from '@proma/shared'
import {
  agentPendingPromptAtom,
  agentSidePanelOpenAtom,
  agentSidePanelWidthAtom,
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
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { replaceAgentSessionInFreshnessOrder } from '@/lib/agent-session-list'
import { getLinguistRoleOption } from '../session-binding/LinguistRoleMenu'
import {
  captureLinguistTurnContextSnapshot,
  createSegmentAgentReference,
  linguistSegmentAgentReferenceAtomFamily,
  linguistWorkbenchUiStateAtomFamily,
  resolveVisibleSegmentAgentReference,
  type LinguistSegmentAgentReference,
  type LinguistWorkbenchUiState,
} from './cat-workspace-atoms'
import { describeLinguistIpcError } from './project-utils'
import { ensureProjectAgentSession } from './project-agent-session'

// ===== 显式「为 Agent 引用」片段（问题 12）=====
// atom、类型与 helper 统一住在 cat-workspace-atoms.ts（snapshot seam 共用），
// 此处仅消费，不另存第二份实现。

/**
 * Companion Chat 自动展开的共享判定（纯函数，问题 11）。
 * 仅在侧问答会话「新打开或切换」时允许自动展开为 full；
 * 用户点「返回工作台」回到 rail 时 conversationId 不变，不得再次被推回 full。
 */
export function shouldAutoExpandAgentForSideChat(
  previousConversationId: string | null,
  nextConversationId: string | null,
  presentation: 'rail' | 'full',
  canExpandToFull: boolean,
): boolean {
  return Boolean(
    nextConversationId
    && nextConversationId !== previousConversationId
    && presentation === 'rail'
    && canExpandToFull,
  )
}

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
  /** 显式「为 Agent 引用」的片段（内部经 resolveVisibleSegmentAgentReference 按项目资产校验） */
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
  // 片段 chip 只由显式「为 Agent 引用」驱动；键盘/编辑焦点不再隐式产生 Agent scope。
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

export type ProjectAgentQuickActionId =
  | 'translate'
  | 'review'
  | 'proofread'
  | 'translate-suggest'
  | 'review-suggest'
  | 'proofread-suggest'
  | 'qa'
  | 'terms'
  | 'import'
  | 'export'

export interface ProjectAgentQuickAction {
  id: ProjectAgentQuickActionId
  /** 岗位即任务入口：点击后先把会话岗位切到对应岗位，再发送任务。 */
  role: LinguistRole
  /** primary = rail 主按钮；overflow = 「更多项目任务」菜单。 */
  placement: 'primary' | 'overflow'
  label: string
  prompt: string
  scope: string
  disabled: boolean
}

const QUICK_ACTION_SEGMENT_LIMIT = 50

/** 片段级动作：冻结点击时的选择快照；项目级动作：只带项目/批次，不带选择。 */
const BATCH_SCOPED_ACTIONS: ReadonlySet<ProjectAgentQuickActionId> = new Set(['terms', 'export'])
const PROJECT_SCOPED_ACTIONS: ReadonlySet<ProjectAgentQuickActionId> = new Set(['qa', 'import'])

export function buildProjectAgentQuickActions(
  uiState: LinguistWorkbenchUiState,
): readonly ProjectAgentQuickAction[] {
  const selectedCount = uiState.selectedSegmentIds.length
  const hasTarget = selectedCount > 0 || uiState.activeSegmentId !== undefined
  const overLimit = selectedCount > QUICK_ACTION_SEGMENT_LIMIT
  const segmentDisabled = !hasTarget || overLimit
  const segmentScope = overLimit
    ? `已选 ${selectedCount} 段，请缩小到 50 段以内。`
    : selectedCount > 0
      ? `将处理已选 ${selectedCount} 个片段。`
      : uiState.activeSegmentId
        ? '将处理当前片段。'
        : '请先选择片段或激活当前片段。'
  const target = selectedCount > 0
    ? `当前已选 ${selectedCount} 个片段`
    : '当前片段'
  const selectedSuffix = selectedCount > 0 ? '已选' : '当前'

  return [
    {
      id: 'translate',
      role: 'translator',
      placement: 'primary',
      label: `翻译${selectedSuffix}`,
      prompt: `请翻译${target}，完成正式译文与自检，直接写回项目，不要只保留为待查看建议。`,
      scope: segmentScope,
      disabled: segmentDisabled,
    },
    {
      id: 'review',
      role: 'reviewer',
      placement: 'primary',
      label: `审校${selectedSuffix}`,
      prompt: `请完整审校${target}的 Source 与当前 Target，保留正确译文，修正所有实质问题，直接写回项目，不要只保留为待查看建议。`,
      scope: segmentScope,
      disabled: segmentDisabled,
    },
    {
      id: 'proofread',
      role: 'proofreader',
      placement: 'primary',
      label: `校对${selectedSuffix}`,
      prompt: `请以目标语成品为中心校对${target}，润色表达并统一风格，直接写回项目，不要只保留为待查看建议。`,
      scope: segmentScope,
      disabled: segmentDisabled,
    },
    {
      id: 'translate-suggest',
      role: 'translator',
      placement: 'overflow',
      label: '翻译（先看建议）',
      prompt: `请翻译${target}，完成正式译文与自检；先把结果保留为待查看建议，等我查看后再决定写回。`,
      scope: segmentScope,
      disabled: segmentDisabled,
    },
    {
      id: 'review-suggest',
      role: 'reviewer',
      placement: 'overflow',
      label: '审校（先看建议）',
      prompt: `请完整审校${target}的 Source 与当前 Target，保留正确译文，修正所有实质问题；先把结果保留为待查看建议，等我查看后再决定写回。`,
      scope: segmentScope,
      disabled: segmentDisabled,
    },
    {
      id: 'proofread-suggest',
      role: 'proofreader',
      placement: 'overflow',
      label: '校对（先看建议）',
      prompt: `请以目标语成品为中心校对${target}，润色表达并统一风格；先把结果保留为待查看建议，等我查看后再决定写回。`,
      scope: segmentScope,
      disabled: segmentDisabled,
    },
    {
      id: 'qa',
      role: 'general',
      placement: 'overflow',
      label: '项目 QA',
      prompt: '请运行整个项目的确定性 QA。检查范围必须是整个项目，当前选择不限制检查范围；请使用现有 CAT Tools 报告发现的问题。',
      scope: 'QA 始终检查整个项目，当前选择不限制范围。',
      disabled: false,
    },
    {
      id: 'terms',
      role: 'general',
      placement: 'overflow',
      label: '整理术语',
      prompt: '请整理当前批次的术语：提取应统一的源文术语，对照项目术语库，列出缺失或不一致的条目；新增或修改术语前先给我确认。',
      scope: '整理当前批次的术语，与片段选择无关。',
      disabled: false,
    },
    {
      id: 'import',
      role: 'general',
      placement: 'overflow',
      label: '导入资源',
      prompt: '我想导入语言资产（翻译记忆、术语库、Style Guide 或 Context）。请说明可以接受哪些类型与格式的文件；等我提供文件路径后，帮我登记进项目。',
      scope: '导入项目级语言资产，与片段选择无关。',
      disabled: false,
    },
    {
      id: 'export',
      role: 'general',
      placement: 'overflow',
      label: '验证并导出',
      prompt: '请验证并导出当前批次的交付文件：先运行交付预检，如有阻断项请如实告诉我；预检通过后保存交付副本，并报告验证与保存结果。',
      scope: '导出当前批次，先预检再保存，与片段选择无关。',
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

  const snapshot = PROJECT_SCOPED_ACTIONS.has(actionId)
    ? createLinguistTurnContextV1({
      projectId,
      selectedSegmentIds: [],
      capturedAt,
      uiRevision: uiState.uiRevision,
    })
    : BATCH_SCOPED_ACTIONS.has(actionId)
      ? createLinguistTurnContextV1({
        projectId,
        ...(uiState.activeAssetId !== undefined ? { assetId: uiState.activeAssetId } : {}),
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
  assets?: readonly LinguistAssetInfo[]
}

export function ProjectAgentRail({
  projectId,
  projectName,
  assets = [],
}: ProjectAgentRailProps): React.ReactElement {
  const store = useStore()
  const sessionId = useAtomValue(projectCurrentAgentSessionIdMapAtom).get(projectId)
  const sessions = useAtomValue(agentSessionsAtom)
  const setSessions = useSetAtom(agentSessionsAtom)
  const currentSession = sessionId === undefined
    ? undefined
    : sessions.find((item) => item.id === sessionId)
  const currentRole: LinguistRole = currentSession?.linguistRole ?? 'general'
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
  const segmentReference = useAtomValue(linguistSegmentAgentReferenceAtomFamily(projectId))
  const setSegmentReference = useSetAtom(linguistSegmentAgentReferenceAtomFamily(projectId))
  const removeSegmentReference = React.useCallback((): void => {
    setSegmentReference(undefined)
  }, [setSegmentReference])
  const contextSummary = React.useMemo(
    () => buildProjectComposerContextChips({
      projectId,
      projectName,
      assets,
      uiState,
      segmentReference,
      onRemoveSegmentReference: removeSegmentReference,
      onClearSelectedSegments: clearSelectedSegments,
    }),
    [
      assets,
      clearSelectedSegments,
      projectId,
      projectName,
      removeSegmentReference,
      segmentReference,
      uiState,
    ],
  )
  const quickActions = React.useMemo(
    () => buildProjectAgentQuickActions(uiState),
    [uiState],
  )
  const primaryQuickActions = React.useMemo(
    () => quickActions.filter((action) => action.placement === 'primary'),
    [quickActions],
  )
  const overflowQuickActions = React.useMemo(
    () => quickActions.filter((action) => action.placement === 'overflow'),
    [quickActions],
  )
  const runQuickAction = React.useCallback((actionId: ProjectAgentQuickActionId): void => {
    if (!sessionId) return
    const action = quickActions.find(({ id }) => id === actionId)
    if (!action || action.disabled) return
    // 点击时先冻结范围快照，再切换岗位；等待期间的选择变化不影响本次任务。
    const pending = createProjectAgentQuickActionPendingPrompt(
      store,
      projectId,
      sessionId,
      actionId,
    )
    if (!pending) return
    // 岗位即任务入口：切换失败时不发送，避免岗位提示词与任务错配。
    if (action.role !== currentRole) {
      void (async () => {
        try {
          const result = await window.electronAPI.linguistSessionsUpdateRole({
            sessionId,
            role: action.role,
          })
          if (!result.ok) {
            toast.error('切换岗位失败', { description: describeLinguistIpcError(result.error) })
            return
          }
          setSessions((previous) => replaceAgentSessionInFreshnessOrder(previous, result.data))
          setPendingPrompt(pending)
        } catch {
          toast.error('切换岗位失败', { description: '与主进程通信异常（INTERNAL）' })
        }
      })()
      return
    }
    setPendingPrompt(pending)
  }, [currentRole, projectId, quickActions, sessionId, setPendingPrompt, setSessions, store])

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

  // 问题 10：只消费 Proma 已有的统一侧面板宽度；不再为 Companion 新增存储或拖拽系统。
  const sharedSidePanelWidth = useAtomValue(agentSidePanelWidthAtom)

  // 问题 11：仅在 Companion Chat 新打开/切换会话时自动展开 full；
  // 「返回工作台」把 presentation 切回 rail 时 conversationId 不变，共享判定不再推回。
  const previousSideChatIdRef = React.useRef(sideChatConversationId)
  React.useEffect(() => {
    const previousSideChatId = previousSideChatIdRef.current
    previousSideChatIdRef.current = sideChatConversationId
    if (shouldAutoExpandAgentForSideChat(
      previousSideChatId,
      sideChatConversationId,
      presentation,
      surfaceControls.canExpandToFull,
    )) {
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
    const roleOption = getLinguistRoleOption(currentRole)
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
              aria-label={`项目 ${projectName}，岗位 ${roleOption.label}`}
              className="min-w-0 flex-1 px-2"
            >
              <p className="truncate text-xs font-medium text-foreground">{projectName}</p>
              <p className="truncate text-[11px] text-muted-foreground">
                {[roleOption.shortLabel, ...contextSummary.slice(1).map((chip) => chip.label)].join(' · ')}
              </p>
            </div>
          )}
          {presentation === 'rail' && (
            <div
              role="group"
              aria-label="项目 Agent 快捷动作"
              className="grid min-w-0 flex-1 grid-cols-[1fr_1fr_1fr_auto] gap-1"
            >
              {primaryQuickActions.map((action) => (
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
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    aria-label="更多项目任务"
                    title="更多项目任务"
                    className="h-7 px-1.5"
                  >
                    <MoreHorizontal aria-hidden="true" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="z-[9999] w-72">
                  <DropdownMenuLabel className="text-[11px] text-muted-foreground">
                    先看建议（写回前等你查看）
                  </DropdownMenuLabel>
                  {overflowQuickActions
                    .filter((action) => action.id.endsWith('-suggest'))
                    .map((action) => (
                      <DropdownMenuItem
                        key={action.id}
                        disabled={action.disabled}
                        onSelect={() => runQuickAction(action.id)}
                      >
                        <span className="min-w-0 flex-1">
                          <span className="block text-xs">{action.label}</span>
                          <span className="block text-[11px] leading-4 text-muted-foreground">{action.scope}</span>
                        </span>
                      </DropdownMenuItem>
                    ))}
                  <DropdownMenuSeparator />
                  <DropdownMenuLabel className="text-[11px] text-muted-foreground">
                    项目任务
                  </DropdownMenuLabel>
                  {overflowQuickActions
                    .filter((action) => !action.id.endsWith('-suggest'))
                    .map((action) => (
                      <DropdownMenuItem
                        key={action.id}
                        disabled={action.disabled}
                        onSelect={() => runQuickAction(action.id)}
                      >
                        <span className="min-w-0 flex-1">
                          <span className="block text-xs">{action.label}</span>
                          <span className="block text-[11px] leading-4 text-muted-foreground">{action.scope}</span>
                        </span>
                      </DropdownMenuItem>
                    ))}
                </DropdownMenuContent>
              </DropdownMenu>
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
          {presentation === 'full' && sideChatConversationId && sidePanelOpen && (
            <aside
              data-testid="linguist-companion-chat"
              aria-label="项目 Agent 问答"
              className="min-h-0 shrink-0 overflow-hidden"
              style={{ width: `min(${sharedSidePanelWidth}px, calc(100% - 20rem))` }}
            >
              <SidePanel
                sessionId={sessionId}
                sessionPath={null}
                activeTab="chat"
                onTabChange={() => {}}
                chatOnly
                width={sharedSidePanelWidth}
              />
            </aside>
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
