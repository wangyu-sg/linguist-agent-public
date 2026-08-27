/**
 * 「向项目 Agent 发送自然语言任务」的共享入口（K1/K6/K7/K10）。
 *
 * 用途：Task Recipes、「让 Agent 识别 Tag」、「让 Agent 整理术语」等按钮
 * 统一走这里——确保会话存在（懒创建）、冻结当前 Workbench scope 快照、
 * 写入 agentPendingPromptAtom（AgentView 自动发送），并打开对应的原生 Agent Tab。
 *
 * 这里不创建任何新 workflow：只是「填一条任务 + 附加当前 scope + 发送」。
 */

import type { createStore } from 'jotai/vanilla'
import type {
  AgentSessionMeta,
  LinguistIpcError,
  LinguistIpcResult,
  LinguistSessionCreateForProjectRequest,
} from '@proma/shared'
import { agentPendingPromptAtom } from '@/atoms/agent-atoms'
import {
  captureLinguistTurnContextSnapshot,
} from './cat-workspace-atoms'
import { openLinguistAgentSession } from './open-linguist-session'
import { ensureProjectAgentSession } from './project-agent-session'

type JotaiStore = ReturnType<typeof createStore>
type CreateProjectSession = (
  input: LinguistSessionCreateForProjectRequest,
) => Promise<LinguistIpcResult<AgentSessionMeta>>

export type ProjectAgentTaskSendResult =
  | { status: 'sent'; sessionId: string }
  | { status: 'selection-truncated' }
  | { status: 'error'; error: LinguistIpcError }

export async function sendProjectAgentTask(
  store: JotaiStore,
  projectId: string,
  message: string,
  createSession?: CreateProjectSession,
): Promise<ProjectAgentTaskSendResult> {
  const ensured = await ensureProjectAgentSession(store, projectId, createSession)
  if (!ensured.ok) return { status: 'error', error: ensured.error }

  const snapshot = captureLinguistTurnContextSnapshot(store, projectId)
  if (snapshot.selectionTruncated) return { status: 'selection-truncated' }

  const opened = await openLinguistAgentSession(store, ensured.data.id)
  if (!opened.ok) return { status: 'error', error: opened.error }

  store.set(agentPendingPromptAtom, {
    sessionId: ensured.data.id,
    message,
    linguistContext: snapshot.context,
  })
  return { status: 'sent', sessionId: ensured.data.id }
}
