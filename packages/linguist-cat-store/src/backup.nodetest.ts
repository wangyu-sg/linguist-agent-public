import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { join } from 'node:path'
import { sha256Hex } from '@linguist/cat-formats'
import {
  listProjectBackups,
  readBackupManifest,
  createProjectBackup,
  verifyBackup,
  type BackupManifest,
} from './backup'
import { CatDatabase } from './database'
import { StoreNotFoundError } from './errors'
import { loadDatabaseSync } from './runtime'
import { SCHEMA_VERSION } from './schema'
import { CatStore } from './store'
import { makeClock, makeEntropy, makeImportedAsset, makeTempDir } from './testkit'

function refreshBackupFile(backupDir: string, relativePath: string): void {
  const manifest = readBackupManifest(backupDir)!
  const entry = manifest.files.find((file) => file.path === relativePath)!
  const bytes = readFileSync(join(backupDir, relativePath))
  entry.sizeBytes = bytes.byteLength
  entry.sha256 = sha256Hex(bytes)
  writeFileSync(join(backupDir, 'manifest.json'), JSON.stringify(manifest))
}

test('backupProject: full-project directory backup with manifest; backup db reopens read-only with data intact', () => {
  const store = new CatStore({ rootDir: makeTempDir(), entropy: makeEntropy(), now: makeClock() })
  const project = store.createProject({ name: 'P', sourceLocale: 'en', targetLocale: 'zh-CN', promaWorkspaceId: 'ws' })
  const db = store.openProject(project.id)
  const sourceBytes = Buffer.from('source-bytes')
  const { asset, segments } = db.assets.insertImported(makeImportedAsset({
    segmentCount: 3,
    filename: 'demo.tsv',
    sourceSha256: sha256Hex(sourceBytes),
  }))
  db.segments.applyTargetEdit(segments[0]!.id, '已确认的译文', 0, { status: 'reviewed' })
  // source/ 与 blobs/ 各放一件内容，断言它们随备份走
  db.saveAssetSource(asset.id, sourceBytes)
  writeFileSync(join(db.blobsDir, 'ctx-demo.md'), 'blob-bytes')
  db.close()

  const backup = store.backupProject(project.id)
  assert.equal(backup.method, 'vacuum_into', 'Node 22 has no db.backup; VACUUM INTO fallback must be used')
  assert.ok(backup.backupName.startsWith('backup-'))
  assert.ok(existsSync(join(backup.backupDir, 'cat.db')))
  assert.ok(existsSync(join(backup.backupDir, 'project.json')))
  assert.ok(existsSync(join(backup.backupDir, 'source', `${asset.id}.tsv`)))
  assert.ok(existsSync(join(backup.backupDir, 'blobs', 'ctx-demo.md')))
  assert.ok(existsSync(join(backup.backupDir, 'manifest.json')))

  // manifest 覆盖目录内全部其他文件，sha256/size 可复算
  const manifest = readBackupManifest(backup.backupDir)
  assert.ok(manifest !== undefined)
  assert.equal(manifest.schemaVersion, SCHEMA_VERSION)
  const listed = new Set(manifest.files.map((f) => f.path))
  for (const expected of ['cat.db', 'project.json', `source/${asset.id}.tsv`, 'blobs/ctx-demo.md']) {
    assert.ok(listed.has(expected), `manifest must list ${expected}`)
  }
  for (const file of manifest.files) {
    const abs = join(backup.backupDir, file.path)
    assert.equal(sha256Hex(readFileSync(abs)), file.sha256, `sha256 recomputed for ${file.path}`)
  }

  // metadata copy matches project.json
  const meta = JSON.parse(readFileSync(join(backup.backupDir, 'project.json'), 'utf8')) as { id: string }
  assert.equal(meta.id, project.id)

  // backup is a complete db: open read-only and read the data back
  const backupDb = CatDatabase.open(join(backup.backupDir, 'cat.db'), { readOnly: true })
  try {
    const row = backupDb.db
      .prepare('SELECT target, status, revision FROM segments WHERE id = ?')
      .get(segments[0]!.id) as { target: string; status: string; revision: number }
    // node:sqlite rows are null-prototype objects; spread before deepEqual
    assert.deepEqual({ ...row }, { target: '已确认的译文', status: 'reviewed', revision: 1 })
    const count = backupDb.db.prepare('SELECT COUNT(*) AS n FROM segments').get() as { n: number }
    assert.equal(count.n, 3)
  } finally {
    backupDb.close()
  }

  // 全新备份通过 verify
  const verification = verifyBackup(backup.backupDir)
  assert.deepEqual(verification.problems, [])
  assert.equal(verification.ok, true)
  assert.equal(verification.schemaVersion, SCHEMA_VERSION)
  assert.equal(manifest.version, '2')
  assert.equal(manifest.projectId, project.id)
})

