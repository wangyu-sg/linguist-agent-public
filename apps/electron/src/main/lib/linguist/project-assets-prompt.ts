/**
 * Linguist 项目资产系统上下文注入（PB-095；六类项目资产的每会话提示）。
 *
 * 「项目对话」（携带 linguistProjectId 的 Pi Agent 会话，PB-034）在
 * system prompt 尾部追加项目资产摘要：Style Guide 规则行、技术约束、
 * Voice Profiles、Context 资料目录（filename+kind+note 清单）全量进
 * 上下文（受预算硬顶约束）；句式库与 context doc 全文不进上下文——
 * 模型经 cat_search_sentence_patterns / cat_read_context_doc 按需查询。
 *
 * 注入矩阵（每次发送实时重构；不持久化，resume 走同一构建自然一致）：
 * - 普通会话（无 linguistProjectId）→ 空串；
 * - 绑定 missing（项目目录缺失/损坏）→ 空串（会话降级为普通 Pi 会话）；
 * - 绑定 archived → 仍注入（归档会话的发送已被 PB-034 主进程闸门阻断，
 *   注入与否不影响只读语义；同 PB-040 Skill 注入的单一规则）；
 * - 任一段读取失败 → 该段 fail closed 降级为空段 + warn，绝不因资产
 *   读取故障掀翻发送链路；服务/句柄不可解析 → 整体空串 + warn。
 *
 * 预算硬顶（超出截断并附「…(余 N 条，经 UI 或工具查询)」note）：
 * Style Guide ≤100 条且 ≤8000 字符；Voice Profiles ≤50 角色且 ≤6000
 * 字符；Tech Constraints ≤4000 字符；Context 目录 ≤40 条且 ≤2000 字符。
 *
 * 本模块刻意不 import electron：node --test 直接驱动（同 project-skill.ts）。
 */

import type { AgentSessionMeta } from '@proma/shared'
import type { ProjectDatabase } from '@linguist/cat-store'
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

/** 注入预算硬顶（探针/测试断言共用同一真源）。 */
export const PROJECT_ASSETS_PROMPT_BUDGETS = {
  styleGuideMaxRules: 100,
  styleGuideMaxChars: 8000,
  voiceProfileMaxSpeakers: 50,
  voiceProfileMaxChars: 6000,
  techConstraintMaxChars: 4000,
  contextDocMaxEntries: 40,
  contextDocMaxChars: 2000,
} as const

/** 截断提示（测试断言共用同一真源）。 */
export const PROJECT_ASSETS_TRUNCATED_NOTE = '…(余 N 条，经 UI 或工具查询)'

interface SectionBudget {
  maxItems: number
  maxChars: number
}

/**
 * 组装一段注入文本：逐行累加直至触顶；截断时把 note 中的 N 替换为
 * 未纳入条数。全部行空时返回 undefined（该段整体省略）。
 */
function buildSection(title: string, lines: string[], total: number, budget: SectionBudget): string | undefined {
  if (lines.length === 0) return undefined
  const body: string[] = []
  let chars = 0
  for (const line of lines) {
    if (body.length >= budget.maxItems) break
    if (chars + line.length > budget.maxChars) break
    body.push(line)
    chars += line.length
  }
  if (body.length === 0) return undefined
  const remaining = total - body.length
  if (remaining > 0) body.push(PROJECT_ASSETS_TRUNCATED_NOTE.replace('N', String(remaining)))
  return `### ${title}\n${body.join('\n')}`
}

/** 单段读取失败 → 空段 + warn（fail closed；不掀翻其他段）。 */
function readSection(label: string, build: () => string | undefined): string | undefined {
  try {
    return build()
  } catch (error) {
    console.warn(`[Linguist 资产注入] ${label} 读取失败，按空段处理（${describeErrorForLog(error)}）`)
    return undefined
  }
}

function styleGuideSection(db: ProjectDatabase): string | undefined {
  const rules = db.styleGuideRules.list({ limit: PROJECT_ASSETS_PROMPT_BUDGETS.styleGuideMaxRules + 1 })
  const total = db.styleGuideRules.count()
  const lines = rules.map((rule) => {
    const group = rule.groupKey !== undefined ? `【${rule.groupKey}】` : ''
    const good = rule.goodExample !== undefined ? ` ✅${rule.goodExample}` : ''
    const bad = rule.badExample !== undefined ? ` ❌${rule.badExample}` : ''
    return `- ${group}${rule.ruleText}${good}${bad}`
  })
  return buildSection('Style Guide', lines, total, {
    maxItems: PROJECT_ASSETS_PROMPT_BUDGETS.styleGuideMaxRules,
    maxChars: PROJECT_ASSETS_PROMPT_BUDGETS.styleGuideMaxChars,
  })
}

