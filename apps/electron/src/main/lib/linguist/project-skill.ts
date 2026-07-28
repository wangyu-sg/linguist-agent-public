/**
 * Linguist 常驻项目 Skill 解析（PB-040；计划 §8.1/§8.4「最小常驻项目 Skill」；
 * PB-082 扩展质量策略档与评审角色）。
 *
 * 「项目对话」（携带 linguistProjectId 的 Pi Agent 会话，PB-034）在既有
 * additionalSkillPaths 缝上追加内置 `linguist-skills/` 下的 Skill 目录，
 * 使工作守则出现在该会话的可用 Skill 列表中（Pi SDK 追加进 system prompt，
 * 模型按需 read SKILL.md 正文）。Skill 只声明不变量：不注册工具、不扩大文件
 * 范围、不绕过 Proposal、不声称 QA 通过、不做交付（计划 §8.4）。
 *
 * 注入矩阵（每次发送实时重解析；不持久化 Skill 列表，resume 走同一解析自然一致）：
 * - 普通会话（无 linguistProjectId）→ 不注入（[]）；
 * - 评审会话（meta.linguistSessionRole === 'reviewer'）→ 只注入
 *   `project-reviewer` 目录（独立评审守则，PB-083/PB-082）；
 * - 普通项目会话 → 注入 `project-assistant` + 项目当前质量策略档的
 *   `strategy-<profile>` 目录（计划 §21：fast/balanced/best；profile 经
 *   service 实时读取并规范化）；
 * - 绑定 missing（项目目录缺失/损坏）→ 不注入（会话降级为普通 Pi 会话）；
 * - 绑定 archived → 仍注入。归档会话的发送已被 PB-034 主进程闸门阻断
 *   （checkLinguistSessionSendBlock），Skill 注入与否不影响只读语义；
 *   保持「绑定在场且项目数据完整即注入」的单一规则，避免为不可达分支设特例；
 * - 策略档读取失败 / strategy 目录缺 SKILL.md → 只注入 project-assistant
 *   （fail closed 降级，策略缺省不影响常驻守则）；
 * - 服务不可解析 / project-assistant（评审会话为 project-reviewer）目录缺
 *   SKILL.md → 不注入（fail closed，记警告，绝不因 Skill 解析故障掀翻发送链路）。
 *
 * 本模块刻意不 import electron：node --test 直接驱动（同 session-binding.ts）。
 */

import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { normalizeQualityProfile } from '@linguist/cat-core'
import type { AgentSessionMeta } from '@proma/shared'
import { errorCodeOf } from './errors'
import { resolveLinguistBindingStatus, type LinguistServiceResolver } from './session-binding'

/**
 * PB-110 日志纪律：warn 只记错误 name/code，绝不透传 error.message——
 * 上游 message 可能引用段正文等客户文本（同 ipc-envelope.ts 未类型化
 * 错误只记 name 的纪律）。
 */
function describeErrorForLog(error: unknown): string {
  return `name=${error instanceof Error ? error.name : typeof error}，code=${errorCodeOf(error)}`
}

/** 内置 project-assistant Skill 的 frontmatter name（探针/测试断言共用同一真源）。 */
export const LINGUIST_PROJECT_SKILL_NAME = 'linguist-project-assistant'

/** 内置 project-reviewer Skill 的 frontmatter name（PB-083/PB-082）。 */
export const LINGUIST_REVIEWER_SKILL_NAME = 'linguist-project-reviewer'
export const LINGUIST_AUDITOR_SKILL_NAME = 'linguist-project-auditor'

/** 各质量策略档 Skill 的 frontmatter name（PB-082；目录名 strategy-<profile>）。 */
export const LINGUIST_STRATEGY_SKILL_NAMES = {
  fast: 'linguist-strategy-fast',
  balanced: 'linguist-strategy-balanced',
  best: 'linguist-strategy-best',
} as const

