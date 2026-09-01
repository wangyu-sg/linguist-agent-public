/**
 * Legacy project importer (PB-091): orchestrates extract -> map -> store
 * writes for ONE legacy project into a NEW Linguist project under
 * --target-root. Never touches the scanned legacy tree (read-only); the
 * only writes happen inside the injected target root.
 *
 * Store writes go exclusively through the public store API:
 * CatStore.createProject (root always injected) -> db.assets.insert(asset,
 * segments) (adapter bypass: legacy segments are already parsed JSON, so
 * Segment rows are built directly in map.ts) -> db.tmUnits.importMany ->
 * db.termEntries.importMany -> db.qaFindings.insertOpen (+ transition to
 * waived). Not through LinguistProjectService (that is the bytes->adapter
 * pipeline).
 *
 * Idempotency: the new project id is deterministically derived (default
 * entropy seed = sha256("legacy\0"+legacyProjectId), first 16 hex chars); a
 * repeated import collides with StoreProjectExistsError and is refused.
 *
 * Rollback: a real run writes the sidecar projects/<newId>/legacy-import.json
 * and the report carries rollback instructions (delete the project dir +
 * remove its projects.json entry). --dry-run writes nothing at all.
 *
 * PB-092 (disposition layer):
 * - --external-source=copy|reference (default copy = PB-091 behavior):
 *   reference never reads external bytes and falls back uploads ->
 *   blob-store -> lost; the external root is recorded in the sidecar.
 * - CAS blob-store fallback: cat-core source_refs point at
 *   blob-store/blobs/sha256/<2hex>/<digest>; blobs are re-hashed and
 *   byte-count-checked on read (tampered blobs degrade to lost + note).
 * - Orphan projects route through disposition.ts: quarantined by default
 *   (report-only refusal, zero writes, CLI exit 5) or salvaged with
 *   --salvage-orphan (languages from batch payloads, name from directory).
 * - Chat carriers: chat.json bytes archived under legacy-archive/chat/,
 *   _pi_sessions/*.jsonl manifest + line counts, agent_events.jsonl never
 *   imported (hidden reasoning trace).
 * - The report gains disposition / refusal / signals / externalSource /
 *   chat; chat-only projects import metadata-only as 'archived-only'.
 *
 * PB-093 (chat history -> read-only archived transcript):
 * - chat.json rows are rendered ONCE into a static Markdown transcript at
 *   projects/<newId>/legacy-archive/chat/transcript.md (pure, deterministic
 *   render in chat-transcript.ts — PB-094 Verify can re-render and compare
 *   sha256). Legacy chats are never migrated into continuable Proma
 *   sessions: the old Runtime/Tool/Prompt/Session semantics are
 *   incompatible with the new repo.
 * - _pi_sessions/*.jsonl bytes are archived VERBATIM under
 *   legacy-archive/chat/pi-sessions/ (never parsed, never rendered; the
 *   extract retains sha256 + byte references so the written bytes are
 *   exactly the hashed bytes). They may contain hidden thinking content —
 *   the user's own data, preserved intact.
 * - ArchiveEntry gains kinds 'chat-transcript' and 'pi-session'; the report
 *   chat summary gains transcript{path,sha256,bytes,sessions,rows,
 *   malformedRows,unassignedRows} | null and piSessionsArchived.
 */

import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import {
  generateProjectId,
  type EntropySource,
  type OpenQaFindingInput,
  type ProjectId,
} from '@linguist/cat-core'
import { sha256Hex } from '@linguist/cat-formats'
import { CatStore, StoreNotFoundError } from '@linguist/cat-store'
import { renderChatTranscript, type ChatTranscriptSummary } from './chat-transcript'
import {
  deriveDisposition,
  determineProjectRoute,
  type ImportDisposition,
  type ImportRefusal,
} from './disposition'
import {
  extractLegacyProject,
  LegacyProjectNotFoundError,
  type ExtractedBatch,
  type LegacyProjectExtraction,
} from './extract'
import { BATCHES_DIR, BATCH_FILE, CHAT_FILE, PI_SESSIONS_DIR, PROJECTS_REL, QUALITY_DECISION_LEDGER_FILE } from './layout'
import {
  PASTE_FORMATS,
  bump,
  collectLedgerReviews,
  counterToRecord,
  mapLegacyBatch,
  mapOverrideEntry,
  mapQaFinding,
  mapTermbaseEntry,
  mapTmEntry,
  selectLatestReportsPerBatch,
  type FieldCounter,
} from './map'
import type { HealthSignal } from './scan'
import { blobStoreDir, type CatCoreSourceRefInfo, type DataSource } from './sqlite-probe'

/** Keep in sync with package.json version (sidecar provenance). */
export const MIGRATION_TOOL_VERSION = '0.0.4'

/** Seed separator byte (built via code point so this source stays NUL-free). */
const NUL = String.fromCodePoint(0)

export class ImportDataError extends Error {
  readonly code = 'IMPORT_DATA_ERROR'
  constructor(message: string) {
    super(message)
    this.name = 'ImportDataError'
  }
}

// ---------------------------------------------------------------------------
// deterministic project id (PB-091 decision 11)

export function legacyImportEntropy(seed: string): EntropySource {
  const bytes = createHash('sha256').update(seed).digest()
  return () => new Uint8Array(bytes)
}

/** Default seed: "legacy\0"<legacyProjectId>; --seed overrides the whole seed string. */
export function deriveImportProjectId(legacyProjectId: string, seed?: string): ProjectId {
  return generateProjectId(legacyImportEntropy(seed ?? `legacy${NUL}${legacyProjectId}`))
}

// ---------------------------------------------------------------------------
// report model

