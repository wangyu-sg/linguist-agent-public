import type { AgentSessionMeta } from '@proma/shared'
import type { SessionIndicatorStatus } from '@/atoms/agent-atoms'
import {
  getAgentSessionLinguistProjectId,
  getDelegatedChildSessionStatus,
} from '@/lib/agent-session-list'

export interface AgentSessionTreeNode {
  session: AgentSessionMeta
  childSessions: AgentSessionMeta[]
}

export const PROJECT_SESSION_PREVIEW_LIMIT = 5
export const PROJECT_SESSION_RECENT_WINDOW_MS = 3 * 86_400_000

const ACTIVE_SESSION_STATUSES: ReadonlySet<SessionIndicatorStatus> = new Set([
  'blocked',
  'running',
  'completed',
])

const ACTIVE_SESSION_STATUS_PRIORITY: Record<SessionIndicatorStatus, number> = {
  blocked: 0,
  running: 1,
  completed: 2,
  idle: 3,
}

export function isDelegatedChildSession(session: AgentSessionMeta): boolean {
  return !!session.parentSessionId && !!session.sourceDelegationId
}

export function buildAgentSessionTrees(
  sessions: readonly AgentSessionMeta[],
  indicatorMap?: ReadonlyMap<string, SessionIndicatorStatus>,
): AgentSessionTreeNode[] {
  const sessionIds = new Set(sessions.map((session) => session.id))
  const childrenByParentId = new Map<string, AgentSessionMeta[]>()
  const roots: AgentSessionMeta[] = []

  for (const session of sessions) {
    if (
      isDelegatedChildSession(session)
      && session.parentSessionId
      && sessionIds.has(session.parentSessionId)
    ) {
      const children = childrenByParentId.get(session.parentSessionId) ?? []
      children.push(session)
      childrenByParentId.set(session.parentSessionId, children)
    } else {
      roots.push(session)
    }
  }

  return roots.map((session) => ({
    session,
    childSessions: sortDelegatedChildSessions(childrenByParentId.get(session.id) ?? [], indicatorMap),
  }))
}

export function sortDelegatedChildSessions(
  sessions: readonly AgentSessionMeta[],
  indicatorMap?: ReadonlyMap<string, SessionIndicatorStatus>,
): AgentSessionMeta[] {
  return [...sessions].sort((left, right) => {
    const leftActive = indicatorMap && ACTIVE_SESSION_STATUSES.has(getDelegatedChildSessionStatus(left, indicatorMap)) ? 1 : 0
    const rightActive = indicatorMap && ACTIVE_SESSION_STATUSES.has(getDelegatedChildSessionStatus(right, indicatorMap)) ? 1 : 0
    return rightActive - leftActive || right.updatedAt - left.updatedAt
  })
}

export function getSessionTreeStatus(
  item: AgentSessionTreeNode,
  indicatorMap: ReadonlyMap<string, SessionIndicatorStatus>,
): SessionIndicatorStatus {
  const statuses = [
    indicatorMap.get(item.session.id) ?? 'idle',
    ...item.childSessions.map((session) => getDelegatedChildSessionStatus(session, indicatorMap)),
  ]
  if (statuses.includes('blocked')) return 'blocked'
  if (statuses.includes('running')) return 'running'
  if (statuses.includes('completed')) return 'completed'
  return 'idle'
}

export function countCompletedDelegatedChildren(
  childSessions: readonly AgentSessionMeta[],
): number {
  return childSessions.filter((session) => session.delegationStatus === 'completed').length
}

export function treeContainsSessionId(
  item: AgentSessionTreeNode,
  sessionId: string | null | undefined,
): boolean {
  return !!sessionId && (
    item.session.id === sessionId
    || item.childSessions.some((session) => session.id === sessionId)
  )
}

export function isOrdinaryAgentSession(
  session: AgentSessionMeta,
  sessions: readonly AgentSessionMeta[],
): boolean {
  return getAgentSessionLinguistProjectId(session, sessions) === undefined
}

export function isLinguistProjectSession(
  session: AgentSessionMeta,
  projectId?: string,
): boolean {
  return !!session.linguistProjectId
    && (projectId === undefined || session.linguistProjectId === projectId)
}

export function hasPinnedVisibleParent(
  session: AgentSessionMeta,
  sessions: readonly AgentSessionMeta[],
): boolean {
  if (!isDelegatedChildSession(session) || !session.parentSessionId) return false
  return sessions.some((candidate) =>
    candidate.id === session.parentSessionId
    && candidate.pinned === true
    && candidate.archived !== true,
  )
}

export function buildPinnedAgentSessionTrees(
  sessions: readonly AgentSessionMeta[],
): AgentSessionTreeNode[] {
  const visible = sessions.filter((session) => session.archived !== true)
  const roots = visible.filter((session) =>
    session.pinned === true && !hasPinnedVisibleParent(session, visible),
  )
  return roots.map((session) => ({
    session,
    childSessions: visible.filter((candidate) =>
      isDelegatedChildSession(candidate)
      && candidate.parentSessionId === session.id,
    ),
  }))
}

export function selectVisibleAgentSessionTrees(input: {
  trees: readonly AgentSessionTreeNode[]
  indicatorMap: ReadonlyMap<string, SessionIndicatorStatus>
  currentSessionId?: string | null
  now: number
  extraCount?: number
  previousActiveIds?: ReadonlySet<string>
}): {
  visible: AgentSessionTreeNode[]
  activeIds: Set<string>
  hiddenCount: number
} {
  const {
    trees,
    indicatorMap,
    currentSessionId,
    now,
    extraCount = 0,
    previousActiveIds = new Set(),
  } = input
  const active = trees
    .filter((tree) => {
      const status = getSessionTreeStatus(tree, indicatorMap)
      return ACTIVE_SESSION_STATUSES.has(status)
        || (
          tree.session.id === currentSessionId
          && previousActiveIds.has(tree.session.id)
        )
    })
    .slice()
    .sort((left, right) => {
      const statusDelta = ACTIVE_SESSION_STATUS_PRIORITY[
        getSessionTreeStatus(left, indicatorMap)
      ] - ACTIVE_SESSION_STATUS_PRIORITY[getSessionTreeStatus(right, indicatorMap)]
      return statusDelta || right.session.updatedAt - left.session.updatedAt
    })

  const activeIds = new Set<string>()
  for (const tree of active) {
    activeIds.add(tree.session.id)
    for (const child of tree.childSessions) activeIds.add(child.id)
  }

  const recentCutoff = now - PROJECT_SESSION_RECENT_WINDOW_MS
  const recent = trees
    .filter((tree) =>
      !activeIds.has(tree.session.id)
      && tree.session.updatedAt >= recentCutoff,
    )
    .slice(0, PROJECT_SESSION_PREVIEW_LIMIT)
  const baseline = [...active, ...recent]
  const baselineIds = new Set(baseline.map((tree) => tree.session.id))
  const extra = trees
    .filter((tree) => !baselineIds.has(tree.session.id))
    .slice(0, extraCount)
  let visible = [...baseline, ...extra]

  if (
    currentSessionId
    && !visible.some((tree) => treeContainsSessionId(tree, currentSessionId))
  ) {
    const current = trees.find((tree) => treeContainsSessionId(tree, currentSessionId))
    if (current) visible = [...active, current, ...recent, ...extra]
  }

  return {
    visible,
    activeIds,
    hiddenCount: Math.max(0, trees.length - visible.length),
  }
}
