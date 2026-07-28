/**
 * Import disposition + project routing (PB-092): pure functions that decide
 * HOW one legacy project is disposed of, derived from the extraction facts
 * and the import plan counters. No I/O, no store access — import.ts feeds
 * the inputs and executes the decision.
 *
 * The six release-blocker situations and their handling:
 * 1. invalid `full` permissionMode  -> never blocks; echoed as a signal.
 * 2. manifest root deleted          -> source chain uploads -> blob-store ->
 *    lost; disposition degrades to 'partial' when bytes are lost.
 * 3. external root + managed uploads -> user choice via --external-source
 *    (copy = read external bytes [PB-091 default]; reference = do not read
 *    external bytes, fall back to uploads -> blob-store -> lost).
 * 4. internal copy only             -> same chain as (2); blob-store layer
 *    recovers v2 managed copies from the CAS blob-store via source_refs.
 * 5. orphan project                 -> quarantined by default; imported with
 *    --salvage-orphan when batch payloads carry the language pair.
 * 6. quarantine                     -> a report-only refusal: zero writes,
 *    full ImportReport JSON on stdout, CLI exit 5.
 *
 * Disposition vocabulary (report.disposition):
 * - 'imported'      every asset imported, no lost/dropped/degraded data.
 * - 'partial'       something was skipped, lost, undeliverable or dropped.
 * - 'archived-only' no CAT data (assets/TM/TB) but artifacts were archived
 *                   (e.g. chat-only projects) — metadata-only project, not a
 *                   fabricated runnable one.
 * - 'quarantined'   refused: nothing written, refusal{reason,evidence} set.
 * - 'error'         a store-write exception aborted the import mid-flight.
 */

// ---------------------------------------------------------------------------
// disposition derivation

export type ImportDisposition = 'imported' | 'partial' | 'archived-only' | 'quarantined' | 'error'

export interface DispositionInput {
  /** Quarantine refusal (report.refusal !== null). Wins over everything. */
  refused: boolean
  /** A store-write phase exception aborted the import. */
  storeError: boolean
  assetsImported: number
  /** Batches not imported (unreadable payload, asset-id collision). */
  assetsSkipped: number
  /** Imported-or-skipped batches whose source bytes are lost (synthetic digest anchor). */
  lostSources: number
  /** IMPORTED assets whose re-export is unavailable (no adapter or lost source). */
  exportUnavailable: number
  /** QA findings dropped (unknown segment, unimported batch, superseded report...). */
  qaDropped: number
  tmImported: number
  termsImported: number
  /** Archive artifacts planned (proposals, ledger, exports, chat). */
  archivesPlanned: number
}

/**
 * Precedence: quarantine > store error > partial (any degradation) >
 * archived-only (zero CAT data but archives exist) > imported.
 * 'partial' beats 'archived-only' so a project whose CAT data failed to
 * import is never reported as a clean archive.
 */
export function deriveDisposition(input: DispositionInput): ImportDisposition {
  if (input.refused) return 'quarantined'
  if (input.storeError) return 'error'
  const degraded = input.assetsSkipped > 0 || input.lostSources > 0 || input.exportUnavailable > 0 || input.qaDropped > 0
  if (degraded) return 'partial'
  const catDataImported = input.assetsImported + input.tmImported + input.termsImported
  if (catDataImported === 0 && input.archivesPlanned > 0) return 'archived-only'
  return 'imported'
}

// ---------------------------------------------------------------------------
// project routing (orphan handling; PB-092 decisions 2-3)

export type QuarantineReason = 'orphan-project' | 'orphan-project-no-locales' | 'orphan-sqlite-project' | 'missing-locales'

export interface ImportRefusal {
  reason: QuarantineReason
  evidence?: Record<string, unknown>
}

export type ProjectRoute =
  /** No project directory and no manifest projection: genuinely unknown id. */
  | { kind: 'not-found' }
  /** Refused: report-only quarantine, zero writes, CLI exit 5. */
  | { kind: 'quarantine'; refusal: ImportRefusal }
  /** Orphan recovered under --salvage-orphan (languages from batch payloads). */
  | { kind: 'salvage' }
  /** Normal import path. */
  | { kind: 'import' }

export interface ProjectRouteInput {
  /** data/projects/<projectId>/ exists. */
  dirExists: boolean
  /** A manifest payload resolved from ANY layer (sqlite/read-cache/legacy JSON). */
  manifestResolved: boolean
  /** Manifest read error detail (unparseable projection), when any. */
  manifestError: string | null
  /** source+target language available from the manifest or any batch payload. */
  localesAvailable: boolean
  /** --salvage-orphan flag. */
  salvageOrphan: boolean
  /** Number of batch payloads readable from any layer (salvage evidence). */
  batches: number
  /** read-cache has projections for this project (orphan-sqlite evidence). */
  readCacheHasProjections: boolean
  /** CAS blob-store blob count (orphan-sqlite evidence). */
  blobStoreBlobs: number
}

/**
 * Route one legacy project. Rules (PB-092 decisions 2-3):
 * - directory + projection both absent           -> not-found (CLI exit 3).
 * - projection without a directory               -> ALWAYS quarantine
 *   (orphan-sqlite-project; evidence records read-cache/blob-store content;
 *   no directory-less salvage is offered).
 * - directory without a readable manifest        -> quarantine
 *   (orphan-project) unless --salvage-orphan AND batch payloads carry the
 *   language pair (-> salvage).
 * - readable manifest but no language pair anywhere -> quarantine
 *   (missing-locales; an empty shell is never fabricated).
 */
export function determineProjectRoute(input: ProjectRouteInput): ProjectRoute {
  if (!input.dirExists) {
    if (!input.manifestResolved) return { kind: 'not-found' }
    return {
      kind: 'quarantine',
      refusal: {
        reason: 'orphan-sqlite-project',
        evidence: {
          readCacheHasProjections: input.readCacheHasProjections,
          blobStoreBlobs: input.blobStoreBlobs,
        },
      },
    }
  }
  if (!input.manifestResolved) {
    if (input.salvageOrphan && input.localesAvailable) return { kind: 'salvage' }
    if (input.salvageOrphan) {
      return {
        kind: 'quarantine',
        refusal: {
          reason: 'orphan-project-no-locales',
          evidence: {
            manifestError: input.manifestError,
            batches: input.batches,
            salvageRequested: true,
          },
        },
      }
    }
    return {
      kind: 'quarantine',
      refusal: {
        reason: 'orphan-project',
        evidence: {
          manifestError: input.manifestError,
          batches: input.batches,
          hint: 'rerun with --salvage-orphan to import using batch-payload languages and the directory name',
        },
      },
    }
  }
  if (!input.localesAvailable) {
    return {
      kind: 'quarantine',
      refusal: { reason: 'missing-locales', evidence: { batches: input.batches } },
    }
  }
  return { kind: 'import' }
}
