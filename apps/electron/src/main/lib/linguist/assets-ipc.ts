/**
 * PB-095 项目资产 IPC：六类资产的 CRUD 与原生导入。原生选择器留在主
 * 进程，renderer 永不传路径或字节（同 PB-080 纪律）。不依赖 Electron，
 * 便于用 fake picker + 真实 service 做 node 测试。
 *
 * 术语（第六类）复用 PB-080 的 reference 通道；本模块覆盖五类新资产：
 * styleGuideRules / sentencePatterns / contextDocs / techConstraints /
 * voiceProfiles。contextDocs 查询只回元数据（text_extract 不下发、
 * blob 字节永不过 IPC）；image 条目附带 proma-file:// previewUrl
 * （不透明 token，经 registerPreviewUrl 注入，blob 缺失时省略）。
 */

import { readFileSync, statSync } from 'node:fs'
import { basename, extname } from 'node:path'
import {
  LINGUIST_IMPORT_MAX_BYTES,
  LINGUIST_RESOURCE_IMPORT_MAX_BYTES,
  LINGUIST_PROJECT_ASSET_ID_PATTERN,
  type LinguistAssetPreviewResult,
  type LinguistAssetsDeleteResult,
  type LinguistAssetsQueryResult,
  type LinguistAssetsUpsertResult,
  type LinguistContextDocImportResult,
  type LinguistIpcResult,
  type LinguistProjectAssetInfo,
  type LinguistSentencePatternImportResult,
} from '@proma/shared'
import type { ContextDoc } from '@linguist/cat-store'
import { LinguistImportTooLargeError } from './errors'
import { assertRecord, invalid, readProjectId, wrap } from './ipc-envelope'
import type { LinguistAssetPreviewDeps } from './project-ipc'
import type {
  LinguistProjectAssetKind,
  ProjectAssetsQuery,
} from './project-service'
import type { LinguistProjectService } from './project-service'
import {
  createLinguistProjectMutationEvent,
  type LinguistProjectMutationSink,
} from './session-cat-tools'

const ASSET_KINDS = new Set(['styleGuideRules', 'sentencePatterns', 'contextDocs', 'techConstraints', 'voiceProfiles'])
const PATTERN_STATUSES = new Set(['confirmed', 'pending', 'rejected'])
const CONSTRAINT_KINDS = new Set(['length', 'rich_text', 'tag_note'])
const QUERY_MAX_LENGTH = 1_000
const TEXT_MAX_LENGTH = 4_000
const SHORT_MAX_LENGTH = 1_000
const VALUE_JSON_MAX_LENGTH = 8_000
const MARKER_MAX_COUNT = 50
const PAGE_MAX = 200

export interface LinguistAssetsPickerOptions {
  title: string
  properties?: Array<'openFile'>
  filters: { name: string; extensions: string[] }[]
}

export interface LinguistAssetsPickerResult {
  canceled: boolean
  filePaths: string[]
}

export type LinguistAssetsFilePicker = (
  options: LinguistAssetsPickerOptions,
) => Promise<LinguistAssetsPickerResult>

export interface LinguistAssetsIpcDeps {
  getService: () => LinguistProjectService
  /** 资产写入成功后广播统一 mutation，让 Workbench/Agent 的资源缓存同步失效。 */
  onProjectMutation?: LinguistProjectMutationSink
  /**
   * 把已确认在项目 blobs/ 内的绝对路径注册为 proma-file:// 不透明
   * URL（生产环境 = registerPromaFilePath；nodetest 注入 fake）。仅
   * contextDocs 的 image 条目查询时使用；注册失败降级为无 previewUrl。
   */
  registerPreviewUrl: (absPath: string) => string
  /**
   * contextDocs blob 预览的转换栈（与 PB-089 同一组依赖；生产 =
   * file-preview-service + registerPromaFilePath，ipc.ts 惰性注入；
   * nodetest 注入 fake）。缺失时 previewContextDoc 以 INTERNAL 降级。
   */
  assetPreview?: LinguistAssetPreviewDeps
}

/** contextDocs 文本类直读扩展名（导入白名单中的文本成员 + 常见文本格式）。 */
const CONTEXT_DOC_TEXT_EXTENSIONS = new Set(['md', 'markdown', 'txt', 'text', 'log', 'json', 'csv', 'tsv'])
const CONTEXT_DOC_EXTRACT_EXTENSIONS = new Set(['doc', 'dot', 'wps', 'wpt', 'rtf'])

