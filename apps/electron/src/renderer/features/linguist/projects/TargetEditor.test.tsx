import { describe, expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import type { LinguistSegmentInfo } from '@proma/shared'
import {
  TargetEditor,
  TARGET_UNDO_MAX_CHARACTERS,
  TARGET_UNDO_MAX_OPERATIONS,
  createTargetDraftState,
  insertTargetText,
  targetDraftReducer,
  targetProtectionViolations,
} from './TargetEditor'

const segment: LinguistSegmentInfo = {
  id: 'seg-0000000000000001',
  assetId: 'asset-1',
  ordinal: 0,
  source: 'Press <b>{name}</b>',
  target: '按下 <b>{name}</b>',
  sourceLocale: 'en',
  targetLocale: 'zh-CN',
  status: 'translated',
  locked: false,
  revision: 3,
  sourceHash: 'hash',
}

describe('LF-044/LF-047 TargetEditor', () => {
  test('given 连续输入和替换 when Undo/Redo then 按编辑历史恢复草稿', () => {
    let state = createTargetDraftState('初始')
    state = targetDraftReducer(state, { type: 'commit', value: '第一次' })
    state = targetDraftReducer(state, { type: 'commit', value: '替换内容' })

    state = targetDraftReducer(state, { type: 'undo' })
    expect(state.value).toBe('第一次')
    state = targetDraftReducer(state, { type: 'undo' })
    expect(state.value).toBe('初始')
    state = targetDraftReducer(state, { type: 'redo' })
    expect(state.value).toBe('第一次')
  })

  test('given 长编辑会话 when 持续输入 then Undo 历史同时受操作数与字符预算限制', () => {
    let state = createTargetDraftState('初始')
    for (let index = 0; index < TARGET_UNDO_MAX_OPERATIONS + 50; index += 1) {
      state = targetDraftReducer(state, { type: 'commit', value: `译文-${index}` })
    }
    expect(state.past).toHaveLength(TARGET_UNDO_MAX_OPERATIONS)

    state = createTargetDraftState('初始')
    const largeEdit = '译'.repeat(Math.ceil(TARGET_UNDO_MAX_CHARACTERS / 3))
    for (let index = 0; index < 5; index += 1) {
      state = targetDraftReducer(state, { type: 'commit', value: `${index}${largeEdit}` })
    }
    expect(state.past.reduce((total, value) => total + value.length, 0))
      .toBeLessThanOrEqual(TARGET_UNDO_MAX_CHARACTERS)
  })

  test('given IME composition when 产生多个中间值 then 只留下一个可撤销步骤', () => {
    let state = createTargetDraftState('旧')
    state = targetDraftReducer(state, { type: 'composition-start' })
    state = targetDraftReducer(state, { type: 'composition-update', value: 'x' })
    state = targetDraftReducer(state, { type: 'composition-update', value: '新' })
    state = targetDraftReducer(state, { type: 'composition-end', value: '新词' })

    expect(state.value).toBe('新词')
    expect(state.composing).toBeFalse()
    expect(targetDraftReducer(state, { type: 'undo' }).value).toBe('旧')
  })

  test('given Revision Conflict when 加载最新 revision then 可替换草稿或将原草稿 rebase 到最新值', () => {
    const draft = targetDraftReducer(createTargetDraftState('旧译文'), {
      type: 'commit',
      value: '我的草稿',
    })
    const latest = targetDraftReducer(draft, { type: 'reset', value: '服务端最新译文' })
    expect(latest.value).toBe('服务端最新译文')

    const preserved = targetDraftReducer(latest, { type: 'commit', value: draft.value })
    expect(preserved.value).toBe('我的草稿')
    expect(targetDraftReducer(preserved, { type: 'undo' }).value).toBe('服务端最新译文')
  })

  test('given 光标或点击 Bottom Dock 前保留的选区 when Insert then 插入光标、替换选区，无选区信息时追加', () => {
    expect(insertTargetText('abcd', 'X', { start: 2, end: 2 })).toEqual({
      value: 'abXcd',
      caret: 3,
    })
    expect(insertTargetText('abcd', 'X', { start: 1, end: 3 })).toEqual({
      value: 'aXd',
      caret: 2,
    })
    expect(insertTargetText('abcd', 'X')).toEqual({
      value: 'abcdX',
      caret: 5,
    })
  })

  test('given Source Tag/Placeholder when Replace 或 Insert 形成不守恒草稿 then 返回 hard rail', () => {
    expect(targetProtectionViolations(segment, '按下 <b>{name}</b>')).toEqual([])
    expect(targetProtectionViolations(segment, '按下 name')).toEqual([
      'missing:<b>',
      'missing:{name}',
      'missing:</b>',
    ])
    expect(targetProtectionViolations(segment, '按下 <b>{name}')).toEqual([
      'missing:</b>',
    ])
    expect(targetProtectionViolations(
      { source: '%s ${name} {{count}}' },
      '%s ${name}',
    )).toEqual(['missing:{{count}}'])
  })

  test('given 初始译文 when 渲染 then Tag/Placeholder 可见且无变更时保存禁用', () => {
    const html = renderToStaticMarkup(
      <TargetEditor
        index={0}
        segment={segment}
        archived={false}
        confirmLabel="确认审校"
        onCancel={() => {}}
        onSave={async () => 'saved'}
        onReload={async () => segment}
        onSaved={() => {}}
      />,
    )

    expect(html).toContain('aria-label="源文必须保留的标签与占位符"')
    expect(html).toContain('aria-label="正在编辑原始行 1 译文"')
    expect(html).toContain('aria-label="编辑原始行 1 译文"')
    expect(html).toContain('data-target-token="true"')
    expect(html).toContain('&lt;b&gt;')
    expect(html).toContain('{name}')
    expect(html).toContain('aria-label="撤销译文编辑"')
    expect(html).toContain('aria-label="重做译文编辑"')
    expect(html).toContain('aria-keyshortcuts="Meta+S Control+S Meta+Enter Control+Enter Escape')
    expect(html).toContain('⌘/Ctrl+S 保存')
    expect(html).toContain('role="status"')
    expect(html).toMatch(/aria-label="保存译文"[^>]*disabled=""/)
    const confirmButton = html.match(/<button[^>]*aria-label="确认审校并前进"[^>]*>/)?.[0]
    expect(confirmButton).toBeDefined()
    expect(confirmButton).not.toContain('disabled=')
    expect(html).toContain('确认审校并前进')
    expect(html).toContain('取消')
  })

  test('given locked 片段 when 独立渲染编辑器 then 保持只读且不可保存', () => {
    const html = renderToStaticMarkup(
      <TargetEditor
        index={0}
        segment={{ ...segment, locked: true }}
        archived={false}
        confirmLabel="确认审校"
        onCancel={() => {}}
        onSave={async () => 'saved'}
        onReload={async () => segment}
      />,
    )

    expect(html).toContain('readonly=""')
    expect(html).toContain('aria-label="保存译文"')
    expect(html).toContain('disabled=""')
  })

  test('given 已归档项目 when 独立渲染编辑器 then 与 locked 一样只读且不可保存', () => {
    const html = renderToStaticMarkup(
      <TargetEditor
        index={0}
        segment={segment}
        archived
        confirmLabel="确认审校"
        onCancel={() => {}}
        onSave={async () => 'saved'}
        onReload={async () => segment}
      />,
    )

    expect(html).toContain('readonly=""')
    expect(html).toMatch(/aria-label="保存译文"[^>]*disabled=""/)
    expect(html).toMatch(/aria-label="确认审校并前进"[^>]*disabled=""/)
  })
})
