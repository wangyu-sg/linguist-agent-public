/**
 * Typed store errors. Mirrors the cat-formats error pattern (which mirrors
 * cat-core's DomainError): each error carries a stable machine-readable
 * `code` string — codes are part of the public contract and must never
 * change without a migration note.
 *
 * Store errors intentionally do NOT extend cat-core's DomainError: its
 * `code` field is typed as the closed `DomainErrorCode` union, so
 * subclassing with new codes would break the type contract. Domain errors
 * (RevisionConflictError, SegmentLockedError, ...) propagate through the
 * store unchanged — repositories never swallow or re-wrap them.
 */

export const STORE_ERROR_CODES = {
  /** node:sqlite is not available in this JS runtime (e.g. bun). */
  STORE_SQLITE_UNAVAILABLE: 'STORE_SQLITE_UNAVAILABLE',
  /** The DB on disk has a NEWER schema than this code knows — fail closed. */
  STORE_SCHEMA_TOO_NEW: 'STORE_SCHEMA_TOO_NEW',
  /** An existing SQLite file is not a verified Linguist CAT database. */
  STORE_DATABASE_IDENTITY: 'STORE_DATABASE_IDENTITY',
  /** Project / asset / proposal / DB file does not exist. */
  STORE_NOT_FOUND: 'STORE_NOT_FOUND',
  /** projects.json exists but is not parseable / has an invalid shape. */
  STORE_INDEX_CORRUPT: 'STORE_INDEX_CORRUPT',
  /** A write was attempted on a read-only database handle. */
  STORE_READ_ONLY: 'STORE_READ_ONLY',
  /** SQLITE_BUSY surfaced after the busy timeout. */
  STORE_BUSY: 'STORE_BUSY',
  /** createProject was called for a project that already exists. */
  STORE_PROJECT_EXISTS: 'STORE_PROJECT_EXISTS',
  /** Active project reorder input is stale or is not an exact permutation. */
  PROJECT_ORDER_CONFLICT: 'PROJECT_ORDER_CONFLICT',
  /** A source blob's bytes do not match the asset row's sourceSha256. */
  STORE_ASSET_SOURCE_MISMATCH: 'STORE_ASSET_SOURCE_MISMATCH',
  /** A backup failed verification (manifest / sha256 / quick_check / schema). */
  STORE_BACKUP_CORRUPT: 'STORE_BACKUP_CORRUPT',
  /** A pre-manifest (two-file) backup: restorable = false, preview only. */
  STORE_BACKUP_LEGACY: 'STORE_BACKUP_LEGACY',
  /** A session attempted to access run state owned by another bound session. */
  STORE_AUTHORITY: 'STORE_AUTHORITY',
  /** A durable translation job transition/checkpoint violated its state contract. */
  STORE_JOB_STATE: 'STORE_JOB_STATE',
  /** An idempotency key was reused for a different operation, payload, or tool identity. */
  STORE_IDEMPOTENCY_CONFLICT: 'STORE_IDEMPOTENCY_CONFLICT',
} as const

export type StoreErrorCode = (typeof STORE_ERROR_CODES)[keyof typeof STORE_ERROR_CODES]

export abstract class StoreError extends Error {
  abstract readonly code: StoreErrorCode
}

/** node:sqlite could not be loaded in the current JS runtime. */
export class StoreSqliteUnavailableError extends StoreError {
  readonly code = STORE_ERROR_CODES.STORE_SQLITE_UNAVAILABLE
  constructor(readonly detail: string) {
    super(
      `node:sqlite is not available in this runtime (${detail}). ` +
        'The CAT store requires Node >= 22.5 (Electron main process); run the store tests via the package `test` script (node --test), not bun.',
    )
    this.name = 'StoreSqliteUnavailableError'
  }
}

/**
 * The database on disk carries a schema version newer than this build
 * understands. Opening it would risk silent data loss — the store fails
 * closed instead.
 */
export class StoreSchemaTooNewError extends StoreError {
  readonly code = STORE_ERROR_CODES.STORE_SCHEMA_TOO_NEW
  constructor(
    readonly dbPath: string,
    readonly diskVersion: number,
    readonly codeVersion: number,
  ) {
    super(
      `Database ${dbPath} has schema version ${diskVersion}, but this build only understands up to ${codeVersion}. ` +
        'Refusing to open (fail closed); upgrade the application.',
    )
    this.name = 'StoreSchemaTooNewError'
  }
}

/** An existing SQLite file failed the read-only Linguist identity preflight. */
export class StoreDatabaseIdentityError extends StoreError {
  readonly code = STORE_ERROR_CODES.STORE_DATABASE_IDENTITY
  constructor(
    readonly dbPath: string,
    readonly detail: string,
  ) {
    super(`Database ${dbPath} is not a verified Linguist CAT database: ${detail}. Refusing to modify it.`)
    this.name = 'StoreDatabaseIdentityError'
  }
}

/** Something addressed by id/path does not exist. */
export class StoreNotFoundError extends StoreError {
  readonly code = STORE_ERROR_CODES.STORE_NOT_FOUND
  constructor(
    readonly entity: string,
    readonly key: string,
  ) {
    super(`${entity} not found: ${key}.`)
    this.name = 'StoreNotFoundError'
  }
}

/** projects.json (or project.json) exists but cannot be parsed/validated. */
export class StoreIndexCorruptError extends StoreError {
  readonly code = STORE_ERROR_CODES.STORE_INDEX_CORRUPT
  constructor(
    readonly filePath: string,
    readonly detail: string,
  ) {
    super(
      `Project index ${filePath} is corrupt: ${detail}. ` +
        'Restore it from a backup or fix the JSON manually; the store refuses to guess.',
    )
    this.name = 'StoreIndexCorruptError'
  }
}

