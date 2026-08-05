import { describe, expect, test } from 'bun:test'
import { Provider, createStore } from 'jotai'
import { renderToStaticMarkup } from 'react-dom/server'
import type { LinguistProjectInfo, LinguistProjectSummary } from '@proma/shared'
import {
  AGENT_RAIL_DEFAULT_WIDTH,
  AGENT_RAIL_MAX_WIDTH,
  AGENT_RAIL_MIN_WIDTH,
  ASSET_NAVIGATOR_DEFAULT_WIDTH,
  ASSET_NAVIGATOR_MAX_WIDTH,
  ASSET_NAVIGATOR_MIN_WIDTH,
  BOTTOM_DOCK_DEFAULT_HEIGHT,
  BOTTOM_DOCK_MAX_HEIGHT,
  BOTTOM_DOCK_MIN_HEIGHT,
  clampAgentRailWidth,
  clampAssetNavigatorWidth,
  clampBottomDockHeight,
  linguistWorkbenchUiStateAtomFamily,
} from './cat-workspace-atoms'
import {
  CAT_COLUMN_MIN_WIDTH,
  getAssetNavigatorWidthFromKey,
  getAgentRailWidthFromKey,
  getBottomDockHeightFromKey,
  LinguistWorkbenchShell,
} from './LinguistWorkbenchShell'

const project: LinguistProjectInfo = {
  schemaVersion: 1,
  id: 'prj-0000000000000001',
  name: '游戏本地化',
  sourceLocale: 'en',
  targetLocale: 'zh-CN',
  promaWorkspaceId: 'workspace-1',
  createdAt: '2026-07-01T08:00:00.000Z',
  updatedAt: '2026-07-01T08:00:00.000Z',
  qualityProfile: 'balanced',
}

const summary: LinguistProjectSummary = {
  project,
  assetCount: 2,
  totalSegments: 20,
  segmentCounts: {
    untranslated: 5,
    draft: 3,
    translated: 4,
    reviewed: 8,
  },
  currentStageCounts: { untouched: 7, draft: 2, confirmed: 11 },
  assets: [
    {
      assetId: 'asset-1',
      filename: 'dialogue.json',
      formatId: 'json',
      segmentCount: 12,
      sourceSha256: 'a'.repeat(64),
      segmentCounts: { untranslated: 3, draft: 2, translated: 3, reviewed: 4 },
      currentStageCounts: { untouched: 4, draft: 1, confirmed: 7 },
      openQaCount: 2,
    },
    {
      assetId: 'asset-2',
      filename: 'menu.json',
      formatId: 'json',
      segmentCount: 8,
      sourceSha256: 'b'.repeat(64),
      segmentCounts: { untranslated: 2, draft: 1, translated: 1, reviewed: 4 },
      currentStageCounts: { untouched: 3, draft: 1, confirmed: 4 },
      openQaCount: 1,
    },
  ],
}

