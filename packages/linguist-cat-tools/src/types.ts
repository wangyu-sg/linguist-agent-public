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
  ContextAnchor,
  ContextExtractionWarning,
  EvidenceGap,
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
  WorkflowStage,
  WorkflowStageDecision,
  TagToken,
  SaveTagProfileCandidateInput,
  TagCandidateValidationResult,
  UnknownTagPatternResult,
  WorkbookMappingColumns,
  LinguistWorkbookMappingProfile,
  TmAgentEvidence,
  TmMatchDiagnostics,
} from '@linguist/cat-core'
import type {
  ContextDocKind,
  ApprovedExemplar,
  ProjectDatabase,
  SentencePattern,
  TermEntry,
  TermEntryMatch,
  TmUnit,
  VoiceProfile,
} from '@linguist/cat-store'
import type { LinguistCatToolError } from './errors'

/** CAT tool names currently exposed to project sessions. */
export const LINGUIST_CAT_TOOL_NAMES = [
  'cat_project_summary',
  'cat_list_assets',
  'cat_get_segments',
  'cat_import_resources',
  'cat_refresh_project_inventory',
  'cat_import_asset',
  'cat_preview_workbook_mapping',
  'cat_save_workbook_mapping',
  'cat_upsert_voice_profile',
  'cat_add_approved_exemplar',
  'cat_get_voice_context',
  'cat_scan_unknown_tag_patterns',
  'cat_save_tag_profile_candidate',
  'cat_export_asset',
  'cat_get_translation_context',
  'cat_get_proposal_snapshot',
  'cat_apply_translations',
  'cat_confirm_segments',
  'cat_search_tm',
  'cat_search_terms',
  'cat_upsert_terms',
  'cat_delete_terms',
  'cat_list_term_conflicts',
  'cat_validate_terms',
  'cat_propose_translations',
  'cat_accept_proposals',
  'cat_run_qa',
  'cat_get_qa_findings',
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
  /** 当前受信任 Linguist 岗位；cat_confirm_segments 由此推导 stage。 */
  linguistRole?: 'general' | 'translator' | 'reviewer' | 'proofreader'
  /** 宿主创建或恢复的冻结 Stage Evidence 执行；模型无对应入参。 */
  stageEvidenceRunId?: string
  /** 委派时冻结的 Segment 范围；模型无对应入参。 */
  reviewScopeSegmentIds?: readonly string[]
  /** Current-turn host provenance; resolved locally per tool call. */
  generationProvenance?: (toolCallId: string) => LinguistGenerationProvenance
  /** 读取已绑定项目的受管 Context 图片；宿主负责路径授权与图片校验。 */
  readContextImage?: (docId: string) => Promise<{ data: string; mimeType: string }>
  /** Electron injects the packaged node:worker_threads QA entry. */
  qaWorker?: LinguistQaWorker
  /** Electron injects the same packaged worker for full-project consistency analysis. */
  consistencyWorker?: LinguistConsistencyWorker
  /** 导入会话工作目录或已授权目录/文件中的项目资源。 */
  importIntakeAsset?: (
    filePath: string,
    resourceKind: LinguistIntakeResourceKind,
    xlsxMapping?: LinguistIntakeXlsxMapping,
  ) => Promise<LinguistIntakeImportResult>
  /** 导入文件或目录中的多个资源；路径权限沿用 Proma Session。 */
  importResources?: (input: LinguistImportResourcesInput) => Promise<LinguistImportResourcesResult>
  /** 由宿主扫描当前项目授权范围；模型不能提供或扩张路径。 */
  refreshProjectEvidenceInventory?: () => Promise<LinguistProjectEvidenceInventoryResult>
  /** 读取 XLSX 证据并给出确定性列映射建议；宿主负责路径授权。 */
  previewWorkbookMapping?: (filePath: string) => Promise<LinguistWorkbookMappingPreview>
  /** 重新读取并校验 XLSX 后保存当前绑定项目的轻量 mapping profile。 */
  saveWorkbookMapping?: (
    filePath: string,
    input: LinguistSaveWorkbookMappingInput,
  ) => Promise<LinguistWorkbookMappingProfile>
  /** 把已绑定项目的批次保存为新的本地文件；宿主校验路径与会话 authority。 */
  exportAsset?: (
    assetId: string,
    destinationPath: string,
    validation: 'verified' | 'as-is',
    overwrite: boolean,
  ) => Promise<LinguistExportAssetResult>
  /** 当前绑定项目的确定性未知 Tag 形状扫描。 */
  scanUnknownTagPatterns?: (
    assetIds?: readonly string[],
    sampleLimit?: number,
  ) => UnknownTagPatternResult[]
  /** 验证并持久化 Tag Profile 候选；明确要求时可紧接激活。 */
  saveTagProfileCandidate?: (
    input: SaveTagProfileCandidateInput,
    activate: boolean,
  ) => {
    candidateId: string
    status: 'candidate' | 'active'
    validation: TagCandidateValidationResult
  }
}

