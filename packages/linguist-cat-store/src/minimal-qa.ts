/**
 * INTERIM minimal QA — a deliberate placeholder until the real QA Core
 * lands in PB-070. Do NOT grow this into a rule engine; replace it when
 * PB-070 arrives. (Marked interim in code here, in the CLI docs, and in
 * the G2 report.)
 *
 * Exactly two deterministic checks:
 * - EMPTY_TARGET (L1): non-locked segment whose source is non-empty
 *   but target is empty.
 * - PLACEHOLDER_MISMATCH (L0): the {curly} tokens and inline <tags>
 *   of a non-empty target differ (as multisets) from those of the source.
 *
 * Findings use cat-core's OpenQaFindingInput shape, so they flow through
 * the store's qa_findings repository (rerun semantics) unchanged. No
 * number/terminology/fuzzy rules — those belong to PB-070.
 */

import type { OpenQaFindingInput, Segment } from '@linguist/cat-core'

export const MINIMAL_QA_RULES = {
  EMPTY_TARGET: 'EMPTY_TARGET',
  PLACEHOLDER_MISMATCH: 'PLACEHOLDER_MISMATCH',
} as const

const CURLY_TOKEN = /\{[^{}]*\}/g
const INLINE_TAG = /<\/?[A-Za-z][^<>]*\/?>/g

function addMatches(counts: Map<string, number>, text: string, pattern: RegExp): void {
  for (const match of text.matchAll(pattern)) {
    const token = match[0]
    counts.set(token, (counts.get(token) ?? 0) + 1)
  }
}

/** Placeholder multiset of a text: {curly} tokens plus inline <tags>. */
export function placeholderMultiset(text: string): Map<string, number> {
  const counts = new Map<string, number>()
  addMatches(counts, text, CURLY_TOKEN)
  addMatches(counts, text, INLINE_TAG)
  return counts
}

/** Tokens in `expected` exceeding `actual`, with multiplicities, sorted. */
export function multisetDiff(expected: ReadonlyMap<string, number>, actual: ReadonlyMap<string, number>): string[] {
  const out: string[] = []
  for (const [token, count] of expected) {
    const missing = count - (actual.get(token) ?? 0)
    for (let i = 0; i < missing; i++) out.push(token)
  }
  return out.sort()
}

function preview(text: string, max = 60): string {
  const flat = text.replace(/\s+/g, ' ').trim()
  return flat.length <= max ? flat : `${flat.slice(0, max - 1)}…`
}

/**
 * Run the interim checks over one segment. Locked segments are skipped
 * (translate="no" — an empty target there is intentional); an empty
 * source never fires EMPTY_TARGET (there is nothing to translate); the
 * placeholder check only runs on a non-empty target (an empty target is
 * already covered by EMPTY_TARGET).
 */
export function minimalQaSegment(segment: Segment): OpenQaFindingInput[] {
  if (segment.locked) return []
  if (segment.target === '') {
    if (segment.source === '') return []
    return [
      {
        segmentId: segment.id,
        code: MINIMAL_QA_RULES.EMPTY_TARGET,
        severity: 'L1',
        message: `Target is empty (source: ${preview(segment.source)}).`,
      },
    ]
  }
  const sourceTokens = placeholderMultiset(segment.source)
  const targetTokens = placeholderMultiset(segment.target)
  const missing = multisetDiff(sourceTokens, targetTokens)
  const extra = multisetDiff(targetTokens, sourceTokens)
  if (missing.length === 0 && extra.length === 0) return []
  const parts: string[] = []
  if (missing.length > 0) parts.push(`missing in target: ${missing.join(', ')}`)
  if (extra.length > 0) parts.push(`not in source: ${extra.join(', ')}`)
  return [
    {
      segmentId: segment.id,
      code: MINIMAL_QA_RULES.PLACEHOLDER_MISMATCH,
      severity: 'L0',
      message: `Placeholder mismatch (${parts.join('; ')}).`,
    },
  ]
}