/** text 态截断护栏（与 PB-089 / context doc text_extract 同一 200k 字符纪律）。 */
const PREVIEW_TEXT_MAX_CHARS = 200_000

function readKind(record: Record<string, unknown>): LinguistProjectAssetKind {
  const value = record.kind
  if (typeof value !== 'string' || !ASSET_KINDS.has(value)) {
    invalid('kind must be one of styleGuideRules/sentencePatterns/contextDocs/techConstraints/voiceProfiles')
  }
  return value as LinguistProjectAssetKind
}

function readAssetId(value: unknown, label = 'id'): string {
  if (typeof value !== 'string' || !LINGUIST_PROJECT_ASSET_ID_PATTERN.test(value)) {
    invalid(`${label} must be a valid project-asset Stable ID`)
  }
  return value
}

function readOptionalString(record: Record<string, unknown>, key: string, maxLength: number): string | undefined {
  const value = record[key]
  if (value === undefined) return undefined
  if (typeof value !== 'string' || value.length > maxLength) {
    invalid(`${key} must be a string of at most ${maxLength} characters`)
  }
  const trimmed = value.trim()
  return trimmed === '' ? undefined : trimmed
}

function readRequiredString(record: Record<string, unknown>, key: string, maxLength: number): string {
  const value = readOptionalString(record, key, maxLength)
  if (value === undefined) invalid(`${key} must be a non-blank string of at most ${maxLength} characters`)
  return value
}

function readOptionalStringArray(record: Record<string, unknown>, key: string): string[] | undefined {
  const value = record[key]
  if (value === undefined) return undefined
  if (!Array.isArray(value) || value.length > MARKER_MAX_COUNT) {
    invalid(`${key} must be an array of at most ${MARKER_MAX_COUNT} strings`)
  }
  const result: string[] = []
  for (const item of value) {
    if (typeof item !== 'string' || item.trim() === '' || item.length > SHORT_MAX_LENGTH) {
      invalid(`${key} items must be non-blank strings of at most ${SHORT_MAX_LENGTH} characters`)
    }
    result.push(item.trim())
  }
  return result
}

function readPage(record: Record<string, unknown>): { query?: string; status?: 'confirmed' | 'pending' | 'rejected'; limit: number; offset: number } {
  const query = record.query
  if (query !== undefined && (typeof query !== 'string' || query.length > QUERY_MAX_LENGTH)) {
    invalid(`query must be a string of at most ${QUERY_MAX_LENGTH} characters`)
  }
  const status = record.status
  if (status !== undefined && (typeof status !== 'string' || !PATTERN_STATUSES.has(status))) {
    invalid('status must be one of confirmed/pending/rejected')
  }
  const limit = record.limit ?? 50
  const offset = record.offset ?? 0
  if (!Number.isInteger(limit) || (limit as number) < 1 || (limit as number) > PAGE_MAX) {
    invalid(`limit must be an integer between 1 and ${PAGE_MAX}`)
  }
  if (!Number.isInteger(offset) || (offset as number) < 0) invalid('offset must be a non-negative integer')
  return {
    ...(typeof query === 'string' && query.trim() !== '' ? { query: query.trim() } : {}),
    ...(typeof status === 'string' ? { status: status as 'confirmed' | 'pending' | 'rejected' } : {}),
    limit: limit as number,
    offset: offset as number,
  }
}

function readItem(record: Record<string, unknown>): Record<string, unknown> {
  const item = record.item
  if (typeof item !== 'object' || item === null || Array.isArray(item)) {
    invalid('item must be an object')
  }
  return item as Record<string, unknown>
}

function readStyleGuideRuleInput(item: Record<string, unknown>) {
  const id = item.id
  if (id !== undefined) readAssetId(id)
  return {
    ...(typeof id === 'string' ? { id } : {}),
    groupKey: readOptionalString(item, 'groupKey', SHORT_MAX_LENGTH),
    ruleText: readRequiredString(item, 'ruleText', TEXT_MAX_LENGTH),
    sourceExample: readOptionalString(item, 'sourceExample', TEXT_MAX_LENGTH),
    goodExample: readOptionalString(item, 'goodExample', TEXT_MAX_LENGTH),
    badExample: readOptionalString(item, 'badExample', TEXT_MAX_LENGTH),
    updatedBy: readOptionalString(item, 'updatedBy', SHORT_MAX_LENGTH),
  }
}

