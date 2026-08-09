import { fnv1a64 } from './ids'
import { compileTagFamilyRegex, scanTags } from './tag-families'
import type {
  LinguistTagCandidateKind,
  LinguistTagFamily,
  LinguistTagProfile,
  LinguistTagProfileCandidate,
} from './tag-profile'

export interface UnknownTagSample {
  id: string
  source: string
  target: string
}

export interface UnknownTagExample {
  id: string
  segmentId: string
  side: 'source' | 'target'
  value: string
}

export interface UnknownTagPatternResult {
  patternShape: string
  examples: UnknownTagExample[]
  frequency: number
  sourceTargetPreservation: {
    exactValueRate: number
    shapeRate: number
    countRate: number
  }
  pairingEvidence: { opening: number; closing: number; balanced: boolean; pairKeys: string[] }
  suggestedVariableParts: string[]
}

export interface SaveTagProfileCandidateInput {
  name: string
  regex: string
  kind: LinguistTagCandidateKind
  pairKey?: string
  evidenceExampleIds: readonly string[]
  confidence: number
  explanation: string
}

export interface TagCandidateValidationResult {
  /** false 仅表示候选不能激活；语法安全的无效候选仍可保存为 draft/ignored。 */
  valid: boolean
  saveable: boolean
  activationReady: boolean
  errors: string[]
  warnings: string[]
  matchedEvidence: number
  falsePositiveRate: number
  knownProfileConflicts: string[]
  holdout: {
    passed: boolean
    positiveExamples: number
    matchedPositiveExamples: number
    negativeExamples: number
    falsePositives: number
  }
}

const UNKNOWN_SHAPES: readonly RegExp[] = [
  /\[[^\]\r\n]{1,120}\]/g,
  /\{[^{}\r\n]{1,120}\}/g,
  /<[^<>\r\n]{1,160}>/g,
  /\$[^$\r\n]{1,120}\$/g,
  /\\x[0-9A-Fa-f]{2}/g,
  /\\[A-Za-z][A-Za-z0-9_]*(?:\([^()\r\n]{0,120}\))?/g,
]

function overlaps(start: number, end: number, known: readonly { start: number; end: number }[]): boolean {
  return known.some((span) => !(end <= span.start || start >= span.end))
}

function rawUnknowns(text: string, profile?: LinguistTagProfile): Array<{ value: string; start: number }> {
  const known = scanTags(text, { profile })
  const found: Array<{ value: string; start: number }> = []
  for (const pattern of UNKNOWN_SHAPES) {
    pattern.lastIndex = 0
    for (const match of text.matchAll(pattern)) {
      const value = match[0]
      const start = match.index ?? 0
      if (!overlaps(start, start + value.length, known)) found.push({ value, start })
    }
  }
  return found.sort((left, right) => left.start - right.start)
}

