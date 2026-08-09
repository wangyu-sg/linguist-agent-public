import { describe, expect, test } from 'bun:test'
import type { LinguistUnknownTagPatternInfo } from '@proma/shared'
import {
  shouldShowUnknownTagNotice,
  unknownTagFingerprint,
} from './UnknownTagNotice'

function pattern(shape: string, frequency: number): LinguistUnknownTagPatternInfo {
  return {
    patternShape: shape,
    examples: [],
    frequency,
    sourceTargetPreservation: { exactValueRate: 1, shapeRate: 1, countRate: 1 },
    pairingEvidence: { opening: 0, closing: 0, balanced: true, pairKeys: [] },
    suggestedVariableParts: [],
  }
}

describe('未知 Tag 自动提示', () => {
  test('指纹与形状顺序无关，形状或频次变化即改变', () => {
    const a = unknownTagFingerprint([pattern('<g id={n}>', 3), pattern('<%pb>', 1)])
    const b = unknownTagFingerprint([pattern('<%pb>', 1), pattern('<g id={n}>', 3)])
    const c = unknownTagFingerprint([pattern('<g id={n}>', 4), pattern('<%pb>', 1)])

    expect(a).toBe(b)
    expect(a).not.toBe(c)
    expect(unknownTagFingerprint([])).toBe('')
  })

  test.each([
    {
      name: '扫描结果未到：不提示',
      input: { archived: false, patterns: null, dismissedFingerprint: undefined },
      expected: false,
    },
    {
      name: '无疑似形状：不提示',
      input: { archived: false, patterns: [], dismissedFingerprint: undefined },
      expected: false,
    },
    {
      name: '有形状且未忽略：提示',
      input: {
        archived: false,
        patterns: [pattern('<g id={n}>', 3)],
        dismissedFingerprint: undefined,
      },
      expected: true,
    },
    {
      name: '已忽略同一指纹：不提示',
      input: {
        archived: false,
        patterns: [pattern('<g id={n}>', 3)],
        dismissedFingerprint: unknownTagFingerprint([pattern('<g id={n}>', 3)]),
      },
      expected: false,
    },
    {
      name: '忽略后出现新形状：重新提示',
      input: {
        archived: false,
        patterns: [pattern('<g id={n}>', 3), pattern('<%pb>', 2)],
        dismissedFingerprint: unknownTagFingerprint([pattern('<g id={n}>', 3)]),
      },
      expected: true,
    },
    {
      name: '归档项目：不提示',
      input: {
        archived: true,
        patterns: [pattern('<g id={n}>', 3)],
        dismissedFingerprint: undefined,
      },
      expected: false,
    },
  ])('given $name when 评估提示 then 展示=$expected', ({ input, expected }) => {
    expect(shouldShowUnknownTagNotice(input)).toBe(expected)
  })
})
