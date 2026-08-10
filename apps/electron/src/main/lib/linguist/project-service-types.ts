import type {
  Asset,
  CurrentStageState,
  EntropySource,
  LinguistProject,
  LinguistTagProfile,
  LinguistTagProfileCandidate,
  QaFindingDisposition,
  QaFindingSeverity,
  QaIssueType,
  QaProfile,
  Segment,
  SegmentStatus,
  TranslationProposal,
  UnknownTagPatternResult,
  WorkflowOutputStatusPolicy,
  WorkflowStage,
  WorkflowStageEvent,
} from '@linguist/cat-core'

export interface LinguistTagProfileMutationResult {
  project: LinguistProject
  tagProfile: LinguistTagProfile
  candidate?: LinguistTagProfileCandidate
  validation?: import('@linguist/cat-core').TagCandidateValidationResult
}
import type {
  CatFormatRegistry,
  ImportWarning,
} from '@linguist/cat-formats'
import type {
  ApprovedExemplar,
  ContextDoc,
  ExportRecord,
  ReferenceImport,
  ExportVerification,
  SentencePattern,
  SentencePatternStatus,
  SqliteRuntimeProbe,
  StyleGuideRule,
  TechConstraint,
  TermEntry,
  TermEntryStatus,
  TmUnit,
  VoiceProfile,
} from '@linguist/cat-store'

/**
 * LinguistProjectService 的稳定调用合同。
 *
 * 实现按生命周期、资源、质量和交付拆分，但 IPC 与测试仍只依赖
 * project-service.ts 重导出的这一组类型，避免内部模块布局泄漏给调用方。
 */

export interface LinguistProjectServiceOptions {
  /** Linguist 根目录（<configDir>/linguist）。必传——绝不硬编码。 */
  rootDir: string
  /** 项目 id 熵源；注入可确定性复现。 */
  entropy?: EntropySource
  /** 时钟（时间戳/备份文件名）；注入可确定性复现。 */
  now?: () => string
  /** 应用版本；生产默认复用 Host 已初始化的 Proma 版本。 */
  applicationVersion?: string
  /** 工作区 id 分配器；缺省按 agent-workspace-manager 约定用 randomUUID。 */
  workspaceAllocator?: (projectName: string) => string
  /** 格式注册表；缺省登记 XLIFF/CSV/JSON。 */
  registry?: CatFormatRegistry
}

export interface LinguistServiceStatus {
  rootDir: string
  /** true = node:sqlite 不可用，CAT 数据库能力降级（索引仍可用）。 */
  degraded: boolean
  sqlite: SqliteRuntimeProbe
}

export interface DeleteLinguistProjectResult {
  projectId: string
  /** 数据根 trash/ 下的恢复目录名；原目录已缺失时不提供。 */
  recoveryName?: string
}

export interface CreateLinguistProjectInput {
  name: string
  sourceLocale: string
  targetLocale: string
  /** 显式关联既有 Proma 工作区 id；缺省时按工作区 id 约定分配新 id。 */
  promaWorkspaceId?: string
  workflowStage?: WorkflowStage
  outputStatusPolicy?: WorkflowOutputStatusPolicy
  qaProfile?: QaProfile
}

export interface StageMutationItem {
  segmentId: string
  expectedRevision: number
}

export interface StageMutationFailure {
  segmentId: string
  code: string
  message: string
}

export interface StageMutationBatchResult {
  succeeded: Segment[]
  failed: StageMutationFailure[]
}

export interface LinguistProjectHealthCheck {
  id: 'project_json' | 'cat_db_open' | 'schema_version' | 'asset_sources'
  ok: boolean
  scope: 'complete' | 'sampled'
  checkedItems?: number
  totalItems?: number
  /** 仅含错误码 / 计数，绝无客户文本。 */
  detail?: string
}

export interface LinguistProjectHealthReport {
  kind: 'quick'
  projectId: string
  healthy: boolean
  checkedAt: string
  checks: LinguistProjectHealthCheck[]
}

export interface LinguistBackupResult {
  backupName: string
  /** linguist 根相对路径（projects/<id>/backups/backup-<ts>）。 */
  backupDir: string
  method: 'vacuum_into' | 'backup_api'
  fileCount: number
  totalSizeBytes: number
  schemaVersion: number
}

export interface LinguistBackupListItem {
  name: string
  /** directory = 新格式（可恢复）；legacy = PB-024 两文件旧格式（仅可预览）。 */
  format: 'directory' | 'legacy'
  createdAt?: string
  sizeBytes: number
  schemaVersion?: number
  method?: 'vacuum_into' | 'backup_api'
  fileCount?: number
}

