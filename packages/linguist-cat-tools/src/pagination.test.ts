import { describe, expect, test } from 'bun:test'
import { LinguistCatInvalidArgumentError } from './errors'
import { pageHasMore, resolvePage } from './pagination'

const LIMITS = { defaultLimit: 20, maxLimit: 100 }

describe('resolvePage', () => {
  test('defaults apply when limit/offset are omitted', () => {
    expect(resolvePage({}, LIMITS)).toEqual({ limit: 20, offset: 0, clamped: false })
    expect(resolvePage({ offset: 40 }, LIMITS)).toEqual({ limit: 20, offset: 40, clamped: false })
  })

  test('in-range limit is used as-is', () => {
    expect(resolvePage({ limit: 7, offset: 3 }, LIMITS)).toEqual({ limit: 7, offset: 3, clamped: false })
  })

  test('limit equal to the hard max is not clamped', () => {
    expect(resolvePage({ limit: 100 }, LIMITS)).toEqual({ limit: 100, offset: 0, clamped: false })
  })

  test('oversized limit clamps to the hard max with a note', () => {
    const page = resolvePage({ limit: 500, offset: 10 }, LIMITS)
    expect(page.limit).toBe(100)
    expect(page.offset).toBe(10)
    expect(page.clamped).toBe(true)
    expect(page.note).toContain('500')
    expect(page.note).toContain('100')
  })

  test('invalid limits/offsets throw INVALID_ARGUMENT', () => {
    for (const bad of [0, -1, 2.5, Number.NaN]) {
      expect(() => resolvePage({ limit: bad }, LIMITS)).toThrow(LinguistCatInvalidArgumentError)
    }
    for (const bad of [-1, 1.5, Number.NaN]) {
      expect(() => resolvePage({ offset: bad }, LIMITS)).toThrow(LinguistCatInvalidArgumentError)
    }
    try {
      resolvePage({ limit: -1 }, LIMITS)
      expect.unreachable()
    } catch (err) {
      expect(err).toBeInstanceOf(LinguistCatInvalidArgumentError)
      expect((err as LinguistCatInvalidArgumentError).code).toBe('INVALID_ARGUMENT')
      expect((err as LinguistCatInvalidArgumentError).argument).toBe('limit')
    }
  })
})

describe('pageHasMore', () => {
  test('offset + page size below total means more pages', () => {
    expect(pageHasMore(101, 0, 100)).toBe(true)
    expect(pageHasMore(100, 0, 100)).toBe(false)
    expect(pageHasMore(100, 99, 1)).toBe(false)
  })

  test('offset beyond total yields an empty page with no more pages', () => {
    expect(pageHasMore(100, 200, 0)).toBe(false)
  })
})
