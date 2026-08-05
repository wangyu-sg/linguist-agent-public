import {
  LINGUIST_ASSET_ID_PATTERN,
  LINGUIST_CAT_PAGE_MAX,
  LINGUIST_CAT_SEARCH_MAX_LENGTH,
  LINGUIST_QA_FINDING_ID_PATTERN,
  LINGUIST_SEGMENT_ID_PATTERN,
  type LinguistCatEditSegmentResult,
  type LinguistCatConfirmStageBulkResult,
  type LinguistCatStageMutationResult,
  type LinguistCatContextResult,
  type LinguistCatListQaFindingsResult,
  type LinguistCatQueryResult,
  type LinguistCatRunQaResult,
  type LinguistCurrentStageState,
  type LinguistQaFindingDisposition,
  type LinguistQaFindingInfo,
  type LinguistQaFindingSeverity,
  type LinguistIpcResult,
  type LinguistLatestRunSummaryResult,
  type LinguistProjectEventAckResult,
  type LinguistProjectEventListResult,
  type LinguistProjectMutationEvent,
  type LinguistRunUndoResult,
  type LinguistSegmentStatus,
} from '@proma/shared'
import { assertRecord, invalid, readProjectId, wrap } from './ipc-envelope'
import type { LinguistProjectService } from './project-service'

const SEGMENT_STATUSES: ReadonlySet<string> = new Set([
  'untranslated',
  'draft',
  'translated',
  'reviewed',
])
const CURRENT_STAGE_STATES: ReadonlySet<string> = new Set([
  'untouched',
  'draft',
  'confirmed',
])
const QA_STATUSES: ReadonlySet<string> = new Set(['open', 'resolved', 'waived'])
const QA_SEVERITIES: ReadonlySet<string> = new Set(['L0', 'L1', 'L2', 'L3', 'L4'])
const QA_DISPOSITIONS: ReadonlySet<string> = new Set(['defect', 'needs_review', 'query', 'info'])
const QA_WAIVER_REASON_MAX_LENGTH = 500
const QA_WAIVER_OPERATOR_MAX_LENGTH = 120
const QA_CODE_MAX_LENGTH = 120
const PROJECT_EVENT_PAGE_MAX = 200

export interface LinguistCatWorkspaceIpcDeps {
  getService: () => LinguistProjectService
  getSession?: (sessionId: string) => {
    id: string
    linguistProjectId?: string
    archived?: boolean
  } | undefined
  onProjectMutation?: (event: LinguistProjectMutationEvent) => void
}

function optionalString(
  record: Record<string, unknown>,
  field: 'assetId' | 'search',
): string | undefined {
  const value = record[field]
  if (value === undefined) return undefined
  if (typeof value !== 'string') invalid(`${field} must be a string`)
  return value
}

function integer(
  record: Record<string, unknown>,
  field: 'limit' | 'offset',
  fallback: number,
): number {
  const value = record[field] ?? fallback
  if (!Number.isInteger(value)) invalid(`${field} must be an integer`)
  return value as number
}

