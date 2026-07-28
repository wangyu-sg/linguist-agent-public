/**
 * Legacy project extractor (PB-091): full-field reads of ONE legacy project
 * from a COPY of a legacy runtime root (<root>/data/projects/<projectId>).
 *
 * Each cat-core domain (manifest / batch / tm / termbase) is resolved through
 * the same authority -> read-cache -> legacy JSON chain as the PB-090 scanner
 * (sqlite-probe.ts), so cutover projects import their authoritative SQLite
 * projection instead of dead legacy JSON. Governance-side payloads
 * (delivery_qa reports, quality_decision_ledger.jsonl, proposals, exports,
 * term_history.json) are file-based per the legacy layout (governance SQLite
 * projections are not consulted — see PB-091 known limitations).
 *
 * Strictly read-only: nothing in the scanned tree is created, modified or
 * deleted; SQLite is opened read-only via probeCatCore().
 *
 * PB-092 additions: chat carriers (chat.json bytes, _pi_sessions manifest,
 * agent_events presence), cat-core source_refs projections (CAS blob-store
 * fallback evidence), the agent_settings probe and the inline health-signal
 * echo that feeds ImportReport.signals. A missing project directory is
 * tolerated under `allowMissingDir` so the importer can quarantine
 * orphan-sqlite projects with full layer evidence.
 *
 * Provenance — shapes lifted from frozen legacy-repo SOURCE (read-only):
 * - docs/roadmap/LEGACY_MIGRATION_CONTRACTS.md §5-§9, §12, §14 (new repo).
 * - linguist-agent/packages/cat-data/src/batch_workspace.ts:38-86 —
 *   CatBatch / BatchSegment field sets (schemaVersion 1).
 * - linguist-agent/packages/cat-data/src/tm.ts:7-22 — TmEntry (bare array).
 * - linguist-agent/packages/cat-data/src/termbase.ts:14-37 — TermbaseEntry /
 *   TermbaseOverride; SQLite/read-cache shape {entries, overrides} vs legacy
 *   two-file shape termbase.json + termbase_overrides.json.
 * - linguist-agent/packages/cat-data/src/term_history.ts:17-63 —
 *   TermHistoryIndex {rows, decisions} (term_history.json).
 * - linguist-agent/packages/cat-data/src/delivery_qa.ts:25-47 —
 *   DeliveryQaReport / DeliveryQaFinding (delivery_qa/<reportId>.json).
 * - linguist-agent/packages/cat-data/src/quality_decision_ledger.ts:73-89 —
 *   ledger chain validation rules (sequence/previousHash/hash).
 * - linguist-agent/packages/cat-server/src/server.ts:3478-3495 — uploads are
 *   stored as `<Date.now()>-<safeName>` (drives the suffix-match rule).
 * - linguist-agent/packages/cat-data/src/legacy_task_backfill.ts:148-170,
 *   378-391, 466-483 — chat.json row shape {ts, kind, text, sessionId?...};
 *   rows without sessionId = malformed_chat_session; agent_events.jsonl =
 *   hidden_reasoning_trace (excluded, never imported); _pi_sessions/*.jsonl
 *   = internal_pi_session (PB-093: archived byte-verbatim, never parsed —
 *   the extract keeps sha256 + a byte reference for the importer).
 */

import { createHash } from 'node:crypto'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import {
  AGENT_EVENTS_FILE,
  AGENT_SELECTED_SESSION_FILE,
  AGENT_SETTINGS_FILE,
  BATCHES_DIR,
  BATCH_FILE,
  CHAT_FILE,
  DELIVERY_QA_DIR,
  EXPORTS_DIR,
  PI_SESSIONS_DIR,
  PROJECTS_REL,
  PROJECT_MANIFEST,
  PROPOSALS_DIR,
  QUALITY_DECISION_LEDGER_FILE,
  REPORTS_DIR,
  TERMBASE_FILE,
  TERMBASE_OVERRIDES_FILE,
  TERM_HISTORY_FILE,
  TM_FILE,
  UPLOADS_DIR,
  projectDirOf,
} from './layout'
import { countJsonlLines, probeAgentSettings, type UnsupportedField } from './model'
import {
  collectProjectDigestFiles,
  projectDigest,
  ScanRootError,
  walkBlobStore,
  type FileDigest,
  type HealthSignal,
} from './scan'
import {
  listReadCacheBatchIds,
  probeCatCore,
  readCacheJson,
  type CatCoreSourceRefInfo,
  type DataSource,
} from './sqlite-probe'

