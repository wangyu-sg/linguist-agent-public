import type { LinguistPluralAttributeGrammar, LinguistTagProfile } from './tag-profile'
import { localeMatches, type TagToken } from './tag-families'

/** 有界属性语法：方括号名称 + 双引号属性；不运行项目代码或推断标签编号映射。 */
function pluralArgument(literal: string, grammar: LinguistPluralAttributeGrammar): string | undefined {
  const head = /^\[[A-Za-z_][A-Za-z0-9_:-]*/.exec(literal)
  if (head?.[0] !== `[${grammar.tagName}` || !literal.endsWith(']')) return undefined
  const attributes = new Map<string, string>()
  const pattern = /\s+([A-Za-z_][A-Za-z0-9_]*)\s*=\s*"([^"\r\n]*)"/y
  let offset = head[0].length
  while (offset < literal.length - 1) {
    if (literal.slice(offset, -1).trim() === '') break
    pattern.lastIndex = offset
    const match = pattern.exec(literal)
    if (match === null || attributes.has(match[1]!)) return undefined
    attributes.set(match[1]!, match[2]!)
    offset = pattern.lastIndex
  }
  const expected = [...grammar.formAttributes, grammar.argumentAttribute]
  if (attributes.size !== expected.length || expected.some(name => !attributes.has(name))) return undefined
  if (grammar.formAttributes.some(name => /[\[\]{}<>\\]/.test(attributes.get(name)!))) return undefined
  const argument = attributes.get(grammar.argumentAttribute)!
  return /^(?:[0-9]+|[A-Za-z_][A-Za-z0-9_]*)$/.test(argument) ? argument : undefined
}

/** 只豁免已登记且通过纯解析/引用核验的 grammar token；其余仍走原守恒规则。 */
export function projectGrammarTokens(
  source: string,
  target: string,
  sourceTokens: readonly TagToken[],
  targetTokens: readonly TagToken[],
  targetLocale: string,
  profile?: LinguistTagProfile,
): { source: ReadonlySet<TagToken>; target: ReadonlySet<TagToken>; errors: string[] } {
  const sourceAccepted = new Set<TagToken>()
  const targetAccepted = new Set<TagToken>()
  const errors: string[] = []
  const sourceBindings = new Map<string, number>()
  const targetBindings = new Map<string, number>()
  const declared = new Set(Array.from(source.matchAll(/\{([0-9]+|[A-Za-z_][A-Za-z0-9_]*)\}/g), match => match[1]!))
  const grammars = new Map((profile?.families ?? [])
    .filter(family => family.enabled !== false && family.class === 'singleton' && family.grammar !== undefined
      && family.targetLocales?.some(locale => localeMatches(locale, targetLocale)))
    .map(family => [family.id, family.grammar!]))
  for (const token of sourceTokens) {
    const grammar = grammars.get(token.familyId)
    if (grammar === undefined) continue
    const argument = pluralArgument(source.slice(token.start, token.end), grammar)
    if (argument !== undefined) {
      declared.add(argument)
      const binding = `${token.familyId}:${argument}`
      sourceBindings.set(binding, (sourceBindings.get(binding) ?? 0) + 1)
      sourceAccepted.add(token)
    }
  }
  for (const token of targetTokens) {
    const grammar = grammars.get(token.familyId)
    if (grammar === undefined) continue
    const argument = pluralArgument(target.slice(token.start, token.end), grammar)
    if (argument === undefined || !declared.has(argument)) errors.push(`invalid-plural:${token.familyId}@${token.start}`)
    else {
      targetAccepted.add(token)
      const binding = `${token.familyId}:${argument}`
      targetBindings.set(binding, (targetBindings.get(binding) ?? 0) + 1)
    }
  }
  for (const [binding, count] of sourceBindings) {
    if ((targetBindings.get(binding) ?? 0) < count) errors.push(`missing-plural-binding:${binding}`)
  }
  // regex 可能无法认领缺失右括号的标记；显式名称确保坏语法不能退化为普通文本。
  for (const [familyId, grammar] of grammars) {
    const prefix = `[${grammar.tagName}`
    let start = target.indexOf(prefix)
    while (start >= 0) {
      const next = target[start + prefix.length]
      if ((next === undefined || /[\s\]]/.test(next)) && !targetTokens.some(token => token.familyId === familyId && token.start === start && targetAccepted.has(token))) {
        errors.push(`invalid-plural:${familyId}@${start}`)
      }
      start = target.indexOf(prefix, start + prefix.length)
    }
  }
  return { source: sourceAccepted, target: targetAccepted, errors: [...new Set(errors)] }
}
