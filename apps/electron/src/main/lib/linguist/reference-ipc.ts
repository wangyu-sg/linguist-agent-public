/**
 * PB-080 TM / 术语库 IPC：原生选择器留在主进程，renderer 永不传路径或字节。
 */

import { readFileSync, statSync } from 'node:fs'
import { basename } from 'node:path'
import { sha256Hex } from '@linguist/cat-core'
import {
  LINGUIST_IMPORT_MAX_BYTES,
  LINGUIST_PENDING_IMPORT_ID_PATTERN,
  LINGUIST_REFERENCE_ID_PATTERN,
  type LinguistAssetPreviewResult,
  type LinguistReferenceCandidatePreviewRequest,
  type LinguistReferenceCandidateSummary,
  type LinguistReferenceCancelImportResult,
  type LinguistReferenceConfirmImportResult,
  type LinguistIpcResult,
  type LinguistReferenceDeleteResult,
  type LinguistReferenceImportInfo,
  type LinguistReferenceImportResult,
  type LinguistReferenceQueryResult,
  type LinguistTermInfo,
  type LinguistTermStatus,
  type LinguistTermUpsertResult,
  type LinguistTmInfo,
} from '@proma/shared'
import { LinguistImportTooLargeError } from './errors'
import { assertRecord, invalid, readProjectId, wrap } from './ipc-envelope'
import { PendingImportFileStore, type PendingImportFileScope } from './pending-import-files'
import type { LinguistProjectService } from './project-service'
import type {
  ReferenceImport,
  TermEntryImportInput,
  TmUnitImportInput,
} from '@linguist/cat-store'
import { parseTermReference, parseTmReference } from './project-resource-parsers'

const TERM_STATUSES = new Set<LinguistTermStatus>([
  'allowed',
  'preferred',
  'required',
  'forbidden',
  'deprecated',
])
const REFERENCE_KINDS = new Set(['tm', 'terms'])
const QUERY_MAX_LENGTH = 1_000
const PAGE_MAX = 200
const TERM_MAX_LENGTH = 1_000
const NOTE_MAX_LENGTH = 4_000
const CANDIDATE_SAMPLE_LIMIT = 20
const CANDIDATE_WARNING_LIMIT = 20
const CANDIDATE_VALUE_MAX_CHARS = 400
const PREVIEW_TEXT_MAX_CHARS = 200_000
const SHA256_HEX_PATTERN = /^[0-9a-f]{64}$/

/** Store 的 blob 相对路径只留在主进程；IPC 只返回可展示 provenance。 */
function toReferenceImportInfo(source: ReferenceImport): LinguistReferenceImportInfo {
  return {
    id: source.id,
    kind: source.kind,
    filename: source.originalFilename,
    sourceSha256: source.sourceSha256,
    createdAt: source.createdAt,
  }
}

export interface LinguistReferencePickerOptions {
  title: string
  properties?: Array<'openFile'>
  filters: { name: string; extensions: string[] }[]
}

export interface LinguistReferencePickerResult {
  canceled: boolean
  filePaths: string[]
}

export type LinguistReferenceFilePicker = (
  options: LinguistReferencePickerOptions,
) => Promise<LinguistReferencePickerResult>

export interface LinguistReferenceIpcDeps {
  getService: () => LinguistProjectService
  /** 与 XLSX 映射共用的 picker bytes token；生产从 main/ipc.ts 注入同一实例。 */
  pendingFiles?: PendingImportFileStore
}

function readKind(record: Record<string, unknown>): 'tm' | 'terms' {
  const value = record.kind
  if (typeof value !== 'string' || !REFERENCE_KINDS.has(value)) {
    invalid('kind must be tm or terms')
  }
  return value as 'tm' | 'terms'
}

function pendingScopeForKind(kind: 'tm' | 'terms'): PendingImportFileScope {
  return kind === 'tm' ? 'reference-tm' : 'reference-terms'
}

function readCandidateBinding(input: unknown): LinguistReferenceCandidatePreviewRequest {
  const record = assertRecord(input)
  for (const key of Object.keys(record)) {
    if (!['projectId', 'kind', 'candidateId', 'sourceSha256'].includes(key)) {
      invalid(`unknown reference candidate field ${JSON.stringify(key)}`)
    }
  }
  const projectId = readProjectId(record)
  const kind = readKind(record)
  const candidateId = record.candidateId
  if (typeof candidateId !== 'string' || !LINGUIST_PENDING_IMPORT_ID_PATTERN.test(candidateId)) {
    invalid('candidateId must be an opaque pending import token')
  }
  const sourceSha256 = record.sourceSha256
  if (typeof sourceSha256 !== 'string' || !SHA256_HEX_PATTERN.test(sourceSha256)) {
    invalid('sourceSha256 must be a lowercase SHA-256 hex digest')
  }
  return { projectId, kind, candidateId, sourceSha256 }
}

