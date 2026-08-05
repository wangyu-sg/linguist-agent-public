/**
 * Linguist legacy migration orchestration service (PB-094; plan §22).
 *
 * Wraps @linguist/legacy-migration (scanLegacyRoot + importLegacyProject)
 * for the Electron main process:
 *
 * - Path discipline (plan §7.4): the renderer never submits a path. The
 *   native directory picker (injected by ipc.ts via migration-ipc) hands the
 *   chosen directory to scanRoot(), which retains {root, report} as session
 *   state; importSelected() only accepts project ids seen in that scan.
 * - Import loop: each selected project is imported (importLegacyProject is
 *   synchronous) and immediately verified; the loop yields via setImmediate
 *   between projects and emits progress events {projectId, phase, index,
 *   total} (phase 'import' fires before the import, 'verify' before the
 *   verify). A single very large project still blocks the main process
 *   during its own import — documented known limitation, no worker_threads.
 * - Verify per project (skipped when zero writes happened):
 *   1. transcript-rerender — read the sidecar legacy-import.json for the
 *      provenance, re-render the transcript from the ARCHIVED
 *      legacy-archive/chat/chat.json bytes and compare sha256 against the
 *      report. Deterministic because importSelected pins ONE clock value
 *      per project import, so sidecar.importedAt === transcript archivedAt.
 *   2. transcript-bytes — sha256 the archived transcript.md bytes and
 *      compare against the report (catches post-write tampering of the
 *      rendered file itself).
 *   3. store-assets / store-references / store-qa — reopen the new project
 *      with CatStore.openProject(id, {readOnly: true}) and compare
 *      asset/segment/TM/term/QA counts against the report totals.
 *   targetConflict reports skip the transcript checks (their transcript
 *   plan was never written; the on-disk artifact belongs to the first
 *   import) but still run the store-count checks (idempotent re-verify).
 * - Degraded sqlite (node:sqlite unavailable): scanRoot/importSelected
 *   refuse defensively with LinguistMigrationUnavailableError (code
 *   STORE_SQLITE_UNAVAILABLE, already in the shared catalog) — the wizard
 *   disables its entry on this code.
 *
 * Logging discipline: channel/error-code/counts only; never log file names,
 * paths, source or target text.
 */

import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { CatStore, StoreNotFoundError } from '@linguist/cat-store'
import {
  deriveImportProjectId,
  importLegacyProject,
  renderChatTranscript,
  scanLegacyRoot,
  ScanRootError,
  type HealthSignal,
  type ImportReport,
  type ScanReport,
} from '@linguist/legacy-migration'
import {
  LINGUIST_IPC_ERROR_CODES,
  type LinguistMigrationDisposition,
  type LinguistMigrationHealthSignal,
  type LinguistMigrationProgress,
  type LinguistMigrationProjectReport,
  type LinguistMigrationReport,
  type LinguistMigrationScanResult,
  type LinguistMigrationScannedProject,
  type LinguistMigrationVerifyCheck,
  type LinguistMigrationVerifyResult,
} from '@proma/shared'
import { getLinguistProjectService } from './project-service'

// ---------------------------------------------------------------------------
// typed errors (codes are already in the shared LINGUIST_IPC_ERROR_CODES
// catalog, so the IPC envelope passes them through unchanged)

/** Degraded sqlite runtime: migration entry is disabled, defensively. */
export class LinguistMigrationUnavailableError extends Error {
  readonly code = LINGUIST_IPC_ERROR_CODES.STORE_SQLITE_UNAVAILABLE
  constructor() {
    super('node:sqlite runtime unavailable; legacy migration is disabled (degraded mode).')
    this.name = 'LinguistMigrationUnavailableError'
  }
}

/** Invalid migration request state (no prior scan / unknown project ids / bad root). */
export class LinguistMigrationInputError extends Error {
  readonly code = LINGUIST_IPC_ERROR_CODES.INVALID_INPUT
  constructor(message: string) {
    super(message)
    this.name = 'LinguistMigrationInputError'
  }
}

export interface LinguistMigrationServiceOptions {
  /**
   * Linguist project root — the ONLY place imports write. Always the
   * project-service rootDir so migrated projects appear in the project list.
   */
  targetRoot: string
  /** false when the sqlite runtime probe degraded (service refuses defensively). */
  isAvailable: () => boolean
  /** Injectable clock (tests). Pinned per import — see importSelected. */
  now?: () => string
}

export type LinguistMigrationProgressCallback = (progress: LinguistMigrationProgress) => void

