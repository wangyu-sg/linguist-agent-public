import { describe, expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import type { LinguistProposalInfo, LinguistSegmentInfo } from '@proma/shared'
import { SegmentGrid, splitSegmentText } from './SegmentGrid'

describe('LF-043/LF-046/LF-047 Segment Grid', () => {
  test('given Grid 位于 Workbench 主区 when 渲染 then 填满可用高度且由唯一视口滚动', () => {
    const html = renderToStaticMarkup(
      <SegmentGrid
        projectId="prj-0000000000000001"
        total={0}
        segmentIds={[]}
        rows={new Map()}
        selectedIds={new Set()}
        pendingBySegment={new Map()}
        mutatingProposalIds={new Set()}
        qaBySegment={new Map()}
        archived={false}
        workflowStage="translation"
        onActiveSegmentChange={() => {}}
        onOpenDetails={() => {}}
        onOpenQa={() => {}}
        onFocusIndex={() => {}}
        onFocusIndexSettled={() => {}}
        onToggleSelected={() => {}}
        onVisibleRangeChange={() => {}}
        onSaveTarget={async () => 'saved'}
        onReloadTarget={async () => undefined}
        onConfirmAndAdvance={async () => {}}
        onUnconfirmStage={async () => {}}
        onReviewProposal={async () => {}}
        onTargetEditorCapabilityChange={() => {}}
      />,
    )

    expect(html).toContain('aria-label="Segment Grid"')
    expect(html).toContain('aria-rowcount="1"')
    expect(html).toContain('aria-colcount="6"')
    expect(html).toContain('aria-multiselectable="true"')
    expect(html).toContain('aria-readonly="false"')
    expect(html).toContain('aria-label="选择片段"')
    expect(html).toContain('data-testid="cat-virtual-scroll"')
    expect(html).toContain('role="rowgroup"')
    expect(html).toContain('h-full min-h-0')
    expect(html).toContain('uppercase tracking-wider text-foreground/60')
    expect(html).not.toContain('h-[clamp(')
    expect(html.match(/overflow-auto/g)).toHaveLength(1)
    expect(html.indexOf('Source')).toBeLessThan(html.indexOf('Target'))
    expect(html.indexOf('Target')).toBeLessThan(html.indexOf('Status'))
    expect(html.indexOf('Status')).toBeLessThan(html.indexOf('QA'))
  })

  test('given 活动且锁定的片段 when 渲染可视行 then 展开原文、保留选择并禁止编辑', () => {
    const segment: LinguistSegmentInfo = {
      id: 'segment-1',
      assetId: 'asset-1',
      ordinal: 0,
      source: 'Press <b>{name}</b>',
      target: '按下 <b>{name}</b>',
      sourceLocale: 'en',
      targetLocale: 'zh-CN',
      status: 'translated',
      locked: true,
      revision: 3,
      sourceHash: 'hash',
    }
    const html = renderToStaticMarkup(
      <SegmentGrid
        projectId="prj-0000000000000001"
        total={1}
        segmentIds={[segment.id]}
        rows={new Map([[0, segment]])}
        selectedIds={new Set([segment.id])}
        pendingBySegment={new Map()}
        mutatingProposalIds={new Set()}
        activeSegmentId={segment.id}
        archived={false}
        workflowStage="translation"
        onActiveSegmentChange={() => {}}
        onOpenDetails={() => {}}
        onOpenQa={() => {}}
        onFocusIndex={() => {}}
        onFocusIndexSettled={() => {}}
        onToggleSelected={() => {}}
        onVisibleRangeChange={() => {}}
        onSaveTarget={async () => 'saved'}
        onReloadTarget={async () => segment}
        onConfirmAndAdvance={async () => {}}
        onUnconfirmStage={async () => {}}
        onReviewProposal={async () => {}}
        onTargetEditorCapabilityChange={() => {}}
      />,
    )

    expect(html).toContain('aria-selected="true"')
    expect(html).toContain('aria-keyshortcuts="ArrowUp ArrowDown Home End PageUp PageDown Enter F2 Space"')
    expect(html).toContain('原始行 1')
    expect(html).toContain('segmentId segment-1')
    expect(html).toContain('源文：Press')
    expect(html).toContain('译文：按下')
    expect(html).not.toContain('片段行 1')
    expect(html).toContain('min-h-[104px]')
    expect(html).toContain('data-segment-token="true"')
    expect(html).toContain('disabled=""')
    expect(html).toContain('QA 状态尚未加载')
    expect(html).not.toContain('当前行翻译建议')
  })

  test('given 可编辑、锁定与归档行 when 渲染 Grid then 仅可编辑行保留双击编辑接缝', () => {
    const segment: LinguistSegmentInfo = {
      id: 'segment-1',
      assetId: 'asset-1',
      ordinal: 0,
      source: 'Start',
      target: '开始',
      sourceLocale: 'en',
      targetLocale: 'zh-CN',
      status: 'translated',
      locked: false,
      revision: 1,
      sourceHash: 'hash',
    }
    const renderRow = (locked: boolean, archived: boolean): string => renderToStaticMarkup(
      <SegmentGrid
        projectId="prj-0000000000000001"
        total={1}
        segmentIds={[segment.id]}
        rows={new Map([[0, { ...segment, locked }]])}
        selectedIds={new Set()}
        pendingBySegment={new Map()}
        mutatingProposalIds={new Set()}
        archived={archived}
        workflowStage="translation"
        onActiveSegmentChange={() => {}}
        onOpenDetails={() => {}}
        onOpenQa={() => {}}
        onFocusIndex={() => {}}
        onFocusIndexSettled={() => {}}
        onToggleSelected={() => {}}
        onVisibleRangeChange={() => {}}
        onSaveTarget={async () => 'saved'}
        onReloadTarget={async () => segment}
        onConfirmAndAdvance={async () => {}}
        onUnconfirmStage={async () => {}}
        onReviewProposal={async () => {}}
        onTargetEditorCapabilityChange={() => {}}
      />,
    )

    expect(renderRow(false, false)).toContain('data-target-double-click=""')
    expect(renderRow(true, false)).not.toContain('data-target-double-click')
    expect(renderRow(false, true)).not.toContain('data-target-double-click')
  })

  test('given 当前行有待审 Proposal 与开放 QA when 渲染 Grid then 状态、数量和最高严重度均可读', () => {
    const segment: LinguistSegmentInfo = {
      id: 'segment-1',
      assetId: 'asset-1',
      ordinal: 0,
      source: 'Start',
      target: '开始',
      sourceLocale: 'en',
      targetLocale: 'zh-CN',
      status: 'translated',
      locked: false,
      revision: 3,
      sourceHash: 'hash',
    }
    const proposal: LinguistProposalInfo = {
      id: 'proposal-1',
      segmentId: segment.id,
      baseRevision: segment.revision,
      proposedTarget: '启动',
      evidenceRefs: ['tm:exact-1'],
      termRefs: ['term:start'],
      warnings: [],
      createdAt: '2026-07-27T00:00:00.000Z',
      status: 'pending',
    }
    const html = renderToStaticMarkup(
      <SegmentGrid
        projectId="prj-0000000000000001"
        total={1}
        segmentIds={[segment.id]}
        rows={new Map([[0, segment]])}
        selectedIds={new Set()}
        pendingBySegment={new Map([[segment.id, proposal]])}
        mutatingProposalIds={new Set()}
        qaBySegment={new Map([[
          segment.id,
          { count: 2, highestSeverity: 'L1' },
        ]])}
        activeSegmentId={segment.id}
        archived={false}
        workflowStage="translation"
        onActiveSegmentChange={() => {}}
        onOpenDetails={() => {}}
        onOpenQa={() => {}}
        onFocusIndex={() => {}}
        onFocusIndexSettled={() => {}}
        onToggleSelected={() => {}}
        onVisibleRangeChange={() => {}}
        onSaveTarget={async () => 'saved'}
        onReloadTarget={async () => segment}
        onConfirmAndAdvance={async () => {}}
        onUnconfirmStage={async () => {}}
        onReviewProposal={async () => {}}
        onTargetEditorCapabilityChange={() => {}}
      />,
    )

    expect(html).toContain('aria-current="true"')
    expect(html).toContain('原始行 1')
    expect(html).toContain('结果 1/1')
    expect(html).toContain('segmentId segment-1')
    expect(html).toContain('查看原始行 1 当前行详情')
    expect(html).toContain('查看原始行 1 QA：2 个开放 QA，最高 L1 严重')
    expect(html).toContain('L1 严重')
    expect(html).toContain('aria-label="当前行翻译建议"')
    expect(html).toContain('Current')
    expect(html).toContain('Proposed')
    expect(html).toContain('<del')
    expect(html).toContain('<ins')
    expect(html).toContain('Evidence：tm:exact-1 · term:start')
    expect(html).toContain('Accept')
    expect(html).toContain('Reject')
  })

  test('given stale、locked 或 archived Proposal when 渲染活动行 then Accept fail closed，Reject 仅归档阻断', () => {
    const baseSegment: LinguistSegmentInfo = {
      id: 'segment-1',
      assetId: 'asset-1',
      ordinal: 0,
      source: 'Start',
      target: '开始',
      sourceLocale: 'en',
      targetLocale: 'zh-CN',
      status: 'translated',
      locked: false,
      revision: 2,
      sourceHash: 'hash',
    }
    const proposal: LinguistProposalInfo = {
      id: 'proposal-1',
      segmentId: baseSegment.id,
      baseRevision: 1,
      proposedTarget: '启动',
      evidenceRefs: [],
      termRefs: [],
      warnings: [],
      createdAt: '2026-07-27T00:00:00.000Z',
      status: 'pending',
    }
    const renderBlocked = (segment: LinguistSegmentInfo, archived: boolean): string =>
      renderToStaticMarkup(
        <SegmentGrid
          projectId="prj-0000000000000001"
          total={1}
          segmentIds={[segment.id]}
          rows={new Map([[0, segment]])}
          selectedIds={new Set()}
          pendingBySegment={new Map([[segment.id, { ...proposal, segmentId: segment.id }]])}
          mutatingProposalIds={new Set()}
          activeSegmentId={segment.id}
          archived={archived}
          workflowStage="translation"
          onActiveSegmentChange={() => {}}
          onOpenDetails={() => {}}
          onOpenQa={() => {}}
          onFocusIndex={() => {}}
          onFocusIndexSettled={() => {}}
          onToggleSelected={() => {}}
          onVisibleRangeChange={() => {}}
          onSaveTarget={async () => 'saved'}
          onReloadTarget={async () => segment}
          onConfirmAndAdvance={async () => {}}
          onUnconfirmStage={async () => {}}
          onReviewProposal={async () => {}}
          onTargetEditorCapabilityChange={() => {}}
        />,
      )

    const stale = renderBlocked(baseSegment, false)
    expect(stale).toContain('版本冲突：建议基于 r1，当前为 r2')
    expect(stale.match(/disabled=""/g)?.length ?? 0).toBe(1)
    expect(stale.match(/aria-describedby=/g)?.length ?? 0).toBe(2)

    const locked = renderBlocked({ ...baseSegment, revision: 1, locked: true }, false)
    expect(locked).toContain('片段已锁定')
    expect(locked.match(/disabled=""/g)?.length ?? 0).toBe(2)
    expect(locked.match(/aria-describedby=/g)?.length ?? 0).toBe(2)

    const archived = renderBlocked({ ...baseSegment, revision: 1 }, true)
    expect(archived).toContain('项目已归档')
    expect(archived.match(/disabled=""/g)?.length ?? 0).toBe(3)
    expect(archived.match(/aria-describedby=/g)?.length ?? 0).toBe(3)
  })

  test('given 两个可视片段 when 第二行活动 then 只有活动行及其操作进入 Tab 顺序', () => {
    const createSegment = (index: number): LinguistSegmentInfo => ({
      id: `segment-${index}`,
      assetId: 'asset-1',
      ordinal: index,
      source: `Source ${index}`,
      target: `译文 ${index}`,
      sourceLocale: 'en',
      targetLocale: 'zh-CN',
      status: 'translated',
      locked: false,
      revision: 1,
      sourceHash: `hash-${index}`,
    })
    const segments = [createSegment(0), createSegment(1)]
    const html = renderToStaticMarkup(
      <SegmentGrid
        projectId="prj-0000000000000001"
        total={segments.length}
        segmentIds={segments.map((segment) => segment.id)}
        rows={new Map(segments.map((segment, index) => [index, segment]))}
        selectedIds={new Set()}
        pendingBySegment={new Map()}
        mutatingProposalIds={new Set()}
        qaBySegment={new Map()}
        activeSegmentId={segments[1]!.id}
        archived={false}
        workflowStage="translation"
        onActiveSegmentChange={() => {}}
        onOpenDetails={() => {}}
        onOpenQa={() => {}}
        onFocusIndex={() => {}}
        onFocusIndexSettled={() => {}}
        onToggleSelected={() => {}}
        onVisibleRangeChange={() => {}}
        onSaveTarget={async () => 'saved'}
        onReloadTarget={async () => undefined}
        onConfirmAndAdvance={async () => {}}
        onUnconfirmStage={async () => {}}
        onReviewProposal={async () => {}}
        onTargetEditorCapabilityChange={() => {}}
      />,
    )

    expect(html).toContain('aria-rowcount="3"')
    expect(html).toContain('aria-rowindex="1"')
    expect(html.match(/tabindex="0"/g)).toHaveLength(6)
    expect(html.match(/tabindex="-1"/g)).toHaveLength(6)
  })

  test('given 含 Tag 与 Placeholder 的文本 when 切分显示内容 then 保留原文并识别 Chip', () => {
    expect(splitSegmentText('Press <b>{name}</b>')).toEqual([
      { kind: 'text', value: 'Press ' },
      { kind: 'token', value: '<b>' },
      { kind: 'token', value: '{name}' },
      { kind: 'token', value: '</b>' },
    ])
    expect(splitSegmentText('{尚未闭合')).toEqual([
      { kind: 'text', value: '{尚未闭合' },
    ])
  })

  test('given E 阶段片段 when 当前轮尚未确认 then 展示审校语义与导入原生状态', () => {
    const segment: LinguistSegmentInfo = {
      id: 'segment-editing',
      assetId: 'asset-1',
      ordinal: 41,
      source: 'Start',
      target: '开始',
      sourceLocale: 'en',
      targetLocale: 'zh-CN',
      status: 'translated',
      locked: false,
      revision: 2,
      sourceHash: 'hash',
      currentStageState: 'untouched',
      importedNativeStatus: 'Translated',
    }
    const html = renderToStaticMarkup(
      <SegmentGrid
        projectId="prj-0000000000000001"
        total={1}
        segmentIds={[segment.id]}
        rows={new Map([[0, segment]])}
        selectedIds={new Set()}
        pendingBySegment={new Map()}
        mutatingProposalIds={new Set()}
        activeSegmentId={segment.id}
        archived={false}
        workflowStage="editing"
        onActiveSegmentChange={() => {}}
        onOpenDetails={() => {}}
        onOpenQa={() => {}}
        onFocusIndex={() => {}}
        onFocusIndexSettled={() => {}}
        onToggleSelected={() => {}}
        onVisibleRangeChange={() => {}}
        onSaveTarget={async () => 'saved'}
        onReloadTarget={async () => segment}
        onConfirmAndAdvance={async () => {}}
        onUnconfirmStage={async () => {}}
        onReviewProposal={async () => {}}
        onTargetEditorCapabilityChange={() => {}}
      />,
    )

    expect(html).toContain('本轮状态：待审校，导入状态：Translated')
    expect(html).toContain('原生状态：Translated')
    expect(html).toContain('确认审校')
    expect(html).toContain('原始行 42')
    expect(html).toContain('结果 1/1')
    expect(html).toContain('segmentId segment-editing')
    expect(html).not.toContain('片段行 1')
  })

  test('given 未明确选中片段 when 渲染 then 首行不绘制假 active 但保留键盘入口', () => {
    const createSegment = (index: number): LinguistSegmentInfo => ({
      id: `segment-${index}`,
      assetId: 'asset-1',
      ordinal: index,
      source: `Source ${index}`,
      target: `译文 ${index}`,
      sourceLocale: 'en',
      targetLocale: 'zh-CN',
      status: 'translated',
      locked: false,
      revision: 1,
      sourceHash: `hash-${index}`,
    })
    const segments = [createSegment(0), createSegment(1)]
    const html = renderToStaticMarkup(
      <SegmentGrid
        projectId="prj-0000000000000001"
        total={segments.length}
        segmentIds={segments.map((segment) => segment.id)}
        rows={new Map(segments.map((segment, index) => [index, segment]))}
        selectedIds={new Set()}
        pendingBySegment={new Map()}
        mutatingProposalIds={new Set()}
        qaBySegment={new Map()}
        archived={false}
        workflowStage="translation"
        onActiveSegmentChange={() => {}}
        onOpenDetails={() => {}}
        onOpenQa={() => {}}
        onFocusIndex={() => {}}
        onFocusIndexSettled={() => {}}
        onToggleSelected={() => {}}
        onVisibleRangeChange={() => {}}
        onSaveTarget={async () => 'saved'}
        onReloadTarget={async () => undefined}
        onConfirmAndAdvance={async () => {}}
        onUnconfirmStage={async () => {}}
        onReviewProposal={async () => {}}
        onTargetEditorCapabilityChange={() => {}}
      />,
    )

    // 问题 12：activeSegmentId 为空时不再把首行伪装成 active。
    expect(html).not.toContain('aria-current="true"')
    expect(html).not.toContain('min-h-[104px]')
    // roving tabindex 兜底仍保留键盘入口：首行行与行内操作进入 Tab 顺序。
    expect(html.match(/tabindex="0"/g)).toHaveLength(6)
    expect(html.match(/tabindex="-1"/g)).toHaveLength(6)
  })

  test('given 片段数据行 when 渲染 then 挂「为 Agent 引用」右键菜单，加载占位行不挂', () => {
    const segment: LinguistSegmentInfo = {
      id: 'segment-1',
      assetId: 'asset-1',
      ordinal: 0,
      source: 'Start',
      target: '开始',
      sourceLocale: 'en',
      targetLocale: 'zh-CN',
      status: 'translated',
      locked: false,
      revision: 1,
      sourceHash: 'hash',
    }
    const html = renderToStaticMarkup(
      <SegmentGrid
        projectId="prj-0000000000000001"
        total={2}
        segmentIds={[segment.id, 'segment-2']}
        rows={new Map([[0, segment]])}
        selectedIds={new Set()}
        pendingBySegment={new Map()}
        mutatingProposalIds={new Set()}
        qaBySegment={new Map()}
        archived={false}
        workflowStage="translation"
        onActiveSegmentChange={() => {}}
        onOpenDetails={() => {}}
        onOpenQa={() => {}}
        onFocusIndex={() => {}}
        onFocusIndexSettled={() => {}}
        onToggleSelected={() => {}}
        onVisibleRangeChange={() => {}}
        onSaveTarget={async () => 'saved'}
        onReloadTarget={async () => undefined}
        onConfirmAndAdvance={async () => {}}
        onUnconfirmStage={async () => {}}
        onReviewProposal={async () => {}}
        onTargetEditorCapabilityChange={() => {}}
      />,
    )

    // 数据行挂 ContextMenu trigger（Radix 输出 data-state="closed"）；加载行不挂。
    expect(html.match(/data-state="closed"/g)).toHaveLength(1)
    expect(html).toContain('正在加载…')
  })
})
