/**
 * Context docs repository (PB-095, schema v6): metadata rows for project
 * context documents / images. The file BYTES live under the project
 * blobs/ dir (see blobs.ts); this table only tracks metadata + the
 * optional plain-text extract. Deleting a row does not touch the blob —
 * the service layer composes blob removal (best-effort) on top.
 */

import {
  deriveStableIdV2,
  type ContextAnchor,
  type ContextAnchorLocator,
  type ContextEvidenceLink,
  type StableIdField,
} from '@linguist/cat-core'
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
  parentContextDocId?: string
  extractionWarnings?: Array<{ code: string; message: string }>
}

export interface ContextDocSearch {
  /** Case-insensitive literal substring matched against filename OR note. */
  query?: string
  kind?: ContextDocKind
  /** Only Context Docs explicitly linked to this Segment. */
  segmentId?: string
  limit?: number
  offset?: number
  /** 默认隐藏从父 Context 提取的媒体子项，避免资产面板重复。 */
  includeExtractedMedia?: boolean
}

function stableId(projectId: string, input: ContextDocInput): string {
  const parts: StableIdField[] = [
    projectId,
    input.kind,
    input.originalFilename,
    input.sha256 ?? null,
  ]
  if (input.parentContextDocId !== undefined) parts.push(input.parentContextDocId)
  return deriveStableIdV2('ctx', parts)
}

/** Escape LIKE wildcards so query is a literal substring match. */
function likePattern(search: string): string {
  return `%${search.replace(/[\\%_]/g, (c) => `\\${c}`)}%`
}

