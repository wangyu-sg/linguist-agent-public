/**
 * PB-052 Proposal 写入前的纯确定性硬门。
 *
 * Adapted and simplified from legacy format_signatures.ts, qa_write_gate.ts,
 * number_qa.ts, and delivery_qa.ts. This module has no IO and no waivers:
 * Agent explanations cannot turn a violation into a pass.
 */

import {
  TYPE,
  parse,
  type DateElement,
  type MessageFormatElement,
  type NumberElement,
  type TimeElement,
} from '@formatjs/icu-messageformat-parser'
import type { Segment } from './segment'
import {
  pairingErrors,
  scanTagTokens,
  tagGroupSignature,
  type TagTokenGroup,
} from './tag-families'
import type { LinguistTagProfile } from './tag-profile'

export const DETERMINISTIC_HARD_RULE_CODES = {
  LOCKED_SEGMENT: 'LOCKED_SEGMENT',
  EMPTY_TARGET: 'EMPTY_TARGET',
  INVALID_TARGET_ENCODING: 'INVALID_TARGET_ENCODING',
  PLACEHOLDER_SIGNATURE_MISMATCH: 'PLACEHOLDER_SIGNATURE_MISMATCH',
  TAG_SIGNATURE_MISMATCH: 'TAG_SIGNATURE_MISMATCH',
  // PB-097 tag 族引擎：占位符族守恒 / 富文本族守恒 / 成对配平与嵌套
  TAG_PLACEHOLDER_FAMILY_MISMATCH: 'TAG_PLACEHOLDER_FAMILY_MISMATCH',
  TAG_FAMILY_MISMATCH: 'TAG_FAMILY_MISMATCH',
  TAG_PAIRING_MISMATCH: 'TAG_PAIRING_MISMATCH',
  ICU_SYNTAX_INVALID: 'ICU_SYNTAX_INVALID',
  ICU_SIGNATURE_MISMATCH: 'ICU_SIGNATURE_MISMATCH',
  NEWLINE_SIGNATURE_MISMATCH: 'NEWLINE_SIGNATURE_MISMATCH',
  REQUIRED_TERMINOLOGY_MISSING: 'REQUIRED_TERMINOLOGY_MISSING',
  FORBIDDEN_TERM_PRESENT: 'FORBIDDEN_TERM_PRESENT',
  NUMBER_SIGNATURE_MISMATCH: 'NUMBER_SIGNATURE_MISMATCH',
  TOKEN_SIGNATURE_MISMATCH: 'TOKEN_SIGNATURE_MISMATCH',
} as const

export type DeterministicHardRuleCode =
  (typeof DETERMINISTIC_HARD_RULE_CODES)[keyof typeof DETERMINISTIC_HARD_RULE_CODES]

export interface RequiredTerminologyRule {
  sourceTerm: string
  targetTerm: string
  caseSensitive?: boolean
}

export interface ForbiddenTermRule {
  /** When present, the target ban applies only if the source contains this term. */
  sourceTerm?: string
  term: string
  caseSensitive?: boolean
}

export interface DeterministicHardRuleInput {
  segment: Pick<Segment, 'id' | 'source' | 'locked' | 'targetLocale'>
  proposedTarget: string
  requiredTerminology?: readonly RequiredTerminologyRule[]
  forbiddenTerms?: readonly (ForbiddenTermRule | string)[]
  /** PB-097：项目 tag 族登记表；缺省 = 仅内置族（PB-052 既有行为）。 */
  tagProfile?: LinguistTagProfile
}

export interface DeterministicHardRuleViolation {
  code: DeterministicHardRuleCode
  message: string
  expected?: readonly string[] | number | boolean
  actual?: readonly string[] | number | boolean
}

export interface DeterministicHardRuleResult {
  ok: boolean
  violations: DeterministicHardRuleViolation[]
}

interface Span {
  start: number
  end: number
}

function matchingBrace(value: string, openIndex: number): number {
  let depth = 0
  for (let index = openIndex; index < value.length; index += 1) {
    if (value[index] === '{') depth += 1
    if (value[index] === '}') {
      depth -= 1
      if (depth === 0) return index
    }
  }
  return -1
}

