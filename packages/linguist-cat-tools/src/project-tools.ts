import type { SegmentStatus } from '@linguist/cat-core'
import { Type } from 'typebox'
import {
  LinguistCatAssetNotFoundError,
  LinguistCatInvalidArgumentError,
} from './errors'
import { pageHasMore, resolvePage } from './pagination'
import {
  CAT_TOOL_PAGE_LIMITS,
  type CatAssetListItem,
  type CatProjectSummaryResult,
  type CatSegmentListItem,
  type PagedResult,
} from './types'
import {
  defineTool,
  toolResult,
  toSegmentItem,
  type CatToolRuntime,
} from './tool-runtime'

const SEGMENT_STATUSES: readonly SegmentStatus[] = [
  'untranslated',
  'draft',
  'translated',
  'reviewed',
]

const ARCHIVED_NOTE = 'Project is archived: all data is read-only.'

/** 项目概览、资产目录与分页句段读取。 */
export function createProjectTools(runtime: CatToolRuntime) {
  const { deps, resolveBoundProject } = runtime

  const projectSummaryTool = defineTool({
    name: 'cat_project_summary',
    label: 'CAT project summary',
    description:
      'Read-only summary of the Linguist CAT project bound to this session: name, locales, ' +
      'asset count, total segments, and per-status segment counts. The project always comes ' +
      'from the session binding — never ask the user for a project id. Archived projects are ' +
      'reported with archived: true (reads still work). Contains no filesystem paths.',
    promptSnippet: 'Summarize the bound CAT project',
    promptGuidelines: [
      'Read tools never modify project data; write correct translations with cat_apply_translations.',
    ],
    parameters: Type.Object({}),
    async execute(toolCallId) {
      const { project, db } = resolveBoundProject('cat_project_summary', toolCallId)
      const assetCount = db.assets.countByProject()
      const segmentCounts = db.segments.countByStatus()
      const totalSegments =
        segmentCounts.untranslated + segmentCounts.draft + segmentCounts.translated + segmentCounts.reviewed
      const archived = project.archivedAt !== undefined
      const dto: CatProjectSummaryResult = {
        project: {
          id: project.id as string,
          name: project.name,
          sourceLocale: project.sourceLocale,
          targetLocale: project.targetLocale,
          archived,
          createdAt: project.createdAt,
          updatedAt: project.updatedAt,
          ...(project.archivedAt !== undefined ? { archivedAt: project.archivedAt } : {}),
        },
        assetCount,
        totalSegments,
        segmentCounts,
        ...(archived ? { note: ARCHIVED_NOTE } : {}),
      }
      return toolResult(dto, deps.resultProjectId)
    },
  })

  const listAssetsTool = defineTool({
    name: 'cat_list_assets',
    label: 'CAT list assets',
    description:
      'List the imported assets (files) of the bound CAT project: assetId, filename, formatId, ' +
      'segmentCount, and the content-derived sourceSha256 (not a path). Paginated: default limit ' +
      `${CAT_TOOL_PAGE_LIMITS.listAssets.defaultLimit}, hard max ${CAT_TOOL_PAGE_LIMITS.listAssets.maxLimit} ` +
      '(larger limits are clamped with a note). Use offset to page.',
    promptSnippet: 'List assets of the bound CAT project',
    parameters: Type.Object({
      limit: Type.Optional(Type.Integer({ minimum: 1 })),
      offset: Type.Optional(Type.Integer({ minimum: 0 })),
    }),
    async execute(toolCallId, params) {
      const { db } = resolveBoundProject('cat_list_assets', toolCallId)
      const page = resolvePage(params, CAT_TOOL_PAGE_LIMITS.listAssets)
      // Asset rows are file-level metadata (tens, not millions); listByProject
      // never loads segment rows, so an in-memory page slice stays cheap.
      const assets = db.assets.listByProject()
      const items: CatAssetListItem[] = assets.slice(page.offset, page.offset + page.limit).map((asset) => ({
        assetId: asset.id as string,
        filename: asset.originalFilename,
        formatId: asset.formatId,
        segmentCount: asset.segmentCount,
        sourceSha256: asset.sourceSha256,
      }))
      const dto: PagedResult<CatAssetListItem> = {
        items,
        total: assets.length,
        limit: page.limit,
        offset: page.offset,
        hasMore: pageHasMore(assets.length, page.offset, items.length),
        ...(page.note !== undefined ? { note: page.note } : {}),
      }
      return toolResult(dto, deps.resultProjectId)
    },
  })

  const getSegmentsTool = defineTool({
    name: 'cat_get_segments',
    label: 'CAT get segments',
    description:
      'Read segments of the bound CAT project, optionally filtered by assetId (must come from ' +
      'cat_list_assets), status, or a case-insensitive literal substring over source/target. ' +
      'Paginated: default limit ' +
      `${CAT_TOOL_PAGE_LIMITS.getSegments.defaultLimit}, hard max ${CAT_TOOL_PAGE_LIMITS.getSegments.maxLimit} ` +
      '(larger limits are clamped with a note). Use offset to page through large assets — never ' +
      'expect more than the max in one call. Every item includes segmentId, one-based originalOrdinal, ' +
      'source, and current target; segment ids are stable across filtering and paging.',
    promptSnippet: 'Read segments of the bound CAT project (paged)',
    promptGuidelines: [
      'Page cat_get_segments with offset for large assets; each call returns at most 100 segments.',
    ],
    parameters: Type.Object({
      assetId: Type.Optional(Type.String({ description: 'Asset id from cat_list_assets.' })),
      status: Type.Optional(
        Type.Union([
          Type.Literal('untranslated'),
          Type.Literal('draft'),
          Type.Literal('translated'),
          Type.Literal('reviewed'),
        ]),
      ),
      search: Type.Optional(Type.String({ description: 'Literal substring matched against source or target.' })),
      limit: Type.Optional(Type.Integer({ minimum: 1 })),
      offset: Type.Optional(Type.Integer({ minimum: 0 })),
    }),
    async execute(toolCallId, params) {
      const { assetId, status, search } = params
      if (status !== undefined && !SEGMENT_STATUSES.includes(status)) {
        throw new LinguistCatInvalidArgumentError('status', `expected one of ${SEGMENT_STATUSES.join('/')}, got ${String(status)}`)
      }
      const { db } = resolveBoundProject('cat_get_segments', toolCallId)
      if (assetId !== undefined && db.assets.get(assetId) === undefined) {
        throw new LinguistCatAssetNotFoundError(assetId)
      }
      const page = resolvePage(params, CAT_TOOL_PAGE_LIMITS.getSegments)
      const filter = {
        ...(assetId !== undefined ? { assetId } : {}),
        ...(status !== undefined ? { status } : {}),
        ...(search !== undefined && search !== '' ? { search } : {}),
      }
      const segments = db.segments.query({ ...filter, limit: page.limit, offset: page.offset })
      const total = db.segments.count(filter)
      const items = segments.map(toSegmentItem)
      const dto: PagedResult<CatSegmentListItem> = {
        items,
        total,
        limit: page.limit,
        offset: page.offset,
        hasMore: pageHasMore(total, page.offset, items.length),
        ...(page.note !== undefined ? { note: page.note } : {}),
      }
      return toolResult(dto, deps.resultProjectId, items.map((item) => item.id))
    },
  })

return [
    projectSummaryTool,
    listAssetsTool,
    getSegmentsTool,
  ] as const
}