function readSentencePatternInput(item: Record<string, unknown>) {
  const id = item.id
  if (id !== undefined) readAssetId(id)
  const status = item.status
  if (status !== undefined && (typeof status !== 'string' || !PATTERN_STATUSES.has(status))) {
    invalid('status must be one of confirmed/pending/rejected')
  }
  return {
    ...(typeof id === 'string' ? { id } : {}),
    textType: readOptionalString(item, 'textType', SHORT_MAX_LENGTH),
    module: readOptionalString(item, 'module', SHORT_MAX_LENGTH),
    source: readRequiredString(item, 'source', TEXT_MAX_LENGTH),
    draftTarget: readOptionalString(item, 'draftTarget', TEXT_MAX_LENGTH),
    suggestedTarget: readOptionalString(item, 'suggestedTarget', TEXT_MAX_LENGTH),
    reviewer: readOptionalString(item, 'reviewer', SHORT_MAX_LENGTH),
    ...(typeof status === 'string' ? { status: status as 'confirmed' | 'pending' | 'rejected' } : {}),
  }
}

function readTechConstraintInput(item: Record<string, unknown>) {
  const id = item.id
  if (id !== undefined) readAssetId(id)
  const kind = item.kind
  if (typeof kind !== 'string' || !CONSTRAINT_KINDS.has(kind)) {
    invalid('kind must be one of length/rich_text/tag_note')
  }
  const valueJson = readRequiredString(item, 'valueJson', VALUE_JSON_MAX_LENGTH)
  try {
    JSON.parse(valueJson)
  } catch {
    invalid('valueJson must be valid JSON text')
  }
  return {
    ...(typeof id === 'string' ? { id } : {}),
    kind: kind as 'length' | 'rich_text' | 'tag_note',
    scope: readOptionalString(item, 'scope', SHORT_MAX_LENGTH),
    valueJson,
    note: readOptionalString(item, 'note', TEXT_MAX_LENGTH),
  }
}

function readVoiceProfileInput(item: Record<string, unknown>) {
  const id = item.id
  if (id !== undefined) readAssetId(id)
  return {
    ...(typeof id === 'string' ? { id } : {}),
    speaker: readRequiredString(item, 'speaker', SHORT_MAX_LENGTH),
    textType: readOptionalString(item, 'textType', SHORT_MAX_LENGTH),
    register: readOptionalString(item, 'register', SHORT_MAX_LENGTH),
    person: readOptionalString(item, 'person', SHORT_MAX_LENGTH),
    toneMarkers: readOptionalStringArray(item, 'toneMarkers'),
    taboos: readOptionalStringArray(item, 'taboos'),
    notes: readOptionalString(item, 'notes', TEXT_MAX_LENGTH),
    updatedBy: readOptionalString(item, 'updatedBy', SHORT_MAX_LENGTH),
  }
}

/** context doc 元数据的线格式（text_extract 不下发；绝无路径）。 */
function toContextDocInfo(doc: ContextDoc, previewUrl?: string) {
  return {
    id: doc.id,
    kind: doc.kind,
    originalFilename: doc.originalFilename,
    ...(doc.sha256 !== undefined ? { sha256: doc.sha256 } : {}),
    ...(doc.note !== undefined ? { note: doc.note } : {}),
    createdAt: doc.createdAt,
    hasTextExtract: doc.textExtract !== undefined,
    textExtractLength: doc.textExtract?.length ?? 0,
    ...(previewUrl !== undefined ? { previewUrl } : {}),
  }
}

/**
 * image 条目的内联预览 URL：blob 路径经 service 围栏解析（越界/缺失
 * 返回 undefined），注册失败同样降级——查询永不因预览失败而报错。
 */
function buildPreviewUrl(
  service: LinguistProjectService,
  projectId: string,
  doc: ContextDoc,
  registerPreviewUrl: (absPath: string) => string,
): string | undefined {
  if (doc.kind !== 'image') return undefined
  const absPath = service.resolveContextDocBlobPath(projectId, doc.blobRelpath)
  if (absPath === undefined) return undefined
  try {
    return registerPreviewUrl(absPath)
  } catch {
    return undefined
  }
}

/** 查询结果的线格式映射（contextDocs 剥掉 text_extract，其余 kind 结构兼容直返）。 */
function toAssetInfo(
  item: unknown,
  contextDocPreview?: (doc: ContextDoc) => string | undefined,
): LinguistProjectAssetInfo {
  if (typeof item === 'object' && item !== null && 'blobRelpath' in item) {
    const doc = item as ContextDoc
    return toContextDocInfo(doc, contextDocPreview?.(doc))
  }
  return item as LinguistProjectAssetInfo
}