export interface LinguistExportAssetResult {
  filename: string
  sha256: string
  sizeBytes: number
  verifiedAt: string
  verifiedSegments: number
  validation: 'verified' | 'as-is'
}

export type LinguistIntakeResourceKind = 'batch' | 'tm' | 'terms' | 'context'
export type LinguistImportResourceKind = 'auto' | 'batch' | 'tm' | 'tb' | 'context'

export interface LinguistImportResourcesInput {
  paths: string[]
  recursive: boolean
  kind: LinguistImportResourceKind
  dryRun: boolean
  xlsxMapping?: LinguistIntakeXlsxMapping
}

export interface LinguistImportResourceItem {
  filename: string
  status: 'imported' | 'skipped-duplicate' | 'needs-input' | 'unsupported' | 'failed' | 'ready'
  resourceKind?: LinguistIntakeResourceKind
  resourceId?: string
  sourceSha256?: string
  message?: string
  unknownTagSummary?: UnknownTagPatternResult[]
}

export interface LinguistImportResourcesResult {
  found: number
  ready: number
  imported: number
  skippedDuplicate: number
  needsInput: number
  unsupported: number
  failed: number
  truncated: boolean
  items: LinguistImportResourceItem[]
}

export interface LinguistProjectEvidenceInventoryResult {
  status: 'ready' | 'needs-input' | 'blocked'
  discoveryScopeHash: string
  discovered: number
  registered: number
  readyToImport: number
  unmapped: number
  media: number
  versionConflicts: number
  unsupported: number
  failed: number
  truncated: boolean
  items: LinguistImportResourceItem[]
  gaps: EvidenceGap[]
}

export interface LinguistIntakeXlsxMapping {
  sheetName: string
  columns: {
    key?: string
    source: string
    target: string
    locked?: string
    context?: string
  }
}

export interface LinguistIntakeImportResult {
  resourceKind: LinguistIntakeResourceKind
  filename: string
  status: 'imported' | 'skipped-duplicate'
  resourceId: string
  importedCount: number
  unchangedCount: number
  sourceSha256: string
  warnings: string[]
  unknownTagSummary?: UnknownTagPatternResult[]
}

export interface LinguistWorkbookMappingSuggestion {
  columns: Partial<WorkbookMappingColumns>
  confidence: number
  reasons: string[]
}

export interface LinguistWorkbookMappingPreview {
  filename: string
  workbookFingerprint: string
  matchedProfileId?: string
  sheets: Array<{
    name: string
    state: 'visible' | 'hidden' | 'veryHidden'
    headerRowNumbers: number[]
    headerSignature: string
    headers: Array<{ ref: string; value: string }>
    sampleRows: Array<{
      rowNo: number
      cells: Array<{
        ref: string
        value: string
        kind: 'text' | 'formula-cached' | 'formula-no-cache' | 'error' | 'empty'
      }>
    }>
    mergedRanges: Array<{ ref: string; anchor: string; coveredCells: number }>
    truncated: boolean
    suggestion: LinguistWorkbookMappingSuggestion
  }>
  skippedSheets: Array<{ name: string; state: 'visible' | 'hidden' | 'veryHidden'; reason: string }>
}

export interface LinguistSaveWorkbookMappingInput {
  name?: string
  filenamePattern?: string
  sheetName: string
  columns: WorkbookMappingColumns
}

export interface CatVoiceContextResult {
  speaker: string
  textType?: string
  module?: string
  profile?: VoiceProfile
  exemplars: ApprovedExemplar[]
  note?: string
}

