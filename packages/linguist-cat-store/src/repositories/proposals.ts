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
  createProposalIssuance,
  createProposal,
  expireProposal,
  InvalidStateTransitionError,
  RevisionConflictError,
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
  type DeterministicHardRuleInput,
  type ProposalId,
  type ProposalIssuance,
  type ProposalIssuanceInput,
  type ProposalStatus,
  type Segment,
  type SegmentId,
  type TranslationProposal,
} from '@linguist/cat-core'
import type { CatDatabase } from '../database'
import { StoreNotFoundError } from '../errors'
import {
  proposalFromRow,
  proposalIssuanceFromRow,
  proposalIssuanceToParams,
  proposalToParams,
  segmentFromRow,
  type ProposalIssuanceRow,
  type ProposalRow,
  type SegmentRow,
} from './rows'

export interface ProposalMutationItem {
  proposalId: ProposalId | string
  expectedRevision: number
}

export type IdempotentProposalMutation<T> =
  | { ok: true; result: T; replayed: boolean }
  | { ok: false; conflict: true }

export type ProposalHardRuleOptions = Pick<
  DeterministicHardRuleInput,
  'requiredTerminology' | 'forbiddenTerms' | 'tagProfile'
>

export type ProposalAcceptOptions = AcceptProposalOptions & ProposalHardRuleOptions
export interface ProposalCreateOptions extends ProposalHardRuleOptions {
  issuance?: ProposalIssuanceInput
}

export interface ApplyTranslationEdit {
  segmentId: SegmentId | string
  baseRevision: number
  target: string
  note?: string
}

export interface ApplyTranslationsOptions extends ProposalCreateOptions {
  mode?: 'apply' | 'proposal'
  modelId?: string
  sessionId?: string
  runId?: string
  now?: string
}

export interface ApplyTranslationsResult {
  requested: number
  applied: number
  pending: number
  stale: string[]
  locked: string[]
  failed: Array<{ segmentId: string; code: string }>
  proposalIds: string[]
}

export interface EditAndAcceptInput extends ProposalMutationItem, ProposalHardRuleOptions {
  editedTarget: string
  idempotencyKey: string
  now?: string
}

export interface ReissueTerminalProposalInput extends ProposalMutationItem, ProposalHardRuleOptions {
  idempotencyKey: string
  runId?: string
  now?: string
}

export interface ProposalListFilter {
  status?: ProposalStatus
  limit?: number
  offset?: number
}

export interface ProposalWithDiff {
  proposal: TranslationProposal
  originalOrdinal: number
  source: string
  currentTarget: string
  proposedTarget: string
  currentRevision: number
  baseRevision: number
  locked: boolean
  issuanceCount: number
  latestIssuance: ProposalIssuance
}

interface ProposalDiffRow extends ProposalRow {
  segment_ordinal: number
  segment_source: string
  segment_target: string
  segment_revision: number
  segment_locked: number
  issuance_count: number
  latest_issuance_json: string | null
}

interface ProposalMutationRow {
  operation: string
  request_fingerprint: string
  result_json: string
}

export class ProposalsRepository {
  constructor(private readonly db: CatDatabase) {}

