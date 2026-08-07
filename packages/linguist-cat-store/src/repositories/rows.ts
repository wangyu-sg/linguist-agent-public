/**
 * Typed row <-> domain mapping. All SQL is parameterized; these helpers are
 * the single place where unknown sqlite rows become cat-core domain types.
 */

import {
  parseCriticReviewArtifact,
  parseIndependentCriticArtifact,
  type Asset,
  type AssetId,
  type CriticReviewArtifact,
  type CurrentStageState,
  type IndependentCriticArtifact,
  type ProjectId,
  type ProposalId,
  type ProposalIssuance,
  type ProposalStatus,
  type QaFinding,
  type QaFindingDisposition,
  type QaFindingId,
  type QaFindingSeverity,
  type QaFindingStatus,
  type QaIssueType,
  type Segment,
  type SegmentContext,
  type SegmentId,
  type SegmentRevision,
  type SegmentRevisionSource,
  type SegmentStatus,
  type TranslationProposal,
} from '@linguist/cat-core'

export interface AssetRow {
  id: string
  project_id: string
  format_id: string
  original_filename: string
  source_sha256: string
  segment_count: number
  format_config_json: string | null
  created_at: string
}

export function assetFromRow(row: AssetRow): Asset {
  return {
    id: row.id as AssetId,
    projectId: row.project_id as ProjectId,
    formatId: row.format_id,
    originalFilename: row.original_filename,
    sourceSha256: row.source_sha256,
    segmentCount: row.segment_count,
    ...(typeof row.format_config_json === 'string' ? { formatConfigJson: row.format_config_json } : {}),
  }
}

export function assetToParams(asset: Asset, createdAt: string): unknown[] {
  return [
    asset.id,
    asset.projectId,
    asset.formatId,
    asset.originalFilename,
    asset.sourceSha256,
    asset.segmentCount,
    asset.formatConfigJson ?? null,
    createdAt,
  ]
}

export interface SegmentRow {
  id: string
  asset_id: string
  ordinal: number
  key: string | null
  source: string
  target: string
  source_locale: string
  target_locale: string
  status: string
  locked: number
  revision: number
  source_hash: string
  context_json: string | null
  current_stage_state: string
  imported_native_status: string | null
}

export function segmentFromRow(row: SegmentRow): Segment {
  const context = row.context_json === null ? undefined : (JSON.parse(row.context_json) as SegmentContext)
  return {
    id: row.id as SegmentId,
    assetId: row.asset_id as AssetId,
    ordinal: row.ordinal,
    ...(row.key !== null ? { key: row.key } : {}),
    source: row.source,
    target: row.target,
    sourceLocale: row.source_locale,
    targetLocale: row.target_locale,
    status: row.status as SegmentStatus,
    currentStageState: row.current_stage_state as CurrentStageState,
    ...(row.imported_native_status !== null
      ? { importedNativeStatus: row.imported_native_status }
      : {}),
    locked: row.locked !== 0,
    revision: row.revision,
    sourceHash: row.source_hash,
    ...(context !== undefined ? { context } : {}),
  }
}

export function segmentToParams(segment: Segment): unknown[] {
  return [
    segment.id,
    segment.assetId,
    segment.ordinal,
    segment.key ?? null,
    segment.source,
    segment.target,
    segment.sourceLocale,
    segment.targetLocale,
    segment.status,
    segment.locked ? 1 : 0,
    segment.revision,
    segment.sourceHash,
    segment.context !== undefined ? JSON.stringify(segment.context) : null,
    segment.currentStageState ?? 'untouched',
    segment.importedNativeStatus ?? null,
  ]
}

export interface SegmentRevisionRow {
  segment_id: string
  revision: number
  target: string
  status: string
  source: string
  created_at: string
}

export function segmentRevisionFromRow(row: SegmentRevisionRow): SegmentRevision {
  return {
    revision: row.revision,
    target: row.target,
    status: row.status as SegmentStatus,
    source: row.source as SegmentRevisionSource,
    createdAt: row.created_at,
  }
}

