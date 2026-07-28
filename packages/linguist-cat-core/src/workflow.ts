/**
 * 当前项目承担的语言工作阶段。它与文件中携带的原生状态、句段译文是否存在
 * 是三个不同维度。
 */
export const WORKFLOW_STAGES = ['translation', 'editing', 'proofreading'] as const

export type WorkflowStage = (typeof WORKFLOW_STAGES)[number]

export type CurrentStageState = 'untouched' | 'draft' | 'confirmed'

export type WorkflowStageEventAction = 'confirmed' | 'unconfirmed'

export interface WorkflowStageEvent {
  stage: WorkflowStage
  action: WorkflowStageEventAction
  segmentRevision: number
  actor?: string
  createdAt: string
}

export interface WorkflowStageMutationOptions {
  actor?: string
  now?: string
}

export interface WorkflowStageMutationResult {
  segment: Segment
  event: WorkflowStageEvent
}

/** 每种格式可以覆盖某一阶段确认后的原生输出状态。 */
export interface WorkflowOutputStatusPolicy {
  [formatId: string]: Partial<Record<WorkflowStage, string>> | undefined
}

export const DEFAULT_WORKFLOW_STAGE: WorkflowStage = 'translation'

const DEFAULT_NATIVE_STATUSES: WorkflowOutputStatusPolicy = {
  sdlxliff: {
    translation: 'Translated',
    editing: 'ApprovedTranslation',
    proofreading: 'ApprovedSignOff',
  },
  sdlxliff_1_2: {
    translation: 'Translated',
    editing: 'ApprovedTranslation',
    proofreading: 'ApprovedSignOff',
  },
}

export function normalizeWorkflowStage(value: unknown): WorkflowStage {
  return WORKFLOW_STAGES.includes(value as WorkflowStage) ? (value as WorkflowStage) : DEFAULT_WORKFLOW_STAGE
}

/**
 * 返回当前阶段确认后应写入的格式原生状态。未知格式没有通用状态，交给适配器
 * 保留原始元数据。
 */
export function nativeStatusForStage(
  stage: WorkflowStage,
  formatId: string,
  policy?: WorkflowOutputStatusPolicy,
): string | undefined {
  return policy?.[formatId]?.[stage] ?? DEFAULT_NATIVE_STATUSES[formatId]?.[stage]
}

function stageEvent(
  segment: Segment,
  stage: WorkflowStage,
  action: WorkflowStageEventAction,
  options: WorkflowStageMutationOptions,
): WorkflowStageEvent {
  return {
    stage,
    action,
    segmentRevision: segment.revision,
    ...(options.actor !== undefined ? { actor: options.actor } : {}),
    createdAt: options.now ?? new Date().toISOString(),
  }
}

/** CAS 确认当前阶段；确认本身不伪造一次目标文本修订。 */
export function confirmCurrentStage(
  segment: Segment,
  stage: WorkflowStage,
  expectedRevision: number,
  options: WorkflowStageMutationOptions = {},
): WorkflowStageMutationResult {
  assertSegmentEditable(segment)
  assertRevision(segment, expectedRevision)
  if (segment.target === '') {
    throw new InvalidStateTransitionError('segment-stage', 'untranslated', `${stage}:confirmed`)
  }
  if (segment.currentStageState === 'confirmed') {
    throw new InvalidStateTransitionError(
      'segment-stage',
      `${stage}:confirmed`,
      `${stage}:confirmed`,
    )
  }
  return {
    segment: { ...segment, currentStageState: 'confirmed' },
    event: stageEvent(segment, stage, 'confirmed', options),
  }
}

/** CAS 撤销本轮确认；目标文本保持不变，句段回到当前阶段草稿。 */
export function unconfirmCurrentStage(
  segment: Segment,
  stage: WorkflowStage,
  expectedRevision: number,
  options: WorkflowStageMutationOptions = {},
): WorkflowStageMutationResult {
  assertSegmentEditable(segment)
  assertRevision(segment, expectedRevision)
  if (segment.currentStageState !== 'confirmed') {
    throw new InvalidStateTransitionError(
      'segment-stage',
      `${stage}:${segment.currentStageState ?? 'untouched'}`,
      `${stage}:draft`,
    )
  }
  return {
    segment: { ...segment, currentStageState: 'draft' },
    event: stageEvent(segment, stage, 'unconfirmed', options),
  }
}
import { InvalidStateTransitionError } from './errors'
import {
  assertRevision,
  assertSegmentEditable,
  type Segment,
} from './segment'
