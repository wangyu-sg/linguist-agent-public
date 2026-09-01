import { deriveStableIdV2, tmSourceHash, type TmMatchCandidate } from '@linguist/cat-core'
import type { CatDatabase } from '../database'
import { StoreNotFoundError } from '../errors'
import type { RunHarnessRepository } from '../run-harness'

export interface TmUnit {
  id: string
  source: string
  target: string
  sourceLocale: string
  targetLocale: string
}

export interface TmStoredMatchCandidate extends TmMatchCandidate {
  originalTuid?: string
  metadata?: Record<string, string | string[]>
  sourceInline?: string
  targetInline?: string
}

export interface ApprovedExemplar {
  id: string
  source: string
  target: string
  sourceLocale: string
  targetLocale: string
  speaker: string
  textType: string
  module?: string
  assetId: string
  segmentId: string
  note?: string
  approvedAt: string
}

export interface ApprovedExemplarInput extends Omit<ApprovedExemplar, 'id' | 'approvedAt'> {}

export interface ApprovedExemplarSearch {
  speaker?: string
  textType?: string
  module?: string
  limit?: number
}

export interface TmUnitImportInput {
  source: string
  target: string
  sourceLocale: string
  targetLocale: string
  sourceId: string
  occurrenceKey: string
  originalTuid?: string
  contextKey?: string
  previousSource?: string
  nextSource?: string
  metadata?: Record<string, string | string[]>
  sourceInline?: string
  targetInline?: string
}

export interface ReferenceImportResult {
  imported: number
  unchanged: number
}

export interface TmUnitSearch {
  /** Case-insensitive literal substring matched against source OR target. */
  query?: string
  sourceLocale?: string
  targetLocale?: string
  limit?: number
  offset?: number
}

interface TmUnitRow {
  id: string
  project_id: string
  source: string
  target: string
  source_locale: string
  target_locale: string
  source_id: string | null
  source_hash: string | null
  original_tuid: string | null
  context_key: string | null
  previous_source_hash: string | null
  next_source_hash: string | null
  metadata_json: string | null
  source_inline_xml: string | null
  target_inline_xml: string | null
  source_label?: string | null
  source_priority?: number | null
}

type ApprovedExemplarMetadata = Omit<
  ApprovedExemplar,
  'id' | 'source' | 'target' | 'sourceLocale' | 'targetLocale'
>

function parseApprovedExemplar(row: TmUnitRow): ApprovedExemplar | undefined {
  if (row.metadata_json === null) return undefined
  const meta = JSON.parse(row.metadata_json) as Partial<ApprovedExemplarMetadata>
  if (
    typeof meta.speaker !== 'string'
    || typeof meta.textType !== 'string'
    || typeof meta.assetId !== 'string'
    || typeof meta.segmentId !== 'string'
    || typeof meta.approvedAt !== 'string'
  ) return undefined
  return {
    id: row.id,
    source: row.source,
    target: row.target,
    sourceLocale: row.source_locale,
    targetLocale: row.target_locale,
    speaker: meta.speaker,
    textType: meta.textType,
    ...(typeof meta.module === 'string' ? { module: meta.module } : {}),
    assetId: meta.assetId,
    segmentId: meta.segmentId,
    ...(typeof meta.note === 'string' ? { note: meta.note } : {}),
    approvedAt: meta.approvedAt,
  }
}

function stableId(projectId: string, input: TmUnitImportInput): string {
  return deriveStableIdV2('tmuo', [projectId, input.sourceId, input.occurrenceKey])
}

/** Escape LIKE wildcards so query is a literal substring match. */
function likePattern(search: string): string {
  return `%${search.replace(/[\\%_]/g, (c) => `\\${c}`)}%`
}

function tmUnitFromRow(row: TmUnitRow): TmUnit {
  return {
    id: row.id,
    source: row.source,
    target: row.target,
    sourceLocale: row.source_locale,
    targetLocale: row.target_locale,
  }
}

function tmMatchCandidateFromRow(row: TmUnitRow): TmStoredMatchCandidate {
  return {
    unitId: row.id,
    source: row.source,
    target: row.target,
    ...(row.source_label === null || row.source_label === undefined ? {} : { sourceLabel: row.source_label }),
    ...(row.source_priority === null || row.source_priority === undefined ? {} : { sourcePriority: row.source_priority }),
    ...(row.context_key === null ? {} : { contextKey: row.context_key }),
    ...(row.previous_source_hash === null ? {} : { previousSourceHash: row.previous_source_hash }),
    ...(row.next_source_hash === null ? {} : { nextSourceHash: row.next_source_hash }),
    ...(row.original_tuid === null ? {} : { originalTuid: row.original_tuid }),
    ...(row.metadata_json === null
      ? {}
      : { metadata: JSON.parse(row.metadata_json) as Record<string, string | string[]> }),
    ...(row.source_inline_xml === null
      ? {}
      : { sourceInline: row.source_inline_xml }),
    ...(row.target_inline_xml === null
      ? {}
      : { targetInline: row.target_inline_xml }),
  }
}

