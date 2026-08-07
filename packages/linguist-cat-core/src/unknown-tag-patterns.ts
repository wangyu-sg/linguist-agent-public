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
  sourceTargetPreservationRate: number
  pairingEvidence: { opening: number; closing: number; balanced: boolean }
  knownProfileConflicts: string[]
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
  valid: boolean
  errors: string[]
  warnings: string[]
  matchedEvidence: number
  falsePositiveRate: number
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

function pairingOf(values: readonly string[]): UnknownTagPatternResult['pairingEvidence'] {
  const opening = values.filter((value) => /^<(?!\/)|^\[(?!\/)|^\{(?!\/)/.test(value)).length
  const closing = values.filter((value) => /^<\/|^\[\/|^\{\//.test(value)).length
  return { opening, closing, balanced: closing > 0 && opening === closing }
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
    preserved: number
    variableParts: Set<string>
  }>()
  for (const sample of samples) {
    const targetShapes = new Set(rawUnknowns(sample.target, profile).map((item) => shapeOf(item.value)))
    for (const side of ['source', 'target'] as const) {
      for (const match of rawUnknowns(sample[side], profile)) {
        const shape = shapeOf(match.value)
        const group = groups.get(shape) ?? {
          examples: [], sourceValues: [], preserved: 0, variableParts: new Set<string>(),
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
        if (side === 'source') {
          group.sourceValues.push(match.value)
          if (targetShapes.has(shape)) group.preserved += 1
        }
        groups.set(shape, group)
      }
    }
  }
  return [...groups.entries()]
    .map(([patternShape, group]) => ({
      patternShape,
      examples: group.examples,
      frequency: group.sourceValues.length,
      sourceTargetPreservationRate: group.sourceValues.length === 0
        ? 0
        : group.preserved / group.sourceValues.length,
      pairingEvidence: pairingOf(group.sourceValues),
      knownProfileConflicts: [...new Set(group.examples.flatMap((example) =>
        scanTags(example.value, { profile }).map((tag) => tag.familyId)))],
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
  negativeExamples: readonly string[],
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
  const matchedEvidence = regex === null ? 0 : evidence.filter((item) => regexMatches(regex, item.value)).length
  if (matchedEvidence !== evidence.length) errors.push('正则未命中全部正例')
  if (regex !== null && evidence.some((item) => scanTags(item.value, { profile }).length > 0)) {
    errors.push('候选与已启用 Profile 或内置 Tag 重叠')
  }
  const falsePositives = regex === null ? 0 : negativeExamples.filter((value) => regexMatches(regex, value)).length
  const falsePositiveRate = negativeExamples.length === 0 ? 0 : falsePositives / negativeExamples.length
  if (falsePositiveRate > 0.2) warnings.push(`项目样本误报率为 ${(falsePositiveRate * 100).toFixed(1)}%`)
  return { valid: errors.length === 0, errors, warnings, matchedEvidence, falsePositiveRate }
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
    ...(candidate.pairKey ? { pairWith: candidate.pairKey } : {}),
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
