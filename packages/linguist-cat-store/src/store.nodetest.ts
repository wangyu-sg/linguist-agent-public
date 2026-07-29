import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import {
  copyFileSync,
  existsSync,
  readFileSync,
  readdirSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import {
  StoreDatabaseIdentityError,
  StoreNotFoundError,
  StoreReadOnlyError,
} from './errors'
import { LINGUIST_APPLICATION_ID } from './database'
import { loadDatabaseSync } from './runtime'
import { CatStore } from './store'
import { MIGRATIONS, SCHEMA_VERSION } from './schema'
import { makeClock, makeEntropy, makeImportedAsset, makeTempDir } from './testkit'

const INPUT = { name: 'P', sourceLocale: 'en', targetLocale: 'zh-CN', promaWorkspaceId: 'ws' }

interface StoredDatabaseIdentity {
  version: number
  projectId: string
  applicationId: number
  schemaVersion: number
  createdByVersion: string
  lastMigratedByVersion: string
  mainFileSnapshot: {
    state: string
    sizeBytes: number
    sha256: string
    measuredAt: string
  }
}

function prepareV12Project(
  store: CatStore,
  projectId: string,
  options: { invalidProposal?: boolean } = {},
): { dbPath: string; manifestPath: string } {
  const dbPath = store.index.projectDbPath(projectId)
  const manifestPath = store.index.projectMetaPath(projectId)
  const DatabaseSync = loadDatabaseSync()
  const db = new DatabaseSync(dbPath)
  db.exec(`
    CREATE TABLE schema_migrations (
      version INTEGER PRIMARY KEY,
      applied_at TEXT NOT NULL,
      description TEXT NOT NULL
    )
  `)
  const record = db.prepare(
    'INSERT INTO schema_migrations (version, applied_at, description) VALUES (?, ?, ?)',
  )
  for (const migration of MIGRATIONS.filter((item) => item.version <= 12)) {
    db.exec(migration.sql)
    record.run(migration.version, 'v12-time', migration.description)
  }
  db.prepare(`
    INSERT INTO assets
      (id, project_id, format_id, original_filename, source_sha256, segment_count, created_at)
    VALUES ('ast-v12', ?, 'tsv', 'v12.tsv', ?, 1, 'v12-time')
  `).run(projectId, 'a'.repeat(64))
  db.exec(`
    INSERT INTO segments
      (id, asset_id, ordinal, source, target, source_locale, target_locale, status,
       locked, revision, source_hash)
    VALUES ('seg-v12', 'ast-v12', 0, 'Alpha', '', 'en', 'zh-CN', 'untranslated',
            0, 0, 'source-hash');
  `)
  db.prepare(`
    INSERT INTO proposals
      (id, segment_id, base_revision, proposed_target, evidence_refs_json,
       term_refs_json, warnings_json, created_at, status)
    VALUES ('prp-v12', 'seg-v12', 0, '阿尔法', ?, '[]', '[]', 'proposal-time', 'pending')
  `).run(options.invalidProposal ? '{' : '[]')
  db.exec(`
    PRAGMA application_id = ${LINGUIST_APPLICATION_ID};
    PRAGMA user_version = 12;
  `)
  db.close()

  const bytes = readFileSync(dbPath)
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as {
    databaseIdentity: Partial<StoredDatabaseIdentity>
  }
  manifest.databaseIdentity = {
    ...manifest.databaseIdentity,
    applicationId: LINGUIST_APPLICATION_ID,
    schemaVersion: 12,
    lastMigratedByVersion: 'v12-test',
    mainFileSnapshot: {
      state: 'post-migration-checkpoint',
      sizeBytes: bytes.byteLength,
      sha256: createHash('sha256').update(bytes).digest('hex'),
      measuredAt: 'v12-time',
    },
  }
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)
  return { dbPath, manifestPath }
}

