import { ipcRenderer } from 'electron'
import {
  LINGUIST_PROJECT_IPC_CHANNELS,
  LINGUIST_INTEGRITY_IPC_CHANNELS,
  LINGUIST_SESSION_IPC_CHANNELS,
  LINGUIST_PROPOSAL_IPC_CHANNELS,
  LINGUIST_CAT_IPC_CHANNELS,
  LINGUIST_EXPORT_IPC_CHANNELS,
  LINGUIST_DIAGNOSTICS_IPC_CHANNELS,
  LINGUIST_REFERENCE_IPC_CHANNELS,
  LINGUIST_ASSETS_IPC_CHANNELS,
  LINGUIST_MIGRATION_IPC_CHANNELS,
  LINGUIST_ASSET_PREVIEW_IPC_CHANNELS,
} from '@proma/shared'
import type {
  LinguistIpcResult,
  LinguistBackupListRequest,
  LinguistBackupListResult,
  LinguistProjectArchiveRequest,
  LinguistProjectArchiveResult,
  LinguistProjectBackupRequest,
  LinguistProjectBackupResult,
  LinguistProjectCreateRequest,
  LinguistProjectCreateResult,
  LinguistProjectDeleteRequest,
  LinguistProjectDeleteResult,
  LinguistProjectGetSummaryRequest,
  LinguistProjectGetStageCoverageRequest,
  LinguistProjectGetStageCoverageResult,
  LinguistFormatQualificationListResult,
  LinguistProjectConfirmXlsxMappingRequest,
  LinguistProjectConfirmXlsxMappingResult,
  LinguistProjectImportRequest,
  LinguistProjectImportResult,
  LinguistProjectInfo,
  LinguistProjectListRequest,
  LinguistProjectOpenRequest,
  LinguistProjectOpenResult,
  LinguistProjectRenameRequest,
  LinguistProjectRenameResult,
  LinguistProjectSetLocalesRequest,
  LinguistProjectSetLocalesResult,
  LinguistProjectReorderRequest,
  LinguistProjectReorderResult,
  LinguistIntegrityCancelRequest,
  LinguistIntegrityCancelResult,
  LinguistIntegrityExportReportRequest,
  LinguistIntegrityExportReportResult,
  LinguistIntegrityScrubEvent,
  LinguistIntegrityStartRequest,
  LinguistIntegrityStartResult,
  LinguistProjectRestoreRequest,
  LinguistProjectRestoreResult,
  LinguistProjectSetWorkflowConfigRequest,
  LinguistProjectUpdateTagProfileRequest,
  LinguistProjectUpdateTagProfileResult,
  LinguistProjectScanUnknownTagsRequest,
  LinguistProjectScanUnknownTagsResult,
  LinguistProjectSetWorkflowConfigResult,
  LinguistProjectSummary,
  LinguistProjectUndoImportAssetRequest,
  LinguistProjectUndoImportAssetResult,
  LinguistRestorePreviewRequest,
  LinguistRestorePreviewResult,
  LinguistSessionCreateForProjectRequest,
  LinguistSessionCreateForProjectResult,
  LinguistSessionDetachBindingRequest,
  LinguistSessionDetachBindingResult,
  LinguistSessionGetBindingRequest,
  LinguistSessionGetBindingResult,
  LinguistSessionListForProjectRequest,
  LinguistSessionListForProjectResult,
  LinguistSessionUpdateRoleRequest,
  LinguistSessionUpdateRoleResult,
  LinguistSessionCopyEligibilityRequest,
  LinguistSessionCopyEligibilityResult,
  LinguistSessionCopyToProjectRequest,
  LinguistSessionCopyToProjectResult,
  LinguistProposalListPendingRequest,
  LinguistProposalListPendingResult,
  LinguistProposalListRequest,
  LinguistProposalListResult,
  LinguistProposalGetDiffRequest,
  LinguistProposalGetDiffResult,
  LinguistApplyTranslationsRequest,
  LinguistApplyTranslationsResult,
  LinguistProposalMutationRequest,
  LinguistProposalAcceptResult,
  LinguistProposalRejectResult,
  LinguistProposalEditAndAcceptRequest,
  LinguistProposalEditAndAcceptResult,
  LinguistProposalSelectedMutationRequest,
  LinguistProposalAcceptSelectedResult,
  LinguistProposalRejectSelectedResult,
  LinguistProposalReissueResult,
  LinguistCatQueryRequest,
  LinguistCatQueryResult,
  LinguistCatEditSegmentRequest,
  LinguistCatEditSegmentResult,
  LinguistCatConfirmStageRequest,
  LinguistCatUnconfirmStageRequest,
  LinguistCatStageMutationResult,
  LinguistCatConfirmStageBulkRequest,
  LinguistCatConfirmStageBulkResult,
  LinguistCatGetContextRequest,
  LinguistCatContextResult,
  LinguistCatAddApprovedExemplarRequest,
  LinguistCatAddApprovedExemplarResult,
  LinguistCatRunQaRequest,
  LinguistCatRunQaResult,
  LinguistCatListQaFindingsRequest,
  LinguistCatListQaFindingsResult,
  LinguistCatResolveQaFindingRequest,
  LinguistCatWaiveQaFindingRequest,
  LinguistCatWaiveQaFindingsBulkRequest,
  LinguistCatWaiveQaFindingsBulkResult,
  LinguistProjectEventAckRequest,
  LinguistProjectEventAckResult,
  LinguistProjectEventListRequest,
  LinguistProjectEventListResult,
  LinguistProjectMutationEvent,
  LinguistRunSummaryRequest,
  LinguistLatestRunSummaryResult,
  LinguistRunUndoRequest,
  LinguistRunUndoResult,
  LinguistQaFindingInfo,
  LinguistExportSaveAssetRequest,
  LinguistExportSaveAssetResult,
  LinguistPrepareDeliveryRequest,
  LinguistPrepareDeliveryResult,
  LinguistExportListRequest,
  LinguistExportListResult,
  LinguistDiagnosticsRequest,
  LinguistDiagnosticsStatus,
  LinguistDiagnosticBundlePreviewResult,
  LinguistDiagnosticBundleExportResult,
  LinguistReferenceDeleteRequest,
  LinguistReferenceDeleteResult,
  LinguistReferenceCandidatePreviewRequest,
  LinguistReferenceCancelImportRequest,
  LinguistReferenceCancelImportResult,
  LinguistReferenceConfirmImportRequest,
  LinguistReferenceConfirmImportResult,
  LinguistReferenceImportRequest,
  LinguistReferenceImportResult,
  LinguistReferenceQueryRequest,
  LinguistReferenceQueryResult,
  LinguistTermInfo,
  LinguistTermConflictsRequest,
  LinguistTermConflictsResult,
  LinguistTermsDeleteRequest,
  LinguistTermsDeleteResult,
  LinguistTermsUpsertRequest,
  LinguistTermsUpsertResult,
  LinguistTermUpsertRequest,
  LinguistTermUpsertResult,
  LinguistTermsValidateRequest,
  LinguistTermsValidateResult,
  LinguistTmInfo,
  LinguistTmMatchInfo,
  LinguistAssetPreviewRequest,
  LinguistAssetPreviewResult,
  LinguistReferenceImportPreviewRequest,
  LinguistAssetsDeleteRequest,
  LinguistAssetsDeleteResult,
  LinguistAssetsQueryRequest,
  LinguistAssetsQueryResult,
  LinguistAssetsUpsertRequest,
  LinguistAssetsUpsertResult,
  LinguistContextDocImportRequest,
  LinguistContextDocImportResult,
  LinguistContextDocPreviewRequest,
  LinguistContextDocSegmentLinkRequest,
  LinguistContextDocSegmentLinkResult,
  LinguistSentencePatternImportRequest,
  LinguistSentencePatternImportResult,
  LinguistMigrationImportRequest,
  LinguistMigrationPickAndScanResult,
  LinguistMigrationProgress,
  LinguistMigrationReport,
} from '@proma/shared'

