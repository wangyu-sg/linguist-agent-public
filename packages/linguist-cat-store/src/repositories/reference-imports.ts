/**
 * 原始 TM/TB 文件的导入来源。
 *
 * 解析出的行仍分别落入 tm_units / term_entries；这里每个导入文件只保留一
 * 条 provenance 和一个受管 blob，供用户复核原件，不把同一份 bytes 复制到
 * 每条记录。
 */

import { deriveStableIdV2 } from '@linguist/cat-core'
import type { CatDatabase } from '../database'
import {
  type ReferenceImportRow,
  referenceImportFromRow,
} from './rows'

export type ReferenceImportKind = 'tm' | 'terms'

export interface ReferenceImport {
  id: string
  kind: ReferenceImportKind
  originalFilename: string
  sourceSha256: string
  /** 项目目录内 blobs/ 相对路径，绝不下发为主机绝对路径。 */
  blobRelpath: string
  createdAt: string
}

export interface ReferenceImportInput {
  kind: ReferenceImportKind
  originalFilename: string
  sourceSha256: string
  blobRelpath: string
}

function stableId(projectId: string, input: ReferenceImportInput): string {
  return deriveStableIdV2('rfi', [
    projectId,
    input.kind,
    input.originalFilename,
    input.sourceSha256,
  ])
}

export class ReferenceImportsRepository {
  constructor(
    private readonly db: CatDatabase,
    private readonly projectId: string,
    private readonly now: () => string = () => new Date().toISOString(),
  ) {}

  /** 同一项目、种类、文件名和内容重导入时幂等返回原记录。 */
  insert(input: ReferenceImportInput): ReferenceImport {
    return this.db.transaction(`insert reference import ${input.kind}`, () => {
      const id = stableId(this.projectId, input)
      const existing = this.db.db
        .prepare('SELECT * FROM reference_imports WHERE id = ?')
        .get(id) as ReferenceImportRow | undefined
      if (existing !== undefined) {
        if (
          existing.project_id !== this.projectId
          || existing.kind !== input.kind
          || existing.original_filename !== input.originalFilename
          || existing.source_sha256 !== input.sourceSha256
          || existing.blob_relpath !== input.blobRelpath
        ) {
          throw new Error(`Reference import id collision: ${id}`)
        }
        return referenceImportFromRow(existing)
      }
      this.db.db
        .prepare(
          `INSERT INTO reference_imports
           (id, project_id, kind, original_filename, source_sha256, blob_relpath, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          id,
          this.projectId,
          input.kind,
          input.originalFilename,
          input.sourceSha256,
          input.blobRelpath,
          this.now(),
        )
      return this.get(id) as ReferenceImport
    })
  }

  get(id: string): ReferenceImport | undefined {
    const row = this.db.db
      .prepare('SELECT * FROM reference_imports WHERE id = ? AND project_id = ?')
      .get(id, this.projectId) as ReferenceImportRow | undefined
    return row === undefined ? undefined : referenceImportFromRow(row)
  }

  list(kind: ReferenceImportKind): ReferenceImport[] {
    const rows = this.db.db
      .prepare(
        `SELECT * FROM reference_imports
         WHERE project_id = ? AND kind = ?
         ORDER BY created_at, id`,
      )
      .all(this.projectId, kind) as ReferenceImportRow[]
    return rows.map(referenceImportFromRow)
  }
}