function requireCandidate(
  pendingFiles: PendingImportFileStore,
  request: LinguistReferenceCandidatePreviewRequest,
) {
  const pending = pendingFiles.get(request.candidateId, pendingScopeForKind(request.kind))
  if (
    pending === undefined
    || pending.projectId !== request.projectId
    || pending.sourceSha256 !== request.sourceSha256
  ) {
    invalid('reference import candidate is missing, expired, or bound to different source bytes')
  }
  return pending
}

function truncateCandidateValue(value: string): { value: string; truncated: boolean } {
  if (value.length <= CANDIDATE_VALUE_MAX_CHARS) return { value, truncated: false }
  return { value: `${value.slice(0, CANDIDATE_VALUE_MAX_CHARS)}…`, truncated: true }
}

function candidateSummary(
  kind: 'tm' | 'terms',
  entries: readonly (TmUnitImportInput | TermEntryImportInput)[],
  inputWarnings: readonly string[],
): LinguistReferenceCandidateSummary {
  let valuesTruncated = false
  const samples = entries.slice(0, CANDIDATE_SAMPLE_LIMIT).map((entry) => {
    if (kind === 'tm') {
      const tm = entry as TmUnitImportInput
      const source = truncateCandidateValue(tm.source)
      const target = truncateCandidateValue(tm.target)
      valuesTruncated ||= source.truncated || target.truncated
      return { kind, source: source.value, target: target.value } as const
    }
    const termEntry = entry as TermEntryImportInput
    const term = truncateCandidateValue(termEntry.term)
    const translation = truncateCandidateValue(termEntry.translation)
    const note = typeof termEntry.note === 'string' ? truncateCandidateValue(termEntry.note) : undefined
    valuesTruncated ||= term.truncated || translation.truncated || note?.truncated === true
    return {
      kind,
      term: term.value,
      translation: translation.value,
      status: termEntry.status,
      caseSensitive: termEntry.caseSensitive,
      ...(note === undefined ? {} : { note: note.value }),
    } as const
  })
  const warnings = inputWarnings.slice(0, CANDIDATE_WARNING_LIMIT).map((item) => {
    const result = truncateCandidateValue(item)
    valuesTruncated ||= result.truncated
    return result.value
  })
  return {
    entryCount: entries.length,
    warningCount: inputWarnings.length,
    warnings,
    samples,
    samplesTruncated: entries.length > samples.length,
    valuesTruncated,
  }
}

function readPage(record: Record<string, unknown>): { query?: string; limit: number; offset: number } {
  const query = record.query
  if (query !== undefined && (typeof query !== 'string' || query.length > QUERY_MAX_LENGTH)) {
    invalid(`query must be a string of at most ${QUERY_MAX_LENGTH} characters`)
  }
  const limit = record.limit ?? 50
  const offset = record.offset ?? 0
  if (!Number.isInteger(limit) || (limit as number) < 1 || (limit as number) > PAGE_MAX) {
    invalid(`limit must be an integer between 1 and ${PAGE_MAX}`)
  }
  if (!Number.isInteger(offset) || (offset as number) < 0) invalid('offset must be a non-negative integer')
  return {
    ...(typeof query === 'string' && query.trim() !== '' ? { query: query.trim() } : {}),
    limit: limit as number,
    offset: offset as number,
  }
}

function readTermPage(
  record: Record<string, unknown>,
): ReturnType<typeof readPage> & { status?: LinguistTermStatus } {
  const status = record.status
  if (status !== undefined && (typeof status !== 'string' || !TERM_STATUSES.has(status as LinguistTermStatus))) {
    invalid('status must be a known term status')
  }
  return {
    ...readPage(record),
    ...(typeof status === 'string' ? { status: status as LinguistTermStatus } : {}),
  }
}

