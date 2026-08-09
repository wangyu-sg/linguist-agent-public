import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { AgentSessionMeta, LinguistRole } from '@proma/shared'

export const LINGUIST_ROLE_PROMPT_VERSION = '1.1.0'
const ROLE_PROMPT_MAX_CHARS = 6000

export interface LinguistRolePromptLayer {
  readonly version: string
  readonly hash: string
  readonly content: string
  readonly source: 'bundle' | 'fallback'
}

export interface LinguistRolePromptResolution {
  readonly role: LinguistRole
  readonly roleLayer: LinguistRolePromptLayer
  readonly fallbackLayers: readonly 'role'[]
}

const FALLBACK_ROLE_PROMPTS: Record<LinguistRole, string> = {
  general: '你是通用本地化项目 Agent。根据用户目标直接使用完整 Proma 与 CAT 能力完成导入、分析、处理、QA、导出或其他项目任务。',
  translator: '你是专业本地化译者。对用户声明范围内的全部 Source 负责，提交准确、完整、自然且技术格式正确的正式译文，并完成自检。',
  reviewer: '你是完整双语审校员。逐一审查用户声明范围内的全部 Source 与当前 Target，保留正确译文，只修订存在实质问题的内容。',
  proofreader: '你是目标语校对与润色人员。以完整 Target 为主要对象，必要时回看 Source；只修改真正提高成品质量且不改变原意的内容。',
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

function layer(content: string, source: 'bundle' | 'fallback'): LinguistRolePromptLayer {
  return {
    version: LINGUIST_ROLE_PROMPT_VERSION,
    hash: sha256(content),
    content,
    source,
  }
}

export function getDefaultLinguistRolesRoot(): string | undefined {
  const candidates: string[] = []
  if (typeof process.resourcesPath === 'string' && process.resourcesPath.length > 0) {
    candidates.push(join(process.resourcesPath, 'linguist-roles'))
  }
  if (typeof __dirname === 'string') {
    candidates.push(join(__dirname, '..', '..', '..', 'resources', 'linguist-roles'))
  }
  return candidates.find((candidate) => existsSync(candidate))
}

export function resolveLinguistRolePrompt(
  session: Pick<AgentSessionMeta, 'linguistRole'>,
  rolesRoot: string | undefined = getDefaultLinguistRolesRoot(),
): LinguistRolePromptResolution {
  const role = session.linguistRole ?? 'general'
  const fallback = (): LinguistRolePromptResolution => ({
    role,
    roleLayer: layer(FALLBACK_ROLE_PROMPTS[role], 'fallback'),
    fallbackLayers: ['role'],
  })
  if (rolesRoot === undefined) return fallback()
  try {
    const content = readFileSync(join(rolesRoot, `${role}.md`), 'utf8').trim()
    if (content.length === 0 || content.length > ROLE_PROMPT_MAX_CHARS) return fallback()
    return { role, roleLayer: layer(content, 'bundle'), fallbackLayers: [] }
  } catch {
    return fallback()
  }
}
