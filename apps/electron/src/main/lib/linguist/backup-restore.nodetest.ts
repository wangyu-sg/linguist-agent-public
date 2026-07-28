/**
 * PB-111 备份 / 恢复服务层测试（node --test；bun 无 node:sqlite）。
 *
 * 覆盖票面：listBackups / previewRestore（verify + 摘要对比 + schema）/
 * restoreProject（pre-restore 快照 + 清缓存重开）/ 归档拒绝 /
 * backupName 目录穿越拒绝 / legacy 降级预览与恢复拒绝 / 损坏备份拒绝。
 * store 层的回滚与 verify 细节见 @linguist/cat-store 的 restore.nodetest.ts。
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { copyFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { SCHEMA_VERSION } from '@linguist/cat-store'
import {
  LinguistProjectArchivedError,
  LinguistProjectNotFoundError,
} from './errors'
import { INPUT, makeService, readFixture } from './test/service-testkit'
import type { LinguistProjectService } from './project-service'

/** 建项目 + 导入资产 + 备份。 */
async function makeBackedUpProject(service: LinguistProjectService) {
  const project = service.createProject(INPUT)
  await service.importAsset(project.id, { bytes: readFixture('mini_dialogue.csv'), filename: 'mini_dialogue.csv' })
  const backup = service.backupProject(project.id)
  return { project, backup }
}

test('listBackups: newest first with manifest summary; unknown project -> PROJECT_NOT_FOUND', async () => {
  const service = makeService()
  try {
    const { project } = await makeBackedUpProject(service)
    const entries = service.listBackups(project.id)
    assert.equal(entries.length, 1)
    assert.equal(entries[0]!.format, 'directory')
    assert.ok(entries[0]!.name.startsWith('backup-'))
    assert.equal(entries[0]!.schemaVersion, SCHEMA_VERSION)
    assert.equal(entries[0]!.method, 'vacuum_into')
    assert.ok((entries[0]!.fileCount ?? 0) >= 3)
    assert.ok(entries[0]!.sizeBytes > 0)
    assert.ok(entries[0]!.createdAt !== undefined)

    assert.throws(
      () => service.listBackups('prj-0000000000000000'),
      LinguistProjectNotFoundError,
    )
  } finally {
    service.closeAll()
  }
})

test('previewRestore: verify + backup vs current summary + schema fields', async () => {
  const service = makeService()
  try {
    const { project, backup } = await makeBackedUpProject(service)
    // 备份后再导入一个资产，预览必须体现「备份 vs 当前」差异
    await service.importAsset(project.id, { bytes: readFixture('mini_items.json'), filename: 'mini_items.json' })

    const preview = service.previewRestore(project.id, backup.backupName)
    assert.equal(preview.format, 'directory')
    assert.equal(preview.restorable, true)
    assert.equal(preview.verification?.ok, true)
    assert.equal(preview.backupSchemaVersion, SCHEMA_VERSION)
    assert.equal(preview.currentSchemaVersion, SCHEMA_VERSION)
    assert.equal(preview.willMigrate, false)
    // 备份 1 个资产 vs 当前 2 个资产（对比区数据源不同）
    assert.equal(preview.backupSummary?.assetCount, 1)
    assert.equal(preview.currentSummary?.assetCount, 2)
    assert.ok(
      (preview.backupSummary?.totalSegments ?? 0) < (preview.currentSummary?.totalSegments ?? 0),
    )
    assert.equal(preview.backupSummary?.assets.length, 1)
    assert.equal(preview.currentSummary?.assets.length, 2)
  } finally {
    service.closeAll()
  }
})

test('previewRestore: corrupted backup -> restorable=false with problems; traversal names rejected', async () => {
  const service = makeService()
  try {
    const { project, backup } = await makeBackedUpProject(service)
    // 篡改备份内文件（同长度字节 → sha256 mismatch）
    const absDir = join(service.rootDir, backup.backupDir)
    writeFileSync(join(absDir, 'project.json'), '{"corrupted": true}\n')

    const preview = service.previewRestore(project.id, backup.backupName)
    assert.equal(preview.restorable, false)
    assert.equal(preview.verification?.ok, false)
    assert.ok((preview.verification?.problems.length ?? 0) > 0)

    // 目录穿越 / 非法形状 → STORE_NOT_FOUND（服务层白名单）
    for (const bad of ['../projects.json', 'backup-<x>', 'pre-restore-2026-01-01T00-00-00-000Z', '']) {
      assert.throws(() => service.previewRestore(project.id, bad), /not found|backup/i)
    }
  } finally {
    service.closeAll()
  }
})

