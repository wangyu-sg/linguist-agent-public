/**
 * PB-031 IPC 契约守卫测试（bun 安全，纯逻辑 + 源码形状断言，不触 DB）：
 * - 通道名与计划 §7.2 完全一致（机读契约，防改名；LF-072 起项目域 12 个）；
 * - 稳定错误码目录完整（IPC 层 2 + 服务层 7 + store 10 + format 4 + domain 6）；
 * - 校验常量（id/locale 形状、长度上限、导入扩展名/体积上限、PB-111 备份名
 *   白名单形状）行为；
 * - preload 暴露的方法名与通道引用（源码级断言——preload 顶层
 *   import electron，无法在无 Electron 环境直接 import 模块）。
 */

import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  LINGUIST_BACKUP_DIR_NAME_PATTERN,
  LINGUIST_IMPORT_FILE_EXTENSIONS,
  LINGUIST_IMPORT_MAX_BYTES,
  LINGUIST_CAT_IPC_CHANNELS,
  LINGUIST_CAT_PAGE_MAX,
  LINGUIST_CAT_SEARCH_MAX_LENGTH,
  LINGUIST_EXPORT_IPC_CHANNELS,
  LINGUIST_IPC_ERROR_CODES,
  LINGUIST_LEGACY_BACKUP_NAME_PATTERN,
  LINGUIST_LOCALE_MAX_LENGTH,
  LINGUIST_LOCALE_PATTERN,
  LINGUIST_PROJECT_ID_PATTERN,
  LINGUIST_PROJECT_IPC_CHANNELS,
  LINGUIST_PROJECT_NAME_MAX_LENGTH,
  LINGUIST_PROPOSAL_IPC_CHANNELS,
  LINGUIST_SESSION_IPC_CHANNELS,
} from '@proma/shared'

describe('linguist CAT Workspace IPC contract (PB-060/PB-071)', () => {
test('query, human-only CAS edit, context, and QA channels', () => {
    expect(LINGUIST_CAT_IPC_CHANNELS).toEqual({
      QUERY: 'linguist.cat.query',
      EDIT_SEGMENT: 'linguist.cat.editSegment',
      CONFIRM_STAGE: 'linguist.cat.confirmStage',
      UNCONFIRM_STAGE: 'linguist.cat.unconfirmStage',
      CONFIRM_STAGE_BULK: 'linguist.cat.confirmStageBulk',
      GET_CONTEXT: 'linguist.cat.getContext',
      RUN_QA: 'linguist.cat.runQa',
      LIST_QA_FINDINGS: 'linguist.cat.listQaFindings',
      RESOLVE_QA_FINDING: 'linguist.cat.resolveQaFinding',
      WAIVE_QA_FINDING: 'linguist.cat.waiveQaFinding',
      WAIVE_QA_FINDINGS_BULK: 'linguist.cat.waiveQaFindingsBulk',
      PROJECT_MUTATION: 'linguist.cat.projectMutation',
    })
    expect(LINGUIST_CAT_PAGE_MAX).toBe(200)
    expect(LINGUIST_CAT_SEARCH_MAX_LENGTH).toBe(500)
  })
})

describe('linguist native export IPC contract (PB-073)', () => {
  test('renderer-safe preflight, Save and PB-102 read-only list channels', () => {
    expect(LINGUIST_EXPORT_IPC_CHANNELS).toEqual({
      PREPARE_ASSET: 'linguist.exports.prepareAsset',
      SAVE_ASSET: 'linguist.exports.saveAsset',
      LIST: 'linguist.exports.list',
    })
  })
})

describe('linguist proposal IPC channel contract (PB-053)', () => {
  test('human review, history and reconciliation channel names stay exact', () => {
    expect(LINGUIST_PROPOSAL_IPC_CHANNELS).toEqual({
      LIST: 'linguist.proposals.list',
      LIST_PENDING: 'linguist.proposals.listPending',
      GET_DIFF: 'linguist.proposals.getDiff',
      ACCEPT: 'linguist.proposals.accept',
      REJECT: 'linguist.proposals.reject',
      EDIT_AND_ACCEPT: 'linguist.proposals.editAndAccept',
      ACCEPT_SELECTED: 'linguist.proposals.acceptSelected',
      REJECT_SELECTED: 'linguist.proposals.rejectSelected',
      REISSUE: 'linguist.proposals.reissue',
    })
  })
})

describe('linguist session IPC channel contract (PB-034)', () => {
  test('exactly the four session-binding channel names, dotted form', () => {
    expect(LINGUIST_SESSION_IPC_CHANNELS).toEqual({
      CREATE_FOR_PROJECT: 'linguist.sessions.createForProject',
      LIST_FOR_PROJECT: 'linguist.sessions.listForProject',
      GET_BINDING: 'linguist.sessions.getBinding',
      DETACH_BINDING: 'linguist.sessions.detachBinding',
    })
  })
})

