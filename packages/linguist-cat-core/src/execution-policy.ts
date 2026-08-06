/**
 * Execution Policy — LA-QUALITY-001 replacement for the quality tiers
 * (fast/balanced/best, see quality-profile.ts, now legacy-read-only).
 *
 * Alpha scope (Ponytail cut): a single knob, `independentReview`
 * ('off' | 'risk-based'). The full multi-field ExecutionPolicy is
 * deliberately NOT built.
 *
 * Legacy mapping (read path only, never written back):
 * - fast / balanced → independentReview 'off'
 * - best → 'risk-based'
 *
 * `executionPolicy` is an optional LinguistProject field: project.json files
 * written before LA-QUALITY-001 carry only the legacy `qualityProfile` key
 * (or neither). `resolveExecutionPolicy` is the single read seam — explicit
 * executionPolicy wins, legacy qualityProfile maps, everything else falls
 * back to the default; it never throws and never rewrites the stored file.
 */

import { normalizeQualityProfile } from './quality-profile'

export type LinguistIndependentReview = 'off' | 'risk-based'

export interface LinguistExecutionPolicy {
  independentReview: LinguistIndependentReview
}

export const DEFAULT_EXECUTION_POLICY: LinguistExecutionPolicy = {
  independentReview: 'off',
}

/** Unknown/absent values fall back field-wise to the default; never throws. */
export function normalizeExecutionPolicy(value: unknown): LinguistExecutionPolicy {
  const record = typeof value === 'object' && value !== null
    ? (value as { independentReview?: unknown })
    : undefined
  return {
    independentReview: record?.independentReview === 'risk-based' ? 'risk-based' : 'off',
  }
}

/** Legacy quality tier → execution policy (fast/balanced → off; best → risk-based). */
export function executionPolicyFromLegacyQualityProfile(value: unknown): LinguistExecutionPolicy {
  return {
    independentReview: normalizeQualityProfile(value) === 'best' ? 'risk-based' : 'off',
  }
}

/**
 * Single read seam for a persisted project: explicit executionPolicy wins;
 * legacy qualityProfile maps; absent/unknown falls back to the default.
 */
export function resolveExecutionPolicy(project: {
  executionPolicy?: unknown
  qualityProfile?: unknown
}): LinguistExecutionPolicy {
  if (project.executionPolicy !== undefined) {
    return normalizeExecutionPolicy(project.executionPolicy)
  }
  if (project.qualityProfile !== undefined) {
    return executionPolicyFromLegacyQualityProfile(project.qualityProfile)
  }
  return DEFAULT_EXECUTION_POLICY
}

/** Structural equality (the policy is a flat literal record). */
export function sameExecutionPolicy(
  a: LinguistExecutionPolicy,
  b: LinguistExecutionPolicy,
): boolean {
  return a.independentReview === b.independentReview
}
