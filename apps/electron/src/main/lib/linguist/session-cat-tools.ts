/**
 * Linguist CAT customTools 装配（PB-042；计划 §7.2/§7.3「会话绑定的 CAT 工具」）。
 *
 * 把 CAT 读取、PB-051 Proposal、PB-071 QA、PB-083 评审与 PB-084 批量一致性
 * 工具（@linguist/cat-tools）经会话绑定解析器装配进 Pi 会话的 customTools 缝
 * （orchestrator sendMessage）。
 *
 * 装配规则（每次发送重建工具数组；绑定状态绝不缓存）：
 * - 普通会话（无 linguistProjectId）→ []（硬规则：普通 Chat 的 Tool 列表无 CAT）；
 * - 项目绑定会话（active / archived / missing 均装配）→ 17 个工具。projectId 永远
 *   来自冻结的会话绑定（PB-034），工具入参不含 projectId——计划 §7.2「Tool 每次都
 *   验证 Session projectId 与输入 projectId 一致」由构造满足（根本没有该输入）；
 * - cat_submit_critic_review 的评审身份由工具运行时派生：criticId/executionId
 *   来自会话 id，profileHash 取 `linguist-skills/project-reviewer/SKILL.md` 字节
 *   sha256（解析不到退回固定档案串哈希）；模型入参绝无身份字段；
 * - 绑定 missing 仍装配工具（而非不装配，如实记录的选择）：调用时解析器返回
 *   LinguistCatProjectMissingError，工厂按 Pi 约定抛出，模型看到 [PROJECT_MISSING]
 *   明确失败——降级会话中 CAT 能力的缺席原因对模型保持可读；若改为不装配，模型
 *   无从得知 CAT 能力存在过，失败不可读；
 * - archived 仍装配但不可达（inert）：发送已被 PB-034 主进程闸门阻断
 *   （checkLinguistSessionSendBlock）；即便到达，openProject 对归档项目强制只读
 *   打开；Proposal 写工具（含 cat_create_consistency_proposals）会被
 *   只读 store 二次拒绝；
 * - resolveProject 在每次工具调用时实时重解析（resolveLinguistBindingStatus +
 *   getProject + openProject）：归档/删除目录即刻反映，重启/resume 走同一构造
 *   自然一致（与 PB-040 Skill 解析同一模式）；
 * - 句柄所有权：openProject 返回服务按 projectId 缓存的句柄（ResolvedLinguistCatProject
 *   是 borrowed handle），工具借用，绝不 close。
 *
 * 错误穿透约定（与 PB-041 工厂一致）：typed store/service 错误（含 code，如
 * STORE_SQLITE_UNAVAILABLE / PROJECT_NOT_FOUND）原样穿透不包装；服务暂不可解析
 * 等意外异常同样穿透（Pi 会把工具异常消息呈现给模型，绝不掀翻 Agent 循环）。
 *
 * 本模块刻意不 import electron：node --test 直接驱动（同 session-binding.ts）；
 * bun 单测经 mock.module('electron') + 假服务驱动（同 agent-session-manager.test.ts）。
 */

import type { AgentSessionMeta, LinguistProjectMutationEvent } from '@proma/shared'
import { LINGUIST_IMPORT_MAX_BYTES } from '@proma/shared'
import type { LinguistGenerationProvenance } from '@linguist/cat-core'
import {
  createLinguistCatTools,
  LinguistCatInvalidArgumentError,
  LinguistCatProjectMissingError,
  type LinguistIntakeImportResult,
  type LinguistIntakeSource,
  type ResolveLinguistCatProject,
} from '@linguist/cat-tools'
import { createHash } from 'node:crypto'
import { readFileSync, realpathSync, statSync } from 'node:fs'
import { basename, join } from 'node:path'
import { getAgentSessionMeta } from '../agent-session-manager'
import { resolveLinguistBindingStatus, type LinguistServiceResolver } from './session-binding'
import {
  runLinguistConsistencyWorker,
  runLinguistQaWorker,
} from './cat-job-worker-client'
import type { LinguistProjectService } from './project-service'

