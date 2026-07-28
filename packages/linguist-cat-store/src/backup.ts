/**
 * Project backup / verify (plan §5.7 + §24, PB-111).
 *
 * A backup is a directory `backups/backup-<safeTs>/` containing:
 * - cat.db        — consistent SQLite copy (VACUUM INTO, or the backup API
 *                   on Node >= 23.4; see runtime.ts for the probe rationale);
 * - project.json  — project metadata copy;
 * - source/       — full copy of the asset source blobs (when present);
 * - blobs/        — full copy of the project asset blobs (when present);
 * - manifest.json — integrity manifest covering EVERY other file in the
 *                   directory: { version:'1', createdAt, schemaVersion,
 *                   method, files:[{path, sha256, sizeBytes}] }.
 *
 * verifyBackup re-checks every manifest entry (existence + size + sha256),
 * flags unlisted extra files, then opens cat.db read-only (fail closed:
 * missing schema_migrations → STORE_NOT_FOUND, newer schema →
 * STORE_SCHEMA_TOO_NEW) and runs PRAGMA quick_check. It returns a report
 * and never throws for corrupt content; restore turns a failed report
 * into StoreBackupCorruptError.
 *
 * Legacy pre-manifest backups (backups/cat-<ts>.db two-file layout from
 * PB-024) are detected by name shape: preview can still open them
 * read-only, restore is explicitly unsupported (StoreBackupLegacyError).
 */

import { cpSync, copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { sha256Hex } from '@linguist/cat-formats'
import { CatDatabase } from './database'
import { StoreError, StoreNotFoundError } from './errors'
import { probeSqliteRuntime } from './runtime'

/** New-format backup directory name: backup-<safeTimestamp>. */
export const BACKUP_DIR_NAME_PATTERN = /^backup-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z$/

/** Legacy pre-manifest backup file name: cat-<safeTimestamp>.db. */
export const LEGACY_BACKUP_FILE_PATTERN = /^cat-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z\.db$/

/** Pre-restore safety snapshot prefix (never restorable via the API). */
export const PRE_RESTORE_PREFIX = 'pre-restore-'

export interface BackupManifestFile {
  /** Path relative to the backup directory (POSIX separators). */
  path: string
  sha256: string
  sizeBytes: number
}

export interface BackupManifest {
  version: '1'
  createdAt: string
  /** schema_migrations MAX(version) of the backed-up database. */
  schemaVersion: number
  method: 'vacuum_into' | 'backup_api'
  files: BackupManifestFile[]
}

export interface ProjectBackupResult {
  /** Absolute path of the backup directory. */
  backupDir: string
  /** Backup directory basename (backup-<safeTs>). */
  backupName: string
  manifest: BackupManifest
  method: 'vacuum_into' | 'backup_api'
}

export interface BackupVerification {
  ok: boolean
  /** schema_migrations MAX(version) of the backup cat.db (when openable). */
  schemaVersion?: number
  /** Stable machine-oriented problem descriptions (codes / paths / counts). */
  problems: string[]
}

export interface ProjectBackupEntry {
  /** Backup directory / legacy file basename. */
  name: string
  format: 'directory' | 'legacy'
  /** manifest.createdAt (directory format, manifest parseable). */
  createdAt?: string
  sizeBytes: number
  schemaVersion?: number
  method?: 'vacuum_into' | 'backup_api'
  fileCount?: number
}

function sqlQuote(path: string): string {
  return `'${path.replace(/'/g, "''")}'`
}

/** Filesystem-safe timestamp: 2026-07-25T17-52-35-461Z */
function safeTimestamp(now: string): string {
  return now.replace(/[:.]/g, '-')
}

/** Recursively list files under dir, paths relative to dir (POSIX style). */
function walkFiles(dir: string, prefix = ''): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const rel = prefix === '' ? entry.name : `${prefix}/${entry.name}`
    const abs = join(dir, entry.name)
    if (entry.isDirectory()) out.push(...walkFiles(abs, rel))
    else if (entry.isFile()) out.push(rel)
  }
  return out
}

function sha256File(path: string): string {
  return sha256Hex(readFileSync(path))
}

