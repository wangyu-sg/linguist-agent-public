/**
 * Linguist 项目 ↔ Agent 会话绑定（PB-034；计划 §7.2「Project → Session 绑定」）。
 *
 * 「项目对话」是携带 `linguistProjectId` 的 Pi Agent 会话（AgentSessionMeta，
 * 持久化于 ~/.linguist-agent/agent-sessions.json，重启后绑定仍在）。Chat 模式的
 * Conversation 没有工作区/runtime 概念，Batch 4 的 CAT customTools 只会
 * 装配进 Pi 会话，因此绑定只存在于 Agent 会话栈。
 *
 * 生命周期硬规则（计划 PB-034）：
 * 1. 普通对话（侧栏新建）绝不携带 linguistProjectId；
 * 2. 项目内创建的对话携带绑定（+ 项目名快照，供徽章在缺失时仍可展示）；
 * 3. 绑定创建时冻结——没有任何重绑定 API；仅用户可通过专用 API 永久
 *    解绑。切换 Projects UI 选中项目不影响任何已存在会话；
 * 4. 项目归档后绑定会话只读：历史可读，发送在主进程被拒
 *    （checkLinguistSessionSendBlock，orchestrator 在 preflight 调用）；
 * 5. 项目目录缺失/损坏或服务不可用时保留历史，但发送 fail closed；只有
 *    项目恢复正常或用户显式解绑后才能继续。
 *
 * 本模块刻意不 import electron：node --test 直接驱动（tmp HOME +
 * 真实 LinguistProjectService + 真实会话索引）。
 */

import { existsSync, readFileSync } from 'node:fs'
import type {
  AgentSessionMeta,
  LinguistProjectInfo,
  LinguistSessionBindingInfo,
  LinguistSessionBindingStatus,
  TypedError,
} from '@proma/shared'
import { createAgentSession, listAgentSessions } from '../agent-session-manager'
import { LinguistProjectArchivedError } from './errors'
import type { LinguistProjectService } from './project-service'

/** 惰性解析服务单例（与 project-ipc.ts 同一模式：注册时服务可能尚未 init）。 */
export type LinguistServiceResolver = () => LinguistProjectService

/**
 * 实时解析绑定状态：绑定本身冻结，项目状态每次调用重新求值
 * （重启后自然重新判定；归档/删除目录即刻反映）。
 *
 * missing 判定：项目索引（projects.json）不含该 id（PROJECT_NOT_FOUND），
 * 或 project.json 缺失/不可解析。注意 store 的 getProject 只读索引——
 * 目录被外部删除时索引条目仍在，因此必须补这个廉价的磁盘在场检查
 * （完整健康检查仍是详情面板的职责，此处不做 blob 抽查）。
 */
export function resolveLinguistBindingStatus(
  projectId: string,
  service: LinguistProjectService,
): LinguistSessionBindingStatus {
  let archived = false
  try {
    const project = service.getProject(projectId)
    archived = project.archivedAt !== undefined
  } catch {
    // PROJECT_NOT_FOUND（索引无此项目）等 → 降级语义：不崩 App。
    return 'missing'
  }
  try {
    const { projectJsonPath } = service.getProjectPaths(projectId)
    if (!existsSync(projectJsonPath)) return 'missing'
    JSON.parse(readFileSync(projectJsonPath, 'utf-8'))
  } catch {
    return 'missing'
  }
  return archived ? 'archived' : 'active'
}

/** 查询会话的项目绑定；普通会话（无 linguistProjectId）返回 null。 */
export function getLinguistSessionBinding(
  session: Pick<AgentSessionMeta, 'linguistProjectId' | 'linguistProjectName'> | null | undefined,
  service: LinguistProjectService,
): LinguistSessionBindingInfo | null {
  const projectId = session?.linguistProjectId
  if (!projectId) return null
  const status = resolveLinguistBindingStatus(projectId, service)
  const binding: LinguistSessionBindingInfo = {
    projectId,
    projectName: session!.linguistProjectName ?? projectId,
    status,
  }
  if (status !== 'missing') {
    try {
      binding.project = service.getProject(projectId) as LinguistProjectInfo
    } catch {
      // getProject 竞态（判定后刚被删）：保持 missing 语义，不携带 project。
    }
  }
  return binding
}

