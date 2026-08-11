/**
 * Linguist 项目 ↔ Agent 会话绑定（PB-034；计划 §7.2「Project → Session 绑定」）。
 *
 * 「项目对话」是携带 `linguistProjectId` 的 Agent 会话（AgentSessionMeta，
 * 持久化于 ~/.linguist-agent/agent-sessions.json，重启后绑定仍在）。Chat 模式的
 * Conversation 没有工作区/runtime 概念，Batch 4 的 CAT customTools 只会
 * 装配进 Agent 会话栈，因此绑定只存在于 Agent 会话栈。
 * 新建项目会话与 ipc.ts 普通创建路径同一来源——继承并冻结
 * 创建时的 Proma 默认渠道/模型（settings.json）。
 *
 * 生命周期硬规则（计划 PB-034）：
 * 1. 普通对话（侧栏新建）绝不携带 linguistProjectId；
 * 2. 项目内创建的对话携带绑定（+ 项目名快照，供徽章在缺失时仍可展示）；
 * 3. 绑定创建时冻结——没有任何重绑定 API；仅用户可通过专用 API 永久
 *    解绑。切换 Projects UI 选中项目不影响任何已存在会话；
 * 4. 项目归档、缺失或服务暂不可用时，Agent 对话保持可用；CAT 工具按
 *    项目状态返回只读或明确错误。
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
  LinguistRole,
} from '@proma/shared'
import { getSettings } from '../settings-service'
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
 * 产物为 Agent 会话，元数据携带 linguistProjectId + 项目名快照。
 * role 只定义默认岗位，不参与工具、权限、模型和 Runtime 装配。
 * 渠道/模型继承并冻结创建时的 Proma 默认
 * （与 ipc.ts 普通会话创建路径同一 getSettings() 来源）。
 */
export function createLinguistProjectChatSession(
  service: LinguistProjectService,
  input: { projectId: string; title?: string; role?: LinguistRole },
): AgentSessionMeta {
  const project = service.getProject(input.projectId)
  if (project.archivedAt !== undefined) {
    throw new LinguistProjectArchivedError(input.projectId)
  }
  // 不传标题时保留 Proma 默认标题，让上游首轮自动标题管线真正触发；项目名已独立存入快照。
  const title = input.title?.trim() || undefined
  const settings = getSettings()
  const workspaceId = service.ensureProjectWorkspace(project.id)
  return createAgentSession(
    title,
    settings.agentChannelId,
    workspaceId,
    settings.agentModelId,
    undefined,
    undefined,
    {
      linguistProjectId: project.id,
      linguistProjectName: project.name,
      linguistRole: input.role ?? 'general',
    },
  )
}

/** 列出绑定到某项目的会话（按 updatedAt 降序）。项目缺失时仍可列出——绑定存在会话侧。 */
export function listLinguistProjectChatSessions(projectId: string): AgentSessionMeta[] {
  return listAgentSessions().filter((s) => s.linguistProjectId === projectId)
}
