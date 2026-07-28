import { test } from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { CatDatabase } from './database'
import { StoreNotFoundError, StoreReadOnlyError, StoreSchemaTooNewError } from './errors'
import { loadDatabaseSync } from './runtime'
import { MIGRATIONS, SCHEMA_VERSION } from './schema'
import { makeClock, makeTempDir } from './testkit'

const PLAN_TABLES = [
  'assets',
  'segments',
  'segment_revisions',
  'term_entries',
  'tm_units',
  'proposals',
  'qa_findings',
  'exports',
  'schema_migrations',
]

test('open: applies migrations transactionally, all plan §5.4 tables exist', () => {
  const path = join(makeTempDir(), 'cat.db')
  const catDb = CatDatabase.open(path, { now: makeClock() })
  try {
    assert.equal(catDb.schemaVersion, SCHEMA_VERSION)
    assert.deepEqual(
      catDb.appliedMigrations.map((m) => m.version),
      MIGRATIONS.map((m) => m.version),
    )
    const tables = (
      catDb.db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as { name: string }[]
    ).map((r) => r.name)
    for (const table of PLAN_TABLES) {
      assert.ok(tables.includes(table), `missing table ${table}`)
    }
    const records = catDb.db
      .prepare('SELECT version, applied_at, description FROM schema_migrations ORDER BY version')
      .all() as { version: number; applied_at: string; description: string }[]
    assert.equal(records.length, MIGRATIONS.length)
    assert.equal(records[0]?.applied_at, '2026-01-01T00:00:00.000Z') // injected clock
    assert.equal(records[0]?.description, MIGRATIONS[0]?.description)
  } finally {
    catDb.close()
  }
})

test('open: reopening an up-to-date db applies nothing', () => {
  const path = join(makeTempDir(), 'cat.db')
  CatDatabase.open(path).close()
  const catDb = CatDatabase.open(path)
  try {
    assert.equal(catDb.appliedMigrations.length, 0)
    assert.equal(catDb.schemaVersion, SCHEMA_VERSION)
  } finally {
    catDb.close()
  }
})

test('migration 4: existing term rows receive safe defaults', () => {
  const path = join(makeTempDir(), 'cat.db')
  const LegacyDatabase = loadDatabaseSync()
  const legacy = new LegacyDatabase(path)
  legacy.exec(`
    CREATE TABLE schema_migrations (
      version INTEGER PRIMARY KEY,
      applied_at TEXT NOT NULL,
      description TEXT NOT NULL
    )
  `)
  for (const migration of MIGRATIONS.filter((item) => item.version <= 3)) {
    legacy.exec(migration.sql)
    legacy
      .prepare('INSERT INTO schema_migrations (version, applied_at, description) VALUES (?, ?, ?)')
      .run(migration.version, 'now', migration.description)
  }
  legacy
    .prepare(
      "INSERT INTO term_entries (id, project_id, term, translation, note, created_at) VALUES ('ter-old', 'p1', 'API', '接口', NULL, 'now')",
    )
    .run()
  legacy.close()

  const migrated = CatDatabase.open(path)
  try {
    const row = migrated.db
      .prepare("SELECT status, case_sensitive FROM term_entries WHERE id = 'ter-old'")
      .get() as { status: string; case_sensitive: number }
    assert.equal(row.status, 'allowed')
    assert.equal(row.case_sensitive, 0)
  } finally {
    migrated.close()
  }
})

test('open: refuses a db with a NEWER schema (fail closed), writable and read-only', () => {
  const path = join(makeTempDir(), 'cat.db')
  const catDb = CatDatabase.open(path)
  catDb.db.prepare('INSERT INTO schema_migrations (version, applied_at, description) VALUES (?, ?, ?)').run(
    SCHEMA_VERSION + 1,
    '2026-01-01T00:00:00.000Z',
    'future schema',
  )
  catDb.close()

  assert.throws(() => CatDatabase.open(path), (err: unknown) => {
    assert.ok(err instanceof StoreSchemaTooNewError)
    assert.equal(err.code, 'STORE_SCHEMA_TOO_NEW')
    assert.equal(err.diskVersion, SCHEMA_VERSION + 1)
    return true
  })
  assert.throws(() => CatDatabase.open(path, { readOnly: true }), (err: unknown) => {
    assert.ok(err instanceof StoreSchemaTooNewError)
    assert.equal(err.code, 'STORE_SCHEMA_TOO_NEW')
    return true
  })
})