export interface ProposalRow {
  id: string
  segment_id: string
  base_revision: number
  proposed_target: string
  evidence_refs_json: string
  term_refs_json: string
  warnings_json: string
  model_id: string | null
  session_id: string | null
  run_id: string | null
  reissued_from_proposal_id: string | null
  supersedes_proposal_id: string | null
  created_at: string
  status: string
}

export function proposalFromRow(row: ProposalRow): TranslationProposal {
  return {
    id: row.id as ProposalId,
    segmentId: row.segment_id as SegmentId,
    baseRevision: row.base_revision,
    proposedTarget: row.proposed_target,
    evidenceRefs: JSON.parse(row.evidence_refs_json) as string[],
    termRefs: JSON.parse(row.term_refs_json) as string[],
    warnings: JSON.parse(row.warnings_json) as string[],
    ...(row.model_id !== null ? { modelId: row.model_id } : {}),
    ...(row.session_id !== null ? { sessionId: row.session_id } : {}),
    ...(row.run_id !== null ? { runId: row.run_id } : {}),
    ...(row.reissued_from_proposal_id !== null
      ? { reissuedFromProposalId: row.reissued_from_proposal_id as ProposalId }
      : {}),
    ...(row.supersedes_proposal_id !== null
      ? { supersedesProposalId: row.supersedes_proposal_id as ProposalId }
      : {}),
    createdAt: row.created_at,
    status: row.status as ProposalStatus,
  }
}

export function proposalToParams(proposal: TranslationProposal): unknown[] {
  return [
    proposal.id,
    proposal.segmentId,
    proposal.baseRevision,
    proposal.proposedTarget,
    JSON.stringify(proposal.evidenceRefs),
    JSON.stringify(proposal.termRefs),
    JSON.stringify(proposal.warnings),
    proposal.modelId ?? null,
    proposal.sessionId ?? null,
    proposal.runId ?? null,
    proposal.reissuedFromProposalId ?? null,
    proposal.supersedesProposalId ?? null,
    proposal.createdAt,
    proposal.status,
  ]
}

export interface ProposalIssuanceRow {
  issuance_id: string
  proposal_id: string
  idempotency_key: string | null
  session_id: string | null
  run_id: string | null
  tool_call_id: string | null
  model_provider: string | null
  model_id: string | null
  runtime: string | null
  role: string | null
  strategy: string | null
  linguist_prompt_version: string | null
  prompt_hash: string | null
  project_digest_hash: string | null
  project_digest_revision: string | null
  turn_context_version: number | null
  turn_context_snapshot_json: string | null
  turn_context_hash: string | null
  toolset_hash: string | null
  evidence_refs_json: string
  term_refs_json: string
  created_at: string
}

export function proposalIssuanceFromRow(row: ProposalIssuanceRow): ProposalIssuance {
  return {
    id: row.issuance_id as ProposalIssuance['id'],
    proposalId: row.proposal_id as ProposalIssuance['proposalId'],
    ...(row.idempotency_key === null ? {} : { idempotencyKey: row.idempotency_key }),
    ...(row.session_id === null ? {} : { sessionId: row.session_id }),
    ...(row.run_id === null ? {} : { runId: row.run_id }),
    ...(row.tool_call_id === null ? {} : { toolCallId: row.tool_call_id }),
    ...(row.model_provider === null ? {} : { modelProvider: row.model_provider }),
    ...(row.model_id === null ? {} : { modelId: row.model_id }),
    ...(row.runtime === null ? {} : { runtime: row.runtime }),
    ...(row.strategy === null
      ? {}
      : { strategy: row.strategy as NonNullable<ProposalIssuance['strategy']> }),
    ...(row.linguist_prompt_version === null
      ? {}
      : { linguistPromptVersion: row.linguist_prompt_version }),
    ...(row.prompt_hash === null ? {} : { promptHash: row.prompt_hash }),
    ...(row.project_digest_hash === null
      ? {}
      : { projectDigestHash: row.project_digest_hash }),
    ...(row.project_digest_revision === null
      ? {}
      : { projectDigestRevision: row.project_digest_revision }),
    ...(row.turn_context_version === null
      ? {}
      : { turnContextVersion: row.turn_context_version }),
    ...(row.turn_context_snapshot_json === null
      ? {}
      : { turnContextSnapshot: row.turn_context_snapshot_json }),
    ...(row.turn_context_hash === null ? {} : { turnContextHash: row.turn_context_hash }),
    ...(row.toolset_hash === null ? {} : { toolsetHash: row.toolset_hash }),
    evidenceRefs: JSON.parse(row.evidence_refs_json) as string[],
    termRefs: JSON.parse(row.term_refs_json) as string[],
    createdAt: row.created_at,
  }
}

