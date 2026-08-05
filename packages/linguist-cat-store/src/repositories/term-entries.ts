import { deriveStableIdV2 } from '@linguist/cat-core'
import type { CatDatabase } from '../database'
import { StoreNotFoundError } from '../errors'
import type { ReferenceImportResult } from './tm-units'

export type TermEntryStatus = 'allowed' | 'preferred' | 'required' | 'forbidden' | 'deprecated'

export interface TermEntry {
  id: string
  term: string
  translation: string
  status: TermEntryStatus
  caseSensitive: boolean
  note?: string
  /** PB-095：术语所属模块/分类/配图（blobs/ 相对路径），均为可空标注。 */
  module?: string
  category?: string
  imageRef?: string
}

export interface TermEntryImportInput {
  term: string
  translation: string
  status: TermEntryStatus
  caseSensitive: boolean
  note?: string
  module?: string
  category?: string
  imageRef?: string
}

export interface TermEntryUpsertInput extends TermEntryImportInput {
  id?: string
}

export interface TermEntrySearch {
  /** Case-insensitive literal substring matched against term OR translation. */
  query?: string
  status?: TermEntryStatus
  limit?: number
  offset?: number
}

export interface TermMatchOptions {
  text: string
  statuses?: readonly TermEntryStatus[]
  limit?: number
}

export interface TermMatchManyOptions extends Omit<TermMatchOptions, 'text'> {
  texts: readonly string[]
}

export type TermMatchType = 'exact' | 'contains'

export interface TermEntryMatch extends TermEntry {
  matchType: TermMatchType
  conflict: boolean
}

interface TermEntryRow {
  id: string
  project_id: string
  term: string
  translation: string
  status: TermEntryStatus
  case_sensitive: number
  note: string | null
  module: string | null
  category: string | null
  image_ref: string | null
  created_at: string
}

function stableId(projectId: string, input: TermEntryImportInput): string {
  return deriveStableIdV2('ter', [
    projectId,
    input.term,
    input.translation,
    input.status,
    input.caseSensitive,
    input.note ?? null,
  ])
}

/** Escape LIKE wildcards so query is a literal substring match. */
function likePattern(search: string): string {
  return `%${search.replace(/[\\%_]/g, (c) => `\\${c}`)}%`
}

function termEntryFromRow(row: TermEntryRow): TermEntry {
  return {
    id: row.id,
    term: row.term,
    translation: row.translation,
    status: row.status,
    caseSensitive: row.case_sensitive === 1,
    ...(row.note !== null ? { note: row.note } : {}),
    ...(row.module !== null ? { module: row.module } : {}),
    ...(row.category !== null ? { category: row.category } : {}),
    ...(row.image_ref !== null ? { imageRef: row.image_ref } : {}),
  }
}

// module/category/imageRef 是标注而非同一性的一部分：刻意不参与
// stableId 与 sameContent——UI 编辑标注后重导入同一份 CSV 仍计
// unchanged，不会因标注漂移撞 id（标注只经显式 id 的 upsert 更新）。
function sameContent(row: TermEntryRow, projectId: string, input: TermEntryImportInput): boolean {
  return row.project_id === projectId
    && row.term === input.term
    && row.translation === input.translation
    && row.status === input.status
    && row.case_sensitive === Number(input.caseSensitive)
    && row.note === (input.note ?? null)
}

function buildWhere(projectId: string, filter: TermEntrySearch): { where: string; params: unknown[] } {
  const clauses = ['project_id = ?']
  const params: unknown[] = [projectId]
  if (filter.query !== undefined) {
    clauses.push("(term LIKE ? ESCAPE '\\' OR translation LIKE ? ESCAPE '\\')")
    params.push(likePattern(filter.query), likePattern(filter.query))
  }
  if (filter.status !== undefined) {
    clauses.push('status = ?')
    params.push(filter.status)
  }
  return { where: `WHERE ${clauses.join(' AND ')}`, params }
}

function normalizeText(value: string, foldCase = true): string {
  const normalized = value.normalize('NFKC').replace(/\s+/gu, ' ').trim()
  return foldCase ? normalized.toLowerCase() : normalized
}

function containsTerm(text: string, term: string): boolean {
  if (term === '') return false
  // ponytail: CJK keeps contiguous substring matching; word-boundary tokenization
  // for every locale comes only when real samples prove the simple split wrong.
  if (/\p{Script=Han}/u.test(term)) return text.includes(term)
  const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(`(?<![\\p{L}\\p{N}_])${escaped}(?![\\p{L}\\p{N}_])`, 'u').test(text)
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0
}

