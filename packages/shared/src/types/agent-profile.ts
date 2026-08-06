import type { AgentSessionMeta } from './agent'
import {
  linguistExecutionPolicyFromLegacyStrategy,
  type LinguistExecutionPolicy,
} from './linguist'

export type AgentProfile =
  | {
      kind: 'general'
      workspaceId?: string
    }
  | {
      kind: 'linguist'
      projectId: string
      role: 'assistant' | 'reviewer' | 'auditor'
      /** LA-QUALITY-001：冻结的 Execution Policy（legacy linguistStrategy 会话读取时映射）。 */
      executionPolicy: LinguistExecutionPolicy
    }

type AgentProfileMeta = Partial<Pick<
  AgentSessionMeta,
  'workspaceId' | 'linguistProjectId' | 'linguistSessionRole' | 'linguistStrategy' | 'linguistExecutionPolicy'
>>

/**
 * 会话 Execution Policy 的单一解析缝：冻结的 linguistExecutionPolicy 优先；
 * 旧会话的 legacy linguistStrategy 映射（best → risk-based，其余 → off）；
 * 都缺省时回落默认（off）。会话 meta 一经创建绝不改写（LA-QUALITY-001）。
 */
export function resolveLinguistExecutionPolicy(
  meta: Pick<AgentProfileMeta, 'linguistStrategy' | 'linguistExecutionPolicy'> | null | undefined,
): LinguistExecutionPolicy {
  return meta?.linguistExecutionPolicy
    ?? linguistExecutionPolicyFromLegacyStrategy(meta?.linguistStrategy)
}

/** 会话身份只由持久化 metadata 决定，不从当前 Mode、Tab 或入口位置猜测。 */
export function resolveAgentProfile(meta: AgentProfileMeta | null | undefined): AgentProfile {
  if (meta?.linguistProjectId) {
    return {
      kind: 'linguist',
      projectId: meta.linguistProjectId,
      role: meta.linguistSessionRole ?? 'assistant',
      executionPolicy: resolveLinguistExecutionPolicy(meta),
    }
  }
  return {
    kind: 'general',
    ...(meta?.workspaceId ? { workspaceId: meta.workspaceId } : {}),
  }
}
