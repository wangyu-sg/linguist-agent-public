import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { CatDatabase, LINGUIST_APPLICATION_ID } from './database'
import {
  StoreDatabaseIdentityError,
  StoreNotFoundError,
  StoreReadOnlyError,
  StoreSchemaTooNewError,
} from './errors'
import { loadDatabaseSync } from './runtime'
import { ProposalsRepository } from './repositories/proposals'
import { MIGRATIONS, SCHEMA_VERSION } from './schema'
import { makeClock, makeTempDir } from './testkit'

const PLAN_TABLES = [
  'assets',
  'segments',
  'segment_revisions',
  'term_entries',
  'tm_units',
  'proposals',
  'proposal_issuances',
  'qa_findings',
  'exports',
  'translation_jobs',
  'project_events',
  'project_event_acks',
  'run_changes',
  'stage_evidence_states',
  'evidence_gaps',
  'stage_evidence_receipts',
  'schema_migrations',
]

test('open: unknown SQLite is rejected before any byte or mtime changes', () => {
  const path = join(makeTempDir(), 'unknown.db')
  const DatabaseSync = loadDatabaseSync()
  const unknown = new DatabaseSync(path)
  unknown.exec('CREATE TABLE unrelated_data (value TEXT)')
  unknown.close()
  const beforeBytes = readFileSync(path)
  const beforeMtimeNs = statSync(path, { bigint: true }).mtimeNs

  assert.throws(() => CatDatabase.open(path), StoreDatabaseIdentityError)

  assert.deepEqual(readFileSync(path), beforeBytes)
  assert.equal(statSync(path, { bigint: true }).mtimeNs, beforeMtimeNs)
})

test('open: an existing empty file is not treated as a new or legacy database', () => {
  const path = join(makeTempDir(), 'empty.db')
  writeFileSync(path, '')
  const beforeBytes = readFileSync(path)
  const beforeMtimeNs = statSync(path, { bigint: true }).mtimeNs

  assert.throws(() => CatDatabase.open(path), StoreDatabaseIdentityError)

  assert.deepEqual(readFileSync(path), beforeBytes)
  assert.equal(statSync(path, { bigint: true }).mtimeNs, beforeMtimeNs)
})

test('open: a new database stamps one consistent Linguist identity', () => {
  const path = join(makeTempDir(), 'cat.db')
  const catDb = CatDatabase.open(path)
  try {
    const applicationId = catDb.db.prepare('PRAGMA application_id').get() as { application_id: number }
    const userVersion = catDb.db.prepare('PRAGMA user_version').get() as { user_version: number }
    const migrationVersion = catDb.db
      .prepare('SELECT MAX(version) AS version FROM schema_migrations')
      .get() as { version: number }
    assert.equal(applicationId.application_id, LINGUIST_APPLICATION_ID)
    assert.equal(userVersion.user_version, SCHEMA_VERSION)
    assert.equal(migrationVersion.version, SCHEMA_VERSION)
  } finally {
    catDb.close()
  }
})

test('open: another application_id is rejected instead of being restamped', () => {
  const path = join(makeTempDir(), 'other-app.db')
  const catDb = CatDatabase.open(path)
  catDb.db.exec('PRAGMA application_id = 123456')
  catDb.close()
  const beforeBytes = readFileSync(path)
  const beforeMtimeNs = statSync(path, { bigint: true }).mtimeNs

  assert.throws(() => CatDatabase.open(path), StoreDatabaseIdentityError)

  assert.deepEqual(readFileSync(path), beforeBytes)
  assert.equal(statSync(path, { bigint: true }).mtimeNs, beforeMtimeNs)
})

