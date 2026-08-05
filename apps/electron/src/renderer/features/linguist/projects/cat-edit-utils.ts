export interface EditKeyInput {
  key: string
  metaKey: boolean
  ctrlKey: boolean
  shiftKey: boolean
  isComposing: boolean
}

export type TargetSaveResult = 'saved' | 'conflict' | 'failed'

export interface TargetCommitAvailability {
  archived: boolean
  locked: boolean
  dirty: boolean
  saving: boolean
  resolvingConflict: boolean
  composing: boolean
  hasViolations: boolean
  conflict: boolean
}

export function canCommitTarget(input: TargetCommitAvailability): boolean {
  return !input.archived
    && !input.locked
    && input.dirty
    && !input.saving
    && !input.resolvingConflict
    && !input.composing
    && !input.hasViolations
    && !input.conflict
}

export function canConfirmTarget(input: TargetCommitAvailability): boolean {
  return canCommitTarget({ ...input, dirty: true })
}

export function targetSaveCompletion(
  result: TargetSaveResult,
  advance: boolean,
): 'close' | 'advance' | 'conflict' | 'stay' {
  if (result === 'conflict') return 'conflict'
  if (result === 'failed') return 'stay'
  return advance ? 'advance' : 'close'
}

export function editKeyAction(
  input: EditKeyInput,
): 'save' | 'confirm-and-advance' | 'cancel' | 'undo' | 'redo' | null {
  if (input.key === 'Escape') return 'cancel'
  if (input.isComposing) return null
  const modifier = input.metaKey || input.ctrlKey
  if (input.key === 'Enter' && modifier) return 'confirm-and-advance'
  const key = input.key.toLowerCase()
  if (key === 's' && modifier) return 'save'
  if (key === 'z' && modifier) return input.shiftKey ? 'redo' : 'undo'
  if (key === 'y' && input.ctrlKey) return 'redo'
  return null
}