export interface LinguistBackupSummary {
  assetCount: number
  totalSegments: number
  segmentCounts: Record<SegmentStatus, number>
  currentStageCounts: Record<CurrentStageState, number>
  assets: LinguistProjectSummaryAsset[]
}

export interface LinguistRestorePreview {
  backupName: string
  format: 'directory' | 'legacy'
  restorable: boolean
  verification?: { ok: boolean; schemaVersion?: number; problems: string[] }
  backupSummary?: LinguistBackupSummary
  currentSummary?: LinguistBackupSummary
  backupSchemaVersion?: number
  currentSchemaVersion: number
  willMigrate: boolean
  notice?: string
}

export interface LinguistRestoreResult {
  backupName: string
  preRestoreName: string
  schemaVersion: number
}

/** 导入入参刻意不接受路径（renderer 永不提交文件系统路径）。 */
export interface ImportAssetInput {
  bytes: Uint8Array
  filename: string
  /** XLSX is only imported after the main process has verified this explicit user mapping. */
  xlsxMapping?: XlsxImportMapping
  /** Phrase split 的 master XLIFF 同伴；只在主进程内传字节，不暴露路径。 */
  phraseMaster?: { bytes: Uint8Array; filename: string }
}

export interface XlsxImportMapping {
  sheetName: string
  columns: {
    key?: string
    source: string
    target: string
    locked?: string
    context?: string
  }
}

export interface ImportAssetResult {
  /** 新导入或按源字节哈希跳过的项目内重复。 */
  status: 'imported' | 'skipped-duplicate'
  assetId: string
  formatId: string
  segmentCount: number
  warnings: ImportWarning[]
  sourceSha256: string
  /** LA-INTAKE-007：插入同事务内回读验证报告（失败即回滚，不会随 ok:false 返回）。 */
  verification: ImportVerificationReport
  /** 新资产导入后的确定性轻量扫描；只给证据，绝不自动激活。 */
  unknownTagSummary: UnknownTagPatternResult[]
}

/**
 * LA-INTAKE-007 单项导入验证检查；detail 只含计数 / 哈希 / 格式 id 级
 * 信息，绝无客户文本。
 */
export interface ImportVerificationCheck {
  id: 'segment-count' | 'format' | 'language-pair' | 'source-hash'
  passed: boolean
  detail: string
}

export interface ImportVerificationReport {
  ok: boolean
  checks: ImportVerificationCheck[]
}

/**
 * LA-INTAKE-007 撤销导入的下游引用计数：Proposal / QA / 历史评审件 / 导出 /
 * 人工编辑痕迹 / durable job，全零才允许撤销；任一非零即 IMPORT_UNDO_BLOCKED。
 * 只含计数，绝无客户文本。
 */
export interface ImportUndoReferences {
  proposals: number
  qaFindings: number
  legacyCriticArtifacts: number
  exports: number
  editedSegments: number
  jobs: number
}

export interface UndoImportAssetResult {
  assetId: string
  deletedSegments: number
  /** false = 行已删但 source blob 清尾失败（留下可幂等覆盖的孤儿 blob）。 */
  sourceBlobRemoved: boolean
}

export type LinguistReferenceKind = 'tm' | 'terms'

export interface ImportReferenceInput {
  bytes: Uint8Array
  filename: string
  xlsxMapping?: XlsxImportMapping
}

export interface ImportReferenceResult {
  imported: number
  unchanged: number
  warnings: string[]
  /**
   * 本次 TM/TB 文件导入的受管原件；句式库和手工新增的 TM/TB 不会伪造此来源。
   */
  source?: ReferenceImport
}

export interface TmReferenceInfo extends TmUnit {}

export interface TermReferenceInfo extends TermEntry {}

export interface TmReferenceMatch extends TmUnit {
  score: number
  matchType: 'exact' | 'contains' | 'fuzzy'
}

export interface TermReferenceMatch extends TermEntry {
  matchType: 'exact' | 'contains'
  conflict: boolean
  start: number
  end: number
  lowDiscrimination: boolean
}

export interface ReferenceQuery {
  query?: string
  status?: TermEntryStatus
  limit: number
  offset: number
}

export interface ReferenceQueryPage<T> {
  items: T[]
  total: number
  limit: number
  offset: number
  hasMore: boolean
}

/** TM/TB 管理器额外携带一次文件导入 provenance；项目语言资产列表不复用它。 */
export interface ReferenceImportQueryPage<T> extends ReferenceQueryPage<T> {
  /** 当前 TM/TB 类别的文件导入来源，供管理器打开 Proma Preview Tab。 */
  imports: ReferenceImport[]
}