export function createLinguistAssetsIpc(deps: LinguistAssetsIpcDeps) {
  const { getService, onProjectMutation, registerPreviewUrl, assetPreview } = deps
  const emitAssetMutation = (projectId: string): void => {
    if (onProjectMutation === undefined) return
    onProjectMutation(createLinguistProjectMutationEvent(projectId, { kind: 'asset-updated' }))
  }

  return {
    query(input: unknown): Promise<LinguistIpcResult<LinguistAssetsQueryResult>> {
      return wrap(() => {
        const record = assertRecord(input)
        const projectId = readProjectId(record)
        const kind = readKind(record)
        const page = readPage(record)
        const query: ProjectAssetsQuery = {
          ...(page.query !== undefined ? { query: page.query } : {}),
          ...(page.status !== undefined ? { status: page.status } : {}),
          limit: page.limit,
          offset: page.offset,
        }
        const service = getService()
        const result = service.queryProjectAssets(projectId, kind, query)
        return {
          ...result,
          items: result.items.map((item) =>
            toAssetInfo(
              item,
              kind === 'contextDocs'
                ? (doc) => buildPreviewUrl(service, projectId, doc, registerPreviewUrl)
                : undefined,
            ),
          ),
        }
      })
    },

    upsert(input: unknown): Promise<LinguistIpcResult<LinguistAssetsUpsertResult>> {
      return wrap(() => {
        const record = assertRecord(input)
        const projectId = readProjectId(record)
        const kind = readKind(record)
        const item = readItem(record)
        const service = getService()
        let result: LinguistAssetsUpsertResult
        switch (kind) {
          case 'styleGuideRules':
            result = service.upsertProjectAsset(projectId, kind, readStyleGuideRuleInput(item))
            break
          case 'sentencePatterns':
            result = service.upsertProjectAsset(projectId, kind, readSentencePatternInput(item))
            break
          case 'contextDocs': {
            const id = readAssetId(item.id)
            result = toContextDocInfo(
              service.upsertProjectAsset(projectId, kind, {
                id,
                note: readOptionalString(item, 'note', TEXT_MAX_LENGTH),
              }),
            )
            break
          }
          case 'techConstraints':
            result = service.upsertProjectAsset(projectId, kind, readTechConstraintInput(item))
            break
          case 'voiceProfiles':
            result = service.upsertProjectAsset(projectId, kind, readVoiceProfileInput(item))
            break
        }
        emitAssetMutation(projectId)
        return result
      })
    },

    delete(input: unknown): Promise<LinguistIpcResult<LinguistAssetsDeleteResult>> {
      return wrap(() => {
        const record = assertRecord(input)
        const projectId = readProjectId(record)
        const kind = readKind(record)
        const id = readAssetId(record.id)
        getService().deleteProjectAsset(projectId, kind, id)
        emitAssetMutation(projectId)
        return { id }
      })
    },

    async importContextDoc(
      input: unknown,
      pickFile: LinguistAssetsFilePicker,
    ): Promise<LinguistIpcResult<LinguistContextDocImportResult>> {
      return wrap(async () => {
        const record = assertRecord(input)
        const projectId = readProjectId(record)
        const note = readOptionalString(record, 'note', TEXT_MAX_LENGTH)
        const service = getService()
        service.assertProjectWritable(projectId)
        const picked = await pickFile({
          title: '导入 Context 文档 / 图片',
          properties: ['openFile'],
          filters: [
            { name: '文档、表格与图片', extensions: ['pdf', 'doc', 'docx', 'rtf', 'xlsx', 'pptx', 'md', 'markdown', 'txt', 'csv', 'json', 'png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp'] },
            { name: '所有文件', extensions: ['*'] },
          ],
        })
        if (picked.canceled || picked.filePaths.length === 0) return { cancelled: true }
        const filePath = picked.filePaths[0] as string
        const sizeBytes = statSync(filePath).size
        if (sizeBytes > LINGUIST_RESOURCE_IMPORT_MAX_BYTES) {
          throw new LinguistImportTooLargeError(sizeBytes, LINGUIST_RESOURCE_IMPORT_MAX_BYTES)
        }
        const filename = basename(filePath)
        const doc = await service.importContextDoc(projectId, {
          bytes: readFileSync(filePath),
          filename,
          ...(note !== undefined ? { note } : {}),
        })
        emitAssetMutation(projectId)
        return { cancelled: false, filename, doc: toContextDocInfo(doc) }
      })
    },

    async importSentencePatterns(
      input: unknown,
      pickFile: LinguistAssetsFilePicker,
    ): Promise<LinguistIpcResult<LinguistSentencePatternImportResult>> {
      return wrap(async () => {
        const record = assertRecord(input)
        const projectId = readProjectId(record)
        const service = getService()
        service.assertProjectWritable(projectId)
        const picked = await pickFile({
          title: '导入句式库 (CSV)',
          properties: ['openFile'],
          filters: [{ name: '句式库 (CSV)', extensions: ['csv'] }],
        })
        if (picked.canceled || picked.filePaths.length === 0) return { cancelled: true }
        const filePath = picked.filePaths[0] as string
        const sizeBytes = statSync(filePath).size
        if (sizeBytes > LINGUIST_IMPORT_MAX_BYTES) {
          throw new LinguistImportTooLargeError(sizeBytes, LINGUIST_IMPORT_MAX_BYTES)
        }
        const filename = basename(filePath)
        const result = service.importSentencePatterns(projectId, {
          bytes: new Uint8Array(readFileSync(filePath)),
          filename,
        })
        emitAssetMutation(projectId)
        return { cancelled: false, filename, ...result }
      })
    },

    /**
     * linguist.assets.previewContextDoc — Context 文档 blob 预览（纯读；
     * 归档项目允许）。主进程围栏解析 blobs/ 内绝对路径后按扩展名三态分派
     * （与 PB-089 previewAssetSource 同一纪律）：文本类直读（截断护栏）/
     * docx/xlsx/pptx 转 HTML，旧版 Word/WPS 转可读文本，图片/PDF/未知扩展名降级 proma-file:// 不透明
     * token URL 直渲染。零字节、零路径过 IPC；blob 缺失/越界由服务层抛
     * StoreNotFoundError → STORE_NOT_FOUND 错误信封，转换失败收敛 INTERNAL。
     */
    previewContextDoc(input: unknown): Promise<LinguistIpcResult<LinguistAssetPreviewResult>> {
      return wrap(async () => {
        if (assetPreview === undefined) {
          throw new Error('asset preview conversion stack is not wired')
        }
        const record = assertRecord(input)
        const projectId = readProjectId(record)
        const docId = readAssetId(record.docId, 'docId')
        const { sourcePath, originalFilename } = getService().resolveContextDocPreviewPath(projectId, docId)
        const ext = extname(originalFilename).toLowerCase().replace(/^\./, '')

        if (CONTEXT_DOC_TEXT_EXTENSIONS.has(ext)) {
          const file = await assetPreview.readText(sourcePath)
          if (file === null) throw new Error('context doc preview: text read failed')
          const truncated = file.content.length > PREVIEW_TEXT_MAX_CHARS
          return {
            kind: 'text',
            text: truncated ? file.content.slice(0, PREVIEW_TEXT_MAX_CHARS) : file.content,
            truncated,
            filename: originalFilename,
          }
        }
        if (CONTEXT_DOC_EXTRACT_EXTENSIONS.has(ext)) {
          if (assetPreview.extractText === undefined) throw new Error('context doc preview: text extractor unavailable')
          const text = await assetPreview.extractText(sourcePath)
          return {
            kind: 'text',
            text: text.slice(0, PREVIEW_TEXT_MAX_CHARS),
            truncated: text.length > PREVIEW_TEXT_MAX_CHARS,
            filename: originalFilename,
          }
        }
        if (ext === 'docx') {
          const converted = await assetPreview.convertDocxToHtml(sourcePath)
          if (converted === null) throw new Error('context doc preview: docx conversion failed')
          return { kind: 'html', html: converted.html, filename: originalFilename }
        }
        if (ext === 'xlsx' || ext === 'pptx') {
          const converted = await assetPreview.convertOfficeToHtml(sourcePath)
          if (converted === null) throw new Error('context doc preview: office conversion failed')
          return {
            kind: 'html',
            html: converted.html,
            ...(converted.text !== '' ? { text: converted.text } : {}),
            filename: originalFilename,
          }
        }
        // 图片 / PDF / 未知扩展名：proma-file:// 不透明 token URL 直渲染
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

export type LinguistAssetsIpcHandlers = ReturnType<typeof createLinguistAssetsIpc>
