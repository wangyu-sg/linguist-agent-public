/**
 * QA Finding persistence: stable evaluation identity, append-only occurrence
 * and status history, plus explicit human lifecycle transitions.
 */

import {
  deriveStableIdV2,
  fnv1a64,
  openQaFinding,
  sha256Hex,
  transitionQaFinding,
  type OpenQaFindingInput,
  type QaFinding,
  type QaFindingId,
  type QaFindingStatus,
  type SegmentId,
} from '@linguist/cat-core'
import type { CatDatabase } from '../database'
import { StoreNotFoundError } from '../errors'
import {
  qaFindingFromRow,
  type PersistedQaFinding,
  type QaFindingRow,
} from './rows'

export interface QaFindingListFilter {
  assetId?: string
  segmentId?: string
  code?: string
  status?: QaFindingStatus
  severity?: QaFinding['severity']
  disposition?: QaFinding['disposition']
  limit?: number
  offset?: number
}

export interface QaWaiverEvidence {
  reason: string
  operator: string
  at: string
}

export interface QaFindingPersistenceInput extends OpenQaFindingInput {
  /** Rule/schema version; a change creates a new evaluation identity. */
  ruleVersion?: string
  /** Stable evidence identity or digest; values are normalized to SHA-256. */
  evidenceHash?: string
}

export interface QaRunPersistence {
  runId?: string
  observedAt?: string
  ruleVersion?: string
}

export interface QaFindingOccurrence {
  occurrenceId: string
  findingId: string
  runId: string
  observedAt: string
}

export interface QaFindingStatusEvent {
  eventId: string
  findingId: string
  fromStatus?: QaFindingStatus
  toStatus: QaFindingStatus
  actorType: 'system' | 'human'
  actorId?: string
  reason?: string
  createdAt: string
}

interface ObservedFinding {
  finding: QaFinding
  segmentRevision: number
  ruleVersion: string
  evidenceHash: string
  legacyFindingId: string
  legacyEvidenceHash: string
}

const textEncoder = new TextEncoder()

function digest(value: string): string {
  return sha256Hex(textEncoder.encode(value))
}

function eventId(kind: string, values: readonly string[]): string {
  return deriveStableIdV2(kind, values)
}

export class QaFindingsRepository {
  constructor(
    private readonly db: CatDatabase,
    private readonly now: () => string,
  ) {}

  replaceForSegment(
    segmentId: SegmentId | string,
    inputs: readonly QaFindingPersistenceInput[],
    persistence: QaRunPersistence = {},
  ): PersistedQaFinding[] {
    const row = this.db.db.prepare('SELECT revision FROM segments WHERE id = ?').get(segmentId) as
      | { revision: number }
      | undefined
    if (row === undefined) throw new StoreNotFoundError('segment', segmentId)
    return this.replaceOpen(
      inputs,
      new Map([[String(segmentId), row.revision]]),
      persistence,
      String(segmentId),
    )
  }

  /** Deterministic project rerun. Historical CRITIC_* rows are never auto-closed. */
  replaceForProject(
    inputs: readonly QaFindingPersistenceInput[],
    segmentRevisions: ReadonlyMap<string, number>,
    persistence: QaRunPersistence = {},
  ): PersistedQaFinding[] {
    return this.replaceOpen(inputs, segmentRevisions, persistence)
  }

  /**
   * Advisory inserts do not clean other findings and never reopen a terminal
   * row. Reopen is only available through transition(..., 'open').
   */
  insertOpen(
    inputs: readonly QaFindingPersistenceInput[],
    persistence: QaRunPersistence = {},
  ): PersistedQaFinding[] {
    this.db.assertWritable('insert open qa findings')
    if (inputs.length === 0) return []
    const segmentRevisions = new Map<string, number>()
    const revisionOf = this.db.db.prepare('SELECT revision FROM segments WHERE id = ?')
    for (const input of inputs) {
      const key = String(input.segmentId)
      if (segmentRevisions.has(key)) continue
      const row = revisionOf.get(input.segmentId) as { revision: number } | undefined
      if (row === undefined) throw new StoreNotFoundError('segment', input.segmentId)
      segmentRevisions.set(key, row.revision)
    }
    return this.observe(inputs, segmentRevisions, persistence)
  }

