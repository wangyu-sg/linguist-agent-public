/**
 * QA Finding persistence: atomic project reruns, filtered reads, and
 * human-only lifecycle transitions with revision/waiver evidence.
 */

import {
  openQaFinding,
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
  /** Restrict Findings to segments of one asset (used by per-asset export gates). */
  assetId?: string
  segmentId?: string
  code?: string
  status?: QaFindingStatus
  severity?: QaFinding['severity']
  /** PB-096：按处置维度筛选（UI 审核面板）。 */
  disposition?: QaFinding['disposition']
  limit?: number
  offset?: number
}

export interface QaWaiverEvidence {
  reason: string
  operator: string
  /** ISO 时间；调用层注入以便审计与测试可重复。 */
  at: string
}

export class QaFindingsRepository {
  constructor(private readonly db: CatDatabase) {}

  replaceForSegment(
    segmentId: SegmentId | string,
    inputs: readonly OpenQaFindingInput[],
  ): PersistedQaFinding[] {
    const row = this.db.db.prepare('SELECT revision FROM segments WHERE id = ?').get(segmentId) as
      | { revision: number }
      | undefined
    if (row === undefined) throw new StoreNotFoundError('segment', segmentId)
    return this.replaceOpen(inputs, new Map([[String(segmentId), row.revision]]), String(segmentId))
  }

  /**
   * Full-project rerun: replace deterministic open Findings atomically.
   * 独立复核产生的 CRITIC_* 行属于人工审查证据，不由确定性 QA 重跑清除。
   */
  replaceForProject(
    inputs: readonly OpenQaFindingInput[],
    segmentRevisions: ReadonlyMap<string, number>,
  ): PersistedQaFinding[] {
    return this.replaceOpen(inputs, segmentRevisions)
  }

  /**
   * Insert open findings WITHOUT deleting existing rows (advisory review
   * writers, PB-083). Idempotent by content-derived id: re-inserting the
   * same finding is a no-op, and a resolved/waived row with identical
   * content reopens (same convention as replaceForSegment). Does not open
   * its own transaction — callers compose atomic multi-writes (the
   * cat_submit_critic_review tool wraps artifact + findings in one
   * transaction).
   */
  insertOpen(inputs: readonly OpenQaFindingInput[]): PersistedQaFinding[] {
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
    const findings = inputs.map(openQaFinding)
    const insert = this.db.db.prepare(
      'INSERT OR REPLACE INTO qa_findings (id, segment_id, code, severity, issue_type, disposition, message, status, segment_revision, waiver_reason) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)',
    )
    for (const finding of findings) {
      insert.run(
        finding.id,
        finding.segmentId,
        finding.code,
        finding.severity,
        finding.issueType,
        finding.disposition,
        finding.message,
        finding.status,
        segmentRevisions.get(String(finding.segmentId)) ?? 0,
      )
    }
    return findings.map((finding) => ({
      ...finding,
      segmentRevision: segmentRevisions.get(String(finding.segmentId)) ?? 0,
    }))
  }

  private replaceOpen(
    inputs: readonly OpenQaFindingInput[],
    segmentRevisions: ReadonlyMap<string, number>,
    onlySegmentId?: string,
  ): PersistedQaFinding[] {
    const findings = inputs.map(openQaFinding)
    return this.db.transaction('replace open qa findings', () => {
      if (onlySegmentId === undefined) {
        this.db.db
          .prepare(
            "DELETE FROM qa_findings WHERE status = 'open' AND substr(code, 1, 7) <> 'CRITIC_'",
          )
          .run()
      } else {
        this.db.db
          .prepare(
            "DELETE FROM qa_findings WHERE segment_id = ? AND status = 'open' AND substr(code, 1, 7) <> 'CRITIC_'",
          )
          .run(onlySegmentId)
      }
      const insert = this.db.db.prepare(
        'INSERT OR REPLACE INTO qa_findings (id, segment_id, code, severity, issue_type, disposition, message, status, segment_revision, waiver_reason) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)',
      )
      for (const finding of findings) {
        insert.run(
          finding.id,
          finding.segmentId,
          finding.code,
          finding.severity,
          finding.issueType,
          finding.disposition,
          finding.message,
          finding.status,
          segmentRevisions.get(finding.segmentId) ?? 0,
        )
      }
      return findings.map((finding) => ({
        ...finding,
        segmentRevision: segmentRevisions.get(finding.segmentId) ?? 0,
      }))
    })
  }

  getById(findingId: QaFindingId | string): PersistedQaFinding | undefined {
    const row = this.db.db.prepare('SELECT * FROM qa_findings WHERE id = ?').get(findingId) as
      | QaFindingRow
      | undefined
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

  /** 每资产开放 QA 聚合；通过 segments 关联，绝不把 Finding 归到错误资产。 */
  countOpenByAsset(): ReadonlyMap<string, number> {
    const rows = this.db.db
      .prepare(`
        SELECT segments.asset_id AS asset_id, COUNT(*) AS n
        FROM qa_findings
        INNER JOIN segments ON segments.id = qa_findings.segment_id
        WHERE qa_findings.status = 'open'
        GROUP BY segments.asset_id
      `)
      .all() as { asset_id: string; n: number }[]
    return new Map(rows.map((row) => [row.asset_id, Number(row.n)]))
  }

  /** Transition status. Waive requires and persists a non-empty human reason. */
  transition(
    findingId: QaFindingId | string,
    to: QaFindingStatus,
    waiver?: QaWaiverEvidence,
  ): PersistedQaFinding {
    return this.db.transaction(`transition qa finding ${findingId} to ${to}`, () => {
      return this.transitionWithinTransaction(findingId, to, waiver)
    })
  }

  /** 同一事务批量豁免；任一 Finding 不可豁免时整批回滚。 */
  waiveMany(
    findingIds: readonly (QaFindingId | string)[],
    evidence: QaWaiverEvidence,
  ): PersistedQaFinding[] {
    const uniqueIds = [...new Set(findingIds)]
    if (uniqueIds.length === 0) return []
    return this.db.transaction(`waive ${uniqueIds.length} qa findings`, () =>
      uniqueIds.map((findingId) =>
        this.transitionWithinTransaction(findingId, 'waived', evidence)),
    )
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
    const at = to === 'waived' ? waiver?.at.trim() : undefined
    if (to === 'waived' && (!reason || !operator || !at)) {
      throw new TypeError('waiver reason, operator, and timestamp are required')
    }
    this.db.db
      .prepare(
        'UPDATE qa_findings SET status = ?, waiver_reason = ?, waived_by = ?, waived_at = ? WHERE id = ?',
      )
      .run(updated.status, reason ?? null, operator ?? null, at ?? null, findingId)
    const {
      waiverReason: _oldReason,
      waivedBy: _oldOperator,
      waivedAt: _oldTimestamp,
      ...withoutWaiver
    } = finding
    return {
      ...withoutWaiver,
      ...updated,
      ...(reason !== undefined ? { waiverReason: reason } : {}),
      ...(operator !== undefined ? { waivedBy: operator } : {}),
      ...(at !== undefined ? { waivedAt: at } : {}),
    }
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
