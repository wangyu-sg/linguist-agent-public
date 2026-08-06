/**
 * Linguist 会话跨项目复制的主进程模块。
 *
 * Renderer 只提供 source sessionId 与 target projectId。项目身份、冻结绑定、
 * fork 截断点和文件复制策略全部在主进程求值，不能由 Renderer 覆盖。
 */

import { existsSync, readFileSync } from 'node:fs'
import type {
  AgentSessionMeta,
  ForkSessionInput,
  LinguistSessionCopyBlockReason,
  SDKMessage,
} from '@proma/shared'
import { resolveExecutionPolicy, sameExecutionPolicy } from '@linguist/cat-core'
import {
  createBlankLinguistSessionCopy,
  deleteAgentSession,
  forkAgentSession,
  getAgentSessionMeta,
  hasAgentSessionNativeForkArtifact,
  type AgentSessionForkOptions,
  type AgentSessionLinguistBinding,
} from '../agent-session-manager'
import { getAgentSessionMessagesPath } from '../config-paths'
import type { LinguistProjectService } from './project-service'

export type LinguistSessionCopyEligibility =
  | { eligible: true; mode: 'blank' }
  | { eligible: true; mode: 'fork'; upToMessageUuid: string }
  | {
      eligible: false
      reason: LinguistSessionCopyBlockReason
      message: string
    }

export class LinguistSessionCopyBlockedError extends Error {
  readonly code = 'SESSION_COPY_BLOCKED'

  constructor(readonly reason: LinguistSessionCopyBlockReason, message: string) {
    super(message)
    this.name = 'LinguistSessionCopyBlockedError'
  }
}

export class LinguistSessionCopyTargetError extends Error {
  readonly code = 'SESSION_COPY_BLOCKED'

  constructor(message: string) {
    super(message)
    this.name = 'LinguistSessionCopyTargetError'
  }
}

type ForkSession = (
  input: ForkSessionInput,
  options: AgentSessionForkOptions,
) => Promise<AgentSessionMeta>

type CreateBlankSession = (
  source: AgentSessionMeta,
  title: string,
  linguistBinding: AgentSessionLinguistBinding,
) => AgentSessionMeta

export interface LinguistSessionCopyDependencies {
  getService: () => LinguistProjectService
  isSessionActive: (sessionId: string) => boolean
  forkSession?: ForkSession
  createBlankSession?: CreateBlankSession
}

function blocked(
  reason: LinguistSessionCopyBlockReason,
  message: string,
): LinguistSessionCopyEligibility {
  return { eligible: false, reason, message }
}

function parseStoredMessages(sessionId: string): SDKMessage[] | null {
  const path = getAgentSessionMessagesPath(sessionId)
  if (!existsSync(path)) return []
  try {
    const raw = readFileSync(path, 'utf-8')
    if (!raw.trim()) return []
    return raw
      .split('\n')
      .filter((line) => line.trim())
      .map((line) => JSON.parse(line) as SDKMessage)
  } catch {
    return null
  }
}

function latestCompletedAssistant(messages: readonly SDKMessage[]): string | undefined {
  let pendingAssistant: string | undefined
  let latestCompleted: string | undefined
  let turnOpen = false

  for (const message of messages) {
    const parentToolUseId = (
      message as { parent_tool_use_id?: string | null }
    ).parent_tool_use_id
    if (message.type === 'user' && !parentToolUseId) {
      turnOpen = true
      pendingAssistant = undefined
      continue
    }
    if (message.type === 'assistant' && !parentToolUseId) {
      turnOpen = true
      const assistant = message as {
        uuid?: string
        error?: unknown
      }
      pendingAssistant = assistant.uuid && !assistant.error ? assistant.uuid : undefined
      continue
    }
    if (
      message.type === 'result'
      && (message as { subtype?: string }).subtype === 'success'
      && pendingAssistant
    ) {
      latestCompleted = pendingAssistant
      turnOpen = false
    }
  }

  return turnOpen ? undefined : latestCompleted
}

export function getLinguistSessionCopyEligibility(
  deps: LinguistSessionCopyDependencies,
  sessionId: string,
): LinguistSessionCopyEligibility {
  const source = getAgentSessionMeta(sessionId)
  if (!source) {
    return blocked('SESSION_NOT_FOUND', '源会话不存在')
  }
  if (!source.linguistProjectId) {
    return blocked('NOT_LINGUIST_SESSION', '只有 Linguist 项目会话可以复制到其他项目')
  }
  if (deps.isSessionActive(sessionId)) {
    return blocked('RUNNING', '会话正在运行，请等待本轮完成后再复制')
  }

  const messages = parseStoredMessages(sessionId)
  if (messages === null) {
    return blocked('HISTORY_UNREADABLE', '会话历史损坏或不可读')
  }
  if (messages.length === 0) {
    if (source.sdkSessionId || source.piSessionFile) {
      return blocked('HISTORY_UNREADABLE', '会话历史缺失，无法验证原生 session artifact')
    }
    return { eligible: true, mode: 'blank' }
  }

  const upToMessageUuid = latestCompletedAssistant(messages)
  if (!upToMessageUuid) {
    return blocked('NO_COMPLETED_ASSISTANT', '会话没有可安全复制的已完成 assistant 消息')
  }
  if (
    !hasAgentSessionNativeForkArtifact(source)
    || (source.agentRuntime === 'pi' && !source.piEntryBindings?.[upToMessageUuid])
  ) {
    return blocked('HISTORY_UNREADABLE', '原生 session artifact 缺失或不可读')
  }
  return { eligible: true, mode: 'fork', upToMessageUuid }
}

