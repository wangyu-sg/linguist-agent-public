import { test } from 'node:test'
import assert from 'node:assert/strict'
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { sha256Hex } from '@linguist/cat-formats'
import { readBackupManifest } from './backup'
import {
  StoreBackupCorruptError,
  StoreBackupLegacyError,
  StoreNotFoundError,
} from './errors'
import {
  RESTORE_TRANSACTION_FILE,
  restoreProjectBackup,
} from './restore'
import { loadDatabaseSync } from './runtime'
import { SCHEMA_VERSION } from './schema'
import { CatStore } from './store'
import { makeClock, makeEntropy, makeImportedAsset, makeTempDir } from './testkit'

/** 项目 + 一个已审校段 + source/blobs 各一件内容；返回句柄已关闭后的上下文。 */
function makeBackedUpProject() {
  const store = new CatStore({ rootDir: makeTempDir(), entropy: makeEntropy(), now: makeClock() })
  const project = store.createProject({ name: 'P', sourceLocale: 'en', targetLocale: 'zh-CN', promaWorkspaceId: 'ws' })
  const db = store.openProject(project.id)
  const sourceBytes = Buffer.from('source-v1')
  const { asset, segments } = db.assets.insertImported(makeImportedAsset({
    segmentCount: 2,
    filename: 'demo.tsv',
    sourceSha256: sha256Hex(sourceBytes),
  }))
  db.segments.applyTargetEdit(segments[0]!.id, '备份时的译文', 0, { status: 'reviewed' })
  const projectDir = join(store.rootDir, 'projects', project.id)
  db.saveAssetSource(asset.id, sourceBytes)
  writeFileSync(join(db.blobsDir, 'ctx-demo.md'), 'blob-v1')
  db.close()
  const backup = store.backupProject(project.id)
  return {
    store,
    project,
    projectDir,
    backup,
    segmentId: segments[0]!.id,
    sourceName: `${asset.id}.tsv`,
  }
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
  const { store, project, projectDir, backup, segmentId, sourceName } = makeBackedUpProject()

  // 备份后修改：段译文 + source 内容 + 新增 blob
  const db = store.openProject(project.id)
  db.segments.applyTargetEdit(segmentId, '备份后的新译文', 1, { status: 'draft' })
  db.close()
  writeFileSync(join(projectDir, 'source', sourceName), 'source-v2')
  writeFileSync(join(projectDir, 'blobs', 'ctx-new.md'), 'blob-v2')

  const result = store.restoreProject(project.id, backup.backupName)
  assert.equal(result.backupName, backup.backupName)
  assert.ok(result.preRestoreName.startsWith('pre-restore-'))

  // 项目回到备份态
  assert.equal(readSegmentTarget(store, project.id, segmentId), '备份时的译文')
  assert.equal(readFileSync(join(projectDir, 'source', sourceName), 'utf8'), 'source-v1')
  assert.equal(readFileSync(join(projectDir, 'blobs', 'ctx-demo.md'), 'utf8'), 'blob-v1')
  assert.ok(!existsSync(join(projectDir, 'blobs', 'ctx-new.md')), '备份后新增的 blob 必须被移除')

  const restoredDbPath = join(projectDir, 'cat.db')
  const restoredManifest = JSON.parse(
    readFileSync(join(projectDir, 'project.json'), 'utf8'),
  ) as {
    databaseIdentity: {
      applicationId: number
      schemaVersion: number
      mainFileSnapshot: { sha256: string }
    }
  }
  const DatabaseSync = loadDatabaseSync()
  const identityDb = new DatabaseSync(restoredDbPath, { readOnly: true })
  try {
    assert.equal(
      (identityDb.prepare('PRAGMA application_id').get() as { application_id: number }).application_id,
      restoredManifest.databaseIdentity.applicationId,
    )
    assert.equal(
      (identityDb.prepare('PRAGMA user_version').get() as { user_version: number }).user_version,
      SCHEMA_VERSION,
    )
    assert.equal(
      (identityDb.prepare(
        'SELECT MAX(version) AS version FROM schema_migrations',
      ).get() as { version: number }).version,
      SCHEMA_VERSION,
    )
  } finally {
    identityDb.close()
  }
  assert.equal(restoredManifest.databaseIdentity.schemaVersion, SCHEMA_VERSION)
  assert.equal(
    restoredManifest.databaseIdentity.mainFileSnapshot.sha256,
    sha256Hex(readFileSync(restoredDbPath)),
  )

  // pre-restore 快照保留了备份后的状态
  const snapshotDir = join(projectDir, 'backups', result.preRestoreName)
  assert.ok(existsSync(join(snapshotDir, 'cat.db')))
  assert.equal(readFileSync(join(snapshotDir, 'source', sourceName), 'utf8'), 'source-v2')
  assert.equal(readFileSync(join(snapshotDir, 'blobs', 'ctx-new.md'), 'utf8'), 'blob-v2')
  const snapshotDb = store.openBackupDatabase(project.id, backup.backupName)
  snapshotDb.close()
})

