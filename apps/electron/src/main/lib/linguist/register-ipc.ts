import { app, BrowserWindow, dialog, ipcMain } from 'electron'
import { join } from 'node:path'
import {
  LINGUIST_ASSET_PREVIEW_IPC_CHANNELS,
  LINGUIST_ASSETS_IPC_CHANNELS,
  LINGUIST_CAT_IPC_CHANNELS,
  LINGUIST_DIAGNOSTICS_IPC_CHANNELS,
  LINGUIST_EXPORT_IPC_CHANNELS,
  LINGUIST_INTEGRITY_IPC_CHANNELS,
  LINGUIST_MIGRATION_IPC_CHANNELS,
  LINGUIST_PROJECT_IPC_CHANNELS,
  LINGUIST_PROPOSAL_IPC_CHANNELS,
  LINGUIST_REFERENCE_IPC_CHANNELS,
  LINGUIST_SESSION_IPC_CHANNELS,
  type LinguistProjectMutationEvent,
} from '@proma/shared'
import { isAgentSessionActive } from '../agent-service'
import { getAgentSessionMeta } from '../agent-session-manager'
import { registerPromaFilePath } from '../local-file-protocol'
import { createLinguistAssetsIpc } from './assets-ipc'
import { createLinguistCatWorkspaceIpc } from './cat-workspace-ipc'
import { createLinguistDiagnosticsIpc } from './diagnostics-ipc'
import { createLinguistExportIpc } from './export-ipc'
import { createIntegrityScrubIpc } from './integrity-scrub-ipc'
import { IntegrityScrubService } from './integrity-scrub-service'
import { createLinguistMigrationIpc } from './migration-ipc'
import { getLinguistMigrationService } from './migration-service'
import { PendingImportFileStore } from './pending-import-files'
import { createLinguistProjectIpc } from './project-ipc'
import { getLinguistProjectService } from './project-service'
import { createLinguistProposalIpc } from './proposal-ipc'
import { createLinguistReferenceIpc } from './reference-ipc'
import { createLinguistSessionIpc } from './session-ipc'

let linguistIntegrityScrubService: IntegrityScrubService | undefined

