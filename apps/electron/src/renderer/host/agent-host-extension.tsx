// LA-HOST-SEAM: renderer-agent-extension
/**
 * AgentView ↔ Linguist 的唯一 renderer 宿主缝。
 *
 * AgentView 只消费本 hook 获得会话级扩展;普通 Agent 会话得到空扩展,
 * Linguist 项目绑定会话得到 CAT 扩展(composer chips、轮次上下文捕获、
 * 项目 mutation 版本、附件闸门)。AgentView 不再直接 import features/linguist。
 *
 * 本文件是唯一允许同时认识 Agent 通用层与 Linguist feature 的 renderer 模块。
 */

import * as React from 'react'
import { atom, useAtom, useAtomValue, useSetAtom } from 'jotai'
import type { createStore } from 'jotai/vanilla'
import { toast } from 'sonner'
import type { LinguistTurnContextV1 } from '@proma/shared'
import {
  agentLinguistTurnContextCaptureAtom,
  agentSessionsAtom,
} from '@/atoms/agent-atoms'
import { projectCurrentAgentSessionIdMapAtom } from '@/atoms/project-agent-session-atoms'
import { activeTabAtom } from '@/atoms/tab-atoms'
import {
  resolveAgentAttachmentSaveGate,
  type AgentAttachmentSaveGate,
} from '@/components/agent/agent-attachment-gate'
import { ComposerContextChips } from '@/features/linguist/composer/ComposerContextChips'
import {
  linguistSegmentAgentReferenceAtomFamily,
  linguistWorkbenchUiStateAtomFamily,
} from '@/features/linguist/projects/cat-workspace-atoms'
import { linguistProjectSummaryAtomFamily } from '@/features/linguist/projects/project-summary-atoms'
import { buildProjectComposerContextChips } from '@/features/linguist/projects/project-composer-context'
import { openLinguistAgentSession } from '@/features/linguist/projects/open-linguist-session'
import { getAgentSessionLinguistProjectId } from '@/lib/agent-session-list'
import {
  DEFAULT_AGENT_HOST_CAPABILITIES,
  UNAVAILABLE_AGENT_HOST_CAPABILITIES,
  type AgentHostCapabilities,
} from './contracts'
import { extensionRegistry } from './extensions'
import { getAgentSurfaceControls } from './extension-registry'

export interface AgentHostAttachmentGate {
  resolve: (workspaceSlug?: string) => AgentAttachmentSaveGate
}

export interface AgentHostExtension {
  /** 渲染在 composer 上方的上下文 chips;普通会话为 null。 */
  composerContextChips: React.ReactNode
  /** 发送前捕获 Linguist 轮次上下文;普通会话返回 undefined。 */
  captureTurnContext: () => LinguistTurnContextV1 | undefined
  /** 按会话绑定与呈现方式解析出的宿主能力。 */
  hostCapabilities: AgentHostCapabilities
  /** 附件落盘闸门(封装 linguistProjectId,AgentView 不直接接触项目身份)。 */
  attachmentGate: AgentHostAttachmentGate
}

/** 无绑定时订阅用占位 projectId;对应 atom 从不被写入,保持惰性。 */
const NO_PROJECT = ''
type JotaiStore = ReturnType<typeof createStore>

/** 通用导航只问宿主是否接管；绑定项目的父/子会话统一返回项目 Tab。 */
export function openHostedAgentSession(
  store: JotaiStore,
  sessionId: string,
): Promise<void> | null {
  const sessions = store.get(agentSessionsAtom)
  const session = sessions.find((candidate) => candidate.id === sessionId)
  if (!session || !getAgentSessionLinguistProjectId(session, sessions)) return null
  return openLinguistAgentSession(store, sessionId).then((result) => {
    if (!result.ok) throw new Error(result.error.message)
  })
}

/** 当前全屏 Linguist Agent 交给 AppShell 原生右栏承载。 */
export const activeHostedAgentSidePanelSessionIdAtom = atom((get) => {
  const activeTab = get(activeTabAtom)
  if (activeTab?.type !== 'linguist-project') return null
  if (get(linguistWorkbenchUiStateAtomFamily(activeTab.projectId)).agentPresentation !== 'full') return null
  return get(projectCurrentAgentSessionIdMapAtom).get(activeTab.projectId) ?? null
})

