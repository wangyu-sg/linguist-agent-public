import { atom } from 'jotai'
import type { AgentSessionMeta } from '@proma/shared'
import { agentSessionsAtom } from './agent-atoms'
import { getAgentSessionLinguistProjectId } from '@/lib/agent-session-list'

type SessionSelectionUpdate =
  | Map<string, string>
  | ((current: Map<string, string>) => Map<string, string>)

const projectAgentSessionPreferenceAtom = atom<Map<string, string>>(new Map())

export function parseProjectAgentSessionPreferences(value: unknown): Map<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return new Map()
  return new Map(
    Object.entries(value).filter(
      (entry): entry is [string, string] =>
        entry[0].length > 0 && typeof entry[1] === 'string' && entry[1].length > 0,
    ),
  )
}

export function serializeProjectAgentSessionIds(
  selections: ReadonlyMap<string, string>,
): Record<string, string> {
  return Object.fromEntries(selections)
}

function isSelectableProjectSession(
  session: AgentSessionMeta,
  projectId: string,
  sessions: readonly AgentSessionMeta[],
): boolean {
  return getAgentSessionLinguistProjectId(session, sessions) === projectId
}

export function resolveProjectAgentSessionIds(
  preferences: ReadonlyMap<string, string>,
  sessions: readonly AgentSessionMeta[],
): Map<string, string> {
  const sessionsById = new Map(sessions.map((session) => [session.id, session]))
  const resolved = new Map<string, string>()

  for (const [projectId, sessionId] of preferences) {
    const session = sessionsById.get(sessionId)
    if (session && isSelectableProjectSession(session, projectId, sessions)) {
      resolved.set(projectId, sessionId)
    }
  }

  const freshest = [...sessions]
    .filter((session) => getAgentSessionLinguistProjectId(session, sessions) !== undefined && session.archived !== true)
    .sort((left, right) =>
      right.updatedAt - left.updatedAt || right.createdAt - left.createdAt,
    )
  for (const session of freshest) {
    const projectId = getAgentSessionLinguistProjectId(session, sessions)
    if (projectId !== undefined && !resolved.has(projectId)) {
      resolved.set(projectId, session.id)
    }
  }

  return resolved
}

/**
 * Project → 原生 Agent Session 的唯一 Renderer 选择真源。
 * 无有效选择时只回退到已有最新会话；打开项目不会隐式创建会话。
 */
export const projectCurrentAgentSessionIdMapAtom = atom(
  (get) => resolveProjectAgentSessionIds(
    get(projectAgentSessionPreferenceAtom),
    get(agentSessionsAtom),
  ),
  (get, set, update: SessionSelectionUpdate) => {
    const current = get(projectAgentSessionPreferenceAtom)
    set(
      projectAgentSessionPreferenceAtom,
      typeof update === 'function' ? update(current) : update,
    )
  },
)
