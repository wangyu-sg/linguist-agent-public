import { atom } from 'jotai'
import { atomFamily } from 'jotai/utils'
import type { LinguistProjectMutationEvent } from '@proma/shared'

export interface ProjectMutationState {
  lastRevision: number
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
  if (event.projectId !== projectId || event.revision <= current.lastRevision) return current
  return {
    lastRevision: event.revision,
    latest: {
      event,
      gap: event.revision > current.lastRevision + 1,
    },
  }
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