export interface AssetImportEntry {
  batchId: string
  batchSource: DataSource
  assetId: string | null
  legacyFormat: string | null
  formatId: string | null
  exportUnavailable: boolean
  originalFilename: string | null
  sourceSha256: string | null
  /** PB-092 adds 'blob-store' (v2 managed copy recovered via source_refs). */
  sourceResolution: 'external' | 'uploads' | 'blob-store' | 'lost' | null
  sourceDetail: string | null
  segments: number
  lockedSegments: number
  /** Non-null when the batch was NOT imported (asset id collision). */
  skipped: string | null
  keptBatchId: string | null
}

export interface ArchiveEntry {
  /** PB-093 adds 'chat-transcript' (rendered markdown) and 'pi-session'. */
  kind: 'proposal' | 'ledger' | 'export' | 'chat' | 'chat-transcript' | 'pi-session'
  /** Legacy-project-relative source path. */
  from: string
  /** Target-root-relative destination path. */
  to: string
  sha256: string
  bytes: number
  written: boolean
}

/** PB-093 transcript artifact descriptor (report.chat.transcript). */
export interface ChatTranscriptArtifact extends ChatTranscriptSummary {
  /** Target-root-relative transcript path (legacy-archive/chat/transcript.md). */
  path: string
  /** sha256 of the rendered markdown bytes (re-renderable for PB-094 Verify). */
  sha256: string
  bytes: number
}

/** Chat carrier summary (PB-092 decision 5 + PB-093); bytes live in the archives. */
export interface ChatImportSummary {
  /** chat.json exists. */
  present: boolean
  /** Decoded entry count; null when absent/unreadable/not an array. */
  entries: number | null
  /** chat.json rows without a sessionId (legacy malformed_chat_session). */
  malformedChatSessions: number
  /** _pi_sessions/*.jsonl manifest (name + line count + size). */
  sessions: Array<{ name: string; lines: number; bytes: number }>
  /** agent_events.jsonl exists — hidden reasoning trace, NEVER imported. */
  agentEventsPresent: boolean
  /** chat.json bytes archived under legacy-archive/chat/ this run. */
  archived: boolean
  /**
   * PB-093 read-only transcript artifact; null when chat.json is absent,
   * unreadable, not a JSON array or an empty array (no transcript written).
   */
  transcript: ChatTranscriptArtifact | null
  /** _pi_sessions/*.jsonl files archived byte-verbatim this run (PB-093). */
  piSessionsArchived: number
}

export interface ImportReport {
  tool: 'linguist-legacy-import'
  version: 1
  generatedAt: string
  dryRun: boolean
  /** true when the derived project id already exists in the target root. */
  targetConflict: boolean
  /**
   * PB-092 disposition: imported | partial | archived-only | quarantined |
   * error (derivation table in disposition.ts). A targetConflict report
   * describes the refused PLAN (nothing was written; the first import
   * already landed) — check targetConflict before disposition.
   */
  disposition: ImportDisposition
  /** Quarantine refusal (PB-092 decision 3); null on every non-refused path. */
  refusal: ImportRefusal | null
  /** Project-scoped health signals echoed from extraction (PB-092 decision 8). */
  signals: HealthSignal[]
  /** External source handling in effect (PB-092 decision 1). */
  externalSource: 'copy' | 'reference'
  legacyRoot: string
  legacyProjectId: string
  newProjectId: string
  project: { name: string; sourceLocale: string; targetLocale: string; promaWorkspaceId: string }
  sourceDigest: string
  digestFiles: number
  domains: { manifest: DataSource; tm: DataSource; termbase: DataSource; batches: Record<string, DataSource> }
  assets: AssetImportEntry[]
  totals: {
    assets: number
    assetsSkipped: number
    segments: number
    segmentsByStatus: Record<string, number>
    lockedSegments: number
    tmImported: number
    tmUnchanged: number
    termsImported: number
    termsUnchanged: number
    qaOpen: number
    qaWaived: number
    qaDropped: number
    proposalsArchived: number
    exportsArchived: number
  }
  droppedFields: Record<string, number>
  coercions: Record<string, number>
  archives: ArchiveEntry[]
  chat: ChatImportSummary
  ledger: { present: boolean; valid: boolean; events: number; reviewsApplied: number; error: string | null }
  sidecar: { path: string; written: boolean }
  rollback: string[]
  notes: string[]
}

// ---------------------------------------------------------------------------
// source resolution (PB-091 decision 9 + PB-092 decisions 1 & 4)

interface ResolvedSource {
  kind: 'external' | 'uploads' | 'blob-store' | 'lost'
  sha256: string
  bytes: Uint8Array | null
  detail: string
  ambiguous: string[] | null
}

/** sha256 of the legacy batch.json bytes (PB-090 digest) — the honest synthetic anchor. */
function batchFileDigest(extraction: LegacyProjectExtraction, batchId: string): string | null {
  const rel = `${BATCHES_DIR}/${batchId}/${BATCH_FILE}`
  return extraction.digestFiles.find((file) => file.relPath === rel)?.sha256 ?? null
}

function synthesizedDigest(extraction: LegacyProjectExtraction, batch: ExtractedBatch): string {
  const fileDigest = batchFileDigest(extraction, batch.batchId)
  if (fileDigest !== null) return fileDigest
  // SQLite/read-cache-only batch without a legacy batch.json: fall back to a
  // deterministic digest of the projection payload itself.
  return sha256Hex(new TextEncoder().encode(JSON.stringify(batch.value)))
}

/** Upload naming (legacy server.ts:3492): `<Date.now()>-<safeName>`. */
const UPLOAD_NAME_PATTERN = /^(\d+)-(.+)$/

