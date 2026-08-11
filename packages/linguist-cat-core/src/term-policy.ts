export type TermPolicyStatus = 'allowed' | 'preferred' | 'required' | 'forbidden' | 'deprecated'

export interface TermPolicyCandidate {
  id: string
  term: string
  translation: string
  status: TermPolicyStatus
  caseSensitive: boolean
  conflict: boolean
  lowDiscrimination: boolean
  module?: string
  category?: string
}

export type TermPolicyAdvisoryReason =
  | 'conflict'
  | 'low_discrimination'
  | 'scope_unknown'
  | 'preferred'
  | 'deprecated'

export interface SegmentTermPolicyInput<T extends TermPolicyCandidate> {
  source: string
  target: string
  sourceLocale: string
  targetLocale: string
  assetId: string
  module?: string
  category?: string
  segmentMetadata: Readonly<Record<string, string>>
  candidates: readonly T[]
}

export interface EvaluatedTermPolicyMatch<T extends TermPolicyCandidate> {
  match: T
  enforcement: 'hard' | 'advisory' | 'none'
  reasons: TermPolicyAdvisoryReason[]
  targetUsed: boolean
}

export interface SegmentTermPolicyEvaluation<T extends TermPolicyCandidate> {
  matches: Array<EvaluatedTermPolicyMatch<T>>
}

function normalize(value: string, foldCase: boolean): string {
  const normalized = value.normalize('NFKC').replace(/\s+/gu, ' ').trim()
  return foldCase ? normalized.toLocaleLowerCase() : normalized
}

function containsTerm(text: string, term: string, caseSensitive: boolean): boolean {
  const normalizedText = normalize(text, !caseSensitive)
  const normalizedTerm = normalize(term, !caseSensitive)
  if (normalizedTerm === '' || normalizedText === '') return false
  if (/\p{Script=Han}/u.test(normalizedTerm)) return normalizedText.includes(normalizedTerm)
  const escaped = normalizedTerm.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(`(?<![\\p{L}\\p{N}_])${escaped}(?![\\p{L}\\p{N}_])`, 'u').test(normalizedText)
}

/**
 * 统一判定“硬权威”与“需人工判断”。候选匹配仍由 Store 的成熟 matcher
 * 负责；Core 只做无 IO 的 scope / conflict / discrimination / status 分类。
 */
export function evaluateSegmentTermPolicy<T extends TermPolicyCandidate>(
  input: SegmentTermPolicyInput<T>,
): SegmentTermPolicyEvaluation<T> {
  return {
    matches: input.candidates.map((match) => {
      const scopeMismatch = (match.module !== undefined && input.module !== undefined && match.module !== input.module)
        || (match.category !== undefined && input.category !== undefined && match.category !== input.category)
      const scopeUnknown = (match.module !== undefined && input.module === undefined)
        || (match.category !== undefined && input.category === undefined)
      const reasons: TermPolicyAdvisoryReason[] = []
      if (match.conflict) reasons.push('conflict')
      if (match.lowDiscrimination) reasons.push('low_discrimination')
      if (scopeUnknown) reasons.push('scope_unknown')
      if (match.status === 'preferred') reasons.push('preferred')
      if (match.status === 'deprecated') reasons.push('deprecated')
      const enforceable = match.status === 'required' || match.status === 'forbidden'
      return {
        match,
        enforcement: scopeMismatch || match.status === 'allowed'
          ? 'none'
          : enforceable && reasons.length === 0
            ? 'hard'
            : 'advisory',
        reasons,
        targetUsed: containsTerm(input.target, match.translation, match.caseSensitive),
      }
    }),
  }
}