export type { DataSource }

// ---------------------------------------------------------------------------
// extraction model

/** One file captured verbatim (bytes hashed, content archived by the importer). */
export interface ExtractedFile {
  /** Project-dir-relative path (posix separators). */
  relPath: string
  absPath: string
  bytes: number
  sha256: string
}

export interface ExtractedUpload {
  name: string
  bytes: number
  mtimeMs: number
}

export interface ExtractedBatch {
  batchId: string
  source: DataSource
  /** Raw CatBatch record; null when unreadable/absent (error carries detail). */
  value: Record<string, unknown> | null
  error: string | null
  /**
   * cat-core source_refs for ownerKind 'batch' (SQLite layer only, no
   * read-cache fallback); the PB-092 CAS blob-store fallback evidence.
   */
  sourceRefs: CatCoreSourceRefInfo[]
  /** Raw proposal-set JSON files (batches/<id>/proposals/*.json, file-based). */
  proposals: ExtractedFile[]
  /** Rendered proposal report names (batches/<id>/reports/*.md) — not carried. */
  reportFiles: string[]
}

export interface ExtractedDeliveryQaReport {
  fileName: string
  reportId: string | null
  batchId: string | null
  generatedAt: string | null
  /** Raw DeliveryQaFinding records. */
  findings: Record<string, unknown>[]
  error: string | null
}

export interface ExtractedLedger {
  present: boolean
  /** Verbatim file text (archived by the importer); null when absent. */
  raw: string | null
  events: Record<string, unknown>[]
  /** Hash-chain validation result (verify-only; hashes are never recomputed for storage). */
  valid: boolean
  error: string | null
}

export interface ExtractedTermHistory {
  present: boolean
  /** Raw TermHistoryDecision records (term_history.json decisions[]). */
  decisions: Record<string, unknown>[]
  error: string | null
}

// ---------------------------------------------------------------------------
// chat carriers (PB-092 decision 5, extended by PB-093)
// Provenance: linguist-agent/packages/cat-data/src/legacy_task_backfill.ts
// - chat.json = user-visible history candidate (bytes archived verbatim; the
//   parsed rows are retained for the PB-093 read-only transcript render).
// - _pi_sessions/*.jsonl = internal_pi_session: PB-093 archives the bytes
//   VERBATIM under legacy-archive/chat/pi-sessions/ (never parsed, never
//   rendered — rendering them would contradict the "no executable session"
//   ticket intent); the extract keeps sha256 + a byte reference so the
//   importer writes exactly the bytes that were hashed. The files may
//   contain hidden thinking content; they are the user's own data and are
//   preserved intact (accepted onto the new disk).
// - agent_events.jsonl = hidden_reasoning_trace, "excluded": presence only,
//   NEVER imported and never archived.

export interface ExtractedChatSession {
  /** File name inside _pi_sessions/ (no directory components). */
  name: string
  /** Non-blank JSONL line count. */
  lines: number
  bytes: number
  /** sha256 of `content` (hex). */
  sha256: string
  /** Raw bytes retained for byte-verbatim archival (PB-093); never parsed. */
  content: Buffer
}

export interface ExtractedChat {
  /** chat.json raw bytes (archived verbatim by the importer); null when absent/unreadable. */
  chatJson: ExtractedFile | null
  /** Decoded entry count; null when absent, unreadable or not a JSON array. */
  entries: number | null
  /**
   * Parsed chat.json rows retained for the PB-093 transcript render; null
   * when absent, unreadable or not a JSON array.
   */
  rows: unknown[] | null
  /** chat.json rows without a (non-empty string) sessionId — legacy malformed_chat_session. */
  malformedChatSessions: number
  /** _pi_sessions/*.jsonl manifest + byte references (archived verbatim). */
  sessions: ExtractedChatSession[]
  /** agent_events.jsonl exists (hidden reasoning trace; never imported). */
  agentEventsPresent: boolean
  /** agent_selected_session.json exists. */
  selectedSession: boolean
}

