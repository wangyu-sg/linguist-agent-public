import { describe, expect, test } from 'bun:test'
import {
  DEFAULT_EXECUTION_POLICY,
  executionPolicyFromLegacyQualityProfile,
  normalizeExecutionPolicy,
  resolveExecutionPolicy,
  sameExecutionPolicy,
} from './index'

describe('execution policy（LA-QUALITY-001 质量档位替代的纯模型）', () => {
  test('normalizeExecutionPolicy：合法值原样通过', () => {
    expect(normalizeExecutionPolicy({ independentReview: 'off' })).toEqual({ independentReview: 'off' })
    expect(normalizeExecutionPolicy({ independentReview: 'risk-based' })).toEqual({ independentReview: 'risk-based' })
  })

  test('normalizeExecutionPolicy：缺省/未知/非对象一律回落 off，不抛错', () => {
    expect(DEFAULT_EXECUTION_POLICY).toEqual({ independentReview: 'off' })
    for (const value of [
      undefined,
      null,
      '',
      'risk-based',
      42,
      true,
      [],
      {},
      { independentReview: 'on' },
      { independentReview: 'RISK-BASED' },
      { independentReview: 1 },
      { unrelated: 'risk-based' },
    ]) {
      expect(normalizeExecutionPolicy(value)).toEqual({ independentReview: 'off' })
    }
  })

  test('legacy 映射：fast/balanced → off；best → risk-based；未知档位按 balanced 语义 → off', () => {
    expect(executionPolicyFromLegacyQualityProfile('fast')).toEqual({ independentReview: 'off' })
    expect(executionPolicyFromLegacyQualityProfile('balanced')).toEqual({ independentReview: 'off' })
    expect(executionPolicyFromLegacyQualityProfile('best')).toEqual({ independentReview: 'risk-based' })
    for (const value of [undefined, null, 'turbo', 42, {}]) {
      expect(executionPolicyFromLegacyQualityProfile(value)).toEqual({ independentReview: 'off' })
    }
  })

  test('resolveExecutionPolicy：显式 executionPolicy 优先于 legacy qualityProfile', () => {
    expect(resolveExecutionPolicy({
      executionPolicy: { independentReview: 'off' },
      qualityProfile: 'best',
    })).toEqual({ independentReview: 'off' })
    expect(resolveExecutionPolicy({
      executionPolicy: { independentReview: 'risk-based' },
      qualityProfile: 'fast',
    })).toEqual({ independentReview: 'risk-based' })
  })

  test('resolveExecutionPolicy：仅 legacy 档位时映射；都没有时回落默认', () => {
    expect(resolveExecutionPolicy({ qualityProfile: 'best' })).toEqual({ independentReview: 'risk-based' })
    expect(resolveExecutionPolicy({ qualityProfile: 'fast' })).toEqual({ independentReview: 'off' })
    expect(resolveExecutionPolicy({})).toEqual({ independentReview: 'off' })
    // 非法 executionPolicy 不穿透到 legacy，按非法值自身回落（字段在场即视为新格式）
    expect(resolveExecutionPolicy({ executionPolicy: 'junk', qualityProfile: 'best' }))
      .toEqual({ independentReview: 'off' })
  })

  test('sameExecutionPolicy：扁平字面量结构相等', () => {
    expect(sameExecutionPolicy({ independentReview: 'off' }, { independentReview: 'off' })).toBe(true)
    expect(sameExecutionPolicy({ independentReview: 'risk-based' }, { independentReview: 'risk-based' })).toBe(true)
    expect(sameExecutionPolicy({ independentReview: 'off' }, { independentReview: 'risk-based' })).toBe(false)
  })
})