test('facade: first writable open records an honest database snapshot in project.json', () => {
  const rootDir = makeTempDir()
  const store = new CatStore({
    rootDir,
    entropy: makeEntropy(),
    now: makeClock(),
    applicationVersion: '1.2.3-test',
  })
  const project = store.createProject(INPUT)

  store.openProject(project.id).close()

  const manifest = JSON.parse(
    readFileSync(store.index.projectMetaPath(project.id), 'utf8'),
  ) as { databaseIdentity: StoredDatabaseIdentity }
  assert.deepEqual(
    {
      version: manifest.databaseIdentity.version,
      projectId: manifest.databaseIdentity.projectId,
      applicationId: manifest.databaseIdentity.applicationId,
      schemaVersion: manifest.databaseIdentity.schemaVersion,
      createdByVersion: manifest.databaseIdentity.createdByVersion,
      lastMigratedByVersion: manifest.databaseIdentity.lastMigratedByVersion,
      snapshotState: manifest.databaseIdentity.mainFileSnapshot.state,
    },
    {
      version: 1,
      projectId: project.id,
      applicationId: LINGUIST_APPLICATION_ID,
      schemaVersion: SCHEMA_VERSION,
      createdByVersion: '1.2.3-test',
      lastMigratedByVersion: '1.2.3-test',
      snapshotState: 'post-migration-checkpoint',
    },
  )
  assert.ok(manifest.databaseIdentity.mainFileSnapshot.sizeBytes > 0)
  assert.match(manifest.databaseIdentity.mainFileSnapshot.sha256, /^[0-9a-f]{64}$/)
  assert.equal(typeof manifest.databaseIdentity.mainFileSnapshot.measuredAt, 'string')
})