export interface LegacyProjectExtraction {
  root: string
  projectId: string
  dir: string
  /** false for orphan-sqlite projects (projection without a directory). */
  dirExists: boolean
  manifest: { source: DataSource; value: Record<string, unknown> | null; error: string | null }
  batches: ExtractedBatch[]
  tm: { source: DataSource; entries: unknown[]; error: string | null }
  termbase: { source: DataSource; entries: unknown[]; overrides: unknown[]; error: string | null }
  termHistory: ExtractedTermHistory
  deliveryQaReports: ExtractedDeliveryQaReport[]
  ledger: ExtractedLedger
  exportFiles: ExtractedFile[]
  uploads: ExtractedUpload[]
  chat: ExtractedChat
  /** CAS blob-store stats (v2 managed source copies live here). */
  blobStore: { present: boolean; blobs: number; bytes: number }
  /**
   * Project-scoped health signals echoed into ImportReport.signals (PB-092
   * decision 7-8): invalid-permission-mode, root-missing,
   * external-root-with-managed-uploads, internal-copy-only, orphan-project,
   * orphan-sqlite-project. Same codes/messages as the PB-090 scanner.
   */
  signals: HealthSignal[]
  /** PB-090 project digest (scan.ts projectDigest over the same file set). */
  digest: string
  digestFiles: FileDigest[]
  warnings: string[]
}

export class LegacyProjectNotFoundError extends Error {
  readonly code = 'IMPORT_PROJECT_NOT_FOUND'
  constructor(message: string) {
    super(message)
    this.name = 'LegacyProjectNotFoundError'
  }
}

