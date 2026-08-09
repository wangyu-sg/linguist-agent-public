import * as React from 'react'
import type { LinguistSegmentInfo, LinguistTagProfileInfo } from '@proma/shared'
import { compileTagFamilyRegex, scanTags } from '@linguist/cat-core'
import { Check, Loader2, Redo2, Undo2, X } from 'lucide-react'
import {
  canCommitTarget,
  canConfirmTarget,
  editKeyAction,
  targetSaveCompletion,
  type TargetSaveResult,
} from './cat-edit-utils'
import {
  extendSelectionOverHardSpans,
  hardSpanForUnitDeletion,
  listTargetTagSpans,
  skipHardSpanForArrow,
  snapCaretOutOfHardSpan,
} from './tag-atomic-utils'

export interface ProtectedTextPart {
  kind: 'text' | 'token' | 'suspected'
  value: string
}

export interface TargetDraftState {
  value: string
  past: readonly string[]
  future: readonly string[]
  composing: boolean
  compositionBase?: string
}

export type TargetDraftAction =
  | { type: 'reset'; value: string }
  | { type: 'commit'; value: string }
  | { type: 'composition-start' }
  | { type: 'composition-update'; value: string }
  | { type: 'composition-end'; value: string }
  | { type: 'undo' }
  | { type: 'redo' }

export const TARGET_UNDO_MAX_OPERATIONS = 200
export const TARGET_UNDO_MAX_CHARACTERS = 200_000

export interface TargetTextSelection {
  start: number
  end: number
}

export interface InsertTargetTextResult {
  value: string
  caret: number
}

export interface TargetEditorHandle {
  replace: (value: string) => boolean
  insert: (value: string) => boolean
  undo: () => boolean
  redo: () => boolean
  focus: () => void
}

export interface TargetEditorProps {
  index: number
  segment: LinguistSegmentInfo
  archived: boolean
  confirmLabel: string
  onCancel: () => void
  onSave: (target: string) => Promise<TargetSaveResult>
  onReload: () => Promise<LinguistSegmentInfo | undefined>
  onSaved?: (advance: boolean) => void
  onDraftChange?: (draft: string, dirty: boolean) => void
  onHandleChange?: (handle: TargetEditorHandle | undefined) => void
  tagProfile?: LinguistTagProfileInfo
}

export function splitProtectedText(text: string, tagProfile?: LinguistTagProfileInfo): ProtectedTextPart[] {
  const spans: Array<{ start: number; end: number; kind: 'token' | 'suspected' }> = scanTags(text, { profile: tagProfile })
    .map((tag) => ({ start: tag.start, end: tag.end, kind: 'token' }))
  for (const candidate of tagProfile?.candidates ?? []) {
    if (candidate.status !== 'candidate') continue
    const regex = compileTagFamilyRegex(candidate.pattern)
    if (regex === null) continue
    regex.lastIndex = 0
    for (const match of text.matchAll(regex)) {
      const start = match.index ?? 0
      const end = start + match[0].length
      if (match[0] && !spans.some((span) => !(end <= span.start || start >= span.end))) {
        spans.push({ start, end, kind: 'suspected' })
      }
    }
  }
  spans.sort((left, right) => left.start - right.start)
  const parts: ProtectedTextPart[] = []
  let cursor = 0
  for (const span of spans) {
    if (span.start > cursor) parts.push({ kind: 'text', value: text.slice(cursor, span.start) })
    parts.push({ kind: span.kind, value: text.slice(span.start, span.end) })
    cursor = span.end
  }
  if (cursor < text.length) parts.push({ kind: 'text', value: text.slice(cursor) })
  return parts
}

export function createTargetDraftState(value: string): TargetDraftState {
  return {
    value,
    past: [],
    future: [],
    composing: false,
  }
}

function boundDraftHistory(
  past: readonly string[],
  future: readonly string[],
  futureFirst = false,
): Pick<TargetDraftState, 'past' | 'future'> {
  let operations = TARGET_UNDO_MAX_OPERATIONS
  let characters = TARGET_UNDO_MAX_CHARACTERS
  const take = (values: readonly string[], nearestAtStart: boolean): string[] => {
    const kept: string[] = []
    if (nearestAtStart) {
      for (const value of values) {
        if (operations === 0 || value.length > characters) break
        kept.push(value)
        operations -= 1
        characters -= value.length
      }
      return kept
    }
    for (let index = values.length - 1; index >= 0; index -= 1) {
      const value = values[index]!
      if (operations === 0 || value.length > characters) break
      kept.unshift(value)
      operations -= 1
      characters -= value.length
    }
    return kept
  }
  if (futureFirst) {
    const boundedFuture = take(future, true)
    return { past: take(past, false), future: boundedFuture }
  }
  const boundedPast = take(past, false)
  return { past: boundedPast, future: take(future, true) }
}

