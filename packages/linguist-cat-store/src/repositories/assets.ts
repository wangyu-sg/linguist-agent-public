/**
 * Assets repository: insert imported assets (asset row + all segment rows
 * in ONE transaction), list by project, get by id.
 */

import {
  createAsset,
  type Asset,
  type AssetId,
  type ProjectId,
  type Segment,
} from '@linguist/cat-core'
import { bindImportedSegments, type ImportedCatAsset } from '@linguist/cat-formats'
import type { CatDatabase } from '../database'
import { assetFromRow, segmentToParams, type AssetRow } from './rows'

export interface InsertImportedResult {
  asset: Asset
  segments: Segment[]
}

export class AssetsRepository {
  constructor(
    private readonly db: CatDatabase,
    private readonly projectId: ProjectId,
    private readonly now: () => string,
  ) {}

  /**
   * Insert an ImportedCatAsset (cat-formats import output): creates the
   * Asset (content-derived id), binds segments (content-derived ids), and
   * writes the asset row + every segment row in ONE transaction. Any
   * failure rolls everything back — a project never ends up with half an
   * asset.
   */
  insertImported(imported: ImportedCatAsset): InsertImportedResult {
    const asset = createAsset({
      projectId: this.projectId,
      formatId: imported.asset.formatId,
      originalFilename: imported.asset.originalFilename,
      sourceSha256: imported.asset.sourceSha256,
      segmentCount: imported.asset.segmentCount,
      ...(imported.asset.formatConfigJson === undefined
        ? {}
        : { formatConfigJson: imported.asset.formatConfigJson }),
    })
    const segments = bindImportedSegments(imported.segments, asset.id)
    this.insert(asset, segments)
    return { asset, segments }
  }

  /** Insert an already-bound asset + segments in ONE transaction. */
  insert(asset: Asset, segments: readonly Segment[]): void {
    this.db.transaction(`insert asset ${asset.id}`, () => {
      this.db
        .db
        .prepare(
          'INSERT INTO assets (id, project_id, format_id, original_filename, source_sha256, segment_count, format_config_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        )
        .run(
          asset.id,
          asset.projectId,
          asset.formatId,
          asset.originalFilename,
          asset.sourceSha256,
          asset.segmentCount,
          asset.formatConfigJson ?? null,
          this.now(),
        )
      const insertSegment = this.db.db.prepare(
        `INSERT INTO segments (id, asset_id, ordinal, key, source, target, source_locale, target_locale, status, locked, revision, source_hash, context_json, current_stage_state, imported_native_status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      for (const segment of segments) {
        insertSegment.run(...segmentToParams(segment))
      }
    })
  }

  listByProject(): Asset[] {
    const rows = this.db.db
      .prepare('SELECT * FROM assets WHERE project_id = ? ORDER BY created_at, id')
      .all(this.projectId) as AssetRow[]
    return rows.map(assetFromRow)
  }

  /**
   * Cheap asset count for the project (COUNT(*), no row load) — for project
   * summaries that must stay O(count) regardless of project size (PB-031).
   */
  countByProject(): number {
    const row = this.db.db
      .prepare('SELECT COUNT(*) AS n FROM assets WHERE project_id = ?')
      .get(this.projectId) as { n: number }
    return Number(row.n)
  }

  get(assetId: AssetId | string): Asset | undefined {
    const row = this.db.db.prepare('SELECT * FROM assets WHERE id = ?').get(assetId) as
      | AssetRow
      | undefined
    return row === undefined ? undefined : assetFromRow(row)
  }

  /**
   * LA-INTAKE-007 撤销导入专用级联删除：asset 行 + 全部 segment 行 +
   * 每段 segment_revisions / segment_stage_events，单事务，失败整体回滚。
   * proposals/qa_findings 对 segments 有 ON DELETE CASCADE 兜底，但正常
   * 路径走不到——服务层先查下游引用，有引用即拒绝删除。显式逐表删除
   * 而不是依赖 FK 级联，保证删除集在代码里可读可审。
   */
  deleteWithSegments(assetId: AssetId | string): void {
    this.db.transaction(`delete asset ${assetId} with segments`, () => {
      this.db.db
        .prepare(
          `DELETE FROM segment_revisions
           WHERE segment_id IN (SELECT id FROM segments WHERE asset_id = ?)`,
        )
        .run(assetId)
      this.db.db
        .prepare(
          `DELETE FROM segment_stage_events
           WHERE segment_id IN (SELECT id FROM segments WHERE asset_id = ?)`,
        )
        .run(assetId)
      this.db.db.prepare('DELETE FROM segments WHERE asset_id = ?').run(assetId)
      this.db.db.prepare('DELETE FROM assets WHERE id = ?').run(assetId)
    })
  }
}
