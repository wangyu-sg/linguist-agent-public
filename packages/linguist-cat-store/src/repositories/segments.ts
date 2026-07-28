/**
 * Segments repository: paged/filtered queries, CAS target edits with
 * revision history, lock/unlock, bulk fetch.
 *
 * Every content mutation goes through cat-core's applyTargetEdit inside ONE
 * transaction: domain invariants (locked -> SegmentLockedError, stale
 * expectedRevision -> RevisionConflictError) are enforced by the domain
 * layer, never re-implemented here.
 */

import {
  applyTargetEdit,
  confirmCurrentStage as confirmCurrentStageDomain,
  unconfirmCurrentStage as unconfirmCurrentStageDomain,
  UnknownSegmentError,
  type ApplyTargetEditOptions,
  type CurrentStageState,
  type Segment,
  type SegmentId,
  type SegmentStatus,
  type TargetEditResult,
  type WorkflowStage,
  type WorkflowStageEvent,
  type WorkflowStageEventAction,
  type WorkflowStageMutationOptions,
  type WorkflowStageMutationResult,
} from '@linguist/cat-core'
import type { CatDatabase } from '../database'
import { segmentFromRow, type SegmentRow, type SegmentRevisionRow, segmentRevisionFromRow } from './rows'

export interface SegmentQuery {
  assetId?: string
  status?: SegmentStatus
  currentStageState?: CurrentStageState
  /** Case-insensitive substring matched against source OR target. */
  search?: string
  limit?: number
  offset?: number
}

interface WorkflowStageEventRow {
  stage: string
  action: string
  segment_revision: number
  actor: string | null
  created_at: string
}

/** Escape LIKE wildcards so search is a literal substring match. */
function likePattern(search: string): string {
  return `%${search.replace(/[\\%_]/g, (c) => `\\${c}`)}%`
}

/** Shared WHERE construction for query()/count() — the two must never drift. */
function buildSegmentWhere(
  filter: Pick<SegmentQuery, 'assetId' | 'status' | 'currentStageState' | 'search'>,
): { where: string; params: unknown[] } {
  const clauses: string[] = []
  const params: unknown[] = []
  if (filter.assetId !== undefined) {
    clauses.push('asset_id = ?')
    params.push(filter.assetId)
  }
  if (filter.status !== undefined) {
    clauses.push('status = ?')
    params.push(filter.status)
  }
  if (filter.currentStageState !== undefined) {
    clauses.push('current_stage_state = ?')
    params.push(filter.currentStageState)
  }
  if (filter.search !== undefined) {
    clauses.push("(source LIKE ? ESCAPE '\\' OR target LIKE ? ESCAPE '\\')")
    params.push(likePattern(filter.search), likePattern(filter.search))
  }
  return { where: clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '', params }
}

export class SegmentsRepository {
  constructor(private readonly db: CatDatabase) {}

  /** Paged query, deterministic order: asset_id, ordinal, key, id. */
  query(filter: SegmentQuery = {}): Segment[] {
    const { where, params } = buildSegmentWhere(filter)
    const limit = filter.limit ?? 500
    const offset = filter.offset ?? 0
    const rows = this.db.db
      .prepare(
        `SELECT * FROM segments ${where} ORDER BY asset_id, ordinal, key, id LIMIT ? OFFSET ?`,
      )
      .all(...params, limit, offset) as SegmentRow[]
    return rows.map(segmentFromRow)
  }

  /**
   * Cheap COUNT(*) under the same filters as query() (no row load) — lets
   * paged readers report total/hasMore without fetching every row (PB-041).
   */
  count(
    filter: Pick<SegmentQuery, 'assetId' | 'status' | 'currentStageState' | 'search'> = {},
  ): number {
    const { where, params } = buildSegmentWhere(filter)
    const row = this.db.db
      .prepare(`SELECT COUNT(*) AS n FROM segments ${where}`)
      .get(...params) as { n: number }
    return Number(row.n)
  }

  /** Filtered ID index in the same deterministic order as query(); used as stable virtual row keys. */
  queryIds(
    filter: Pick<SegmentQuery, 'assetId' | 'status' | 'currentStageState' | 'search'> = {},
  ): string[] {
    const { where, params } = buildSegmentWhere(filter)
    const rows = this.db.db
      .prepare(`SELECT id FROM segments ${where} ORDER BY asset_id, ordinal, key, id`)
      .all(...params) as { id: string }[]
    return rows.map((row) => row.id)
  }

  getById(segmentId: SegmentId | string): Segment | undefined {
    const row = this.db.db.prepare('SELECT * FROM segments WHERE id = ?').get(segmentId) as
      | SegmentRow
      | undefined
    return row === undefined ? undefined : segmentFromRow(row)
  }

  /**
   * Cheap per-status segment counts (GROUP BY, no row load) — for project
   * summaries that must stay O(count) regardless of project size (PB-031).
   * Every known status is present in the result (0 when absent).
   */
  countByStatus(): Record<SegmentStatus, number> {
    const counts: Record<SegmentStatus, number> = {
      untranslated: 0,
      draft: 0,
      translated: 0,
      reviewed: 0,
    }
    const rows = this.db.db
      .prepare('SELECT status, COUNT(*) AS n FROM segments GROUP BY status')
      .all() as { status: SegmentStatus; n: number }[]
    for (const row of rows) {
      if (row.status in counts) counts[row.status] = Number(row.n)
    }
    return counts
  }