export function stopAllLinguistIntegrityScrubs(): void {
  linguistIntegrityScrubService?.dispose()
  linguistIntegrityScrubService = undefined
}
export function registerLinguistIpc(): void {
  // ===== Linguist CAT 项目（PB-031；计划 §7.2）=====

  // 契约见 packages/shared/src/types/linguist.ts。与 house「直返 + throw」惯例
  // 不同，本域全部通道返回 LinguistIpcResult<T> 信封：Electron invoke 会包装
  // handler 抛出的错误并丢弃自定义 code 属性，而稳定机器可读错误码是
  // 计划 §7.4 的硬规则。处理器逻辑（校验 / 信封 / 导入选择器流程）在
  // lib/linguist/project-ipc.ts（不依赖 electron，node --test 直接驱动），
  // 此处只做薄适配：通道注册 + 注入真实 dialog picker。
  // 服务惰性解析（getLinguistProjectService）：注册先于 bootstrap 的服务 init，
  // init 失败时通道以 INTERNAL 信封降级而非崩溃。
  const pendingLinguistImportFiles = new PendingImportFileStore()
  const linguistProjectIpc = createLinguistProjectIpc({
    getService: getLinguistProjectService,
    pendingFiles: pendingLinguistImportFiles,
    // PB-089：预览转换栈惰性注入（file-preview-service 体积大，沿用本文件
    // 既有的 await import 延迟加载纪律）；registerPromaFilePath 静态已导入。
    assetPreview: {
      readText: async (filePath) =>
        (await import('../file-preview-service')).resolveAndReadFile(filePath),
      extractText: async (filePath) =>
        (await import('../document-parser')).extractTextFromFile(filePath),
      convertDocxToHtml: async (filePath) =>
        (await import('../file-preview-service')).convertDocxToHtml(filePath),
      convertOfficeToHtml: async (filePath) =>
        (await import('../file-preview-service')).convertOfficeToHtml(filePath),
      registerPreviewUrl: registerPromaFilePath,
    },
  })
  linguistIntegrityScrubService ??= new IntegrityScrubService({
    getService: getLinguistProjectService,
    workerScript: join(__dirname, 'linguist-integrity-scrub-worker.cjs'),
    emit: (event) => {
      for (const window of BrowserWindow.getAllWindows()) {
        window.webContents.send(LINGUIST_INTEGRITY_IPC_CHANNELS.PROGRESS, event)
      }
    },
  })
  const linguistIntegrityIpc = createIntegrityScrubIpc({
    getProjectService: getLinguistProjectService,
    scrub: linguistIntegrityScrubService,
  })

  ipcMain.handle(
    LINGUIST_PROJECT_IPC_CHANNELS.LIST,
    async (_, input: unknown) => linguistProjectIpc.list(input)
  )

  ipcMain.handle(
    LINGUIST_PROJECT_IPC_CHANNELS.CREATE,
    async (_, input: unknown) => linguistProjectIpc.create(input)
  )

  ipcMain.handle(
    LINGUIST_PROJECT_IPC_CHANNELS.OPEN,
    async (_, input: unknown) => linguistProjectIpc.open(input)
  )

  // 导入：主进程原生文件选择器。renderer 永不提交路径/字节（计划 §7.4）；
  // 取消是正常分支（{cancelled: true}），非错误。
  ipcMain.handle(
    LINGUIST_PROJECT_IPC_CHANNELS.IMPORT,
    async (event, input: unknown) => {
      const win = BrowserWindow.fromWebContents(event.sender)
      return linguistProjectIpc.import(input, (options) =>
        win ? dialog.showOpenDialog(win, options) : dialog.showOpenDialog(options)
      )
    }
  )

  ipcMain.handle(
    LINGUIST_PROJECT_IPC_CHANNELS.CONFIRM_XLSX_MAPPING,
    async (_, input: unknown) => linguistProjectIpc.confirmXlsxMapping(input)
  )

  // 摘要：PB-033 起响应扩展为含资产元数据列表（assets），通道与校验不变。
  ipcMain.handle(
    LINGUIST_PROJECT_IPC_CHANNELS.GET_SUMMARY,
    async (_, input: unknown) => linguistProjectIpc.getSummary(input)
  )

  // 阶段覆盖：单批次单阶段岗位确认/decision 聚合（T/E/P 进度）。
  ipcMain.handle(
    LINGUIST_PROJECT_IPC_CHANNELS.GET_STAGE_COVERAGE,
    async (_, input: unknown) => linguistProjectIpc.getStageCoverage(input)
  )

  ipcMain.handle(
    LINGUIST_PROJECT_IPC_CHANNELS.LIST_FORMAT_QUALIFICATIONS,
    async () => linguistProjectIpc.listFormatQualifications()
  )

  ipcMain.handle(
    LINGUIST_PROJECT_IPC_CHANNELS.RENAME,
    async (_, input: unknown) => linguistProjectIpc.rename(input)
  )

  ipcMain.handle(
    LINGUIST_PROJECT_IPC_CHANNELS.SET_LOCALES,
    async (_, input: unknown) => linguistProjectIpc.setLocales(input)
  )

  ipcMain.handle(
    LINGUIST_PROJECT_IPC_CHANNELS.REORDER_ACTIVE,
    async (_, input: unknown) => linguistProjectIpc.reorderActive(input)
  )

  ipcMain.handle(
    LINGUIST_PROJECT_IPC_CHANNELS.ARCHIVE,
    async (_, input: unknown) => linguistProjectIpc.archive(input)
  )

  ipcMain.handle(
    LINGUIST_PROJECT_IPC_CHANNELS.DELETE,
    async (_, input: unknown) => linguistProjectIpc.delete(input)
  )

  ipcMain.handle(
    LINGUIST_PROJECT_IPC_CHANNELS.SET_WORKFLOW_CONFIG,
    async (_, input: unknown) => linguistProjectIpc.setWorkflowConfig(input)
  )
  ipcMain.handle(
    LINGUIST_PROJECT_IPC_CHANNELS.UPDATE_TAG_PROFILE,
    async (_, input: unknown) => linguistProjectIpc.updateTagProfile(input)
  )
  ipcMain.handle(
    LINGUIST_PROJECT_IPC_CHANNELS.SCAN_UNKNOWN_TAGS,
    async (_, input: unknown) => linguistProjectIpc.scanUnknownTags(input)
  )

  // PB-111：备份 / 恢复（计划 §24）。renderer 只提交 projectId + backupName
  // （白名单形状，防目录穿越）；响应绝无绝对路径。归档项目可备份/预览/列表，
  // 恢复由服务层以 PROJECT_ARCHIVED 拒绝。
  ipcMain.handle(
    LINGUIST_PROJECT_IPC_CHANNELS.BACKUP,
    async (_, input: unknown) => linguistProjectIpc.backup(input)
  )
  ipcMain.handle(
    LINGUIST_PROJECT_IPC_CHANNELS.LIST_BACKUPS,
    async (_, input: unknown) => linguistProjectIpc.listBackups(input)
  )
  ipcMain.handle(
    LINGUIST_PROJECT_IPC_CHANNELS.PREVIEW_RESTORE,
    async (_, input: unknown) => linguistProjectIpc.previewRestore(input)
  )
  ipcMain.handle(
    LINGUIST_PROJECT_IPC_CHANNELS.RESTORE,
    async (_, input: unknown) => linguistProjectIpc.restore(input)
  )
  // LA-INTAKE-007：条件撤销导入（主进程重新校验项目与资产 id；
  // 下游引用判定与级联删除全在服务层，renderer 只提交两个 id）。
  ipcMain.handle(
    LINGUIST_PROJECT_IPC_CHANNELS.UNDO_IMPORT_ASSET,
    async (_, input: unknown) => linguistProjectIpc.undoImportAsset(input)
  )

  // LF-088：Full Integrity Scrub 始终由独立 node:worker_threads 执行；
  // renderer 只收进度/脱敏结果，也不能提交保存路径。
  ipcMain.handle(
    LINGUIST_INTEGRITY_IPC_CHANNELS.START,
    async (_, input: unknown) => linguistIntegrityIpc.start(input)
  )
  ipcMain.handle(
    LINGUIST_INTEGRITY_IPC_CHANNELS.CANCEL,
    async (_, input: unknown) => linguistIntegrityIpc.cancel(input)
  )
  ipcMain.handle(
    LINGUIST_INTEGRITY_IPC_CHANNELS.EXPORT_REPORT,
    async (event, input: unknown) => {
      const win = BrowserWindow.fromWebContents(event.sender)
      return linguistIntegrityIpc.exportReport(input, (options) =>
        win ? dialog.showSaveDialog(win, options) : dialog.showSaveDialog(options)
      )
    }
  )

  // PB-089：CAT 资产源文件预览（纯读，归档项目允许；三态分派在处理器内）。
  // 处理器在 project-ipc.ts（项目通道组共享受托服务），通道名独立成组
  // （linguist.project.* 单数），不影响 PB-031 契约守卫的 11 通道断言。
  ipcMain.handle(
    LINGUIST_ASSET_PREVIEW_IPC_CHANNELS.PREVIEW_SOURCE,
    async (_, input: unknown) => linguistProjectIpc.previewAssetSource(input)
  )
  ipcMain.handle(
    LINGUIST_ASSET_PREVIEW_IPC_CHANNELS.PREVIEW_REFERENCE_IMPORT,
    async (_, input: unknown) => linguistProjectIpc.previewReferenceImport(input)
  )

  // 导出：主进程先生成并验证 staging，再由系统 Save 对话框选择目标。
  const linguistExportIpc = createLinguistExportIpc({ getService: getLinguistProjectService })
  ipcMain.handle(
    LINGUIST_EXPORT_IPC_CHANNELS.PREPARE_ASSET,
    async (_, input: unknown) => linguistExportIpc.prepareAsset(input)
  )
  // PB-102：只读列出项目 exports/ 目录（无选择器，纯信封通道）。
  ipcMain.handle(
    LINGUIST_EXPORT_IPC_CHANNELS.LIST,
    async (_, input: unknown) => linguistExportIpc.list(input)
  )
  ipcMain.handle(
    LINGUIST_EXPORT_IPC_CHANNELS.SAVE_ASSET,
    async (event, input: unknown) => {
      const win = BrowserWindow.fromWebContents(event.sender)
      return linguistExportIpc.saveAsset(input, (options) =>
        win ? dialog.showSaveDialog(win, options) : dialog.showSaveDialog(options)
      )
    }
  )

  const linguistDiagnosticsIpc = createLinguistDiagnosticsIpc({
    getService: getLinguistProjectService,
    getSession: getAgentSessionMeta,
    isDevelopment: !app.isPackaged,
  })
  ipcMain.handle(
    LINGUIST_DIAGNOSTICS_IPC_CHANNELS.GET_STATUS,
    async (_, input: unknown) => linguistDiagnosticsIpc.getStatus(input)
  )
  ipcMain.handle(
    LINGUIST_DIAGNOSTICS_IPC_CHANNELS.PREVIEW_BUNDLE,
    async (_, input: unknown) => linguistDiagnosticsIpc.previewBundle(input)
  )
  ipcMain.handle(
    LINGUIST_DIAGNOSTICS_IPC_CHANNELS.EXPORT_BUNDLE,
    async (event, input: unknown) => {
      const win = BrowserWindow.fromWebContents(event.sender)
      return linguistDiagnosticsIpc.exportBundle(input, (options) =>
        win ? dialog.showSaveDialog(win, options) : dialog.showSaveDialog(options)
      )
    }
  )

  // ===== Linguist Legacy 迁移向导（PB-094；计划 §22）=====
  //
  // 目录选择器在主进程（计划 §7.4：renderer 永不提交路径）；旧根路径由服务在
  // pickAndScan 时留存为会话状态。进度事件经 webContents.send 推送
  // （PROGRESS 为 main→renderer 单向通道，不注册 handle）。
  const linguistMigrationIpc = createLinguistMigrationIpc({ getService: getLinguistMigrationService })
  ipcMain.handle(
    LINGUIST_MIGRATION_IPC_CHANNELS.PICK_AND_SCAN,
    async (event, input: unknown) => {
      const win = BrowserWindow.fromWebContents(event.sender)
      return linguistMigrationIpc.pickAndScan(input, (options) =>
        win ? dialog.showOpenDialog(win, options) : dialog.showOpenDialog(options)
      )
    }
  )
  ipcMain.handle(
    LINGUIST_MIGRATION_IPC_CHANNELS.IMPORT,
    async (event, input: unknown) =>
      linguistMigrationIpc.import(input, (progress) => {
        if (!event.sender.isDestroyed()) {
          event.sender.send(LINGUIST_MIGRATION_IPC_CHANNELS.PROGRESS, progress)
        }
      })
  )

  const broadcastLinguistProjectMutation = (
    mutation: LinguistProjectMutationEvent,
  ): void => {
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed() && !win.webContents.isDestroyed()) {
        try {
          win.webContents.send(LINGUIST_CAT_IPC_CHANNELS.PROJECT_MUTATION, mutation)
        } catch (error) {
          console.error('[Linguist] 向 renderer 广播项目 mutation 失败:', error)
        }
      }
    }
  }

  // ===== Linguist CAT Workspace（PB-060/071；分页、编辑与人工 QA 审核）=====
  const linguistCatWorkspaceIpc = createLinguistCatWorkspaceIpc({
    getService: getLinguistProjectService,
    getSession: getAgentSessionMeta,
    onProjectMutation: broadcastLinguistProjectMutation,
  })
  ipcMain.handle(LINGUIST_CAT_IPC_CHANNELS.LIST_PROJECT_EVENTS, async (_, input: unknown) =>
    linguistCatWorkspaceIpc.listProjectEvents(input))
  ipcMain.handle(LINGUIST_CAT_IPC_CHANNELS.ACK_PROJECT_EVENTS, async (_, input: unknown) =>
    linguistCatWorkspaceIpc.ackProjectEvents(input))
  ipcMain.handle(LINGUIST_CAT_IPC_CHANNELS.GET_LATEST_RUN_SUMMARY, async (_, input: unknown) =>
    linguistCatWorkspaceIpc.getLatestRunSummary(input))
  ipcMain.handle(LINGUIST_CAT_IPC_CHANNELS.UNDO_LATEST_RUN, async (_, input: unknown) =>
    linguistCatWorkspaceIpc.undoLatestRun(input))
  ipcMain.handle(LINGUIST_CAT_IPC_CHANNELS.QUERY, async (_, input: unknown) =>
    linguistCatWorkspaceIpc.query(input))
  ipcMain.handle(LINGUIST_CAT_IPC_CHANNELS.EDIT_SEGMENT, async (_, input: unknown) =>
    linguistCatWorkspaceIpc.edit(input))
  ipcMain.handle(LINGUIST_CAT_IPC_CHANNELS.CONFIRM_STAGE, async (_, input: unknown) =>
    linguistCatWorkspaceIpc.confirmStage(input))
  ipcMain.handle(LINGUIST_CAT_IPC_CHANNELS.UNCONFIRM_STAGE, async (_, input: unknown) =>
    linguistCatWorkspaceIpc.unconfirmStage(input))
  ipcMain.handle(LINGUIST_CAT_IPC_CHANNELS.CONFIRM_STAGE_BULK, async (_, input: unknown) =>
    linguistCatWorkspaceIpc.confirmStageBulk(input))
  ipcMain.handle(LINGUIST_CAT_IPC_CHANNELS.GET_CONTEXT, async (_, input: unknown) =>
    linguistCatWorkspaceIpc.getContext(input))
  ipcMain.handle(LINGUIST_CAT_IPC_CHANNELS.ADD_APPROVED_EXEMPLAR, async (_, input: unknown) =>
    linguistCatWorkspaceIpc.addApprovedExemplar(input))
  ipcMain.handle(LINGUIST_CAT_IPC_CHANNELS.RUN_QA, async (_, input: unknown) =>
    linguistCatWorkspaceIpc.runQa(input))
  ipcMain.handle(LINGUIST_CAT_IPC_CHANNELS.LIST_QA_FINDINGS, async (_, input: unknown) =>
    linguistCatWorkspaceIpc.listQaFindings(input))
  ipcMain.handle(LINGUIST_CAT_IPC_CHANNELS.RESOLVE_QA_FINDING, async (_, input: unknown) =>
    linguistCatWorkspaceIpc.resolveQaFinding(input))
  ipcMain.handle(LINGUIST_CAT_IPC_CHANNELS.WAIVE_QA_FINDING, async (_, input: unknown) =>
    linguistCatWorkspaceIpc.waiveQaFinding(input))
  ipcMain.handle(LINGUIST_CAT_IPC_CHANNELS.WAIVE_QA_FINDINGS_BULK, async (_, input: unknown) =>
    linguistCatWorkspaceIpc.waiveQaFindingsBulk(input))

  // ===== Linguist TM / 术语库（PB-080；原生导入与项目隔离管理）=====
  const linguistReferenceIpc = createLinguistReferenceIpc({
    getService: getLinguistProjectService,
    pendingFiles: pendingLinguistImportFiles,
  })
  ipcMain.handle(LINGUIST_REFERENCE_IPC_CHANNELS.QUERY_TM, async (_, input: unknown) =>
    linguistReferenceIpc.queryTm(input))
  ipcMain.handle(LINGUIST_REFERENCE_IPC_CHANNELS.QUERY_TERMS, async (_, input: unknown) =>
    linguistReferenceIpc.queryTerms(input))
  ipcMain.handle(LINGUIST_REFERENCE_IPC_CHANNELS.IMPORT, async (event, input: unknown) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    return linguistReferenceIpc.import(input, (options) =>
      win ? dialog.showOpenDialog(win, options) : dialog.showOpenDialog(options))
  })
  ipcMain.handle(LINGUIST_REFERENCE_IPC_CHANNELS.CONFIRM_IMPORT, async (_, input: unknown) =>
    linguistReferenceIpc.confirmImport(input))
  ipcMain.handle(LINGUIST_REFERENCE_IPC_CHANNELS.CANCEL_IMPORT, async (_, input: unknown) =>
    linguistReferenceIpc.cancelImport(input))
  ipcMain.handle(LINGUIST_REFERENCE_IPC_CHANNELS.PREVIEW_CANDIDATE, async (_, input: unknown) =>
    linguistReferenceIpc.previewCandidate(input))
  ipcMain.handle(LINGUIST_REFERENCE_IPC_CHANNELS.UPSERT_TERM, async (_, input: unknown) =>
    linguistReferenceIpc.upsertTerm(input))
  ipcMain.handle(LINGUIST_REFERENCE_IPC_CHANNELS.UPSERT_TERMS, async (_, input: unknown) =>
    linguistReferenceIpc.upsertTerms(input))
  ipcMain.handle(LINGUIST_REFERENCE_IPC_CHANNELS.DELETE_TERMS, async (_, input: unknown) =>
    linguistReferenceIpc.deleteTerms(input))
  ipcMain.handle(LINGUIST_REFERENCE_IPC_CHANNELS.LIST_TERM_CONFLICTS, async (_, input: unknown) =>
    linguistReferenceIpc.listTermConflicts(input))
  ipcMain.handle(LINGUIST_REFERENCE_IPC_CHANNELS.VALIDATE_TERMS, async (_, input: unknown) =>
    linguistReferenceIpc.validateTerms(input))
  ipcMain.handle(LINGUIST_REFERENCE_IPC_CHANNELS.DELETE, async (_, input: unknown) =>
    linguistReferenceIpc.delete(input))

  // ===== Linguist 项目资产（PB-095；六类资产 CRUD 与原生导入）=====
  const linguistAssetsIpc = createLinguistAssetsIpc({
    getService: getLinguistProjectService,
    registerPreviewUrl: registerPromaFilePath,
    onProjectMutation: broadcastLinguistProjectMutation,
    // Context 文档 blob 预览转换栈（与 PB-089 同一惰性加载纪律）。
    assetPreview: {
      readText: async (filePath) =>
        (await import('../file-preview-service')).resolveAndReadFile(filePath),
      extractText: async (filePath) =>
        (await import('../document-parser')).extractTextFromFile(filePath),
      convertDocxToHtml: async (filePath) =>
        (await import('../file-preview-service')).convertDocxToHtml(filePath),
      convertOfficeToHtml: async (filePath) =>
        (await import('../file-preview-service')).convertOfficeToHtml(filePath),
      registerPreviewUrl: registerPromaFilePath,
    },
  })
  ipcMain.handle(LINGUIST_ASSETS_IPC_CHANNELS.QUERY, async (_, input: unknown) =>
    linguistAssetsIpc.query(input))
  ipcMain.handle(LINGUIST_ASSETS_IPC_CHANNELS.UPSERT, async (_, input: unknown) =>
    linguistAssetsIpc.upsert(input))
  ipcMain.handle(LINGUIST_ASSETS_IPC_CHANNELS.DELETE, async (_, input: unknown) =>
    linguistAssetsIpc.delete(input))
  // Context 文档 blob 预览（纯读，归档项目允许；三态分派在处理器内）。
  ipcMain.handle(LINGUIST_ASSETS_IPC_CHANNELS.PREVIEW_CONTEXT_DOC, async (_, input: unknown) =>
    linguistAssetsIpc.previewContextDoc(input))
  ipcMain.handle(LINGUIST_ASSETS_IPC_CHANNELS.SET_CONTEXT_DOC_SEGMENT_LINK, async (_, input: unknown) =>
    linguistAssetsIpc.setContextDocSegmentLink(input))
  ipcMain.handle(LINGUIST_ASSETS_IPC_CHANNELS.IMPORT_CONTEXT_DOC, async (event, input: unknown) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    return linguistAssetsIpc.importContextDoc(input, (options) =>
      win ? dialog.showOpenDialog(win, options) : dialog.showOpenDialog(options))
  })
  ipcMain.handle(LINGUIST_ASSETS_IPC_CHANNELS.IMPORT_SENTENCE_PATTERNS, async (event, input: unknown) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    return linguistAssetsIpc.importSentencePatterns(input, (options) =>
      win ? dialog.showOpenDialog(win, options) : dialog.showOpenDialog(options))
  })

  // ===== Linguist Proposal 人工审核（PB-053）=====
  // 只暴露给 renderer，不注册为 Agent tool；写操作全部带 CAS + idempotency key。
  const linguistProposalIpc = createLinguistProposalIpc({
    getService: getLinguistProjectService,
    onProjectMutation: broadcastLinguistProjectMutation,
  })
  ipcMain.handle(LINGUIST_PROPOSAL_IPC_CHANNELS.LIST, async (_, input: unknown) =>
    linguistProposalIpc.list(input))
  ipcMain.handle(LINGUIST_PROPOSAL_IPC_CHANNELS.LIST_PENDING, async (_, input: unknown) =>
    linguistProposalIpc.listPending(input))
  ipcMain.handle(LINGUIST_PROPOSAL_IPC_CHANNELS.GET_DIFF, async (_, input: unknown) =>
    linguistProposalIpc.getDiff(input))
  ipcMain.handle(LINGUIST_PROPOSAL_IPC_CHANNELS.APPLY_TRANSLATIONS, async (_, input: unknown) =>
    linguistProposalIpc.applyTranslations(input))
  ipcMain.handle(LINGUIST_PROPOSAL_IPC_CHANNELS.ACCEPT, async (_, input: unknown) =>
    linguistProposalIpc.accept(input))
  ipcMain.handle(LINGUIST_PROPOSAL_IPC_CHANNELS.REJECT, async (_, input: unknown) =>
    linguistProposalIpc.reject(input))
  ipcMain.handle(LINGUIST_PROPOSAL_IPC_CHANNELS.EDIT_AND_ACCEPT, async (_, input: unknown) =>
    linguistProposalIpc.editAndAccept(input))
  ipcMain.handle(LINGUIST_PROPOSAL_IPC_CHANNELS.ACCEPT_SELECTED, async (_, input: unknown) =>
    linguistProposalIpc.acceptSelected(input))
  ipcMain.handle(LINGUIST_PROPOSAL_IPC_CHANNELS.REJECT_SELECTED, async (_, input: unknown) =>
    linguistProposalIpc.rejectSelected(input))
  ipcMain.handle(LINGUIST_PROPOSAL_IPC_CHANNELS.REISSUE, async (_, input: unknown) =>
    linguistProposalIpc.reissue(input))

  // ===== Linguist 会话绑定（PB-034；计划 §7.2「Project → Session 绑定」）=====
  // 「项目对话」= 携带冻结 linguistProjectId 绑定的 Pi Agent 会话。同一信封
  // 约定（LinguistIpcResult，绝不抛出）；处理器逻辑在 lib/linguist/
  // session-ipc.ts + session-binding.ts（不依赖 electron，node --test 驱动）。
  const linguistSessionIpc = createLinguistSessionIpc({
    getService: getLinguistProjectService,
    isSessionActive: isAgentSessionActive,
  })

  // 项目内创建对话：绑定在创建时写入并冻结；归档项目拒绝创建（PROJECT_ARCHIVED）。
  ipcMain.handle(
    LINGUIST_SESSION_IPC_CHANNELS.CREATE_FOR_PROJECT,
    async (_, input: unknown) => linguistSessionIpc.createForProject(input)
  )

  ipcMain.handle(
    LINGUIST_SESSION_IPC_CHANNELS.UPDATE_ROLE,
    async (_, input: unknown) => linguistSessionIpc.updateRole(input)
  )

  // 项目对话列表（轻量元数据，updatedAt 降序；项目缺失/归档均可列出）。
  ipcMain.handle(
    LINGUIST_SESSION_IPC_CHANNELS.LIST_FOR_PROJECT,
    async (_, input: unknown) => linguistSessionIpc.listForProject(input)
  )

  // 会话 → 绑定 + 实时状态；普通会话 binding=null。
  ipcMain.handle(
    LINGUIST_SESSION_IPC_CHANNELS.GET_BINDING,
    async (_, input: unknown) => linguistSessionIpc.getBinding(input)
  )

  // 用户显式永久解绑；解绑后沿用原会话作为普通 Agent。
  ipcMain.handle(
    LINGUIST_SESSION_IPC_CHANNELS.DETACH_BINDING,
    async (_, input: unknown) => linguistSessionIpc.detachBinding(input)
  )

  ipcMain.handle(
    LINGUIST_SESSION_IPC_CHANNELS.GET_COPY_ELIGIBILITY,
    async (_, input: unknown) => linguistSessionIpc.getCopyEligibility(input)
  )

  ipcMain.handle(
    LINGUIST_SESSION_IPC_CHANNELS.COPY_TO_PROJECT,
    async (_, input: unknown) => linguistSessionIpc.copyToProject(input)
  )
}
