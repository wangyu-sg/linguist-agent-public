/**
 * Tech constraints repository (PB-095, schema v6): length / rich_text /
 * tag_note constraints with an optional scope (text_type 或资产级；可空
 * = 全局). value_json is stored verbatim (IPC 层已校验其为合法 JSON)；
 * QA 消费归 PB-097，本层只做存取。
 */

import { createHash } from 'node:crypto'
import type { CatDatabase } from '../database'
import { StoreNotFoundError } from '../errors'
import {
  techConstraintFromRow,
  type TechConstraint,
  type TechConstraintKind,
  type TechConstraintRow,
} from './rows'

export interface TechConstraintInput {
  kind: TechConstraintKind
  scope?: string
  valueJson: string
  note?: string
}

export interface TechConstraintUpsertInput extends TechConstraintInput {
  /** 缺省为创建；给定时只能更新该项目的现有记录。 */
  id?: string
}

export interface TechConstraintSearch {
  kind?: TechConstraintKind
  scope?: string
  limit?: number
  offset?: number
}

function stableId(projectId: string, input: TechConstraintInput): string {
  const content = JSON.stringify([projectId, input.kind, input.scope ?? null, input.valueJson])
  return `tcn-${createHash('sha256').update(content).digest('hex').slice(0, 16)}`
}

function buildWhere(projectId: string, filter: TechConstraintSearch): { where: string; params: unknown[] } {
  const clauses = ['project_id = ?']
  const params: unknown[] = [projectId]
  if (filter.kind !== undefined) {
    clauses.push('kind = ?')
    params.push(filter.kind)
  }
  if (filter.scope !== undefined) {
    clauses.push('scope = ?')
    params.push(filter.scope)
  }
  return { where: `WHERE ${clauses.join(' AND ')}`, params }
}

export class TechConstraintsRepository {
  constructor(
    private readonly db: CatDatabase,
    private readonly projectId: string,
    private readonly now: () => string = () => new Date().toISOString(),
  ) {}

  upsert(input: TechConstraintUpsertInput): TechConstraint {
    return this.db.transaction(`upsert tech constraint ${input.id ?? input.kind}`, () => {
      if (input.id !== undefined) {
        const existing = this.db.db
          .prepare('SELECT id FROM tech_constraints WHERE id = ? AND project_id = ?')
          .get(input.id, this.projectId)
        if (existing === undefined) throw new StoreNotFoundError('tech constraint', input.id)
        this.db.db
          .prepare(
            `UPDATE tech_constraints
             SET kind = ?, scope = ?, value_json = ?, note = ?, updated_at = ?
             WHERE id = ? AND project_id = ?`,
          )
          .run(input.kind, input.scope ?? null, input.valueJson, input.note ?? null, this.now(), input.id, this.projectId)
        return this.get(input.id) as TechConstraint
      }

      const id = stableId(this.projectId, input)
      const existing = this.db.db
        .prepare('SELECT * FROM tech_constraints WHERE id = ?')
        .get(id) as TechConstraintRow | undefined
      if (existing !== undefined) {
        if (existing.project_id !== this.projectId) {
          throw new Error(`Tech constraint id collision: ${id}`)
        }
        return techConstraintFromRow(existing)
      }
      this.db.db
        .prepare(
          `INSERT INTO tech_constraints
           (id, project_id, kind, scope, value_json, note, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(id, this.projectId, input.kind, input.scope ?? null, input.valueJson, input.note ?? null, this.now())
      return this.get(id) as TechConstraint
    })
  }

  get(id: string): TechConstraint | undefined {
    const row = this.db.db
      .prepare('SELECT * FROM tech_constraints WHERE id = ? AND project_id = ?')
      .get(id, this.projectId) as TechConstraintRow | undefined
    return row === undefined ? undefined : techConstraintFromRow(row)
  }

  list(filter: TechConstraintSearch = {}): TechConstraint[] {
    const { where, params } = buildWhere(this.projectId, filter)
    const rows = this.db.db
      .prepare(`SELECT * FROM tech_constraints ${where} ORDER BY kind, scope, updated_at, id LIMIT ? OFFSET ?`)
      .all(...params, filter.limit ?? 500, filter.offset ?? 0) as TechConstraintRow[]
    return rows.map(techConstraintFromRow)
  }

  count(filter: Omit<TechConstraintSearch, 'limit' | 'offset'> = {}): number {
    const { where, params } = buildWhere(this.projectId, filter)
    const row = this.db.db
      .prepare(`SELECT COUNT(*) AS n FROM tech_constraints ${where}`)
      .get(...params) as { n: number }
    return Number(row.n)
  }

  delete(id: string): void {
    this.db.transaction(`delete tech constraint ${id}`, () => {
      const result = this.db.db
        .prepare('DELETE FROM tech_constraints WHERE id = ? AND project_id = ?')
        .run(id, this.projectId)
      if (Number(result.changes) === 0) throw new StoreNotFoundError('tech constraint', id)
    })
  }
}
