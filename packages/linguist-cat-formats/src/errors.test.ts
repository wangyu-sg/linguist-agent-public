import { describe, expect, test } from 'bun:test'
import {
  FORMAT_ERROR_CODES,
  FormatAmbiguousError,
  FormatError,
  FormatExportError,
  FormatParseError,
  FormatSegmentLostError,
  FormatUnsupportedError,
} from './index'

describe('格式错误 code 稳定性', () => {
  test('全部 code 字面量固定（公共契约）', () => {
    expect(FORMAT_ERROR_CODES).toEqual({
      FORMAT_PARSE_ERROR: 'FORMAT_PARSE_ERROR',
      FORMAT_EXPORT_ERROR: 'FORMAT_EXPORT_ERROR',
      FORMAT_SEGMENT_LOST: 'FORMAT_SEGMENT_LOST',
      FORMAT_UNSUPPORTED: 'FORMAT_UNSUPPORTED',
      FORMAT_AMBIGUOUS: 'FORMAT_AMBIGUOUS',
    })
  })

  test('各错误类的 code、name 与载荷', () => {
    const parse = new FormatParseError('fake_tsv', 'a.ftsv', 'bad line')
    expect(parse.code).toBe('FORMAT_PARSE_ERROR')
    expect(parse.adapterId).toBe('fake_tsv')
    expect(parse.message).toContain('a.ftsv')

    const exportErr = new FormatExportError('fake_tsv', 'template mismatch')
    expect(exportErr.code).toBe('FORMAT_EXPORT_ERROR')

    const lost = new FormatSegmentLostError('fake_tsv', ['seg-1', 'seg-2'], 'imported 3, got 1')
    expect(lost.code).toBe('FORMAT_SEGMENT_LOST')
    expect(lost.missingSegmentIds).toEqual(['seg-1', 'seg-2'])
    expect(lost.message).toContain('seg-1')

    const unsupported = new FormatUnsupportedError('x.unknown', ['fake_tsv'])
    expect(unsupported.code).toBe('FORMAT_UNSUPPORTED')
    expect(unsupported.message).toContain('x.unknown')
    expect(unsupported.message).toContain('fake_tsv')

    const ambiguous = new FormatAmbiguousError('x.tie', 0.95, ['a', 'b'])
    expect(ambiguous.code).toBe('FORMAT_AMBIGUOUS')
    expect(ambiguous.adapterIds).toEqual(['a', 'b'])
  })

  test('全部错误均为 FormatError（可统一捕获），cause 透传', () => {
    const cause = new Error('root')
    const errors: FormatError[] = [
      new FormatParseError('a', 'f', 'd', { cause }),
      new FormatExportError('a', 'd'),
      new FormatSegmentLostError('a', []),
      new FormatUnsupportedError('f', []),
      new FormatAmbiguousError('f', 1, ['a', 'b']),
    ]
    for (const err of errors) {
      expect(err).toBeInstanceOf(FormatError)
      expect(err).toBeInstanceOf(Error)
      expect(typeof err.code).toBe('string')
    }
    expect((errors[0] as FormatParseError).cause).toBe(cause)
  })
})
