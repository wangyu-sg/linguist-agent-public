import {
  DETERMINISTIC_HARD_RULE_CODES,
  runDeterministicHardRules,
  type ForbiddenTermRule,
  type RequiredTerminologyRule,
} from './hard-rules'
import type { LinguistGlossaryPolicy } from './glossary-policy'
import { resolveQaIssueMapping, type QaFindingDisposition, type QaFindingSeverity, type QaIssueType } from './issue-type'
import type { OpenQaFindingInput } from './qa-finding'
import type { LinguistTagProfile } from './tag-profile'
import { compareSegments, type Segment } from './segment'
import type { QaProfile } from './qa-profile'

export const QA_RULE_CODES = {
  PLACEHOLDER_MISMATCH: 'PLACEHOLDER_MISMATCH',
  TAG_MISMATCH: 'TAG_MISMATCH',
  EMPTY_TARGET: 'EMPTY_TARGET',
  FORBIDDEN_TERM: 'FORBIDDEN_TERM',
  REQUIRED_TERM: 'REQUIRED_TERM',
  NUMBER_MISMATCH: 'NUMBER_MISMATCH',
  WHITESPACE_MISMATCH: 'WHITESPACE_MISMATCH',
  REPEATED_PUNCTUATION: 'REPEATED_PUNCTUATION',
  SOURCE_EQUALS_TARGET: 'SOURCE_EQUALS_TARGET',
  INCONSISTENT_REPEATED_SOURCE: 'INCONSISTENT_REPEATED_SOURCE',
  TARGET_LENGTH_WARNING: 'TARGET_LENGTH_WARNING',
  // PB-096 批次 1（Xbench 类检查，迁自旧仓 mechanical_text_qa / delivery_qa）
  NEWLINE_MISMATCH: 'NEWLINE_MISMATCH',
  EDGE_WHITESPACE: 'EDGE_WHITESPACE',
  DOUBLE_SPACE: 'DOUBLE_SPACE',
  UNPAIRED_SYMBOL: 'UNPAIRED_SYMBOL',
  UNPAIRED_QUOTE: 'UNPAIRED_QUOTE',
  REPEATED_WORD: 'REPEATED_WORD',
  EMAIL_MISMATCH: 'EMAIL_MISMATCH',
  URL_MISMATCH: 'URL_MISMATCH',
  ALPHANUMERIC_MISMATCH: 'ALPHANUMERIC_MISMATCH',
  TARGET_SOURCE_INCONSISTENCY: 'TARGET_SOURCE_INCONSISTENCY',
  FULLWIDTH_PUNCTUATION: 'FULLWIDTH_PUNCTUATION',
  RESIDUAL_CJK: 'RESIDUAL_CJK',
  GLOSSARY_CONFLICT: 'GLOSSARY_CONFLICT',
  UPPERCASE_TOKEN_MISMATCH: 'UPPERCASE_TOKEN_MISMATCH',
  CAMELCASE_TOKEN_MISMATCH: 'CAMELCASE_TOKEN_MISMATCH',
  // PB-097 tag 族引擎（占位符族 / 富文本族守恒 / 成对配平与嵌套）
  PLACEHOLDER_FAMILY_MISMATCH: 'PLACEHOLDER_FAMILY_MISMATCH',
  TAG_FAMILY_MISMATCH: 'TAG_FAMILY_MISMATCH',
  TAG_PAIRING_MISMATCH: 'TAG_PAIRING_MISMATCH',
} as const

export type QaRuleCode = (typeof QA_RULE_CODES)[keyof typeof QA_RULE_CODES]

/** 术语表 preferred 一词多译冲突组（store 层用现成 conflict 标志语义预先算好）。 */
export interface QaGlossaryConflict {
  sourceTerm: string
  translations: readonly string[]
}

