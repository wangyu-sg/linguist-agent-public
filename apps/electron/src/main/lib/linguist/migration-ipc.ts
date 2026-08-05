/**
 * Linguist legacy migration typed IPC handlers (PB-094; plan §7.2/§7.4/§22).
 *
 * Same discipline as project-ipc.ts: this module never imports electron —
 * ipc.ts registers thin adapters (injecting the real dialog picker and the
 * webContents progress sender), and node --test drives the handlers
 * directly (stub picker + real service + mkdtemp roots).
 *
 * Contract (packages/shared/src/types/linguist.ts):
 * - All channels return the LinguistIpcResult<T> envelope, never throw.
 * - pickAndScan: the directory picker runs in the main process (plan §7.4);
 *   the renderer only receives the scan PROJECTION. User cancel returns
 *   {cancelled: true} (a normal branch, not an error). Degraded sqlite
 *   refuses BEFORE the picker is opened (STORE_SQLITE_UNAVAILABLE).
 * - import: the request carries only legacy project ids + options; the
 *   legacy root path stays in the main-process session state from the last
 *   pickAndScan (the renderer cannot forge it). Progress events are
 *   forwarded through the injected callback (ipc.ts → webContents.send).
 */

import type {
  LinguistIpcResult,
  LinguistMigrationPickAndScanResult,
  LinguistMigrationReport,
} from '@proma/shared'
import { assertRecord, invalid, wrap } from './ipc-envelope'
import type { LinguistMigrationProgressCallback, LinguistMigrationService } from './migration-service'

// ===== picker abstraction (minimal mirror of the electron directory dialog) =====

export interface LinguistMigrationDirPickerOptions {
  title: string
  /** Explicit openDirectory (the legacy root is a directory, never a file). */
  properties: Array<'openDirectory'>
}

export interface LinguistMigrationDirPickerResult {
  canceled: boolean
  filePaths: string[]
}

export type LinguistMigrationDirectoryPicker = (
  options: LinguistMigrationDirPickerOptions,
) => Promise<LinguistMigrationDirPickerResult>

/** Lazy service resolution: IPC registration may precede service init. */
export interface LinguistMigrationIpcDeps {
  getService: () => LinguistMigrationService
}

// ===== input validation (plan §7.4: the renderer is untrusted) =====

/** Legacy project ids are directory names — never new-repo prj- ids and never paths. */
function readProjectIds(record: Record<string, unknown>): string[] {
  const value = record.projectIds
  if (!Array.isArray(value) || value.length === 0) {
    invalid('projectIds must be a non-empty array of legacy project ids')
  }
  if (value.length > 500) {
    invalid('projectIds must contain at most 500 ids')
  }
  const ids: string[] = []
  const seen = new Set<string>()
  for (const entry of value) {
    if (
      typeof entry !== 'string' ||
      entry.length === 0 ||
      entry.length > 255 ||
      entry.includes('/') ||
      entry.includes('\\')
    ) {
      invalid('projectIds entries must be non-empty legacy project id strings without path separators')
    }
    if (seen.has(entry)) continue
    seen.add(entry)
    ids.push(entry)
  }
  return ids
}

function readImportOptions(
  record: Record<string, unknown>,
): { externalSource?: 'copy' | 'reference'; salvageOrphan?: boolean } | undefined {
  const value = record.options
  if (value === undefined) return undefined
  const options = assertRecord(value)
  const externalSource = options.externalSource
  if (externalSource !== undefined && externalSource !== 'copy' && externalSource !== 'reference') {
    invalid("options.externalSource must be 'copy' or 'reference'")
  }
  const salvageOrphan = options.salvageOrphan
  if (salvageOrphan !== undefined && typeof salvageOrphan !== 'boolean') {
    invalid('options.salvageOrphan must be a boolean')
  }
  return {
    ...(externalSource !== undefined ? { externalSource } : {}),
    ...(salvageOrphan !== undefined ? { salvageOrphan } : {}),
  }
}

// ===== handler factory =====

export function createLinguistMigrationIpc(deps: LinguistMigrationIpcDeps) {
  const { getService } = deps

  return {
    /**
     * linguist.migration.pickAndScan — native directory picker + scan in
     * one step. Degraded mode refuses before the picker opens; a cancel is
     * a typed result, not an error.
     */
    async pickAndScan(
      input: unknown,
      pickDirectory: LinguistMigrationDirectoryPicker,
    ): Promise<LinguistIpcResult<LinguistMigrationPickAndScanResult>> {
      return wrap(async () => {
        if (input !== undefined) assertRecord(input)
        const service = getService()
        service.assertAvailable()
        const picked = await pickDirectory({
          title: '选择旧版数据根目录',
          properties: ['openDirectory'],
        })
        if (picked.canceled || picked.filePaths.length === 0) {
          return { cancelled: true }
        }
        const root = picked.filePaths[0]!
        const scan = service.scanRoot(root)
        console.log(
          `[Linguist IPC] 旧版数据根扫描完成: ${String(scan.totals.projects)} 个项目（schema v${String(scan.schemaVersion)}）`,
        )
        return { cancelled: false as const, ...scan }
      })
    },

    /**
     * linguist.migration.import — batch import of the selected legacy
     * projects; each import is verified immediately and progress events are
     * forwarded to the injected sender. The response is the aggregated
     * report (memory-rendered only, never persisted).
     */
    async import(
      input: unknown,
      onProgress?: LinguistMigrationProgressCallback,
    ): Promise<LinguistIpcResult<LinguistMigrationReport>> {
      return wrap(async () => {
        const record = assertRecord(input)
        const projectIds = readProjectIds(record)
        const options = readImportOptions(record)
        const report = await getService().importSelected(
          { projectIds, ...(options !== undefined ? { options } : {}) },
          onProgress,
        )
        console.log(
          `[Linguist IPC] 旧版迁移完成: ${String(report.projects.length)} 个项目（已导入 ${String(report.counts.imported)}，部分 ${String(report.counts.partial)}，仅归档 ${String(report.counts['archived-only'])}，隔离 ${String(report.counts.quarantined)}，错误 ${String(report.counts.error)}）`,
        )
        return report
      })
    },
  }
}

/** Handler-set type shared by ipc.ts and the tests. */
export type LinguistMigrationIpcHandlers = ReturnType<typeof createLinguistMigrationIpc>
