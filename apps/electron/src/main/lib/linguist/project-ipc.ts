/**
 * Linguist 项目 typed IPC 处理器（PB-031；计划 §4.1/§7.2/§7.4）。
 *
 * 本模块实现项目域通道的全部逻辑（校验 → 服务调用 → 结果信封；PB-082 起
 * 含 setQualityProfile 共 7 个），
 * 刻意不 import electron：ipc.ts 以薄适配器注册（注入 picker），
 * node --test 直接驱动本模块（stub picker + 真实服务 + fixture 文件）。
 *
 * 契约要点（packages/shared/src/types/linguist.ts）：
 * - 全部通道返回 LinguistIpcResult<T> 信封，绝不抛出。理由：Electron 的
 *   ipcRenderer.invoke 会把 handler 抛出的错误包装成
 *   "Error invoking remote method ..." 并丢弃自定义 code 属性，而稳定
 *   机器可读错误码是计划 §7.4 的硬规则（与 house 既有「直返 + throw」
 *   惯例不同，属刻意选择）。
 * - 已知类型化错误（LinguistServiceError 四码 + STORE_*、FORMAT_*、domain
 *   穿透 + INVALID_INPUT）透传其稳定 code 与 message；未知错误一律收敛为
 *   INTERNAL + 通用文案（不泄露 stack / 内部文本；主进程日志同样只记
 *   name/code，不记客户文本）。
 * - 导入通道：主进程原生文件选择器（picker 由 ipc.ts 注入），选中后主
 *   进程自行读盘（大小护栏与服务一致 50MB），bytes 交给服务；
 *   renderer 永不提交路径/字节。用户取消返回 {cancelled: true}（正常
 *   分支，非错误）。
 *
 * 日志纪律（计划 §7.4）：只记通道名 / 错误码 / 计数，绝不记文件名、
 * 路径、源文、译文。
 */

import { readFileSync, statSync } from 'node:fs'
import { basename, extname } from 'node:path'
import {
  normalizeQaProfile,
  normalizeQualityProfile,
  normalizeWorkflowStage,
  type LinguistProject,
} from '@linguist/cat-core'
import {
  LINGUIST_ASSET_ID_PATTERN,
  LINGUIST_BACKUP_DIR_NAME_PATTERN,
  LINGUIST_IMPORT_FILE_EXTENSIONS,
  LINGUIST_IMPORT_MAX_BYTES,
  LINGUIST_LEGACY_BACKUP_NAME_PATTERN,
  LINGUIST_LOCALE_MAX_LENGTH,
  LINGUIST_LOCALE_PATTERN,
  LINGUIST_PROJECT_NAME_MAX_LENGTH,
  LINGUIST_QA_PROFILES,
  LINGUIST_QUALITY_PROFILES,
  LINGUIST_WORKSPACE_ID_MAX_LENGTH,
  LINGUIST_WORKFLOW_STAGES,
  type LinguistAssetPreviewResult,
  type LinguistBackupListResult,
  type LinguistIpcResult,
  type LinguistProjectArchiveResult,
  type LinguistProjectBackupResult,
  type LinguistProjectCreateResult,
  type LinguistProjectDeleteResult,
  type LinguistProjectImportResult,
  type LinguistProjectInfo,
  type LinguistProjectListResult,
  type LinguistProjectOpenResult,
  type LinguistProjectRenameResult,
  type LinguistProjectReorderResult,
  type LinguistProjectRestoreResult,
  type LinguistProjectSetQualityProfileResult,
  type LinguistProjectSetWorkflowConfigResult,
  type LinguistQaProfile,
  type LinguistProjectSummary,
  type LinguistQualityProfile,
  type LinguistWorkflowOutputStatusPolicy,
  type LinguistWorkflowStage,
  type LinguistRestorePreviewResult,
} from '@proma/shared'
import { LinguistImportTooLargeError, LinguistProjectArchivedError } from './errors'
import { assertRecord, invalid, readProjectId, wrap } from './ipc-envelope'
import type { LinguistProjectService } from './project-service'

// ===== picker 抽象（electron dialog 的最小镜像；ipc.ts 注入真实实现）=====

