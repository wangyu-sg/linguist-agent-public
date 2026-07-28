import { describe, expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import type {
  LinguistSegmentInfo,
  LinguistTmMatchInfo,
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
  applyTmMatchToEditor,
  getTmActionDisabledReason,
  TmMatchView,
  tmMatchScore,
  tmOriginLabel,
  tmStateMatchesActiveSegment,
} from './TmMatchPanel'

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

const fuzzyMatch: LinguistTmMatchInfo = {
  id: 'tm-fuzzy',
  source: 'Drink potion',
  target: '饮用药水',
  sourceLocale: 'en',
  targetLocale: 'zh-CN',
  origin: 'game-v1.tmx',
  score: 0.956,
  matchType: 'fuzzy',
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

describe('LF-051 TM Match Panel', () => {
  test('given 活动片段刚切换但旧 TM 仍 ready when 渲染动作前校验 then 旧结果不能用于新片段', () => {
    expect(tmStateMatchesActiveSegment('segment-old', 'segment-new')).toBeFalse()
    expect(tmStateMatchesActiveSegment('segment-new', 'segment-new')).toBeTrue()
    expect(tmStateMatchesActiveSegment('segment-old', undefined)).toBeFalse()
  })

  test('given 活动 TargetEditor when Replace then 只替换未保存草稿、聚焦编辑器且可 Undo', () => {
    const harness = createCapabilityHarness({
      source: segment.source,
      initial: '旧草稿',
    })

    expect(applyTmMatchToEditor({
      action: 'replace',
      match: fuzzyMatch,
      activeSegmentId: segment.id,
      capability: harness.capability,
      locked: false,
      archived: false,
    })).toBe('applied')
    expect(harness.getDraft()).toBe('饮用药水')
    expect(harness.getFocusCount()).toBe(1)
    expect(harness.capability.handle.undo()).toBeTrue()
    expect(harness.getDraft()).toBe('旧草稿')
  })

  test('given TargetEditor 选区 when Insert then 替换选区、保留其余草稿且可 Undo', () => {
    const harness = createCapabilityHarness({
      source: segment.source,
      initial: 'abCD',
      selection: { start: 2, end: 4 },
    })

    expect(applyTmMatchToEditor({
      action: 'insert',
      match: { ...fuzzyMatch, target: 'X' },
      activeSegmentId: segment.id,
      capability: harness.capability,
      locked: false,
      archived: false,
    })).toBe('applied')
    expect(harness.getDraft()).toBe('abX')
    expect(harness.capability.handle.undo()).toBeTrue()
    expect(harness.getDraft()).toBe('abCD')
  })

  test('given TM 文本破坏 Tag when Replace then hard rail 拒绝且草稿不变', () => {
    const protectedSegment = { ...segment, source: 'Press {name}' }
    const harness = createCapabilityHarness({
      source: protectedSegment.source,
      initial: '按下 {name}',
    })

    expect(applyTmMatchToEditor({
      action: 'replace',
      match: { ...fuzzyMatch, target: '按下' },
      activeSegmentId: protectedSegment.id,
      capability: harness.capability,
      locked: false,
      archived: false,
    })).toBe('rejected')
    expect(harness.getDraft()).toBe('按下 {name}')
    expect(harness.getFocusCount()).toBe(0)
  })

  test('given 无 editor、segment 不匹配、locked 或 archived when 操作 then 不调用编辑命令', () => {
    let replaceCount = 0
    const capability: LinguistTargetEditorCapability = {
      segmentId: segment.id,
      handle: {
        replace: () => {
          replaceCount += 1
          return true
        },
        insert: () => true,
        undo: () => true,
        redo: () => true,
        focus: () => undefined,
      },
    }
    const input = {
      action: 'replace' as const,
      match: fuzzyMatch,
      activeSegmentId: segment.id,
      locked: false,
      archived: false,
    }

    expect(applyTmMatchToEditor(input)).toBe('unavailable')
    expect(applyTmMatchToEditor({
      ...input,
      activeSegmentId: 'segment-other',
      capability,
    })).toBe('unavailable')
    expect(applyTmMatchToEditor({ ...input, capability, locked: true })).toBe('unavailable')
    expect(applyTmMatchToEditor({ ...input, capability, archived: true })).toBe('unavailable')
    expect(replaceCount).toBe(0)
  })

  test('given TM matches when 渲染 then score、origin、source、target、Exact/Fuzzy 与动作描述可读', () => {
    const capability = createCapabilityHarness({
      source: segment.source,
      initial: segment.target,
    }).capability
    const html = renderToStaticMarkup(
      <TmMatchView
        activeSegmentId={segment.id}
        segment={segment}
        matches={[
          fuzzyMatch,
          {
            ...fuzzyMatch,
            id: 'tm-exact',
            origin: 'client',
            score: 1,
            matchType: 'exact',
          },
        ]}
        capability={capability}
        archived={false}
      />,
    )

    expect(html).toContain('96%')
    expect(html).toContain('Imported · game-v1.tmx')
    expect(html).toContain('Client')
    expect(html).toContain('Fuzzy')
    expect(html).toContain('Exact')
    expect(html).toContain('Drink potion')
    expect(html).toContain('饮用药水')
    expect(html).toContain('aria-label="使用 96% Imported · game-v1.tmx Fuzzy TM 替换当前译文草稿"')
    expect(html).toContain('插入当前译文草稿')
    expect(html).not.toContain('disabled=""')
  })

  test('given locked 片段 when 渲染 then Replace/Insert 禁用并向读屏说明原因', () => {
    const html = renderToStaticMarkup(
      <TmMatchView
        activeSegmentId={segment.id}
        segment={{ ...segment, locked: true }}
        matches={[fuzzyMatch]}
        capability={createCapabilityHarness({
          source: segment.source,
          initial: segment.target,
        }).capability}
        archived={false}
      />,
    )

    expect(html).toContain('当前片段已锁定，不能修改译文草稿')
    expect(html.match(/disabled=""/g)).toHaveLength(2)
    expect(html).toContain('aria-describedby="tm-action-reason-segment-a"')
    expect(html).toContain('title="当前片段已锁定，不能修改译文草稿"')
  })

  test('given 无活动 editor 或项目已归档 when 渲染 then 动作禁用且分别显示可访问原因', () => {
    const withoutEditor = renderToStaticMarkup(
      <TmMatchView
        activeSegmentId={segment.id}
        segment={segment}
        matches={[fuzzyMatch]}
        archived={false}
      />,
    )
    const archived = renderToStaticMarkup(
      <TmMatchView
        activeSegmentId={segment.id}
        segment={segment}
        matches={[fuzzyMatch]}
        capability={createCapabilityHarness({
          source: segment.source,
          initial: segment.target,
        }).capability}
        archived
      />,
    )

    expect(withoutEditor).toContain('请先在 Segment Grid 中打开当前片段的 Target Editor')
    expect(withoutEditor.match(/disabled=""/g)).toHaveLength(2)
    expect(archived).toContain('项目已归档，不能修改译文草稿')
    expect(archived.match(/disabled=""/g)).toHaveLength(2)
  })

  test('given action prerequisites when 计算可用性 then 提供项目归档和无 editor 的明确原因', () => {
    expect(getTmActionDisabledReason({
      activeSegmentId: segment.id,
      archived: true,
      locked: false,
    })).toBe('项目已归档，不能修改译文草稿')
    expect(getTmActionDisabledReason({
      activeSegmentId: segment.id,
      archived: false,
      locked: false,
    })).toBe('请先在 Segment Grid 中打开当前片段的 Target Editor')
    expect(tmMatchScore(1.5)).toBe(100)
    expect(tmMatchScore(-1)).toBe(0)
    expect(tmOriginLabel()).toBe('Project')
    expect(tmOriginLabel('imported')).toBe('Imported')
  })
})