function commitDraft(state: TargetDraftState, value: string): TargetDraftState {
  if (value === state.value) return state
  return {
    value,
    ...boundDraftHistory([...state.past, state.value], []),
    composing: false,
  }
}

export function targetDraftReducer(
  state: TargetDraftState,
  action: TargetDraftAction,
): TargetDraftState {
  switch (action.type) {
    case 'reset':
      return createTargetDraftState(action.value)
    case 'commit':
      return state.composing ? state : commitDraft(state, action.value)
    case 'composition-start':
      return state.composing
        ? state
        : { ...state, composing: true, compositionBase: state.value }
    case 'composition-update':
      return state.composing ? { ...state, value: action.value } : state
    case 'composition-end': {
      const compositionBase = state.compositionBase ?? state.value
      if (compositionBase === action.value) {
        return { ...state, value: action.value, composing: false, compositionBase: undefined }
      }
      return {
        value: action.value,
        ...boundDraftHistory([...state.past, compositionBase], []),
        composing: false,
      }
    }
    case 'undo': {
      if (state.composing || state.past.length === 0) return state
      const value = state.past.at(-1)!
      return {
        value,
        ...boundDraftHistory(
          state.past.slice(0, -1),
          [state.value, ...state.future],
          true,
        ),
        composing: false,
      }
    }
    case 'redo': {
      if (state.composing || state.future.length === 0) return state
      const [value, ...future] = state.future
      return {
        value: value!,
        ...boundDraftHistory([...state.past, state.value], future),
        composing: false,
      }
    }
  }
}

export function insertTargetText(
  value: string,
  inserted: string,
  selection?: TargetTextSelection,
): InsertTargetTextResult {
  const start = selection?.start ?? value.length
  const end = selection?.end ?? value.length
  return {
    value: `${value.slice(0, start)}${inserted}${value.slice(end)}`,
    caret: start + inserted.length,
  }
}

export function targetProtectionViolations(
  segment: Pick<LinguistSegmentInfo, 'source'>,
  target: string,
  tagProfile?: LinguistTagProfileInfo,
): string[] {
  const sourceTokens = splitProtectedText(segment.source, tagProfile)
    .filter((part) => part.kind === 'token')
    .map((part) => part.value)
  const targetTokens = splitProtectedText(target, tagProfile)
    .filter((part) => part.kind === 'token')
    .map((part) => part.value)
  const remainingTarget = [...targetTokens]
  const violations: string[] = []
  for (const token of sourceTokens) {
    const index = remainingTarget.indexOf(token)
    if (index < 0) violations.push(`missing:${token}`)
    else remainingTarget.splice(index, 1)
  }
  return [
    ...violations,
    ...remainingTarget.map((token) => `extra:${token}`),
  ]
}

export function targetSuspectedTagWarnings(
  segment: Pick<LinguistSegmentInfo, 'source'>,
  target: string,
  tagProfile?: LinguistTagProfileInfo,
): string[] {
  const values = (text: string) => splitProtectedText(text, tagProfile)
    .filter((part) => part.kind === 'suspected')
    .map((part) => part.value)
  const remaining = values(target)
  return values(segment.source).flatMap((value) => {
    const index = remaining.indexOf(value)
    if (index < 0) return [`missing-suspected:${value}`]
    remaining.splice(index, 1)
    return []
  })
}

