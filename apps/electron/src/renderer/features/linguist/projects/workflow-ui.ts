import type {
  LinguistCurrentStageState,
  LinguistSegmentStatus,
  LinguistWorkflowStage,
} from '@proma/shared'

const ACTION_LABELS: Record<LinguistWorkflowStage, string> = {
  translation: '确认翻译',
  editing: '确认审校',
  proofreading: '确认校对',
}

const COMPLETION_LABELS: Record<LinguistWorkflowStage, string> = {
  translation: '已确认',
  editing: '已审校',
  proofreading: '已校对',
}

const PROGRESS_LABELS: Record<
  LinguistWorkflowStage,
  Record<LinguistCurrentStageState, string>
> = {
  translation: {
    untouched: '未翻译',
    draft: '翻译草稿',
    confirmed: '已确认',
  },
  editing: {
    untouched: '待审校',
    draft: '审校草稿',
    confirmed: '已审校',
  },
  proofreading: {
    untouched: '待校对',
    draft: '校对草稿',
    confirmed: '已校对',
  },
}

export interface StageFilterOption {
  value: LinguistCurrentStageState
  label: string
}

export function stageActionLabel(stage: LinguistWorkflowStage): string {
  return ACTION_LABELS[stage]
}

export function stageCompletionLabel(stage: LinguistWorkflowStage): string {
  return COMPLETION_LABELS[stage]
}

export function stageBulkConfirmationSummary(
  stage: LinguistWorkflowStage,
  succeededCount: number,
  failedCount: number,
): string {
  return `${stageCompletionLabel(stage)} ${succeededCount} 段，${failedCount} 段失败`
}

export function stageProgressLabel(
  stage: LinguistWorkflowStage,
  state: LinguistCurrentStageState,
  hasTarget: boolean,
): string {
  if (stage === 'translation' && state === 'untouched' && hasTarget) return '待确认'
  return PROGRESS_LABELS[stage][state]
}

export function stageFilterOptions(stage: LinguistWorkflowStage): StageFilterOption[] {
  return (['untouched', 'draft', 'confirmed'] as const).map((value) => ({
    value,
    label: stage === 'translation' && value === 'untouched'
      ? '未翻译 / 待确认'
      : PROGRESS_LABELS[stage][value],
  }))
}

export function stageProgressSummary(
  stage: LinguistWorkflowStage,
  counts: Readonly<Record<LinguistCurrentStageState, number>>,
): string {
  const total = counts.untouched + counts.draft + counts.confirmed
  return `${PROGRESS_LABELS[stage].confirmed} ${counts.confirmed} / ${total}`
}

export function nextStageItemLabel(stage: LinguistWorkflowStage): string {
  if (stage === 'translation') return '下一个未翻译 / 待确认'
  return `下一个${PROGRESS_LABELS[stage].untouched}`
}

/** 阶段中文名（STATUS 图例用；与 stage-coverage-atoms 的 STAGE_COVERAGE_LABELS 一致）。 */
const STAGE_NAMES: Record<LinguistWorkflowStage, string> = {
  translation: '翻译',
  editing: '审校',
  proofreading: '校对',
}

/** STATUS 徽标颜色对应的整体流程状态（LinguistSegmentStatus）文案。 */
const SEGMENT_STATUS_LABELS: Record<LinguistSegmentStatus, string> = {
  untranslated: '未翻译',
  draft: '草稿',
  translated: '已翻译',
  reviewed: '已审校',
}

const STAGE_STATE_DESCRIPTIONS: Record<
  LinguistWorkflowStage,
  Record<LinguistCurrentStageState, string>
> = {
  translation: {
    untouched: '尚无译文，尚未翻译',
    draft: '翻译草稿已暂存，尚未确认',
    confirmed: '翻译已确认，可进入审校',
  },
  editing: {
    untouched: '等待审校，尚未开始本轮确认',
    draft: '审校修改已暂存，尚未确认',
    confirmed: '审校已确认，可进入校对',
  },
  proofreading: {
    untouched: '等待校对，尚未开始本轮确认',
    draft: '校对修改已暂存，尚未确认',
    confirmed: '校对已确认，片段完成',
  },
}

/**
 * U-13：STATUS 徽标的 title 图例。徽标颜色取自整体 LinguistSegmentStatus、
 * 文案取自当前阶段状态，同色可能不同义；title 同时给出两者含义，
 * 让任意状态颜色在界面内可查（不改色板）。
 */
export function segmentStatusBadgeTitle(
  stage: LinguistWorkflowStage,
  state: LinguistCurrentStageState,
  status: LinguistSegmentStatus,
  hasTarget: boolean,
): string {
  const label = stageProgressLabel(stage, state, hasTarget)
  const description = stage === 'translation' && state === 'untouched' && hasTarget
    ? '已有译文，等待确认翻译'
    : STAGE_STATE_DESCRIPTIONS[stage][state]
  return [
    `${STAGE_NAMES[stage]}阶段 · ${label}：${description}`,
    `徽标颜色对应整体状态：${SEGMENT_STATUS_LABELS[status]}`,
  ].join('\n')
}
