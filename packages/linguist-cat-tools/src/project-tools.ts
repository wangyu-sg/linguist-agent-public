import type { SegmentStatus } from '@linguist/cat-core'
import type { ProjectDatabase } from '@linguist/cat-store'
import { Type } from 'typebox'
import {
  LinguistCatAssetNotFoundError,
  LinguistCatInvalidArgumentError,
} from './errors'
import { pageHasMore, resolvePage } from './pagination'
import {
  CAT_TOOL_PAGE_LIMITS,
  type CatAssetListItem,
  type CatDeliveryStatus,
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

  const currentTaskFor = (
    db: ProjectDatabase,
    assetId: string,
  ): CatDeliveryStatus['currentTask'] => {
    if (deps.sessionId === undefined
      || (deps.linguistRole !== 'translator' && deps.linguistRole !== 'reviewer' && deps.linguistRole !== 'proofreader')) return null
    const assetSegmentIds = new Set(db.segments.queryIds({ assetId }))
    const state = db.stageEvidence.list().find(candidate =>
      candidate.sessionId === deps.sessionId
      && candidate.role === deps.linguistRole
      && candidate.plan.segmentIds.some(segmentId => assetSegmentIds.has(segmentId)))
    if (state === undefined) return null
    const completion = db.stageEvidence.getCompletion(state.stageRunId)
    return {
      stageRunId: state.stageRunId,
      role: deps.linguistRole,
      status: completion.status,
      scopeSegments: completion.decisions.total,
      pendingSegments: completion.decisions.pending,
      blockedSegments: completion.decisions.blocked,
      pendingEvidence: completion.presentation.pending.length,
      blockingGaps: completion.blockingGaps.length,
    }
  }

  const projectSummaryTool = defineTool({
    name: 'cat_project_summary',
    label: 'CAT project summary',
    description:
      'Read a side-effect-free business summary of the bound CAT project; never ask for or accept a model-selected projectId. With no arguments, return the existing project and count fields unchanged. For one imported batch, use includeDelivery=true with assetId to additionally read the existing delivery preflight snapshot and this session\'s latest relevant professional task. This query does not create tasks, record decisions/evidence, run persisted QA, stage an export, or save files. ready means preflight readiness, not verified export or independent review. qaFreshness=not-evaluated means this summary does not establish QA freshness; no findings is not proof that QA ran. currentTask=null means no matching task, not completed review. Archived projects remain readable but not exportable through this query.',
    promptSnippet: 'Summarize the bound CAT project',
    parameters: Type.Object({
      assetId: Type.Optional(Type.String({
        minLength: 1,
        description: 'Imported asset ID from the bound project. Supply together with includeDelivery=true to inspect one batch; never a project ID.',
      })),
      includeDelivery: Type.Optional(Type.Boolean({
        description: 'Read the existing delivery preflight and this session\'s latest relevant task for one asset. Requires assetId. Does not run persisted QA, create a Stage, stage an export or save a file.',
      })),
    }),
    async execute(toolCallId, params) {
      if (params.includeDelivery === true && params.assetId === undefined) {
        throw new LinguistCatInvalidArgumentError('assetId', 'required when includeDelivery=true')
      }
      if (params.assetId !== undefined && params.includeDelivery !== true) {
        throw new LinguistCatInvalidArgumentError('includeDelivery', 'must be true when assetId is provided')
      }
      const { project, db } = resolveBoundProject('cat_project_summary', toolCallId)
      const assetCount = db.assets.countByProject()
      const segmentCounts = db.segments.countByStatus()
      const totalSegments =
        segmentCounts.untranslated + segmentCounts.draft + segmentCounts.translated + segmentCounts.reviewed
      const archived = project.archivedAt !== undefined
      const delivery = params.includeDelivery === true
        ? (() => {
            const assetId = params.assetId!
            if (db.assets.get(assetId) === undefined) throw new LinguistCatAssetNotFoundError(assetId)
            if (deps.readDeliveryPreflight === undefined) {
              throw new LinguistCatInvalidArgumentError('includeDelivery', 'delivery preflight is unavailable')
            }
            const preflight = deps.readDeliveryPreflight(assetId)
            return {
              assetId: preflight.assetId,
              workflowStage: preflight.workflowStage,
              archived,
              segmentCount: preflight.segmentCount,
              lockedSegments: preflight.lockedSegments,
              unconfirmedUnlockedSegments: preflight.unconfirmedUnlockedSegments,
              pendingProposalCount: preflight.pendingProposalCount,
              qa: {
                openErrors: preflight.qa.openErrors,
                openWarnings: preflight.qa.openWarnings,
                waived: preflight.qa.waived,
              },
              qaFreshness: 'not-evaluated' as const,
              evidence: {
                status: preflight.evidence.status,
                stageRuns: preflight.evidence.stageRuns,
                required: preflight.evidence.required,
                presented: preflight.evidence.presented,
                pending: preflight.evidence.pending,
              },
              ready: preflight.ready,
              blockers: preflight.blockers.map(({ code, count, message }) => ({ code, count, message })),
              verifiedExport: false as const,
              currentTask: currentTaskFor(db, assetId),
            }
          })()
        : undefined
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
        ...(delivery === undefined ? {} : { delivery }),
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
