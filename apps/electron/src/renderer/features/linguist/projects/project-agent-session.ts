import type { createStore } from 'jotai/vanilla'
import type {
  AgentSessionMeta,
  LinguistIpcResult,
  LinguistSessionCreateForProjectRequest,
} from '@proma/shared'
import { agentSessionsAtom } from '@/atoms/agent-atoms'
import { projectCurrentAgentSessionIdMapAtom } from '@/atoms/project-agent-session-atoms'
import { replaceAgentSessionInFreshnessOrder } from '@/lib/agent-session-list'

type JotaiStore = ReturnType<typeof createStore>
type CreateProjectSession = (
  input: LinguistSessionCreateForProjectRequest,
) => Promise<LinguistIpcResult<AgentSessionMeta>>

const pendingCreates = new WeakMap<
  JotaiStore,
  Map<string, Promise<LinguistIpcResult<AgentSessionMeta>>>
>()

function isUsableProjectSession(
  session: AgentSessionMeta | undefined,
  projectId: string,
): session is AgentSessionMeta {
  return session?.linguistProjectId === projectId && session.archived !== true
}

export function selectProjectAgentSession(
  store: JotaiStore,
  projectId: string,
  sessionId: string,
): boolean {
  const session = store.get(agentSessionsAtom).find((item) => item.id === sessionId)
  if (!isUsableProjectSession(session, projectId)) return false

  store.set(projectCurrentAgentSessionIdMapAtom, (previous) => {
    const next = new Map(previous)
    next.set(projectId, sessionId)
    return next
  })
  return true
}

/** 归档/只读历史专用；只放宽会话 archived，不放宽项目绑定身份。 */
export function selectProjectAgentSessionForHistory(
  store: JotaiStore,
  projectId: string,
  sessionId: string,
): boolean {
  const session = store.get(agentSessionsAtom).find((item) => item.id === sessionId)
  if (session?.linguistProjectId !== projectId) return false
  store.set(projectCurrentAgentSessionIdMapAtom, (previous) => {
    const next = new Map(previous)
    next.set(projectId, sessionId)
    return next
  })
  return true
}

export function selectFallbackLinguistSession(
  store: JotaiStore,
  projectId: string,
  excludedSessionId: string,
): string | undefined {
  const fallback = store.get(agentSessionsAtom)
    .filter((session) =>
      session.id !== excludedSessionId
      && isUsableProjectSession(session, projectId),
    )
    .sort((left, right) =>
      Number(!!right.pinned) - Number(!!left.pinned)
      || right.updatedAt - left.updatedAt
      || left.id.localeCompare(right.id),
    )[0]

  store.set(projectCurrentAgentSessionIdMapAtom, (previous) => {
    const next = new Map(previous)
    if (fallback) next.set(projectId, fallback.id)
    else next.delete(projectId)
    return next
  })
  return fallback?.id
}

export function registerCreatedProjectSession(
  store: JotaiStore,
  projectId: string,
  session: AgentSessionMeta,
): boolean {
  if (!isUsableProjectSession(session, projectId)) return false
  store.set(agentSessionsAtom, (previous) =>
    replaceAgentSessionInFreshnessOrder(previous, session),
  )
  return selectProjectAgentSession(store, projectId, session.id)
}

/**
 * LF-032 懒创建 seam：只有 Agent rail / 发送等调用方明确需要会话时才调用。
 * 同项目并发请求共用一次 IPC，避免首次打开 rail 与发送同时产生两个会话。
 */
export function ensureProjectAgentSession(
  store: JotaiStore,
  projectId: string,
  createSession: CreateProjectSession = (input) =>
    window.electronAPI.linguistSessionsCreateForProject(input),
): Promise<LinguistIpcResult<AgentSessionMeta>> {
  const currentId = store.get(projectCurrentAgentSessionIdMapAtom).get(projectId)
  const current = store.get(agentSessionsAtom).find((session) => session.id === currentId)
  if (isUsableProjectSession(current, projectId)) {
    return Promise.resolve({ ok: true, data: current })
  }

  let storeCreates = pendingCreates.get(store)
  if (!storeCreates) {
    storeCreates = new Map()
    pendingCreates.set(store, storeCreates)
  }
  const pending = storeCreates.get(projectId)
  if (pending) return pending

  const created: Promise<LinguistIpcResult<AgentSessionMeta>> = createSession({ projectId })
    .then((result) => {
      if (!result.ok) return result
      if (!registerCreatedProjectSession(store, projectId, result.data)) {
        return {
          ok: false as const,
          error: { code: 'INTERNAL' as const, message: '项目会话绑定不一致' },
        }
      }
      return result
    })
    .finally(() => {
      storeCreates?.delete(projectId)
    })
  storeCreates.set(projectId, created)
  return created
}
