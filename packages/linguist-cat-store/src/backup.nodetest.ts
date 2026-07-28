import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { sha256Hex } from '@linguist/cat-formats'
import {
  listProjectBackups,
  readBackupManifest,
  verifyBackup,
  type BackupManifest,
} from './backup'
import { CatDatabase } from './database'
import { StoreNotFoundError } from './errors'
import { SCHEMA_VERSION } from './schema'
import { CatStore } from './store'
import { makeClock, makeEntropy, makeImportedAsset, makeTempDir } from './testkit'

test('backupProject: full-project directory backup with manifest; backup db reopens read-only with data intact', () => {
  const store = new CatStore({ rootDir: makeTempDir(), entropy: makeEntropy(), now: makeClock() })
  const project = store.createProject({ name: 'P', sourceLocale: 'en', targetLocale: 'zh-CN', promaWorkspaceId: 'ws' })
  const db = store.openProject(project.id)
  const { segments } = db.assets.insertImported(makeImportedAsset({ segmentCount: 3 }))
  db.segments.applyTargetEdit(segments[0]!.id, '已确认的译文', 0, { status: 'reviewed' })
  // source/ 与 blobs/ 各放一件内容，断言它们随备份走
  writeFileSync(join(db.sourceDir, 'ast-demo.tsv'), 'source-bytes')
  writeFileSync(join(db.blobsDir, 'ctx-demo.md'), 'blob-bytes')
  db.close()

  const backup = store.backupProject(project.id)
  assert.equal(backup.method, 'vacuum_into', 'Node 22 has no db.backup; VACUUM INTO fallback must be used')
  assert.ok(backup.backupName.startsWith('backup-'))
  assert.ok(existsSync(join(backup.backupDir, 'cat.db')))
  assert.ok(existsSync(join(backup.backupDir, 'project.json')))
  assert.ok(existsSync(join(backup.backupDir, 'source', 'ast-demo.tsv')))
  assert.ok(existsSync(join(backup.backupDir, 'blobs', 'ctx-demo.md')))
  assert.ok(existsSync(join(backup.backupDir, 'manifest.json')))

  // manifest 覆盖目录内全部其他文件，sha256/size 可复算
  const manifest = readBackupManifest(backup.backupDir)
  assert.ok(manifest !== undefined)
  assert.equal(manifest.schemaVersion, SCHEMA_VERSION)
  const listed = new Set(manifest.files.map((f) => f.path))
  for (const expected of ['cat.db', 'project.json', 'source/ast-demo.tsv', 'blobs/ctx-demo.md']) {
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
})

test('verifyBackup: tampered bytes / tampered manifest / missing file are reported', () => {
  const store = new CatStore({ rootDir: makeTempDir(), entropy: makeEntropy(), now: makeClock() })
  const project = store.createProject({ name: 'P', sourceLocale: 'en', targetLocale: 'zh-CN', promaWorkspaceId: 'ws' })
  store.openProject(project.id).close()
  const projectDir = join(store.rootDir, 'projects', project.id)
  writeFileSync(join(projectDir, 'source', 'a.bin'), 'aaa')
  const backup = store.backupProject(project.id)

  // 1. 篡改文件字节 → sha256 mismatch
  writeFileSync(join(backup.backupDir, 'source', 'a.bin'), 'bbb')
  let v = verifyBackup(backup.backupDir)
  assert.equal(v.ok, false)
  assert.ok(v.problems.some((p) => p === 'sha256 mismatch: source/a.bin'))

  // 恢复字节，篡改 manifest（删掉一个条目）→ unlisted file
  writeFileSync(join(backup.backupDir, 'source', 'a.bin'), 'aaa')
  const manifestPath = join(backup.backupDir, 'manifest.json')
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as BackupManifest
  manifest.files = manifest.files.filter((f) => f.path !== 'source/a.bin')
  writeFileSync(manifestPath, JSON.stringify(manifest))
  v = verifyBackup(backup.backupDir)
  assert.equal(v.ok, false)
  assert.ok(v.problems.some((p) => p === 'unlisted file: source/a.bin'))

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
