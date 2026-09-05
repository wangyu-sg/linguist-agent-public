import type {
  AgentSessionMeta,
  LinguistDelegatedScope,
  LinguistDelegationOutcome,
  LinguistRole,
} from '@proma/shared'
import { getLinguistProjectService } from './project-service'

export interface LinguistDelegationRequest {
  linguistRole?: Exclude<LinguistRole, 'general'>
  linguistScope?: {
    batchId?: string
    assetIds?: string[]
    segmentIds?: string[]
  }
}

export interface LinguistDelegationMetadata {
  role: LinguistRole
  projectId: string
  projectName: string
  scope: LinguistDelegatedScope
}

const ROLE_STAGE: Record<
  LinguistDelegationOutcome['role'],
  LinguistDelegationOutcome['stage']
> = {
  translator: 'translation',
  reviewer: 'editing',
  proofreader: 'proofreading',
}

function freezeScope(
  parent: AgentSessionMeta & { linguistProjectId: string },
  input: LinguistDelegationRequest['linguistScope'],
): LinguistDelegatedScope {
  const db = getLinguistProjectService().openProject(parent.linguistProjectId)
  const assetIds = [...new Set([
    ...(input?.batchId ? [input.batchId] : []),
    ...(input?.assetIds ?? []),
  ])]
  const segmentIds = [...new Set(input?.segmentIds ?? [])]
  for (const assetId of assetIds) {
    if (!db.assets.get(assetId)) throw new Error(`Linguist 委派批次不存在: ${assetId}`)
    segmentIds.push(...db.segments.queryIds({ assetId }))
  }
  const frozenSegmentIds = [...new Set(segmentIds)]
  const effectiveSegmentIds = frozenSegmentIds.length > 0 || input !== undefined
    ? frozenSegmentIds
    : db.segments.queryIds()
  const found = new Set(db.segments.getByIds(effectiveSegmentIds).map((segment) => segment.id as string))
  const missing = effectiveSegmentIds.find((segmentId) => !found.has(segmentId))
  if (missing) throw new Error(`Linguist 委派 Segment 不存在: ${missing}`)
  if (effectiveSegmentIds.length === 0) throw new Error('Linguist 委派范围没有 Segment')
  return { assetIds, segmentIds: effectiveSegmentIds }
}

export function resolveLinguistDelegationMetadata(
  parent: AgentSessionMeta | undefined,
  request: LinguistDelegationRequest,
): LinguistDelegationMetadata | undefined {
  if (!parent?.linguistProjectId) {
    if (!request.linguistRole) return undefined
    throw new Error('只有 Linguist General 会话可以委派本地化岗位')
  }
  if (parent.linguistRole !== 'general') {
    if (!request.linguistRole) return undefined
    throw new Error('只有 Linguist General 会话可以委派本地化岗位')
  }
  return {
    role: request.linguistRole ?? 'general',
    projectId: parent.linguistProjectId,
    projectName: parent.linguistProjectName ?? parent.linguistProjectId,
    scope: freezeScope(parent as AgentSessionMeta & { linguistProjectId: string }, request.linguistScope),
  }
}

/** 委派状态只代表进程结束；完成度实时读取冻结范围的 CAT 审计事件。 */
export function resolveLinguistDelegationOutcome(
  session: AgentSessionMeta | undefined,
): LinguistDelegationOutcome | undefined {
  const role = session?.linguistRole
  const projectId = session?.linguistProjectId
  const segmentIds = session?.linguistDelegatedScope?.segmentIds
  if (role !== 'translator' && role !== 'reviewer' && role !== 'proofreader') return undefined
  if (!projectId || !segmentIds) return undefined

  try {
    const stage = ROLE_STAGE[role]
    const db = getLinguistProjectService().openProject(projectId)
    const evidenceState = db.stageEvidence.list(stage).find(state => state.sessionId === session.id)
    const evidence = evidenceState === undefined ? undefined : db.stageEvidence.getCompletion(evidenceState.stageRunId)
    const coverage = evidence?.decisions ?? db.segments.getStageDecisionCoverage(stage, segmentIds, {
      actor: session.id, afterEventId: Number.MAX_SAFE_INTEGER,
    })
    const status = evidence === undefined || evidence.status === 'complete'
      ? coverage.status
      : evidence.status === 'in_progress'
        ? 'in_progress'
        : 'completed_with_blocks'
    return {
      role,
      stage,
      ...coverage,
      status,
      decided: coverage.total - coverage.pending,
      ...(evidence === undefined
        ? {}
        : {
            evidence: {
              status: evidence.status,
              required: evidence.presentation.required,
              presented: evidence.presentation.presented,
              pending: evidence.presentation.pending.length,
              blockingGaps: evidence.blockingGaps.length,
              warnings: evidence.warnings.length,
            },
          }),
    }
  } catch (error) {
    console.warn(`[协作工具] 无法读取 Linguist 委派完成证据: ${session.id}`, error)
    return undefined
  }
}