export interface LinguistApi {
  // ===== Linguist CAT 项目（PB-031；计划 §7.2）=====
  // 全部通道返回 LinguistIpcResult<T> 信封（稳定错误码契约，见
  // packages/shared/src/types/linguist.ts）；renderer 只经这些 typed
  // 通道访问 CAT store，绝不提交路径/字节（计划 §7.4）。

  /** 列出 CAT 项目（可选含已归档） */
  linguistProjectsList: (
    input?: LinguistProjectListRequest,
  ) => Promise<LinguistIpcResult<LinguistProjectInfo[]>>
  /** 创建 CAT 项目 */
  linguistProjectsCreate: (
    input: LinguistProjectCreateRequest,
  ) => Promise<LinguistIpcResult<LinguistProjectCreateResult>>
  /** 打开 CAT 项目（DB 句柄 + 元数据 + 健康报告；非 UI 导航） */
  linguistProjectsOpen: (
    input: LinguistProjectOpenRequest,
  ) => Promise<LinguistIpcResult<LinguistProjectOpenResult>>
  /** 导入资产：主进程原生文件选择器；取消返回 {cancelled: true} */
  linguistProjectsImport: (
    input: LinguistProjectImportRequest,
  ) => Promise<LinguistIpcResult<LinguistProjectImportResult>>
  /** XLSX 文件经主进程预览后，显式确认 sheet 与列映射。 */
  linguistProjectsConfirmXlsxMapping: (
    input: LinguistProjectConfirmXlsxMappingRequest,
  ) => Promise<LinguistIpcResult<LinguistProjectConfirmXlsxMappingResult>>
  /** LA-INTAKE-007：撤销一次导入（IMPORT_UNDO_BLOCKED 时 details 含分类计数） */
  linguistProjectsUndoImportAsset: (
    input: LinguistProjectUndoImportAssetRequest,
  ) => Promise<LinguistIpcResult<LinguistProjectUndoImportAssetResult>>
  /** 项目摘要（元数据 + 资产列表（PB-033）+ 按状态段计数） */
  linguistProjectsGetSummary: (
    input: LinguistProjectGetSummaryRequest,
  ) => Promise<LinguistIpcResult<LinguistProjectSummary>>
  /** 单批次单阶段的岗位 decision 覆盖统计（Reviewer/Proofreader 真实进度） */
  linguistProjectsGetStageCoverage: (
    input: LinguistProjectGetStageCoverageRequest,
  ) => Promise<LinguistIpcResult<LinguistProjectGetStageCoverageResult>>
  /** 随应用发布的格式验证与平台资格，只读且不接收项目路径。 */
  linguistProjectsListFormatQualifications: () => Promise<
    LinguistIpcResult<LinguistFormatQualificationListResult>
  >
  /** 重命名 CAT 项目；归档项目拒绝写入 */
  linguistProjectsRename: (
    input: LinguistProjectRenameRequest,
  ) => Promise<LinguistIpcResult<LinguistProjectRenameResult>>
  /** 修改空项目语言对；已有 locale-bound 数据时主进程拒绝。 */
  linguistProjectsSetLocales: (
    input: LinguistProjectSetLocalesRequest,
  ) => Promise<LinguistIpcResult<LinguistProjectSetLocalesResult>>
  /** 原子保存完整的活跃项目顺序 */
  linguistProjectsReorderActive: (
    input: LinguistProjectReorderRequest,
  ) => Promise<LinguistIpcResult<LinguistProjectReorderResult>>
  /** 归档 CAT 项目 */
  linguistProjectsArchive: (
    input: LinguistProjectArchiveRequest,
  ) => Promise<LinguistIpcResult<LinguistProjectArchiveResult>>
  /** 可恢复删除已归档 CAT 项目；项目名须精确确认 */
  linguistProjectsDelete: (
    input: LinguistProjectDeleteRequest,
  ) => Promise<LinguistIpcResult<LinguistProjectDeleteResult>>
  /** 设置当前 T/E/P 任务阶段与格式原生输出策略。 */
  linguistProjectsSetWorkflowConfig: (
    input: LinguistProjectSetWorkflowConfigRequest,
  ) => Promise<LinguistIpcResult<LinguistProjectSetWorkflowConfigResult>>
  /** 项目 Tag Profile 候选与启用状态管理。 */
  linguistProjectsUpdateTagProfile: (
    input: LinguistProjectUpdateTagProfileRequest,
  ) => Promise<LinguistIpcResult<LinguistProjectUpdateTagProfileResult>>
  linguistProjectsScanUnknownTags: (
    input: LinguistProjectScanUnknownTagsRequest,
  ) => Promise<LinguistIpcResult<LinguistProjectScanUnknownTagsResult>>
  /** PB-111：全量备份（backup-<ts>/ 目录 + manifest；归档项目也可备份） */
  linguistProjectsBackup: (
    input: LinguistProjectBackupRequest,
  ) => Promise<LinguistIpcResult<LinguistProjectBackupResult>>
  /** PB-111：列出项目备份（只读；名称/摘要元数据，绝无路径；最新在前） */
  linguistBackupsList: (
    input: LinguistBackupListRequest,
  ) => Promise<LinguistIpcResult<LinguistBackupListResult>>
  /** PB-111：恢复预览（verify 报告 + 备份/当前摘要对比 + schema 版本） */
  linguistBackupsPreviewRestore: (
    input: LinguistRestorePreviewRequest,
  ) => Promise<LinguistIpcResult<LinguistRestorePreviewResult>>
  /** PB-111：恢复（整体替换；当前态先快照 pre-restore-<ts>；归档拒绝） */
  linguistBackupsRestore: (
    input: LinguistProjectRestoreRequest,
  ) => Promise<LinguistIpcResult<LinguistProjectRestoreResult>>
  linguistIntegrityStart: (
    input: LinguistIntegrityStartRequest,
  ) => Promise<LinguistIpcResult<LinguistIntegrityStartResult>>
  linguistIntegrityCancel: (
    input: LinguistIntegrityCancelRequest,
  ) => Promise<LinguistIpcResult<LinguistIntegrityCancelResult>>
  linguistIntegrityExportReport: (
    input: LinguistIntegrityExportReportRequest,
  ) => Promise<LinguistIpcResult<LinguistIntegrityExportReportResult>>
  onLinguistIntegrityProgress: (
    callback: (event: LinguistIntegrityScrubEvent) => void,
  ) => () => void
  /** PB-089：CAT 资产源文件预览（纯读，归档项目可用；text/html/url 三态分派） */
  linguistProjectsPreviewAssetSource: (
    input: LinguistAssetPreviewRequest,
  ) => Promise<LinguistIpcResult<LinguistAssetPreviewResult>>
  /** TM/TB 文件导入原件预览（只读，opaque id 进）。 */
  linguistProjectsPreviewReferenceImport: (
    input: LinguistReferenceImportPreviewRequest,
  ) => Promise<LinguistIpcResult<LinguistAssetPreviewResult>>
  /** staging 后经原生 Save 对话框交付；renderer 不提交路径。 */
  linguistExportsPrepareAsset: (
    input: LinguistPrepareDeliveryRequest,
  ) => Promise<LinguistIpcResult<LinguistPrepareDeliveryResult>>
  linguistExportsSaveAsset: (
    input: LinguistExportSaveAssetRequest,
  ) => Promise<LinguistIpcResult<LinguistExportSaveAssetResult>>
  /** PB-102：只读列出项目 exports/ 交付物（主进程读目录，响应不含路径）。 */
  linguistExportsList: (
    input: LinguistExportListRequest,
  ) => Promise<LinguistIpcResult<LinguistExportListResult>>
  linguistDiagnosticsGetStatus: (
    input: LinguistDiagnosticsRequest,
  ) => Promise<LinguistIpcResult<LinguistDiagnosticsStatus>>
  linguistDiagnosticsPreviewBundle: (
    input: LinguistDiagnosticsRequest,
  ) => Promise<LinguistIpcResult<LinguistDiagnosticBundlePreviewResult>>
  linguistDiagnosticsExportBundle: (
    input: LinguistDiagnosticsRequest,
  ) => Promise<LinguistIpcResult<LinguistDiagnosticBundleExportResult>>
  /** CAT Workspace 只读资产/段分页查询。 */
  linguistCatQuery: (
    input: LinguistCatQueryRequest,
  ) => Promise<LinguistIpcResult<LinguistCatQueryResult>>
  /** 人工编辑译文（expectedRevision CAS）。 */
  linguistCatEditSegment: (
    input: LinguistCatEditSegmentRequest,
  ) => Promise<LinguistIpcResult<LinguistCatEditSegmentResult>>
  linguistCatConfirmStage: (
    input: LinguistCatConfirmStageRequest,
  ) => Promise<LinguistIpcResult<LinguistCatStageMutationResult>>
  linguistCatUnconfirmStage: (
    input: LinguistCatUnconfirmStageRequest,
  ) => Promise<LinguistIpcResult<LinguistCatStageMutationResult>>
  linguistCatConfirmStageBulk: (
    input: LinguistCatConfirmStageBulkRequest,
  ) => Promise<LinguistIpcResult<LinguistCatConfirmStageBulkResult>>
  /** Context Rail 当前 Segment 与待审 Proposal（只读）。 */
  linguistCatGetContext: (
    input: LinguistCatGetContextRequest,
  ) => Promise<LinguistIpcResult<LinguistCatContextResult>>
  /** 把已确认 Segment 的主进程当前正文登记为角色译例。 */
  linguistCatAddApprovedExemplar: (
    input: LinguistCatAddApprovedExemplarRequest,
  ) => Promise<LinguistIpcResult<LinguistCatAddApprovedExemplarResult>>
  /** 运行确定性 QA（不改 Segment），供项目界面与 Agent 共用。 */
  linguistCatRunQa: (
    input: LinguistCatRunQaRequest,
  ) => Promise<LinguistIpcResult<LinguistCatRunQaResult>>
  /** 读取已持久化 QA Finding。 */
  linguistCatListQaFindings: (
    input: LinguistCatListQaFindingsRequest,
  ) => Promise<LinguistIpcResult<LinguistCatListQaFindingsResult>>
  /** 人工仅可在编辑后 resolve Finding。 */
  linguistCatResolveQaFinding: (
    input: LinguistCatResolveQaFindingRequest,
  ) => Promise<LinguistIpcResult<LinguistQaFindingInfo>>
  /** 人工 waive 必须说明理由。 */
  linguistCatWaiveQaFinding: (
    input: LinguistCatWaiveQaFindingRequest,
  ) => Promise<LinguistIpcResult<LinguistQaFindingInfo>>
  /** 按精确 Finding ID 原子批量豁免，并保存理由与操作者。 */
  linguistCatWaiveQaFindingsBulk: (
    input: LinguistCatWaiveQaFindingsBulkRequest,
  ) => Promise<LinguistIpcResult<LinguistCatWaiveQaFindingsBulkResult>>
  /** 按持久序号补拉项目事件；纯读，不隐式 ack。 */
  linguistCatListProjectEvents: (
    input: LinguistProjectEventListRequest,
  ) => Promise<LinguistIpcResult<LinguistProjectEventListResult>>
  /** renderer 成功应用事件后显式提交单调 ack。 */
  linguistCatAckProjectEvents: (
    input: LinguistProjectEventAckRequest,
  ) => Promise<LinguistIpcResult<LinguistProjectEventAckResult>>
  /** 读取最近一次产生持久项目事件的运行摘要。 */
  linguistCatGetLatestRunSummary: (
    input: LinguistRunSummaryRequest,
  ) => Promise<LinguistIpcResult<LinguistLatestRunSummaryResult>>
  /** 由主进程校验 Session authority 后撤销最近一次可证明的 CAT 变更。 */
  linguistCatUndoLatestRun: (
    input: LinguistRunUndoRequest,
  ) => Promise<LinguistIpcResult<LinguistRunUndoResult>>
  /** Agent CAT Tool 已提交项目写入；返回 unsubscribe。 */
  onLinguistProjectMutation: (
    callback: (event: LinguistProjectMutationEvent) => void,
  ) => () => void