/**
 * Pick the source_ref for a batch source file (PB-092): exact path match
 * first, else the first ref (the cutover publishes refs for sourceFile and
 * masterFile — cat_core_sqlite_cutover.ts:282-292).
 */
function pickSourceRef(refs: readonly CatCoreSourceRefInfo[], sourceFile: string): CatCoreSourceRefInfo | null {
  return refs.find((ref) => ref.path === sourceFile) ?? refs[0] ?? null
}

function resolveBatchSource(
  extraction: LegacyProjectExtraction,
  batch: ExtractedBatch,
  externalSource: 'copy' | 'reference',
  notes: string[],
): ResolvedSource {
  const value = batch.value ?? {}
  const format = typeof value.format === 'string' ? value.format : null
  const sourceFile = typeof value.sourceFile === 'string' ? value.sourceFile : null

  // Paste batches never had source bytes (synthetic sourceFile): go straight
  // to the lost branch instead of probing the filesystem.
  if (format !== null && PASTE_FORMATS.has(format)) {
    return {
      kind: 'lost',
      sha256: synthesizedDigest(extraction, batch),
      bytes: null,
      detail: `paste-synthetic-source (${format}); export unavailable, source_sha256 = legacy batch.json digest`,
      ambiguous: null,
    }
  }

  if (sourceFile !== null) {
    // 1. external root file still present -> real bytes, real sha256.
    //    PB-092: only under --external-source=copy (the default). 'reference'
    //    is the user's explicit machine-readable choice to NOT read external
    //    bytes; the chain falls through to the managed copies.
    if (externalSource === 'copy') {
      try {
        if (statSync(sourceFile).isFile()) {
          const bytes = readFileSync(sourceFile)
          return { kind: 'external', sha256: sha256Hex(bytes), bytes: new Uint8Array(bytes), detail: sourceFile, ambiguous: null }
        }
      } catch {
        // not accessible: fall through to the uploads branch
      }
    }

    // 2. managed uploads copy: exact name, or `<timestamp>-<name>` suffix.
    const base = basename(sourceFile)
    const candidates: Array<{ name: string; prefix: number }> = []
    for (const upload of extraction.uploads) {
      if (upload.name === base) {
        candidates.push({ name: upload.name, prefix: Number.POSITIVE_INFINITY })
        continue
      }
      const match = UPLOAD_NAME_PATTERN.exec(upload.name)
      if (match && match[2] === base) candidates.push({ name: upload.name, prefix: Number(match[1]) })
    }
    if (candidates.length > 0) {
      // Multiple candidates: take the latest upload (largest Date.now() prefix).
      candidates.sort((a, b) => b.prefix - a.prefix || (a.name < b.name ? -1 : 1))
      const winner = candidates[0]!
      const ambiguous = candidates.length > 1 ? candidates.map((c) => c.name) : null
      if (ambiguous !== null) {
        notes.push(`batch ${batch.batchId}: ${candidates.length} uploads match "${base}"; took latest (${winner.name})`)
      }
      try {
        const bytes = readFileSync(join(extraction.dir, 'uploads', winner.name))
        const detail =
          externalSource === 'reference'
            ? `uploads/${winner.name} (external source referenced, bytes not read: ${sourceFile})`
            : `uploads/${winner.name}`
        return { kind: 'uploads', sha256: sha256Hex(bytes), bytes: new Uint8Array(bytes), detail, ambiguous }
      } catch {
        // vanished between listing and read: degrade to the blob-store layer
      }
    }

    // 3. CAS blob-store via cat-core source_refs (PB-092 decision 4): the v2
    //    managed copy. The blob is re-hashed and byte-count-checked on read;
    //    a tampered/missing blob degrades to lost with a note.
    const ref = pickSourceRef(batch.sourceRefs, sourceFile)
    if (ref !== null) {
      const blobRel = `${ref.blobRefId.slice(0, 2)}/${ref.blobRefId}`
      try {
        const bytes = readFileSync(join(blobStoreDir(extraction.root), blobRel))
        const actualSha256 = sha256Hex(bytes)
        if (actualSha256 === ref.sha256 && bytes.length === ref.bytes) {
          const detail =
            externalSource === 'reference'
              ? `blob-store blob ${blobRel} via source_refs (external source referenced, bytes not read: ${sourceFile})`
              : `blob-store blob ${blobRel} via source_refs`
          return { kind: 'blob-store', sha256: ref.sha256, bytes: new Uint8Array(bytes), detail, ambiguous: null }
        }
        notes.push(
          `batch ${batch.batchId}: blob-store blob ${blobRel} failed integrity check ` +
            `(expected sha256 ${ref.sha256} / ${ref.bytes} bytes, got ${actualSha256} / ${bytes.length}); source treated as lost`,
        )
      } catch {
        notes.push(`batch ${batch.batchId}: source_refs point at blob-store blob ${blobRel} but it is unreadable; source treated as lost`)
      }
    }
  }

  // 4. all copies lost: honest deterministic anchor, no blob, export unavailable.
  return {
    kind: 'lost',
    sha256: synthesizedDigest(extraction, batch),
    bytes: null,
    detail:
      sourceFile === null
        ? 'source-file-missing; source_sha256 = legacy batch.json digest (synthetic), export unavailable'
        : `source-bytes-lost (${sourceFile}); source_sha256 = legacy batch.json digest (synthetic), export unavailable`,
    ambiguous: null,
  }
}

// ---------------------------------------------------------------------------
// main entry

