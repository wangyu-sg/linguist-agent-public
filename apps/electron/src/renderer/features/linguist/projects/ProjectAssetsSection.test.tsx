/**
 * ProjectAssetsSection 预览入口回归（bun:test + renderToStaticMarkup）。
 *
 * 验收面：批次行的「预览」入口不再弹第二套 LA modal（无 Dialog 形态）；
 * 实际打开行为（Proma Preview Tab）由 linguist-preview-open.test.tsx 覆盖。
 */

import { describe, expect, test } from 'bun:test'
import { createStore, Provider } from 'jotai'
import { renderToStaticMarkup } from 'react-dom/server'
import type { LinguistProjectSummary } from '@proma/shared'
import { ProjectAssetsSection } from './ProjectAssetsSection'

const SUMMARY: LinguistProjectSummary = {
  project: {
    schemaVersion: 1,
    id: 'project-a',
    name: '游戏本地化',
    sourceLocale: 'en',
    targetLocale: 'zh-CN',
    promaWorkspaceId: 'ws-a',
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
  },
  assetCount: 1,
  totalSegments: 3,
  segmentCounts: { untranslated: 3, draft: 0, translated: 0, reviewed: 0 },
  currentStageCounts: { untouched: 3, draft: 0, confirmed: 0 },
  assets: [{
    assetId: 'ast-0000000000000001',
    filename: 'messages.xliff',
    formatId: 'xliff',
    segmentCount: 3,
    sourceSha256: 'a'.repeat(64),
    segmentCounts: { untranslated: 3, draft: 0, translated: 0, reviewed: 0 },
    currentStageCounts: { untouched: 3, draft: 0, confirmed: 0 },
    openQaCount: 0,
  }],
}

describe('ProjectAssetsSection 预览入口', () => {
  test('given 有批次的摘要 when 渲染 then 预览入口存在且不挂任何 modal 预览', () => {
    const store = createStore()
    const html = renderToStaticMarkup(
      <Provider store={store}>
        <ProjectAssetsSection
          projectId="project-a"
          archived={false}
          summary={SUMMARY}
          onSummaryRefresh={async () => undefined}
        />
      </Provider>,
    )

    expect(html).toContain('aria-label="预览 messages.xliff"')
    expect(html).toContain('aria-label="刷新批次"')
    // 旧第二套预览（Dialog modal）已移除
    expect(html).not.toContain('role="dialog"')
    expect(html).not.toContain('预览源文件')
    expect(html).not.toContain('正在生成预览')
  })
})

describe('ProjectAssetsSection 撤销导入入口（LA-INTAKE-007）', () => {
  test('given 活跃项目 when 渲染 then 撤销导入按钮可用', () => {
    const store = createStore()
    const html = renderToStaticMarkup(
      <Provider store={store}>
        <ProjectAssetsSection
          projectId="project-a"
          archived={false}
          summary={SUMMARY}
          onSummaryRefresh={async () => undefined}
        />
      </Provider>,
    )

    expect(html).toContain('aria-label="撤销导入 messages.xliff"')
    expect(html).toContain('撤销导入')
  })

  test('given 归档项目 when 渲染 then 撤销导入按钮禁用并注明只读原因', () => {
    const store = createStore()
    const html = renderToStaticMarkup(
      <Provider store={store}>
        <ProjectAssetsSection
          projectId="project-a"
          archived={true}
          summary={SUMMARY}
          onSummaryRefresh={async () => undefined}
        />
      </Provider>,
    )

    // 归档禁用：按钮带 disabled 且 title 给出只读原因
    expect(html).toContain('已归档项目为只读，无法撤销导入')
    const undoButton = html.match(/<button[^>]*aria-label="撤销导入 messages\.xliff"[^>]*>/)
    expect(undoButton).not.toBeNull()
    expect(undoButton![0]).toContain('disabled')
  })
})