test('facade: v12 → v13 migration advances all identity checkpoints after one successful open', () => {
  const store = new CatStore({
    rootDir: makeTempDir(),
    entropy: makeEntropy(),
    now: makeClock(),
    applicationVersion: 'v13-test',
  })
  const project = store.createProject(INPUT)
  const { dbPath, manifestPath } = prepareV12Project(store, project.id)

  store.openProject(project.id).close()

  const DatabaseSync = loadDatabaseSync()
  const db = new DatabaseSync(dbPath, { readOnly: true })
  try {
    assert.equal(
      (db.prepare('PRAGMA application_id').get() as { application_id: number }).application_id,
      LINGUIST_APPLICATION_ID,
    )
    assert.equal(
      (db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version,
      13,
    )
    assert.equal(
      (db.prepare('SELECT MAX(version) AS version FROM schema_migrations').get() as { version: number }).version,
      13,
    )
  } finally {
    db.close()
  }
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as {
    databaseIdentity: StoredDatabaseIdentity
  }
  const bytes = readFileSync(dbPath)
  assert.equal(manifest.databaseIdentity.schemaVersion, 13)
  assert.equal(manifest.databaseIdentity.lastMigratedByVersion, 'v13-test')
  assert.equal(manifest.databaseIdentity.mainFileSnapshot.sizeBytes, bytes.byteLength)
  assert.equal(
    manifest.databaseIdentity.mainFileSnapshot.sha256,
    createHash('sha256').update(bytes).digest('hex'),
  )
})

test('facade: failed v13 backfill preserves v12 database and manifest identity together', () => {
  const store = new CatStore({
    rootDir: makeTempDir(),
    entropy: makeEntropy(),
    now: makeClock(),
    applicationVersion: 'v13-test',
  })
  const project = store.createProject(INPUT)
  const { dbPath, manifestPath } = prepareV12Project(store, project.id, { invalidProposal: true })
  const beforeManifest = readFileSync(manifestPath)

  assert.throws(() => store.openProject(project.id))

  const DatabaseSync = loadDatabaseSync()
  const db = new DatabaseSync(dbPath, { readOnly: true })
  try {
    assert.equal(
      (db.prepare('PRAGMA application_id').get() as { application_id: number }).application_id,
      LINGUIST_APPLICATION_ID,
    )
    assert.equal(
      (db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version,
      12,
    )
    assert.equal(
      (db.prepare('SELECT MAX(version) AS version FROM schema_migrations').get() as { version: number }).version,
      12,
    )
    assert.equal(
      db.prepare(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'proposal_issuances'",
      ).get(),
      undefined,
    )
  } finally {
    db.close()
  }
  assert.deepEqual(readFileSync(manifestPath), beforeManifest)
})

test('facade: writable open atomically backfills legacy project.json without dropping unknown fields', () => {
  const store = new CatStore({
    rootDir: makeTempDir(),
    entropy: makeEntropy(),
    now: makeClock(),
    applicationVersion: '2.0.0-test',
  })
  const project = store.createProject(INPUT)
  store.openProject(project.id).close()
  const manifestPath = store.index.projectMetaPath(project.id)
  const legacy = JSON.parse(readFileSync(manifestPath, 'utf8')) as Record<string, unknown>
  delete legacy.databaseIdentity
  legacy.futureExtension = { keep: true }
  writeFileSync(manifestPath, `${JSON.stringify(legacy, null, 2)}\n`)

  store.openProject(project.id).close()

  const updated = JSON.parse(readFileSync(manifestPath, 'utf8')) as {
    futureExtension: unknown
    databaseIdentity: StoredDatabaseIdentity
  }
  assert.deepEqual(updated.futureExtension, { keep: true })
  assert.equal(updated.databaseIdentity.createdByVersion, 'unknown')
  assert.equal(updated.databaseIdentity.lastMigratedByVersion, 'unknown')
  assert.deepEqual(
    readdirSync(store.index.projectDir(project.id)).filter((name) => name.includes('.tmp-')),
    [],
  )
})

test('facade: read-only open validates but does not backfill legacy project.json', () => {
  const store = new CatStore({ rootDir: makeTempDir(), entropy: makeEntropy(), now: makeClock() })
  const project = store.createProject(INPUT)
  store.openProject(project.id).close()
  const manifestPath = store.index.projectMetaPath(project.id)
  const legacy = JSON.parse(readFileSync(manifestPath, 'utf8')) as Record<string, unknown>
  delete legacy.databaseIdentity
  writeFileSync(manifestPath, `${JSON.stringify(legacy, null, 2)}\n`)
  const beforeBytes = readFileSync(manifestPath)
  const beforeMtimeNs = statSync(manifestPath, { bigint: true }).mtimeNs

  store.openProject(project.id, { readOnly: true }).close()

  assert.deepEqual(readFileSync(manifestPath), beforeBytes)
  assert.equal(statSync(manifestPath, { bigint: true }).mtimeNs, beforeMtimeNs)
})

test('facade: project.json identity mismatch fails before cat.db changes', () => {
  const store = new CatStore({ rootDir: makeTempDir(), entropy: makeEntropy(), now: makeClock() })
  const project = store.createProject(INPUT)
  store.openProject(project.id).close()
  const manifestPath = store.index.projectMetaPath(project.id)
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as Record<string, unknown>
  manifest.id = 'prj-ffffffffffffffff'
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)
  const dbPath = store.index.projectDbPath(project.id)
  const beforeBytes = readFileSync(dbPath)
  const beforeMtimeNs = statSync(dbPath, { bigint: true }).mtimeNs

  assert.throws(() => store.openProject(project.id), StoreDatabaseIdentityError)

  assert.deepEqual(readFileSync(dbPath), beforeBytes)
  assert.equal(statSync(dbPath, { bigint: true }).mtimeNs, beforeMtimeNs)
})

test('facade: manifest and database schema identities must agree', () => {
  const store = new CatStore({ rootDir: makeTempDir(), entropy: makeEntropy(), now: makeClock() })
  const project = store.createProject(INPUT)
  store.openProject(project.id).close()
  const manifestPath = store.index.projectMetaPath(project.id)
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as {
    databaseIdentity: StoredDatabaseIdentity
  }
  manifest.databaseIdentity.schemaVersion = SCHEMA_VERSION - 1
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)
  const dbPath = store.index.projectDbPath(project.id)
  const beforeBytes = readFileSync(dbPath)
  const beforeMtimeNs = statSync(dbPath, { bigint: true }).mtimeNs

  assert.throws(() => store.openProject(project.id), StoreDatabaseIdentityError)

  assert.deepEqual(readFileSync(dbPath), beforeBytes)
  assert.equal(statSync(dbPath, { bigint: true }).mtimeNs, beforeMtimeNs)
})

test('facade: a recorded manifest cannot silently restamp a zeroed database header', () => {
  const store = new CatStore({ rootDir: makeTempDir(), entropy: makeEntropy(), now: makeClock() })
  const project = store.createProject(INPUT)
  store.openProject(project.id).close()
  const dbPath = store.index.projectDbPath(project.id)
  const DatabaseSync = loadDatabaseSync()
  const tampered = new DatabaseSync(dbPath)
  tampered.exec('PRAGMA application_id = 0')
  tampered.close()
  const beforeBytes = readFileSync(dbPath)
  const beforeMtimeNs = statSync(dbPath, { bigint: true }).mtimeNs

  assert.throws(() => store.openProject(project.id), StoreDatabaseIdentityError)

  assert.deepEqual(readFileSync(dbPath), beforeBytes)
  assert.equal(statSync(dbPath, { bigint: true }).mtimeNs, beforeMtimeNs)
})