  /** TM / 术语库均由主进程选择文件与读盘，renderer 不传路径或 bytes。 */
  linguistReferencesQueryTm: (
    input: LinguistReferenceQueryRequest,
  ) => Promise<LinguistIpcResult<LinguistReferenceQueryResult<LinguistTmInfo>>>
  linguistReferencesQueryTerms: (
    input: LinguistReferenceQueryRequest,
  ) => Promise<LinguistIpcResult<LinguistReferenceQueryResult<LinguistTermInfo>>>
  linguistReferencesImport: (
    input: LinguistReferenceImportRequest,
  ) => Promise<LinguistIpcResult<LinguistReferenceImportResult>>
  linguistReferencesConfirmImport: (
    input: LinguistReferenceConfirmImportRequest,
  ) => Promise<LinguistIpcResult<LinguistReferenceConfirmImportResult>>
  linguistReferencesCancelImport: (
    input: LinguistReferenceCancelImportRequest,
  ) => Promise<LinguistIpcResult<LinguistReferenceCancelImportResult>>
  linguistReferencesPreviewCandidate: (
    input: LinguistReferenceCandidatePreviewRequest,
  ) => Promise<LinguistIpcResult<LinguistAssetPreviewResult>>
  linguistReferencesUpsertTerm: (
    input: LinguistTermUpsertRequest,
  ) => Promise<LinguistIpcResult<LinguistTermUpsertResult>>
  linguistReferencesUpsertTerms: (
    input: LinguistTermsUpsertRequest,
  ) => Promise<LinguistIpcResult<LinguistTermsUpsertResult>>
  linguistReferencesDeleteTerms: (
    input: LinguistTermsDeleteRequest,
  ) => Promise<LinguistIpcResult<LinguistTermsDeleteResult>>
  linguistReferencesListTermConflicts: (
    input: LinguistTermConflictsRequest,
  ) => Promise<LinguistIpcResult<LinguistTermConflictsResult>>
  linguistReferencesValidateTerms: (
    input: LinguistTermsValidateRequest,
  ) => Promise<LinguistIpcResult<LinguistTermsValidateResult>>
  linguistReferencesDelete: (
    input: LinguistReferenceDeleteRequest,
  ) => Promise<LinguistIpcResult<LinguistReferenceDeleteResult>>
  /** PB-095 项目资产：CRUD 与原生导入（主进程选盘读盘，renderer 不传路径/字节）。 */
  linguistAssetsQuery: (
    input: LinguistAssetsQueryRequest,
  ) => Promise<LinguistIpcResult<LinguistAssetsQueryResult>>
  linguistAssetsUpsert: (
    input: LinguistAssetsUpsertRequest,
  ) => Promise<LinguistIpcResult<LinguistAssetsUpsertResult>>
  linguistAssetsDelete: (
    input: LinguistAssetsDeleteRequest,
  ) => Promise<LinguistIpcResult<LinguistAssetsDeleteResult>>
  linguistAssetsImportContextDoc: (
    input: LinguistContextDocImportRequest,
  ) => Promise<LinguistIpcResult<LinguistContextDocImportResult>>
  /** Context 文档 blob 预览（纯读，归档项目可用；text/html/url 三态分派）。 */
  linguistAssetsPreviewContextDoc: (
    input: LinguistContextDocPreviewRequest,
  ) => Promise<LinguistIpcResult<LinguistAssetPreviewResult>>
  linguistAssetsSetContextDocSegmentLink: (
    input: LinguistContextDocSegmentLinkRequest,
  ) => Promise<LinguistIpcResult<LinguistContextDocSegmentLinkResult>>
  linguistAssetsImportSentencePatterns: (
    input: LinguistSentencePatternImportRequest,
  ) => Promise<LinguistIpcResult<LinguistSentencePatternImportResult>>