export function proposalIssuanceToParams(issuance: ProposalIssuance): unknown[] {
  return [
    issuance.id,
    issuance.proposalId,
    issuance.idempotencyKey ?? null,
    issuance.sessionId ?? null,
    issuance.runId ?? null,
    issuance.toolCallId ?? null,
    issuance.modelProvider ?? null,
    issuance.modelId ?? null,
    issuance.runtime ?? null,
    null,
    issuance.strategy ?? null,
    issuance.linguistPromptVersion ?? null,
    issuance.promptHash ?? null,
    issuance.projectDigestHash ?? null,
    issuance.projectDigestRevision ?? null,
    issuance.turnContextVersion ?? null,
    issuance.turnContextSnapshot ?? null,
    issuance.turnContextHash ?? null,
    issuance.toolsetHash ?? null,
    JSON.stringify(issuance.evidenceRefs),
    JSON.stringify(issuance.termRefs),
    issuance.createdAt,
  ]
}

export interface QaFindingRow {
  id: string
  segment_id: string
  code: string
  severity: string
  issue_type: string
  disposition: string
  message: string
  status: string
  segment_revision: number
  waiver_reason: string | null
  waived_by: string | null
  waived_at: string | null
  rule_version: string
  evidence_hash: string
  first_seen_run_id: string
  created_at: string
}

export interface CriticArtifactRow {
  artifact_id: string
  segment_id: string
  created_at: string
  artifact_json: string
}

/**
 * Parse a persisted critic artifact. Parsing is strict: the artifactId and
 * artifactHash are re-derived and verified on every read, so a tampered row
 * fails loudly instead of silently returning altered review content.
 */
export type PersistedCriticArtifact = IndependentCriticArtifact | CriticReviewArtifact

export function criticArtifactFromRow(row: CriticArtifactRow): PersistedCriticArtifact {
  const value = JSON.parse(row.artifact_json) as { schemaVersion?: unknown }
  return value.schemaVersion === 2
    ? parseCriticReviewArtifact(value)
    : parseIndependentCriticArtifact(value)
}

export interface PersistedQaFinding extends QaFinding {
  segmentRevision: number
  ruleVersion: string
  evidenceHash: string
  firstSeenRunId: string
  createdAt: string
  waiverReason?: string
  waivedBy?: string
  waivedAt?: string
}

export function qaFindingFromRow(row: QaFindingRow): PersistedQaFinding {
  return {
    id: row.id as QaFindingId,
    segmentId: row.segment_id as SegmentId,
    code: row.code,
    severity: row.severity as QaFindingSeverity,
    issueType: row.issue_type as QaIssueType,
    disposition: row.disposition as QaFindingDisposition,
    message: row.message,
    status: row.status as QaFindingStatus,
    segmentRevision: row.segment_revision,
    ruleVersion: row.rule_version,
    evidenceHash: row.evidence_hash,
    firstSeenRunId: row.first_seen_run_id,
    createdAt: row.created_at,
    ...(row.waiver_reason !== null ? { waiverReason: row.waiver_reason } : {}),
    ...(row.waived_by !== null ? { waivedBy: row.waived_by } : {}),
    ...(row.waived_at !== null ? { waivedAt: row.waived_at } : {}),
  }
}

