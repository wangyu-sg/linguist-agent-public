/**
 * Generic round-trip test harness (plan §6.3) for CatFormatAdapters.
 *
 * One entry point — `assertRoundTrip(adapter, bytes, opts)` — runs the full
 * cycle and throws typed FormatErrors on any violation:
 *
 *   import original bytes
 *   -> assert import recorded SHA-256 of the original bytes
 *   -> bind segments to a deterministic project/asset (cat-core)
 *   -> (optional) export unmodified -> assert byte-stable output
 *   -> modify targets of a subset via cat-core applyTargetEdit (CAS)
 *   -> export with originalBytes as template
 *   -> re-import exported bytes
 *   -> assert segment count equal, ids equal and ordered, sources intact,
 *      unmodified targets identical, modified targets applied,
 *      adapter-provided invariants hold
 *
 * Silent segment drops fail with FormatSegmentLostError — never a warning.
 */

import {
  applyTargetEdit,
  createAsset,
  createProject,
  createSeededEntropy,
  type Asset,
  type Segment,
} from '@linguist/cat-core'
import type { CatFormatAdapter, ImportWarning } from '../adapter'
import { bindImportedSegments } from '../adapter'
import { FormatExportError, FormatParseError, FormatSegmentLostError } from '../errors'
import { sha256Hex, type HashFn } from '../hash'

/**
 * Adapter-provided invariant asserted for every segment pair
 * (original import vs re-import of exported output), e.g. "inline tag set
 * preserved", "placeholder tokens preserved". Throw inside `assert` to fail.
 */
export interface RoundTripInvariant {
  name: string
  assert(before: Segment, after: Segment): void
}

export interface RoundTripOptions {
  /** Default 'sample.<first adapter extension or bin>'. */
  filename?: string
  sourceLocale?: string
  targetLocale?: string
  /** Injectable hasher; default is the built-in pure-TS SHA-256. */
  hash?: HashFn
  /**
   * Target mutation per segment: return the new target ('' is a valid
   * edit), or null/undefined to leave the segment unmodified.
   * Default: every second segment gets `[<targetLocale>] <source>`.
   */
  modify?: (segment: Segment, index: number) => string | null | undefined
  /** Adapter-specific invariants (tags/placeholders/...). */
  invariants?: RoundTripInvariant[]
  /**
   * Assert that exporting the unmodified import reproduces the original
   * bytes exactly (plan §6.3 byte-stability rule). Default true; requires
   * canonical-form input bytes.
   */
  assertByteStableUnmodified?: boolean
  /** Fixed ISO timestamp for revision entries (determinism). */
  now?: string
}

export interface RoundTripReport {
  adapterId: string
  filename: string
  /** SHA-256 (hex) of the original bytes, as recorded by import. */
  sourceSha256: string
  segmentCount: number
  /** Ids of segments whose target was modified before export. */
  modifiedSegmentIds: string[]
  /** The exported bytes (re-imported and verified). */
  exportedBytes: Uint8Array
  warnings: ImportWarning[]
}

const DEFAULT_NOW = '2026-01-01T00:00:00.000Z'

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false
  return true
}

/**
 * Runs the full round-trip against `adapter` and returns a report on
 * success. Throws FormatParseError / FormatExportError /
 * FormatSegmentLostError on any contract violation.
 */
