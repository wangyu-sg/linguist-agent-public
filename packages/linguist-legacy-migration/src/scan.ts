/**
 * Legacy data-root scanner (PB-090).
 *
 * Reads a COPY of a legacy runtime root (<root>/data/...) and produces a
 * ScanReport: project list, health signals, source roots, managed uploads,
 * assets, segments, TM/TB, proposals, chat presence, unsupported fields and
 * per-project digests. The scanner is strictly read-only: no write APIs are
 * imported, SQLite is opened read-only (sqlite-probe.ts), and nothing in the
 * scanned tree is created, modified or deleted.
 *
 * The scanner outputs SIGNALS ONLY. Disposition decisions (six-situation
 * handling, quarantine) belong to PB-091/PB-092.
 */

import { createHash } from 'node:crypto'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import {
  AGENT_SELECTED_SESSION_FILE,
  AGENT_SETTINGS_FILE,
  BATCHES_DIR,
  BATCH_FILE,
  CAT_CORE_BLOBS_REL,
  CHAT_FILE,
  KNOWN_PROJECT_DIRS,
  KNOWN_PROJECT_FILES,
  PROJECTS_REL,
  PROJECT_MANIFEST,
  PROPOSALS_DIR,
  REPORTS_DIR,
  RUNTIME_DATA_SCHEMA_VERSION,
  SCHEMA_MARKER_REL,
  TERMBASE_FILE,
  TERMBASE_OVERRIDES_FILE,
  TM_AUDIT_FILE,
  TM_FILE,
  UPLOADS_DIR,
} from './layout'
import {
  countArrayEntries,
  countChatEntries,
  countJsonlLines,
  decodeManifest,
  probeAgentSettings,
  summarizeBatch,
  type BatchSummary,
  type MinimalManifest,
  type UnsupportedField,
} from './model'
import { listReadCacheBatchIds, probeCatCore, readCacheJson, type DataSource } from './sqlite-probe'

export type { DataSource, UnsupportedField }

// ---------------------------------------------------------------------------
// report model

export type HealthSeverity = 'info' | 'warning' | 'error'

export interface HealthSignal {
  code:
    | 'sqlite-authority-active'
    | 'sqlite-db-missing'
    | 'sqlite-unreadable'
    | 'sqlite-legacy-divergence'
    | 'read-cache-missing-projection'
    | 'orphan-project'
    | 'orphan-sqlite-project'
    | 'project-id-mismatch'
    | 'root-missing'
    | 'external-root-with-managed-uploads'
    | 'internal-copy-only'
    | 'invalid-permission-mode'
    | 'file-unreadable'
  severity: HealthSeverity
  projectId: string | null
  message: string
  evidence?: Record<string, unknown>
}

export interface FileDigest {
  relPath: string
  sha256: string
  bytes: number
}

export interface ManifestScan {
  source: DataSource
  readable: boolean
  /** Decode error detail when unreadable (parse failure, non-object). */
  error: string | null
  manifest: MinimalManifest | null
}

export interface SourceRootScan {
  /** manifest.root (external source root absolute path); null when unknown. */
  path: string | null
  /** true when path stats as an existing directory. */
  exists: boolean
  statError: string | null
}

export interface UploadsScan {
  present: boolean
  files: number
  bytes: number
  names: string[]
}

export interface BatchScan extends BatchSummary {
  source: DataSource
  proposals: number
  reports: number
}

export interface TmScan {
  source: DataSource
  present: boolean
  entries: number | null
  auditLines: number | null
}

export interface TermbaseScan {
  source: DataSource
  present: boolean
  entries: number | null
  overrides: number | null
}

export interface ChatScan {
  present: boolean
  entries: number | null
  selectedSession: boolean
}

export interface ProjectScan {
  projectId: string
  dir: string
  manifest: ManifestScan
  sourceRoot: SourceRootScan
  assets: { count: number; byRole: Record<string, number> }
  uploads: UploadsScan
  batches: BatchScan[]
  tm: TmScan
  termbase: TermbaseScan
  chat: ChatScan
  unsupportedFields: UnsupportedField[]
  health: HealthSignal[]
  /** sha256 over JSON of the sorted [relPath, sha256, bytes] digest list. */
  digest: string
  digestFiles: FileDigest[]
}