/** CAT Tool 已提交的项目内变更；不含 projectId，避免模型输入影响项目 authority。 */
export interface LinguistCatToolMutation {
  kind: 'proposal-created' | 'qa-updated' | 'project-updated'
  /** cat.db outbox sequence; the host adds its transient push revision. */
  sequence?: number
  segmentIds?: readonly string[]
  proposalIds?: readonly string[]
  qaFindingIds?: readonly string[]
  resolvedQaFindingIds?: readonly string[]
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

export interface CatApplyTranslationsResult {
  requested: number
  applied: number
  pending: number
  stale: string[]
  locked: string[]
  failed: Array<{ segmentId: string; code: string }>
  proposalIds: string[]
}

export interface CatConfirmSegmentsResult {
  stage: WorkflowStage
  decisions: Array<{
    segmentId: string
    decision: WorkflowStageDecision
    revision: number
  }>
  coverage: {
    scope: 'items' | 'delegated'
    total: number
    unchanged: number
    corrected: number
    blocked: number
    pending: number
    status: 'in_progress' | 'complete' | 'completed_with_blocks'
  }
  /** 宿主签发的双覆盖完成状态；Segment decision complete 不能替代 Evidence complete。 */
  fullReview?: {
    status: 'in_progress' | 'blocked' | 'stale' | 'complete'
    requiredEvidence: number
    presentedEvidence: number
    pendingEvidence: number
    blockingGaps: number
    warnings: number
  }
  replayed: boolean
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

export interface CatLinkedContextEvidence {
  docId: string
  filename: string
  anchorId?: string
  locator?: ContextAnchor['locator']
  text: string
  requiredness: 'required' | 'conditional' | 'optional'
}

export interface CatRequiredEvidencePending {
  docId: string
  filename: string
  anchorIds: string[]
  kind: 'document' | 'image'
  reason: string
}

export interface SegmentTranslationContext {
  segmentId: string
  assetId: string
  revision: number
  /** LA-CONTEXT-002：返回页永不空、永不截半截；预算只裁次级字段。 */
  source: string
  currentTarget: string
  locked: boolean
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
  conflicts: TermEntryMatch[]
  tm: TmAgentEvidence[]
  /** 已自动进入本次工具结果的小型强关联 Context 正文。 */
  linkedContext: CatLinkedContextEvidence[]
  warnings: string[]
  evidence: CatEvidenceRef[]
}

/** LA-CONTEXT-001：第一页自动注入的项目规则快照条目。 */
export interface CatProjectRuleItem {
  ruleId: string
  groupKey?: string
  ruleText: string
  /** 规则关联的受管引用（StyleGuideRule.screenshotRef）；无引用时缺省。 */
  referenceId?: string
}

export interface CatGetTranslationContextResult {
  contexts: SegmentTranslationContext[]
  totalRequested: number
  /** Echoes the opaque input cursor; null is the first page. */
  cursor: string | null
  truncated: boolean
  nextCursor?: string
  suggestedSegmentIds?: string[]
  /** 仅第一页（offset=0）自动注入；条数有界。 */
  projectRules?: CatProjectRuleItem[]
  /** 必需但尚未进入模型请求的大型文档或视觉证据。 */
  requiredEvidencePending?: CatRequiredEvidencePending[]
  /** 宿主签发的 Stage Evidence 覆盖；Agent 文本不能改写。 */
  stageEvidence?: {
    stageRunId: string
    status: 'planning' | 'ready' | 'ready-with-gaps' | 'stale' | 'complete'
    required: number
    presented: number
    pending: number
  }
  /**
   * LA-CONTEXT-002：预算连下一段最小核心都放不下时返回（contexts 为空、
   * cursor 不推进），取值是重试该页所需的最低 maxBytes。
   */
  minimumRequiredBytes?: number
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

export interface CatSearchTmResult extends CatSearchResult<TmUnit | TmMatchDiagnostics> {
  /** concordance 是显式字面搜索；segment 使用完整 Segment Matcher。 */
  mode: 'concordance' | 'segment'
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
 * text_extract。图片 kind 或无抽取文本时 text 缺省并带 note 说明；
 * 图片字节只能作为 Pi ImageContent 返回，details 仍不含路径或二进制。
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
  /** 可定位的页、段落、单元格或图片锚点；不含媒体字节。 */
  anchors?: ContextAnchor[]
  /** 从父文档抽取的受管媒体，需按 docId 再读取才会进入模型请求。 */
  extractedMedia?: Array<{
    docId: string
    filename: string
    anchorIds: string[]
  }>
  /** 抽取时产生的显式缺口或降级说明。 */
  extractionWarnings?: ContextExtractionWarning[]
  /** 图片说明 / 无抽取说明 / clamp 提示。 */
  note?: string
}

export interface CatProposeTranslationsResult {
  runId: string
  proposalIds: string[]
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