export async function assertRoundTrip(
  adapter: CatFormatAdapter,
  originalBytes: Uint8Array,
  options: RoundTripOptions = {},
): Promise<RoundTripReport> {
  const hash = options.hash ?? sha256Hex
  const filename = options.filename ?? `sample${adapter.extensions[0] ?? '.bin'}`
  const sourceLocale = options.sourceLocale ?? 'en'
  const targetLocale = options.targetLocale ?? 'zh-CN'
  const now = options.now ?? DEFAULT_NOW
  const modify =
    options.modify ??
    ((segment: Segment, index: number): string | null =>
      index % 2 === 0 ? `[${targetLocale}] ${segment.source}` : null)

  // 1. Import + SHA-256 recording (hard rule: import stores source SHA-256).
  const expectedSha256 = await hash(originalBytes)
  const imported = await adapter.import({ bytes: originalBytes, filename, sourceLocale, targetLocale })
  if (imported.asset.sourceSha256 !== expectedSha256) {
    throw new FormatParseError(
      adapter.id,
      filename,
      `import recorded sourceSha256 ${imported.asset.sourceSha256}, expected ${expectedSha256} (SHA-256 of the original bytes)`,
    )
  }
  if (imported.asset.segmentCount !== imported.segments.length) {
    throw new FormatParseError(
      adapter.id,
      filename,
      `asset.segmentCount ${imported.asset.segmentCount} does not match ${imported.segments.length} imported segment(s)`,
    )
  }

  // 2. Deterministic project/asset + segment identity binding (cat-core).
  const project = createProject(
    {
      name: 'round-trip-harness',
      sourceLocale,
      targetLocale,
      promaWorkspaceId: 'round-trip-harness',
    },
    { entropy: createSeededEntropy(`round-trip:${adapter.id}:${filename}`), now },
  )
  const asset: Asset = createAsset({
    projectId: project.id,
    formatId: imported.asset.formatId,
    originalFilename: filename,
    sourceSha256: imported.asset.sourceSha256,
    segmentCount: imported.asset.segmentCount,
  })
  const initial = bindImportedSegments(imported.segments, asset.id)

  // 3. Byte-stability: unmodified export must reproduce the original bytes.
  if (options.assertByteStableUnmodified ?? true) {
    const unmodified = await adapter.export({ originalBytes, asset, segments: initial })
    if (!bytesEqual(unmodified, originalBytes)) {
      throw new FormatExportError(
        adapter.id,
        'unmodified export is not byte-stable: exporting the untouched import must reproduce the original bytes exactly',
      )
    }
  }

  // 4. Modify a subset of targets via cat-core CAS edits.
  const modifiedIds = new Map<string, string>()
  const edited = initial.map((segment, index) => {
    const newTarget = modify(segment, index)
    if (newTarget == null || segment.locked) return segment
    const result = applyTargetEdit(segment, newTarget, segment.revision, { now })
    modifiedIds.set(segment.id, newTarget)
    return result.segment
  })

  // 5. Export with the original bytes as template; 6. re-import the output.
  const exportedBytes = await adapter.export({ originalBytes, asset, segments: edited })
  const reimported = await adapter.import({ bytes: exportedBytes, filename, sourceLocale, targetLocale })
  const roundTripped = bindImportedSegments(reimported.segments, asset.id)

  // 7. Segment loss is a hard failure — count, identity and order.
  if (roundTripped.length !== initial.length) {
    const reIds = new Set(roundTripped.map((s) => s.id))
    const missing = initial.filter((s) => !reIds.has(s.id)).map((s) => s.id)
    if (missing.length > 0) {
      throw new FormatSegmentLostError(
        adapter.id,
        missing,
        `imported ${initial.length} segment(s), re-imported ${roundTripped.length} after export`,
      )
    }
    throw new FormatExportError(
      adapter.id,
      `re-import produced ${roundTripped.length - initial.length} extra segment(s) not present in the original`,
    )
  }
  const reIdSet = new Set(roundTripped.map((s) => s.id))
  const missingIds = initial.filter((s) => !reIdSet.has(s.id)).map((s) => s.id)
  if (missingIds.length > 0) {
    throw new FormatSegmentLostError(adapter.id, missingIds, 'segment ids changed across the round-trip')
  }
  for (let i = 0; i < initial.length; i++) {
    if (roundTripped[i]!.id !== initial[i]!.id) {
      throw new FormatExportError(
        adapter.id,
        `segment order changed at position ${i}: expected ${initial[i]!.id}, got ${roundTripped[i]!.id}`,
      )
    }
  }

  // 8. Per-segment content assertions + adapter invariants.
  for (let i = 0; i < initial.length; i++) {
    const before = initial[i]!
    const after = roundTripped[i]!
    if (after.source !== before.source) {
      throw new FormatExportError(adapter.id, `segment ${before.id}: source text mutated across the round-trip`)
    }
    const expectedTarget = modifiedIds.get(before.id) ?? before.target
    if (after.target !== expectedTarget) {
      throw new FormatExportError(
        adapter.id,
        `segment ${before.id}: target mismatch; expected ${JSON.stringify(expectedTarget)}, got ${JSON.stringify(after.target)}`,
      )
    }
    for (const invariant of options.invariants ?? []) {
      try {
        invariant.assert(before, after)
      } catch (err) {
        throw new FormatExportError(
          adapter.id,
          `segment ${before.id}: invariant "${invariant.name}" failed: ${err instanceof Error ? err.message : String(err)}`,
          { cause: err },
        )
      }
    }
  }

  return {
    adapterId: adapter.id,
    filename,
    sourceSha256: imported.asset.sourceSha256,
    segmentCount: initial.length,
    modifiedSegmentIds: [...modifiedIds.keys()],
    exportedBytes,
    warnings: imported.warnings,
  }
}
