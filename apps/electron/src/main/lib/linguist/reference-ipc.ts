/**
 * PB-080 TM / 术语库 IPC：原生选择器留在主进程，renderer 永不传路径或字节。
 */

import { readFileSync, statSync } from 'node:fs'
import { basename } from 'node:path'
import {
  LINGUIST_IMPORT_MAX_BYTES,
  LINGUIST_REFERENCE_ID_PATTERN,
  type LinguistIpcResult,
  type LinguistReferenceDeleteResult,
  type LinguistReferenceImportResult,
  type LinguistReferenceQueryResult,
  type LinguistTermInfo,
  type LinguistTermStatus,
  type LinguistTermUpsertResult,
  type LinguistTmInfo,
} from '@proma/shared'
import { LinguistImportTooLargeError } from './errors'
import { assertRecord, invalid, readProjectId, wrap } from './ipc-envelope'
import type { LinguistProjectService } from './project-service'

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
}

function readKind(record: Record<string, unknown>): 'tm' | 'terms' {
  const value = record.kind
  if (typeof value !== 'string' || !REFERENCE_KINDS.has(value)) {
    invalid('kind must be tm or terms')
  }
  return value as 'tm' | 'terms'
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

  return {
    queryTm(input: unknown): Promise<LinguistIpcResult<LinguistReferenceQueryResult<LinguistTmInfo>>> {
      return wrap(() => {
        const record = assertRecord(input)
        return getService().queryTmReferences(readProjectId(record), readPage(record))
      })
    },

    queryTerms(input: unknown): Promise<LinguistIpcResult<LinguistReferenceQueryResult<LinguistTermInfo>>> {
      return wrap(() => {
        const record = assertRecord(input)
        return getService().queryTermReferences(readProjectId(record), readTermPage(record))
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
        const result = service.importReference(projectId, kind, {
          bytes: new Uint8Array(readFileSync(filePath)),
          filename,
        })
        return { cancelled: false, filename, ...result }
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