describe('linguist project IPC channel contract (plan §7.2)', () => {
  test('exactly the twelve mandated channel names, dotted form (LF-072 增加可恢复删除)', () => {
    expect(LINGUIST_PROJECT_IPC_CHANNELS).toEqual({
      LIST: 'linguist.projects.list',
      CREATE: 'linguist.projects.create',
      OPEN: 'linguist.projects.open',
      IMPORT: 'linguist.projects.import',
      GET_SUMMARY: 'linguist.projects.getSummary',
      ARCHIVE: 'linguist.projects.archive',
      DELETE: 'linguist.projects.delete',
      SET_QUALITY_PROFILE: 'linguist.projects.setQualityProfile',
      SET_WORKFLOW_CONFIG: 'linguist.projects.setWorkflowConfig',
      BACKUP: 'linguist.projects.backup',
      LIST_BACKUPS: 'linguist.projects.listBackups',
      PREVIEW_RESTORE: 'linguist.projects.previewRestore',
      RESTORE: 'linguist.projects.restore',
    })
  })

  test('stable error-code catalog is complete (31 codes)', () => {
    const codes: string[] = Object.values(LINGUIST_IPC_ERROR_CODES)
    expect(codes.length).toBe(31)
    expect(new Set(codes).size).toBe(31)
    // IPC 层
    expect(codes).toContain('INVALID_INPUT')
    expect(codes).toContain('INTERNAL')
    // 服务层（PB-030）
    for (const c of [
      'PROJECT_NOT_FOUND',
      'PROJECT_ARCHIVED',
      'PROJECT_UNHEALTHY',
      'IMPORT_TOO_LARGE',
      'EXPORT_BLOCKED_BY_QA',
      'CONTEXT_DOC_EXTRACT_FAILED',
      'PROJECT_DELETE_REQUIRES_ARCHIVE',
      'PROJECT_DELETE_CONFIRMATION_MISMATCH',
    ]) {
      expect(codes).toContain(c)
    }
    // store 穿透
    for (const c of [
      'STORE_SQLITE_UNAVAILABLE',
      'STORE_SCHEMA_TOO_NEW',
      'STORE_NOT_FOUND',
      'STORE_INDEX_CORRUPT',
      'STORE_READ_ONLY',
      'STORE_BUSY',
      'STORE_PROJECT_EXISTS',
      'STORE_ASSET_SOURCE_MISMATCH',
      'STORE_BACKUP_CORRUPT',
      'STORE_BACKUP_LEGACY',
    ]) {
      expect(codes).toContain(c)
    }
    // format 穿透
    for (const c of ['FORMAT_PARSE_ERROR', 'FORMAT_EXPORT_ERROR', 'FORMAT_SEGMENT_LOST', 'FORMAT_UNSUPPORTED']) {
      expect(codes).toContain(c)
    }
    // domain 穿透
    for (const c of [
      'SEGMENT_LOCKED',
      'REVISION_CONFLICT',
      'STALE_PROPOSAL',
      'UNKNOWN_SEGMENT',
      'INVALID_STATE_TRANSITION',
      'INVALID_ID',
    ]) {
      expect(codes).toContain(c)
    }
  })
})