export interface LinguistMigrationImportSelection {
  projectIds: string[]
  options?: {
    externalSource?: 'copy' | 'reference'
    salvageOrphan?: boolean
  }
}

// ---------------------------------------------------------------------------
// wire projections (UI-shaped subsets; the full reports never leave main)

function toWireHealth(signal: HealthSignal): LinguistMigrationHealthSignal {
  return { severity: signal.severity, message: signal.message }
}

function toWireScanResult(report: ScanReport): LinguistMigrationScanResult {
  const projects: LinguistMigrationScannedProject[] = report.projects.map((project) => {
    const manifest = project.manifest.manifest
    return {
      projectId: project.projectId,
      name: manifest?.projectName ?? project.projectId,
      sourceLocale: manifest?.sourceLanguage ?? null,
      targetLocale: manifest?.targetLanguage ?? null,
      batches: project.batches.length,
      segments: project.batches.reduce((sum, batch) => sum + batch.segmentCount, 0),
      tmEntries: project.tm.entries,
      termEntries: project.termbase.entries,
      chatPresent: project.chat.present,
      orphan: !project.manifest.readable,
      health: project.health.map(toWireHealth),
    }
  })
  return {
    schemaVersion: report.schemaVersion,
    projects,
    // root-level signals only (project signals ride on their own entries)
    health: report.health.filter((signal) => signal.projectId === null).map(toWireHealth),
    totals: {
      projects: report.totals.projects,
      batches: report.totals.batches,
      segments: report.totals.segments,
    },
  }
}

function toWireProjectReport(report: ImportReport): Omit<LinguistMigrationProjectReport, 'verify'> {
  return {
    legacyProjectId: report.legacyProjectId,
    newProjectId: report.newProjectId,
    projectName: report.project.name,
    disposition: report.disposition,
    targetConflict: report.targetConflict,
    refusal:
      report.refusal === null
        ? null
        : {
            reason: report.refusal.reason,
            ...(report.refusal.evidence !== undefined ? { evidence: report.refusal.evidence } : {}),
          },
    totals: {
      assets: report.totals.assets,
      segments: report.totals.segments,
      tmImported: report.totals.tmImported,
      termsImported: report.totals.termsImported,
      qaOpen: report.totals.qaOpen,
      qaWaived: report.totals.qaWaived,
    },
    transcript:
      report.chat.transcript === null
        ? null
        : {
            path: report.chat.transcript.path,
            sha256: report.chat.transcript.sha256,
            sessions: report.chat.transcript.sessions,
            rows: report.chat.transcript.rows,
          },
    archivesWritten: report.archives.filter((archive) => archive.written).length,
    rollback: report.rollback,
    notes: report.notes,
  }
}

/** Import threw (e.g. LegacyProjectNotFoundError): an honest error entry; the loop continues. */
function errorProjectReport(legacyProjectId: string, err: unknown): LinguistMigrationProjectReport {
  const message = err instanceof Error ? err.message : String(err)
  return {
    legacyProjectId,
    newProjectId: deriveImportProjectId(legacyProjectId),
    projectName: legacyProjectId,
    disposition: 'error',
    targetConflict: false,
    refusal: null,
    totals: { assets: 0, segments: 0, tmImported: 0, termsImported: 0, qaOpen: 0, qaWaived: 0 },
    transcript: null,
    archivesWritten: 0,
    rollback: [],
    notes: [`import failed: ${message}`],
    verify: { status: 'skipped', checks: [] },
  }
}

function countByDisposition(
  projects: LinguistMigrationProjectReport[],
): Record<LinguistMigrationDisposition, number> {
  const counts: Record<LinguistMigrationDisposition, number> = {
    imported: 0,
    partial: 0,
    'archived-only': 0,
    quarantined: 0,
    error: 0,
  }
  for (const project of projects) counts[project.disposition] += 1
  return counts
}

function sha256Hex(bytes: Uint8Array | string): string {
  return createHash('sha256').update(bytes).digest('hex')
}

// ---------------------------------------------------------------------------
// service

export class LinguistMigrationService {
  private readonly targetRoot: string
  private readonly isAvailable: () => boolean
  private readonly now: () => string
  /** Session state: the last scanned legacy root (renderer never re-submits it). */
  private lastScan: { root: string; report: ScanReport } | null = null

  constructor(options: LinguistMigrationServiceOptions) {
    this.targetRoot = options.targetRoot
    this.isAvailable = options.isAvailable
    this.now = options.now ?? (() => new Date().toISOString())
  }

  /** Defensive degraded-mode gate (also called by the IPC layer BEFORE the picker). */
  assertAvailable(): void {
    if (!this.isAvailable()) throw new LinguistMigrationUnavailableError()
  }

