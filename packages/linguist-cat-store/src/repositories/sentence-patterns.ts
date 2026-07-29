/**
 * Sentence patterns repository (PB-095, schema v6): reference sentence
 * patterns (源文 + 草稿/建议译文) with a confirmed/pending/rejected
 * review status. Ids are content-derived Stable ID v2 values, so CSV
 * re-imports are idempotent (same convention as TM/TB importMany).
 */

import { deriveStableIdV2 } from '@linguist/cat-core'
import type { CatDatabase } from '../database'
import { StoreNotFoundError } from '../errors'
import {
  sentencePatternFromRow,
  type SentencePattern,
  type SentencePatternRow,
  type SentencePatternStatus,
} from './rows'
import type { ReferenceImportResult } from './tm-units'

export interface SentencePatternInput {
  textType?: string
  module?: string
  source: string
  draftTarget?: string
  suggestedTarget?: string
  reviewer?: string
  /** 缺省 pending（导入/新建未评审）。 */
  status?: SentencePatternStatus
}

export interface SentencePatternUpsertInput extends SentencePatternInput {
  /** 缺省为创建；给定时只能更新该项目的现有记录。 */
  id?: string
}

export interface SentencePatternSearch {
  /** Case-insensitive literal substring matched against source OR targets. */
  query?: string
  textType?: string
  status?: SentencePatternStatus
  limit?: number
  offset?: number
}

function stableId(projectId: string, input: SentencePatternInput): string {
  return deriveStableIdV2('spn', [
    projectId,
    input.textType ?? null,
    input.module ?? null,
    input.source,
  ])
}

/** Escape LIKE wildcards so query is a literal substring match. */
function likePattern(search: string): string {
  return `%${search.replace(/[\\%_]/g, (c) => `\\${c}`)}%`
}

function buildWhere(projectId: string, filter: SentencePatternSearch): { where: string; params: unknown[] } {
  const clauses = ['project_id = ?']
  const params: unknown[] = [projectId]
  if (filter.query !== undefined) {
    clauses.push(
      "(source LIKE ? ESCAPE '\\' OR draft_target LIKE ? ESCAPE '\\' OR suggested_target LIKE ? ESCAPE '\\')",
    )
    const pattern = likePattern(filter.query)
    params.push(pattern, pattern, pattern)
  }
  if (filter.textType !== undefined) {
    clauses.push('text_type = ?')
    params.push(filter.textType)
  }
  if (filter.status !== undefined) {
    clauses.push('status = ?')
    params.push(filter.status)
  }
  return { where: `WHERE ${clauses.join(' AND ')}`, params }
}

function sameContent(row: SentencePatternRow, projectId: string, input: SentencePatternInput): boolean {
  return row.project_id === projectId
    && row.text_type === (input.textType ?? null)
    && row.module === (input.module ?? null)
    && row.source === input.source
    && row.draft_target === (input.draftTarget ?? null)
    && row.suggested_target === (input.suggestedTarget ?? null)
}

export class SentencePatternsRepository {
  constructor(
    private readonly db: CatDatabase,
    private readonly projectId: string,
    private readonly now: () => string = () => new Date().toISOString(),
  ) {}

