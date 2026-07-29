/**
 * 项目备份：同目录 staging → 完整验证 → 原子 rename 发布。
 *
 * manifest v2 把 projectId 与内容摘要绑定；v1 仅为已有 Alpha 备份读取兼容，
 * 身份仍由摘要覆盖的 project.json 与调用方 expectedProjectId 共同验证。
 */

import {
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { sha256Hex } from '@linguist/cat-formats'
import { CatDatabase, LINGUIST_APPLICATION_ID } from './database'
import { StoreBackupCorruptError, StoreNotFoundError } from './errors'
import { getBlockingIntegrityProblems, scanProjectIntegrity } from './integrity'
import { hasCompleteDatabaseIdentity } from './integrity-managed-files'
import {
  readProjectManifestFile,
  type ProjectManifest,
} from './project-index'
import { probeSqliteRuntime } from './runtime'

export const BACKUP_DIR_NAME_PATTERN = /^backup-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z$/
export const LEGACY_BACKUP_FILE_PATTERN = /^cat-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z\.db$/
export const PRE_RESTORE_PREFIX = 'pre-restore-'

export type BackupFaultPoint = 'before-copy' | 'before-manifest' | 'before-publish'
export type BackupFaultInjector = (point: BackupFaultPoint, relativePath?: string) => void

export interface BackupManifestFile {
  path: string
  sha256: string
  sizeBytes: number
}

export interface BackupManifest {
  version: '1' | '2'
  /** v2 必有；v1 读取兼容时缺省。 */
  projectId?: string
  createdAt: string
  schemaVersion: number
  method: 'vacuum_into' | 'backup_api'
  files: BackupManifestFile[]
}

export interface ProjectBackupResult {
  backupDir: string
  backupName: string
  manifest: BackupManifest
  method: 'vacuum_into' | 'backup_api'
}

export interface BackupVerification {
  ok: boolean
  schemaVersion?: number
  problems: string[]
}

export interface ProjectBackupEntry {
  name: string
  format: 'directory' | 'legacy'
  createdAt?: string
  sizeBytes: number
  schemaVersion?: number
  method?: 'vacuum_into' | 'backup_api'
  fileCount?: number
}

let stagingCounter = 0

function sqlQuote(path: string): string {
  return `'${path.replace(/'/g, "''")}'`
}

function safeTimestamp(now: string): string {
  return now.replace(/[:.]/g, '-')
}

function sha256File(path: string): string {
  return sha256Hex(readFileSync(path))
}

function isInside(root: string, candidate: string): boolean {
  const rel = relative(resolve(root), resolve(candidate))
  return rel === '' || (!rel.startsWith(`..${sep}`) && rel !== '..' && !isAbsolute(rel))
}

function assertDirectoryNotSymlink(path: string, label: string): void {
  const stat = lstatSync(path, { throwIfNoEntry: false })
  if (stat === undefined) {
    mkdirSync(path, { recursive: true })
    return
  }
  if (stat.isSymbolicLink() || !stat.isDirectory()) {
    throw new Error(`${label} must be a directory and cannot be a symbolic link`)
  }
}

function copyRegularFile(
  source: string,
  destination: string,
  relativePath: string,
  fault?: BackupFaultInjector,
): void {
  const stat = lstatSync(source)
  if (stat.isSymbolicLink()) throw new Error(`backup source cannot contain a symbolic link: ${relativePath}`)
  if (!stat.isFile()) throw new Error(`backup source must be a regular file: ${relativePath}`)
  fault?.('before-copy', relativePath)
  mkdirSync(dirname(destination), { recursive: true })
  copyFileSync(source, destination)
}

function copyTreeIfPresent(
  source: string,
  destination: string,
  prefix: string,
  fault?: BackupFaultInjector,
): void {
  const stat = lstatSync(source, { throwIfNoEntry: false })
  if (stat === undefined) return
  if (stat.isSymbolicLink()) throw new Error(`backup source cannot contain a symbolic link: ${prefix}`)
  if (!stat.isDirectory()) throw new Error(`backup source must be a directory: ${prefix}`)
  mkdirSync(destination, { recursive: true })
  for (const name of readdirSync(source)) {
    const sourcePath = join(source, name)
    const destinationPath = join(destination, name)
    const rel = `${prefix}/${name}`
    const item = lstatSync(sourcePath)
    if (item.isSymbolicLink()) throw new Error(`backup source cannot contain a symbolic link: ${rel}`)
    if (item.isDirectory()) copyTreeIfPresent(sourcePath, destinationPath, rel, fault)
    else if (item.isFile()) copyRegularFile(sourcePath, destinationPath, rel, fault)
    else throw new Error(`backup source must contain only regular files: ${rel}`)
  }
}

function walkRegularFiles(
  root: string,
  prefix = '',
  problems?: string[],
): string[] {
  const files: string[] = []
  const rootStat = lstatSync(root, { throwIfNoEntry: false })
  if (rootStat === undefined) return files
  if (rootStat.isSymbolicLink() || !rootStat.isDirectory()) {
    problems?.push('backup root is not a regular directory')
    return files
  }
  for (const name of readdirSync(root)) {
    const path = join(root, name)
    const rel = prefix === '' ? name : `${prefix}/${name}`
    const stat = lstatSync(path)
    if (stat.isSymbolicLink()) problems?.push(`symbolic link: ${rel}`)
    else if (stat.isDirectory()) files.push(...walkRegularFiles(path, rel, problems))
    else if (stat.isFile()) files.push(rel)
    else problems?.push(`non-regular entry: ${rel}`)
  }
  return files
}

function readValidatedProjectManifest(projectJsonPath: string): ProjectManifest | undefined {
  try {
    const stat = lstatSync(projectJsonPath)
    if (stat.isSymbolicLink() || !stat.isFile()) return undefined
    return readProjectManifestFile(projectJsonPath)
  } catch {
    return undefined
  }
}

function isSafeManifestPath(path: string): boolean {
  return path !== 'manifest.json'
    && path.length > 0
    && !path.includes('\\')
    && !isAbsolute(path)
    && path.split('/').every((part) => part !== '' && part !== '.' && part !== '..')
}

export function createProjectBackup(
  catDb: CatDatabase,
  projectDir: string,
  now: string,
  fault?: BackupFaultInjector,
): ProjectBackupResult {
  const backupsDir = join(projectDir, 'backups')
  assertDirectoryNotSymlink(backupsDir, 'backups')
  const backupName = `backup-${safeTimestamp(now)}`
  const backupDir = join(backupsDir, backupName)
  if (lstatSync(backupDir, { throwIfNoEntry: false }) !== undefined) {
    throw new Error(`backup already exists: ${backupName}`)
  }
  const stagingDir = join(
    backupsDir,
    `.${backupName}.partial-${process.pid}-${stagingCounter++}`,
  )
  mkdirSync(stagingDir)

  try {
    const backupDbPath = join(stagingDir, 'cat.db')
    const probe = probeSqliteRuntime()
    let method: ProjectBackupResult['method']
    if (probe.hasBackupApi && catDb.db.backup) {
      const backup = catDb.db.backup(backupDbPath)
      if (backup instanceof Promise) {
        throw new Error('async DatabaseSync#backup is unsupported')
      }
      method = 'backup_api'
    } else {
      catDb.execWrite(`backup into ${backupDbPath}`, `VACUUM INTO ${sqlQuote(backupDbPath)}`)
      method = 'vacuum_into'
    }

    copyRegularFile(
      join(projectDir, 'project.json'),
      join(stagingDir, 'project.json'),
      'project.json',
      fault,
    )
    copyTreeIfPresent(join(projectDir, 'source'), join(stagingDir, 'source'), 'source', fault)
    copyTreeIfPresent(join(projectDir, 'blobs'), join(stagingDir, 'blobs'), 'blobs', fault)
    const projectManifest = readValidatedProjectManifest(join(stagingDir, 'project.json'))
    if (
      projectManifest === undefined
      || !hasCompleteDatabaseIdentity(
        projectManifest,
        LINGUIST_APPLICATION_ID,
        catDb.schemaVersion,
      )
    ) throw new Error('project.json has no valid database identity')
    const projectId = projectManifest.id
    const manifest: BackupManifest = {
      version: '2',
      projectId,
      createdAt: now,
      schemaVersion: catDb.schemaVersion,
      method,
      files: walkRegularFiles(stagingDir)
        .sort()
        .map((rel) => {
          const path = join(stagingDir, rel)
          return { path: rel, sha256: sha256File(path), sizeBytes: statSync(path).size }
        }),
    }
    fault?.('before-manifest')
    writeFileSync(
      join(stagingDir, 'manifest.json'),
      `${JSON.stringify(manifest, null, 2)}\n`,
      { encoding: 'utf8', flag: 'wx' },
    )

    const verification = verifyBackup(stagingDir, projectId)
    if (!verification.ok) {
      throw new StoreBackupCorruptError(backupName, verification.problems)
    }
    fault?.('before-publish')
    renameSync(stagingDir, backupDir)
    return { backupDir, backupName, manifest, method }
  } catch (error) {
    rmSync(stagingDir, { recursive: true, force: true })
    throw error
  }
}

export function readBackupManifest(backupDir: string): BackupManifest | undefined {
  const path = join(backupDir, 'manifest.json')
  try {
    const stat = lstatSync(path)
    if (stat.isSymbolicLink() || !stat.isFile()) return undefined
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as Partial<BackupManifest> | null
    if (
      typeof parsed !== 'object'
      || parsed === null
      || (parsed.version !== '1' && parsed.version !== '2')
      || (parsed.version === '2' && typeof parsed.projectId !== 'string')
      || typeof parsed.createdAt !== 'string'
      || typeof parsed.schemaVersion !== 'number'
      || !Number.isSafeInteger(parsed.schemaVersion)
      || (parsed.method !== 'vacuum_into' && parsed.method !== 'backup_api')
      || !Array.isArray(parsed.files)
      || parsed.files.some((file) =>
        typeof file !== 'object'
        || file === null
        || typeof file.path !== 'string'
        || typeof file.sha256 !== 'string'
        || !/^[0-9a-f]{64}$/.test(file.sha256)
        || typeof file.sizeBytes !== 'number'
        || !Number.isSafeInteger(file.sizeBytes)
        || file.sizeBytes < 0)
    ) return undefined
    return parsed as BackupManifest
  } catch {
    return undefined
  }
}

export function verifyBackup(
  backupDir: string,
  expectedProjectId?: string,
): BackupVerification {
  const problems: string[] = []
  const rootStat = lstatSync(backupDir, { throwIfNoEntry: false })
  if (rootStat === undefined || rootStat.isSymbolicLink() || !rootStat.isDirectory()) {
    return { ok: false, problems: ['backup root missing, symbolic, or not a directory'] }
  }
  const manifest = readBackupManifest(backupDir)
  if (manifest === undefined) return { ok: false, problems: ['manifest.json missing or invalid'] }

  const listed = new Set<string>()
  for (const file of manifest.files) {
    if (!isSafeManifestPath(file.path) || !isInside(backupDir, join(backupDir, file.path))) {
      problems.push(`invalid manifest path: ${file.path}`)
      continue
    }
    if (listed.has(file.path)) {
      problems.push(`duplicate manifest path: ${file.path}`)
      continue
    }
    listed.add(file.path)
    const path = join(backupDir, file.path)
    try {
      const stat = lstatSync(path)
      if (stat.isSymbolicLink() || !stat.isFile()) {
        problems.push(`non-regular file: ${file.path}`)
      } else if (stat.size !== file.sizeBytes) {
        problems.push(`size mismatch: ${file.path} (${stat.size} != ${file.sizeBytes})`)
      } else if (sha256File(path) !== file.sha256) {
        problems.push(`sha256 mismatch: ${file.path}`)
      }
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code ?? 'UNKNOWN'
      problems.push(code === 'ENOENT'
        ? `missing file: ${file.path}`
        : `unreadable file: ${file.path} (${code})`)
    }
  }
  const actual = walkRegularFiles(backupDir, '', problems)
  for (const path of actual) {
    if (path !== 'manifest.json' && !listed.has(path)) problems.push(`unlisted file: ${path}`)
  }

  const projectManifest = readValidatedProjectManifest(join(backupDir, 'project.json'))
  const projectId = projectManifest?.id
  if (projectId === undefined) problems.push('project.json missing or invalid projectId')
  if (manifest.projectId !== undefined && projectId !== undefined && manifest.projectId !== projectId) {
    problems.push('manifest projectId mismatch')
  }
  if (expectedProjectId !== undefined && projectId !== expectedProjectId) {
    problems.push('projectId mismatch')
  }
  if (expectedProjectId !== undefined && manifest.projectId !== undefined && manifest.projectId !== expectedProjectId) {
    problems.push('manifest projectId mismatch')
  }
  if (manifest.version === '2' && projectManifest !== undefined) {
    if (!hasCompleteDatabaseIdentity(
      projectManifest,
      LINGUIST_APPLICATION_ID,
      manifest.schemaVersion,
    )) problems.push('project.json databaseIdentity mismatch')
  }

  let schemaVersion: number | undefined
  if (
    projectId !== undefined
    && !problems.some((problem) => problem.includes('cat.db') || problem.includes('project.json'))
  ) {
    const integrity = scanProjectIntegrity({
      projectDir: backupDir,
      expectedProjectId: expectedProjectId ?? projectId,
      databasePragma: 'quick_check',
      allowOlderSchema: true,
      includeExportManifests: false,
    })
    schemaVersion = integrity.schemaVersion
    problems.push(...getBlockingIntegrityProblems(integrity).map((problem) => `integrity: ${problem}`))
    if (schemaVersion !== undefined && manifest.schemaVersion !== schemaVersion) {
      problems.push(`manifest schemaVersion mismatch (${manifest.schemaVersion} != ${schemaVersion})`)
    }
  }
  return {
    ok: problems.length === 0,
    ...(schemaVersion === undefined ? {} : { schemaVersion }),
    problems,
  }
}

export function listProjectBackups(projectDir: string): ProjectBackupEntry[] {
  const backupsDir = join(projectDir, 'backups')
  const root = lstatSync(backupsDir, { throwIfNoEntry: false })
  if (root === undefined || root.isSymbolicLink() || !root.isDirectory()) return []
  const entries: ProjectBackupEntry[] = []
  for (const item of readdirSync(backupsDir, { withFileTypes: true })) {
    const path = join(backupsDir, item.name)
    if (item.isDirectory() && BACKUP_DIR_NAME_PATTERN.test(item.name)) {
      const manifest = readBackupManifest(path)
      const files = walkRegularFiles(path)
      const sizeBytes = files.reduce((sum, rel) => {
        try {
          return sum + statSync(join(path, rel)).size
        } catch {
          return sum
        }
      }, 0)
      entries.push({
        name: item.name,
        format: 'directory',
        sizeBytes,
        ...(manifest === undefined
          ? {}
          : {
              createdAt: manifest.createdAt,
              schemaVersion: manifest.schemaVersion,
              method: manifest.method,
              fileCount: manifest.files.length,
            }),
      })
    } else if (item.isFile() && LEGACY_BACKUP_FILE_PATTERN.test(item.name)) {
      entries.push({ name: item.name, format: 'legacy', sizeBytes: statSync(path).size })
    }
  }
  entries.sort((left, right) => {
    const timestamp = (name: string): string =>
      /\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z/.exec(name)?.[0] ?? name
    const a = timestamp(left.name)
    const b = timestamp(right.name)
    return a < b ? 1 : a > b ? -1 : left.name < right.name ? 1 : -1
  })
  return entries
}

export function resolveBackupPath(projectDir: string, backupName: string): string {
  if (!BACKUP_DIR_NAME_PATTERN.test(backupName) && !LEGACY_BACKUP_FILE_PATTERN.test(backupName)) {
    throw new StoreNotFoundError('backup', backupName)
  }
  const path = join(projectDir, 'backups', backupName)
  if (!existsSync(path)) throw new StoreNotFoundError('backup', backupName)
  return path
}