function techConstraintSection(db: ProjectDatabase): string | undefined {
  const constraints = db.techConstraints.list()
  const total = db.techConstraints.count()
  const lines = constraints.map((constraint) => {
    const scope = constraint.scope !== undefined ? `/${constraint.scope}` : ''
    const note = constraint.note !== undefined ? `（${constraint.note}）` : ''
    return `- [${constraint.kind}${scope}] ${constraint.valueJson}${note}`
  })
  return buildSection('技术约束', lines, total, {
    // 无条数硬顶（简报只定字符预算）；用总数做安全上限。
    maxItems: total,
    maxChars: PROJECT_ASSETS_PROMPT_BUDGETS.techConstraintMaxChars,
  })
}

function voiceProfileSection(db: ProjectDatabase): string | undefined {
  const profiles = db.voiceProfiles.list({ limit: PROJECT_ASSETS_PROMPT_BUDGETS.voiceProfileMaxSpeakers + 1 })
  const total = db.voiceProfiles.count()
  const lines = profiles.map((profile) => {
    const traits = [profile.textType, profile.register, profile.person].filter((item) => item !== undefined)
    const traitText = traits.length > 0 ? `（${traits.join('/')}）` : ''
    const tone = profile.toneMarkers !== undefined && profile.toneMarkers.length > 0
      ? `；语气=${profile.toneMarkers.join('、')}`
      : ''
    const taboos = profile.taboos !== undefined && profile.taboos.length > 0
      ? `；禁忌=${profile.taboos.join('、')}`
      : ''
    const notes = profile.notes !== undefined ? `；备注=${profile.notes}` : ''
    return `- ${profile.speaker}${traitText}${tone}${taboos}${notes}`
  })
  return buildSection('Voice Profiles', lines, total, {
    maxItems: PROJECT_ASSETS_PROMPT_BUDGETS.voiceProfileMaxSpeakers,
    maxChars: PROJECT_ASSETS_PROMPT_BUDGETS.voiceProfileMaxChars,
  })
}

function contextCatalogSection(db: ProjectDatabase): string | undefined {
  const docs = db.contextDocs.list({ limit: PROJECT_ASSETS_PROMPT_BUDGETS.contextDocMaxEntries + 1 })
  const total = db.contextDocs.count()
  const lines = docs.map((doc) => {
    const note = doc.note !== undefined ? ` — ${doc.note}` : ''
    const extract = doc.kind === 'doc' && doc.textExtract !== undefined ? `（id: ${doc.id}，可经 cat_read_context_doc 阅读）` : `（id: ${doc.id}）`
    return `- ${doc.originalFilename}（${doc.kind}）${extract}${note}`
  })
  return buildSection('Context 资料目录', lines, total, {
    maxItems: PROJECT_ASSETS_PROMPT_BUDGETS.contextDocMaxEntries,
    maxChars: PROJECT_ASSETS_PROMPT_BUDGETS.contextDocMaxChars,
  })
}

/**
 * 计算会话应追加的项目资产系统上下文（空串 = 不注入），供 orchestrator
 * 拼接进 Pi 会话的 system prompt。注入矩阵见模块头注释；任何解析异常
 * 均 fail closed。
 */
export function buildLinguistProjectAssetsPrompt(
  session: Pick<AgentSessionMeta, 'linguistProjectId'> | undefined,
  getService: LinguistServiceResolver,
): string {
  if (!session?.linguistProjectId) return ''
  try {
    const service = getService()
    const status = resolveLinguistBindingStatus(session.linguistProjectId, service)
    if (status === 'missing') return ''

    // 归档项目强制只读打开（服务层保证）；借用服务缓存句柄，绝不 close。
    const db = service.openProject(session.linguistProjectId)
    const sections = [
      readSection('Style Guide', () => styleGuideSection(db)),
      readSection('技术约束', () => techConstraintSection(db)),
      readSection('Voice Profiles', () => voiceProfileSection(db)),
      readSection('Context 资料目录', () => contextCatalogSection(db)),
    ].filter((section): section is string => section !== undefined)
    if (sections.length === 0) return ''
    return (
      `\n\n## 项目资产（随会话注入的约束与背景；句式库与文档全文经 CAT 工具按需查询）\n\n${sections.join('\n\n')}`
    )
  } catch (error) {
    console.warn(`[Linguist 资产注入] 项目资产上下文构建失败，按不注入处理（${describeErrorForLog(error)}）`)
    return ''
  }
}
