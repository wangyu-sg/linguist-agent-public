/**
 * Tag 族注册表与匹配管线（PB-097）：正则 → span 集 → 规范化签名。
 *
 * 纯函数无 IO。设计移植旧仓 tag_tokens.ts 的「优先级 + overlap-claim
 * 单扫描」与 tag_rules_core.ts compileTagRule 的启发式 ReDoS lint：
 * - 项目族（tagProfile.families）按登记顺序排在所有内置族之前，先扫先
 *   占 span，重叠即跳过——项目族永远压内置族；
 * - 内置族全部为手工审过的线性正则；项目族正则在编译期过安全 lint
 *   （长度上限 / 嵌套量词拒绝 / 禁空串匹配），不过 lint 的族静默跳过，
 *   绝不让坏正则进热路径；
 * - 签名形态 `kind:familyId[:pairKey]:normalizedLiteral`，paired 族归一
 *   化开/闭（闭标签不带属性），singleton 带属性多重集（空值属性也进签
 *   名）——属性全量进签名，改属性值即守恒违规。
 *
 * ICU 归属：ICU span 由 hard-rules 的 icuSignature 单独校验（本管线不重
 * 复造 ICU 检查）；brace-named 族跳过 ICU span（分支体内 `{Rare}` 是分
 * 支文本不是占位符），brace-num 族不跳过——ICU 分支体内的 `{0}` 是真实
 * 数字占位符引用，由本管线单独验，不被 withoutSpans 抹掉后漏检。
 *
 * 未登记的 `[...]` / `{...}` 字面不锁定；「疑似但未登记」模式提示归后续
 * discovery 票，本管线不做。
 */

import type { LinguistTagProfile } from './tag-profile'

export interface TagSpan {
  start: number
  end: number
}

/** 族归类：决定守恒违规映射到哪个硬规则码（见 hard-rules.ts）。 */
export type TagTokenGroup = 'xml' | 'markup' | 'placeholder'

export type TagTokenKind = 'open' | 'close' | 'self' | 'singleton'

export interface TagToken {
  familyId: string
  group: TagTokenGroup
  kind: TagTokenKind
  /** paired 族的配对锚（开/闭同名归并）；singleton/self 为 null。 */
  pairKey: string | null
  signature: string
  start: number
  end: number
}

export interface TagScanOptions {
  /** 各侧自身的 ICU span（brace-named 族跳过；brace-num 族不跳过）。 */
  icuSpans?: readonly TagSpan[]
  /** 段 targetLocale，族 targetLocales 激活条件。 */
  targetLocale?: string
  /** 项目族登记表；缺省 = 仅内置族。 */
  profile?: LinguistTagProfile
}

/**
 * 启发式 ReDoS lint（移植旧仓 compileTagRule，tag_rules_core.ts:133-146）：
 * 长度上限 / 嵌套量词拒绝 / 禁空串匹配；编译失败或不过 lint 返回 null。
 * 扫描强制带 g（逐匹配推进 lastIndex 不回流）。
 */
export function compileTagFamilyRegex(pattern: string, flags?: string): RegExp | null {
  if (pattern.length > 240 || /\([^)]*[*+][^)]*\)\s*[*+{]/.test(pattern)) return null
  const rawFlags = flags ?? 'g'
  if (/[^dgimsuvy]/.test(rawFlags)) return null
  const merged = Array.from(new Set(`g${rawFlags}`.split(''))).join('')
  try {
    const regex = new RegExp(pattern, merged)
    if (new RegExp(pattern, merged.replace('g', '')).test('')) return null
    return regex
  } catch {
    return null
  }
}

// 通用属性抽取：name="v" / name='v' / name=v（v 到空白/>/] 为止）。
// 空值属性（S=""）同样进签名——属性多重集的一个元素。
const ATTRIBUTE_PATTERN = /([A-Za-z_][A-Za-z0-9_:-]*)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>[\]]+))/g

/**
 * 字面归一化：骨架（剥离属性后折叠空白、小写）+ 排序属性多重集
 * （属性名小写、值原样保留——`<color=#FFF>` 改成 `<color=#000>` 即变签
 * 名，属性守恒）。tag 内属性换序不误判（多重集排序）。
 */
function normalizeLiteral(literal: string): string {
  const attributes: string[] = []
  const skeleton = literal
    .replace(ATTRIBUTE_PATTERN, (_match, name: string, dq?: string, sq?: string, bare?: string) => {
      attributes.push(`${name.toLowerCase()}=${dq ?? sq ?? bare ?? ''}`)
      return ' '
    })
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
  attributes.sort()
  return attributes.length > 0 ? `${skeleton}|${attributes.join(',')}` : skeleton
}