export function useAgentHostExtension(
  sessionId: string,
  presentation: 'full' | 'rail' = 'full',
): AgentHostExtension {
  const sessionMeta = useAtomValue(agentSessionsAtom).find((item) => item.id === sessionId)
  const linguistProjectId = sessionMeta?.linguistProjectId
  const projectKey = linguistProjectId ?? NO_PROJECT

  const summaryState = useAtomValue(linguistProjectSummaryAtomFamily(projectKey))
  const [uiState, setUiState] = useAtom(linguistWorkbenchUiStateAtomFamily(projectKey))
  const segmentReference = useAtomValue(linguistSegmentAgentReferenceAtomFamily(projectKey))
  const setSegmentReference = useSetAtom(linguistSegmentAgentReferenceAtomFamily(projectKey))
  const captureLinguistTurnContext = useAtomValue(agentLinguistTurnContextCaptureAtom)

  const captureTurnContext = React.useCallback((): LinguistTurnContextV1 | undefined => {
    if (!linguistProjectId || !captureLinguistTurnContext) return undefined
    const snapshot = captureLinguistTurnContext(linguistProjectId)
    if (snapshot.selectionTruncated) {
      toast.info('已选片段超过上下文上限', {
        description: `本轮仅携带前 ${snapshot.context.selectedSegmentIds.length} 个片段。`,
      })
    }
    return snapshot.context
  }, [captureLinguistTurnContext, linguistProjectId])

  const composerContextChips = React.useMemo((): React.ReactNode => {
    if (!linguistProjectId) return null
    const summary = summaryState.status === 'ready' ? summaryState.summary : undefined
    const chips = buildProjectComposerContextChips({
      projectId: linguistProjectId,
      // 摘要未就绪时回退到通用标签;就绪后自动替换为真实项目名。
      projectName: summary?.project.name ?? '当前项目',
      assets: summary?.assets ?? [],
      uiState,
      segmentReference,
      onRemoveSegmentReference: () => setSegmentReference(undefined),
      onClearSelectedSegments: () => setUiState({ selectedSegmentIds: [] }),
    })
    return <ComposerContextChips chips={chips} />
  }, [linguistProjectId, segmentReference, setSegmentReference, setUiState, summaryState, uiState])

  const hostCapabilities = React.useMemo((): AgentHostCapabilities => {
    if (!linguistProjectId) return DEFAULT_AGENT_HOST_CAPABILITIES
    const surface = extensionRegistry.getAgentSurfaceContext({
      extensionId: 'linguist',
      sessionId,
      presentation: presentation === 'rail' ? 'linguist-rail' : 'linguist-full',
    })
    return surface?.hostCapabilities ?? UNAVAILABLE_AGENT_HOST_CAPABILITIES
  }, [linguistProjectId, presentation, sessionId])

  const attachmentGate = React.useMemo((): AgentHostAttachmentGate => ({
    resolve: (workspaceSlug) => resolveAgentAttachmentSaveGate({
      linguistProjectId,
      workspaceSlug,
    }),
  }), [linguistProjectId])

  return {
    composerContextChips,
    captureTurnContext,
    hostCapabilities,
    attachmentGate,
  }
}

export interface AgentSurfaceHostPresentation {
  /** 宿主裁决后的实际呈现(能力不允许 full 时回落 rail)。 */
  presentation: 'rail' | 'full'
  hostCapabilities: AgentHostCapabilities
  canExpandToFull: boolean
}

/**
 * Rail 侧呈现桥接:把工作台 UI 意图(agentPresentation)经 registry 能力声明
 * 裁决为实际呈现。会话未创建时以 `project:<id>` 占位查询能力清单。
 */
export function useAgentSurfaceHostPresentation(
  projectId: string,
  sessionId: string | undefined,
  requestedPresentation: 'closed' | 'rail' | 'full',
): AgentSurfaceHostPresentation {
  return React.useMemo(() => {
    const requestedSurfacePresentation = requestedPresentation === 'full'
      ? 'linguist-full'
      : 'linguist-rail'
    const agentSurface = extensionRegistry.getAgentSurfaceContext({
      extensionId: 'linguist',
      sessionId: sessionId ?? `project:${projectId}`,
      presentation: requestedSurfacePresentation,
    })
    const hostCapabilities = agentSurface?.hostCapabilities ?? UNAVAILABLE_AGENT_HOST_CAPABILITIES
    const surfaceControls = getAgentSurfaceControls(hostCapabilities)
    return {
      presentation: requestedSurfacePresentation === 'linguist-full' && surfaceControls.canExpandToFull
        ? 'full'
        : 'rail',
      hostCapabilities,
      canExpandToFull: surfaceControls.canExpandToFull,
    }
  }, [projectId, requestedPresentation, sessionId])
}