test('restore: QA status, waiver evidence, occurrences, and status history remain intact', () => {
  const store = new CatStore({
    rootDir: makeTempDir(),
    entropy: makeEntropy('qa-restore'),
    now: makeClock(),
  })
  const project = store.createProject({
    name: 'QA history',
    sourceLocale: 'en',
    targetLocale: 'zh-CN',
    promaWorkspaceId: 'ws',
  })
  const db = store.openProject(project.id)
  const sourceBytes = Buffer.from('qa-source')
  const { asset, segments } = db.assets.insertImported(makeImportedAsset({
    segmentCount: 1,
    sourceSha256: sha256Hex(sourceBytes),
  }))
  db.saveAssetSource(asset.id, sourceBytes)
  const [finding] = db.qaFindings.replaceForSegment(segments[0]!.id, [{
    segmentId: segments[0]!.id,
    code: 'EMPTY_TARGET',
    severity: 'L1',
    message: 'empty',
    evidenceHash: 'empty-target',
  }], {
    runId: 'qa:before-backup',
    observedAt: '2026-07-29T03:00:00.000Z',
    ruleVersion: 'rules-v1',
  })
  db.qaFindings.transition(finding!.id, 'waived', {
    reason: 'intentional blank',
    operator: 'reviewer-restore',
    at: '2026-07-29T03:01:00.000Z',
  })
  db.close()
  const backup = store.backupProject(project.id)

  const changed = store.openProject(project.id)
  changed.qaFindings.transition(finding!.id, 'open')
  changed.close()
  store.restoreProject(project.id, backup.backupName)

  const restored = store.openProject(project.id, { readOnly: true })
  try {
    const row = restored.qaFindings.getById(finding!.id)
    assert.equal(row?.status, 'waived')
    assert.equal(row?.waiverReason, 'intentional blank')
    assert.equal(row?.waivedBy, 'reviewer-restore')
    assert.equal(restored.qaFindings.listOccurrences(finding!.id).length, 1)
    assert.deepEqual(
      restored.qaFindings.listStatusEvents(finding!.id).map((event) => event.toStatus),
      ['open', 'waived'],
    )
  } finally {
    restored.close()
  }
})

