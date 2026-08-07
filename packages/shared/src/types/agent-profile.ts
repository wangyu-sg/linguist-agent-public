import type { AgentSessionMeta } from './agent'
import type { LinguistRole } from './agent'

export type AgentProfile =
  | {
      kind: 'general'
      workspaceId?: string
    }
  | {
      kind: 'linguist'
      projectId: string
      role: LinguistRole
    }

type AgentProfileMeta = Partial<Pick<
  AgentSessionMeta,
  'workspaceId' | 'linguistProjectId' | 'linguistRole'
>>

/** 会话身份只由持久化 metadata 决定，不从当前 Mode、Tab 或入口位置猜测。 */
export function resolveAgentProfile(meta: AgentProfileMeta | null | undefined): AgentProfile {
  if (meta?.linguistProjectId) {
    return {
      kind: 'linguist',
      projectId: meta.linguistProjectId,
      role: meta.linguistRole ?? 'general',
    }
  }
  return {
    kind: 'general',
    ...(meta?.workspaceId ? { workspaceId: meta.workspaceId } : {}),
  }
}