function readTermInput(record: Record<string, unknown>): {
  id?: string
  term: string
  translation: string
  status: LinguistTermStatus
  caseSensitive: boolean
  note?: string
  module?: string
  category?: string
  imageRef?: string
} {
  const id = record.id
  if (id !== undefined && (typeof id !== 'string' || !LINGUIST_REFERENCE_ID_PATTERN.test(id))) {
    invalid('id must be a TM/TB opaque id')
  }
  const term = record.term
  const translation = record.translation
  const status = record.status
  const caseSensitive = record.caseSensitive
  const note = record.note
  const module = record.module
  const category = record.category
  const imageRef = record.imageRef
  if (typeof term !== 'string' || term.trim().length === 0 || term.length > TERM_MAX_LENGTH) {
    invalid(`term must be a non-blank string of at most ${TERM_MAX_LENGTH} characters`)
  }
  if (typeof translation !== 'string' || translation.trim().length === 0 || translation.length > TERM_MAX_LENGTH) {
    invalid(`translation must be a non-blank string of at most ${TERM_MAX_LENGTH} characters`)
  }
  if (typeof status !== 'string' || !TERM_STATUSES.has(status as LinguistTermStatus)) {
    invalid('status must be a known term status')
  }
  if (typeof caseSensitive !== 'boolean') invalid('caseSensitive must be a boolean')
  if (note !== undefined && (typeof note !== 'string' || note.length > NOTE_MAX_LENGTH)) {
    invalid(`note must be a string of at most ${NOTE_MAX_LENGTH} characters`)
  }
  // PB-095 标注列：可空字符串，长度与 note 同顶。
  for (const [key, value] of [['module', module], ['category', category], ['imageRef', imageRef]] as const) {
    if (value !== undefined && (typeof value !== 'string' || value.length > NOTE_MAX_LENGTH)) {
      invalid(`${key} must be a string of at most ${NOTE_MAX_LENGTH} characters`)
    }
  }
  return {
    ...(typeof id === 'string' ? { id } : {}),
    term: term.trim(),
    translation: translation.trim(),
    status: status as LinguistTermStatus,
    caseSensitive,
    ...(typeof note === 'string' && note.trim() !== '' ? { note: note.trim() } : {}),
    ...(typeof module === 'string' && module.trim() !== '' ? { module: module.trim() } : {}),
    ...(typeof category === 'string' && category.trim() !== '' ? { category: category.trim() } : {}),
    ...(typeof imageRef === 'string' && imageRef.trim() !== '' ? { imageRef: imageRef.trim() } : {}),
  }
}

