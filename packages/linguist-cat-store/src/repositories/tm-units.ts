import { createHash } from 'node:crypto'
import type { CatDatabase } from '../database'
import { StoreNotFoundError } from '../errors'

export interface TmUnit {
  id: string
  source: string
  target: string
  sourceLocale: string
  targetLocale: string
  origin?: string
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

function stableId(projectId: string, input: TmUnitImportInput): string {
  const content = JSON.stringify([
    projectId,
    input.source,
    input.target,
    input.sourceLocale,
    input.targetLocale,
    input.origin ?? null,
  ])
  return `tmu-${createHash('sha256').update(content).digest('hex').slice(0, 16)}`
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
    ...(row.origin !== null ? { origin: row.origin } : {}),
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
      return { imported, unchanged }
    })
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
    })
  }

  findMatches(options: TmMatchOptions): TmUnitMatch[] {
    const query = normalizeText(options.source)
    const threshold = options.threshold ?? 0.6
    const params: unknown[] = [this.projectId, options.sourceLocale]
    let targetClause = ''
    if (options.targetLocale !== undefined) {
      targetClause = ' AND target_locale = ?'
      params.push(options.targetLocale)
    }
    // ponytail: 当前按项目与 locale 做 O(n) 扫描；数据量实测成为瓶颈时再换 FTS/倒排索引。
    const rows = this.db.db
      .prepare(`SELECT * FROM tm_units WHERE project_id = ? AND source_locale = ?${targetClause}`)
      .all(...params) as TmUnitRow[]
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
    return matches.slice(0, options.limit ?? 20)
  }
}
