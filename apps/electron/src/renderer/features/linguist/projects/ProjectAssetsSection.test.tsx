/**
 * ProjectAssetsSection 预览入口回归（bun:test + renderToStaticMarkup）。
 *
 * 验收面：批次行的「预览」入口不再弹第二套 LA modal（无 Dialog 形态）；
 * 实际打开行为（Proma Preview Tab）由 linguist-preview-open.test.tsx 覆盖。
 */

import { describe, expect, test } from 'bun:test'
import type { ReactElement } from 'react'
import { createStore, Provider } from 'jotai'
import { renderToStaticMarkup } from 'react-dom/server'
import type { LinguistProjectImportResult, LinguistProjectSummary } from '@proma/shared'
import {
  BulkImportSummary,
  ProjectImportMenu,
  ProjectAssetsSection,
  XlsxMappingConfirmPanel,
  createPendingXlsxMapping,
  describeWorkbookMappingUsed,
  hasImportedProjectResources,
} from './ProjectAssetsSection'

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
    sourceCharacters: 39,
    targetCharacters: 0,
    openQaCount: 0,
  }],
}

describe('ProjectAssetsSection 预览入口', () => {
  test('given 有批次的摘要 when 渲染 then 只有一个导入触发器且不挂任何 modal 预览', () => {
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
    expect(html.match(/aria-label="导入资源"/g)).toHaveLength(1)
    // 旧第二套预览（Dialog modal）已移除
    expect(html).not.toContain('role="dialog"')
    expect(html).not.toContain('预览源文件')
    expect(html).not.toContain('正在生成预览')
  })
})

describe('ProjectAssetsSection 导入菜单', () => {
  test('given 活跃项目 when 选择菜单项 then 分别走多文件与文件夹流程', () => {
    const selected: Array<'files' | 'directory'> = []
    const menu = ProjectImportMenu({
      busy: false,
      disabled: false,
      title: '导入资源',
      onSelect: (selection) => selected.push(selection),
    })
    const [, content] = menu.props.children as ReactElement[]
    const items = content!.props.children as ReactElement[]

    expect(items.map((item) => (item.props.children[1] as ReactElement).props.children))
      .toEqual(['选择文件…', '选择文件夹…'])
    items[0]!.props.onSelect()
    items[1]!.props.onSelect()
    expect(selected).toEqual(['files', 'directory'])
  })

  test('given 归档项目 when 渲染 then 唯一导入触发器禁用并说明只读原因', () => {
    const store = createStore()
    const html = renderToStaticMarkup(
      <Provider store={store}>
        <ProjectAssetsSection
          projectId="project-a"
          archived
          summary={SUMMARY}
          onSummaryRefresh={async () => undefined}
        />
      </Provider>,
    )
    const button = html.match(/<button[^>]*aria-label="导入资源"[^>]*>/)

    expect(button).not.toBeNull()
    expect(button![0]).toContain('disabled')
    expect(button![0]).toContain('title="已归档项目为只读，无法导入"')
  })
})

test('Phrase 成功配对的 master 与 Tag Mapping 覆盖在批量结果中可见', () => {
  const html = renderToStaticMarkup(
    <BulkImportSummary
      result={{
        cancelled: false,
        bulk: true,
        found: 2,
        ready: 0,
        imported: 2,
        skippedDuplicate: 0,
        needsInput: 0,
        unsupported: 0,
        failed: 0,
        truncated: false,
        items: [{
          filename: 'split.mxliff',
          status: 'imported',
          resourceKind: 'batch',
          resourceId: 'ast-1',
          message: 'Phrase master: master.xliff · Tag Mapping: 8/8 段',
        }],
      }}
      onDismiss={() => undefined}
    />,
  )

  expect(html).toContain('split.mxliff')
  expect(html).toContain('已导入')
  expect(html).toContain('Phrase master: master.xliff · Tag Mapping: 8/8 段')
})

