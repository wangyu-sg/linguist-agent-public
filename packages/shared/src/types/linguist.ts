/**
 * Linguist CAT 项目 IPC 契约（PB-031；计划 §4.1/§7.2/§7.4）
 *
 * 本文件是 renderer 与主进程之间「项目域」的唯一通讯契约：
 * - renderer 只经这里的 typed channel（PB-082 起 7 个）访问 CAT store，绝不自行打开
 *   数据库、绝不提交文件系统路径（计划 §7.4）；导入由主进程原生文件
 *   选择器完成，renderer 只收到 opaque 结果（含被选中文件的 basename）。
 * - 所有 channel 返回 `LinguistIpcResult<T>` 信封而非 throw：Electron 的
 *   ipcRenderer.invoke 会把 handler 抛出的错误包装成
 *   "Error invoking remote method ..." 并丢弃自定义 `code` 属性，而稳定
 *   机器可读错误码是计划 §7.4 的硬规则，因此本域采用结果信封
 *   （与 house 既有「直返 + throw」惯例不同，属刻意选择，已在 ipc.ts 注记）。
 * - 错误码目录是公开契约：服务层四码（PB-030 errors.ts）+ IPC 层两码
 *   （INVALID_INPUT/INTERNAL）+ store/format/domain 类型化错误原样穿透。
 *   未知错误一律收敛为 INTERNAL（不泄露 stack / 内部文本）。
 *
 * 形状说明：LinguistProjectInfo 等类型是 cat-core/cat-store 领域类型的
 * JSON 线格式镜像（@proma/shared 不依赖 linguist 包），结构兼容、可直接
 * 由服务返回值赋值。
 */

// ===== Channel 名（计划 §7.2，逐一对应，不得改名）=====

export const LINGUIST_PROJECT_IPC_CHANNELS = {
  /** 列出项目（可选含已归档） */
  LIST: 'linguist.projects.list',
  /** 创建项目 */
  CREATE: 'linguist.projects.create',
  /** 打开项目（DB 句柄 + 元数据 + 健康报告；非 UI 导航） */
  OPEN: 'linguist.projects.open',
  /** 导入资产（主进程原生文件选择器；renderer 不传路径/字节） */
  IMPORT: 'linguist.projects.import',
  /** XLSX 选择后由用户确认 sheet/列映射；renderer 只回传 opaque mapping token。 */
  CONFIRM_XLSX_MAPPING: 'linguist.projects.confirmXlsxMapping',
  /** 项目摘要（元数据 + 资产列表 + 按状态分段的段计数） */
  GET_SUMMARY: 'linguist.projects.getSummary',
  /** 重命名项目（沿用项目名校验；归档项目只读） */
  RENAME: 'linguist.projects.rename',
  /** 修改空项目语言对；已有批次或 TM/TB 时 fail closed。 */
  SET_LOCALES: 'linguist.projects.setLocales',
  /** 原子保存全部活跃项目顺序；归档项目保持原相对顺序 */
  REORDER_ACTIVE: 'linguist.projects.reorderActive',
  /** 归档项目 */
  ARCHIVE: 'linguist.projects.archive',
  /** 可恢复删除（仅已归档项目 + 精确项目名确认） */
  DELETE: 'linguist.projects.delete',
  /** 设置当前 T/E/P 任务阶段与格式原生输出策略。 */
  SET_WORKFLOW_CONFIG: 'linguist.projects.setWorkflowConfig',
  /** 保存/激活/忽略/启停项目 Tag Profile 条目。 */
  UPDATE_TAG_PROFILE: 'linguist.projects.updateTagProfile',
  /** 只读扫描未登记 Tag 形状，供 Agent 与设置 UI 共用。 */
  SCAN_UNKNOWN_TAGS: 'linguist.projects.scanUnknownTags',
  /** PB-111：全量备份（backup-<ts>/ 目录 + manifest；归档项目也可备份） */
  BACKUP: 'linguist.projects.backup',
  /** PB-111：列出项目备份（只读；名称/摘要元数据，绝无路径） */
  LIST_BACKUPS: 'linguist.projects.listBackups',
  /** PB-111：恢复预览（verify 报告 + 备份/当前摘要对比 + schema 版本） */
  PREVIEW_RESTORE: 'linguist.projects.previewRestore',
  /** PB-111：恢复（整体替换；当前态先快照 pre-restore-<ts>；归档拒绝） */
  RESTORE: 'linguist.projects.restore',
  /** LA-INTAKE-007：撤销一次导入（无下游引用才允许；归档 fail closed） */
  UNDO_IMPORT_ASSET: 'linguist.projects.undoImportAsset',
} as const

export type LinguistProjectIpcChannel =
  (typeof LINGUIST_PROJECT_IPC_CHANNELS)[keyof typeof LINGUIST_PROJECT_IPC_CHANNELS]

/** 全量完整性扫描独立通道；生产执行体必须是 Worker，不与 Quick Health 混用。 */
export const LINGUIST_INTEGRITY_IPC_CHANNELS = {
  START: 'linguist.integrity.start',
  CANCEL: 'linguist.integrity.cancel',
  EXPORT_REPORT: 'linguist.integrity.exportReport',
  PROGRESS: 'linguist.integrity.progress',
} as const

export type LinguistIntegrityIpcChannel =
  (typeof LINGUIST_INTEGRITY_IPC_CHANNELS)[keyof typeof LINGUIST_INTEGRITY_IPC_CHANNELS]

// ===== 会话绑定通道（PB-034；计划 §7.2「Project → Session 绑定」）=====
//
// 「项目对话」= 携带 linguistProjectId 绑定的 Pi Agent 会话（AgentSessionMeta）。
// 绑定在创建时写入并冻结（无任何重绑定 API）；普通对话（侧栏新建）绝不携带
// 绑定。仅允许用户显式永久解绑。归档/缺失判定在每次调用时实时求值。

export const LINGUIST_SESSION_IPC_CHANNELS = {
  /** 在项目内创建对话（Pi Agent 会话，元数据携带 linguistProjectId 绑定） */
  CREATE_FOR_PROJECT: 'linguist.sessions.createForProject',
  /** 更新项目会话的默认岗位；不改变项目绑定、工具、权限、模型或 Runtime */
  UPDATE_ROLE: 'linguist.sessions.updateRole',
  /** 列出绑定到某项目的会话（项目缺失时仍可列出——绑定存在会话侧） */
  LIST_FOR_PROJECT: 'linguist.sessions.listForProject',
  /** 查询某会话的项目绑定 + 实时状态（active/archived/missing/unavailable） */
  GET_BINDING: 'linguist.sessions.getBinding',
  /** 永久解除项目绑定；解绑后会话作为普通 Agent 继续，不能重新绑定 */
  DETACH_BINDING: 'linguist.sessions.detachBinding',
  /** 查询会话能否安全复制到另一个 Linguist 项目 */
  GET_COPY_ELIGIBILITY: 'linguist.sessions.getCopyEligibility',
  /** 在主进程验证目标后创建独立的跨项目副本 */
  COPY_TO_PROJECT: 'linguist.sessions.copyToProject',
} as const

export type LinguistSessionIpcChannel =
  (typeof LINGUIST_SESSION_IPC_CHANNELS)[keyof typeof LINGUIST_SESSION_IPC_CHANNELS]

// ===== Proposal 与批量译文写回通道 =====

export const LINGUIST_PROPOSAL_IPC_CHANNELS = {
  LIST: 'linguist.proposals.list',
  LIST_PENDING: 'linguist.proposals.listPending',
  GET_DIFF: 'linguist.proposals.getDiff',
  APPLY_TRANSLATIONS: 'linguist.proposals.applyTranslations',
  ACCEPT: 'linguist.proposals.accept',
  REJECT: 'linguist.proposals.reject',
  EDIT_AND_ACCEPT: 'linguist.proposals.editAndAccept',
  ACCEPT_SELECTED: 'linguist.proposals.acceptSelected',
  REJECT_SELECTED: 'linguist.proposals.rejectSelected',
  REISSUE: 'linguist.proposals.reissue',
} as const

export type LinguistProposalIpcChannel =
  (typeof LINGUIST_PROPOSAL_IPC_CHANNELS)[keyof typeof LINGUIST_PROPOSAL_IPC_CHANNELS]

// ===== CAT Workspace 通道（PB-060/071；人工编辑与 QA 审核）=====

export const LINGUIST_CAT_IPC_CHANNELS = {
  QUERY: 'linguist.cat.query',
  EDIT_SEGMENT: 'linguist.cat.editSegment',
  CONFIRM_STAGE: 'linguist.cat.confirmStage',
  UNCONFIRM_STAGE: 'linguist.cat.unconfirmStage',
  CONFIRM_STAGE_BULK: 'linguist.cat.confirmStageBulk',
  GET_CONTEXT: 'linguist.cat.getContext',
  RUN_QA: 'linguist.cat.runQa',
  LIST_QA_FINDINGS: 'linguist.cat.listQaFindings',
  RESOLVE_QA_FINDING: 'linguist.cat.resolveQaFinding',
  WAIVE_QA_FINDING: 'linguist.cat.waiveQaFinding',
  WAIVE_QA_FINDINGS_BULK: 'linguist.cat.waiveQaFindingsBulk',
  LIST_PROJECT_EVENTS: 'linguist.cat.listProjectEvents',
  ACK_PROJECT_EVENTS: 'linguist.cat.ackProjectEvents',
  GET_LATEST_RUN_SUMMARY: 'linguist.cat.getLatestRunSummary',
  UNDO_LATEST_RUN: 'linguist.cat.undoLatestRun',
  /** Agent CAT Tool 成功提交项目写入后的主进程下行事件。 */
  PROJECT_MUTATION: 'linguist.cat.projectMutation',
} as const

export type LinguistCatIpcChannel =
  (typeof LINGUIST_CAT_IPC_CHANNELS)[keyof typeof LINGUIST_CAT_IPC_CHANNELS]

export interface LinguistProjectMutationEvent {
  projectId: string
  /** 当前主进程内推送顺序；renderer 重连以 sequence 为持久游标。 */
  revision: number
  /** cat.db outbox 的持久序号；旧的人工作业通知可以缺省。 */
  sequence?: number
  kind:
    | 'proposal-created'
    | 'proposal-reviewed'
    | 'segment-updated'
    | 'qa-updated'
    | 'asset-updated'
    | 'project-updated'
    | 'job-updated'
    | 'run-undone'
  runId?: string
  toolCallId?: string
  segmentIds?: readonly string[]
  proposalIds?: readonly string[]
  qaFindingIds?: readonly string[]
  resolvedQaFindingIds?: readonly string[]
  jobId?: string
  job?: {
    status: 'pending' | 'running' | 'paused' | 'completed' | 'failed' | 'cancelled'
    cursor: number
    total: number
    completed: number
    failed: number
  }
}

export interface LinguistProjectEventListRequest {
  projectId: string
  afterSequence: number
  limit?: number
}

export interface LinguistProjectEventListResult {
  events: LinguistProjectMutationEvent[]
  hasMore: boolean
}

export interface LinguistProjectEventAckRequest {
  projectId: string
  consumerId: string
  throughSequence: number
}

export interface LinguistProjectEventAckResult {
  consumerId: string
  sequence: number
  ackedAt: string
}

