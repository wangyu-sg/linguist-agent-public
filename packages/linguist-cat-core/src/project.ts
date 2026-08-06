/**
 * LinguistProject — plan-mandated schema (schemaVersion 1). Pure data.
 */

import { generateProjectId, type EntropySource, type ProjectId } from './ids'
import type { LinguistExecutionPolicy } from './execution-policy'
import type { LinguistGlossaryPolicy } from './glossary-policy'
import type { LinguistQualityProfile } from './quality-profile'
import { normalizeQaProfile, type QaProfile } from './qa-profile'
import type { LinguistTagProfile } from './tag-profile'
import {
  normalizeWorkflowStage,
  type WorkflowOutputStatusPolicy,
  type WorkflowStage,
} from './workflow'

export interface LinguistProject {
  schemaVersion: 1
  id: ProjectId
  name: string
  sourceLocale: string
  targetLocale: string
  promaWorkspaceId: string
  createdAt: string
  updatedAt: string
  archivedAt?: string
  /**
   * Execution Policy（LA-QUALITY-001，取代质量档位）。可选字段：旧
   * project.json 无此键，读取经 resolveExecutionPolicy 处理（显式值优先，
   * 其次 legacy qualityProfile 映射，最后回落默认），绝不主动回写 legacy 字段。
   */
  executionPolicy?: LinguistExecutionPolicy
  /**
   * Legacy quality strategy tier (PB-082, plan §21；LA-QUALITY-001 起只读)。
   * 旧 project.json 可能仍携带；新写入不再产生，读取时经
   * executionPolicyFromLegacyQualityProfile 映射（best → risk-based，其余 → off）。
   */
  qualityProfile?: LinguistQualityProfile
  /**
   * 术语执行策略（PB-096，契约《通用缺陷等级》）。可选字段，同
   * qualityProfile 先例：旧 project.json 无此键，读取经
   * normalizeGlossaryPolicy 回落 'prefer'，绝不主动回写。
   */
  glossaryPolicy?: LinguistGlossaryPolicy
  /**
   * 项目 tag 族登记表（PB-097）。可选字段，同 qualityProfile 先例：旧
   * project.json 无此键，读取经 normalizeTagProfile 回落 undefined
   * （= 仅内置族），绝不主动回写。项目族手工登记，不做 LLM 自动发现。
   */
  tagProfile?: LinguistTagProfile
  /** 当前项目承担的 T/E/P 任务阶段；旧项目读取时规范化为 translation。 */
  workflowStage?: WorkflowStage
  /** 格式原生状态的项目级覆盖策略。 */
  outputStatusPolicy?: WorkflowOutputStatusPolicy
  /** 确定性 QA 的项目预设；旧项目读取为 general。 */
  qaProfile?: QaProfile
}

export interface CreateProjectInput {
  name: string
  sourceLocale: string
  targetLocale: string
  promaWorkspaceId: string
  workflowStage?: WorkflowStage
  outputStatusPolicy?: WorkflowOutputStatusPolicy
  qaProfile?: QaProfile
}

export interface CreateProjectDeps {
  entropy?: EntropySource
  /** ISO timestamp; inject for determinism. */
  now?: string
}

export function createProject(input: CreateProjectInput, deps: CreateProjectDeps = {}): LinguistProject {
  const now = deps.now ?? new Date().toISOString()
  return {
    schemaVersion: 1,
    id: generateProjectId(deps.entropy),
    name: input.name,
    sourceLocale: input.sourceLocale,
    targetLocale: input.targetLocale,
    promaWorkspaceId: input.promaWorkspaceId,
    workflowStage: normalizeWorkflowStage(input.workflowStage),
    qaProfile: normalizeQaProfile(input.qaProfile),
    ...(input.outputStatusPolicy !== undefined
      ? { outputStatusPolicy: input.outputStatusPolicy }
      : {}),
    createdAt: now,
    updatedAt: now,
  }
}

/** Archive is metadata-only; returns a new project object. */
export function archiveProject(project: LinguistProject, now: string): LinguistProject {
  return { ...project, archivedAt: now, updatedAt: now }
}
