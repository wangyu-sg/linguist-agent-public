import { describe, expect, test } from 'bun:test'
import {
  DEFAULT_QUALITY_PROFILE,
  QUALITY_PROFILE_POLICIES,
  normalizeQualityProfile,
  type LinguistQualityProfile,
} from './index'

describe('quality profile（PB-082 质量策略档纯模型）', () => {
  test('normalizeQualityProfile：三档字面量原样通过', () => {
    expect(normalizeQualityProfile('fast')).toBe('fast')
    expect(normalizeQualityProfile('balanced')).toBe('balanced')
    expect(normalizeQualityProfile('best')).toBe('best')
  })

  test('normalizeQualityProfile：缺省/未知/非字符串一律回落 balanced，不抛错', () => {
    expect(DEFAULT_QUALITY_PROFILE).toBe('balanced')
    for (const value of [undefined, null, '', 'turbo', 'FAST', 'Best', 0, 42, true, {}, []]) {
      expect(normalizeQualityProfile(value)).toBe('balanced')
    }
  })

  test('策略表：三档齐全且字段完整', () => {
    const profiles = Object.keys(QUALITY_PROFILE_POLICIES).sort()
    expect(profiles).toEqual(['balanced', 'best', 'fast'])
    for (const profile of profiles as LinguistQualityProfile[]) {
      const policy = QUALITY_PROFILE_POLICIES[profile]
      expect(typeof policy.proposalBatchGuidance).toBe('string')
      expect(policy.proposalBatchGuidance.length).toBeGreaterThan(0)
      expect(typeof policy.consultTmTb).toBe('boolean')
      expect(typeof policy.reviewPass).toBe('boolean')
    }
  })

  test('策略表映射与计划 §21 一致（2026-07-27 用户修正：全档逐段查库）', () => {
    // 三档都必须逐段查 TM/TB（真实本地化基线实践）；档位差异只在批次/轮次/评审
    // Fast：大 batch、单次 proposal、仅确定性 QA
    expect(QUALITY_PROFILE_POLICIES.fast.consultTmTb).toBe(true)
    expect(QUALITY_PROFILE_POLICIES.fast.reviewPass).toBe(false)
    // Balanced：中 batch、术语和上下文、确定性 QA
    expect(QUALITY_PROFILE_POLICIES.balanced.consultTmTb).toBe(true)
    expect(QUALITY_PROFILE_POLICIES.balanced.reviewPass).toBe(false)
    // Best：小 batch、proposal 后独立 review pass、确定性 QA
    expect(QUALITY_PROFILE_POLICIES.best.consultTmTb).toBe(true)
    expect(QUALITY_PROFILE_POLICIES.best.reviewPass).toBe(true)
  })
})