interface CompiledFamily {
  id: string
  group: TagTokenGroup
  regex: RegExp
  skipIcuSpans: boolean
  targetLocales?: readonly string[]
  kindOf: (match: RegExpExecArray) => TagTokenKind
  pairKeyOf: (match: RegExpExecArray) => string | null
}

// 内置族（全部手工审过的线性正则）。数组顺序即扫描优先级。
// - xml：XML/HTML 形 <tag …>，配对校验锚 = tag 名小写；
// - bbcode：BBCode 全族（不限 color|size|b|i|u 五色——修旧仓漏族），
//   泛化后 [Energy1] 图标等同形字面也被锁定；
//   正则要 ASCII 字母开头，[月亮] / [527402p1q1/100] / [Grm:Qty …]
//   等不会被误吞（这些由项目族登记）；
// - brace-num / brace-named：{N} / {name} 占位符；
// - printf：printf 全族（含 %1$s 位置参数、%.2f 精度、%03d 填充、%%）；
// - escape：反斜杠转义 \n \r \t。
const BUILTIN_FAMILIES: readonly CompiledFamily[] = [
  {
    id: 'xml',
    group: 'xml',
    regex: /<\s*(?<close>\/)?\s*(?<name>[A-Za-z][A-Za-z0-9:_-]*)[^<>]*?(?<self>\/)?\s*>/g,
    skipIcuSpans: false,
    kindOf: (match) => (match.groups?.close ? 'close' : match.groups?.self ? 'self' : 'open'),
    pairKeyOf: (match) => match.groups?.name?.toLowerCase() ?? null,
  },
  {
    id: 'bbcode',
    group: 'markup',
    regex: /\[(?<close>\/)?(?<name>[A-Za-z][A-Za-z0-9]*)(?:=[^[\]]*)?\]/g,
    skipIcuSpans: false,
    kindOf: (match) => (match.groups?.close ? 'close' : 'open'),
    pairKeyOf: (match) => match.groups?.name?.toLowerCase() ?? null,
  },
  {
    id: 'brace-num',
    group: 'placeholder',
    regex: /\{\d+\}/g,
    // 不跳过 ICU span：分支体内的 {0} 是真实占位符引用，必须守恒。
    skipIcuSpans: false,
    kindOf: () => 'singleton',
    pairKeyOf: () => null,
  },
  {
    id: 'brace-named',
    group: 'placeholder',
    regex: /\{[A-Za-z_][A-Za-z0-9_]*\}/g,
    // 跳过 ICU span：分支体内 {Rare} 是分支文本，误判为占位符会误报。
    skipIcuSpans: true,
    kindOf: () => 'singleton',
    pairKeyOf: () => null,
  },
  {
    id: 'printf',
    group: 'placeholder',
    // flags 刻意不含空格：避免散文 "100% sure" 的 "% s" 误命中。
    regex: /%(?:\d+\$)?[-+0#]*(?:\d+|\*)?(?:\.\d+)?[hlLjzt]*[diuoxXfFeEgGaAcspn%]/g,
    skipIcuSpans: false,
    kindOf: () => 'singleton',
    pairKeyOf: () => null,
  },
  {
    id: 'escape',
    group: 'placeholder',
    regex: /\\[nrt]/g,
    skipIcuSpans: false,
    kindOf: () => 'singleton',
    pairKeyOf: () => null,
  },
]

// 项目族编译结果按 pattern+flags memoize（热路径不重复编译；
// 扫描前重置 lastIndex，共享 RegExp 对象安全——扫描同步、JS 单线程）。
const projectRegexCache = new Map<string, RegExp | null>()

function compileProjectRegex(pattern: string, flags?: string): RegExp | null {
  const key = `${pattern} ${flags ?? ''}`
  const cached = projectRegexCache.get(key)
  if (cached !== undefined) return cached
  const compiled = compileTagFamilyRegex(pattern, flags)
  projectRegexCache.set(key, compiled)
  return compiled
}

function compileProjectFamilies(profile?: LinguistTagProfile): CompiledFamily[] {
  if (profile === undefined) return []
  const families: CompiledFamily[] = []
  for (const family of profile.families) {
    const regex = compileProjectRegex(family.pattern, family.flags)
    if (regex === null) continue
    const pairKey = family.pairWith ?? family.id
    families.push({
      id: family.id,
      group: 'markup',
      regex,
      skipIcuSpans: false,
      ...(family.targetLocales !== undefined ? { targetLocales: family.targetLocales } : {}),
      kindOf: (match) =>
        family.class === 'paired' ? (match.groups?.close ? 'close' : 'open') : 'singleton',
      pairKeyOf: () => (family.class === 'paired' ? pairKey : null),
    })
  }
  return families
}

/** locale 命中：全串或 base 相等（忽略大小写），`ru` 命中 `ru-RU`。 */
function localeMatches(entry: string, targetLocale: string): boolean {
  const normalize = (value: string) => value.trim().toLowerCase()
  const full = normalize(targetLocale)
  const wanted = normalize(entry)
  return full === wanted || full.split('-', 1)[0] === wanted.split('-', 1)[0]
}

function familyActive(family: CompiledFamily, targetLocale?: string): boolean {
  if (family.targetLocales === undefined || family.targetLocales.length === 0) return true
  if (targetLocale === undefined) return true
  return family.targetLocales.some((entry) => localeMatches(entry, targetLocale))
}

function inSpans(start: number, spans: readonly TagSpan[]): boolean {
  return spans.some((span) => start >= span.start && start < span.end)
}

function overlaps(claimed: readonly TagSpan[], start: number, end: number): boolean {
  return claimed.some((range) => !(end <= range.start || start >= range.end))
}

/**
 * 单扫描解析文本中的全部 tag token：项目族在前、内置族在后，先扫先
 * 占 span，重叠跳过。返回按位置排序的 token 序列。
 */
export function scanTagTokens(text: string, options: TagScanOptions = {}): TagToken[] {
  if (!text) return []
  const icuSpans = options.icuSpans ?? []
  const claimed: TagSpan[] = []
  const tokens: TagToken[] = []
  for (const family of [...compileProjectFamilies(options.profile), ...BUILTIN_FAMILIES]) {
    if (!familyActive(family, options.targetLocale)) continue
    family.regex.lastIndex = 0
    let match: RegExpExecArray | null
    while ((match = family.regex.exec(text)) !== null) {
      const literal = match[0]
      if (!literal) {
        family.regex.lastIndex += 1
        continue
      }
      const start = match.index
      const end = start + literal.length
      if (overlaps(claimed, start, end)) continue
      if (family.skipIcuSpans && inSpans(start, icuSpans)) continue
      claimed.push({ start, end })
      const kind = family.kindOf(match)
      const pairKey = family.pairKeyOf(match)
      // paired 归一化开/闭：闭标签不带属性；开标签带属性多重集。
      const signature =
        kind === 'close'
          ? `close:${family.id}:${pairKey ?? ''}`
          : `${kind}:${family.id}:${normalizeLiteral(literal)}`
      tokens.push({ familyId: family.id, group: family.group, kind, pairKey, signature, start, end })
    }
  }
  return tokens.sort((left, right) => left.start - right.start)
}

/** 指定归类的签名多重集（排序后逐位比较 = 多重集比较，不比顺序）。 */
export function tagGroupSignature(tokens: readonly TagToken[], group: TagTokenGroup): string[] {
  return tokens.filter((token) => token.group === group).map((token) => token.signature).sort()
}

/**
 * 成对 tag 栈算法：验开闭配平 + 嵌套合法。交叉嵌套（`<b><i></b></i>`）
 * 判 invalid——守恒多重集相等不代表嵌套合法。返回人类可读错误串列表，
 * 空数组 = 配平且嵌套合法。
 */
export function pairingErrors(tokens: readonly TagToken[]): string[] {
  const stack: Array<{ pairKey: string; familyId: string }> = []
  const errors: string[] = []
  for (const token of tokens) {
    if (token.kind === 'open' && token.pairKey !== null) {
      stack.push({ pairKey: token.pairKey, familyId: token.familyId })
      continue
    }
    if (token.kind !== 'close' || token.pairKey === null) continue
    const top = stack.at(-1)
    if (top?.pairKey === token.pairKey && top.familyId === token.familyId) {
      stack.pop()
      continue
    }
    const nested = stack.findIndex(
      (entry) => entry.pairKey === token.pairKey && entry.familyId === token.familyId,
    )
    if (nested >= 0) {
      // 交叉嵌套：弹到匹配处，每个被跨过的开标签记一笔。
      while (stack.length > nested + 1) {
        const crossed = stack.pop()!
        errors.push(`crossed:${crossed.familyId}:${crossed.pairKey}`)
      }
      stack.pop()
      continue
    }
    errors.push(`stray-close:${token.familyId}:${token.pairKey}`)
  }
  for (const entry of stack) {
    errors.push(`unclosed:${entry.familyId}:${entry.pairKey}`)
  }
  return errors
}
