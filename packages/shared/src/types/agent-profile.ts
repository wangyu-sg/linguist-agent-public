import type { AgentSessionMeta } from './agent'
import type { LinguistQualityProfile } from './linguist'

export type AgentProfile =
  | {
      kind: 'general'
      workspaceId?: string
    }
  | {
      kind: 'linguist'
      projectId: string
      role: 'assistant' | 'reviewer' | 'auditor'
      strategy: LinguistQualityProfile
    }

type AgentProfileMeta = Partial<Pick<
  AgentSessionMeta,
  'workspaceId' | 'linguistProjectId' | 'linguistSessionRole' | 'linguistStrategy'
>>

/** 会话身份只由持久化 metadata 决定，不从当前 Mode、Tab 或入口位置猜测。 */
export function resolveAgentProfile(meta: AgentProfileMeta | null | undefined): AgentProfile {
  if (meta?.linguistProjectId) {
    return {
      kind: 'linguist',
      projectId: meta.linguistProjectId,
      role: meta.linguistSessionRole ?? 'assistant',
      strategy: meta.linguistStrategy ?? 'balanced',
    }
  }
  return {
    kind: 'general',
    ...(meta?.workspaceId ? { workspaceId: meta.workspaceId } : {}),
  }
}
