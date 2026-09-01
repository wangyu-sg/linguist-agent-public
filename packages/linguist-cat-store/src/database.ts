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
import {
  StoreDatabaseIdentityError,
  StoreNotFoundError,
  StoreReadOnlyError,
  StoreSchemaTooNewError,
  translateSqliteError,
} from './errors'
import { loadDatabaseSync, probeSqliteRuntime, type SqliteDatabase } from './runtime'
import { MIGRATIONS, SCHEMA_VERSION } from './schema'

/** SQLite header "LACA" (Linguist Agent CAT): 0x4c414341 / 1279345473, positive int32. */
export const LINGUIST_APPLICATION_ID = 0x4c414341

export interface OpenCatDatabaseOptions {
  /** Open without write access (migration scanner, backup verification). */
  readOnly?: boolean
  /** Clock for schema_migrations.applied_at; inject for determinism. */
  now?: () => string
  /** Trusted project identity supplied by ProjectDatabase for preflight validation. */
  expectedProjectId?: string
  /** Trusted project.json application id, when one has been recorded. */
  expectedApplicationId?: number
  /** Trusted project.json database schema snapshot, when one has been recorded. */
  expectedSchemaVersion?: number
}

export interface AppliedMigration {
  version: number
  description: string
}

interface InspectedDatabaseIdentity {
  applicationId: number
  schemaVersion: number
}

export class CatDatabase {
  private transactionDepth = 0

  private constructor(
    readonly db: SqliteDatabase,
    readonly path: string,
    readonly readOnly: boolean,
    readonly schemaVersion: number,
    /** Migrations applied by THIS open call (empty for read-only / up-to-date). */
    readonly appliedMigrations: readonly AppliedMigration[],
    /** This open created/stamped/migrated the SQLite header identity. */
    readonly identityChanged: boolean,
  ) {}

  static open(path: string, options: OpenCatDatabaseOptions = {}): CatDatabase {
    const readOnly = options.readOnly ?? false
    if (readOnly && !existsSync(path)) {
      throw new StoreNotFoundError('cat database', path)
    }
    const DatabaseSync = loadDatabaseSync()
    const existingIdentity = path !== ':memory:' && existsSync(path)
      ? preflightExistingDatabase(DatabaseSync, path, options)
      : undefined
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
        return new CatDatabase(db, path, true, version, [], false)
      }
      const { version, applied } = applyMigrations(
        db,
        path,
        options.now ?? (() => new Date().toISOString()),
        existingIdentity?.applicationId === LINGUIST_APPLICATION_ID,
      )
      const identityChanged = existingIdentity === undefined
        || existingIdentity.applicationId === 0
        || applied.length > 0
      if (identityChanged) stampDatabaseIdentity(db, version)
      return new CatDatabase(db, path, false, version, applied, identityChanged)
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
    if (this.transactionDepth > 0) return fn()
    this.db.exec('BEGIN IMMEDIATE')
    this.transactionDepth = 1
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
    } finally {
      this.transactionDepth = 0
    }
  }

  /** Create a consistent SQLite snapshot without requiring a writable source handle. */
  backupInto(destinationPath: string): 'vacuum_into' | 'backup_api' {
    const probe = probeSqliteRuntime()
    if (probe.hasBackupApi && this.db.backup) {
      const result = this.db.backup(destinationPath)
      if (result instanceof Promise) throw new Error('async DatabaseSync#backup is unsupported')
      return 'backup_api'
    }
    const quoted = `'${destinationPath.replace(/'/g, "''")}'`
    try {
      this.db.exec(`VACUUM INTO ${quoted}`)
    } catch (err) {
      translateSqliteError(err, `backup into ${destinationPath}`)
    }
    return 'vacuum_into'
  }

  close(): void {
    try {
      this.db.close()
    } catch (err) {
      translateSqliteError(err, `close ${this.path}`)
    }
  }
}