// ===== 项目资产六类（PB-095，schema v6）=====
//
// 域类型刻意留在 store 层（同 PB-080 的 TmUnit/TermEntry 先例，不进
// cat-core）：它们是项目资产管理与提示词注入的持久化形状，不参与段/
// 提案/QA 的领域不变量。screenshot_ref / blob_relpath 是项目目录内
// blobs/ 相对路径（可空），绝不存绝对路径。

/** Style Guide 规则（分组规则行 + ✅/❌ 对照例）。 */
export interface StyleGuideRule {
  id: string
  groupKey?: string
  ruleText: string
  sourceExample?: string
  goodExample?: string
  badExample?: string
  /** blobs/ 相对路径（v1 仅预留列，IPC 不开放写入）。 */
  screenshotRef?: string
  updatedAt: string
  updatedBy?: string
}

export interface StyleGuideRuleRow {
  id: string
  project_id: string
  group_key: string | null
  rule_text: string
  source_example: string | null
  good_example: string | null
  bad_example: string | null
  screenshot_ref: string | null
  updated_at: string
  updated_by: string | null
}

export function styleGuideRuleFromRow(row: StyleGuideRuleRow): StyleGuideRule {
  return {
    id: row.id,
    ...(row.group_key !== null ? { groupKey: row.group_key } : {}),
    ruleText: row.rule_text,
    ...(row.source_example !== null ? { sourceExample: row.source_example } : {}),
    ...(row.good_example !== null ? { goodExample: row.good_example } : {}),
    ...(row.bad_example !== null ? { badExample: row.bad_example } : {}),
    ...(row.screenshot_ref !== null ? { screenshotRef: row.screenshot_ref } : {}),
    updatedAt: row.updated_at,
    ...(row.updated_by !== null ? { updatedBy: row.updated_by } : {}),
  }
}

export type SentencePatternStatus = 'confirmed' | 'pending' | 'rejected'

/** 句式（参考句式库）：源文 + 草稿/建议译文 + 评审状态机。 */
export interface SentencePattern {
  id: string
  textType?: string
  module?: string
  source: string
  draftTarget?: string
  suggestedTarget?: string
  reviewer?: string
  status: SentencePatternStatus
  createdAt: string
  updatedAt: string
}

export interface SentencePatternRow {
  id: string
  project_id: string
  text_type: string | null
  module: string | null
  source: string
  draft_target: string | null
  suggested_target: string | null
  reviewer: string | null
  status: SentencePatternStatus
  created_at: string
  updated_at: string
}

