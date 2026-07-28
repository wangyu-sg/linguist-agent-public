/**
 * Project restore (PB-111, plan §24): whole-replacement semantics.
 *
 * Flow (the CALLER must have closed every open handle of the project
 * first — the service layer does closeProject before invoking this):
 *
 *   a) verifyBackup(backupDir) must pass; any problem →
 *      StoreBackupCorruptError, nothing on disk is touched.
 *   b) Safety snapshot: current cat.db / project.json / source/ / blobs/
 *      are copied to backups/pre-restore-<safeTs>/ (whichever exist —
 *      a project whose cat.db was never created restores fine).
 *   c) The backup content replaces the project directory: files via
 *      tmp+rename in the same directory; source//blobs/ via
 *      "rename current aside → copy new into staging → rename staging
 *      into place → delete the aside copy" so a crash never leaves a
 *      half-copied tree at the live path.
 *   d) Any failure during (c) rolls the project directory back from the
 *      (b) snapshot, then rethrows. The pre-restore snapshot is kept in
 *      all cases (success included) for manual recovery / audit.
 *
 * Schema policy: restore only refuses backups NEWER than this build (the
 * read-only open inside verifyBackup fails closed). Older schemas are
 * fine — the first writable open after restore migrates automatically
 * (database.ts), which the service layer triggers right away.
 */

import { copyFileSync, cpSync, existsSync, mkdirSync, renameSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import {
  BACKUP_DIR_NAME_PATTERN,
  LEGACY_BACKUP_FILE_PATTERN,
  PRE_RESTORE_PREFIX,
  verifyBackup,
} from './backup'
import { StoreBackupCorruptError, StoreBackupLegacyError, StoreNotFoundError } from './errors'

export interface RestoreBackupResult {
  backupName: string
  /** Basename of the pre-restore safety snapshot (backups/pre-restore-<safeTs>). */
  preRestoreName: string
}

/** Filesystem-safe timestamp (same convention as backup.ts). */
function safeTimestamp(now: string): string {
  return now.replace(/[:.]/g, '-')
}

/** Atomic file install: copy to a tmp sibling, then rename over the target. */
function installFile(src: string, target: string, stamp: string): void {
  const tmp = `${target}.restore-${stamp}`
  copyFileSync(src, tmp)
  renameSync(tmp, target)
}

/**
 * Replace a directory wholesale with rollback-friendly steps:
 * current → `<name>.old-<stamp>` (aside), backup content staged at
 * `<name>.new-<stamp>`, staging renamed into place, aside deleted.
 * When the backup has no such directory the live one is removed (whole-
 * replacement semantics: the project must match the backup).
 */
function installDirectory(srcDir: string, targetDir: string, stamp: string): void {
  const aside = `${targetDir}.old-${stamp}`
  const staging = `${targetDir}.new-${stamp}`
  rmSync(aside, { recursive: true, force: true })
  rmSync(staging, { recursive: true, force: true })
  if (!existsSync(srcDir)) {
    rmSync(targetDir, { recursive: true, force: true })
    return
  }
  if (existsSync(targetDir)) renameSync(targetDir, aside)
  try {
    cpSync(srcDir, staging, { recursive: true })
    renameSync(staging, targetDir)
  } catch (err) {
    // Staging failed — put the aside copy back so the live path is whole.
    rmSync(staging, { recursive: true, force: true })
    if (existsSync(aside) && !existsSync(targetDir)) renameSync(aside, targetDir)
    throw err
  }
  rmSync(aside, { recursive: true, force: true })
}

const RESTORED_FILES = ['cat.db', 'project.json'] as const
const RESTORED_DIRS = ['source', 'blobs'] as const

/** Copy the current project state into the pre-restore snapshot dir. */
function snapshotCurrentState(projectDir: string, snapshotDir: string): void {
  mkdirSync(snapshotDir, { recursive: true })
  for (const file of RESTORED_FILES) {
    const src = join(projectDir, file)
    if (existsSync(src)) copyFileSync(src, join(snapshotDir, file))
  }
  for (const dir of RESTORED_DIRS) {
    const src = join(projectDir, dir)
    if (existsSync(src)) cpSync(src, join(snapshotDir, dir), { recursive: true })
  }
}

/** Roll the project directory back to the snapshot taken before restore. */
function rollbackFromSnapshot(projectDir: string, snapshotDir: string, stamp: string): void {
  for (const file of RESTORED_FILES) {
    const snapshotFile = join(snapshotDir, file)
    const target = join(projectDir, file)
    if (existsSync(snapshotFile)) installFile(snapshotFile, target, stamp)
    else rmSync(target, { force: true })
  }
  for (const dir of RESTORED_DIRS) {
    const snapshotDirPath = join(snapshotDir, dir)
    const target = join(projectDir, dir)
    rmSync(target, { recursive: true, force: true })
    if (existsSync(snapshotDirPath)) cpSync(snapshotDirPath, target, { recursive: true })
  }
  // Best-effort sweep of install leftovers (.old-/.new-/.restore- siblings).
  for (const file of RESTORED_FILES) {
    rmSync(`${join(projectDir, file)}.restore-${stamp}`, { recursive: true, force: true })
  }
  for (const dir of RESTORED_DIRS) {
    rmSync(`${join(projectDir, dir)}.old-${stamp}`, { recursive: true, force: true })
    rmSync(`${join(projectDir, dir)}.new-${stamp}`, { recursive: true, force: true })
  }
}

/**
 * Restore a project from a new-format backup directory (whole replacement).
 * Legacy pre-manifest backups are refused with StoreBackupLegacyError;
 * corrupt backups with StoreBackupCorruptError — in both cases nothing on
 * disk is touched. Caller's handle discipline: every open ProjectDatabase
 * handle of this project MUST be closed before calling.
 */
export function restoreProjectBackup(
  projectDir: string,
  backupName: string,
  now: string,
): RestoreBackupResult {
  if (LEGACY_BACKUP_FILE_PATTERN.test(backupName)) {
    throw new StoreBackupLegacyError(backupName)
  }
  if (!BACKUP_DIR_NAME_PATTERN.test(backupName)) {
    throw new StoreNotFoundError('backup', backupName)
  }
  const backupDir = join(projectDir, 'backups', backupName)
  if (!existsSync(backupDir)) throw new StoreNotFoundError('backup', backupName)

  // (a) verify — nothing is touched before this passes.
  const verification = verifyBackup(backupDir)
  if (!verification.ok) {
    throw new StoreBackupCorruptError(backupName, verification.problems)
  }

  // (b) pre-restore safety snapshot of the current state.
  const stamp = safeTimestamp(now)
  const preRestoreName = `${PRE_RESTORE_PREFIX}${stamp}`
  const snapshotDir = join(projectDir, 'backups', preRestoreName)
  snapshotCurrentState(projectDir, snapshotDir)

  // (c) wholesale replacement; (d) any failure rolls back from (b).
  try {
    for (const file of RESTORED_FILES) {
      installFile(join(backupDir, file), join(projectDir, file), stamp)
    }
    for (const dir of RESTORED_DIRS) {
      installDirectory(join(backupDir, dir), join(projectDir, dir), stamp)
    }
  } catch (err) {
    try {
      rollbackFromSnapshot(projectDir, snapshotDir, stamp)
    } catch {
      // Rollback itself failed — the pre-restore snapshot remains on disk
      // for manual recovery; the original error is the useful signal.
    }
    throw err
  }
  return { backupName, preRestoreName }
}
