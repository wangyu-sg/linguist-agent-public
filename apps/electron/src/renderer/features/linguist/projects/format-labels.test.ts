import { describe, expect, test } from 'bun:test'
import {
  describeFormatCapability,
  GENERIC_XLIFF_FALLBACK_NOTICE,
  describeLinguistFormat,
  isGenericXliffFallback,
} from './format-labels'

describe('format labels', () => {
  test('given 已知格式 when 展示 then 返回可读标签', () => {
    expect(describeLinguistFormat('mqxliff_1_2')).toBe('memoQ MQXLIFF')
    expect(describeLinguistFormat('sdlxliff_1_2')).toBe('SDL Trados XLIFF')
  })

  test('given 未知格式 when 展示 then 保留真实 ID', () => {
    expect(describeLinguistFormat('future_adapter')).toBe('future_adapter')
  })

  test('given mqxliff 文件未命中专用 Adapter when 展示 then 明示通用 XLIFF 边界', () => {
    expect(isGenericXliffFallback('dialogue.mqxliff', 'xliff_1_2')).toBe(true)
    expect(isGenericXliffFallback('dialogue.mqxliff', 'mqxliff_1_2')).toBe(false)
    expect(GENERIC_XLIFF_FALLBACK_NOTICE).toContain('通用 XLIFF')
  })

  test('专用格式只声明已有自动证据，不把真实样本标成已验证', () => {
    expect(describeFormatCapability('mqxliff_1_2')).toBe(
      '专用解析：已启用 · Tag round-trip：合成样例已验证，真实样本待验证',
    )
    expect(describeFormatCapability('phrase_mxliff_1_2')).toContain('verified 导出会检查 Tag Mapping')
  })
})