function stampDatabaseIdentity(db: SqliteDatabase, schemaVersion: number): void {
  db.exec('BEGIN IMMEDIATE')
  try {
    db.exec(`PRAGMA application_id = ${LINGUIST_APPLICATION_ID}`)
    db.exec(`PRAGMA user_version = ${schemaVersion}`)
    db.exec('COMMIT')
  } catch (err) {
    try {
      db.exec('ROLLBACK')
    } catch {
      // surface the original failure
    }
    translateSqliteError(err, 'stamp database identity')
  }
}

function preflightExistingDatabase(
  DatabaseSync: ReturnType<typeof loadDatabaseSync>,
  path: string,
  options: OpenCatDatabaseOptions,
): InspectedDatabaseIdentity {
  let db: SqliteDatabase
  try {
    db = new DatabaseSync(path, { readOnly: true })
  } catch (err) {
    translateSqliteError(err, `preflight ${path}`)
  }
  try {
    const tables = readTableNames(db)
    const applicationId = readPragmaInteger(db, path, 'application_id')
    const userVersion = readPragmaInteger(db, path, 'user_version')
    if (applicationId !== 0 && applicationId !== LINGUIST_APPLICATION_ID) {
      throw new StoreDatabaseIdentityError(path, `application_id ${applicationId} belongs to another application`)
    }
    if (applicationId === 0 && userVersion !== 0) {
      throw new StoreDatabaseIdentityError(path, `unstamped database has non-zero user_version ${userVersion}`)
    }
    if (!tables.has('schema_migrations')) {
      throw new StoreDatabaseIdentityError(path, 'schema_migrations marker is missing')
    }
    assertSchemaMigrationTable(db, path)
    const rows = db
      .prepare('SELECT version, description FROM schema_migrations ORDER BY version')
      .all() as Array<{ version: number; description: string }>
    const schemaVersion = rows.at(-1)?.version ?? 0
    if (schemaVersion > SCHEMA_VERSION || userVersion > SCHEMA_VERSION) {
      throw new StoreSchemaTooNewError(path, Math.max(schemaVersion, userVersion), SCHEMA_VERSION)
    }
    if (rows.length === 0) {
      throw new StoreDatabaseIdentityError(path, 'schema_migrations marker has no migration history')
    }
    for (let index = 0; index < rows.length; index++) {
      const row = rows[index]!
      const expected = MIGRATIONS[index]
      if (
        row.version !== index + 1
        || expected === undefined
        || row.description !== expected.description
      ) {
        throw new StoreDatabaseIdentityError(path, `migration history diverges at version ${index + 1}`)
      }
    }
    const missingTables = expectedTablesThrough(schemaVersion).filter((table) => !tables.has(table))
    if (missingTables.length > 0) {
      throw new StoreDatabaseIdentityError(path, `schema marker is incomplete; missing ${missingTables.join(', ')}`)
    }
    if (applicationId === LINGUIST_APPLICATION_ID && userVersion !== schemaVersion) {
      throw new StoreDatabaseIdentityError(
        path,
        `user_version ${userVersion} does not match schema_migrations ${schemaVersion}`,
      )
    }
    if (
      options.expectedApplicationId !== undefined
      && options.expectedApplicationId !== applicationId
    ) {
      throw new StoreDatabaseIdentityError(
        path,
        `manifest application_id ${options.expectedApplicationId} does not match database ${applicationId}`,
      )
    }
    if (
      options.expectedSchemaVersion !== undefined
      && options.expectedSchemaVersion !== schemaVersion
    ) {
      throw new StoreDatabaseIdentityError(
        path,
        `manifest schema ${options.expectedSchemaVersion} does not match database schema ${schemaVersion}`,
      )
    }
    if (options.expectedProjectId !== undefined) {
      assertExpectedProjectId(db, tables, path, options.expectedProjectId)
    }
    return { applicationId, schemaVersion }
  } finally {
    db.close()
  }
}

