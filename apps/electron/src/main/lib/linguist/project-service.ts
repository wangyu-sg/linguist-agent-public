/**
 * LinguistProjectService — 主进程 CAT 项目服务（PB-030；计划 §4/§5.2/§7.4）。
 *
 * 职责：
 * - 项目生命周期（list/create/get/archive）与项目路径解析；
 * - cat.db 句柄缓存（显式 close；归档项目一律只读打开 —— fail closed）；
 * - 项目健康检查（project.json 在场且可解析 / cat.db 可打开 / schema 版本
 *   匹配 / source blob 的 sha256 抽查），产出结构化健康报告；
 * - 备份（委托 cat-store 的 VACUUM INTO，返回 linguist 根相对路径）；
 * - 导入管道 importAsset：bytes + filename 入参，绝不接受文件系统路径
 *   （计划 §7.4：renderer 不提交路径；filename 仅作格式探测与元数据）。
 *
 * 运行时降级：init() 运行 probeSqliteRuntime()。node:sqlite 不可用时服务
 * 进入 degraded 状态（getStatus().degraded === true）——项目索引
 * （projects.json）读写仍可用，任何需要数据库的操作抛 store 的类型化
 * StoreSqliteUnavailableError；主进程启动绝不因本服务崩溃。
 *
 * 日志纪律（计划 §7.4）：只记录 id / 计数 / 错误码，绝不记录文件名、
 * 源文、译文等客户文本。
 *
 * promaWorkspaceId 关联决策（PB-030 范围说明）：创建项目时若调用方未显式
 * 指定，则按 agent-workspace-manager 的 id 约定（randomUUID，见
 * createAgentWorkspace）分配一个工作区 id 引用并写入项目元数据。真实的
 * Proma 工作区创建/绑定属于 PB-034 会话逻辑——本票不创建 agent 工作区、
 * 不写 agent-workspaces.json（避免重复名冲突与 skills 目录副作用）。
 */

