/**
 * Linguist 项目 typed IPC 处理器（PB-031；计划 §4.1/§7.2/§7.4）。
 *
 * 本模块实现项目域通道的全部逻辑（校验 → 服务调用 → 结果信封），
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
  normalizeWorkflowStage,
  type LinguistProject,
} from '@linguist/cat-core'
import {
  normalizeDelimitedHeader,
  parseXlsxWorkbook,
  XlsxAdapter,
  type XlsxWorkbookParseResult,
} from '@linguist/cat-formats'
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
  LINGUIST_REFERENCE_IMPORT_ID_PATTERN,
  LINGUIST_WORKSPACE_ID_MAX_LENGTH,
  LINGUIST_WORKFLOW_STAGES,
  type LinguistAssetPreviewResult,
  type LinguistBackupListResult,
  type LinguistIpcResult,
  type LinguistProjectArchiveResult,
  type LinguistProjectBackupResult,
  type LinguistProjectCreateResult,
  type LinguistProjectConfirmXlsxMappingResult,
  type LinguistProjectDeleteResult,
  type LinguistProjectImportResult,
  type LinguistProjectInfo,
  type LinguistProjectListResult,
  type LinguistProjectOpenResult,
  type LinguistProjectRenameResult,
  type LinguistProjectSetLocalesResult,
  type LinguistProjectReorderResult,
  type LinguistProjectRestoreResult,
  type LinguistProjectSetWorkflowConfigResult,
  type LinguistProjectUpdateTagProfileResult,
  type LinguistProjectScanUnknownTagsResult,
  type LinguistQaProfile,
  type LinguistProjectSummary,
  type LinguistProjectUndoImportAssetResult,
  type LinguistXlsxMappingPreview,
  type LinguistWorkflowOutputStatusPolicy,
  type LinguistWorkflowStage,
  type LinguistRestorePreviewResult,
} from '@proma/shared'
import { LinguistImportTooLargeError, LinguistProjectArchivedError } from './errors'
import { assertRecord, invalid, readProjectId, wrap } from './ipc-envelope'
import { PendingImportFileStore } from './pending-import-files'
import type { LinguistProjectService } from './project-service'
import type { XlsxImportMapping } from './project-service-types'

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
  /** 与 TM/TB 候选共用的短生命周期 picker 文件 token（生产由 ipc.ts 注入）。 */
  pendingFiles?: PendingImportFileStore
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
  /** 旧版 Word/WPS 等二进制文档 → 纯文本。 */
  extractText?: (filePath: string) => Promise<string>
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
const XLSX_MAPPING_SAMPLE_VALUE_MAX_CHARS = 400
const XLSX_DETECTOR = new XlsxAdapter()

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

/** TM/TB 文件导入原件的 opaque stable id。 */
function readReferenceImportId(record: Record<string, unknown>): string {
  const value = record.importId
  if (typeof value !== 'string' || !LINGUIST_REFERENCE_IMPORT_ID_PATTERN.test(value)) {
    invalid('importId must be a valid reference import Stable ID')
  }
  return value
}

function readXlsxMappingString(
  record: Record<string, unknown>,
  field: string,
  required: boolean,
): string | undefined {
  const value = record[field]
  if (value === undefined && !required) return undefined
  if (typeof value !== 'string' || value.trim() === '' || value.length > 512) {
    invalid(`${field} must be a non-blank string of at most 512 characters`)
  }
  return value
}