export function sentencePatternFromRow(row: SentencePatternRow): SentencePattern {
  return {
    id: row.id,
    ...(row.text_type !== null ? { textType: row.text_type } : {}),
    ...(row.module !== null ? { module: row.module } : {}),
    source: row.source,
    ...(row.draft_target !== null ? { draftTarget: row.draft_target } : {}),
    ...(row.suggested_target !== null ? { suggestedTarget: row.suggested_target } : {}),
    ...(row.reviewer !== null ? { reviewer: row.reviewer } : {}),
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

export type ContextDocKind = 'doc' | 'image'

/**
 * Context 资料（背景文档/图片）。字节落项目 blobs/ 目录，本行只存
 * 元数据；纯文本/md 的抽取直存 text_extract（可空），图片永不抽取。
 */
export interface ContextDoc {
  id: string
  kind: ContextDocKind
  originalFilename: string
  /** 项目目录内 blobs/ 相对路径（如 blobs/ctx-<id>.png）。 */
  blobRelpath: string
  sha256?: string
  note?: string
  textExtract?: string
  createdAt: string
}

export interface ContextDocRow {
  id: string
  project_id: string
  kind: ContextDocKind
  original_filename: string
  blob_relpath: string
  sha256: string | null
  note: string | null
  text_extract: string | null
  created_at: string
}

/** TM/TB 原始导入文件的受管来源（schema v14）。 */
export interface ReferenceImportRow {
  id: string
  project_id: string
  kind: 'tm' | 'terms'
  original_filename: string
  source_sha256: string
  blob_relpath: string
  created_at: string
}

export function referenceImportFromRow(row: ReferenceImportRow): import('./reference-imports').ReferenceImport {
  return {
    id: row.id,
    kind: row.kind,
    originalFilename: row.original_filename,
    sourceSha256: row.source_sha256,
    blobRelpath: row.blob_relpath,
    createdAt: row.created_at,
  }
}

export function contextDocFromRow(row: ContextDocRow): ContextDoc {
  return {
    id: row.id,
    kind: row.kind,
    originalFilename: row.original_filename,
    blobRelpath: row.blob_relpath,
    ...(row.sha256 !== null ? { sha256: row.sha256 } : {}),
    ...(row.note !== null ? { note: row.note } : {}),
    ...(row.text_extract !== null ? { textExtract: row.text_extract } : {}),
    createdAt: row.created_at,
  }
}

export type TechConstraintKind = 'length' | 'rich_text' | 'tag_note'

/** 技术约束（长度/富文本/标签说明）；value_json 为结构化负载。 */
export interface TechConstraint {
  id: string
  kind: TechConstraintKind
  /** 约束作用域（text_type 或资产级；可空 = 全局）。 */
  scope?: string
  valueJson: string
  note?: string
  updatedAt: string
}

export interface TechConstraintRow {
  id: string
  project_id: string
  kind: TechConstraintKind
  scope: string | null
  value_json: string
  note: string | null
  updated_at: string
}

export function techConstraintFromRow(row: TechConstraintRow): TechConstraint {
  return {
    id: row.id,
    kind: row.kind,
    ...(row.scope !== null ? { scope: row.scope } : {}),
    valueJson: row.value_json,
    ...(row.note !== null ? { note: row.note } : {}),
    updatedAt: row.updated_at,
  }
}

/** 角色声口表（speaker 行的语域/人称/语气标记/禁忌）。 */
export interface VoiceProfile {
  id: string
  speaker: string
  textType?: string
  register?: string
  person?: string
  toneMarkers?: string[]
  taboos?: string[]
  notes?: string
  updatedAt: string
  updatedBy?: string
}

export interface VoiceProfileRow {
  id: string
  project_id: string
  speaker: string
  text_type: string | null
  register: string | null
  person: string | null
  tone_markers: string | null
  taboos: string | null
  notes: string | null
  updated_at: string
  updated_by: string | null
}

/** JSON 数组列的防御性解析：损坏行降级为缺省而非掀翻读取。 */
function stringArrayFromJson(value: string | null): string[] | undefined {
  if (value === null) return undefined
  try {
    const parsed: unknown = JSON.parse(value)
    if (!Array.isArray(parsed)) return undefined
    return parsed.filter((item): item is string => typeof item === 'string')
  } catch {
    return undefined
  }
}

export function voiceProfileFromRow(row: VoiceProfileRow): VoiceProfile {
  const toneMarkers = stringArrayFromJson(row.tone_markers)
  const taboos = stringArrayFromJson(row.taboos)
  return {
    id: row.id,
    speaker: row.speaker,
    ...(row.text_type !== null ? { textType: row.text_type } : {}),
    ...(row.register !== null ? { register: row.register } : {}),
    ...(row.person !== null ? { person: row.person } : {}),
    ...(toneMarkers !== undefined ? { toneMarkers } : {}),
    ...(taboos !== undefined ? { taboos } : {}),
    ...(row.notes !== null ? { notes: row.notes } : {}),
    updatedAt: row.updated_at,
    ...(row.updated_by !== null ? { updatedBy: row.updated_by } : {}),
  }
}