export interface LinguistRunSummaryRequest {
  projectId: string
}

export interface LinguistRunUndoRequest {
  projectId: string
  sessionId: string
  expectedRunId: string
}

export interface LinguistRunChangeSummary {
  schemaVersion: 1
  projectId: string
  runId: string
  job?: {
    jobId: string
    status: 'pending' | 'running' | 'paused' | 'completed' | 'failed' | 'cancelled'
    scopedSegments: number
    cursor: number
    completedSegments: number
    failedSegments: number
  }
  mutationCount: number
  changes: {
    proposalsCreated: number
    qaFindingsCreated: number
    qaFindingsUpdated: number
    filesTouched: number
    total: number
    undone: number
  }
  eventSequence?: { first: number; last: number }
  canUndo: boolean
}

export interface LinguistLatestRunSummaryResult {
  summary: LinguistRunChangeSummary | null
}

export interface LinguistRunUndoResult {
  runId: string
  status: 'completed' | 'partial' | 'refused' | 'already-undone'
  reverted: Array<{
    entityType: 'segment' | 'proposal' | 'qa-finding' | 'file' | 'legacy-record'
    entityId: string
  }>
  refused: Array<{
    entityType: 'segment' | 'proposal' | 'qa-finding' | 'file' | 'legacy-record'
    entityId: string
    reason: string
  }>
}

// ===== TM / 术语库通道（PB-080；原生导入、管理与只读查询）=====

export const LINGUIST_REFERENCE_IPC_CHANNELS = {
  QUERY_TM: 'linguist.references.queryTm',
  QUERY_TERMS: 'linguist.references.queryTerms',
  /** 原生选择器解析为短生命周期候选；不写 TM/TB 权威表。 */
  IMPORT: 'linguist.references.import',
  /** 人工确认候选后才写入 TM/TB 权威表。 */
  CONFIRM_IMPORT: 'linguist.references.confirmImport',
  /** 丢弃未确认候选；只释放主进程内存。 */
  CANCEL_IMPORT: 'linguist.references.cancelImport',
  /** 未确认候选的原文件预览（opaque token，零路径/零 bytes 下行）。 */
  PREVIEW_CANDIDATE: 'linguist.references.previewCandidate',
  UPSERT_TERM: 'linguist.references.upsertTerm',
  UPSERT_TERMS: 'linguist.references.upsertTerms',
  DELETE_TERMS: 'linguist.references.deleteTerms',
  LIST_TERM_CONFLICTS: 'linguist.references.listTermConflicts',
  VALIDATE_TERMS: 'linguist.references.validateTerms',
  DELETE: 'linguist.references.delete',
} as const

export type LinguistReferenceIpcChannel =
  (typeof LINGUIST_REFERENCE_IPC_CHANNELS)[keyof typeof LINGUIST_REFERENCE_IPC_CHANNELS]

// ===== 导出通道（PB-073；主进程 staging → 原生 Save）=====

export const LINGUIST_EXPORT_IPC_CHANNELS = {
  PREPARE_ASSET: 'linguist.exports.prepareAsset',
  SAVE_ASSET: 'linguist.exports.saveAsset',
  /** PB-102：只读列出项目 exports/ 目录内容（主进程读盘，renderer 不传路径）。 */
  LIST: 'linguist.exports.list',
} as const

export type LinguistExportIpcChannel =
  (typeof LINGUIST_EXPORT_IPC_CHANNELS)[keyof typeof LINGUIST_EXPORT_IPC_CHANNELS]

// ===== 诊断通道（LA-OBS-001；Prompt 状态 + 显式脱敏包）=====

export const LINGUIST_DIAGNOSTICS_IPC_CHANNELS = {
  GET_STATUS: 'linguist.diagnostics.getStatus',
  PREVIEW_BUNDLE: 'linguist.diagnostics.previewBundle',
  EXPORT_BUNDLE: 'linguist.diagnostics.exportBundle',
} as const

export type LinguistDiagnosticsIpcChannel =
  (typeof LINGUIST_DIAGNOSTICS_IPC_CHANNELS)[keyof typeof LINGUIST_DIAGNOSTICS_IPC_CHANNELS]

// ===== Legacy 迁移向导通道（PB-094；计划 §22）=====
//
// 旧版 Linguist Agent 数据根 → 新仓 Linguist 项目的一次性迁移：
// - pickAndScan：主进程弹原生目录选择器并立即扫描（@linguist/legacy-migration
//   只读扫描器）；取消返回 {cancelled: true}（正常分支，非错误）。扫描结果
//   只给 UI 投影（计划 §7.4：renderer 永不提交路径，目录选择必须主进程做）。
// - import：入参仅为「上次扫描中出现过」的旧项目 id 列表 + 选项；旧根路径
//   由主进程在 pickAndScan 时留存，renderer 无从伪造。每个项目 import 完
//   立即 verify（transcript sha256 重渲染比对 + 只读重开计数），进度经
//   PROGRESS 事件推送（LinguistMigrationProgress）。

export const LINGUIST_MIGRATION_IPC_CHANNELS = {
  /** 主进程目录选择器 + 扫描旧数据根（取消 → {cancelled:true}） */
  PICK_AND_SCAN: 'linguist.migration.pickAndScan',
  /** 批量导入选中旧项目（每项 import 后立即 verify；响应为聚合报告） */
  IMPORT: 'linguist.migration.import',
  /** main→renderer 进度事件（LinguistMigrationProgress） */
  PROGRESS: 'linguist.migration.progress',
} as const

export type LinguistMigrationIpcChannel =
  (typeof LINGUIST_MIGRATION_IPC_CHANNELS)[keyof typeof LINGUIST_MIGRATION_IPC_CHANNELS]

// ===== 项目资产通道（PB-095；六类资产的 CRUD 与原生导入）=====
//
// 术语（第六类）复用 LINGUIST_REFERENCE_IPC_CHANNELS 的既有通道（PB-080），
// 本组覆盖五类新资产：styleGuideRules / sentencePatterns / contextDocs /
// techConstraints / voiceProfiles。导入（context doc 任意文件、句式 CSV）
// 走主进程原生选择器，renderer 绝不提交路径或字节（同 PB-080 纪律）。

export const LINGUIST_ASSETS_IPC_CHANNELS = {
  /** 按 kind 分页查询（query/status 过滤；contextDocs 只回元数据）。 */
  QUERY: 'linguist.assets.query',
  /** 按 kind 创建/更新（contextDocs 仅 note 更新；归档只读拒绝）。 */
  UPSERT: 'linguist.assets.upsert',
  /** 按 kind 删除（contextDocs 级联清尾 blob，尽力而为）。 */
  DELETE: 'linguist.assets.delete',
  /** 原生选择器导入 context 文档/图片（字节落项目 blobs/）。 */
  IMPORT_CONTEXT_DOC: 'linguist.assets.importContextDoc',
  /** 原生选择器导入句式 CSV。 */
  IMPORT_SENTENCE_PATTERNS: 'linguist.assets.importSentencePatterns',
  /** 预览 context 文档 blob（text/html/url 三态分派；纯读，归档项目允许）。 */
  PREVIEW_CONTEXT_DOC: 'linguist.assets.previewContextDoc',
} as const

export type LinguistAssetsIpcChannel =
  (typeof LINGUIST_ASSETS_IPC_CHANNELS)[keyof typeof LINGUIST_ASSETS_IPC_CHANNELS]

// ===== CAT 资产源文件预览通道（PB-089；纯读，归档项目也可用）=====
//
// 用户显式点击「预览」后，主进程解析项目 source/ 内的源 blob 绝对路径
// （双重围栏，绝不下发 renderer），按扩展名分派：文本类直接读回（截断
// 护栏）、docx/xlsx 复用 Proma 预览栈转 HTML、未知扩展名降级为
// proma-file:// 不透明 URL 直渲染。零字节过 IPC、零路径过 IPC（PB-110
// 纪律）：text/html 态只回内容字符串，url 态只回不透明 token URL。

export const LINGUIST_ASSET_PREVIEW_IPC_CHANNELS = {
  /** 预览 CAT 资产源文件（text/html/url 三态分派；归档项目允许）。 */
  PREVIEW_SOURCE: 'linguist.project.previewAssetSource',
  /** 预览 TM/TB 文件导入原件（同一三态分派；归档项目允许）。 */
  PREVIEW_REFERENCE_IMPORT: 'linguist.project.previewReferenceImport',
} as const

export type LinguistAssetPreviewIpcChannel =
  (typeof LINGUIST_ASSET_PREVIEW_IPC_CHANNELS)[keyof typeof LINGUIST_ASSET_PREVIEW_IPC_CHANNELS]

// ===== 稳定错误码目录（公开契约，变更需迁移说明）=====

export const LINGUIST_IPC_ERROR_CODES = {
  // ---- IPC 层（本文件定义）----
  /** 输入校验失败（id/locale/枚举/长度/类型不合规）。 */
  INVALID_INPUT: 'INVALID_INPUT',
  /** 未类型化的意外错误（无 stack / 内部文本泄露）。 */
  INTERNAL: 'INTERNAL',

  // ---- 服务层（apps/electron/src/main/lib/linguist/errors.ts，PB-030）----
  PROJECT_NOT_FOUND: 'PROJECT_NOT_FOUND',
  PROJECT_ARCHIVED: 'PROJECT_ARCHIVED',
  PROJECT_UNHEALTHY: 'PROJECT_UNHEALTHY',
  IMPORT_TOO_LARGE: 'IMPORT_TOO_LARGE',
  EXPORT_BLOCKED_BY_QA: 'EXPORT_BLOCKED_BY_QA',
  DELIVERY_NOT_READY: 'DELIVERY_NOT_READY',
  CONTEXT_DOC_EXTRACT_FAILED: 'CONTEXT_DOC_EXTRACT_FAILED',
  PROJECT_DELETE_REQUIRES_ARCHIVE: 'PROJECT_DELETE_REQUIRES_ARCHIVE',
  PROJECT_DELETE_CONFIRMATION_MISMATCH: 'PROJECT_DELETE_CONFIRMATION_MISMATCH',
  PROJECT_ORDER_CONFLICT: 'PROJECT_ORDER_CONFLICT',
  SESSION_COPY_BLOCKED: 'SESSION_COPY_BLOCKED',
  IMPORT_VERIFICATION_FAILED: 'IMPORT_VERIFICATION_FAILED',
  IMPORT_UNDO_BLOCKED: 'IMPORT_UNDO_BLOCKED',
  PROJECT_LOCALE_CHANGE_BLOCKED: 'PROJECT_LOCALE_CHANGE_BLOCKED',

  // ---- cat-store 穿透（packages/linguist-cat-store/src/errors.ts）----
  STORE_SQLITE_UNAVAILABLE: 'STORE_SQLITE_UNAVAILABLE',
  STORE_SCHEMA_TOO_NEW: 'STORE_SCHEMA_TOO_NEW',
  STORE_NOT_FOUND: 'STORE_NOT_FOUND',
  STORE_INDEX_CORRUPT: 'STORE_INDEX_CORRUPT',
  STORE_READ_ONLY: 'STORE_READ_ONLY',
  STORE_BUSY: 'STORE_BUSY',
  STORE_PROJECT_EXISTS: 'STORE_PROJECT_EXISTS',
  STORE_ASSET_SOURCE_MISMATCH: 'STORE_ASSET_SOURCE_MISMATCH',
  STORE_BACKUP_CORRUPT: 'STORE_BACKUP_CORRUPT',
  STORE_BACKUP_LEGACY: 'STORE_BACKUP_LEGACY',

  // ---- cat-formats 穿透（packages/linguist-cat-formats/src/errors.ts）----
  FORMAT_PARSE_ERROR: 'FORMAT_PARSE_ERROR',
  FORMAT_EXPORT_ERROR: 'FORMAT_EXPORT_ERROR',
  FORMAT_SEGMENT_LOST: 'FORMAT_SEGMENT_LOST',
  FORMAT_UNSUPPORTED: 'FORMAT_UNSUPPORTED',

  // ---- cat-core domain 穿透（packages/linguist-cat-core/src/errors.ts）----
  SEGMENT_LOCKED: 'SEGMENT_LOCKED',
  REVISION_CONFLICT: 'REVISION_CONFLICT',
  STALE_PROPOSAL: 'STALE_PROPOSAL',
  UNKNOWN_SEGMENT: 'UNKNOWN_SEGMENT',
  INVALID_STATE_TRANSITION: 'INVALID_STATE_TRANSITION',
  INVALID_ID: 'INVALID_ID',
} as const