function buildWhere(projectId: string, filter: ContextDocSearch): { where: string; params: unknown[] } {
  const clauses = ['project_id = ?']
  const params: unknown[] = [projectId]
  if (filter.includeExtractedMedia !== true) clauses.push('parent_context_doc_id IS NULL')
  if (filter.query !== undefined) {
    clauses.push("(original_filename LIKE ? ESCAPE '\\' OR note LIKE ? ESCAPE '\\')")
    const pattern = likePattern(filter.query)
    params.push(pattern, pattern)
  }
  if (filter.kind !== undefined) {
    clauses.push('kind = ?')
    params.push(filter.kind)
  }
  if (filter.segmentId !== undefined) {
    clauses.push(`EXISTS (
      SELECT 1 FROM context_evidence_links links
      WHERE links.context_doc_id = context_docs.id
        AND links.relation_type = 'segment' AND links.segment_id = ?
    )`)
    params.push(filter.segmentId)
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
        if (
          existing.project_id !== this.projectId
          || existing.blob_relpath !== input.blobRelpath
          || existing.parent_context_doc_id !== (input.parentContextDocId ?? null)
        ) {
          throw new Error(`Context doc id collision: ${id}`)
        }
        // 旧版曾保存 DOCX 字节但不做文本抽取。用户重新导入同一文件时仅
        // 补齐缺失值；既有正文永不被解析器版本变化静默改写。
        this.db.db.prepare(`
          UPDATE context_docs
          SET text_extract = COALESCE(text_extract, ?),
              extraction_warnings_json = CASE
                WHEN extraction_warnings_json = '[]' THEN ?
                ELSE extraction_warnings_json
              END
          WHERE id = ? AND project_id = ?
        `).run(
          input.textExtract ?? null,
          JSON.stringify(input.extractionWarnings ?? []),
          id,
          this.projectId,
        )
        return this.get(id) as ContextDoc
      }
      this.db.db
        .prepare(
          `INSERT INTO context_docs
           (id, project_id, kind, original_filename, blob_relpath, sha256, note,
            text_extract, parent_context_doc_id, extraction_warnings_json, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
          input.parentContextDocId ?? null,
          JSON.stringify(input.extractionWarnings ?? []),
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

  /** Associate or disassociate one project-owned Context Doc and Segment. */
  setSegmentLink(id: string, segmentId: string, linked: boolean): void {
    this.db.transaction(`${linked ? 'link' : 'unlink'} context doc ${id} to segment ${segmentId}`, () => {
      if (this.get(id) === undefined) throw new StoreNotFoundError('context doc', id)
      const segment = this.db.db
        .prepare(`SELECT 1 FROM segments
          INNER JOIN assets ON assets.id = segments.asset_id
          WHERE segments.id = ? AND assets.project_id = ?`)
        .get(segmentId, this.projectId)
      if (segment === undefined) throw new StoreNotFoundError('segment', segmentId)
      if (linked) {
        this.db.db.prepare(`
          INSERT INTO context_evidence_links (
            context_doc_id, anchor_id, relation_type, asset_id, segment_id,
            requiredness, mapping_revision
          ) VALUES (?, NULL, 'segment', NULL, ?, 'conditional', 'manual-v1')
          ON CONFLICT DO UPDATE SET
            requiredness = excluded.requiredness,
            mapping_revision = excluded.mapping_revision
        `).run(id, segmentId)
      } else {
        this.db.db.prepare(`
          DELETE FROM context_evidence_links
          WHERE context_doc_id = ? AND anchor_id IS NULL
            AND relation_type = 'segment' AND segment_id = ?
        `).run(id, segmentId)
      }
    })
  }

  replaceExtraction(
    contextDocId: string,
    anchors: ReadonlyArray<Omit<ContextAnchor, 'contextDocId'>>,
  ): ContextAnchor[] {
    return this.db.transaction(`replace Context extraction ${contextDocId}`, () => {
      if (this.get(contextDocId) === undefined) throw new StoreNotFoundError('context doc', contextDocId)
      if (new Set(anchors.map((anchor) => anchor.id)).size !== anchors.length) {
        throw new TypeError('Context anchor ids must be unique')
      }
      this.db.db.prepare('DELETE FROM context_anchors WHERE context_doc_id = ?').run(contextDocId)
      const insert = this.db.db.prepare(`
        INSERT INTO context_anchors (
          id, context_doc_id, locator_json, label, text_extract,
          media_context_doc_id, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
      `)
      for (const anchor of anchors) {
        if (anchor.mediaContextDocId !== undefined) {
          const media = this.get(anchor.mediaContextDocId)
          if (
            media?.kind !== 'image'
            || (media.id !== contextDocId && media.parentContextDocId !== contextDocId)
          ) {
            throw new StoreNotFoundError('extracted context media', anchor.mediaContextDocId)
          }
        }
        insert.run(
          anchor.id,
          contextDocId,
          JSON.stringify(anchor.locator),
          anchor.label ?? null,
          anchor.text ?? null,
          anchor.mediaContextDocId ?? null,
          this.now(),
        )
      }
      return this.listAnchors(contextDocId)
    })
  }

  listAnchors(contextDocId: string): ContextAnchor[] {
    const rows = this.db.db.prepare(`
      SELECT id, context_doc_id, locator_json, label, text_extract, media_context_doc_id
      FROM context_anchors WHERE context_doc_id = ? ORDER BY id
    `).all(contextDocId) as Array<{
      id: string
      context_doc_id: string
      locator_json: string
      label: string | null
      text_extract: string | null
      media_context_doc_id: string | null
    }>
    return rows.map((row) => ({
      id: row.id,
      contextDocId: row.context_doc_id,
      locator: JSON.parse(row.locator_json) as ContextAnchorLocator,
      ...(row.label === null ? {} : { label: row.label }),
      ...(row.text_extract === null ? {} : { text: row.text_extract }),
      ...(row.media_context_doc_id === null ? {} : { mediaContextDocId: row.media_context_doc_id }),
    }))
  }

  setEvidenceLink(input: ContextEvidenceLink): void {
    this.db.transaction(`set Context evidence link ${input.contextDocId}`, () => {
      if (this.get(input.contextDocId) === undefined) {
        throw new StoreNotFoundError('context doc', input.contextDocId)
      }
      if (input.anchorId !== undefined) {
        const anchor = this.db.db.prepare(`
          SELECT 1 FROM context_anchors WHERE id = ? AND context_doc_id = ?
        `).get(input.anchorId, input.contextDocId)
        if (anchor === undefined) throw new StoreNotFoundError('context anchor', input.anchorId)
      }
      if (input.relation.kind === 'asset') {
        const asset = this.db.db.prepare('SELECT 1 FROM assets WHERE id = ? AND project_id = ?')
          .get(input.relation.assetId, this.projectId)
        if (asset === undefined) throw new StoreNotFoundError('asset', input.relation.assetId)
      } else {
        const segment = this.db.db.prepare(`
          SELECT 1 FROM segments
          INNER JOIN assets ON assets.id = segments.asset_id
          WHERE segments.id = ? AND assets.project_id = ?
        `).get(input.relation.segmentId, this.projectId)
        if (segment === undefined) throw new StoreNotFoundError('segment', input.relation.segmentId)
      }
      this.db.db.prepare(`
        INSERT INTO context_evidence_links (
          context_doc_id, anchor_id, relation_type, asset_id, segment_id,
          requiredness, mapping_revision
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT DO UPDATE SET
          requiredness = excluded.requiredness,
          mapping_revision = excluded.mapping_revision
      `).run(
        input.contextDocId,
        input.anchorId ?? null,
        input.relation.kind,
        input.relation.kind === 'asset' ? input.relation.assetId : null,
        input.relation.kind === 'segment' ? input.relation.segmentId : null,
        input.requiredness,
        input.mappingRevision,
      )
    })
  }

  listEvidenceLinks(contextDocId: string): ContextEvidenceLink[] {
    const rows = this.db.db.prepare(`
      SELECT * FROM context_evidence_links
      WHERE context_doc_id = ?
      ORDER BY relation_type, COALESCE(asset_id, segment_id), COALESCE(anchor_id, '')
    `).all(contextDocId) as Array<{
      context_doc_id: string
      anchor_id: string | null
      relation_type: 'asset' | 'segment'
      asset_id: string | null
      segment_id: string | null
      requiredness: ContextEvidenceLink['requiredness']
      mapping_revision: string
    }>
    return rows.map((row) => ({
      contextDocId: row.context_doc_id,
      ...(row.anchor_id === null ? {} : { anchorId: row.anchor_id }),
      relation: row.relation_type === 'asset'
        ? { kind: 'asset', assetId: row.asset_id! }
        : { kind: 'segment', segmentId: row.segment_id! },
      requiredness: row.requiredness,
      mappingRevision: row.mapping_revision,
    }))
  }

  linkExtractionByExactText(contextDocId: string, mappingRevision: string): ContextEvidenceLink[] {
    return this.db.transaction(`link Context extraction ${contextDocId}`, () => {
      if (this.get(contextDocId) === undefined) throw new StoreNotFoundError('context doc', contextDocId)
      this.db.db.prepare(`
        INSERT INTO context_evidence_links (
          context_doc_id, anchor_id, relation_type, asset_id, segment_id,
          requiredness, mapping_revision
        )
        SELECT anchor.context_doc_id, anchor.id, 'segment', NULL, segment.id,
               'conditional', ?
        FROM context_anchors AS anchor
        INNER JOIN segments AS segment
          ON anchor.text_extract <> ''
          AND (anchor.text_extract = segment.source
            OR anchor.text_extract = segment.target
            OR anchor.text_extract = segment.key)
        INNER JOIN assets AS asset ON asset.id = segment.asset_id
        WHERE anchor.context_doc_id = ? AND asset.project_id = ?
        ON CONFLICT DO UPDATE SET mapping_revision = excluded.mapping_revision
      `).run(mappingRevision, contextDocId, this.projectId)
      this.db.db.prepare(`
        INSERT INTO context_evidence_links (
          context_doc_id, anchor_id, relation_type, asset_id, segment_id,
          requiredness, mapping_revision
        )
        SELECT DISTINCT anchor.context_doc_id, anchor.id, 'asset', asset.id, NULL,
               'conditional', ?
        FROM context_anchors AS anchor
        INNER JOIN segments AS segment
          ON anchor.text_extract <> ''
          AND (anchor.text_extract = segment.source
            OR anchor.text_extract = segment.target
            OR anchor.text_extract = segment.key)
        INNER JOIN assets AS asset ON asset.id = segment.asset_id
        WHERE anchor.context_doc_id = ? AND asset.project_id = ?
        ON CONFLICT DO UPDATE SET mapping_revision = excluded.mapping_revision
      `).run(mappingRevision, contextDocId, this.projectId)

      const anchors = this.listAnchors(contextDocId)
      const links = this.listEvidenceLinks(contextDocId)
      const rowLinks = new Map<string, ContextEvidenceLink[]>()
      for (const anchor of anchors) {
        if (anchor.locator.kind !== 'sheet' || anchor.locator.row === undefined) continue
        const key = `${anchor.locator.sheet}\u0000${anchor.locator.row}`
        const linked = links.filter((link) => link.anchorId === anchor.id)
        if (linked.length > 0) rowLinks.set(key, [...(rowLinks.get(key) ?? []), ...linked])
      }
      for (const anchor of anchors) {
        if (anchor.locator.kind !== 'image' || anchor.locator.sheet === undefined || anchor.locator.row === undefined) continue
        const linked = rowLinks.get(`${anchor.locator.sheet}\u0000${anchor.locator.row}`) ?? []
        for (const source of linked) {
          this.setEvidenceLink({
            ...source,
            anchorId: anchor.id,
            mappingRevision,
          })
        }
      }
      return this.listEvidenceLinks(contextDocId)
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

  listExtractedMedia(parentContextDocId: string): ContextDoc[] {
    const rows = this.db.db.prepare(`
      SELECT * FROM context_docs
      WHERE project_id = ? AND parent_context_doc_id = ?
      ORDER BY created_at, id
    `).all(this.projectId, parentContextDocId) as ContextDocRow[]
    return rows.map(contextDocFromRow)
  }

  isBlobReferenced(blobRelpath: string): boolean {
    return this.db.db.prepare(`
      SELECT 1 FROM context_docs
      WHERE project_id = ? AND blob_relpath = ? LIMIT 1
    `).get(this.projectId, blobRelpath) !== undefined
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