test('verifyBackup: tampered bytes / tampered manifest / missing file are reported', () => {
  const store = new CatStore({ rootDir: makeTempDir(), entropy: makeEntropy(), now: makeClock() })
  const project = store.createProject({ name: 'P', sourceLocale: 'en', targetLocale: 'zh-CN', promaWorkspaceId: 'ws' })
  const db = store.openProject(project.id)
  const projectDir = join(store.rootDir, 'projects', project.id)
  const sourceBytes = Buffer.from('aaa')
  const inserted = db.assets.insertImported(makeImportedAsset({
    filename: 'a.bin',
    sourceSha256: sha256Hex(sourceBytes),
  }))
  db.saveAssetSource(inserted.asset.id, sourceBytes)
  db.close()
  const sourcePath = `source/${inserted.asset.id}.bin`
  const backup = store.backupProject(project.id)

  // 1. 篡改文件字节 → sha256 mismatch
  writeFileSync(join(backup.backupDir, sourcePath), 'bbb')
  let v = verifyBackup(backup.backupDir)
  assert.equal(v.ok, false)
  assert.ok(v.problems.some((p) => p === `sha256 mismatch: ${sourcePath}`))

  // 恢复字节，篡改 manifest（删掉一个条目）→ unlisted file
  writeFileSync(join(backup.backupDir, sourcePath), 'aaa')
  const manifestPath = join(backup.backupDir, 'manifest.json')
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as BackupManifest
  manifest.files = manifest.files.filter((f) => f.path !== sourcePath)
  writeFileSync(manifestPath, JSON.stringify(manifest))
  v = verifyBackup(backup.backupDir)
  assert.equal(v.ok, false)
  assert.ok(v.problems.some((p) => p === `unlisted file: ${sourcePath}`))

  // 删掉被 manifest 列出的文件 → missing file
  const fresh = store.backupProject(project.id)
  rmSync(join(fresh.backupDir, 'project.json'))
  v = verifyBackup(fresh.backupDir)
  assert.equal(v.ok, false)
  assert.ok(v.problems.some((p) => p === 'missing file: project.json'))
})

test('listProjectBackups: new-format dirs + legacy files, newest first, pre-restore snapshots skipped', () => {
  const store = new CatStore({ rootDir: makeTempDir(), entropy: makeEntropy(), now: makeClock() })
  const project = store.createProject({ name: 'P', sourceLocale: 'en', targetLocale: 'zh-CN', promaWorkspaceId: 'ws' })
  store.openProject(project.id).close()
  const projectDir = join(store.rootDir, 'projects', project.id)
  const backupsDir = join(projectDir, 'backups')

  const first = store.backupProject(project.id)
  const second = store.backupProject(project.id)
  // legacy 两文件备份 + pre-restore 快照（应被跳过）
  writeFileSync(join(backupsDir, 'cat-2026-01-01T00-00-00-000Z.db'), 'legacy')
  mkdirSync(join(backupsDir, 'pre-restore-2026-01-01T00-00-01-000Z'))

  const entries = listProjectBackups(projectDir)
  assert.equal(entries.length, 3)
  assert.equal(entries[0]!.name, second.backupName)
  assert.equal(entries[1]!.name, first.backupName)
  assert.equal(entries[2]!.name, 'cat-2026-01-01T00-00-00-000Z.db')
  assert.equal(entries[0]!.format, 'directory')
  assert.equal(entries[0]!.schemaVersion, SCHEMA_VERSION)
  assert.equal(entries[0]!.method, 'vacuum_into')
  assert.ok((entries[0]!.fileCount ?? 0) >= 2)
  assert.ok(entries[0]!.sizeBytes > 0)
  assert.equal(entries[2]!.format, 'legacy')
})

