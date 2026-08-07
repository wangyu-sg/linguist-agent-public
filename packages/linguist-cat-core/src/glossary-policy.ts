/**
 * 术语执行策略 glossaryPolicy（PB-096，契约《通用缺陷等级》）。
 *
 * 可选 LinguistProject 字段：旧 project.json
 * 无此键，读取经 normalizeGlossaryPolicy 缺省回落 'prefer'，绝不主动回写。
 *
 * - strict：必须命中术语表翻译，不命中即 L1 defect（terminology_hard）；
 * - prefer（默认）：允许语法/时态/改写偏离，偏离标 needs_review（terminology_soft）；
 * - off：不做术语强制，仅 info 提示。
 * forbidden 条目不受策略影响，永远 strict 阻断（L1 defect）。
 */

export type LinguistGlossaryPolicy = 'strict' | 'prefer' | 'off'

export const DEFAULT_GLOSSARY_POLICY: LinguistGlossaryPolicy = 'prefer'

const GLOSSARY_POLICIES: readonly LinguistGlossaryPolicy[] = ['strict', 'prefer', 'off']

/** Absent/unknown values fall back to 'prefer'; never throws. */
export function normalizeGlossaryPolicy(value: unknown): LinguistGlossaryPolicy {
  return GLOSSARY_POLICIES.includes(value as LinguistGlossaryPolicy)
    ? (value as LinguistGlossaryPolicy)
    : DEFAULT_GLOSSARY_POLICY
}
