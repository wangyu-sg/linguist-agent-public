import type {
  LinguistCurrentStageState,
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