// ---------------------------------------------------------------------------
// small fs helpers (all read-only)

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function readJson(path: string): { value: unknown | null; error: string | null } {
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

function hashFile(absPath: string, relPath: string): ExtractedFile | null {
  try {
    const bytes = readFileSync(absPath)
    return { relPath, absPath, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') }
  } catch {
    return null
  }
}

/** Recursive file walk returning project-dir-relative posix paths (sorted). */
function walkFiles(base: string, relPrefix: string): Array<{ absPath: string; relPath: string }> {
  const out: Array<{ absPath: string; relPath: string }> = []
  let entries
  try {
    entries = readdirSync(base, { withFileTypes: true })
  } catch {
    return out
  }
  for (const entry of entries) {
    const absPath = join(base, entry.name)
    const relPath = relPrefix === '' ? entry.name : `${relPrefix}/${entry.name}`
    if (entry.isDirectory()) out.push(...walkFiles(absPath, relPath))
    else if (entry.isFile()) out.push({ absPath, relPath })
  }
  return out.sort((a, b) => (a.relPath < b.relPath ? -1 : 1))
}

// ---------------------------------------------------------------------------
// ledger chain validation (verify-only)
// Provenance: linguist-agent/packages/cat-data/src/quality_decision_ledger.ts
// readQualityDecisionLedger() — same rules: schemaVersion 1, sequence from 1,
// previousHash chain, hash = sha256(JSON.stringify(event without hash)).

function hashLedgerEvent(event: Record<string, unknown>): string {
  return createHash('sha256').update(JSON.stringify(event)).digest('hex')
}

export function verifyLedgerChain(raw: string): {
  events: Record<string, unknown>[]
  valid: boolean
  error: string | null
} {
  const events: Record<string, unknown>[] = []
  const lines = raw.split(/\r?\n/).filter((line) => line.trim() !== '')
  for (const [index, line] of lines.entries()) {
    let row: unknown
    try {
      row = JSON.parse(line)
    } catch (err) {
      return { events, valid: false, error: `line ${index + 1}: invalid JSON (${err instanceof Error ? err.message : String(err)})` }
    }
    if (!isRecord(row)) return { events, valid: false, error: `line ${index + 1}: not a JSON object` }
    if (row.schemaVersion !== 1 || row.sequence !== index + 1) {
      return { events, valid: false, error: `line ${index + 1}: sequence/schemaVersion invalid` }
    }
    if (index === 0 && row.previousHash !== undefined) {
      return { events, valid: false, error: 'line 1: unexpected previousHash' }
    }
    if (index > 0 && row.previousHash !== events[index - 1]?.hash) {
      return { events, valid: false, error: `line ${index + 1}: hash chain broken` }
    }
    const { hash: actual, ...withoutHash } = row
    if (typeof actual !== 'string' || actual !== hashLedgerEvent(withoutHash)) {
      return { events, valid: false, error: `line ${index + 1}: hash invalid` }
    }
    events.push(row)
  }
  return { events, valid: true, error: null }
}

// ---------------------------------------------------------------------------
// domain resolution (authority -> read-cache -> legacy JSON), mirrors scan.ts

interface DomainResolution {
  value: unknown | null
  source: DataSource
  error: string | null
}

function resolveDomain(
  probe: ReturnType<typeof probeCatCore>,
  root: string,
  kind: 'manifest' | 'batch' | 'tm' | 'termbase',
  projectId: string,
  legacyPath: string,
  id = 'root',
): DomainResolution {
  const legacy = readJson(legacyPath)
  if (probe.authority) {
    if (probe.opened) {
      const value = probe.read(kind, projectId, id)
      if (value !== null && value !== undefined) return { value, source: 'sqlite', error: null }
    }
    const cached = readCacheJson(root, kind, projectId, id)
    if (cached.value !== null) return { value: cached.value, source: 'read-cache', error: null }
    return { value: null, source: 'none', error: `no ${kind} projection available (sqlite/read-cache miss)` }
  }
  if (legacy.error !== null) return { value: null, source: 'none', error: legacy.error }
  return { value: legacy.value, source: legacy.value === null ? 'none' : 'legacy-json', error: null }
}

// ---------------------------------------------------------------------------
// main entry

export function extractLegacyProject(options: { root: string; projectId: string; allowMissingDir?: boolean }): LegacyProjectExtraction {
  const root = resolve(options.root)
  const { projectId } = options
  if (!existsSync(join(root, 'data'))) {
    throw new ScanRootError(`legacy data directory not found: ${join(root, 'data')} (--root must point at the runtime root containing data/)`)
  }
  const dir = projectDirOf(root, projectId)
  const dirExists = existsSync(dir)
  if (!dirExists && options.allowMissingDir !== true) {
    throw new LegacyProjectNotFoundError(
      `legacy project not found: ${dir} (--project must name a directory under ${join(root, PROJECTS_REL)})`,
    )
  }

  const warnings: string[] = []
  const signals: HealthSignal[] = []
  const probe = probeCatCore(root)
  try {
    // --- manifest -----------------------------------------------------------
    const manifestResolution = resolveDomain(probe, root, 'manifest', projectId, join(dir, PROJECT_MANIFEST))
    const manifestValue = manifestResolution.value !== null && isRecord(manifestResolution.value) ? manifestResolution.value : null
    if (manifestResolution.value !== null && manifestValue === null) {
      warnings.push('manifest projection is not a JSON object')
    }

    // --- orphan signals (mirror scan.ts; import routing consumes them) -------
    if (!dirExists && manifestValue !== null) {
      signals.push({
        code: 'orphan-sqlite-project',
        severity: 'warning',
        projectId,
        message: 'SQLite/read-cache has a manifest projection for this project, but data/projects/ has no such directory.',
        evidence: { source: manifestResolution.source },
      })
    }
    if (dirExists && manifestValue === null) {
      const missing = manifestResolution.value === null && manifestResolution.error === null
      signals.push({
        code: 'orphan-project',
        severity: missing ? 'warning' : 'error',
        projectId,
        message: missing
          ? 'Project directory exists but no readable manifest was found in any layer (project_manifest_unreadable: missing).'
          : `Project directory exists but its manifest is unreadable (project_manifest_unreadable: ${manifestResolution.error ?? 'not a JSON object'}).`,
        evidence: { source: manifestResolution.source, error: manifestResolution.error },
      })
    }

    // --- batches ------------------------------------------------------------
    const batchIds = new Set<string>()
    const legacyBatchIds = listDirs(join(dir, BATCHES_DIR))
    for (const id of legacyBatchIds) batchIds.add(id)
    if (probe.authority && probe.opened) {
      for (const value of probe.listBatches(projectId)) {
        const id = (value as { batchId?: unknown }).batchId
        if (typeof id === 'string') batchIds.add(id)
      }
    }
    if (probe.authority) {
      for (const id of listReadCacheBatchIds(root, projectId)) batchIds.add(id)
    }

    const batches: ExtractedBatch[] = []
    for (const batchId of [...batchIds].sort()) {
      const resolution = resolveDomain(
        probe,
        root,
        'batch',
        projectId,
        join(dir, BATCHES_DIR, batchId, BATCH_FILE),
        batchId,
      )
      const value = resolution.value !== null && isRecord(resolution.value) ? resolution.value : null
      let error = resolution.error
      if (resolution.value !== null && value === null) error = 'batch payload is not a JSON object'
      if (resolution.value === null && resolution.source === 'none' && resolution.error === null) error = 'batch.json missing'
      const batchDir = join(dir, BATCHES_DIR, batchId)
      const proposals: ExtractedFile[] = []
      for (const name of listFiles(join(batchDir, PROPOSALS_DIR))) {
        if (!name.endsWith('.json')) continue
        const file = hashFile(join(batchDir, PROPOSALS_DIR, name), `${BATCHES_DIR}/${batchId}/${PROPOSALS_DIR}/${name}`)
        if (file) proposals.push(file)
        else warnings.push(`unreadable proposal file: batches/${batchId}/proposals/${name}`)
      }
      const reportFiles = listFiles(join(batchDir, REPORTS_DIR)).filter((name) => name.endsWith('.md'))
      // source_refs are SQLite-only (the read-cache path scheme has no
      // 'source' kind) — the PB-092 blob-store fallback evidence.
      const sourceRefs = probe.authority && probe.opened ? probe.readSourceRefs(projectId, 'batch', batchId) : []
      batches.push({ batchId, source: resolution.source, value, error, sourceRefs, proposals, reportFiles })
    }

    // --- TM -----------------------------------------------------------------
    const tmResolution = resolveDomain(probe, root, 'tm', projectId, join(dir, TM_FILE))
    let tmEntries: unknown[] = []
    let tmError = tmResolution.error
    if (tmResolution.value !== null) {
      if (Array.isArray(tmResolution.value)) tmEntries = tmResolution.value
      else tmError = 'tm payload is not a JSON array'
    }

    // --- termbase (two shapes: bare array + overrides file, or {entries, overrides})
    const tbResolution = resolveDomain(probe, root, 'termbase', projectId, join(dir, TERMBASE_FILE))
    let tbEntries: unknown[] = []
    let tbOverrides: unknown[] = []
    let tbError = tbResolution.error
    if (tbResolution.value !== null) {
      if (Array.isArray(tbResolution.value)) {
        tbEntries = tbResolution.value
      } else if (isRecord(tbResolution.value)) {
        // SQLite/read-cache shape (contracts §7): {entries, overrides}.
        if (Array.isArray(tbResolution.value.entries)) tbEntries = tbResolution.value.entries
        else tbError = 'termbase projection entries is not an array'
        if (Array.isArray(tbResolution.value.overrides)) tbOverrides = tbResolution.value.overrides
      } else {
        tbError = 'termbase payload is neither an array nor an {entries, overrides} object'
      }
    }
    // termbase_overrides.json stays file-based in the legacy layout (contracts §7).
    const overridesJson = readJson(join(dir, TERMBASE_OVERRIDES_FILE))
    if (overridesJson.error !== null) warnings.push(`termbase_overrides.json: ${overridesJson.error}`)
    if (Array.isArray(overridesJson.value)) tbOverrides = overridesJson.value

    // --- term_history.json (file-based; TermHistoryIndex {rows, decisions}) --
    let termHistory: ExtractedTermHistory = { present: false, decisions: [], error: null }
    const historyJson = readJson(join(dir, TERM_HISTORY_FILE))
    if (historyJson.error !== null) {
      termHistory = { present: true, decisions: [], error: historyJson.error }
      warnings.push(`term_history.json: ${historyJson.error}`)
    } else if (historyJson.value !== null) {
      if (isRecord(historyJson.value) && Array.isArray(historyJson.value.decisions)) {
        termHistory = {
          present: true,
          decisions: historyJson.value.decisions.filter(isRecord),
          error: null,
        }
      } else {
        termHistory = { present: true, decisions: [], error: 'term_history.json has no decisions array' }
        warnings.push('term_history.json has no decisions array; term statuses default to allowed')
      }
    }

    // --- delivery_qa reports (file-based) -------------------------------------
    const deliveryQaReports: ExtractedDeliveryQaReport[] = []
    for (const name of listFiles(join(dir, DELIVERY_QA_DIR))) {
      if (!name.endsWith('.json')) continue
      const parsed = readJson(join(dir, DELIVERY_QA_DIR, name))
      if (parsed.error !== null || !isRecord(parsed.value)) {
        const detail = parsed.error ?? 'report is not a JSON object'
        deliveryQaReports.push({ fileName: name, reportId: null, batchId: null, generatedAt: null, findings: [], error: detail })
        warnings.push(`delivery_qa/${name}: ${detail}`)
        continue
      }
      const report = parsed.value
      deliveryQaReports.push({
        fileName: name,
        reportId: typeof report.reportId === 'string' ? report.reportId : null,
        batchId: typeof report.batchId === 'string' ? report.batchId : null,
        generatedAt: typeof report.generatedAt === 'string' ? report.generatedAt : null,
        findings: Array.isArray(report.findings) ? report.findings.filter(isRecord) : [],
        error: null,
      })
    }

    // --- quality decision ledger (verify-only; archived verbatim) -------------
    let ledger: ExtractedLedger = { present: false, raw: null, events: [], valid: false, error: null }
    const ledgerPath = join(dir, QUALITY_DECISION_LEDGER_FILE)
    if (existsSync(ledgerPath)) {
      try {
        const raw = readFileSync(ledgerPath, 'utf8')
        const verified = verifyLedgerChain(raw)
        ledger = { present: true, raw, events: verified.events, valid: verified.valid, error: verified.error }
        if (!verified.valid) warnings.push(`quality_decision_ledger.jsonl chain invalid: ${verified.error}`)
      } catch (err) {
        ledger = { present: true, raw: null, events: [], valid: false, error: `read failed: ${err instanceof Error ? err.message : String(err)}` }
        warnings.push(`quality_decision_ledger.jsonl: ${ledger.error}`)
      }
    }

    // --- exports/ (artifact references; archived verbatim) --------------------
    const exportFiles: ExtractedFile[] = []
    for (const entry of walkFiles(join(dir, EXPORTS_DIR), '')) {
      const file = hashFile(entry.absPath, `${EXPORTS_DIR}/${entry.relPath}`)
      if (file) exportFiles.push(file)
      else warnings.push(`unreadable export file: exports/${entry.relPath}`)
    }

    // --- uploads/ (managed source copies) --------------------------------------
    const uploads: ExtractedUpload[] = []
    for (const name of listFiles(join(dir, UPLOADS_DIR))) {
      let bytes = 0
      let mtimeMs = 0
      try {
        const stat = statSync(join(dir, UPLOADS_DIR, name))
        bytes = stat.size
        mtimeMs = stat.mtimeMs
      } catch {
        warnings.push(`unstatable upload: uploads/${name}`)
      }
      uploads.push({ name, bytes, mtimeMs })
    }

    // --- source-root signals (mirror scan.ts) ----------------------------------
    const blobStore = walkBlobStore(root)
    const manifestRoot = manifestValue !== null && typeof manifestValue.root === 'string' ? manifestValue.root : null
    if (manifestRoot !== null) {
      let rootExists = false
      let statError: string | null = null
      try {
        rootExists = statSync(manifestRoot).isDirectory()
      } catch (err) {
        statError = (err as NodeJS.ErrnoException).code ?? String(err)
      }
      if (!rootExists) {
        signals.push({
          code: 'root-missing',
          severity: 'warning',
          projectId,
          message: `Manifest root ${JSON.stringify(manifestRoot)} is not accessible; importing workspace copies only.`,
          evidence: { root: manifestRoot, statError },
        })
        if (uploads.length > 0 || blobStore.blobs > 0) {
          signals.push({
            code: 'internal-copy-only',
            severity: 'warning',
            projectId,
            message: 'Manifest root is gone; only internal copies survive (uploads/ and/or blob-store).',
            evidence: { uploads: uploads.length, blobStoreBlobs: blobStore.blobs },
          })
        }
      } else if (uploads.length > 0) {
        signals.push({
          code: 'external-root-with-managed-uploads',
          severity: 'info',
          projectId,
          message: 'External source root exists AND managed uploads/ copies are present (copies on both sides).',
          evidence: { root: manifestRoot, uploads: uploads.length },
        })
      }
    }

    // --- chat carriers (PB-092 decision 5 + PB-093 transcript/pi-session) ---
    const chatJsonPath = join(dir, CHAT_FILE)
    const chatJson = existsSync(chatJsonPath) ? hashFile(chatJsonPath, CHAT_FILE) : null
    if (existsSync(chatJsonPath) && chatJson === null) warnings.push('unreadable chat.json bytes')
    let chatEntries: number | null = null
    let chatRows: unknown[] | null = null
    let malformedChatSessions = 0
    const chatParsed = readJson(chatJsonPath)
    if (chatParsed.error !== null) {
      warnings.push(`chat.json: ${chatParsed.error}`)
    } else if (chatParsed.value !== null) {
      if (Array.isArray(chatParsed.value)) {
        chatEntries = chatParsed.value.length
        chatRows = chatParsed.value
        for (const entry of chatParsed.value) {
          // legacy_task_backfill.ts:466-483 — a row without a (non-empty
          // string) sessionId is a malformed_chat_session.
          const sessionId = isRecord(entry) ? entry.sessionId : undefined
          if (typeof sessionId !== 'string' || sessionId.trim() === '') malformedChatSessions++
        }
      } else {
        warnings.push('chat.json is not a JSON array')
      }
    }
    const sessions: ExtractedChatSession[] = []
    for (const name of listFiles(join(dir, PI_SESSIONS_DIR))) {
      if (!name.endsWith('.jsonl')) continue
      try {
        const raw = readFileSync(join(dir, PI_SESSIONS_DIR, name))
        sessions.push({
          name,
          lines: countJsonlLines(raw.toString('utf8')),
          bytes: raw.length,
          sha256: createHash('sha256').update(raw).digest('hex'),
          content: raw,
        })
      } catch {
        warnings.push(`unreadable pi session: ${PI_SESSIONS_DIR}/${name}`)
      }
    }
    const chat: ExtractedChat = {
      chatJson,
      entries: chatEntries,
      rows: chatRows,
      malformedChatSessions,
      sessions,
      agentEventsPresent: existsSync(join(dir, AGENT_EVENTS_FILE)),
      selectedSession: existsSync(join(dir, AGENT_SELECTED_SESSION_FILE)),
    }

    // --- agent settings probe (PB-092 decision 7; never blocks the import) -----
    const settingsJson = readJson(join(dir, AGENT_SETTINGS_FILE))
    if (settingsJson.error !== null) warnings.push(`agent_settings.json: ${settingsJson.error}`)
    if (settingsJson.value !== null) {
      const settingsUnsupported: UnsupportedField[] = []
      const settings = probeAgentSettings(settingsJson.value, settingsUnsupported)
      for (const item of settingsUnsupported) warnings.push(`${item.path}: ${item.detail}`)
      if (settings.invalidPermissionMode) {
        signals.push({
          code: 'invalid-permission-mode',
          severity: 'warning',
          projectId,
          message: `agent_settings.json permissionMode ${JSON.stringify(settings.permissionMode)} is not supported (ask | auto | custom); recorded, import continues.`,
          evidence: { permissionMode: settings.permissionMode },
        })
      }
    }

    // --- digest (PB-090 algorithm, same file set as the scanner) ---------------
    const digestFiles = collectProjectDigestFiles(dir)

    return {
      root,
      projectId,
      dir,
      dirExists,
      manifest: { source: manifestResolution.source, value: manifestValue, error: manifestResolution.error },
      batches,
      tm: { source: tmResolution.source, entries: tmEntries, error: tmError },
      termbase: { source: tbResolution.source, entries: tbEntries, overrides: tbOverrides, error: tbError },
      termHistory,
      deliveryQaReports,
      ledger,
      exportFiles,
      uploads,
      chat,
      blobStore,
      signals,
      digest: projectDigest(digestFiles),
      digestFiles,
      warnings,
    }
  } finally {
    probe.close()
  }
}
