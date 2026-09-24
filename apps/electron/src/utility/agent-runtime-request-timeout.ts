import { AGENT_RUNTIME_METHODS } from '@proma/shared'
import { normalizeDelegationWaitSeconds } from '../main/lib/agent-collaboration-utils'

const DEFAULT_PARENT_REQUEST_TIMEOUT_MS = 120_000
const DELEGATION_WAIT_IPC_MARGIN_MS = 5_000
// AskUserQuestion 属于用户主导的自由文本交互；两分钟不足以完成输入。
export const ASK_USER_QUESTION_TIMEOUT_MS = 15 * 60_000

/**
 * Utility Process 请求主进程的等待时间。
 * 仅用户输入与协作等待按业务期限延长，其他能力仍按两分钟检测故障。
 */
export function getParentRequestTimeoutMs(method: string, payload: unknown): number {
  if (
    method === AGENT_RUNTIME_METHODS.CAPABILITY_CAN_USE_TOOL
    && (payload as { toolName?: unknown } | null)?.toolName === 'AskUserQuestion'
  ) {
    return ASK_USER_QUESTION_TIMEOUT_MS
  }
  if (method === AGENT_RUNTIME_METHODS.CAPABILITY_CUSTOM_TOOL) {
    const request = payload as { toolName?: unknown; input?: { timeoutSeconds?: unknown } } | null
    if (request?.toolName === 'mcp__collaboration__wait_for_delegations') {
      return Math.ceil(normalizeDelegationWaitSeconds(request.input?.timeoutSeconds) * 1_000)
        + DELEGATION_WAIT_IPC_MARGIN_MS
    }
    if (request?.toolName === 'mcp__collaboration__continue_delegation') {
      return normalizeDelegationWaitSeconds(undefined) * 1_000 + DELEGATION_WAIT_IPC_MARGIN_MS
    }
  }
  return DEFAULT_PARENT_REQUEST_TIMEOUT_MS
}
