/**
 * Linguist Role/Strategy Prompt 与 Pi Skill 路径解析。
 *
 * Prompt 层校验 Bundle 的 name/version/正文预算；失效时返回同版本编译内置
 * fallback。既有 additionalSkillPaths 行为保持不变，供 Pi 按需发现 Skills。
 */

import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
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

export const LINGUIST_ROLE_SKILL_VERSION = '1.0.1'
export const LINGUIST_STRATEGY_SKILL_VERSION = '1.0.1'
const LINGUIST_PROMPT_SKILL_MAX_CHARS = 6000

export type LinguistPromptRole = 'assistant' | 'reviewer' | 'auditor'

export interface LinguistPromptSkillLayer {
  readonly version: string
  readonly hash: string
  readonly content: string
  readonly source: 'bundle' | 'fallback'
}

export interface LinguistPromptSkillResolution {
  readonly role: LinguistPromptRole
  readonly roleLayer: LinguistPromptSkillLayer
  readonly strategy?: keyof typeof LINGUIST_STRATEGY_SKILL_NAMES
  readonly strategyLayer?: LinguistPromptSkillLayer
  readonly fallbackLayers: readonly ('role' | 'strategy')[]
}

const ROLE_SKILL_CONFIG = {
  assistant: {
    dir: 'project-assistant',
    name: LINGUIST_PROJECT_SKILL_NAME,
    content: `# Linguist Project Assistant

你正在一个 Linguist Project 中工作。使用 CAT Tool 读取和提出修改；不要直接修改源资产。Proposal 不等于已接受译文，QA 结果由确定性工具产生。

先理解任务范围、语言对、文本功能、角色/场景和技术约束，再以批次读取相关上下文并生成候选，只对高风险段追加检索。引用 Segment ID、TM/TB 或项目证据；无法确定时标记歧义，不要伪造事实。

项目正式译文只通过 CAT Proposal 工作流提交。报告完成范围、关键选择、Proposal 数量、QA 问题和未解决项，不复述 Workbench 已可见的大量正文。`,
  },
  reviewer: {
    dir: 'project-reviewer',
    name: LINGUIST_REVIEWER_SKILL_NAME,
    content: `# Linguist Reviewer

你是当前 Linguist Project 的独立二审。基于指定 Proposal Snapshot 判断候选是否准确、自然、符合项目规则、角色声音、上下文和技术约束。

无实质问题时提交 pass；存在问题时提交 issues，每条 Finding 给出问题类型、严重度、证据、解释和可执行建议；上下文不足时提交 abstain。Suggested Target 是建议，不代表已修改或已接受。`,
  },
  auditor: {
    dir: 'project-auditor',
    name: LINGUIST_AUDITOR_SKILL_NAME,
    content: `# Linguist Quality Auditor

你负责工作流盲审。系统提供的审计证据默认不含 Producer 结论和已有 QA；先基于 Source、Target、项目规则和必要上下文独立判断。

不要主动寻找既有结论。若任务要求追查历史或来源，可以使用 Proma 通用工具，但需记录额外查看的信息。输出区分通过、发现问题和无法判断，并记录证据与置信度。`,
  },
} as const

const STRATEGY_SKILL_CONFIG = {
  fast: {
    dir: 'strategy-fast',
    name: LINGUIST_STRATEGY_SKILL_NAMES.fast,
    content: `# Fast Strategy

每批优先处理 20–50 个上下文相近的 Segment。一次取得批量上下文，只对剧情关键、上下文冲突、专名不确定、格式复杂或低置信段追加检索；提交批量 Proposal 并运行范围 QA，只报告数量、关键风险和未处理段。`,
  },
  balanced: {
    dir: 'strategy-balanced',
    name: LINGUIST_STRATEGY_SKILL_NAMES.balanced,
    content: `# Balanced Strategy

每批处理 10–25 个上下文相关的 Segment。批量取得 TM、TB、邻接段、角色与技术约束，翻译后自查语义、自然度、角色口吻、术语、数字、Tag、占位符与前后文一致性；提交 Proposal、运行范围 QA，并集中列出需人工选择的歧义。`,
  },
  best: {
    dir: 'strategy-best',
    name: LINGUIST_STRATEGY_SKILL_NAMES.best,
    content: `# Best Strategy

每批通常处理 5–10 个 Segment，关键文案可更小。一次取得完整上下文，再按需深入项目资料或外部参考；核对世界观、角色声音、叙事意图、游戏功能、文化适配与技术约束。提交 Proposal、运行 QA，并为具体 Proposal Snapshot 请求独立 Reviewer。`,
  },
} as const

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