/**
 * 在项目内创建对话：项目必须存在且未归档（归档项目只读，fail closed），
 * 产物为 Pi Agent 会话，元数据携带 linguistProjectId + 项目名快照。
 * PB-082：role='reviewer' 时创建独立评审会话（meta 写入冻结的
 * linguistSessionRole:'reviewer' 标记，skill 注入走 project-reviewer）。
 */
export function createLinguistProjectChatSession(
  service: LinguistProjectService,
  input: { projectId: string; title?: string; role?: 'reviewer' | 'auditor' },
): AgentSessionMeta {
  const project = service.getProject(input.projectId)
  if (project.archivedAt !== undefined) {
    throw new LinguistProjectArchivedError(input.projectId)
  }
  const title = input.title?.trim() || project.name
  return createAgentSession(title, undefined, undefined, undefined, 'pi', {
    linguistProjectId: project.id,
    linguistProjectName: project.name,
    ...(input.role !== undefined ? { linguistSessionRole: input.role } : {}),
  })
}

/** 列出绑定到某项目的会话（按 updatedAt 降序）。项目缺失时仍可列出——绑定存在会话侧。 */
export function listLinguistProjectChatSessions(projectId: string): AgentSessionMeta[] {
  return listAgentSessions().filter((s) => s.linguistProjectId === projectId)
}

/**
 * 发送闸门（主进程强制，PB-034 规则 4）：绑定会话的项目已归档 →
 * 返回 TypedError（orchestrator 以 preflight error 持久化并终止本轮）；
 * 只有未绑定 / active 返回 null；archived / missing / unavailable 均
 * fail closed，绝不静默退化成普通 Agent。
 */
export function checkLinguistSessionSendBlock(
  session:
    | Pick<AgentSessionMeta, 'id' | 'linguistProjectId' | 'linguistProjectName'>
    | null
    | undefined,
  getService: LinguistServiceResolver,
): TypedError | null {
  if (!session?.linguistProjectId) return null
  let status: LinguistSessionBindingStatus
  try {
    status = resolveLinguistBindingStatus(session.linguistProjectId, getService())
  } catch (error) {
    console.warn(
      '[Linguist 绑定] 项目状态解析失败，已阻断发送:',
      error instanceof Error ? error.name : 'UnknownError',
    )
    status = 'unavailable'
  }
  if (status === 'active') return null
  const projectName = session.linguistProjectName ?? session.linguistProjectId
  if (status === 'missing') {
    return {
      code: 'linguist_project_missing',
      title: '绑定项目缺失',
      message: `会话绑定的项目「${projectName}」缺失或损坏。本次消息不会发送，也不会静默按普通 Agent 继续。请先修复项目；若确认不再需要项目上下文，请解除项目绑定。`,
      actions: [],
      canRetry: false,
      details: [`projectId: ${session.linguistProjectId}`, 'status: missing'],
    }
  }
  if (status === 'unavailable') {
    return {
      code: 'linguist_project_unavailable',
      title: '项目服务不可用',
      message: `暂时无法验证会话绑定的项目「${projectName}」。为避免丢失 CAT 上下文，本次消息不会按普通 Agent 发送。请重试；若确认不再需要项目上下文，也可解除项目绑定。`,
      actions: [{ key: 'r', label: '重试', action: 'retry' }],
      canRetry: true,
      details: [`projectId: ${session.linguistProjectId}`, 'status: unavailable'],
    }
  }
  return {
    code: 'linguist_project_archived',
    title: '项目已归档（只读）',
    message: `会话绑定的项目「${projectName}」已归档。归档项目的会话为只读：历史消息可正常阅读，但不能发送新消息。如需继续，请在项目列表中新建项目或另开普通对话。`,
    actions: [],
    canRetry: false,
    details: [`projectId: ${session.linguistProjectId}`, 'status: archived'],
  }
}
