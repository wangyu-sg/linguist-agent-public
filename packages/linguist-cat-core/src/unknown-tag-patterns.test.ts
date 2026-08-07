import { describe, expect, test } from 'bun:test'
import {
  scanTags,
  scanUnknownTagPatterns,
  updateTagProfileEntry,
  validateTagProfileCandidate,
} from './index'

describe('未知 Tag 发现', () => {
  test('Given 未登记客户形状 When 扫描 Then 只返回候选且普通 bracket 不硬锁', () => {
    const samples = [{
      id: 'seg-1',
      source: '获得[Grm:Qty=2]伤害，[Damage]可翻译',
      target: 'Deal [Grm:Qty=3] damage, translate [Damage]',
    }]
    const results = scanUnknownTagPatterns(samples)
    expect(results.some((result) => result.patternShape === '[Grm:Qty={number}]')).toBe(true)
    expect(scanTags('[Damage]')).toEqual([])
    expect(scanTags('[b]Damage[/b]').map((tag) => tag.kind)).toEqual(['open', 'close'])
  })

  test('Candidate 拒绝 ReDoS、空匹配和已启用 Profile 重叠', () => {
    const input = {
      name: 'quantity',
      regex: '\\[Grm:Qty=\\d+\\]',
      kind: 'standalone' as const,
      evidenceExampleIds: ['seg-1:source:0'],
      confidence: 0.9,
      explanation: '客户数量指令',
    }
    const evidence = [{ id: 'seg-1:source:0', segmentId: 'seg-1', side: 'source' as const, value: '[Grm:Qty=2]' }]
    expect(validateTagProfileCandidate(input, evidence, ['[Damage]']).valid).toBe(true)
    expect(validateTagProfileCandidate({ ...input, regex: '(a+)+$' }, evidence, []).valid).toBe(false)
  })

  test('候选与启用项操作拒绝不存在的 ID', () => {
    const profile = { families: [], candidates: [] }
    expect(() => updateTagProfileEntry(profile, 'missing', 'ignore')).toThrow('candidate not found')
    expect(() => updateTagProfileEntry(profile, 'missing', 'disable')).toThrow('family not found')
  })
})