  /** 一次业务操作创建 Proposal，并按模式直接接受或保留 Pending；每段独立回滚。 */
  applyTranslations(
    edits: readonly ApplyTranslationEdit[],
    options: ApplyTranslationsOptions = {},
  ): ApplyTranslationsResult {
    if (edits.length < 1 || edits.length > 200) {
      throw new RangeError('applyTranslations expects 1-200 edits')
    }
    const result: ApplyTranslationsResult = {
      requested: edits.length,
      applied: 0,
      pending: 0,
      stale: [],
      locked: [],
      failed: [],
      proposalIds: [],
    }
    return this.db.transaction(`apply ${edits.length} translations`, () => {
      const hardRules = this.mergeHardRuleOptions(options)
      for (const edit of edits) {
        this.db.db.exec('SAVEPOINT apply_translation_item')
        try {
          if (edit.target.trim() === '') throw new TypeError('EMPTY_TARGET')
          if (edit.note !== undefined && edit.note.length > 2_000) throw new TypeError('NOTE_TOO_LONG')
          const proposal = this.insertPendingWithinTransaction({
            segmentId: edit.segmentId as SegmentId,
            baseRevision: edit.baseRevision,
            proposedTarget: edit.target,
            ...(edit.note?.trim() ? { warnings: [`说明：${edit.note.trim()}`] } : {}),
            ...(options.modelId === undefined ? {} : { modelId: options.modelId }),
            ...(options.sessionId === undefined ? {} : { sessionId: options.sessionId }),
            ...(options.runId === undefined ? {} : { runId: options.runId }),
            ...(options.now === undefined ? {} : { now: options.now }),
          }, hardRules, options.issuance)
          result.proposalIds.push(proposal.id as string)
          if ((options.mode ?? 'apply') === 'proposal') result.pending += 1
          else {
            this.acceptWithinTransaction(proposal.id, { ...hardRules, ...(options.now === undefined ? {} : { now: options.now }) })
            result.applied += 1
          }
          this.db.db.exec('RELEASE apply_translation_item')
        } catch (error) {
          this.db.db.exec('ROLLBACK TO apply_translation_item')
          this.db.db.exec('RELEASE apply_translation_item')
          if (error instanceof SegmentLockedError) result.locked.push(edit.segmentId as string)
          else if (error instanceof RevisionConflictError) result.stale.push(edit.segmentId as string)
          else {
            const code = error instanceof InvalidStateTransitionError && error.entity === 'proposal-hard-rules'
              ? error.from
              : error instanceof UnknownSegmentError
                ? error.code
                : error instanceof Error && /^[A-Z][A-Z0-9_]+$/.test(error.message)
                  ? error.message
                  : 'FAILED'
            result.failed.push({ segmentId: edit.segmentId as string, code })
          }
        }
      }
      return result
    })
  }

  /** Create + insert a pending proposal (id is content-derived). */
  insertPending(
    input: CreateProposalInput,
    options: ProposalCreateOptions = {},
  ): TranslationProposal {
    return this.insertPendingMany([input], options)[0]!
  }

  /** Validate and insert a proposal batch in one transaction. Exact pending duplicates are idempotent. */
  insertPendingMany(
    inputs: readonly CreateProposalInput[],
    options: ProposalCreateOptions = {},
  ): TranslationProposal[] {
    if (inputs.length === 0) return []
    return this.db.transaction(`insert ${inputs.length} proposals`, () => {
      const hardRuleOptions = this.mergeHardRuleOptions(options)
      const proposals = new Map<string, TranslationProposal>()
      for (const input of inputs) {
        const proposal = this.insertPendingWithinTransaction(input, hardRuleOptions, options.issuance)
        if (proposals.has(proposal.id)) continue
        proposals.set(proposal.id, proposal)
      }
      return [...proposals.values()]
    })
  }

  private insertPendingWithinTransaction(
    input: CreateProposalInput,
    options: ProposalHardRuleOptions,
    issuance?: ProposalIssuanceInput,
  ): TranslationProposal {
    return this.insertPendingProposalWithinTransaction(createProposal(input), options, issuance)
  }

  private insertPendingProposalWithinTransaction(
    proposal: TranslationProposal,
    options: ProposalHardRuleOptions,
    issuanceInput?: ProposalIssuanceInput,
  ): TranslationProposal {
    const row = this.db.db
      .prepare('SELECT * FROM segments WHERE id = ?')
      .get(proposal.segmentId) as SegmentRow | undefined
    if (!row) throw new UnknownSegmentError(proposal.segmentId, `Proposal ${proposal.id}`)
    const segment = segmentFromRow(row)
    if (segment.locked) throw new SegmentLockedError(segment.id)
    if (segment.revision !== proposal.baseRevision) {
      throw new StaleProposalError(proposal.id, segment.id, proposal.baseRevision, segment.revision)
    }
    this.assertHardRules(segment, proposal.proposedTarget, options, 'pending')
    const existing = this.getById(proposal.id)
    if (existing && existing.status !== 'pending') {
      throw new InvalidStateTransitionError('proposal', existing.status, 'pending')
    }
    if (!existing) {
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
    }
    this.insertIssuance(proposal, issuanceInput)
    return existing ?? proposal
  }