export interface QaRunOptions {
  /** general 保守；subtitle 容忍字幕省略号/强调标点与正常中英长度扩展。 */
  profile?: QaProfile
  requiredTerminology?: readonly RequiredTerminologyRule[]
  forbiddenTerms?: readonly (ForbiddenTermRule | string)[]
  minTargetLengthRatio?: number
  maxTargetLengthRatio?: number
  /** 术语执行策略（默认 prefer）；forbidden 条目永远 strict 阻断。 */
  glossaryPolicy?: LinguistGlossaryPolicy
  /** preferred 一词多译冲突组；源文命中即产 glossary_conflict（query）。 */
  glossaryConflicts?: readonly QaGlossaryConflict[]
  /** 高噪声令牌 parity 检查，照旧仓 Xbench opt-in 语义默认关。 */
  checkUppercaseTokens?: boolean
  checkCamelCaseTokens?: boolean
  /** PB-097：项目 tag 族登记表；缺省 = 仅内置族。 */
  tagProfile?: LinguistTagProfile
  /** 短源文只有相邻上下文相同时才做重复源文一致性检查。 */
  shortRepeatedSourceMaxLength?: number
}

interface FindingSpec {
  code: QaRuleCode
  message: string
  /** 运行时覆盖静态映射表（术语策略升降级）；缺省按表。 */
  severity?: QaFindingSeverity
  issueType?: QaIssueType
  disposition?: QaFindingDisposition
}

const HARD_RULE_MAPPING: Partial<Record<string, FindingSpec>> = {
  [DETERMINISTIC_HARD_RULE_CODES.PLACEHOLDER_SIGNATURE_MISMATCH]: {
    code: QA_RULE_CODES.PLACEHOLDER_MISMATCH,
    message: '占位符与源文不一致。',
  },
  [DETERMINISTIC_HARD_RULE_CODES.ICU_SIGNATURE_MISMATCH]: {
    code: QA_RULE_CODES.PLACEHOLDER_MISMATCH,
    message: 'ICU 占位符分支与源文不一致。',
  },
  [DETERMINISTIC_HARD_RULE_CODES.TAG_SIGNATURE_MISMATCH]: {
    code: QA_RULE_CODES.TAG_MISMATCH,
    message: '标签结构与源文不一致。',
  },
  [DETERMINISTIC_HARD_RULE_CODES.FORBIDDEN_TERM_PRESENT]: {
    code: QA_RULE_CODES.FORBIDDEN_TERM,
    message: '译文包含禁用术语。',
  },
  [DETERMINISTIC_HARD_RULE_CODES.REQUIRED_TERMINOLOGY_MISSING]: {
    code: QA_RULE_CODES.REQUIRED_TERM,
    message: '译文缺少必需术语。',
  },
  [DETERMINISTIC_HARD_RULE_CODES.NUMBER_SIGNATURE_MISMATCH]: {
    code: QA_RULE_CODES.NUMBER_MISMATCH,
    message: '数字与源文不一致。',
  },
  // PB-096：NEWLINE 硬规则映射进 QA finding（TOKEN 仍只作写入门，不进 QA）。
  [DETERMINISTIC_HARD_RULE_CODES.NEWLINE_SIGNATURE_MISMATCH]: {
    code: QA_RULE_CODES.NEWLINE_MISMATCH,
    message: '换行与源文不一致。',
  },
  // PB-097 tag 族引擎三码：占位符族增量守恒 / 富文本族守恒 / 配平嵌套。
  [DETERMINISTIC_HARD_RULE_CODES.TAG_PLACEHOLDER_FAMILY_MISMATCH]: {
    code: QA_RULE_CODES.PLACEHOLDER_FAMILY_MISMATCH,
    message: '占位符/格式令牌与源文不一致。',
  },
  [DETERMINISTIC_HARD_RULE_CODES.TAG_FAMILY_MISMATCH]: {
    code: QA_RULE_CODES.TAG_FAMILY_MISMATCH,
    message: '富文本/项目标签族与源文不一致。',
  },
  [DETERMINISTIC_HARD_RULE_CODES.TAG_PAIRING_MISMATCH]: {
    code: QA_RULE_CODES.TAG_PAIRING_MISMATCH,
    message: '标签配对或嵌套不合法。',
  },
}