function splitTopLevel(value: string, delimiter: string, limit: number): string[] {
  const parts: string[] = []
  let depth = 0
  let start = 0
  for (let index = 0; index < value.length; index += 1) {
    if (value[index] === '{') depth += 1
    if (value[index] === '}') depth = Math.max(0, depth - 1)
    if (value[index] === delimiter && depth === 0 && parts.length < limit - 1) {
      parts.push(value.slice(start, index).trim())
      start = index + 1
    }
  }
  parts.push(value.slice(start).trim())
  return parts
}

function branchRows(body: string): Array<{ key: string; value: string }> {
  const rows: Array<{ key: string; value: string }> = []
  let index = 0
  while (index < body.length) {
    while (/\s/.test(body[index] ?? '')) index += 1
    const start = index
    while (index < body.length && !/[\s{]/.test(body[index] ?? '')) index += 1
    const key = body.slice(start, index).trim().toLowerCase()
    while (/\s/.test(body[index] ?? '')) index += 1
    if (!key || body[index] !== '{') {
      index += 1
      continue
    }
    const close = matchingBrace(body, index)
    if (close < 0) break
    rows.push({ key, value: body.slice(index + 1, close) })
    index = close + 1
  }
  return rows.sort((left, right) => left.key.localeCompare(right.key))
}

function legacyIcuSignature(value: string): { signature: string[]; spans: Span[] } {
  const signature: string[] = []
  const spans: Span[] = []
  for (let index = 0; index < value.length; index += 1) {
    if (value[index] !== '{') continue
    const close = matchingBrace(value, index)
    if (close < 0) continue
    const content = value.slice(index + 1, close)
    const [argument, rawType, body] = splitTopLevel(content, ',', 3)
    const type = rawType?.toLowerCase()
    if (argument && body && (type === 'plural' || type === 'select' || type === 'selectordinal')) {
      const branches = branchRows(body)
      signature.push(`${argument}:${type}:${branches.map((branch) => branch.key).join('|')}`)
      for (const branch of branches) {
        signature.push(
          ...legacyIcuSignature(branch.value).signature.map(
            (nested) => `${argument}/${branch.key}/${nested}`,
          ),
        )
      }
      spans.push({ start: index, end: close + 1 })
      index = close
      continue
    }
    const colon = content.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*:(.*)$/s)
    if (colon) {
      const choices = splitTopLevel(colon[2]!, '|', Number.MAX_SAFE_INTEGER)
      signature.push(`${colon[1]}:choice:${choices.length}`)
      spans.push({ start: index, end: close + 1 })
      index = close
    }
  }
  return { signature: signature.sort(), spans }
}

interface IcuSignature {
  signature: string[]
  spans: Span[]
  syntaxError?: string
  standard: boolean
}