  private insertIssuance(
    proposal: TranslationProposal,
    input?: ProposalIssuanceInput,
  ): ProposalIssuance {
    const issuance = createProposalIssuance(proposal, input)
    const existing = this.db.db
      .prepare('SELECT * FROM proposal_issuances WHERE issuance_id = ?')
      .get(issuance.id) as ProposalIssuanceRow | undefined
    if (existing) {
      const persisted = proposalIssuanceFromRow(existing)
      if (
        JSON.stringify(proposalIssuanceToParams(persisted)) !==
        JSON.stringify(proposalIssuanceToParams(issuance))
      ) {
        throw new InvalidStateTransitionError('proposal-issuance', issuance.id, 'retry')
      }
      return persisted
    }
    this.db.db
      .prepare(
        `INSERT INTO proposal_issuances (
           issuance_id, proposal_id, idempotency_key, session_id, run_id, tool_call_id,
           model_provider, model_id, runtime, role, strategy, linguist_prompt_version,
           prompt_hash, project_digest_hash, project_digest_revision,
           turn_context_version, turn_context_snapshot_json, turn_context_hash,
           toolset_hash, evidence_refs_json, term_refs_json, created_at
         ) VALUES (${Array.from({ length: 22 }, () => '?').join(', ')})`,
      )
      .run(...proposalIssuanceToParams(issuance))
    return issuance
  }

  listIssuances(proposalId: ProposalId | string): ProposalIssuance[] {
    if (this.db.schemaVersion < 13) {
      const proposal = this.getById(proposalId)
      return proposal === undefined ? [] : [this.legacyIssuance(proposal)]
    }
    return (this.db.db
      .prepare(
        'SELECT * FROM proposal_issuances WHERE proposal_id = ? ORDER BY created_at, issuance_id',
      )
      .all(proposalId) as ProposalIssuanceRow[]).map(proposalIssuanceFromRow)
  }

  private legacyIssuance(proposal: TranslationProposal): ProposalIssuance {
    return createProposalIssuance(proposal, {
      idempotencyKey: `legacy:${proposal.id}`,
      createdAt: proposal.createdAt,
    })
  }

  private storedHardRules(): Pick<
    DeterministicHardRuleInput,
    'requiredTerminology' | 'forbiddenTerms'
  > {
    const rows = this.db.db
      .prepare(
        `SELECT term, translation, status, case_sensitive
         FROM term_entries
         WHERE status IN ('required', 'forbidden')
         ORDER BY id`,
      )
      .all() as Array<{
        term: string
        translation: string
        status: 'required' | 'forbidden'
        case_sensitive: number
      }>
    return {
      requiredTerminology: rows
        .filter((row) => row.status === 'required')
        .map((row) => ({
          sourceTerm: row.term,
          targetTerm: row.translation,
          caseSensitive: row.case_sensitive === 1,
        })),
      forbiddenTerms: rows
        .filter((row) => row.status === 'forbidden')
        .map((row) => ({
          sourceTerm: row.term,
          term: row.translation,
          caseSensitive: row.case_sensitive === 1,
        })),
    }
  }

  private mergeHardRuleOptions(options: ProposalHardRuleOptions): ProposalHardRuleOptions {
    const stored = this.storedHardRules()
    return {
      ...options,
      requiredTerminology: [
        ...(stored.requiredTerminology ?? []),
        ...(options.requiredTerminology ?? []),
      ],
      forbiddenTerms: [
        ...(stored.forbiddenTerms ?? []),
        ...(options.forbiddenTerms ?? []),
      ],
    }
  }

