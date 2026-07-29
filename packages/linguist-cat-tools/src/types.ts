/**
 * Public types of @linguist/cat-tools (PB-041).
 *
 * Architecture (plan §4/§7.3): CAT tools are Pi
 * ToolDefinitions built by createLinguistCatTools(). Tool implementations
 * NEVER accept a projectId from model input — the project comes from the
 * SESSION BINDING via the injected `resolveProject`. The Electron main
 * process (PB-042) implements resolveProject from session metadata; tests
 * inject fakes. This package is Electron-free.
 *
 * Output constraints (plan §7.4): every result is JSON-serializable, uses
 * stable content-derived ids, carries pagination info, is capped per call,
 * and contains NO absolute filesystem paths anywhere.
 */

import type {
  BatchConsistencyDimensions,
  BatchConsistencyPass,
  LinguistProject,
  LinguistGenerationProvenance,
  ProposalIssuance,
  OpenQaFindingInput,
  QaFinding,
  QaFindingDisposition,
  QaFindingSeverity,
  QaFindingStatus,
  QaIssueType,
  QaRunOptions,
  Segment,
  SegmentStatus,
  TagToken,
} from '@linguist/cat-core'
import type {
  ContextDocKind,
  ProjectDatabase,
  SentencePattern,
  TermEntry,
  TermEntryMatch,
  TmUnit,
  TmUnitMatch,
} from '@linguist/cat-store'
import type { LinguistCatToolError } from './errors'

/** CAT tool names currently exposed to project sessions. */
export const LINGUIST_CAT_TOOL_NAMES = [
  'cat_project_summary',
  'cat_list_assets',
  'cat_get_segments',
  'cat_get_translation_context',
  'cat_get_proposal_snapshot',
  'cat_search_tm',
  'cat_search_terms',
  'cat_propose_translations',
  'cat_run_qa',
  'cat_get_qa_findings',
  'cat_submit_critic_review',
  'cat_plan_consistency_repairs',
  'cat_create_consistency_proposals',
  'cat_search_sentence_patterns',
  'cat_read_context_doc',
] as const

export type LinguistCatToolName = (typeof LINGUIST_CAT_TOOL_NAMES)[number]

/** Per-call context handed to resolveProject (tool identity only — never model input). */
export interface LinguistCatToolCallInfo {
  toolName: LinguistCatToolName
  toolCallId: string
}

/**
 * The bound project plus a BORROWED open database handle. Ownership stays
 * with the resolver (the Electron service caches handles per project) —
 * tool implementations must NEVER close() it.
 */
export interface ResolvedLinguistCatProject {
  project: LinguistProject
  db: ProjectDatabase
}

/**
 * Binding resolver injected by the host. Returns the resolved project, or a
 * typed LinguistCatToolError (e.g. LinguistCatBindingMissingError) when the
 * session cannot be resolved; throwing a typed error is equivalent.
 * Archived projects resolve normally — read tools continue to work while
 * the store rejects Proposal writes through its read-only guard.
 */
export type ResolveLinguistCatProject = (
  call: LinguistCatToolCallInfo,
) => ResolvedLinguistCatProject | LinguistCatToolError

export interface LinguistQaWorkerRequest {
  segments: readonly Segment[]
  options: QaRunOptions
}

export interface LinguistQaWorkerResult {
  findings: OpenQaFindingInput[]
  workerThreadId: number
}

export type LinguistQaWorker = (
  request: LinguistQaWorkerRequest,
  signal?: AbortSignal,
  onProgress?: (phase: 'started' | 'completed') => void,
) => Promise<LinguistQaWorkerResult>

export interface LinguistConsistencyWorkerRequest {
  segments: readonly Segment[]
  options: QaRunOptions
  persistedFindings: readonly QaFinding[]
}

export interface LinguistConsistencyWorkerResult {
  pass: BatchConsistencyPass
  workerThreadId: number
}