function finding(segment: Segment, spec: FindingSpec): OpenQaFindingInput {
  const mapping = resolveQaIssueMapping(spec.code)
  return {
    segmentId: segment.id,
    code: spec.code,
    severity: spec.severity ?? mapping.severity,
    issueType: spec.issueType ?? mapping.issueType,
    disposition: spec.disposition ?? mapping.disposition,
    message: spec.message,
  }
}

function boundaryWhitespace(value: string): string {
  return `${value.match(/^\s*/u)?.[0].length ?? 0}:${value.match(/\s*$/u)?.[0].length ?? 0}`
}

function unicodeLength(value: string): number {
  return Array.from(value).length
}

// ===== 批次 1 纯函数（旧仓 cat-data 只读参考，逻辑照抄、风格适配）=====

/** 旧仓 mechanical_text_qa.ts:58-81：括号族栈式配对（含全角族）。 */
function unpairedSymbolFamilies(value: string): string[] {
  const pairs = new Map<string, string>([
    [')', '('], [']', '['], ['}', '{'], ['）', '（'], ['］', '［'], ['｝', '｛'],
    ['】', '【'], ['〉', '〈'], ['》', '《'], ['」', '「'], ['』', '『'],
  ])
  const opens = new Set(pairs.values())
  const stack: string[] = []
  const failures = new Set<string>()
  for (const char of value) {
    if (opens.has(char)) {
      stack.push(char)
      continue
    }
    const expected = pairs.get(char)
    if (!expected) continue
    if (stack.at(-1) === expected) stack.pop()
    else failures.add(`${expected}${char}`)
  }
  for (const open of stack) {
    const close = [...pairs].find(([, candidate]) => candidate === open)?.[0] ?? '?'
    failures.add(`${open}${close}`)
  }
  return [...failures]
}

