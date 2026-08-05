import { atom } from 'jotai'
import { atomFamily } from 'jotai/utils'
import type {
  LinguistIpcResult,
  LinguistProjectEventAckRequest,
  LinguistProjectEventAckResult,
  LinguistProjectEventListRequest,
  LinguistProjectEventListResult,
  LinguistProjectMutationEvent,
} from '@proma/shared'

export interface ProjectMutationState {
  lastRevision: number
  lastSequence: number
  latest?: {
    event: LinguistProjectMutationEvent
    gap: boolean
  }
}

export interface ProjectMutationRefreshPlan {
  summary: boolean
  segments: 'none' | 'affected-pages' | 'current-page'
  proposals: boolean
  qa: boolean
  context: boolean
  resources: boolean
  segmentIds: readonly string[]
}

type MutationSubscriber = (
  callback: (event: LinguistProjectMutationEvent) => void,
) => () => void

export const INITIAL_PROJECT_MUTATION_STATE: ProjectMutationState = {
  lastRevision: 0,
  lastSequence: 0,
}

export const linguistProjectMutationStateAtomFamily = atomFamily(
  (_projectId: string) => atom<ProjectMutationState>(INITIAL_PROJECT_MUTATION_STATE),
)

export function subscribeToProjectMutations(
  projectId: string,
  onMutation: (event: LinguistProjectMutationEvent) => void,
  subscribe?: MutationSubscriber,
): () => void {
  const register = subscribe
    ?? ((callback: (event: LinguistProjectMutationEvent) => void) =>
      window.electronAPI.onLinguistProjectMutation(callback))
  return register((event) => {
    if (event.projectId === projectId) onMutation(event)
  })
}

export function reduceProjectMutation(
  projectId: string,
  current: ProjectMutationState,
  event: LinguistProjectMutationEvent,
): ProjectMutationState {
  if (event.projectId !== projectId) return current
  const nextRevision = Math.max(current.lastRevision, event.revision)
  const nextSequence = event.sequence === undefined
    ? current.lastSequence
    : Math.max(current.lastSequence, event.sequence)
  if (nextRevision === current.lastRevision && nextSequence === current.lastSequence) return current
  const gap = event.sequence === undefined
    ? event.revision > current.lastRevision + 1
    : event.sequence > current.lastSequence + 1
  return {
    lastRevision: nextRevision,
    lastSequence: nextSequence,
    latest: {
      event,
      gap,
    },
  }
}

type ProjectEventPull = (
  input: LinguistProjectEventListRequest,
) => Promise<LinguistIpcResult<LinguistProjectEventListResult>>

type ProjectEventAck = (
  input: LinguistProjectEventAckRequest,
) => Promise<LinguistIpcResult<LinguistProjectEventAckResult>>

/** 重连或发现 gap 时从 durable outbox 补拉；读取成功应用后才显式 ack。 */
export async function replayProjectMutations(
  projectId: string,
  current: ProjectMutationState,
  options: {
    consumerId?: string
    pull?: ProjectEventPull
    ack?: ProjectEventAck
  } = {},
): Promise<ProjectMutationState> {
  const pull = options.pull ?? ((input) => window.electronAPI.linguistCatListProjectEvents(input))
  const ack = options.ack ?? ((input) => window.electronAPI.linguistCatAckProjectEvents(input))
  let next = current
  let afterSequence = current.lastSequence
  let replayedCount = 0
  while (true) {
    const result = await pull({ projectId, afterSequence, limit: 100 })
    if (!result.ok) throw new Error(result.error.code)
    for (const event of result.data.events) {
      if (
        event.projectId !== projectId ||
        event.sequence === undefined ||
        event.sequence !== afterSequence + 1
      ) {
        throw new Error('INVALID_PROJECT_EVENT_REPLAY')
      }
      afterSequence = event.sequence
      next = reduceProjectMutation(projectId, next, event)
      replayedCount += 1
    }
    if (!result.data.hasMore) break
    if (result.data.events.length === 0) throw new Error('PROJECT_EVENT_REPLAY_STALLED')
  }
  if (replayedCount > 1 && next.latest !== undefined) {
    next = { ...next, latest: { ...next.latest, gap: true } }
  }
  if (next.lastSequence > 0) {
    const acknowledged = await ack({
      projectId,
      consumerId: options.consumerId ?? 'renderer-workbench-v1',
      throughSequence: next.lastSequence,
    })
    if (!acknowledged.ok) throw new Error(acknowledged.error.code)
  }
  return next
}

export function getProjectMutationRefreshPlan(
  state: ProjectMutationState,
): ProjectMutationRefreshPlan {
  const latest = state.latest
  const plan: ProjectMutationRefreshPlan = {
    summary: false,
    segments: 'none',
    proposals: false,
    qa: false,
    context: false,
    resources: false,
    segmentIds: latest?.event.segmentIds ?? [],
  }
  if (latest === undefined) return plan
  const { event, gap } = latest
  if (gap) {
    return {
      ...plan,
      segments: 'current-page',
      summary: true,
      proposals: true,
      qa: true,
      context: true,
      resources: true,
    }
  }
  switch (event.kind) {
    case 'proposal-created':
      return {
        ...plan,
        proposals: true,
        context: true,
      }
    case 'proposal-reviewed':
      return {
        ...plan,
        summary: true,
        segments: 'affected-pages',
        proposals: true,
        qa: true,
        context: true,
      }
    case 'segment-updated':
      return {
        ...plan,
        summary: true,
        segments: 'affected-pages',
        qa: true,
        context: true,
      }
    case 'qa-updated':
      return {
        ...plan,
        summary: true,
        qa: true,
        context: true,
      }
    case 'asset-updated':
      return {
        ...plan,
        summary: true,
        segments: 'current-page',
        context: true,
        resources: true,
      }
    case 'project-updated':
      return {
        ...plan,
        summary: true,
        segments: plan.segmentIds.length > 0 ? 'affected-pages' : 'none',
        proposals: (event.proposalIds?.length ?? 0) > 0,
        qa: (event.qaFindingIds?.length ?? 0) > 0,
        context: true,
        resources: true,
      }
    case 'job-updated':
      return plan
    case 'run-undone':
      return {
        ...plan,
        summary: true,
        segments: 'current-page',
        proposals: true,
        qa: true,
        context: true,
        resources: true,
      }
  }
}

export function affectedLoadedPageOffsets(
  affectedSegmentIds: readonly string[],
  segmentIds: readonly string[],
  loadedRows: ReadonlyMap<number, unknown>,
  pageSize: number,
): number[] {
  const offsets = new Set<number>()
  for (const segmentId of affectedSegmentIds) {
    const index = segmentIds.indexOf(segmentId)
    if (index >= 0 && loadedRows.has(index)) {
      offsets.add(Math.floor(index / pageSize) * pageSize)
    }
  }
  return [...offsets].sort((left, right) => left - right)
}
