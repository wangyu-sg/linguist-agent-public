/**
 * Typed domain errors. Each error carries a stable machine-readable `code`
 * string — codes are part of the public contract and must never change
 * without a migration note.
 */

export const DOMAIN_ERROR_CODES = {
  SEGMENT_LOCKED: 'SEGMENT_LOCKED',
  REVISION_CONFLICT: 'REVISION_CONFLICT',
  STALE_PROPOSAL: 'STALE_PROPOSAL',
  UNKNOWN_SEGMENT: 'UNKNOWN_SEGMENT',
  INVALID_STATE_TRANSITION: 'INVALID_STATE_TRANSITION',
  INVALID_ID: 'INVALID_ID',
} as const

export type DomainErrorCode = (typeof DOMAIN_ERROR_CODES)[keyof typeof DOMAIN_ERROR_CODES]

export abstract class DomainError extends Error {
  abstract readonly code: DomainErrorCode
}

/** A locked segment rejects target edits and proposal acceptance. */
export class SegmentLockedError extends DomainError {
  readonly code = DOMAIN_ERROR_CODES.SEGMENT_LOCKED
  constructor(readonly segmentId: string) {
    super(`Segment ${segmentId} is locked; target edits and proposals are rejected.`)
    this.name = 'SegmentLockedError'
  }
}

/**
 * Compare-and-swap failure: the caller's expected revision no longer
 * matches the segment's current revision. Never overwrite on conflict.
 */
export class RevisionConflictError extends DomainError {
  readonly code: DomainErrorCode = DOMAIN_ERROR_CODES.REVISION_CONFLICT
  constructor(
    readonly segmentId: string,
    readonly expectedRevision: number,
    readonly currentRevision: number,
  ) {
    super(
      `Segment ${segmentId} revision conflict: expected ${expectedRevision}, current ${currentRevision}.`,
    )
    this.name = 'RevisionConflictError'
  }
}

/**
 * A proposal may only be applied when segment.revision === proposal.baseRevision.
 * A stale proposal indicates the segment moved on; it must be regenerated,
 * never force-applied. Subclass of RevisionConflictError so generic CAS
 * handlers catch both.
 */
export class StaleProposalError extends RevisionConflictError {
  override readonly code = DOMAIN_ERROR_CODES.STALE_PROPOSAL
  constructor(
    readonly proposalId: string,
    segmentId: string,
    baseRevision: number,
    currentRevision: number,
  ) {
    super(segmentId, baseRevision, currentRevision)
    this.name = 'StaleProposalError'
  }
}

/** The segment referenced by an operation (e.g. a proposal) does not match. */
export class UnknownSegmentError extends DomainError {
  readonly code = DOMAIN_ERROR_CODES.UNKNOWN_SEGMENT
  constructor(
    readonly segmentId: string,
    readonly referencedBy?: string,
  ) {
    super(
      referencedBy
        ? `${referencedBy} references unknown segment ${segmentId}.`
        : `Unknown segment ${segmentId}.`,
    )
    this.name = 'UnknownSegmentError'
  }
}

/** Illegal lifecycle transition (e.g. accepting a non-pending proposal). */
export class InvalidStateTransitionError extends DomainError {
  readonly code = DOMAIN_ERROR_CODES.INVALID_STATE_TRANSITION
  constructor(
    readonly entity: string,
    readonly from: string,
    readonly to: string,
  ) {
    super(`Invalid ${entity} state transition: ${from} -> ${to}.`)
    this.name = 'InvalidStateTransitionError'
  }
}

/** A string failed branded-id validation. */
export class InvalidIdError extends DomainError {
  readonly code = DOMAIN_ERROR_CODES.INVALID_ID
  constructor(
    readonly value: string,
    readonly expectedFormat: string,
  ) {
    super(`Invalid id "${value}"; expected format ${expectedFormat}.`)
    this.name = 'InvalidIdError'
  }
}