export interface ImportLegacyOptions {
  /** Legacy runtime-root COPY (the directory containing data/). Read-only. */
  root: string
  /** Legacy project id (directory name under data/projects/). */
  projectId: string
  /** New-repo linguist root. REQUIRED — the only place writes happen. */
  targetRoot: string
  /** Project name override; default manifest.projectName, else legacy id. */
  name?: string
  /** promaWorkspaceId; default `legacy-<projectId>`. */
  workspaceId?: string
  /** Entropy seed override for the derived project id (default "legacy\0"<id>). */
  seed?: string
  /** Injectable clock for deterministic imports. */
  now?: () => string
  /** Zero writes: compute the plan + report only. */
  dryRun?: boolean
  /**
   * External source handling (PB-092 decision 1): 'copy' (default, PB-091
   * behavior) reads external bytes when the file is still present;
   * 'reference' is the user's explicit choice to NOT read external bytes —
   * resolution falls back to uploads -> blob-store -> lost and the external
   * root is recorded in the sidecar (externalSourceRoot).
   */
  externalSource?: 'copy' | 'reference'
  /**
   * Opt-in orphan salvage (PB-092 decision 2): a project whose manifest is
   * missing/unparseable is quarantined by default; with this flag it is
   * imported using the batch-payload language pair and the directory name.
   */
  salvageOrphan?: boolean
}

// ---------------------------------------------------------------------------
// report helpers (PB-092)

function chatSummary(
  extraction: LegacyProjectExtraction,
  chat: { archived: boolean; transcript: ChatTranscriptArtifact | null; piSessionsArchived: number },
): ChatImportSummary {
  return {
    present: extraction.chat.chatJson !== null,
    entries: extraction.chat.entries,
    malformedChatSessions: extraction.chat.malformedChatSessions,
    sessions: extraction.chat.sessions.map((s) => ({ name: s.name, lines: s.lines, bytes: s.bytes })),
    agentEventsPresent: extraction.chat.agentEventsPresent,
    archived: chat.archived,
    transcript: chat.transcript,
    piSessionsArchived: chat.piSessionsArchived,
  }
}

/**
 * Quarantine report (PB-092 decision 3): the refusal IS the isolation —
 * zero writes under the target root, but the full ImportReport shape is
 * returned so the CLI can print it (exit 5) and PB-094 can consume it.
 */
function quarantinedReport(params: {
  now: () => string
  dryRun: boolean
  extraction: LegacyProjectExtraction
  options: ImportLegacyOptions
  externalSource: 'copy' | 'reference'
  refusal: ImportRefusal
  notes: string[]
  newProjectId: ProjectId
  name: string
  sourceLocale: string
  targetLocale: string
  workspaceId: string
}): ImportReport {
  const { extraction, options, refusal } = params
  const sidecarRelPath = join('projects', params.newProjectId, 'legacy-import.json')
  return {
    tool: 'linguist-legacy-import',
    version: 1,
    generatedAt: params.now(),
    dryRun: params.dryRun,
    targetConflict: false,
    disposition: 'quarantined',
    refusal,
    signals: extraction.signals,
    externalSource: params.externalSource,
    legacyRoot: extraction.root,
    legacyProjectId: options.projectId,
    newProjectId: params.newProjectId,
    // best-effort metadata: unknown locales stay '' (nothing is fabricated)
    project: { name: params.name, sourceLocale: params.sourceLocale, targetLocale: params.targetLocale, promaWorkspaceId: params.workspaceId },
    sourceDigest: extraction.digest,
    digestFiles: extraction.digestFiles.length,
    domains: {
      manifest: extraction.manifest.source,
      tm: extraction.tm.source,
      termbase: extraction.termbase.source,
      batches: Object.fromEntries(extraction.batches.map((b) => [b.batchId, b.source])),
    },
    assets: [],
    totals: {
      assets: 0,
      assetsSkipped: 0,
      segments: 0,
      segmentsByStatus: {},
      lockedSegments: 0,
      tmImported: 0,
      tmUnchanged: 0,
      termsImported: 0,
      termsUnchanged: 0,
      qaOpen: 0,
      qaWaived: 0,
      qaDropped: 0,
      proposalsArchived: 0,
      exportsArchived: 0,
    },
    droppedFields: {},
    coercions: {},
    archives: [],
    chat: chatSummary(extraction, { archived: false, transcript: null, piSessionsArchived: 0 }),
    ledger: {
      present: extraction.ledger.present,
      valid: extraction.ledger.valid,
      events: extraction.ledger.events.length,
      reviewsApplied: 0,
      error: extraction.ledger.error,
    },
    sidecar: { path: sidecarRelPath, written: false },
    rollback: [
      `delete directory: ${join(options.targetRoot, 'projects', params.newProjectId)}`,
      `remove the entry with id "${params.newProjectId}" from ${join(options.targetRoot, 'projects.json')} (plain JSON index)`,
    ],
    notes: [...params.notes, `quarantined (${refusal.reason}): nothing was written to the target root`],
  }
}