describe('validation constants', () => {
  test('project id pattern: prj-<16 lowercase hex>', () => {
    expect(LINGUIST_PROJECT_ID_PATTERN.test('prj-0123456789abcdef')).toBe(true)
    expect(LINGUIST_PROJECT_ID_PATTERN.test('prj-0000000000000000')).toBe(true)
    expect(LINGUIST_PROJECT_ID_PATTERN.test('prj-0123456789ABCDEF')).toBe(false)
    expect(LINGUIST_PROJECT_ID_PATTERN.test('prj-0123')).toBe(false)
    expect(LINGUIST_PROJECT_ID_PATTERN.test('xyz')).toBe(false)
    expect(LINGUIST_PROJECT_ID_PATTERN.test('seg-0123456789abcdef')).toBe(false)
    expect(LINGUIST_PROJECT_ID_PATTERN.test('')).toBe(false)
  })

  test('locale pattern: BCP-47-ish shape', () => {
    for (const ok of ['en', 'zh', 'zh-CN', 'zh-Hant', 'zh-Hant-TW', 'pt-BR', 'en-US', 'de-CH-1901']) {
      expect(LINGUIST_LOCALE_PATTERN.test(ok)).toBe(true)
    }
    for (const bad of ['', 'english', 'e', 'en_US', 'zh--CN', '-en', 'en-', 'zh CN', 'en..US', '123']) {
      expect(LINGUIST_LOCALE_PATTERN.test(bad)).toBe(false)
    }
    expect(LINGUIST_LOCALE_MAX_LENGTH).toBe(35)
  })

  test('caps and import allowlist match the plan', () => {
    expect(LINGUIST_PROJECT_NAME_MAX_LENGTH).toBe(120)
    expect(LINGUIST_IMPORT_MAX_BYTES).toBe(50 * 1024 * 1024)
    expect([...LINGUIST_IMPORT_FILE_EXTENSIONS]).toEqual(['xliff', 'xlf', 'mqxliff', 'csv', 'tsv', 'json', 'xlsx', 'sdlxliff', 'mxliff', 'docx'])
  })

  test('PB-111 backup name whitelist shapes (directory traversal rejected)', () => {
    expect(LINGUIST_BACKUP_DIR_NAME_PATTERN.test('backup-2026-07-25T17-52-35-461Z')).toBe(true)
    expect(LINGUIST_LEGACY_BACKUP_NAME_PATTERN.test('cat-2026-07-25T17-52-35-461Z.db')).toBe(true)
    for (const bad of [
      '../projects.json',
      'backup-',
      'backup-2026-07-25',
      'pre-restore-2026-01-01T00-00-00-000Z',
      'cat-2026-07-25T17-52-35-461Z.db/..',
      '',
    ]) {
      expect(LINGUIST_BACKUP_DIR_NAME_PATTERN.test(bad)).toBe(false)
      expect(LINGUIST_LEGACY_BACKUP_NAME_PATTERN.test(bad)).toBe(false)
    }
  })
})