  /**
   * Scan a picker-chosen legacy root and retain it as the session scan.
   * ScanRootError (no data/ subdirectory) maps to INVALID_INPUT — picking
   * the wrong directory is a user error, not an internal failure.
   */
  scanRoot(root: string): LinguistMigrationScanResult & { rootPath: string } {
    this.assertAvailable()
    if (typeof root !== 'string' || root.length === 0) {
      throw new LinguistMigrationInputError('legacy root must be a non-empty directory path')
    }
    let report: ScanReport
    try {
      report = scanLegacyRoot({ root })
    } catch (err) {
      if (err instanceof ScanRootError) {
        throw new LinguistMigrationInputError(
          `the picked directory is not a legacy data root (missing data/ subdirectory): ${root}`,
        )
      }
      throw err
    }
    this.lastScan = { root: report.root, report }
    return { ...toWireScanResult(report), rootPath: report.root }
  }

  /**
   * Import every selected project (import -> verify per project), emitting
   * progress events. Synchronous imports yield via setImmediate between
   * projects so progress events and the event loop stay alive.
   */
  async importSelected(
    selection: LinguistMigrationImportSelection,
    onProgress?: LinguistMigrationProgressCallback,
  ): Promise<LinguistMigrationReport> {
    this.assertAvailable()
    const scan = this.lastScan
    if (scan === null) {
      throw new LinguistMigrationInputError('no legacy root scanned yet; run pickAndScan first')
    }
    const knownIds = new Set(scan.report.projects.map((project) => project.projectId))
    const unknown = selection.projectIds.filter((id) => !knownIds.has(id))
    if (unknown.length > 0) {
      throw new LinguistMigrationInputError(`project ids not present in the last scan: ${unknown.join(', ')}`)
    }

    const total = selection.projectIds.length
    const projects: LinguistMigrationProjectReport[] = []
    for (const [i, legacyProjectId] of selection.projectIds.entries()) {
      // Yield between projects (a single import is synchronous; huge
      // projects still block — documented known limitation).
      await new Promise<void>((resolve) => {
        setImmediate(resolve)
      })
      const index = i + 1
      onProgress?.({ projectId: legacyProjectId, phase: 'import', index, total })
      // Pin ONE clock value per import: the transcript provenance archivedAt
      // then equals the sidecar importedAt, which verify's re-render needs.
      const importedAt = this.now()
      let report: ImportReport
      try {
        report = importLegacyProject({
          root: scan.root,
          projectId: legacyProjectId,
          targetRoot: this.targetRoot,
          now: () => importedAt,
          ...(selection.options?.externalSource !== undefined
            ? { externalSource: selection.options.externalSource }
            : {}),
          ...(selection.options?.salvageOrphan !== undefined
            ? { salvageOrphan: selection.options.salvageOrphan }
            : {}),
        })
      } catch (err) {
        // Project-level failure (not-found / unreadable payloads): record an
        // error entry and continue with the remaining projects.
        projects.push(errorProjectReport(legacyProjectId, err))
        continue
      }
      onProgress?.({ projectId: legacyProjectId, phase: 'verify', index, total })
      const projection = toWireProjectReport(report)
      projects.push({ ...projection, verify: this.verifyProject(projection) })
    }
    return { counts: countByDisposition(projects), projects }
  }

