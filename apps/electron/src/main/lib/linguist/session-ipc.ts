/**
 * Linguist 会话绑定 typed IPC 处理器（PB-034；计划 §7.2）。
 *
 * 四个通道（契约见 packages/shared/src/types/linguist.ts 的
 * LINGUIST_SESSION_IPC_CHANNELS）：
 * - createForProject：项目内创建对话（Pi Agent 会话，写入冻结绑定）；
 *   项目不存在 → PROJECT_NOT_FOUND；已归档 → PROJECT_ARCHIVED（只读，
 *   fail closed）。
 * - listForProject：列出绑定会话（轻量元数据，updatedAt 降序）；项目
 *   缺失/归档均可列出（绑定存在会话侧，历史可读）。
 * - getBinding：会话 → 绑定 + 实时状态（active/archived/missing/unavailable）；
 *   普通会话 → { binding: null }（正常分支，非错误）。
 * - detachBinding：用户显式永久解绑；之后会话作为普通 Agent 使用。
 *
 * 与 project-ipc.ts 同一约定：绝不抛出（LinguistIpcResult 信封）、主进程
 * 自行校验入参、未知错误收敛 INTERNAL、不 import electron（node --test
 * 直接驱动）。无新增错误码——复用既有 24 码目录。
 */

import {
  LINGUIST_PROJECT_NAME_MAX_LENGTH,
  type AgentSessionMeta,
  type LinguistIpcResult,
  type LinguistProjectChatSessionInfo,
  type LinguistSessionCopyEligibilityResult,
  type LinguistSessionCopyToProjectResult,
  type LinguistSessionCreateForProjectResult,
  type LinguistSessionDetachBindingResult,
  type LinguistSessionGetBindingResult,
  type LinguistSessionListForProjectResult,
} from '@proma/shared'
import { assertRecord, invalid, readProjectId, wrap } from './ipc-envelope'
import type { LinguistProjectService } from './project-service'
import {
  createLinguistProjectChatSession,
  getLinguistSessionBinding,
  listLinguistProjectChatSessions,
} from './session-binding'
import {
  detachAgentSessionLinguistBinding,
  getAgentSessionMeta,
} from '../agent-session-manager'
import {
  copyLinguistSessionToProject,
  getLinguistSessionCopyEligibility,
} from './session-copy'

/** 惰性解析服务单例：注册 IPC 时服务可能尚未 init（index.ts bootstrap 顺序）。 */
export interface LinguistSessionIpcDeps {
  getService: () => LinguistProjectService
  isSessionActive: (sessionId: string) => boolean
}

/** Agent 会话 id 校验：非空字符串（uuid 形状由创建方保证，此处不过度约束）。 */
function readSessionId(record: Record<string, unknown>): string {
  const value = record.sessionId
  if (typeof value !== 'string' || value.length === 0 || value.length > 128) {
    invalid('sessionId must be a non-empty string of at most 128 characters')
  }
  return value
}

/** 可选会话标题：字符串、trim 后非空、≤120（与项目名上限同常量）。 */
function readOptionalTitle(record: Record<string, unknown>): string | undefined {
  const value = record.title
  if (value === undefined) return undefined
  if (
    typeof value !== 'string' ||
    value.trim().length === 0 ||
    value.length > LINGUIST_PROJECT_NAME_MAX_LENGTH
  ) {
    invalid(`title must be a non-blank string of at most ${LINGUIST_PROJECT_NAME_MAX_LENGTH} characters`)
  }
  return value
}

/** 项目会话角色由主进程白名单解析；缺省 = 普通助理会话。 */
function readOptionalRole(record: Record<string, unknown>): 'reviewer' | 'auditor' | undefined {
  const value = record.role
  if (value === undefined) return undefined
  if (value !== 'reviewer' && value !== 'auditor') {
    invalid(`role must be 'reviewer' or 'auditor' when provided`)
  }
  return value
}

export function toRendererCopyResult(
  session: AgentSessionMeta,
): LinguistSessionCopyToProjectResult {
  return {
    id: session.id,
    title: session.title,
    ...(session.channelId !== undefined ? { channelId: session.channelId } : {}),
    ...(session.modelId !== undefined ? { modelId: session.modelId } : {}),
    ...(session.agentRuntime !== undefined ? { agentRuntime: session.agentRuntime } : {}),
    ...(session.codexFastMode !== undefined ? { codexFastMode: session.codexFastMode } : {}),
    ...(session.openAIThinkingLevel !== undefined
      ? { openAIThinkingLevel: session.openAIThinkingLevel }
      : {}),
    ...(session.permissionMode !== undefined ? { permissionMode: session.permissionMode } : {}),
    ...(session.linguistProjectId !== undefined
      ? { linguistProjectId: session.linguistProjectId }
      : {}),
    ...(session.linguistProjectName !== undefined
      ? { linguistProjectName: session.linguistProjectName }
      : {}),
    ...(session.linguistSessionRole !== undefined
      ? { linguistSessionRole: session.linguistSessionRole }
      : {}),
    ...(session.linguistStrategy !== undefined
      ? { linguistStrategy: session.linguistStrategy }
      : {}),
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
  }
}