/**
 * 解析内置 `linguist-skills/` 根目录（project-assistant / project-reviewer /
 * strategy-* 的父目录；目录在场才返回，否则 undefined）。
 *
 * - 打包：electron-builder extraResources 将仓根 `resources/linguist-skills/`
 *   拷到 `<process.resourcesPath>/linguist-skills/`；
 * - 开发：主进程被 esbuild 束为 `apps/electron/dist/main.cjs`
 *   （`__dirname` = `dist/`），上溯三级到仓根 `resources/`。
 *   node --test 从源码驱动时为 ESM（无 `__dirname`），该分支跳过——
 *   测试经显式 skillsRoot 参数或临时设置 process.resourcesPath 注入；
 *   打包布局由 probe-project-skill 端到端覆盖。
 */
export function getDefaultLinguistSkillsRoot(): string | undefined {
  const candidates: string[] = []
  if (typeof process.resourcesPath === 'string' && process.resourcesPath.length > 0) {
    candidates.push(join(process.resourcesPath, 'linguist-skills'))
  }
  if (typeof __dirname === 'string') {
    candidates.push(join(__dirname, '..', '..', '..', 'resources', 'linguist-skills'))
  }
  for (const dir of candidates) {
    if (existsSync(dir)) return dir
  }
  return undefined
}

/** 目录内含 SKILL.md 才算可注入的 Skill（内置资源缺失时降级，见头注释）。 */
function skillDirIfPresent(dir: string): string | undefined {
  return existsSync(join(dir, 'SKILL.md')) ? dir : undefined
}

/**
 * 计算会话应追加的 Linguist Skill 目录（0、1 或 2 个），供 orchestrator 装配进
 * Pi 会话的 additionalSkillPaths。注入矩阵见模块头注释；任何解析异常均 fail closed。
 */
export function resolveLinguistSessionSkillPaths(
  session: Pick<AgentSessionMeta, 'linguistProjectId' | 'linguistSessionRole'> | undefined,
  getService: LinguistServiceResolver,
  skillsRoot: string | undefined = getDefaultLinguistSkillsRoot(),
): string[] {
  if (!session?.linguistProjectId) return []
  if (skillsRoot === undefined || !existsSync(skillsRoot)) return []
  try {
    const status = resolveLinguistBindingStatus(session.linguistProjectId, getService())
    if (status === 'missing') return []

    // 评审会话：只注入独立评审守则（不注入助理/策略——角色边界清晰）。
    if (session.linguistSessionRole === 'reviewer') {
      const reviewerDir = skillDirIfPresent(join(skillsRoot, 'project-reviewer'))
      if (reviewerDir === undefined) return []
      console.log(`[Linguist Skill] 评审会话注入评审 Skill（${status}）: ${reviewerDir}`)
      return [reviewerDir]
    }
    if (session.linguistSessionRole === 'auditor') {
      const auditorDir = skillDirIfPresent(join(skillsRoot, 'project-auditor'))
      if (auditorDir === undefined) return []
      console.log(`[Linguist Skill] 盲审会话注入独立审计 Skill（${status}）: ${auditorDir}`)
      return [auditorDir]
    }

    // 普通项目会话：常驻守则必备；缺失则整体不注入（同 PB-040 语义）。
    const assistantDir = skillDirIfPresent(join(skillsRoot, 'project-assistant'))
    if (assistantDir === undefined) return []

    // 质量策略档实时读取；读取失败 fail closed 只注入常驻守则。
    let profile
    try {
      profile = normalizeQualityProfile(getService().getProject(session.linguistProjectId).qualityProfile)
    } catch (error) {
      console.warn(`[Linguist Skill] 项目质量策略档读取失败，只注入常驻 Skill（${describeErrorForLog(error)}）`)
      return [assistantDir]
    }
    const strategyDir = skillDirIfPresent(join(skillsRoot, `strategy-${profile}`))
    if (strategyDir === undefined) {
      console.warn(`[Linguist Skill] 策略 Skill 缺失（strategy-${profile}），只注入常驻 Skill`)
      return [assistantDir]
    }
    console.log(`[Linguist Skill] 项目会话注入常驻 + 策略 Skill（${status}，${profile}）`)
    return [assistantDir, strategyDir]
  } catch (error) {
    console.warn(`[Linguist Skill] 项目 Skill 路径解析失败，按不注入处理（${describeErrorForLog(error)}）`)
    return []
  }
}