  /** 当前任务阶段的进度聚合；与绝对 SegmentStatus 保持正交。 */
  countByCurrentStageState(): Record<CurrentStageState, number> {
    const counts: Record<CurrentStageState, number> = {
      untouched: 0,
      draft: 0,
      confirmed: 0,
    }
    const rows = this.db.db
      .prepare('SELECT current_stage_state, COUNT(*) AS n FROM segments GROUP BY current_stage_state')
      .all() as { current_stage_state: CurrentStageState; n: number }[]
    for (const row of rows) {
      if (row.current_stage_state in counts) {
        counts[row.current_stage_state] = Number(row.n)
      }
    }
    return counts
  }

  /** 每资产的状态聚合，供项目摘要一次查询生成导航进度，不加载段行。 */
  countByAssetAndStatus(): ReadonlyMap<string, Record<SegmentStatus, number>> {
    const countsByAsset = new Map<string, Record<SegmentStatus, number>>()
    const rows = this.db.db
      .prepare('SELECT asset_id, status, COUNT(*) AS n FROM segments GROUP BY asset_id, status')
      .all() as { asset_id: string; status: SegmentStatus; n: number }[]
    for (const row of rows) {
      const counts = countsByAsset.get(row.asset_id) ?? {
        untranslated: 0,
        draft: 0,
        translated: 0,
        reviewed: 0,
      }
      counts[row.status] = Number(row.n)
      countsByAsset.set(row.asset_id, counts)
    }
    return countsByAsset
  }

  /** 每资产的当前任务阶段进度聚合，供工作台导航与交付预检使用。 */
  countByAssetAndCurrentStageState(): ReadonlyMap<
    string,
    Record<CurrentStageState, number>
  > {
    const countsByAsset = new Map<string, Record<CurrentStageState, number>>()
    const rows = this.db.db
      .prepare(
        `SELECT asset_id, current_stage_state, COUNT(*) AS n
         FROM segments
         GROUP BY asset_id, current_stage_state`,
      )
      .all() as { asset_id: string; current_stage_state: CurrentStageState; n: number }[]
    for (const row of rows) {
      const counts = countsByAsset.get(row.asset_id) ?? {
        untouched: 0,
        draft: 0,
        confirmed: 0,
      }
      counts[row.current_stage_state] = Number(row.n)
      countsByAsset.set(row.asset_id, counts)
    }
    return countsByAsset
  }

  countLockedByAsset(assetId: string): number {
    const row = this.db.db
      .prepare('SELECT COUNT(*) AS n FROM segments WHERE asset_id = ? AND locked = 1')
      .get(assetId) as { n: number }
    return Number(row.n)
  }

  countUnconfirmedUnlockedByAsset(assetId: string): number {
    const row = this.db.db
      .prepare(
        `SELECT COUNT(*) AS n
         FROM segments
         WHERE asset_id = ?
           AND locked = 0
           AND COALESCE(current_stage_state, 'untouched') <> 'confirmed'`,
      )
      .get(assetId) as { n: number }
    return Number(row.n)
  }

  /** Bulk fetch; unknown ids are silently omitted (order follows input). */
  getByIds(segmentIds: readonly (SegmentId | string)[]): Segment[] {
    const found = new Map<string, Segment>()
    const stmt = this.db.db.prepare('SELECT * FROM segments WHERE id = ?')
    for (const id of segmentIds) {
      const row = stmt.get(id) as SegmentRow | undefined
      if (row) found.set(row.id, segmentFromRow(row))
    }
    const result: Segment[] = []
    for (const id of segmentIds) {
      const segment = found.get(id)
      if (segment) result.push(segment)
    }
    return result
  }

  /**
   * CAS target edit in ONE transaction: read segment, run cat-core
   * applyTargetEdit (locked/conflict checks), update the row, append the
   * segment_revisions entry. Throws UnknownSegmentError,
   * SegmentLockedError, RevisionConflictError — never overwrites.
   */
  applyTargetEdit(
    segmentId: SegmentId | string,
    newTarget: string,
    expectedRevision: number,
    options: ApplyTargetEditOptions = {},
  ): TargetEditResult {
    return this.db.transaction(`edit segment ${segmentId}`, () => {
      const segment = this.getById(segmentId)
      if (!segment) throw new UnknownSegmentError(segmentId)
      const result = applyTargetEdit(segment, newTarget, expectedRevision, options)
      this.db.db
        .prepare('UPDATE segments SET target = ?, status = ?, current_stage_state = ?, revision = ? WHERE id = ?')
        .run(
          result.segment.target,
          result.segment.status,
          result.segment.currentStageState,
          result.segment.revision,
          segmentId,
        )
      this.insertRevision(segmentId, result.revision)
      return result
    })
  }