export function importLegacyProject(options: ImportLegacyOptions): ImportReport {
  const now = options.now ?? (() => new Date().toISOString())
  const dryRun = options.dryRun ?? false
  const externalSource = options.externalSource ?? 'copy'
  const extraction = extractLegacyProject({ root: options.root, projectId: options.projectId, allowMissingDir: true })
  const notes: string[] = [...extraction.warnings]
  const dropped: FieldCounter = new Map()
  const coercions: FieldCounter = new Map()

  // --- best-effort metadata (manifest may be absent on orphan paths) --------
  const manifest = extraction.manifest.value
  const firstBatch = extraction.batches.find((b) => b.value !== null)?.value ?? null
  const sourceLocale =
    (manifest !== null && typeof manifest.sourceLanguage === 'string' ? manifest.sourceLanguage : null) ??
    (firstBatch !== null && typeof firstBatch.sourceLanguage === 'string' ? firstBatch.sourceLanguage : null)
  const targetLocale =
    (manifest !== null && typeof manifest.targetLanguage === 'string' ? manifest.targetLanguage : null) ??
    (firstBatch !== null && typeof firstBatch.targetLanguage === 'string' ? firstBatch.targetLanguage : null)
  const name = options.name ?? (manifest !== null && typeof manifest.projectName === 'string' ? manifest.projectName : null) ?? options.projectId
  const workspaceId = options.workspaceId ?? `legacy-${options.projectId}`
  const newProjectId = deriveImportProjectId(options.projectId, options.seed)

  // --- routing (PB-092 decisions 2-3; pure rules in disposition.ts) ---------
  const route = determineProjectRoute({
    dirExists: extraction.dirExists,
    manifestResolved: manifest !== null,
    manifestError: extraction.manifest.error,
    localesAvailable: sourceLocale !== null && targetLocale !== null,
    salvageOrphan: options.salvageOrphan ?? false,
    batches: extraction.batches.filter((b) => b.value !== null).length,
    readCacheHasProjections:
      extraction.manifest.source === 'read-cache' || extraction.batches.some((b) => b.source === 'read-cache'),
    blobStoreBlobs: extraction.blobStore.blobs,
  })
  if (route.kind === 'not-found') {
    throw new LegacyProjectNotFoundError(
      `legacy project not found: ${extraction.dir} (--project must name a directory under ${join(extraction.root, PROJECTS_REL)} or a cat-core manifest projection)`,
    )
  }
  if (route.kind === 'quarantine') {
    return quarantinedReport({
      now,
      dryRun,
      extraction,
      options,
      externalSource,
      refusal: route.refusal,
      notes,
      newProjectId,
      name,
      sourceLocale: sourceLocale ?? '',
      targetLocale: targetLocale ?? '',
      workspaceId,
    })
  }
  if (route.kind === 'salvage') {
    notes.push(
      `orphan project salvaged (--salvage-orphan): manifest unreadable (${extraction.manifest.error ?? 'missing'}); ` +
        `languages taken from batch payloads, project name from directory "${options.projectId}"`,
    )
  }
  if (sourceLocale === null || targetLocale === null) {
    // Unreachable: determineProjectRoute quarantines missing locales. Kept as
    // a defensive guard so the language pair is narrowed for the store write.
    throw new ImportDataError(`legacy project ${options.projectId} has no source/target language in manifest or batches; nothing imported`)
  }

  // --- map batches (one batch = one asset; collisions skip the later batch) --
  const assetEntries: AssetImportEntry[] = []
  const importedBatches: Array<{
    batch: ExtractedBatch
    mapped: ReturnType<typeof mapLegacyBatch>
    resolved: ResolvedSource
    segmentIds: Map<string, string>
  }> = []
  const usedAssetIds = new Map<string, string>() // assetId -> first batchId
  for (const batch of extraction.batches) {
    if (batch.value === null) {
      notes.push(`batch ${batch.batchId}: unreadable (${batch.error ?? 'unknown'}); skipped`)
      assetEntries.push({
        batchId: batch.batchId,
        batchSource: batch.source,
        assetId: null,
        legacyFormat: null,
        formatId: null,
        exportUnavailable: true,
        originalFilename: null,
        sourceSha256: null,
        sourceResolution: null,
        sourceDetail: batch.error,
        segments: 0,
        lockedSegments: 0,
        skipped: 'batch-unreadable',
        keptBatchId: null,
      })
      continue
    }
    const resolved = resolveBatchSource(extraction, batch, externalSource, notes)
    if (resolved.kind === 'lost') notes.push(`batch ${batch.batchId}: ${resolved.detail}`)
    const sourceFile = typeof batch.value.sourceFile === 'string' ? batch.value.sourceFile : null
    const originalFilename = sourceFile !== null ? basename(sourceFile) : batch.batchId
    const mapped = mapLegacyBatch(
      batch.value,
      {
        newProjectId,
        sourceSha256: resolved.sha256,
        originalFilename,
        sourceLocale: typeof batch.value.sourceLanguage === 'string' ? batch.value.sourceLanguage : sourceLocale,
        targetLocale: typeof batch.value.targetLanguage === 'string' ? batch.value.targetLanguage : targetLocale,
      },
      dropped,
      coercions,
    )
    const entry: AssetImportEntry = {
      batchId: batch.batchId,
      batchSource: batch.source,
      assetId: mapped.asset.id,
      legacyFormat: typeof batch.value.format === 'string' ? batch.value.format : null,
      formatId: mapped.format.formatId,
      exportUnavailable: mapped.format.exportUnavailable || resolved.kind === 'lost',
      originalFilename,
      sourceSha256: resolved.sha256,
      sourceResolution: resolved.kind,
      sourceDetail: resolved.detail,
      segments: mapped.segments.length,
      lockedSegments: mapped.segments.filter((s) => s.locked).length,
      skipped: null,
      keptBatchId: null,
    }
    if (mapped.format.exportUnavailable) {
      notes.push(`batch ${batch.batchId}: format ${entry.legacyFormat ?? '?'} has no export adapter in the new repo; export unavailable`)
    }
    const keptBatchId = usedAssetIds.get(mapped.asset.id)
    if (keptBatchId !== undefined) {
      entry.skipped = 'asset-id-collision'
      entry.keptBatchId = keptBatchId
      notes.push(`batch ${batch.batchId}: same source as batch ${keptBatchId} (asset ${mapped.asset.id}); skipped (one batch = one asset)`)
      bump(dropped, 'batch.skipped-asset-id-collision')
      assetEntries.push(entry)
      continue
    }
    usedAssetIds.set(mapped.asset.id, batch.batchId)
    const segmentIds = new Map<string, string>()
    for (const segment of mapped.segments) {
      if (segment.key !== undefined) segmentIds.set(segment.key, segment.id)
    }
    importedBatches.push({ batch, mapped, resolved, segmentIds })
    assetEntries.push(entry)
  }

  // --- TM / TB mapping --------------------------------------------------------
  const fallbackLocales = { sourceLocale, targetLocale }
  const tmInputs = []
  let tmInvalid = 0
  for (const [index, entry] of extraction.tm.entries.entries()) {
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) {
      tmInvalid++
      bump(dropped, 'tm.entry-not-an-object')
      continue
    }
    const mapped = mapTmEntry(entry as Record<string, unknown>, fallbackLocales, String(index + 1), dropped, coercions)
    if (mapped !== null) tmInputs.push(mapped)
  }
  const termInputs = []
  for (const entry of extraction.termbase.entries) {
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) {
      bump(dropped, 'termbase.entry-not-an-object')
      continue
    }
    const mapped = mapTermbaseEntry(entry as Record<string, unknown>, extraction.termHistory.decisions, dropped, coercions)
    if (mapped !== null) termInputs.push(mapped)
  }
  for (const override of extraction.termbase.overrides) {
    if (typeof override !== 'object' || override === null || Array.isArray(override)) {
      bump(dropped, 'termbase-override.not-an-object')
      continue
    }
    const mapped = mapOverrideEntry(override as Record<string, unknown>, dropped)
    if (mapped !== null) termInputs.push(mapped)
  }

  // --- QA mapping (latest report per batch; reviews from a VALID ledger) ------
  const reviews = extraction.ledger.valid ? collectLedgerReviews(extraction.ledger.events) : new Map()
  if (extraction.ledger.present && !extraction.ledger.valid) {
    notes.push('quality_decision_ledger.jsonl failed chain validation; review states ignored, all findings import as open')
  }
  const latestReports = selectLatestReportsPerBatch(extraction.deliveryQaReports, dropped)
  const qaInputs: Array<{ input: OpenQaFindingInput; waiveReason: string | null }> = []
  const knownBatchIds = new Set(extraction.batches.map((b) => b.batchId))
  for (const [batchId, report] of [...latestReports.entries()].sort()) {
    const target = importedBatches.find((b) => b.batch.batchId === batchId)
    if (target === undefined) {
      bump(dropped, knownBatchIds.has(batchId) ? 'qa.report-batch-skipped' : 'qa.report-unknown-batch')
      notes.push(`delivery_qa report ${report.reportId ?? report.fileName}: batch ${batchId} was not imported; its findings are dropped`)
      continue
    }
    for (const finding of report.findings) {
      const mapped = mapQaFinding(finding, target.segmentIds, reviews, dropped, coercions)
      if (mapped !== null) qaInputs.push(mapped)
    }
  }

  const qaDropped =
    (dropped.get('qa.finding-no-segment-id') ?? 0) +
    (dropped.get('qa.finding-unknown-segment') ?? 0) +
    (dropped.get('qa.report-no-batch-id') ?? 0) +
    (dropped.get('qa.report-batch-skipped') ?? 0) +
    (dropped.get('qa.report-unknown-batch') ?? 0)

  // --- target conflict probe (idempotency refusal, decision 11) ---------------
  const store = new CatStore({ rootDir: options.targetRoot, now })
  let targetConflict = false
  try {
    store.getProject(newProjectId)
    targetConflict = true
  } catch (err) {
    if (!(err instanceof StoreNotFoundError)) throw err
  }
  if (targetConflict) {
    notes.push(`project ${newProjectId} already exists in the target root; a real run is refused (idempotent import)`)
  }

  // --- archives plan -----------------------------------------------------------
  const archives: ArchiveEntry[] = []
  for (const { batch } of importedBatches) {
    for (const proposal of batch.proposals) {
      archives.push({
        kind: 'proposal',
        from: proposal.relPath,
        to: join('projects', newProjectId, 'legacy-archive', 'proposals', batch.batchId, basename(proposal.relPath)),
        sha256: proposal.sha256,
        bytes: proposal.bytes,
        written: false,
      })
    }
  }
  if (extraction.ledger.present && extraction.ledger.raw !== null) {
    const raw = extraction.ledger.raw
    archives.push({
      kind: 'ledger',
      from: QUALITY_DECISION_LEDGER_FILE,
      to: join('projects', newProjectId, 'legacy-archive', QUALITY_DECISION_LEDGER_FILE),
      sha256: createHash('sha256').update(raw, 'utf8').digest('hex'),
      bytes: Buffer.byteLength(raw, 'utf8'),
      written: false,
    })
  }
  for (const file of extraction.exportFiles) {
    archives.push({
      kind: 'export',
      from: file.relPath,
      to: join('projects', newProjectId, file.relPath),
      sha256: file.sha256,
      bytes: file.bytes,
      written: false,
    })
  }
  // chat.json bytes (PB-092 decision 5): the user-visible history candidate,
  // archived verbatim; agent_events.jsonl is never imported (hidden reasoning
  // trace). PB-093 renders the transcript and archives _pi_sessions bytes.
  if (extraction.chat.chatJson !== null) {
    archives.push({
      kind: 'chat',
      from: CHAT_FILE,
      to: join('projects', newProjectId, 'legacy-archive', 'chat', CHAT_FILE),
      sha256: extraction.chat.chatJson.sha256,
      bytes: extraction.chat.chatJson.bytes,
      written: false,
    })
  }

  // PB-093: render the read-only transcript ONCE (pure + deterministic, so
  // PB-094 Verify can re-render and compare sha256). The plan is computed
  // before the write phase so dry-run/conflict reports carry it too.
  const transcriptRelPath = join('projects', newProjectId, 'legacy-archive', 'chat', 'transcript.md')
  const renderedTranscript =
    extraction.chat.rows !== null
      ? renderChatTranscript({
          rows: extraction.chat.rows,
          provenance: {
            legacyProjectId: options.projectId,
            sourceDigest: extraction.digest,
            archivedAt: now(),
            generator: `linguist-legacy-import ${MIGRATION_TOOL_VERSION}`,
          },
        })
      : null
  const transcriptPlan: (ChatTranscriptArtifact & { markdown: string }) | null =
    renderedTranscript === null
      ? null
      : {
          path: transcriptRelPath,
          sha256: createHash('sha256').update(renderedTranscript.markdown, 'utf8').digest('hex'),
          bytes: Buffer.byteLength(renderedTranscript.markdown, 'utf8'),
          sessions: renderedTranscript.summary.sessions,
          rows: renderedTranscript.summary.rows,
          malformedRows: renderedTranscript.summary.malformedRows,
          unassignedRows: renderedTranscript.summary.unassignedRows,
          markdown: renderedTranscript.markdown,
        }
  if (transcriptPlan !== null) {
    archives.push({
      kind: 'chat-transcript',
      from: CHAT_FILE,
      to: transcriptRelPath,
      sha256: transcriptPlan.sha256,
      bytes: transcriptPlan.bytes,
      written: false,
    })
    notes.push(
      'chat transcript rendered read-only at legacy-archive/chat/transcript.md: message text is passed through verbatim ' +
        '(no Markdown escaping) and tool rows are the legacy one-line summaries (tool args/results were never in chat.json, so they are not archived)',
    )
  }
  // _pi_sessions/*.jsonl: archived byte-verbatim (PB-093) — never parsed,
  // never rendered into an executable-session-shaped artifact.
  for (const session of extraction.chat.sessions) {
    archives.push({
      kind: 'pi-session',
      from: `${PI_SESSIONS_DIR}/${session.name}`,
      to: join('projects', newProjectId, 'legacy-archive', 'chat', 'pi-sessions', session.name),
      sha256: session.sha256,
      bytes: session.bytes,
      written: false,
    })
  }
  if (extraction.chat.sessions.length > 0) {
    notes.push(
      '_pi_sessions/*.jsonl archived byte-verbatim under legacy-archive/chat/pi-sessions/ (never parsed or rendered; ' +
        "the files may contain hidden thinking content — the user's own data, preserved intact)",
    )
  }

  const sidecarRelPath = join('projects', newProjectId, 'legacy-import.json')
  const rollback = [
    `delete directory: ${join(options.targetRoot, 'projects', newProjectId)}`,
    `remove the entry with id "${newProjectId}" from ${join(options.targetRoot, 'projects.json')} (plain JSON index)`,
  ]

  // PB-092 decision 1: in reference mode the external root was NOT read; the
  // sidecar records it (user-private path, visible to the user only).
  const manifestRootPath = manifest !== null && typeof manifest.root === 'string' ? manifest.root : null
  const externalSourceRoot = externalSource === 'reference' ? manifestRootPath : null

  // Plan-level disposition (pre-write counters) — drives the sidecar's
  // archivedOnly marker; the report below re-derives with actual counts.
  const plannedDisposition = deriveDisposition({
    refused: false,
    storeError: false,
    assetsImported: importedBatches.length,
    assetsSkipped: assetEntries.filter((a) => a.skipped !== null).length,
    lostSources: assetEntries.filter((a) => a.sourceResolution === 'lost').length,
    exportUnavailable: assetEntries.filter((a) => a.skipped === null && a.exportUnavailable).length,
    qaDropped,
    tmImported: tmInputs.length,
    termsImported: termInputs.length,
    archivesPlanned: archives.length,
  })

  // --- write phase (skipped entirely under --dry-run or on conflict) -----------
  let tmImported = 0
  let tmUnchanged = 0
  let termsImported = 0
  let termsUnchanged = 0
  let qaOpen = 0
  let qaWaived = 0
  let sidecarWritten = false
  let storeError: string | null = null
  if (!dryRun && !targetConflict) {
    try {
      // createProject throws StoreProjectExistsError on a race with the probe
      // above — the refusal path stays the store's own error.
      const project = store.createProject(
        { name, sourceLocale, targetLocale, promaWorkspaceId: workspaceId },
        { entropy: legacyImportEntropy(options.seed ?? `legacy${NUL}${options.projectId}`), now: now() },
      )
      const db = store.openProject(project.id)
      try {
        for (const { mapped, resolved } of importedBatches) {
          db.assets.insert(mapped.asset, mapped.segments)
          if (resolved.bytes !== null) db.saveAssetSource(mapped.asset.id, resolved.bytes)
        }
        const tmResult = db.tmUnits.importMany(tmInputs)
        tmImported = tmResult.imported
        tmUnchanged = tmResult.unchanged
        const termResult = db.termEntries.importMany(termInputs)
        termsImported = termResult.imported
        termsUnchanged = termResult.unchanged
        const inserted = db.qaFindings.insertOpen(qaInputs.map((q) => q.input))
        for (const [index, finding] of inserted.entries()) {
          const waiveReason = qaInputs[index]?.waiveReason ?? null
          if (waiveReason !== null) {
            db.qaFindings.transition(finding.id, 'waived', {
              reason: waiveReason,
              operator: 'legacy-migration',
              at: now(),
            })
            qaWaived++
          } else {
            qaOpen++
          }
        }
      } finally {
        db.close()
      }

      // archive artifacts (proposals raw JSON, ledger verbatim, exports verbatim,
      // chat bytes, rendered transcript, pi-session bytes)
      const projectDir = join(options.targetRoot, 'projects', newProjectId)
      for (const archive of archives) {
        const to = join(options.targetRoot, archive.to)
        mkdirSync(dirname(to), { recursive: true })
        if (archive.kind === 'chat-transcript') {
          // rendered markdown (generated, not copied) — transcriptPlan is
          // non-null whenever this archive kind exists
          writeFileSync(to, transcriptPlan!.markdown, 'utf8')
        } else if (archive.kind === 'pi-session') {
          // the retained extraction bytes: exactly what was hashed at extract
          const session = extraction.chat.sessions.find((s) => `${PI_SESSIONS_DIR}/${s.name}` === archive.from)
          if (session === undefined) throw new ImportDataError(`internal: pi-session archive ${archive.from} has no extraction bytes`)
          writeFileSync(to, session.content)
        } else {
          writeFileSync(to, readFileSync(join(extraction.dir, archive.from)))
        }
        archive.written = true
      }

      // sidecar (decision 12; PB-092 conditional fields externalSourceRoot / archivedOnly)
      const sidecar = {
        legacyProjectId: options.projectId,
        legacyRoot: extraction.root,
        legacyManifestUpdatedAt: manifest !== null && typeof manifest.updatedAt === 'string' ? manifest.updatedAt : null,
        sourceDigest: extraction.digest,
        importedAt: now(),
        scannerVersion: MIGRATION_TOOL_VERSION,
        dryRun: false,
        ...(externalSourceRoot !== null ? { externalSourceRoot } : {}),
        ...(plannedDisposition === 'archived-only' ? { archivedOnly: true } : {}),
      }
      writeFileSync(join(projectDir, 'legacy-import.json'), `${JSON.stringify(sidecar, null, 2)}\n`, 'utf8')
      sidecarWritten = true
    } catch (err) {
      // PB-092: a mid-flight store failure becomes disposition 'error' — the
      // report (with rollback steps) is still returned, never a bare throw.
      storeError = err instanceof Error ? err.message : String(err)
      notes.push(`store write failed mid-import: ${storeError}; project ${newProjectId} may be partially written — follow the rollback steps`)
    }
  } else {
    // projected counts (fresh target): every input would import
    tmImported = tmInputs.length
    termsImported = termInputs.length
    qaOpen = qaInputs.filter((q) => q.waiveReason === null).length
    qaWaived = qaInputs.filter((q) => q.waiveReason !== null).length
  }

  // --- report -------------------------------------------------------------------
  const segmentsByStatus: Record<string, number> = {}
  let segmentTotal = 0
  let lockedTotal = 0
  for (const { mapped } of importedBatches) {
    for (const segment of mapped.segments) {
      segmentTotal++
      if (segment.locked) lockedTotal++
      segmentsByStatus[segment.status] = (segmentsByStatus[segment.status] ?? 0) + 1
    }
  }
  const disposition = deriveDisposition({
    refused: false,
    storeError: storeError !== null,
    assetsImported: importedBatches.length,
    assetsSkipped: assetEntries.filter((a) => a.skipped !== null).length,
    lostSources: assetEntries.filter((a) => a.sourceResolution === 'lost').length,
    exportUnavailable: assetEntries.filter((a) => a.skipped === null && a.exportUnavailable).length,
    qaDropped,
    tmImported,
    termsImported,
    archivesPlanned: archives.length,
  })

  return {
    tool: 'linguist-legacy-import',
    version: 1,
    generatedAt: now(),
    dryRun,
    targetConflict,
    disposition,
    refusal: null,
    signals: extraction.signals,
    externalSource,
    legacyRoot: extraction.root,
    legacyProjectId: options.projectId,
    newProjectId,
    project: { name, sourceLocale, targetLocale, promaWorkspaceId: workspaceId },
    sourceDigest: extraction.digest,
    digestFiles: extraction.digestFiles.length,
    domains: {
      manifest: extraction.manifest.source,
      tm: extraction.tm.source,
      termbase: extraction.termbase.source,
      batches: Object.fromEntries(extraction.batches.map((b) => [b.batchId, b.source])),
    },
    assets: assetEntries,
    totals: {
      assets: importedBatches.length,
      assetsSkipped: assetEntries.filter((a) => a.skipped !== null).length,
      segments: segmentTotal,
      segmentsByStatus,
      lockedSegments: lockedTotal,
      tmImported,
      tmUnchanged,
      termsImported,
      termsUnchanged,
      qaOpen,
      qaWaived,
      qaDropped,
      proposalsArchived: archives.filter((a) => a.kind === 'proposal').length,
      exportsArchived: archives.filter((a) => a.kind === 'export').length,
    },
    droppedFields: counterToRecord(dropped),
    coercions: counterToRecord(coercions),
    archives,
    chat: chatSummary(extraction, {
      archived: archives.some((a) => a.kind === 'chat' && a.written),
      transcript:
        transcriptPlan === null
          ? null
          : {
              path: transcriptPlan.path,
              sha256: transcriptPlan.sha256,
              bytes: transcriptPlan.bytes,
              sessions: transcriptPlan.sessions,
              rows: transcriptPlan.rows,
              malformedRows: transcriptPlan.malformedRows,
              unassignedRows: transcriptPlan.unassignedRows,
            },
      piSessionsArchived: archives.filter((a) => a.kind === 'pi-session' && a.written).length,
    }),
    ledger: {
      present: extraction.ledger.present,
      valid: extraction.ledger.valid,
      events: extraction.ledger.events.length,
      reviewsApplied: reviews.size,
      error: extraction.ledger.error,
    },
    sidecar: { path: sidecarRelPath, written: sidecarWritten },
    rollback,
    notes,
  }
}
