import type { AgentRuntime } from '@proma/shared'

export interface LinguistRuntimeObservation {
  runtime: AgentRuntime
  baseToolCount: number | null
  overlayToolCount: number
  observedAt: string
}

export interface LinguistPromptRetryObservation {
  attempts: number
  lastAttemptAt: string
  lastRecovered: boolean
}

const runtimeBySession = new Map<string, LinguistRuntimeObservation>()
const retryByScope = new Map<string, LinguistPromptRetryObservation>()
const MAX_OBSERVATIONS = 128

function setBounded<T>(map: Map<string, T>, key: string, value: T): void {
  map.delete(key)
  map.set(key, value)
  if (map.size > MAX_OBSERVATIONS) map.delete(map.keys().next().value!)
}

export function recordLinguistRuntimeObservation(
  sessionId: string,
  observation: LinguistRuntimeObservation,
): void {
  setBounded(runtimeBySession, sessionId, { ...observation })
}

export function getLinguistRuntimeObservation(
  sessionId: string | undefined,
): LinguistRuntimeObservation | undefined {
  const observation = sessionId === undefined
    ? undefined
    : runtimeBySession.get(sessionId)
  return observation === undefined ? undefined : { ...observation }
}

export function recordLinguistPromptRetry(
  scope: string,
  recovered: boolean,
  attemptedAt = new Date().toISOString(),
): LinguistPromptRetryObservation {
  const previous = retryByScope.get(scope)
  const observation = {
    attempts: (previous?.attempts ?? 0) + 1,
    lastAttemptAt: attemptedAt,
    lastRecovered: recovered,
  }
  setBounded(retryByScope, scope, observation)
  return { ...observation }
}

export function getLinguistPromptRetryObservation(
  scope: string,
): LinguistPromptRetryObservation | undefined {
  const observation = retryByScope.get(scope)
  return observation === undefined ? undefined : { ...observation }
}
