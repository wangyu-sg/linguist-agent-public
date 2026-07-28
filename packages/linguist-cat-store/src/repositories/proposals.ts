/**
 * Proposals repository: insert pending, list, accept/reject/supersede.
 *
 * accept() runs in ONE transaction: read proposal + segment, delegate all
 * lifecycle/CAS/lock checks to cat-core's acceptProposal, then update the
 * proposal row, the segment row, and append the revision entry. Any
 * failure (stale baseRevision, locked segment, non-pending proposal)
 * rolls everything back — no partial writes, ever.
 */

import {
  acceptProposal,
  createProposal,
  expireProposal,
  InvalidStateTransitionError,
  runDeterministicHardRules,
  SegmentLockedError,
  StaleProposalError,
  rejectProposal,
  reissueProposal,
  supersedeProposal,
  UnknownSegmentError,
  type AcceptProposalOptions,
  type AcceptProposalResult,
  type CreateProposalInput,
  type LinguistTagProfile,
  type ProposalId,
  type ProposalStatus,
  type SegmentId,
  type TranslationProposal,
} from '@linguist/cat-core'
import type { CatDatabase } from '../database'
import { StoreNotFoundError } from '../errors'
import { proposalFromRow, proposalToParams, segmentFromRow, type ProposalRow, type SegmentRow } from './rows'

export interface ProposalMutationItem {
  proposalId: ProposalId | string
  expectedRevision: number
}

export type IdempotentProposalMutation<T> =
  | { ok: true; result: T; replayed: boolean }
  | { ok: false; conflict: true }

export interface EditAndAcceptInput extends ProposalMutationItem {
  editedTarget: string
  idempotencyKey: string
  now?: string
  /** PB-097：项目 tag 族登记表（调用方从 project.json 解析）；缺省 = 仅内置族。 */
  tagProfile?: LinguistTagProfile
}

export interface ReissueTerminalProposalInput extends ProposalMutationItem {
  idempotencyKey: string
  runId?: string
  now?: string
}

export interface ProposalListFilter {
  status?: ProposalStatus
  limit?: number
  offset?: number
}

interface ProposalMutationRow {
  operation: string
  request_fingerprint: string
  result_json: string
}

export class ProposalsRepository {
  constructor(private readonly db: CatDatabase) {}

  /** Create + insert a pending proposal (id is content-derived). */
  insertPending(input: CreateProposalInput): TranslationProposal {
    return this.insertPendingMany([input])[0]!
  }

  /** Validate and insert a proposal batch in one transaction. Exact pending duplicates are idempotent. */
  insertPendingMany(inputs: readonly CreateProposalInput[]): TranslationProposal[] {
    if (inputs.length === 0) return []
    return this.db.transaction(`insert ${inputs.length} proposals`, () => {
      const proposals = new Map<string, TranslationProposal>()
      for (const input of inputs) {
        const proposal = this.insertPendingWithinTransaction(input)
        if (proposals.has(proposal.id)) continue
        proposals.set(proposal.id, proposal)
      }
      return [...proposals.values()]
    })
  }

  private insertPendingWithinTransaction(input: CreateProposalInput): TranslationProposal {
    return this.insertPendingProposalWithinTransaction(createProposal(input))
  }