export type LinguistProjectMutationSink = (event: LinguistProjectMutationEvent) => void

const projectMutationRevisions = new Map<string, number>()

function intakeSourceToken(sessionId: string, filePath: string): string {
  return `attached-file:${createHash('sha256').update(`${sessionId}\0${filePath}`).digest('hex')}`
}

function attachedFileEntries(sessionId: string): Array<{
  token: string
  path: string
  filename: string
  sizeBytes: number
}> {
  const paths = getAgentSessionMeta(sessionId)?.attachedFiles ?? []
  const entries: Array<{
    token: string
    path: string
    filename: string
    sizeBytes: number
  }> = []
  for (const filePath of paths) {
    try {
      const safePath = realpathSync(filePath)
      const stats = statSync(safePath)
      if (!stats.isFile()) continue
      entries.push({
        token: intakeSourceToken(sessionId, safePath),
        path: safePath,
        filename: basename(safePath),
        sizeBytes: stats.size,
      })
    } catch {
      // 附件已被移除或不可读：不把失效路径泄漏给模型。
    }
  }
  return entries
}

function createSessionIntakeBridge(
  sessionId: string,
  projectId: string,
  getService: LinguistServiceResolver,
): {
  listIntakeSources: () => readonly LinguistIntakeSource[]
  importIntakeAsset: (sourceToken: string) => Promise<LinguistIntakeImportResult>
} {
  return {
    listIntakeSources() {
      return attachedFileEntries(sessionId).map((entry) => ({
        sourceToken: entry.token,
        filename: entry.filename,
        sizeBytes: entry.sizeBytes,
        status: entry.sizeBytes > LINGUIST_IMPORT_MAX_BYTES ? 'too-large' as const : 'ready' as const,
      }))
    },
    async importIntakeAsset(sourceToken) {
      const entry = attachedFileEntries(sessionId).find((candidate) => candidate.token === sourceToken)
      if (entry === undefined) {
        throw new LinguistCatInvalidArgumentError(
          'sourceToken',
          'unknown or no longer attached; call cat_list_intake_sources again',
        )
      }
      if (entry.sizeBytes > LINGUIST_IMPORT_MAX_BYTES) {
        throw new LinguistCatInvalidArgumentError(
          'sourceToken',
          'attached file exceeds the 50MB intake limit',
        )
      }
      const service: LinguistProjectService = getService()
      const result = await service.importAsset(projectId, {
        bytes: new Uint8Array(readFileSync(entry.path)),
        filename: entry.filename,
      })
      return {
        sourceToken,
        filename: entry.filename,
        status: result.status,
        assetId: result.assetId,
        formatId: result.formatId,
        segmentCount: result.segmentCount,
        sourceSha256: result.sourceSha256,
        warnings: result.warnings.map((warning) => warning.message),
      }
    },
  }
}

export function getLinguistProjectMutationRevision(projectId: string): number {
  return projectMutationRevisions.get(projectId) ?? 0
}

export function createLinguistProjectMutationEvent(
  projectId: string,
  mutation: Omit<LinguistProjectMutationEvent, 'projectId' | 'revision'>,
): LinguistProjectMutationEvent {
  const revision = Math.max(
    (projectMutationRevisions.get(projectId) ?? 0) + 1,
    mutation.sequence ?? 0,
  )
  projectMutationRevisions.set(projectId, revision)
  return { projectId, revision, ...mutation }
}

/**
 * 解析评审 skill 字节（critic profileHash 真源，PB-083）。候选布局同
 * getDefaultLinguistSkillsRoot：打包在 `<process.resourcesPath>/linguist-skills/`，
 * 开发时自 `dist/` 上溯三级到仓根 `resources/`。解析不到返回 undefined，
 * 工厂退回固定档案串哈希（fail closed，绝不阻断工具装配）。
 */