function fallbackLayer(version: string, content: string): LinguistPromptSkillLayer {
  return {
    version,
    hash: sha256(content),
    content,
    source: 'fallback',
  }
}

function loadPromptSkill(
  skillsRoot: string | undefined,
  config: { readonly dir: string; readonly name: string; readonly content: string },
  version: string,
): LinguistPromptSkillLayer {
  const fallback = fallbackLayer(version, config.content)
  if (skillsRoot === undefined) return fallback
  try {
    const source = readFileSync(join(skillsRoot, config.dir, 'SKILL.md'), 'utf8')
    const match = source.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]+)$/)
    if (match === null) return fallback
    const name = match[1]!.match(/^name:\s*(.+)$/m)?.[1]?.trim().replace(/^["']|["']$/g, '')
    const bundledVersion = match[1]!.match(/^version:\s*(.+)$/m)?.[1]?.trim().replace(/^["']|["']$/g, '')
    const content = match[2]!.trim()
    if (
      name !== config.name
      || bundledVersion !== version
      || content.length === 0
      || content.length > LINGUIST_PROMPT_SKILL_MAX_CHARS
    ) return fallback
    return {
      version,
      hash: sha256(content),
      content,
      source: 'bundle',
    }
  } catch {
    return fallback
  }
}

/**
 * 解析 Role/Strategy Prompt 层。可更新 Skill Bundle 缺失、损坏或版本不匹配时，
 * 返回同版本编译内置 fallback；调用方据 source 显式标记降级，不会退化为 General。
 */
export function resolveLinguistPromptSkillLayers(
  session: Pick<AgentSessionMeta, 'linguistProjectId' | 'linguistSessionRole'>,
  getService: LinguistServiceResolver,
  skillsRoot: string | undefined = getDefaultLinguistSkillsRoot(),
): LinguistPromptSkillResolution {
  const role: LinguistPromptRole = session.linguistSessionRole ?? 'assistant'
  const roleConfig = ROLE_SKILL_CONFIG[role]
  const roleLayer = loadPromptSkill(
    skillsRoot,
    roleConfig,
    LINGUIST_ROLE_SKILL_VERSION,
  )
  const fallbackLayers: Array<'role' | 'strategy'> = []
  if (roleLayer.source === 'fallback') fallbackLayers.push('role')

  if (role !== 'assistant') {
    return { role, roleLayer, fallbackLayers }
  }

  let strategy: keyof typeof LINGUIST_STRATEGY_SKILL_NAMES = 'balanced'
  let strategyProfileUnavailable = false
  try {
    strategy = normalizeQualityProfile(getService().getProject(session.linguistProjectId!).qualityProfile)
  } catch {
    strategyProfileUnavailable = true
  }
  const strategyConfig = STRATEGY_SKILL_CONFIG[strategy]
  const loadedStrategy = loadPromptSkill(
    skillsRoot,
    strategyConfig,
    LINGUIST_STRATEGY_SKILL_VERSION,
  )
  const strategyLayer = strategyProfileUnavailable
    ? fallbackLayer(LINGUIST_STRATEGY_SKILL_VERSION, strategyConfig.content)
    : loadedStrategy
  if (strategyLayer.source === 'fallback') fallbackLayers.push('strategy')
  return { role, roleLayer, strategy, strategyLayer, fallbackLayers }
}

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
      console.log(`[Linguist Skill] 评审会话注入评审 Skill（${status}）`)
      return [reviewerDir]
    }
    if (session.linguistSessionRole === 'auditor') {
      const auditorDir = skillDirIfPresent(join(skillsRoot, 'project-auditor'))
      if (auditorDir === undefined) return []
      console.log(`[Linguist Skill] 盲审会话注入独立审计 Skill（${status}）`)
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
