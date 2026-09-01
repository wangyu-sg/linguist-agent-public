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
  LinguistWorkbookMappingProfile,
} from '@linguist/cat-core'
import {
  createProjectBackup,
  LEGACY_BACKUP_FILE_PATTERN,
  listProjectBackups,
  resolveBackupPath,
  type ProjectBackupEntry,
  type ProjectBackupResult,
} from './backup'
import {
  StoreBusyError,
  StoreDatabaseIdentityError,
  StoreNotFoundError,
} from './errors'
import {
  recoverInterruptedRestore,
  restoreProjectBackup,
  type RestoreBackupResult,
} from './restore'
import { LINGUIST_APPLICATION_ID } from './database'
import { SCHEMA_VERSION } from './schema'
import { ProjectDatabase } from './project-database'
import {
  ProjectIndex,
  readProjectManifestFile,
  type RemovedProject,
} from './project-index'

export interface CatStoreOptions {
  /** Linguist root dir (e.g. ~/.linguist-agent/linguist). Required — never hardcoded. */
  rootDir: string
  /** Entropy for project id generation; inject for determinism. */
  entropy?: EntropySource
  /** Clock for timestamps (index, migrations, revisions, backups). */
  now?: () => string
  /** Host application version recorded in project.json migration metadata. */
  applicationVersion?: string
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
    this.index = new ProjectIndex(options.rootDir, {
      now: this.now,
      applicationVersion: options.applicationVersion ?? 'unknown',
    })
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

  renameProject(projectId: string, name: string): LinguistProject {
    return this.index.rename(projectId, name)
  }

  setWorkbookMappings(
    projectId: string,
    profiles: readonly LinguistWorkbookMappingProfile[],
  ): LinguistProject {
    return this.index.setWorkbookMappings(projectId, profiles)
  }

  reorderActiveProjects(orderedProjectIds: readonly string[]): LinguistProject[] {
    return this.index.reorderActive(orderedProjectIds)
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
    recoverInterruptedRestore(this.index.projectDir(project.id), project.id)
    const trustedManifest = this.index.readProjectManifest(project.id)
    if (trustedManifest.id !== project.id) {
      throw new StoreDatabaseIdentityError(
        this.index.projectMetaPath(project.id),
        `directory/index project ${project.id} does not match manifest ${trustedManifest.id}`,
      )
    }
    const dbPath = this.index.projectDbPath(project.id)
    if (options.readOnly !== true && existsSync(dbPath)) {
      const inspected = ProjectDatabase.open(dbPath, {
        projectId: project.id,
        trustedManifest,
        readOnly: true,
        now: this.now,
      })
      try {
        if (inspected.schemaVersion < SCHEMA_VERSION) {
          // The backup is intentionally made from the read-only handle before
          // the writable open below is allowed to run migrations.
          createProjectBackup(
            inspected.catDb,
            this.index.projectDir(project.id),
            this.now(),
            { fromSchema: inspected.schemaVersion, toSchema: SCHEMA_VERSION },
          )
        }
      } finally {
        inspected.close()
      }
    }
    const handle = ProjectDatabase.open(dbPath, {
      projectId: project.id,
      trustedManifest,
      readOnly: options.readOnly ?? false,
      now: this.now,
    })
    if (handle.readOnly) return handle
    try {
      const checkpoint = handle.catDb.db.prepare('PRAGMA wal_checkpoint(FULL)').get() as {
        busy: number
        log: number
        checkpointed: number
      }
      if (checkpoint.busy !== 0 || checkpoint.log !== checkpoint.checkpointed) {
        throw new StoreBusyError('checkpoint database identity snapshot')
      }
      this.index.recordDatabaseIdentity(project.id, {
        applicationId: LINGUIST_APPLICATION_ID,
        schemaVersion: handle.schemaVersion,
        migrated: handle.catDb.identityChanged,
      })
      return handle
    } catch (error) {
      handle.close()
      throw error
    }
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
    const trustedManifest = LEGACY_BACKUP_FILE_PATTERN.test(backupName)
      ? stripDatabaseIdentity(this.index.readProjectManifest(project.id))
      : readProjectManifestFile(join(backupPath, 'project.json'))
    return ProjectDatabase.open(dbPath, {
      projectId: project.id,
      trustedManifest,
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
    return restoreProjectBackup(
      this.index.projectDir(project.id),
      backupName,
      this.now(),
      project.id,
      undefined,
      (input) => {
        this.index.recordDatabaseIdentity(project.id, input)
      },
    )
  }
}

function stripDatabaseIdentity(
  manifest: ReturnType<ProjectIndex['readProjectManifest']>,
): ReturnType<ProjectIndex['readProjectManifest']> {
  const { databaseIdentity: _databaseIdentity, ...project } = manifest
  return project
}
