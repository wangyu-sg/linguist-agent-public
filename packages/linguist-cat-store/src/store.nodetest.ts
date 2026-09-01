import { test } from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { CatStore } from './store'
import { readBackupManifest } from './backup'
import { LINGUIST_APPLICATION_ID } from './database'
import { loadDatabaseSync } from './runtime'
import { MIGRATIONS } from './schema'
import { makeClock, makeEntropy, makeTempDir } from './testkit'

test('openProject: creates a verifiable pre-migration backup before Schema 19 writes', () => {
  const store = new CatStore({
    rootDir: makeTempDir(),
    entropy: makeEntropy('pre-migration-backup'),
    now: makeClock(),
    applicationVersion: 'test',
  })
  const project = store.createProject({
    name: 'Pre-migration backup',
    sourceLocale: 'en-US',
    targetLocale: 'zh-CN',
    promaWorkspaceId: 'workspace-1',
  })
  const dbPath = store.index.projectDbPath(project.id)
  const DatabaseSync = loadDatabaseSync()
  const legacy = new DatabaseSync(dbPath)
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
  for (const migration of MIGRATIONS.filter((item) => item.version <= 18)) {
    legacy.exec(migration.sql)
    migration.backfill?.(legacy)
    record.run(migration.version, '2026-01-01T00:00:00.000Z', migration.description)
  }
  legacy.exec(`
    PRAGMA application_id = ${LINGUIST_APPLICATION_ID};
    PRAGMA user_version = 18;
  `)
  legacy.close()
  store.index.recordDatabaseIdentity(project.id, {
    applicationId: LINGUIST_APPLICATION_ID,
    schemaVersion: 18,
    migrated: false,
  })

  const migrated = store.openProject(project.id)
  try {
    assert.equal(migrated.schemaVersion, 19)
  } finally {
    migrated.close()
  }

  const [backup] = store.listProjectBackups(project.id)
  assert.ok(backup)
  const backupDir = join(store.index.projectDir(project.id), 'backups', backup.name)
  const manifest = readBackupManifest(backupDir)
  assert.ok(manifest)
  assert.equal(manifest.schemaVersion, 18)
  assert.deepEqual(manifest.migration, { fromSchema: 18, toSchema: 19 })

  const backupDb = store.openBackupDatabase(project.id, backup.name)
  try {
    assert.equal(backupDb.readOnly, true)
    assert.equal(backupDb.schemaVersion, 18)
  } finally {
    backupDb.close()
  }
})

test('Schema 19 repositories keep imported occurrences separately and honor source controls', () => {
  const store = new CatStore({
    rootDir: makeTempDir(),
    entropy: makeEntropy('tm-sources'),
    now: makeClock(),
  })
  const project = store.createProject({
    name: 'TM sources',
    sourceLocale: 'en-US',
    targetLocale: 'zh-CN',
    promaWorkspaceId: 'workspace-1',
  })
  const db = store.openProject(project.id)
  try {
    const reference = db.referenceImports.insert({
      kind: 'tm',
      originalFilename: 'source.tmx',
      sourceSha256: 'a'.repeat(64),
      blobRelpath: 'blobs/source.tmx',
    })
    const source = db.tmSources.ensureImported(reference)
    const imported = db.tmUnits.importMany([{
      source: 'Charge',
      target: '充能',
      sourceLocale: 'en-US',
      targetLocale: 'zh-CN',
      sourceId: source.id,
      occurrenceKey: 'tuid-1',
      originalTuid: 'tuid-1',
      metadata: { domain: 'ui' },
      sourceInline: '<seg><ph/></seg>',
      targetInline: '<seg><ph/></seg>',
    }])
    assert.deepEqual(imported, { imported: 1, unchanged: 0 })
    assert.deepEqual(db.tmSources.get(source.id), {
      ...source,
      unitCount: 1,
    })
    const unit = db.tmUnits.list()[0]!
    assert.deepEqual(db.tmUnits.listCandidates('en-US', 'zh-CN')[0], {
      unitId: unit.id,
      source: 'Charge',
      target: '充能',
      sourceLabel: 'source.tmx',
      sourcePriority: 0,
      originalTuid: 'tuid-1',
      metadata: { domain: 'ui' },
      sourceInline: '<seg><ph/></seg>',
      targetInline: '<seg><ph/></seg>',
    })

    db.tmSources.update(source.id, { enabled: false })
    assert.equal(db.tmUnits.listCandidates('en-US', 'zh-CN').length, 0)
    db.tmSources.update(source.id, { enabled: true, priority: 3 })
    assert.equal(db.tmSources.get(source.id)?.priority, 3)
    assert.equal(db.tmSources.get(source.id)?.enabled, true)
  } finally {
    db.close()
  }
})

test('Schema 19 source identity is not shared across language pairs', () => {
  const store = new CatStore({ rootDir: makeTempDir(), entropy: makeEntropy('tm-hash'), now: makeClock() })
  const project = store.createProject({
    name: 'TM hash',
    sourceLocale: 'en-US',
    targetLocale: 'zh-CN',
    promaWorkspaceId: 'workspace-1',
  })
  const db = store.openProject(project.id)
  try {
    const sourceId = 'source-1'
    db.tmUnits.importMany([
      {
        source: 'Save',
        target: '保存',
        sourceLocale: 'en-US',
        targetLocale: 'zh-CN',
        sourceId,
        occurrenceKey: 'en-zh',
      },
      {
        source: 'Save',
        target: 'Sauvegarder',
        sourceLocale: 'en-US',
        targetLocale: 'fr-FR',
        sourceId,
        occurrenceKey: 'en-fr',
      },
    ])
    const rows = db.tmUnits.list({ query: 'Save' })
    assert.equal(rows.length, 2)
    const hashes = db.catDb.db.prepare(
      'SELECT source_hash FROM tm_units WHERE project_id = ? ORDER BY source_locale',
    ).all(project.id) as Array<{ source_hash: string }>
    assert.notEqual(hashes[0]!.source_hash, hashes[1]!.source_hash)
  } finally {
    db.close()
  }
})