  // ===== Linguist 会话绑定（PB-034）=====
  // 「项目对话」= 携带冻结 linguistProjectId 的 Pi Agent 会话；同一信封约定。

  /** 在项目内创建对话（绑定创建时冻结；归档项目拒绝创建） */
  linguistSessionsCreateForProject: (
    input: LinguistSessionCreateForProjectRequest,
  ) => Promise<LinguistIpcResult<LinguistSessionCreateForProjectResult>>
  linguistSessionsUpdateRole: (
    input: LinguistSessionUpdateRoleRequest,
  ) => Promise<LinguistIpcResult<LinguistSessionUpdateRoleResult>>
  /** 列出绑定到某项目的会话（标题 + 更新时间，updatedAt 降序） */
  linguistSessionsListForProject: (
    input: LinguistSessionListForProjectRequest,
  ) => Promise<LinguistIpcResult<LinguistSessionListForProjectResult>>
  /** 查询会话的项目绑定 + 实时状态；普通会话 binding=null */
  linguistSessionsGetBinding: (
    input: LinguistSessionGetBindingRequest,
  ) => Promise<LinguistIpcResult<LinguistSessionGetBindingResult>>
  /** 永久解除项目绑定；之后会话作为普通 Agent 使用 */
  linguistSessionsDetachBinding: (
    input: LinguistSessionDetachBindingRequest,
  ) => Promise<LinguistIpcResult<LinguistSessionDetachBindingResult>>
  /** 查询会话当前能否安全跨项目复制 */
  linguistSessionsGetCopyEligibility: (
    input: LinguistSessionCopyEligibilityRequest,
  ) => Promise<LinguistIpcResult<LinguistSessionCopyEligibilityResult>>
  /** 创建目标项目绑定的独立会话副本 */
  linguistSessionsCopyToProject: (
    input: LinguistSessionCopyToProjectRequest,
  ) => Promise<LinguistIpcResult<LinguistSessionCopyToProjectResult>>

