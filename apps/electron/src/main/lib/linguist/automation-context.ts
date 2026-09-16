import { isDeepStrictEqual } from 'node:util'
import { LINGUIST_ROLES, type AgentSessionMeta, type Automation, type AutomationLinguistCapture, type AutomationLinguistContext } from '@proma/shared'
import type { AgentSessionLinguistBinding } from '../agent-session-manager'
import { getLinguistProjectService, type LinguistProjectService } from './project-service'
import { LinguistProjectNotFoundError, LinguistProjectUnhealthyError } from './errors'
import { validateLinguistScopeOwnership, validateLinguistTurnContextForSession } from './turn-context-validator'

/** session 与 turnContext 来自请求对应的宿主快照，绝不重新读取 Renderer 当前选区。 */
export function captureAutomationLinguistContext(
  capture: AutomationLinguistCapture,
  session: AgentSessionMeta | undefined,
  workspaceId: string | undefined,
  getService: () => LinguistProjectService = getLinguistProjectService,
): AutomationLinguistContext | undefined {
  if (!['context', 'project', 'asset', 'segments', 'none'].includes(capture.scope)) throw new Error('未知定时任务范围')
  if (capture.scope === 'none') return undefined
  if (!session?.linguistProjectId || session.workspaceId !== workspaceId) {
    if (capture.scope === 'context') return undefined
    throw new Error('所选范围需要同工作区的合法 Linguist 来源会话')
  }
  const role = capture.role ?? 'general'
  if (!LINGUIST_ROLES.includes(role)) throw new Error('未知 Linguist 岗位')
  const service = getService()
  const project = service.getProject(session.linguistProjectId)
  if (project.promaWorkspaceId !== workspaceId) throw new Error('Linguist 项目与目标工作区不一致')
  let scope: AutomationLinguistContext['scope']
  let capturedAt = new Date().toISOString()
  if (capture.scope === 'project') scope = { kind: 'project' }
  if (capture.scope === 'asset' || capture.scope === 'segments') {
    const { context, selectionTruncated } = validateLinguistTurnContextForSession(capture.turnContext, session, service)
    if (!context.assetId) throw new Error('本轮快照未绑定批次，不能猜测当前批次')
    capturedAt = context.capturedAt
    if (capture.scope === 'asset') scope = { kind: 'asset', assetId: context.assetId }
    else {
      if (selectionTruncated) throw new Error('选区超过 100 段或已截断；请明确整个批次或提供完整批准范围，不能仅保存前 100 段')
      if (context.selectedSegmentIds.length === 0) throw new Error('本轮快照没有选择句段')
      scope = { kind: 'segments', assetId: context.assetId, segmentIds: [...context.selectedSegmentIds] }
    }
  }
  return { projectId: project.id, role, ...(scope ? { scope } : {}), capturedAt }
}

/** 快照已持久化后不依赖来源会话；实体不可用由实际 CAT 访问报告，原生工具仍可执行。 */
export function automationSessionBinding(automation: Automation, service: LinguistProjectService): AgentSessionLinguistBinding | undefined {
  const context = automation.linguistContext
  if (!context) return undefined
  let name = context.projectId
  try {
    const project = service.getProject(context.projectId)
    if (project.promaWorkspaceId !== automation.workspaceId) throw new Error('定时任务项目与工作区不一致')
    name = project.name
  } catch (error) {
    if (!(error instanceof LinguistProjectNotFoundError || error instanceof LinguistProjectUnhealthyError)) throw error
  }
  return { linguistProjectId: context.projectId, linguistProjectName: name, linguistRole: context.role, automationLinguistContext: structuredClone(context) }
}

export function automationSessionMatches(automation: Automation, session: AgentSessionMeta): boolean {
  const context = automation.linguistContext
  return session.sourceAutomationId === automation.id
    && session.workspaceId === automation.workspaceId
    && session.linguistProjectId === context?.projectId
    && (!context || session.linguistRole === context.role)
    && isDeepStrictEqual(session.automationLinguistContext, context)
}

/** 每次运行的批次范围在首次领域访问冻结，后续 UI 变化不参与。 */
export function resolveAutomationSegmentScope(context: AutomationLinguistContext, service: LinguistProjectService): readonly string[] | undefined {
  const scope = context.scope
  if (!scope) return undefined
  const db = validateLinguistScopeOwnership(service, context.projectId, scope.kind === 'project' ? undefined : scope.assetId, scope.kind === 'segments' ? scope.segmentIds : [])
  return scope.kind === 'segments' ? [...scope.segmentIds] : db.segments.queryIds(scope.kind === 'asset' ? { assetId: scope.assetId } : undefined)
}