export interface SchemaMarkerInfo {
  schemaVersion: number | null
  migratedAt: string | null
  backupId: string | null
}

export interface ScanReport {
  tool: 'linguist-legacy-scan'
  /** Report format version. */
  version: 1
  generatedAt: string
  root: string
  dataDir: string
  /** 2 when data/.schema.json exists, else 1 (legacy version oracle). */
  schemaVersion: 1 | 2
  schemaMarker: SchemaMarkerInfo | null
  sqlite: {
    authority: boolean
    dbPresent: boolean
    dbSha256: string | null
    dbBytes: number | null
    opened: boolean
    error: string | null
    projectIds: string[]
    blobStore: { present: boolean; blobs: number; bytes: number }
  }
  projects: ProjectScan[]
  /** SQLite manifest projections without a project directory (reverse orphans). */
  sqliteOnlyProjects: string[]
  /** Rollup of every project signal plus root-level signals. */
  health: HealthSignal[]
  totals: {
    projects: number
    batches: number
    segments: number
    lockedSegments: number
    tmEntries: number
    termbaseEntries: number
    uploads: number
    unsupportedFields: number
  }
}

export class ScanRootError extends Error {
  readonly code = 'SCAN_ROOT_NOT_FOUND'
  constructor(message: string) {
    super(message)
    this.name = 'ScanRootError'
  }
}

// ---------------------------------------------------------------------------
// small fs helpers (all read-only)

function readJsonFile(path: string): { value: unknown | null; error: string | null } {
  let raw: string
  try {
    raw = readFileSync(path, 'utf8')
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return { value: null, error: null }
    return { value: null, error: `read failed: ${err instanceof Error ? err.message : String(err)}` }
  }
  try {
    return { value: JSON.parse(raw) as unknown, error: null }
  } catch (err) {
    return { value: null, error: `invalid JSON: ${err instanceof Error ? err.message : String(err)}` }
  }
}