function readXlsxMappingConfirmation(input: unknown): {
  projectId: string
  mappingId: string
  sourceSha256: string
  mapping: XlsxImportMapping
} {
  const record = assertRecord(input)
  for (const key of Object.keys(record)) {
    if (!['projectId', 'mappingId', 'sourceSha256', 'sheetName', 'columns'].includes(key)) {
      invalid(`unknown XLSX mapping field ${JSON.stringify(key)}`)
    }
  }
  const projectId = readProjectId(record)
  const mappingId = readXlsxMappingString(record, 'mappingId', true)!
  const sourceSha256 = readXlsxMappingString(record, 'sourceSha256', true)!
  if (!/^[0-9a-f]{64}$/.test(sourceSha256)) invalid('sourceSha256 must be a lowercase SHA-256 hex digest')
  const sheetName = readXlsxMappingString(record, 'sheetName', true)!
  if (typeof record.columns !== 'object' || record.columns === null || Array.isArray(record.columns)) {
    invalid('columns must be an object')
  }
  const columnsRecord = record.columns as Record<string, unknown>
  for (const key of Object.keys(columnsRecord)) {
    if (!['key', 'source', 'target', 'locked', 'context'].includes(key)) {
      invalid(`unknown XLSX mapping column ${JSON.stringify(key)}`)
    }
  }
  const columns: XlsxImportMapping['columns'] = {
    source: readXlsxMappingString(columnsRecord, 'source', true)!,
    target: readXlsxMappingString(columnsRecord, 'target', true)!,
  }
  for (const key of ['key', 'locked', 'context'] as const) {
    const value = readXlsxMappingString(columnsRecord, key, false)
    if (value !== undefined) columns[key] = value
  }
  return { projectId, mappingId, sourceSha256, mapping: { sheetName, columns } }
}

function toXlsxMappingPreview(parsed: XlsxWorkbookParseResult): LinguistXlsxMappingPreview {
  const truncated = new Set(parsed.report.sampling.truncatedSheets.map((entry) => entry.sheet))
  return {
    sourceSha256: parsed.report.sourceSha256,
    sheets: parsed.sheets.map((sheet) => {
      const header = sheet.headers[0]
      const normalizedCounts = new Map<string, number>()
      for (const cell of header?.cells ?? []) {
        const normalized = normalizeDelimitedHeader(cell.value)
        if (normalized !== '') normalizedCounts.set(normalized, (normalizedCounts.get(normalized) ?? 0) + 1)
      }
      return {
        name: sheet.name,
        state: sheet.state,
        headerRowNumbers: sheet.headerRowNumbers,
        columns: (header?.cells ?? []).map((cell) => {
          const normalized = normalizeDelimitedHeader(cell.value)
          return {
            index: cell.col,
            header: cell.value,
            selectable: normalized !== '' && normalizedCounts.get(normalized) === 1,
          }
        }),
        sampleRows: sheet.rows.map((row) => ({
          rowNo: row.rowNo,
          cells: row.cells.map((cell) => ({
            columnIndex: cell.col,
            value: cell.value.slice(0, XLSX_MAPPING_SAMPLE_VALUE_MAX_CHARS),
            truncated: cell.value.length > XLSX_MAPPING_SAMPLE_VALUE_MAX_CHARS,
          })),
        })),
        coverage: {
          physicalRows: sheet.stats.totalRows,
          dataRows: sheet.stats.dataRows,
          nonEmptyDataRows: sheet.stats.nonEmptyDataRows,
          emptyDataRows: sheet.stats.emptyDataRows,
          shownSampleRows: sheet.rows.length,
          truncated: truncated.has(sheet.name),
        },
        distortion: sheet.distortion,
      }
    }),
    skippedSheets: parsed.skippedSheets,
  }
}

function validateXlsxMapping(
  parsed: XlsxWorkbookParseResult,
  mapping: XlsxImportMapping,
): XlsxImportMapping {
  const matches = parsed.sheets.filter((sheet) => sheet.name === mapping.sheetName)
  if (matches.length !== 1) invalid('selected XLSX sheet no longer exists or is ambiguous')
  const header = matches[0]!.headers[0]
  if (header === undefined) invalid('selected XLSX sheet has no mapping header row')
  const seen = new Set<string>()
  const columns: XlsxImportMapping['columns'] = {
    source: '',
    target: '',
  }
  for (const role of ['key', 'source', 'target', 'locked', 'context'] as const) {
    const selected = mapping.columns[role]
    if (selected === undefined) continue
    const normalized = normalizeDelimitedHeader(selected)
    const occurrences = header.cells.filter((cell) => normalizeDelimitedHeader(cell.value) === normalized)
    if (normalized === '' || occurrences.length !== 1 || seen.has(normalized)) {
      invalid(`selected XLSX ${role} column is missing, ambiguous, or reused`)
    }
    seen.add(normalized)
    columns[role] = selected
  }
  if (columns.source === '' || columns.target === '') invalid('XLSX source and target columns are required')
  return { sheetName: mapping.sheetName, columns }
}

