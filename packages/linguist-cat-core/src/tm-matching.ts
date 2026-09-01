import { sha256Hex } from './hash'
import { scanTagTokens } from './tag-families'

/** The only match classes emitted by Segment Match. Concordance is separate. */
export type TmSegmentMatchClass =
  | 'double-context'
  | 'context'
  | 'exact'
  | 'near-exact'
  | 'fuzzy'

export type TmContextState = 'match' | 'mismatch' | 'unknown'
export type TmReuseSafety = 'compatible' | 'review' | 'incompatible'

export interface TmMatchContext {
  contextKey?: string
  previousSource?: string
  nextSource?: string
}

export interface TmMatchCandidate {
  unitId: string
  source: string
  target: string
  sourceLabel?: string
  sourcePriority?: number
  contextKey?: string
  previousSourceHash?: string
  nextSourceHash?: string
}

export interface TmMatchDiagnostics {
  unitId: string
  matchClass: TmSegmentMatchClass
  displayScore: number
  matchedSource: string
  target: string
  sourceLabel: string
  sourcePriority: number
  provenanceCount: number
  variantCount: number
  context: {
    structural: TmContextState
    textFlow: TmContextState
  }
  structure: {
    safety: Exclude<TmReuseSafety, 'incompatible'>
    reasons: string[]
  }
  differences: string[]
}

export interface TmMatcherOptions {
  context?: TmMatchContext
  minimumScore?: number
}

export interface TmAgentEvidence {
  unitId: string
  matchClass: TmSegmentMatchClass
  score: number
  matchedSource: string
  target: string
  sourceLabel: string
  safety: 'compatible' | 'review'
  reasons: string[]
  ambiguous: boolean
}

const WORD_SEGMENTER = new Intl.Segmenter(undefined, { granularity: 'word' })

function normalizeTmText(value: string): string {
  return value
    .normalize('NFKC')
    .replace(/\r\n?/gu, '\n')
    .replace(/[\t\f\v ]+/gu, ' ')
    .trim()
    .toLocaleLowerCase()
}

function tokenize(value: string): string[] {
  return Array.from(WORD_SEGMENTER.segment(value), (part) => part.segment.trim())
    .filter((token) => token !== '')
}

function isCjk(value: string): boolean {
  return /[\u3040-\u30ff\u3400-\u9fff\uf900-\ufaff]/u.test(value)
}

function characterNgrams(value: string): Map<string, number> {
  const characters = Array.from(value)
  const grams = new Map<string, number>()
  const size = characters.length > 1 ? 2 : 1
  for (let index = 0; index + size <= characters.length; index += 1) {
    const gram = characters.slice(index, index + size).join('')
    grams.set(gram, (grams.get(gram) ?? 0) + 1)
  }
  return grams
}

function multisetDice(left: Map<string, number>, right: Map<string, number>): number {
  let overlap = 0
  let leftTotal = 0
  let rightTotal = 0
  for (const count of left.values()) leftTotal += count
  for (const count of right.values()) rightTotal += count
  for (const [gram, count] of left) overlap += Math.min(count, right.get(gram) ?? 0)
  return leftTotal === 0 && rightTotal === 0
    ? 1
    : (2 * overlap) / (leftTotal + rightTotal)
}

function levenshteinSimilarity(left: readonly string[], right: readonly string[]): number {
  if (left.length === 0 && right.length === 0) return 1
  const previous = Array.from({ length: right.length + 1 }, (_, index) => index)
  for (let row = 1; row <= left.length; row += 1) {
    let diagonal = previous[0]!
    previous[0] = row
    for (let column = 1; column <= right.length; column += 1) {
      const above = previous[column]!
      previous[column] = left[row - 1] === right[column - 1]
        ? diagonal
        : 1 + Math.min(diagonal, above, previous[column - 1]!)
      diagonal = above
    }
  }
  return 1 - previous[right.length]! / Math.max(left.length, right.length)
}

function lengthPenalty(left: string, right: string): number {
  const a = Array.from(left).length
  const b = Array.from(right).length
  if (a === 0 && b === 0) return 1
  return Math.min(a, b) / Math.max(a, b)
}