function listDirs(path: string): string[] {
  try {
    return readdirSync(path, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort()
  } catch {
    return []
  }
}

function listFiles(path: string): string[] {
  try {
    return readdirSync(path, { withFileTypes: true })
      .filter((entry) => entry.isFile())
      .map((entry) => entry.name)
      .sort()
  } catch {
    return []
  }
}

function digestFile(path: string): FileDigest | null {
  try {
    const bytes = readFileSync(path)
    return { relPath: path, sha256: createHash('sha256').update(bytes).digest('hex'), bytes: bytes.length }
  } catch {
    return null
  }
}

/**
 * sha256 over JSON of the sorted [relPath, sha256, bytes] digest list
 * (PB-090 project digest algorithm; PB-091 reuses it for the import
 * sidecar/report source digest).
 */
export function projectDigest(files: FileDigest[]): string {
  const sorted = [...files].sort((a, b) => (a.relPath < b.relPath ? -1 : a.relPath > b.relPath ? 1 : 0))
  const triples = sorted.map((f) => [f.relPath, f.sha256, f.bytes])
  return createHash('sha256').update(JSON.stringify(triples)).digest('hex')
}

/**
 * Digest evidence files of one legacy project directory (PB-090 file set):
 * project.json, tm.json, termbase.json, chat.json, batches/<id>/batch.json
 * (legacy directory listing), uploads/<file> (direct children). Sorted by
 * relPath. Exported for the PB-091 importer so sidecar digests are
 * byte-identical to scanner digests of the same tree.
 */
export function collectProjectDigestFiles(dir: string): FileDigest[] {
  const digestFiles: FileDigest[] = []
  for (const rel of [PROJECT_MANIFEST, TM_FILE, TERMBASE_FILE, CHAT_FILE]) {
    const file = digestFile(join(dir, rel))
    if (file) digestFiles.push({ ...file, relPath: rel })
  }
  for (const batchId of listDirs(join(dir, BATCHES_DIR))) {
    const file = digestFile(join(dir, BATCHES_DIR, batchId, BATCH_FILE))
    if (file) digestFiles.push({ ...file, relPath: `${BATCHES_DIR}/${batchId}/${BATCH_FILE}` })
  }
  const uploadsDir = join(dir, UPLOADS_DIR)
  for (const name of listFiles(uploadsDir)) {
    const file = digestFile(join(uploadsDir, name))
    if (file) digestFiles.push({ ...file, relPath: `${UPLOADS_DIR}/${name}` })
  }
  return digestFiles.sort((a, b) => (a.relPath < b.relPath ? -1 : 1))
}

export function walkBlobStore(root: string): { present: boolean; blobs: number; bytes: number } {
  const base = join(root, CAT_CORE_BLOBS_REL)
  if (!existsSync(base)) return { present: false, blobs: 0, bytes: 0 }
  let blobs = 0
  let bytes = 0
  const stack = [base]
  while (stack.length > 0) {
    const dir = stack.pop()!
    let entries
    try {
      entries = readdirSync(dir, { withFileTypes: true })
    } catch {
      continue
    }
    for (const entry of entries) {
      const path = join(dir, entry.name)
      if (entry.isDirectory()) stack.push(path)
      else if (entry.isFile()) {
        blobs++
        try {
          bytes += statSync(path).size
        } catch {
          // size unknown; count stands
        }
      }
    }
  }
  return { present: true, blobs, bytes }
}

// ---------------------------------------------------------------------------
// per-project scan

interface ProjectContext {
  root: string
  authority: boolean
  sqlite: ReturnType<typeof probeCatCore>
  health: HealthSignal[]
  unsupported: UnsupportedField[]
}

function signal(ctx: ProjectContext, s: HealthSignal): void {
  ctx.health.push(s)
}

/** Resolve one domain value through the authority -> read-cache -> legacy chain. */
function resolveDomainValue(
  ctx: ProjectContext,
  kind: 'manifest' | 'tm' | 'termbase',
  projectId: string,
  legacyPath: string,
): { value: unknown | null; source: DataSource; legacyValue: unknown | null; legacyError: string | null } {
  const legacy = readJsonFile(legacyPath)
  if (ctx.authority) {
    if (ctx.sqlite.opened) {
      const value = ctx.sqlite.read(kind, projectId)
      if (value !== null && value !== undefined) return { value, source: 'sqlite', legacyValue: legacy.value, legacyError: legacy.error }
    }
    const cached = readCacheJson(ctx.root, kind, projectId)
    if (cached.value !== null) return { value: cached.value, source: 'read-cache', legacyValue: legacy.value, legacyError: legacy.error }
    signal(ctx, {
      code: 'read-cache-missing-projection',
      severity: 'warning',
      projectId,
      message: `SQLite authority is active but no ${kind} projection is available (sqlite unreadable or projection absent; read-cache miss: ${cached.error ?? 'n/a'}).`,
    })
    return { value: null, source: 'none', legacyValue: legacy.value, legacyError: legacy.error }
  }
  if (legacy.error !== null) return { value: null, source: 'none', legacyValue: null, legacyError: legacy.error }
  return { value: legacy.value, source: legacy.value === null ? 'none' : 'legacy-json', legacyValue: legacy.value, legacyError: null }
}

function scanProject(root: string, projectId: string, ctx: ProjectContext): ProjectScan {
  const dir = join(root, PROJECTS_REL, projectId)

  // --- unsupported top-level entries (unknown project files/dirs) ----------
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!KNOWN_PROJECT_DIRS.has(entry.name)) {
        ctx.unsupported.push({ scope: 'project-files', path: `${entry.name}/`, detail: 'unknown project directory' })
      }
    } else if (entry.isFile() && !KNOWN_PROJECT_FILES.has(entry.name)) {
      ctx.unsupported.push({ scope: 'project-files', path: entry.name, detail: 'unknown project file' })
    }
  }

  // --- manifest -------------------------------------------------------------
  const manifestResolution = resolveDomainValue(ctx, 'manifest', projectId, join(dir, PROJECT_MANIFEST))
  const manifestUnsupported: UnsupportedField[] = []
  let manifest: MinimalManifest | null = null
  let manifestError: string | null = null
  if (manifestResolution.value !== null) {
    manifest = decodeManifest(manifestResolution.value, manifestUnsupported)
    if (manifest === null) manifestError = 'manifest is not a JSON object'
  } else if (manifestResolution.source === 'none') {
    manifestError = manifestResolution.legacyError
  }
  ctx.unsupported.push(...manifestUnsupported)
  const manifestReadable = manifest !== null
  if (!manifestReadable) {
    // Mirrors legacy projects_index.ts project_manifest_unreadable:
    // missing => warning, unparsable => error.
    const missing = manifestResolution.source === 'none' && manifestResolution.legacyError === null
    signal(ctx, {
      code: 'orphan-project',
      severity: missing ? 'warning' : 'error',
      projectId,
      message: missing
        ? 'Project directory exists but no readable manifest was found in any layer (project_manifest_unreadable: missing).'
        : `Project directory exists but its manifest is unreadable (project_manifest_unreadable: ${manifestError ?? 'unknown error'}).`,
      evidence: { source: manifestResolution.source, error: manifestError },
    })
  }

  // sqlite/legacy divergence (cheap triple compare; both layers must have parsed)
  if (manifestResolution.source === 'sqlite' && manifestResolution.legacyValue !== null) {
    const legacyManifest = decodeManifest(manifestResolution.legacyValue, [])
    if (legacyManifest && manifest) {
      const diverged =
        legacyManifest.projectId !== manifest.projectId ||
        legacyManifest.root !== manifest.root ||
        legacyManifest.updatedAt !== manifest.updatedAt
      if (diverged) {
        signal(ctx, {
          code: 'sqlite-legacy-divergence',
          severity: 'warning',
          projectId,
          message: 'SQLite manifest and legacy project.json differ (projectId/root/updatedAt); SQLite is authoritative.',
          evidence: {
            sqlite: { projectId: manifest.projectId, root: manifest.root, updatedAt: manifest.updatedAt },
            legacy: { projectId: legacyManifest.projectId, root: legacyManifest.root, updatedAt: legacyManifest.updatedAt },
          },
        })
      }
    }
  }

  if (manifest?.projectId && manifest.projectId !== projectId) {
    signal(ctx, {
      code: 'project-id-mismatch',
      severity: 'info',
      projectId,
      message: `Manifest projectId ${JSON.stringify(manifest.projectId)} differs from directory name.`,
      evidence: { manifestProjectId: manifest.projectId },
    })
  }

  // --- source root ----------------------------------------------------------
  let sourceRoot: SourceRootScan = { path: null, exists: false, statError: null }
  if (manifest?.root) {
    try {
      sourceRoot = { path: manifest.root, exists: statSync(manifest.root).isDirectory(), statError: null }
    } catch (err) {
      sourceRoot = { path: manifest.root, exists: false, statError: (err as NodeJS.ErrnoException).code ?? String(err) }
    }
    if (!sourceRoot.exists) {
      // The legacy scanProjectFolder throws ENOENT here; the scanner degrades
      // to a workspace-only scan instead.
      signal(ctx, {
        code: 'root-missing',
        severity: 'warning',
        projectId,
        message: `Manifest root ${JSON.stringify(manifest.root)} is not accessible; scanning workspace copy only.`,
        evidence: { root: manifest.root, statError: sourceRoot.statError },
      })
    }
  }

  // --- managed uploads (durable source copies) -------------------------------
  const uploadsDir = join(dir, UPLOADS_DIR)
  const uploadNames = listFiles(uploadsDir)
  let uploadBytes = 0
  for (const name of uploadNames) {
    try {
      uploadBytes += statSync(join(uploadsDir, name)).size
    } catch {
      // counted without size
    }
  }
  const uploads: UploadsScan = {
    present: uploadNames.length > 0,
    files: uploadNames.length,
    bytes: uploadBytes,
    names: uploadNames,
  }

  // copy-location signals (both-sides vs internal-only)
  if (sourceRoot.path !== null && sourceRoot.exists && uploads.present) {
    signal(ctx, {
      code: 'external-root-with-managed-uploads',
      severity: 'info',
      projectId,
      message: 'External source root exists AND managed uploads/ copies are present (copies on both sides).',
      evidence: { root: sourceRoot.path, uploads: uploads.files },
    })
  }

  // --- batches ---------------------------------------------------------------
  const batchIds = new Set<string>()
  const legacyBatchIds = listDirs(join(dir, BATCHES_DIR))
  for (const id of legacyBatchIds) batchIds.add(id)
  const sqliteBatches = ctx.authority && ctx.sqlite.opened ? ctx.sqlite.listBatches(projectId) : []
  for (const value of sqliteBatches) {
    const id = (value as { batchId?: unknown }).batchId
    if (typeof id === 'string') batchIds.add(id)
  }
  const readCacheBatchIds = ctx.authority ? listReadCacheBatchIds(ctx.root, projectId) : []
  for (const id of readCacheBatchIds) batchIds.add(id)

  const batches: BatchScan[] = []
  for (const batchId of [...batchIds].sort()) {
    let value: unknown | null = null
    let source: DataSource = 'none'
    if (ctx.authority) {
      if (ctx.sqlite.opened) {
        value = ctx.sqlite.read('batch', projectId, batchId)
        if (value !== null) source = 'sqlite'
      }
      if (value === null) {
        const cached = readCacheJson(ctx.root, 'batch', projectId, batchId)
        if (cached.value !== null) {
          value = cached.value
          source = 'read-cache'
        } else if (!legacyBatchIds.includes(batchId)) {
          signal(ctx, {
            code: 'read-cache-missing-projection',
            severity: 'warning',
            projectId,
            message: `Batch ${batchId} has no SQLite/read-cache projection and no legacy batch.json.`,
          })
        }
      }
    } else {
      const legacy = readJsonFile(join(dir, BATCHES_DIR, batchId, BATCH_FILE))
      if (legacy.error !== null) {
        signal(ctx, {
          code: 'file-unreadable',
          severity: 'error',
          projectId,
          message: `batches/${batchId}/batch.json: ${legacy.error}`,
        })
      }
      value = legacy.value
      source = value === null ? 'none' : 'legacy-json'
    }
    const batchUnsupported: UnsupportedField[] = []
    const summary = value !== null ? summarizeBatch(value, `batches/${batchId}/batch.json`, batchUnsupported) : null
    ctx.unsupported.push(...batchUnsupported)
    const proposals = listFiles(join(dir, BATCHES_DIR, batchId, PROPOSALS_DIR)).filter((n) => n.endsWith('.json')).length
    const reports = listFiles(join(dir, BATCHES_DIR, batchId, REPORTS_DIR)).filter((n) => n.endsWith('.md')).length
    batches.push({
      batchId,
      format: summary?.format ?? null,
      sourceFile: summary?.sourceFile ?? null,
      segmentCount: summary?.segmentCount ?? 0,
      lockedCount: summary?.lockedCount ?? 0,
      statusCounts: summary?.statusCounts ?? {},
      source,
      proposals,
      reports,
    })
  }

  // --- TM / TB ---------------------------------------------------------------
  const tmResolution = resolveDomainValue(ctx, 'tm', projectId, join(dir, TM_FILE))
  const tmEntries = tmResolution.value !== null ? countArrayEntries(tmResolution.value) : null
  if (tmResolution.value !== null && tmEntries === null) {
    signal(ctx, { code: 'file-unreadable', severity: 'error', projectId, message: 'tm payload is not a JSON array.' })
  }
  if (tmResolution.legacyError !== null && !ctx.authority) {
    signal(ctx, { code: 'file-unreadable', severity: 'error', projectId, message: `tm.json: ${tmResolution.legacyError}` })
  }
  const tmAuditPath = join(dir, TM_AUDIT_FILE)
  let tmAuditLines: number | null = null
  if (existsSync(tmAuditPath)) {
    try {
      tmAuditLines = countJsonlLines(readFileSync(tmAuditPath, 'utf8'))
    } catch {
      tmAuditLines = null
    }
  }
  const tm: TmScan = {
    source: tmResolution.source,
    present: tmResolution.value !== null,
    entries: tmEntries,
    auditLines: tmAuditLines,
  }

  const tbResolution = resolveDomainValue(ctx, 'termbase', projectId, join(dir, TERMBASE_FILE))
  const tbEntries = tbResolution.value !== null ? countArrayEntries(tbResolution.value) : null
  if (tbResolution.value !== null && tbEntries === null) {
    signal(ctx, { code: 'file-unreadable', severity: 'error', projectId, message: 'termbase payload is not a JSON array.' })
  }
  if (tbResolution.legacyError !== null && !ctx.authority) {
    signal(ctx, { code: 'file-unreadable', severity: 'error', projectId, message: `termbase.json: ${tbResolution.legacyError}` })
  }
  // termbase_overrides.json stays file-based in the legacy layout (not a SQLite projection).
  const overridesJson = readJsonFile(join(dir, TERMBASE_OVERRIDES_FILE))
  const termbase: TermbaseScan = {
    source: tbResolution.source,
    present: tbResolution.value !== null,
    entries: tbEntries,
    overrides: overridesJson.value !== null ? countArrayEntries(overridesJson.value) : null,
  }

  // --- chat presence (existence + entry count only; no session validation) ---
  const chatJson = readJsonFile(join(dir, CHAT_FILE))
  const chatEntries = chatJson.value !== null ? countChatEntries(chatJson.value) : null
  if (chatJson.error !== null) {
    signal(ctx, { code: 'file-unreadable', severity: 'error', projectId, message: `chat.json: ${chatJson.error}` })
  } else if (chatJson.value !== null && chatEntries === null) {
    signal(ctx, { code: 'file-unreadable', severity: 'error', projectId, message: 'chat.json is not a JSON array.' })
  }
  const chat: ChatScan = {
    present: chatJson.value !== null || chatJson.error !== null,
    entries: chatEntries,
    selectedSession: existsSync(join(dir, AGENT_SELECTED_SESSION_FILE)),
  }

  // --- agent settings (plain JSON; invalid values never abort the scan) ------
  const settingsJson = readJsonFile(join(dir, AGENT_SETTINGS_FILE))
  if (settingsJson.error !== null) {
    signal(ctx, { code: 'file-unreadable', severity: 'error', projectId, message: `agent_settings.json: ${settingsJson.error}` })
  }
  if (settingsJson.value !== null) {
    const probe = probeAgentSettings(settingsJson.value, ctx.unsupported)
    if (probe.invalidPermissionMode) {
      signal(ctx, {
        code: 'invalid-permission-mode',
        severity: 'warning',
        projectId,
        message: `agent_settings.json permissionMode ${JSON.stringify(probe.permissionMode)} is not supported (ask | auto | custom); recorded, scan continues.`,
        evidence: { permissionMode: probe.permissionMode },
      })
    }
  }

  // --- internal-copy-only needs the blob-store fact; filled in by caller -----

  // --- digest (PB-090 file set; shared with the PB-091 importer) ------------
  const digestFiles = collectProjectDigestFiles(dir)

  // --- assets (from manifest scan snapshot) -----------------------------------
  const byRole: Record<string, number> = {}
  for (const asset of manifest?.scanAssets ?? []) {
    const role = asset.role ?? 'unknown'
    byRole[role] = (byRole[role] ?? 0) + 1
  }

  return {
    projectId,
    dir,
    manifest: {
      source: manifestResolution.source,
      readable: manifestReadable,
      error: manifestError,
      manifest,
    },
    sourceRoot,
    assets: { count: manifest?.scanAssets.length ?? 0, byRole },
    uploads,
    batches,
    tm,
    termbase,
    chat,
    unsupportedFields: [],
    health: [],
    digest: projectDigest(digestFiles),
    digestFiles: digestFiles.sort((a, b) => (a.relPath < b.relPath ? -1 : 1)),
  }
}