/** 旧仓 mechanical_text_qa.ts:83-101：引号配对（忽略词内撇号 don't/hero's）。 */
function unpairedQuoteFamilies(value: string): string[] {
  const failures: string[] = []
  const paired = [['“', '”'], ['«', '»'], ['‹', '›']] as const
  for (const [open, close] of paired) {
    const opens = [...value].filter((char) => char === open).length
    const closes = [...value].filter((char) => char === close).length
    if (opens !== closes) failures.push(`${open}${close}:${opens}/${closes}`)
  }
  const straightDouble = (value.match(/"/g) ?? []).length
  if (straightDouble % 2 !== 0) failures.push(`\"\":${straightDouble}`)
  const withoutApostrophes = value.replace(/(?<=\p{L})['’](?=\p{L})/gu, '')
  const delimiterSingles = withoutApostrophes.match(/'/g)?.length ?? 0
  if (delimiterSingles % 2 !== 0) failures.push(`'':${delimiterSingles}`)
  const curlySingleOpens = [...withoutApostrophes].filter((char) => char === '‘').length
  const curlySingleCloses = [...withoutApostrophes].filter((char) => char === '’').length
  if (curlySingleOpens !== curlySingleCloses) failures.push(`‘’:${curlySingleOpens}/${curlySingleCloses}`)
  return failures
}

/** 旧仓 mechanical_text_qa.ts:103-115：空白分隔的相邻重复词（长度>1，忽略大小写）。 */
function repeatedWords(value: string): string[] {
  const words = Array.from(value.matchAll(/\p{L}+(?:['’]\p{L}+)*/gu))
  const repeated = new Set<string>()
  for (let index = 1; index < words.length; index += 1) {
    const previous = words[index - 1]!
    const current = words[index]!
    const separator = value.slice((previous.index ?? 0) + previous[0].length, current.index ?? 0)
    if (/^\s+$/u.test(separator) && current[0].length > 1 && current[0].toLocaleLowerCase() === previous[0].toLocaleLowerCase()) {
      repeated.add(current[0])
    }
  }
  return [...repeated]
}

function uppercaseTokens(value: string): string[] {
  return value.match(/\b[A-Z][A-Z0-9_-]{1,}\b/g) ?? []
}

function camelCaseTokens(value: string): string[] {
  return value.match(/\b(?:[a-z]+[A-Z][A-Za-z0-9]*|[A-Z][a-z]+[A-Z][A-Za-z0-9]*)\b/g) ?? []
}

/** 旧仓 delivery_qa.ts:120-130：email/url/alphanumeric 令牌抽取。 */
function emails(value: string): string[] {
  return value.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) ?? []
}

function urls(value: string): string[] {
  return value.match(/https?:\/\/[^\s)]+/gi) ?? []
}

function alphanumericTokens(value: string): string[] {
  return value.match(/[A-Za-z]+[A-Za-z0-9_-]*\d+[A-Za-z0-9_-]*|\d+[A-Za-z][A-Za-z0-9_-]*/g) ?? []
}

function sameMultiset(left: readonly string[], right: readonly string[]): boolean {
  return [...left].sort().join('\u0000') === [...right].sort().join('\u0000')
}

/** 旧仓 delivery_qa.ts:201-205：散文标点的高信号 zh→en 泄漏检查（UI 括号族不算）。 */
function hasFullwidthPunctuation(value: string): boolean {
  return /[，。！？；：、（）]/u.test(value)
}

/** 旧仓 delivery_qa.ts:215-217：CJK 残留（统一表意文字区间）。 */
function hasCjk(value: string): boolean {
  return /[㐀-鿿]/u.test(value)
}

function hasRepeatedPunctuation(value: string, profile: QaProfile): boolean {
  if (profile === 'subtitle') {
    // 字幕中的 ...、!!、?! 是常见节奏/强调；连续逗号、分号、冒号仍属高信号。
    return /([,，;；:：])\1+/u.test(value)
  }
  return /([!?！？。,.，；;:：])\1+/u.test(value)
}

/** 旧仓 delivery_qa.ts:291：CJK 泄漏检查仅在 zh→en 场景启用（locale 感知）。 */
function checksCjkLeakage(segment: Segment): boolean {
  const localeBase = (value: string): string => value.trim().toLocaleLowerCase().split('-', 1)[0] ?? ''
  return localeBase(segment.sourceLocale) === 'zh' && localeBase(segment.targetLocale) === 'en'
}

/** 一致性分组归一化（旧仓 normalizeConsistency 默认大小写不敏感）。 */
function normalizeConsistency(value: string): string {
  return value.normalize('NFKC').replace(/\s+/g, ' ').trim().toLocaleLowerCase()
}

const REQUIRED_TERM_SPEC: FindingSpec = {
  code: QA_RULE_CODES.REQUIRED_TERM,
  severity: 'L1',
  issueType: 'terminology_hard',
  disposition: 'defect',
  message: '译文缺少必需术语。',
}

function segmentFindings(segment: Segment, options: QaRunOptions): OpenQaFindingInput[] {
  if (segment.locked || segment.source === '') return []
  if (segment.target === '') {
    return [finding(segment, {
      code: QA_RULE_CODES.EMPTY_TARGET,
      message: '译文为空。',
    })]
  }

  const results: OpenQaFindingInput[] = []
  const emitted = new Set<QaRuleCode>()
  const emit = (spec: FindingSpec): void => {
    if (emitted.has(spec.code)) return
    emitted.add(spec.code)
    results.push(finding(segment, spec))
  }

  for (const violation of runDeterministicHardRules({
    segment,
    proposedTarget: segment.target,
    requiredTerminology: options.requiredTerminology,
    forbiddenTerms: options.forbiddenTerms,
    ...(options.tagProfile !== undefined ? { tagProfile: options.tagProfile } : {}),
  }).violations) {
    const mapped = HARD_RULE_MAPPING[violation.code]
    if (mapped === undefined) continue
    emit(mapped.code === QA_RULE_CODES.REQUIRED_TERM ? REQUIRED_TERM_SPEC : mapped)
  }

  if (boundaryWhitespace(segment.source) !== boundaryWhitespace(segment.target)) {
    emit({
      code: QA_RULE_CODES.WHITESPACE_MISMATCH,
      message: '译文首尾空白与源文不一致。',
    })
  }
  if (segment.target !== segment.target.trim()) {
    emit({
      code: QA_RULE_CODES.EDGE_WHITESPACE,
      message: '译文首尾存在多余空白。',
    })
  }
  if (/ {2,}/.test(segment.target)) {
    emit({
      code: QA_RULE_CODES.DOUBLE_SPACE,
      message: '译文包含连续空格。',
    })
  }
  const profile = options.profile ?? 'general'
  if (hasRepeatedPunctuation(segment.target, profile)) {
    emit({
      code: QA_RULE_CODES.REPEATED_PUNCTUATION,
      message: '译文包含重复标点。',
    })
  }
  const symbolFamilies = unpairedSymbolFamilies(segment.target)
  if (symbolFamilies.length > 0) {
    emit({
      code: QA_RULE_CODES.UNPAIRED_SYMBOL,
      message: `译文包含不配对或嵌套错误的符号：${symbolFamilies.join('、')}。`,
    })
  }
  const quoteFamilies = unpairedQuoteFamilies(segment.target)
  if (quoteFamilies.length > 0) {
    emit({
      code: QA_RULE_CODES.UNPAIRED_QUOTE,
      message: '译文包含不配对的引号。',
    })
  }
  const repeated = repeatedWords(segment.target)
  if (repeated.length > 0) {
    emit({
      code: QA_RULE_CODES.REPEATED_WORD,
      message: `译文包含相邻重复词：${repeated.join('、')}。`,
    })
  }
  if (
    /\p{L}/u.test(segment.source)
    && segment.source.normalize('NFKC').trim() === segment.target.normalize('NFKC').trim()
  ) {
    emit({
      code: QA_RULE_CODES.SOURCE_EQUALS_TARGET,
      message: '译文与源文相同。',
    })
  }

  // 不可译令牌多重集（旧仓 delivery_qa.ts:354-364）：源文有才比较。
  const sourceEmails = emails(segment.source)
  if (sourceEmails.length > 0 && !sameMultiset(sourceEmails, emails(segment.target))) {
    emit({
      code: QA_RULE_CODES.EMAIL_MISMATCH,
      message: '邮箱地址与源文不一致。',
    })
  }
  const sourceUrls = urls(segment.source)
  if (sourceUrls.length > 0 && !sameMultiset(sourceUrls, urls(segment.target))) {
    emit({
      code: QA_RULE_CODES.URL_MISMATCH,
      message: 'URL 与源文不一致。',
    })
  }
  const sourceAlphanumeric = alphanumericTokens(segment.source)
  if (sourceAlphanumeric.length > 0 && !sameMultiset(sourceAlphanumeric, alphanumericTokens(segment.target))) {
    emit({
      code: QA_RULE_CODES.ALPHANUMERIC_MISMATCH,
      message: '字母数字令牌与源文不一致。',
    })
  }

  // 高噪声令牌 parity：照旧仓 opt-in 语义，默认关。
  if (options.checkUppercaseTokens === true
    && !sameMultiset(uppercaseTokens(segment.source), uppercaseTokens(segment.target))) {
    emit({
      code: QA_RULE_CODES.UPPERCASE_TOKEN_MISMATCH,
      message: '大写令牌集合与源文不一致。',
    })
  }
  if (options.checkCamelCaseTokens === true
    && !sameMultiset(camelCaseTokens(segment.source), camelCaseTokens(segment.target))) {
    emit({
      code: QA_RULE_CODES.CAMELCASE_TOKEN_MISMATCH,
      message: 'CamelCase 令牌集合与源文不一致。',
    })
  }

  // zh→en locale 感知泄漏检查（旧仓 delivery_qa.ts:318-328,378-388）。
  if (checksCjkLeakage(segment)) {
    if (hasCjk(segment.target)) {
      emit({
        code: QA_RULE_CODES.RESIDUAL_CJK,
        message: '译文仍包含 CJK 字符。',
      })
    }
    if (hasFullwidthPunctuation(segment.target)) {
      emit({
        code: QA_RULE_CODES.FULLWIDTH_PUNCTUATION,
        message: '译文包含中文/全角标点。',
      })
    }
  }

  // 术语表内部冲突（一词多译）：不可一刀切判定，必须 query。
  const conflicts = (options.glossaryConflicts ?? []).filter((conflict) =>
    conflict.sourceTerm.trim() !== ''
    && segment.source.normalize('NFKC').toLocaleLowerCase()
      .includes(conflict.sourceTerm.normalize('NFKC').toLocaleLowerCase()))
  if (conflicts.length > 0) {
    emit({
      code: QA_RULE_CODES.GLOSSARY_CONFLICT,
      message: `术语表存在一词多译冲突：${conflicts
        .map((conflict) => `${conflict.sourceTerm} → ${conflict.translations.join(' / ')}`)
        .join('；')}。`,
    })
  }

  const sourceLength = unicodeLength(segment.source.trim())
  const targetLength = unicodeLength(segment.target.trim())
  const minRatio = options.minTargetLengthRatio ?? (profile === 'subtitle' ? 0.2 : 0.4)
  const maxRatio = options.maxTargetLengthRatio ?? (profile === 'subtitle' ? 4.5 : 2.5)
  if (sourceLength >= 10 && (targetLength / sourceLength < minRatio || targetLength / sourceLength > maxRatio)) {
    emit({
      code: QA_RULE_CODES.TARGET_LENGTH_WARNING,
      message: `译文长度比例异常（${targetLength}/${sourceLength}）。`,
    })
  }
  return results
}

export function runQa(
  segments: readonly Segment[],
  options: QaRunOptions = {},
): OpenQaFindingInput[] {
  const ordered = [...segments].sort(compareSegments)
  const results = ordered.flatMap((segment) => segmentFindings(segment, options))
  const repeated = new Map<string, Segment[]>()
  const byTarget = new Map<string, Segment[]>()
  const byPosition = new Map(
    ordered.map((segment) => [`${segment.assetId}:${segment.ordinal}`, segment]),
  )
  for (const segment of ordered) {
    if (segment.locked || segment.source === '' || segment.target === '') continue
    const group = repeated.get(segment.source) ?? []
    group.push(segment)
    repeated.set(segment.source, group)
    // 异源同译（旧仓 mechanical_text_qa.ts:199-211 duplicated_target）。
    const targetKey = normalizeConsistency(segment.target)
    if (targetKey !== '') {
      const targetGroup = byTarget.get(targetKey) ?? []
      targetGroup.push(segment)
      byTarget.set(targetKey, targetGroup)
    }
  }
  for (const group of repeated.values()) {
    const sourceLength = unicodeLength(group[0]?.source.normalize('NFKC').trim() ?? '')
    const shortSourceLimit = options.shortRepeatedSourceMaxLength ?? 4
    const candidateGroups = sourceLength <= shortSourceLimit
      ? [...Map.groupBy(group, (segment) => {
          const previous = byPosition.get(`${segment.assetId}:${segment.ordinal - 1}`)
          const next = byPosition.get(`${segment.assetId}:${segment.ordinal + 1}`)
          return `${normalizeConsistency(previous?.source ?? '')}\u0000${normalizeConsistency(next?.source ?? '')}`
        }).values()]
      : [group]
    for (const candidateGroup of candidateGroups) {
      if (
        candidateGroup.length < 2
        || new Set(candidateGroup.map((segment) =>
          segment.target.normalize('NFKC').trim())).size < 2
      ) continue
      for (const segment of candidateGroup) {
        results.push(finding(segment, {
          code: QA_RULE_CODES.INCONSISTENT_REPEATED_SOURCE,
          message: '相同源文在相同相邻上下文中存在不一致译文。',
        }))
      }
    }
  }
  for (const group of byTarget.values()) {
    if (group.length < 2 || new Set(group.map((segment) => normalizeConsistency(segment.source))).size < 2) continue
    for (const segment of group) {
      results.push(finding(segment, {
        code: QA_RULE_CODES.TARGET_SOURCE_INCONSISTENCY,
        message: '不同源文使用了相同译文。',
      }))
    }
  }
  const ordinal = new Map(ordered.map((segment, index) => [segment.id, index]))
  return results.sort(
    (left, right) =>
      (ordinal.get(left.segmentId) ?? 0) - (ordinal.get(right.segmentId) ?? 0)
      || left.code.localeCompare(right.code),
  )
}
