import {
  deriveStableIdV2,
  evaluateSegmentTermPolicy,
  type Segment,
  type SegmentTermPolicyEvaluation,
} from '@linguist/cat-core'
import type { CatDatabase } from '../database'
import { StoreNotFoundError } from '../errors'
import type { RunHarnessRepository } from '../run-harness'
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
  module?: string
  category?: string
}

export interface TermMatchManyOptions extends Omit<TermMatchOptions, 'text'> {
  texts: readonly string[]
}

export type TermMatchType = 'exact' | 'contains'

export interface TermEntryMatch extends TermEntry {
  matchType: TermMatchType
  conflict: boolean
  start: number
  end: number
  lowDiscrimination: boolean
}

export interface TermEntryConflict {
  normalizedTerm: string
  entries: TermEntry[]
}

export interface TermValidationResult {
  missingRequired: Array<{ segmentId: string; termId: string; term: string; expected: string }>
  forbiddenHits: Array<{ segmentId: string; termId: string; forbidden: string }>
  preferredNotUsed: Array<{ segmentId: string; termId: string; term: string; preferred: string }>
  unresolvedConflicts: Array<{ segmentId: string; term: string; termIds: string[] }>
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
  ])
}

function contentKey(input: Pick<TermEntryImportInput, 'term' | 'translation' | 'status' | 'caseSensitive'>): string {
  return JSON.stringify([input.term, input.translation, input.status, input.caseSensitive])
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

// note/module/category/imageRef 是标注而非同一性的一部分：刻意不参与
// stableId 与 sameContent——UI 编辑标注后重导入同一份 CSV 仍计
// unchanged，不会因标注漂移撞 id（标注只经显式 id 的 upsert 更新）。
function sameContent(row: TermEntryRow, projectId: string, input: TermEntryImportInput): boolean {
  return row.project_id === projectId
    && row.term === input.term
    && row.translation === input.translation
    && row.status === input.status
    && row.case_sensitive === Number(input.caseSensitive)
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

function termPattern(term: string): RegExp {
  const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(`(?<![\\p{L}\\p{N}_])${escaped}(?![\\p{L}\\p{N}_])`, 'gu')
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0
}

function cleanInput<T extends TermEntryImportInput>(input: T): T {
  const term = input.term.trim()
  const translation = input.translation.trim()
  if (term === '' || translation === '') throw new TypeError('term and translation must be non-empty')
  return { ...input, term, translation }
}

function bucketKey(value: string): string | undefined {
  const normalized = normalizeText(value)
  const han = normalized.match(/\p{Script=Han}/u)?.[0]
  if (han !== undefined) return `h:${han}`
  const token = normalized.match(/[\p{L}\p{N}_]+/u)?.[0]
  return token === undefined ? [...normalized][0] === undefined ? undefined : `c:${[...normalized][0]}` : `t:${token}`
}

function textBucketKeys(value: string): Set<string> {
  const normalized = normalizeText(value)
  const keys = new Set<string>()
  for (const char of normalized.match(/\p{Script=Han}/gu) ?? []) keys.add(`h:${char}`)
  for (const token of normalized.match(/[\p{L}\p{N}_]+/gu) ?? []) keys.add(`t:${token}`)
  for (const char of normalized) if (!/\s/u.test(char)) keys.add(`c:${char}`)
  return keys
}

function occurrences(text: string, term: string, wholeToken = false): Array<{ start: number; end: number }> {
  if (term === '') return []
  if (wholeToken || !/\p{Script=Han}/u.test(term)) {
    return [...text.matchAll(termPattern(term))].map((match) => ({
      start: match.index,
      end: match.index + match[0].length,
    }))
  }
  const result: Array<{ start: number; end: number }> = []
  for (let start = text.indexOf(term); start >= 0; start = text.indexOf(term, start + Math.max(1, term.length))) {
    result.push({ start, end: start + term.length })
  }
  return result
}

interface CompiledTermbase {
  rows: TermEntryRow[]
  buckets: Map<string, TermEntryRow[]>
}

interface PositionedMatch {
  row: TermEntryRow
  matchType: TermMatchType
  start: number
  end: number
  lowDiscrimination: boolean
  contextRank: number
}

export class TermEntriesRepository {
  private compiled?: CompiledTermbase

  constructor(
    private readonly db: CatDatabase,
    private readonly projectId: string,
    private readonly now: () => string = () => new Date().toISOString(),
    private readonly events?: RunHarnessRepository,
  ) {}

  importMany(inputs: readonly TermEntryImportInput[]): ReferenceImportResult {
    return this.db.transaction('import term entries', () => {
      const find = this.db.db.prepare('SELECT * FROM term_entries WHERE id = ?')
      const existingContent = new Set(
        (this.db.db.prepare('SELECT term, translation, status, case_sensitive FROM term_entries WHERE project_id = ?')
          .all(this.projectId) as Array<Pick<TermEntryRow, 'term' | 'translation' | 'status' | 'case_sensitive'>>)
          .map((row) => contentKey({
            term: row.term,
            translation: row.translation,
            status: row.status,
            caseSensitive: row.case_sensitive === 1,
          })),
      )
      const insert = this.db.db.prepare(
        `INSERT INTO term_entries
         (id, project_id, term, translation, status, case_sensitive, note, module, category, image_ref, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      let imported = 0
      let unchanged = 0
      for (const rawInput of inputs) {
        const input = cleanInput(rawInput)
        const key = contentKey(input)
        if (existingContent.has(key)) {
          unchanged++
          continue
        }
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
        existingContent.add(key)
        imported++
      }
      if (imported > 0) {
        this.compiled = undefined
        this.events?.appendProjectEvent({ kind: 'project-updated' })
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
    const cleaned = cleanInput(input)
    return this.db.transaction(`upsert term entry ${cleaned.id ?? cleaned.term}`, () => {
      if (cleaned.id !== undefined) {
        const existing = this.db.db
          .prepare('SELECT id FROM term_entries WHERE id = ? AND project_id = ?')
          .get(cleaned.id, this.projectId)
        if (existing === undefined) throw new StoreNotFoundError('term entry', cleaned.id)
        this.db.db
          .prepare(
            `UPDATE term_entries
             SET term = ?, translation = ?, status = ?, case_sensitive = ?, note = ?,
                 module = ?, category = ?, image_ref = ?
             WHERE id = ? AND project_id = ?`,
          )
          .run(
            cleaned.term,
            cleaned.translation,
            cleaned.status,
            Number(cleaned.caseSensitive),
            cleaned.note ?? null,
            cleaned.module ?? null,
            cleaned.category ?? null,
            cleaned.imageRef ?? null,
            cleaned.id,
            this.projectId,
          )
        this.compiled = undefined
        this.events?.appendProjectEvent({ kind: 'project-updated' })
        return { ...cleaned, id: cleaned.id }
      }

      const same = this.db.db.prepare(
        `SELECT * FROM term_entries
         WHERE project_id = ? AND term = ? AND translation = ? AND status = ? AND case_sensitive = ?
         LIMIT 1`,
      ).get(
        this.projectId,
        cleaned.term,
        cleaned.translation,
        cleaned.status,
        Number(cleaned.caseSensitive),
      ) as TermEntryRow | undefined
      if (same !== undefined) return termEntryFromRow(same)
      const id = stableId(this.projectId, cleaned)
      const existing = this.db.db.prepare('SELECT * FROM term_entries WHERE id = ?').get(id) as
        | TermEntryRow
        | undefined
      if (existing !== undefined) {
        if (!sameContent(existing, this.projectId, cleaned)) {
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
          cleaned.term,
          cleaned.translation,
          cleaned.status,
          Number(cleaned.caseSensitive),
          cleaned.note ?? null,
          cleaned.module ?? null,
          cleaned.category ?? null,
          cleaned.imageRef ?? null,
          this.now(),
        )
      this.compiled = undefined
      this.events?.appendProjectEvent({ kind: 'project-updated' })
      return { ...cleaned, id }
    })
  }

  list(filter: TermEntrySearch = {}): TermEntry[] {
    const { where, params } = buildWhere(this.projectId, filter)
    const rows = this.db.db
      .prepare(`SELECT * FROM term_entries ${where} ORDER BY created_at, id LIMIT ? OFFSET ?`)
      .all(...params, filter.limit ?? 500, filter.offset ?? 0) as TermEntryRow[]
    return rows.map(termEntryFromRow)
  }

  /** 现有只读工具使用的检索别名。 */
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
      this.compiled = undefined
      this.events?.appendProjectEvent({ kind: 'project-updated' })
    })
  }

  private compile(): CompiledTermbase {
    if (this.compiled !== undefined) return this.compiled
    const rows = this.db.db
      .prepare('SELECT * FROM term_entries WHERE project_id = ?')
      .all(this.projectId) as TermEntryRow[]
    const buckets = new Map<string, TermEntryRow[]>()
    for (const row of rows) {
      const key = bucketKey(row.term)
      if (key === undefined) continue
      const bucket = buckets.get(key) ?? []
      bucket.push(row)
      buckets.set(key, bucket)
    }
    this.compiled = { rows, buckets }
    return this.compiled
  }

  private applicable(
    row: TermEntryRow,
    options: Pick<TermMatchOptions, 'module' | 'category'>,
  ): boolean {
    return (options.module === undefined || row.module === null || row.module === options.module)
      && (options.category === undefined || row.category === null || row.category === options.category)
  }

  listConflicts(
    options: Pick<TermMatchOptions, 'statuses' | 'module' | 'category'> = {},
  ): TermEntryConflict[] {
    const statuses = options.statuses === undefined ? undefined : new Set(options.statuses)
    const groups = Map.groupBy(
      this.compile().rows.filter((row) =>
        (statuses === undefined || statuses.has(row.status)) && this.applicable(row, options)),
      (row) => normalizeText(row.term),
    )
    return [...groups.entries()]
      .filter(([term, rows]) => term !== '' && new Set(rows.map((row) => normalizeText(row.translation))).size > 1)
      .map(([normalizedTerm, rows]) => ({
        normalizedTerm,
        entries: rows.map(termEntryFromRow).sort((left, right) => compareText(left.id, right.id)),
      }))
      .sort((left, right) => compareText(left.normalizedTerm, right.normalizedTerm))
  }

  findMatches(options: TermMatchOptions): TermEntryMatch[] {
    return this.findMatchesMany({
      texts: [options.text],
      ...(options.statuses !== undefined ? { statuses: options.statuses } : {}),
      ...(options.limit !== undefined ? { limit: options.limit } : {}),
      ...(options.module !== undefined ? { module: options.module } : {}),
      ...(options.category !== undefined ? { category: options.category } : {}),
    }).get(options.text) ?? []
  }

  findMatchesMany(options: TermMatchManyOptions): ReadonlyMap<string, TermEntryMatch[]> {
    const compiled = this.compile()
    return new Map(options.texts.map((text) => [
      text,
      this.matchRows(compiled, text, options),
    ]))
  }

  private matchRows(
    compiled: CompiledTermbase,
    rawText: string,
    options: Omit<TermMatchOptions, 'text'>,
  ): TermEntryMatch[] {
    const statuses = options.statuses === undefined ? undefined : new Set(options.statuses)
    const rows = new Map<string, TermEntryRow>()
    for (const key of textBucketKeys(rawText)) {
      for (const row of compiled.buckets.get(key) ?? []) rows.set(row.id, row)
    }
    const positioned: PositionedMatch[] = []
    for (const row of rows.values()) {
      if ((statuses !== undefined && !statuses.has(row.status)) || !this.applicable(row, options)) continue
      const foldCase = row.case_sensitive !== 1
      const text = normalizeText(rawText, foldCase)
      const term = normalizeText(row.term, foldCase)
      const lowDiscrimination = [...term].length === 1
      const contextMatched = (row.module !== null && row.module === options.module)
        || (row.category !== null && row.category === options.category)
      const spans = text === term
        ? [{ start: 0, end: text.length }]
        : occurrences(text, term, lowDiscrimination && !contextMatched)
      for (const span of spans) positioned.push({
        row,
        matchType: text === term ? 'exact' : 'contains',
        ...span,
        lowDiscrimination,
        contextRank: contextMatched ? 0 : row.module === null && row.category === null ? 1 : 2,
      })
    }
    const statusRank: Record<TermEntryStatus, number> = {
      required: 0,
      forbidden: 1,
      preferred: 2,
      allowed: 3,
      deprecated: 4,
    }
    positioned.sort((left, right) =>
      Number(left.matchType === 'contains') - Number(right.matchType === 'contains')
      || left.contextRank - right.contextRank
      || normalizeText(right.row.term).length - normalizeText(left.row.term).length
      || statusRank[left.row.status] - statusRank[right.row.status]
      || left.start - right.start
      || compareText(normalizeText(left.row.term), normalizeText(right.row.term))
      || compareText(normalizeText(left.row.translation), normalizeText(right.row.translation))
      || compareText(left.row.id, right.row.id),
    )
    const selected: PositionedMatch[] = []
    for (const candidate of positioned) {
      const sameTermAndSpan = selected.some((match) =>
        match.start === candidate.start
        && match.end === candidate.end
        && normalizeText(match.row.term) === normalizeText(candidate.row.term))
      const overlaps = selected.some((match) =>
        candidate.start < match.end && match.start < candidate.end)
      if (overlaps && !sameTermAndSpan) continue
      selected.push(candidate)
    }
    const conflictTranslations = new Map<string, Set<string>>()
    for (const match of selected) {
      const key = normalizeText(match.row.term)
      const translations = conflictTranslations.get(key) ?? new Set<string>()
      translations.add(normalizeText(match.row.translation))
      conflictTranslations.set(key, translations)
    }
    return selected.slice(0, options.limit ?? 20).map((match) => ({
      ...termEntryFromRow(match.row),
      matchType: match.matchType,
      conflict: (conflictTranslations.get(normalizeText(match.row.term))?.size ?? 0) > 1,
      start: match.start,
      end: match.end,
      lowDiscrimination: match.lowDiscrimination,
    }))
  }

  evaluateSegment(
    segment: Segment,
    target = segment.target,
  ): SegmentTermPolicyEvaluation<TermEntryMatch> {
    const module = segment.context?.meta?.module
    const category = segment.context?.meta?.category
    return evaluateSegmentTermPolicy({
      source: segment.source,
      target,
      sourceLocale: segment.sourceLocale,
      targetLocale: segment.targetLocale,
      assetId: segment.assetId as string,
      ...(module === undefined ? {} : { module }),
      ...(category === undefined ? {} : { category }),
      segmentMetadata: segment.context?.meta ?? {},
      candidates: this.findMatches({
        text: segment.source,
        limit: Number.MAX_SAFE_INTEGER,
        ...(module === undefined ? {} : { module }),
        ...(category === undefined ? {} : { category }),
      }),
    })
  }

  validateSegments(segments: readonly Segment[]): TermValidationResult {
    const result: TermValidationResult = {
      missingRequired: [],
      forbiddenHits: [],
      preferredNotUsed: [],
      unresolvedConflicts: [],
    }
    for (const segment of segments) {
      const evaluated = this.evaluateSegment(segment).matches
      const seen = new Set<string>()
      for (const item of evaluated) {
        const match = item.match
        if (seen.has(match.id)) continue
        seen.add(match.id)
        if (match.status === 'required' && item.enforcement === 'hard' && !item.targetUsed) {
          result.missingRequired.push({
            segmentId: segment.id as string,
            termId: match.id,
            term: match.term,
            expected: match.translation,
          })
        } else if (match.status === 'forbidden' && item.enforcement === 'hard' && item.targetUsed) {
          result.forbiddenHits.push({
            segmentId: segment.id as string,
            termId: match.id,
            forbidden: match.translation,
          })
        } else if (match.status === 'preferred' && !item.targetUsed) {
          result.preferredNotUsed.push({
            segmentId: segment.id as string,
            termId: match.id,
            term: match.term,
            preferred: match.translation,
          })
        }
      }
      const conflictGroups = Map.groupBy(
        evaluated.map((item) => item.match).filter((match) => match.conflict),
        (match) => normalizeText(match.term),
      )
      for (const [term, entries] of conflictGroups) {
        result.unresolvedConflicts.push({
          segmentId: segment.id as string,
          term,
          termIds: [...new Set(entries.map((entry) => entry.id))].sort(compareText),
        })
      }
    }
    return result
  }
}
