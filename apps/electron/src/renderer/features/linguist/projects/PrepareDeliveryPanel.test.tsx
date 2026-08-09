import { describe, expect, test } from 'bun:test'
import type { LinguistAssetInfo } from '@proma/shared'
import { renderToStaticMarkup } from 'react-dom/server'
import { PrepareDeliveryPanel } from './PrepareDeliveryPanel'

const ASSET: LinguistAssetInfo = {
  assetId: 'ast-0123456789abcdef',
  filename: 'dialogue.sdlxliff',
  formatId: 'sdlxliff_1_2',
  segmentCount: 2,
  sourceSha256: 'a'.repeat(64),
  segmentCounts: {
    untranslated: 0,
    draft: 0,
    translated: 2,
    reviewed: 0,
  },
  currentStageCounts: {
    untouched: 0,
    draft: 0,
    confirmed: 2,
  },
  openQaCount: 0,
}

describe('PrepareDeliveryPanel', () => {
  test('given 已导入批次 when 初次打开 then 明示预检入口与不覆盖原文件承诺', () => {
    const html = renderToStaticMarkup(
      <PrepareDeliveryPanel
        projectId="prj-0123456789abcdef"
        assets={[ASSET]}
        archived={false}
      />,
    )

    expect(html).toContain('dialogue.sdlxliff')
    expect(html).toContain('运行交付预检')
    expect(html).toContain('不会被覆盖')
    expect(html).toContain('建议、QA、本轮状态、格式回写与导出完整性')
  })
})