export type LinguistIpcErrorCode =
  (typeof LINGUIST_IPC_ERROR_CODES)[keyof typeof LINGUIST_IPC_ERROR_CODES]

// ===== 结果信封 =====

export interface LinguistIpcError {
  code: LinguistIpcErrorCode
  /** 人类可读描述；类型化错误透传其 message，未知错误为通用文案。 */
  message: string
  /**
   * LA-INTAKE-007：类型化错误可选携带的机器可读计数（如 IMPORT_UNDO_BLOCKED
   * 的下游引用计数）。只允许非负整数值；绝无客户文本。
   */
  details?: Record<string, number>
}

export type LinguistIpcResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: LinguistIpcError }

// ===== 校验常量（主进程 handler 强制执行；renderer 可用于预校验）=====

/** 随机项目 id 保持历史形状：`prj-<16 位小写 hex>`。 */
export const LINGUIST_PROJECT_ID_PATTERN = /^prj-[0-9a-f]{16}$/

/** 内容派生 id 同时接受历史 v1 与新建 v2；项目 id 仍为随机 v1。 */
export const LINGUIST_ASSET_ID_PATTERN = /^ast(?:-[0-9a-f]{16}|_v2_[0-9a-f]{64})$/

export const LINGUIST_SEGMENT_ID_PATTERN = /^seg(?:-[0-9a-f]{16}|_v2_[0-9a-f]{64})$/

export const LINGUIST_PROPOSAL_ID_PATTERN = /^prp(?:-[0-9a-f]{16}|_v2_[0-9a-f]{64})$/

export const LINGUIST_QA_FINDING_ID_PATTERN = /^qaf(?:-[0-9a-f]{16}|_v2_[0-9a-f]{64})$/

/** TM / TB 记录 id：内容派生且仅在项目内有意义。 */
export const LINGUIST_REFERENCE_ID_PATTERN = /^(?:tmu|ter)(?:-[0-9a-f]{16}|_v2_[0-9a-f]{64})$/

/** TM/TB 原始导入文件 id：内容派生，只用于受管原件预览。 */
export const LINGUIST_REFERENCE_IMPORT_ID_PATTERN = /^rfi(?:-[0-9a-f]{16}|_v2_[0-9a-f]{64})$/

/** 主进程 picker 候选 token；短生命周期，不是持久化身份。 */
export const LINGUIST_PENDING_IMPORT_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

/** PB-095 项目资产 id：sgr/spn/ctx/tcn/vpr 五前缀，内容派生且仅在项目内有意义。 */
export const LINGUIST_PROJECT_ASSET_ID_PATTERN = /^(?:sgr|spn|ctx|tcn|vpr)(?:-[0-9a-f]{16}|_v2_[0-9a-f]{64})$/

/**
 * BCP-47 风格 locale 形状：2-3 字母语言标签 + 可选 `-xx` 子标签序列
 * （如 en / zh-CN / zh-Hant-TW / pt-BR）。刻意不查表——只做形状校验。
 */
export const LINGUIST_LOCALE_PATTERN = /^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*$/

/** locale 字符串长度上限（BCP-47 实际最大值 35）。 */
export const LINGUIST_LOCALE_MAX_LENGTH = 35

/** 项目名长度上限（字符数；trim 后不得为空）。 */
export const LINGUIST_PROJECT_NAME_MAX_LENGTH = 120

/** 可选显式工作区 id 的长度上限。 */
export const LINGUIST_WORKSPACE_ID_MAX_LENGTH = 128

/** 导入文件选择器的扩展名白名单（计划 §7.2；PB-081 起含 xlsx，PB-086 起含 sdlxliff，PB-087 起含 mxliff，PB-088 起含 docx）。 */
export const LINGUIST_IMPORT_FILE_EXTENSIONS = [
  'xliff',
  'xlf',
  'mqxliff',
  'csv',
  'tsv',
  'json',
  'xlsx',
  'sdlxliff',
  'mxliff',
  'docx',
] as const

/** 导入体积上限（与 PB-030 服务层 MAX_IMPORT_BYTES 一致）。 */
export const LINGUIST_IMPORT_MAX_BYTES = 50 * 1024 * 1024
export const LINGUIST_RESOURCE_IMPORT_MAX_BYTES = 512 * 1024 * 1024

/** CAT Workspace 单页上限；虚拟化 Grid 仍按页取数，不把 10k 行一次搬进 renderer。 */
export const LINGUIST_CAT_PAGE_MAX = 200

/** CAT 搜索输入上限，主进程信任边界与 renderer 输入一致。 */
export const LINGUIST_CAT_SEARCH_MAX_LENGTH = 500

/** PB-111 新格式备份目录名：backup-<safeTimestamp>（目录穿越防线的唯一合法形状之一）。 */
export const LINGUIST_BACKUP_DIR_NAME_PATTERN = /^backup-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z$/

/** PB-024 旧格式（两文件）备份文件名：cat-<safeTimestamp>.db；仅可预览，不可恢复。 */
export const LINGUIST_LEGACY_BACKUP_NAME_PATTERN = /^cat-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z\.db$/

// ===== 线格式类型（领域类型的 JSON 镜像）=====

/** cat-core LinguistProject 的线格式镜像（结构兼容）。 */
export interface LinguistProjectInfo {
  schemaVersion: 1
  id: string
  name: string
  sourceLocale: string
  targetLocale: string
  promaWorkspaceId: string
  createdAt: string
  updatedAt: string
  archivedAt?: string
  /** 旧任务/测试夹具可缺省；主进程正常化后线上响应始终提供。 */
  workflowStage?: LinguistWorkflowStage
  outputStatusPolicy?: LinguistWorkflowOutputStatusPolicy
  /** 旧任务/测试夹具可缺省；主进程正常化后线上响应始终提供。 */
  qaProfile?: LinguistQaProfile
  tagProfile?: LinguistTagProfileInfo
}

export type LinguistTagCandidateKind = 'standalone' | 'opening' | 'closing'

export interface LinguistTagFamilyInfo {
  id: string
  pattern: string
  class: 'paired' | 'singleton'
  kind?: LinguistTagCandidateKind
  pairWith?: string
  note?: string
  enabled?: boolean
}

export interface LinguistTagProfileCandidateInfo {
  id: string
  name: string
  pattern: string
  kind: LinguistTagCandidateKind
  pairKey?: string
  evidenceExampleIds: readonly string[]
  confidence: number
  explanation: string
  status: 'candidate' | 'ignored'
}

export interface LinguistTagProfileInfo {
  families: readonly LinguistTagFamilyInfo[]
  candidates?: readonly LinguistTagProfileCandidateInfo[]
}

export type LinguistProjectUpdateTagProfileRequest =
  | {
      projectId: string
      action: 'save'
      replaceId?: string
      candidate: {
        name: string
        regex: string
        kind: LinguistTagCandidateKind
        pairKey?: string
        evidenceExampleIds: string[]
        confidence: number
        explanation: string
      }
    }
  | {
      projectId: string
      action: 'activate' | 'ignore' | 'enable' | 'disable'
      entryId: string
    }

export type LinguistProjectUpdateTagProfileResult = LinguistProjectInfo

export interface LinguistUnknownTagExampleInfo {
  id: string
  segmentId: string
  side: 'source' | 'target'
  value: string
}

export interface LinguistUnknownTagPatternInfo {
  patternShape: string
  examples: LinguistUnknownTagExampleInfo[]
  frequency: number
  sourceTargetPreservation: {
    exactValueRate: number
    shapeRate: number
    countRate: number
  }
  pairingEvidence: { opening: number; closing: number; balanced: boolean; pairKeys: string[] }
  suggestedVariableParts: string[]
}

export interface LinguistProjectScanUnknownTagsRequest {
  projectId: string
  assetIds?: string[]
  sampleLimit?: number
}

export type LinguistProjectScanUnknownTagsResult = LinguistUnknownTagPatternInfo[]

export const LINGUIST_WORKFLOW_STAGES = ['translation', 'editing', 'proofreading'] as const
export type LinguistWorkflowStage = (typeof LINGUIST_WORKFLOW_STAGES)[number]
export type LinguistCurrentStageState = 'untouched' | 'draft' | 'confirmed'
export type LinguistCurrentStageStateCounts = Record<LinguistCurrentStageState, number>

export const LINGUIST_QA_PROFILES = ['general', 'subtitle'] as const
export type LinguistQaProfile = (typeof LINGUIST_QA_PROFILES)[number]

export interface LinguistWorkflowOutputStatusPolicy {
  [formatId: string]: Partial<Record<LinguistWorkflowStage, string>> | undefined
}

/** 段状态（对齐 cat-core SegmentStatus）。 */
export type LinguistSegmentStatus = 'untranslated' | 'draft' | 'translated' | 'reviewed'

/** 按状态的段计数（四个状态键齐全，缺省为 0）。 */
export type LinguistSegmentStatusCounts = Record<LinguistSegmentStatus, number>

/** Quick Health 单项检查；完整性范围必须显式，避免把抽样说成全量。 */
export interface LinguistProjectHealthCheckInfo {
  id: 'project_json' | 'cat_db_open' | 'schema_version' | 'asset_sources'
  ok: boolean
  scope: 'complete' | 'sampled'
  checkedItems?: number
  totalItems?: number
  /** 仅含错误码 / 计数，绝无客户文本。 */
  detail?: string
}

/** 打开项目时的轻量 Quick Health，不代表完整性全检。 */
export interface LinguistProjectHealthReport {
  kind: 'quick'
  projectId: string
  healthy: boolean
  checkedAt: string
  checks: LinguistProjectHealthCheckInfo[]
}

export type LinguistIntegrityCheckId =
  | 'project_manifest'
  | 'schema_version'
  | 'source_digests'
  | 'blob_digests'
  | 'sqlite_integrity'
  | 'foreign_keys'
  | 'orphans'
  | 'proposal_references'
  | 'qa_references'
  | 'review_references'
  | 'event_sequence'
  | 'job_lineage'
  | 'run_lineage'
  | 'export_manifests'
  | 'session_workspaces'