  // ===== Linguist Proposal 人工审核（PB-053）=====
  linguistProposalsList: (
    input: LinguistProposalListRequest,
  ) => Promise<LinguistIpcResult<LinguistProposalListResult>>
  linguistProposalsListPending: (
    input: LinguistProposalListPendingRequest,
  ) => Promise<LinguistIpcResult<LinguistProposalListPendingResult>>
  linguistProposalsGetDiff: (
    input: LinguistProposalGetDiffRequest,
  ) => Promise<LinguistIpcResult<LinguistProposalGetDiffResult>>
  linguistApplyTranslations: (
    input: LinguistApplyTranslationsRequest,
  ) => Promise<LinguistIpcResult<LinguistApplyTranslationsResult>>
  linguistProposalsAccept: (
    input: LinguistProposalMutationRequest,
  ) => Promise<LinguistIpcResult<LinguistProposalAcceptResult>>
  linguistProposalsReject: (
    input: LinguistProposalMutationRequest,
  ) => Promise<LinguistIpcResult<LinguistProposalRejectResult>>
  linguistProposalsEditAndAccept: (
    input: LinguistProposalEditAndAcceptRequest,
  ) => Promise<LinguistIpcResult<LinguistProposalEditAndAcceptResult>>
  linguistProposalsAcceptSelected: (
    input: LinguistProposalSelectedMutationRequest,
  ) => Promise<LinguistIpcResult<LinguistProposalAcceptSelectedResult>>
  linguistProposalsRejectSelected: (
    input: LinguistProposalSelectedMutationRequest,
  ) => Promise<LinguistIpcResult<LinguistProposalRejectSelectedResult>>
  linguistProposalsReissue: (
    input: LinguistProposalMutationRequest,
  ) => Promise<LinguistIpcResult<LinguistProposalReissueResult>>

  // ===== Linguist Legacy 迁移向导（PB-094，计划 §22）=====
  // 目录选择器在主进程；renderer 永不提交路径。扫描结果只给 UI 投影。