export function createLinguistSessionIpc(deps: LinguistSessionIpcDeps) {
  const { getService } = deps

  return {
    /**
     * linguist.sessions.createForProject — 项目内创建对话。
     * 绑定（linguistProjectId + 项目名快照）在创建时写入并冻结；
     * 产物为 Pi runtime 的 Agent 会话（PB-011）。
     * PB-082：可选 role='reviewer' 创建独立评审会话（冻结 linguistSessionRole 标记）。
     */
    createForProject(input: unknown): Promise<LinguistIpcResult<LinguistSessionCreateForProjectResult>> {
      return wrap(() => {
        const record = assertRecord(input)
        const projectId = readProjectId(record)
        const title = readOptionalTitle(record)
        const role = readOptionalRole(record)
        return createLinguistProjectChatSession(getService(), {
          projectId,
          ...(title !== undefined ? { title } : {}),
          ...(role !== undefined ? { role } : {}),
        })
      })
    },

    /**
     * linguist.sessions.listForProject — 项目对话列表（标题 + 更新时间 + 角色）。
     * 不触项目库：项目被删/归档后历史会话仍可列出（只读语义的一部分）。
     */
    listForProject(input: unknown): Promise<LinguistIpcResult<LinguistSessionListForProjectResult>> {
      return wrap(() => {
        const projectId = readProjectId(assertRecord(input))
        const sessions: LinguistProjectChatSessionInfo[] = listLinguistProjectChatSessions(projectId)
          .map((s) => ({
            id: s.id,
            title: s.title,
            createdAt: s.createdAt,
            updatedAt: s.updatedAt,
            role: s.linguistSessionRole ?? 'assistant',
          }))
        return sessions
      })
    },

    /**
     * linguist.sessions.getBinding — 绑定 + 实时状态解析。
     * renderer 徽章/通告与主进程 Batch 4 装配共用同一解析。
     */
    getBinding(input: unknown): Promise<LinguistIpcResult<LinguistSessionGetBindingResult>> {
      return wrap(() => {
        const sessionId = readSessionId(assertRecord(input))
        const session = getAgentSessionMeta(sessionId)
        if (!session?.linguistProjectId) return { binding: null }
        try {
          return { binding: getLinguistSessionBinding(session, getService()) }
        } catch {
          return {
            binding: {
              projectId: session.linguistProjectId,
              projectName: session.linguistProjectName ?? session.linguistProjectId,
              status: 'unavailable',
            },
          }
        }
      })
    },

    /** linguist.sessions.detachBinding — 显式、永久、幂等地解除项目绑定。 */
    detachBinding(input: unknown): Promise<LinguistIpcResult<LinguistSessionDetachBindingResult>> {
      return wrap(() => {
        const sessionId = readSessionId(assertRecord(input))
        const before = getAgentSessionMeta(sessionId)
        const session = detachAgentSessionLinguistBinding(sessionId)
        return {
          detached: before?.linguistProjectId !== undefined && session !== null,
          session,
        }
      })
    },

    /** 只返回稳定模式/阻断原因，不暴露主进程原生分叉节点 ID。 */
    getCopyEligibility(input: unknown): Promise<LinguistIpcResult<LinguistSessionCopyEligibilityResult>> {
      return wrap(() => {
        const sessionId = readSessionId(assertRecord(input))
        const result = getLinguistSessionCopyEligibility(deps, sessionId)
        return result.eligible
          ? { eligible: true, mode: result.mode }
          : result
      })
    },

    /** 主进程重新验证源 binding、运行状态、目标项目与历史 artifact。 */
    copyToProject(input: unknown): Promise<LinguistIpcResult<LinguistSessionCopyToProjectResult>> {
      return wrap(async () => {
        const record = assertRecord(input)
        const session = await copyLinguistSessionToProject(deps, {
          sessionId: readSessionId(record),
          targetProjectId: readProjectId({ projectId: record.targetProjectId }),
        })
        return toRendererCopyResult(session)
      })
    },
  }
}

/** 便于类型推导的处理器集合类型（ipc.ts / 测试共用）。 */
export type LinguistSessionIpcHandlers = ReturnType<typeof createLinguistSessionIpc>