export interface LinguistIntegrityProblem {
  /** 稳定机器码与数量；不携带路径、文件名或客户内容。 */
  code: string
  count: number
}

export interface LinguistIntegrityCheck {
  id: LinguistIntegrityCheckId
  status: 'passed' | 'failed' | 'unavailable'
  checkedItems: number
  failedItems: number
  unavailableItems: number
  problems: LinguistIntegrityProblem[]
}

/** Full Integrity Scrub 的实时结果；不同于打开项目时的 Quick Health。 */
export interface LinguistIntegrityScrubReport {
  schemaVersion: 1
  kind: 'full'
  projectId: string
  jobId: string
  executor: 'worker_thread'
  workerThreadId: number
  outcome: 'passed' | 'failed' | 'incomplete'
  startedAt: string
  completedAt: string
  checks: LinguistIntegrityCheck[]
}

export interface LinguistIntegrityScrubProgress {
  checkId: LinguistIntegrityCheckId
  completedItems: number
  totalItems: number
  completedChecks: number
  totalChecks: number
  percent: number
}

export type LinguistIntegrityScrubEvent =
  | {
    projectId: string
    jobId: string
    state: 'running'
    progress: LinguistIntegrityScrubProgress
  }
  | {
    projectId: string
    jobId: string
    state: 'completed'
    report: LinguistIntegrityScrubReport
  }
  | {
    projectId: string
    jobId: string
    state: 'cancelled'
  }
  | {
    projectId: string
    jobId: string
    state: 'failed'
    errorCode: 'WORKER_FAILED'
  }

export interface LinguistIntegrityStartRequest {
  projectId: string
}

export interface LinguistIntegrityStartResult {
  jobId: string
}

export interface LinguistIntegrityCancelRequest {
  projectId: string
  jobId: string
}

export interface LinguistIntegrityCancelResult {
  cancelled: boolean
}

export interface LinguistIntegrityExportReportRequest {
  projectId: string
  jobId: string
}

export type LinguistIntegrityExportReportResult =
  | { cancelled: true }
  | {
    cancelled: false
    filename: string
    sha256: string
    sizeBytes: number
    verifiedAt: string
  }

/** 导入警告（cat-formats ImportWarning 的线格式镜像）。 */
export interface LinguistImportWarning {
  /** 稳定的 adapter 作用域 code，如 'fake_tsv.empty_key'。 */
  code: string
  message: string
  segmentKey?: string
}

/** 项目资产的静态展示元数据；CAT 分页查询不额外重复聚合进度。 */
export interface LinguistAssetMetadata {
  assetId: string
  /** 导入时的文件 basename（展示元数据，绝非路径）。 */
  filename: string
  formatId: string
  segmentCount: number
  /** 源字节 SHA-256（hex，64 字符）。 */
  sourceSha256: string
}

/**
 * getSummary 的资产信息：静态元数据加 Store GROUP BY 的真实进度和开放 QA 数。
 * 刻意不含时间戳：领域 Asset 本身不携带导入时间（assets.created_at 不进领域类型）。
 */
export interface LinguistAssetInfo extends LinguistAssetMetadata {
  segmentCounts: LinguistSegmentStatusCounts
  currentStageCounts: LinguistCurrentStageStateCounts
  openQaCount: number
}

/**
 * 领域边界（2026-08）：一次导入的双语文件是「批次」（Batch，一次交付任务，
 * 拥有独立 Segments / QA / Export），不是「语言资产」。语言资产是
 * LinguistProjectAssetKind 承载的项目级长期资源（Style Guide / Context 等）。
 * 底层 schema 13 的 assets 表 / asset_id 是兼容存储细节，对外新代码统一使用
 * Batch 命名；Asset 命名保留为同一类型的兼容别名，不做全仓重命名或 DB 迁移。
 */
export type LinguistBatchMetadata = LinguistAssetMetadata
export type LinguistBatchInfo = LinguistAssetInfo

// ===== 请求 / 响应契约 =====

export interface LinguistProjectListRequest {
  /** true 时含已归档项目；缺省 false。 */
  includeArchived?: boolean
}

export type LinguistProjectListResult = LinguistProjectInfo[]

export interface LinguistProjectCreateRequest {
  name: string
  sourceLocale: string
  targetLocale: string
  /** 显式关联既有 Proma 工作区 id；缺省时主进程按工作区 id 约定分配。 */
  promaWorkspaceId?: string
  /** 新建界面必须显式提交；旧调用缺省时兼容为 translation。 */
  workflowStage?: LinguistWorkflowStage
  outputStatusPolicy?: LinguistWorkflowOutputStatusPolicy
  qaProfile?: LinguistQaProfile
}

export type LinguistProjectCreateResult = LinguistProjectInfo

export interface LinguistProjectOpenRequest {
  projectId: string
}

/**
 * open 的语义：主进程打开（并缓存）项目 DB 句柄，返回元数据 + 健康报告。
 * UI 导航是 renderer 自己的事，不在本契约内。
 */
export interface LinguistProjectOpenResult {
  project: LinguistProjectInfo
  health: LinguistProjectHealthReport
}

export interface LinguistProjectImportRequest {
  projectId: string
}

export interface LinguistXlsxMappingColumnPreview {
  /** 0-based physical worksheet column. */
  index: number
  /** Exact header text; this is what a confirmed mapping sends back. */
  header: string
  /** false for blank or normalized-duplicate headers, which are unsafe to persist by name. */
  selectable: boolean
}

export interface LinguistXlsxMappingSampleCell {
  columnIndex: number
  value: string
  truncated: boolean
}

export interface LinguistXlsxMappingSampleRow {
  /** Physical Excel row number, never a display-only ordinal. */
  rowNo: number
  cells: LinguistXlsxMappingSampleCell[]
}

export interface LinguistXlsxMappingPreviewSheet {
  name: string
  state: 'visible' | 'hidden' | 'veryHidden'
  /** Physical header rows returned by the parser; v1 mapping uses the first row. */
  headerRowNumbers: number[]
  columns: LinguistXlsxMappingColumnPreview[]
  sampleRows: LinguistXlsxMappingSampleRow[]
  coverage: {
    physicalRows: number
    dataRows: number
    nonEmptyDataRows: number
    emptyDataRows: number
    shownSampleRows: number
    truncated: boolean
  }
  distortion: {
    formulaCells: number
    formulaCellsWithCachedValue: number
    formulaCellsWithoutCachedValue: number
    errorCells: number
    mergedRanges: number
    mergedCoveredCells: number
    phoneticRunsExcluded: number
    ooxmlEscapesRestored: number
  }
}

/** Main-process-derived workbook evidence. No filesystem path or source bytes are exposed. */
export interface LinguistXlsxMappingPreview {
  sourceSha256: string
  sheets: LinguistXlsxMappingPreviewSheet[]
  skippedSheets: Array<{ name: string; state: 'visible' | 'hidden' | 'veryHidden'; reason: string }>
}

export interface LinguistProjectConfirmXlsxMappingRequest {
  projectId: string
  /** Short-lived main-process token bound to the selected source bytes. */
  mappingId: string
  /** Renderer echo of preview.sourceSha256; mismatches are rejected. */
  sourceSha256: string
  sheetName: string
  columns: {
    key?: string
    source: string
    target: string
    locked?: string
    context?: string
  }
}

/**
 * 导入结果。用户在选择器中取消是正常分支（cancelled: true），不是错误；
 * 成功分支携带服务结果 + 被选中文件的 basename（仅为展示元数据，
 * renderer 永远拿不到、也不需要文件系统路径）。
 * LA-INTAKE-007 起携带导入回读验证报告（导入与验证同一事务，失败即回滚，
 * 线上只会出现 ok:true 的报告；ok:false 的批次以 IMPORT_VERIFICATION_FAILED
 * 错误信封返回）。
 */
export type LinguistProjectImportResult =
  | { cancelled: true }
  | {
      cancelled: false
      requiresXlsxMapping: true
      /** Selected basename only; renderer never receives the source path. */
      filename: string
      mappingId: string
      sourceSha256: string
      preview: LinguistXlsxMappingPreview
    }
  | {
      cancelled: false
      requiresXlsxMapping: false
      /** 被选中文件的 basename（展示用元数据；绝非路径）。 */
      filename: string
      status: 'imported' | 'skipped-duplicate'
      assetId: string
      formatId: string
      segmentCount: number
      warnings: LinguistImportWarning[]
      sourceSha256: string
      verification: LinguistImportVerificationReport
      unknownTagSummary: LinguistUnknownTagPatternInfo[]
    }

export type LinguistProjectConfirmXlsxMappingResult = Exclude<
  LinguistProjectImportResult,
  { cancelled: true } | { requiresXlsxMapping: true }
>

export interface LinguistProjectGetSummaryRequest {
  projectId: string
}

export interface LinguistProjectRenameRequest {
  projectId: string
  name: string
}

export type LinguistProjectRenameResult = LinguistProjectInfo

export interface LinguistProjectSetLocalesRequest {
  projectId: string
  sourceLocale: string
  targetLocale: string
}

export type LinguistProjectSetLocalesResult = LinguistProjectInfo

export interface LinguistProjectReorderRequest {
  /** 必须恰好包含当前全部活跃项目 id，且不得重复。 */
  orderedProjectIds: string[]
}

export type LinguistProjectReorderResult = LinguistProjectInfo[]

/**
 * 项目摘要：元数据 + 资产列表/计数 + 按状态段计数。
 * 计数走廉价 COUNT/GROUP BY（不加载段行）；assets 为资产元数据行
 * （listByProject，按创建序，与 assetCount 同源）——PB-033 资产区展示用，
 * 仍不加载段 / source blob。
 */
export interface LinguistProjectSummary {
  project: LinguistProjectInfo
  assetCount: number
  totalSegments: number
  segmentCounts: LinguistSegmentStatusCounts
  currentStageCounts: LinguistCurrentStageStateCounts
  /** 已导入资产列表（PB-033；与 assetCount 一致，按创建时间升序）。 */
  assets: LinguistAssetInfo[]
}

/** cat-core Segment 的 JSON 线格式镜像。 */
export interface LinguistSegmentInfo {
  id: string
  assetId: string
  ordinal: number
  key?: string
  source: string
  target: string
  sourceLocale: string
  targetLocale: string
  status: LinguistSegmentStatus
  /** schema v8 前的线格式可缺省；UI 按 untouched 处理。 */
  currentStageState?: LinguistCurrentStageState
  importedNativeStatus?: string
  locked: boolean
  revision: number
  sourceHash: string
  context?: {
    note?: string
    origin?: string
    meta?: Record<string, string>
  }
}

export interface LinguistCatQueryRequest {
  projectId: string
  assetId?: string
  status?: LinguistSegmentStatus
  /** 当前 T/E/P 任务内的进度；renderer 主筛选使用此字段。 */
  currentStageState?: LinguistCurrentStageState
  search?: string
  limit?: number
  offset?: number
  /** PB-061：仅首个过滤请求需要稳定 ID 索引；后续 page 请求保持 false。 */
  includeIndex?: boolean
}