export type LinguistConsistencyWorker = (
  request: LinguistConsistencyWorkerRequest,
  signal?: AbortSignal,
  onProgress?: (phase: 'started' | 'completed') => void,
) => Promise<LinguistConsistencyWorkerResult>

export interface LinguistCatToolsDeps {
  resolveProject: ResolveLinguistCatProject
  /**
   * 宿主会话绑定生成的项目 ID；仅用于成功结果的导航元数据，模型无对应入参。
   * 独立包测试可省略，保持原 DTO 契约。
   */
  resultProjectId?: string
  /**
   * 成功提交写事务后的窄通知。宿主负责补上受信任的 projectId 与单调 revision；
   * 通知失败不得回滚或伪装已提交的 CAT 写入失败。
   */
  onMutation?: (mutation: LinguistCatToolMutation) => void
  /** Proposal creation timestamp; inject for deterministic tests. */
  now?: () => string
  /** Stored as Proposal provenance when present. */
  modelId?: string
  /** Stored as Proposal provenance when present. */
  sessionId?: string
  /** Current-turn host provenance; resolved locally per tool call. */
  generationProvenance?: (toolCallId: string) => LinguistGenerationProvenance
  /**
   * independent-audit exposes evidence reads only. It intentionally omits
   * existing QA conclusions, Proposal candidates and every write tool.
   */
  sessionMode?: 'standard' | 'independent-audit'
  /**
   * Reviewer skill bytes for the critic profileHash (PB-083). Called per
   * cat_submit_critic_review invocation; returning undefined makes the tool
   * fall back to hashing the fixed profile string
   * 'linguist-critic-profile:v1' (the model never supplies identity).
   */
  criticSkillBytes?: () => string | Uint8Array | undefined
  /** Electron injects the packaged node:worker_threads QA entry. */
  qaWorker?: LinguistQaWorker
  /** Electron injects the same packaged worker for full-project consistency analysis. */
  consistencyWorker?: LinguistConsistencyWorker
}

/** CAT Tool 已提交的项目内变更；不含 projectId，避免模型输入影响项目 authority。 */
export interface LinguistCatToolMutation {
  kind: 'proposal-created' | 'qa-updated' | 'project-updated'
  /** cat.db outbox sequence; the host adds its transient push revision. */
  sequence?: number
  segmentIds?: readonly string[]
  proposalIds?: readonly string[]
  qaFindingIds?: readonly string[]
}

/** Page limits (plan §7.4): defaults are small; maximums are HARD caps. */
export const CAT_TOOL_PAGE_LIMITS = {
  listAssets: { defaultLimit: 50, maxLimit: 200 },
  getSegments: { defaultLimit: 20, maxLimit: 100 },
  getTranslationContext: { defaultLimit: 50, maxLimit: 50 },
  searchTm: { defaultLimit: 20, maxLimit: 50 },
  searchTerms: { defaultLimit: 20, maxLimit: 50 },
  getQaFindings: { defaultLimit: 20, maxLimit: 100 },
  searchSentencePatterns: { defaultLimit: 20, maxLimit: 50 },
  /** readContextDoc 的 limit 是字符数（text_extract 分页读）。 */
  readContextDoc: { defaultLimit: 4000, maxLimit: 8000 },
} as const

/** Standard paged envelope (plan §7.4): {items, total, limit, offset, hasMore}. */
export interface PagedResult<TItem> {
  items: TItem[]
  /** Total rows matching the filters (COUNT(*), not a full load). */
  total: number
  /** Effective limit after clamping. */
  limit: number
  offset: number
  hasMore: boolean
  /** Present when the requested limit was clamped to the hard max. */
  note?: string
}