test('facade: a manifest snapshot prevents silent recreation of a missing cat.db', () => {
  const store = new CatStore({ rootDir: makeTempDir(), entropy: makeEntropy(), now: makeClock() })
  const project = store.createProject(INPUT)
  store.openProject(project.id).close()
  const dbPath = store.index.projectDbPath(project.id)
  unlinkSync(dbPath)

  assert.throws(() => store.openProject(project.id), StoreNotFoundError)
  assert.equal(existsSync(dbPath), false)
})

test('facade: a cat.db containing another project id is rejected before writable open', () => {
  const store = new CatStore({ rootDir: makeTempDir(), entropy: makeEntropy(), now: makeClock() })
  const projectA = store.createProject(INPUT)
  const dbA = store.openProject(projectA.id)
  dbA.catDb.db.prepare(`
    INSERT INTO assets
      (id, project_id, format_id, original_filename, source_sha256, segment_count, created_at)
    VALUES ('ast-foreign', ?, 'tsv', 'foreign.tsv', ?, 0, 'now')
  `).run(projectA.id, 'a'.repeat(64))
  dbA.close()

  const projectB = store.createProject({ ...INPUT, name: 'B' })
  const pathB = store.index.projectDbPath(projectB.id)
  copyFileSync(store.index.projectDbPath(projectA.id), pathB)
  const beforeBytes = readFileSync(pathB)
  const beforeMtimeNs = statSync(pathB, { bigint: true }).mtimeNs

  assert.throws(() => store.openProject(projectB.id), StoreDatabaseIdentityError)

  assert.deepEqual(readFileSync(pathB), beforeBytes)
  assert.equal(statSync(pathB, { bigint: true }).mtimeNs, beforeMtimeNs)
})

test('facade: full project lifecycle over injected root dir', () => {
  const rootDir = makeTempDir()
  const store = new CatStore({ rootDir, entropy: makeEntropy(), now: makeClock() })
  const project = store.createProject(INPUT)

  const db = store.openProject(project.id)
  assert.equal(db.schemaVersion, SCHEMA_VERSION)
  assert.ok(existsSync(store.index.projectDbPath(project.id)))
  const { asset } = db.assets.insertImported(makeImportedAsset({ segmentCount: 2 }))
  db.close()

  // data persists across opens
  const reopened = store.openProject(project.id)
  try {
    assert.equal(reopened.assets.get(asset.id)?.segmentCount, 2)
  } finally {
    reopened.close()
  }
})

test('facade: openProject on unknown id -> STORE_NOT_FOUND', () => {
  const store = new CatStore({ rootDir: makeTempDir(), entropy: makeEntropy(), now: makeClock() })
  assert.throws(() => store.openProject('prj-0000000000000000'), (err: unknown) => {
    assert.ok(err instanceof StoreNotFoundError)
    return true
  })
})

test('facade: read-only open rejects repository writes with STORE_READ_ONLY', () => {
  const store = new CatStore({ rootDir: makeTempDir(), entropy: makeEntropy(), now: makeClock() })
  const project = store.createProject(INPUT)
  const writable = store.openProject(project.id)
  const { segments } = writable.assets.insertImported(makeImportedAsset({ segmentCount: 1 }))
  writable.close()

  const db = store.openProject(project.id, { readOnly: true })
  try {
    assert.equal(db.readOnly, true)
    // reads fine
    assert.equal(db.segments.getById(segments[0]!.id)?.ordinal, 0)
    // every repository write path rejects
    assert.throws(() => db.assets.insertImported(makeImportedAsset({ segmentCount: 1 })), (err: unknown) => {
      assert.ok(err instanceof StoreReadOnlyError)
      assert.equal(err.code, 'STORE_READ_ONLY')
      return true
    })
    assert.throws(() => db.segments.applyTargetEdit(segments[0]!.id, 'x', 0), StoreReadOnlyError)
    assert.throws(() => db.segments.setLocked(segments[0]!.id, true), StoreReadOnlyError)
    assert.throws(
      () => db.proposals.insertPending({ segmentId: segments[0]!.id, baseRevision: 0, proposedTarget: 'x' }),
      StoreReadOnlyError,
    )
    assert.throws(
      () => db.qaFindings.replaceForSegment(segments[0]!.id, []),
      StoreReadOnlyError,
    )
    assert.throws(
      () => db.exports.record({ assetId: 'ast-0000000000000000', path: 'exports/x', sha256: 'd'.repeat(64), segmentCount: 0 }),
      StoreReadOnlyError,
    )
  } finally {
    db.close()
  }
})