export interface LinguistCatQueryResult {
  assets: LinguistAssetMetadata[]
  segments: LinguistSegmentInfo[]
  /** 与当前过滤/排序一致的稳定 key 索引；includeIndex=false 时为空数组。 */
  segmentIds: string[]
  total: number
  limit: number
  offset: number
  hasMore: boolean
}

export interface LinguistCatEditSegmentRequest {
  projectId: string
  segmentId: string
  target: string
  expectedRevision: number
}

export type LinguistCatEditSegmentResult = LinguistSegmentInfo

export interface LinguistCatStageMutationRequest {
  projectId: string
  segmentId: string
  expectedRevision: number
}

export type LinguistCatConfirmStageRequest = LinguistCatStageMutationRequest
export type LinguistCatUnconfirmStageRequest = LinguistCatStageMutationRequest
export type LinguistCatStageMutationResult = LinguistSegmentInfo

export interface LinguistCatConfirmStageBulkRequest {
  projectId: string
  items: Array<{
    segmentId: string
    expectedRevision: number
  }>
}

export interface LinguistCatStageMutationFailure {
  segmentId: string
  code: string
  message: string
}

export interface LinguistCatConfirmStageBulkResult {
  succeeded: LinguistSegmentInfo[]
  failed: LinguistCatStageMutationFailure[]
}

export interface LinguistWorkflowStageEventInfo {
  stage: LinguistWorkflowStage
  action: 'confirmed' | 'unconfirmed'
  segmentRevision: number
  actor?: string
  createdAt: string
}

export interface LinguistCatGetContextRequest {
  projectId: string
  segmentId: string
}

/** PB-096：QA 契约五档严重度（L0 Blocker → L4 Suggestion）。 */
export type LinguistQaFindingSeverity = 'L0' | 'L1' | 'L2' | 'L3' | 'L4'
export type LinguistQaFindingStatus = 'open' | 'resolved' | 'waived'

/** PB-096：处置四值（创建时确定；与 status 状态机正交）。 */
export type LinguistQaFindingDisposition = 'defect' | 'needs_review' | 'query' | 'info'

/** PB-096：缺陷分类 29 枚举（契约《通用缺陷等级》全量覆盖，含 other 兜底）。 */
export type LinguistQaIssueType =
  | 'hallucination' | 'mistranslation' | 'omission' | 'addition'
  | 'terminology_hard' | 'terminology_soft' | 'consistency' | 'style_guide'
  | 'character_voice' | 'register_tone' | 'fluency_readability' | 'grammar_syntax'
  | 'spelling_typo' | 'punctuation_typography' | 'capitalization_case' | 'numbers_units_dates'
  | 'names_titles_honorifics' | 'gender_pronouns' | 'cultural_sensitivity' | 'profanity_rating'
  | 'legal_compliance' | 'format_tags' | 'placeholders_variables' | 'whitespace_linebreaks'
  | 'length_limit' | 'ui_terminology' | 'glossary_conflict' | 'source_issue' | 'other'

/** 含当前 Segment 修订，供「编辑后才能 resolve」的 UI 作无障碍禁用提示。 */
export interface LinguistQaFindingInfo {
  id: string
  segmentId: string
  code: string
  severity: LinguistQaFindingSeverity
  issueType: LinguistQaIssueType
  disposition: LinguistQaFindingDisposition
  message: string
  status: LinguistQaFindingStatus
  /** 运行 QA 时的 Segment 修订。 */
  segmentRevision: number
  /** 当前 Segment 修订；主进程实时读取。 */
  currentRevision: number
  waiverReason?: string
  waivedBy?: string
  waivedAt?: string
}

export interface LinguistCatRunQaRequest {
  projectId: string
}

/** PB-096：按契约五档 severity 与四值 disposition 计数。 */
export interface LinguistCatRunQaResult {
  total: number
  severityCounts: Record<LinguistQaFindingSeverity, number>
  dispositionCounts: Record<LinguistQaFindingDisposition, number>
}

export interface LinguistCatListQaFindingsRequest {
  projectId: string
  segmentId?: string
  code?: string
  status?: LinguistQaFindingStatus
  severity?: LinguistQaFindingSeverity
  disposition?: LinguistQaFindingDisposition
  limit?: number
  offset?: number
}

export interface LinguistCatListQaFindingsResult {
  items: LinguistQaFindingInfo[]
  total: number
  limit: number
  offset: number
  hasMore: boolean
}

export interface LinguistCatResolveQaFindingRequest {
  projectId: string
  findingId: string
}

export interface LinguistCatWaiveQaFindingRequest extends LinguistCatResolveQaFindingRequest {
  reason: string
  operator: string
}

export interface LinguistCatWaiveQaFindingsBulkRequest {
  projectId: string
  findingIds: string[]
  reason: string
  operator: string
}

export type LinguistCatWaiveQaFindingsBulkResult = LinguistQaFindingInfo[]

export interface LinguistCatContextResult {
  segment: LinguistSegmentInfo
  pendingProposal?: LinguistProposalInfo
  qaFindings: LinguistQaFindingInfo[]
  tmMatches: LinguistTmMatchInfo[]
  termMatches: LinguistTermMatchInfo[]
  stageEvents?: LinguistWorkflowStageEventInfo[]
}

export type LinguistTmMatchType = 'exact' | 'contains' | 'fuzzy'

/** 项目 TM 的匹配结果；score 只表示确定性文字相似度，不是模型置信度。 */
export interface LinguistTmInfo {
  id: string
  source: string
  target: string
  sourceLocale: string
  targetLocale: string
  origin?: string
}

export interface LinguistTmMatchInfo extends LinguistTmInfo {
  score: number
  matchType: LinguistTmMatchType
}

export type LinguistTermStatus = 'allowed' | 'preferred' | 'required' | 'forbidden' | 'deprecated'
export type LinguistTermMatchType = 'exact' | 'contains'

export interface LinguistTermInfo {
  id: string
  term: string
  translation: string
  status: LinguistTermStatus
  caseSensitive: boolean
  note?: string
  /** PB-095：所属模块/分类/配图（blobs/ 相对路径），可空标注。 */
  module?: string
  category?: string
  imageRef?: string
}

export interface LinguistTermMatchInfo extends LinguistTermInfo {
  matchType: LinguistTermMatchType
  /** 多个 preferred 项给同一术语不同译文时只标冲突，不擅自选第一条。 */
  conflict: boolean
  start: number
  end: number
  lowDiscrimination: boolean
}

export interface LinguistReferenceQueryRequest {
  projectId: string
  query?: string
  status?: LinguistTermStatus
  limit?: number
  offset?: number
}

export interface LinguistReferenceQueryResult<T> {
  items: T[]
  total: number
  limit: number
  offset: number
  hasMore: boolean
  /** 当前 TM/TB 类别的文件导入来源；仅含安全展示元数据。 */
  imports?: LinguistReferenceImportInfo[]
}

/** 文件导入型 TM/TB 的安全 provenance；没有本机路径或 blob 相对路径。 */
export interface LinguistReferenceImportInfo {
  id: string
  kind: 'tm' | 'terms'
  filename: string
  sourceSha256: string
  createdAt: string
}

export interface LinguistReferenceImportRequest {
  projectId: string
  kind: 'tm' | 'terms'
}

/** 有界 TM 候选样本；长文本在主进程截断，完整原件另走 Preview Tab。 */
export interface LinguistTmReferenceCandidateSample {
  kind: 'tm'
  source: string
  target: string
}

/** 有界术语候选样本；不代表已进入术语库。 */
export interface LinguistTermReferenceCandidateSample {
  kind: 'terms'
  term: string
  translation: string
  status: LinguistTermStatus
  caseSensitive: boolean
  note?: string
}

export type LinguistReferenceCandidateSample =
  | LinguistTmReferenceCandidateSample
  | LinguistTermReferenceCandidateSample

/** 解析候选的有界展示摘要；完整解析产物只保留在主进程短生命周期 token 中。 */
export interface LinguistReferenceCandidateSummary {
  entryCount: number
  warningCount: number
  warnings: string[]
  samples: LinguistReferenceCandidateSample[]
  samplesTruncated: boolean
  valuesTruncated: boolean
}

/** 选择器取消、待确认候选、已确认写入三态；绝不把路径或 bytes 下行。 */
export type LinguistReferenceImportResult =
  | { cancelled: true }
  | {
      cancelled: false
      requiresConfirmation: true
      filename: string
      candidateId: string
      sourceSha256: string
      summary: LinguistReferenceCandidateSummary
    }
  | {
      cancelled: false
      requiresConfirmation: false
      filename: string
      imported: number
      unchanged: number
      warnings: string[]
      source: LinguistReferenceImportInfo
    }

/** 确认请求必须完整回显候选的 project/kind/token/hash 绑定。 */
export interface LinguistReferenceConfirmImportRequest {
  projectId: string
  kind: 'tm' | 'terms'
  candidateId: string
  sourceSha256: string
}

export type LinguistReferenceConfirmImportResult = Extract<
  LinguistReferenceImportResult,
  { requiresConfirmation: false }
>

/** 取消只释放内存候选；无项目写入。 */
export type LinguistReferenceCancelImportRequest = LinguistReferenceConfirmImportRequest

export interface LinguistReferenceCancelImportResult {
  candidateId: string
}

/** 确认前的原文件预览请求；token 与 project/kind/hash 都由主进程复核。 */
export type LinguistReferenceCandidatePreviewRequest = LinguistReferenceConfirmImportRequest

export interface LinguistTermUpsertRequest {
  projectId: string
  /** 缺省为创建；给定时只能更新该项目的现有记录。 */
  id?: string
  term: string
  translation: string
  status: LinguistTermStatus
  caseSensitive: boolean
  note?: string
  /** PB-095 标注列（可空；仅显式 id 更新路径写入）。 */
  module?: string
  category?: string
  imageRef?: string
}

export type LinguistTermUpsertResult = LinguistTermInfo

export interface LinguistTermsUpsertRequest {
  projectId: string
  terms: Array<Omit<LinguistTermUpsertRequest, 'projectId'>>
}

export interface LinguistTermsUpsertResult {
  terms: LinguistTermInfo[]
  count: number
}

export interface LinguistTermsDeleteRequest {
  projectId: string
  termIds: string[]
}

export interface LinguistTermsDeleteResult {
  deletedTermIds: string[]
  count: number
}

export interface LinguistTermConflictsRequest {
  projectId: string
  statuses?: LinguistTermStatus[]
  module?: string
  category?: string
}

export interface LinguistTermConflictInfo {
  normalizedTerm: string
  entries: LinguistTermInfo[]
}

export interface LinguistTermConflictsResult {
  conflicts: LinguistTermConflictInfo[]
  count: number
}

export interface LinguistTermsValidateRequest {
  projectId: string
  segmentIds: string[]
}

export interface LinguistTermsValidateResult {
  missingRequired: Array<{ segmentId: string; termId: string; term: string; expected: string }>
  forbiddenHits: Array<{ segmentId: string; termId: string; forbidden: string }>
  preferredNotUsed: Array<{ segmentId: string; termId: string; term: string; preferred: string }>
  unresolvedConflicts: Array<{ segmentId: string; term: string; termIds: string[] }>
}

export interface LinguistReferenceDeleteRequest {
  projectId: string
  kind: 'tm' | 'terms'
  id: string
}

export interface LinguistReferenceDeleteResult {
  id: string
}