export interface LinguistImportPickerOptions {
  title: string
  /** 显式 openFile（Electron 默认亦是；写明防回归）。 */
  properties?: Array<'openFile'>
  filters: { name: string; extensions: string[] }[]
}

export interface LinguistImportPickerResult {
  canceled: boolean
  filePaths: string[]
}

export type LinguistImportFilePicker = (
  options: LinguistImportPickerOptions,
) => Promise<LinguistImportPickerResult>

/** 惰性解析服务单例：注册 IPC 时服务可能尚未 init（index.ts bootstrap 顺序）。 */
export interface LinguistProjectIpcDeps {
  getService: () => LinguistProjectService
  /**
   * PB-089 资产源文件预览的转换栈（生产 = file-preview-service 的三个函数
   * + registerPromaFilePath，ipc.ts 惰性注入；nodetest 注入 fake）。可选
   * 仅为兼容既有构造点；缺失时 previewAssetSource 以 INTERNAL 降级。
   */
  assetPreview?: LinguistAssetPreviewDeps
}

/**
 * PB-089 预览转换依赖（全部以「主进程内部解析的绝对路径」为入参，
 * renderer 路径永不进入——与 file:* 旧通道的纪律分界）。
 */
export interface LinguistAssetPreviewDeps {
  /** 文本类直读（50MB 上限；null = 读取失败/超限）。 */
  readText: (filePath: string) => Promise<{ content: string } | null>
  /** docx → HTML（null = 转换失败）。 */
  convertDocxToHtml: (filePath: string) => Promise<{ html: string } | null>
  /** xlsx → HTML + 提取纯文本（null = 转换失败）。 */
  convertOfficeToHtml: (filePath: string) => Promise<{ html: string; text: string } | null>
  /** 已围栏的绝对路径 → proma-file:// 不透明 token URL。 */
  registerPreviewUrl: (absPath: string) => string
}

/** PB-089：文本类直读扩展名（CAT 导入白名单中的非 Office 成员）。 */
const PREVIEW_TEXT_EXTENSIONS = new Set(['xliff', 'xlf', 'mqxliff', 'sdlxliff', 'mxliff', 'csv', 'tsv', 'json'])

/** PB-089：text 态截断护栏（对齐 context doc text_extract 的 200k 字符纪律）。 */
const PREVIEW_TEXT_MAX_CHARS = 200_000

// ===== 输入校验（计划 §7.4：renderer 不可信，主进程自行校验一切入参）=====
// 信封/通用校验件（invalid / assertRecord / readProjectId / wrap / toIpcError）
// 已提取至 ./ipc-envelope.ts（PB-034），此处仅保留项目域专用校验。

function readLocale(record: Record<string, unknown>, field: 'sourceLocale' | 'targetLocale'): string {
  const value = record[field]
  if (
    typeof value !== 'string' ||
    value.length > LINGUIST_LOCALE_MAX_LENGTH ||
    !LINGUIST_LOCALE_PATTERN.test(value)
  ) {
    invalid(`${field} must be a BCP-47-shaped locale tag`)
  }
  return value
}

function readProjectName(record: Record<string, unknown>): string {
  const value = record.name
  if (
    typeof value !== 'string' ||
    value.trim().length === 0 ||
    value.length > LINGUIST_PROJECT_NAME_MAX_LENGTH
  ) {
    invalid(`name must be a non-blank string of at most ${LINGUIST_PROJECT_NAME_MAX_LENGTH} characters`)
  }
  return value
}

function readDeleteConfirmation(record: Record<string, unknown>): string {
  const value = record.confirmationName
  if (typeof value !== 'string' || value.length > LINGUIST_PROJECT_NAME_MAX_LENGTH) {
    invalid(`confirmationName must be a string of at most ${LINGUIST_PROJECT_NAME_MAX_LENGTH} characters`)
  }
  return value
}

function readOptionalWorkspaceId(record: Record<string, unknown>): string | undefined {
  const value = record.promaWorkspaceId
  if (value === undefined) return undefined
  if (typeof value !== 'string' || value.length === 0 || value.length > LINGUIST_WORKSPACE_ID_MAX_LENGTH) {
    invalid(`promaWorkspaceId must be a string of at most ${LINGUIST_WORKSPACE_ID_MAX_LENGTH} characters`)
  }
  return value
}