test('open: an incomplete schema_migrations disguise is rejected read-only', () => {
  const path = join(makeTempDir(), 'disguised.db')
  const DatabaseSync = loadDatabaseSync()
  const disguised = new DatabaseSync(path)
  disguised.exec(`
    CREATE TABLE schema_migrations (
      version INTEGER PRIMARY KEY,
      applied_at TEXT NOT NULL,
      description TEXT NOT NULL
    );
    INSERT INTO schema_migrations VALUES (1, 'now', '${MIGRATIONS[0]!.description}');
    CREATE TABLE assets (id TEXT);
    CREATE TABLE segments (id TEXT);
  `)
  disguised.close()
  const beforeBytes = readFileSync(path)
  const beforeMtimeNs = statSync(path, { bigint: true }).mtimeNs

  assert.throws(() => CatDatabase.open(path), StoreDatabaseIdentityError)

  assert.deepEqual(readFileSync(path), beforeBytes)
  assert.equal(statSync(path, { bigint: true }).mtimeNs, beforeMtimeNs)
})

test('open: a verified legacy LA database is stamped once after successful compatibility open', () => {
  const path = join(makeTempDir(), 'legacy.db')
  const DatabaseSync = loadDatabaseSync()
  const legacy = new DatabaseSync(path)
  legacy.exec(`
    CREATE TABLE schema_migrations (
      version INTEGER PRIMARY KEY,
      applied_at TEXT NOT NULL,
      description TEXT NOT NULL
    )
  `)
  const record = legacy.prepare(
    'INSERT INTO schema_migrations (version, applied_at, description) VALUES (?, ?, ?)',
  )
  for (const migration of MIGRATIONS) {
    legacy.exec(migration.sql)
    record.run(migration.version, 'legacy', migration.description)
  }
  legacy.close()

  const upgraded = CatDatabase.open(path)
  try {
    assert.equal(
      (upgraded.db.prepare('PRAGMA application_id').get() as { application_id: number }).application_id,
      LINGUIST_APPLICATION_ID,
    )
    assert.equal(
      (upgraded.db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version,
      SCHEMA_VERSION,
    )
  } finally {
    upgraded.close()
  }
})

test('open: read-only validates a legacy database without stamping it', () => {
  const path = join(makeTempDir(), 'legacy-readonly.db')
  const DatabaseSync = loadDatabaseSync()
  const legacy = new DatabaseSync(path)
  legacy.exec(`
    CREATE TABLE schema_migrations (
      version INTEGER PRIMARY KEY,
      applied_at TEXT NOT NULL,
      description TEXT NOT NULL
    )
  `)
  const record = legacy.prepare(
    'INSERT INTO schema_migrations (version, applied_at, description) VALUES (?, ?, ?)',
  )
  for (const migration of MIGRATIONS) {
    legacy.exec(migration.sql)
    record.run(migration.version, 'legacy', migration.description)
  }
  legacy.close()
  const beforeBytes = readFileSync(path)
  const beforeMtimeNs = statSync(path, { bigint: true }).mtimeNs

  CatDatabase.open(path, { readOnly: true }).close()

  assert.deepEqual(readFileSync(path), beforeBytes)
  assert.equal(statSync(path, { bigint: true }).mtimeNs, beforeMtimeNs)
  const inspected = new DatabaseSync(path, { readOnly: true })
  try {
    assert.equal(
      (inspected.prepare('PRAGMA application_id').get() as { application_id: number }).application_id,
      0,
    )
    assert.equal(
      (inspected.prepare('PRAGMA user_version').get() as { user_version: number }).user_version,
      0,
    )
  } finally {
    inspected.close()
  }
})

test('open: application_id, user_version, and schema_migrations must agree', () => {
  const path = join(makeTempDir(), 'inconsistent.db')
  const catDb = CatDatabase.open(path)
  catDb.db.exec(`PRAGMA user_version = ${SCHEMA_VERSION - 1}`)
  catDb.close()
  const beforeBytes = readFileSync(path)
  const beforeMtimeNs = statSync(path, { bigint: true }).mtimeNs

  assert.throws(() => CatDatabase.open(path), StoreDatabaseIdentityError)
  assert.throws(() => CatDatabase.open(path, { readOnly: true }), StoreDatabaseIdentityError)

  assert.deepEqual(readFileSync(path), beforeBytes)
  assert.equal(statSync(path, { bigint: true }).mtimeNs, beforeMtimeNs)
})

test('migration failure rolls back its schema and leaves the previous stamp consistent', () => {
  const path = join(makeTempDir(), 'migration-failure.db')
  const DatabaseSync = loadDatabaseSync()
  const v11 = new DatabaseSync(path)
  v11.exec(`
    CREATE TABLE schema_migrations (
      version INTEGER PRIMARY KEY,
      applied_at TEXT NOT NULL,
      description TEXT NOT NULL
    )
  `)
  const record = v11.prepare(
    'INSERT INTO schema_migrations (version, applied_at, description) VALUES (?, ?, ?)',
  )
  for (const migration of MIGRATIONS.filter((item) => item.version <= 11)) {
    v11.exec(migration.sql)
    record.run(migration.version, 'old', migration.description)
  }
  v11.exec(`
    PRAGMA application_id = ${LINGUIST_APPLICATION_ID};
    PRAGMA user_version = 11;
    CREATE TABLE translation_jobs (sentinel TEXT);
  `)
  v11.close()

  assert.throws(() => CatDatabase.open(path))

  const inspected = new DatabaseSync(path, { readOnly: true })
  try {
    const proposalColumns = inspected.prepare('PRAGMA table_info(proposal_mutations)').all() as Array<{ name: string }>
    assert.equal(proposalColumns.some((column) => column.name === 'run_id'), false)
    assert.equal(
      (inspected.prepare('SELECT MAX(version) AS version FROM schema_migrations').get() as { version: number }).version,
      11,
    )
    assert.equal(
      (inspected.prepare('PRAGMA application_id').get() as { application_id: number }).application_id,
      LINGUIST_APPLICATION_ID,
    )
    assert.equal(
      (inspected.prepare('PRAGMA user_version').get() as { user_version: number }).user_version,
      11,
    )
  } finally {
    inspected.close()
  }
})

test('open: :memory: remains a supported new Linguist database', () => {
  const catDb = CatDatabase.open(':memory:')
  try {
    assert.equal(catDb.schemaVersion, SCHEMA_VERSION)
    assert.equal(
      (catDb.db.prepare('PRAGMA application_id').get() as { application_id: number }).application_id,
      LINGUIST_APPLICATION_ID,
    )
  } finally {
    catDb.close()
  }
})

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

test('migration 11: v10 QA rows are backfilled and event/link tables are created', () => {
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
  const record = legacy.prepare(
    'INSERT INTO schema_migrations (version, applied_at, description) VALUES (?, ?, ?)',
  )
  for (const migration of MIGRATIONS.filter((item) => item.version <= 10)) {
    legacy.exec(migration.sql)
    record.run(migration.version, '2026-01-01T00:00:00.000Z', migration.description)
  }
  legacy.prepare(`
    INSERT INTO assets
      (id, project_id, format_id, original_filename, source_sha256, segment_count, created_at)
    VALUES ('ast-old', 'prj-old', 'tsv', 'old.tsv', ?, 1, 'now')
  `).run('a'.repeat(64))
  legacy.prepare(`
    INSERT INTO segments
      (id, asset_id, ordinal, source, target, source_locale, target_locale, status, locked, revision, source_hash)
    VALUES ('seg-old', 'ast-old', 0, 'S', '', 'en', 'zh-CN', 'untranslated', 0, 0, 'h')
  `).run()
  legacy.prepare(`
    INSERT INTO qa_findings
      (id, segment_id, code, severity, issue_type, disposition, message, status,
       segment_revision, waiver_reason, waived_by, waived_at)
    VALUES
      ('qaf-0000000000000001', 'seg-old', 'EMPTY_TARGET', 'L1', 'omission',
       'defect', 'empty', 'waived', 0, 'legacy reason', 'legacy reviewer', 'legacy time')
  `).run()
  legacy.close()

  const migrated = CatDatabase.open(path, { now: () => '2026-07-29T02:00:00.000Z' })
  try {
    const row = migrated.db.prepare(`
      SELECT rule_version, evidence_hash, first_seen_run_id, created_at,
             status, waiver_reason, waived_by, waived_at
      FROM qa_findings WHERE id = 'qaf-0000000000000001'
    `).get() as Record<string, string>
    assert.deepEqual({ ...row }, {
      rule_version: 'legacy',
      evidence_hash: 'qaf-0000000000000001',
      first_seen_run_id: 'legacy',
      created_at: '1970-01-01T00:00:00.000Z',
      status: 'waived',
      waiver_reason: 'legacy reason',
      waived_by: 'legacy reviewer',
      waived_at: 'legacy time',
    })
    const tables = (migrated.db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
      .all() as Array<{ name: string }>).map((entry) => entry.name)
    for (const name of [
      'qa_finding_occurrences',
      'qa_finding_status_events',
      'critic_finding_qa_links',
    ]) {
      assert.ok(tables.includes(name), `missing ${name}`)
    }
    assert.equal(
      (migrated.db.prepare('SELECT COUNT(*) AS n FROM qa_finding_occurrences').get() as { n: number }).n,
      1,
    )
    const baseline = migrated.db.prepare(`
      SELECT to_status, actor_type, actor_id, reason
      FROM qa_finding_status_events
      WHERE finding_id = 'qaf-0000000000000001'
    `).get() as Record<string, string>
    assert.deepEqual({ ...baseline }, {
      to_status: 'waived',
      actor_type: 'human',
      actor_id: 'legacy reviewer',
      reason: 'legacy reason',
    })
  } finally {
    migrated.close()
  }
})

test('migration 12: v11 mutation rows keep unknown run provenance and recovery tables are added', () => {
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
  const record = legacy.prepare(
    'INSERT INTO schema_migrations (version, applied_at, description) VALUES (?, ?, ?)',
  )
  for (const migration of MIGRATIONS.filter((item) => item.version <= 11)) {
    legacy.exec(migration.sql)
    record.run(migration.version, '2026-01-01T00:00:00.000Z', migration.description)
  }
  legacy.prepare(`
    INSERT INTO proposal_mutations
      (idempotency_key, operation, request_fingerprint, result_json, created_at)
    VALUES ('legacy-key', 'accept', 'legacy-payload', '{"ok":true}', 'legacy-time')
  `).run()
  legacy.close()

  const migrated = CatDatabase.open(path)
  try {
    const provenance = migrated.db.prepare(`
      SELECT run_id, tool_call_id, event_sequence
      FROM proposal_mutations WHERE idempotency_key = 'legacy-key'
    `).get() as {
      run_id: string | null
      tool_call_id: string | null
      event_sequence: number | null
    }
    assert.deepEqual({ ...provenance }, {
      run_id: null,
      tool_call_id: null,
      event_sequence: null,
    })
    const tables = new Set((migrated.db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
      .all() as Array<{ name: string }>).map((entry) => entry.name))
    for (const name of ['translation_jobs', 'project_events', 'project_event_acks', 'run_changes']) {
      assert.ok(tables.has(name), `missing ${name}`)
    }
  } finally {
    migrated.close()
  }
})

test('migration 13: v12 proposal content is backfilled once and Harness tables stay intact', () => {
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
  const record = legacy.prepare(
    'INSERT INTO schema_migrations (version, applied_at, description) VALUES (?, ?, ?)',
  )
  for (const migration of MIGRATIONS.filter((item) => item.version <= 12)) {
    legacy.exec(migration.sql)
    record.run(migration.version, '2026-01-01T00:00:00.000Z', migration.description)
  }
  legacy.prepare(`
    INSERT INTO assets
      (id, project_id, format_id, original_filename, source_sha256, segment_count, created_at)
    VALUES ('ast-old', 'prj-old', 'tsv', 'old.tsv', ?, 1, 'old-time')
  `).run('a'.repeat(64))
  legacy.prepare(`
    INSERT INTO segments
      (id, asset_id, ordinal, source, target, source_locale, target_locale, status,
       locked, revision, source_hash)
    VALUES ('seg-old', 'ast-old', 0, 'Alpha', '', 'en', 'zh-CN', 'untranslated',
            0, 0, 'source-hash')
  `).run()
  legacy.prepare(`
    INSERT INTO proposals
      (id, segment_id, base_revision, proposed_target, evidence_refs_json,
       term_refs_json, warnings_json, model_id, session_id, run_id, created_at, status)
    VALUES ('prp-old', 'seg-old', 0, '阿尔法', '["tm:old"]', '["term:old"]',
            '[]', 'model-old', 'session-old', 'run-old', 'proposal-time', 'pending')
  `).run()
  legacy.prepare(`
    INSERT INTO proposal_mutations
      (idempotency_key, operation, request_fingerprint, result_json, created_at, run_id)
    VALUES ('mutation-old', 'propose', '{}', '{}', 'old-time', 'run-old')
  `).run()
  legacy.prepare(`
    INSERT INTO run_changes
      (run_id, mutation_key, entity_type, entity_id, change_kind, created_at)
    VALUES ('run-old', 'mutation-old', 'proposal', 'prp-old', 'created', 'old-time')
  `).run()
  legacy.prepare(`
    INSERT INTO project_events
      (project_id, event_key, run_id, kind, payload_json, created_at)
    VALUES ('prj-old', 'event-old', 'run-old', 'proposal.created', '{}', 'old-time')
  `).run()
  legacy.exec(`
    PRAGMA application_id = ${LINGUIST_APPLICATION_ID};
    PRAGMA user_version = 12;
  `)
  legacy.close()

  const compatible = CatDatabase.open(path, { readOnly: true })
  try {
    const proposals = new ProposalsRepository(compatible)
    const diff = proposals.listWithDiffs()[0]
    assert.equal(diff?.issuanceCount, 1)
    assert.equal(diff?.latestIssuance.id, proposals.listIssuances('prp-old')[0]?.id)
    assert.equal(diff?.latestIssuance.runId, 'run-old')
  } finally {
    compatible.close()
  }

  const migrated = CatDatabase.open(path)
  try {
    const issuance = migrated.db.prepare(`
      SELECT issuance_id, proposal_id, idempotency_key, session_id, run_id, model_id,
             evidence_refs_json, term_refs_json, created_at
      FROM proposal_issuances
    `).get() as Record<string, string>
    assert.match(issuance.issuance_id!, /^pis_v2_[0-9a-f]{64}$/)
    assert.deepEqual({ ...issuance, issuance_id: undefined }, {
      issuance_id: undefined,
      proposal_id: 'prp-old',
      idempotency_key: 'legacy:prp-old',
      session_id: 'session-old',
      run_id: 'run-old',
      model_id: 'model-old',
      evidence_refs_json: '["tm:old"]',
      term_refs_json: '["term:old"]',
      created_at: 'proposal-time',
    })
    assert.equal(
      (migrated.db.prepare('SELECT COUNT(*) AS n FROM run_changes').get() as { n: number }).n,
      1,
    )
    assert.equal(
      (migrated.db.prepare('SELECT COUNT(*) AS n FROM project_events').get() as { n: number }).n,
      1,
    )
    assert.equal(
      (migrated.db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version,
      SCHEMA_VERSION,
    )
  } finally {
    migrated.close()
  }
})

test('migration 13: invalid legacy proposal rolls back forward schema and backfill atomically', () => {
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
  const record = legacy.prepare(
    'INSERT INTO schema_migrations (version, applied_at, description) VALUES (?, ?, ?)',
  )
  for (const migration of MIGRATIONS.filter((item) => item.version <= 12)) {
    legacy.exec(migration.sql)
    record.run(migration.version, 'old-time', migration.description)
  }
  legacy.prepare(`
    INSERT INTO assets
      (id, project_id, format_id, original_filename, source_sha256, segment_count, created_at)
    VALUES ('ast-old', 'prj-old', 'tsv', 'old.tsv', ?, 1, 'old-time')
  `).run('a'.repeat(64))
  legacy.prepare(`
    INSERT INTO segments
      (id, asset_id, ordinal, source, target, source_locale, target_locale, status,
       locked, revision, source_hash)
    VALUES ('seg-old', 'ast-old', 0, 'Alpha', '', 'en', 'zh-CN', 'untranslated',
            0, 0, 'source-hash')
  `).run()
  legacy.prepare(`
    INSERT INTO proposals
      (id, segment_id, base_revision, proposed_target, evidence_refs_json,
       term_refs_json, warnings_json, created_at, status)
    VALUES ('prp-bad', 'seg-old', 0, '阿尔法', '{', '[]', '[]', 'proposal-time', 'pending')
  `).run()
  legacy.exec(`
    PRAGMA application_id = ${LINGUIST_APPLICATION_ID};
    PRAGMA user_version = 12;
  `)
  legacy.close()

  assert.throws(() => CatDatabase.open(path))
  const inspected = new LegacyDatabase(path)
  try {
    assert.equal(
      (inspected.prepare('SELECT MAX(version) AS v FROM schema_migrations').get() as { v: number }).v,
      12,
    )
    assert.equal(
      (inspected.prepare('PRAGMA application_id').get() as { application_id: number }).application_id,
      LINGUIST_APPLICATION_ID,
    )
    assert.equal(
      (inspected.prepare('PRAGMA user_version').get() as { user_version: number }).user_version,
      12,
    )
    assert.equal(
      inspected.prepare(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'proposal_issuances'",
      ).get(),
      undefined,
    )
    assert.ok(
      inspected.prepare(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'term_entries'",
      ).get(),
    )
  } finally {
    inspected.close()
  }
})

test('migration 17: existing v16 projects gain Stage Evidence state without rewriting CAT content', () => {
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
  const record = legacy.prepare(
    'INSERT INTO schema_migrations (version, applied_at, description) VALUES (?, ?, ?)',
  )
  for (const migration of MIGRATIONS.filter((item) => item.version <= 16)) {
    legacy.exec(migration.sql)
    migration.backfill?.(legacy)
    record.run(migration.version, '2026-01-01T00:00:00.000Z', migration.description)
  }
  legacy.exec(`
    PRAGMA application_id = ${LINGUIST_APPLICATION_ID};
    PRAGMA user_version = 16;
  `)
  legacy.close()

  const migrated = CatDatabase.open(path)
  try {
    assert.equal(migrated.schemaVersion, 17)
    const tables = new Set((migrated.db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
      .all() as Array<{ name: string }>).map((row) => row.name))
    assert.equal(tables.has('stage_evidence_states'), true)
    assert.equal(tables.has('evidence_gaps'), true)
    assert.equal(tables.has('stage_evidence_receipts'), true)
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

test('transaction: nested repository work joins the outer rollback boundary', () => {
  const path = join(makeTempDir(), 'cat.db')
  const catDb = CatDatabase.open(path)
  try {
    assert.throws(() =>
      catDb.transaction('outer failure', () => {
        catDb.transaction('nested write', () => {
          catDb.db.prepare(`
            INSERT INTO term_entries
              (id, project_id, term, translation, note, created_at)
            VALUES ('nested', 'p1', 'a', 'b', NULL, 'now')
          `).run()
        })
        throw new Error('rollback outer transaction')
      }),
    )
    assert.equal(
      (catDb.db.prepare('SELECT COUNT(*) AS n FROM term_entries').get() as { n: number }).n,
      0,
    )
  } finally {
    catDb.close()
  }
})
