import type {
  AgentToolResult,
  ToolDefinition,
} from '@earendil-works/pi-coding-agent'
import type {
  LinguistGenerationProvenance,
  ProposalIssuanceInput,
  Segment,
  StageEvidenceReceipt,
} from '@linguist/cat-core'
import type { ProjectDatabase } from '@linguist/cat-store'
import type { TSchema } from 'typebox'
import { LinguistCatInvalidArgumentError } from './errors'
import type {
  CatSegmentListItem,
  LinguistCatToolMutation,
  LinguistCatToolName,
  LinguistCatToolsDeps,
  ResolvedLinguistCatProject,
} from './types'

export const defineTool = <
  TParams extends TSchema,
  TDetails = unknown,
  TState = unknown,
>(
  tool: ToolDefinition<TParams, TDetails, TState>,
) => tool

/** 导航元数据只携带首个句段锚点；content 自含模型所需正文，details 保留 UI 导航合同。 */
export function toolResult<TDetails extends object>(
  dto: TDetails,
  projectId?: string,
  segmentIds?: readonly string[],
): AgentToolResult<TDetails> {
  const details: TDetails = projectId === undefined
    ? dto
    : {
        ...dto,
        projectId,
        ...(segmentIds?.[0] !== undefined
          ? { segmentId: segmentIds[0] }
          : {}),
      }
  return {
    content: [{
      type: 'text',
      text: JSON.stringify(details),
    }],
    details,
  }
}

export function toSegmentItem(segment: Segment): CatSegmentListItem {
  return {
    segmentId: segment.id as string,
    id: segment.id as string,
    assetId: segment.assetId as string,
    ordinal: segment.ordinal,
    originalOrdinal: segment.ordinal + 1,
    ...(segment.key !== undefined ? { key: segment.key } : {}),
    status: segment.status,
    locked: segment.locked,
    revision: segment.revision,
    source: segment.source,
    target: segment.target,
  }
}

export interface CatToolRuntime {
  prepareStage: NonNullable<LinguistCatToolsDeps['prepareStage']>
  deps: LinguistCatToolsDeps
  resolveBoundProject: (
    toolName: LinguistCatToolName,
    toolCallId: string,
  ) => ResolvedLinguistCatProject
  notifyMutation: (mutation: LinguistCatToolMutation) => void
  proposalProvenance: (
    toolCallId: string,
  ) => ProposalIssuanceInput & { toolCallId: string; runId: string }
  prepareEvidencePresentation: (
    db: ProjectDatabase,
    toolCallId: string,
    segmentIds: readonly string[],
    evidence: StageEvidenceReceipt['evidence'],
    content: AgentToolResult<unknown>['content'],
  ) => void
}

/** 把宿主 authority 与通知策略集中在一处，具体 Tool 只实现领域行为。 */
export function createCatToolRuntime(
  deps: LinguistCatToolsDeps,
): CatToolRuntime {
  const proposalProvenance = (
    toolCallId: string,
  ): ProposalIssuanceInput & { toolCallId: string; runId: string } => {
    const provided: LinguistGenerationProvenance = deps.generationProvenance?.(toolCallId) ?? {}
    return {
      ...provided,
      ...(provided.sessionId === undefined && deps.sessionId !== undefined
        ? { sessionId: deps.sessionId }
        : {}),
      ...(provided.modelId === undefined && deps.modelId !== undefined
        ? { modelId: deps.modelId }
        : {}),
      toolCallId,
      runId:
        provided.runId
        ?? (deps.sessionId === undefined
          ? `tool:${toolCallId}`
          : `run:${deps.sessionId}:${toolCallId}`),
    }
  }
  return {
    deps,
    prepareStage(segmentIds, task) {
      deps.prepareStage?.(segmentIds, task)
      const scope = deps.reviewScopeSegmentIds
      if (scope !== undefined && segmentIds.some(id => !scope.includes(id))) {
        throw new LinguistCatInvalidArgumentError('segmentIds', 'outside the frozen task scope')
      }
    },
    resolveBoundProject(toolName, toolCallId) {
      const resolved = deps.resolveProject({ toolName, toolCallId })
      if (resolved instanceof Error) throw resolved
      return resolved
    },
    notifyMutation(mutation) {
      try {
        deps.onMutation?.(mutation)
      } catch {
        // 写入已经提交；通知失败不能伪装成失败并诱发模型重复写。
      }
    },
    proposalProvenance,
    prepareEvidencePresentation(db, toolCallId, segmentIds, evidence, content) {
      if (db.readOnly || deps.stageEvidenceRunId === undefined || deps.onEvidencePrepared === undefined) return
      const state = db.stageEvidence.get(deps.stageEvidenceRunId)
      if (state === undefined) throw new Error('Host Stage Evidence state is missing')
      const provenance = proposalProvenance(toolCallId)
      const sessionId = provenance.sessionId ?? deps.sessionId
      if (sessionId === undefined) throw new Error('Host Stage Evidence session is missing')
      const planned = evidence.flatMap(item => {
        const requirement = state.plan.requirements.find(candidate => candidate.evidence.ref.kind === item.ref.kind
          && candidate.evidence.ref.id === item.ref.id)
        return requirement === undefined ? [] : [{ ...item, version: requirement.evidence.version }]
      })
      if (planned.length === 0) return
      deps.onEvidencePrepared({
        stageRunId: state.stageRunId,
        baselineHash: state.baseline.baselineHash,
        sessionId,
        generationRunId: provenance.runId,
        toolCallId,
        segmentIds: [...new Set(segmentIds)],
        evidence: planned,
      }, content)
    },
  }
}
