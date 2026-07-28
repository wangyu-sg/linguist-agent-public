/**
 * CatStore — facade over the project index (projects.json) and per-project
 * SQLite databases. The linguist root dir (plan §5.2: ~/.linguist-agent/linguist in
 * production) is ALWAYS injected via options; tests pass mkdtemp dirs.
 * Clock and entropy are injectable for deterministic ids/timestamps.
 */

import { existsSync } from 'node:fs'
import { join } from 'node:path'
import type {
  CreateProjectDeps,
  CreateProjectInput,
  EntropySource,
  LinguistProject,
} from '@linguist/cat-core'
import {
  createProjectBackup,
  LEGACY_BACKUP_FILE_PATTERN,
  listProjectBackups,
  resolveBackupPath,
  type ProjectBackupEntry,
  type ProjectBackupResult,
} from './backup'
import { StoreNotFoundError } from './errors'
import { restoreProjectBackup, type RestoreBackupResult } from './restore'
import { ProjectDatabase } from './project-database'
import { ProjectIndex, type RemovedProject } from './project-index'

export interface CatStoreOptions {
  /** Linguist root dir (e.g. ~/.linguist-agent/linguist). Required — never hardcoded. */
  rootDir: string
  /** Entropy for project id generation; inject for determinism. */
  entropy?: EntropySource
  /** Clock for timestamps (index, migrations, revisions, backups). */
  now?: () => string
}

export interface OpenProjectOptions {
  /** Open cat.db without write access; all writes throw StoreReadOnlyError. */
  readOnly?: boolean
}

export class CatStore {
  readonly rootDir: string
  readonly index: ProjectIndex
  private readonly entropy?: EntropySource
  private readonly now: () => string

  constructor(options: CatStoreOptions) {
    this.rootDir = options.rootDir
    this.now = options.now ?? (() => new Date().toISOString())
    if (options.entropy !== undefined) this.entropy = options.entropy
    this.index = new ProjectIndex(options.rootDir, { now: this.now })
  }

  listProjects(filter: { includeArchived?: boolean } = {}): LinguistProject[] {
    return this.index.list(filter)
  }

  createProject(input: CreateProjectInput, deps: CreateProjectDeps = {}): LinguistProject {
    return this.index.create(input, {
      ...deps,
      entropy: deps.entropy ?? this.entropy,
      now: deps.now ?? this.now(),
    })
  }

  getProject(projectId: string): LinguistProject {
    return this.index.get(projectId)
  }

  updateProject(
    projectId: string,
    patch: Parameters<ProjectIndex['update']>[1],
  ): LinguistProject {
    return this.index.update(projectId, patch)
  }

  archiveProject(projectId: string): LinguistProject {
    return this.index.archive(projectId)
  }

  /** 可恢复删除：完整项目目录移入数据根 trash/，并从项目索引移除。 */
  deleteProject(projectId: string): RemovedProject {
    return this.index.remove(projectId)
  }

  /**
   * Open a project's cat.db (created + migrated on first writable open).
   * Caller must close() the returned handle.
   */
  openProject(projectId: string, options: OpenProjectOptions = {}): ProjectDatabase {
    const project = this.index.get(projectId) // throws StoreNotFoundError
    const dbPath = this.index.projectDbPath(project.id)
    return ProjectDatabase.open(dbPath, {
      projectId: project.id,
      readOnly: options.readOnly ?? false,
      now: this.now,
    })
  }

  /**
   * Backup a project (PB-111, plan §24): full-project directory backup
   * backups/backup-<safeTs>/ — cat.db (VACUUM INTO / backup API) +
   * project.json + source/ + blobs/ + integrity manifest.
   */
  backupProject(projectId: string): ProjectBackupResult {
    const project = this.index.get(projectId)
    const projectDir = this.index.projectDir(project.id)
    if (!existsSync(this.index.projectDbPath(project.id))) {
      throw new StoreNotFoundError('cat database', this.index.projectDbPath(project.id))
    }
    const catDb = this.openProject(projectId).catDb
    try {
      return createProjectBackup(catDb, projectDir, this.now())
    } finally {
      catDb.close()
    }
  }

  /** List backups under the project's backups/ dir (newest first; read-only). */
  listProjectBackups(projectId: string): ProjectBackupEntry[] {
    const project = this.index.get(projectId)
    return listProjectBackups(this.index.projectDir(project.id))
  }

  /**
   * Open a backup's database read-only (new-format directory or legacy
   * two-file .db) for restore preview. Caller must close() the handle.
   */
  openBackupDatabase(projectId: string, backupName: string): ProjectDatabase {
    const project = this.index.get(projectId)
    const backupPath = resolveBackupPath(this.index.projectDir(project.id), backupName)
    const dbPath = LEGACY_BACKUP_FILE_PATTERN.test(backupName) ? backupPath : join(backupPath, 'cat.db')
    return ProjectDatabase.open(dbPath, {
      projectId: project.id,
      readOnly: true,
      now: this.now,
    })
  }

  /**
   * Restore a project from a new-format backup (whole replacement; the
   * current state is snapshotted to backups/pre-restore-<safeTs>/ first).
   * Caller discipline: every open handle of this project MUST be closed
   * before calling — the service layer closes its cached handle first.
   */
  restoreProject(projectId: string, backupName: string): RestoreBackupResult {
    const project = this.index.get(projectId)
    return restoreProjectBackup(this.index.projectDir(project.id), backupName, this.now())
  }
}
