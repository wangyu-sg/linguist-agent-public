import { deriveStableIdV2 } from '@linguist/cat-core'
import type { CatDatabase } from '../database'
import { StoreNotFoundError } from '../errors'
import type { RunHarnessRepository } from '../run-harness'

export interface TmUnit {
  id: string
  source: string
  target: string
  sourceLocale: string
  targetLocale: string
  origin?: string
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
  origin?: string
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

export interface TmMatchOptions {
  source: string
  sourceLocale: string
  targetLocale?: string
  threshold?: number
  limit?: number
}

export interface TmMatchManyOptions extends Omit<TmMatchOptions, 'source'> {
  sources: readonly string[]
}

export type TmMatchType = 'exact' | 'contains' | 'fuzzy'

export interface TmUnitMatch extends TmUnit {
  score: number
  matchType: TmMatchType
}

interface TmUnitRow {
  id: string
  project_id: string
  source: string
  target: string
  source_locale: string
  target_locale: string
  origin: string | null
  created_at: string
}

const APPROVED_EXEMPLAR_ORIGIN_PREFIX = 'approved-exemplar:'

type ApprovedExemplarMetadata = Omit<
  ApprovedExemplar,
  'id' | 'source' | 'target' | 'sourceLocale' | 'targetLocale'
>

function parseApprovedExemplar(row: TmUnitRow): ApprovedExemplar | undefined {
  if (!row.origin?.startsWith(APPROVED_EXEMPLAR_ORIGIN_PREFIX)) return undefined
  try {
    const meta = JSON.parse(row.origin.slice(APPROVED_EXEMPLAR_ORIGIN_PREFIX.length)) as Partial<ApprovedExemplarMetadata>
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
  } catch {
    return undefined
  }
}

function stableId(projectId: string, input: TmUnitImportInput): string {
  return deriveStableIdV2('tmu', [
    projectId,
    input.source,
    input.target,
    input.sourceLocale,
    input.targetLocale,
    input.origin ?? null,
  ])
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
    ...(row.origin !== null
      ? { origin: row.origin.startsWith(APPROVED_EXEMPLAR_ORIGIN_PREFIX) ? 'approved-exemplar' : row.origin }
      : {}),
  }
}