test('restore: durable jobs, idempotency receipts, outbox sequence and acknowledgements roll back together', () => {
  const store = new CatStore({
    rootDir: makeTempDir(),
    entropy: makeEntropy('run-restore'),
    now: makeClock(),
  })
  const project = store.createProject({
    name: 'Run recovery',
    sourceLocale: 'en',
    targetLocale: 'zh-CN',
    promaWorkspaceId: 'ws',
  })
  const db = store.openProject(project.id)
  const sourceBytes = Buffer.from('run-restore-source')
  const { asset, segments } = db.assets.insertImported(makeImportedAsset({
    segmentCount: 2,
    sourceSha256: sha256Hex(sourceBytes),
  }))
  db.saveAssetSource(asset.id, sourceBytes)
  const segmentIds = segments.map((segment) => segment.id as string)
  const authority = { sessionId: 'session-restore' }
  const identity = {
    runId: 'run-restore',
    toolCallId: 'call-restore',
    idempotencyKey: 'key-restore',
  }
  db.runs.createJob({
    jobId: 'job-restore',
    runId: identity.runId,
    sessionId: authority.sessionId,
    strategy: 'balanced',
    segmentIds,
    provenance: { schemaVersion: 1, runtime: 'worker' },
  })
  db.runs.transitionJob('job-restore', authority, 'running')
  db.runs.checkpointJob({
    jobId: 'job-restore',
    ...authority,
    cursor: 1,
    completedSegmentIds: segmentIds.slice(0, 1),
    failedSegmentIds: [],
    proposalIds: [],
    openItemIds: [],
  })
  const original = db.runs.executeMutation({
    identity,
    operation: 'cat_propose_translations',
    payload: { segmentId: segmentIds[0], proposedTarget: '备份内候选 0' },
    mutate: () => {
      const proposal = db.proposals.insertPending({
        segmentId: segments[0]!.id,
        baseRevision: 0,
        proposedTarget: '备份内候选 0',
        runId: identity.runId,
      })
      return {
        result: { proposalId: proposal.id as string },
        changes: [{
          entityType: 'proposal' as const,
          entityId: proposal.id as string,
          changeKind: 'created' as const,
          segmentId: segmentIds[0],
          expectedRevision: 0,
          after: proposal,
        }],
        event: {
          kind: 'proposal-created' as const,
          segmentIds: [segmentIds[0]!],
          proposalIds: [proposal.id as string],
        },
      }
    },
  })
  assert.equal(original.event?.sequence, 4)
  db.runs.ackEvents('renderer-restore', 4)
  db.close()
  const backup = store.backupProject(project.id)

  const changed = store.openProject(project.id)
  changed.runs.transitionJob('job-restore', authority, 'paused')
  changed.close()
  store.restoreProject(project.id, backup.backupName)

  const restored = store.openProject(project.id)
  try {
    assert.equal(restored.runs.getJob('job-restore', authority)?.status, 'running')
    assert.equal(restored.runs.getJob('job-restore', authority)?.cursor, 1)
    assert.deepEqual(restored.runs.listEvents().map((event) => event.sequence), [1, 2, 3, 4])
    assert.equal(restored.runs.getEventAck('renderer-restore')?.sequence, 4)
    const replay = restored.runs.executeMutation({
      identity,
      operation: 'cat_propose_translations',
      payload: { segmentId: segmentIds[0], proposedTarget: '备份内候选 0' },
      mutate: () => assert.fail('restored idempotency receipt must bypass mutation'),
    })
    assert.equal(replay.replayed, true)
    assert.deepEqual(replay.result, original.result)
    assert.equal(restored.runs.getRunChangeSummary(identity.runId).changes.proposalsCreated, 1)
  } finally {
    restored.close()
  }
})

test('restore: project.json 以备份元数据为准', () => {
  const { store, project, projectDir, backup } = makeBackedUpProject()
  store.updateProject(project.id, { name: '改名后的项目' })
  store.restoreProject(project.id, backup.backupName)
  const meta = JSON.parse(readFileSync(join(projectDir, 'project.json'), 'utf8')) as { name: string }
  assert.equal(meta.name, 'P')
})

