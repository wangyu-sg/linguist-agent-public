import { describe, expect, test } from 'bun:test'
import {
  canCommitTarget,
  editKeyAction,
  targetSaveCompletion,
} from './cat-edit-utils'

describe('PB-062 Target edit keyboard/IME behavior', () => {
  test('Cmd/Ctrl+Enter saves only after IME composition ends', () => {
    expect(editKeyAction({
      key: 'Enter',
      metaKey: true,
      ctrlKey: false,
      shiftKey: false,
      isComposing: true,
    })).toBeNull()
    expect(editKeyAction({
      key: 'Enter',
      metaKey: true,
      ctrlKey: false,
      shiftKey: false,
      isComposing: false,
    })).toBe('confirm-and-advance')
    expect(editKeyAction({
      key: 'Enter',
      metaKey: false,
      ctrlKey: true,
      shiftKey: false,
      isComposing: false,
    })).toBe('confirm-and-advance')
    expect(editKeyAction({
      key: 'Enter',
      metaKey: false,
      ctrlKey: false,
      shiftKey: false,
      isComposing: false,
    })).toBeNull()
  })

  test('Escape cancels without depending on composition state', () => {
    expect(editKeyAction({
      key: 'Escape',
      metaKey: false,
      ctrlKey: false,
      shiftKey: false,
      isComposing: true,
    })).toBe('cancel')
  })

  test('Cmd/Ctrl+Z and Ctrl+Y provide explicit undo/redo outside IME', () => {
    expect(editKeyAction({
      key: 'z',
      metaKey: true,
      ctrlKey: false,
      shiftKey: false,
      isComposing: false,
    })).toBe('undo')
    expect(editKeyAction({
      key: 'Z',
      metaKey: true,
      ctrlKey: false,
      shiftKey: true,
      isComposing: false,
    })).toBe('redo')
    expect(editKeyAction({
      key: 'y',
      metaKey: false,
      ctrlKey: true,
      shiftKey: false,
      isComposing: false,
    })).toBe('redo')
    expect(editKeyAction({
      key: 'z',
      metaKey: true,
      ctrlKey: false,
      shiftKey: false,
      isComposing: true,
    })).toBeNull()
  })

  test('given 可提交草稿 when 按 Cmd/Ctrl+S then 保存但不前进，IME 期间不处理', () => {
    expect(editKeyAction({
      key: 's',
      metaKey: true,
      ctrlKey: false,
      shiftKey: false,
      isComposing: false,
    })).toBe('save')
    expect(editKeyAction({
      key: 'S',
      metaKey: false,
      ctrlKey: true,
      shiftKey: false,
      isComposing: false,
    })).toBe('save')
    expect(editKeyAction({
      key: 's',
      metaKey: true,
      ctrlKey: false,
      shiftKey: false,
      isComposing: true,
    })).toBeNull()
  })
})

describe('LF-045 Target 保存工作流', () => {
  const editable = {
    archived: false,
    locked: false,
    dirty: true,
    saving: false,
    resolvingConflict: false,
    composing: false,
    hasViolations: false,
    conflict: false,
  }

  test('given 可编辑草稿 when 保存成功 then 普通保存关闭、确认并前进才移动', () => {
    expect(canCommitTarget(editable)).toBeTrue()
    expect(targetSaveCompletion('saved', false)).toBe('close')
    expect(targetSaveCompletion('saved', true)).toBe('advance')
    expect(targetSaveCompletion('failed', true)).toBe('stay')
  })

  test('given Revision Conflict when 保存返回冲突 then 不关闭且可选择最新译文或保留草稿', () => {
    expect(targetSaveCompletion('conflict', true)).toBe('conflict')
  })

  test('given locked、archived 或 IME composition when 请求保存 then fail closed', () => {
    expect(canCommitTarget({ ...editable, locked: true })).toBeFalse()
    expect(canCommitTarget({ ...editable, archived: true })).toBeFalse()
    expect(canCommitTarget({ ...editable, composing: true })).toBeFalse()
    expect(canCommitTarget({ ...editable, conflict: true })).toBeFalse()
    expect(canCommitTarget({ ...editable, dirty: false })).toBeFalse()
  })
})
