/**
 * Independent Critic artifact contract (PB-083).
 *
 * Extracted from legacy linguist-agent@la-v2-legacy-freeze-2026-07-25
 * `packages/cat-data/src/independent_critic.ts`; validation and error
 * behavior remain compatible. New ids use Stable ID v2 while parsers retain
 * legacy id support. `isCitableEvidenceSource` comes from `./evidence`.
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

import { isCitableEvidenceSource } from './evidence'
import { sha256Hex } from './hash'
import { deriveStableIdV2 } from './ids'
import {
  QA_FINDING_SEVERITIES,
  QA_ISSUE_TYPES,
  type QaFindingSeverity,
  type QaIssueType,
} from './issue-type'
import type { LinguistGenerationProvenance } from './proposal-issuance'

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

export type CriticReviewVerdict = 'pass' | 'issues' | 'abstain'

export interface CriticReviewSnapshotRef {
  snapshotId: string
  snapshotHash: string
  proposalId: string
}

export interface CriticReviewerProvenance extends IndependentCriticIdentity {
  sessionId: string
  modelId?: string
  /** SHA-256 of the exact reviewer prompt/skill bytes used for the review. */
  promptVersion: string
  generation?: LinguistGenerationProvenance
}

export interface CriticReviewArtifact {
  schemaVersion: 2
  authority: 'advisory_finding'
  canCommit: false
  artifactId: string
  snapshot: CriticReviewSnapshotRef
  subject: IndependentCriticSubject
  reviewer: CriticReviewerProvenance
  verdict: CriticReviewVerdict
  summary?: string
  reason?: string
  findings: IndependentCriticFinding[]
  artifactHash: string
}

export type CreateCriticReviewRequest =
  & {
    schemaVersion: 2
    snapshot: CriticReviewSnapshotRef
    subject: IndependentCriticSubject
    reviewer: CriticReviewerProvenance
  }
  & (
    | { verdict: 'pass'; summary?: string; findings: [] }
    | { verdict: 'issues'; summary: string; findings: IndependentCriticFindingDraft[] }
    | { verdict: 'abstain'; reason: string; findings: [] }
  )

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
const LEGACY_ARTIFACT_ID = /^critic:[a-f0-9]{24}$/u
const V2_ARTIFACT_ID = /^critic_v2_[a-f0-9]{64}$/u
const LEGACY_FINDING_ID = /^cf:[a-f0-9]{24}$/u
const V2_FINDING_ID = /^cf_v2_[a-f0-9]{64}$/u
type ContentIdVersion = 'v1' | 'v2'
const textEncoder = new TextEncoder()

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
  return sha256Hex(textEncoder.encode(JSON.stringify(canonicalize(value))))
}

function contentId(entityType: 'critic' | 'cf', value: unknown, version: ContentIdVersion): string {
  const content = JSON.stringify(canonicalize(value))
  return version === 'v1'
    ? `${entityType}:${sha256Hex(textEncoder.encode(content)).slice(0, 24)}`
    : deriveStableIdV2(entityType, [content])
}