// ===== 项目语言资产线类型与请求 / 响应契约（PB-095）=====
//
// 本节的 LinguistProjectAssetKind 才是领域语言中的「语言资产」（项目级长期
// 复用资源），与上文表示「批次」的 LinguistAssetInfo 严格区分。
// 以下类型是 cat-store 项目资产域类型（schema v6）的 JSON 线格式镜像
// （@proma/shared 不依赖 linguist 包）。contextDocs 查询只回元数据：
// text_extract 全文不下发（模型经 cat_read_context_doc 按需读），
// blob 字节永不过 IPC（v1 不在 UI 显示图片，见交接报告）。

export type LinguistProjectAssetKind =
  | 'styleGuideRules'
  | 'sentencePatterns'
  | 'contextDocs'
  | 'techConstraints'
  | 'voiceProfiles'

export interface LinguistStyleGuideRuleInfo {
  id: string
  groupKey?: string
  ruleText: string
  sourceExample?: string
  goodExample?: string
  badExample?: string
  /** blobs/ 相对路径（v1 预留，IPC 不开放写入）。 */
  screenshotRef?: string
  updatedAt: string
  updatedBy?: string
}

export type LinguistSentencePatternStatus = 'confirmed' | 'pending' | 'rejected'

export interface LinguistSentencePatternInfo {
  id: string
  textType?: string
  module?: string
  source: string
  draftTarget?: string
  suggestedTarget?: string
  reviewer?: string
  status: LinguistSentencePatternStatus
  createdAt: string
  updatedAt: string
}

export type LinguistContextDocKind = 'doc' | 'image'

export interface LinguistContextDocInfo {
  id: string
  kind: LinguistContextDocKind
  /** 导入时的文件 basename（元数据，不是路径）。 */
  originalFilename: string
  sha256?: string
  note?: string
  createdAt: string
  /** 是否有可经 cat_read_context_doc 阅读的纯文本抽取。 */
  hasTextExtract: boolean
  textExtractLength: number
  /**
   * 仅 kind='image' 且 blob 字节在盘上时下发：proma-file:// 不透明
   * token URL（local-file-protocol，TTL/realpath 围栏），供 renderer
   * <img> 内联预览。renderer 永不拿到绝对路径。
   */
  previewUrl?: string
}

export type LinguistTechConstraintKind = 'length' | 'rich_text' | 'tag_note'

export interface LinguistTechConstraintInfo {
  id: string
  kind: LinguistTechConstraintKind
  /** 作用域（text_type 或资产级；可空 = 全局）。 */
  scope?: string
  valueJson: string
  note?: string
  updatedAt: string
}