/** Copy a directory tree when the source exists; no-op otherwise. */
function copyDirIfExists(src: string, dest: string): void {
  if (!existsSync(src)) return
  cpSync(src, dest, { recursive: true })
}

/**
 * Create a full-project backup under <projectDir>/backups/backup-<safeTs>/:
 * database copy (VACUUM INTO / backup API) + project.json + source/ +
 * blobs/ + integrity manifest. The caller holds the only handle discipline:
 * pass an open (writable) CatDatabase of the project; it stays open.
 */
export function createProjectBackup(
  catDb: CatDatabase,
  projectDir: string,
  now: string,
): ProjectBackupResult {
  const backupsDir = join(projectDir, 'backups')
  mkdirSync(backupsDir, { recursive: true })
  const backupName = `backup-${safeTimestamp(now)}`
  const backupDir = join(backupsDir, backupName)
  mkdirSync(backupDir, { recursive: true })

  const backupDbPath = join(backupDir, 'cat.db')
  const probe = probeSqliteRuntime()
  let method: ProjectBackupResult['method']
  if (probe.hasBackupApi && catDb.db.backup) {
    const result = catDb.db.backup(backupDbPath)
    if (result instanceof Promise) {
      throw new Error('async DatabaseSync#backup is not supported by this store; use Node with synchronous backup or VACUUM INTO')
    }
    method = 'backup_api'
  } else {
    // VACUUM INTO fails if the target exists — timestamps are injected, so
    // tests control uniqueness; wall-clock ms resolution is enough here.
    catDb.execWrite(`backup into ${backupDbPath}`, `VACUUM INTO ${sqlQuote(backupDbPath)}`)
    method = 'vacuum_into'
  }

  copyFileSync(join(projectDir, 'project.json'), join(backupDir, 'project.json'))
  copyDirIfExists(join(projectDir, 'source'), join(backupDir, 'source'))
  copyDirIfExists(join(projectDir, 'blobs'), join(backupDir, 'blobs'))

  const manifest: BackupManifest = {
    version: '1',
    createdAt: now,
    schemaVersion: catDb.schemaVersion,
    method,
    files: walkFiles(backupDir)
      .sort()
      .map((rel) => {
        const abs = join(backupDir, rel)
        return { path: rel, sha256: sha256File(abs), sizeBytes: statSync(abs).size }
      }),
  }
  writeFileSync(join(backupDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')
  return { backupDir, backupName, manifest, method }
}

/** Parse a backup manifest; undefined when missing/invalid shape. */
export function readBackupManifest(backupDir: string): BackupManifest | undefined {
  const path = join(backupDir, 'manifest.json')
  if (!existsSync(path)) return undefined
  let parsed: unknown
  try {
    parsed = JSON.parse(readFileSync(path, 'utf8'))
  } catch {
    return undefined
  }
  const m = parsed as Partial<BackupManifest> | null
  if (
    typeof m !== 'object' ||
    m === null ||
    m.version !== '1' ||
    typeof m.createdAt !== 'string' ||
    typeof m.schemaVersion !== 'number' ||
    (m.method !== 'vacuum_into' && m.method !== 'backup_api') ||
    !Array.isArray(m.files) ||
    m.files.some(
      (f) =>
        typeof f !== 'object' ||
        f === null ||
        typeof (f as BackupManifestFile).path !== 'string' ||
        typeof (f as BackupManifestFile).sha256 !== 'string' ||
        typeof (f as BackupManifestFile).sizeBytes !== 'number',
    )
  ) {
    return undefined
  }
  return parsed as BackupManifest
}

/**
 * Verify a new-format backup directory: manifest shape, per-file
 * existence/size/sha256, no unlisted extra files, cat.db opens read-only
 * (fail closed on newer schema) and PRAGMA quick_check passes. Never
 * throws for corrupt content — problems are reported; unexpected store
 * errors are folded into the report by stable code.
 */
export function verifyBackup(backupDir: string): BackupVerification {
  const problems: string[] = []
  const manifest = readBackupManifest(backupDir)
  if (manifest === undefined) {
    problems.push('manifest.json missing or invalid')
    return { ok: false, problems }
  }

  const listed = new Set(manifest.files.map((f) => f.path))
  for (const file of manifest.files) {
    const abs = join(backupDir, file.path)
    if (!existsSync(abs)) {
      problems.push(`missing file: ${file.path}`)
      continue
    }
    try {
      const size = statSync(abs).size
      if (size !== file.sizeBytes) {
        problems.push(`size mismatch: ${file.path} (${size} != ${file.sizeBytes})`)
        continue
      }
      if (sha256File(abs) !== file.sha256) {
        problems.push(`sha256 mismatch: ${file.path}`)
      }
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code ?? 'UNKNOWN'
      problems.push(`unreadable file: ${file.path} (${code})`)
    }
  }
  for (const actual of walkFiles(backupDir)) {
    if (actual === 'manifest.json') continue
    if (!listed.has(actual)) problems.push(`unlisted file: ${actual}`)
  }

  let schemaVersion: number | undefined
  if (!problems.some((p) => p.includes('cat.db'))) {
    let db: CatDatabase | undefined
    try {
      db = CatDatabase.open(join(backupDir, 'cat.db'), { readOnly: true })
      schemaVersion = db.schemaVersion
      const rows = db.db.prepare('PRAGMA quick_check').all() as Array<Record<string, unknown>>
      const allOk = rows.every((row) => Object.values(row)[0] === 'ok')
      if (!allOk) problems.push('PRAGMA quick_check failed')
    } catch (err) {
      const code = err instanceof StoreError ? err.code : 'UNKNOWN'
      problems.push(`cat.db not openable: ${code}`)
    } finally {
      try {
        db?.close()
      } catch {
        // close failure does not change the verdict
      }
    }
  }
  return { ok: problems.length === 0, ...(schemaVersion !== undefined ? { schemaVersion } : {}), problems }
}

/**
 * List backups under <projectDir>/backups: new-format directories (with
 * manifest summary when parseable) and legacy two-file .db backups.
 * pre-restore snapshots and stray files are skipped; newest first
 * (timestamp embedded in the name sorts lexicographically).
 */
export function listProjectBackups(projectDir: string): ProjectBackupEntry[] {
  const backupsDir = join(projectDir, 'backups')
  if (!existsSync(backupsDir)) return []
  const entries: ProjectBackupEntry[] = []
  for (const item of readdirSync(backupsDir, { withFileTypes: true })) {
    const abs = join(backupsDir, item.name)
    if (item.isDirectory() && BACKUP_DIR_NAME_PATTERN.test(item.name)) {
      const manifest = readBackupManifest(abs)
      const sizeBytes = walkFiles(abs).reduce((sum, rel) => sum + statSync(join(abs, rel)).size, 0)
      entries.push({
        name: item.name,
        format: 'directory',
        sizeBytes,
        ...(manifest !== undefined
          ? {
              createdAt: manifest.createdAt,
              schemaVersion: manifest.schemaVersion,
              method: manifest.method,
              fileCount: manifest.files.length,
            }
          : {}),
      })
    } else if (item.isFile() && LEGACY_BACKUP_FILE_PATTERN.test(item.name)) {
      entries.push({ name: item.name, format: 'legacy', sizeBytes: statSync(abs).size })
    }
  }
  entries.sort((a, b) => {
    // 名字内嵌同构时间戳（backup-/cat- 前缀不同，按时间戳段比较，最新在前）
    const ts = (name: string): string =>
      /\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z/.exec(name)?.[0] ?? name
    const ta = ts(a.name)
    const tb = ts(b.name)
    return ta < tb ? 1 : ta > tb ? -1 : a.name < b.name ? 1 : -1
  })
  return entries
}

/** Absolute path of a backup (directory or legacy file); name must be whitelisted. */
export function resolveBackupPath(projectDir: string, backupName: string): string {
  if (!BACKUP_DIR_NAME_PATTERN.test(backupName) && !LEGACY_BACKUP_FILE_PATTERN.test(backupName)) {
    throw new StoreNotFoundError('backup', backupName)
  }
  const abs = join(projectDir, 'backups', backupName)
  if (!existsSync(abs)) throw new StoreNotFoundError('backup', backupName)
  return abs
}
