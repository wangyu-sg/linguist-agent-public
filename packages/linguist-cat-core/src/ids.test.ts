import { describe, expect, test } from 'bun:test'
import {
  ID_PATTERN,
  InvalidIdError,
  asProjectId,
  asSegmentId,
  createSeededEntropy,
  deriveAssetId,
  deriveProposalId,
  deriveSegmentId,
  fnv1a64,
  generateProjectId,
} from './index'

describe('确定性哈希与 ID', () => {
  test('fnv1a64 同输入同输出，16 位小写 hex', () => {
    expect(fnv1a64('hello')).toBe(fnv1a64('hello'))
    expect(fnv1a64('hello')).toMatch(/^[0-9a-f]{16}$/)
    expect(fnv1a64('hello')).not.toBe(fnv1a64('world'))
    expect(fnv1a64('中文输入')).toBe(fnv1a64('中文输入'))
  })

  test('generateProjectId 注入种子熵 → 完全确定', () => {
    const a = generateProjectId(createSeededEntropy('seed-1'))
    const b = generateProjectId(createSeededEntropy('seed-1'))
    const c = generateProjectId(createSeededEntropy('seed-2'))
    expect(a).toBe(b)
    expect(a).toMatch(ID_PATTERN)
    expect(a.startsWith('prj-')).toBe(true)
    expect(a).not.toBe(c)
  })

  test('派生 ID 同输入同 ID（可重放）', () => {
    expect(deriveAssetId('prj-1', 'sha', 'a.xlf')).toBe(deriveAssetId('prj-1', 'sha', 'a.xlf'))
    expect(deriveSegmentId('ast-1', 3)).toBe(deriveSegmentId('ast-1', 3))
    expect(deriveSegmentId('ast-1', 3, 'k')).not.toBe(deriveSegmentId('ast-1', 3))
    expect(deriveProposalId('seg-1', 2, 'target')).toBe(deriveProposalId('seg-1', 2, 'target'))
    expect(deriveProposalId('seg-1', 2, 'target')).not.toBe(deriveProposalId('seg-1', 3, 'target'))
  })

  test('各前缀 ID 均通过统一格式', () => {
    expect(deriveAssetId('p', 's', 'f')).toMatch(/^ast-/)
    expect(deriveSegmentId('a', 0)).toMatch(/^seg-/)
    expect(deriveProposalId('s', 0, 't')).toMatch(/^prp-/)
  })

  test('校验器拒绝非法格式并抛 InvalidIdError', () => {
    expect(asProjectId(generateProjectId(createSeededEntropy('x')))).toMatch(/^prj-/)
    expect(() => asProjectId('nope')).toThrow(InvalidIdError)
    expect(() => asSegmentId('prj-0123456789abcdef')).toThrow(InvalidIdError)
    try {
      asProjectId('UPPER-CASE')
    } catch (err) {
      expect((err as InvalidIdError).code).toBe('INVALID_ID')
    }
  })
})