/** 所有受管原件共用一套三态 Preview 转换，避免批次/TM/TB 分叉。 */
async function previewManagedSource(
  assetPreview: LinguistAssetPreviewDeps,
  sourcePath: string,
  originalFilename: string,
): Promise<LinguistAssetPreviewResult> {
  const ext = extname(originalFilename).toLowerCase().replace(/^\./, '')
  if (PREVIEW_TEXT_EXTENSIONS.has(ext)) {
    const file = await assetPreview.readText(sourcePath)
    if (file === null) throw new Error('managed source preview: text read failed')
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
    if (converted === null) throw new Error('managed source preview: docx conversion failed')
    return { kind: 'html', html: converted.html, filename: originalFilename }
  }
  if (ext === 'xlsx') {
    const converted = await assetPreview.convertOfficeToHtml(sourcePath)
    if (converted === null) throw new Error('managed source preview: xlsx conversion failed')
    return {
      kind: 'html',
      html: converted.html,
      ...(converted.text !== '' ? { text: converted.text } : {}),
      filename: originalFilename,
    }
  }
  return {
    kind: 'url',
    url: assetPreview.registerPreviewUrl(sourcePath),
    filename: originalFilename,
    ext,
  }
}

function toProjectInfo(project: LinguistProject): LinguistProjectInfo {
  return {
    ...project,
    workflowStage: normalizeWorkflowStage(project.workflowStage),
    qaProfile: normalizeQaProfile(project.qaProfile),
  }
}

// ===== 处理器工厂 =====