test('pragmas: journal_mode=WAL, synchronous=FULL, foreign_keys=ON', () => {
  const path = join(makeTempDir(), 'cat.db')
  const catDb = CatDatabase.open(path)
  try {
    const journal = catDb.db.prepare('PRAGMA journal_mode').get() as { journal_mode: string }
    assert.equal(journal.journal_mode, 'wal')
    const sync = catDb.db.prepare('PRAGMA synchronous').get() as { synchronous: number }
    assert.equal(sync.synchronous, 2) // FULL
    const fk = catDb.db.prepare('PRAGMA foreign_keys').get() as { foreign_keys: number }
    assert.equal(fk.foreign_keys, 1)
    const busy = catDb.db.prepare('PRAGMA busy_timeout').get() as { timeout: number }
    assert.equal(busy.timeout, 5000)
  } finally {
    catDb.close()
  }
})

test('read-only open: missing file -> STORE_NOT_FOUND', () => {
  const path = join(makeTempDir(), 'nope.db')
  assert.throws(() => CatDatabase.open(path, { readOnly: true }), (err: unknown) => {
    assert.ok(err instanceof StoreNotFoundError)
    assert.equal(err.code, 'STORE_NOT_FOUND')
    return true
  })
})

test('read-only open: writes are rejected with a typed error at every layer', () => {
  const path = join(makeTempDir(), 'cat.db')
  const writable = CatDatabase.open(path)
  writable.db.prepare("INSERT INTO term_entries (id, project_id, term, translation, note, created_at) VALUES ('t1', 'p1', 'a', 'b', NULL, 'now')").run()
  writable.close()

  const catDb = CatDatabase.open(path, { readOnly: true })
  try {
    // reads work
    const row = catDb.db.prepare('SELECT term FROM term_entries').get() as { term: string }
    assert.equal(row.term, 'a')
    // store-level guard
    assert.throws(() => catDb.transaction('write attempt', () => {}), (err: unknown) => {
      assert.ok(err instanceof StoreReadOnlyError)
      assert.equal(err.code, 'STORE_READ_ONLY')
      return true
    })
    assert.throws(() => catDb.execWrite('raw write', "INSERT INTO term_entries (id, project_id, term, translation, note, created_at) VALUES ('t2', 'p1', 'a', 'b', NULL, 'now')"), (err: unknown) => {
      assert.ok(err instanceof StoreReadOnlyError)
      return true
    })
    // sqlite itself is read-only too (defense in depth)
    assert.throws(() =>
      catDb.db.prepare("INSERT INTO term_entries (id, project_id, term, translation, note, created_at) VALUES ('t3', 'p1', 'a', 'b', NULL, 'now')").run(),
    )
  } finally {
    catDb.close()
  }
})

test('transaction: multi-statement failure rolls everything back', () => {
  const path = join(makeTempDir(), 'cat.db')
  const catDb = CatDatabase.open(path)
  try {
    assert.throws(() =>
      catDb.transaction('induced failure', () => {
        catDb.db.prepare("INSERT INTO term_entries (id, project_id, term, translation, note, created_at) VALUES ('t1', 'p1', 'a', 'b', NULL, 'now')").run()
        throw new Error('induced mid-transaction failure')
      }),
    )
    const rows = catDb.db.prepare('SELECT id FROM term_entries').all()
    assert.equal(rows.length, 0, 'insert must be rolled back')
  } finally {
    catDb.close()
  }
})