function readArtifactId(value: unknown, label: string): {
  id: string
  version: ContentIdVersion
} {
  const id = text(value, 'artifactId')
  if (LEGACY_ARTIFACT_ID.test(id)) return { id, version: 'v1' }
  if (V2_ARTIFACT_ID.test(id)) return { id, version: 'v2' }
  throw new Error(`${label} artifactId changed.`)
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

function parseReviewSnapshot(value: unknown): CriticReviewSnapshotRef {
  if (!isRecord(value)) throw new Error('snapshot must be an object.')
  knownFields(value, ['snapshotId', 'snapshotHash', 'proposalId'], 'snapshot')
  return {
    snapshotId: text(value.snapshotId, 'snapshot.snapshotId'),
    snapshotHash: sha256(value.snapshotHash, 'snapshot.snapshotHash'),
    proposalId: text(value.proposalId, 'snapshot.proposalId'),
  }
}

function parseReviewer(value: unknown): CriticReviewerProvenance {
  if (!isRecord(value)) throw new Error('reviewer must be an object.')
  knownFields(
    value,
    ['criticId', 'executionId', 'profileHash', 'sessionId', 'modelId', 'promptVersion', 'generation'],
    'reviewer',
  )
  const identity = parseCritic({
    criticId: value.criticId,
    executionId: value.executionId,
    profileHash: value.profileHash,
  }, 'reviewer')
  const sessionId = text(value.sessionId, 'reviewer.sessionId')
  if (sessionId !== identity.executionId) {
    throw new Error('reviewer.sessionId must match reviewer.executionId.')
  }
  return {
    ...identity,
    sessionId,
    ...(value.modelId === undefined ? {} : { modelId: text(value.modelId, 'reviewer.modelId') }),
    promptVersion: sha256(value.promptVersion, 'reviewer.promptVersion'),
    ...(value.generation === undefined
      ? {}
      : { generation: parseGenerationProvenance(value.generation) }),
  }
}

function parseGenerationProvenance(value: unknown): LinguistGenerationProvenance {
  if (!isRecord(value)) throw new Error('reviewer.generation must be an object.')
  const fields = [
    'sessionId',
    'runId',
    'toolCallId',
    'modelProvider',
    'modelId',
    'runtime',
    'role',
    'strategy',
    'linguistPromptVersion',
    'promptHash',
    'projectDigestHash',
    'projectDigestRevision',
    'turnContextVersion',
    'turnContextSnapshot',
    'turnContextHash',
    'toolsetHash',
  ] as const
  knownFields(value, fields, 'reviewer.generation')
  const result: LinguistGenerationProvenance = {}
  for (const field of [
    'sessionId',
    'runId',
    'toolCallId',
    'modelProvider',
    'modelId',
    'runtime',
    'linguistPromptVersion',
    'projectDigestRevision',
  ] as const) {
    if (value[field] !== undefined) result[field] = text(value[field], `reviewer.generation.${field}`)
  }
  for (const field of ['promptHash', 'projectDigestHash', 'turnContextHash', 'toolsetHash'] as const) {
    if (value[field] !== undefined) result[field] = sha256(value[field], `reviewer.generation.${field}`)
  }
  if (value.role !== undefined) {
    if (!(['assistant', 'reviewer', 'auditor'] as const).includes(value.role as never)) {
      throw new Error('reviewer.generation.role is invalid.')
    }
    result.role = value.role as NonNullable<LinguistGenerationProvenance['role']>
  }
  if (value.strategy !== undefined) {
    if (!(['fast', 'balanced', 'best'] as const).includes(value.strategy as never)) {
      throw new Error('reviewer.generation.strategy is invalid.')
    }
    result.strategy = value.strategy as NonNullable<LinguistGenerationProvenance['strategy']>
  }
  if (value.turnContextVersion !== undefined) {
    if (!Number.isInteger(value.turnContextVersion) || (value.turnContextVersion as number) < 0) {
      throw new Error('reviewer.generation.turnContextVersion must be a non-negative integer.')
    }
    result.turnContextVersion = value.turnContextVersion as number
  }
  if (value.turnContextSnapshot !== undefined) {
    const snapshot = text(value.turnContextSnapshot, 'reviewer.generation.turnContextSnapshot')
    let parsed: unknown
    try {
      parsed = JSON.parse(snapshot)
    } catch {
      throw new Error('reviewer.generation.turnContextSnapshot must be JSON.')
    }
    if (JSON.stringify(canonicalize(parsed)) !== snapshot) {
      throw new Error('reviewer.generation.turnContextSnapshot must be canonical JSON.')
    }
    result.turnContextSnapshot = snapshot
  }
  return result
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

function createFindings(
  subject: IndependentCriticSubject,
  critic: IndependentCriticIdentity,
  drafts: readonly IndependentCriticFindingDraft[],
  version: ContentIdVersion,
): IndependentCriticFinding[] {
  if (!drafts.length) throw new Error('Independent Critic requires at least one structured finding.')
  return drafts.map((finding, index) => {
    const draft = parseFindingDraft(finding, `findings[${index}]`)
    return {
      findingId: contentId('cf', { subject, critic, draft, index }, version),
      criticId: critic.criticId,
      ...draft,
    }
  })
}

function artifactWithoutHash(
  subject: IndependentCriticSubject,
  critic: IndependentCriticIdentity,
  findings: IndependentCriticFinding[],
  version: ContentIdVersion,
): Omit<IndependentCriticArtifact, 'artifactHash'> {
  const artifactId = contentId('critic', { subject, critic, findings }, version)
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
  const findings = createFindings(subject, critic, request.findings, 'v2')
  const withoutHash = artifactWithoutHash(subject, critic, findings, 'v2')
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
  const { id: storedArtifactId, version } = readArtifactId(value.artifactId, 'Independent Critic')
  const findings = value.findings.map((finding, index) => {
    if (!isRecord(finding)) throw new Error(`findings[${index}] must be an object.`)
    knownFields(finding, ['findingId', 'criticId', 'category', 'severity', 'issueType', 'evidenceRefs', 'explanation', 'suggestedRepair'], `findings[${index}]`)
    const draft = parseFindingDraft(finding, `findings[${index}]`, true)
    const findingId = text(finding.findingId, `findings[${index}].findingId`)
    if (!(version === 'v1' ? LEGACY_FINDING_ID : V2_FINDING_ID).test(findingId)) {
      throw new Error(`findings[${index}] findingId changed.`)
    }
    if (text(finding.criticId, `findings[${index}].criticId`) !== critic.criticId) throw new Error(`findings[${index}] criticId differs from artifact critic.`)
    return { findingId, criticId: critic.criticId, ...draft }
  })
  if (!findings.length || new Set(findings.map((finding) => finding.findingId)).size !== findings.length) throw new Error('Independent Critic findings must be non-empty and uniquely identified.')
  const withoutHash = artifactWithoutHash(subject, critic, findings, version)
  if (storedArtifactId !== withoutHash.artifactId) throw new Error('Independent Critic artifactId changed.')
  if (sha256(value.artifactHash, 'artifactHash') !== hash(withoutHash)) throw new Error('Independent Critic artifactHash changed.')
  return deepFreeze({ ...withoutHash, artifactHash: hash(withoutHash) })
}

function createCriticReviewFields(
  request: CreateCriticReviewRequest,
  version: ContentIdVersion,
): Omit<CriticReviewArtifact, 'artifactId' | 'artifactHash'> {
  if (!isRecord(request) || request.schemaVersion !== 2 || !Array.isArray(request.findings)) {
    throw new Error('Unsupported Critic Review request.')
  }
  const snapshot = parseReviewSnapshot(request.snapshot)
  const subject = parseSubject(request.subject)
  const reviewer = parseReviewer(request.reviewer)
  assertIndependent(subject, reviewer)
  if (snapshot.proposalId !== subject.candidateId) {
    throw new Error('Critic Review snapshot proposal differs from the candidate.')
  }
  if (!(['pass', 'issues', 'abstain'] as const).includes(request.verdict)) {
    throw new Error('Critic Review verdict is invalid.')
  }
  const summary = 'summary' in request && request.summary !== undefined
    ? text(request.summary, 'summary')
    : undefined
  const reason = 'reason' in request && request.reason !== undefined
    ? text(request.reason, 'reason')
    : undefined
  let findings: IndependentCriticFinding[] = []
  if (request.verdict === 'issues') {
    if (summary === undefined) throw new Error('Issues review requires a summary.')
    findings = createFindings(subject, {
      criticId: reviewer.criticId,
      executionId: reviewer.executionId,
      profileHash: reviewer.profileHash,
    }, request.findings, version)
    if (reason !== undefined) throw new Error('Issues review cannot contain an abstain reason.')
  } else {
    if (request.findings.length > 0) throw new Error(`${request.verdict} review cannot contain findings.`)
    if (request.verdict === 'abstain' && reason === undefined) {
      throw new Error('Abstain review requires a reason.')
    }
    if (request.verdict === 'pass' && reason !== undefined) {
      throw new Error('Pass review cannot contain an abstain reason.')
    }
  }
  return {
    schemaVersion: 2,
    authority: 'advisory_finding',
    canCommit: false,
    snapshot,
    subject,
    reviewer,
    verdict: request.verdict,
    ...(summary === undefined ? {} : { summary }),
    ...(reason === undefined ? {} : { reason }),
    findings,
  }
}

export function createCriticReviewArtifact(request: CreateCriticReviewRequest): CriticReviewArtifact {
  const fields = createCriticReviewFields(request, 'v2')
  const artifactId = contentId('critic', fields, 'v2')
  const withoutHash = { ...fields, artifactId }
  return deepFreeze({ ...withoutHash, artifactHash: hash(withoutHash) })
}

export function parseCriticReviewArtifact(value: unknown): CriticReviewArtifact {
  if (!isRecord(value)) throw new Error('Critic Review artifact must be an object.')
  knownFields(
    value,
    [
      'schemaVersion',
      'authority',
      'canCommit',
      'artifactId',
      'snapshot',
      'subject',
      'reviewer',
      'verdict',
      'summary',
      'reason',
      'findings',
      'artifactHash',
    ],
    'Critic Review artifact',
  )
  if (
    value.schemaVersion !== 2 ||
    value.authority !== 'advisory_finding' ||
    value.canCommit !== false ||
    !Array.isArray(value.findings)
  ) {
    throw new Error('Critic Review artifact contract is invalid.')
  }
  const { id: storedArtifactId, version } = readArtifactId(value.artifactId, 'Critic Review')
  const fields = createCriticReviewFields({
    schemaVersion: 2,
    snapshot: value.snapshot as CriticReviewSnapshotRef,
    subject: value.subject as IndependentCriticSubject,
    reviewer: value.reviewer as CriticReviewerProvenance,
    verdict: value.verdict as CriticReviewVerdict,
    ...(value.summary === undefined ? {} : { summary: value.summary as string }),
    ...(value.reason === undefined ? {} : { reason: value.reason as string }),
    findings: value.findings.map((finding) => {
      if (!isRecord(finding)) return finding as never
      const { findingId: _findingId, criticId: _criticId, ...draft } = finding
      return draft as unknown as IndependentCriticFindingDraft
    }),
  } as CreateCriticReviewRequest, version)
  const artifactId = contentId('critic', fields, version)
  if (storedArtifactId !== artifactId) {
    throw new Error('Critic Review artifactId changed.')
  }
  const withoutHash = { ...fields, artifactId }
  if (sha256(value.artifactHash, 'artifactHash') !== hash(withoutHash)) {
    throw new Error('Critic Review artifactHash changed.')
  }
  const storedFindingIds = value.findings.map((finding, index) =>
    isRecord(finding) ? text(finding.findingId, `findings[${index}].findingId`) : '',
  )
  const storedCriticIds = value.findings.map((finding, index) =>
    isRecord(finding) ? text(finding.criticId, `findings[${index}].criticId`) : '',
  )
  if (
    storedFindingIds.length !== fields.findings.length ||
    storedFindingIds.some((findingId, index) => findingId !== fields.findings[index]!.findingId) ||
    storedCriticIds.some((criticId) => criticId !== fields.reviewer.criticId)
  ) {
    throw new Error('Critic Review finding identity changed.')
  }
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
  return sha256Hex(typeof profileBytes === 'string' ? textEncoder.encode(profileBytes) : profileBytes)
}