function hasStandardIcu(value: string): boolean {
  return /\{[^{}]+,\s*(?:plural|select|selectordinal|number|date|time)\b/iu.test(value)
}

function styleSignature(
  style: NumberElement['style'] | DateElement['style'] | TimeElement['style'],
): string {
  if (style === undefined || style === null) return ''
  if (typeof style === 'string') return style.trim()
  if ('tokens' in style) {
    return style.tokens
      .map((token) => `${token.stem}/${token.options.join('/')}`)
      .join('|')
  }
  return style.pattern
}

function astSignature(
  elements: readonly MessageFormatElement[],
  path = 'icu',
  nested = false,
): string[] {
  const signature: string[] = []
  for (const element of elements) {
    if (element.type === TYPE.argument) {
      if (nested) signature.push(`${path}:argument:${element.value}`)
      continue
    }
    if (
      element.type === TYPE.number
      || element.type === TYPE.date
      || element.type === TYPE.time
    ) {
      signature.push(`${path}:${TYPE[element.type]}:${element.value}:${styleSignature(element.style)}`)
      continue
    }
    if (element.type === TYPE.select) {
      const keys = Object.keys(element.options).sort()
      signature.push(`${path}:select:${element.value}:${keys.join('|')}`)
      for (const key of keys) {
        signature.push(...astSignature(element.options[key]!.value, `${path}/${element.value}/${key}`, true))
      }
      continue
    }
    if (element.type === TYPE.plural) {
      const keys = Object.keys(element.options).sort()
      signature.push(
        `${path}:plural:${element.value}:${element.pluralType}:offset:${element.offset}:${keys.join('|')}`,
      )
      for (const key of keys) {
        signature.push(...astSignature(element.options[key]!.value, `${path}/${element.value}/${key}`, true))
      }
      continue
    }
    if (element.type === TYPE.pound) {
      if (nested) signature.push(`${path}:pound`)
      continue
    }
    if (element.type === TYPE.tag) {
      signature.push(...astSignature(element.children, `${path}/tag:${element.value}`, nested))
    }
  }
  return signature
}

function standardIcuSignature(value: string): IcuSignature {
  try {
    const ast = parse(value, {
      ignoreTag: true,
      requiresOtherClause: true,
      shouldParseSkeletons: true,
      captureLocation: true,
    })
    const spans = ast.flatMap((element): Span[] => {
      if (
        element.type !== TYPE.number
        && element.type !== TYPE.date
        && element.type !== TYPE.time
        && element.type !== TYPE.select
        && element.type !== TYPE.plural
      ) return []
      const location = element.location
      return location === undefined
        ? []
        : [{ start: location.start.offset, end: location.end.offset }]
    })
    return { signature: astSignature(ast).sort(), spans, standard: true }
  } catch (error) {
    const fallback = legacyIcuSignature(value)
    return {
      ...fallback,
      syntaxError: error instanceof Error ? error.message : 'invalid ICU message',
      standard: false,
    }
  }
}

function icuSignature(value: string, forceStandard = false): IcuSignature {
  if (forceStandard || hasStandardIcu(value)) return standardIcuSignature(value)
  return { ...legacyIcuSignature(value), standard: false }
}

function withoutSpans(value: string, spans: readonly Span[]): string {
  if (spans.length === 0) return value
  let result = ''
  let cursor = 0
  for (const span of [...spans].sort((left, right) => left.start - right.start)) {
    result += value.slice(cursor, span.start)
    cursor = Math.max(cursor, span.end)
  }
  return result + value.slice(cursor)
}

function placeholderSignature(value: string, icuSpans: readonly Span[]): string[] {
  const structural = withoutSpans(value, icuSpans)
  return Array.from(
    structural.matchAll(/\{\{[^{}]+\}\}|\$\{[^{}]+\}|%\d*\$?[a-zA-Z]|\{[^{}]+\}/g),
    (match) => match[0],
  ).sort()
}

// PB-097：XML/tag 签名由 tag-families.ts 族管线单源产出（属性全量进签
// 名，修旧仓只留 id 类属性的守恒缺口；签名排序后比较 = 多重集比较，
// tag 调序合法——用户拍板 2026-07-27）。

function newlineSignature(value: string): string[] {
  return [
    `hard:${(value.match(/\r\n|\r|\n/g) ?? []).length}`,
    `literal:${(value.match(/\\n/g) ?? []).length}`,
  ]
}

const ENGLISH_MONTH_NUMBERS: Readonly<Record<string, string>> = {
  january: '1', february: '2', march: '3', april: '4', may: '5', june: '6',
  july: '7', august: '8', september: '9', october: '10', november: '11', december: '12',
}

const ENGLISH_ORDINAL_NUMBERS: Readonly<Record<string, string>> = {
  first: '1',
  second: '2',
  third: '3',
  fourth: '4',
  fifth: '5',
  sixth: '6',
  seventh: '7',
  eighth: '8',
  ninth: '9',
  tenth: '10',
  eleventh: '11',
  twelfth: '12',
  thirteenth: '13',
  fourteenth: '14',
  fifteenth: '15',
  sixteenth: '16',
  seventeenth: '17',
  eighteenth: '18',
  nineteenth: '19',
  twentieth: '20',
}

const CHINESE_DIGITS: Readonly<Record<string, number>> = {
  零: 0,
  〇: 0,
  一: 1,
  二: 2,
  两: 2,
  三: 3,
  四: 4,
  五: 5,
  六: 6,
  七: 7,
  八: 8,
  九: 9,
}

const CHINESE_NUMBER_UNITS: Readonly<Record<string, number>> = {
  十: 10,
  百: 100,
  千: 1_000,
  万: 10_000,
  亿: 100_000_000,
}

function canonicalChineseNumber(value: string): string {
  if (![...value].some((char) => CHINESE_NUMBER_UNITS[char] !== undefined)) {
    return String(Number([...value].map((char) => CHINESE_DIGITS[char]).join('')))
  }
  let total = 0
  let section = 0
  let digit = 0
  for (const char of value) {
    const nextDigit = CHINESE_DIGITS[char]
    if (nextDigit !== undefined) {
      digit = nextDigit
      continue
    }
    const unit = CHINESE_NUMBER_UNITS[char]
    if (unit === undefined) continue
    if (unit < 10_000) {
      section += (digit || 1) * unit
    } else {
      section += digit
      total += section * unit
      section = 0
    }
    digit = 0
  }
  return String(total + section + digit)
}

/**
 * 只在明确数字语境中转换中文数词，避免把“一会儿 / 一样”等普通词误当
 * 作数字。带十百千万亿的数词本身可判定为数值；单个数字需有序号或量词。
 */
function canonicalizeChineseNumberContexts(value: string): string {
  const numberChars = '零〇一二两三四五六七八九十百千万亿'
  const convert = (_match: string, raw: string): string => canonicalChineseNumber(raw)
  return value
    .replace(new RegExp(`第([${numberChars}]+)`, 'gu'), (_match, raw: string) =>
      `第${canonicalChineseNumber(raw)}`)
    .replace(
      new RegExp(
        `([${numberChars}]+)(?=号|月份?|日|年|小时|分钟|秒|点(?:钟|整|半)|层|章|集|话|次|岁|公里|米|元|%)`,
        'gu',
      ),
      convert,
    )
    .replace(
      new RegExp(
        `(^|[^\\p{Script=Han}])([${numberChars}]*[十百千万亿][${numberChars}]*)(?=$|[^\\p{Script=Han}])`,
        'gu',
      ),
      (_match, prefix: string, raw: string) => `${prefix}${canonicalChineseNumber(raw)}`,
    )
}

function canonicalNumber(value: string): string {
  let normalized = value
  if (/^\d{1,3}(?:,\d{3})+$/.test(normalized)) normalized = normalized.replace(/,/g, '')
  else if (/^\d+,\d{1,2}$/.test(normalized)) normalized = normalized.replace(',', '.')
  const [integer, fraction] = normalized.split('.')
  const normalizedInteger = integer!.replace(/^0+(?=\d)/, '')
  if (fraction === undefined) return normalizedInteger
  const normalizedFraction = fraction.replace(/0+$/, '')
  return normalizedFraction ? `${normalizedInteger}.${normalizedFraction}` : normalizedInteger
}

function numberSignature(value: string, icuSpans: readonly Span[]): string[] {
  const normalized = canonicalizeChineseNumberContexts(withoutSpans(value, icuSpans))
    .replace(/\{\d+\}/g, '')
    .replace(
      /\b(?:first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth|eleventh|twelfth|thirteenth|fourteenth|fifteenth|sixteenth|seventeenth|eighteenth|nineteenth|twentieth)\b/gi,
      (match) => ENGLISH_ORDINAL_NUMBERS[match.toLowerCase()] ?? match,
    )
    .replace(
      /\b(?:january|february|march|april|may|june|july|august|september|october|november|december)\b/gi,
      (month) => ENGLISH_MONTH_NUMBERS[month.toLowerCase()] ?? month,
    )
    .replace(/(\d{1,2})\s*[点時时]\s*00\s*分/g, '$1')
    .replace(/\b(\d{1,2}):00\b/g, '$1')
  return Array.from(normalized.matchAll(/\d+(?:[.,]\d+)*/g), (match) => canonicalNumber(match[0]))
    .sort((left, right) => left.localeCompare(right, 'en', { numeric: true }))
}

function tokenSignature(value: string, icuSpans: readonly Span[]): string[] {
  return (
    withoutSpans(value, icuSpans)
      .match(/[A-Za-z]+[A-Za-z0-9_-]*\d+[A-Za-z0-9_-]*|\d+[A-Za-z][A-Za-z0-9_-]*/g)
    ?? []
  ).sort()
}

function same(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index])
}