/** A write was attempted on a read-only database handle. */
export class StoreReadOnlyError extends StoreError {
  readonly code = STORE_ERROR_CODES.STORE_READ_ONLY
  constructor(readonly operation: string) {
    super(`Database handle is read-only; write operation rejected: ${operation}.`)
    this.name = 'StoreReadOnlyError'
  }
}

/** SQLITE_BUSY after the busy timeout elapsed. */
export class StoreBusyError extends StoreError {
  readonly code = STORE_ERROR_CODES.STORE_BUSY
  constructor(readonly operation: string) {
    super(`Database is busy (SQLITE_BUSY after busy_timeout) during: ${operation}.`)
    this.name = 'StoreBusyError'
  }
}

/** createProject was called for an id that already exists in the index. */
export class StoreProjectExistsError extends StoreError {
  readonly code = STORE_ERROR_CODES.STORE_PROJECT_EXISTS
  constructor(readonly projectId: string) {
    super(`Project already exists: ${projectId}.`)
    this.name = 'StoreProjectExistsError'
  }
}

/** Active project reorder input is not an exact permutation of the current active ids. */
export class StoreProjectOrderConflictError extends StoreError {
  readonly code = STORE_ERROR_CODES.PROJECT_ORDER_CONFLICT
  constructor(readonly detail: string) {
    super(`Active project order conflict: ${detail}. Refresh the project list and retry.`)
    this.name = 'StoreProjectOrderConflictError'
  }
}

/**
 * A source blob's bytes do not match the asset row's recorded sourceSha256
 * (the CAS anchor of plan §6.3). The store refuses to persist or hand out
 * inconsistent bytes — a mismatch means caller bug or on-disk corruption.
 */
export class StoreAssetSourceMismatchError extends StoreError {
  readonly code = STORE_ERROR_CODES.STORE_ASSET_SOURCE_MISMATCH
  constructor(readonly assetId: string) {
    super(
      `Source blob for asset ${assetId} does not match its recorded sourceSha256; ` +
        'refusing inconsistent bytes.',
    )
    this.name = 'StoreAssetSourceMismatchError'
  }
}

/**
 * A backup directory failed verification: manifest missing/invalid, a
 * listed file missing or with mismatched size/sha256, the backed-up
 * cat.db unopenable (including schema-too-new, fail closed), or
 * PRAGMA quick_check reporting corruption. Restore refuses such backups;
 * the current project state is never touched.
 */
export class StoreBackupCorruptError extends StoreError {
  readonly code = STORE_ERROR_CODES.STORE_BACKUP_CORRUPT
  constructor(
    readonly backupName: string,
    readonly problems: readonly string[],
  ) {
    super(
      `Backup ${backupName} failed verification (${problems.length} problem(s)): ${problems.join('; ')}. ` +
        'Refusing to restore; the current project state is untouched.',
    )
    this.name = 'StoreBackupCorruptError'
  }
}

/**
 * A pre-manifest backup (PB-024 two-file layout: backups/cat-<ts>.db +
 * project-<ts>.json). Such backups lack source/blobs and a manifest, so
 * restore is explicitly unsupported; preview (read-only DB summary) is
 * still available in degraded form.
 */
export class StoreBackupLegacyError extends StoreError {
  readonly code = STORE_ERROR_CODES.STORE_BACKUP_LEGACY
  constructor(readonly backupName: string) {
    super(
      `Backup ${backupName} uses the legacy pre-manifest format (no manifest, no source/blobs copy). ` +
        'Restore is not supported for legacy backups; create a new backup instead.',
    )
    this.name = 'StoreBackupLegacyError'
  }
}

/** Session-bound run state never accepts authority supplied by another session. */
export class StoreAuthorityError extends StoreError {
  readonly code = STORE_ERROR_CODES.STORE_AUTHORITY
  constructor(
    readonly entity: string,
    readonly key: string,
  ) {
    super(`Bound session is not authorized to access ${entity}: ${key}.`)
    this.name = 'StoreAuthorityError'
  }
}

/** Invalid durable job transition/checkpoint; the transaction is rolled back. */
export class StoreJobStateError extends StoreError {
  readonly code = STORE_ERROR_CODES.STORE_JOB_STATE
  constructor(
    readonly jobId: string,
    readonly detail: string,
  ) {
    super(`Translation job ${jobId} rejected: ${detail}.`)
    this.name = 'StoreJobStateError'
  }
}

/** Reusing a mutation key for different input is a hard conflict, never a retry. */
export class StoreIdempotencyConflictError extends StoreError {
  readonly code = STORE_ERROR_CODES.STORE_IDEMPOTENCY_CONFLICT
  constructor(readonly idempotencyKey: string) {
    super(`Idempotency key was reused with conflicting mutation input: ${idempotencyKey}.`)
    this.name = 'StoreIdempotencyConflictError'
  }
}

/** SQLite error codes we translate (from node:sqlite's `errcode`). */
const SQLITE_BUSY = 5
const SQLITE_READONLY = 8

/**
 * Translate raw node:sqlite errors into typed store errors where a stable
 * mapping exists. Domain/store errors pass through unchanged; unknown
 * sqlite failures are re-thrown as-is (never silently swallowed).
 */
export function translateSqliteError(err: unknown, operation: string): never {
  if (err instanceof StoreError) throw err
  if (err instanceof Error) {
    const errcode = (err as { errcode?: unknown }).errcode
    if (errcode === SQLITE_BUSY) throw new StoreBusyError(operation)
    if (errcode === SQLITE_READONLY || /readonly database/i.test(err.message)) {
      throw new StoreReadOnlyError(operation)
    }
  }
  throw err
}
