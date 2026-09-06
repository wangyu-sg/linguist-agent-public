import type {
  WorkflowStage,
  WorkflowStageDecision,
} from '@linguist/cat-core'
import { Type } from 'typebox'
import { LinguistCatInvalidArgumentError } from './errors'
import type { CatConfirmSegmentsResult } from './types'
import {
  defineTool,
  toolResult,
  type CatToolRuntime,
} from './tool-runtime'

const ROLE_STAGE: Partial<Record<
  NonNullable<CatToolRuntime['deps']['linguistRole']>,
  WorkflowStage
>> = {
  translator: 'translation',
  reviewer: 'editing',
  proofreader: 'proofreading',
}

/** 岗位逐段完成证据；stage 与委派 scope 都只来自宿主 Session。 */
export function createStageTools(runtime: CatToolRuntime) {
  const { deps, notifyMutation, resolveBoundProject } = runtime

  const confirmSegmentsTool = defineTool({
    name: 'cat_confirm_segments',
    label: 'CAT confirm reviewed segments',
    description: 'Persist unchanged, corrected or blocked decisions for 1-200 segments of the current trusted professional role and frozen task. This is a write, not a progress query. Do not call for report-only, proposal-only or chat-only tasks; use cat_project_summary for a read-only status check. Read the full Source/current Target before unchanged. For corrected, first successfully apply the Target and use its new revision. Never confirm a failed write or a pending proposal as corrected. blocked records an unresolved segment and is not successful completion. Stage, revision, actor and evidence checks remain enforced by the existing store; decide task completion from the returned full state, not only the number of decisions.',
    promptSnippet: 'Record explicit per-segment completion decisions for the current Linguist role',
    parameters: Type.Object({
      items: Type.Array(Type.Object({
        segmentId: Type.String({ minLength: 1 }),
        expectedRevision: Type.Integer({ minimum: 0, description: 'Current Target revision actually read or returned after a successful apply. Never guess or reuse the pre-edit revision when confirming a correction.' }),
        decision: Type.Union([
          Type.Literal('unchanged'),
          Type.Literal('corrected'),
          Type.Literal('blocked'),
        ]),
      }), { minItems: 1, maxItems: 200 }),
    }),
    async execute(toolCallId, params) {
      if (params.items.length < 1 || params.items.length > 200) {
        throw new LinguistCatInvalidArgumentError('items', 'expected 1-200 items')
      }
      const { db } = resolveBoundProject('cat_confirm_segments', toolCallId)
      const stage = deps.linguistRole === undefined
        ? undefined
        : ROLE_STAGE[deps.linguistRole]
      if (stage === undefined) {
        throw new LinguistCatInvalidArgumentError(
          'linguistRole',
          'cat_confirm_segments requires a Translator, Reviewer, or Proofreader session',
        )
      }
      const itemIds = params.items.map((item) => item.segmentId)
      runtime.prepareStage(itemIds)
      if (new Set(itemIds).size !== itemIds.length) {
        throw new LinguistCatInvalidArgumentError('items', 'segmentId values must be unique')
      }
      const delegatedScope = deps.reviewScopeSegmentIds
      const runId = deps.sessionId === undefined
        ? `tool:${toolCallId}`
        : `run:${deps.sessionId}:${toolCallId}`
      const now = deps.now?.()
      const mutation = db.runs.executeMutation({
        identity: {
          runId,
          toolCallId,
          idempotencyKey: `cat_confirm_segments:${deps.stageEvidenceRunId ?? 'unscoped'}:${runId}:${toolCallId}`,
        },
        operation: 'cat_confirm_segments',
        payload: params,
        mutate: () => {
          const decisions = params.items.map((item) => {
            const result = db.segments.recordCurrentStageDecision(
              item.segmentId,
              stage,
              item.expectedRevision,
              item.decision as WorkflowStageDecision,
              {
                ...(deps.sessionId === undefined ? {} : { actor: deps.sessionId }),
                ...(now === undefined ? {} : { now }),
              },
            )
            return {
              segmentId: item.segmentId,
              decision: item.decision as WorkflowStageDecision,
              revision: result.event.segmentRevision,
            }
          })
          return {
            result: { decisions },
            changes: [],
            event: {
              kind: 'project-updated' as const,
              segmentIds: itemIds,
            },
          }
        },
      })
      const coverageIds = delegatedScope ?? itemIds
      const evidenceState = deps.stageEvidenceRunId === undefined
        ? undefined
        : db.stageEvidence.get(deps.stageEvidenceRunId)
      if (deps.stageEvidenceRunId !== undefined && evidenceState === undefined) {
        throw new Error('Host Stage Evidence state is missing')
      }
      const completion = evidenceState === undefined
        ? undefined
        : db.stageEvidence.getCompletion(evidenceState.stageRunId)
      const coverage = completion?.decisions ?? db.segments.getStageDecisionCoverage(stage, coverageIds)
      const dto: CatConfirmSegmentsResult = {
        stage,
        decisions: mutation.result.decisions,
        coverage: {
          scope: delegatedScope === undefined ? 'items' : 'delegated',
          ...coverage,
        },
        ...(completion === undefined
          ? {}
          : {
              fullReview: {
                status: completion.status,
                requiredEvidence: completion.presentation.required,
                presentedEvidence: completion.presentation.presented,
                pendingEvidence: completion.presentation.pending.length,
                blockingGaps: completion.blockingGaps.length,
                warnings: completion.warnings.length,
              },
            }),
        replayed: mutation.replayed,
      }
      if (!mutation.replayed && mutation.event !== undefined) {
        notifyMutation({
          kind: 'project-updated',
          sequence: mutation.event.sequence,
          segmentIds: mutation.event.segmentIds,
        })
      }
      return toolResult(dto, deps.resultProjectId, itemIds)
    },
  })

  return [confirmSegmentsTool] as const
}