  private replaceOpen(
    inputs: readonly QaFindingPersistenceInput[],
    segmentRevisions: ReadonlyMap<string, number>,
    persistence: QaRunPersistence,
    onlySegmentId?: string,
  ): PersistedQaFinding[] {
    return this.db.transaction('replace open qa findings', () => {
      const findings = this.observe(inputs, segmentRevisions, persistence)
      const observedIds = new Set(findings.map((finding) => finding.id as string))
      const rows = this.db.db
        .prepare(
          onlySegmentId === undefined
            ? "SELECT id FROM qa_findings WHERE status = 'open' AND substr(code, 1, 7) <> 'CRITIC_'"
            : "SELECT id FROM qa_findings WHERE segment_id = ? AND status = 'open' AND substr(code, 1, 7) <> 'CRITIC_'",
        )
        .all(...(onlySegmentId === undefined ? [] : [onlySegmentId])) as Array<{ id: string }>
      const at = persistence.observedAt ?? this.now()
      const runId = persistence.runId ?? `qa:${at}`
      for (const row of rows) {
        if (observedIds.has(row.id)) continue
        this.db.db
          .prepare("UPDATE qa_findings SET status = 'resolved' WHERE id = ? AND status = 'open'")
          .run(row.id)
        this.insertStatusEvent(row.id, 'open', 'resolved', 'system', runId, 'not observed in QA rerun', at)
      }
      return findings
    })
  }

  private observe(
    inputs: readonly QaFindingPersistenceInput[],
    segmentRevisions: ReadonlyMap<string, number>,
    persistence: QaRunPersistence,
  ): PersistedQaFinding[] {
    const at = persistence.observedAt ?? this.now()
    const runId = persistence.runId ?? `qa:${at}`
    const observed = inputs.map((input): ObservedFinding => {
      const finding = openQaFinding(input)
      const segmentRevision = segmentRevisions.get(String(finding.segmentId))
      if (segmentRevision === undefined) throw new StoreNotFoundError('segment', finding.segmentId)
      const ruleVersion =
        input.ruleVersion ??
        persistence.ruleVersion ??
        'deterministic-v1'
      const evidenceHash = digest(input.evidenceHash ?? (finding.id as string))
      const legacyFindingId = `qaf-${fnv1a64(
        `${finding.segmentId}${finding.code}${finding.message}`,
      )}`
      const legacyEvidenceHash = digest(input.evidenceHash ?? legacyFindingId)
      return {
        finding,
        segmentRevision,
        ruleVersion,
        evidenceHash,
        legacyFindingId,
        legacyEvidenceHash,
      }
    })

    const results: PersistedQaFinding[] = []
    for (const item of observed) {
      let row = this.findByIdentity(item)
      if (row === undefined) row = this.adoptLegacy(item)
      if (row === undefined) row = this.insertFinding(item, runId, at)
      if (row.status === 'open') {
        this.db.db.prepare(`
          UPDATE qa_findings
          SET severity = ?, issue_type = ?, disposition = ?, message = ?
          WHERE id = ? AND status = 'open'
        `).run(
          item.finding.severity,
          item.finding.issueType,
          item.finding.disposition,
          item.finding.message,
          row.id,
        )
      }
      this.insertOccurrence(row.id, runId, at)
      results.push(this.getById(row.id)!)
    }
    return results
  }

  private findByIdentity(item: ObservedFinding): QaFindingRow | undefined {
    return this.db.db.prepare(`
      SELECT * FROM qa_findings
      WHERE segment_id = ? AND segment_revision = ? AND code = ?
        AND rule_version = ? AND evidence_hash IN (?, ?)
      ORDER BY id LIMIT 1
    `).get(
      item.finding.segmentId,
      item.segmentRevision,
      item.finding.code,
      item.ruleVersion,
      item.evidenceHash,
      item.legacyEvidenceHash,
    ) as QaFindingRow | undefined
  }

  private adoptLegacy(item: ObservedFinding): QaFindingRow | undefined {
    const row = this.db.db.prepare(`
      SELECT * FROM qa_findings
      WHERE id = ? AND segment_id = ? AND segment_revision = ? AND rule_version = 'legacy'
    `).get(
      item.legacyFindingId,
      item.finding.segmentId,
      item.segmentRevision,
    ) as QaFindingRow | undefined
    if (row === undefined) return undefined
    this.db.db.prepare(`
      UPDATE qa_findings
      SET rule_version = ?, evidence_hash = ?
      WHERE id = ?
    `).run(item.ruleVersion, item.evidenceHash, row.id)
    return this.getRow(row.id)
  }

