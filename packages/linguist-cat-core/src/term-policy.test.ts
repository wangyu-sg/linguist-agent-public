import { describe, expect, test } from 'bun:test'
import { evaluateSegmentTermPolicy, type TermPolicyCandidate } from './term-policy'

const base = {
  source: 'Use Save and Legacy',
  target: '使用保存，不用旧称',
  sourceLocale: 'en',
  targetLocale: 'zh-CN',
  assetId: 'asset-1',
  segmentMetadata: {},
}

function candidate(overrides: Partial<TermPolicyCandidate>): TermPolicyCandidate {
  return {
    id: 'term-1',
    term: 'Save',
    translation: '保存',
    status: 'required',
    caseSensitive: false,
    conflict: false,
    lowDiscrimination: false,
    ...overrides,
  }
}

describe('统一术语判定', () => {
  test('仅无冲突、作用域明确的 required/forbidden 是硬权威', () => {
    const result = evaluateSegmentTermPolicy({
      ...base,
      candidates: [
        candidate({ id: 'required' }),
        candidate({ id: 'forbidden', term: 'Legacy', translation: '旧称', status: 'forbidden' }),
        candidate({ id: 'conflict', conflict: true }),
        candidate({ id: 'short', lowDiscrimination: true }),
        candidate({ id: 'unknown', module: 'combat' }),
        candidate({ id: 'preferred', status: 'preferred' }),
        candidate({ id: 'deprecated', status: 'deprecated' }),
      ],
    }).matches

    expect(result.map(({ match, enforcement, targetUsed }) => [match.id, enforcement, targetUsed])).toEqual([
      ['required', 'hard', true],
      ['forbidden', 'hard', true],
      ['conflict', 'advisory', true],
      ['short', 'advisory', true],
      ['unknown', 'advisory', true],
      ['preferred', 'advisory', true],
      ['deprecated', 'advisory', true],
    ])
  })
})