test('restore: corrupted backup (tampered bytes) rejected, current state untouched', () => {
  const { store, project, projectDir, backup, segmentId, sourceName } = makeBackedUpProject()
  const db = store.openProject(project.id)
  db.segments.applyTargetEdit(segmentId, '备份后的新译文', 1, { status: 'draft' })
  db.close()

  writeFileSync(join(backup.backupDir, 'source', sourceName), 'source-XX')
  assert.throws(
    () => store.restoreProject(project.id, backup.backupName),
    (err: unknown) => {
      assert.ok(err instanceof StoreBackupCorruptError)
      assert.equal(err.code, 'STORE_BACKUP_CORRUPT')
      assert.ok(err.problems.some((p) => p === `sha256 mismatch: source/${sourceName}`))
      return true
    },
  )
  assert.equal(readSegmentTarget(store, project.id, segmentId), '备份后的新译文')
  assert.equal(readFileSync(join(projectDir, 'source', sourceName), 'utf8'), 'source-v1')
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
      assert.ok(err.problems.some((p) => p.includes('CAT_DB_OPEN')))
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

test('restore: injected mid-install failure rolls back to the pre-restore snapshot', () => {
  const fixedNow = '2026-01-01T00:00:00.000Z'
  const store = new CatStore({ rootDir: makeTempDir(), entropy: makeEntropy(), now: () => fixedNow })
  const project = store.createProject({ name: 'P', sourceLocale: 'en', targetLocale: 'zh-CN', promaWorkspaceId: 'ws' })
  const db = store.openProject(project.id)
  const sourceBytes = Buffer.from('rollback-source')
  const { asset, segments } = db.assets.insertImported(makeImportedAsset({
    segmentCount: 2,
    sourceSha256: sha256Hex(sourceBytes),
  }))
  db.saveAssetSource(asset.id, sourceBytes)
  db.segments.applyTargetEdit(segments[0]!.id, '备份时的译文', 0, { status: 'reviewed' })
  db.close()
  const projectDir = join(store.rootDir, 'projects', project.id)
  const backup = store.backupProject(project.id)

  const db2 = store.openProject(project.id)
  db2.segments.applyTargetEdit(segments[0]!.id, '备份后的新译文', 1, { status: 'draft' })
  db2.close()

  assert.throws(() => restoreProjectBackup(
    projectDir,
    backup.backupName,
    fixedNow,
    project.id,
    (point, relativePath) => {
      if (point === 'after-install-file' && relativePath === 'cat.db') {
        const error = new Error('injected install failure') as NodeJS.ErrnoException
        error.code = 'EIO'
        throw error
      }
    },
  ))
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
  const { projectDir, backup, sourceName } = makeBackedUpProject()
  // 删除当前 cat.db / source / blobs，模拟「新项目目录」恢复场景
  rmSync(join(projectDir, 'cat.db'))
  rmSync(join(projectDir, 'cat.db-wal'), { force: true })
  rmSync(join(projectDir, 'cat.db-shm'), { force: true })
  rmSync(join(projectDir, 'source'), { recursive: true, force: true })
  rmSync(join(projectDir, 'blobs'), { recursive: true, force: true })

  const result = restoreProjectBackup(
    projectDir,
    backup.backupName,
    '2026-02-01T00:00:00.000Z',
    JSON.parse(readFileSync(join(backup.backupDir, 'project.json'), 'utf8')).id as string,
  )
  assert.ok(result.preRestoreName.startsWith('pre-restore-'))
  assert.ok(existsSync(join(projectDir, 'cat.db')))
  assert.equal(readFileSync(join(projectDir, 'source', sourceName), 'utf8'), 'source-v1')
  assert.equal(readFileSync(join(projectDir, 'blobs', 'ctx-demo.md'), 'utf8'), 'blob-v1')
})

test('restore: process crash during installation is recovered from the durable journal on next open', () => {
  const { store, project, projectDir, backup, segmentId } = makeBackedUpProject()
  const changed = store.openProject(project.id)
  changed.segments.applyTargetEdit(segmentId, '崩溃前的当前译文', 1, { status: 'draft' })
  changed.close()

  const restoreUrl = pathToFileURL(join(dirname(fileURLToPath(import.meta.url)), 'restore.ts')).href
  const loader = join(dirname(fileURLToPath(import.meta.url)), '..', 'test', 'register-ts-loader.mjs')
  const crashed = spawnSync(process.execPath, [
    '--experimental-transform-types',
    '--import',
    loader,
    '--input-type=module',
    '--eval',
    `import { restoreProjectBackup } from ${JSON.stringify(restoreUrl)};
     restoreProjectBackup(
       ${JSON.stringify(projectDir)},
       ${JSON.stringify(backup.backupName)},
       '2026-06-01T00:00:00.000Z',
       ${JSON.stringify(project.id)},
       (point, path) => {
         if (point === 'after-install-file' && path === 'cat.db') process.exit(86)
       },
     );`,
  ])
  assert.equal(crashed.status, 86, crashed.stderr.toString())
  assert.ok(existsSync(join(projectDir, 'backups', RESTORE_TRANSACTION_FILE)))
  assert.ok(existsSync(join(projectDir, 'backups', 'pre-restore-2026-06-01T00-00-00-000Z')))

  assert.equal(readSegmentTarget(store, project.id, segmentId), '崩溃前的当前译文')
  assert.ok(!existsSync(join(projectDir, 'backups', RESTORE_TRANSACTION_FILE)))
  assert.ok(existsSync(join(projectDir, 'backups', 'pre-restore-2026-06-01T00-00-00-000Z')))
})

test('restore: rollback failure keeps both journal and safety snapshot for later recovery', () => {
  const { store, project, projectDir, backup, segmentId } = makeBackedUpProject()
  const changed = store.openProject(project.id)
  changed.segments.applyTargetEdit(segmentId, '回滚失败前的当前译文', 1, { status: 'draft' })
  changed.close()

  assert.throws(
    () => restoreProjectBackup(
      projectDir,
      backup.backupName,
      '2026-06-02T00:00:00.000Z',
      project.id,
      (point, path) => {
        if (point === 'after-install-file' && path === 'cat.db') throw new Error('install failed')
        if (point === 'before-rollback') throw new Error('rollback failed')
      },
    ),
    (error: unknown) => {
      assert.ok(error instanceof AggregateError)
      assert.match(error.message, /safety snapshot retained/)
      return true
    },
  )
  assert.ok(existsSync(join(projectDir, 'backups', RESTORE_TRANSACTION_FILE)))
  assert.ok(existsSync(join(projectDir, 'backups', 'pre-restore-2026-06-02T00-00-00-000Z')))

  // 下一次正常打开不带故障注入，按 journal 恢复并保留安全快照。
  assert.equal(readSegmentTarget(store, project.id, segmentId), '回滚失败前的当前译文')
  assert.ok(!existsSync(join(projectDir, 'backups', RESTORE_TRANSACTION_FILE)))
  assert.ok(existsSync(join(projectDir, 'backups', 'pre-restore-2026-06-02T00-00-00-000Z')))
})

test('open fails closed on a restore journal with a traversing snapshot name', () => {
  const store = new CatStore({ rootDir: makeTempDir(), entropy: makeEntropy('journal'), now: makeClock() })
  const project = store.createProject({
    name: 'Journal',
    sourceLocale: 'en',
    targetLocale: 'zh-CN',
    promaWorkspaceId: 'ws',
  })
  store.openProject(project.id).close()
  const projectDir = join(store.rootDir, 'projects', project.id)
  writeFileSync(join(projectDir, 'backups', RESTORE_TRANSACTION_FILE), JSON.stringify({
    version: 1,
    projectId: project.id,
    backupName: 'backup-2026-06-02T00-00-00-000Z',
    preRestoreName: 'pre-restore-../../outside',
    stamp: '../../outside',
  }))

  assert.throws(() => store.openProject(project.id), /journal is invalid/)
})

test('restore: Proposal and QA lineage survives and passes post-install validation', () => {
  const store = new CatStore({
    rootDir: makeTempDir(),
    entropy: makeEntropy('lineage'),
    now: makeClock(),
  })
  const project = store.createProject({
    name: 'Lineage',
    sourceLocale: 'en',
    targetLocale: 'zh-CN',
    promaWorkspaceId: 'ws',
  })
  const db = store.openProject(project.id)
  const sourceBytes = Buffer.from('lineage-source')
  const { asset, segments } = db.assets.insertImported(makeImportedAsset({
    segmentCount: 1,
    sourceSha256: sha256Hex(sourceBytes),
  }))
  db.saveAssetSource(asset.id, sourceBytes)
  const proposal = db.proposals.insertPending({
    segmentId: segments[0]!.id,
    baseRevision: 0,
    proposedTarget: '候选译文 0',
    runId: 'run-lineage',
    now: '2026-07-29T00:00:00.000Z',
  })
  const [qa] = db.qaFindings.replaceForSegment(segments[0]!.id, [{
    segmentId: segments[0]!.id,
    code: 'EMPTY_TARGET',
    severity: 'L1',
    message: 'empty',
    evidenceHash: 'lineage-evidence',
  }], {
    runId: 'qa-lineage',
    observedAt: '2026-07-29T00:00:01.000Z',
    ruleVersion: 'rules-v1',
  })
  db.close()
  const backup = store.backupProject(project.id)

  const changed = store.openProject(project.id)
  changed.catDb.db.exec('DELETE FROM qa_findings; DELETE FROM proposals')
  changed.close()
  store.restoreProject(project.id, backup.backupName)

  const restored = store.openProject(project.id, { readOnly: true })
  try {
    assert.equal(restored.proposals.getById(proposal.id)?.runId, 'run-lineage')
    assert.equal(restored.proposals.listIssuances(proposal.id).length, 1)
    assert.equal(restored.qaFindings.getById(qa!.id)?.firstSeenRunId, 'qa-lineage')
  } finally {
    restored.close()
  }
})

test('restore: project identity conflict is rejected before touching the current state', () => {
  const { store, project, backup, segmentId } = makeBackedUpProject()
  const changed = store.openProject(project.id)
  changed.segments.applyTargetEdit(segmentId, '身份冲突前的当前译文', 1, { status: 'draft' })
  changed.close()
  const manifest = readBackupManifest(backup.backupDir)!
  manifest.projectId = 'prj-fedcba9876543210'
  writeFileSync(join(backup.backupDir, 'manifest.json'), JSON.stringify(manifest))

  assert.throws(() => store.restoreProject(project.id, backup.backupName), StoreBackupCorruptError)
  assert.equal(readSegmentTarget(store, project.id, segmentId), '身份冲突前的当前译文')
})

test('restore: post-install validation failure rolls back instead of exposing bad bytes', () => {
  const { store, project, projectDir, backup, segmentId, sourceName } = makeBackedUpProject()
  const changed = store.openProject(project.id)
  changed.segments.applyTargetEdit(segmentId, '复验失败前的当前译文', 1, { status: 'draft' })
  changed.close()

  assert.throws(
    () => restoreProjectBackup(
      projectDir,
      backup.backupName,
      '2026-06-03T00:00:00.000Z',
      project.id,
      (point) => {
        if (point === 'before-post-verify') {
          writeFileSync(join(projectDir, 'source', sourceName), 'tampered-after-install')
        }
      },
    ),
    StoreBackupCorruptError,
  )
  assert.equal(readSegmentTarget(store, project.id, segmentId), '复验失败前的当前译文')
  assert.ok(!existsSync(join(projectDir, 'backups', RESTORE_TRANSACTION_FILE)))
})

test('restore: missing v13 Harness table rolls back after installation', () => {
  const { store, project, projectDir, backup, segmentId } = makeBackedUpProject()
  const changed = store.openProject(project.id)
  changed.segments.applyTargetEdit(segmentId, '复验不可用前的当前译文', 1, { status: 'draft' })
  changed.close()

  assert.throws(
    () => restoreProjectBackup(
      projectDir,
      backup.backupName,
      '2026-06-04T00:00:00.000Z',
      project.id,
      (point) => {
        if (point !== 'before-post-verify') return
        const DatabaseSync = loadDatabaseSync()
        const installed = new DatabaseSync(join(projectDir, 'cat.db'))
        try {
          installed.exec('DROP TABLE translation_jobs')
        } finally {
          installed.close()
        }
      },
    ),
    StoreBackupCorruptError,
  )
  assert.equal(readSegmentTarget(store, project.id, segmentId), '复验不可用前的当前译文')
  assert.ok(!existsSync(join(projectDir, 'backups', RESTORE_TRANSACTION_FILE)))
})