  private insertFinding(
    item: ObservedFinding,
    runId: string,
    at: string,
  ): QaFindingRow {
    const preferredId = item.finding.id as string
    const occupied = this.getRow(preferredId)
    const id = occupied === undefined
      ? preferredId
      : deriveStableIdV2('qaf', [
          item.finding.segmentId,
          item.segmentRevision,
          item.finding.code,
          item.ruleVersion,
          item.evidenceHash,
        ])
    this.db.db.prepare(`
      INSERT INTO qa_findings (
        id, segment_id, code, severity, issue_type, disposition, message, status,
        segment_revision, waiver_reason, waived_by, waived_at,
        rule_version, evidence_hash, first_seen_run_id, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 'open', ?, NULL, NULL, NULL, ?, ?, ?, ?)
    `).run(
      id,
      item.finding.segmentId,
      item.finding.code,
      item.finding.severity,
      item.finding.issueType,
      item.finding.disposition,
      item.finding.message,
      item.segmentRevision,
      item.ruleVersion,
      item.evidenceHash,
      runId,
      at,
    )
    this.insertStatusEvent(id, undefined, 'open', 'system', runId, 'first observed', at)
    return this.getRow(id)!
  }

  private insertOccurrence(findingId: string, runId: string, observedAt: string): void {
    this.db.db.prepare(`
      INSERT OR IGNORE INTO qa_finding_occurrences
        (occurrence_id, finding_id, qa_run_id, observed_at)
      VALUES (?, ?, ?, ?)
    `).run(
      eventId('qao', [findingId, runId]),
      findingId,
      runId,
      observedAt,
    )
  }

