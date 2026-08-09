import { describe, expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import type {
  LinguistSegmentInfo,
  LinguistTermMatchInfo,
} from '@proma/shared'
import type { LinguistTargetEditorCapability } from './cat-workspace-atoms'
import {
  createTargetDraftState,
  insertTargetText,
  targetDraftReducer,
  targetProtectionViolations,
  type TargetDraftState,
  type TargetTextSelection,
} from './TargetEditor'
import {
  applyTermMatchToEditor,
  getTermInsertDisabledReason,
  TermMatchView,
  termStateMatchesActiveContext,
} from './TermMatchPanel'

const segment: LinguistSegmentInfo = {
  id: 'segment-a',
  assetId: 'asset-a',
  ordinal: 0,
  source: 'Drink the potion',
  target: '喝下药水',
  sourceLocale: 'en',
  targetLocale: 'zh-CN',
  status: 'draft',
  locked: false,
  revision: 3,
  sourceHash: 'hash',
}

const preferredMatch: LinguistTermMatchInfo = {
  id: 'term-preferred',
  term: 'potion',
  translation: '药水',
  status: 'preferred',
  caseSensitive: true,
  note: '游戏内统一使用该译法',
  matchType: 'contains',
  conflict: true,
  start: 10,
  end: 16,
  lowDiscrimination: false,
}

function createCapabilityHarness({
  source,
  initial,
  selection,
}: {
  source: string
  initial: string
  selection?: TargetTextSelection
}): {
  capability: LinguistTargetEditorCapability
  getDraft: () => string
  getFocusCount: () => number
} {
  let draft: TargetDraftState = createTargetDraftState(initial)
  let focusCount = 0
  const accept = (value: string): boolean => {
    if (targetProtectionViolations({ source }, value).length > 0) return false
    draft = targetDraftReducer(draft, { type: 'commit', value })
    return true
  }
  return {
    capability: {
      segmentId: segment.id,
      handle: {
        replace: accept,
        insert: (value) => accept(insertTargetText(draft.value, value, selection).value),
        undo: () => {
          const next = targetDraftReducer(draft, { type: 'undo' })
          if (next === draft) return false
          draft = next
          return true
        },
        redo: () => false,
        focus: () => {
          focusCount += 1
        },
      },
    },
    getDraft: () => draft.value,
    getFocusCount: () => focusCount,
  }
}

describe('LF-052 Term Match Panel', () => {
  test('given Project 或活动片段切换但旧术语仍 ready when 校验上下文 then 旧结果不可操作', () => {
    expect(termStateMatchesActiveContext(
      'project-old',
      'segment-a',
      'project-new',
      'segment-a',
    )).toBeFalse()
    expect(termStateMatchesActiveContext(
      'project-a',
      'segment-old',
      'project-a',
      'segment-new',
    )).toBeFalse()
    expect(termStateMatchesActiveContext(
      'project-a',
      'segment-a',
      'project-a',
      'segment-a',
    )).toBeTrue()
    expect(termStateMatchesActiveContext(
      'project-a',
      'segment-a',
      'project-a',
      undefined,
    )).toBeFalse()
  })

  test('given 活动 TargetEditor 选区 when Insert 术语 then 只改未保存草稿、聚焦且可 Undo', () => {
    const harness = createCapabilityHarness({
      source: segment.source,
      initial: 'abCD',
      selection: { start: 2, end: 4 },
    })

    expect(applyTermMatchToEditor({
      projectId: 'project-a',
      activeSegmentId: segment.id,
      match: preferredMatch,
      capability: harness.capability,
      locked: false,
      archived: false,
    })).toBe('applied')
    expect(harness.getDraft()).toBe('ab药水')
    expect(harness.getFocusCount()).toBe(1)
    expect(harness.capability.handle.undo()).toBeTrue()
    expect(harness.getDraft()).toBe('abCD')
  })

  test('given Insert 会破坏 Tag when 应用术语 then 复用 editor hard rail 拒绝且草稿不变', () => {
    const protectedSegment = { ...segment, source: 'Press {name}' }
    const harness = createCapabilityHarness({
      source: protectedSegment.source,
      initial: '按下 {name}',
      selection: { start: 3, end: 9 },
    })

    expect(applyTermMatchToEditor({
      projectId: 'project-a',
      activeSegmentId: protectedSegment.id,
      match: { ...preferredMatch, translation: '勇者' },
      capability: harness.capability,
      locked: false,
      archived: false,
    })).toBe('rejected')
    expect(harness.getDraft()).toBe('按下 {name}')
    expect(harness.getFocusCount()).toBe(0)
  })

  test('given 项目/片段/editor/locked/archive 前置不满足 when Insert then fail closed 且不调用 editor', () => {
    let insertCount = 0
    const capability: LinguistTargetEditorCapability = {
      segmentId: segment.id,
      handle: {
        replace: () => true,
        insert: () => {
          insertCount += 1
          return true
        },
        undo: () => true,
        redo: () => true,
        focus: () => undefined,
      },
    }
    const input = {
      projectId: 'project-a',
      activeSegmentId: segment.id,
      match: preferredMatch,
      capability,
      locked: false,
      archived: false,
    }

    expect(applyTermMatchToEditor({ ...input, projectId: '' })).toBe('unavailable')
    expect(applyTermMatchToEditor({ ...input, activeSegmentId: undefined })).toBe('unavailable')
    expect(applyTermMatchToEditor({
      ...input,
      activeSegmentId: 'segment-other',
    })).toBe('unavailable')
    expect(applyTermMatchToEditor({ ...input, capability: undefined })).toBe('unavailable')
    expect(applyTermMatchToEditor({ ...input, locked: true })).toBe('unavailable')
    expect(applyTermMatchToEditor({ ...input, archived: true })).toBe('unavailable')
    expect(insertCount).toBe(0)
  })

  test('given 术语匹配 when 渲染 then 展示真实 DTO 字段、冲突且不伪造 priority', () => {
    const html = renderToStaticMarkup(
      <TermMatchView
        projectId="project-a"
        activeSegmentId={segment.id}
        segment={segment}
        matches={[
          preferredMatch,
          {
            ...preferredMatch,
            id: 'term-allowed',
            status: 'allowed',
            caseSensitive: false,
            note: undefined,
            matchType: 'exact',
            conflict: false,
          },
        ]}
        capability={createCapabilityHarness({
          source: segment.source,
          initial: segment.target,
        }).capability}
        archived={false}
      />,
    )

    expect(html).toContain('potion')
    expect(html).toContain('药水')
    expect(html).toContain('首选')
    expect(html).toContain('允许')
    expect(html).toContain('区分大小写')
    expect(html).toContain('不区分大小写')
    expect(html).toContain('游戏内统一使用该译法')
    expect(html).toContain('无备注')
    expect(html).toContain('Contains')
    expect(html).toContain('Exact')
    expect(html).toContain('译文冲突')
    expect(html).toContain('无冲突')
    expect(html).not.toContain('priority')
    expect(html).not.toContain('优先级')
  })

  test('given 无 editor、locked 或 archived when 渲染 then Insert 禁用并向读屏说明原因', () => {
    const withoutEditor = renderToStaticMarkup(
      <TermMatchView
        projectId="project-a"
        activeSegmentId={segment.id}
        segment={segment}
        matches={[preferredMatch]}
        archived={false}
      />,
    )
    const locked = renderToStaticMarkup(
      <TermMatchView
        projectId="project-a"
        activeSegmentId={segment.id}
        segment={{ ...segment, locked: true }}
        matches={[preferredMatch]}
        capability={createCapabilityHarness({
          source: segment.source,
          initial: segment.target,
        }).capability}
        archived={false}
      />,
    )
    const archived = renderToStaticMarkup(
      <TermMatchView
        projectId="project-a"
        activeSegmentId={segment.id}
        segment={segment}
        matches={[preferredMatch]}
        capability={createCapabilityHarness({
          source: segment.source,
          initial: segment.target,
        }).capability}
        archived
      />,
    )

    expect(withoutEditor).toContain('请先在 Segment Grid 中打开当前片段的 Target Editor')
    expect(withoutEditor).toContain('aria-describedby="term-insert-reason-project-a-segment-a"')
    expect(withoutEditor).toContain('disabled=""')
    expect(locked).toContain('当前片段已锁定，不能修改译文草稿')
    expect(locked).toContain('disabled=""')
    expect(archived).toContain('项目已归档，不能修改译文草稿')
    expect(archived).toContain('disabled=""')
  })

  test('given action prerequisites when 计算禁用原因 then 项目与片段身份优先 fail closed', () => {
    expect(getTermInsertDisabledReason({
      projectId: '',
      activeSegmentId: segment.id,
      locked: false,
      archived: false,
    })).toBe('项目不可用，不能修改译文草稿')
    expect(getTermInsertDisabledReason({
      projectId: 'project-a',
      activeSegmentId: undefined,
      locked: false,
      archived: false,
    })).toBe('请先选择当前片段')
  })
})
