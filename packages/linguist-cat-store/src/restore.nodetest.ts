import { test } from 'node:test'
import assert from 'node:assert/strict'
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { sha256Hex } from '@linguist/cat-formats'
import { readBackupManifest } from './backup'
import {
  StoreBackupCorruptError,
  StoreBackupLegacyError,
  StoreNotFoundError,
} from './errors'
import { restoreProjectBackup } from './restore'
import { loadDatabaseSync } from './runtime'
import { SCHEMA_VERSION } from './schema'
import { CatStore } from './store'
import { makeClock, makeEntropy, makeImportedAsset, makeTempDir } from './testkit'

/** 项目 + 一个已审校段 + source/blobs 各一件内容；返回句柄已关闭后的上下文。 */
function makeBackedUpProject() {
  const store = new CatStore({ rootDir: makeTempDir(), entropy: makeEntropy(), now: makeClock() })
  const project = store.createProject({ name: 'P', sourceLocale: 'en', targetLocale: 'zh-CN', promaWorkspaceId: 'ws' })
  const db = store.openProject(project.id)
  const { segments } = db.assets.insertImported(makeImportedAsset({ segmentCount: 2 }))
  db.segments.applyTargetEdit(segments[0]!.id, '备份时的译文', 0, { status: 'reviewed' })
  const projectDir = join(store.rootDir, 'projects', project.id)
  writeFileSync(join(db.sourceDir, 'ast-demo.tsv'), 'source-v1')
  writeFileSync(join(db.blobsDir, 'ctx-demo.md'), 'blob-v1')
  db.close()
  const backup = store.backupProject(project.id)
  return { store, project, projectDir, backup, segmentId: segments[0]!.id }
}

function readSegmentTarget(store: CatStore, projectId: string, segmentId: string): string {
  const db = store.openProject(projectId, { readOnly: true })
  try {
    const row = db.catDb.db.prepare('SELECT target FROM segments WHERE id = ?').get(segmentId) as { target: string }
    return row.target
  } finally {
    db.close()
  }
}

test('restore: edits after backup are rolled back; pre-restore snapshot keeps them', () => {
  const { store, project, projectDir, backup, segmentId } = makeBackedUpProject()

  // 备份后修改：段译文 + source 内容 + 新增 blob
  const db = store.openProject(project.id)
  db.segments.applyTargetEdit(segmentId, '备份后的新译文', 1, { status: 'draft' })
  db.close()
  writeFileSync(join(projectDir, 'source', 'ast-demo.tsv'), 'source-v2')
  writeFileSync(join(projectDir, 'blobs', 'ctx-new.md'), 'blob-v2')

  const result = store.restoreProject(project.id, backup.backupName)
  assert.equal(result.backupName, backup.backupName)
  assert.ok(result.preRestoreName.startsWith('pre-restore-'))

  // 项目回到备份态
  assert.equal(readSegmentTarget(store, project.id, segmentId), '备份时的译文')
  assert.equal(readFileSync(join(projectDir, 'source', 'ast-demo.tsv'), 'utf8'), 'source-v1')
  assert.equal(readFileSync(join(projectDir, 'blobs', 'ctx-demo.md'), 'utf8'), 'blob-v1')
  assert.ok(!existsSync(join(projectDir, 'blobs', 'ctx-new.md')), '备份后新增的 blob 必须被移除')

  // pre-restore 快照保留了备份后的状态
  const snapshotDir = join(projectDir, 'backups', result.preRestoreName)
  assert.ok(existsSync(join(snapshotDir, 'cat.db')))
  assert.equal(readFileSync(join(snapshotDir, 'source', 'ast-demo.tsv'), 'utf8'), 'source-v2')
  assert.equal(readFileSync(join(snapshotDir, 'blobs', 'ctx-new.md'), 'utf8'), 'blob-v2')
  const snapshotDb = store.openBackupDatabase(project.id, backup.backupName)
  snapshotDb.close()
})

test('restore: project.json 以备份元数据为准', () => {
  const { store, project, projectDir, backup } = makeBackedUpProject()
  store.updateProject(project.id, { name: '改名后的项目' })
  store.restoreProject(project.id, backup.backupName)
  const meta = JSON.parse(readFileSync(join(projectDir, 'project.json'), 'utf8')) as { name: string }
  assert.equal(meta.name, 'P')
})

