import {
  parseLinguistTurnContextV1,
  serializeLinguistTurnContextV1,
  type AgentSessionMeta,
  type LinguistTurnContextParseResult,
  type LinguistTurnContextV1,
} from '@proma/shared'
import type { LinguistProjectService } from './project-service'

export class LinguistTurnContextOwnershipError extends Error {
  override readonly name = 'LinguistTurnContextOwnershipError'
}

type LinguistProjectServiceResolver = () => LinguistProjectService

/**
 * LF-060 主进程 authority seam：结构校验后，再以冻结的 Session binding 和
 * 项目数据库验证全部 opaque ID。Context 只能描述当前绑定，不能改变绑定。
 */
export function validateLinguistTurnContextForSession(
  value: unknown,
  session: Pick<AgentSessionMeta, 'linguistProjectId'> | undefined,
  service: LinguistProjectService,
): LinguistTurnContextParseResult {
  const parsed = parseLinguistTurnContextV1(value)
  const { context } = parsed

  if (session?.linguistProjectId === undefined) {
    throw new LinguistTurnContextOwnershipError('session is not bound to a Linguist project')
  }
  if (session.linguistProjectId !== context.projectId) {
    throw new LinguistTurnContextOwnershipError('context project does not match session binding')
  }

  service.getProject(context.projectId)
  const db = service.openProject(context.projectId)
  if (context.assetId !== undefined && db.assets.get(context.assetId) === undefined) {
    throw new LinguistTurnContextOwnershipError('context asset does not belong to bound project')
  }

  const segmentIds = new Set(context.selectedSegmentIds)
  if (context.activeSegmentId !== undefined) segmentIds.add(context.activeSegmentId)
  for (const segmentId of segmentIds) {
    if (db.segments.getById(segmentId) === undefined) {
      throw new LinguistTurnContextOwnershipError('context segment does not belong to bound project')
    }
  }

  if (
    context.activeQaFindingId !== undefined
    && db.qaFindings.getById(context.activeQaFindingId) === undefined
  ) {
    throw new LinguistTurnContextOwnershipError(
      'context QA finding does not belong to bound project',
    )
  }

  return parsed
}

/**
 * LF-062 Agent Turn 闸门：绑定会话必须携带快照，普通会话禁止伪造快照。
 * 仅绑定会话才解析项目服务，避免普通 Agent 被 Linguist 服务可用性影响。
 */
export function validateLinguistTurnContextForAgentTurn(
  value: unknown,
  session: Pick<AgentSessionMeta, 'linguistProjectId'> | undefined,
  getService: LinguistProjectServiceResolver,
): LinguistTurnContextParseResult | undefined {
  const parsed = parseLinguistTurnContextForAgentTurn(value, session)
  if (!parsed) return undefined
  validateLinguistTurnContextForSession(parsed.context, session, getService())
  return parsed
}

/** 不访问项目服务的 wire/binding 预检；实体归属仍由上方 authority seam 完成。 */
export function parseLinguistTurnContextForAgentTurn(
  value: unknown,
  session: Pick<AgentSessionMeta, 'linguistProjectId'> | undefined,
): LinguistTurnContextParseResult | undefined {
  if (session?.linguistProjectId === undefined) {
    if (value !== undefined) {
      throw new LinguistTurnContextOwnershipError(
        'session is not bound to a Linguist project',
      )
    }
    return undefined
  }
  if (value === undefined) {
    throw new LinguistTurnContextOwnershipError(
      'bound Linguist session requires a context snapshot',
    )
  }
  const parsed = parseLinguistTurnContextV1(value)
  if (parsed.context.projectId !== session.linguistProjectId) {
    throw new LinguistTurnContextOwnershipError(
      'context project does not match session binding',
    )
  }
  return parsed
}

/** Host-owned 结构化块；只包含已验证的 V1 opaque IDs、时间与 UI revision。 */
export function buildLinguistTurnContextBlock(
  context: Readonly<LinguistTurnContextV1>,
): string {
  return [
    '<linguist_turn_context schema_version="1">',
    serializeLinguistTurnContextV1(context),
    '</linguist_turn_context>',
  ].join('\n')
}
