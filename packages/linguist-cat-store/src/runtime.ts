/**
 * Runtime probe for node:sqlite (PB-024, plan §5.7).
 *
 * The CAT store runs on `node:sqlite` (DatabaseSync) inside the Electron
 * main process (Electron 39.5.1 = Node 22.22.x). Probed facts on this
 * machine (see DEV_BASELINE_REPORT / PB-003):
 * - DatabaseSync works: create/insert/select, VACUUM INTO.
 * - `db.backup()` does NOT exist before Node 23.4 — backup uses
 *   `VACUUM INTO '<path>'` instead (see backup.ts).
 * - bun 1.3.14 has NO node:sqlite at all (`import 'node:sqlite'` throws
 *   "No such built-in module"), so the store test suite runs under
 *   `node --test` (see package.json `test` script and src/*.nodetest.ts).
 *
 * The sqlite module is loaded lazily via createRequire so that importing
 * this package never crashes a runtime without node:sqlite — the probe
 * reports `ok: false` instead, and `loadDatabaseSync()` throws a typed
 * StoreSqliteUnavailableError only when a database is actually opened.
 */

import { createRequire } from 'node:module'
import { StoreSqliteUnavailableError } from './errors'

/** Minimal structural types for the node:sqlite surface we use. */
export interface SqliteRunResult {
  changes: number | bigint
  lastInsertRowid: number | bigint
}

export interface SqliteStatement {
  run(...params: unknown[]): SqliteRunResult
  get(...params: unknown[]): unknown
  all(...params: unknown[]): unknown[]
}

export interface SqliteDatabase {
  exec(sql: string): void
  prepare(sql: string): SqliteStatement
  close(): void
  /** Present only on Node >= 23.4; we fall back to VACUUM INTO. */
  backup?: (path: string) => unknown
}

export interface DatabaseSyncCtor {
  new (path: string, options?: { open?: boolean; readOnly?: boolean }): SqliteDatabase
}

export interface SqliteRuntimeProbe {
  /** true when node:sqlite loads and a smoke round-trip succeeds. */
  ok: boolean
  /** process.version of the current runtime. */
  nodeVersion: string
  /** true when DatabaseSync#backup exists (Node >= 23.4). */
  hasBackupApi: boolean
  /** Human-readable findings, e.g. why ok is false or which fallback is used. */
  notes: string[]
}

let cachedProbe: SqliteRuntimeProbe | undefined

/**
 * Resolution base for createRequire. Under node --test / ESM this is
 * import.meta.url; in the esbuild-bundled CJS main process (PB-030) esbuild
 * replaces import.meta with an empty object (url === undefined), so fall
 * back to __filename (dist/main.cjs itself), then to cwd. For a builtin
 * like node:sqlite the base only has to be valid, not meaningful.
 */
function createNodeRequire(): NodeRequire {
  const metaUrl = import.meta.url as string | undefined
  if (typeof metaUrl === 'string' && metaUrl.length > 0) return createRequire(metaUrl)
  if (typeof __filename === 'string' && __filename.length > 0) return createRequire(__filename)
  return createRequire(process.cwd() + '/index.js')
}

/**
 * Probe the current JS runtime for node:sqlite support. Result is cached
 * per process. Used by the store test suite and (later) by main-process
 * startup to decide whether CAT persistence can run.
 */
export function probeSqliteRuntime(): SqliteRuntimeProbe {
  if (cachedProbe) return cachedProbe
  const notes: string[] = []
  const nodeVersion = process.version
  let ctor: DatabaseSyncCtor | undefined
  try {
    const require = createNodeRequire()
    const mod = require('node:sqlite') as { DatabaseSync?: DatabaseSyncCtor }
    if (typeof mod.DatabaseSync !== 'function') {
      notes.push('node:sqlite loaded but DatabaseSync is missing')
    } else {
      ctor = mod.DatabaseSync
    }
  } catch (err) {
    notes.push(`node:sqlite import failed: ${err instanceof Error ? err.message : String(err)}`)
  }

  let hasBackupApi = false
  if (ctor) {
    try {
      const db = new ctor(':memory:')
      try {
        db.exec('CREATE TABLE probe(a TEXT)')
        db.prepare('INSERT INTO probe VALUES (?)').run('ok')
        const row = db.prepare('SELECT a FROM probe').get() as { a: string } | undefined
        if (row?.a !== 'ok') notes.push('smoke round-trip returned unexpected result')
        hasBackupApi = typeof db.backup === 'function'
        notes.push(
          hasBackupApi
            ? 'DatabaseSync#backup available (Node >= 23.4)'
            : 'DatabaseSync#backup unavailable (Node < 23.4); backups use VACUUM INTO fallback',
        )
      } finally {
        db.close()
      }
    } catch (err) {
      notes.push(`smoke round-trip failed: ${err instanceof Error ? err.message : String(err)}`)
      ctor = undefined
    }
  }

  cachedProbe = { ok: ctor !== undefined, nodeVersion, hasBackupApi, notes }
  return cachedProbe
}

/**
 * Load the DatabaseSync constructor or throw StoreSqliteUnavailableError.
 * Called only when a database is actually opened.
 */
export function loadDatabaseSync(): DatabaseSyncCtor {
  const probe = probeSqliteRuntime()
  if (!probe.ok) {
    throw new StoreSqliteUnavailableError(probe.notes.join('; ') || 'unknown reason')
  }
  const require = createNodeRequire()
  const mod = require('node:sqlite') as { DatabaseSync: DatabaseSyncCtor }
  return mod.DatabaseSync
}
