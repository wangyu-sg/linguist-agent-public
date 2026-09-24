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
  RecordStageEvidenceReceiptInput,
  VoiceProfile,
  ProjectRule,
} from '@linguist/cat-store'
import type { AgentToolResult } from '@earendil-works/pi-coding-agent'
import type { LinguistCatToolError } from './errors'

/** CAT tool names currently exposed to project sessions. */
export const LINGUIST_CAT_TOOL_NAMES = [
  'cat_project_summary',
  'cat_list_batches',
  'cat_get_segments',
  'cat_import_resources',
  'cat_refresh_project_inventory',
  'cat_preview_workbook_mapping',
  'cat_save_workbook_mapping',
  'cat_upsert_voice_profile',
  'cat_add_approved_exemplar',
  'cat_get_voice_context',
  'cat_scan_unknown_tag_patterns',
  'cat_save_tag_profile_candidate',
  'cat_export_batch',
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
  /** 仅专业动作创建/恢复任务；scope/restart 来自现有读取工具的明确参数。 */
  prepareStage?: (segmentIds: readonly string[], task?: { scope?: 'segments' | 'assets' | 'project'; restart?: boolean; toolCallId: string }) => void
  prepareContextDoc?: (docId: string) => void
  /** 仅通知准备完成；宿主在最终 Provider 调用确认后才写 Receipt。 */
  onEvidencePrepared?: (receipt: RecordStageEvidenceReceiptInput, content: AgentToolResult<unknown>['content']) => void
  /** 委派时冻结的 Segment 范围；模型无对应入参。 */
  reviewScopeSegmentIds?: readonly string[]
  /** 委派 Proposal 允许写入的 Segment 范围；模型无对应入参。 */
  delegatedScopeSegmentIds?: readonly string[]
  /** 读取已绑定批次的现有交付预检；不执行 QA、导出或写入。 */
  readDeliveryPreflight?: (assetId: string) => CatDeliveryPreflightSnapshot
  /** Current-turn host provenance; resolved locally per tool call. */
  generationProvenance?: (toolCallId: string) => LinguistGenerationProvenance
  /** 读取已绑定项目的受管 Context 图片；宿主负责路径授权与图片校验。 */
  readContextImage?: (docId: string) => Promise<{ data: string; mimeType: string }>
  /** Electron injects the packaged node:worker_threads QA entry. */
  qaWorker?: LinguistQaWorker
  /** Electron injects the same packaged worker for full-project consistency analysis. */
  consistencyWorker?: LinguistConsistencyWorker
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
  status: 'imported' | 'skipped-duplicate' | 'needs-input' | 'unsupported' | 'failed' | 'ready' | 'supporting'
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
  exemplars: Array<Omit<ApprovedExemplar, 'assetId'> & { batchId: string }>
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
  listBatches: { defaultLimit: 50, maxLimit: 200 },
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
  batchCount: number
  totalSegments: number
  segmentCounts: Record<SegmentStatus, number>
  /** Present for archived projects: reads are fine, writes are rejected upstream. */
  note?: string
  delivery?: CatDeliveryStatus
}

export interface CatDeliveryStatus {
  batchId: string
  workflowStage: WorkflowStage
  archived: boolean
  segmentCount: number
  lockedSegments: number
  unconfirmedUnlockedSegments: number
  pendingProposalCount: number
  qa: { openErrors: number; openWarnings: number; waived: number }
  qaFreshness: 'not-evaluated'
  evidence: {
    status: 'not-applicable' | 'stale' | 'blocked' | 'in-progress' | 'complete'
    stageRuns: number
    required: number
    presented: number
    pending: number
  }
  ready: boolean
  blockers: Array<{ code: string; count: number; message: string }>
  verifiedExport: false
  currentTask: null | {
    stageRunId: string
    role: 'translator' | 'reviewer' | 'proofreader'
    status: 'in_progress' | 'blocked' | 'stale' | 'complete'
    scopeSegments: number
    pendingSegments: number
    blockedSegments: number
    pendingEvidence: number
    blockingGaps: number
  }
}

export type CatDeliveryPreflightSnapshot = Pick<
  CatDeliveryStatus,
  | 'workflowStage'
  | 'segmentCount'
  | 'lockedSegments'
  | 'unconfirmedUnlockedSegments'
  | 'pendingProposalCount'
  | 'qa'
  | 'evidence'
  | 'ready'
  | 'blockers'
> & { assetId: string }