  /** 主进程目录选择器 + 扫描旧数据根；取消返回 {cancelled: true} */
  linguistMigrationPickAndScan: () => Promise<LinguistIpcResult<LinguistMigrationPickAndScanResult>>
  /** 批量导入选中旧项目（每项 import 后立即 verify；响应为聚合报告，不持久化） */
  linguistMigrationImport: (
    input: LinguistMigrationImportRequest,
  ) => Promise<LinguistIpcResult<LinguistMigrationReport>>
  /** 订阅迁移进度事件 {projectId, phase, index, total}；返回 unsubscribe */
  onLinguistMigrationProgress: (
    callback: (progress: LinguistMigrationProgress) => void,
  ) => () => void
}
export function exposeLinguistApi(): LinguistApi {
  return {
    // ===== Linguist CAT 项目（PB-031）=====
    linguistProjectsList: (input?: LinguistProjectListRequest) =>
      ipcRenderer.invoke(LINGUIST_PROJECT_IPC_CHANNELS.LIST, input),
    linguistProjectsCreate: (input: LinguistProjectCreateRequest) =>
      ipcRenderer.invoke(LINGUIST_PROJECT_IPC_CHANNELS.CREATE, input),
    linguistProjectsOpen: (input: LinguistProjectOpenRequest) =>
      ipcRenderer.invoke(LINGUIST_PROJECT_IPC_CHANNELS.OPEN, input),
    linguistProjectsImport: (input: LinguistProjectImportRequest) =>
      ipcRenderer.invoke(LINGUIST_PROJECT_IPC_CHANNELS.IMPORT, input),
    linguistProjectsConfirmXlsxMapping: (input: LinguistProjectConfirmXlsxMappingRequest) =>
      ipcRenderer.invoke(LINGUIST_PROJECT_IPC_CHANNELS.CONFIRM_XLSX_MAPPING, input),
    linguistProjectsUndoImportAsset: (input: LinguistProjectUndoImportAssetRequest) =>
      ipcRenderer.invoke(LINGUIST_PROJECT_IPC_CHANNELS.UNDO_IMPORT_ASSET, input),
    linguistProjectsGetSummary: (input: LinguistProjectGetSummaryRequest) =>
      ipcRenderer.invoke(LINGUIST_PROJECT_IPC_CHANNELS.GET_SUMMARY, input),
    linguistProjectsGetStageCoverage: (input: LinguistProjectGetStageCoverageRequest) =>
      ipcRenderer.invoke(LINGUIST_PROJECT_IPC_CHANNELS.GET_STAGE_COVERAGE, input),
    linguistProjectsListFormatQualifications: () =>
      ipcRenderer.invoke(LINGUIST_PROJECT_IPC_CHANNELS.LIST_FORMAT_QUALIFICATIONS),
    linguistProjectsRename: (input: LinguistProjectRenameRequest) =>
      ipcRenderer.invoke(LINGUIST_PROJECT_IPC_CHANNELS.RENAME, input),
    linguistProjectsSetLocales: (input: LinguistProjectSetLocalesRequest) =>
      ipcRenderer.invoke(LINGUIST_PROJECT_IPC_CHANNELS.SET_LOCALES, input),
    linguistProjectsReorderActive: (input: LinguistProjectReorderRequest) =>
      ipcRenderer.invoke(LINGUIST_PROJECT_IPC_CHANNELS.REORDER_ACTIVE, input),
    linguistProjectsArchive: (input: LinguistProjectArchiveRequest) =>
      ipcRenderer.invoke(LINGUIST_PROJECT_IPC_CHANNELS.ARCHIVE, input),
    linguistProjectsDelete: (input: LinguistProjectDeleteRequest) =>
      ipcRenderer.invoke(LINGUIST_PROJECT_IPC_CHANNELS.DELETE, input),
    linguistProjectsSetWorkflowConfig: (input: LinguistProjectSetWorkflowConfigRequest) =>
      ipcRenderer.invoke(LINGUIST_PROJECT_IPC_CHANNELS.SET_WORKFLOW_CONFIG, input),
    linguistProjectsUpdateTagProfile: (input: LinguistProjectUpdateTagProfileRequest) =>
      ipcRenderer.invoke(LINGUIST_PROJECT_IPC_CHANNELS.UPDATE_TAG_PROFILE, input),
    linguistProjectsScanUnknownTags: (input: LinguistProjectScanUnknownTagsRequest) =>
      ipcRenderer.invoke(LINGUIST_PROJECT_IPC_CHANNELS.SCAN_UNKNOWN_TAGS, input),
    // ===== Linguist 备份 / 恢复（PB-111，计划 §24）=====
    linguistProjectsBackup: (input: LinguistProjectBackupRequest) =>
      ipcRenderer.invoke(LINGUIST_PROJECT_IPC_CHANNELS.BACKUP, input),
    linguistBackupsList: (input: LinguistBackupListRequest) =>
      ipcRenderer.invoke(LINGUIST_PROJECT_IPC_CHANNELS.LIST_BACKUPS, input),
    linguistBackupsPreviewRestore: (input: LinguistRestorePreviewRequest) =>
      ipcRenderer.invoke(LINGUIST_PROJECT_IPC_CHANNELS.PREVIEW_RESTORE, input),
    linguistBackupsRestore: (input: LinguistProjectRestoreRequest) =>
      ipcRenderer.invoke(LINGUIST_PROJECT_IPC_CHANNELS.RESTORE, input),
    linguistIntegrityStart: (input: LinguistIntegrityStartRequest) =>
      ipcRenderer.invoke(LINGUIST_INTEGRITY_IPC_CHANNELS.START, input),
    linguistIntegrityCancel: (input: LinguistIntegrityCancelRequest) =>
      ipcRenderer.invoke(LINGUIST_INTEGRITY_IPC_CHANNELS.CANCEL, input),
    linguistIntegrityExportReport: (input: LinguistIntegrityExportReportRequest) =>
      ipcRenderer.invoke(LINGUIST_INTEGRITY_IPC_CHANNELS.EXPORT_REPORT, input),
    onLinguistIntegrityProgress: (callback: (event: LinguistIntegrityScrubEvent) => void) => {
      const listener = (_: unknown, event: LinguistIntegrityScrubEvent): void => callback(event)
      ipcRenderer.on(LINGUIST_INTEGRITY_IPC_CHANNELS.PROGRESS, listener)
      return () => { ipcRenderer.removeListener(LINGUIST_INTEGRITY_IPC_CHANNELS.PROGRESS, listener) }
    },
    // ===== Linguist 资产源文件预览（PB-089）=====
    linguistProjectsPreviewAssetSource: (input: LinguistAssetPreviewRequest) =>
      ipcRenderer.invoke(LINGUIST_ASSET_PREVIEW_IPC_CHANNELS.PREVIEW_SOURCE, input),
    linguistProjectsPreviewReferenceImport: (input: LinguistReferenceImportPreviewRequest) =>
      ipcRenderer.invoke(LINGUIST_ASSET_PREVIEW_IPC_CHANNELS.PREVIEW_REFERENCE_IMPORT, input),
    linguistExportsPrepareAsset: (input: LinguistPrepareDeliveryRequest) =>
      ipcRenderer.invoke(LINGUIST_EXPORT_IPC_CHANNELS.PREPARE_ASSET, input),
    linguistExportsSaveAsset: (input: LinguistExportSaveAssetRequest) =>
      ipcRenderer.invoke(LINGUIST_EXPORT_IPC_CHANNELS.SAVE_ASSET, input),
    linguistExportsList: (input: LinguistExportListRequest) =>
      ipcRenderer.invoke(LINGUIST_EXPORT_IPC_CHANNELS.LIST, input),
    linguistDiagnosticsGetStatus: (input: LinguistDiagnosticsRequest) =>
      ipcRenderer.invoke(LINGUIST_DIAGNOSTICS_IPC_CHANNELS.GET_STATUS, input),
    linguistDiagnosticsPreviewBundle: (input: LinguistDiagnosticsRequest) =>
      ipcRenderer.invoke(LINGUIST_DIAGNOSTICS_IPC_CHANNELS.PREVIEW_BUNDLE, input),
    linguistDiagnosticsExportBundle: (input: LinguistDiagnosticsRequest) =>
      ipcRenderer.invoke(LINGUIST_DIAGNOSTICS_IPC_CHANNELS.EXPORT_BUNDLE, input),
    linguistCatQuery: (input: LinguistCatQueryRequest) =>
      ipcRenderer.invoke(LINGUIST_CAT_IPC_CHANNELS.QUERY, input),
    linguistCatEditSegment: (input: LinguistCatEditSegmentRequest) =>
      ipcRenderer.invoke(LINGUIST_CAT_IPC_CHANNELS.EDIT_SEGMENT, input),
    linguistCatConfirmStage: (input: LinguistCatConfirmStageRequest) =>
      ipcRenderer.invoke(LINGUIST_CAT_IPC_CHANNELS.CONFIRM_STAGE, input),
    linguistCatUnconfirmStage: (input: LinguistCatUnconfirmStageRequest) =>
      ipcRenderer.invoke(LINGUIST_CAT_IPC_CHANNELS.UNCONFIRM_STAGE, input),
    linguistCatConfirmStageBulk: (input: LinguistCatConfirmStageBulkRequest) =>
      ipcRenderer.invoke(LINGUIST_CAT_IPC_CHANNELS.CONFIRM_STAGE_BULK, input),
    linguistCatGetContext: (input: LinguistCatGetContextRequest) =>
      ipcRenderer.invoke(LINGUIST_CAT_IPC_CHANNELS.GET_CONTEXT, input),
    linguistCatAddApprovedExemplar: (input: LinguistCatAddApprovedExemplarRequest) =>
      ipcRenderer.invoke(LINGUIST_CAT_IPC_CHANNELS.ADD_APPROVED_EXEMPLAR, input),
    linguistCatRunQa: (input: LinguistCatRunQaRequest) =>
      ipcRenderer.invoke(LINGUIST_CAT_IPC_CHANNELS.RUN_QA, input),
    linguistCatListQaFindings: (input: LinguistCatListQaFindingsRequest) =>
      ipcRenderer.invoke(LINGUIST_CAT_IPC_CHANNELS.LIST_QA_FINDINGS, input),
    linguistCatResolveQaFinding: (input: LinguistCatResolveQaFindingRequest) =>
      ipcRenderer.invoke(LINGUIST_CAT_IPC_CHANNELS.RESOLVE_QA_FINDING, input),
    linguistCatWaiveQaFinding: (input: LinguistCatWaiveQaFindingRequest) =>
      ipcRenderer.invoke(LINGUIST_CAT_IPC_CHANNELS.WAIVE_QA_FINDING, input),
    linguistCatWaiveQaFindingsBulk: (input: LinguistCatWaiveQaFindingsBulkRequest) =>
      ipcRenderer.invoke(LINGUIST_CAT_IPC_CHANNELS.WAIVE_QA_FINDINGS_BULK, input),
    linguistCatListProjectEvents: (input: LinguistProjectEventListRequest) =>
      ipcRenderer.invoke(LINGUIST_CAT_IPC_CHANNELS.LIST_PROJECT_EVENTS, input),
    linguistCatAckProjectEvents: (input: LinguistProjectEventAckRequest) =>
      ipcRenderer.invoke(LINGUIST_CAT_IPC_CHANNELS.ACK_PROJECT_EVENTS, input),
    linguistCatGetLatestRunSummary: (input: LinguistRunSummaryRequest) =>
      ipcRenderer.invoke(LINGUIST_CAT_IPC_CHANNELS.GET_LATEST_RUN_SUMMARY, input),
    linguistCatUndoLatestRun: (input: LinguistRunUndoRequest) =>
      ipcRenderer.invoke(LINGUIST_CAT_IPC_CHANNELS.UNDO_LATEST_RUN, input),
    onLinguistProjectMutation: (callback: (event: LinguistProjectMutationEvent) => void) => {
      const listener = (_: unknown, event: LinguistProjectMutationEvent): void => callback(event)
      ipcRenderer.on(LINGUIST_CAT_IPC_CHANNELS.PROJECT_MUTATION, listener)
      return () => { ipcRenderer.removeListener(LINGUIST_CAT_IPC_CHANNELS.PROJECT_MUTATION, listener) }
    },
    linguistReferencesQueryTm: (input: LinguistReferenceQueryRequest) =>
      ipcRenderer.invoke(LINGUIST_REFERENCE_IPC_CHANNELS.QUERY_TM, input),
    linguistReferencesQueryTerms: (input: LinguistReferenceQueryRequest) =>
      ipcRenderer.invoke(LINGUIST_REFERENCE_IPC_CHANNELS.QUERY_TERMS, input),
    linguistReferencesImport: (input: LinguistReferenceImportRequest) =>
      ipcRenderer.invoke(LINGUIST_REFERENCE_IPC_CHANNELS.IMPORT, input),
    linguistReferencesConfirmImport: (input: LinguistReferenceConfirmImportRequest) =>
      ipcRenderer.invoke(LINGUIST_REFERENCE_IPC_CHANNELS.CONFIRM_IMPORT, input),
    linguistReferencesCancelImport: (input: LinguistReferenceCancelImportRequest) =>
      ipcRenderer.invoke(LINGUIST_REFERENCE_IPC_CHANNELS.CANCEL_IMPORT, input),
    linguistReferencesPreviewCandidate: (input: LinguistReferenceCandidatePreviewRequest) =>
      ipcRenderer.invoke(LINGUIST_REFERENCE_IPC_CHANNELS.PREVIEW_CANDIDATE, input),
    linguistReferencesUpsertTerm: (input: LinguistTermUpsertRequest) =>
      ipcRenderer.invoke(LINGUIST_REFERENCE_IPC_CHANNELS.UPSERT_TERM, input),
    linguistReferencesUpsertTerms: (input: LinguistTermsUpsertRequest) =>
      ipcRenderer.invoke(LINGUIST_REFERENCE_IPC_CHANNELS.UPSERT_TERMS, input),
    linguistReferencesDeleteTerms: (input: LinguistTermsDeleteRequest) =>
      ipcRenderer.invoke(LINGUIST_REFERENCE_IPC_CHANNELS.DELETE_TERMS, input),
    linguistReferencesListTermConflicts: (input: LinguistTermConflictsRequest) =>
      ipcRenderer.invoke(LINGUIST_REFERENCE_IPC_CHANNELS.LIST_TERM_CONFLICTS, input),
    linguistReferencesValidateTerms: (input: LinguistTermsValidateRequest) =>
      ipcRenderer.invoke(LINGUIST_REFERENCE_IPC_CHANNELS.VALIDATE_TERMS, input),
    linguistReferencesDelete: (input: LinguistReferenceDeleteRequest) =>
      ipcRenderer.invoke(LINGUIST_REFERENCE_IPC_CHANNELS.DELETE, input),
    // ===== Linguist 项目资产（PB-095）=====
    linguistAssetsQuery: (input: LinguistAssetsQueryRequest) =>
      ipcRenderer.invoke(LINGUIST_ASSETS_IPC_CHANNELS.QUERY, input),
    linguistAssetsUpsert: (input: LinguistAssetsUpsertRequest) =>
      ipcRenderer.invoke(LINGUIST_ASSETS_IPC_CHANNELS.UPSERT, input),
    linguistAssetsDelete: (input: LinguistAssetsDeleteRequest) =>
      ipcRenderer.invoke(LINGUIST_ASSETS_IPC_CHANNELS.DELETE, input),
    linguistAssetsImportContextDoc: (input: LinguistContextDocImportRequest) =>
      ipcRenderer.invoke(LINGUIST_ASSETS_IPC_CHANNELS.IMPORT_CONTEXT_DOC, input),
    linguistAssetsPreviewContextDoc: (input: LinguistContextDocPreviewRequest) =>
      ipcRenderer.invoke(LINGUIST_ASSETS_IPC_CHANNELS.PREVIEW_CONTEXT_DOC, input),
    linguistAssetsSetContextDocSegmentLink: (input: LinguistContextDocSegmentLinkRequest) =>
      ipcRenderer.invoke(LINGUIST_ASSETS_IPC_CHANNELS.SET_CONTEXT_DOC_SEGMENT_LINK, input),
    linguistAssetsImportSentencePatterns: (input: LinguistSentencePatternImportRequest) =>
      ipcRenderer.invoke(LINGUIST_ASSETS_IPC_CHANNELS.IMPORT_SENTENCE_PATTERNS, input),

    // ===== Linguist 会话绑定（PB-034）=====
    linguistSessionsCreateForProject: (input: LinguistSessionCreateForProjectRequest) =>
      ipcRenderer.invoke(LINGUIST_SESSION_IPC_CHANNELS.CREATE_FOR_PROJECT, input),
    linguistSessionsUpdateRole: (input: LinguistSessionUpdateRoleRequest) =>
      ipcRenderer.invoke(LINGUIST_SESSION_IPC_CHANNELS.UPDATE_ROLE, input),
    linguistSessionsListForProject: (input: LinguistSessionListForProjectRequest) =>
      ipcRenderer.invoke(LINGUIST_SESSION_IPC_CHANNELS.LIST_FOR_PROJECT, input),
    linguistSessionsGetBinding: (input: LinguistSessionGetBindingRequest) =>
      ipcRenderer.invoke(LINGUIST_SESSION_IPC_CHANNELS.GET_BINDING, input),
    linguistSessionsDetachBinding: (input: LinguistSessionDetachBindingRequest) =>
      ipcRenderer.invoke(LINGUIST_SESSION_IPC_CHANNELS.DETACH_BINDING, input),
    linguistSessionsGetCopyEligibility: (input: LinguistSessionCopyEligibilityRequest) =>
      ipcRenderer.invoke(LINGUIST_SESSION_IPC_CHANNELS.GET_COPY_ELIGIBILITY, input),
    linguistSessionsCopyToProject: (input: LinguistSessionCopyToProjectRequest) =>
      ipcRenderer.invoke(LINGUIST_SESSION_IPC_CHANNELS.COPY_TO_PROJECT, input),

    // ===== Linguist Proposal 人工审核（PB-053）=====
    linguistProposalsList: (input: LinguistProposalListRequest) =>
      ipcRenderer.invoke(LINGUIST_PROPOSAL_IPC_CHANNELS.LIST, input),
    linguistProposalsListPending: (input: LinguistProposalListPendingRequest) =>
      ipcRenderer.invoke(LINGUIST_PROPOSAL_IPC_CHANNELS.LIST_PENDING, input),
    linguistProposalsGetDiff: (input: LinguistProposalGetDiffRequest) =>
      ipcRenderer.invoke(LINGUIST_PROPOSAL_IPC_CHANNELS.GET_DIFF, input),
    linguistApplyTranslations: (input: LinguistApplyTranslationsRequest) =>
      ipcRenderer.invoke(LINGUIST_PROPOSAL_IPC_CHANNELS.APPLY_TRANSLATIONS, input),
    linguistProposalsAccept: (input: LinguistProposalMutationRequest) =>
      ipcRenderer.invoke(LINGUIST_PROPOSAL_IPC_CHANNELS.ACCEPT, input),
    linguistProposalsReject: (input: LinguistProposalMutationRequest) =>
      ipcRenderer.invoke(LINGUIST_PROPOSAL_IPC_CHANNELS.REJECT, input),
    linguistProposalsEditAndAccept: (input: LinguistProposalEditAndAcceptRequest) =>
      ipcRenderer.invoke(LINGUIST_PROPOSAL_IPC_CHANNELS.EDIT_AND_ACCEPT, input),
    linguistProposalsAcceptSelected: (input: LinguistProposalSelectedMutationRequest) =>
      ipcRenderer.invoke(LINGUIST_PROPOSAL_IPC_CHANNELS.ACCEPT_SELECTED, input),
    linguistProposalsRejectSelected: (input: LinguistProposalSelectedMutationRequest) =>
      ipcRenderer.invoke(LINGUIST_PROPOSAL_IPC_CHANNELS.REJECT_SELECTED, input),
    linguistProposalsReissue: (input: LinguistProposalMutationRequest) =>
      ipcRenderer.invoke(LINGUIST_PROPOSAL_IPC_CHANNELS.REISSUE, input),

    // ===== Linguist Legacy 迁移向导（PB-094）=====
    linguistMigrationPickAndScan: () =>
      ipcRenderer.invoke(LINGUIST_MIGRATION_IPC_CHANNELS.PICK_AND_SCAN),
    linguistMigrationImport: (input: LinguistMigrationImportRequest) =>
      ipcRenderer.invoke(LINGUIST_MIGRATION_IPC_CHANNELS.IMPORT, input),
    onLinguistMigrationProgress: (callback: (progress: LinguistMigrationProgress) => void) => {
      const listener = (_: unknown, progress: LinguistMigrationProgress): void => callback(progress)
      ipcRenderer.on(LINGUIST_MIGRATION_IPC_CHANNELS.PROGRESS, listener)
      return () => { ipcRenderer.removeListener(LINGUIST_MIGRATION_IPC_CHANNELS.PROGRESS, listener) }
    },
  }
}
