/**
 * Low-level cat.db handle (plan §5.7): open with pragmas, apply schema
 * migrations transactionally, fail closed on newer on-disk schemas,
 * support read-only opens, and translate sqlite errors into typed store
 * errors.
 *
 * Pragmas (writable open): journal_mode=WAL, synchronous=FULL,
 * foreign_keys=ON, busy_timeout=5000. Read-only opens skip journal_mode
 * (it would write) and never run migrations.
 */

import { existsSync } from 'node:fs'
import { StoreNotFoundError, StoreReadOnlyError, StoreSchemaTooNewError, translateSqliteError } from './errors'
import { loadDatabaseSync, type SqliteDatabase } from './runtime'
import { MIGRATIONS, SCHEMA_VERSION } from './schema'

export interface OpenCatDatabaseOptions {
  /** Open without write access (migration scanner, backup verification). */
  readOnly?: boolean
  /** Clock for schema_migrations.applied_at; inject for determinism. */
  now?: () => string
}

export interface AppliedMigration {
  version: number
  description: string
}

export class CatDatabase {
  private constructor(
    readonly db: SqliteDatabase,
    readonly path: string,
    readonly readOnly: boolean,
    readonly schemaVersion: number,
    /** Migrations applied by THIS open call (empty for read-only / up-to-date). */
    readonly appliedMigrations: readonly AppliedMigration[],
  ) {}

  static open(path: string, options: OpenCatDatabaseOptions = {}): CatDatabase {
    const readOnly = options.readOnly ?? false
    if (readOnly && !existsSync(path)) {
      throw new StoreNotFoundError('cat database', path)
    }
    const DatabaseSync = loadDatabaseSync()
    let db: SqliteDatabase
    try {
      db = new DatabaseSync(path, readOnly ? { readOnly: true } : {})
    } catch (err) {
      translateSqliteError(err, `open ${path}`)
    }

    try {
      applyPragmas(db, readOnly)
      if (readOnly) {
        const version = readSchemaVersion(db, path)
        if (version > SCHEMA_VERSION) throw new StoreSchemaTooNewError(path, version, SCHEMA_VERSION)
        return new CatDatabase(db, path, true, version, [])
      }
      const { version, applied } = applyMigrations(db, path, options.now ?? (() => new Date().toISOString()))
      return new CatDatabase(db, path, false, version, applied)
    } catch (err) {
      try {
        db.close()
      } catch {
        // already broken; surface the original error
      }
      throw err
    }
  }

  /** Throw StoreReadOnlyError when a write is attempted on a read-only handle. */
  assertWritable(operation: string): void {
    if (this.readOnly) throw new StoreReadOnlyError(operation)
  }

  /**
   * Run `fn` inside BEGIN IMMEDIATE ... COMMIT; any throw rolls the whole
   * transaction back — multi-statement writes never land partially.
   */
  transaction<T>(operation: string, fn: () => T): T {
    this.assertWritable(operation)
    this.db.exec('BEGIN IMMEDIATE')
    try {
      const result = fn()
      this.db.exec('COMMIT')
      return result
    } catch (err) {
      try {
        this.db.exec('ROLLBACK')
      } catch {
        // rollback itself failed; the original error is more useful
      }
      translateSqliteError(err, operation)
    }
  }

  /** Execute a raw write statement with error translation (internal use). */
  execWrite(operation: string, sql: string): void {
    this.assertWritable(operation)
    try {
      this.db.exec(sql)
    } catch (err) {
      translateSqliteError(err, operation)
    }
  }

  close(): void {
    try {
      this.db.close()
    } catch (err) {
      translateSqliteError(err, `close ${this.path}`)
    }
  }
}

function applyPragmas(db: SqliteDatabase, readOnly: boolean): void {
  if (!readOnly) {
    db.exec('PRAGMA journal_mode = WAL')
    db.exec('PRAGMA synchronous = FULL')
  }
  db.exec('PRAGMA foreign_keys = ON')
  db.exec('PRAGMA busy_timeout = 5000')
}

function tableExists(db: SqliteDatabase, name: string): boolean {
  const row = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?")
    .get(name) as { name: string } | undefined
  return row !== undefined
}

function readSchemaVersion(db: SqliteDatabase, path: string): number {
  if (!tableExists(db, 'schema_migrations')) {
    throw new StoreNotFoundError('cat database schema (schema_migrations)', path)
  }
  const row = db.prepare('SELECT MAX(version) AS v FROM schema_migrations').get() as
    | { v: number | null }
    | undefined
  return row?.v ?? 0
}

function applyMigrations(
  db: SqliteDatabase,
  path: string,
  now: () => string,
): { version: number; applied: AppliedMigration[] } {
  // Fresh databases get the bookkeeping table first; a file that has user
  // tables but no schema_migrations is not something we dare guess about.
  if (!tableExists(db, 'schema_migrations')) {
    db.exec(`
      CREATE TABLE schema_migrations (
        version INTEGER PRIMARY KEY,
        applied_at TEXT NOT NULL,
        description TEXT NOT NULL
      )
    `)
  }
  const current = readSchemaVersion(db, path)
  if (current > SCHEMA_VERSION) throw new StoreSchemaTooNewError(path, current, SCHEMA_VERSION)

  const applied: AppliedMigration[] = []
  const insertRecord = db.prepare(
    'INSERT INTO schema_migrations (version, applied_at, description) VALUES (?, ?, ?)',
  )
  for (const migration of MIGRATIONS) {
    if (migration.version <= current) continue
    db.exec('BEGIN IMMEDIATE')
    try {
      db.exec(migration.sql)
      insertRecord.run(migration.version, now(), migration.description)
      db.exec('COMMIT')
    } catch (err) {
      try {
        db.exec('ROLLBACK')
      } catch {
        // surface the original failure
      }
      translateSqliteError(err, `migration ${migration.version} (${migration.description})`)
    }
    applied.push({ version: migration.version, description: migration.description })
  }
  return { version: SCHEMA_VERSION, applied }
}
