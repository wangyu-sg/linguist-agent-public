/**
 * Citable-evidence determination (PB-083).
 *
 * Carried over from legacy linguist-agent@la-v2-legacy-freeze-2026-07-25
 * `packages/cat-data/src/write_policy.ts` (only the three evidence symbols;
 * the write policy itself hangs on legacy batch_workspace / qa_write_gate
 * and is NOT migrated). Tool traces and agent events are audit data, not
 * citable evidence. Shared by independent-critic and future proposal
 * evidence checks.
 */

/** Audit-only source prefixes: a match is never citable evidence. */
export const AUDIT_ONLY_EVIDENCE_PATTERNS: readonly RegExp[] = [
  /^tool[_\s:-]*trace\b/i,
  /^tool[_\s:-]*call\b/i,
  /^trace\b/i,
  /^agent[_\s:-]*events?\b/i,
  /^pi[_\s:-]*event\b/i,
  /^runtime[_\s:-]*validation\b/i,
]

/** Audit-only (non-citable) source: the trimmed value matches an audit prefix. */
export function isAuditOnlyEvidenceSource(value: string): boolean {
  return AUDIT_ONLY_EVIDENCE_PATTERNS.some((pattern) => pattern.test(value.trim()))
}

/** Citable source: non-empty and not an audit-only trace. */
export function isCitableEvidenceSource(value: string): boolean {
  return Boolean(value.trim()) && !isAuditOnlyEvidenceSource(value)
}