/** PB-082：质量策略档严格校验（只接受三档字面量；不做兜底规范化——那是 store 读取路径的职责）。 */
function readQualityProfile(record: Record<string, unknown>): LinguistQualityProfile {
  const value = record.profile
  if (typeof value !== 'string' || !(LINGUIST_QUALITY_PROFILES as readonly string[]).includes(value)) {
    invalid(`profile must be one of: ${LINGUIST_QUALITY_PROFILES.join(', ')}`)
  }
  return value as LinguistQualityProfile
}

function readWorkflowStage(
  record: Record<string, unknown>,
  optional = false,
): LinguistWorkflowStage {
  const value = record.workflowStage
  if (optional && value === undefined) return 'translation'
  if (
    typeof value !== 'string'
    || !(LINGUIST_WORKFLOW_STAGES as readonly string[]).includes(value)
  ) {
    invalid(`workflowStage must be one of: ${LINGUIST_WORKFLOW_STAGES.join(', ')}`)
  }
  return value as LinguistWorkflowStage
}

function readQaProfile(
  record: Record<string, unknown>,
  optional = false,
): LinguistQaProfile | undefined {
  const value = record.qaProfile
  if (optional && value === undefined) return undefined
  if (
    typeof value !== 'string'
    || !(LINGUIST_QA_PROFILES as readonly string[]).includes(value)
  ) {
    invalid(`qaProfile must be one of: ${LINGUIST_QA_PROFILES.join(', ')}`)
  }
  return value as LinguistQaProfile
}

function readOutputStatusPolicy(
  record: Record<string, unknown>,
  allowNull: boolean,
): LinguistWorkflowOutputStatusPolicy | null | undefined {
  const value = record.outputStatusPolicy
  if (value === undefined) return undefined
  if (value === null && allowNull) return null
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    invalid('outputStatusPolicy must be an object')
  }
  const normalized: LinguistWorkflowOutputStatusPolicy = {}
  for (const [formatId, stageValues] of Object.entries(value as Record<string, unknown>)) {
    if (formatId.length === 0 || formatId.length > 64) invalid('outputStatusPolicy format id is invalid')
    if (typeof stageValues !== 'object' || stageValues === null || Array.isArray(stageValues)) {
      invalid('outputStatusPolicy format value must be an object')
    }
    const stages: Partial<Record<LinguistWorkflowStage, string>> = {}
    for (const [stage, status] of Object.entries(stageValues as Record<string, unknown>)) {
      if (!(LINGUIST_WORKFLOW_STAGES as readonly string[]).includes(stage)) {
        invalid('outputStatusPolicy contains an unknown workflow stage')
      }
      if (typeof status !== 'string' || status.trim().length === 0 || status.length > 64) {
        invalid('outputStatusPolicy native status must be a non-blank string')
      }
      stages[stage as LinguistWorkflowStage] = status
    }
    normalized[formatId] = stages
  }
  return normalized
}

/**
 * PB-111：backupName 白名单形状校验（backup-<safeTs> 目录或 legacy
 * cat-<safeTs>.db）——目录穿越防线的第一道（服务层/store 层另有同样的
 * 形状校验 + 存在性检查）。
 */
function readBackupName(record: Record<string, unknown>): string {
  const value = record.backupName
  if (
    typeof value !== 'string' ||
    (!LINGUIST_BACKUP_DIR_NAME_PATTERN.test(value) && !LINGUIST_LEGACY_BACKUP_NAME_PATTERN.test(value))
  ) {
    invalid('backupName must match backup-<timestamp> or legacy cat-<timestamp>.db')
  }
  return value
}

/**
 * PB-089：CAT 资产 Stable ID 严格校验（与 PB-095 的 sgr/spn/…
 * 项目资产 id 区分——本通道只接受 CAT 导入资产）。
 */
function readCatAssetId(record: Record<string, unknown>): string {
  const value = record.assetId
  if (typeof value !== 'string' || !LINGUIST_ASSET_ID_PATTERN.test(value)) {
    invalid('assetId must be a valid Stable ID')
  }
  return value
}

/**
 * 领域项目 → 线格式镜像（PB-082）：wire 契约要求 qualityProfile 必有值，
 * 领域类型该字段可选（旧 project.json 前向兼容）——在 IPC 边界做最后一道
 * 规范化（store 读取路径已先行规范化，此处双保险，保证类型与线上一致）。
 */
