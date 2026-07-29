/**
 * Exports repository: records export artifact metadata (id, assetId, path
 * relative to the project dir, sha256, segmentCount, createdAt). The
 * export bytes themselves are written by the format adapters / delivery
 * layer (later tickets); this table is the audit trail.
 */

import { deriveStableIdV2, type ProjectId } from '@linguist/cat-core'
import type { CatDatabase } from '../database'

export interface ExportRecord {
  /** Content-derived id of the first record for this asset digest. */
  id: string
  projectId: ProjectId
  assetId: string
  /** Path relative to the project dir (e.g. exports/en.json). */
  path: string
  sha256: string
  segmentCount: number
  createdAt: string
}

export interface RecordExportInput {
  assetId: string
  path: string
  sha256: string
  segmentCount: number
  /** ISO timestamp; inject for determinism. */
  now?: string
}

interface ExportRow {
  id: string
  project_id: string
  asset_id: string
  path: string
  sha256: string
  segment_count: number
  created_at: string
}

function exportFromRow(row: ExportRow): ExportRecord {
  return {
    id: row.id,
    projectId: row.project_id as ProjectId,
    assetId: row.asset_id,
    path: row.path,
    sha256: row.sha256,
    segmentCount: row.segment_count,
    createdAt: row.created_at,
  }
}

export class ExportsRepository {
  constructor(
    private readonly db: CatDatabase,
    private readonly projectId: ProjectId,
    private readonly now: () => string,
  ) {}

  record(input: RecordExportInput): ExportRecord {
    return this.db.transaction(`record export ${input.assetId}`, () => {
      const existing = this.db.db
        .prepare(
          `SELECT * FROM exports
           WHERE project_id = ? AND asset_id = ? AND sha256 = ? AND segment_count = ?
           ORDER BY created_at, id LIMIT 1`,
        )
        .get(
          this.projectId,
          input.assetId,
          input.sha256,
          input.segmentCount,
        ) as ExportRow | undefined
      if (existing !== undefined) return exportFromRow(existing)

      const createdAt = input.now ?? this.now()
      const record: ExportRecord = {
        id: deriveStableIdV2('exp', [input.assetId, input.sha256, createdAt]),
        projectId: this.projectId,
        assetId: input.assetId,
        path: input.path,
        sha256: input.sha256,
        segmentCount: input.segmentCount,
        createdAt,
      }
      this.db.db
        .prepare(
          'INSERT INTO exports (id, project_id, asset_id, path, sha256, segment_count, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
        )
        .run(record.id, record.projectId, record.assetId, record.path, record.sha256, record.segmentCount, record.createdAt)
      return record
    })
  }

  listByAsset(assetId: string): ExportRecord[] {
    const rows = this.db.db
      .prepare('SELECT * FROM exports WHERE asset_id = ? ORDER BY created_at, id')
      .all(assetId) as ExportRow[]
    return rows.map(exportFromRow)
  }

  listByProject(): ExportRecord[] {
    const rows = this.db.db
      .prepare('SELECT * FROM exports WHERE project_id = ? ORDER BY created_at, id')
      .all(this.projectId) as ExportRow[]
    return rows.map(exportFromRow)
  }
}