export interface LinguistVoiceProfileInfo {
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

export type LinguistProjectAssetInfo =
  | LinguistStyleGuideRuleInfo
  | LinguistSentencePatternInfo
  | LinguistContextDocInfo
  | LinguistTechConstraintInfo
  | LinguistVoiceProfileInfo

export interface LinguistAssetsQueryRequest {
  projectId: string
  kind: LinguistProjectAssetKind
  /** 子串过滤（各 kind 的匹配列见主进程实现）。 */
  query?: string
  /** 仅 sentencePatterns 有效。 */
  status?: LinguistSentencePatternStatus
  limit?: number
  offset?: number
}

export type LinguistAssetsQueryResult = LinguistReferenceQueryResult<LinguistProjectAssetInfo>

export interface LinguistStyleGuideRuleUpsertInput {
  /** 缺省为创建；给定时只能更新该项目的现有记录。 */
  id?: string
  groupKey?: string
  ruleText: string
  sourceExample?: string
  goodExample?: string
  badExample?: string
  updatedBy?: string
}

export interface LinguistSentencePatternUpsertInput {
  id?: string
  textType?: string
  module?: string
  source: string
  draftTarget?: string
  suggestedTarget?: string
  reviewer?: string
  /** 缺省 pending。 */
  status?: LinguistSentencePatternStatus
}

export interface LinguistTechConstraintUpsertInput {
  id?: string
  kind: LinguistTechConstraintKind
  scope?: string
  /** 必须是合法 JSON 文本（主进程校验）。 */
  valueJson: string
  note?: string
}

export interface LinguistVoiceProfileUpsertInput {
  id?: string
  speaker: string
  textType?: string
  register?: string
  person?: string
  toneMarkers?: string[]
  taboos?: string[]
  notes?: string
  updatedBy?: string
}

/** contextDocs 的 upsert 仅支持 note 更新（行由导入创建）。 */
export interface LinguistContextDocNoteUpdateInput {
  id: string
  note?: string
}

export type LinguistAssetsUpsertRequest =
  | { projectId: string; kind: 'styleGuideRules'; item: LinguistStyleGuideRuleUpsertInput }
  | { projectId: string; kind: 'sentencePatterns'; item: LinguistSentencePatternUpsertInput }
  | { projectId: string; kind: 'contextDocs'; item: LinguistContextDocNoteUpdateInput }
  | { projectId: string; kind: 'techConstraints'; item: LinguistTechConstraintUpsertInput }
  | { projectId: string; kind: 'voiceProfiles'; item: LinguistVoiceProfileUpsertInput }

export type LinguistAssetsUpsertResult = LinguistProjectAssetInfo

export interface LinguistAssetsDeleteRequest {
  projectId: string
  kind: LinguistProjectAssetKind
  id: string
}

export type LinguistAssetsDeleteResult = LinguistReferenceDeleteResult

export interface LinguistContextDocImportRequest {
  projectId: string
  note?: string
}

export type LinguistContextDocImportResult =
  | { cancelled: true }
  | {
      cancelled: false
      /** 被选中文件的 basename（opaque 结果，非路径）。 */
      filename: string
      doc: LinguistContextDocInfo
    }

export interface LinguistSentencePatternImportRequest {
  projectId: string
}

export interface LinguistSentencePatternImportResult {
  cancelled: boolean
  filename?: string
  imported?: number
  unchanged?: number
  warnings?: string[]
}

// ===== CAT 资产源文件预览契约（PB-089）=====

export interface LinguistAssetPreviewRequest {
  projectId: string
  /** CAT 资产 opaque id（Stable ID v1/v2；主进程强制形状校验）。 */
  assetId: string
}

/** TM/TB 文件导入原件预览请求；id 由主进程围栏解析，不传路径或字节。 */
export interface LinguistReferenceImportPreviewRequest {
  projectId: string
  importId: string
}

/**
 * Context 文档 blob 预览请求（与 PB-089 同源纪律：opaque id 进，
 * 主进程围栏解析 blobs/ 内绝对路径，零字节/零路径过 IPC）。
 */
export interface LinguistContextDocPreviewRequest {
  projectId: string
  /** contextDocs 行 opaque id（项目资产 Stable ID；主进程强制形状校验）。 */
  docId: string
}

/**
 * 预览结果三态分派（discriminated union）：
 * - text：xliff/xlf/mqxliff/sdlxliff/mxliff/csv/tsv/json（批次源文件）或
 *   md/markdown/txt 等文本类 context 文档直接读回，超过主进程截断护栏时
 *   截断并置 truncated；
 * - html：docx / xlsx 经 Proma 预览栈转换的 HTML（xlsx 附提取纯文本）；
 * - url：未知扩展名降级，proma-file:// 不透明 token URL 由 renderer 直渲染。
 * filename 恒为资产原始文件名（展示元数据；绝非路径）。
 */
export type LinguistAssetPreviewResult =
  | { kind: 'text'; text: string; truncated: boolean; filename: string }
  | { kind: 'html'; html: string; text?: string; filename: string }
  | { kind: 'url'; url: string; filename: string; ext: string }

export interface LinguistProjectArchiveRequest {
  projectId: string
}

export type LinguistProjectArchiveResult = LinguistProjectInfo

export interface LinguistProjectDeleteRequest {
  projectId: string
  /** 必须与主进程当前项目名精确一致；renderer 不能绕过。 */
  confirmationName: string
}

export interface LinguistProjectDeleteResult {
  projectId: string
  /** 数据根 trash/ 下的恢复目录名，绝非绝对路径。 */
  recoveryName?: string
}

export interface LinguistProjectSetWorkflowConfigRequest {
  projectId: string
  workflowStage: LinguistWorkflowStage
  outputStatusPolicy?: LinguistWorkflowOutputStatusPolicy | null
  qaProfile?: LinguistQaProfile
}

export type LinguistProjectSetWorkflowConfigResult = LinguistProjectInfo

// ===== 备份 / 恢复请求响应契约（PB-111，计划 §24）=====
//
// renderer 只提交 projectId + backupName（白名单形状，见上方两个 PATTERN
// 常量）；响应只携带备份名 / 根相对路径 / 摘要计数，绝无绝对路径。

export interface LinguistProjectBackupRequest {
  projectId: string
}

export interface LinguistProjectBackupResult {
  /** 备份目录名（backup-<safeTs>）；preview/restore 的 opaque 标识。 */
  backupName: string
  /** linguist 根相对路径（projects/<id>/backups/backup-<ts>）。 */
  backupDir: string
  method: 'vacuum_into' | 'backup_api'
  fileCount: number
  totalSizeBytes: number
  /** 备份库的 schema_migrations MAX(version)。 */
  schemaVersion: number
}

export interface LinguistBackupListRequest {
  projectId: string
}

/** 备份列表项：名称 + 摘要元数据（manifest 派生），绝无路径。 */
export interface LinguistBackupInfo {
  name: string
  /** directory = 新格式（可恢复）；legacy = PB-024 两文件旧格式（仅可预览）。 */
  format: 'directory' | 'legacy'
  createdAt?: string
  sizeBytes: number
  schemaVersion?: number
  method?: 'vacuum_into' | 'backup_api'
  fileCount?: number
}

export type LinguistBackupListResult = LinguistBackupInfo[]

export interface LinguistRestorePreviewRequest {
  projectId: string
  backupName: string
}

/** 恢复预览中的库摘要（廉价 COUNT/GROUP BY + 资产元数据行）。 */
export interface LinguistBackupSummary {
  assetCount: number
  totalSegments: number
  segmentCounts: LinguistSegmentStatusCounts
  currentStageCounts: LinguistCurrentStageStateCounts
  assets: LinguistAssetInfo[]
}

export interface LinguistRestorePreviewResult {
  backupName: string
  format: 'directory' | 'legacy'
  /** false = verify 未通过 / legacy 格式 / 库打不开，确认恢复会被拒绝。 */
  restorable: boolean
  /** 新格式备份的 verify 报告（legacy 缺省）。 */
  verification?: { ok: boolean; schemaVersion?: number; problems: string[] }
  backupSummary?: LinguistBackupSummary
  currentSummary?: LinguistBackupSummary
  backupSchemaVersion?: number
  currentSchemaVersion: number
  /** true = 备份 schema 旧于当前构建，恢复后首次打开自动迁移。 */
  willMigrate: boolean
  /** 人读提示（legacy 降级 / verify 失败 / 将迁移；仅码级描述）。 */
  notice?: string
}

export interface LinguistProjectRestoreRequest {
  projectId: string
  backupName: string
}

export interface LinguistProjectRestoreResult {
  backupName: string
  /** 恢复前安全快照名（backups/pre-restore-<safeTs>，纯名称非路径）。 */
  preRestoreName: string
  /** 恢复并重开后的 schema 版本（旧版备份已自动迁移）。 */
  schemaVersion: number
}

export interface LinguistExportSaveAssetRequest {
  projectId: string
  assetId: string
}

export type LinguistPrepareDeliveryRequest = LinguistExportSaveAssetRequest

export type LinguistDeliveryBlockerCode =
  | 'PENDING_PROPOSALS'
  | 'UNCONFIRMED_SEGMENTS'
  | 'OPEN_QA_ERRORS'
  | 'PHRASE_MASTER_MAPPING'

export interface LinguistDeliveryBlockerInfo {
  code: LinguistDeliveryBlockerCode
  count: number
  message: string
}

export interface LinguistDeliveryQaSummary {
  openErrors: number
  openWarnings: number
  waived: number
  bySeverity: Record<LinguistQaFindingSeverity, number>
}

export interface LinguistDeliveryPreflight {
  projectId: string
  assetId: string
  filename: string
  formatId: string
  workflowStage: LinguistWorkflowStage
  expectedNativeStatus?: string
  segmentCount: number
  stageCounts: LinguistCurrentStageStateCounts
  lockedSegments: number
  unconfirmedUnlockedSegments: number
  pendingProposalCount: number
  qa: LinguistDeliveryQaSummary
  ready: boolean
  blockers: LinguistDeliveryBlockerInfo[]
}

export interface LinguistDeliveryVerification {
  verifiedSegments: number
  verifiedSourceSegments: number
  verifiedTargetSegments: number
  verifiedNativeStatusSegments: number
  changedTargetSegments: number
  changedNativeStatusSegments: number
  tagsPreserved: boolean
  sha256: string
  suggestedFilename: string
}

export interface LinguistPrepareDeliveryResult {
  preflight: LinguistDeliveryPreflight
  verification?: LinguistDeliveryVerification
  reportMarkdown: string
}

/** 导出审计元数据；刻意不含 staging / 用户目标路径。 */
export interface LinguistExportArtifactInfo {
  id: string
  assetId: string
  sha256: string
  segmentCount: number
  createdAt: string
}

export interface LinguistExportDeliveryVerification {
  sha256: string
  sizeBytes: number
  verifiedAt: string
  /** 客户正文无关的项目状态指纹；段 revision/状态变化即改变。 */
  projectRevision: string
}

export type LinguistExportSaveAssetResult =
  | { cancelled: true }
  | {
      cancelled: false
      /** 用户目标文件的 basename，仅供成功提示。 */
      filename: string
      artifact: LinguistExportArtifactInfo
      delivery: LinguistExportDeliveryVerification
      verifiedSegments: number
      preparation: LinguistPrepareDeliveryResult
    }

/** PB-102：列出项目 exports/ 目录（renderer 只提交 projectId，计划 §7.4）。 */
export interface LinguistExportListRequest {
  projectId: string
}

/**
 * exports/ 目录单个交付物的展示投影：仅 basename + 大小 + 时间，
 * 绝不携带任何文件系统路径。assetId 由 staging 文件名前缀解析
 * （`<assetId>-<sha256:16>-<原文件名>`），供点击时回走 PB-073 native Save 链路。
 */
export interface LinguistExportFileInfo {
  filename: string
  /** 解析得出的来源资产 id；文件名不符 staging 形状时缺省。 */
  assetId?: string
  sizeBytes: number
  /** epoch ms。 */
  modifiedAt: number
  /** manifest 校验通过时提供；历史或损坏 manifest 缺省。 */
  sha256?: string
  createdAt?: string
  verifiedAt?: string
  projectRevision?: string
  /** true 表示项目段 revision/状态已晚于该交付物。 */
  stale?: boolean
}

export type LinguistExportListResult = LinguistExportFileInfo[]

// ===== Prompt / Observability / 隐私诊断包（LA-OBS-001）=====

export interface LinguistDiagnosticsRequest {
  projectId: string
  sessionId?: string
  /** 用户点击“重新探测”时为 true；主进程仍执行同一真实 Prompt 构建。 */
  retry?: boolean
}

export interface LinguistPromptStatusInfo {
  promptVersion: string
  promptHash: string
  role: import('./agent').LinguistRole
  roleSource: 'bundle' | 'fallback'
  renderer: 'xml' | 'markdown'
  projectDigestStatus: 'complete' | 'partial' | 'skipped'
  projectDigestTruncated: boolean
  charCount: number
}

export interface LinguistDiagnosticsQaMetrics {
  openErrors: number
  openWarnings: number
  pendingProposals: number
}

export interface LinguistDiagnosticsEventGap {
  latestSequence: number
  acknowledgedSequence: number
  pending: number
}

export type LinguistDiagnosticsJobStatus =
  | 'pending'
  | 'running'
  | 'paused'
  | 'completed'
  | 'failed'
  | 'cancelled'

export interface LinguistDevDiagnostics {
  profile?: {
    kind: 'linguist'
    role: import('./agent').LinguistRole
  }
  agentRuntime?: import('./agent-provider').AgentRuntime
  sessionCwd?: string
  tools: {
    /** Claude SDK 不公开基础工具清单时为 null，不用 MCP server 数冒充。 */
    base: number | null
    overlay: number
    observedAt?: string
  }
  trace: {
    projectId: string
    sessionId?: string
    runId?: string
    jobId?: string
    toolCallId?: string
    eventSequence: number
    availableFields: Array<
      'projectId' | 'sessionId' | 'runId' | 'jobId' | 'toolCallId' | 'eventSequence'
    >
    unavailableFields: Array<'runId' | 'jobId' | 'stepId' | 'toolCallId'>
  }
  metrics: {
    promptProbeLatencyMs: number
    promptProbeResultBytes: number
    qa: LinguistDiagnosticsQaMetrics
    eventGap: LinguistDiagnosticsEventGap
  }
  recentJob:
    | { status: 'not_available' }
    | {
      status: LinguistDiagnosticsJobStatus
      jobId: string
      runId: string
      runtime: string
      cursor: number
      total: number
    }
  worker: {
    mode: 'node-worker_threads' | 'not_observed'
    status: LinguistDiagnosticsJobStatus | 'idle' | 'degraded'
  }
}

export interface LinguistDiagnosticsStatus {
  projectRevision: string
  prompt: LinguistPromptStatusInfo
  /** 生产构建省略绝对 CWD 与内部关联字段；Prompt 健康仍始终可见。 */
  dev?: LinguistDevDiagnostics
}

export interface LinguistDiagnosticBundle {
  schemaVersion: 1
  createdAt: string
  privacy: {
    redacted: true
    autoUpload: false
    contains: {
      filenames: false
      contentSnippets: false
      customerText: false
      absolutePaths: false
      secrets: false
      hiddenReasoning: false
    }
  }
  correlation: {
    projectFingerprint: string
    sessionFingerprint?: string
    runFingerprint?: string
    jobFingerprint?: string
    toolCallFingerprint?: string
    eventSequence: number
    availableTraceFields: Array<
      | 'projectFingerprint'
      | 'sessionFingerprint'
      | 'runFingerprint'
      | 'jobFingerprint'
      | 'toolCallFingerprint'
      | 'eventSequence'
    >
    unavailableTraceFields: Array<
      'runFingerprint' | 'jobFingerprint' | 'stepId' | 'toolCallFingerprint'
    >
  }
  projectRevision: string
  prompt: LinguistPromptStatusInfo
  metrics: {
    promptProbeLatencyMs: number
    promptProbeResultBytes: number
    qa: LinguistDiagnosticsQaMetrics
    eventGap: LinguistDiagnosticsEventGap
  }
  runtime: {
    agentRuntime?: import('./agent-provider').AgentRuntime
    baseToolCount: number | null
    overlayToolCount: number
    workerMode: 'node-worker_threads' | 'not_observed'
    workerStatus: LinguistDiagnosticsJobStatus | 'idle' | 'degraded'
    recentJobStatus: LinguistDiagnosticsJobStatus | 'not_available'
  }
}

export interface LinguistDiagnosticBundlePreviewResult {
  bundle: LinguistDiagnosticBundle
  sizeBytes: number
}

export type LinguistDiagnosticBundleExportResult =
  | { cancelled: true }
  | {
    cancelled: false
    filename: string
    sha256: string
    sizeBytes: number
    verifiedAt: string
  }

// ===== 会话绑定请求 / 响应契约（PB-034）=====

/** active 正常；其余状态均保留历史但阻断发送，直到修复或用户显式永久解绑。 */
export type LinguistSessionBindingStatus =
  | 'active'
  | 'archived'
  | 'missing'
  | 'unavailable'

/** 会话 → 项目绑定的实时解析结果（绑定本身冻结，状态每次实时求值）。 */
export interface LinguistSessionBindingInfo {
  projectId: string
  /** 绑定时的项目名快照（项目缺失后仍可展示）。 */
  projectName: string
  status: LinguistSessionBindingStatus
  /** 项目当前元数据；missing/unavailable 时缺省。 */
  project?: LinguistProjectInfo
}

/** 项目对话列表项（轻量元数据；按 updatedAt 降序）。 */
export interface LinguistProjectChatSessionInfo {
  id: string
  title: string
  createdAt: number
  updatedAt: number
  role: import('./agent').LinguistRole
}

export interface LinguistSessionCreateForProjectRequest {
  projectId: string
  /** 可选标题（≤120 字符）；缺省用项目名。 */
  title?: string
  /** 默认岗位；所有岗位共享同一工具和权限。 */
  role?: import('./agent').LinguistRole
}

/** 创建结果即完整的 Agent 会话元数据（携带 linguistProjectId/Name 绑定；Pi runtime）。 */
export type LinguistSessionCreateForProjectResult = import('./agent').AgentSessionMeta

export interface LinguistSessionUpdateRoleRequest {
  sessionId: string
  role: import('./agent').LinguistRole
}

export type LinguistSessionUpdateRoleResult = import('./agent').AgentSessionMeta

export interface LinguistSessionListForProjectRequest {
  projectId: string
}

export type LinguistSessionListForProjectResult = LinguistProjectChatSessionInfo[]

export interface LinguistSessionGetBindingRequest {
  /** Agent 会话 id（非空字符串）。 */
  sessionId: string
}

/** 未绑定的普通会话 → binding 为 null（正常分支，非错误）。 */
export interface LinguistSessionGetBindingResult {
  binding: LinguistSessionBindingInfo | null
}

export interface LinguistSessionDetachBindingRequest {
  /** Agent 会话 id（非空字符串）。 */
  sessionId: string
}

export interface LinguistSessionDetachBindingResult {
  /** 本次调用是否实际移除了一个绑定；重复解绑为 false。 */
  detached: boolean
  /** 未知会话为 null；其余返回解绑后的权威会话元数据。 */
  session: import('./agent').AgentSessionMeta | null
}

export type LinguistSessionCopyBlockReason =
  | 'SESSION_NOT_FOUND'
  | 'NOT_LINGUIST_SESSION'
  | 'RUNNING'
  | 'NO_COMPLETED_ASSISTANT'
  | 'HISTORY_UNREADABLE'

export interface LinguistSessionCopyEligibilityRequest {
  sessionId: string
}

export type LinguistSessionCopyEligibilityResult =
  | {
      eligible: true
      mode: 'blank' | 'fork'
    }
  | {
      eligible: false
      reason: LinguistSessionCopyBlockReason
      message: string
    }

export interface LinguistSessionCopyToProjectRequest {
  sessionId: string
  targetProjectId: string
}

export type LinguistSessionCopyToProjectResult = Pick<
  import('./agent').AgentSessionMeta,
  | 'id'
  | 'title'
  | 'channelId'
  | 'modelId'
  | 'agentRuntime'
  | 'codexFastMode'
  | 'openAIThinkingLevel'
  | 'permissionMode'
  | 'linguistProjectId'
  | 'linguistProjectName'
  | 'linguistRole'
  | 'createdAt'
  | 'updatedAt'
>

// ===== Proposal 人工审核请求 / 响应契约（PB-053）=====

export type LinguistProposalStatus =
  | 'pending'
  | 'accepted'
  | 'rejected'
  | 'superseded'
  | 'expired'

export interface LinguistProposalInfo {
  id: string
  segmentId: string
  baseRevision: number
  proposedTarget: string
  evidenceRefs: string[]
  termRefs: string[]
  warnings: string[]
  modelId?: string
  sessionId?: string
  runId?: string
  reissuedFromProposalId?: string
  supersedesProposalId?: string
  createdAt: string
  status: LinguistProposalStatus
}

export interface LinguistProposalIssuanceInfo {
  id: string
  proposalId: string
  idempotencyKey?: string
  sessionId?: string
  runId?: string
  toolCallId?: string
  modelProvider?: string
  modelId?: string
  runtime?: string
  strategy?: 'fast' | 'balanced' | 'best'
  linguistPromptVersion?: string
  promptHash?: string
  projectDigestHash?: string
  projectDigestRevision?: string
  turnContextVersion?: number
  turnContextSnapshot?: string
  turnContextHash?: string
  toolsetHash?: string
  evidenceRefs: string[]
  termRefs: string[]
  createdAt: string
}

export interface LinguistProposalDiff {
  proposal: LinguistProposalInfo
  originalOrdinal: number
  source: string
  currentTarget: string
  proposedTarget: string
  currentRevision: number
  baseRevision: number
  locked: boolean
  /** Optional only for wire compatibility with pre-v13 clients. */
  issuanceCount?: number
  latestIssuance?: LinguistProposalIssuanceInfo
}

export interface LinguistProposalMutationItem {
  proposalId: string
  expectedRevision: number
}

export interface LinguistProposalListPendingRequest {
  projectId: string
}

export type LinguistProposalListPendingResult = LinguistProposalInfo[]

export interface LinguistProposalListRequest extends LinguistProposalListPendingRequest {
  status?: LinguistProposalStatus
  limit?: number
  offset?: number
}

export interface LinguistProposalListResult {
  /** Proposal + current Segment snapshot, projected by one Store JOIN query. */
  items: LinguistProposalDiff[]
  total: number
  limit: number
  offset: number
  hasMore: boolean
}

export interface LinguistProposalGetDiffRequest extends LinguistProposalListPendingRequest {
  proposalId: string
}

export type LinguistProposalGetDiffResult = LinguistProposalDiff

export interface LinguistApplyTranslationEdit {
  segmentId: string
  baseRevision: number
  target: string
  note?: string
}

export interface LinguistApplyTranslationsRequest extends LinguistProposalListPendingRequest {
  edits: LinguistApplyTranslationEdit[]
  mode?: 'apply' | 'proposal'
}

export interface LinguistApplyTranslationsResult {
  requested: number
  applied: number
  pending: number
  stale: string[]
  locked: string[]
  failed: Array<{ segmentId: string; code: string }>
  proposalIds: string[]
}

export interface LinguistProposalMutationRequest
  extends LinguistProposalListPendingRequest,
    LinguistProposalMutationItem {
  idempotencyKey: string
}

export interface LinguistProposalEditAndAcceptRequest extends LinguistProposalMutationRequest {
  editedTarget: string
}

export interface LinguistProposalSelectedMutationRequest
  extends LinguistProposalListPendingRequest {
  items: LinguistProposalMutationItem[]
  idempotencyKey: string
}

export interface LinguistAcceptedProposalResult {
  proposal: LinguistProposalInfo
  segmentId: string
  target: string
  revision: number
}

export type LinguistProposalAcceptResult = LinguistAcceptedProposalResult
export type LinguistProposalRejectResult = LinguistProposalInfo
export type LinguistProposalEditAndAcceptResult = LinguistAcceptedProposalResult
export type LinguistProposalAcceptSelectedResult = LinguistAcceptedProposalResult[]
export type LinguistProposalRejectSelectedResult = LinguistProposalInfo[]
export type LinguistProposalReissueResult = LinguistProposalInfo

// ===== Legacy 迁移向导请求 / 响应契约（PB-094）=====
//
// 以下是 @linguist/legacy-migration ScanReport / ImportReport 的 UI 投影
// （刻意非全镜像，只携带渲染所需字段；@proma/shared 不依赖 linguist 包，
// 按既有镜像模式在此重定义）。路径纪律：rootPath / transcript.path /
// rollback 文本均由主进程产出后下行，renderer 从不上行任何路径。

/** 迁移处置五值（legacy-migration ImportDisposition 的线镜像）。 */
export type LinguistMigrationDisposition =
  | 'imported'
  | 'partial'
  | 'archived-only'
  | 'quarantined'
  | 'error'

/** 健康信号投影（legacy-migration HealthSignal 的子集）。 */
export interface LinguistMigrationHealthSignal {
  severity: 'info' | 'warning' | 'error'
  message: string
}

/** 扫描到的单个旧项目（id 即旧目录名，非新仓 prj- id）。 */
export interface LinguistMigrationScannedProject {
  projectId: string
  /** manifest.projectName，缺省回退目录名。 */
  name: string
  sourceLocale: string | null
  targetLocale: string | null
  batches: number
  segments: number
  tmEntries: number | null
  termEntries: number | null
  /** 有 chat.json（导入时将归档并渲染只读 transcript）。 */
  chatPresent: boolean
  /** manifest 缺失/不可解析（默认隔离，除非显式勾选抢救）。 */
  orphan: boolean
  health: LinguistMigrationHealthSignal[]
}

/** 扫描结果投影（不含内部 digest / 逐文件清单 / sqlite 细节）。 */
export interface LinguistMigrationScanResult {
  /** 旧数据根 schema 版本（2 = data/.schema.json 存在）。 */
  schemaVersion: 1 | 2
  projects: LinguistMigrationScannedProject[]
  /** 根级健康信号（sqlite 权威标记 / 缺库 / 不可读等）。 */
  health: LinguistMigrationHealthSignal[]
  totals: { projects: number; batches: number; segments: number }
}

/** pickAndScan 响应：取消是正常分支；rootPath 仅供向导回显用户所选目录。 */
export type LinguistMigrationPickAndScanResult =
  | { cancelled: true }
  | ({ cancelled: false; rootPath: string } & LinguistMigrationScanResult)

export interface LinguistMigrationImportOptions {
  /** 外部源文处理：copy（默认，文件仍在线则读取字节）/ reference（不读外部字节）。 */
  externalSource?: 'copy' | 'reference'
  /** 抢救无 manifest 的孤儿项目（默认隔离，仅出报告不写入）。 */
  salvageOrphan?: boolean
}

export interface LinguistMigrationImportRequest {
  /** 旧项目 id 列表（必须全部来自上次扫描投影；主进程复核）。 */
  projectIds: string[]
  options?: LinguistMigrationImportOptions
}

/** main→renderer 进度事件（IMPORT 调用期间逐项目两相位推送）。 */
export interface LinguistMigrationProgress {
  /** 旧项目 id。 */
  projectId: string
  phase: 'import' | 'verify'
  /** 1-based。 */
  index: number
  total: number
}

/** 单项 verify 检查（transcript 重渲染比对 / 只读重开计数）。 */
export interface LinguistMigrationVerifyCheck {
  id:
    | 'transcript-rerender'
    | 'transcript-bytes'
    | 'store-reopen'
    | 'store-assets'
    | 'store-references'
    | 'store-qa'
  ok: boolean
  detail: string
}

export interface LinguistMigrationVerifyResult {
  /** quarantined / 导入抛出（零写入）→ skipped。 */
  status: 'passed' | 'failed' | 'skipped'
  checks: LinguistMigrationVerifyCheck[]
}

/** 单项目迁移报告（ImportReport 的 UI 投影 + verify 结果）。 */
export interface LinguistMigrationProjectReport {
  legacyProjectId: string
  /** 新仓项目 id（prj-…；确定性派生；隔离/冲突时零写入）。 */
  newProjectId: string
  projectName: string
  disposition: LinguistMigrationDisposition
  /** true = 幂等拒绝（该项目此前已导入；本报告描述的是被拒绝的计划）。 */
  targetConflict: boolean
  refusal: { reason: string; evidence?: Record<string, unknown> } | null
  totals: {
    assets: number
    segments: number
    tmImported: number
    termsImported: number
    qaOpen: number
    qaWaived: number
  }
  /** 只读 transcript 产物（targetRoot 相对路径 + sha256）；无 chat.json 时 null。 */
  transcript: { path: string; sha256: string; sessions: number; rows: number } | null
  /** 实际写入磁盘的归档件数。 */
  archivesWritten: number
  /** 回滚指引文本（删除项目目录 + 移除 projects.json 条目）。 */
  rollback: string[]
  notes: string[]
  verify: LinguistMigrationVerifyResult
}

/** 聚合迁移报告（IMPORT 响应；不持久化，仅供报告页内存渲染）。 */
export interface LinguistMigrationReport {
  /** disposition -> 项目数（五键齐全，缺省 0）。 */
  counts: Record<LinguistMigrationDisposition, number>
  projects: LinguistMigrationProjectReport[]
}

// ===== 导入验证报告 + 条件撤销导入（LA-INTAKE-007）=====
//
// importAsset 在插入同事务内回读验证（段数/格式/语言对/source hash），
// 失败即整批回滚并以 IMPORT_VERIFICATION_FAILED 信封返回；验证报告随
// LinguistProjectImportResult 成功分支下行。撤销导入经
// linguist.projects.undoImportAsset：下游引用（Proposal/QA/评审件/
// 导出/人工编辑痕迹/durable job）任一非零即 IMPORT_UNDO_BLOCKED，错误 details 只含
// 分类计数；全零则 asset + segments + 关联行 + source blob 一并消失。

/** 单项导入验证检查；detail 只含计数 / 哈希 / 格式 id，绝无客户文本。 */
export interface LinguistImportVerificationCheck {
  id: 'segment-count' | 'format' | 'language-pair' | 'source-hash'
  passed: boolean
  detail: string
}

export interface LinguistImportVerificationReport {
  ok: boolean
  checks: LinguistImportVerificationCheck[]
}

export interface LinguistProjectUndoImportAssetRequest {
  projectId: string
  /** CAT 资产 Stable ID（主进程按 LINGUIST_ASSET_ID_PATTERN 严格校验）。 */
  assetId: string
}

export interface LinguistProjectUndoImportAssetResult {
  assetId: string
  deletedSegments: number
  /** false = 行已删但 source blob 清尾失败（留下可幂等覆盖的孤儿 blob）。 */
  sourceBlobRemoved: boolean
}
