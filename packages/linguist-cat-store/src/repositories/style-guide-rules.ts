/**
 * Style Guide rules repository (PB-095, schema v6): grouped style rules
 * with ✅/❌ example pairs. Ids are content-derived Stable ID v2 values,
 * so re-creating an identical rule is idempotent; edits go through the
 * explicit-id upsert path (same convention as term entries).
 */

import { deriveStableIdV2 } from '@linguist/cat-core'
import type { CatDatabase } from '../database'
import { StoreNotFoundError } from '../errors'
import {
  styleGuideRuleFromRow,
  type StyleGuideRule,
  type StyleGuideRuleRow,
} from './rows'

export interface StyleGuideRuleInput {
  groupKey?: string
  ruleText: string
  sourceExample?: string
  goodExample?: string
  badExample?: string
  updatedBy?: string
}

export interface StyleGuideRuleUpsertInput extends StyleGuideRuleInput {
  /** 缺省为创建；给定时只能更新该项目的现有记录。 */
  id?: string
}

export interface StyleGuideRuleSearch {
  /** Case-insensitive literal substring matched against ruleText OR examples. */
  query?: string
  groupKey?: string
  limit?: number
  offset?: number
}

function stableId(projectId: string, input: StyleGuideRuleInput): string {
  return deriveStableIdV2('sgr', [projectId, input.groupKey ?? null, input.ruleText])
}

/** Escape LIKE wildcards so query is a literal substring match. */
function likePattern(search: string): string {
  return `%${search.replace(/[\\%_]/g, (c) => `\\${c}`)}%`
}

function buildWhere(projectId: string, filter: StyleGuideRuleSearch): { where: string; params: unknown[] } {
  const clauses = ['project_id = ?']
  const params: unknown[] = [projectId]
  if (filter.query !== undefined) {
    clauses.push(
      "(rule_text LIKE ? ESCAPE '\\' OR good_example LIKE ? ESCAPE '\\' OR bad_example LIKE ? ESCAPE '\\')",
    )
    const pattern = likePattern(filter.query)
    params.push(pattern, pattern, pattern)
  }
  if (filter.groupKey !== undefined) {
    clauses.push('group_key = ?')
    params.push(filter.groupKey)
  }
  return { where: `WHERE ${clauses.join(' AND ')}`, params }
}

export class StyleGuideRulesRepository {
  constructor(
    private readonly db: CatDatabase,
    private readonly projectId: string,
    private readonly now: () => string = () => new Date().toISOString(),
  ) {}

  upsert(input: StyleGuideRuleUpsertInput): StyleGuideRule {
    return this.db.transaction(`upsert style guide rule ${input.id ?? input.ruleText.slice(0, 24)}`, () => {
      if (input.id !== undefined) {
        const existing = this.db.db
          .prepare('SELECT id FROM style_guide_rules WHERE id = ? AND project_id = ?')
          .get(input.id, this.projectId)
        if (existing === undefined) throw new StoreNotFoundError('style guide rule', input.id)
        this.db.db
          .prepare(
            `UPDATE style_guide_rules
             SET group_key = ?, rule_text = ?, source_example = ?, good_example = ?,
                 bad_example = ?, updated_at = ?, updated_by = ?
             WHERE id = ? AND project_id = ?`,
          )
          .run(
            input.groupKey ?? null,
            input.ruleText,
            input.sourceExample ?? null,
            input.goodExample ?? null,
            input.badExample ?? null,
            this.now(),
            input.updatedBy ?? null,
            input.id,
            this.projectId,
          )
        return this.get(input.id) as StyleGuideRule
      }

      const id = stableId(this.projectId, input)
      const existing = this.db.db
        .prepare('SELECT * FROM style_guide_rules WHERE id = ?')
        .get(id) as StyleGuideRuleRow | undefined
      if (existing !== undefined) {
        if (existing.project_id !== this.projectId || existing.rule_text !== input.ruleText) {
          throw new Error(`Style guide rule id collision: ${id}`)
        }
        return styleGuideRuleFromRow(existing)
      }
      this.db.db
        .prepare(
          `INSERT INTO style_guide_rules
           (id, project_id, group_key, rule_text, source_example, good_example, bad_example,
            screenshot_ref, updated_at, updated_by)
           VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)`,
        )
        .run(
          id,
          this.projectId,
          input.groupKey ?? null,
          input.ruleText,
          input.sourceExample ?? null,
          input.goodExample ?? null,
          input.badExample ?? null,
          this.now(),
          input.updatedBy ?? null,
        )
      return this.get(id) as StyleGuideRule
    })
  }

  get(id: string): StyleGuideRule | undefined {
    const row = this.db.db
      .prepare('SELECT * FROM style_guide_rules WHERE id = ? AND project_id = ?')
      .get(id, this.projectId) as StyleGuideRuleRow | undefined
    return row === undefined ? undefined : styleGuideRuleFromRow(row)
  }

  list(filter: StyleGuideRuleSearch = {}): StyleGuideRule[] {
    const { where, params } = buildWhere(this.projectId, filter)
    const rows = this.db.db
      .prepare(`SELECT * FROM style_guide_rules ${where} ORDER BY group_key, updated_at, id LIMIT ? OFFSET ?`)
      .all(...params, filter.limit ?? 500, filter.offset ?? 0) as StyleGuideRuleRow[]
    return rows.map(styleGuideRuleFromRow)
  }

  count(filter: Omit<StyleGuideRuleSearch, 'limit' | 'offset'> = {}): number {
    const { where, params } = buildWhere(this.projectId, filter)
    const row = this.db.db
      .prepare(`SELECT COUNT(*) AS n FROM style_guide_rules ${where}`)
      .get(...params) as { n: number }
    return Number(row.n)
  }

  delete(id: string): void {
    this.db.transaction(`delete style guide rule ${id}`, () => {
      const result = this.db.db
        .prepare('DELETE FROM style_guide_rules WHERE id = ? AND project_id = ?')
        .run(id, this.projectId)
      if (Number(result.changes) === 0) throw new StoreNotFoundError('style guide rule', id)
    })
  }
}