  /** CSV 批量导入：内容派生 id，重复行计 unchanged（status 不参与同一性）。 */
  importMany(inputs: readonly SentencePatternInput[]): ReferenceImportResult {
    return this.db.transaction('import sentence patterns', () => {
      const find = this.db.db.prepare('SELECT * FROM sentence_patterns WHERE id = ?')
      const insert = this.db.db.prepare(
        `INSERT INTO sentence_patterns
         (id, project_id, text_type, module, source, draft_target, suggested_target,
          reviewer, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      let imported = 0
      let unchanged = 0
      for (const input of inputs) {
        const id = stableId(this.projectId, input)
        const existing = find.get(id) as SentencePatternRow | undefined
        if (existing !== undefined) {
          if (!sameContent(existing, this.projectId, input)) {
            throw new Error(`Sentence pattern id collision: ${id}`)
          }
          unchanged++
          continue
        }
        const timestamp = this.now()
        insert.run(
          id,
          this.projectId,
          input.textType ?? null,
          input.module ?? null,
          input.source,
          input.draftTarget ?? null,
          input.suggestedTarget ?? null,
          input.reviewer ?? null,
          input.status ?? 'pending',
          timestamp,
          timestamp,
        )
        imported++
      }
      return { imported, unchanged }
    })
  }

  upsert(input: SentencePatternUpsertInput): SentencePattern {
    return this.db.transaction(`upsert sentence pattern ${input.id ?? input.source.slice(0, 24)}`, () => {
      if (input.id !== undefined) {
        const existing = this.db.db
          .prepare('SELECT id FROM sentence_patterns WHERE id = ? AND project_id = ?')
          .get(input.id, this.projectId)
        if (existing === undefined) throw new StoreNotFoundError('sentence pattern', input.id)
        this.db.db
          .prepare(
            `UPDATE sentence_patterns
             SET text_type = ?, module = ?, source = ?, draft_target = ?, suggested_target = ?,
                 reviewer = ?, status = ?, updated_at = ?
             WHERE id = ? AND project_id = ?`,
          )
          .run(
            input.textType ?? null,
            input.module ?? null,
            input.source,
            input.draftTarget ?? null,
            input.suggestedTarget ?? null,
            input.reviewer ?? null,
            input.status ?? 'pending',
            this.now(),
            input.id,
            this.projectId,
          )
        return this.get(input.id) as SentencePattern
      }

      const id = stableId(this.projectId, input)
      const existing = this.db.db
        .prepare('SELECT * FROM sentence_patterns WHERE id = ?')
        .get(id) as SentencePatternRow | undefined
      if (existing !== undefined) {
        if (!sameContent(existing, this.projectId, input)) {
          throw new Error(`Sentence pattern id collision: ${id}`)
        }
        return sentencePatternFromRow(existing)
      }
      const timestamp = this.now()
      this.db.db
        .prepare(
          `INSERT INTO sentence_patterns
           (id, project_id, text_type, module, source, draft_target, suggested_target,
            reviewer, status, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          id,
          this.projectId,
          input.textType ?? null,
          input.module ?? null,
          input.source,
          input.draftTarget ?? null,
          input.suggestedTarget ?? null,
          input.reviewer ?? null,
          input.status ?? 'pending',
          timestamp,
          timestamp,
        )
      return this.get(id) as SentencePattern
    })
  }

  get(id: string): SentencePattern | undefined {
    const row = this.db.db
      .prepare('SELECT * FROM sentence_patterns WHERE id = ? AND project_id = ?')
      .get(id, this.projectId) as SentencePatternRow | undefined
    return row === undefined ? undefined : sentencePatternFromRow(row)
  }

  list(filter: SentencePatternSearch = {}): SentencePattern[] {
    const { where, params } = buildWhere(this.projectId, filter)
    const rows = this.db.db
      .prepare(`SELECT * FROM sentence_patterns ${where} ORDER BY created_at, id LIMIT ? OFFSET ?`)
      .all(...params, filter.limit ?? 500, filter.offset ?? 0) as SentencePatternRow[]
    return rows.map(sentencePatternFromRow)
  }

  count(filter: Omit<SentencePatternSearch, 'limit' | 'offset'> = {}): number {
    const { where, params } = buildWhere(this.projectId, filter)
    const row = this.db.db
      .prepare(`SELECT COUNT(*) AS n FROM sentence_patterns ${where}`)
      .get(...params) as { n: number }
    return Number(row.n)
  }

  delete(id: string): void {
    this.db.transaction(`delete sentence pattern ${id}`, () => {
      const result = this.db.db
        .prepare('DELETE FROM sentence_patterns WHERE id = ? AND project_id = ?')
        .run(id, this.projectId)
      if (Number(result.changes) === 0) throw new StoreNotFoundError('sentence pattern', id)
    })
  }
}
