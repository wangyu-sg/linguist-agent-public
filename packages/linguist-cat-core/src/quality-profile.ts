/**
 * Quality profile — plan §21 Fast / Balanced / Best strategy tiers (PB-082).
 *
 * Pure data only: the profile selects a guidance policy for project-chat
 * skills (batch size, TM/TB consultation, independent review pass). It is
 * NOT a model router — the user still picks the model explicitly.
 *
 * `qualityProfile` is an optional LinguistProject field: project.json files
 * written before PB-082 have no such key, so reads normalize through
 * `normalizeQualityProfile` (absent/unknown → 'balanced', never throws) and
 * the normalized value is never written back proactively.
 */

export type LinguistQualityProfile = 'fast' | 'balanced' | 'best'

export const DEFAULT_QUALITY_PROFILE: LinguistQualityProfile = 'balanced'

const QUALITY_PROFILES: readonly LinguistQualityProfile[] = ['fast', 'balanced', 'best']

/** Absent/unknown values fall back to the default tier; never throws. */
export function normalizeQualityProfile(value: unknown): LinguistQualityProfile {
  return QUALITY_PROFILES.includes(value as LinguistQualityProfile)
    ? (value as LinguistQualityProfile)
    : DEFAULT_QUALITY_PROFILE
}

export interface LinguistQualityProfilePolicy {
  /** One-line Chinese batch guidance, consumed by strategy skill texts. */
  proposalBatchGuidance: string
  /**
   * Whether the tier consults TM/TB (cat_search_tm / cat_search_terms) for
   * EVERY segment. Mandatory at every tier (user decision 2026-07-27): real
   * localization workflow always consults project assets before proposing —
   * tiers differ in batch size / passes / review, never in asset consultation.
   */
  consultTmTb: boolean
  /** Whether the tier requires an independent review pass after proposing. */
  reviewPass: boolean
}

/**
 * Plan §21 policy table (consultTmTb corrected per user decision 2026-07-27 —
 * per-segment TM/TB consultation is baseline professional practice, not a
 * premium feature):
 * - fast: large batches, single proposal pass, per-segment TM/TB lookup,
 *   deterministic QA only (speed comes from batch size and single pass,
 *   never from skipping project assets);
 * - balanced: medium batches, per-segment terminology + context,
 *   deterministic QA;
 * - best: small batches, per-segment lookup + context, independent review
 *   pass after the proposal, deterministic QA.
 */
export const QUALITY_PROFILE_POLICIES: Record<LinguistQualityProfile, LinguistQualityProfilePolicy> = {
  fast: {
    proposalBatchGuidance: '大批次：单次 cat_propose_translations 尽量打满 50 段，单轮提案；每段仍先查 cat_search_tm / cat_search_terms 再提案（速度来自批次与单轮，绝不跳过查库）',
    consultTmTb: true,
    reviewPass: false,
  },
  balanced: {
    proposalBatchGuidance: '中批次：每轮约 10~20 段，逐段先查 cat_search_tm / cat_search_terms 并结合上下文再提案',
    consultTmTb: true,
    reviewPass: false,
  },
  best: {
    proposalBatchGuidance: '小批次：每轮不超过 5~10 段，逐段查 TM/TB 与上下文，提案后停下来请用户发起独立评审',
    consultTmTb: true,
    reviewPass: true,
  },
}