  /** CAS 确认当前项目阶段；目标内容 revision 不变，确认写入独立审计流。 */
  confirmCurrentStage(
    segmentId: SegmentId | string,
    stage: WorkflowStage,
    expectedRevision: number,
    options: WorkflowStageMutationOptions = {},
  ): WorkflowStageMutationResult {
    return this.mutateCurrentStage(
      segmentId,
      stage,
      expectedRevision,
      options,
      confirmCurrentStageDomain,
    )
  }

  /** CAS 撤销本轮确认，保留目标文本与完整审计历史。 */
  unconfirmCurrentStage(
    segmentId: SegmentId | string,
    stage: WorkflowStage,
    expectedRevision: number,
    options: WorkflowStageMutationOptions = {},
  ): WorkflowStageMutationResult {
    return this.mutateCurrentStage(
      segmentId,
      stage,
      expectedRevision,
      options,
      unconfirmCurrentStageDomain,
    )
  }

  listStageEvents(segmentId: SegmentId | string): WorkflowStageEvent[] {
    const rows = this.db.db
      .prepare(
        `SELECT stage, action, segment_revision, actor, created_at
         FROM segment_stage_events
         WHERE segment_id = ?
         ORDER BY event_id`,
      )
      .all(segmentId) as WorkflowStageEventRow[]
    return rows.map((row) => ({
      stage: row.stage as WorkflowStage,
      action: row.action as WorkflowStageEventAction,
      segmentRevision: row.segment_revision,
      ...(row.actor !== null ? { actor: row.actor } : {}),
      createdAt: row.created_at,
    }))
  }

  /**
   * 切换项目阶段时重建本轮状态：只有该阶段最后一次事件仍是当前目标 revision
   * 的确认才算 confirmed；撤销为 draft，无记录或旧 revision 为 untouched。
   */
  rebaseCurrentStage(stage: WorkflowStage): void {
    this.db.transaction(`rebase current stage to ${stage}`, () => {
      this.db.db.prepare(
        `UPDATE segments
         SET current_stage_state = COALESCE((
           SELECT CASE
             WHEN event.action = 'confirmed'
               AND event.segment_revision = segments.revision THEN 'confirmed'
             WHEN event.action = 'unconfirmed'
               AND event.segment_revision = segments.revision THEN 'draft'
             ELSE 'untouched'
           END
           FROM segment_stage_events AS event
           WHERE event.segment_id = segments.id AND event.stage = ?
           ORDER BY event.event_id DESC
           LIMIT 1
         ), 'untouched')`,
      ).run(stage)
    })
  }

  /** Lock/unlock (metadata-only; revision unchanged). */
  setLocked(segmentId: SegmentId | string, locked: boolean): Segment {
    return this.db.transaction(`set locked on segment ${segmentId}`, () => {
      const segment = this.getById(segmentId)
      if (!segment) throw new UnknownSegmentError(segmentId)
      this.db.db.prepare('UPDATE segments SET locked = ? WHERE id = ?').run(locked ? 1 : 0, segmentId)
      return { ...segment, locked }
    })
  }

  /** Append-only revision history for a segment, ascending. */
  listRevisions(segmentId: SegmentId | string) {
    const rows = this.db.db
      .prepare('SELECT * FROM segment_revisions WHERE segment_id = ? ORDER BY revision')
      .all(segmentId) as SegmentRevisionRow[]
    return rows.map(segmentRevisionFromRow)
  }

  private insertRevision(
    segmentId: SegmentId | string,
    revision: { revision: number; target: string; status: string; source: string; createdAt: string },
  ): void {
    this.db.db
      .prepare(
        'INSERT INTO segment_revisions (segment_id, revision, target, status, source, created_at) VALUES (?, ?, ?, ?, ?, ?)',
      )
      .run(segmentId, revision.revision, revision.target, revision.status, revision.source, revision.createdAt)
  }

  private mutateCurrentStage(
    segmentId: SegmentId | string,
    stage: WorkflowStage,
    expectedRevision: number,
    options: WorkflowStageMutationOptions,
    mutate: (
      segment: Segment,
      stage: WorkflowStage,
      expectedRevision: number,
      options: WorkflowStageMutationOptions,
    ) => WorkflowStageMutationResult,
  ): WorkflowStageMutationResult {
    return this.db.transaction(`mutate ${stage} stage on segment ${segmentId}`, () => {
      const segment = this.getById(segmentId)
      if (!segment) throw new UnknownSegmentError(segmentId)
      const result = mutate(segment, stage, expectedRevision, options)
      this.db.db
        .prepare('UPDATE segments SET current_stage_state = ? WHERE id = ?')
        .run(result.segment.currentStageState, segmentId)
      this.db.db
        .prepare(
          `INSERT INTO segment_stage_events
           (segment_id, stage, action, segment_revision, actor, created_at)
           VALUES (?, ?, ?, ?, ?, ?)`,
        )
        .run(
          segmentId,
          result.event.stage,
          result.event.action,
          result.event.segmentRevision,
          result.event.actor ?? null,
          result.event.createdAt,
        )
      return result
    })
  }
}
