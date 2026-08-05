import { describe, expect, test } from 'bun:test'
import {
  ID_PATTERN,
  InvalidIdError,
  asAssetId,
  asProjectId,
  asProposalId,
  asQaFindingId,
  asSegmentId,
  createSeededEntropy,
  deriveAssetId,
  deriveProposalId,
  deriveQaFindingId,
  deriveSegmentId,
  deriveStableIdV2,
  fnv1a64,
  generateProjectId,
  parseStableId,
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

  test('Stable ID v2 使用 entity/version 与长度前缀 UTF-8 tuple 的完整 SHA-256', () => {
    expect(deriveStableIdV2('seg', ['é'])).toBe(
      'seg_v2_69ea525c5ffdb56e42d30d52ae279b536fd5a9ed9101d94ea932adaab05beef5',
    )
    expect(deriveStableIdV2('seg', ['ab', 'c'])).not.toBe(
      deriveStableIdV2('seg', ['a', 'bc']),
    )
    expect(deriveStableIdV2('seg', [null])).not.toBe(
      deriveStableIdV2('seg', ['null']),
    )
  })

  test('派生 ID 同输入同 ID（可重放）', () => {
    expect(deriveAssetId('prj-1', 'sha', 'a.xlf')).toBe(deriveAssetId('prj-1', 'sha', 'a.xlf'))
    expect(deriveSegmentId('ast-1', 3)).toBe(deriveSegmentId('ast-1', 3))
    expect(deriveSegmentId('ast-1', 3, 'k')).not.toBe(deriveSegmentId('ast-1', 3))
    expect(deriveProposalId('seg-1', 2, 'target')).toBe(deriveProposalId('seg-1', 2, 'target'))
    expect(deriveProposalId('seg-1', 2, 'target')).not.toBe(deriveProposalId('seg-1', 3, 'target'))
  })

  test('内容派生实体新建 v2 ID，并保留 v1 解析与读取', () => {
    const assetId = deriveAssetId('p', 's', 'f')
    const segmentId = deriveSegmentId('a', 0)
    const proposalId = deriveProposalId('s', 0, 't')
    const findingId = deriveQaFindingId('s', 'C', 'message')
    const v2Ids = [assetId, segmentId, proposalId, findingId]
    expect(v2Ids).toEqual([
      expect.stringMatching(/^ast_v2_[0-9a-f]{64}$/),
      expect.stringMatching(/^seg_v2_[0-9a-f]{64}$/),
      expect.stringMatching(/^prp_v2_[0-9a-f]{64}$/),
      expect.stringMatching(/^qaf_v2_[0-9a-f]{64}$/),
    ])

    const legacy = 'seg-0123456789abcdef'
    expect(parseStableId(legacy)).toEqual({
      entityType: 'seg',
      version: 'v1',
      digest: '0123456789abcdef',
    })
    expect(parseStableId(segmentId)).toEqual({
      entityType: 'seg',
      version: 'v2',
      digest: segmentId.slice('seg_v2_'.length),
    })
    expect(String(asSegmentId(legacy))).toBe(legacy)
    expect(asSegmentId(segmentId)).toBe(segmentId)
    expect(asAssetId(assetId)).toBe(assetId)
    expect(asProposalId(proposalId)).toBe(proposalId)
    expect(asQaFindingId(findingId)).toBe(findingId)
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
