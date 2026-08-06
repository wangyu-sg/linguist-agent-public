/**
 * LA-TRANS-001 Translation Scope / Coverage Ledger。
 *
 * 模型用 cat_begin_translation_scope 声明翻译范围，服务端把段 ID 与
 * baseRevision 冻结进 translation_jobs（复用 run-harness，不新建表）；
 * cat_finalize_translation_scope 不接受模型自报的完成度——逐段按 DB 真值
 * 推导覆盖等式 requested = proposalCreated + blocked + skipped + failed
 * （proposalCreated = 该段存在 pending Proposal），存在未解释 pending/failed
 * 时以 TRANSLATION_SCOPE_INCOMPLETE 拒绝并返回各类精确计数；全部解释后
 * checkpoint 全量范围并落库 completed（job-updated project event 随
 * transition 追加）。finalize 幂等：已 completed 的 scope 按持久化 job 行
 * 重建同一计数重放。
 *
 * provenance.kind = 'translation-scope'（TranslationJobProvenance 之外的
 * 附加 opaque 字段，store 校验后随 provenance_json 持久化），与 QA /
 * consistency worker 的 job 在 diagnostics recentJob 中区分。
 */

import { StoreJobStateError, translationJobScopeDigest, type TranslationJob } from '@linguist/cat-store'
import { Type } from 'typebox'
import {
  LinguistCatInvalidArgumentError,
  LinguistCatTranslationScopeIncompleteError,
} from './errors'
import { defineTool, toolResult, type CatToolRuntime } from './tool-runtime'
import type {
  CatBeginTranslationScopeResult,
  CatFinalizeTranslationScopeResult,
  CatTranslationScopeCoverage,
} from './types'

/** scope 段数硬上限（与输出纪律一致：每次调用有界）；更大范围拆多个 scope。 */
const SCOPE_MAX_SEGMENTS = 500
/** openItemIds 前缀：finalize 重放时据此把 failed 拆回 skipped / blocked。 */
const SKIP_OPEN_ITEM_PREFIX = 'translation-scope-skip:'
const BLOCKED_OPEN_ITEM_PREFIX = 'translation-scope-blocked:'

function sameScope(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index])
}

/** 已 completed 的 scope 只从持久化 job 行重建计数，保证幂等重放结果逐字节一致。 */
function coverageFromCompletedJob(job: TranslationJob): CatTranslationScopeCoverage {
  return {
    requested: job.segmentIds.length,
    proposalCreated: job.completedSegmentIds.length,
    skipped: job.openItemIds.filter((id) => id.startsWith(SKIP_OPEN_ITEM_PREFIX)).length,
    blocked: job.openItemIds.filter((id) => id.startsWith(BLOCKED_OPEN_ITEM_PREFIX)).length,
    failed: 0,
    pending: 0,
  }
}