describe('preload / ipc.ts source shape (source-level assertions)', () => {
  // apps/electron/src/main/lib/linguist → 上溯三级到 src/
  const SRC_DIR = join(import.meta.dir, '..', '..', '..')
  const preloadSource = readFileSync(join(SRC_DIR, 'preload', 'index.ts'), 'utf8')
  const ipcSource = readFileSync(join(SRC_DIR, 'main', 'ipc.ts'), 'utf8')

  const PRELOAD_METHODS = [
    'linguistProjectsList',
    'linguistProjectsCreate',
    'linguistProjectsOpen',
    'linguistProjectsImport',
    'linguistProjectsGetSummary',
    'linguistProjectsArchive',
    'linguistProjectsDelete',
    'linguistProjectsSetQualityProfile',
    // ===== PB-111 备份 / 恢复 =====
    'linguistProjectsBackup',
    'linguistBackupsList',
    'linguistBackupsPreviewRestore',
    'linguistBackupsRestore',
  ] as const

  test('preload exposes the PB-060 CAT query without a renderer database path', () => {
    expect(preloadSource).toContain('linguistCatQuery:')
    expect(preloadSource).toContain('linguistCatEditSegment:')
    expect(preloadSource).toContain('linguistCatRunQa:')
    expect(preloadSource).toContain('linguistCatListQaFindings:')
    expect(preloadSource).toContain('linguistCatResolveQaFinding:')
    expect(preloadSource).toContain('linguistCatWaiveQaFinding:')
    expect(preloadSource).toContain('onLinguistProjectMutation:')
    expect(preloadSource).toContain('LINGUIST_CAT_IPC_CHANNELS.QUERY')
    expect(preloadSource).toContain('LINGUIST_CAT_IPC_CHANNELS.EDIT_SEGMENT')
    expect(preloadSource).toContain('LINGUIST_CAT_IPC_CHANNELS.PROJECT_MUTATION')
    for (const member of ['RUN_QA', 'LIST_QA_FINDINGS', 'RESOLVE_QA_FINDING', 'WAIVE_QA_FINDING']) {
      expect(preloadSource).toContain(`LINGUIST_CAT_IPC_CHANNELS.${member}`)
      expect(ipcSource).toContain(`LINGUIST_CAT_IPC_CHANNELS.${member}`)
    }
    expect(ipcSource).toContain('createLinguistCatWorkspaceIpc')
    expect(ipcSource).toContain('LINGUIST_CAT_IPC_CHANNELS.QUERY')
    expect(ipcSource).toContain('LINGUIST_CAT_IPC_CHANNELS.EDIT_SEGMENT')
  })

  test('preload exposes the twelve linguistProjects*/linguistBackups* methods wired to the channels', () => {
    for (const method of PRELOAD_METHODS) {
      expect(preloadSource).toContain(`${method}:`)
    }
    expect(preloadSource).toContain('LINGUIST_PROJECT_IPC_CHANNELS')
    for (const member of ['LIST', 'CREATE', 'OPEN', 'IMPORT', 'GET_SUMMARY', 'ARCHIVE', 'DELETE', 'SET_QUALITY_PROFILE', 'BACKUP', 'LIST_BACKUPS', 'PREVIEW_RESTORE', 'RESTORE']) {
      expect(preloadSource).toContain(`LINGUIST_PROJECT_IPC_CHANNELS.${member}`)
    }
  })

  test('ipc.ts registers all twelve channels with the dialog picker injected for import', () => {
    expect(ipcSource).toContain('createLinguistProjectIpc')
    for (const member of ['LIST', 'CREATE', 'OPEN', 'IMPORT', 'GET_SUMMARY', 'ARCHIVE', 'DELETE', 'SET_QUALITY_PROFILE', 'BACKUP', 'LIST_BACKUPS', 'PREVIEW_RESTORE', 'RESTORE']) {
      expect(ipcSource).toContain(`LINGUIST_PROJECT_IPC_CHANNELS.${member}`)
    }
    expect(ipcSource).toContain('dialog.showOpenDialog')
    expect(ipcSource).toContain('getLinguistProjectService')
  })

  test('native export is renderer-safe and uses the main-process Save dialog', () => {
    expect(preloadSource).toContain('linguistExportsPrepareAsset:')
    expect(preloadSource).toContain('LINGUIST_EXPORT_IPC_CHANNELS.PREPARE_ASSET')
    expect(preloadSource).toContain('linguistExportsSaveAsset:')
    expect(preloadSource).toContain('LINGUIST_EXPORT_IPC_CHANNELS.SAVE_ASSET')
    expect(ipcSource).toContain('createLinguistExportIpc')
    expect(ipcSource).toContain('LINGUIST_EXPORT_IPC_CHANNELS.PREPARE_ASSET')
    expect(ipcSource).toContain('LINGUIST_EXPORT_IPC_CHANNELS.SAVE_ASSET')
    expect(ipcSource).toContain('dialog.showSaveDialog')
  })

  test('PB-102 read-only exports list channel is wired through preload and ipc.ts', () => {
    expect(preloadSource).toContain('linguistExportsList:')
    expect(preloadSource).toContain('LINGUIST_EXPORT_IPC_CHANNELS.LIST')
    expect(ipcSource).toContain('LINGUIST_EXPORT_IPC_CHANNELS.LIST')
  })

  const PRELOAD_SESSION_METHODS = [
    'linguistSessionsCreateForProject',
    'linguistSessionsListForProject',
    'linguistSessionsGetBinding',
    'linguistSessionsDetachBinding',
  ] as const

  test('preload exposes all linguistSessions* methods wired to the channels', () => {
    for (const method of PRELOAD_SESSION_METHODS) {
      expect(preloadSource).toContain(`${method}:`)
    }
    for (const member of ['CREATE_FOR_PROJECT', 'LIST_FOR_PROJECT', 'GET_BINDING', 'DETACH_BINDING']) {
      expect(preloadSource).toContain(`LINGUIST_SESSION_IPC_CHANNELS.${member}`)
    }
  })

  test('ipc.ts registers all four session-binding channels', () => {
    expect(ipcSource).toContain('createLinguistSessionIpc')
    for (const member of ['CREATE_FOR_PROJECT', 'LIST_FOR_PROJECT', 'GET_BINDING', 'DETACH_BINDING']) {
      expect(ipcSource).toContain(`LINGUIST_SESSION_IPC_CHANNELS.${member}`)
    }
  })

  const PROPOSAL_MEMBERS = [
    'LIST',
    'LIST_PENDING',
    'GET_DIFF',
    'ACCEPT',
    'REJECT',
    'EDIT_AND_ACCEPT',
    'ACCEPT_SELECTED',
    'REJECT_SELECTED',
    'REISSUE',
  ] as const

  test('preload and ipc.ts wire all human Proposal operations (PB-053 + reconciliation)', () => {
    for (const method of [
      'linguistProposalsList',
      'linguistProposalsListPending',
      'linguistProposalsGetDiff',
      'linguistProposalsAccept',
      'linguistProposalsReject',
      'linguistProposalsEditAndAccept',
      'linguistProposalsAcceptSelected',
      'linguistProposalsRejectSelected',
      'linguistProposalsReissue',
    ]) {
      expect(preloadSource).toContain(`${method}:`)
    }
    expect(ipcSource).toContain('createLinguistProposalIpc')
    for (const member of PROPOSAL_MEMBERS) {
      expect(preloadSource).toContain(`LINGUIST_PROPOSAL_IPC_CHANNELS.${member}`)
      expect(ipcSource).toContain(`LINGUIST_PROPOSAL_IPC_CHANNELS.${member}`)
    }
  })
})