export class TermEntriesRepository {
  constructor(
    private readonly db: CatDatabase,
    private readonly projectId: string,
    private readonly now: () => string = () => new Date().toISOString(),
  ) {}

  importMany(inputs: readonly TermEntryImportInput[]): ReferenceImportResult {
    return this.db.transaction('import term entries', () => {
      const find = this.db.db.prepare('SELECT * FROM term_entries WHERE id = ?')
      const insert = this.db.db.prepare(
        `INSERT INTO term_entries
         (id, project_id, term, translation, status, case_sensitive, note, module, category, image_ref, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      let imported = 0
      let unchanged = 0
      for (const input of inputs) {
        const id = stableId(this.projectId, input)
        const existing = find.get(id) as TermEntryRow | undefined
        if (existing !== undefined) {
          if (!sameContent(existing, this.projectId, input)) {
            throw new Error(`Term content id collision: ${id}`)
          }
          unchanged++
          continue
        }
        insert.run(
          id,
          this.projectId,
          input.term,
          input.translation,
          input.status,
          Number(input.caseSensitive),
          input.note ?? null,
          input.module ?? null,
          input.category ?? null,
          input.imageRef ?? null,
          this.now(),
        )
        imported++
      }
      return { imported, unchanged }
    })
  }

  get(id: string): TermEntry | undefined {
    const row = this.db.db
      .prepare('SELECT * FROM term_entries WHERE id = ? AND project_id = ?')
      .get(id, this.projectId) as TermEntryRow | undefined
    return row === undefined ? undefined : termEntryFromRow(row)
  }

  upsert(input: TermEntryUpsertInput): TermEntry {
    return this.db.transaction(`upsert term entry ${input.id ?? input.term}`, () => {
      if (input.id !== undefined) {
        const existing = this.db.db
          .prepare('SELECT id FROM term_entries WHERE id = ? AND project_id = ?')
          .get(input.id, this.projectId)
        if (existing === undefined) throw new StoreNotFoundError('term entry', input.id)
        this.db.db
          .prepare(
            `UPDATE term_entries
             SET term = ?, translation = ?, status = ?, case_sensitive = ?, note = ?,
                 module = ?, category = ?, image_ref = ?
             WHERE id = ? AND project_id = ?`,
          )
          .run(
            input.term,
            input.translation,
            input.status,
            Number(input.caseSensitive),
            input.note ?? null,
            input.module ?? null,
            input.category ?? null,
            input.imageRef ?? null,
            input.id,
            this.projectId,
          )
        return { ...input, id: input.id }
      }

      const id = stableId(this.projectId, input)
      const existing = this.db.db.prepare('SELECT * FROM term_entries WHERE id = ?').get(id) as
        | TermEntryRow
        | undefined
      if (existing !== undefined) {
        if (!sameContent(existing, this.projectId, input)) {
          throw new Error(`Term content id collision: ${id}`)
        }
        return termEntryFromRow(existing)
      }
      this.db.db
        .prepare(
          `INSERT INTO term_entries
           (id, project_id, term, translation, status, case_sensitive, note, module, category, image_ref, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          id,
          this.projectId,
          input.term,
          input.translation,
          input.status,
          Number(input.caseSensitive),
          input.note ?? null,
          input.module ?? null,
          input.category ?? null,
          input.imageRef ?? null,
          this.now(),
        )
      return { ...input, id }
    })
  }

  list(filter: TermEntrySearch = {}): TermEntry[] {
    const { where, params } = buildWhere(this.projectId, filter)
    const rows = this.db.db
      .prepare(`SELECT * FROM term_entries ${where} ORDER BY created_at, id LIMIT ? OFFSET ?`)
      .all(...params, filter.limit ?? 500, filter.offset ?? 0) as TermEntryRow[]
    return rows.map(termEntryFromRow)
  }

  /** Backward-compatible alias used by existing read tools. */
  search(filter: TermEntrySearch = {}): TermEntry[] {
    return this.list(filter)
  }

  count(filter: Omit<TermEntrySearch, 'limit' | 'offset'> = {}): number {
    const { where, params } = buildWhere(this.projectId, filter)
    const row = this.db.db
      .prepare(`SELECT COUNT(*) AS n FROM term_entries ${where}`)
      .get(...params) as { n: number }
    return Number(row.n)
  }

  delete(id: string): void {
    this.db.transaction(`delete term entry ${id}`, () => {
      const result = this.db.db
        .prepare('DELETE FROM term_entries WHERE id = ? AND project_id = ?')
        .run(id, this.projectId)
      if (Number(result.changes) === 0) throw new StoreNotFoundError('term entry', id)
    })
  }

  /**
   * preferred 一词多译冲突组（PB-096 glossary_conflict 检测）。与
   * findMatches 的 conflict 标志同一语义：同一归一化 source term 存在
   * 两个及以上不同 preferred 译法即冲突。每组返回原词（首行原样）与
   * 去重排序后的译法列表。
   */
  listPreferredConflicts(): Array<{ sourceTerm: string; translations: string[] }> {
    const rows = this.db.db
      .prepare("SELECT * FROM term_entries WHERE project_id = ? AND status = 'preferred'")
      .all(this.projectId) as TermEntryRow[]
    const groups = new Map<string, { sourceTerm: string; translations: Set<string> }>()
    for (const row of rows) {
      const key = normalizeText(row.term)
      if (key === '') continue
      const group = groups.get(key) ?? { sourceTerm: row.term, translations: new Set<string>() }
      group.translations.add(normalizeText(row.translation))
      groups.set(key, group)
    }
    return [...groups.values()]
      .filter((group) => group.translations.size > 1)
      .map((group) => ({
        sourceTerm: group.sourceTerm,
        translations: [...group.translations].sort(compareText),
      }))
      .sort((left, right) => compareText(normalizeText(left.sourceTerm), normalizeText(right.sourceTerm)))
  }

  findMatches(options: TermMatchOptions): TermEntryMatch[] {
    return this.findMatchesMany({
      texts: [options.text],
      ...(options.statuses !== undefined ? { statuses: options.statuses } : {}),
      ...(options.limit !== undefined ? { limit: options.limit } : {}),
    }).get(options.text) ?? []
  }

  findMatchesMany(options: TermMatchManyOptions): ReadonlyMap<string, TermEntryMatch[]> {
    const params: unknown[] = [this.projectId]
    let statusClause = ''
    if (options.statuses !== undefined && options.statuses.length > 0) {
      statusClause = ` AND status IN (${options.statuses.map(() => '?').join(', ')})`
      params.push(...options.statuses)
    }
    // ponytail: 术语命中按项目做 O(n) 扫描；条目量实测成为瓶颈时再加 FTS/倒排索引。
    const rows = this.db.db
      .prepare(`SELECT * FROM term_entries WHERE project_id = ?${statusClause}`)
      .all(...params) as TermEntryRow[]
    const preferredTranslations = new Map<string, Set<string>>()
    for (const row of rows) {
      if (row.status !== 'preferred') continue
      const key = normalizeText(row.term)
      const translations = preferredTranslations.get(key) ?? new Set<string>()
      translations.add(normalizeText(row.translation))
      preferredTranslations.set(key, translations)
    }

    return new Map(options.texts.map((text) => [
      text,
      this.matchRows(rows, preferredTranslations, text, options.limit ?? 20),
    ]))
  }

  private matchRows(
    rows: readonly TermEntryRow[],
    preferredTranslations: ReadonlyMap<string, ReadonlySet<string>>,
    rawText: string,
    limit: number,
  ): TermEntryMatch[] {
    const matches: TermEntryMatch[] = []
    for (const row of rows) {
      const foldCase = row.case_sensitive !== 1
      const text = normalizeText(rawText, foldCase)
      const term = normalizeText(row.term, foldCase)
      const matchType = text === term ? 'exact' : containsTerm(text, term) ? 'contains' : undefined
      if (matchType === undefined) continue
      matches.push({
        ...termEntryFromRow(row),
        matchType,
        conflict:
          row.status === 'preferred'
          && (preferredTranslations.get(normalizeText(row.term))?.size ?? 0) > 1,
      })
    }
    const statusRank: Record<TermEntryStatus, number> = {
      required: 0,
      preferred: 1,
      forbidden: 2,
      allowed: 3,
      deprecated: 4,
    }
    matches.sort((left, right) =>
      Number(left.matchType === 'contains') - Number(right.matchType === 'contains')
      || right.term.length - left.term.length
      || statusRank[left.status] - statusRank[right.status]
      || compareText(normalizeText(left.term), normalizeText(right.term))
      || compareText(normalizeText(left.translation), normalizeText(right.translation))
      || compareText(left.id, right.id),
    )
    return matches.slice(0, limit)
  }
}
