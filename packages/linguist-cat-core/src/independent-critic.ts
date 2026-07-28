/**
 * Independent Critic artifact contract (PB-083).
 *
 * Extracted from legacy linguist-agent@la-v2-legacy-freeze-2026-07-25
 * `packages/cat-data/src/independent_critic.ts` — behavior preserved
 * verbatim (same validation cases, same error messages, same id/hash
 * derivation), style converted to this repo's conventions, and
 * `isCitableEvidenceSource` now comes from the local `./evidence` module.
 *
 * Independent Critics produce versioned advisory artifacts only. A separate
 * owner may later decide whether to create a proposal; this module has no
 * writer, proposal, target, or Decision dependency. The contract burns in
 * `authority: 'advisory_finding'` / `canCommit: false` — review output can
 * never be committed directly.
 *
 * Added during extraction (not part of the legacy surface):
 * `independentCriticCandidateHash` / `independentCriticProfileHash` — the
 * hashing helpers the tool runtime needs to derive subject/critic identity
 * without re-implementing this module's canonicalization.
 */

import { createHash } from 'node:crypto'
import { isCitableEvidenceSource } from './evidence'
import {
  QA_FINDING_SEVERITIES,
  QA_ISSUE_TYPES,
  type QaFindingSeverity,
  type QaIssueType,
} from './issue-type'

export const INDEPENDENT_CRITIC_CATEGORIES = ['fidelity', 'naturalness', 'terminology', 'voice', 'consistency'] as const
export type IndependentCriticCategory = (typeof INDEPENDENT_CRITIC_CATEGORIES)[number]
/**
 * PB-096：critic severity 与 QA 契约同构（L0–L4 五档）。category 保留为
 * 机制码；缺陷分类由 finding 的 issueType 直接产出（29 枚举）。
 */
export type IndependentCriticSeverity = QaFindingSeverity

export interface IndependentCriticFindingDraft {
  category: IndependentCriticCategory
  severity: IndependentCriticSeverity
  issueType: QaIssueType
  evidenceRefs: string[]
  explanation: string
  suggestedRepair?: string
}

export interface IndependentCriticSubject {
  segmentId: string
  risk: 'high'
  candidateId: string
  candidateHash: string
  candidateExecutionId: string
  candidateProducerId: string
}

export interface IndependentCriticIdentity {
  criticId: string
  executionId: string
  profileHash: string
}

export interface IndependentCriticFinding extends IndependentCriticFindingDraft {
  findingId: string
  criticId: string
}

export interface IndependentCriticArtifact {
  schemaVersion: 1
  authority: 'advisory_finding'
  canCommit: false
  artifactId: string
  subject: IndependentCriticSubject
  critic: IndependentCriticIdentity
  findings: IndependentCriticFinding[]
  artifactHash: string
}

export interface IndependentCriticRequest {
  schemaVersion: 1
  subject: IndependentCriticSubject
  critic: IndependentCriticIdentity
  findings: IndependentCriticFindingDraft[]
}

export type IndependentCriticPlan =
  | { kind: 'not_required'; reason: 'Independent Critic is reserved for high-risk segments.' }
  | { kind: 'required'; requiredRoles: ['fidelity', 'naturalness', 'terminology', 'voice'] }

export interface CriticTargetedRepairScope {
  authority: 'advisory_finding'
  canCommit: false
  segmentIds: string[]
  findingIds: string[]
}

const SHA256 = /^[a-f0-9]{64}$/u

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function knownFields(row: Record<string, unknown>, fields: readonly string[], label: string): void {
  for (const key of Object.keys(row)) if (!fields.includes(key)) throw new Error(`${label} has unknown field ${key}.`)
}

