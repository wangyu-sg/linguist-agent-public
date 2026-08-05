/**
 * Typed format errors. Mirrors the cat-core DomainError pattern: each error
 * carries a stable machine-readable `code` string — codes are part of the
 * public contract and must never change without a migration note.
 *
 * NOTE: these intentionally do NOT extend cat-core's `DomainError` — its
 * `code` field is typed as the closed `DomainErrorCode` union, so subclassing
 * with new codes would break the type contract. The pattern (abstract base +
 * stable codes + `instanceof` catch-all) is replicated instead.
 */

export const FORMAT_ERROR_CODES = {
  /** Import failed: bytes could not be parsed as the adapter's format. */
  FORMAT_PARSE_ERROR: 'FORMAT_PARSE_ERROR',
  /** Export failed: segments could not be written into the original template. */
  FORMAT_EXPORT_ERROR: 'FORMAT_EXPORT_ERROR',
  /**
   * Round-trip invariant violation: segments present after import were lost
   * (or silently dropped) by export. Never skip failed segments silently.
   */
  FORMAT_SEGMENT_LOST: 'FORMAT_SEGMENT_LOST',
  /** No adapter accepts the given bytes/filename, or format is unsupported. */
  FORMAT_UNSUPPORTED: 'FORMAT_UNSUPPORTED',
} as const

export type FormatErrorCode = (typeof FORMAT_ERROR_CODES)[keyof typeof FORMAT_ERROR_CODES]

export abstract class FormatError extends Error {
  abstract readonly code: FormatErrorCode
}

/** Import-side parse failure. Always carries adapter id + filename + detail. */
export class FormatParseError extends FormatError {
  readonly code = FORMAT_ERROR_CODES.FORMAT_PARSE_ERROR
  constructor(
    readonly adapterId: string,
    readonly filename: string,
    readonly detail: string,
    options?: { cause?: unknown },
  ) {
    super(`[${adapterId}] failed to parse ${filename}: ${detail}`, options)
    this.name = 'FormatParseError'
  }
}

/** Export-side failure (template mismatch, unknown segment, write error). */
export class FormatExportError extends FormatError {
  readonly code = FORMAT_ERROR_CODES.FORMAT_EXPORT_ERROR
  constructor(
    readonly adapterId: string,
    readonly detail: string,
    options?: { cause?: unknown },
  ) {
    super(`[${adapterId}] export failed: ${detail}`, options)
    this.name = 'FormatExportError'
  }
}

/**
 * Segments were lost between import and re-import of exported output.
 * Raised by the round-trip harness (and usable by adapters themselves) —
 * silent segment drops are a hard failure, never a warning.
 */
export class FormatSegmentLostError extends FormatError {
  readonly code = FORMAT_ERROR_CODES.FORMAT_SEGMENT_LOST
  constructor(
    readonly adapterId: string,
    readonly missingSegmentIds: readonly string[],
    readonly detail?: string,
  ) {
    super(
      `[${adapterId}] ${missingSegmentIds.length} segment(s) lost on round-trip: ${missingSegmentIds.join(', ')}` +
        (detail ? ` (${detail})` : ''),
    )
    this.name = 'FormatSegmentLostError'
  }
}

/** No registered adapter accepts the input (detect score 0 for all). */
export class FormatUnsupportedError extends FormatError {
  readonly code = FORMAT_ERROR_CODES.FORMAT_UNSUPPORTED
  constructor(
    readonly filename: string,
    readonly triedAdapterIds: readonly string[],
  ) {
    super(
      `No format adapter accepts ${filename}` +
        (triedAdapterIds.length > 0 ? ` (tried: ${triedAdapterIds.join(', ')})` : ' (registry is empty)'),
    )
    this.name = 'FormatUnsupportedError'
  }
}
