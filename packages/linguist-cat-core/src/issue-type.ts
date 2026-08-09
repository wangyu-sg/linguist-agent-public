/**
 * QA 契约对齐（PB-096）：缺陷分类 issue_type、处置 disposition 与
 * 五档严重度 L0–L4 的单一事实来源。契约文本见用户拍板的《通用缺陷等级》：
 * severity 五档（L0 Blocker / L1 Critical / L2 Major / L3 Minor /
 * L4 Suggestion）、disposition 四值（defect / needs_review / query / info，
 * 创建时确定，与 status 状态机正交）、issue_type 29 枚举全量覆盖。
 *
 * 本模块是纯数据 + 表驱动映射：规则码 -> (issueType, severity, disposition)
 * 的静态默认值；schema v7 的 SQL 回填与 PB-091 迁移层也以本表为准。
 */

/** 缺陷严重度五档（L0 绝对阻断 → L4 建议项，L4 不计入缺陷率）。 */
export const QA_FINDING_SEVERITIES = ['L0', 'L1', 'L2', 'L3', 'L4'] as const
export type QaFindingSeverity = (typeof QA_FINDING_SEVERITIES)[number]

/** 处置四值：明确缺陷 / 灰区需人工确认 / 必须向项目方提问 / 仅信息提示。 */
export const QA_FINDING_DISPOSITIONS = ['defect', 'needs_review', 'query', 'info'] as const
export type QaFindingDisposition = (typeof QA_FINDING_DISPOSITIONS)[number]

/** issue_type 29 枚举（契约全量覆盖，含 other 兜底）。 */
export const QA_ISSUE_TYPES = [
  'hallucination',
  'mistranslation',
  'omission',
  'addition',
  'terminology_hard',
  'terminology_soft',
  'consistency',
  'style_guide',
  'character_voice',
  'register_tone',
  'fluency_readability',
  'grammar_syntax',
  'spelling_typo',
  'punctuation_typography',
  'capitalization_case',
  'numbers_units_dates',
  'names_titles_honorifics',
  'gender_pronouns',
  'cultural_sensitivity',
  'profanity_rating',
  'legal_compliance',
  'format_tags',
  'placeholders_variables',
  'whitespace_linebreaks',
  'length_limit',
  'ui_terminology',
  'glossary_conflict',
  'source_issue',
  'other',
] as const
export type QaIssueType = (typeof QA_ISSUE_TYPES)[number]

export interface QaIssueMapping {
  issueType: QaIssueType
  severity: QaFindingSeverity
  disposition: QaFindingDisposition
}

/**
 * 规则码 -> 契约三元组静态映射。定级依据《通用缺陷等级》指引：
 * 占位符/标签/ICU 破坏 = L0 defect；硬术语（禁用/严格必需）= L1 defect；
 * 数字单位 = L1 defect；preferred 偏离由术语校验返回 advisory；
 * 一致性/标点/空白/长度 = L2–L3 defect；术语表冲突不可判定 = query。
 */
export const QA_CODE_ISSUE_MAPPING: Readonly<Record<string, QaIssueMapping>> = {
  // —— PB-070 既有 11 码（code 与 message 不变，仅补契约三元组）——
  PLACEHOLDER_MISMATCH: { issueType: 'placeholders_variables', severity: 'L0', disposition: 'defect' },
  TAG_MISMATCH: { issueType: 'format_tags', severity: 'L0', disposition: 'defect' },
  EMPTY_TARGET: { issueType: 'omission', severity: 'L1', disposition: 'defect' },
  FORBIDDEN_TERM: { issueType: 'terminology_hard', severity: 'L1', disposition: 'defect' },
  REQUIRED_TERM: { issueType: 'terminology_hard', severity: 'L1', disposition: 'defect' },
  NUMBER_MISMATCH: { issueType: 'numbers_units_dates', severity: 'L1', disposition: 'defect' },
  WHITESPACE_MISMATCH: { issueType: 'whitespace_linebreaks', severity: 'L3', disposition: 'defect' },
  REPEATED_PUNCTUATION: { issueType: 'punctuation_typography', severity: 'L3', disposition: 'defect' },
  SOURCE_EQUALS_TARGET: { issueType: 'omission', severity: 'L2', disposition: 'defect' },
  INCONSISTENT_REPEATED_SOURCE: { issueType: 'consistency', severity: 'L2', disposition: 'defect' },
  TARGET_LENGTH_WARNING: { issueType: 'length_limit', severity: 'L3', disposition: 'defect' },
  // —— PB-096 批次 1：Xbench 类确定性检查（迁自旧仓 mechanical_text_qa / delivery_qa）——
  NEWLINE_MISMATCH: { issueType: 'whitespace_linebreaks', severity: 'L2', disposition: 'defect' },
  EDGE_WHITESPACE: { issueType: 'whitespace_linebreaks', severity: 'L3', disposition: 'defect' },
  DOUBLE_SPACE: { issueType: 'whitespace_linebreaks', severity: 'L3', disposition: 'defect' },
  UNPAIRED_SYMBOL: { issueType: 'punctuation_typography', severity: 'L2', disposition: 'defect' },
  UNPAIRED_QUOTE: { issueType: 'punctuation_typography', severity: 'L2', disposition: 'defect' },
  REPEATED_WORD: { issueType: 'fluency_readability', severity: 'L3', disposition: 'defect' },
  EMAIL_MISMATCH: { issueType: 'placeholders_variables', severity: 'L2', disposition: 'defect' },
  URL_MISMATCH: { issueType: 'placeholders_variables', severity: 'L2', disposition: 'defect' },
  ALPHANUMERIC_MISMATCH: { issueType: 'placeholders_variables', severity: 'L2', disposition: 'defect' },
  TARGET_SOURCE_INCONSISTENCY: { issueType: 'consistency', severity: 'L3', disposition: 'defect' },
  FULLWIDTH_PUNCTUATION: { issueType: 'punctuation_typography', severity: 'L2', disposition: 'defect' },
  RESIDUAL_CJK: { issueType: 'omission', severity: 'L2', disposition: 'defect' },
  GLOSSARY_CONFLICT: { issueType: 'glossary_conflict', severity: 'L2', disposition: 'query' },
  UPPERCASE_TOKEN_MISMATCH: { issueType: 'capitalization_case', severity: 'L3', disposition: 'defect' },
  CAMELCASE_TOKEN_MISMATCH: { issueType: 'capitalization_case', severity: 'L3', disposition: 'defect' },
  // —— PB-097 tag 族引擎：占位符族→placeholders_variables；成对与富文本族→format_tags（均 L0 defect）——
  PLACEHOLDER_FAMILY_MISMATCH: { issueType: 'placeholders_variables', severity: 'L0', disposition: 'defect' },
  TAG_FAMILY_MISMATCH: { issueType: 'format_tags', severity: 'L0', disposition: 'defect' },
  TAG_PAIRING_MISMATCH: { issueType: 'format_tags', severity: 'L0', disposition: 'defect' },
}

/** 未知码兜底：other / L2 / defect（schema v7 回填与 openQaFinding 共用）。 */
export const FALLBACK_QA_ISSUE_MAPPING: QaIssueMapping = {
  issueType: 'other',
  severity: 'L2',
  disposition: 'defect',
}

/** 按规则码查契约三元组；未知码返回 other 兜底，绝不抛错。 */
export function resolveQaIssueMapping(code: string): QaIssueMapping {
  return QA_CODE_ISSUE_MAPPING[code] ?? FALLBACK_QA_ISSUE_MAPPING
}