function toProjectInfo(project: LinguistProject): LinguistProjectInfo {
  return {
    ...project,
    qualityProfile: normalizeQualityProfile(project.qualityProfile),
    workflowStage: normalizeWorkflowStage(project.workflowStage),
    qaProfile: normalizeQaProfile(project.qaProfile),
  }
}

// ===== 处理器工厂 =====

export function createLinguistProjectIpc(deps: LinguistProjectIpcDeps) {
  const { getService, assetPreview } = deps

  return {
    /** linguist.projects.list — 列出项目（可选含已归档）。 */
    list(input: unknown): Promise<LinguistIpcResult<LinguistProjectListResult>> {
      return wrap(() => {
        const record = input === undefined ? {} : assertRecord(input)
        const includeArchived = record.includeArchived
        if (includeArchived !== undefined && typeof includeArchived !== 'boolean') {
          invalid('includeArchived must be a boolean')
        }
        return getService().listProjects({ includeArchived }).map(toProjectInfo)
      })
    },

    /** linguist.projects.create — 创建项目（name/locale 严格校验）。 */
    create(input: unknown): Promise<LinguistIpcResult<LinguistProjectCreateResult>> {
      return wrap(() => {
        const record = assertRecord(input)
        const name = readProjectName(record)
        const sourceLocale = readLocale(record, 'sourceLocale')
        const targetLocale = readLocale(record, 'targetLocale')
        const promaWorkspaceId = readOptionalWorkspaceId(record)
        const workflowStage = readWorkflowStage(record, true)
        const qaProfile = readQaProfile(record, true)
        const outputStatusPolicy = readOutputStatusPolicy(record, false)
        return toProjectInfo(getService().createProject({
          name,
          sourceLocale,
          targetLocale,
          workflowStage,
          ...(qaProfile !== undefined ? { qaProfile } : {}),
          ...(promaWorkspaceId !== undefined ? { promaWorkspaceId } : {}),
          ...(outputStatusPolicy !== undefined && outputStatusPolicy !== null
            ? { outputStatusPolicy }
            : {}),
        }))
      })
    },

    /** linguist.projects.rename — 复用创建项目的名称校验。 */
    rename(input: unknown): Promise<LinguistIpcResult<LinguistProjectRenameResult>> {
      return wrap(() => {
        const record = assertRecord(input)
        return toProjectInfo(getService().renameProject(
          readProjectId(record),
          readProjectName(record),
        ))
      })
    },

    /** linguist.projects.reorderActive — 必须提交完整且无重复的活跃项目集合。 */
    reorderActive(input: unknown): Promise<LinguistIpcResult<LinguistProjectReorderResult>> {
      return wrap(() => {
        const record = assertRecord(input)
        if (!Array.isArray(record.orderedProjectIds)) {
          invalid('orderedProjectIds must be an array')
        }
        const orderedProjectIds = record.orderedProjectIds.map((projectId) =>
          readProjectId({ projectId }),
        )
        return getService().reorderActiveProjects(orderedProjectIds).map(toProjectInfo)
      })
    },

    /**
     * linguist.projects.open — 打开项目 DB 句柄（缓存；归档强制只读），
     * 返回元数据 + 健康报告。UI 导航属 renderer，不在本通道语义内。
     */
    open(input: unknown): Promise<LinguistIpcResult<LinguistProjectOpenResult>> {
      return wrap(() => {
        const projectId = readProjectId(assertRecord(input))
        const service = getService()
        service.openProject(projectId)
        return {
          project: toProjectInfo(service.getProject(projectId)),
          health: service.checkProjectHealth(projectId),
        }
      })
    },

    /**
     * linguist.projects.import — 原生文件选择器导入流程：
     * 项目存在/未归档前置校验（避免无谓弹窗）→ picker → 主进程读盘
     * （大小护栏 50MB，先于读盘）→ importAsset(bytes, basename)，同源字节重复则跳过。
     * renderer 永不接触路径/字节；取消返回 {cancelled: true}。
     */
    async import(
      input: unknown,
      pickFile: LinguistImportFilePicker,
    ): Promise<LinguistIpcResult<LinguistProjectImportResult>> {
      return wrap(async () => {
        const projectId = readProjectId(assertRecord(input))
        const service = getService()
        const project = service.getProject(projectId)
        if (project.archivedAt !== undefined) {
          throw new LinguistProjectArchivedError(projectId)
        }

        const picked = await pickFile({
          title: '导入翻译资产',
          properties: ['openFile'],
          filters: [
            {
              name: '翻译资产 (XLIFF / SDLXLIFF / MXLIFF / DOCX / CSV / TSV / JSON / XLSX)',
              extensions: [...LINGUIST_IMPORT_FILE_EXTENSIONS],
            },
          ],
        })
        if (picked.canceled || picked.filePaths.length === 0) {
          return { cancelled: true }
        }

        const filePath = picked.filePaths[0] as string
        // 大小护栏：先于读盘（服务层对 bytes 还有一道同样的护栏）。
        const sizeBytes = statSync(filePath).size
        if (sizeBytes > LINGUIST_IMPORT_MAX_BYTES) {
          throw new LinguistImportTooLargeError(sizeBytes, LINGUIST_IMPORT_MAX_BYTES)
        }
        const bytes = new Uint8Array(readFileSync(filePath))
        const filename = basename(filePath)

        const result = await service.importAsset(projectId, { bytes, filename })
        console.log(
          result.status === 'skipped-duplicate'
            ? `[Linguist IPC] 已跳过重复资产: 项目 ${projectId} 资产 ${result.assetId}`
            : `[Linguist IPC] 导入完成: 项目 ${projectId} 资产 ${result.assetId}（${result.formatId}，${result.segmentCount} 段）`,
        )
        return { cancelled: false, filename, ...result }
      })
    },

    /**
     * linguist.projects.getSummary — 元数据 + 资产列表/计数 + 按状态段计数
     * （计数廉价 COUNT/GROUP BY，不加载段；资产列表 PB-033 扩展，只读资产
     * 元数据行）。
     */
    getSummary(input: unknown): Promise<LinguistIpcResult<LinguistProjectSummary>> {
      return wrap(() => {
        const projectId = readProjectId(assertRecord(input))
        const summary = getService().getProjectSummary(projectId)
        return { ...summary, project: toProjectInfo(summary.project) }
      })
    },

    /** linguist.projects.archive — 归档（元数据操作；句柄关闭丢弃）。 */
    archive(input: unknown): Promise<LinguistIpcResult<LinguistProjectArchiveResult>> {
      return wrap(() => {
        const projectId = readProjectId(assertRecord(input))
        return toProjectInfo(getService().archiveProject(projectId))
      })
    },

    /** linguist.projects.delete — 仅已归档项目；完整目录移入可恢复删除区。 */
    delete(input: unknown): Promise<LinguistIpcResult<LinguistProjectDeleteResult>> {
      return wrap(() => {
        const record = assertRecord(input)
        const projectId = readProjectId(record)
        const confirmationName = readDeleteConfirmation(record)
        return getService().deleteProject(projectId, confirmationName)
      })
    },

    /**
     * linguist.projects.setQualityProfile — 设置质量策略档（PB-082，计划 §21）。
     * profile 只接受三档字面量（INVALID_INPUT）；归档/不存在由服务层映射
     * PROJECT_ARCHIVED / PROJECT_NOT_FOUND（无新错误码）。
     */
    setQualityProfile(input: unknown): Promise<LinguistIpcResult<LinguistProjectSetQualityProfileResult>> {
      return wrap(() => {
        const record = assertRecord(input)
        const projectId = readProjectId(record)
        const profile = readQualityProfile(record)
        return toProjectInfo(getService().setQualityProfile(projectId, profile))
      })
    },

    setWorkflowConfig(input: unknown): Promise<LinguistIpcResult<LinguistProjectSetWorkflowConfigResult>> {
      return wrap(() => {
        const record = assertRecord(input)
        const projectId = readProjectId(record)
        const workflowStage = readWorkflowStage(record)
        const outputStatusPolicy = readOutputStatusPolicy(record, true)
        const qaProfile = readQaProfile(record, true)
        return toProjectInfo(getService().setWorkflowConfig(
          projectId,
          workflowStage,
          outputStatusPolicy,
          qaProfile,
        ))
      })
    },

    /** linguist.projects.backup — PB-111 全量备份（归档项目也可备份）。 */
    backup(input: unknown): Promise<LinguistIpcResult<LinguistProjectBackupResult>> {
      return wrap(() => {
        const projectId = readProjectId(assertRecord(input))
        return getService().backupProject(projectId)
      })
    },

    /** linguist.projects.listBackups — PB-111 备份列表（只读；最新在前）。 */
    listBackups(input: unknown): Promise<LinguistIpcResult<LinguistBackupListResult>> {
      return wrap(() => {
        const projectId = readProjectId(assertRecord(input))
        return getService().listBackups(projectId)
      })
    },

    /** linguist.projects.previewRestore — PB-111 恢复预览（verify + 摘要对比）。 */
    previewRestore(input: unknown): Promise<LinguistIpcResult<LinguistRestorePreviewResult>> {
      return wrap(() => {
        const record = assertRecord(input)
        const projectId = readProjectId(record)
        const backupName = readBackupName(record)
        return getService().previewRestore(projectId, backupName)
      })
    },

    /** linguist.projects.restore — PB-111 恢复（归档项目 PROJECT_ARCHIVED）。 */
    restore(input: unknown): Promise<LinguistIpcResult<LinguistProjectRestoreResult>> {
      return wrap(() => {
        const record = assertRecord(input)
        const projectId = readProjectId(record)
        const backupName = readBackupName(record)
        return getService().restoreProject(projectId, backupName)
      })
    },

    /**
     * linguist.project.previewAssetSource — PB-089 CAT 资产源文件预览
     * （纯读；归档项目允许）。主进程围栏解析 source/ blob 绝对路径后按
     * 扩展名三态分派：文本类直读（截断护栏）/ docx·xlsx 转 HTML /
     * 未知扩展名降级 proma-file:// URL。零字节、零路径过 IPC：text/html
     * 态只回内容字符串，url 态只回不透明 token URL。blob 缺失/越界由
     * 服务层抛 StoreNotFoundError → STORE_NOT_FOUND 错误信封；转换失败
     * 收敛 INTERNAL（不泄露内部细节）。
     */
    previewAssetSource(input: unknown): Promise<LinguistIpcResult<LinguistAssetPreviewResult>> {
      return wrap(async () => {
        if (assetPreview === undefined) {
          throw new Error('asset preview conversion stack is not wired')
        }
        const record = assertRecord(input)
        const projectId = readProjectId(record)
        const assetId = readCatAssetId(record)
        const { sourcePath, originalFilename } = getService().resolveAssetSourcePath(projectId, assetId)
        const ext = extname(originalFilename).toLowerCase().replace(/^\./, '')

        if (PREVIEW_TEXT_EXTENSIONS.has(ext)) {
          const file = await assetPreview.readText(sourcePath)
          if (file === null) throw new Error('asset source preview: text read failed')
          const truncated = file.content.length > PREVIEW_TEXT_MAX_CHARS
          return {
            kind: 'text',
            text: truncated ? file.content.slice(0, PREVIEW_TEXT_MAX_CHARS) : file.content,
            truncated,
            filename: originalFilename,
          }
        }
        if (ext === 'docx') {
          const converted = await assetPreview.convertDocxToHtml(sourcePath)
          if (converted === null) throw new Error('asset source preview: docx conversion failed')
          return { kind: 'html', html: converted.html, filename: originalFilename }
        }
        if (ext === 'xlsx') {
          const converted = await assetPreview.convertOfficeToHtml(sourcePath)
          if (converted === null) throw new Error('asset source preview: xlsx conversion failed')
          return {
            kind: 'html',
            html: converted.html,
            ...(converted.text !== '' ? { text: converted.text } : {}),
            filename: originalFilename,
          }
        }
        // 未知扩展名（白名单外，如旧仓迁移资产）：降级 url 态直渲染
        return {
          kind: 'url',
          url: assetPreview.registerPreviewUrl(sourcePath),
          filename: originalFilename,
          ext,
        }
      })
    },
  }
}

/** 便于类型推导的处理器集合类型（ipc.ts / 测试共用）。 */
export type LinguistProjectIpcHandlers = ReturnType<typeof createLinguistProjectIpc>