export interface CatProjectSummaryResult {
  project: {
    id: string
    name: string
    sourceLocale: string
    targetLocale: string
    archived: boolean
    createdAt: string
    updatedAt: string
    archivedAt?: string
  }
  assetCount: number
  totalSegments: number
  segmentCounts: Record<SegmentStatus, number>
  /** Present for archived projects: reads are fine, writes are rejected upstream. */
  note?: string
}

export interface CatAssetListItem {
  assetId: string
  /** Import-time file basename (metadata, never a path). */
  filename: string
  formatId: string
  segmentCount: number
  /** Content-derived sha256 of the source bytes (not a path). */
  sourceSha256: string
}

export interface CatSegmentListItem {
  /** Stable opaque identifier; explicit alias retained beside legacy `id`. */
  segmentId: string
  id: string
  assetId: string
  /** Zero-based storage ordinal retained for API compatibility. */
  ordinal: number
  /** One-based original row number shown to users and used in audit references. */
  originalOrdinal: number
  key?: string
  status: SegmentStatus
  locked: boolean
  revision: number
  source: string
  target: string
}

export interface CatSegmentBrief {
  segmentId: string
  revision: number
  source: string
  currentTarget: string
}

export interface CatEvidenceRef {
  id: string
  kind: 'segment-revision' | 'neighbor' | 'term' | 'tm'
}

export interface SegmentTranslationContext {
  segmentId: string
  assetId: string
  revision: number
  source: string
  currentTarget: string
  speaker?: string
  notes?: string
  previous: CatSegmentBrief[]
  next: CatSegmentBrief[]
  tags: TagToken[]
  placeholderSignature: string[]
  /** 仅承载项目明确声明的 Required authority；不得把 preferred 升格。 */
  requiredTerms: TermEntryMatch[]
  forbiddenTerms: TermEntryMatch[]
  preferredTerms: TermEntryMatch[]
  tmMatches: TmUnitMatch[]
  warnings: string[]
  evidence: CatEvidenceRef[]
}

export interface CatGetTranslationContextResult {
  contexts: SegmentTranslationContext[]
  totalRequested: number
  /** Echoes the opaque input cursor; null is the first page. */
  cursor: string | null
  truncated: boolean
  nextCursor?: string
  suggestedSegmentIds?: string[]
  maxBytes: number
  usedBytes: number
}

export type CatProposalReviewSnapshotStatus =
  | 'pending'
  | 'accepted'
  | 'rejected'
  | 'stale'

export interface CatProposalReviewSnapshot {
  snapshotId: string
  snapshotHash: string
  proposalId: string
  status: CatProposalReviewSnapshotStatus
  segmentId: string
  assetId: string
  source: string
  currentTarget: string
  proposedTarget: string
  currentRevision: number
  baseRevision: number
  sourceLocale: string
  targetLocale: string
  context: {
    speaker?: string
    notes?: string
    previous: CatSegmentBrief[]
    next: CatSegmentBrief[]
  }
  evidence: Array<{
    id: string
    kind: 'segment-revision' | 'proposal-evidence' | 'term'
  }>
  issuanceCount: number
  issuances: ProposalIssuance[]
  producer: ProposalIssuance
}

/** Search envelope: capped results + total match count + optional note. */
export interface CatSearchResult<TItem> {
  query: string
  results: TItem[]
  /** Total matches before the limit cap. */
  total: number
  /** Effective limit after clamping. */
  limit: number
  /** Present when results are empty or the limit was clamped. */
  note?: string
}

export interface CatSearchTmResult extends CatSearchResult<TmUnit | TmUnitMatch> {
  /** concordance 保持旧的 source/target substring；match 是 source exact/fuzzy。 */
  mode: 'concordance' | 'match'
}
/** PB-095：TermEntry 带 module/category/imageRef 标注列（可空，缺省不出现）。 */
export type CatSearchTermsResult = CatSearchResult<TermEntry>

/**
 * cat_search_sentence_patterns（PB-095）：句式库按 query/textType/status
 * 过滤的分页结果。条目即 store 的 SentencePattern（id 内容派生稳定）。
 */