export interface CatApplyTranslationsResult {
  requested: number
  applied: number
  pending: number
  stale: string[]
  locked: string[]
  failed: Array<{ segmentId: string; code: string }>
  proposalIds: string[]
  /** 本次实际提交的版本；旧幂等回放可能没有该字段，不补造历史回执。 */
  appliedItems?: Array<{ segmentId: string; proposalId: string; baseRevision: number; revision: number }>
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

export interface CatBatchListItem {
  batchId: string
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
  batchId: string
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

/** 仅供定位句段；不含审校所需正文或已读证据。 */
export interface CatSegmentIndexItem extends Omit<CatSegmentListItem, 'source' | 'target'> {
  currentStageState?: Segment['currentStageState']
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

export interface CatSharedContextEvidence {
  docId: string
  version: string
  filename: string
  anchorId?: string
  locator?: ContextAnchor['locator']
  text: string
}

export interface CatLinkedContextEvidence extends CatSharedContextEvidence {
  requiredness: 'required' | 'conditional' | 'optional'
}

/** 本响应未附的必要原件；历史覆盖不代表当前模型记得正文。 */
export interface CatUnprovidedReference {
  sourceRef: { kind: 'context-doc'; id: string }
  version: string
  docId: string
  filename: string
  anchorIds: string[]
  kind: 'document' | 'image'
  reason: string
  segmentIds: string[]
  retrieve: { tool: 'cat_read_context_doc'; docId: string; offset?: number; limit?: number }
  history: {
    status: 'covered' | 'pending' | 'not-tracked' | 'unknown'
    stageRunId?: string
    version?: string
  }
}

export interface CatContextReference {
  ref: string
  requiredness: CatLinkedContextEvidence['requiredness']
}

export interface CatNeighborReference {
  segmentId: string
  revision: number
}

export interface CatSharedTranslationContext {
  context: Record<string, CatSharedContextEvidence>
  voices: Record<string, VoiceProfile>
  /** 只包含本页 contexts 未承载的边界邻文，键为 segmentId@revision。 */
  neighbors: Record<string, CatSegmentBrief>
}

export interface SegmentTranslationContext {
  segmentId: string
  batchId: string
  revision: number
  /** LA-CONTEXT-002：返回页永不空、永不截半截；预算只裁次级字段。 */
  source: string
  currentTarget: string
  locked: boolean
  originalOrdinal: number
  key?: string
  origin?: string
  textType?: string
  module?: string
  category?: string
  speaker?: string
  voiceRefs: string[]
  notes?: string
  previous: CatNeighborReference[]
  next: CatNeighborReference[]
  tags: TagToken[]
  targetTags: TagToken[]
  placeholderSignature: string[]
  /** 仅承载项目明确声明的 Required authority；不得把 preferred 升格。 */
  requiredTerms: TermEntryMatch[]
  forbiddenTerms: TermEntryMatch[]
  preferredTerms: TermEntryMatch[]
  conflicts: TermEntryMatch[]
  tm: TmAgentEvidence[]
  /** 引用本响应 shared.context；requiredness 属于当前句段的关联。 */
  contextRefs: CatContextReference[]
  warnings: string[]
  evidence: CatEvidenceRef[]
}

/** 与 Store 共用的项目规则条目。 */
export type CatProjectRuleItem = ProjectRule

export interface CatGetTranslationContextResult {
  contextFormatVersion: 2
  /** 将 text 按 offset 连接后解析为完整 JSON；分片不代表内容/证据已读完。 */
  contextFragment?: { encoding: 'json'; offset: number; totalChars: number; text: string }

  contexts: SegmentTranslationContext[]
  shared: CatSharedTranslationContext
  totalRequested: number
  /** Echoes the opaque input cursor; null is the first page. */
  cursor: string | null
  truncated: boolean
  nextCursor?: string
  suggestedSegmentIds?: string[]
  /** 当前规则页；通过相同工具的 rulesOnly/rulesOffset 续读。 */
  projectRules?: CatProjectRuleItem[]
  ruleCoverage: { total: number; offset: number; provided: number; remaining: number; nextOffset?: number }
  unprovidedReferences?: CatUnprovidedReference[]
  /** 宿主签发的 Stage Evidence 覆盖；Agent 文本不能改写。 */
  stageEvidence?: {
    stageRunId: string
    status: 'in_progress' | 'blocked' | 'stale' | 'complete'
    scopeSegments: number
    pendingSegments: number
    blockedSegments: number
    required: number
    presented: number
    pending: number
  }
  readOnly?: boolean
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
  batchId: string
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
  /** 正文和定位元数据版本；metadataOnly 必须回传，拒绝跨版本拼接。 */
  docVersion: string
  metadataOnly?: true
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
  /** 下一页实际 UTF-16 位置；与 limit 的请求值无关。 */
  nextOffset?: number
  metadataOffset?: number
  nextMetadataOffset?: number
  anchorCount?: number
  warningCount?: number
  maxBytes?: number
  usedBytes?: number
  minimumRequiredBytes?: number
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
  readOnly?: boolean
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
  dimensions: Omit<BatchConsistencyDimensions, 'assetIds'> & { batchIds: string[] }
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