import { randomUUID } from 'node:crypto'
import { existsSync, lstatSync, readdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import {
  activateTagProfileCandidate,
  normalizeWorkflowStage,
  saveTagProfileCandidate as saveTagCandidate,
  scanUnknownTagPatterns,
  updateTagProfileEntry,
  validateTagProfileCandidate,
  type CurrentStageState,
  type EntropySource,
  type LinguistProject,
  type LinguistWorkbookMappingProfile,
  type SaveTagProfileCandidateInput,
  type QaProfile,
  type QaFindingDisposition,
  type QaFindingSeverity,
  type Segment,
  type SegmentStatus,
  type WorkflowOutputStatusPolicy,
  type WorkflowStage,
} from '@linguist/cat-core'
import { getPromaVersion } from '@proma/core'
import {
  type CatFormatRegistry,
} from '@linguist/cat-formats'
import {
  BACKUP_DIR_NAME_PATTERN,
  CatStore,
  LEGACY_BACKUP_FILE_PATTERN,
  probeSqliteRuntime,
  SCHEMA_VERSION,
  StoreNotFoundError,
  StoreSqliteUnavailableError,
  verifyBackup,
  type ContextDoc,
  type ProjectDatabase,
  type SentencePattern,
  type SentencePatternUpsertInput,
  type SqliteRuntimeProbe,
  type StyleGuideRule,
  type StyleGuideRuleUpsertInput,
  type TechConstraint,
  type TechConstraintUpsertInput,
  type TermEntryUpsertInput,
  type VoiceProfile,
  type VoiceProfileUpsertInput,
} from '@linguist/cat-store'
import { getConfigDir } from '../config-paths'
import {
  LINGUIST_ASSET_ID_PATTERN,
  type LinguistExportFileInfo,
} from '@proma/shared'
import type {
  LinguistImportResourcesInput,
  LinguistImportResourcesResult,
  LinguistIntakeImportResult,
  LinguistIntakeResourceKind,
  LinguistIntakeXlsxMapping,
  LinguistSaveWorkbookMappingInput,
  LinguistWorkbookMappingPreview,
} from '@linguist/cat-tools'
import {
  errorCodeOf,
  LinguistProjectArchivedError,
  LinguistProjectDeleteConfirmationMismatchError,
  LinguistProjectDeleteRequiresArchiveError,
  LinguistProjectLocaleChangeBlockedError,
  mapStoreError,
} from './errors'
import { readLinguistExportManifests } from './export-manifest'
import { createDefaultCatFormatRegistry } from './format-registry'
import {
  importProjectFile,
  importProjectResources,
} from './project-file-intake'
import {
  createProjectWorkbookMappingProfile,
  previewProjectWorkbookMapping,
  resolveProjectWorkbookMapping,
} from './project-workbook-mapping'
import {
  MAX_IMPORT_BYTES,
  ProjectDelivery,
} from './project-delivery'
import type { ProjectModuleContext } from './project-module-context'
import { ProjectQuality } from './project-quality'
import { computeLinguistProjectRevision } from './project-revision'
import { ProjectResources } from './project-resources'
import type {
  CatQaFinding,
  CatSegmentContext,
  CatWorkspacePage,
  CatWorkspaceQuery,
  CreateLinguistProjectInput,
  DeleteLinguistProjectResult,
  ImportAssetInput,
  ImportAssetResult,
  ImportContextDocInput,
  ImportReferenceInput,
  ImportReferenceResult,
  LinguistBackupListItem,
  LinguistBackupResult,
  LinguistBackupSummary,
  LinguistDeliveryPreflight,
  LinguistPreparedDelivery,
  LinguistProjectAssetKind,
  LinguistProjectHealthCheck,
  LinguistProjectHealthReport,
  LinguistProjectServiceOptions,
  LinguistProjectSummary,
  LinguistTagProfileMutationResult,
  LinguistReferenceKind,
  LinguistRestorePreview,
  LinguistRestoreResult,
  LinguistServiceStatus,
  LinguistStagedExport,
  ProjectAssetInfo,
  ProjectAssetsQuery,
  ReferenceImportQueryPage,
  ReferenceQuery,
  ReferenceQueryPage,
  StageMutationBatchResult,
  StageMutationItem,
  TermReferenceInfo,
  TmReferenceInfo,
  UndoImportAssetResult,
} from './project-service-types'
import {
  projectPaths,
  resolveLinguistRootDir,
  toRootRelativePath,
  type LinguistProjectPaths,
} from './paths'

export { MAX_IMPORT_BYTES }
export * from './project-service-types'

/** 健康检查 source blob 抽查的样本上限（spot-check，不全量扫）。 */
const ASSET_SOURCE_SPOT_CHECK_LIMIT = 20

export class LinguistProjectService {
  readonly rootDir: string
  private readonly entropy?: EntropySource
  private readonly now: () => string
  private readonly applicationVersion: string
  private readonly workspaceAllocator: (projectName: string) => string
  private readonly registry: CatFormatRegistry
  private storeInstance?: CatStore
  private probe?: SqliteRuntimeProbe
  private readonly handles = new Map<string, ProjectDatabase>()
  private readonly resources: ProjectResources
  private readonly quality: ProjectQuality
  private readonly delivery: ProjectDelivery

  constructor(options: LinguistProjectServiceOptions) {
    this.rootDir = options.rootDir
    this.now = options.now ?? (() => new Date().toISOString())
    this.applicationVersion = options.applicationVersion ?? getPromaVersion()
    if (options.entropy !== undefined) this.entropy = options.entropy
    this.workspaceAllocator = options.workspaceAllocator ?? (() => randomUUID())
    this.registry = options.registry ?? createDefaultCatFormatRegistry()
    const context: ProjectModuleContext = {
      rootDir: this.rootDir,
      registry: this.registry,
      now: () => this.now(),
      getProject: (projectId) => this.getProject(projectId),
      getProjectPaths: (projectId) => this.getProjectPaths(projectId),
      openProject: (projectId, openOptions) =>
        this.openProject(projectId, openOptions),
      assertProjectWritable: (projectId) =>
        this.assertProjectWritable(projectId),
      call: (fn, projectId) => this.call(fn, projectId),
    }
    this.resources = new ProjectResources(context)
    this.quality = new ProjectQuality(context)
    this.delivery = new ProjectDelivery(context)
  }

  /** CatStore 惰性实例化（构造轻、首用才建）。 */
  private get store(): CatStore {
    this.storeInstance ??= new CatStore({
      rootDir: this.rootDir,
      ...(this.entropy !== undefined ? { entropy: this.entropy } : {}),
      now: this.now,
      applicationVersion: this.applicationVersion,
    })
    return this.storeInstance
  }

  /**
   * 启动探测（服务初始化入口）。绝不抛错：sqlite 不可用时记录降级，
   * 主进程启动链不受影响（由 index.ts 的 safeRun 再兜底一层）。
   */
  init(): LinguistServiceStatus {
    this.probe = probeSqliteRuntime()
    if (this.probe.ok) {
      console.log(
        `[Linguist] CAT 项目服务已初始化（node ${this.probe.nodeVersion}，备份: ${this.probe.hasBackupApi ? 'backup API' : 'VACUUM INTO'}）`,
      )
    } else {
      console.warn(
        `[Linguist] node:sqlite 不可用，CAT 数据库能力降级（项目索引仍可读写；DB 操作将抛 STORE_SQLITE_UNAVAILABLE）: ${this.probe.notes.join('; ')}`,
      )
    }
    return this.getStatus()
  }

  getStatus(): LinguistServiceStatus {
    const probe = this.probe ?? probeSqliteRuntime()
    return { rootDir: this.rootDir, degraded: !probe.ok, sqlite: probe }
  }

  listProjects(filter: { includeArchived?: boolean } = {}): LinguistProject[] {
    return this.call(() => this.store.listProjects(filter))
  }

  getProject(projectId: string): LinguistProject {
    return this.call(() => this.store.getProject(projectId), projectId)
  }

  createProject(input: CreateLinguistProjectInput): LinguistProject {
    const promaWorkspaceId = input.promaWorkspaceId ?? this.workspaceAllocator(input.name)
    const project = this.call(() =>
      this.store.createProject({
        name: input.name,
        sourceLocale: input.sourceLocale,
        targetLocale: input.targetLocale,
        promaWorkspaceId,
        ...(input.workflowStage !== undefined
          ? { workflowStage: input.workflowStage }
          : {}),
        ...(input.outputStatusPolicy !== undefined
          ? { outputStatusPolicy: input.outputStatusPolicy }
          : {}),
        ...(input.qaProfile !== undefined ? { qaProfile: input.qaProfile } : {}),
      }),
    )
    // 尽力预建 cat.db（可写打开即建库+迁移）。degraded 模式下跳过——
    // 项目元数据已落盘，DB 将在首次可写打开时创建。
    try {
      this.store.openProject(project.id).close()
    } catch (err) {
      if (err instanceof StoreSqliteUnavailableError) {
        console.warn(`[Linguist] sqlite 不可用，项目 ${project.id} 的 cat.db 将延迟到首次打开时创建`)
      } else {
        throw mapStoreError(err, project.id)
      }
    }
    console.log(`[Linguist] 已创建 CAT 项目: ${project.id}（工作区 ${promaWorkspaceId}）`)
    return project
  }

  renameProject(projectId: string, name: string): LinguistProject {
    this.assertProjectWritable(projectId)
    return this.call(() => this.store.renameProject(projectId, name), projectId)
  }

  /** 空项目可改语言对；已有批次/TM/TB 的 locale 已写入数据行，必须冻结。 */
  setProjectLocales(projectId: string, sourceLocale: string, targetLocale: string): LinguistProject {
    this.assertProjectWritable(projectId)
    const current = this.getProject(projectId)
    if (current.sourceLocale === sourceLocale && current.targetLocale === targetLocale) return current
    const db = this.openProject(projectId)
    const blockers = this.call(() => ({
      batches: db.assets.countByProject(),
      tmUnits: db.tmUnits.count(),
      termEntries: db.termEntries.count(),
    }), projectId)
    if (Object.values(blockers).some((count) => count > 0)) {
      throw new LinguistProjectLocaleChangeBlockedError(projectId, blockers)
    }
    return this.call(
      () => this.store.updateProject(projectId, { sourceLocale, targetLocale }),
      projectId,
    )
  }

  reorderActiveProjects(orderedProjectIds: string[]): LinguistProject[] {
    return this.call(() => this.store.reorderActiveProjects(orderedProjectIds))
  }

  /**
   * 归档（元数据操作）。归档后关闭并丢弃缓存句柄——句柄重新打开时
   * 一律只读（fail closed）。
   */
  archiveProject(projectId: string): LinguistProject {
    const project = this.call(() => this.store.archiveProject(projectId), projectId)
    this.closeProject(projectId)
    console.log(`[Linguist] 已归档 CAT 项目: ${project.id}`)
    return project
  }

  /**
   * 可恢复删除：仅已归档项目 + 精确项目名确认；完整目录移入 trash/。
   * Session 绑定不级联删除，后续按既有 missing/fail-closed 语义保持历史可读。
   */
  deleteProject(projectId: string, confirmationName: string): DeleteLinguistProjectResult {
    const project = this.getProject(projectId)
    if (project.archivedAt === undefined) {
      throw new LinguistProjectDeleteRequiresArchiveError(projectId)
    }
    if (confirmationName !== project.name) {
      throw new LinguistProjectDeleteConfirmationMismatchError(projectId)
    }
    this.closeProject(projectId)
    const removed = this.call(() => this.store.deleteProject(projectId), projectId)
    console.log(`[Linguist] 已将 CAT 项目移入可恢复删除区: ${projectId}`)
    return {
      projectId,
      ...(removed.recoveryName !== undefined ? { recoveryName: removed.recoveryName } : {}),
    }
  }

  /** 项目磁盘布局（先校验项目存在）。 */
  getProjectPaths(projectId: string): LinguistProjectPaths {
    this.getProject(projectId)
    return projectPaths(this.rootDir, projectId)
  }

  /**
   * PB-102：只读列出项目 exports/ 目录内容（交付物可发现）。
   * 返回刻意只是展示投影（basename/大小/时间 + 从 staging 文件名解析的
   * assetId），绝不暴露任何文件系统路径（计划 §7.4）。只读操作，
   * 归档项目同样可列。exports/ 尚未创建（从未导出）时返回空列表。
   * 日志纪律：不记录文件名，只记录计数。
   */
  listExportFiles(projectId: string): LinguistExportFileInfo[] {
    const { exportsDir } = this.getProjectPaths(projectId)
    const directory = lstatSync(exportsDir, { throwIfNoEntry: false })
    if (directory === undefined) return []
    if (directory.isSymbolicLink() || !directory.isDirectory()) {
      console.warn(`[Linguist] 项目 ${projectId} exports 目录身份无效，拒绝列出`)
      return []
    }
    let entries: string[]
    try {
      entries = readdirSync(exportsDir)
    } catch {
      // exports/ 不存在（从未导出）= 空交付物列表，正常分支
      return []
    }
    const project = this.getProject(projectId)
    const db = this.openProject(projectId)
    const currentRevision = computeLinguistProjectRevision(project, db)
    const artifacts = new Map(
      db.exports.listByProject().map((artifact) => [artifact.path, artifact]),
    )
    const manifests = readLinguistExportManifests(exportsDir)
    const files: LinguistExportFileInfo[] = []
    for (const name of entries) {
      if (name.startsWith('.') || name.includes('.tmp-')) continue
      const stat = lstatSync(resolve(exportsDir, name), { throwIfNoEntry: false })
      if (stat === undefined || stat.isSymbolicLink() || !stat.isFile()) continue
      // staging 文件名形状：`<assetId>-<sha256:16>-<原文件名>`（export-staging.ts）
      const assetId = /^(ast(?:-[0-9a-f]{16}|_v2_[0-9a-f]{64}))-[0-9a-f]{16}-/.exec(name)?.[1]
      const artifact = artifacts.get(`exports/${name}`)
      const manifest = artifact === undefined
        ? undefined
        : manifests.get(artifact.id)
      const verifiedManifest = manifest !== undefined
        && manifest.assetId === artifact?.assetId
        && manifest.sha256 === artifact.sha256
        && manifest.sizeBytes === stat.size
        ? manifest
        : undefined
      files.push({
        filename: name,
        ...(assetId !== undefined && LINGUIST_ASSET_ID_PATTERN.test(assetId)
          ? { assetId }
          : {}),
        sizeBytes: stat.size,
        modifiedAt: stat.mtimeMs,
        ...(verifiedManifest === undefined
          ? {}
          : {
            sha256: verifiedManifest.sha256,
            createdAt: verifiedManifest.createdAt,
            verifiedAt: verifiedManifest.verifiedAt,
            projectRevision: verifiedManifest.projectRevision,
            stale: verifiedManifest.projectRevision !== currentRevision,
          }),
      })
    }
    // 最新导出在前
    files.sort((a, b) => b.modifiedAt - a.modifiedAt)
    console.log(`[Linguist] 列出项目 ${projectId} 交付物 ${files.length} 件`)
    return files
  }

  /**
   * 打开项目的 cat.db 句柄（按 projectId 缓存；重复调用返回同一句柄）。
   * 归档项目强制只读打开（fail closed），调用方无法覆盖。只读缓存句柄
   * 在收到可写请求时会被关闭并以可写句柄替换（仅未归档项目可能走到）。
   * 调用方负责 closeProject()/closeAll()。
   */
  openProject(projectId: string, options: { readOnly?: boolean } = {}): ProjectDatabase {
    const project = this.getProject(projectId)
    const readOnly = (options.readOnly ?? false) || project.archivedAt !== undefined
    const cached = this.handles.get(projectId)
    if (cached !== undefined) {
      if (cached.readOnly === readOnly) return cached
      cached.close()
      this.handles.delete(projectId)
    }
    const handle = this.call(() => this.store.openProject(projectId, { readOnly }), projectId)
    this.handles.set(projectId, handle)
    return handle
  }

  /** 关闭并移除缓存句柄；未缓存时为空操作。 */
  closeProject(projectId: string): void {
    const handle = this.handles.get(projectId)
    if (handle !== undefined) {
      handle.close()
      this.handles.delete(projectId)
    }
  }

  /** 关闭全部缓存句柄（应用退出前调用）。 */
  closeAll(): void {
    for (const handle of this.handles.values()) {
      try {
        handle.close()
      } catch (err) {
        console.warn('[Linguist] 关闭项目句柄失败（已忽略）:', errorCodeOf(err))
      }
    }
    this.handles.clear()
  }

  /**
   * Quick Health：project.json 可解析、cat.db 可打开、schema 版本匹配、
   * source blob 的 sha256 有界抽样（经 store 的 readAssetSource 校验）。
   * Quick Health 自身绝不抛存储错误——结果体现在报告里；项目不存在仍抛
   * PROJECT_NOT_FOUND。临时只读句柄用毕即关，不复用缓存。
   */
  checkProjectHealth(projectId: string): LinguistProjectHealthReport {
    this.getProject(projectId)
    const checks: LinguistProjectHealthCheck[] = []

    // 1. project.json 在场且可解析
    try {
      this.store.index.readProjectMeta(projectId)
      checks.push({ id: 'project_json', ok: true, scope: 'complete' })
    } catch (err) {
      checks.push({ id: 'project_json', ok: false, scope: 'complete', detail: errorCodeOf(err) })
    }

    // 2+3. cat.db 可打开 & schema 版本匹配（只读打开绝不迁移）
    let db: ProjectDatabase | undefined
    let openError: string | undefined
    try {
      db = this.store.openProject(projectId, { readOnly: true })
      checks.push({ id: 'cat_db_open', ok: true, scope: 'complete' })
      checks.push(
        db.schemaVersion === SCHEMA_VERSION
          ? { id: 'schema_version', ok: true, scope: 'complete', detail: `v${db.schemaVersion}` }
          : {
              id: 'schema_version',
              ok: false,
              scope: 'complete',
              detail: `schema v${db.schemaVersion} != expected v${SCHEMA_VERSION}`,
            },
      )
    } catch (err) {
      openError = errorCodeOf(err)
      checks.push({ id: 'cat_db_open', ok: false, scope: 'complete', detail: openError })
      checks.push({ id: 'schema_version', ok: false, scope: 'complete', detail: openError })
    }

    // 4. source blob 抽查（仅 DB 可开时）
    if (db !== undefined) {
      try {
        const assets = db.assets.listByProject()
        const sample = assets.slice(0, ASSET_SOURCE_SPOT_CHECK_LIMIT)
        let failed = 0
        const failureCodes = new Set<string>()
        for (const asset of sample) {
          try {
            db.readAssetSource(asset.id)
          } catch (err) {
            failed += 1
            failureCodes.add(errorCodeOf(err))
          }
        }
        checks.push(
          failed === 0
            ? {
                id: 'asset_sources',
                ok: true,
                scope: 'sampled',
                checkedItems: sample.length,
                totalItems: assets.length,
                detail: `${sample.length} checked`,
              }
            : {
                id: 'asset_sources',
                ok: false,
                scope: 'sampled',
                checkedItems: sample.length,
                totalItems: assets.length,
                detail: `${failed}/${sample.length} failed (${[...failureCodes].sort().join(', ')})`,
              },
        )
      } finally {
        db.close()
      }
    } else {
      checks.push({
        id: 'asset_sources',
        ok: false,
        scope: 'sampled',
        checkedItems: 0,
        detail: openError ?? 'cat.db unopenable',
      })
    }

    const healthy = checks.every((check) => check.ok)
    console.log(`[Linguist] Quick Health: ${projectId} → ${healthy ? '未发现问题' : '异常'}（${checks.filter((c) => !c.ok).length}/${checks.length} 项失败）`)
    return { kind: 'quick', projectId, healthy, checkedAt: this.now(), checks }
  }

  /**
   * 备份（PB-111，计划 §24）：全量目录备份 backups/backup-<ts>/（cat.db
   * VACUUM INTO + project.json + source/ + blobs/ + manifest），返回
   * 备份名 + 根相对目录 + manifest 摘要。归档项目同样可备份（只读语义）。
   */
  backupProject(projectId: string): LinguistBackupResult {
    this.getProject(projectId)
    const result = this.call(() => this.store.backupProject(projectId), projectId)
    const totalSizeBytes = result.manifest.files.reduce((sum, f) => sum + f.sizeBytes, 0)
    console.log(
      `[Linguist] 已备份 CAT 项目: ${projectId}（${result.method}，${result.manifest.files.length} 文件，${totalSizeBytes} 字节）`,
    )
    return {
      backupName: result.backupName,
      backupDir: toRootRelativePath(this.rootDir, result.backupDir),
      method: result.method,
      fileCount: result.manifest.files.length,
      totalSizeBytes,
      schemaVersion: result.manifest.schemaVersion,
    }
  }

  /** 列出项目备份（PB-111；只读操作，归档项目同样可列；最新在前）。 */
  listBackups(projectId: string): LinguistBackupListItem[] {
    this.getProject(projectId)
    const entries = this.call(() => this.store.listProjectBackups(projectId), projectId)
    console.log(`[Linguist] 列出项目 ${projectId} 备份 ${entries.length} 件`)
    return entries
  }

  /**
   * 恢复预览（PB-111）：backupName 白名单形状（backup-<ts> 目录或 legacy
   * cat-<ts>.db，防目录穿越）→ 新格式跑 verifyBackup + 只读打开备份库跑
   * 摘要查询 + 与当前摘要对比 + schema 版本（旧版标注「恢复后自动迁移」）；
   * legacy 降级为「仅可预览 DB 摘要，不可恢复」。归档项目允许预览。
   */
  previewRestore(projectId: string, backupName: string): LinguistRestorePreview {
    this.getProject(projectId)
    const isLegacy = LEGACY_BACKUP_FILE_PATTERN.test(backupName)
    if (!isLegacy && !BACKUP_DIR_NAME_PATTERN.test(backupName)) {
      throw new StoreNotFoundError('backup', backupName)
    }
    const { backupsDir } = this.getProjectPaths(projectId)
    if (!existsSync(join(backupsDir, backupName))) {
      throw new StoreNotFoundError('backup', backupName)
    }

    let verification: LinguistRestorePreview['verification']
    if (!isLegacy) {
      const report = this.call(
        () => verifyBackup(join(backupsDir, backupName), projectId),
        projectId,
      )
      verification = {
        ok: report.ok,
        ...(report.schemaVersion !== undefined ? { schemaVersion: report.schemaVersion } : {}),
        problems: report.problems,
      }
    }

    // 备份库摘要（只读打开，fail closed；打不开时摘要缺省但不拖垮预览）
    let backupSummary: LinguistBackupSummary | undefined
    let backupSchemaVersion: number | undefined = verification?.schemaVersion
    let backupOpenError: string | undefined
    try {
      const backupDb = this.call(() => this.store.openBackupDatabase(projectId, backupName), projectId)
      try {
        backupSchemaVersion = backupDb.schemaVersion
        backupSummary = this.call(() => this.summarizeHandle(backupDb), projectId)
      } finally {
        backupDb.close()
      }
    } catch (err) {
      backupOpenError = errorCodeOf(err)
    }

    // 当前项目摘要（对比用；当前库异常时缺省）
    let currentSummary: LinguistBackupSummary | undefined
    try {
      const current = this.getProjectSummary(projectId)
      currentSummary = {
        assetCount: current.assetCount,
        totalSegments: current.totalSegments,
        segmentCounts: current.segmentCounts,
        currentStageCounts: current.currentStageCounts,
        assets: current.assets,
      }
    } catch {
      // 当前项目不健康不拖垮预览（对比区单独降级）
    }

    const restorable = !isLegacy && verification?.ok === true
    const willMigrate = backupSchemaVersion !== undefined && backupSchemaVersion < SCHEMA_VERSION
    const notice = isLegacy
      ? '旧格式备份（缺 manifest 与 source/blobs）：仅可预览数据库摘要，不支持恢复'
      : verification?.ok === false
        ? `备份未通过完整性校验（${verification.problems.length} 项问题），不可恢复`
        : backupOpenError !== undefined
          ? `备份数据库无法读取摘要（${backupOpenError}）`
          : willMigrate
            ? '备份由旧版本 schema 生成，恢复后首次打开将自动迁移'
            : undefined
    console.log(`[Linguist] 恢复预览: 项目 ${projectId} 备份 ${isLegacy ? 'legacy' : 'directory'}（restorable=${restorable}）`)
    return {
      backupName,
      format: isLegacy ? 'legacy' : 'directory',
      restorable,
      ...(verification !== undefined ? { verification } : {}),
      ...(backupSummary !== undefined ? { backupSummary } : {}),
      ...(currentSummary !== undefined ? { currentSummary } : {}),
      ...(backupSchemaVersion !== undefined ? { backupSchemaVersion } : {}),
      currentSchemaVersion: SCHEMA_VERSION,
      willMigrate,
      ...(notice !== undefined ? { notice } : {}),
    }
  }

  /**
   * 恢复（PB-111，计划 §24）：归档项目拒绝（PROJECT_ARCHIVED——归档语义
   * 不允许经恢复绕过；恢复后项目元数据以备份的 project.json 为准）。
   * 流程：关闭缓存句柄 → store 整体替换恢复（verify 先行；当前态先快照到
   * backups/pre-restore-<ts>/；失败自动回滚）→ 清缓存重开（旧 schema 在
   * 首次可写打开时自动迁移）→ 返回恢复报告（含快照名）。
   */
  restoreProject(projectId: string, backupName: string): LinguistRestoreResult {
    const project = this.getProject(projectId)
    if (project.archivedAt !== undefined) throw new LinguistProjectArchivedError(projectId)
    this.closeProject(projectId)
    try {
      const result = this.call(() => this.store.restoreProject(projectId, backupName), projectId)
      // 重开：刷新缓存句柄；旧 schema 备份在此自动迁移。
      this.closeProject(projectId)
      const db = this.openProject(projectId)
      console.log(
        `[Linguist] 已恢复 CAT 项目: ${projectId} ← ${backupName}（快照 ${result.preRestoreName}，schema v${db.schemaVersion}）`,
      )
      return {
        backupName,
        preRestoreName: result.preRestoreName,
        schemaVersion: db.schemaVersion,
      }
    } catch (err) {
      // 恢复失败：丢弃可能悬空的缓存句柄，下次访问惰性重开。
      this.closeProject(projectId)
      throw err
    }
  }

  /**
   * 项目摘要（PB-031；PB-033 扩展资产列表）：元数据 + 资产/段计数 + 资产
   * 元数据列表。计数经 store 仓库的 COUNT/GROUP BY（不加载段行）；资产列表
   * 只读资产元数据行（listByProject，不碰段行 / source blob）。复用缓存
   * 句柄（归档项目自动只读）；项目不存在抛 PROJECT_NOT_FOUND，degraded
   * 模式抛 STORE_SQLITE_UNAVAILABLE（穿透）。
   */
  getProjectSummary(projectId: string): LinguistProjectSummary {
    const project = this.getProject(projectId)
    const db = this.openProject(projectId)
    return { project, ...this.summarizeHandle(db) }
  }

  /**
   * 句柄摘要（PB-031 计数 + PB-033 资产列表）：廉价 COUNT/GROUP BY +
   * 资产元数据行（不加载段行 / source blob）。getProjectSummary 与
   * PB-111 恢复预览（对备份库句柄重跑）共用。
   */
  private summarizeHandle(db: ProjectDatabase): LinguistBackupSummary {
    const assetCount = this.call(() => db.assets.countByProject(), db.projectId)
    const segmentCounts = this.call(() => db.segments.countByStatus(), db.projectId)
    const currentStageCounts = this.call(
      () => db.segments.countByCurrentStageState(),
      db.projectId,
    )
    const assetRows = this.call(() => db.assets.listByProject(), db.projectId)
    const segmentCountsByAsset = this.call(() => db.segments.countByAssetAndStatus(), db.projectId)
    const currentStageCountsByAsset = this.call(
      () => db.segments.countByAssetAndCurrentStageState(),
      db.projectId,
    )
    const openQaCountsByAsset = this.call(() => db.qaFindings.countOpenByAsset(), db.projectId)
    const totalSegments =
      segmentCounts.untranslated + segmentCounts.draft + segmentCounts.translated + segmentCounts.reviewed
    const assets = assetRows.map((asset) => {
      const assetId = asset.id as string
      return {
        assetId,
        filename: asset.originalFilename,
        formatId: asset.formatId,
        segmentCount: asset.segmentCount,
        sourceSha256: asset.sourceSha256,
        segmentCounts: segmentCountsByAsset.get(assetId) ?? {
          untranslated: 0,
          draft: 0,
          translated: 0,
          reviewed: 0,
        },
        currentStageCounts: currentStageCountsByAsset.get(assetId) ?? {
          untouched: 0,
          draft: 0,
          confirmed: 0,
        },
        openQaCount: openQaCountsByAsset.get(assetId) ?? 0,
      }
    })
    return { assetCount, totalSegments, segmentCounts, currentStageCounts, assets }
  }

  /** PB-080：所有 reference 写入共享的归档前置守卫。 */
  assertProjectWritable(projectId: string): void {
    const project = this.getProject(projectId)
    if (project.archivedAt !== undefined) throw new LinguistProjectArchivedError(projectId)
  }

  /** 更新项目当前任务阶段；阶段变化后按审计记录重建每条句段的本轮状态。 */
  setWorkflowConfig(
    projectId: string,
    workflowStage: WorkflowStage,
    outputStatusPolicy?: WorkflowOutputStatusPolicy | null,
    qaProfile?: QaProfile,
  ): LinguistProject {
    this.assertProjectWritable(projectId)
    const previousStage = this.getProject(projectId).workflowStage ?? 'translation'
    const db = this.openProject(projectId)
    this.call(() => db.segments.rebaseCurrentStage(workflowStage), projectId)
    let updated: LinguistProject
    try {
      updated = this.call(
        () => this.store.index.setWorkflowConfig(projectId, {
          workflowStage,
          ...(outputStatusPolicy !== undefined ? { outputStatusPolicy } : {}),
          ...(qaProfile !== undefined ? { qaProfile } : {}),
        }),
        projectId,
      )
    } catch (error) {
      this.call(() => db.segments.rebaseCurrentStage(previousStage), projectId)
      throw error
    }
    console.log(`[Linguist] 已设置项目任务阶段: 项目 ${projectId} → ${workflowStage}`)
    return updated
  }

  private tagSamples(projectId: string) {
    const db = this.openProject(projectId)
    const total = this.call(() => db.segments.count(), projectId)
    return this.call(
      () => db.segments.query({ limit: total }).map((segment) => ({
        id: segment.id as string,
        source: segment.source,
        target: segment.target,
      })),
      projectId,
    )
  }

  scanUnknownTagPatterns(projectId: string, assetIds?: readonly string[], sampleLimit = 3) {
    const project = this.getProject(projectId)
    const db = this.openProject(projectId)
    const assets = assetIds === undefined ? undefined : new Set(assetIds)
    if (assets !== undefined) {
      for (const assetId of assets) {
        if (db.assets.get(assetId) === undefined) throw new StoreNotFoundError('asset', assetId)
      }
    }
    return scanUnknownTagPatterns(
      this.tagSamples(projectId).filter((sample) => {
        if (assets === undefined) return true
        const segment = db.segments.getById(sample.id)
        return segment !== undefined && assets.has(segment.assetId as string)
      }),
      project.tagProfile,
      sampleLimit,
    )
  }

  saveTagProfileCandidate(
    projectId: string,
    input: SaveTagProfileCandidateInput,
    replaceId?: string,
    activate = false,
  ): LinguistTagProfileMutationResult {
    this.assertProjectWritable(projectId)
    const project = this.getProject(projectId)
    const samples = this.tagSamples(projectId)
    const discoveries = scanUnknownTagPatterns(samples, project.tagProfile, Number.MAX_SAFE_INTEGER)
    const examples = discoveries.flatMap((item) => item.examples)
    const wanted = new Set(input.evidenceExampleIds)
    const evidence = examples.filter((example) => wanted.has(example.id))
    const validation = validateTagProfileCandidate(input, evidence, samples, project.tagProfile)
    if (!validation.saveable) throw new Error(validation.errors.join('；'))
    if (activate && !validation.activationReady) {
      throw new Error([...validation.errors, ...validation.warnings].join('；'))
    }
    const baseProfile = replaceId === undefined || project.tagProfile === undefined
      ? project.tagProfile
      : {
          ...project.tagProfile,
          candidates: project.tagProfile.candidates?.filter((item) => item.id !== replaceId),
        }
    const saved = saveTagCandidate(baseProfile, input)
    const tagProfile = activate
      ? activateTagProfileCandidate(saved.profile, saved.candidate.id)
      : saved.profile
    const updated = this.call(
      () => this.store.index.setTagProfile(projectId, tagProfile),
      projectId,
    )
    return { project: updated, tagProfile, candidate: saved.candidate, validation }
  }

  updateTagProfile(
    projectId: string,
    entryId: string,
    action: 'activate' | 'ignore' | 'enable' | 'disable',
  ): LinguistTagProfileMutationResult {
    this.assertProjectWritable(projectId)
    const project = this.getProject(projectId)
    const profile = project.tagProfile ?? { families: [] }
    if (action === 'activate') {
      const candidate = profile.candidates?.find((item) => item.id === entryId)
      if (!candidate) throw new Error(`Tag Profile candidate not found: ${entryId}`)
      // 激活前必须在当前项目数据上重跑验证，不信任旧 UI 状态。
      const samples = this.tagSamples(projectId)
      const discoveries = scanUnknownTagPatterns(samples, project.tagProfile, Number.MAX_SAFE_INTEGER)
      const examples = discoveries.flatMap((item) => item.examples)
      const wanted = new Set(candidate.evidenceExampleIds)
      const validation = validateTagProfileCandidate({
        name: candidate.name,
        regex: candidate.pattern,
        kind: candidate.kind,
        ...(candidate.pairKey ? { pairKey: candidate.pairKey } : {}),
        evidenceExampleIds: candidate.evidenceExampleIds,
        confidence: candidate.confidence,
        explanation: candidate.explanation,
      }, examples.filter((item) => wanted.has(item.id)), samples, project.tagProfile)
      if (!validation.activationReady) {
        throw new Error([...validation.errors, ...validation.warnings].join('；'))
      }
      const tagProfile = activateTagProfileCandidate(profile, entryId)
      const updated = this.call(() => this.store.index.setTagProfile(projectId, tagProfile), projectId)
      return { project: updated, tagProfile, validation }
    }
    const tagProfile = updateTagProfileEntry(profile, entryId, action)
    const updated = this.call(() => this.store.index.setTagProfile(projectId, tagProfile), projectId)
    return { project: updated, tagProfile }
  }

  /** TM 管理列表仍保留 source/target literal concordance 语义。 */
  queryTmReferences(
    projectId: string,
    query: ReferenceQuery,
  ): ReferenceImportQueryPage<TmReferenceInfo> {
    return this.resources.queryTmReferences(projectId, query)
  }

  queryTermReferences(
    projectId: string,
    query: ReferenceQuery,
  ): ReferenceImportQueryPage<TermReferenceInfo> {
    return this.resources.queryTermReferences(projectId, query)
  }

  importReference(
    projectId: string,
    kind: LinguistReferenceKind,
    input: ImportReferenceInput,
  ): Promise<ImportReferenceResult> {
    return this.resources.importReference(projectId, kind, input)
  }

  upsertTermReference(
    projectId: string,
    input: TermEntryUpsertInput,
  ): TermReferenceInfo {
    return this.resources.upsertTermReference(projectId, input)
  }

  upsertTermReferences(projectId: string, inputs: readonly TermEntryUpsertInput[]) {
    return this.resources.upsertTermReferences(projectId, inputs)
  }

  deleteTermReferences(projectId: string, ids: readonly string[]): void {
    this.resources.deleteTermReferences(projectId, ids)
  }

  listTermConflicts(
    projectId: string,
    options: Parameters<ProjectResources['listTermConflicts']>[1],
  ) {
    return this.resources.listTermConflicts(projectId, options)
  }

  validateTerms(projectId: string, segmentIds: readonly string[]) {
    return this.resources.validateTerms(projectId, segmentIds)
  }

  deleteReference(
    projectId: string,
    kind: LinguistReferenceKind,
    id: string,
  ): void {
    this.resources.deleteReference(projectId, kind, id)
  }

  queryProjectAssets(
    projectId: string,
    kind: LinguistProjectAssetKind,
    query: ProjectAssetsQuery,
  ): ReferenceQueryPage<ProjectAssetInfo> {
    return this.resources.queryProjectAssets(projectId, kind, query)
  }

  upsertProjectAsset(
    projectId: string,
    kind: 'styleGuideRules',
    item: StyleGuideRuleUpsertInput,
  ): StyleGuideRule
  upsertProjectAsset(
    projectId: string,
    kind: 'sentencePatterns',
    item: SentencePatternUpsertInput,
  ): SentencePattern
  upsertProjectAsset(
    projectId: string,
    kind: 'contextDocs',
    item: { id: string; note?: string },
  ): ContextDoc
  upsertProjectAsset(
    projectId: string,
    kind: 'techConstraints',
    item: TechConstraintUpsertInput,
  ): TechConstraint
  upsertProjectAsset(
    projectId: string,
    kind: 'voiceProfiles',
    item: VoiceProfileUpsertInput,
  ): VoiceProfile
  upsertProjectAsset(
    projectId: string,
    kind: LinguistProjectAssetKind,
    item:
      | StyleGuideRuleUpsertInput
      | SentencePatternUpsertInput
      | { id: string; note?: string }
      | TechConstraintUpsertInput
      | VoiceProfileUpsertInput,
  ): ProjectAssetInfo {
    return this.resources.upsertProjectAsset(projectId, kind, item)
  }

  deleteProjectAsset(
    projectId: string,
    kind: LinguistProjectAssetKind,
    id: string,
  ): void {
    this.resources.deleteProjectAsset(projectId, kind, id)
  }

  resolveContextDocBlobPath(
    projectId: string,
    blobRelpath: string,
  ): string | undefined {
    return this.resources.resolveContextDocBlobPath(
      projectId,
      blobRelpath,
    )
  }

  resolveAssetSourcePath(
    projectId: string,
    assetId: string,
  ): { sourcePath: string; originalFilename: string } {
    return this.resources.resolveAssetSourcePath(projectId, assetId)
  }

  resolveReferenceImportPreviewPath(
    projectId: string,
    importId: string,
  ): { sourcePath: string; originalFilename: string } {
    return this.resources.resolveReferenceImportPreviewPath(projectId, importId)
  }

  resolveContextDocPreviewPath(
    projectId: string,
    docId: string,
  ): { sourcePath: string; originalFilename: string } {
    return this.resources.resolveContextDocPreviewPath(projectId, docId)
  }

  importContextDoc(
    projectId: string,
    input: ImportContextDocInput,
  ): Promise<ContextDoc> {
    return this.resources.importContextDoc(projectId, input)
  }

  importSentencePatterns(
    projectId: string,
    input: ImportReferenceInput,
  ): ImportReferenceResult {
    return this.resources.importSentencePatterns(projectId, input)
  }

  queryCatWorkspace(
    projectId: string,
    query: CatWorkspaceQuery,
  ): CatWorkspacePage {
    return this.quality.queryCatWorkspace(projectId, query)
  }

  getSegmentContext(
    projectId: string,
    segmentId: string,
  ): CatSegmentContext {
    return this.quality.getSegmentContext(projectId, segmentId)
  }

  runQa(projectId: string): CatQaFinding[] {
    return this.quality.runQa(projectId)
  }

  listQaFindings(
    projectId: string,
    filter: {
      segmentId?: string
      code?: string
      status?: 'open' | 'resolved' | 'waived'
      severity?: QaFindingSeverity
      disposition?: QaFindingDisposition
      limit?: number
      offset?: number
    } = {},
  ): { items: CatQaFinding[]; total: number } {
    return this.quality.listQaFindings(projectId, filter)
  }

  resolveQaFinding(
    projectId: string,
    findingId: string,
  ): CatQaFinding {
    return this.quality.resolveQaFinding(projectId, findingId)
  }

  waiveQaFinding(
    projectId: string,
    findingId: string,
    reason: string,
    operator: string,
  ): CatQaFinding {
    return this.quality.waiveQaFinding(
      projectId,
      findingId,
      reason,
      operator,
    )
  }

  waiveQaFindings(
    projectId: string,
    findingIds: readonly string[],
    reason: string,
    operator: string,
  ): CatQaFinding[] {
    return this.quality.waiveQaFindings(
      projectId,
      findingIds,
      reason,
      operator,
    )
  }

  prepareDelivery(
    projectId: string,
    assetId: string,
  ): Promise<LinguistPreparedDelivery> {
    return this.delivery.prepareDelivery(projectId, assetId)
  }

  exportAssetToPath(
    projectId: string,
    assetId: string,
    destinationPath: string,
    mode: 'verified' | 'as-is',
    overwrite: boolean,
  ) {
    return this.delivery.exportAssetToPath(
      projectId,
      assetId,
      destinationPath,
      mode,
      overwrite,
    )
  }

  stageExport(
    projectId: string,
    assetId: string,
  ): Promise<LinguistStagedExport> {
    return this.delivery.stageExport(projectId, assetId)
  }

  stageDraftExport(
    projectId: string,
    assetId: string,
  ): Promise<LinguistStagedExport> {
    return this.delivery.stageExport(projectId, assetId, {
      allowBlockingQa: true,
      allowHardRuleViolations: true,
    })
  }

  editSegment(
    projectId: string,
    segmentId: string,
    target: string,
    expectedRevision: number,
  ): Segment {
    return this.quality.editSegment(
      projectId,
      segmentId,
      target,
      expectedRevision,
    )
  }

  confirmCurrentStage(
    projectId: string,
    segmentId: string,
    expectedRevision: number,
  ): Segment {
    return this.quality.confirmCurrentStage(
      projectId,
      segmentId,
      expectedRevision,
    )
  }

  unconfirmCurrentStage(
    projectId: string,
    segmentId: string,
    expectedRevision: number,
  ): Segment {
    return this.quality.unconfirmCurrentStage(
      projectId,
      segmentId,
      expectedRevision,
    )
  }

  confirmCurrentStageBulk(
    projectId: string,
    items: readonly StageMutationItem[],
  ): StageMutationBatchResult {
    return this.quality.confirmCurrentStageBulk(projectId, items)
  }

  importAsset(
    projectId: string,
    input: ImportAssetInput,
  ): Promise<ImportAssetResult> {
    return this.delivery.importAsset(projectId, input)
  }

  previewWorkbookMapping(
    projectId: string,
    cwd: string,
    filePath: string,
  ): Promise<LinguistWorkbookMappingPreview> {
    return previewProjectWorkbookMapping(this.getProject(projectId), cwd, filePath)
  }

  async saveWorkbookMapping(
    projectId: string,
    cwd: string,
    filePath: string,
    input: LinguistSaveWorkbookMappingInput,
  ): Promise<LinguistWorkbookMappingProfile> {
    this.assertProjectWritable(projectId)
    const project = this.getProject(projectId)
    const profile = await createProjectWorkbookMappingProfile(
      project,
      cwd,
      filePath,
      input,
      this.now(),
    )
    const profiles = [
      ...(project.workbookMappings ?? []).filter((candidate) => candidate.id !== profile.id),
      profile,
    ]
    this.call(() => this.store.setWorkbookMappings(projectId, profiles), projectId)
    return profile
  }

  resolveWorkbookMapping(
    projectId: string,
    bytes: Uint8Array,
    filename: string,
  ): Promise<LinguistIntakeXlsxMapping | undefined> {
    return resolveProjectWorkbookMapping(this.getProject(projectId), bytes, filename)
  }

  importFileResource(
    projectId: string,
    cwd: string,
    filePath: string,
    resourceKind: LinguistIntakeResourceKind,
    xlsxMapping?: LinguistIntakeXlsxMapping,
  ): Promise<LinguistIntakeImportResult> {
    return importProjectFile(this, projectId, cwd, filePath, resourceKind, xlsxMapping)
  }

  importResourcesFromPaths(
    projectId: string,
    cwd: string,
    input: LinguistImportResourcesInput,
  ): Promise<LinguistImportResourcesResult> {
    return importProjectResources(this, projectId, cwd, input)
  }

  /** LA-INTAKE-007：撤销一次导入（无下游引用才允许；归档 fail closed）。 */
  undoImportAsset(projectId: string, assetId: string): UndoImportAssetResult {
    return this.delivery.undoImportAsset(projectId, assetId)
  }

  /** 同步 store 调用的错误映射包装。 */
  private call<T>(fn: () => T, projectId?: string): T {
    try {
      return fn()
    } catch (err) {
      throw mapStoreError(err, projectId)
    }
  }
}

// ===== 单例（house 风格：模块级实例 + 显式 init，见 feishuBridgeManager 等） =====

let instance: LinguistProjectService | undefined

/**
 * 初始化并返回服务单例（幂等）。rootDir 缺省解析为
 * join(getConfigDir(), 'linguist')（USERDATA_LAYOUT.md §3）。
 * IPC 注册属 PB-031，本票只接线实例化。
 */
export function initLinguistProjectService(
  options: Partial<LinguistProjectServiceOptions> = {},
): LinguistProjectService {
  if (instance !== undefined) return instance
  const rootDir = options.rootDir ?? resolveLinguistRootDir(getConfigDir())
  instance = new LinguistProjectService({ ...options, rootDir })
  instance.init()
  return instance
}

export function getLinguistProjectService(): LinguistProjectService {
  if (instance === undefined) {
    throw new Error('[Linguist] LinguistProjectService 尚未初始化（initLinguistProjectService 未运行）')
  }
  return instance
}

/** 退出前关闭全部缓存的项目 DB 句柄；未初始化时为空操作。 */
export function closeAllLinguistProjectHandles(): void {
  instance?.closeAll()
}
