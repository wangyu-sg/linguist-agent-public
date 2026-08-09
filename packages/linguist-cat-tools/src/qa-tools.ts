import { normalizeQaProfile, runQa } from '@linguist/cat-core'
import {
  buildQaTermOptions,
  type IdempotentRunMutation,
  type QaFindingListFilter,
} from '@linguist/cat-store'
import { Type } from 'typebox'
import { runQaWorkerJob, type WorkerJobProgress } from './job-runner'
import { pageHasMore, resolvePage } from './pagination'
import {
  CAT_TOOL_PAGE_LIMITS,
  type CatQaFindingItem,
  type CatRunQaResult,
  type CatWorkerJobProgress,
  type LinguistQaWorkerResult,
  type PagedResult,
} from './types'
import {
  defineTool,
  toolResult,
  type CatToolRuntime,
} from './tool-runtime'

const RUN_QA_PARAMETERS = Type.Object({})

/** 确定性 QA 执行与 Finding 读取；不提供 resolve/waive。 */
export function createQaTools(runtime: CatToolRuntime) {
  const { deps, notifyMutation, resolveBoundProject } = runtime

  const runQaTool = defineTool<
    typeof RUN_QA_PARAMETERS,
    CatRunQaResult | CatWorkerJobProgress
  >({
    name: 'cat_run_qa',
    label: 'CAT run QA',
    description:
      'Run deterministic QA for every segment in the bound CAT project and persist reviewable findings. ' +
      'This never changes segment text, revision, or review status. Only a human can resolve or waive findings.',
    promptSnippet: 'Run deterministic QA on the bound CAT project',
    promptGuidelines: [
      'Report findings to the user; never claim they are resolved or waived.',
    ],
    parameters: RUN_QA_PARAMETERS,
    async execute(toolCallId, _params, signal, onUpdate) {
      // PB-096：term_entries、项目 profile 与 tagProfile 一起冻结进 worker snapshot。
      // required / forbidden 都是硬规则；preferred advisory 由 cat_validate_terms 返回。
      // PB-097：项目 tagProfile 进同一道确定性 QA（缺省 = 仅内置族）。
      const { project, db } = resolveBoundProject('cat_run_qa', toolCallId)
      const runId = `qa:${deps.sessionId ?? 'session-unavailable'}:${toolCallId}`
      const total = db.segments.count()
      const segments = total === 0 ? [] : db.segments.query({ limit: total })
      const qaOptions = {
        ...buildQaTermOptions(db),
        glossaryPolicy: project.glossaryPolicy,
        profile: normalizeQaProfile(project.qaProfile),
        ...(project.tagProfile !== undefined ? { tagProfile: project.tagProfile } : {}),
      }
      const commit = (
        workerResult: LinguistQaWorkerResult,
        completedSegmentIds: readonly string[],
      ) => db.runs.executeMutation({
        identity: {
          runId,
          toolCallId,
          idempotencyKey: `cat_run_qa:${deps.sessionId ?? 'session-unavailable'}:${toolCallId}`,
        },
        operation: 'cat_run_qa',
        payload: {},
        mutate: () => {
          const before = new Map(
            db.qaFindings.list().map((finding) => [finding.id as string, finding]),
          )
          const persistence = {
            runId,
            ...(deps.now === undefined ? {} : { observedAt: deps.now() }),
            ruleVersion: 'deterministic-v1',
          }
          const inputsBySegment = Map.groupBy(
            workerResult.findings,
            (finding) => finding.segmentId as string,
          )
          const findings = completedSegmentIds.flatMap((segmentId) =>
            db.qaFindings.replaceForSegment(
              segmentId,
              inputsBySegment.get(segmentId) ?? [],
              persistence,
            ))
          const severityCounts: CatRunQaResult['severityCounts'] =
            { L0: 0, L1: 0, L2: 0, L3: 0, L4: 0 }
          const dispositionCounts: CatRunQaResult['dispositionCounts'] =
            { defect: 0, needs_review: 0, query: 0, info: 0 }
          for (const finding of findings) {
            severityCounts[finding.severity] += 1
            dispositionCounts[finding.disposition] += 1
          }
          const dto: CatRunQaResult = {
            total: findings.length,
            severityCounts,
            dispositionCounts,
          }
          const changes = db.qaFindings.list().flatMap((finding) => {
            const previous = before.get(finding.id as string)
            if (previous !== undefined && JSON.stringify(previous) === JSON.stringify(finding)) {
              return []
            }
            return [{
              entityType: 'qa-finding' as const,
              entityId: finding.id as string,
              changeKind: previous === undefined ? 'created' as const : 'updated' as const,
              segmentId: finding.segmentId as string,
              expectedRevision: finding.segmentRevision,
              ...(previous === undefined ? {} : { before: previous }),
              after: finding,
            }]
          })
          const resolvedQaFindingIds = db.qaFindings.list().flatMap((finding) => {
            const previous = before.get(finding.id as string)
            return previous?.status === 'open' && finding.status === 'resolved'
              ? [finding.id as string]
              : []
          })
          return {
            result: dto,
            changes,
            event: {
              kind: 'qa-updated' as const,
              segmentIds: completedSegmentIds,
              qaFindingIds: findings.map((finding) => finding.id as string),
              ...(resolvedQaFindingIds.length === 0 ? {} : { resolvedQaFindingIds }),
            },
          }
        },
      })

      let mutation: IdempotentRunMutation<CatRunQaResult>
      if (segments.length === 0) {
        mutation = commit({ findings: [], workerThreadId: 0 }, [])
      } else {
        let latestProgress: WorkerJobProgress | undefined
        const publishProgress = (phase?: 'started' | 'completed'): void => {
          if (latestProgress === undefined) return
          onUpdate?.({
            content: [{
              type: 'text',
              text: phase === undefined
                ? `CAT QA job ${latestProgress.status}: ${latestProgress.cursor}/${latestProgress.total}`
                : `CAT QA worker ${phase}: ${latestProgress.cursor}/${latestProgress.total}`,
            }],
            details: { jobProgress: latestProgress },
          })
        }
        const qaWorker = deps.qaWorker ?? (async (request) => ({
          findings: runQa(request.segments, request.options),
          workerThreadId: 0,
        }))
        mutation = await runQaWorkerJob({
          db,
          runId,
          sessionId: deps.sessionId ?? 'session-unavailable',
          segmentIds: segments.map((segment) => segment.id as string),
          ...(deps.modelId === undefined ? {} : { modelId: deps.modelId }),
          signal,
          onProgress: (next) => {
            latestProgress = next
            publishProgress()
          },
          compute: async (_job, workerSignal) => ({
            result: await qaWorker(
              { segments, options: qaOptions },
              workerSignal,
              (phase) => publishProgress(phase),
            ),
          }),
          commit: (workerResult, job) => commit(workerResult, job.completedSegmentIds),
        })
      }
      if (!mutation.replayed && mutation.event !== undefined) {
        notifyMutation({
          kind: 'qa-updated',
          sequence: mutation.event.sequence,
          segmentIds: mutation.event.segmentIds,
          qaFindingIds: mutation.event.qaFindingIds,
          resolvedQaFindingIds: mutation.event.resolvedQaFindingIds,
        })
      }
      return toolResult(mutation.result, deps.resultProjectId, mutation.event?.segmentIds)
    },
  })

  const getQaFindingsTool = defineTool({
    name: 'cat_get_qa_findings',
    label: 'CAT get QA findings',
    description:
      'Read persisted QA findings from the bound CAT project, optionally filtered by status or severity. ' +
      `Returns at most ${CAT_TOOL_PAGE_LIMITS.getQaFindings.maxLimit} findings per call. ` +
      'This tool cannot resolve or waive findings.',
    promptSnippet: 'Read QA findings from the bound CAT project',
    parameters: Type.Object({
      status: Type.Optional(Type.Union([
        Type.Literal('open'),
        Type.Literal('resolved'),
        Type.Literal('waived'),
      ])),
      severity: Type.Optional(Type.Union([
        Type.Literal('L0'),
        Type.Literal('L1'),
        Type.Literal('L2'),
        Type.Literal('L3'),
        Type.Literal('L4'),
      ])),
      disposition: Type.Optional(Type.Union([
        Type.Literal('defect'),
        Type.Literal('needs_review'),
        Type.Literal('query'),
        Type.Literal('info'),
      ])),
      limit: Type.Optional(Type.Integer({ minimum: 1 })),
      offset: Type.Optional(Type.Integer({ minimum: 0 })),
    }),
    async execute(toolCallId, params) {
      const { db } = resolveBoundProject('cat_get_qa_findings', toolCallId)
      const page = resolvePage(params, CAT_TOOL_PAGE_LIMITS.getQaFindings)
      const filter: QaFindingListFilter = {
        ...(params.status !== undefined ? { status: params.status } : {}),
        ...(params.severity !== undefined ? { severity: params.severity } : {}),
        ...(params.disposition !== undefined ? { disposition: params.disposition } : {}),
      }
      const findings = db.qaFindings.list({ ...filter, limit: page.limit, offset: page.offset })
      const total = db.qaFindings.count(filter)
      const items: CatQaFindingItem[] = findings.map((finding) => {
        const criticReviews = db.criticArtifacts
          .traceByQaFindingId(finding.id as string)
          .flatMap(({ artifact, criticFindingId }) =>
            artifact.schemaVersion === 2
              ? [{
                  reviewId: artifact.artifactId,
                  criticFindingId,
                  proposalId: artifact.snapshot.proposalId,
                  snapshotId: artifact.snapshot.snapshotId,
                  snapshotHash: artifact.snapshot.snapshotHash,
                  reviewerSessionId: artifact.reviewer.sessionId,
                  ...(artifact.reviewer.modelId === undefined
                    ? {}
                    : { reviewerModelId: artifact.reviewer.modelId }),
                  promptVersion: artifact.reviewer.promptVersion,
                }]
              : [])
        return {
          id: finding.id as string,
          segmentId: finding.segmentId as string,
          code: finding.code,
          severity: finding.severity,
          issueType: finding.issueType,
          disposition: finding.disposition,
          message: finding.message,
          status: finding.status,
          segmentRevision: finding.segmentRevision,
          ruleVersion: finding.ruleVersion,
          evidenceHash: finding.evidenceHash,
          firstSeenRunId: finding.firstSeenRunId,
          ...(finding.waiverReason !== undefined ? { waiverReason: finding.waiverReason } : {}),
          ...(criticReviews.length === 0 ? {} : { criticReviews }),
        }
      })
      const dto: PagedResult<CatQaFindingItem> = {
        items,
        total,
        limit: page.limit,
        offset: page.offset,
        hasMore: pageHasMore(total, page.offset, items.length),
        ...(page.note !== undefined ? { note: page.note } : {}),
      }
      return toolResult(dto, deps.resultProjectId, items.map((item) => item.segmentId))
    },
  })

return [runQaTool, getQaFindingsTool] as const
}