function resolveCriticSkillBytes(): Uint8Array | undefined {
  const candidates: string[] = []
  if (typeof process.resourcesPath === 'string' && process.resourcesPath.length > 0) {
    candidates.push(join(process.resourcesPath, 'linguist-skills', 'project-reviewer', 'SKILL.md'))
  }
  if (typeof __dirname === 'string') {
    candidates.push(join(__dirname, '..', '..', '..', 'resources', 'linguist-skills', 'project-reviewer', 'SKILL.md'))
  }
  for (const file of candidates) {
    try {
      return readFileSync(file)
    } catch {
      // 候选不存在或不可读：尝试下一个
    }
  }
  return undefined
}

/**
 * 计算会话应装配的 Linguist CAT 工具（0 或 17 个），供 orchestrator 合并进
 * Pi queryOptions.customTools。规则见模块头注释；本函数自身不触碰服务
 * （构建工具数组是纯操作），服务只在工具被调用时经 resolver 触达。
 */
export function resolveLinguistSessionCatTools(
  session: Pick<
    AgentSessionMeta,
    'id' | 'modelId' | 'linguistProjectId' | 'linguistSessionRole'
  > | undefined,
  getService: LinguistServiceResolver,
  onProjectMutation?: LinguistProjectMutationSink,
  generationProvenance?: (toolCallId: string) => LinguistGenerationProvenance,
) {
  const projectId = session?.linguistProjectId
  if (!projectId) return []
  const resolveProject: ResolveLinguistCatProject = () => {
    const service = getService()
    // 每次调用实时重判定：missing（索引无此项目 / project.json 缺失或不可解析）
    // → 类型化 PROJECT_MISSING，工厂抛出后对模型可读；active/archived 正常打开
    // （归档由 openProject 强制只读，六个只读工具与 check-only 模式语义安全）。
    if (resolveLinguistBindingStatus(projectId, service) === 'missing') {
      return new LinguistCatProjectMissingError(projectId)
    }
    return { project: service.getProject(projectId), db: service.openProject(projectId) }
  }
  const intake = createSessionIntakeBridge(session.id, projectId, getService)
  return createLinguistCatTools({
    resolveProject,
    resultProjectId: projectId,
    sessionId: session.id,
    ...(session.linguistSessionRole === 'auditor'
      ? { sessionMode: 'independent-audit' as const }
      : {}),
    criticSkillBytes: resolveCriticSkillBytes,
    consistencyWorker: runLinguistConsistencyWorker,
    qaWorker: runLinguistQaWorker,
    listIntakeSources: intake.listIntakeSources,
    importIntakeAsset: intake.importIntakeAsset,
    onMutation: (mutation) => {
      const event = createLinguistProjectMutationEvent(projectId, mutation)
      onProjectMutation?.(event)
    },
    ...(session.modelId !== undefined ? { modelId: session.modelId } : {}),
    ...(generationProvenance === undefined ? {} : { generationProvenance }),
  })
}

/**
 * customTools 名称冲突防线（init 时 fail loud）：cat_* 必须是本轮查询
 * customTools 列表中的全局唯一名。与既有工具（内建/桥接 MCP）撞名是编程错误
 * ——静默覆盖会让模型调到错误实现，宁可 loudly 终止本轮查询也不带病装配。
 */
export function assertNoLinguistCatToolNameConflict(
  existingToolNames: Iterable<string>,
  catTools: readonly { name: string }[],
): void {
  if (catTools.length === 0) return
  const existing = new Set(existingToolNames)
  for (const tool of catTools) {
    if (existing.has(tool.name)) {
      throw new Error(
        `[Linguist CAT] customTools 名称冲突: ${tool.name} 已被既有工具占用（cat_* 必须全局唯一，拒绝装配本轮查询）`,
      )
    }
  }
}
