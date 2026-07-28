/**
 * Context docs repository (PB-095, schema v6): metadata rows for project
 * context documents / images. The file BYTES live under the project
 * blobs/ dir (see blobs.ts); this table only tracks metadata + the
 * optional plain-text extract. Deleting a row does not touch the blob —
 * the service layer composes blob removal (best-effort) on top.
 */

import { createHash } from 'node:crypto'
import type { CatDatabase } from '../database'
import { StoreNotFoundError } from '../errors'
import {
  contextDocFromRow,
  type ContextDoc,
  type ContextDocKind,
  type ContextDocRow,
} from './rows'

export interface ContextDocInput {
  kind: ContextDocKind
  originalFilename: string
  /** 项目目录内 blobs/ 相对路径（调用方负责先落字节）。 */
  blobRelpath: string
  sha256?: string
  note?: string
  textExtract?: string
}

export interface ContextDocSearch {
  /** Case-insensitive literal substring matched against filename OR note. */
  query?: string
  kind?: ContextDocKind
  limit?: number
  offset?: number
}

function stableId(projectId: string, input: ContextDocInput): string {
  const content = JSON.stringify([
    projectId,
    input.kind,
    input.originalFilename,
    input.sha256 ?? null,
  ])
  return `ctx-${createHash('sha256').update(content).digest('hex').slice(0, 16)}`
}

/** Escape LIKE wildcards so query is a literal substring match. */
function likePattern(search: string): string {
  return `%${search.replace(/[\\%_]/g, (c) => `\\${c}`)}%`
}

function buildWhere(projectId: string, filter: ContextDocSearch): { where: string; params: unknown[] } {
  const clauses = ['project_id = ?']
  const params: unknown[] = [projectId]
  if (filter.query !== undefined) {
    clauses.push("(original_filename LIKE ? ESCAPE '\\' OR note LIKE ? ESCAPE '\\')")
    const pattern = likePattern(filter.query)
    params.push(pattern, pattern)
  }
  if (filter.kind !== undefined) {
    clauses.push('kind = ?')
    params.push(filter.kind)
  }
  return { where: `WHERE ${clauses.join(' AND ')}`, params }
}

export class ContextDocsRepository {
  constructor(
    private readonly db: CatDatabase,
    private readonly projectId: string,
    private readonly now: () => string = () => new Date().toISOString(),
  ) {}

  /** 插入元数据行；同内容（项目+kind+文件名+sha256）重插幂等返回既有行。 */
  insert(input: ContextDocInput): ContextDoc {
    return this.db.transaction(`insert context doc ${input.originalFilename}`, () => {
      const id = stableId(this.projectId, input)
      const existing = this.db.db
        .prepare('SELECT * FROM context_docs WHERE id = ?')
        .get(id) as ContextDocRow | undefined
      if (existing !== undefined) {
        if (existing.project_id !== this.projectId || existing.blob_relpath !== input.blobRelpath) {
          throw new Error(`Context doc id collision: ${id}`)
        }
        // 旧版曾保存 DOCX 字节但不做文本抽取。用户重新导入同一文件时仅
        // 补齐缺失值；既有正文永不被解析器版本变化静默改写。
        if (existing.text_extract === null && input.textExtract !== undefined) {
          this.db.db
            .prepare('UPDATE context_docs SET text_extract = ? WHERE id = ? AND project_id = ? AND text_extract IS NULL')
            .run(input.textExtract, id, this.projectId)
          return this.get(id) as ContextDoc
        }
        return contextDocFromRow(existing)
      }
      this.db.db
        .prepare(
          `INSERT INTO context_docs
           (id, project_id, kind, original_filename, blob_relpath, sha256, note, text_extract, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          id,
          this.projectId,
          input.kind,
          input.originalFilename,
          input.blobRelpath,
          input.sha256 ?? null,
          input.note ?? null,
          input.textExtract ?? null,
          this.now(),
        )
      return this.get(id) as ContextDoc
    })
  }

  get(id: string): ContextDoc | undefined {
    const row = this.db.db
      .prepare('SELECT * FROM context_docs WHERE id = ? AND project_id = ?')
      .get(id, this.projectId) as ContextDocRow | undefined
    return row === undefined ? undefined : contextDocFromRow(row)
  }

  updateNote(id: string, note?: string): ContextDoc {
    return this.db.transaction(`update context doc note ${id}`, () => {
      const result = this.db.db
        .prepare('UPDATE context_docs SET note = ? WHERE id = ? AND project_id = ?')
        .run(note ?? null, id, this.projectId)
      if (Number(result.changes) === 0) throw new StoreNotFoundError('context doc', id)
      return this.get(id) as ContextDoc
    })
  }

  list(filter: ContextDocSearch = {}): ContextDoc[] {
    const { where, params } = buildWhere(this.projectId, filter)
    const rows = this.db.db
      .prepare(`SELECT * FROM context_docs ${where} ORDER BY created_at, id LIMIT ? OFFSET ?`)
      .all(...params, filter.limit ?? 500, filter.offset ?? 0) as ContextDocRow[]
    return rows.map(contextDocFromRow)
  }

  count(filter: Omit<ContextDocSearch, 'limit' | 'offset'> = {}): number {
    const { where, params } = buildWhere(this.projectId, filter)
    const row = this.db.db
      .prepare(`SELECT COUNT(*) AS n FROM context_docs ${where}`)
      .get(...params) as { n: number }
    return Number(row.n)
  }

  delete(id: string): void {
    this.db.transaction(`delete context doc ${id}`, () => {
      const result = this.db.db
        .prepare('DELETE FROM context_docs WHERE id = ? AND project_id = ?')
        .run(id, this.projectId)
      if (Number(result.changes) === 0) throw new StoreNotFoundError('context doc', id)
    })
  }
}