function assertExpectedProjectId(
  db: SqliteDatabase,
  tables: ReadonlySet<string>,
  path: string,
  expectedProjectId: string,
): void {
  for (const table of tables) {
    const quotedTable = `"${table.replaceAll('"', '""')}"`
    const columns = db.prepare(`PRAGMA table_info(${quotedTable})`).all() as Array<{ name: string }>
    if (!columns.some((column) => column.name === 'project_id')) continue
    const rows = db.prepare(
      `SELECT DISTINCT project_id FROM ${quotedTable} WHERE project_id IS NOT NULL LIMIT 2`,
    ).all() as Array<{ project_id: unknown }>
    for (const row of rows) {
      if (row.project_id !== expectedProjectId) {
        throw new StoreDatabaseIdentityError(
          path,
          `table ${table} contains project_id ${String(row.project_id)}, expected ${expectedProjectId}`,
        )
      }
    }
  }
}

function readTableNames(db: SqliteDatabase): Set<string> {
  return new Set(
    (db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as Array<{ name: string }>)
      .map((row) => row.name),
  )
}

function assertSchemaMigrationTable(db: SqliteDatabase, path: string): void {
  const columns = db.prepare('PRAGMA table_info(schema_migrations)').all() as Array<{
    name: string
    type: string
    notnull: number
    pk: number
  }>
  const expected = [
    { name: 'version', type: 'INTEGER', notnull: 0, pk: 1 },
    { name: 'applied_at', type: 'TEXT', notnull: 1, pk: 0 },
    { name: 'description', type: 'TEXT', notnull: 1, pk: 0 },
  ]
  if (
    columns.length !== expected.length
    || columns.some((column, index) => {
      const wanted = expected[index]!
      return column.name !== wanted.name
        || column.type.toUpperCase() !== wanted.type
        || column.notnull !== wanted.notnull
        || column.pk !== wanted.pk
    })
  ) {
    throw new StoreDatabaseIdentityError(path, 'schema_migrations table shape is invalid')
  }
}

function expectedTablesThrough(schemaVersion: number): string[] {
  const tables = new Set<string>()
  for (const migration of MIGRATIONS) {
    if (migration.version > schemaVersion) break
    for (const match of migration.sql.matchAll(
      /CREATE TABLE(?: IF NOT EXISTS)?\s+([A-Za-z_][A-Za-z0-9_]*)|DROP TABLE(?: IF EXISTS)?\s+([A-Za-z_][A-Za-z0-9_]*)/gi,
    )) {
      if (match[1] !== undefined) tables.add(match[1])
      else if (match[2] !== undefined) tables.delete(match[2])
    }
  }
  return [...tables]
}

function readPragmaInteger(
  db: SqliteDatabase,
  path: string,
  pragma: 'application_id' | 'user_version',
): number {
  const row = db.prepare(`PRAGMA ${pragma}`).get() as Record<string, unknown> | undefined
  const value = row?.[pragma]
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new StoreDatabaseIdentityError(path, `invalid PRAGMA ${pragma}`)
  }
  return value
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
  updateStampedVersion: boolean,
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
      for (const prerequisite of migration.prerequisites ?? []) {
        assertMigrationValidation(db, prerequisite.sql, prerequisite.expected, 'prerequisite')
      }
      db.exec(migration.sql)
      migration.backfill?.(db)
      for (const validation of migration.validations ?? []) {
        assertMigrationValidation(db, validation.sql, validation.expected, 'validation')
      }
      insertRecord.run(migration.version, now(), migration.description)
      if (updateStampedVersion) db.exec(`PRAGMA user_version = ${migration.version}`)
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

function assertMigrationValidation(
  db: SqliteDatabase,
  sql: string,
  expected: number,
  phase: 'prerequisite' | 'validation',
): void {
  const row = db.prepare(sql).get() as { violations?: number } | undefined
  const actual = Number(row?.violations ?? Number.NaN)
  if (actual !== expected) {
    throw new Error(`migration ${phase} failed: expected ${expected}, received ${actual}`)
  }
}
