/**
 * Linguist Prompt overlay composer（沿用 PB-095 函数名以保持调用 seam）。
 *
 * LA-PROMPT-001 起本模块是薄 facade：语义构建唯一真源在
 * prompt-contract.ts（Canonical Prompt Contract：有序 layer + envelope），
 * wire 表达在 prompt-renderer.ts（'xml' 与历史输出 byte 级一致，Claude
 * 路径；'markdown' 面向 Pi 等 generic runtime）。本模块只保留既有导出
 * 签名并委托 contract + renderer，别的 importer 零破坏。
 *
 * 项目会话按 Profile / Professional Quality Contract / Role / Project Digest
 * 分层；普通会话为空。项目资料缺失或 Role Prompt 失效时显式标记降级，并使用内置 fallback，
 * 绝不静默退化为 General。Project Digest 只常驻小摘要和按需 reference。
 * professional_quality_contract 层恒定、短、全角色共享，
 * 写入 manifest 的 contract_version / contract_hash，禁止预支降级措辞。
 */

import { createHash } from 'node:crypto'
import type { AgentSessionMeta } from '@proma/shared'
import type { LinguistServiceResolver } from './session-binding'
import {
  buildLinguistPromptContract,
  type LinguistPromptContractBuildOptions,
  type LinguistPromptContractStatus,
  getLinguistPromptContractCacheSize,
} from './prompt-contract'
import { renderLinguistPrompt, type LinguistPromptRenderer } from './prompt-renderer'

// —— 既有常量导出零破坏（真源已迁至 prompt-contract.ts）——
export {
  LINGUIST_PROFILE_VERSION,
  LINGUIST_QUALITY_CONTRACT_VERSION,
  LINGUIST_PROJECT_DIGEST_VERSION,
  LINGUIST_QUALITY_CONTRACT_PROMPT,
  PROJECT_ASSETS_PROMPT_BUDGETS,
  LINGUIST_PROMPT_BUDGETS,
  PROJECT_ASSETS_TRUNCATED_NOTE,
} from './prompt-contract'

// —— LA-PROMPT-001：contract / renderer 新面 ——
export {
  LINGUIST_PROMPT_CONTRACT_VERSION,
  buildLinguistPromptContract,
  computeLinguistPromptContractHash,
  serializeLinguistPromptContractCanonical,
} from './prompt-contract'
export type {
  LinguistPromptContract,
  LinguistPromptContractBuild,
  LinguistPromptContractBuildOptions,
  LinguistPromptContractStatus,
  LinguistPromptEnvelope,
  LinguistPromptLayer,
} from './prompt-contract'
export { renderLinguistPrompt, LINGUIST_PROMPT_RENDERERS } from './prompt-renderer'
export type { LinguistPromptRenderer } from './prompt-renderer'

// —— LA-PROMPT-002：全局预算 allocator 面 ——
export {
  PROJECT_DIGEST_GLOBAL_BUDGET_NOTE,
  allocateLinguistPromptGlobalBudget,
  enforceLinguistPromptWireBudget,
  estimateLinguistPromptWireLength,
} from './prompt-contract'
export type {
  LinguistPromptGlobalBudgetDecision,
  LinguistPromptTrimmedLayer,
} from './prompt-contract'

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

export interface LinguistPromptBuildOptions extends LinguistPromptContractBuildOptions {
  /** wire 表达；缺省 'xml'（与历史输出 byte 级一致）。 */
  readonly renderer?: LinguistPromptRenderer
}

export interface LinguistPromptStatus extends LinguistPromptContractStatus {
  /** 渲染后 wire 文本的 sha256（随 renderer 变化；跨 renderer 等价用 promptContractHash）。 */
  readonly promptHash: string
  /** 本次渲染使用的 renderer。 */
  readonly renderer: LinguistPromptRenderer
}

export interface LinguistPromptBuildResult {
  readonly prompt: string
  readonly status: LinguistPromptStatus
}

/** 与真实 system prompt 共用一次解析，供 Dev Diagnostics 重新探测。 */
export function buildLinguistProjectAssetsPromptWithStatus(
  session: Pick<
    AgentSessionMeta,
    'linguistProjectId' | 'linguistRole'
  > & {
    linguistProjectId: string
  },
  getService: LinguistServiceResolver,
  options: LinguistPromptBuildOptions = {},
): LinguistPromptBuildResult {
  const { contract, status } = buildLinguistPromptContract(session, getService, options)
  const renderer = options.renderer ?? 'xml'
  const prompt = renderLinguistPrompt(contract, renderer)
  return {
    prompt,
    status: {
      ...status,
      promptHash: sha256(prompt),
      renderer,
    },
  }
}

/** 组合 Profile/Quality Contract/Role/Digest；普通会话返回空串。 */
export function buildLinguistProjectAssetsPrompt(
  session: Pick<
    AgentSessionMeta,
    'linguistProjectId' | 'linguistRole'
  > | undefined,
  getService: LinguistServiceResolver,
  options: LinguistPromptBuildOptions = {},
): string {
  if (!session?.linguistProjectId) return ''
  return buildLinguistProjectAssetsPromptWithStatus(
    session as typeof session & { linguistProjectId: string },
    getService,
    options,
  ).prompt
}

export function getLinguistPromptCacheSize(): number {
  return getLinguistPromptContractCacheSize()
}