  /**
   * Verify one imported project against its report projection (also exposed
   * for tests: tamper with an artifact after import, then re-verify).
   *
   * Zero-write outcomes (quarantined, thrown imports) produce no checks at
   * all -> status 'skipped'.
   */
  verifyProject(project: Omit<LinguistMigrationProjectReport, 'verify'>): LinguistMigrationVerifyResult {
    this.assertAvailable()
    const checks: LinguistMigrationVerifyCheck[] = []

    // --- transcript re-render + byte integrity (skipped on targetConflict:
    // the conflict report's transcript plan was never written; the on-disk
    // artifact belongs to the first import) ------------------------------
    if (project.transcript !== null && !project.targetConflict) {
      const transcript = project.transcript
      const projectDir = join(this.targetRoot, 'projects', project.newProjectId)
      try {
        const sidecar = JSON.parse(readFileSync(join(projectDir, 'legacy-import.json'), 'utf8')) as Record<string, unknown>
        const legacyProjectId = typeof sidecar.legacyProjectId === 'string' ? sidecar.legacyProjectId : null
        const sourceDigest = typeof sidecar.sourceDigest === 'string' ? sidecar.sourceDigest : null
        const importedAt = typeof sidecar.importedAt === 'string' ? sidecar.importedAt : null
        const scannerVersion = typeof sidecar.scannerVersion === 'string' ? sidecar.scannerVersion : null
        if (legacyProjectId === null || sourceDigest === null || importedAt === null || scannerVersion === null) {
          throw new Error('sidecar legacy-import.json is missing provenance fields')
        }
        const chatRows: unknown = JSON.parse(
          readFileSync(join(projectDir, 'legacy-archive', 'chat', 'chat.json'), 'utf8'),
        )
        if (!Array.isArray(chatRows)) {
          throw new Error('archived chat.json is not a JSON array')
        }
        const rendered = renderChatTranscript({
          rows: chatRows,
          provenance: {
            legacyProjectId,
            sourceDigest,
            archivedAt: importedAt,
            generator: `linguist-legacy-import ${scannerVersion}`,
          },
        })
        if (rendered === null) {
          throw new Error('transcript re-render returned null (no archivable rows)')
        }
        const actual = sha256Hex(rendered.markdown)
        checks.push({
          id: 'transcript-rerender',
          ok: actual === transcript.sha256,
          detail:
            actual === transcript.sha256
              ? 're-rendered transcript sha256 matches the report'
              : `re-rendered sha256 ${actual} != report ${transcript.sha256} (archived chat.json was modified?)`,
        })
      } catch (err) {
        checks.push({
          id: 'transcript-rerender',
          ok: false,
          detail: `transcript re-render failed: ${err instanceof Error ? err.message : String(err)}`,
        })
      }
      try {
        const actual = sha256Hex(readFileSync(join(this.targetRoot, transcript.path)))
        checks.push({
          id: 'transcript-bytes',
          ok: actual === transcript.sha256,
          detail:
            actual === transcript.sha256
              ? 'archived transcript.md bytes match the report sha256'
              : `transcript.md sha256 ${actual} != report ${transcript.sha256} (file was modified after import)`,
        })
      } catch (err) {
        checks.push({
          id: 'transcript-bytes',
          ok: false,
          detail: `transcript.md unreadable: ${err instanceof Error ? err.message : String(err)}`,
        })
      }
    }

    // --- read-only store reopen + count comparison ------------------------
    try {
      const store = new CatStore({ rootDir: this.targetRoot })
      const db = store.openProject(project.newProjectId, { readOnly: true })
      try {
        const assets = db.assets.countByProject()
        const segments = db.segments.count()
        const tm = db.tmUnits.count()
        const terms = db.termEntries.count()
        const qaOpen = db.qaFindings.count({ status: 'open' })
        const qaWaived = db.qaFindings.count({ status: 'waived' })
        checks.push({
          id: 'store-assets',
          ok: assets === project.totals.assets && segments === project.totals.segments,
          detail: `assets ${String(assets)}/${String(project.totals.assets)}, segments ${String(segments)}/${String(project.totals.segments)} (actual/report)`,
        })
        checks.push({
          id: 'store-references',
          ok: tm === project.totals.tmImported && terms === project.totals.termsImported,
          detail: `tm ${String(tm)}/${String(project.totals.tmImported)}, terms ${String(terms)}/${String(project.totals.termsImported)} (actual/report)`,
        })
        checks.push({
          id: 'store-qa',
          ok: qaOpen === project.totals.qaOpen && qaWaived === project.totals.qaWaived,
          detail: `qa open ${String(qaOpen)}/${String(project.totals.qaOpen)}, waived ${String(qaWaived)}/${String(project.totals.qaWaived)} (actual/report)`,
        })
      } finally {
        db.close()
      }
    } catch (err) {
      if (!(err instanceof StoreNotFoundError)) {
        checks.push({
          id: 'store-reopen',
          ok: false,
          detail: `read-only reopen failed: ${err instanceof Error ? err.message : String(err)}`,
        })
      }
      // StoreNotFoundError: zero-write outcome (quarantined / thrown import)
      // — nothing exists to verify, so no check is emitted at all.
    }

    if (checks.length === 0) return { status: 'skipped', checks }
    return { status: checks.every((check) => check.ok) ? 'passed' : 'failed', checks }
  }
}

// ---------------------------------------------------------------------------
// lazily resolved singleton (registration precedes linguist service init;
// the project service is the source of targetRoot + degraded state)

let instance: LinguistMigrationService | undefined

export function getLinguistMigrationService(): LinguistMigrationService {
  instance ??= new LinguistMigrationService({
    targetRoot: getLinguistProjectService().rootDir,
    isAvailable: () => !getLinguistProjectService().getStatus().degraded,
  })
  return instance
}