function ProtectedTokenChips({
  text,
  tagProfile,
}: {
  text: string
  tagProfile?: LinguistTagProfileInfo
}): React.ReactElement | null {
  const tokens = splitProtectedText(text, tagProfile).filter((part) => part.kind !== 'text')
  if (tokens.length === 0) return null
  return (
    <span
      aria-label="源文必须保留的标签与占位符"
      className="flex min-w-0 flex-wrap items-center gap-1"
    >
      {tokens.map((token, index) => (
        <span
          key={`${token.value}:${index}`}
          data-target-token
          className={token.kind === 'token'
            ? 'inline-flex max-w-full rounded bg-primary/10 px-1 py-0.5 font-mono text-[10px] leading-none text-primary'
            : 'inline-flex max-w-full rounded bg-warning/10 px-1 py-0.5 font-mono text-[10px] leading-none text-warning'}
          title={token.kind === 'token' ? '已启用硬保护' : '疑似 Tag：仅软提示'}
        >
          {token.value}
        </span>
      ))}
    </span>
  )
}

export const TargetEditor = React.forwardRef<TargetEditorHandle, TargetEditorProps>(
  function TargetEditor({
    index,
    segment,
    archived,
    confirmLabel,
    onCancel,
    onSave,
    onReload,
    onSaved,
    onDraftChange,
    onHandleChange,
    tagProfile,
  }, ref): React.ReactElement {
    const [state, dispatch] = React.useReducer(
      targetDraftReducer,
      segment.target,
      createTargetDraftState,
    )
    const [saving, setSaving] = React.useState(false)
    const [blocked, setBlocked] = React.useState(false)
    const [conflict, setConflict] = React.useState(false)
    const [resolvingConflict, setResolvingConflict] = React.useState(false)
    const [tagHint, setTagHint] = React.useState<string>()
    const textareaRef = React.useRef<HTMLTextAreaElement>(null)
    const composingRef = React.useRef(false)
    const pendingCaretRef = React.useRef<number>()
    const previousSegmentRef = React.useRef(segment)
    const draftValueRef = React.useRef(state.value)
    const acceptedLatestRef = React.useRef<{ preserveDraft: boolean }>()
    const readOnly = archived || segment.locked
    const dirty = state.value !== segment.target
    draftValueRef.current = state.value
    const violations = React.useMemo(
      () => targetProtectionViolations(segment, state.value, tagProfile),
      [segment, state.value, tagProfile],
    )
    const suspectedWarnings = React.useMemo(
      () => targetSuspectedTagWarnings(segment, state.value, tagProfile),
      [segment, state.value, tagProfile],
    )
    /** K8 整单元导航的统一 span 来源（hard=scanTags；soft=候选正则）。 */
    const tagSpans = React.useMemo(
      () => listTargetTagSpans(state.value, tagProfile),
      [state.value, tagProfile],
    )
    const commitAvailability = {
      archived,
      locked: segment.locked,
      dirty,
      saving,
      resolvingConflict,
      composing: state.composing,
      hasViolations: violations.length > 0,
      conflict,
    }
    const canCommit = canCommitTarget(commitAvailability)
    const canConfirm = onSaved !== undefined && canConfirmTarget(commitAvailability)

    React.useEffect(() => {
      const previous = previousSegmentRef.current
      previousSegmentRef.current = segment
      if (previous.id !== segment.id) {
        acceptedLatestRef.current = undefined
        dispatch({ type: 'reset', value: segment.target })
        setBlocked(false)
        setConflict(false)
        setTagHint(undefined)
        return
      }
      if (
        previous.revision === segment.revision
        && previous.target === segment.target
      ) return
      const acceptedLatest = acceptedLatestRef.current
      acceptedLatestRef.current = undefined
      if (acceptedLatest?.preserveDraft) return
      if (acceptedLatest !== undefined || draftValueRef.current === previous.target) {
        dispatch({ type: 'reset', value: segment.target })
        setBlocked(false)
        setConflict(false)
        return
      }
      setConflict(true)
    }, [segment.id, segment.revision, segment.target])

    React.useEffect(() => {
      onDraftChange?.(state.value, dirty)
    }, [dirty, onDraftChange, state.value])

    React.useEffect(() => {
      const caret = pendingCaretRef.current
      if (caret === undefined) return
      pendingCaretRef.current = undefined
      textareaRef.current?.focus()
      textareaRef.current?.setSelectionRange(caret, caret)
    }, [state.value])

    const acceptCandidate = React.useCallback((
      value: string,
      operation: 'manual' | 'protected',
      action: TargetDraftAction = { type: 'commit', value },
    ): boolean => {
      const nextViolations = targetProtectionViolations(segment, value, tagProfile)
      const currentIsValid = targetProtectionViolations(segment, state.value, tagProfile).length === 0
      if (
        nextViolations.length > 0
        && (operation === 'protected' || currentIsValid)
      ) {
        setBlocked(true)
        return false
      }
      setBlocked(false)
      setTagHint(undefined)
      dispatch(action)
      return true
    }, [segment, state.value, tagProfile])

    const undo = React.useCallback((): boolean => {
      if (state.composing || state.past.length === 0) return false
      setBlocked(false)
      dispatch({ type: 'undo' })
      return true
    }, [state.composing, state.past.length])

    const redo = React.useCallback((): boolean => {
      if (state.composing || state.future.length === 0) return false
      setBlocked(false)
      dispatch({ type: 'redo' })
      return true
    }, [state.composing, state.future.length])

    const replace = React.useCallback((value: string): boolean => {
      if (readOnly || composingRef.current) return false
      return acceptCandidate(value, 'protected')
    }, [acceptCandidate, readOnly])

    const insert = React.useCallback((value: string): boolean => {
      if (readOnly || composingRef.current) return false
      const textarea = textareaRef.current
      // Bottom Dock 按钮会暂时取得 DOM 焦点，但 textarea 仍保留用户最后的选区。
      const selection = textarea !== null
        ? { start: textarea.selectionStart, end: textarea.selectionEnd }
        : undefined
      const result = insertTargetText(state.value, value, selection)
      if (!acceptCandidate(result.value, 'protected')) return false
      pendingCaretRef.current = result.caret
      return true
    }, [acceptCandidate, readOnly, state.value])

    const operationsRef = React.useRef({ replace, insert, undo, redo })
    operationsRef.current = { replace, insert, undo, redo }
    const handle = React.useMemo<TargetEditorHandle>(() => ({
      replace: (value) => operationsRef.current.replace(value),
      insert: (value) => operationsRef.current.insert(value),
      undo: () => operationsRef.current.undo(),
      redo: () => operationsRef.current.redo(),
      focus: () => textareaRef.current?.focus(),
    }), [])

    React.useImperativeHandle(ref, () => handle, [handle])

    React.useEffect(() => {
      onHandleChange?.(handle)
      return () => onHandleChange?.(undefined)
    }, [handle, onHandleChange])

    const save = async (advance: boolean): Promise<void> => {
      if ((advance ? !canConfirm : !canCommit) || composingRef.current) return
      if (advance && !dirty) {
        onSaved?.(true)
        return
      }
      setSaving(true)
      try {
        const completion = targetSaveCompletion(await onSave(state.value), advance)
        if (completion === 'conflict') {
          setConflict(true)
        } else if (completion === 'close' || completion === 'advance') {
          onSaved?.(completion === 'advance')
        }
      } finally {
        setSaving(false)
      }
    }

    const resolveConflict = async (preserveDraft: boolean): Promise<void> => {
      if (resolvingConflict || saving) return
      acceptedLatestRef.current = { preserveDraft }
      setResolvingConflict(true)
      try {
        const latest = await onReload()
        if (latest === undefined) {
          acceptedLatestRef.current = undefined
          return
        }
        if (
          latest.revision === segment.revision
          && latest.target === segment.target
        ) {
          acceptedLatestRef.current = undefined
        }
        dispatch({
          type: 'reset',
          value: latest.target,
        })
        if (preserveDraft) {
          dispatch({ type: 'commit', value: state.value })
        }
        setBlocked(false)
        setConflict(false)
      } finally {
        setResolvingConflict(false)
      }
    }

    const cancel = (): void => {
      if (saving || resolvingConflict) return
      if (conflict) void onReload()
      onCancel()
    }

    return (
      <span
        role="group"
        aria-label={`正在编辑原始行 ${index + 1} 译文`}
        aria-busy={saving || resolvingConflict}
        data-target-editor
        className="flex min-w-0 flex-col gap-1"
      >
        <textarea
          ref={textareaRef}
          autoFocus={!readOnly}
          readOnly={readOnly}
          value={state.value}
          aria-label={`编辑原始行 ${index + 1} 译文`}
          aria-invalid={violations.length > 0}
          aria-describedby={`target-editor-help-${segment.id}`}
          aria-keyshortcuts="Meta+S Control+S Meta+Enter Control+Enter Escape Meta+Z Control+Z Meta+Shift+Z Control+Shift+Z Control+Y"
          onChange={(event) => {
            const value = event.target.value
            if (composingRef.current) {
              acceptCandidate(value, 'manual', { type: 'composition-update', value })
            } else {
              acceptCandidate(value, 'manual')
            }
          }}
          onPaste={(event) => {
            if (readOnly) return
            const result = insertTargetText(
              state.value,
              event.clipboardData.getData('text/plain'),
              {
                start: event.currentTarget.selectionStart,
                end: event.currentTarget.selectionEnd,
              },
            )
            if (!acceptCandidate(result.value, 'protected')) {
              event.preventDefault()
              return
            }
            event.preventDefault()
            pendingCaretRef.current = result.caret
          }}
          onCompositionStart={() => {
            composingRef.current = true
            dispatch({ type: 'composition-start' })
          }}
          onCompositionEnd={(event) => {
            composingRef.current = false
            const value = event.currentTarget.value
            if (!acceptCandidate(
              value,
              'manual',
              { type: 'composition-end', value },
            )) {
              dispatch({ type: 'composition-end', value: state.value })
            }
            // IME composition 期间不校正选区；compositionend 后再把光标吸出 hard span。
            requestAnimationFrame(() => {
              const el = textareaRef.current
              if (el === null || composingRef.current) return
              if (el.selectionStart !== el.selectionEnd) return
              const snapped = snapCaretOutOfHardSpan(
                el.selectionStart,
                listTargetTagSpans(el.value, tagProfile),
              )
              if (snapped !== null) el.setSelectionRange(snapped, snapped)
            })
          }}
          onSelect={(event) => {
            if (readOnly || composingRef.current) return
            const textarea = event.currentTarget
            const { selectionStart, selectionEnd } = textarea
            if (selectionStart === selectionEnd) {
              const snapped = snapCaretOutOfHardSpan(selectionStart, tagSpans)
              if (snapped !== null) textarea.setSelectionRange(snapped, snapped)
              return
            }
            const extended = extendSelectionOverHardSpans(selectionStart, selectionEnd, tagSpans)
            if (extended !== null) textarea.setSelectionRange(extended.start, extended.end)
          }}
          onKeyDown={(event) => {
            // K8：hard span 按整单元跨越和选中；最终写入仍由结构规则校验。
            if (
              !readOnly
              && !composingRef.current
              && !event.nativeEvent.isComposing
              && !event.metaKey
              && !event.ctrlKey
              && !event.altKey
            ) {
              const textarea = event.currentTarget
              const collapsed = textarea.selectionStart === textarea.selectionEnd
              if (
                collapsed
                && !event.shiftKey
                && (event.key === 'ArrowLeft' || event.key === 'ArrowRight')
              ) {
                const target = skipHardSpanForArrow(
                  textarea.selectionStart,
                  event.key === 'ArrowLeft' ? 'left' : 'right',
                  tagSpans,
                )
                if (target !== null) {
                  event.preventDefault()
                  textarea.setSelectionRange(target, target)
                  return
                }
              }
              if (event.key === 'Backspace' || event.key === 'Delete') {
                if (collapsed) {
                  const span = hardSpanForUnitDeletion(
                    textarea.selectionStart,
                    event.key === 'Backspace' ? 'backward' : 'forward',
                    tagSpans,
                  )
                  if (span !== null) {
                    event.preventDefault()
                    textarea.setSelectionRange(span.start, span.end)
                    setTagHint('已选中整个标签；再次按下删除键尝试移除。源文必需的标签无法删除。')
                    return
                  }
                }
                // 非折叠选区：交给原生删除 + onChange 守恒守卫（required 标签自然不可删）。
              }
            }
            const action = editKeyAction({
              key: event.key,
              metaKey: event.metaKey,
              ctrlKey: event.ctrlKey,
              shiftKey: event.shiftKey,
              isComposing: composingRef.current || event.nativeEvent.isComposing,
            })
            if (action === null) return
            event.preventDefault()
            if (action === 'cancel') cancel()
            else if (action === 'save') void save(false)
            else if (action === 'confirm-and-advance') void save(true)
            else if (action === 'undo') undo()
            else redo()
          }}
          className="h-16 w-full resize-none rounded-md bg-background px-2 py-1.5 text-[12px] leading-4 outline-none ring-1 ring-primary/45 read-only:cursor-not-allowed read-only:opacity-60"
        />
        <span className="flex min-w-0 flex-wrap items-center justify-between gap-1">
          <ProtectedTokenChips
            text={segment.source}
            tagProfile={tagProfile}
          />
          {dirty && (
            <span className="text-[10px] font-medium text-warning">未保存</span>
          )}
        </span>
        {conflict && (
          <span
            role="alert"
            className="rounded-md bg-warning/10 px-2 py-1.5 text-[10px] text-warning"
          >
            <span className="block font-medium">译文已有更新，草稿尚未覆盖最新内容。</span>
            <span className="mt-1 flex flex-wrap gap-1">
              <button
                type="button"
                disabled={resolvingConflict}
                onClick={() => void resolveConflict(false)}
                className="rounded bg-background/70 px-1.5 py-0.5 hover:bg-background disabled:opacity-40"
              >
                重新加载最新译文
              </button>
              <button
                type="button"
                disabled={resolvingConflict}
                onClick={() => void resolveConflict(true)}
                className="rounded bg-background/70 px-1.5 py-0.5 hover:bg-background disabled:opacity-40"
              >
                保留我的草稿
              </button>
            </span>
          </span>
        )}
        {suspectedWarnings.length > 0 && violations.length === 0 && (
          <span className="rounded-md bg-warning/10 px-2 py-1 text-[10px] text-warning">
            译文未保留 {suspectedWarnings.length} 个疑似 Tag；它们尚未启用硬保护，请确认是否可翻译。
          </span>
        )}
        {tagHint !== undefined && (
          <span role="status" className="rounded-md bg-primary/10 px-2 py-1 text-[10px] text-primary">
            {tagHint}
          </span>
        )}
        <span className="flex items-center justify-between gap-2 text-[10px] text-foreground/35">
          <span id={`target-editor-help-${segment.id}`}>
            {blocked || violations.length > 0
              ? '必须保留源文中的标签和占位符'
              : conflict
                ? '请先处理 Revision Conflict'
                : `⌘/Ctrl+S 保存 · ⌘/Ctrl+↵ ${confirmLabel}并前进 · Esc 取消`}
          </span>
          <span className="flex flex-wrap justify-end gap-1">
            <button
              type="button"
              aria-label="撤销译文编辑"
              title="撤销"
              onClick={undo}
              disabled={readOnly || state.composing || state.past.length === 0}
              className="rounded p-0.5 hover:bg-foreground/[0.08] disabled:opacity-35"
            >
              <Undo2 aria-hidden="true" className="size-3" />
            </button>
            <button
              type="button"
              aria-label="重做译文编辑"
              title="重做"
              onClick={redo}
              disabled={readOnly || state.composing || state.future.length === 0}
              className="rounded p-0.5 hover:bg-foreground/[0.08] disabled:opacity-35"
            >
              <Redo2 aria-hidden="true" className="size-3" />
            </button>
            <button
              type="button"
              aria-label="取消编辑"
              aria-keyshortcuts="Escape"
              onClick={cancel}
              disabled={saving || resolvingConflict}
              className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 hover:bg-foreground/[0.08] disabled:opacity-35"
            >
              <X aria-hidden="true" className="size-3" />
              取消
            </button>
            <button
              type="button"
              aria-label="保存译文"
              aria-keyshortcuts="Meta+S Control+S"
              onClick={() => void save(false)}
              disabled={!canCommit}
              className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 hover:bg-foreground/[0.08] disabled:opacity-35"
            >
              {saving
                ? <Loader2 aria-hidden="true" className="size-3 animate-spin" />
                : <Check aria-hidden="true" className="size-3" />}
              保存
            </button>
            <button
              type="button"
              aria-label={`${confirmLabel}并前进`}
              aria-keyshortcuts="Meta+Enter Control+Enter"
              onClick={() => void save(true)}
              disabled={!canConfirm}
              className="rounded bg-primary px-1.5 py-0.5 font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-35"
            >
              {confirmLabel}并前进
            </button>
          </span>
        </span>
        <span role="status" aria-live="polite" className="sr-only">
          {saving
            ? '正在保存译文'
            : resolvingConflict
              ? '正在重新加载最新译文'
              : conflict
                ? '译文存在 Revision Conflict'
                : blocked || violations.length > 0
                  ? '译文未保留全部标签或占位符'
                  : dirty
                    ? '译文有未保存更改'
                    : '译文已保存'}
        </span>
      </span>
    )
  },
)