/** 不依赖 Electron，便于用 fake picker + 真实 service 做 node 测试。 */
export function createLinguistReferenceIpc(deps: LinguistReferenceIpcDeps) {
  const { getService } = deps
  const pendingFiles = deps.pendingFiles ?? new PendingImportFileStore()

  return {
    queryTm(input: unknown): Promise<LinguistIpcResult<LinguistReferenceQueryResult<LinguistTmInfo>>> {
      return wrap(() => {
        const record = assertRecord(input)
        const page = getService().queryTmReferences(readProjectId(record), readPage(record))
        return {
          ...page,
          imports: page.imports.map(toReferenceImportInfo),
        }
      })
    },

    queryTerms(input: unknown): Promise<LinguistIpcResult<LinguistReferenceQueryResult<LinguistTermInfo>>> {
      return wrap(() => {
        const record = assertRecord(input)
        const page = getService().queryTermReferences(readProjectId(record), readTermPage(record))
        return {
          ...page,
          imports: page.imports.map(toReferenceImportInfo),
        }
      })
    },

    async import(
      input: unknown,
      pickFile: LinguistReferenceFilePicker,
    ): Promise<LinguistIpcResult<LinguistReferenceImportResult>> {
      return wrap(async () => {
        const record = assertRecord(input)
        const projectId = readProjectId(record)
        const kind = readKind(record)
        const service = getService()
        service.assertProjectWritable(projectId)
        const picked = await pickFile({
          title: kind === 'tm' ? '导入翻译记忆' : '导入术语库',
          properties: ['openFile'],
          filters: kind === 'tm'
            ? [{ name: '翻译记忆 (TMX / CSV)', extensions: ['tmx', 'csv'] }]
            : [{ name: '术语库 (TBX / CSV)', extensions: ['tbx', 'csv'] }],
        })
        if (picked.canceled || picked.filePaths.length === 0) return { cancelled: true }
        const filePath = picked.filePaths[0] as string
        const sizeBytes = statSync(filePath).size
        if (sizeBytes > LINGUIST_IMPORT_MAX_BYTES) {
          throw new LinguistImportTooLargeError(sizeBytes, LINGUIST_IMPORT_MAX_BYTES)
        }
        const filename = basename(filePath)
        const bytes = new Uint8Array(readFileSync(filePath))
        const project = service.getProject(projectId)
        const parsed = kind === 'tm'
          ? parseTmReference({ bytes, filename }, project.sourceLocale, project.targetLocale)
          : parseTermReference({ bytes, filename }, project.sourceLocale, project.targetLocale)
        const sourceSha256 = sha256Hex(bytes)
        const pending = pendingFiles.issue({
          scope: pendingScopeForKind(kind),
          projectId,
          filename,
          sourceSha256,
          bytes,
        })
        return {
          cancelled: false,
          filename,
          requiresConfirmation: true,
          candidateId: pending.id,
          sourceSha256,
          summary: candidateSummary(kind, parsed.entries, parsed.warnings),
        }
      })
    },

    /** 人工确认候选：主进程复核绑定/hash 后才调用既有同事务 authority 写入。 */
    confirmImport(
      input: unknown,
    ): Promise<LinguistIpcResult<LinguistReferenceConfirmImportResult>> {
      return wrap(() => {
        const request = readCandidateBinding(input)
        const service = getService()
        service.assertProjectWritable(request.projectId)
        const pending = requireCandidate(pendingFiles, request)
        if (sha256Hex(pending.bytes) !== request.sourceSha256) {
          pendingFiles.remove(pending.id, pending.scope)
          invalid('reference import candidate bytes no longer match sourceSha256')
        }
        const result = service.importReference(request.projectId, request.kind, {
          bytes: pending.bytes,
          filename: pending.filename,
        })
        // importReference 是文件确认专用路径；没有 provenance 表示事务没有完整落地。
        if (result.source === undefined) {
          throw new Error('reference import source provenance was not persisted')
        }
        pendingFiles.remove(pending.id, pending.scope)
        return {
          cancelled: false,
          requiresConfirmation: false,
          filename: pending.filename,
          imported: result.imported,
          unchanged: result.unchanged,
          warnings: result.warnings,
          source: toReferenceImportInfo(result.source),
        }
      })
    },

    /** 取消只释放内存候选；不触碰项目数据库或 blobs。 */
    cancelImport(
      input: unknown,
    ): Promise<LinguistIpcResult<LinguistReferenceCancelImportResult>> {
      return wrap(() => {
        const request = readCandidateBinding(input)
        requireCandidate(pendingFiles, request)
        pendingFiles.remove(request.candidateId, pendingScopeForKind(request.kind))
        return { candidateId: request.candidateId }
      })
    },

    /** 确认前原件预览：只解码主进程内存 bytes，复用 Proma Preview Tab 的 text 态。 */
    previewCandidate(
      input: unknown,
    ): Promise<LinguistIpcResult<LinguistAssetPreviewResult>> {
      return wrap(() => {
        const request = readCandidateBinding(input)
        // 项目已删除时不继续暴露内存候选；归档仍允许只读预览。
        getService().getProject(request.projectId)
        const pending = requireCandidate(pendingFiles, request)
        let text: string
        try {
          text = new TextDecoder('utf-8', { fatal: true }).decode(pending.bytes)
        } catch {
          invalid('reference import candidate cannot be decoded as UTF-8')
        }
        const truncated = text.length > PREVIEW_TEXT_MAX_CHARS
        return {
          kind: 'text',
          text: truncated ? text.slice(0, PREVIEW_TEXT_MAX_CHARS) : text,
          truncated,
          filename: pending.filename,
        }
      })
    },

    upsertTerm(input: unknown): Promise<LinguistIpcResult<LinguistTermUpsertResult>> {
      return wrap(() => {
        const record = assertRecord(input)
        return getService().upsertTermReference(readProjectId(record), readTermInput(record))
      })
    },

    delete(input: unknown): Promise<LinguistIpcResult<LinguistReferenceDeleteResult>> {
      return wrap(() => {
        const record = assertRecord(input)
        const id = record.id
        if (typeof id !== 'string' || !LINGUIST_REFERENCE_ID_PATTERN.test(id)) {
          invalid('id must be a TM/TB opaque id')
        }
        const kind = readKind(record)
        getService().deleteReference(readProjectId(record), kind, id)
        return { id }
      })
    },
  }
}

export type LinguistReferenceIpcHandlers = ReturnType<typeof createLinguistReferenceIpc>