function requireEligible(
  deps: LinguistSessionCopyDependencies,
  sessionId: string,
): Extract<LinguistSessionCopyEligibility, { eligible: true }> {
  const result = getLinguistSessionCopyEligibility(deps, sessionId)
  if (!result.eligible) {
    throw new LinguistSessionCopyBlockedError(result.reason, result.message)
  }
  return result
}

function requireHealthyTarget(
  service: LinguistProjectService,
  projectId: string,
): ReturnType<LinguistProjectService['getProject']> {
  let target: ReturnType<LinguistProjectService['getProject']>
  try {
    target = service.getProject(projectId)
  } catch {
    throw new LinguistSessionCopyTargetError('目标项目不存在')
  }
  if (target.archivedAt !== undefined) {
    throw new LinguistSessionCopyTargetError('目标项目已归档，不能接收会话副本')
  }
  try {
    if (!service.checkProjectHealth(target.id).healthy) {
      throw new LinguistSessionCopyTargetError('目标项目健康检查未通过')
    }
  } catch (error) {
    if (error instanceof LinguistSessionCopyTargetError) throw error
    throw new LinguistSessionCopyTargetError('目标项目健康检查未通过')
  }
  return target
}

export async function copyLinguistSessionToProject(
  deps: LinguistSessionCopyDependencies,
  input: { sessionId: string; targetProjectId: string },
): Promise<AgentSessionMeta> {
  const eligibility = requireEligible(deps, input.sessionId)
  const source = getAgentSessionMeta(input.sessionId)
  if (!source?.linguistProjectId) {
    throw new LinguistSessionCopyBlockedError('SESSION_NOT_FOUND', '源会话在复制前已不存在')
  }
  if (source.linguistProjectId === input.targetProjectId) {
    throw new LinguistSessionCopyTargetError('目标项目必须与源项目不同')
  }

  const service = deps.getService()
  const target = requireHealthyTarget(service, input.targetProjectId)

  const title = `${source.title}（副本）`
  const linguistBinding: AgentSessionLinguistBinding = {
    linguistProjectId: target.id,
    linguistProjectName: target.name,
    // LA-QUALITY-001：副本冻结目标项目当前 Execution Policy（legacy 项目经映射）。
    linguistExecutionPolicy: resolveExecutionPolicy(target),
    ...(source.linguistSessionRole
      ? { linguistSessionRole: source.linguistSessionRole }
      : {}),
  }

  let copied: AgentSessionMeta | undefined
  try {
    if (eligibility.mode === 'blank') {
      copied = (deps.createBlankSession ?? createBlankLinguistSessionCopy)(
        source,
        title,
        linguistBinding,
      )
    } else {
      try {
        copied = await (deps.forkSession ?? forkAgentSession)(
          {
            sessionId: source.id,
            upToMessageUuid: eligibility.upToMessageUuid,
          },
          {
            title,
            linguistBinding,
            copyWorkspaceFiles: false,
            inheritSessionConfig: true,
            requirePortableArtifacts: true,
          },
        )
      } catch {
        throw new LinguistSessionCopyBlockedError(
          'HISTORY_UNREADABLE',
          '原生 session artifact 无法完成安全复制',
        )
      }
    }

    const latestSource = getAgentSessionMeta(source.id)
    const latestEligibility = requireEligible(deps, source.id)
    if (
      latestSource?.linguistProjectId !== source.linguistProjectId
      || latestEligibility.mode !== eligibility.mode
      || (
        latestEligibility.mode === 'fork'
        && eligibility.mode === 'fork'
        && latestEligibility.upToMessageUuid !== eligibility.upToMessageUuid
      )
    ) {
      throw new LinguistSessionCopyBlockedError(
        'HISTORY_UNREADABLE',
        '源会话在复制期间发生变化，请重试',
      )
    }

    const latestTarget = requireHealthyTarget(service, input.targetProjectId)
    if (
      copied.id === source.id
      || copied.linguistProjectId !== latestTarget.id
      || copied.linguistProjectName !== latestTarget.name
      || copied.linguistExecutionPolicy === undefined
      || !sameExecutionPolicy(copied.linguistExecutionPolicy, resolveExecutionPolicy(latestTarget))
      || copied.workspaceId !== undefined
    ) {
      throw new LinguistSessionCopyTargetError('副本绑定校验失败')
    }
    return copied
  } catch (error) {
    if (copied?.id && copied.id !== source.id) {
      try {
        deleteAgentSession(copied.id, { discardLinguistWorkspace: true })
      } catch { /* 保留原始错误 */ }
    }
    throw error
  }
}