export type CatSearchSentencePatternsResult = PagedResult<SentencePattern>

/**
 * cat_read_context_doc（PB-095）：按字符分页读 context doc 的
 * text_extract。图片 kind 或无抽取文本时 text 缺省并带 note 说明——
 * 字节永不进工具输出（输出纪律：无路径、无二进制）。
 */
export interface CatReadContextDocResult {
  docId: string
  kind: ContextDocKind
  /** 导入时的文件 basename（元数据，不是路径）。 */
  filename: string
  createdAt: string
  sha256?: string
  /** 文档自带的备注（doc 元数据）；与工具消息的 note 区分。 */
  docNote?: string
  offset: number
  /** 有效字符上限（clamp 后）。 */
  limit: number
  /** text_extract 全文字符数（无抽取时为 0）。 */
  totalChars: number
  hasMore: boolean
  text?: string
  /** 图片说明 / 无抽取说明 / clamp 提示。 */
  note?: string
}

export interface CatProposeTranslationsResult {
  runId: string
  proposalIds: string[]
}

/** Result of cat_submit_critic_review (PB-083): advisory artifact + finding ids only. */
export interface CatSubmitCriticReviewResult {
  reviewId: string
  artifactId: string
  verdict: 'pass' | 'issues' | 'abstain'
  findingIds: string[]
  qaFindingIds: string[]
  /** Advisory scope only — canCommit is burned to false; repairs go through proposals. */
  repairScope?: {
    authority: 'advisory_finding'
    canCommit: false
    segmentIds: string[]
    findingIds: string[]
  }
}

/** PB-096：cat_run_qa 结果按契约五档 severity 与四值 disposition 计数。 */
export interface CatRunQaResult {
  total: number
  severityCounts: Record<QaFindingSeverity, number>
  dispositionCounts: Record<QaFindingDisposition, number>
}

export interface CatWorkerJobProgress {
  jobProgress: {
    jobId: string
    status: 'pending' | 'running' | 'paused' | 'completed' | 'failed' | 'cancelled'
    cursor: number
    total: number
    completed: number
    failed: number
  }
}

export interface CatQaFindingItem {
  id: string
  segmentId: string
  code: string
  severity: QaFindingSeverity
  issueType: QaIssueType
  disposition: QaFindingDisposition
  message: string
  status: QaFindingStatus
  segmentRevision: number
  ruleVersion: string
  evidenceHash: string
  firstSeenRunId: string
  waiverReason?: string
  criticReviews?: Array<{
    reviewId: string
    criticFindingId: string
    proposalId: string
    snapshotId: string
    snapshotHash: string
    reviewerSessionId: string
    reviewerModelId?: string
    promptVersion: string
  }>
}

/** consistency plan 分组报告里的一条 finding。 */
export interface CatBatchConsistencyFindingItem {
  findingId: string
  segmentId: string
  code: string
  severity: QaFindingSeverity
  message: string
  locked: boolean
}

/** 同 normalized source 的一致性命中与候选；候选计数不代表自动真理。 */
export interface CatBatchConsistencyGroupItem {
  groupId: string
  source: string
  normalizedSource: string
  segmentIds: string[]
  findingIds: string[]
  candidateTargets: Array<{ target: string; count: number; lockedCount: number }>
  dimensions: BatchConsistencyDimensions
  findings: CatBatchConsistencyFindingItem[]
}

/** cat_plan_consistency_repairs：只读快照，planId 绑定 revision/target/lock/finding。 */
export interface CatConsistencyPlanResult {
  planId: string
  findingCount: number
  groupCount: number
  groups: CatBatchConsistencyGroupItem[]
  note?: string
}

/** cat_create_consistency_proposals：仅显式选择生成 pending Proposal。 */
export interface CatCreateConsistencyProposalsResult {
  planId: string
  runId: string
  proposalIds: string[]
}
