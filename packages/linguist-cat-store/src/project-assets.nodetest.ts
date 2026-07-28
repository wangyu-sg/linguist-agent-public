/**
 * Schema v6 migration tests (PB-095): fresh opens reach v6 with the five
 * project-asset tables; a real v5 database migrates up without losing
 * term data, and the new term annotation columns read back as absent.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { CatDatabase } from './database'
import { TermEntriesRepository } from './repositories/term-entries'
import { loadDatabaseSync } from './runtime'
import { MIGRATIONS, SCHEMA_VERSION } from './schema'
import { CatStore } from './store'
import { makeClock, makeEntropy, makeTempDir } from './testkit'

const PROJECT_ID = 'prj-aaaaaaaaaaaaaaaa'
const V6_TABLES = ['style_guide_rules', 'sentence_patterns', 'context_docs', 'tech_constraints', 'voice_profiles'] as const

function tableNames(db: CatDatabase): string[] {
  const rows = db.db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
    .all() as Array<{ name: string }>
  return rows.map((row) => row.name)
}

test('schema v6: fresh open migrates to version 6 and creates the project-asset tables', () => {
  const store = new CatStore({ rootDir: makeTempDir(), entropy: makeEntropy('pb-095'), now: makeClock() })
  const project = store.createProject({ name: 'P', sourceLocale: 'en', targetLocale: 'zh-CN', promaWorkspaceId: 'ws' })
  const db = store.openProject(project.id)
  try {
    assert.equal(SCHEMA_VERSION, 10)
    assert.equal(db.schemaVersion, SCHEMA_VERSION)
    assert.ok(db.catDb.appliedMigrations.some((migration) => migration.version === 6))
    const names = tableNames(db.catDb)
    for (const table of V6_TABLES) assert.ok(names.includes(table), `missing table ${table}`)
    const termColumns = (db.catDb.db.prepare('PRAGMA table_info(term_entries)').all() as Array<{ name: string }>)
      .map((column) => column.name)
    for (const column of ['module', 'category', 'image_ref']) {
      assert.ok(termColumns.includes(column), `term_entries missing column ${column}`)
    }
  } finally {
    db.close()
  }
})

test('schema v6: a v5 database migrates up, keeps term data, and reads new annotation columns as absent', () => {
  // 手工落一个 v5 库（逐条应用 MIGRATIONS 1..5 + 一行无新列的术语）。
  const dbPath = join(makeTempDir(), 'cat.db')
  const DatabaseSync = loadDatabaseSync()
  const raw = new DatabaseSync(dbPath)
  raw.exec(
    'CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL, description TEXT NOT NULL)',
  )
  const record = raw.prepare(
    'INSERT INTO schema_migrations (version, applied_at, description) VALUES (?, ?, ?)',
  )
  for (const migration of MIGRATIONS) {
    if (migration.version > 5) break
    raw.exec(migration.sql)
    record.run(migration.version, '2026-01-01T00:00:00.000Z', migration.description)
  }
  raw.prepare(
    "INSERT INTO term_entries (id, project_id, term, translation, note, created_at) VALUES ('ter-legacy000000001', ?, 'Potion', '药水', '旧注', '2026-01-01T00:00:00.000Z')",
  ).run(PROJECT_ID)
  raw.close()

  const catDb = CatDatabase.open(dbPath, { now: makeClock() })
  try {
    assert.equal(catDb.schemaVersion, SCHEMA_VERSION)
    assert.ok(catDb.appliedMigrations.some((migration) => migration.version === 6))
    const names = tableNames(catDb)
    for (const table of V6_TABLES) assert.ok(names.includes(table), `missing table ${table}`)

    // 迁移后旧行保留；三个新标注列可空读出（字段缺省而非 null 泄漏）。
    const terms = new TermEntriesRepository(catDb, PROJECT_ID)
    const legacy = terms.get('ter-legacy000000001')
    assert.deepEqual(legacy, {
      id: 'ter-legacy000000001',
      term: 'Potion',
      translation: '药水',
      status: 'allowed',
      caseSensitive: false,
      note: '旧注',
    })

    // 新列可写可读（经 upsert 显式 id 更新路径）。
    const annotated = terms.upsert({
      id: 'ter-legacy000000001',
      term: 'Potion',
      translation: '药水',
      status: 'allowed',
      caseSensitive: false,
      note: '旧注',
      module: 'items',
      category: 'consumable',
      imageRef: 'blobs/ctx-0000000000000000.png',
    })
    assert.equal(annotated.module, 'items')
    assert.equal(terms.get('ter-legacy000000001')?.imageRef, 'blobs/ctx-0000000000000000.png')
  } finally {
    catDb.close()
  }
})