function shapeOf(value: string): string {
  return value
    .replace(/"[^"\r\n]*"|'[^'\r\n]*'/g, '{string}')
    .replace(/\d+(?:\.\d+)?/g, '{number}')
    .replace(/#[0-9A-Fa-f]{3,8}\b/g, '{color}')
}

function variableParts(value: string): string[] {
  const parts = value.match(/"[^"\r\n]*"|'[^'\r\n]*'|\d+(?:\.\d+)?|#[0-9A-Fa-f]{3,8}\b/g) ?? []
  return [...new Set(parts.map((part) => /^['"]/.test(part) ? 'quoted string' : part.startsWith('#') ? 'color' : 'number'))]
}

function multisetIntersection(left: readonly string[], right: readonly string[]): number {
  const remaining = new Map<string, number>()
  for (const value of right) remaining.set(value, (remaining.get(value) ?? 0) + 1)
  let matched = 0
  for (const value of left) {
    const count = remaining.get(value) ?? 0
    if (count === 0) continue
    matched++
    remaining.set(value, count - 1)
  }
  return matched
}

interface PairToken {
  kind: 'opening' | 'closing'
  key: string
}

interface PairStat {
  opening: number
  closing: number
  balanced: boolean
}

function pairToken(value: string): PairToken | undefined {
  const match = /^(?:<\s*(\/)?\s*([A-Za-z][A-Za-z0-9:_-]*)[^<>]*>|\[\s*(\/)?\s*([A-Za-z][A-Za-z0-9:_-]*)(?:[=\s][^\]]*)?\]|\{\s*(\/)?\s*([A-Za-z][A-Za-z0-9:_-]*)(?:[=\s][^}]*)?\})$/.exec(value)
  const key = match?.[2] ?? match?.[4] ?? match?.[6]
  if (!key) return undefined
  return {
    kind: match?.[1] || match?.[3] || match?.[5] ? 'closing' : 'opening',
    key: key.toLocaleLowerCase(),
  }
}

function buildPairStats(texts: readonly string[]): Map<string, PairStat> {
  const stats = new Map<string, PairStat>()
  const get = (key: string): PairStat => {
    const existing = stats.get(key)
    if (existing) return existing
    const created = { opening: 0, closing: 0, balanced: true }
    stats.set(key, created)
    return created
  }
  for (const text of texts) {
    const stack: string[] = []
    for (const match of rawUnknowns(text)) {
      const token = pairToken(match.value)
      if (!token) continue
      const stat = get(token.key)
      stat[token.kind]++
      if (token.kind === 'opening') {
        stack.push(token.key)
        continue
      }
      if (stack.at(-1) === token.key) {
        stack.pop()
        continue
      }
      stat.balanced = false
      for (const openKey of stack) get(openKey).balanced = false
      const pairedAt = stack.lastIndexOf(token.key)
      if (pairedAt >= 0) stack.splice(pairedAt, 1)
    }
    for (const openKey of stack) get(openKey).balanced = false
  }
  return stats
}

function pairingEvidence(keys: ReadonlySet<string>, stats: ReadonlyMap<string, PairStat>): UnknownTagPatternResult['pairingEvidence'] {
  const pairKeys = [...keys].sort()
  const relevant = pairKeys.map((key) => stats.get(key)).filter((item): item is PairStat => item !== undefined)
  const opening = relevant.reduce((total, item) => total + item.opening, 0)
  const closing = relevant.reduce((total, item) => total + item.closing, 0)
  return {
    opening,
    closing,
    balanced: relevant.length > 0 && opening > 0 && closing > 0 && relevant.every((item) => item.balanced),
    pairKeys,
  }
}

function collectUnknownExamples(samples: readonly UnknownTagSample[], profile?: LinguistTagProfile): UnknownTagExample[] {
  return samples.flatMap((sample) => (['source', 'target'] as const).flatMap((side) =>
    rawUnknowns(sample[side], profile).map((match) => ({
      id: `${sample.id}:${side}:${match.start}`,
      segmentId: sample.id,
      side,
      value: match.value,
    })),
  ))
}

/** 只做确定性形状统计；结果不会自动进入硬保护。 */
export function scanUnknownTagPatterns(
  samples: readonly UnknownTagSample[],
  profile?: LinguistTagProfile,
  sampleLimit = 3,
): UnknownTagPatternResult[] {
  const groups = new Map<string, {
    examples: UnknownTagExample[]
    sourceValues: string[]
    exactPreserved: number
    shapePreserved: number
    countPreserved: number
    countCompared: number
    pairKeys: Set<string>
    variableParts: Set<string>
  }>()
  for (const sample of samples) {
    const matches = {
      source: rawUnknowns(sample.source, profile),
      target: rawUnknowns(sample.target, profile),
    }
    for (const side of ['source', 'target'] as const) {
      for (const match of matches[side]) {
        const shape = shapeOf(match.value)
        const group = groups.get(shape) ?? {
          examples: [],
          sourceValues: [],
          exactPreserved: 0,
          shapePreserved: 0,
          countPreserved: 0,
          countCompared: 0,
          pairKeys: new Set<string>(),
          variableParts: new Set<string>(),
        }
        if (group.examples.length < sampleLimit) {
          group.examples.push({
            id: `${sample.id}:${side}:${match.start}`,
            segmentId: sample.id,
            side,
            value: match.value,
          })
        }
        for (const part of variableParts(match.value)) group.variableParts.add(part)
        const pair = pairToken(match.value)
        if (pair) group.pairKeys.add(pair.key)
        groups.set(shape, group)
      }
    }
    const sourceByShape = Map.groupBy(matches.source.map((item) => item.value), shapeOf)
    const targetByShape = Map.groupBy(matches.target.map((item) => item.value), shapeOf)
    for (const [shape, sourceValues] of sourceByShape) {
      const group = groups.get(shape)!
      const targetValues = targetByShape.get(shape) ?? []
      group.sourceValues.push(...sourceValues)
      group.exactPreserved += multisetIntersection(sourceValues, targetValues)
      group.shapePreserved += Math.min(sourceValues.length, targetValues.length)
      group.countCompared++
      if (sourceValues.length === targetValues.length) group.countPreserved++
    }
  }
  const pairStats = buildPairStats(samples.map((sample) => sample.source))
  return [...groups.entries()]
    .map(([patternShape, group]) => ({
      patternShape,
      examples: group.examples,
      frequency: group.sourceValues.length,
      sourceTargetPreservation: {
        exactValueRate: group.sourceValues.length === 0 ? 0 : group.exactPreserved / group.sourceValues.length,
        shapeRate: group.sourceValues.length === 0 ? 0 : group.shapePreserved / group.sourceValues.length,
        countRate: group.countCompared === 0 ? 0 : group.countPreserved / group.countCompared,
      },
      pairingEvidence: pairingEvidence(group.pairKeys, pairStats),
      suggestedVariableParts: [...group.variableParts],
    }))
    .sort((left, right) => right.frequency - left.frequency || left.patternShape.localeCompare(right.patternShape))
}

function regexMatches(regex: RegExp, value: string): boolean {
  regex.lastIndex = 0
  const match = regex.exec(value)
  return match?.index === 0 && match[0].length === value.length
}

export function validateTagProfileCandidate(
  input: SaveTagProfileCandidateInput,
  evidence: readonly UnknownTagExample[],
  samples: readonly UnknownTagSample[],
  profile?: LinguistTagProfile,
): TagCandidateValidationResult {
  const errors: string[] = []
  const warnings: string[] = []
  const regex = compileTagFamilyRegex(input.regex)
  if (regex === null) errors.push('正则无效、可匹配空串或未通过 ReDoS 安全检查')
  if ((input.kind === 'opening' || input.kind === 'closing') && !input.pairKey?.trim()) {
    errors.push('开/闭标签必须提供 pairKey')
  }
  if (input.kind === 'standalone' && input.pairKey !== undefined) {
    warnings.push('standalone 不使用 pairKey，激活时将忽略')
  }
  if (evidence.length === 0) errors.push('至少需要一个可回读的正例')
  if (evidence.length !== new Set(input.evidenceExampleIds).size) errors.push('部分正例已不存在或不属于当前项目')
  const matchedEvidence = regex === null ? 0 : evidence.filter((item) => regexMatches(regex, item.value)).length
  if (matchedEvidence !== evidence.length) errors.push('正则未命中全部正例')

  const knownProfileConflicts = new Set<string>()
  if (regex !== null) {
    for (const sample of samples) {
      for (const side of ['source', 'target'] as const) {
        for (const tag of scanTags(sample[side], { profile })) {
          if (regexMatches(regex, sample[side].slice(tag.start, tag.end))) knownProfileConflicts.add(tag.familyId)
        }
      }
    }
  }
  if (knownProfileConflicts.size > 0) {
    errors.push(`候选与真实项目样本中的已启用 Tag 重叠: ${[...knownProfileConflicts].sort().join(', ')}`)
  }

  if (input.kind === 'opening' || input.kind === 'closing') {
    const parsed = evidence.map((item) => pairToken(item.value))
    if (parsed.some((item) => item?.kind !== input.kind)) {
      errors.push(`${input.kind} 候选的正例必须是可解析的真实${input.kind === 'opening' ? '开' : '闭'}标签`)
    } else {
      const sides = new Set(evidence.map((item) => item.side))
      const stats = buildPairStats(samples.flatMap((sample) => [
        ...(sides.has('source') ? [sample.source] : []),
        ...(sides.has('target') ? [sample.target] : []),
      ]))
      const keys = new Set(parsed.flatMap((item) => item ? [item.key] : []))
      if ([...keys].some((key) => {
        const stat = stats.get(key)
        return stat === undefined || stat.opening === 0 || stat.closing === 0 || !stat.balanced
      })) errors.push('开/闭标签正例未在真实项目样本中形成同名、正确嵌套的配对')
    }
  }

  const evidenceIds = new Set(evidence.map((item) => item.id))
  const evidenceShapes = new Set(evidence.map((item) => shapeOf(item.value)))
  const holdoutExamples = collectUnknownExamples(samples, profile).filter((item) => !evidenceIds.has(item.id))
  const positiveExamples = holdoutExamples.filter((item) => evidenceShapes.has(shapeOf(item.value)))
  const negativeExamples = holdoutExamples.filter((item) => !evidenceShapes.has(shapeOf(item.value)))
  const matchedPositiveExamples = regex === null
    ? 0
    : positiveExamples.filter((item) => regexMatches(regex, item.value)).length
  const falsePositives = regex === null
    ? 0
    : negativeExamples.filter((item) => regexMatches(regex, item.value)).length
  const falsePositiveRate = negativeExamples.length === 0 ? 0 : falsePositives / negativeExamples.length
  if (falsePositiveRate > 0.2) warnings.push(`项目样本误报率为 ${(falsePositiveRate * 100).toFixed(1)}%`)
  const holdout = {
    passed: holdoutExamples.length > 0
      && matchedPositiveExamples === positiveExamples.length
      && falsePositiveRate <= 0.2,
    positiveExamples: positiveExamples.length,
    matchedPositiveExamples,
    negativeExamples: negativeExamples.length,
    falsePositives,
  }
  if (!holdout.passed) warnings.push('独立 holdout 未通过，候选不能激活')
  const saveable = errors.length === 0
  const valid = saveable && falsePositiveRate <= 0.2
  return {
    valid,
    saveable,
    activationReady: valid && holdout.passed,
    errors,
    warnings,
    matchedEvidence,
    falsePositiveRate,
    knownProfileConflicts: [...knownProfileConflicts].sort(),
    holdout,
  }
}

export function saveTagProfileCandidate(
  profile: LinguistTagProfile | undefined,
  input: SaveTagProfileCandidateInput,
): { profile: LinguistTagProfile; candidate: LinguistTagProfileCandidate } {
  const candidate: LinguistTagProfileCandidate = {
    id: `tag-${fnv1a64(`${input.name}\0${input.regex}\0${input.kind}\0${input.pairKey ?? ''}`)}`,
    name: input.name.trim(),
    pattern: input.regex,
    kind: input.kind,
    ...(input.pairKey?.trim() ? { pairKey: input.pairKey.trim() } : {}),
    evidenceExampleIds: [...new Set(input.evidenceExampleIds)],
    confidence: Math.max(0, Math.min(1, input.confidence)),
    explanation: input.explanation.trim(),
    status: 'candidate',
  }
  const candidates = (profile?.candidates ?? []).filter((item) => item.id !== candidate.id)
  return {
    profile: { families: profile?.families ?? [], candidates: [...candidates, candidate] },
    candidate,
  }
}

export function activateTagProfileCandidate(
  profile: LinguistTagProfile,
  candidateId: string,
): LinguistTagProfile {
  const candidate = profile.candidates?.find((item) => item.id === candidateId)
  if (!candidate) throw new Error(`Tag Profile candidate not found: ${candidateId}`)
  const family: LinguistTagFamily = {
    id: candidate.id,
    pattern: candidate.pattern,
    class: candidate.kind === 'standalone' ? 'singleton' : 'paired',
    kind: candidate.kind,
    ...(candidate.kind !== 'standalone' && candidate.pairKey ? { pairWith: candidate.pairKey } : {}),
    note: candidate.explanation,
    enabled: true,
  }
  return {
    families: [...profile.families.filter((item) => item.id !== family.id), family],
    candidates: profile.candidates?.filter((item) => item.id !== candidateId),
  }
}

export function updateTagProfileEntry(
  profile: LinguistTagProfile,
  id: string,
  action: 'ignore' | 'enable' | 'disable',
): LinguistTagProfile {
  if (action === 'ignore') {
    if (!profile.candidates?.some((item) => item.id === id)) {
      throw new Error(`Tag Profile candidate not found: ${id}`)
    }
    return {
      ...profile,
      candidates: profile.candidates?.map((item) => item.id === id ? { ...item, status: 'ignored' } : item),
    }
  }
  if (!profile.families.some((item) => item.id === id)) {
    throw new Error(`Tag Profile family not found: ${id}`)
  }
  return {
    ...profile,
    families: profile.families.map((item) => item.id === id
      ? { ...item, enabled: action === 'enable' }
      : item),
  }
}
