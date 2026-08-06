import { describe, expect, test } from 'bun:test'
import { Provider, createStore } from 'jotai'
import { renderToStaticMarkup } from 'react-dom/server'
import type { LinguistProjectInfo, LinguistProjectSummary } from '@proma/shared'
import { AssetNavigator, getAssetNavigatorSelectionPatch } from './AssetNavigator'
import { linguistWorkbenchUiStateAtomFamily } from './cat-workspace-atoms'

const project: LinguistProjectInfo = {
  schemaVersion: 1,
  id: 'prj-0000000000000001',
  name: '游戏本地化',
  sourceLocale: 'en',
  targetLocale: 'zh-CN',
  promaWorkspaceId: 'workspace-1',
  createdAt: '2026-07-01T08:00:00.000Z',
  updatedAt: '2026-07-01T08:00:00.000Z',
  executionPolicy: { independentReview: 'off' },
}

const summary: LinguistProjectSummary = {
  project,
  assetCount: 2,
  totalSegments: 20,
  segmentCounts: { untranslated: 5, draft: 3, translated: 4, reviewed: 8 },
  currentStageCounts: { untouched: 7, draft: 2, confirmed: 11 },
  assets: [
    { assetId: 'asset-1', filename: 'dialogue.json', formatId: 'json', segmentCount: 12, sourceSha256: 'a'.repeat(64), segmentCounts: { untranslated: 3, draft: 2, translated: 3, reviewed: 4 }, currentStageCounts: { untouched: 4, draft: 1, confirmed: 7 }, openQaCount: 2 },
    { assetId: 'asset-2', filename: 'menu.json', formatId: 'json', segmentCount: 8, sourceSha256: 'b'.repeat(64), segmentCounts: { untranslated: 2, draft: 1, translated: 1, reviewed: 4 }, currentStageCounts: { untouched: 3, draft: 1, confirmed: 4 }, openQaCount: 1 },
  ],
}

describe('AssetNavigator', () => {
  test('given 真实项目摘要 when 渲染批次导航 then 展示批次段数、项目确认状态和当前选择', () => {
    const store = createStore()
    store.set(linguistWorkbenchUiStateAtomFamily(project.id), { activeAssetId: 'asset-2' })

    const html = renderToStaticMarkup(
      <Provider store={store}><AssetNavigator projectId={project.id} summary={summary} /></Provider>,
    )

    expect(html).toContain('aria-label="批次导航器"')
    expect(html).toContain('项目状态：已确认 11 / 20')
    expect(html).toContain('dialogue.json')
    expect(html).toContain('已确认 7 / 12 · QA 2')
    expect(html).toContain('menu.json')
    expect(html).toContain('aria-current="page"')
    expect(html).toContain('text-foreground/65')
  })

  test('given 批次曾选中过片段 when 切换离开再选回 then 恢复该批次最后活动段', () => {
    const store = createStore()
    const uiState = linguistWorkbenchUiStateAtomFamily(project.id)
    store.set(uiState, { activeAssetId: 'asset-1', activeSegmentId: 'segment-1', assetActiveSegmentIds: { 'asset-1': 'segment-1' } })

    store.set(uiState, (current) => getAssetNavigatorSelectionPatch(current, 'asset-2'))
    expect(store.get(uiState)).toMatchObject({ activeAssetId: 'asset-2', activeSegmentId: undefined })

    store.set(uiState, (current) => getAssetNavigatorSelectionPatch(current, 'asset-1'))
    expect(store.get(uiState)).toMatchObject({ activeAssetId: 'asset-1', activeSegmentId: 'segment-1' })
  })
})