export function createLinguistCatWorkspaceIpc(deps: LinguistCatWorkspaceIpcDeps) {
  const readAuthorizedSession = (
    record: Record<string, unknown>,
    projectId: string,
  ): { id: string } => {
    const sessionId = record.sessionId
    if (
      typeof sessionId !== 'string'
      || sessionId.trim() === ''
      || sessionId.length > 200
    ) {
      invalid('sessionId must be a non-blank stable identifier')
    }
    const session = deps.getSession?.(sessionId)
    if (
      session === undefined
      || session.archived === true
      || session.linguistProjectId !== projectId
    ) {
      invalid('sessionId does not belong to the current Linguist project')
    }
    return session
  }

  const notifyRunUndone = (event: LinguistProjectMutationEvent): void => {
    if (deps.onProjectMutation === undefined) return
    try {
      deps.onProjectMutation(event)
    } catch (error) {
      // 数据库 undo 已提交；通知失败不能把成功响应伪装成写失败。
      console.error('[Linguist CAT] 广播 run undo mutation 失败:', error)
    }
  }

  const readSegmentId = (record: Record<string, unknown>): string => {
    const segmentId = record.segmentId
    if (typeof segmentId !== 'string' || !LINGUIST_SEGMENT_ID_PATTERN.test(segmentId)) {
      invalid('segmentId must be a valid Stable ID')
    }
    return segmentId
  }

  const readFindingId = (record: Record<string, unknown>): string => {
    const findingId = record.findingId
    if (typeof findingId !== 'string' || !LINGUIST_QA_FINDING_ID_PATTERN.test(findingId)) {
      invalid('findingId must be a valid Stable ID')
    }
    return findingId
  }

  const readExpectedRevision = (record: Record<string, unknown>): number => {
    const expectedRevision = record.expectedRevision
    if (!Number.isInteger(expectedRevision) || (expectedRevision as number) < 0) {
      invalid('expectedRevision must be a non-negative integer')
    }
    return expectedRevision as number
  }

  const readWaiverEvidence = (record: Record<string, unknown>): {
    reason: string
    operator: string
  } => {
    const reason = record.reason
    if (
      typeof reason !== 'string'
      || reason.trim().length === 0
      || reason.length > QA_WAIVER_REASON_MAX_LENGTH
    ) {
      invalid(`reason must be a non-blank string of at most ${QA_WAIVER_REASON_MAX_LENGTH} characters`)
    }
    const operator = record.operator
    if (
      typeof operator !== 'string'
      || operator.trim().length === 0
      || operator.length > QA_WAIVER_OPERATOR_MAX_LENGTH
    ) {
      invalid(`operator must be a non-blank string of at most ${QA_WAIVER_OPERATOR_MAX_LENGTH} characters`)
    }
    return { reason: reason.trim(), operator: operator.trim() }
  }

  return {
    getLatestRunSummary(input: unknown): Promise<LinguistIpcResult<LinguistLatestRunSummaryResult>> {
      return wrap(() => {
        const projectId = readProjectId(assertRecord(input))
        return {
          summary:
            deps.getService().openProject(projectId).runs.getLatestRunChangeSummary() ?? null,
        }
      })
    },

    undoLatestRun(input: unknown): Promise<LinguistIpcResult<LinguistRunUndoResult>> {
      return wrap(() => {
        const record = assertRecord(input)
        const projectId = readProjectId(record)
        const session = readAuthorizedSession(record, projectId)
        const expectedRunId = record.expectedRunId
        if (
          typeof expectedRunId !== 'string'
          || expectedRunId.trim() === ''
          || expectedRunId.length > 200
        ) {
          invalid('expectedRunId must be a non-blank stable identifier')
        }
        const runs = deps.getService().openProject(projectId).runs
        const summary = runs.getLatestRunChangeSummary()
        if (summary === undefined) invalid('project has no durable Linguist run to undo')
        if (summary.runId !== expectedRunId) {
          invalid('latest run changed; refresh the run summary before undoing')
        }
        const result = runs.undoRun(summary.runId, { actorId: `workbench:${session.id}` })
        if (result.event !== undefined) {
          notifyRunUndone({
            ...result.event,
            revision: result.event.sequence,
            sequence: result.event.sequence,
          })
        }
        return {
          runId: result.runId,
          status: result.status,
          reverted: result.reverted,
          refused: result.refused,
        }
      })
    },

    listProjectEvents(input: unknown): Promise<LinguistIpcResult<LinguistProjectEventListResult>> {
      return wrap(() => {
        const record = assertRecord(input)
        const projectId = readProjectId(record)
        const afterSequence = record.afterSequence
        const limit = record.limit ?? 100
        if (!Number.isInteger(afterSequence) || (afterSequence as number) < 0) {
          invalid('afterSequence must be a non-negative integer')
        }
        if (
          !Number.isInteger(limit) ||
          (limit as number) < 1 ||
          (limit as number) > PROJECT_EVENT_PAGE_MAX
        ) {
          invalid(`limit must be between 1 and ${PROJECT_EVENT_PAGE_MAX}`)
        }
        const rows = deps.getService().openProject(projectId).runs.listEvents(
          afterSequence as number,
          (limit as number) + 1,
        )
        return {
          events: rows.slice(0, limit as number).map((event) => ({
            ...event,
            revision: event.sequence,
            sequence: event.sequence,
          })),
          hasMore: rows.length > (limit as number),
        }
      })
    },

    ackProjectEvents(input: unknown): Promise<LinguistIpcResult<LinguistProjectEventAckResult>> {
      return wrap(() => {
        const record = assertRecord(input)
        const projectId = readProjectId(record)
        const consumerId = record.consumerId
        const throughSequence = record.throughSequence
        if (
          typeof consumerId !== 'string' ||
          !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,119}$/.test(consumerId)
        ) {
          invalid('consumerId must be an opaque identifier of at most 120 characters')
        }
        if (!Number.isInteger(throughSequence) || (throughSequence as number) < 0) {
          invalid('throughSequence must be a non-negative integer')
        }
        return deps.getService().openProject(projectId).runs.ackEvents(
          consumerId,
          throughSequence as number,
        )
      })
    },

    query(input: unknown): Promise<LinguistIpcResult<LinguistCatQueryResult>> {
      return wrap(() => {
        const record = assertRecord(input)
        const projectId = readProjectId(record)
        const assetId = optionalString(record, 'assetId')
        if (assetId !== undefined && !LINGUIST_ASSET_ID_PATTERN.test(assetId)) {
          invalid('assetId must be a valid Stable ID')
        }
        const search = optionalString(record, 'search')
        if (search !== undefined && search.length > LINGUIST_CAT_SEARCH_MAX_LENGTH) {
          invalid(`search must be at most ${LINGUIST_CAT_SEARCH_MAX_LENGTH} characters`)
        }
        const status = record.status
        if (status !== undefined && (typeof status !== 'string' || !SEGMENT_STATUSES.has(status))) {
          invalid('status must be a known segment status')
        }
        const currentStageState = record.currentStageState
        if (
          currentStageState !== undefined
          && (
            typeof currentStageState !== 'string'
            || !CURRENT_STAGE_STATES.has(currentStageState)
          )
        ) {
          invalid('currentStageState must be a known current-stage state')
        }
        const limit = integer(record, 'limit', 100)
        const offset = integer(record, 'offset', 0)
        const includeIndex = record.includeIndex ?? false
        if (typeof includeIndex !== 'boolean') invalid('includeIndex must be a boolean')
        if (limit < 1 || limit > LINGUIST_CAT_PAGE_MAX) {
          invalid(`limit must be between 1 and ${LINGUIST_CAT_PAGE_MAX}`)
        }
        if (offset < 0) invalid('offset must be non-negative')

        const page = deps.getService().queryCatWorkspace(projectId, {
          assetId,
          status: status as LinguistSegmentStatus | undefined,
          currentStageState: currentStageState as LinguistCurrentStageState | undefined,
          search: search?.trim() || undefined,
          limit,
          offset,
          includeIndex,
        })
        return {
          assets: page.assets.map((asset) => ({
            assetId: asset.id,
            filename: asset.originalFilename,
            formatId: asset.formatId,
            segmentCount: asset.segmentCount,
            sourceSha256: asset.sourceSha256,
          })),
          segments: page.segments,
          segmentIds: page.segmentIds,
          total: page.total,
          limit,
          offset,
          hasMore: offset + page.segments.length < page.total,
        }
      })
    },

    edit(input: unknown): Promise<LinguistIpcResult<LinguistCatEditSegmentResult>> {
      return wrap(() => {
        const record = assertRecord(input)
        const projectId = readProjectId(record)
        const segmentId = readSegmentId(record)
        const target = record.target
        if (typeof target !== 'string') invalid('target must be a string')
        const expectedRevision = readExpectedRevision(record)
        return deps.getService().editSegment(
          projectId,
          segmentId,
          target,
          expectedRevision,
        )
      })
    },

    confirmStage(input: unknown): Promise<LinguistIpcResult<LinguistCatStageMutationResult>> {
      return wrap(() => {
        const record = assertRecord(input)
        return deps.getService().confirmCurrentStage(
          readProjectId(record),
          readSegmentId(record),
          readExpectedRevision(record),
        )
      })
    },

    unconfirmStage(input: unknown): Promise<LinguistIpcResult<LinguistCatStageMutationResult>> {
      return wrap(() => {
        const record = assertRecord(input)
        return deps.getService().unconfirmCurrentStage(
          readProjectId(record),
          readSegmentId(record),
          readExpectedRevision(record),
        )
      })
    },

    confirmStageBulk(input: unknown): Promise<LinguistIpcResult<LinguistCatConfirmStageBulkResult>> {
      return wrap(() => {
        const record = assertRecord(input)
        const projectId = readProjectId(record)
        if (
          !Array.isArray(record.items)
          || record.items.length === 0
          || record.items.length > LINGUIST_CAT_PAGE_MAX
        ) {
          invalid(`items must contain between 1 and ${LINGUIST_CAT_PAGE_MAX} entries`)
        }
        const items = record.items.map((value) => {
          const item = assertRecord(value)
          return {
            segmentId: readSegmentId(item),
            expectedRevision: readExpectedRevision(item),
          }
        })
        return deps.getService().confirmCurrentStageBulk(projectId, items)
      })
    },

    getContext(input: unknown): Promise<LinguistIpcResult<LinguistCatContextResult>> {
      return wrap(() => {
        const record = assertRecord(input)
        return deps.getService().getSegmentContext(
          readProjectId(record),
          readSegmentId(record),
        )
      })
    },

    runQa(input: unknown): Promise<LinguistIpcResult<LinguistCatRunQaResult>> {
      return wrap(() => {
        const projectId = readProjectId(assertRecord(input))
        const findings = deps.getService().runQa(projectId)
        // PB-096：按契约五档 severity 与四值 disposition 计数
        const severityCounts: Record<LinguistQaFindingSeverity, number> = { L0: 0, L1: 0, L2: 0, L3: 0, L4: 0 }
        const dispositionCounts: Record<LinguistQaFindingDisposition, number> = { defect: 0, needs_review: 0, query: 0, info: 0 }
        for (const finding of findings) {
          severityCounts[finding.severity] += 1
          dispositionCounts[finding.disposition] += 1
        }
        return { total: findings.length, severityCounts, dispositionCounts }
      })
    },

    listQaFindings(input: unknown): Promise<LinguistIpcResult<LinguistCatListQaFindingsResult>> {
      return wrap(() => {
        const record = assertRecord(input)
        const projectId = readProjectId(record)
        const segmentId = record.segmentId
        if (segmentId !== undefined && (typeof segmentId !== 'string' || !LINGUIST_SEGMENT_ID_PATTERN.test(segmentId))) {
          invalid('segmentId must be a valid Stable ID')
        }
        const code = record.code
        if (
          code !== undefined
          && (typeof code !== 'string' || code.trim().length === 0 || code.length > QA_CODE_MAX_LENGTH)
        ) {
          invalid(`code must be a non-blank string of at most ${QA_CODE_MAX_LENGTH} characters`)
        }
        const status = record.status
        if (status !== undefined && (typeof status !== 'string' || !QA_STATUSES.has(status))) {
          invalid('status must be a known QA finding status')
        }
        const severity = record.severity
        if (severity !== undefined && (typeof severity !== 'string' || !QA_SEVERITIES.has(severity))) {
          invalid('severity must be a known QA finding severity')
        }
        const disposition = record.disposition
        if (disposition !== undefined && (typeof disposition !== 'string' || !QA_DISPOSITIONS.has(disposition))) {
          invalid('disposition must be a known QA finding disposition')
        }
        const limit = integer(record, 'limit', 100)
        const offset = integer(record, 'offset', 0)
        if (limit < 1 || limit > LINGUIST_CAT_PAGE_MAX) {
          invalid(`limit must be between 1 and ${LINGUIST_CAT_PAGE_MAX}`)
        }
        if (offset < 0) invalid('offset must be non-negative')
        const result = deps.getService().listQaFindings(projectId, {
          ...(typeof segmentId === 'string' ? { segmentId } : {}),
          ...(typeof code === 'string' ? { code: code.trim() } : {}),
          ...(typeof status === 'string' ? { status: status as 'open' | 'resolved' | 'waived' } : {}),
          ...(typeof severity === 'string' ? { severity: severity as LinguistQaFindingSeverity } : {}),
          ...(typeof disposition === 'string' ? { disposition: disposition as LinguistQaFindingDisposition } : {}),
          limit,
          offset,
        })
        return {
          items: result.items as LinguistQaFindingInfo[],
          total: result.total,
          limit,
          offset,
          hasMore: offset + result.items.length < result.total,
        }
      })
    },

    resolveQaFinding(input: unknown): Promise<LinguistIpcResult<LinguistQaFindingInfo>> {
      return wrap(() => {
        const record = assertRecord(input)
        return deps.getService().resolveQaFinding(readProjectId(record), readFindingId(record))
      })
    },

    waiveQaFinding(input: unknown): Promise<LinguistIpcResult<LinguistQaFindingInfo>> {
      return wrap(() => {
        const record = assertRecord(input)
        const evidence = readWaiverEvidence(record)
        return deps.getService().waiveQaFinding(
          readProjectId(record),
          readFindingId(record),
          evidence.reason,
          evidence.operator,
        )
      })
    },

    waiveQaFindingsBulk(input: unknown): Promise<LinguistIpcResult<LinguistQaFindingInfo[]>> {
      return wrap(() => {
        const record = assertRecord(input)
        if (
          !Array.isArray(record.findingIds)
          || record.findingIds.length === 0
          || record.findingIds.length > LINGUIST_CAT_PAGE_MAX
        ) {
          invalid(`findingIds must contain between 1 and ${LINGUIST_CAT_PAGE_MAX} entries`)
        }
        const findingIds = record.findingIds.map((findingId) =>
          readFindingId({ findingId }))
        if (new Set(findingIds).size !== findingIds.length) {
          invalid('findingIds must not contain duplicates')
        }
        const evidence = readWaiverEvidence(record)
        return deps.getService().waiveQaFindings(
          readProjectId(record),
          findingIds,
          evidence.reason,
          evidence.operator,
        )
      })
    },
  }
}
