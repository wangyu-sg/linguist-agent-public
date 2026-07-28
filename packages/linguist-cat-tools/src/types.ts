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
  LinguistProject,
  QaFindingDisposition,
  QaFindingSeverity,
  QaFindingStatus,
  QaIssueType,
  SegmentStatus,
} from '@linguist/cat-core'
import type {
  ContextDocKind,
  ProjectDatabase,
  SentencePattern,
  TermEntry,
  TmUnit,
  TmUnitMatch,
} from '@linguist/cat-store'
import type { LinguistCatToolError } from './errors'

/** CAT tool names currently exposed to project sessions. */
export const LINGUIST_CAT_TOOL_NAMES = [
  'cat_project_summary',
  'cat_list_assets',
  'cat_get_segments',
  'cat_search_tm',
  'cat_search_terms',
  'cat_propose_translations',
  'cat_run_qa',
  'cat_get_qa_findings',
  'cat_submit_critic_review',
  'cat_run_batch_consistency',
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
}

/** CAT Tool 已提交的项目内变更；不含 projectId，避免模型输入影响项目 authority。 */
export interface LinguistCatToolMutation {
  kind: 'proposal-created' | 'qa-updated' | 'project-updated'
  segmentIds?: readonly string[]
  proposalIds?: readonly string[]
  qaFindingIds?: readonly string[]
}

/** Page limits (plan §7.4): defaults are small; maximums are HARD caps. */
export const CAT_TOOL_PAGE_LIMITS = {
  listAssets: { defaultLimit: 50, maxLimit: 200 },
  getSegments: { defaultLimit: 20, maxLimit: 100 },
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
  artifactId: string
  findingIds: string[]
  qaFindingIds: string[]
  /** Advisory scope only — canCommit is burned to false; repairs go through proposals. */
  repairScope: {
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
  waiverReason?: string
}

/** cat_run_batch_consistency（PB-084）分组报告里的一条 finding。 */
export interface CatBatchConsistencyFindingItem {
  findingId: string
  segmentId: string
  code: string
  severity: QaFindingSeverity
  message: string
  locked: boolean
}

/** 同 source 的一组一致性命中 + 组内多数非空 target 建议。 */
export interface CatBatchConsistencyGroupItem {
  source: string
  segmentIds: string[]
  findingIds: string[]
  /** 组内多数非空 target（NFKC+trim 归一化计票）；组内全空时缺省。 */
  suggestedTarget?: string
  findings: CatBatchConsistencyFindingItem[]
}

/**
 * cat_run_batch_consistency 结果。check-only 只报告（绝不写库）；repair
 * 额外创建 pending proposals（与 cat_propose_translations 同一审核链），
 * 绝不直接改段。
 */
export interface CatRunBatchConsistencyResult {
  mode: 'check-only' | 'repair'
  findingCount: number
  groupCount: number
  groups: CatBatchConsistencyGroupItem[]
  /** repair 模式：新建/复用的 pending proposal ids（内容派生，幂等）。 */
  proposalIds?: string[]
  /** repair 模式的可信工具执行批次。 */
  runId?: string
  /** repair 模式：未自动修复的段及原因。 */
  skipped?: Array<{ segmentId: string; reason: string }>
  /** Present when there are no open consistency findings. */
  note?: string
}
