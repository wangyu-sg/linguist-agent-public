import { atom } from 'jotai'
import { atomFamily } from 'jotai/utils'
import type {
  LinguistIntegrityScrubEvent,
  LinguistIntegrityScrubProgress,
  LinguistIntegrityScrubReport,
} from '@proma/shared'

export type ProjectIntegrityState =
  | { status: 'idle' }
  | { status: 'starting' }
  | { status: 'running'; jobId: string; progress?: LinguistIntegrityScrubProgress }
  | { status: 'completed'; jobId: string; report: LinguistIntegrityScrubReport }
  | { status: 'cancelled' }
  | { status: 'error'; message: string }

export const INITIAL_PROJECT_INTEGRITY_STATE: ProjectIntegrityState = { status: 'idle' }

export const projectIntegrityStateAtomFamily = atomFamily(
  (_projectId: string) => atom<ProjectIntegrityState>(INITIAL_PROJECT_INTEGRITY_STATE),
)

export function reduceProjectIntegrityEvent(
  projectId: string,
  current: ProjectIntegrityState,
  event: LinguistIntegrityScrubEvent,
): ProjectIntegrityState {
  if (event.projectId !== projectId) return current
  switch (event.state) {
    case 'running':
      return { status: 'running', jobId: event.jobId, progress: event.progress }
    case 'completed':
      return { status: 'completed', jobId: event.jobId, report: event.report }
    case 'cancelled':
      return { status: 'cancelled' }
    case 'failed':
      return { status: 'error', message: event.errorCode }
  }
}

export function subscribeToProjectIntegrity(
  projectId: string,
  onEvent: (event: LinguistIntegrityScrubEvent) => void,
): () => void {
  return window.electronAPI.onLinguistIntegrityProgress((event) => {
    if (event.projectId === projectId) onEvent(event)
  })
}