  private insertStatusEvent(
    findingId: string,
    from: QaFindingStatus | undefined,
    to: QaFindingStatus,
    actorType: 'system' | 'human',
    actorId: string | undefined,
    reason: string | undefined,
    createdAt: string,
  ): void {
    const sequence = this.db.db
      .prepare('SELECT COUNT(*) AS n FROM qa_finding_status_events WHERE finding_id = ?')
      .get(findingId) as { n: number }
    this.db.db.prepare(`
      INSERT INTO qa_finding_status_events
        (event_id, finding_id, from_status, to_status, actor_type, actor_id, reason, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      eventId('qse', [
        findingId,
        String(sequence.n),
        from ?? '',
        to,
        actorType,
        actorId ?? '',
        reason ?? '',
        createdAt,
      ]),
      findingId,
      from ?? null,
      to,
      actorType,
      actorId ?? null,
      reason ?? null,
      createdAt,
    )
  }

  private getRow(findingId: QaFindingId | string): QaFindingRow | undefined {
    return this.db.db.prepare('SELECT * FROM qa_findings WHERE id = ?').get(findingId) as
      | QaFindingRow
      | undefined
  }

  getById(findingId: QaFindingId | string): PersistedQaFinding | undefined {
    const row = this.getRow(findingId)
    return row === undefined ? undefined : qaFindingFromRow(row)
  }

  list(filter: QaFindingListFilter = {}): PersistedQaFinding[] {
    const { where, params } = this.where(filter)
    const rows = this.db.db
      .prepare(`SELECT * FROM qa_findings ${where} ORDER BY segment_id, code, id LIMIT ? OFFSET ?`)
      .all(...params, filter.limit ?? -1, filter.offset ?? 0) as QaFindingRow[]
    return rows.map(qaFindingFromRow)
  }

  count(filter: Omit<QaFindingListFilter, 'limit' | 'offset'> = {}): number {
    const { where, params } = this.where(filter)
    const row = this.db.db.prepare(`SELECT COUNT(*) AS n FROM qa_findings ${where}`).get(...params) as { n: number }
    return Number(row.n)
  }

  listOccurrences(findingId: QaFindingId | string): QaFindingOccurrence[] {
    const rows = this.db.db.prepare(`
      SELECT occurrence_id, finding_id, qa_run_id, observed_at
      FROM qa_finding_occurrences WHERE finding_id = ?
      ORDER BY observed_at, rowid
    `).all(findingId) as Array<{
      occurrence_id: string
      finding_id: string
      qa_run_id: string
      observed_at: string
    }>
    return rows.map((row) => ({
      occurrenceId: row.occurrence_id,
      findingId: row.finding_id,
      runId: row.qa_run_id,
      observedAt: row.observed_at,
    }))
  }

  listStatusEvents(findingId: QaFindingId | string): QaFindingStatusEvent[] {
    const rows = this.db.db.prepare(`
      SELECT event_id, finding_id, from_status, to_status, actor_type, actor_id, reason, created_at
      FROM qa_finding_status_events WHERE finding_id = ?
      ORDER BY created_at, rowid
    `).all(findingId) as Array<{
      event_id: string
      finding_id: string
      from_status: string | null
      to_status: string
      actor_type: 'system' | 'human'
      actor_id: string | null
      reason: string | null
      created_at: string
    }>
    return rows.map((row) => ({
      eventId: row.event_id,
      findingId: row.finding_id,
      ...(row.from_status === null ? {} : { fromStatus: row.from_status as QaFindingStatus }),
      toStatus: row.to_status as QaFindingStatus,
      actorType: row.actor_type,
      ...(row.actor_id === null ? {} : { actorId: row.actor_id }),
      ...(row.reason === null ? {} : { reason: row.reason }),
      createdAt: row.created_at,
    }))
  }

  countOpenByAsset(): ReadonlyMap<string, number> {
    const rows = this.db.db.prepare(`
      SELECT segments.asset_id AS asset_id, COUNT(*) AS n
      FROM qa_findings
      INNER JOIN segments ON segments.id = qa_findings.segment_id
      WHERE qa_findings.status = 'open'
      GROUP BY segments.asset_id
    `).all() as { asset_id: string; n: number }[]
    return new Map(rows.map((row) => [row.asset_id, Number(row.n)]))
  }

  transition(
    findingId: QaFindingId | string,
    to: QaFindingStatus,
    waiver?: QaWaiverEvidence,
  ): PersistedQaFinding {
    return this.db.transaction(`transition qa finding ${findingId} to ${to}`, () =>
      this.transitionWithinTransaction(findingId, to, waiver))
  }

  waiveMany(
    findingIds: readonly (QaFindingId | string)[],
    evidence: QaWaiverEvidence,
  ): PersistedQaFinding[] {
    const uniqueIds = [...new Set(findingIds)]
    if (uniqueIds.length === 0) return []
    return this.db.transaction(`waive ${uniqueIds.length} qa findings`, () =>
      uniqueIds.map((findingId) =>
        this.transitionWithinTransaction(findingId, 'waived', evidence)))
  }

  private transitionWithinTransaction(
    findingId: QaFindingId | string,
    to: QaFindingStatus,
    waiver?: QaWaiverEvidence,
  ): PersistedQaFinding {
    const finding = this.getById(findingId)
    if (finding === undefined) throw new StoreNotFoundError('qa finding', findingId)
    const updated = transitionQaFinding(finding, to)
    const reason = to === 'waived' ? waiver?.reason.trim() : undefined
    const operator = to === 'waived' ? waiver?.operator.trim() : undefined
    const at = to === 'waived' ? waiver?.at.trim() : this.now()
    if (to === 'waived' && (!reason || !operator || !at)) {
      throw new TypeError('waiver reason, operator, and timestamp are required')
    }
    this.db.db.prepare(`
      UPDATE qa_findings
      SET status = ?, waiver_reason = ?, waived_by = ?, waived_at = ?
      WHERE id = ?
    `).run(updated.status, reason ?? null, operator ?? null, to === 'waived' ? at : null, findingId)
    this.insertStatusEvent(
      finding.id as string,
      finding.status,
      updated.status,
      'human',
      operator,
      reason,
      at!,
    )
    return this.getById(findingId)!
  }

  private where(filter: Omit<QaFindingListFilter, 'limit' | 'offset'>): {
    where: string
    params: unknown[]
  } {
    const clauses: string[] = []
    const params: unknown[] = []
    if (filter.segmentId !== undefined) {
      clauses.push('segment_id = ?')
      params.push(filter.segmentId)
    }
    if (filter.code !== undefined) {
      clauses.push('code = ?')
      params.push(filter.code)
    }
    if (filter.assetId !== undefined) {
      clauses.push('segment_id IN (SELECT id FROM segments WHERE asset_id = ?)')
      params.push(filter.assetId)
    }
    if (filter.status !== undefined) {
      clauses.push('status = ?')
      params.push(filter.status)
    }
    if (filter.severity !== undefined) {
      clauses.push('severity = ?')
      params.push(filter.severity)
    }
    if (filter.disposition !== undefined) {
      clauses.push('disposition = ?')
      params.push(filter.disposition)
    }
    return {
      where: clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '',
      params,
    }
  }
}