test('保存或复用映射时摘要显示 Sheet 与实际列', () => {
  expect(describeWorkbookMappingUsed({
    profileId: 'mapping-1',
    sheetName: 'Sheet1',
    columns: { key: 'ID', source: 'English', target: 'Chinese', locked: 'Lock', context: 'Notes' },
  })).toBe('Sheet1 · ID=ID · Source=English · Target=Chinese · Locked=Lock · Context=Notes')
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

const XLSX_PREVIEW_RESULT = {
  cancelled: false,
  bulk: false,
  requiresXlsxMapping: true,
  filename: 'dialogue.xlsx',
  mappingId: 'map-preview',
  sourceSha256: 'b'.repeat(64),
  preview: {
    sourceSha256: 'b'.repeat(64),
    sheets: [{
      name: 'Strings',
      state: 'visible',
      headerRowNumbers: [1],
      columns: [
        { index: 0, header: 'String ID', selectable: true },
        { index: 1, header: 'English', selectable: true },
        { index: 2, header: 'Chinese', selectable: true },
        { index: 3, header: 'Context', selectable: true },
        { index: 4, header: 'Lock', selectable: true },
      ],
      sampleRows: [],
      coverage: {
        physicalRows: 2,
        dataRows: 1,
        nonEmptyDataRows: 1,
        emptyDataRows: 0,
        shownSampleRows: 0,
        truncated: false,
      },
      distortion: {
        formulaCells: 0,
        formulaCellsWithCachedValue: 0,
        formulaCellsWithoutCachedValue: 0,
        errorCells: 0,
        mergedRanges: 0,
        mergedCoveredCells: 0,
        phoneticRunsExcluded: 0,
        ooxmlEscapesRestored: 0,
      },
      suggestion: {
        columns: { key: 'String ID', source: 'English', target: 'Chinese', locked: 'Lock', context: 'Context' },
        confidence: 0.95,
        reasons: ['source 命中列名 "English"', 'target 命中列名 "Chinese"'],
      },
    }],
    skippedSheets: [],
  },
} satisfies Extract<LinguistProjectImportResult, { requiresXlsxMapping: true }>

describe('ProjectAssetsSection XLSX mapping 建议与记忆', () => {
  test('given 主进程建议 when 建立待确认态 then 预填 Sheet/列且默认不记忆', () => {
    const mapping = createPendingXlsxMapping(XLSX_PREVIEW_RESULT)
    expect(mapping.sheetName).toBe('Strings')
    expect(mapping.columns).toEqual({
      key: 'String ID',
      source: 'English',
      target: 'Chinese',
      locked: 'Lock',
      context: 'Context',
    })
    expect(mapping.rememberMapping).toBe(false)
  })

  test('given 待确认映射 when 渲染 then 展示置信度、理由与“记住此映射”', () => {
    const html = renderToStaticMarkup(
      <XlsxMappingConfirmPanel
        mapping={createPendingXlsxMapping(XLSX_PREVIEW_RESULT)}
        disabled={false}
        onChangeSheet={() => undefined}
        onChangeColumn={() => undefined}
        onChangeRemember={() => undefined}
        onConfirm={() => undefined}
        onCancel={() => undefined}
      />,
    )
    expect(html).toContain('建议置信度 95%')
    expect(html).toContain('source 命中列名 &quot;English&quot;')
    expect(html).toContain('记住此映射')
  })

  test('given 批量结果含已导入语言资产 when 判断刷新 then 只对非 batch 导入返回 true', () => {
    const base = {
      cancelled: false,
      bulk: true,
      found: 1,
      ready: 0,
      imported: 1,
      skippedDuplicate: 0,
      needsInput: 0,
      unsupported: 0,
      failed: 0,
      truncated: false,
    } as const
    expect(hasImportedProjectResources({
      ...base,
      items: [{ filename: 'brief.md', status: 'imported', resourceKind: 'context' }],
    })).toBe(true)
    expect(hasImportedProjectResources({
      ...base,
      items: [{ filename: 'batch.xliff', status: 'imported', resourceKind: 'batch' }],
    })).toBe(false)
  })
})