test('restore: corrupted backup (tampered bytes) rejected, current state untouched', () => {
  const { store, project, projectDir, backup, segmentId } = makeBackedUpProject()
  const db = store.openProject(project.id)
  db.segments.applyTargetEdit(segmentId, '备份后的新译文', 1, { status: 'draft' })
  db.close()

  writeFileSync(join(backup.backupDir, 'source', 'ast-demo.tsv'), 'source-XX')
  assert.throws(
    () => store.restoreProject(project.id, backup.backupName),
    (err: unknown) => {
      assert.ok(err instanceof StoreBackupCorruptError)
      assert.equal(err.code, 'STORE_BACKUP_CORRUPT')
      assert.ok(err.problems.some((p) => p === 'sha256 mismatch: source/ast-demo.tsv'))
      return true
    },
  )
  assert.equal(readSegmentTarget(store, project.id, segmentId), '备份后的新译文')
  assert.equal(readFileSync(join(projectDir, 'source', 'ast-demo.tsv'), 'utf8'), 'source-v1')
  // 未产生 pre-restore 快照
  assert.ok(
    !readdirSync(join(projectDir, 'backups')).some((n) => n.startsWith('pre-restore-')),
  )
})

test('restore: backup db unopenable (garbage bytes, consistent manifest) rejected', () => {
  const { store, project, backup } = makeBackedUpProject()
  // 用垃圾字节替换备份库并重算 manifest（模拟「外形完整但库已坏」）
  const dbPath = join(backup.backupDir, 'cat.db')
  writeFileSync(dbPath, 'not a sqlite database at all')
  const manifest = readBackupManifest(backup.backupDir)!
  const entry = manifest.files.find((f) => f.path === 'cat.db')!
  entry.sha256 = sha256Hex(readFileSync(dbPath))
  entry.sizeBytes = readFileSync(dbPath).byteLength
  writeFileSync(join(backup.backupDir, 'manifest.json'), JSON.stringify(manifest))

  assert.throws(
    () => store.restoreProject(project.id, backup.backupName),
    (err: unknown) => {
      assert.ok(err instanceof StoreBackupCorruptError)
      assert.ok(err.problems.some((p) => p.startsWith('cat.db not openable:')))
      return true
    },
  )
})

test('restore: backup with newer schema rejected (fail closed)', () => {
  const { store, project, backup } = makeBackedUpProject()
  // 模拟「更新版本应用产生的备份」：bump schema_migrations 并重算 manifest
  const dbPath = join(backup.backupDir, 'cat.db')
  const DatabaseSync = loadDatabaseSync()
  const raw = new DatabaseSync(dbPath)
  raw.exec(`UPDATE schema_migrations SET version = ${SCHEMA_VERSION + 1} WHERE version = ${SCHEMA_VERSION}`)
  raw.close()
  const manifest = readBackupManifest(backup.backupDir)!
  const entry = manifest.files.find((f) => f.path === 'cat.db')!
  entry.sha256 = sha256Hex(readFileSync(dbPath))
  entry.sizeBytes = readFileSync(dbPath).byteLength
  writeFileSync(join(backup.backupDir, 'manifest.json'), JSON.stringify(manifest))

  assert.throws(
    () => store.restoreProject(project.id, backup.backupName),
    (err: unknown) => {
      assert.ok(err instanceof StoreBackupCorruptError)
      assert.ok(err.problems.some((p) => p.includes('STORE_SCHEMA_TOO_NEW')))
      return true
    },
  )
})

