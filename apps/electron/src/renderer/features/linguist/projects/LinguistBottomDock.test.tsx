import { describe, expect, test } from 'bun:test'
import { Provider, createStore } from 'jotai'
import { renderToStaticMarkup } from 'react-dom/server'
import {
  linguistQaFindingsCapabilityAtomFamily,
  linguistWorkbenchUiStateAtomFamily,
} from './cat-workspace-atoms'
import { getNextBottomDockTab, LinguistBottomDock } from './LinguistBottomDock'

describe('LinguistBottomDock', () => {
  test('given 活动片段和已保存的 QA Tab when 渲染 then 挂载该片段的 QA 面板而不是旧占位', () => {
    const store = createStore()
    store.set(linguistWorkbenchUiStateAtomFamily('project-a'), {
      activeSegmentId: 'segment-a',
      bottomDockTab: 'qa',
    })
    store.set(linguistQaFindingsCapabilityAtomFamily('project-a'), {
      jumpToFinding: () => undefined,
      refreshAfterMutation: async () => undefined,
      refreshToken: 4,
    })

    const html = renderToStaticMarkup(
      <Provider store={store}>
        <LinguistBottomDock projectId="project-a" archived />
      </Provider>,
    )

    expect(html).toContain('role="tablist"')
    expect(html).toContain('TM 匹配')
    expect(html).toContain('术语')
    expect(html).toContain('QA')
    expect(html).toContain('上下文/证据')
    expect(html).toContain('预览')
    expect(html).toContain('提案')
    expect(html).toContain('准备交付')
    expect(html).toContain('aria-selected="true"')
    expect(html).toContain('id="linguist-dock-tab-project-a-qa" type="button" role="tab" aria-selected="true" aria-controls="linguist-dock-panel-project-a" tabindex="0"')
    expect(html).toContain('id="linguist-dock-tab-project-a-tm" type="button" role="tab" aria-selected="false" aria-controls="linguist-dock-panel-project-a" tabindex="-1"')
    expect(html).toContain('aria-label="当前片段 QA Findings"')
    expect(html).toContain('仅显示当前片段；运行 QA 仍会扫描整个项目')
    expect(html).toContain('项目已归档：仍可读取和跳转；运行、解决和豁免已禁用。')
    expect(html).not.toContain('选择片段后显示相关语言资产')
  })

  test('given Dock Tab 获得焦点 when 使用方向键和首尾键 then 按 WAI-ARIA Tabs 规则循环导航', () => {
    expect(getNextBottomDockTab('tm', 'ArrowRight')).toBe('terms')
    expect(getNextBottomDockTab('delivery', 'ArrowRight')).toBe('tm')
    expect(getNextBottomDockTab('tm', 'ArrowLeft')).toBe('delivery')
    expect(getNextBottomDockTab('qa', 'Home')).toBe('tm')
    expect(getNextBottomDockTab('qa', 'End')).toBe('delivery')
    expect(getNextBottomDockTab('qa', 'Enter')).toBeUndefined()
  })

  test('given 活动批次和预览 Tab when 渲染 then 提供进入 Proma 预览标签页的入口而不内嵌第二套预览面', () => {
    const store = createStore()
    store.set(linguistWorkbenchUiStateAtomFamily('project-a'), {
      activeAssetId: 'asset-a',
      bottomDockTab: 'preview',
    })

    const html = renderToStaticMarkup(
      <Provider store={store}>
        <LinguistBottomDock
          projectId="project-a"
          assets={[{
            assetId: 'asset-a',
            filename: 'messages.xliff',
            formatId: 'xliff',
            segmentCount: 3,
            sourceSha256: 'a'.repeat(64),
            segmentCounts: { untranslated: 3, draft: 0, translated: 0, reviewed: 0 },
            currentStageCounts: { untouched: 3, draft: 0, confirmed: 0 },
            openQaCount: 0,
          }]}
        />
      </Provider>,
    )

    expect(html).toContain('messages.xliff')
    expect(html).toContain('xliff · 3 段 · 只读')
    expect(html).toContain('在预览标签页中打开')
    expect(html).not.toContain('正在生成预览')
    expect(html).not.toContain('保存')
  })

  test('given 无活动批次和预览 Tab when 渲染 then 只提示选择批次', () => {
    const store = createStore()
    store.set(linguistWorkbenchUiStateAtomFamily('project-a'), {
      bottomDockTab: 'preview',
    })

    const html = renderToStaticMarkup(
      <Provider store={store}>
        <LinguistBottomDock projectId="project-a" />
      </Provider>,
    )

    expect(html).toContain('选择批次后可在此打开预览')
    expect(html).not.toContain('在预览标签页中打开')
  })

  test('given Dock 内容高于可用空间 when 渲染 then Tab panel 自身可聚焦并纵向滚动', () => {
    const html = renderToStaticMarkup(
      <LinguistBottomDock projectId="project-a" />,
    )

    expect(html).toContain('data-bottom-dock-scroll="true"')
    expect(html).toContain('tabindex="0"')
    expect(html).toContain('overflow-y-auto')
    expect(html).toContain('overscroll-contain')
  })

  test('given 术语 Tab when 渲染 then 挂载可操作术语面板而不是旧占位内容', () => {
    const store = createStore()
    store.set(linguistWorkbenchUiStateAtomFamily('project-a'), {
      bottomDockTab: 'terms',
    })

    const html = renderToStaticMarkup(
      <Provider store={store}>
        <LinguistBottomDock projectId="project-a" />
      </Provider>,
    )

    expect(html).toContain('选择一个片段查看术语匹配')
    expect(html).not.toContain('选择片段后显示相关语言资产')
  })
})
