/**
 * Schema v7 migration tests (PB-096): fresh opens reach v7 with the new
 * qa_findings contract columns; a real v6 database migrates up without
 * losing finding data, and severity/issue_type/disposition backfill follows
 * the cat-core static mapping table (unknown codes -> L2/other, legacy
 * info rows -> disposition info, CRITIC_* keeps legacy tier semantics).
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { CatDatabase } from './database'
import { loadDatabaseSync } from './runtime'
import { MIGRATIONS, SCHEMA_VERSION } from './schema'
import { CatStore } from './store'
import { makeClock, makeEntropy, makeTempDir } from './testkit'

const PROJECT_ID = 'prj-aaaaaaaaaaaaaaaa'
const ASSET_ID = 'ast-aaaaaaaaaaaaaaa1'
const SEGMENT_ID = 'seg-aaaaaaaaaaaaaaa1'

interface BackfillRow {
  id: string
  code: string
  severity: string
  issueType: string
  disposition: string
}

test('schema v7 contract: fresh open reaches current schema and retains the QA columns', () => {
  const store = new CatStore({ rootDir: makeTempDir(), entropy: makeEntropy('pb-096'), now: makeClock() })
  const project = store.createProject({ name: 'P', sourceLocale: 'en', targetLocale: 'zh-CN', promaWorkspaceId: 'ws' })
  const db = store.openProject(project.id)
  try {
    assert.equal(SCHEMA_VERSION, 10)
    assert.equal(db.schemaVersion, SCHEMA_VERSION)
    assert.ok(db.catDb.appliedMigrations.some((migration) => migration.version === 7))
    assert.ok(db.catDb.appliedMigrations.some((migration) => migration.version === 8))
    const columns = (db.catDb.db.prepare('PRAGMA table_info(qa_findings)').all() as Array<{ name: string }>)
      .map((column) => column.name)
    for (const column of ['issue_type', 'disposition']) {
      assert.ok(columns.includes(column), `qa_findings missing column ${column}`)
    }
  } finally {
    db.close()
  }
})

test('schema v7 contract: a v6 database migrates through v7-v10, keeps finding data, and backfills QA', () => {
  // 手工落一个 v6 库（逐条应用 MIGRATIONS 1..6 + 一行资产/段 + 八条旧三值 finding）。
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
    if (migration.version > 6) break
    raw.exec(migration.sql)
    record.run(migration.version, '2026-01-01T00:00:00.000Z', migration.description)
  }
  raw.prepare(
    "INSERT INTO assets (id, project_id, format_id, original_filename, source_sha256, segment_count, created_at) VALUES (?, ?, 'json', 'a.json', 'sha', 1, '2026-01-01T00:00:00.000Z')",
  ).run(ASSET_ID, PROJECT_ID)
  raw.prepare(
    "INSERT INTO segments (id, asset_id, ordinal, key, source, target, source_locale, target_locale, status, locked, revision, source_hash, context_json) VALUES (?, ?, 0, NULL, 'Hello', '你好', 'en', 'zh-CN', 'translated', 0, 0, 'h', NULL)",
  ).run(SEGMENT_ID, ASSET_ID)
  const insertFinding = raw.prepare(
    'INSERT INTO qa_findings (id, segment_id, code, severity, message, status, segment_revision, waiver_reason) VALUES (?, ?, ?, ?, ?, ?, 0, ?)',
  )
  const legacy: Array<[id: string, code: string, severity: string, status: string, waiver: string | null]> = [
    ['qaf-0000000000000001', 'PLACEHOLDER_MISMATCH', 'blocking', 'open', null],
    ['qaf-0000000000000002', 'NUMBER_MISMATCH', 'blocking', 'open', null],
    ['qaf-0000000000000003', 'WHITESPACE_MISMATCH', 'warning', 'open', null],
    ['qaf-0000000000000004', 'REQUIRED_TERM', 'warning', 'open', null],
    ['qaf-0000000000000005', 'CRITIC_FIDELITY', 'warning', 'open', null],
    ['qaf-0000000000000006', 'CRITIC_VOICE', 'info', 'open', null],
    ['qaf-0000000000000007', 'UNKNOWN_CODE_X', 'warning', 'open', null],
    ['qaf-0000000000000008', 'TRAILING_SPACE', 'info', 'waived', '历史豁免原因'],
  ]
  for (const [id, code, severity, status, waiver] of legacy) {
    insertFinding.run(id, SEGMENT_ID, code, severity, `msg-${code}`, status, waiver)
  }
  raw.close()

  const catDb = CatDatabase.open(dbPath, { now: makeClock() })
  try {
    assert.equal(catDb.schemaVersion, SCHEMA_VERSION)
    assert.ok(catDb.appliedMigrations.some((migration) => migration.version === 7))
    assert.ok(catDb.appliedMigrations.some((migration) => migration.version === 8))

    const rows = catDb.db
      .prepare('SELECT id, code, severity, issue_type, disposition FROM qa_findings ORDER BY id')
      .all() as Array<{ id: string; code: string; severity: string; issue_type: string; disposition: string }>
    const backfill: BackfillRow[] = rows.map((row) => ({
      id: row.id,
      code: row.code,
      severity: row.severity,
      issueType: row.issue_type,
      disposition: row.disposition,
    }))
    assert.deepEqual(backfill, [
      // 已知码按静态表：占位符 L0 defect
      { id: 'qaf-0000000000000001', code: 'PLACEHOLDER_MISMATCH', severity: 'L0', issueType: 'placeholders_variables', disposition: 'defect' },
      // 数字 L1 defect
      { id: 'qaf-0000000000000002', code: 'NUMBER_MISMATCH', severity: 'L1', issueType: 'numbers_units_dates', disposition: 'defect' },
      // 空白 L3 defect
      { id: 'qaf-0000000000000003', code: 'WHITESPACE_MISMATCH', severity: 'L3', issueType: 'whitespace_linebreaks', disposition: 'defect' },
      // 术语 prefer 偏离 needs_review
      { id: 'qaf-0000000000000004', code: 'REQUIRED_TERM', severity: 'L2', issueType: 'terminology_soft', disposition: 'needs_review' },
      // CRITIC_* 保留旧档位语义（warning→L2），按类目映射 issueType
      { id: 'qaf-0000000000000005', code: 'CRITIC_FIDELITY', severity: 'L2', issueType: 'mistranslation', disposition: 'needs_review' },
      { id: 'qaf-0000000000000006', code: 'CRITIC_VOICE', severity: 'L4', issueType: 'character_voice', disposition: 'needs_review' },
      // 未知码 → L2 / other / defect
      { id: 'qaf-0000000000000007', code: 'UNKNOWN_CODE_X', severity: 'L2', issueType: 'other', disposition: 'defect' },
      // 未知码 + 旧 info → L2 / other / info
      { id: 'qaf-0000000000000008', code: 'TRAILING_SPACE', severity: 'L2', issueType: 'other', disposition: 'info' },
    ])

    // 数据保留：status 与 waiver_reason 原样
    const waived = catDb.db
      .prepare("SELECT status, waiver_reason FROM qa_findings WHERE id = 'qaf-0000000000000008'")
      .get() as { status: string; waiver_reason: string }
    assert.equal(waived.status, 'waived')
    assert.equal(waived.waiver_reason, '历史豁免原因')
  } finally {
    catDb.close()
  }
})