function normalizedIncludes(haystack: string, needle: string, caseSensitive = false): boolean {
  const normalizedHaystack = haystack.normalize('NFKC')
  const normalizedNeedle = needle.normalize('NFKC')
  return caseSensitive
    ? normalizedHaystack.includes(normalizedNeedle)
    : normalizedHaystack.toLocaleLowerCase().includes(normalizedNeedle.toLocaleLowerCase())
}

function mismatch(
  code: DeterministicHardRuleCode,
  message: string,
  expected: readonly string[],
  actual: readonly string[],
): DeterministicHardRuleViolation | undefined {
  return same(expected, actual) ? undefined : { code, message, expected, actual }
}

function hasInvalidTargetEncoding(value: string): boolean {
  if (value.includes('\u0000')) return true
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index)
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1)
      if (index + 1 >= value.length || next < 0xdc00 || next > 0xdfff) return true
      index += 1
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      return true
    }
  }
  return false
}

export function runDeterministicHardRules(input: DeterministicHardRuleInput): DeterministicHardRuleResult {
  const { segment, proposedTarget } = input
  const sourceIcu = icuSignature(segment.source)
  const targetIcu = icuSignature(proposedTarget, sourceIcu.standard)
  // PB-097 tag 族管线：各侧用自身 ICU span（brace-named 跳过 ICU 分支体，
  // brace-num 不跳过——ICU 内 {0} 是真实占位符，单独验不漏检）。
  const sourceTags = scanTagTokens(segment.source, {
    icuSpans: sourceIcu.spans,
    targetLocale: segment.targetLocale,
    ...(input.tagProfile !== undefined ? { profile: input.tagProfile } : {}),
  })
  const targetTags = scanTagTokens(proposedTarget, {
    icuSpans: targetIcu.spans,
    targetLocale: segment.targetLocale,
    ...(input.tagProfile !== undefined ? { profile: input.tagProfile } : {}),
  })
  const sourcePlaceholders = placeholderSignature(segment.source, sourceIcu.spans)
  const targetPlaceholders = placeholderSignature(proposedTarget, targetIcu.spans)
  // 成对配平/嵌套校验：源为事实基准——源本身不配平时跳过目标配对校验
  // （照抄源文不该被拦），守恒多重集兜底。
  const sourcePairErrors = pairingErrors(sourceTags)
  const targetPairErrors = pairingErrors(targetTags)
  const tagFamilyMismatch = (
    group: TagTokenGroup,
    code: DeterministicHardRuleCode,
    message: string,
  ): DeterministicHardRuleViolation | undefined =>
    mismatch(code, message, tagGroupSignature(sourceTags, group), tagGroupSignature(targetTags, group))
  const candidates: Array<DeterministicHardRuleViolation | undefined> = [
    segment.locked
      ? {
          code: DETERMINISTIC_HARD_RULE_CODES.LOCKED_SEGMENT,
          message: `Segment ${segment.id} is locked.`,
          expected: false,
          actual: true,
        }
      : undefined,
    segment.source.trim() !== '' && proposedTarget.trim() === ''
      ? {
          code: DETERMINISTIC_HARD_RULE_CODES.EMPTY_TARGET,
          message: 'Target must not be empty when source has content.',
          expected: false,
          actual: true,
        }
      : undefined,
    hasInvalidTargetEncoding(proposedTarget)
      ? {
          code: DETERMINISTIC_HARD_RULE_CODES.INVALID_TARGET_ENCODING,
          message: 'Target contains NUL or an unpaired UTF-16 surrogate.',
          expected: false,
          actual: true,
        }
      : undefined,
    mismatch(
      DETERMINISTIC_HARD_RULE_CODES.PLACEHOLDER_SIGNATURE_MISMATCH,
      'Placeholder signature differs between source and target.',
      sourcePlaceholders,
      targetPlaceholders,
    ),
    // 占位符族（printf 全族/{N}/{name}/转义）与既有宽松签名互补：既有签
    // 名已报时不重复报族码，族码只抓增量差异（如 %.2f、%%、\t）。
    same(sourcePlaceholders, targetPlaceholders)
      ? tagFamilyMismatch(
          'placeholder',
          DETERMINISTIC_HARD_RULE_CODES.TAG_PLACEHOLDER_FAMILY_MISMATCH,
          'Placeholder tag family signature differs between source and target.',
        )
      : undefined,
    tagFamilyMismatch(
      'xml',
      DETERMINISTIC_HARD_RULE_CODES.TAG_SIGNATURE_MISMATCH,
      'XML/format tag signature differs between source and target.',
    ),
    tagFamilyMismatch(
      'markup',
      DETERMINISTIC_HARD_RULE_CODES.TAG_FAMILY_MISMATCH,
      'Rich-text/project tag family signature differs between source and target.',
    ),
    sourcePairErrors.length === 0 && targetPairErrors.length > 0
      ? {
          code: DETERMINISTIC_HARD_RULE_CODES.TAG_PAIRING_MISMATCH,
          message: 'Paired tags are unbalanced or illegally nested in target.',
          expected: [],
          actual: targetPairErrors,
        }
      : undefined,
    targetIcu.syntaxError !== undefined
      ? {
          code: DETERMINISTIC_HARD_RULE_CODES.ICU_SYNTAX_INVALID,
          message: `Target ICU message is invalid: ${targetIcu.syntaxError}.`,
          expected: true,
          actual: false,
        }
      : undefined,
    mismatch(
      DETERMINISTIC_HARD_RULE_CODES.ICU_SIGNATURE_MISMATCH,
      'ICU branch signature differs between source and target.',
      sourceIcu.signature,
      targetIcu.signature,
    ),
    mismatch(
      DETERMINISTIC_HARD_RULE_CODES.NEWLINE_SIGNATURE_MISMATCH,
      'Newline signature differs between source and target.',
      newlineSignature(segment.source),
      newlineSignature(proposedTarget),
    ),
    mismatch(
      DETERMINISTIC_HARD_RULE_CODES.NUMBER_SIGNATURE_MISMATCH,
      'Number signature differs between source and target.',
      numberSignature(segment.source, sourceIcu.spans),
      numberSignature(proposedTarget, targetIcu.spans),
    ),
    mismatch(
      DETERMINISTIC_HARD_RULE_CODES.TOKEN_SIGNATURE_MISMATCH,
      'Alphanumeric token signature differs between source and target.',
      tokenSignature(segment.source, sourceIcu.spans),
      tokenSignature(proposedTarget, targetIcu.spans),
    ),
  ]

  for (const rule of input.requiredTerminology ?? []) {
    if (
      rule.sourceTerm.trim()
      && rule.targetTerm.trim()
      && normalizedIncludes(segment.source, rule.sourceTerm, rule.caseSensitive)
      && !normalizedIncludes(proposedTarget, rule.targetTerm, rule.caseSensitive)
    ) {
      candidates.push({
        code: DETERMINISTIC_HARD_RULE_CODES.REQUIRED_TERMINOLOGY_MISSING,
        message: `Required terminology is missing: ${rule.targetTerm}.`,
        expected: [rule.targetTerm],
        actual: [],
      })
    }
  }
  for (const rawRule of input.forbiddenTerms ?? []) {
    const rule = typeof rawRule === 'string' ? { term: rawRule } : rawRule
    const sourceMatches = rule.sourceTerm === undefined
      || (
        rule.sourceTerm.trim().length > 0
        && normalizedIncludes(segment.source, rule.sourceTerm, rule.caseSensitive)
      )
    if (
      sourceMatches
      && rule.term.trim()
      && normalizedIncludes(proposedTarget, rule.term, rule.caseSensitive)
    ) {
      candidates.push({
        code: DETERMINISTIC_HARD_RULE_CODES.FORBIDDEN_TERM_PRESENT,
        message: `Forbidden term is present: ${rule.term}.`,
        expected: [],
        actual: [rule.term],
      })
    }
  }

  const violations = candidates.filter(
    (violation): violation is DeterministicHardRuleViolation => violation !== undefined,
  )
  return { ok: violations.length === 0, violations }
}