/** 翻译范围声明与覆盖结算。 */
export function createTranslationScopeTools(runtime: CatToolRuntime) {
  const { deps, notifyMutation, resolveBoundProject } = runtime

  const beginTranslationScopeTool = defineTool({
    name: 'cat_begin_translation_scope',
    label: 'CAT begin translation scope',
    description:
      'Declare a frozen translation scope in the bound project before translating. The server snapshots the given ' +
      'segment ids and their current revisions into a durable translation job and returns its scopeJobId plus a ' +
      'scopeDigest hash binding the frozen ids and revisions. This tool ' +
      'creates no proposals and never changes segments: translate with cat_propose_translations, then close the ' +
      'ledger with cat_finalize_translation_scope. Submit 1-500 existing segment ids from cat_get_segments.',
    promptSnippet: 'Freeze a translation scope before proposing translations',
    promptGuidelines: [
      'Begin the scope before proposing, and finalize the returned scopeJobId when the batch is done.',
      'Coverage is derived from the database at finalize, never from self-reported progress.',
    ],
    parameters: Type.Object({
      segmentIds: Type.Array(Type.String({ minLength: 1 }), {
        minItems: 1,
        maxItems: SCOPE_MAX_SEGMENTS,
      }),
    }),
    async execute(toolCallId, params) {
      // binding 校验永远先于参数触碰（未绑定会话必须抛 BINDING_MISSING）。
      const { db } = resolveBoundProject('cat_begin_translation_scope', toolCallId)
      const segmentIds = [...new Set(params.segmentIds)]
      if (segmentIds.length !== params.segmentIds.length) {
        throw new LinguistCatInvalidArgumentError('segmentIds', 'must not contain duplicates')
      }
      if (segmentIds.length < 1 || segmentIds.length > SCOPE_MAX_SEGMENTS) {
        throw new LinguistCatInvalidArgumentError('segmentIds', `expected 1-${SCOPE_MAX_SEGMENTS} items`)
      }
      const sessionId = deps.sessionId ?? 'session-unavailable'
      const runId = `translation-scope:${sessionId}:${toolCallId}`
      const scopeJobId = `job:translation-scope:${sessionId}:${toolCallId}`
      const authority = { sessionId }
      const existing = db.runs.getJob(scopeJobId, authority)
      if (existing !== undefined) {
        // 同 toolCallId 重放：身份与冻结范围必须逐段一致，否则是编程错误。
        if (existing.runId !== runId || !sameScope(existing.segmentIds, segmentIds)) {
          throw new StoreJobStateError(scopeJobId, 'existing job identity or frozen scope differs')
        }
        const replay: CatBeginTranslationScopeResult = {
          scopeJobId,
          runId,
          status: existing.status,
          requested: existing.segmentIds.length,
          scopeDigest: translationJobScopeDigest(existing.segmentIds, existing.baseRevisions),
          replayed: true,
        }
        return toolResult(replay, deps.resultProjectId, existing.segmentIds)
      }
      const provenance = {
        schemaVersion: 1 as const,
        runtime: 'pi-agent',
        role: 'assistant' as const,
        promptVersion: 'translation-scope-v1',
        kind: 'translation-scope',
        ...(deps.modelId === undefined ? {} : { modelId: deps.modelId }),
      }
      // createJob 在插入同事务内快照每段 baseRevision；未知段在此 fail closed。
      const job = db.runs.createJob({
        jobId: scopeJobId,
        runId,
        sessionId,
        strategy: 'balanced',
        segmentIds,
        provenance,
      })
      const running = db.runs.transitionJob(job.jobId, authority, 'running')
      const dto: CatBeginTranslationScopeResult = {
        scopeJobId,
        runId,
        status: running.status,
        requested: running.segmentIds.length,
        scopeDigest: translationJobScopeDigest(running.segmentIds, running.baseRevisions),
        replayed: false,
      }
      return toolResult(dto, deps.resultProjectId, running.segmentIds)
    },
  })

  const finalizeTranslationScopeTool = defineTool({
    name: 'cat_finalize_translation_scope',
    label: 'CAT finalize translation scope',
    description:
      'Close a translation scope ledger in the bound project. The server derives the coverage equation from the ' +
      'database for every scoped segment: requested = proposalCreated + blocked + skipped + failed, where ' +
      'proposalCreated means a pending proposal exists for the segment. Segments that are locked, stale since ' +
      'begin, or missing count as failed unless explained. If any segment is unexplained (pending) or failed, ' +
      'finalize is refused with precise per-category counts. When everything is explained the job is persisted ' +
      'as completed with a project event; repeating the same finalize replays the recorded counts.',
    promptSnippet: 'Close the translation scope with a server-derived coverage ledger',
    promptGuidelines: [
      'Declare explanations only for segments you did not propose: kind skipped or blocked, each with a concrete reason.',
      'Never explain a segment that already has a pending proposal; contradiction fails the call.',
      'On TRANSLATION_SCOPE_INCOMPLETE, propose translations or add explanations for the counted segments, then finalize again.',
    ],
    parameters: Type.Object({
      scopeJobId: Type.String({ minLength: 1 }),
      explanations: Type.Optional(Type.Array(
        Type.Object({
          segmentId: Type.String({ minLength: 1 }),
          kind: Type.Union([Type.Literal('skipped'), Type.Literal('blocked')]),
          reason: Type.String({ minLength: 1 }),
        }),
        { maxItems: SCOPE_MAX_SEGMENTS },
      )),
    }),
    async execute(toolCallId, params) {
      const { db } = resolveBoundProject('cat_finalize_translation_scope', toolCallId)
      const explanations = params.explanations ?? []
      if (explanations.length > SCOPE_MAX_SEGMENTS) {
        throw new LinguistCatInvalidArgumentError('explanations', `expected at most ${SCOPE_MAX_SEGMENTS} items`)
      }
      const explained = new Map<string, 'skipped' | 'blocked'>()
      for (const item of explanations) {
        if (item.reason.trim() === '') {
          throw new LinguistCatInvalidArgumentError('explanations.reason', 'expected a non-empty reason')
        }
        if (explained.has(item.segmentId)) {
          throw new LinguistCatInvalidArgumentError(
            'explanations',
            `duplicate explanation for segment ${item.segmentId}`,
          )
        }
        explained.set(item.segmentId, item.kind)
      }
      const sessionId = deps.sessionId ?? 'session-unavailable'
      const authority = { sessionId }
      // 只接受本会话 begin 的 scope；跨会话 job id 由 store authority fail closed。
      const job = db.runs.getJob(params.scopeJobId, authority)
      if (job === undefined) {
        throw new LinguistCatInvalidArgumentError(
          'scopeJobId',
          'unknown translation scope; call cat_begin_translation_scope first',
        )
      }
      if (job.status === 'completed') {
        // 幂等重放：首次 finalize 的 checkpoint 已冻结结果，按 job 行原样重建。
        const replay: CatFinalizeTranslationScopeResult = {
          scopeJobId: job.jobId,
          runId: job.runId,
          status: 'completed',
          replayed: true,
          scopeDigest: translationJobScopeDigest(job.segmentIds, job.baseRevisions),
          coverage: coverageFromCompletedJob(job),
        }
        return toolResult(replay, deps.resultProjectId, job.segmentIds)
      }
      for (const segmentId of explained.keys()) {
        if (!job.segmentIds.includes(segmentId)) {
          throw new LinguistCatInvalidArgumentError(
            'explanations',
            `segment ${segmentId} is outside the frozen scope`,
          )
        }
      }

      // 逐段按 DB 真值推导：pending Proposal 才算 proposalCreated；模型申报只解释 skipped/blocked。
      const proposalCreatedIds: string[] = []
      const pendingProposalIds: string[] = []
      const skippedIds: string[] = []
      const blockedIds: string[] = []
      const failedIds: string[] = []
      const pendingIds: string[] = []
      for (const segmentId of job.segmentIds) {
        const pendingProposals = db.proposals.listBySegment(segmentId, 'pending')
        if (pendingProposals.length > 0) {
          if (explained.has(segmentId)) {
            throw new LinguistCatInvalidArgumentError(
              'explanations',
              `segment ${segmentId} already has a pending proposal and cannot be explained`,
            )
          }
          proposalCreatedIds.push(segmentId)
          pendingProposalIds.push(...pendingProposals.map((proposal) => proposal.id as string))
          continue
        }
        const kind = explained.get(segmentId)
        if (kind === 'skipped') {
          skippedIds.push(segmentId)
          continue
        }
        if (kind === 'blocked') {
          blockedIds.push(segmentId)
          continue
        }
        const segment = db.segments.getById(segmentId)
        if (
          segment === undefined
          || segment.locked
          || segment.revision !== job.baseRevisions[segmentId]
        ) {
          // 派生失败：begin 后段被锁定 / 改写 / 删除，且模型未给解释。
          failedIds.push(segmentId)
        } else {
          pendingIds.push(segmentId)
        }
      }
      const coverage: CatTranslationScopeCoverage = {
        requested: job.segmentIds.length,
        proposalCreated: proposalCreatedIds.length,
        skipped: skippedIds.length,
        blocked: blockedIds.length,
        failed: failedIds.length,
        pending: pendingIds.length,
      }
      if (failedIds.length > 0 || pendingIds.length > 0) {
        throw new LinguistCatTranslationScopeIncompleteError(coverage, pendingIds, failedIds)
      }

      // 全部解释：checkpoint 冻结覆盖（completed=proposalCreated，failed=skipped+blocked，
      // 解释记 openItemIds，pending 提案记 proposalIds），再 transition 落库 completed。
      // checkpoint 与 transition 各自追加 job-updated project event；中途崩溃可由
      // 同参数 finalize 幂等恢复（checkpoint 单调、completed 早退重放）。
      if (job.status !== 'running') {
        db.runs.transitionJob(job.jobId, authority, 'running')
      }
      db.runs.checkpointJob({
        jobId: job.jobId,
        sessionId,
        cursor: job.segmentIds.length,
        completedSegmentIds: proposalCreatedIds,
        failedSegmentIds: [...skippedIds, ...blockedIds],
        proposalIds: pendingProposalIds,
        openItemIds: [
          ...skippedIds.map((segmentId) => `${SKIP_OPEN_ITEM_PREFIX}${segmentId}`),
          ...blockedIds.map((segmentId) => `${BLOCKED_OPEN_ITEM_PREFIX}${segmentId}`),
        ],
      })
      const completed = db.runs.transitionJob(job.jobId, authority, 'completed')
      const latestEvent = db.runs.getLatestEvent()
      if (latestEvent !== undefined) {
        notifyMutation({
          kind: 'project-updated',
          sequence: latestEvent.sequence,
          segmentIds: job.segmentIds,
        })
      }
      const dto: CatFinalizeTranslationScopeResult = {
        scopeJobId: completed.jobId,
        runId: completed.runId,
        status: 'completed',
        replayed: false,
        scopeDigest: translationJobScopeDigest(completed.segmentIds, completed.baseRevisions),
        coverage,
      }
      return toolResult(dto, deps.resultProjectId, completed.segmentIds)
    },
  })

  return [beginTranslationScopeTool, finalizeTranslationScopeTool] as const
}