// ---------------------------------------------------------------------------
// root scan

export interface ScanOptions {
  /** Legacy runtime root (the directory CONTAINING data/), e.g. a copied snapshot. */
  root: string
  /** Injectable clock for deterministic reports. */
  now?: () => string
}

export function scanLegacyRoot(options: ScanOptions): ScanReport {
  const root = resolve(options.root)
  const dataDir = join(root, 'data')
  if (!existsSync(dataDir)) {
    throw new ScanRootError(`legacy data directory not found: ${dataDir} (--root must point at the runtime root containing data/)`)
  }

  // version oracle: data/.schema.json (present => v2, absent => v1)
  const markerPath = join(root, SCHEMA_MARKER_REL)
  let schemaVersion: 1 | 2 = 1
  let schemaMarker: SchemaMarkerInfo | null = null
  if (existsSync(markerPath)) {
    schemaVersion = RUNTIME_DATA_SCHEMA_VERSION as 2
    const marker = readJsonFile(markerPath)
    if (marker.value !== null && typeof marker.value === 'object' && !Array.isArray(marker.value)) {
      const row = marker.value as Record<string, unknown>
      schemaMarker = {
        schemaVersion: typeof row.schemaVersion === 'number' ? row.schemaVersion : null,
        migratedAt: typeof row.migratedAt === 'string' ? row.migratedAt : null,
        backupId: typeof row.backupId === 'string' ? row.backupId : null,
      }
    }
  }

  const sqlite = probeCatCore(root)
  const rootHealth: HealthSignal[] = []
  try {
    if (sqlite.authority) {
      rootHealth.push({
        code: 'sqlite-authority-active',
        severity: 'info',
        projectId: null,
        message: 'authority-v1.json present: SQLite cat-core is authoritative; legacy JSON is dead to the old runtime.',
      })
      if (!sqlite.dbPresent) {
        rootHealth.push({
          code: 'sqlite-db-missing',
          severity: 'error',
          projectId: null,
          message: 'authority marker present but cat-core.sqlite is missing.',
        })
      } else if (!sqlite.opened || sqlite.error !== null) {
        rootHealth.push({
          code: 'sqlite-unreadable',
          severity: 'error',
          projectId: null,
          message: `cat-core.sqlite could not be read: ${sqlite.error ?? 'open failed'}`,
        })
      }
    }

    const blobStore = walkBlobStore(root)
    const projectIds = listDirs(join(root, PROJECTS_REL))

    const projects: ProjectScan[] = []
    for (const projectId of projectIds) {
      const ctx: ProjectContext = { root, authority: sqlite.authority, sqlite, health: [], unsupported: [] }
      const scan = scanProject(root, projectId, ctx)
      // internal-copy-only: root gone but durable copies survive in workspace
      if (scan.sourceRoot.path !== null && !scan.sourceRoot.exists && (scan.uploads.present || blobStore.blobs > 0)) {
        ctx.health.push({
          code: 'internal-copy-only',
          severity: 'warning',
          projectId,
          message: 'Manifest root is gone; only internal copies survive (uploads/ and/or blob-store).',
          evidence: { uploads: scan.uploads.files, blobStoreBlobs: blobStore.blobs },
        })
      }
      scan.health = ctx.health
      scan.unsupportedFields = ctx.unsupported
      rootHealth.push(...ctx.health)
      projects.push(scan)
    }

    const dirSet = new Set(projectIds)
    const sqliteOnlyProjects = sqlite.projectIds.filter((id) => !dirSet.has(id))
    for (const id of sqliteOnlyProjects) {
      rootHealth.push({
        code: 'orphan-sqlite-project',
        severity: 'warning',
        projectId: id,
        message: 'SQLite cat-core has a manifest projection for this project, but data/projects/ has no such directory.',
      })
    }

    const totals = {
      projects: projects.length,
      batches: projects.reduce((n, p) => n + p.batches.length, 0),
      segments: projects.reduce((n, p) => n + p.batches.reduce((m, b) => m + b.segmentCount, 0), 0),
      lockedSegments: projects.reduce((n, p) => n + p.batches.reduce((m, b) => m + b.lockedCount, 0), 0),
      tmEntries: projects.reduce((n, p) => n + (p.tm.entries ?? 0), 0),
      termbaseEntries: projects.reduce((n, p) => n + (p.termbase.entries ?? 0), 0),
      uploads: projects.reduce((n, p) => n + p.uploads.files, 0),
      unsupportedFields: projects.reduce((n, p) => n + p.unsupportedFields.length, 0),
    }

    return {
      tool: 'linguist-legacy-scan',
      version: 1,
      generatedAt: (options.now ?? (() => new Date().toISOString()))(),
      root,
      dataDir,
      schemaVersion,
      schemaMarker,
      sqlite: {
        authority: sqlite.authority,
        dbPresent: sqlite.dbPresent,
        dbSha256: sqlite.dbSha256,
        dbBytes: sqlite.dbBytes,
        opened: sqlite.opened,
        error: sqlite.error,
        projectIds: sqlite.projectIds,
        blobStore,
      },
      projects,
      sqliteOnlyProjects,
      health: rootHealth,
      totals,
    }
  } finally {
    sqlite.close()
  }
}