export function createLinguistProjectIpc(deps: LinguistProjectIpcDeps) {
  const { getService, assetPreview } = deps
  const pendingFiles = deps.pendingFiles ?? new PendingImportFileStore()

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

    /** linguist.projects.setLocales — 语言对校验后交由服务层判定是否仍为空项目。 */
    setLocales(input: unknown): Promise<LinguistIpcResult<LinguistProjectSetLocalesResult>> {
      return wrap(() => {
        const record = assertRecord(input)
        return toProjectInfo(getService().setProjectLocales(
          readProjectId(record),
          readLocale(record, 'sourceLocale'),
          readLocale(record, 'targetLocale'),
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
          title: '导入翻译批次',
          properties: ['openFile'],
          filters: [
            {
              name: '翻译批次文件 (XLIFF / SDLXLIFF / MXLIFF / DOCX / CSV / TSV / JSON / XLSX)',
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

        // XLSX 不会落入别名猜测：先展示主进程解析证据，再等待用户点名工作表/源文/译文列。
        if (await XLSX_DETECTOR.detect(bytes, filename) > 0) {
          const parsed = await parseXlsxWorkbook(bytes, { filename, maxRowsPerSheet: 5 })
          const sourceSha256 = parsed.report.sourceSha256
          const pending = pendingFiles.issue({
            scope: 'xlsx-mapping',
            projectId,
            filename,
            sourceSha256,
            bytes,
          })
          return {
            cancelled: false,
            requiresXlsxMapping: true,
            filename,
            mappingId: pending.id,
            sourceSha256,
            preview: toXlsxMappingPreview(parsed),
          }
        }

        const result = await service.importAsset(projectId, { bytes, filename })
        console.log(
          result.status === 'skipped-duplicate'
            ? `[Linguist IPC] 已跳过重复资产: 项目 ${projectId} 资产 ${result.assetId}`
            : `[Linguist IPC] 导入完成: 项目 ${projectId} 资产 ${result.assetId}（${result.formatId}，${result.segmentCount} 段）`,
        )
        return { cancelled: false, requiresXlsxMapping: false, filename, ...result }
      })
    },

    /** XLSX 映射确认：主进程再次校验 token、项目和精确 source hash。 */
    async confirmXlsxMapping(
      input: unknown,
    ): Promise<LinguistIpcResult<LinguistProjectConfirmXlsxMappingResult>> {
      return wrap(async () => {
        const confirmation = readXlsxMappingConfirmation(input)
        const service = getService()
        const project = service.getProject(confirmation.projectId)
        if (project.archivedAt !== undefined) throw new LinguistProjectArchivedError(confirmation.projectId)
        const pending = pendingFiles.get(confirmation.mappingId, 'xlsx-mapping')
        if (
          pending === undefined
          || pending.projectId !== confirmation.projectId
          || pending.sourceSha256 !== confirmation.sourceSha256
        ) {
          invalid('XLSX mapping preview is missing, expired, or bound to different source bytes')
        }
        const parsed = await parseXlsxWorkbook(pending.bytes, {
          filename: pending.filename,
          maxRowsPerSheet: 5,
        })
        if (parsed.report.sourceSha256 !== pending.sourceSha256) {
          invalid('XLSX source bytes changed after mapping preview')
        }
        const mapping = validateXlsxMapping(parsed, confirmation.mapping)
        const result = await service.importAsset(confirmation.projectId, {
          bytes: pending.bytes,
          filename: pending.filename,
          xlsxMapping: mapping,
        })
        pendingFiles.remove(pending.id, 'xlsx-mapping')
        console.log(
          result.status === 'skipped-duplicate'
            ? `[Linguist IPC] 已跳过已确认 XLSX 映射的重复资产: 项目 ${confirmation.projectId} 资产 ${result.assetId}`
            : `[Linguist IPC] 已导入已确认 XLSX 映射: 项目 ${confirmation.projectId} 资产 ${result.assetId}（${result.segmentCount} 段）`,
        )
        return { cancelled: false, requiresXlsxMapping: false, filename: pending.filename, ...result }
      })
    },

    /**
     * linguist.projects.undoImportAsset — LA-INTAKE-007 撤销一次导入：
     * 下游引用（Proposal/QA/评审件/导出/人工编辑痕迹/durable job）任一非零即
     * IMPORT_UNDO_BLOCKED（details 只含分类计数）；全零则 asset +
     * segments + 关联行 + source blob 一并删除。归档项目 PROJECT_ARCHIVED。
     */
    undoImportAsset(
      input: unknown,
    ): Promise<LinguistIpcResult<LinguistProjectUndoImportAssetResult>> {
      return wrap(() => {
        const record = assertRecord(input)
        const projectId = readProjectId(record)
        const assetId = readCatAssetId(record)
        return getService().undoImportAsset(projectId, assetId)
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

    updateTagProfile(input: unknown): Promise<LinguistIpcResult<LinguistProjectUpdateTagProfileResult>> {
      return wrap(() => {
        const record = assertRecord(input)
        const projectId = readProjectId(record)
        const action = record.action
        if (action === 'save') {
          const candidate = assertRecord(record.candidate)
          const readText = (key: string, maxLength: number): string => {
            const value = candidate[key]
            if (typeof value !== 'string' || value.trim() === '' || value.length > maxLength) {
              invalid(`candidate.${key} must be a non-empty string up to ${maxLength} characters`)
            }
            return value
          }
          const kind = candidate.kind
          if (kind !== 'standalone' && kind !== 'opening' && kind !== 'closing') {
            invalid('candidate.kind must be standalone/opening/closing')
          }
          const evidenceExampleIds = candidate.evidenceExampleIds
          if (!Array.isArray(evidenceExampleIds) || evidenceExampleIds.length === 0 || evidenceExampleIds.length > 50
            || evidenceExampleIds.some((value) => typeof value !== 'string' || value.trim() === '')) {
            invalid('candidate.evidenceExampleIds must contain 1-50 non-empty strings')
          }
          const confidence = candidate.confidence
          if (typeof confidence !== 'number' || !Number.isFinite(confidence) || confidence < 0 || confidence > 1) {
            invalid('candidate.confidence must be between 0 and 1')
          }
          const pairKey = candidate.pairKey
          if (pairKey !== undefined && (typeof pairKey !== 'string' || pairKey.trim() === '' || pairKey.length > 80)) {
            invalid('candidate.pairKey must be a non-empty string up to 80 characters')
          }
          const replaceId = record.replaceId
          if (replaceId !== undefined && (typeof replaceId !== 'string' || replaceId.trim() === '')) {
            invalid('replaceId must be a non-empty string')
          }
          try {
            const result = getService().saveTagProfileCandidate(projectId, {
              name: readText('name', 80),
              regex: readText('regex', 240),
              kind,
              ...(typeof pairKey === 'string' ? { pairKey } : {}),
              evidenceExampleIds: evidenceExampleIds as string[],
              confidence,
              explanation: readText('explanation', 500),
            }, typeof replaceId === 'string' ? replaceId : undefined)
            return toProjectInfo(result.project)
          } catch (error) {
            invalid(error instanceof Error ? error.message : 'Tag Profile candidate validation failed')
          }
        }
        if (action !== 'activate' && action !== 'ignore' && action !== 'enable' && action !== 'disable') {
          invalid('action must be save/activate/ignore/enable/disable')
        }
        const entryId = record.entryId
        if (typeof entryId !== 'string' || entryId.trim() === '') invalid('entryId must be a non-empty string')
        try {
          return toProjectInfo(getService().updateTagProfile(projectId, entryId, action).project)
        } catch (error) {
          invalid(error instanceof Error ? error.message : 'Tag Profile update failed')
        }
      })
    },

    scanUnknownTags(input: unknown): Promise<LinguistIpcResult<LinguistProjectScanUnknownTagsResult>> {
      return wrap(() => {
        const record = assertRecord(input)
        const projectId = readProjectId(record)
        const assetIds = record.assetIds
        if (assetIds !== undefined && (!Array.isArray(assetIds)
          || assetIds.length > 100
          || assetIds.some((value) => typeof value !== 'string' || value.trim() === ''))) {
          invalid('assetIds must contain at most 100 non-empty strings')
        }
        const sampleLimit = record.sampleLimit
        if (sampleLimit !== undefined && (!Number.isInteger(sampleLimit) || Number(sampleLimit) < 1 || Number(sampleLimit) > 10)) {
          invalid('sampleLimit must be an integer between 1 and 10')
        }
        return getService().scanUnknownTagPatterns(
          projectId,
          assetIds as string[] | undefined,
          sampleLimit as number | undefined,
        )
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
        return previewManagedSource(assetPreview, sourcePath, originalFilename)
      })
    },

    /** TM/TB 原始导入文件预览；与 CAT 批次复用同一主进程围栏和转换栈。 */
    previewReferenceImport(input: unknown): Promise<LinguistIpcResult<LinguistAssetPreviewResult>> {
      return wrap(async () => {
        if (assetPreview === undefined) {
          throw new Error('asset preview conversion stack is not wired')
        }
        const record = assertRecord(input)
        const projectId = readProjectId(record)
        const importId = readReferenceImportId(record)
        const { sourcePath, originalFilename } = getService().resolveReferenceImportPreviewPath(projectId, importId)
        return previewManagedSource(assetPreview, sourcePath, originalFilename)
      })
    },
  }
}

/** 便于类型推导的处理器集合类型（ipc.ts / 测试共用）。 */
export type LinguistProjectIpcHandlers = ReturnType<typeof createLinguistProjectIpc>