test('backupProject: unknown project / missing db -> STORE_NOT_FOUND', () => {
  const store = new CatStore({ rootDir: makeTempDir(), entropy: makeEntropy(), now: makeClock() })
  assert.throws(() => store.backupProject('prj-0000000000000000'), (err: unknown) => {
    assert.ok(err instanceof StoreNotFoundError)
    assert.equal(err.code, 'STORE_NOT_FOUND')
    return true
  })
  const project = store.createProject({ name: 'P', sourceLocale: 'en', targetLocale: 'zh-CN', promaWorkspaceId: 'ws' })
  assert.throws(() => store.backupProject(project.id), StoreNotFoundError, 'cat.db not created yet')
})

test('backup staging cleans partial output after ENOSPC and EROFS copy failures', () => {
  for (const code of ['ENOSPC', 'EROFS'] as const) {
    const store = new CatStore({ rootDir: makeTempDir(), entropy: makeEntropy(code), now: makeClock() })
    const project = store.createProject({ name: 'P', sourceLocale: 'en', targetLocale: 'zh-CN', promaWorkspaceId: 'ws' })
    const db = store.openProject(project.id)
    const projectDir = join(store.rootDir, 'projects', project.id)
    const now = code === 'ENOSPC' ? '2026-02-01T00:00:00.000Z' : '2026-02-02T00:00:00.000Z'
    try {
      assert.throws(
        () => createProjectBackup(db.catDb, projectDir, now, (point) => {
          if (point === 'before-copy') {
            const error = new Error(code) as NodeJS.ErrnoException
            error.code = code
            throw error
          }
        }),
        (error: unknown) => (error as NodeJS.ErrnoException).code === code,
      )
    } finally {
      db.close()
    }
    assert.deepEqual(
      readdirSync(join(projectDir, 'backups')).filter((name) => name.includes('.partial-')),
      [],
    )
    assert.ok(!existsSync(join(projectDir, 'backups', `backup-${now.replace(/[:.]/g, '-')}`)))
  }
})

test('backup captures committed WAL content without requiring a checkpoint', () => {
  const store = new CatStore({ rootDir: makeTempDir(), entropy: makeEntropy('wal'), now: makeClock() })
  const project = store.createProject({ name: 'P', sourceLocale: 'en', targetLocale: 'zh-CN', promaWorkspaceId: 'ws' })
  const db = store.openProject(project.id)
  const projectDir = join(store.rootDir, 'projects', project.id)
  db.catDb.db.exec('PRAGMA wal_autocheckpoint = 0')
  const source = Buffer.from('wal-source')
  const inserted = db.assets.insertImported(makeImportedAsset({
    segmentCount: 7,
    sourceSha256: sha256Hex(source),
  }))
  db.saveAssetSource(inserted.asset.id, source)
  assert.ok(existsSync(join(projectDir, 'cat.db-wal')))
  const backup = createProjectBackup(db.catDb, projectDir, '2026-03-01T00:00:00.000Z')
  db.close()

  const copy = CatDatabase.open(join(backup.backupDir, 'cat.db'), { readOnly: true })
  try {
    const row = copy.db.prepare('SELECT COUNT(*) AS n FROM segments WHERE asset_id = ?').get(
      inserted.asset.id,
    ) as { n: number }
    assert.equal(row.n, 7)
  } finally {
    copy.close()
  }
})

