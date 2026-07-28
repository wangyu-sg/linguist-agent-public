import { describe, expect, test } from 'bun:test'
import type { LinguistAssetInfo } from './linguist'

const asset: LinguistAssetInfo = {
  assetId: 'ast-0123456789abcdef',
  filename: 'dialogue.json',
  formatId: 'json',
  segmentCount: 4,
  sourceSha256: 'a'.repeat(64),
  segmentCounts: { untranslated: 1, draft: 1, translated: 0, reviewed: 2 },
  currentStageCounts: { untouched: 1, draft: 1, confirmed: 2 },
  openQaCount: 3,
}

describe('LinguistAssetInfo', () => {
  test('Given 项目摘要资产 When 消费共享契约 Then 状态计数和开放 QA 均为必备真源字段', () => {
    expect(Object.values(asset.segmentCounts).reduce((total, count) => total + count, 0)).toBe(
      asset.segmentCount,
    )
    expect(Object.values(asset.currentStageCounts).reduce((total, count) => total + count, 0)).toBe(
      asset.segmentCount,
    )
    expect(asset.openQaCount).toBe(3)
  })
})
