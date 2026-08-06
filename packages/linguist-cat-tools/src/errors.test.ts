import { describe, expect, test } from 'bun:test'
import {
  LINGUIST_CAT_TOOL_ERROR_CODES,
  LinguistCatAssetNotFoundError,
  LinguistCatBindingMissingError,
  LinguistCatContextDriftError,
  LinguistCatInvalidArgumentError,
  LinguistCatProjectMissingError,
  LinguistCatToolError,
  type LinguistCatToolErrorCode,
} from './errors'

describe('tool error codes', () => {
  test('the codes registry is stable (public contract)', () => {
    expect(LINGUIST_CAT_TOOL_ERROR_CODES).toEqual({
      BINDING_MISSING: 'BINDING_MISSING',
      PROJECT_MISSING: 'PROJECT_MISSING',
      ASSET_NOT_FOUND: 'ASSET_NOT_FOUND',
      INVALID_ARGUMENT: 'INVALID_ARGUMENT',
      CONTEXT_DRIFT: 'CONTEXT_DRIFT',
      TRANSLATION_SCOPE_INCOMPLETE: 'TRANSLATION_SCOPE_INCOMPLETE',
    })
  })

  test('typed errors carry their code and a [CODE] message prefix (model-visible)', () => {
    const cases: Array<[LinguistCatToolError, LinguistCatToolErrorCode]> = [
      [new LinguistCatBindingMissingError(), 'BINDING_MISSING'],
      [new LinguistCatProjectMissingError('prj-abc'), 'PROJECT_MISSING'],
      [new LinguistCatAssetNotFoundError('ast-abc'), 'ASSET_NOT_FOUND'],
      [new LinguistCatInvalidArgumentError('limit', 'bad'), 'INVALID_ARGUMENT'],
      [new LinguistCatContextDriftError(), 'CONTEXT_DRIFT'],
    ]
    for (const [err, code] of cases) {
      expect(err.code).toBe(code)
      expect(err.message.startsWith(`[${code}]`)).toBe(true)
      expect(err).toBeInstanceOf(Error)
      expect(err).toBeInstanceOf(LinguistCatToolError)
    }
  })

  test('error messages never contain absolute filesystem paths', () => {
    const errors = [
      new LinguistCatBindingMissingError(),
      new LinguistCatProjectMissingError('prj-abc'),
      new LinguistCatAssetNotFoundError('ast-abc'),
      new LinguistCatInvalidArgumentError('limit', 'bad'),
    ]
    for (const err of errors) {
      expect(err.message).not.toContain('/Users/')
      expect(err.message).not.toContain(process.env.HOME ?? '__no_home__')
    }
  })
})