test('backup fails closed when DB references a missing blob and removes staging', () => {
  const store = new CatStore({ rootDir: makeTempDir(), entropy: makeEntropy('missing-blob'), now: makeClock() })
  const project = store.createProject({ name: 'P', sourceLocale: 'en', targetLocale: 'zh-CN', promaWorkspaceId: 'ws' })
  const db = store.openProject(project.id)
  db.contextDocs.insert({
    kind: 'doc',
    originalFilename: 'missing.md',
    blobRelpath: 'blobs/missing.md',
    sha256: 'a'.repeat(64),
  })
  const projectDir = join(store.rootDir, 'projects', project.id)
  assert.throws(
    () => createProjectBackup(db.catDb, projectDir, '2026-04-01T00:00:00.000Z'),
    /BLOB_MISSING_OR_UNREADABLE/,
  )
  db.close()
  assert.deepEqual(
    readdirSync(join(projectDir, 'backups')).filter((name) => name.includes('.partial-')),
    [],
  )
})

test('backup recursively rejects symlinks and preserves an existing same-name backup', () => {
  const store = new CatStore({ rootDir: makeTempDir(), entropy: makeEntropy('symlink'), now: makeClock() })
  const project = store.createProject({ name: 'P', sourceLocale: 'en', targetLocale: 'zh-CN', promaWorkspaceId: 'ws' })
  const db = store.openProject(project.id)
  const projectDir = join(store.rootDir, 'projects', project.id)
  const outside = join(store.rootDir, 'outside.txt')
  writeFileSync(outside, 'outside')
  symlinkSync(outside, join(projectDir, 'source', 'linked.txt'))
  assert.throws(
    () => createProjectBackup(db.catDb, projectDir, '2026-05-01T00:00:00.000Z'),
    /symbolic link/i,
  )
  rmSync(join(projectDir, 'source', 'linked.txt'))

  const first = createProjectBackup(db.catDb, projectDir, '2026-05-02T00:00:00.000Z')
  const originalManifest = readFileSync(join(first.backupDir, 'manifest.json'), 'utf8')
  assert.throws(
    () => createProjectBackup(db.catDb, projectDir, '2026-05-02T00:00:00.000Z'),
    /already exists/i,
  )
  assert.equal(readFileSync(join(first.backupDir, 'manifest.json'), 'utf8'), originalManifest)
  db.close()
})

test('verifyBackup binds manifest and project.json to the expected project identity', () => {
  const store = new CatStore({ rootDir: makeTempDir(), entropy: makeEntropy('identity'), now: makeClock() })
  const project = store.createProject({ name: 'P', sourceLocale: 'en', targetLocale: 'zh-CN', promaWorkspaceId: 'ws' })
  store.openProject(project.id).close()
  const backup = store.backupProject(project.id)

  const conflict = verifyBackup(backup.backupDir, 'prj-fedcba9876543210')
  assert.equal(conflict.ok, false)
  assert.ok(conflict.problems.some((problem) => problem.includes('projectId mismatch')))

  const manifest = readBackupManifest(backup.backupDir)!
  manifest.projectId = 'prj-fedcba9876543210'
  writeFileSync(join(backup.backupDir, 'manifest.json'), JSON.stringify(manifest))
  const tampered = verifyBackup(backup.backupDir, project.id)
  assert.equal(tampered.ok, false)
  assert.ok(tampered.problems.some((problem) => problem.includes('manifest projectId mismatch')))
})

