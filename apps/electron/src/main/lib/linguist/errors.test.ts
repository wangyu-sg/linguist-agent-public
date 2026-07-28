/**
 * errors.ts 纯逻辑测试（bun 安全：不触碰 node:sqlite / 数据库）。
 * store / formats 错误类仅作类型构造，不会触发任何 DB 操作。
 */

import { describe, expect, test } from 'bun:test'
import { FormatUnsupportedError } from '@linguist/cat-formats'
import { StoreIndexCorruptError, StoreNotFoundError, StoreReadOnlyError } from '@linguist/cat-store'
import {
  errorCodeOf,
  LINGUIST_SERVICE_ERROR_CODES,
  LinguistContextDocExtractError,
  LinguistDeliveryNotReadyError,
  LinguistExportBlockedByQaError,
  LinguistImportTooLargeError,
  LinguistProjectArchivedError,
  LinguistProjectDeleteConfirmationMismatchError,
  LinguistProjectDeleteRequiresArchiveError,
  LinguistProjectNotFoundError,
  LinguistProjectUnhealthyError,
  LinguistServiceError,
  mapStoreError,
} from './errors'

describe('stable error codes', () => {
  test('code constants are part of the public contract', () => {
    expect(LINGUIST_SERVICE_ERROR_CODES).toEqual({
      PROJECT_NOT_FOUND: 'PROJECT_NOT_FOUND',
      PROJECT_ARCHIVED: 'PROJECT_ARCHIVED',
      PROJECT_UNHEALTHY: 'PROJECT_UNHEALTHY',
      IMPORT_TOO_LARGE: 'IMPORT_TOO_LARGE',
      EXPORT_BLOCKED_BY_QA: 'EXPORT_BLOCKED_BY_QA',
      DELIVERY_NOT_READY: 'DELIVERY_NOT_READY',
      CONTEXT_DOC_EXTRACT_FAILED: 'CONTEXT_DOC_EXTRACT_FAILED',
      PROJECT_DELETE_REQUIRES_ARCHIVE: 'PROJECT_DELETE_REQUIRES_ARCHIVE',
      PROJECT_DELETE_CONFIRMATION_MISMATCH: 'PROJECT_DELETE_CONFIRMATION_MISMATCH',
    })
  })

  test('each error class carries its code, name and payload', () => {
    const notFound = new LinguistProjectNotFoundError('prj-x')
    expect(notFound).toBeInstanceOf(LinguistServiceError)
    expect(notFound.code).toBe('PROJECT_NOT_FOUND')
    expect(notFound.name).toBe('LinguistProjectNotFoundError')
    expect(notFound.projectId).toBe('prj-x')

    const archived = new LinguistProjectArchivedError('prj-y')
    expect(archived.code).toBe('PROJECT_ARCHIVED')

    expect(new LinguistProjectDeleteRequiresArchiveError('prj-y').code)
      .toBe('PROJECT_DELETE_REQUIRES_ARCHIVE')
    expect(new LinguistProjectDeleteConfirmationMismatchError('prj-y').code)
      .toBe('PROJECT_DELETE_CONFIRMATION_MISMATCH')

    const unhealthy = new LinguistProjectUnhealthyError('prj-z', 'STORE_INDEX_CORRUPT')
    expect(unhealthy.code).toBe('PROJECT_UNHEALTHY')
    expect(unhealthy.detail).toBe('STORE_INDEX_CORRUPT')

    const tooLarge = new LinguistImportTooLargeError(100, 50)
    expect(tooLarge.code).toBe('IMPORT_TOO_LARGE')
    expect(tooLarge.sizeBytes).toBe(100)
    expect(tooLarge.limitBytes).toBe(50)

    const exportBlocked = new LinguistExportBlockedByQaError('prj-e', 'ast-e', 2)
    expect(exportBlocked.code).toBe('EXPORT_BLOCKED_BY_QA')
    expect(exportBlocked.openBlockingFindings).toBe(2)

    const deliveryBlocked = new LinguistDeliveryNotReadyError('prj-e', 'ast-e', 3)
    expect(deliveryBlocked.code).toBe('DELIVERY_NOT_READY')
    expect(deliveryBlocked.blockerCount).toBe(3)

    const extractFailed = new LinguistContextDocExtractError('DOCX_PARSE_FAILED')
    expect(extractFailed.code).toBe('CONTEXT_DOC_EXTRACT_FAILED')
    expect(extractFailed.diagnostic).toBe('DOCX_PARSE_FAILED')
    expect(extractFailed.message).toContain('DOCX_PARSE_FAILED')
    expect(extractFailed.message).toContain('另存为')

    const emptyText = new LinguistContextDocExtractError('DOCX_EMPTY_TEXT')
    expect(emptyText.message).toContain('普通段落正文')
    expect(emptyText.message).toContain('UTF-8 .txt/.md')
  })
})

describe('mapStoreError', () => {
  test('store project not-found maps to PROJECT_NOT_FOUND (id preserved)', () => {
    const mapped = mapStoreError(new StoreNotFoundError('project', 'prj-42'))
    expect(mapped).toBeInstanceOf(LinguistProjectNotFoundError)
    expect((mapped as LinguistProjectNotFoundError).projectId).toBe('prj-42')
  })

  test('missing on-disk project content maps to PROJECT_UNHEALTHY', () => {
    for (const entity of ['project metadata', 'cat database']) {
      const mapped = mapStoreError(new StoreNotFoundError(entity, '/x'), 'prj-1')
      expect(mapped).toBeInstanceOf(LinguistProjectUnhealthyError)
      expect((mapped as LinguistProjectUnhealthyError).code).toBe('PROJECT_UNHEALTHY')
      expect((mapped as LinguistProjectUnhealthyError).projectId).toBe('prj-1')
    }
  })

  test('corrupt index maps to PROJECT_UNHEALTHY', () => {
    const mapped = mapStoreError(new StoreIndexCorruptError('/x/projects.json', 'bad json'), 'prj-1')
    expect(mapped).toBeInstanceOf(LinguistProjectUnhealthyError)
    expect((mapped as LinguistProjectUnhealthyError).code).toBe('PROJECT_UNHEALTHY')
  })

  test('other typed errors pass through unchanged (never re-wrapped)', () => {
    const readOnly = new StoreReadOnlyError('op')
    expect(mapStoreError(readOnly)).toBe(readOnly)

    const unsupported = new FormatUnsupportedError('x.bin', ['xliff_1_2'])
    expect(mapStoreError(unsupported)).toBe(unsupported)

    const plain = new Error('boom')
    expect(mapStoreError(plain)).toBe(plain)
  })

  test('asset-level not-found passes through (not a project-level concern)', () => {
    const assetMissing = new StoreNotFoundError('asset', 'ast-1')
    expect(mapStoreError(assetMissing)).toBe(assetMissing)
  })
})

describe('errorCodeOf', () => {
  test('typed errors yield their code; anything else yields UNKNOWN', () => {
    expect(errorCodeOf(new StoreReadOnlyError('op'))).toBe('STORE_READ_ONLY')
    expect(errorCodeOf(new LinguistProjectArchivedError('prj-1'))).toBe('PROJECT_ARCHIVED')
    expect(errorCodeOf(new Error('x'))).toBe('UNKNOWN')
    expect(errorCodeOf(undefined)).toBe('UNKNOWN')
    expect(errorCodeOf('string')).toBe('UNKNOWN')
  })
})
