/** 项目级确定性 QA 预设；只调整高噪声启发式，不降低格式/标签等硬门。 */
export const QA_PROFILES = ['general', 'subtitle'] as const

export type QaProfile = (typeof QA_PROFILES)[number]

export const DEFAULT_QA_PROFILE: QaProfile = 'general'

export function normalizeQaProfile(value: unknown): QaProfile {
  return QA_PROFILES.includes(value as QaProfile) ? value as QaProfile : DEFAULT_QA_PROFILE
}