test('restore: legacy pre-manifest backup refused; preview open works read-only', () => {
  const { store, project, projectDir, backup, segmentId } = makeBackedUpProject()
  // 伪造 legacy 两文件备份（从新格式备份复制 db + meta）
  const legacyName = 'cat-2026-01-01T00-00-00-000Z.db'
  const backupsDir = join(projectDir, 'backups')
  copyFileSync(join(backup.backupDir, 'cat.db'), join(backupsDir, legacyName))

  assert.throws(
    () => store.restoreProject(project.id, legacyName),
    (err: unknown) => {
      assert.ok(err instanceof StoreBackupLegacyError)
      assert.equal(err.code, 'STORE_BACKUP_LEGACY')
      return true
    },
  )

  // preview 降级路径：legacy db 仍可只读打开跑摘要
  const legacyDb = store.openBackupDatabase(project.id, legacyName)
  try {
    assert.equal(legacyDb.segments.count({}), 2)
    const row = legacyDb.catDb.db.prepare('SELECT target FROM segments WHERE id = ?').get(segmentId) as { target: string }
    assert.equal(row.target, '备份时的译文')
  } finally {
    legacyDb.close()
  }
})

test('restore: mid-restore failure rolls back to the pre-restore snapshot', () => {
  // 固定时钟 → restore stamp 可预测，预置一个同名目录让 project.json 的
  // tmp+rename 在 cat.db 已替换后失败，验证回滚。
  const fixedNow = '2026-01-01T00:00:00.000Z'
  const store = new CatStore({ rootDir: makeTempDir(), entropy: makeEntropy(), now: () => fixedNow })
  const project = store.createProject({ name: 'P', sourceLocale: 'en', targetLocale: 'zh-CN', promaWorkspaceId: 'ws' })
  const db = store.openProject(project.id)
  const { segments } = db.assets.insertImported(makeImportedAsset({ segmentCount: 2 }))
  db.segments.applyTargetEdit(segments[0]!.id, '备份时的译文', 0, { status: 'reviewed' })
  db.close()
  const projectDir = join(store.rootDir, 'projects', project.id)
  const backup = store.backupProject(project.id)

  const db2 = store.openProject(project.id)
  db2.segments.applyTargetEdit(segments[0]!.id, '备份后的新译文', 1, { status: 'draft' })
  db2.close()

  // 故障注入：project.json 的原子写 tmp 路径被同名目录占用 → installFile 抛错
  const stamp = fixedNow.replace(/[:.]/g, '-')
  mkdirSync(join(projectDir, `project.json.restore-${stamp}`))

  assert.throws(() => store.restoreProject(project.id, backup.backupName))
  // 回滚：cat.db 回到备份后状态（非备份态），project.json 未被破坏
  assert.equal(readSegmentTarget(store, project.id, segments[0]!.id), '备份后的新译文')
  const meta = JSON.parse(readFileSync(join(projectDir, 'project.json'), 'utf8')) as { id: string }
  assert.equal(meta.id, project.id)
})

test('restore: unknown / malformed backup name -> STORE_NOT_FOUND', () => {
  const { store, project } = makeBackedUpProject()
  assert.throws(() => store.restoreProject(project.id, 'backup-2099-01-01T00-00-00-000Z'), StoreNotFoundError)
  assert.throws(() => store.restoreProject(project.id, '../../etc/passwd'), StoreNotFoundError)
  assert.throws(() => store.restoreProject(project.id, 'pre-restore-2026-01-01T00-00-00-000Z'), StoreNotFoundError)
  assert.throws(() => store.openBackupDatabase(project.id, '../projects.json'), StoreNotFoundError)
})

test('restoreProjectBackup: works with a project whose cat.db was never created (fresh project dir)', () => {
  const { projectDir, backup } = makeBackedUpProject()
  // 删除当前 cat.db / source / blobs，模拟「新项目目录」恢复场景
  rmSync(join(projectDir, 'cat.db'))
  rmSync(join(projectDir, 'cat.db-wal'), { force: true })
  rmSync(join(projectDir, 'cat.db-shm'), { force: true })
  rmSync(join(projectDir, 'source'), { recursive: true, force: true })
  rmSync(join(projectDir, 'blobs'), { recursive: true, force: true })

  const result = restoreProjectBackup(projectDir, backup.backupName, '2026-02-01T00:00:00.000Z')
  assert.ok(result.preRestoreName.startsWith('pre-restore-'))
  assert.ok(existsSync(join(projectDir, 'cat.db')))
  assert.equal(readFileSync(join(projectDir, 'source', 'ast-demo.tsv'), 'utf8'), 'source-v1')
  assert.equal(readFileSync(join(projectDir, 'blobs', 'ctx-demo.md'), 'utf8'), 'blob-v1')
})