function text(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${label} must be a non-empty string.`)
  return value.trim()
}

function sha256(value: unknown, label: string): string {
  const digest = text(value, label).toLowerCase()
  if (!SHA256.test(digest)) throw new Error(`${label} must be a SHA-256 digest.`)
  return digest
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize)
  if (!isRecord(value)) return value
  return Object.fromEntries(Object.keys(value).sort((a, b) => a.localeCompare(b)).map((key) => [key, canonicalize(value[key])]))
}

function hash(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(canonicalize(value))).digest('hex')
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child)
    Object.freeze(value)
  }
  return value
}

function parseSubject(value: unknown, label = 'subject'): IndependentCriticSubject {
  if (!isRecord(value)) throw new Error(`${label} must be an object.`)
  knownFields(value, ['segmentId', 'risk', 'candidateId', 'candidateHash', 'candidateExecutionId', 'candidateProducerId'], label)
  if (value.risk !== 'high') throw new Error('Independent Critic artifact is only permitted for a high-risk segment.')
  return {
    segmentId: text(value.segmentId, `${label}.segmentId`),
    risk: 'high',
    candidateId: text(value.candidateId, `${label}.candidateId`),
    candidateHash: sha256(value.candidateHash, `${label}.candidateHash`),
    candidateExecutionId: text(value.candidateExecutionId, `${label}.candidateExecutionId`),
    candidateProducerId: text(value.candidateProducerId, `${label}.candidateProducerId`),
  }
}

function parseCritic(value: unknown, label = 'critic'): IndependentCriticIdentity {
  if (!isRecord(value)) throw new Error(`${label} must be an object.`)
  knownFields(value, ['criticId', 'executionId', 'profileHash'], label)
  return {
    criticId: text(value.criticId, `${label}.criticId`),
    executionId: text(value.executionId, `${label}.executionId`),
    profileHash: sha256(value.profileHash, `${label}.profileHash`),
  }
}

function parseEvidence(value: unknown, label: string): string[] {
  if (!Array.isArray(value) || !value.length) throw new Error(`${label} must contain citable evidenceRefs.`)
  const refs = value.map((entry, index) => text(entry, `${label}[${index}]`))
  if (refs.some((ref) => !isCitableEvidenceSource(ref))) throw new Error(`${label} must contain citable evidenceRefs, not audit-only trace.`)
  return [...new Set(refs)].sort((a, b) => a.localeCompare(b))
}

function parseFindingDraft(value: unknown, label: string, artifactFields = false): IndependentCriticFindingDraft {
  if (!isRecord(value)) throw new Error(`${label} must be an object.`)
  knownFields(value, ['category', 'severity', 'issueType', 'evidenceRefs', 'explanation', 'suggestedRepair', ...(artifactFields ? ['findingId', 'criticId'] : [])], label)
  const category = text(value.category, `${label}.category`)
  if (!(INDEPENDENT_CRITIC_CATEGORIES as readonly string[]).includes(category)) throw new Error(`${label}.category is invalid.`)
  if (!(QA_FINDING_SEVERITIES as readonly string[]).includes(String(value.severity))) throw new Error(`${label}.severity is invalid.`)
  const issueType = text(value.issueType, `${label}.issueType`)
  if (!(QA_ISSUE_TYPES as readonly string[]).includes(issueType)) throw new Error(`${label}.issueType is invalid.`)
  const suggestedRepair = value.suggestedRepair === undefined ? undefined : text(value.suggestedRepair, `${label}.suggestedRepair`)
  return {
    category: category as IndependentCriticCategory,
    severity: value.severity as IndependentCriticSeverity,
    issueType: issueType as QaIssueType,
    evidenceRefs: parseEvidence(value.evidenceRefs, `${label}.evidenceRefs`),
    explanation: text(value.explanation, `${label}.explanation`),
    ...(suggestedRepair === undefined ? {} : { suggestedRepair }),
  }
}

function assertIndependent(subject: IndependentCriticSubject, critic: IndependentCriticIdentity): void {
  if (subject.candidateExecutionId === critic.executionId) throw new Error('Independent Critic must use a different execution from the candidate producer.')
  if (subject.candidateProducerId === critic.criticId) throw new Error('Independent Critic must use a different actor from the candidate producer.')
}

function artifactWithoutHash(subject: IndependentCriticSubject, critic: IndependentCriticIdentity, findings: IndependentCriticFinding[]): Omit<IndependentCriticArtifact, 'artifactHash'> {
  const artifactId = `critic:${hash({ subject, critic, findings }).slice(0, 24)}`
  return { schemaVersion: 1, authority: 'advisory_finding', canCommit: false, artifactId, subject, critic, findings }
}

export function planIndependentCritic(input: { risk: 'low' | 'medium' | 'high' }): IndependentCriticPlan {
  if (input.risk === 'high') return { kind: 'required', requiredRoles: ['fidelity', 'naturalness', 'terminology', 'voice'] }
  return { kind: 'not_required', reason: 'Independent Critic is reserved for high-risk segments.' }
}

export function createIndependentCriticArtifact(request: IndependentCriticRequest): IndependentCriticArtifact {
  if (!isRecord(request) || request.schemaVersion !== 1 || !Array.isArray(request.findings)) throw new Error('Unsupported Independent Critic request.')
  const subject = parseSubject(request.subject)
  const critic = parseCritic(request.critic)
  assertIndependent(subject, critic)
  if (!request.findings.length) throw new Error('Independent Critic requires at least one structured finding.')
  const findings = request.findings.map((finding, index) => {
    const draft = parseFindingDraft(finding, `findings[${index}]`)
    return {
      findingId: `cf:${hash({ subject, critic, draft, index }).slice(0, 24)}`,
      criticId: critic.criticId,
      ...draft,
    }
  })
  const withoutHash = artifactWithoutHash(subject, critic, findings)
  return deepFreeze({ ...withoutHash, artifactHash: hash(withoutHash) })
}

export function parseIndependentCriticArtifact(value: unknown): IndependentCriticArtifact {
  if (!isRecord(value)) throw new Error('Independent Critic artifact must be an object.')
  knownFields(value, ['schemaVersion', 'authority', 'canCommit', 'artifactId', 'subject', 'critic', 'findings', 'artifactHash'], 'Independent Critic artifact')
  if (value.schemaVersion !== 1 || value.authority !== 'advisory_finding' || value.canCommit !== false || !Array.isArray(value.findings)) {
    throw new Error('Independent Critic artifact contract is invalid.')
  }
  const subject = parseSubject(value.subject)
  const critic = parseCritic(value.critic)
  assertIndependent(subject, critic)
  const findings = value.findings.map((finding, index) => {
    if (!isRecord(finding)) throw new Error(`findings[${index}] must be an object.`)
    knownFields(finding, ['findingId', 'criticId', 'category', 'severity', 'issueType', 'evidenceRefs', 'explanation', 'suggestedRepair'], `findings[${index}]`)
    const draft = parseFindingDraft(finding, `findings[${index}]`, true)
    const findingId = text(finding.findingId, `findings[${index}].findingId`)
    if (text(finding.criticId, `findings[${index}].criticId`) !== critic.criticId) throw new Error(`findings[${index}] criticId differs from artifact critic.`)
    return { findingId, criticId: critic.criticId, ...draft }
  })
  if (!findings.length || new Set(findings.map((finding) => finding.findingId)).size !== findings.length) throw new Error('Independent Critic findings must be non-empty and uniquely identified.')
  const withoutHash = artifactWithoutHash(subject, critic, findings)
  if (text(value.artifactId, 'artifactId') !== withoutHash.artifactId) throw new Error('Independent Critic artifactId changed.')
  if (sha256(value.artifactHash, 'artifactHash') !== hash(withoutHash)) throw new Error('Independent Critic artifactHash changed.')
  return deepFreeze({ ...withoutHash, artifactHash: hash(withoutHash) })
}

/** Returns only the exact finding/segment scope; it cannot formulate or apply a repair. */
export function targetedRepairScopeFromCriticArtifact(
  artifact: IndependentCriticArtifact,
  options: { findingIds?: string[] } = {},
): CriticTargetedRepairScope {
  const available = new Set(artifact.findings.map((finding) => finding.findingId))
  const findingIds = [...new Set(options.findingIds ?? artifact.findings.map((finding) => finding.findingId))].sort((a, b) => a.localeCompare(b))
  if (!findingIds.length || findingIds.some((id) => !available.has(id))) throw new Error('Requested Critic finding was not found in this artifact.')
  return deepFreeze({ authority: 'advisory_finding', canCommit: false, segmentIds: [artifact.subject.segmentId], findingIds })
}

/**
 * Candidate hash for the tool runtime (PB-083): sha256 over the canonical
 * JSON of {proposalId, segmentId, target, revision} — the same
 * canonicalization the artifact hash uses, so identity derivation stays in
 * one module.
 */
export function independentCriticCandidateHash(input: {
  proposalId: string
  segmentId: string
  target: string
  revision: number
}): string {
  return hash({
    proposalId: input.proposalId,
    segmentId: input.segmentId,
    target: input.target,
    revision: input.revision,
  })
}

/** Critic profile hash: bare sha256 of the reviewer skill bytes (or fallback profile string). */
export function independentCriticProfileHash(profileBytes: string | Uint8Array): string {
  return createHash('sha256').update(profileBytes).digest('hex')
}
