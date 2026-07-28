/**
 * TranslationProposal — plan-mandated proposal schema and lifecycle:
 *
 *   create (pending) -> accept | reject | supersede
 *
 * Accept rule (hard): a proposal may only be applied when
 * segment.revision === proposal.baseRevision AND the segment is not locked
 * AND the proposal is still pending. Otherwise a typed domain error is
 * thrown — a stale proposal is never force-applied.
 */

import {
  InvalidStateTransitionError,
  SegmentLockedError,
  StaleProposalError,
  UnknownSegmentError,
} from './errors'
import { deriveProposalId, type ProposalId, type SegmentId } from './ids'
import { applyTargetEdit, type Segment, type SegmentRevision } from './segment'

export type ProposalStatus = 'pending' | 'accepted' | 'rejected' | 'superseded' | 'expired'

export interface TranslationProposal {
  id: ProposalId
  segmentId: SegmentId
  baseRevision: number
  proposedTarget: string
  evidenceRefs: string[]
  termRefs: string[]
  warnings: string[]
  modelId?: string
  sessionId?: string
  /** One trusted tool execution / proposal batch. */
  runId?: string
  /** Explicit lineage for a new review decision over a terminal proposal. */
  reissuedFromProposalId?: ProposalId
  /** Explicit replacement lineage used by edit-and-accept/reconcile flows. */
  supersedesProposalId?: ProposalId
  createdAt: string
  status: ProposalStatus
}

export interface CreateProposalInput {
  segmentId: SegmentId
  baseRevision: number
  proposedTarget: string
  evidenceRefs?: string[]
  termRefs?: string[]
  warnings?: string[]
  modelId?: string
  sessionId?: string
  runId?: string
  reissuedFromProposalId?: ProposalId
  supersedesProposalId?: ProposalId
  /**
   * Trusted occurrence discriminator. Omit for normal content-idempotent
   * proposals; explicit reissue/reconcile flows must provide it.
   */
  issuanceKey?: string
  /** ISO timestamp; inject for determinism. */
  now?: string
}

/**
 * Create a pending proposal. The id is content-derived
 * hash(segmentId, baseRevision, proposedTarget) — same input, same id.
 */
export function createProposal(input: CreateProposalInput): TranslationProposal {
  return {
    id: deriveProposalId(
      input.segmentId,
      input.baseRevision,
      input.proposedTarget,
      input.issuanceKey,
    ),
    segmentId: input.segmentId,
    baseRevision: input.baseRevision,
    proposedTarget: input.proposedTarget,
    evidenceRefs: input.evidenceRefs ?? [],
    termRefs: input.termRefs ?? [],
    warnings: input.warnings ?? [],
    ...(input.modelId !== undefined ? { modelId: input.modelId } : {}),
    ...(input.sessionId !== undefined ? { sessionId: input.sessionId } : {}),
    ...(input.runId !== undefined ? { runId: input.runId } : {}),
    ...(input.reissuedFromProposalId !== undefined
      ? { reissuedFromProposalId: input.reissuedFromProposalId }
      : {}),
    ...(input.supersedesProposalId !== undefined
      ? { supersedesProposalId: input.supersedesProposalId }
      : {}),
    createdAt: input.now ?? new Date().toISOString(),
    status: 'pending',
  }
}

export interface ReissueProposalInput {
  baseRevision: number
  /** Trusted idempotency/occurrence key; never supplied by the model. */
  reissueKey: string
  modelId?: string
  sessionId?: string
  runId?: string
  now?: string
}

/**
 * Create a new pending review decision from a terminal proposal without
 * rewriting history. The new row keeps explicit lineage and has a distinct
 * id even when target text and base revision are unchanged.
 */
export function reissueProposal(
  original: TranslationProposal,
  input: ReissueProposalInput,
): TranslationProposal {
  if (original.status === 'pending') {
    throw new InvalidStateTransitionError('proposal', 'pending', 'reissued')
  }
  if (input.reissueKey.trim().length === 0) {
    throw new Error('Proposal reissueKey must be non-blank.')
  }
  return createProposal({
    segmentId: original.segmentId,
    baseRevision: input.baseRevision,
    proposedTarget: original.proposedTarget,
    evidenceRefs: original.evidenceRefs,
    termRefs: original.termRefs,
    warnings: original.warnings,
    ...((input.modelId ?? original.modelId) !== undefined
      ? { modelId: input.modelId ?? original.modelId }
      : {}),
    ...((input.sessionId ?? original.sessionId) !== undefined
      ? { sessionId: input.sessionId ?? original.sessionId }
      : {}),
    ...(input.runId !== undefined ? { runId: input.runId } : {}),
    reissuedFromProposalId: original.id,
    issuanceKey: `reissue:${original.id}:${input.reissueKey}`,
    ...(input.now !== undefined ? { now: input.now } : {}),
  })
}

export interface AcceptProposalResult {
  segment: Segment
  revision: SegmentRevision
  proposal: TranslationProposal
}

export interface AcceptProposalOptions {
  /** ISO timestamp for the revision entry; inject for determinism. */
  now?: string
}

/**
 * Apply a pending proposal to its segment (CAS). Throws:
 * - UnknownSegmentError if the proposal references another segment
 * - SegmentLockedError if the segment is locked
 * - InvalidStateTransitionError if the proposal is not pending
 * - StaleProposalError if segment.revision !== proposal.baseRevision
 */
export function acceptProposal(
  segment: Segment,
  proposal: TranslationProposal,
  options: AcceptProposalOptions = {},
): AcceptProposalResult {
  if (proposal.segmentId !== segment.id) {
    throw new UnknownSegmentError(proposal.segmentId, `Proposal ${proposal.id}`)
  }
  if (segment.locked) throw new SegmentLockedError(segment.id)
  if (proposal.status !== 'pending') {
    throw new InvalidStateTransitionError('proposal', proposal.status, 'accepted')
  }
  if (segment.revision !== proposal.baseRevision) {
    throw new StaleProposalError(proposal.id, segment.id, proposal.baseRevision, segment.revision)
  }
  const { segment: updated, revision } = applyTargetEdit(segment, proposal.proposedTarget, segment.revision, {
    source: 'proposal',
    status: 'translated',
    ...(options.now !== undefined ? { now: options.now } : {}),
  })
  return { segment: updated, revision, proposal: { ...proposal, status: 'accepted' } }
}

function transitionTerminal(
  proposal: TranslationProposal,
  to: 'rejected' | 'superseded' | 'expired',
): TranslationProposal {
  if (proposal.status !== 'pending') {
    throw new InvalidStateTransitionError('proposal', proposal.status, to)
  }
  return { ...proposal, status: to }
}

/** Reject a pending proposal. */
export function rejectProposal(proposal: TranslationProposal): TranslationProposal {
  return transitionTerminal(proposal, 'rejected')
}

/**
 * Supersede a pending proposal (a newer proposal for the same segment
 * replaced it). Pure per-proposal transition; pairing with the replacement
 * proposal is the caller's concern.
 */
export function supersedeProposal(proposal: TranslationProposal): TranslationProposal {
  return transitionTerminal(proposal, 'superseded')
}

/** Expire a pending proposal after its segment revision moved on. */
export function expireProposal(proposal: TranslationProposal): TranslationProposal {
  return transitionTerminal(proposal, 'expired')
}
