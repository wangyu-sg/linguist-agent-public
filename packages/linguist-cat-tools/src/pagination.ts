/**
 * Pagination math for the CAT tools (PB-041). Pure — no IO, no store
 * imports — so it runs under plain `bun test`.
 *
 * Policy (plan §7.4): limits have a small default and a HARD maximum; an
 * oversized limit is CLAMPED (never an error) and the result carries a
 * note. Non-integer / negative limits and negative offsets are invalid and
 * throw LinguistCatInvalidArgumentError (Pi validates the TypeBox schema
 * before execute(), so this is the defensive layer for direct calls).
 */

import { LinguistCatInvalidArgumentError } from './errors'

export interface PageLimits {
  defaultLimit: number
  maxLimit: number
}

export interface PageRequest {
  limit?: number
  offset?: number
}

export interface ResolvedPage {
  limit: number
  offset: number
  /** True when the requested limit exceeded the hard max and was clamped. */
  clamped: boolean
  /** Model-facing note; present iff clamped. */
  note?: string
}

function assertNonNegativeInteger(name: 'limit' | 'offset', value: number): void {
  if (!Number.isInteger(value) || value < 0) {
    throw new LinguistCatInvalidArgumentError(name, `expected a non-negative integer, got ${String(value)}`)
  }
}

/** Resolve limit/offset against the tool's page policy. */
export function resolvePage(request: PageRequest, limits: PageLimits): ResolvedPage {
  const { limit, offset = 0 } = request
  assertNonNegativeInteger('offset', offset)
  if (limit === undefined) {
    return { limit: limits.defaultLimit, offset, clamped: false }
  }
  assertNonNegativeInteger('limit', limit)
  if (limit === 0) {
    throw new LinguistCatInvalidArgumentError('limit', 'expected a positive integer, got 0')
  }
  if (limit > limits.maxLimit) {
    return {
      limit: limits.maxLimit,
      offset,
      clamped: true,
      note: `Requested limit ${limit} exceeds the hard maximum; clamped to ${limits.maxLimit}. Use offset to page through remaining results.`,
    }
  }
  return { limit, offset, clamped: false }
}

/** hasMore for the standard paged envelope. */
export function pageHasMore(total: number, offset: number, itemCount: number): boolean {
  return offset + itemCount < total
}