test('restoreProject: edit rolled back; pre-restore snapshot listed in report; handle cache refreshed', async () => {
  const service = makeService()
  try {
    const { project, backup } = await makeBackedUpProject(service)
    const segment = service.queryCatWorkspace(project.id, { limit: 1, offset: 0, includeIndex: false }).segments[0]!
    const edited = service.editSegment(project.id, segment.id, '备份后的译文', segment.revision)
    assert.equal(edited.target, '备份后的译文')

    const result = service.restoreProject(project.id, backup.backupName)
    assert.equal(result.backupName, backup.backupName)
    assert.ok(result.preRestoreName.startsWith('pre-restore-'))
    assert.equal(result.schemaVersion, SCHEMA_VERSION)

    // 缓存句柄已清并重开：读到的是备份态
    const after = service.queryCatWorkspace(project.id, { limit: 1, offset: 0, includeIndex: false }).segments[0]!
    assert.notEqual(after.target, '备份后的译文')

    // pre-restore 快照存在且含备份后的状态（不作为可恢复备份列出）
    const names = service.listBackups(project.id).map((b) => b.name)
    assert.deepEqual(names, [backup.backupName], 'pre-restore 快照不进备份列表')
  } finally {
    service.closeAll()
  }
})

test('restoreProject: archived project rejected (PROJECT_ARCHIVED); backup/preview still allowed', async () => {
  const service = makeService()
  try {
    const { project, backup } = await makeBackedUpProject(service)
    service.archiveProject(project.id)

    // 归档项目：备份 / 列表 / 预览仍可用
    const second = service.backupProject(project.id)
    assert.ok(second.backupName.startsWith('backup-'))
    assert.equal(service.listBackups(project.id).length, 2)
    const preview = service.previewRestore(project.id, backup.backupName)
    assert.equal(preview.restorable, true)

    // 恢复拒绝
    assert.throws(
      () => service.restoreProject(project.id, backup.backupName),
      LinguistProjectArchivedError,
    )
  } finally {
    service.closeAll()
  }
})

test('restoreProject: legacy backup refused (STORE_BACKUP_LEGACY) but preview degrades to DB-only summary', async () => {
  const service = makeService()
  try {
    const { project, backup } = await makeBackedUpProject(service)
    // 伪造 legacy 两文件备份（复制新格式备份的 cat.db）
    const legacyName = 'cat-2026-01-01T00-00-00-000Z.db'
    const absDir = join(service.rootDir, backup.backupDir)
    const { backupsDir } = service.getProjectPaths(project.id)
    copyFileSync(join(absDir, 'cat.db'), join(backupsDir, legacyName))

    const preview = service.previewRestore(project.id, legacyName)
    assert.equal(preview.format, 'legacy')
    assert.equal(preview.restorable, false)
    assert.equal(preview.verification, undefined, 'legacy 无 manifest，不出 verify 报告')
    assert.equal(preview.backupSummary?.assetCount, 1, 'legacy 降级仍可预览 DB 摘要')
    assert.ok(preview.notice?.includes('旧格式'))

    assert.throws(
      () => service.restoreProject(project.id, legacyName),
      (err: unknown) => (err as { code?: string }).code === 'STORE_BACKUP_LEGACY',
    )
  } finally {
    service.closeAll()
  }
})

test('restoreProject: corrupted backup refused (STORE_BACKUP_CORRUPT), current state untouched', async () => {
  const service = makeService()
  try {
    const { project, backup } = await makeBackedUpProject(service)
    const segment = service.queryCatWorkspace(project.id, { limit: 1, offset: 0, includeIndex: false }).segments[0]!
    service.editSegment(project.id, segment.id, '备份后的译文', segment.revision)

    const absDir = join(service.rootDir, backup.backupDir)
    writeFileSync(join(absDir, 'project.json'), '{"corrupted": true}\n')

    assert.throws(
      () => service.restoreProject(project.id, backup.backupName),
      (err: unknown) => (err as { code?: string }).code === 'STORE_BACKUP_CORRUPT',
    )
    const after = service.queryCatWorkspace(project.id, { limit: 1, offset: 0, includeIndex: false }).segments[0]!
    assert.equal(after.target, '备份后的译文', '拒绝恢复后当前状态必须原样')
  } finally {
    service.closeAll()
  }
})