export type LinguistProjectAssetKind =
  | 'styleGuideRules'
  | 'sentencePatterns'
  | 'contextDocs'
  | 'techConstraints'
  | 'voiceProfiles'

export type ProjectAssetInfo =
  | StyleGuideRule
  | SentencePattern
  | ContextDoc
  | TechConstraint
  | VoiceProfile

export interface ProjectAssetsQuery {
  /** 子串过滤（techConstraints 不支持，忽略）。 */
  query?: string
  /** 仅 sentencePatterns 有效。 */
  status?: SentencePatternStatus
  limit: number
  offset: number
}

export interface ImportContextDocInput extends ImportReferenceInput {
  note?: string
}

export interface CatWorkspaceQuery {
  assetId?: string
  status?: SegmentStatus
  currentStageState?: CurrentStageState
  search?: string
  limit: number
  offset: number
  includeIndex: boolean
}

export interface CatWorkspacePage {
  assets: Asset[]
  segments: Segment[]
  total: number
  segmentIds: string[]
}

export interface CatSegmentContext {
  segment: Segment
  pendingProposal?: TranslationProposal
  qaFindings: CatQaFinding[]
  tmMatches: TmReferenceMatch[]
  termMatches: TermReferenceMatch[]
  approvedExemplars: ApprovedExemplar[]
  stageEvents: WorkflowStageEvent[]
}

export interface ApproveSegmentExemplarInput {
  segmentId: string
  speaker: string
  textType: string
  note?: string
}

export interface CatQaFinding {
  id: string
  segmentId: string
  code: string
  severity: QaFindingSeverity
  issueType: QaIssueType
  disposition: QaFindingDisposition
  message: string
  status: 'open' | 'resolved' | 'waived'
  segmentRevision: number
  currentRevision: number
  waiverReason?: string
  waivedBy?: string
  waivedAt?: string
}

export interface LinguistStagedExport {
  artifact: ExportRecord
  /** 仅主进程可消费的 staging 文件绝对路径（PB-073 native Save）。 */
  stagingPath: string
  relativePath: string
  suggestedFilename: string
  verifiedSegments: number
  verification: ExportVerification
}

export type LinguistDeliveryBlockerCode =
  | 'PENDING_PROPOSALS'
  | 'UNCONFIRMED_SEGMENTS'
  | 'OPEN_QA_ERRORS'
  | 'PHRASE_MASTER_MAPPING'
  | 'STRUCTURAL_RULES'

export interface LinguistDeliveryBlocker {
  code: LinguistDeliveryBlockerCode
  count: number
  message: string
}

export interface LinguistDeliveryQaSummary {
  openErrors: number
  openWarnings: number
  waived: number
  bySeverity: Record<QaFindingSeverity, number>
}

export interface LinguistDeliveryPreflight {
  projectId: string
  assetId: string
  filename: string
  formatId: string
  workflowStage: WorkflowStage
  expectedNativeStatus?: string
  segmentCount: number
  stageCounts: Record<CurrentStageState, number>
  lockedSegments: number
  unconfirmedUnlockedSegments: number
  pendingProposalCount: number
  qa: LinguistDeliveryQaSummary
  ready: boolean
  blockers: LinguistDeliveryBlocker[]
}

export interface LinguistDeliveryVerification extends ExportVerification {
  verifiedSegments: number
  sha256: string
  suggestedFilename: string
}

export interface LinguistLocalExportResult {
  filename: string
  sha256: string
  sizeBytes: number
  verifiedAt: string
  verifiedSegments: number
  mode: 'verified' | 'as-is'
}

export interface LinguistPreparedDeliverySaveResult extends LinguistLocalExportResult {
  artifact: ExportRecord
  projectRevision: string
}

export interface LinguistPreparedDelivery {
  validation: 'verified' | 'as-is'
  preflight: LinguistDeliveryPreflight
  verification?: LinguistDeliveryVerification
  reportMarkdown: string
  /** 仅主进程内部复制使用；IPC 投影必须删除。 */
  staged?: LinguistStagedExport
}

export interface LinguistProjectSummaryAsset {
  assetId: string
  filename: string
  formatId: string
  segmentCount: number
  sourceSha256: string
  segmentCounts: Record<SegmentStatus, number>
  currentStageCounts: Record<CurrentStageState, number>
  sourceCharacters: number
  targetCharacters: number
  openQaCount: number
}

export interface LinguistProjectSummary {
  project: LinguistProject
  assetCount: number
  totalSegments: number
  segmentCounts: Record<SegmentStatus, number>
  currentStageCounts: Record<CurrentStageState, number>
  assets: LinguistProjectSummaryAsset[]
}