  private assertHardRules(
    segment: Segment,
    proposedTarget: string,
    options: ProposalHardRuleOptions,
    to: 'pending' | 'accepted',
  ): void {
    const violation = runDeterministicHardRules({
      segment,
      proposedTarget,
      ...options,
    }).violations[0]
    if (violation !== undefined) {
      throw new InvalidStateTransitionError('proposal-hard-rules', violation.code, to)
    }
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

  /** Proposal inbox projection in one JOIN query; avoids list + per-row segment reads. */
  listWithDiffs(filter: ProposalListFilter = {}): ProposalWithDiff[] {
    const limit = filter.limit ?? 500
    const offset = filter.offset ?? 0
    const legacySchema = this.db.schemaVersion < 13
    const issuanceProjection = legacySchema
      ? '0 AS issuance_count, NULL AS latest_issuance_json'
      : `(SELECT COUNT(*) FROM proposal_issuances pi
           WHERE pi.proposal_id = p.id) AS issuance_count,
         (SELECT json_object(
           'issuance_id', pi.issuance_id, 'proposal_id', pi.proposal_id,
           'idempotency_key', pi.idempotency_key, 'session_id', pi.session_id,
           'run_id', pi.run_id, 'tool_call_id', pi.tool_call_id,
           'model_provider', pi.model_provider, 'model_id', pi.model_id,
           'runtime', pi.runtime, 'role', pi.role, 'strategy', pi.strategy,
           'linguist_prompt_version', pi.linguist_prompt_version,
           'prompt_hash', pi.prompt_hash, 'project_digest_hash', pi.project_digest_hash,
           'project_digest_revision', pi.project_digest_revision,
           'turn_context_version', pi.turn_context_version,
           'turn_context_snapshot_json', pi.turn_context_snapshot_json,
           'turn_context_hash', pi.turn_context_hash, 'toolset_hash', pi.toolset_hash,
           'evidence_refs_json', pi.evidence_refs_json,
           'term_refs_json', pi.term_refs_json, 'created_at', pi.created_at
         ) FROM proposal_issuances pi WHERE pi.proposal_id = p.id
           ORDER BY pi.created_at DESC, pi.issuance_id DESC LIMIT 1) AS latest_issuance_json`
    const select = `
      SELECT p.*,
             s.ordinal AS segment_ordinal,
             s.source AS segment_source,
             s.target AS segment_target,
             s.revision AS segment_revision,
             s.locked AS segment_locked,
             ${issuanceProjection}
      FROM proposals p
      INNER JOIN segments s ON s.id = p.segment_id`
    const rows = (
      filter.status === undefined
        ? this.db.db
            .prepare(`${select} ORDER BY p.created_at DESC, p.id DESC LIMIT ? OFFSET ?`)
            .all(limit, offset)
        : this.db.db
            .prepare(`${select} WHERE p.status = ? ORDER BY p.created_at DESC, p.id DESC LIMIT ? OFFSET ?`)
            .all(filter.status, limit, offset)
    ) as ProposalDiffRow[]
    return rows.map((row) => {
      const proposal = proposalFromRow(row)
      if (!legacySchema && row.latest_issuance_json === null) {
        throw new Error(`Proposal issuance not found: ${proposal.id}`)
      }
      const latestIssuance = row.latest_issuance_json === null
        ? this.legacyIssuance(proposal)
        : proposalIssuanceFromRow(JSON.parse(row.latest_issuance_json) as ProposalIssuanceRow)
      return {
        proposal,
        originalOrdinal: row.segment_ordinal + 1,
        source: row.segment_source,
        currentTarget: row.segment_target,
        proposedTarget: proposal.proposedTarget,
        currentRevision: row.segment_revision,
        baseRevision: proposal.baseRevision,
        locked: row.segment_locked !== 0,
        issuanceCount: legacySchema ? 1 : Number(row.issuance_count),
        latestIssuance,
      }
    })
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

  /** LA-INTAKE-007：全状态提案计数（撤销导入的下游引用判定）。 */
  countByAsset(assetId: string): number {
    const row = this.db.db
      .prepare(
        `SELECT COUNT(*) AS n
         FROM proposals
         INNER JOIN segments ON segments.id = proposals.segment_id
         WHERE segments.asset_id = ?`,
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
  accept(proposalId: ProposalId | string, options: ProposalAcceptOptions = {}): AcceptProposalResult {
    return this.acceptMany([proposalId], options)[0]!
  }

  /** Accept selected proposals as one transaction; any conflict rolls back the whole selection. */
  acceptMany(
    proposalIds: readonly (ProposalId | string)[],
    options: ProposalAcceptOptions = {},
  ): AcceptProposalResult[] {
    const uniqueIds = [...new Set(proposalIds)]
    if (uniqueIds.length === 0) return []
    return this.db.transaction(`accept ${uniqueIds.length} proposals`, () => {
      const hardRuleOptions = this.mergeHardRuleOptions(options)
      return uniqueIds.map((proposalId) =>
        this.acceptWithinTransaction(proposalId, hardRuleOptions),
      )
    })
  }

  acceptSelected(
    items: readonly ProposalMutationItem[],
    idempotencyKey: string,
    options: ProposalAcceptOptions = {},
  ): IdempotentProposalMutation<AcceptProposalResult[]> {
    const request = { items, now: options.now ?? null }
    return this.idempotentMutation('accept-selected', idempotencyKey, request, () => {
      const hardRuleOptions = this.mergeHardRuleOptions(options)
      return this.uniqueItems(items).map((item) => {
        this.assertExpectedRevision(item)
        return this.acceptWithinTransaction(item.proposalId, hardRuleOptions)
      })
    })
  }

  private acceptWithinTransaction(
    proposalId: ProposalId | string,
    options: ProposalAcceptOptions,
  ): AcceptProposalResult {
    const proposal = this.getById(proposalId)
    if (!proposal) throw new StoreNotFoundError('proposal', proposalId)
    const segmentRow = this.db.db
      .prepare('SELECT * FROM segments WHERE id = ?')
      .get(proposal.segmentId) as SegmentRow | undefined
    if (!segmentRow) throw new UnknownSegmentError(proposal.segmentId, `Proposal ${proposalId}`)
    const segment = segmentFromRow(segmentRow)
    const result = acceptProposal(segment, proposal, options)
    this.assertHardRules(segment, proposal.proposedTarget, options, 'accepted')
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
      const hardRuleOptions = this.mergeHardRuleOptions(input)
      if (input.editedTarget === original.proposedTarget) {
        return this.acceptWithinTransaction(original.id, hardRuleOptions)
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
      }, hardRuleOptions, {
        idempotencyKey: `edit-and-accept:${input.idempotencyKey}`,
        runId: `human-edit:${input.idempotencyKey}`,
        ...(input.now === undefined ? {} : { createdAt: input.now }),
      })
      this.transitionTerminalWithinTransaction(original.id, 'superseded')
      return this.acceptWithinTransaction(edited.id, hardRuleOptions)
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
      const hardRuleOptions = this.mergeHardRuleOptions(input)
      return this.insertPendingProposalWithinTransaction(reissueProposal(original, {
        baseRevision: segment.revision,
        reissueKey: idempotencyKey,
        runId: input.runId ?? `human-reconcile:${idempotencyKey}`,
        ...(input.now !== undefined ? { now: input.now } : {}),
      }), hardRuleOptions, {
        idempotencyKey: `reissue-terminal:${idempotencyKey}`,
        runId: input.runId ?? `human-reconcile:${idempotencyKey}`,
        ...(input.now === undefined ? {} : { createdAt: input.now }),
      })
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