  private insertPendingProposalWithinTransaction(
    proposal: TranslationProposal,
  ): TranslationProposal {
    const existing = this.getById(proposal.id)
    if (existing?.status === 'pending') return existing
    if (existing) throw new InvalidStateTransitionError('proposal', existing.status, 'pending')
    const row = this.db.db
      .prepare('SELECT * FROM segments WHERE id = ?')
      .get(proposal.segmentId) as SegmentRow | undefined
    if (!row) throw new UnknownSegmentError(proposal.segmentId, `Proposal ${proposal.id}`)
    const segment = segmentFromRow(row)
    if (segment.locked) throw new SegmentLockedError(segment.id)
    if (segment.revision !== proposal.baseRevision) {
      throw new StaleProposalError(proposal.id, segment.id, proposal.baseRevision, segment.revision)
    }
    this.db.db
      .prepare(
        `INSERT INTO proposals (
           id, segment_id, base_revision, proposed_target,
           evidence_refs_json, term_refs_json, warnings_json,
           model_id, session_id, run_id,
           reissued_from_proposal_id, supersedes_proposal_id,
           created_at, status
         )
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(...proposalToParams(proposal))
    return proposal
  }

  getById(proposalId: ProposalId | string): TranslationProposal | undefined {
    const row = this.db.db.prepare('SELECT * FROM proposals WHERE id = ?').get(proposalId) as
      | ProposalRow
      | undefined
    return row === undefined ? undefined : proposalFromRow(row)
  }

  listBySegment(segmentId: SegmentId | string, status?: ProposalStatus): TranslationProposal[] {
    const rows = (
      status === undefined
        ? this.db.db
            .prepare('SELECT * FROM proposals WHERE segment_id = ? ORDER BY created_at, id')
            .all(segmentId)
        : this.db.db
            .prepare('SELECT * FROM proposals WHERE segment_id = ? AND status = ? ORDER BY created_at, id')
            .all(segmentId, status)
    ) as ProposalRow[]
    return rows.map(proposalFromRow)
  }

  listPending(): TranslationProposal[] {
    const rows = this.db.db
      .prepare("SELECT * FROM proposals WHERE status = 'pending' ORDER BY created_at, id")
      .all() as ProposalRow[]
    return rows.map(proposalFromRow)
  }

  /** Project-level inbox/history, newest first and bounded by the caller. */
  list(filter: ProposalListFilter = {}): TranslationProposal[] {
    const limit = filter.limit ?? 500
    const offset = filter.offset ?? 0
    const rows = (
      filter.status === undefined
        ? this.db.db
            .prepare('SELECT * FROM proposals ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?')
            .all(limit, offset)
        : this.db.db
            .prepare(
              'SELECT * FROM proposals WHERE status = ? ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?',
            )
            .all(filter.status, limit, offset)
    ) as ProposalRow[]
    return rows.map(proposalFromRow)
  }

  count(status?: ProposalStatus): number {
    const row = (
      status === undefined
        ? this.db.db.prepare('SELECT COUNT(*) AS n FROM proposals').get()
        : this.db.db
            .prepare('SELECT COUNT(*) AS n FROM proposals WHERE status = ?')
            .get(status)
    ) as { n: number }
    return Number(row.n)
  }

  countPendingByAsset(assetId: string): number {
    const row = this.db.db
      .prepare(
        `SELECT COUNT(*) AS n
         FROM proposals
         INNER JOIN segments ON segments.id = proposals.segment_id
         WHERE segments.asset_id = ? AND proposals.status = 'pending'`,
      )
      .get(assetId) as { n: number }
    return Number(row.n)
  }

  /** Mark pending proposals expired when their segment revision has moved on. */
  expireStale(): TranslationProposal[] {
    return this.db.transaction('expire stale proposals', () => {
      const rows = this.db.db
        .prepare(
          `SELECT p.* FROM proposals p
           JOIN segments s ON s.id = p.segment_id
           WHERE p.status = 'pending' AND p.base_revision <> s.revision
           ORDER BY p.created_at, p.id`,
        )
        .all() as ProposalRow[]
      return rows.map((row) => {
        const expired = expireProposal(proposalFromRow(row))
        this.db.db
          .prepare('UPDATE proposals SET status = ? WHERE id = ?')
          .run(expired.status, expired.id)
        return expired
      })
    })
  }

  /**
   * Accept a pending proposal (CAS) in ONE transaction. Delegates to
   * cat-core acceptProposal: UnknownSegmentError / SegmentLockedError /
   * InvalidStateTransitionError / StaleProposalError propagate unchanged
   * and roll the transaction back.
   */
  accept(proposalId: ProposalId | string, options: AcceptProposalOptions = {}): AcceptProposalResult {
    return this.acceptMany([proposalId], options)[0]!
  }

  /** Accept selected proposals as one transaction; any conflict rolls back the whole selection. */
  acceptMany(
    proposalIds: readonly (ProposalId | string)[],
    options: AcceptProposalOptions = {},
  ): AcceptProposalResult[] {
    const uniqueIds = [...new Set(proposalIds)]
    if (uniqueIds.length === 0) return []
    return this.db.transaction(`accept ${uniqueIds.length} proposals`, () =>
      uniqueIds.map((proposalId) => this.acceptWithinTransaction(proposalId, options)),
    )
  }

  acceptSelected(
    items: readonly ProposalMutationItem[],
    idempotencyKey: string,
    options: AcceptProposalOptions = {},
  ): IdempotentProposalMutation<AcceptProposalResult[]> {
    const request = { items, now: options.now ?? null }
    return this.idempotentMutation('accept-selected', idempotencyKey, request, () =>
      this.uniqueItems(items).map((item) => {
        this.assertExpectedRevision(item)
        return this.acceptWithinTransaction(item.proposalId, options)
      }),
    )
  }

  private acceptWithinTransaction(
    proposalId: ProposalId | string,
    options: AcceptProposalOptions,
  ): AcceptProposalResult {
    const proposal = this.getById(proposalId)
    if (!proposal) throw new StoreNotFoundError('proposal', proposalId)
    const segmentRow = this.db.db
      .prepare('SELECT * FROM segments WHERE id = ?')
      .get(proposal.segmentId) as SegmentRow | undefined
    if (!segmentRow) throw new UnknownSegmentError(proposal.segmentId, `Proposal ${proposalId}`)
    const result = acceptProposal(segmentFromRow(segmentRow), proposal, options)
    this.db.db
      .prepare('UPDATE proposals SET status = ? WHERE id = ?')
      .run(result.proposal.status, proposalId)
    this.db.db
      .prepare('UPDATE segments SET target = ?, status = ?, revision = ? WHERE id = ?')
      .run(result.segment.target, result.segment.status, result.segment.revision, result.segment.id)
    this.db.db
      .prepare(
        'INSERT INTO segment_revisions (segment_id, revision, target, status, source, created_at) VALUES (?, ?, ?, ?, ?, ?)',
      )
      .run(
        result.segment.id,
        result.revision.revision,
        result.revision.target,
        result.revision.status,
        result.revision.source,
        result.revision.createdAt,
      )
    return result
  }

  /** Reject a pending proposal. */
  reject(proposalId: ProposalId | string): TranslationProposal {
    return this.transitionTerminal(proposalId, 'rejected')
  }

  rejectSelected(
    items: readonly ProposalMutationItem[],
    idempotencyKey: string,
  ): IdempotentProposalMutation<TranslationProposal[]> {
    return this.idempotentMutation('reject-selected', idempotencyKey, { items }, () =>
      this.uniqueItems(items).map((item) => {
        this.assertExpectedRevision(item)
        return this.transitionTerminalWithinTransaction(item.proposalId, 'rejected')
      }),
    )
  }

  editAndAccept(input: EditAndAcceptInput): IdempotentProposalMutation<AcceptProposalResult> {
    const { idempotencyKey, ...request } = input
    return this.idempotentMutation('edit-and-accept', idempotencyKey, request, () => {
      this.assertExpectedRevision(input)
      const original = this.getById(input.proposalId)
      if (!original) throw new StoreNotFoundError('proposal', input.proposalId)
      if (original.status !== 'pending') {
        throw new InvalidStateTransitionError('proposal', original.status, 'accepted')
      }
      if (input.editedTarget === original.proposedTarget) {
        return this.acceptWithinTransaction(original.id, { now: input.now })
      }
      const segmentRow = this.db.db
        .prepare('SELECT * FROM segments WHERE id = ?')
        .get(original.segmentId) as SegmentRow | undefined
      if (!segmentRow) throw new UnknownSegmentError(original.segmentId, `Proposal ${original.id}`)
      const hardRules = runDeterministicHardRules({
        segment: segmentFromRow(segmentRow),
        proposedTarget: input.editedTarget,
        ...(input.tagProfile !== undefined ? { tagProfile: input.tagProfile } : {}),
      })
      if (!hardRules.ok) {
        throw new InvalidStateTransitionError(
          'proposal-hard-rules',
          hardRules.violations[0]!.code,
          'accepted',
        )
      }
      const edited = this.insertPendingWithinTransaction({
        segmentId: original.segmentId,
        baseRevision: original.baseRevision,
        proposedTarget: input.editedTarget,
        evidenceRefs: original.evidenceRefs,
        termRefs: original.termRefs,
        warnings: original.warnings,
        ...(original.modelId !== undefined ? { modelId: original.modelId } : {}),
        ...(original.sessionId !== undefined ? { sessionId: original.sessionId } : {}),
        runId: `human-edit:${input.idempotencyKey}`,
        supersedesProposalId: original.id,
        issuanceKey: `edit-and-accept:${input.idempotencyKey}`,
        ...(input.now !== undefined ? { now: input.now } : {}),
      })
      this.transitionTerminalWithinTransaction(original.id, 'superseded')
      return this.acceptWithinTransaction(edited.id, { now: input.now })
    })
  }

  /**
   * Re-open a terminal conclusion as a new pending row. The original status
   * is immutable; idempotency and lineage make the replacement explicit.
   */
  reissueTerminal(
    input: ReissueTerminalProposalInput,
  ): IdempotentProposalMutation<TranslationProposal> {
    const { idempotencyKey, ...request } = input
    return this.idempotentMutation('reissue-terminal', idempotencyKey, request, () => {
      this.assertExpectedRevision(input)
      const original = this.getById(input.proposalId)
      if (!original) throw new StoreNotFoundError('proposal', input.proposalId)
      const segment = this.db.db
        .prepare('SELECT * FROM segments WHERE id = ?')
        .get(original.segmentId) as SegmentRow | undefined
      if (!segment) throw new UnknownSegmentError(original.segmentId, `Proposal ${original.id}`)
      return this.insertPendingProposalWithinTransaction(reissueProposal(original, {
        baseRevision: segment.revision,
        reissueKey: idempotencyKey,
        runId: input.runId ?? `human-reconcile:${idempotencyKey}`,
        ...(input.now !== undefined ? { now: input.now } : {}),
      }))
    })
  }

  /** Supersede a pending proposal (a newer proposal replaced it). */
  supersede(proposalId: ProposalId | string): TranslationProposal {
    return this.transitionTerminal(proposalId, 'superseded')
  }

  private transitionTerminal(proposalId: string, to: 'rejected' | 'superseded'): TranslationProposal {
    return this.db.transaction(`${to} proposal ${proposalId}`, () =>
      this.transitionTerminalWithinTransaction(proposalId, to),
    )
  }

  private transitionTerminalWithinTransaction(
    proposalId: ProposalId | string,
    to: 'rejected' | 'superseded',
  ): TranslationProposal {
    const proposal = this.getById(proposalId)
    if (!proposal) throw new StoreNotFoundError('proposal', proposalId)
    const updated = to === 'rejected' ? rejectProposal(proposal) : supersedeProposal(proposal)
    this.db.db.prepare('UPDATE proposals SET status = ? WHERE id = ?').run(updated.status, proposalId)
    return updated
  }

  private uniqueItems(items: readonly ProposalMutationItem[]): ProposalMutationItem[] {
    const unique = new Map<string, ProposalMutationItem>()
    for (const item of items) unique.set(item.proposalId, item)
    return [...unique.values()]
  }

  private assertExpectedRevision(item: ProposalMutationItem): void {
    const proposal = this.getById(item.proposalId)
    if (!proposal) throw new StoreNotFoundError('proposal', item.proposalId)
    const row = this.db.db
      .prepare('SELECT * FROM segments WHERE id = ?')
      .get(proposal.segmentId) as SegmentRow | undefined
    if (!row) throw new UnknownSegmentError(proposal.segmentId, `Proposal ${proposal.id}`)
    const segment = segmentFromRow(row)
    if (segment.revision !== item.expectedRevision) {
      throw new StaleProposalError(
        proposal.id,
        segment.id,
        item.expectedRevision,
        segment.revision,
      )
    }
  }

  private idempotentMutation<T>(
    operation: string,
    idempotencyKey: string,
    request: object,
    mutate: () => T,
  ): IdempotentProposalMutation<T> {
    return this.db.transaction(`${operation} ${idempotencyKey}`, () => {
      const fingerprint = JSON.stringify(request)
      const existing = this.db.db
        .prepare(
          'SELECT operation, request_fingerprint, result_json FROM proposal_mutations WHERE idempotency_key = ?',
        )
        .get(idempotencyKey) as ProposalMutationRow | undefined
      if (existing) {
        if (existing.operation !== operation || existing.request_fingerprint !== fingerprint) {
          return { ok: false, conflict: true }
        }
        return { ok: true, result: JSON.parse(existing.result_json) as T, replayed: true }
      }
      const result = mutate()
      this.db.db
        .prepare(
          'INSERT INTO proposal_mutations (idempotency_key, operation, request_fingerprint, result_json, created_at) VALUES (?, ?, ?, ?, ?)',
        )
        .run(idempotencyKey, operation, fingerprint, JSON.stringify(result), new Date().toISOString())
      return { ok: true, result, replayed: false }
    })
  }
}