test('verifyBackup checks v13 application, user_version, migrations, and manifest checkpoint identity', () => {
  const store = new CatStore({
    rootDir: makeTempDir(),
    entropy: makeEntropy('v13-identity'),
    now: makeClock(),
  })
  const project = store.createProject({
    name: 'P',
    sourceLocale: 'en',
    targetLocale: 'zh-CN',
    promaWorkspaceId: 'ws',
  })
  store.openProject(project.id).close()

  const manifestBackup = store.backupProject(project.id)
  const projectJsonPath = join(manifestBackup.backupDir, 'project.json')
  const projectJson = JSON.parse(readFileSync(projectJsonPath, 'utf8')) as {
    databaseIdentity: { schemaVersion: number }
  }
  projectJson.databaseIdentity.schemaVersion = 12
  writeFileSync(projectJsonPath, JSON.stringify(projectJson))
  refreshBackupFile(manifestBackup.backupDir, 'project.json')
  assert.ok(
    verifyBackup(manifestBackup.backupDir, project.id).problems
      .some((problem) => problem.includes('databaseIdentity mismatch')),
  )

  const DatabaseSync = loadDatabaseSync()
  for (const [label, mutate] of [
    ['application_id', (db: InstanceType<typeof DatabaseSync>) => db.exec('PRAGMA application_id = 123')],
    ['user_version', (db: InstanceType<typeof DatabaseSync>) => db.exec('PRAGMA user_version = 12')],
    ['schema_migrations', (db: InstanceType<typeof DatabaseSync>) =>
      db.exec('DELETE FROM schema_migrations WHERE version = 13')],
  ] as const) {
    const backup = store.backupProject(project.id)
    const path = join(backup.backupDir, 'cat.db')
    const raw = new DatabaseSync(path)
    mutate(raw)
    raw.close()
    refreshBackupFile(backup.backupDir, 'cat.db')
    const verification = verifyBackup(backup.backupDir, project.id)
    assert.equal(verification.ok, false, label)
    assert.ok(
      verification.problems.some((problem) => problem.includes('CAT_DB_OPEN')),
      `${label}: ${verification.problems.join(', ')}`,
    )
  }
})

test('verifyBackup rejects a symlink mixed into an otherwise digest-matching backup', () => {
  const store = new CatStore({ rootDir: makeTempDir(), entropy: makeEntropy('backup-link'), now: makeClock() })
  const project = store.createProject({ name: 'P', sourceLocale: 'en', targetLocale: 'zh-CN', promaWorkspaceId: 'ws' })
  store.openProject(project.id).close()
  const backup = store.backupProject(project.id)
  const projectJson = join(backup.backupDir, 'project.json')
  rmSync(projectJson)
  symlinkSync(join(store.rootDir, 'projects', project.id, 'project.json'), projectJson)

  const verification = verifyBackup(backup.backupDir, project.id)
  assert.equal(verification.ok, false)
  assert.ok(verification.problems.some((problem) =>
    problem.includes('non-regular file: project.json')
    || problem.includes('symbolic link: project.json')))
})

test('verifyBackup rejects broken Harness lineage even when manifest hashes match', () => {
  const store = new CatStore({ rootDir: makeTempDir(), entropy: makeEntropy('backup-lineage'), now: makeClock() })
  const project = store.createProject({ name: 'P', sourceLocale: 'en', targetLocale: 'zh-CN', promaWorkspaceId: 'ws' })
  const db = store.openProject(project.id)
  const source = Buffer.from('backup-lineage-source')
  const { asset, segments } = db.assets.insertImported(makeImportedAsset({
    segmentCount: 1,
    sourceSha256: sha256Hex(source),
  }))
  db.saveAssetSource(asset.id, source)
  db.runs.createJob({
    jobId: 'job-backup-lineage',
    runId: 'run-backup-lineage',
    sessionId: 'session-backup-lineage',
    strategy: 'balanced',
    segmentIds: [segments[0]!.id as string],
    provenance: { schemaVersion: 1, runtime: 'worker' },
  })
  db.close()
  const backup = store.backupProject(project.id)

  const backupDbPath = join(backup.backupDir, 'cat.db')
  const backupDb = CatDatabase.open(backupDbPath)
  backupDb.db.exec('DROP TABLE translation_jobs')
  backupDb.close()
  const manifest = readBackupManifest(backup.backupDir)!
  const databaseEntry = manifest.files.find((file) => file.path === 'cat.db')!
  databaseEntry.sizeBytes = statSync(backupDbPath).size
  databaseEntry.sha256 = sha256Hex(readFileSync(backupDbPath))
  writeFileSync(join(backup.backupDir, 'manifest.json'), JSON.stringify(manifest))

  const verification = verifyBackup(backup.backupDir, project.id)
  assert.equal(verification.ok, false)
  assert.ok(verification.problems.some((problem) =>
    problem.includes('integrity: schema_version/CAT_DB_OPEN_STORE_DATABASE_IDENTITY')))
})
