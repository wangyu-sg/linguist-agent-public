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

  test('扫描同时记录 exact/shape/count 守恒，并按真实名称和嵌套检查 pair', () => {
    const preserved = scanUnknownTagPatterns([
      { id: 'seg-1', source: '[Var:1] [Var:1]', target: '[Var:1] [Var:2]' },
      { id: 'seg-2', source: '[Var:3]', target: '' },
    ]).find((result) => result.patternShape === '[Var:{number}]')!
    expect(preserved.sourceTargetPreservation).toEqual({
      exactValueRate: 1 / 3,
      shapeRate: 2 / 3,
      countRate: 0.5,
    })

    const balanced = scanUnknownTagPatterns([{
      id: 'seg-3',
      source: '[outer][inner]x[/inner][/outer]',
      target: '',
    }]).find((result) => result.patternShape === '[outer]')!
    expect(balanced.pairingEvidence).toEqual({
      opening: 1,
      closing: 1,
      balanced: true,
      pairKeys: ['outer'],
    })
    const crossed = scanUnknownTagPatterns([{
      id: 'seg-4',
      source: '[outer][inner]x[/outer][/inner]',
      target: '',
    }]).find((result) => result.patternShape === '[outer]')!
    expect(crossed.pairingEvidence.balanced).toBe(false)
  })

  test('Candidate 拒绝 ReDoS 与真实已知 span；高误报可保存 draft 但不可激活', () => {
    const samples = [
      { id: 'seg-1', source: '[Grm:Qty=1] [Damage]', target: '' },
      { id: 'seg-2', source: '[Grm:Qty=2] [Name]', target: '' },
    ]
    const input = {
      name: 'quantity',
      regex: '\\[Grm:Qty=\\d+\\]',
      kind: 'standalone' as const,
      evidenceExampleIds: ['seg-1:source:0'],
      confidence: 0.9,
      explanation: '客户数量指令',
    }
    const evidence = [{ id: 'seg-1:source:0', segmentId: 'seg-1', side: 'source' as const, value: '[Grm:Qty=2]' }]
    const validEvidence = [{ ...evidence[0]!, value: '[Grm:Qty=1]' }]
    const narrow = validateTagProfileCandidate(input, validEvidence, samples)
    expect(narrow.valid).toBe(true)
    expect(narrow.activationReady).toBe(true)
    expect(narrow.holdout).toEqual({
      passed: true,
      positiveExamples: 1,
      matchedPositiveExamples: 1,
      negativeExamples: 2,
      falsePositives: 0,
    })

    const broad = validateTagProfileCandidate({ ...input, regex: '\\[[^\\]]+\\]' }, validEvidence, samples)
    expect(broad.saveable).toBe(true)
    expect(broad.valid).toBe(false)
    expect(broad.activationReady).toBe(false)
    expect(broad.falsePositiveRate).toBe(1)
    expect(validateTagProfileCandidate({ ...input, regex: '(a+)+$' }, validEvidence, samples).saveable).toBe(false)

    const known = validateTagProfileCandidate(
      { ...input, regex: '\\[b\\]' },
      [{ id: 'known', segmentId: 'known', side: 'source', value: '[b]' }],
      [{ id: 'known', source: '[b]bold[/b]', target: '' }],
    )
    expect(known.knownProfileConflicts).toEqual(['bbcode'])
    expect(known.saveable).toBe(false)
  })

  test('opening/closing Candidate 使用真实同名 pair 与嵌套，不按首字符猜测', () => {
    const input = {
      name: 'outer open',
      regex: '\\[outer\\]',
      kind: 'opening' as const,
      pairKey: 'outer',
      evidenceExampleIds: ['seg-1:source:0'],
      confidence: 0.9,
      explanation: '客户容器标签',
    }
    const evidence = [{ id: 'seg-1:source:0', segmentId: 'seg-1', side: 'source' as const, value: '[outer]' }]
    expect(validateTagProfileCandidate(input, evidence, [{
      id: 'seg-1', source: '[outer]x[/outer]', target: '',
    }]).saveable).toBe(true)
    expect(validateTagProfileCandidate(input, evidence, [{
      id: 'seg-1', source: '[outer][inner]x[/outer][/inner]', target: '',
    }]).saveable).toBe(false)
  })

  test('候选与启用项操作拒绝不存在的 ID', () => {
    const profile = { families: [], candidates: [] }
    expect(() => updateTagProfileEntry(profile, 'missing', 'ignore')).toThrow('candidate not found')
    expect(() => updateTagProfileEntry(profile, 'missing', 'disable')).toThrow('family not found')
  })
})