function sameContent(row: TmUnitRow, projectId: string, input: TmUnitImportInput): boolean {
  return row.project_id === projectId
    && row.source === input.source
    && row.target === input.target
    && row.source_locale === input.sourceLocale
    && row.target_locale === input.targetLocale
    && row.origin === (input.origin ?? null)
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

function normalizeText(value: string): string {
  return value.normalize('NFKC').replace(/\s+/gu, ' ').trim().toLowerCase()
}

function bigrams(value: string): string[] {
  const characters = Array.from(value)
  const result: string[] = []
  for (let index = 0; index + 1 < characters.length; index++) {
    result.push(characters[index]! + characters[index + 1]!)
  }
  return result
}

function dice(left: string, right: string): number {
  const leftBigrams = bigrams(left)
  const rightBigrams = bigrams(right)
  if (leftBigrams.length === 0 || rightBigrams.length === 0) return 0
  const counts = new Map<string, number>()
  for (const item of leftBigrams) counts.set(item, (counts.get(item) ?? 0) + 1)
  let overlap = 0
  for (const item of rightBigrams) {
    const remaining = counts.get(item) ?? 0
    if (remaining > 0) {
      overlap++
      counts.set(item, remaining - 1)
    }
  }
  return (2 * overlap) / (leftBigrams.length + rightBigrams.length)
}

function tokenJaccard(left: string, right: string): number {
  const leftTokens = new Set(left.split(' ').filter(Boolean))
  const rightTokens = new Set(right.split(' ').filter(Boolean))
  const union = new Set([...leftTokens, ...rightTokens])
  if (union.size === 0) return 0
  let intersection = 0
  for (const token of leftTokens) {
    if (rightTokens.has(token)) intersection++
  }
  return intersection / union.size
}

function lengthRatio(left: string, right: string): number {
  const leftLength = Array.from(left).length
  const rightLength = Array.from(right).length
  return Math.min(leftLength, rightLength) / Math.max(leftLength, rightLength)
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0
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
         (id, project_id, source, target, source_locale, target_locale, origin, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      let imported = 0
      let unchanged = 0
      for (const input of inputs) {
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
          input.origin ?? null,
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
    const existing = this.listApprovedExemplars({
      speaker: input.speaker,
      textType: input.textType,
      limit: Number.MAX_SAFE_INTEGER,
    }).find((item) => item.segmentId === input.segmentId)
    if (existing) return existing
    const approvedAt = this.now()
    const metadata: ApprovedExemplarMetadata = {
      speaker: input.speaker,
      textType: input.textType,
      ...(input.module === undefined ? {} : { module: input.module }),
      assetId: input.assetId,
      segmentId: input.segmentId,
      ...(input.note === undefined ? {} : { note: input.note }),
      approvedAt,
    }
    const origin = `${APPROVED_EXEMPLAR_ORIGIN_PREFIX}${JSON.stringify(metadata)}`
    this.importMany([{
      source: input.source,
      target: input.target,
      sourceLocale: input.sourceLocale,
      targetLocale: input.targetLocale,
      origin,
    }])
    const id = stableId(this.projectId, {
      source: input.source,
      target: input.target,
      sourceLocale: input.sourceLocale,
      targetLocale: input.targetLocale,
      origin,
    })
    return parseApprovedExemplar(this.db.db
      .prepare('SELECT * FROM tm_units WHERE id = ? AND project_id = ?')
      .get(id, this.projectId) as TmUnitRow)!
  }

  listApprovedExemplars(filter: ApprovedExemplarSearch = {}): ApprovedExemplar[] {
    // ponytail: personal Alpha 线性扫 approved-exemplar 行；超过 10k 条时再加专用索引列。
    const rows = this.db.db
      .prepare(`SELECT * FROM tm_units WHERE project_id = ? AND origin LIKE ? ORDER BY created_at DESC, id DESC`)
      .all(this.projectId, `${APPROVED_EXEMPLAR_ORIGIN_PREFIX}%`) as TmUnitRow[]
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

  /** Backward-compatible alias used by existing read tools. */
  search(filter: TmUnitSearch = {}): TmUnit[] {
    return this.list(filter)
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

  findMatches(options: TmMatchOptions): TmUnitMatch[] {
    return this.matchRows(
      this.matchRowsForLocales(options.sourceLocale, options.targetLocale),
      options.source,
      options.threshold ?? 0.6,
      options.limit ?? 20,
    )
  }

  findMatchesMany(options: TmMatchManyOptions): ReadonlyMap<string, TmUnitMatch[]> {
    const rows = this.matchRowsForLocales(options.sourceLocale, options.targetLocale)
    return new Map(options.sources.map((source) => [
      source,
      this.matchRows(rows, source, options.threshold ?? 0.6, options.limit ?? 20),
    ]))
  }

  private matchRowsForLocales(
    sourceLocale: string,
    targetLocale?: string,
  ): TmUnitRow[] {
    const params: unknown[] = [this.projectId, sourceLocale]
    let targetClause = ''
    if (targetLocale !== undefined) {
      targetClause = ' AND target_locale = ?'
      params.push(targetLocale)
    }
    // ponytail: 当前按项目与 locale 做 O(n) 扫描；数据量实测成为瓶颈时再换 FTS/倒排索引。
    return this.db.db
      .prepare(`SELECT * FROM tm_units WHERE project_id = ? AND source_locale = ?${targetClause}`)
      .all(...params) as TmUnitRow[]
  }

  private matchRows(
    rows: readonly TmUnitRow[],
    source: string,
    threshold: number,
    limit: number,
  ): TmUnitMatch[] {
    const query = normalizeText(source)
    const matches: TmUnitMatch[] = []
    for (const row of rows) {
      const candidate = normalizeText(row.source)
      let matchType: TmMatchType
      let score: number
      if (candidate === query) {
        matchType = 'exact'
        score = 1
      } else if (candidate.includes(query) || query.includes(candidate)) {
        matchType = 'contains'
        score = Math.max(0.72, lengthRatio(query, candidate))
      } else {
        score = Math.max(dice(query, candidate), tokenJaccard(query, candidate))
        matchType = 'fuzzy'
      }
      if (score >= threshold) matches.push({ ...tmUnitFromRow(row), score, matchType })
    }
    const rank: Record<TmMatchType, number> = { exact: 0, contains: 1, fuzzy: 2 }
    matches.sort((left, right) =>
      right.score - left.score
      || rank[left.matchType] - rank[right.matchType]
      || compareText(normalizeText(left.source), normalizeText(right.source))
      || compareText(normalizeText(left.target), normalizeText(right.target))
      || compareText(left.id, right.id),
    )
    return matches.slice(0, limit)
  }
}
