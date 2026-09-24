import { expect, test } from 'bun:test'
import { getToolPhrase, shouldShowToolKindLabel } from '../tool-phrase'
import { formatCatResultForDisplay, summarizeCatResult } from './cat-result'

test('新旧 CAT 工具回放都把工作批次称为批次', () => {
  for (const name of ['cat_list_assets', 'cat_list_batches']) {
    expect(getToolPhrase(name, {}).label).toBe('查看批次')
    expect(summarizeCatResult(name, { items: [], total: 2, limit: 20, offset: 0, hasMore: false })).toEqual({
      title: '工作批次', detail: '显示 0 / 2 个批次',
    })
  }
  for (const countField of ['assetCount', 'batchCount']) {
    expect(summarizeCatResult('cat_project_summary', { project: {}, segmentCounts: {}, [countField]: 2, totalSegments: 6 })?.detail)
      .toBe('2 个批次，6 个片段')
  }
  expect(getToolPhrase('cat_export_batch', { batchId: 'ast-1' }).label).toBe('导出批次')
  expect(getToolPhrase('cat_import_resources', { kind: 'tm', paths: ['/tmp/a.tmx'] }).label).toBe('导入 1 项（TM）')
  expect(getToolPhrase('cat_import_asset', { resourceKind: 'tm' }).label).toBe('导入 TM')
  expect(shouldShowToolKindLabel('cat_list_assets', { limit: 20 }, 'cat_list_assets', '查看批次')).toBe(false)
  expect(shouldShowToolKindLabel('cat_list_batches', { limit: 20 }, 'cat_list_batches', '查看批次')).toBe(false)
  expect(formatCatResultForDisplay({ assetCount: 2, items: [{ assetId: 'ast-1', scope: { assetIds: ['ast-1'] } }] }))
    .toEqual({ batchCount: 2, items: [{ batchId: 'ast-1', scope: { batchIds: ['ast-1'] } }] })
})