const PLAIN_PLACEABLE_PATTERN = /\b\d+(?:[.,]\d+)?%?|https?:\/\/[^\s]+|[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/giu

function extractPlaceables(value: string): string[] {
  const tokens = scanTagTokens(value)
  const placeholders = value.match(PLAIN_PLACEABLE_PATTERN) ?? []
  return [...tokens.map((token) => token.signature).sort(), ...placeholders.map((item) => item.toLocaleLowerCase())]
}

function placeableMasked(value: string): string {
  const tokens = scanTagTokens(value)
  let result = value
  for (const token of [...tokens].sort((left, right) => right.start - left.start)) {
    result = `${result.slice(0, token.start)}¤${result.slice(token.end)}`
  }
  return result.replace(PLAIN_PLACEABLE_PATTERN, '¤')
}

function punctuationMasked(value: string): string {
  return placeableMasked(value)
    .normalize('NFKC')
    .replace(/[^\p{L}\p{N}\s¤]/gu, '')
    .replace(/\s+/gu, ' ')
    .trim()
    .toLocaleLowerCase()
}

function structuralSafety(query: string, candidate: string): { safety: TmReuseSafety; reasons: string[] } {
  const left = extractPlaceables(query)
  const right = extractPlaceables(candidate)
  if (left.length !== right.length) {
    return {
      safety: 'incompatible',
      reasons: ['Placeable 数量不一致'],
    }
  }
  if (left.join('\u0000') !== right.join('\u0000')) {
    return {
      safety: 'review',
      reasons: ['Placeable 或 Tag 值/映射发生变化'],
    }
  }
  return { safety: 'compatible', reasons: [] }
}

function differences(query: string, candidate: string): string[] {
  const result: string[] = []
  if (query !== candidate) {
    if (normalizeTmText(query) === normalizeTmText(candidate)) {
      if (query.replace(/\s+/gu, ' ') !== candidate.replace(/\s+/gu, ' ')) result.push('空白差异')
      if (query.toLocaleLowerCase() === candidate.toLocaleLowerCase()) result.push('大小写差异')
      if (result.length === 0) result.push('标点或格式差异')
    } else if (placeableMasked(query) === placeableMasked(candidate)) {
      result.push('可识别 Placeable 差异')
    } else {
      result.push('词汇或词序差异')
    }
  }
  return result
}

function contextState(expected: string | undefined, actualHash: string | undefined): TmContextState {
  if (expected === undefined || actualHash === undefined) return 'unknown'
  return tmSourceHash(expected) === actualHash ? 'match' : 'mismatch'
}

/** Exact lookup hash; context-only hashes omit locales because no pair is available. */
export function tmSourceHash(value: string, sourceLocale?: string, targetLocale?: string): string {
  const localePrefix = sourceLocale === undefined && targetLocale === undefined
    ? ''
    : `${sourceLocale ?? ''}\u0000${targetLocale ?? ''}\u0000`
  return sha256Hex(new TextEncoder().encode(`${localePrefix}${normalizeTmText(value)}`))
}

function isShortSegment(value: string): boolean {
  const normalized = normalizeTmText(value)
  if (normalized === '') return true
  if (/^\d+$/u.test(normalized)) return true
  if (isCjk(normalized)) return Array.from(normalized).length <= 6
  return tokenize(normalized).length <= 2
}

function compareDiagnostics(left: TmMatchDiagnostics, right: TmMatchDiagnostics): number {
  return right.displayScore - left.displayScore
    || right.sourcePriority - left.sourcePriority
    || left.unitId.localeCompare(right.unitId)
}

function ambiguityGroups(matches: TmMatchDiagnostics[]): void {
  for (const sourceMatches of Map.groupBy(
    matches,
    (match) => normalizeTmText(match.matchedSource),
  ).values()) {
    const targetGroups = Map.groupBy(sourceMatches, (match) => normalizeTmText(match.target))
    for (const targetMatches of targetGroups.values()) {
      for (const match of targetMatches) {
        match.provenanceCount = targetMatches.length
        match.variantCount = targetGroups.size
      }
    }
  }
}

/** Pure, deterministic Segment Matcher. Store supplies candidates; no IO here. */
export function matchTmCandidates(
  query: string,
  candidates: readonly TmMatchCandidate[],
  options: TmMatcherOptions = {},
): TmMatchDiagnostics[] {
  const normalizedQuery = normalizeTmText(query)
  const queryTokens = tokenize(normalizedQuery)
  const queryGrams = characterNgrams(normalizedQuery)
  const matches: TmMatchDiagnostics[] = []
  for (const candidate of candidates) {
    const normalizedCandidate = normalizeTmText(candidate.source)
    const structure = structuralSafety(query, candidate.source)
    const rawExact = query === candidate.source
    const maskedExact = placeableMasked(normalizedQuery) === placeableMasked(normalizedCandidate)
    const structural = candidate.contextKey === undefined || options.context?.contextKey === undefined
      ? 'unknown'
      : candidate.contextKey === options.context.contextKey ? 'match' : 'mismatch'
    const previousFlow = contextState(options.context?.previousSource, candidate.previousSourceHash)
    const nextFlow = contextState(options.context?.nextSource, candidate.nextSourceHash)
    const textFlow = options.context === undefined
      || (candidate.previousSourceHash === undefined && candidate.nextSourceHash === undefined)
      ? 'unknown'
      : previousFlow === 'match' || nextFlow === 'match'
        ? 'match'
        : 'mismatch'
    let matchClass: TmSegmentMatchClass
    let displayScore: number
    if (rawExact && structural === 'match' && textFlow === 'match') {
      matchClass = 'double-context'
      displayScore = 102
    } else if (rawExact && (structural === 'match' || textFlow === 'match')) {
      matchClass = 'context'
      displayScore = 101
    } else if (rawExact) {
      matchClass = 'exact'
      displayScore = 100
    } else if (punctuationMasked(query) === punctuationMasked(candidate.source) || maskedExact) {
      matchClass = 'near-exact'
      displayScore = 97
    } else {
      const lexicalScore = 0.65 * levenshteinSimilarity(queryTokens, tokenize(normalizedCandidate))
        + 0.35 * multisetDice(queryGrams, characterNgrams(normalizedCandidate))
      displayScore = Math.max(0, Math.min(94, lexicalScore * lengthPenalty(normalizedQuery, normalizedCandidate) * 100))
      matchClass = 'fuzzy'
    }
    if (structure.safety === 'incompatible') continue
    if (options.minimumScore !== undefined && displayScore < options.minimumScore) continue
    if (isShortSegment(query) && matchClass === 'fuzzy') continue
    const safety = matchClass === 'near-exact'
      ? 'review'
      : structure.safety
    const safetyReasons = matchClass === 'near-exact' && structure.reasons.length === 0
      ? ['Near Exact 默认需要人工审核']
      : structure.reasons
    matches.push({
      unitId: candidate.unitId,
      matchClass,
      displayScore: Math.round(displayScore * 100) / 100,
      matchedSource: candidate.source,
      target: candidate.target,
      sourceLabel: candidate.sourceLabel ?? 'Project TM',
      sourcePriority: candidate.sourcePriority ?? 0,
      provenanceCount: 1,
      variantCount: 1,
      context: { structural, textFlow },
      structure: { safety, reasons: [...safetyReasons] },
      differences: differences(query, candidate.source),
    })
  }
  ambiguityGroups(matches)
  matches.sort(compareDiagnostics)
  return matches
}

/** Convert diagnostics to the intentionally smaller Agent evidence contract. */
export function selectTmAgentEvidence(
  matches: readonly TmMatchDiagnostics[],
  limit = 5,
): TmAgentEvidence[] {
  const chosen: TmAgentEvidence[] = []
  const chosenTargets = new Set<string>()
  let fuzzyCount = 0
  const hasHigh = matches.some((match) => match.matchClass !== 'fuzzy' && match.displayScore >= 95)
  for (const match of matches) {
    if (match.matchClass === 'fuzzy') {
      if (match.displayScore < 85 || fuzzyCount >= 2 || hasHigh) continue
      fuzzyCount += 1
    }
    const targetKey = normalizeTmText(match.target)
    if (chosenTargets.has(targetKey)) continue
    chosenTargets.add(targetKey)
    chosen.push({
      unitId: match.unitId,
      matchClass: match.matchClass,
      score: Math.round(match.displayScore),
      matchedSource: match.matchedSource,
      target: match.target,
      sourceLabel: match.sourceLabel,
      safety: match.structure.safety,
      reasons: [
        ...match.structure.reasons,
        ...match.differences,
        ...(match.variantCount <= 1 ? [] : ['同一原文存在多个不同译文变体，不能仅按分数选择。']),
      ],
      ambiguous: match.variantCount > 1,
    })
    if (chosen.length >= limit) break
  }
  return chosen
}