describe('LinguistWorkbenchShell', () => {
  test('given 项目摘要和布局插槽 when Agent 尚未展开 then 不挂载 Agent rail', () => {
    const html = renderToStaticMarkup(
      <LinguistWorkbenchShell
        project={project}
        summaryState={{ status: 'ready', summary }}
        onSummaryRefresh={() => undefined}
        assetNavigator={<div>资产树</div>}
        agentRail={<div>原生 Agent</div>}
        bottomDock={<div>语言资源</div>}
      >
        <div>Segment Grid</div>
      </LinguistWorkbenchShell>,
    )

    expect(html).toContain('aria-label="本地化工作台工具栏"')
    expect(html).toContain('max-md:flex-nowrap')
    expect(html).toContain('max-md:overflow-x-auto')
    expect(html).toContain('游戏本地化')
    expect(html).toContain('en')
    expect(html).toContain('zh-CN')
    expect(html).toContain('已确认 11 / 20')
    expect(html).toContain('data-workbench-slot="asset-navigator"')
    expect(html).toContain('width:240px')
    expect(html).toContain('max-md:absolute')
    expect(html).toContain('aria-label="调整资产导航宽度"')
    expect(html).toContain(`aria-valuemin="${ASSET_NAVIGATOR_MIN_WIDTH}"`)
    expect(html).toContain(`aria-valuemax="${ASSET_NAVIGATOR_MAX_WIDTH}"`)
    expect(html).toContain('aria-valuenow="240"')
    expect(html).toContain('data-workbench-slot="segment-grid"')
    expect(html).toContain('Agent')
    expect(html).toContain('项目设置')
    expect(html).not.toContain('data-workbench-slot="agent-rail"')
    expect(html).not.toContain('原生 Agent')
    expect(html).toContain('data-workbench-slot="bottom-dock"')
    expect(html).toContain('height:240px')
    expect(html).toContain('aria-label="调整语言资源面板高度"')
    expect(html).toContain('aria-label="本地化工作台状态栏"')
    expect(html).toContain('翻译草稿 2')
    expect(html).toContain('全部资产')
    expect(html).toContain('未选择片段')
  })

  test('given 用户首次展开 Agent when 工作台重渲染 then 才挂载 rail 插槽', () => {
    const store = createStore()
    store.set(linguistWorkbenchUiStateAtomFamily(project.id), { agentPresentation: 'rail' })

    const html = renderToStaticMarkup(
      <Provider store={store}>
        <LinguistWorkbenchShell
          project={project}
          summaryState={{ status: 'ready', summary }}
          onSummaryRefresh={() => undefined}
          agentRail={<div>原生 Agent</div>}
        >
          <div>Segment Grid</div>
        </LinguistWorkbenchShell>
      </Provider>,
    )

    expect(html).toContain('data-workbench-slot="agent-rail"')
    expect(html).toContain('width:420px')
    expect(html).toContain('role="separator"')
    expect(html).toContain('aria-label="调整项目 Agent 宽度"')
    expect(html).toContain(`aria-valuemin="${AGENT_RAIL_MIN_WIDTH}"`)
    expect(html).toContain(`aria-valuemax="${AGENT_RAIL_MAX_WIDTH}"`)
    expect(html).toContain('aria-valuenow="420"')
    expect(html).toContain('max-xl:absolute')
    expect(html).toContain('min-w-[32rem]')
    expect(html).toContain('max-md:min-w-0')
    expect(html).toContain('xl:max-w-[var(--agent-rail-inline-max)]')
    expect(html).toContain('--agent-rail-inline-max:calc(100% - 512px)')
    expect(html).toContain('原生 Agent')
  })

  test('given 项目 Agent 已展开 when 切换 Full then 留在同一 Linguist 布局并复用唯一 Agent host', () => {
    const store = createStore()
    store.set(linguistWorkbenchUiStateAtomFamily(project.id), {
      agentPresentation: 'full',
    })

    const html = renderToStaticMarkup(
      <Provider store={store}>
        <LinguistWorkbenchShell
          project={project}
          summaryState={{ status: 'ready', summary }}
          onSummaryRefresh={() => undefined}
          agentRail={<div data-testid="native-agent">原生 Agent</div>}
        >
          <div>Segment Grid</div>
        </LinguistWorkbenchShell>
      </Provider>,
    )

    expect(html).toContain('data-workbench-slot="agent-full"')
    expect(html).not.toContain('data-workbench-slot="agent-rail"')
    expect(html).toContain('data-linguist-agent-presentation="full"')
    expect(html.match(/data-testid="native-agent"/g)).toHaveLength(1)
  })

  test('given 三个辅助面板均展开 when 渲染工作台 then Dock 仅占中央 CAT 列且 Rail 保持全高', () => {
    const store = createStore()
    store.set(linguistWorkbenchUiStateAtomFamily(project.id), { agentPresentation: 'rail' })

    const html = renderToStaticMarkup(
      <Provider store={store}>
        <LinguistWorkbenchShell
          project={project}
          summaryState={{ status: 'ready', summary }}
          onSummaryRefresh={() => undefined}
          assetNavigator={<div>资产树</div>}
          agentRail={<div>原生 Agent</div>}
          bottomDock={<div>语言资源</div>}
        >
          <div>Segment Grid</div>
        </LinguistWorkbenchShell>
      </Provider>,
    )

    const catColumnIndex = html.indexOf('data-workbench-slot="cat-column"')
    const segmentGridIndex = html.indexOf('data-workbench-slot="segment-grid"')
    const bottomDockIndex = html.indexOf('data-workbench-slot="bottom-dock"')
    const agentRailIndex = html.indexOf('data-workbench-slot="agent-rail"')

    expect(catColumnIndex).toBeGreaterThan(-1)
    expect(segmentGridIndex).toBeGreaterThan(catColumnIndex)
    expect(bottomDockIndex).toBeGreaterThan(segmentGridIndex)
    expect(agentRailIndex).toBeGreaterThan(bottomDockIndex)
    expect(html.match(/data-resize-grip="true"/g)?.length).toBe(3)
    expect(html.match(/双击复位/g)?.length).toBe(3)
    expect(ASSET_NAVIGATOR_DEFAULT_WIDTH).toBe(240)
    expect(AGENT_RAIL_DEFAULT_WIDTH).toBe(420)
    expect(BOTTOM_DOCK_DEFAULT_HEIGHT).toBe(240)
  })

  test('given 拖动或键盘调整 Rail when 计算宽度 then 保留中央工作区且方向符合右侧面板', () => {
    expect(clampAgentRailWidth(200)).toBe(AGENT_RAIL_MIN_WIDTH)
    expect(clampAgentRailWidth(480)).toBe(480)
    expect(clampAgentRailWidth(800)).toBe(AGENT_RAIL_MAX_WIDTH)
    expect(AGENT_RAIL_MAX_WIDTH).toBe(520)
    expect(CAT_COLUMN_MIN_WIDTH).toBe(512)

    expect(getAgentRailWidthFromKey(420, 'ArrowLeft')).toBe(436)
    expect(getAgentRailWidthFromKey(420, 'ArrowRight')).toBe(404)
    expect(getAgentRailWidthFromKey(420, 'Home')).toBe(AGENT_RAIL_MIN_WIDTH)
    expect(getAgentRailWidthFromKey(420, 'End')).toBe(AGENT_RAIL_MAX_WIDTH)
    expect(getAgentRailWidthFromKey(520, 'Enter')).toBe(AGENT_RAIL_DEFAULT_WIDTH)
  })

  test('given 拖动或键盘调整资产栏 when 计算宽度 then 约束在 180 到 420 且方向符合左侧面板', () => {
    expect(clampAssetNavigatorWidth(100)).toBe(ASSET_NAVIGATOR_MIN_WIDTH)
    expect(clampAssetNavigatorWidth(300)).toBe(300)
    expect(clampAssetNavigatorWidth(800)).toBe(ASSET_NAVIGATOR_MAX_WIDTH)

    expect(getAssetNavigatorWidthFromKey(240, 'ArrowLeft')).toBe(224)
    expect(getAssetNavigatorWidthFromKey(240, 'ArrowRight')).toBe(256)
    expect(getAssetNavigatorWidthFromKey(240, 'Home')).toBe(ASSET_NAVIGATOR_MIN_WIDTH)
    expect(getAssetNavigatorWidthFromKey(240, 'End')).toBe(ASSET_NAVIGATOR_MAX_WIDTH)
    expect(getAssetNavigatorWidthFromKey(320, 'Enter')).toBe(ASSET_NAVIGATOR_DEFAULT_WIDTH)
  })

  test('given 拖动或键盘调整 Bottom Dock when 计算高度 then 约束在最小和最大高度且方向符合底部面板', () => {
    expect(clampBottomDockHeight(100)).toBe(BOTTOM_DOCK_MIN_HEIGHT)
    expect(clampBottomDockHeight(300)).toBe(300)
    expect(clampBottomDockHeight(900)).toBe(BOTTOM_DOCK_MAX_HEIGHT)

    expect(getBottomDockHeightFromKey(240, 'ArrowUp')).toBe(256)
    expect(getBottomDockHeightFromKey(240, 'ArrowDown')).toBe(224)
    expect(getBottomDockHeightFromKey(240, 'Home')).toBe(BOTTOM_DOCK_MIN_HEIGHT)
    expect(getBottomDockHeightFromKey(240, 'End')).toBe(BOTTOM_DOCK_MAX_HEIGHT)
    expect(getBottomDockHeightFromKey(360, 'Enter')).toBe(BOTTOM_DOCK_DEFAULT_HEIGHT)
  })

  test('given 归档项目且摘要不可用 when 渲染工作台 then 明示只读且不伪造统计', () => {
    const html = renderToStaticMarkup(
      <LinguistWorkbenchShell
        project={{ ...project, archivedAt: '2026-07-02T08:00:00.000Z' }}
        summaryState={{ status: 'error' }}
        onSummaryRefresh={() => undefined}
      >
        <div>Segment Grid</div>
      </LinguistWorkbenchShell>,
    )

    expect(html).toContain('已归档 · 只读')
    expect(html).toContain('统计不可用')
    expect(html).not.toContain('0 / 0 已确认')
    expect(html).not.toContain('data-workbench-slot="asset-navigator"')
    expect(html).not.toContain('data-workbench-slot="agent-rail"')
    expect(html).not.toContain('data-workbench-slot="bottom-dock"')
  })
})
