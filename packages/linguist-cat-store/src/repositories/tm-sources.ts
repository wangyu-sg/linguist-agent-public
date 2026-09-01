import { deriveStableIdV2 } from '@linguist/cat-core'
import type { CatDatabase } from '../database'
import type { ReferenceImport } from './reference-imports'

export type TmSourceKind = 'imported' | 'approved' | 'legacy'

export interface TmSource {
  id: string
  kind: TmSourceKind
  displayName: string
  enabled: boolean
  priority: number
  unitCount: number
}

interface TmSourceRow {
  id: string
  kind: TmSourceKind
  display_name: string
  enabled: number
  priority: number
  unit_count: number
}

function fromRow(row: TmSourceRow): TmSource {
  return {
    id: row.id,
    kind: row.kind,
    displayName: row.display_name,
    enabled: row.enabled === 1,
    priority: row.priority,
    unitCount: row.unit_count,
  }
}

export class TmSourcesRepository {
  constructor(
    private readonly db: CatDatabase,
    private readonly projectId: string,
    private readonly now: () => string = () => new Date().toISOString(),
  ) {}

  ensureImported(reference: ReferenceImport): TmSource {
    const id = deriveStableIdV2('tms', [this.projectId, reference.id])
    const existing = this.get(id)
    if (existing !== undefined) {
      if (existing.kind !== 'imported' || existing.displayName !== reference.originalFilename) {
        throw new Error(`TM source id collision: ${id}`)
      }
      return existing
    }
    this.db.db.prepare(`
      INSERT INTO tm_sources
        (id, project_id, kind, display_name, enabled, priority, created_at)
      VALUES (?, ?, 'imported', ?, 1, 0, ?)
    `).run(id, this.projectId, reference.originalFilename, this.now())
    return this.get(id)!
  }

  get(id: string): TmSource | undefined {
    const row = this.db.db.prepare(`
      SELECT s.id, s.kind, s.display_name, s.enabled, s.priority, COUNT(u.id) AS unit_count
      FROM tm_sources AS s
      LEFT JOIN tm_units AS u ON u.source_id = s.id
      WHERE s.id = ? AND s.project_id = ?
      GROUP BY s.id
    `).get(id, this.projectId) as TmSourceRow | undefined
    return row === undefined ? undefined : fromRow(row)
  }

  list(): TmSource[] {
    const rows = this.db.db.prepare(`
      SELECT s.id, s.kind, s.display_name, s.enabled, s.priority, COUNT(u.id) AS unit_count
      FROM tm_sources AS s
      LEFT JOIN tm_units AS u ON u.source_id = s.id
      WHERE s.project_id = ?
      GROUP BY s.id
      ORDER BY s.priority DESC, s.created_at, s.id
    `).all(this.projectId) as TmSourceRow[]
    return rows.map(fromRow)
  }

  update(id: string, patch: { enabled?: boolean; priority?: number }): TmSource {
    const result = this.db.db.prepare(
      `UPDATE tm_sources
       SET enabled = COALESCE(?, enabled), priority = COALESCE(?, priority)
       WHERE id = ? AND project_id = ?`,
    ).run(
      patch.enabled === undefined ? null : patch.enabled ? 1 : 0,
      patch.priority ?? null,
      id,
      this.projectId,
    )
    if (Number(result.changes) === 0) throw new Error(`TM source not found: ${id}`)
    return this.get(id)!
  }
}
