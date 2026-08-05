/**
 * 整体恢复：验证备份 → 原子安全快照 → 持久事务 journal → 安装 → 迁移后复验。
 * 进程若在安装中退出，下次 openProject 会先按 journal 自动回滚。
 */

import {
  copyFileSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { dirname, join } from 'node:path'
import type { ProjectId } from '@linguist/cat-core'
import {
  BACKUP_DIR_NAME_PATTERN,
  LEGACY_BACKUP_FILE_PATTERN,
  PRE_RESTORE_PREFIX,
  verifyBackup,
} from './backup'
import { LINGUIST_APPLICATION_ID } from './database'
import {
  StoreBackupCorruptError,
  StoreBackupLegacyError,
  StoreError,
  StoreNotFoundError,
} from './errors'
import { getBlockingIntegrityProblems, scanProjectIntegrity } from './integrity'
import { ProjectDatabase } from './project-database'
import { readProjectManifestFile } from './project-index'

export const RESTORE_TRANSACTION_FILE = '.restore-transaction.json'

export type RestoreFaultPoint =
  | 'before-install-file'
  | 'after-install-file'
  | 'before-install-directory'
  | 'after-install-directory'
  | 'before-post-verify'
  | 'before-rollback'

export type RestoreFaultInjector = (
  point: RestoreFaultPoint,
  relativePath?: string,
) => void

export interface RestoreBackupResult {
  backupName: string
  preRestoreName: string
}

interface RestoreJournal {
  version: 1
  projectId: string
  backupName: string
  preRestoreName: string
  stamp: string
}

type DatabaseIdentityRecorder = (input: {
  applicationId: number
  schemaVersion: number
  migrated: boolean
}) => void

const RESTORED_FILES = ['cat.db', 'project.json'] as const
const RESTORED_DIRS = ['source', 'blobs'] as const
let transactionCounter = 0

function safeTimestamp(now: string): string {
  return now.replace(/[:.]/g, '-')
}

function copyRegularFile(source: string, destination: string, label: string): void {
  const stat = lstatSync(source)
  if (stat.isSymbolicLink() || !stat.isFile()) {
    throw new Error(`${label} must be a regular file and cannot be a symbolic link`)
  }
  mkdirSync(dirname(destination), { recursive: true })
  copyFileSync(source, destination)
}

function copyDirectory(source: string, destination: string, label: string): void {
  const stat = lstatSync(source)
  if (stat.isSymbolicLink() || !stat.isDirectory()) {
    throw new Error(`${label} must be a directory and cannot be a symbolic link`)
  }
  mkdirSync(destination, { recursive: true })
  for (const name of readdirSync(source)) {
    const sourcePath = join(source, name)
    const destinationPath = join(destination, name)
    const item = lstatSync(sourcePath)
    if (item.isSymbolicLink()) throw new Error(`${label} cannot contain a symbolic link`)
    if (item.isDirectory()) copyDirectory(sourcePath, destinationPath, label)
    else if (item.isFile()) copyRegularFile(sourcePath, destinationPath, label)
    else throw new Error(`${label} must contain only regular files`)
  }
}

function writeJournal(path: string, journal: RestoreJournal): void {
  const tmp = `${path}.tmp-${process.pid}-${transactionCounter++}`
  writeFileSync(tmp, `${JSON.stringify(journal, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' })
  renameSync(tmp, path)
}

function readJournal(path: string, expectedProjectId: string): RestoreJournal | undefined {
  const stat = lstatSync(path, { throwIfNoEntry: false })
  if (stat === undefined) return undefined
  if (stat.isSymbolicLink() || !stat.isFile()) throw new Error('restore transaction journal is invalid')
  try {
    const value = JSON.parse(readFileSync(path, 'utf8')) as Partial<RestoreJournal>
    if (
      value.version !== 1
      || value.projectId !== expectedProjectId
      || typeof value.backupName !== 'string'
      || !BACKUP_DIR_NAME_PATTERN.test(value.backupName)
      || typeof value.preRestoreName !== 'string'
      || typeof value.stamp !== 'string'
      || !BACKUP_DIR_NAME_PATTERN.test(`backup-${value.stamp}`)
      || value.preRestoreName !== `${PRE_RESTORE_PREFIX}${value.stamp}`
    ) throw new Error('invalid')
    return value as RestoreJournal
  } catch {
    throw new Error('restore transaction journal is invalid')
  }
}

function snapshotCurrentState(projectDir: string, snapshotDir: string): void {
  const staging = `${snapshotDir}.partial-${process.pid}-${transactionCounter++}`
  if (lstatSync(snapshotDir, { throwIfNoEntry: false }) !== undefined) {
    throw new Error('pre-restore snapshot already exists')
  }
  mkdirSync(staging)
  try {
    for (const file of RESTORED_FILES) {
      const source = join(projectDir, file)
      if (lstatSync(source, { throwIfNoEntry: false }) !== undefined) {
        copyRegularFile(source, join(staging, file), file)
      }
    }
    for (const directory of RESTORED_DIRS) {
      const source = join(projectDir, directory)
      if (lstatSync(source, { throwIfNoEntry: false }) !== undefined) {
        copyDirectory(source, join(staging, directory), directory)
      }
    }
    renameSync(staging, snapshotDir)
  } catch (error) {
    rmSync(staging, { recursive: true, force: true })
    throw error
  }
}

function installFile(
  source: string,
  target: string,
  stamp: string,
  label: string,
  fault?: RestoreFaultInjector,
): void {
  fault?.('before-install-file', label)
  const staging = `${target}.restore-${stamp}`
  const aside = `${target}.old-${stamp}`
  rmSync(staging, { recursive: true, force: true })
  rmSync(aside, { recursive: true, force: true })
  copyRegularFile(source, staging, label)
  if (lstatSync(target, { throwIfNoEntry: false }) !== undefined) renameSync(target, aside)
  try {
    renameSync(staging, target)
  } catch (error) {
    if (
      lstatSync(aside, { throwIfNoEntry: false }) !== undefined
      && lstatSync(target, { throwIfNoEntry: false }) === undefined
    ) renameSync(aside, target)
    throw error
  }
  rmSync(aside, { force: true })
  fault?.('after-install-file', label)
}

function installDirectory(
  source: string,
  target: string,
  stamp: string,
  label: string,
  fault?: RestoreFaultInjector,
): void {
  fault?.('before-install-directory', label)
  const staging = `${target}.new-${stamp}`
  const aside = `${target}.old-${stamp}`
  rmSync(staging, { recursive: true, force: true })
  rmSync(aside, { recursive: true, force: true })
  if (lstatSync(target, { throwIfNoEntry: false }) !== undefined) renameSync(target, aside)
  try {
    if (lstatSync(source, { throwIfNoEntry: false }) !== undefined) {
      copyDirectory(source, staging, label)
      renameSync(staging, target)
    }
  } catch (error) {
    rmSync(staging, { recursive: true, force: true })
    if (
      lstatSync(aside, { throwIfNoEntry: false }) !== undefined
      && lstatSync(target, { throwIfNoEntry: false }) === undefined
    ) renameSync(aside, target)
    throw error
  }
  rmSync(aside, { recursive: true, force: true })
  fault?.('after-install-directory', label)
}

function cleanupInstallArtifacts(projectDir: string, stamp: string): void {
  for (const file of RESTORED_FILES) {
    rmSync(`${join(projectDir, file)}.restore-${stamp}`, { recursive: true, force: true })
    rmSync(`${join(projectDir, file)}.old-${stamp}`, { recursive: true, force: true })
  }
  for (const directory of RESTORED_DIRS) {
    rmSync(`${join(projectDir, directory)}.new-${stamp}`, { recursive: true, force: true })
    rmSync(`${join(projectDir, directory)}.old-${stamp}`, { recursive: true, force: true })
  }
}

function rollbackFromSnapshot(
  projectDir: string,
  snapshotDir: string,
  stamp: string,
  fault?: RestoreFaultInjector,
): void {
  fault?.('before-rollback')
  rmSync(join(projectDir, 'cat.db-wal'), { force: true })
  rmSync(join(projectDir, 'cat.db-shm'), { force: true })
  for (const file of RESTORED_FILES) {
    const source = join(snapshotDir, file)
    const target = join(projectDir, file)
    if (lstatSync(source, { throwIfNoEntry: false }) === undefined) rmSync(target, { force: true })
    else installFile(source, target, `${stamp}-rollback`, file)
  }
  for (const directory of RESTORED_DIRS) {
    const source = join(snapshotDir, directory)
    const target = join(projectDir, directory)
    rmSync(target, { recursive: true, force: true })
    if (lstatSync(source, { throwIfNoEntry: false }) !== undefined) {
      copyDirectory(source, target, directory)
    }
  }
  cleanupInstallArtifacts(projectDir, stamp)
  cleanupInstallArtifacts(projectDir, `${stamp}-rollback`)
}

function verifyInstalledProject(
  projectDir: string,
  expectedProjectId: string,
  now: string,
  recordDatabaseIdentity?: DatabaseIdentityRecorder,
): void {
  let project: ProjectDatabase | undefined
  try {
    const trustedManifest = readProjectManifestFile(join(projectDir, 'project.json'))
    project = ProjectDatabase.open(join(projectDir, 'cat.db'), {
      projectId: expectedProjectId as ProjectId,
      trustedManifest,
      now: () => now,
    })
    const checkpoint = project.catDb.db.prepare('PRAGMA wal_checkpoint(FULL)').get() as {
      busy: number
      log: number
      checkpointed: number
    }
    if (checkpoint.busy !== 0 || checkpoint.log !== checkpoint.checkpointed) {
      throw new Error('restored database checkpoint is busy')
    }
    if (recordDatabaseIdentity !== undefined) {
      recordDatabaseIdentity({
        applicationId: LINGUIST_APPLICATION_ID,
        schemaVersion: project.schemaVersion,
        migrated: project.catDb.identityChanged,
      })
    } else if (project.catDb.identityChanged) {
      throw new Error('restored database migration cannot record database identity')
    }
  } catch (error) {
    throw new StoreBackupCorruptError('installed project', [
      `database_identity/${error instanceof StoreError ? error.code : 'POST_VERIFY_FAILED'}`,
    ])
  } finally {
    project?.close()
  }
  const report = scanProjectIntegrity({
    projectDir,
    expectedProjectId,
    includeExportManifests: false,
  })
  const problems = getBlockingIntegrityProblems(report)
  if (problems.length > 0) throw new StoreBackupCorruptError('installed project', problems)
}

/**
 * 启动时恢复安装中崩溃：journal 与安全快照都保留到回滚成功后。
 * journal 损坏或回滚失败时 fail closed，不打开可能混合的 cat.db。
 */
export function recoverInterruptedRestore(
  projectDir: string,
  expectedProjectId: string,
  fault?: RestoreFaultInjector,
): boolean {
  const journalPath = join(projectDir, 'backups', RESTORE_TRANSACTION_FILE)
  const journal = readJournal(journalPath, expectedProjectId)
  if (journal === undefined) return false
  const snapshotDir = join(projectDir, 'backups', journal.preRestoreName)
  const snapshot = lstatSync(snapshotDir, { throwIfNoEntry: false })
  if (snapshot === undefined || snapshot.isSymbolicLink() || !snapshot.isDirectory()) {
    throw new Error('restore safety snapshot is missing or invalid')
  }
  rollbackFromSnapshot(projectDir, snapshotDir, journal.stamp, fault)
  rmSync(journalPath)
  return true
}

export function restoreProjectBackup(
  projectDir: string,
  backupName: string,
  now: string,
  expectedProjectId: string,
  fault?: RestoreFaultInjector,
  recordDatabaseIdentity?: DatabaseIdentityRecorder,
): RestoreBackupResult {
  recoverInterruptedRestore(projectDir, expectedProjectId)
  if (LEGACY_BACKUP_FILE_PATTERN.test(backupName)) throw new StoreBackupLegacyError(backupName)
  if (!BACKUP_DIR_NAME_PATTERN.test(backupName)) throw new StoreNotFoundError('backup', backupName)
  const backupDir = join(projectDir, 'backups', backupName)
  if (lstatSync(backupDir, { throwIfNoEntry: false }) === undefined) {
    throw new StoreNotFoundError('backup', backupName)
  }
  const verification = verifyBackup(backupDir, expectedProjectId)
  if (!verification.ok) throw new StoreBackupCorruptError(backupName, verification.problems)

  const stamp = safeTimestamp(now)
  const preRestoreName = `${PRE_RESTORE_PREFIX}${stamp}`
  const snapshotDir = join(projectDir, 'backups', preRestoreName)
  snapshotCurrentState(projectDir, snapshotDir)
  const journalPath = join(projectDir, 'backups', RESTORE_TRANSACTION_FILE)
  const journal: RestoreJournal = {
    version: 1,
    projectId: expectedProjectId,
    backupName,
    preRestoreName,
    stamp,
  }
  writeJournal(journalPath, journal)

  try {
    rmSync(join(projectDir, 'cat.db-wal'), { force: true })
    rmSync(join(projectDir, 'cat.db-shm'), { force: true })
    for (const file of RESTORED_FILES) {
      installFile(join(backupDir, file), join(projectDir, file), stamp, file, fault)
    }
    for (const directory of RESTORED_DIRS) {
      installDirectory(join(backupDir, directory), join(projectDir, directory), stamp, directory, fault)
    }
    fault?.('before-post-verify')
    verifyInstalledProject(projectDir, expectedProjectId, now, recordDatabaseIdentity)
    rmSync(journalPath)
    cleanupInstallArtifacts(projectDir, stamp)
    return { backupName, preRestoreName }
  } catch (installError) {
    try {
      rollbackFromSnapshot(projectDir, snapshotDir, stamp, fault)
      rmSync(journalPath)
    } catch (rollbackError) {
      throw new AggregateError(
        [installError, rollbackError],
        `Restore installation and rollback both failed; safety snapshot retained: ${preRestoreName}`,
      )
    }
    throw installError
  }
}