function sameContent(row: TmUnitRow, projectId: string, input: TmUnitImportInput): boolean {
  return row.project_id === projectId
    && row.source === input.source
    && row.target === input.target
    && row.source_locale === input.sourceLocale
    && row.target_locale === input.targetLocale
    && row.source_id === input.sourceId
    && row.source_hash === tmSourceHash(input.source, input.sourceLocale, input.targetLocale)
    && row.original_tuid === (input.originalTuid ?? null)
    && row.context_key === (input.contextKey ?? null)
    && row.previous_source_hash === (input.previousSource === undefined ? null : tmSourceHash(input.previousSource))
    && row.next_source_hash === (input.nextSource === undefined ? null : tmSourceHash(input.nextSource))
    && row.metadata_json === (input.metadata === undefined ? null : JSON.stringify(input.metadata))
    && row.source_inline_xml === (input.sourceInline ?? null)
    && row.target_inline_xml === (input.targetInline ?? null)
}

function buildWhere(projectId: string, filter: TmUnitSearch): { where: string; params: unknown[] } {
  const clauses = ['project_id = ?']
  const params: unknown[] = [projectId]
  if (filter.query !== undefined) {
    clauses.push("(source LIKE ? ESCAPE '\\' OR target LIKE ? ESCAPE '\\')")
    params.push(likePattern(filter.query), likePattern(filter.query))
  }
  if (filter.sourceLocale !== undefined) {
    clauses.push('source_locale = ?')
    params.push(filter.sourceLocale)
  }
  if (filter.targetLocale !== undefined) {
    clauses.push('target_locale = ?')
    params.push(filter.targetLocale)
  }
  return { where: `WHERE ${clauses.join(' AND ')}`, params }
}

export class TmUnitsRepository {
  constructor(
    private readonly db: CatDatabase,
    private readonly projectId: string,
    private readonly now: () => string = () => new Date().toISOString(),
    private readonly events?: RunHarnessRepository,
  ) {}

