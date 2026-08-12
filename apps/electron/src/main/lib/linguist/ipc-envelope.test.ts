import { describe, expect, test } from 'bun:test'
import {
  FormatAmbiguousError,
  FormatExportError,
  FormatParseError,
  FormatSegmentLostError,
  FormatUnsupportedError,
} from '@linguist/cat-formats'
import { toIpcError } from './ipc-envelope'

describe('Linguist IPC 格式错误合同', () => {
  test('格式歧义保留稳定码和安全的 Adapter 候选，不退化为 INTERNAL', () => {
    expect(toIpcError(new FormatAmbiguousError('/private/customer/file.xlf', 0.95, ['a', 'b'])))
      .toEqual({
        code: 'FORMAT_AMBIGUOUS',
        message: 'Ambiguous format for file.xlf: a, b all scored 0.95',
        formatDetails: {
          code: 'FORMAT_AMBIGUOUS',
          category: 'format_ambiguous',
          filename: 'file.xlf',
          score: 0.95,
          adapterIds: ['a', 'b'],
        },
      })
  })

  test('其余四种格式错误穿透各自可展示字段，同时清除绝对路径', () => {
    expect(toIpcError(new FormatParseError(
      'phrase_mxliff_1_2',
      '/private/customer/file.mxliff',
      'root is incomplete',
    )).formatDetails).toEqual({
      code: 'FORMAT_PARSE_ERROR',
      category: 'vendor_structure_incomplete',
      adapterId: 'phrase_mxliff_1_2',
      filename: 'file.mxliff',
      detail: 'root is incomplete',
    })
    expect(toIpcError(new FormatUnsupportedError(
      '/private/customer/file.mxliff',
      ['phrase_mxliff_1_2'],
    )).formatDetails).toEqual({
      code: 'FORMAT_UNSUPPORTED',
      category: 'format_mismatch',
      filename: 'file.mxliff',
      triedAdapterIds: ['phrase_mxliff_1_2'],
    })
    expect(toIpcError(new FormatExportError('xliff_1_2', 'target span missing')).formatDetails)
      .toEqual({
        code: 'FORMAT_EXPORT_ERROR',
        adapterId: 'xliff_1_2',
        detail: 'target span missing',
      })
    expect(toIpcError(new FormatSegmentLostError('xliff_1_2', ['seg-1'])).formatDetails)
      .toEqual({
        code: 'FORMAT_SEGMENT_LOST',
        adapterId: 'xliff_1_2',
        missingSegmentIds: ['seg-1'],
      })
  })

  test('parse detail 在主进程归一为暂不支持版本或文件损坏，不要求 Renderer 解析文案', () => {
    expect(toIpcError(new FormatParseError(
      'xliff_1_2',
      'file.xlf',
      'XLIFF 2.0 is not supported (XLIFF 1.2 trans-unit documents only)',
    )).formatDetails).toMatchObject({ category: 'unsupported_version' })
    expect(toIpcError(new FormatParseError(
      'xlsx_ooxml',
      'file.xlsx',
      'ZIP container could not be read',
    )).formatDetails).toMatchObject({ category: 'file_corrupt' })
  })
})