  importMany(inputs: readonly TmUnitImportInput[]): ReferenceImportResult {
    return this.db.transaction('import TM units', () => {
      const find = this.db.db.prepare('SELECT * FROM tm_units WHERE id = ?')
      const insert = this.db.db.prepare(
        `INSERT INTO tm_units
         (id, project_id, source, target, source_locale, target_locale, origin,
          source_id, source_hash, original_tuid, context_key, previous_source_hash,
          next_source_hash, metadata_json, source_inline_xml, target_inline_xml, created_at)
         VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      const ensureSource = this.db.db.prepare(`
        INSERT OR IGNORE INTO tm_sources
          (id, project_id, kind, display_name, enabled, priority, created_at)
        VALUES (?, ?, ?, ?, 1, 0, ?)
      `)
      let imported = 0
      let unchanged = 0
      for (const input of inputs) {
        const sourceId = input.sourceId
        const approved = sourceId === `approved:${this.projectId}`
        ensureSource.run(
          sourceId,
          this.projectId,
          approved ? 'approved' : 'legacy',
          approved ? 'Approved exemplars' : 'Legacy TM',
          this.now(),
        )
        const id = stableId(this.projectId, input)
        const existing = find.get(id) as TmUnitRow | undefined
        if (existing !== undefined) {
          if (!sameContent(existing, this.projectId, input)) {
            throw new Error(`TM content id collision: ${id}`)
          }
          unchanged++
          continue
        }
        insert.run(
          id,
          this.projectId,
          input.source,
          input.target,
          input.sourceLocale,
          input.targetLocale,
          sourceId,
          tmSourceHash(input.source, input.sourceLocale, input.targetLocale),
          input.originalTuid ?? null,
          input.contextKey ?? null,
          input.previousSource === undefined ? null : tmSourceHash(input.previousSource),
          input.nextSource === undefined ? null : tmSourceHash(input.nextSource),
          input.metadata === undefined ? null : JSON.stringify(input.metadata),
          input.sourceInline ?? null,
          input.targetInline ?? null,
          this.now(),
        )
        imported++
      }
      if (imported > 0) this.events?.appendProjectEvent({ kind: 'project-updated' })
      return { imported, unchanged }
    })
  }

  addApprovedExemplar(input: ApprovedExemplarInput): ApprovedExemplar {
    if (input.target.trim() === '') throw new Error('Approved exemplar target must not be empty')
    return this.db.transaction(`upsert approved exemplar ${input.segmentId}`, () => {
      const existing = this.listApprovedExemplars({
        speaker: input.speaker,
        textType: input.textType,
        limit: Number.MAX_SAFE_INTEGER,
      }).find((item) => item.segmentId === input.segmentId)
      const module = input.module ?? existing?.module
      const note = input.note ?? existing?.note
      if (existing !== undefined
        && existing.source === input.source
        && existing.target === input.target
        && existing.sourceLocale === input.sourceLocale
        && existing.targetLocale === input.targetLocale
        && existing.module === module
        && existing.assetId === input.assetId
        && existing.note === note) {
        return existing
      }
      if (existing !== undefined) {
        this.db.db.prepare('DELETE FROM tm_units WHERE id = ? AND project_id = ?')
          .run(existing.id, this.projectId)
      }
      const approvedAt = this.now()
      const metadata: ApprovedExemplarMetadata = {
        speaker: input.speaker,
        textType: input.textType,
        ...(module === undefined ? {} : { module }),
        assetId: input.assetId,
        segmentId: input.segmentId,
        ...(note === undefined ? {} : { note }),
        approvedAt,
      }
      const sourceId = `approved:${this.projectId}`
      const importInput: TmUnitImportInput = {
        source: input.source,
        target: input.target,
        sourceLocale: input.sourceLocale,
        targetLocale: input.targetLocale,
        sourceId,
        occurrenceKey: input.segmentId,
        metadata: metadata as Record<string, string | string[]>,
      }
      this.importMany([importInput])
      const id = stableId(this.projectId, importInput)
      return parseApprovedExemplar(this.db.db
        .prepare('SELECT * FROM tm_units WHERE id = ? AND project_id = ?')
        .get(id, this.projectId) as TmUnitRow)!
    })
  }

  listApprovedExemplars(filter: ApprovedExemplarSearch = {}): ApprovedExemplar[] {
    // ponytail: personal Alpha 线性扫 approved-exemplar 行；超过 10k 条时再加专用索引列。
    const rows = this.db.db
      .prepare(`SELECT * FROM tm_units
        WHERE project_id = ? AND source_id = ?
        ORDER BY created_at DESC, id DESC`)
      .all(this.projectId, `approved:${this.projectId}`) as TmUnitRow[]
    const speaker = filter.speaker?.toLocaleLowerCase()
    return rows
      .map(parseApprovedExemplar)
      .filter((item): item is ApprovedExemplar => item !== undefined)
      .filter((item) => speaker === undefined || item.speaker.toLocaleLowerCase() === speaker)
      .filter((item) => filter.textType === undefined || item.textType === filter.textType)
      .filter((item) => filter.module === undefined || item.module === filter.module)
      .slice(0, filter.limit ?? 5)
  }

  get(id: string): TmUnit | undefined {
    const row = this.db.db
      .prepare('SELECT * FROM tm_units WHERE id = ? AND project_id = ?')
      .get(id, this.projectId) as TmUnitRow | undefined
    return row === undefined ? undefined : tmUnitFromRow(row)
  }

  list(filter: TmUnitSearch = {}): TmUnit[] {
    const { where, params } = buildWhere(this.projectId, filter)
    const rows = this.db.db
      .prepare(`SELECT * FROM tm_units ${where} ORDER BY created_at, id LIMIT ? OFFSET ?`)
      .all(...params, filter.limit ?? 500, filter.offset ?? 0) as TmUnitRow[]
    return rows.map(tmUnitFromRow)
  }

  count(filter: Omit<TmUnitSearch, 'limit' | 'offset'> = {}): number {
    const { where, params } = buildWhere(this.projectId, filter)
    const row = this.db.db
      .prepare(`SELECT COUNT(*) AS n FROM tm_units ${where}`)
      .get(...params) as { n: number }
    return Number(row.n)
  }

  delete(id: string): void {
    this.db.transaction(`delete TM unit ${id}`, () => {
      const result = this.db.db
        .prepare('DELETE FROM tm_units WHERE id = ? AND project_id = ?')
        .run(id, this.projectId)
      if (Number(result.changes) === 0) throw new StoreNotFoundError('TM unit', id)
      this.events?.appendProjectEvent({ kind: 'project-updated' })
    })
  }

  /** Candidate retrieval only; scoring/classification stays in cat-core. */
  listCandidates(
    sourceLocale: string,
    targetLocale: string,
    exactSource?: string,
  ): TmStoredMatchCandidate[] {
    const exactHash = exactSource === undefined
      ? undefined
      : tmSourceHash(exactSource, sourceLocale, targetLocale)
    const rows = this.db.db.prepare(`
      SELECT u.*, s.display_name AS source_label, s.priority AS source_priority
      FROM tm_units AS u
      LEFT JOIN tm_sources AS s ON s.id = u.source_id AND s.project_id = u.project_id
      WHERE u.project_id = ? AND u.source_locale = ? AND u.target_locale = ?
        ${exactHash === undefined ? '' : 'AND u.source_hash = ?'}
        AND (s.id IS NULL OR s.enabled = 1)
      ORDER BY COALESCE(s.priority, 0) DESC, u.created_at, u.id
    `).all(
      this.projectId,
      sourceLocale,
      targetLocale,
      ...(exactHash === undefined ? [] : [exactHash]),
    ) as TmUnitRow[]
    return rows.map(tmMatchCandidateFromRow)
  }
}
