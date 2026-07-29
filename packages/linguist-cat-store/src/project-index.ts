/**
 * Project index + on-disk project layout (plan §5.2):
 *
 *   <linguistRoot>/
 *   ├─ projects.json                 (project index, this module)
 *   └─ projects/<project-id>/
 *      ├─ project.json               (LinguistProject metadata)
 *      ├─ cat.db                     (SQLite, see database.ts)
 *      ├─ source/ blobs/ exports/ backups/
 *
 * The linguist root dir is ALWAYS injected (constructor parameter) — never
 * hardcoded. projects.json writes are atomic (tmp file + rename in the
 * same directory). A corrupt index throws StoreIndexCorruptError with a
 * clear message; the store never guesses or silently resets it.
 */

import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  archiveProject as coreArchiveProject,
  createProject as coreCreateProject,
  normalizeGlossaryPolicy,
  normalizeQaProfile,
  normalizeQualityProfile,
  normalizeTagProfile,
  normalizeWorkflowStage,
  type CreateProjectDeps,
  type CreateProjectInput,
  type LinguistProject,
  type LinguistQualityProfile,
  type ProjectId,
  type QaProfile,
  type WorkflowOutputStatusPolicy,
  type WorkflowStage,
} from '@linguist/cat-core'
import {
  StoreDatabaseIdentityError,
  StoreIndexCorruptError,
  StoreNotFoundError,
  StoreProjectExistsError,
} from './errors'

/** Subdirectories scaffolded inside every project dir (plan §5.2). */
export const PROJECT_SUBDIRS = ['source', 'blobs', 'exports', 'backups'] as const

const INDEX_SCHEMA_VERSION = 1

interface ProjectIndexFile {
  schemaVersion: typeof INDEX_SCHEMA_VERSION
  projects: LinguistProject[]
}

export interface ProjectIndexOptions {
  /** Injected clock; defaults to wall time. */
  now?: () => string
  /** Calling application version; injected by the host, never read from Electron here. */
  applicationVersion?: string
}

export interface MainDatabaseSnapshot {
  /** This is a point-in-time digest of cat.db after a FULL WAL checkpoint, not live integrity state. */
  state: 'post-migration-checkpoint'
  sizeBytes: number
  sha256: string
  measuredAt: string
}

export interface ProjectDatabaseIdentity {
  version: 1
  projectId: string
  createdByVersion: string
  applicationId?: number
  schemaVersion?: number
  lastMigratedByVersion?: string
  mainFileSnapshot?: MainDatabaseSnapshot
  [key: string]: unknown
}

export interface ProjectManifest extends LinguistProject {
  databaseIdentity?: ProjectDatabaseIdentity
  [key: string]: unknown
}

export interface RemovedProject {
  project: LinguistProject
  /** 数据根 trash/ 下的可恢复目录名；原目录已缺失时不提供。 */
  recoveryName?: string
}

export interface SetWorkflowConfigInput {
  workflowStage: WorkflowStage
  qaProfile?: QaProfile
  /** null 表示恢复格式适配器默认映射。 */
  outputStatusPolicy?: WorkflowOutputStatusPolicy | null
}

export class ProjectIndex {
  readonly rootDir: string
  private readonly now: () => string
  private readonly applicationVersion: string

  constructor(rootDir: string, options: ProjectIndexOptions = {}) {
    this.rootDir = rootDir
    this.now = options.now ?? (() => new Date().toISOString())
    this.applicationVersion = options.applicationVersion ?? 'unknown'
  }

  get indexPath(): string {
    return join(this.rootDir, 'projects.json')
  }

  projectDir(projectId: string): string {
    return join(this.rootDir, 'projects', projectId)
  }

  projectMetaPath(projectId: string): string {
    return join(this.projectDir(projectId), 'project.json')
  }

  projectDbPath(projectId: string): string {
    return join(this.projectDir(projectId), 'cat.db')
  }

  /** List projects; archived ones are excluded unless asked for. */
  list(filter: { includeArchived?: boolean } = {}): LinguistProject[] {
    const projects = this.readIndex().projects
    return filter.includeArchived ? projects : projects.filter((p) => p.archivedAt === undefined)
  }

  get(projectId: string): LinguistProject {
    const project = this.readIndex().projects.find((p) => p.id === projectId)
    if (!project) throw new StoreNotFoundError('project', projectId)
    return project
  }

  /**
   * Create a project: domain object via cat-core, index entry, project dir
   * scaffold (source/blobs/exports/backups), project.json metadata.
   */
  create(input: CreateProjectInput, deps: CreateProjectDeps = {}): LinguistProject {
    const project = coreCreateProject(input, { ...deps, now: deps.now ?? this.now() })
    const index = this.readIndex()
    if (index.projects.some((p) => p.id === project.id)) {
      throw new StoreProjectExistsError(project.id)
    }
    const dir = this.projectDir(project.id)
    mkdirSync(dir, { recursive: true })
    for (const sub of PROJECT_SUBDIRS) {
      mkdirSync(join(dir, sub), { recursive: true })
    }
    this.writeProjectMeta(project, {
      databaseIdentity: {
        version: 1,
        projectId: project.id,
        createdByVersion: this.applicationVersion,
      },
    })
    index.projects.push(project)
    this.writeIndex(index)
    return project
  }

  /** Patch mutable metadata fields; bumps updatedAt. */
  update(
    projectId: string,
    patch: Partial<Pick<LinguistProject, 'name' | 'sourceLocale' | 'targetLocale' | 'promaWorkspaceId'>>,
  ): LinguistProject {
    const index = this.readIndex()
    const i = index.projects.findIndex((p) => p.id === projectId)
    const current = index.projects[i]
    if (!current) throw new StoreNotFoundError('project', projectId)
    const updated: LinguistProject = { ...current, ...patch, updatedAt: this.now() }
    index.projects[i] = updated
    this.writeIndex(index)
    this.writeProjectMeta(updated)
    return updated
  }

  /**
   * Set the quality strategy tier (PB-082, plan §21). Dedicated write path
   * (not part of `update`'s patch whitelist); bumps updatedAt and rewrites
   * both projects.json and project.json. The value is normalized defensively
   * even though callers already pass the closed union. Archived rejection
   * lives in the service layer (LinguistProjectArchivedError) — the store
   * has no archived concept in its error catalog, same as `update`.
   */
  setQualityProfile(projectId: string, profile: LinguistQualityProfile): LinguistProject {
    const index = this.readIndex()
    const i = index.projects.findIndex((p) => p.id === projectId)
    const current = index.projects[i]
    if (!current) throw new StoreNotFoundError('project', projectId)
    const updated: LinguistProject = {
      ...current,
      qualityProfile: normalizeQualityProfile(profile),
      updatedAt: this.now(),
    }
    index.projects[i] = updated
    this.writeIndex(index)
    this.writeProjectMeta(updated)
    return updated
  }

  /** 更新当前任务阶段及可选的格式原生状态覆盖策略。 */
  setWorkflowConfig(projectId: string, input: SetWorkflowConfigInput): LinguistProject {
    const index = this.readIndex()
    const i = index.projects.findIndex((project) => project.id === projectId)
    const current = index.projects[i]
    if (!current) throw new StoreNotFoundError('project', projectId)
    const updated: LinguistProject = {
      ...current,
      workflowStage: normalizeWorkflowStage(input.workflowStage),
      ...(input.qaProfile !== undefined
        ? { qaProfile: normalizeQaProfile(input.qaProfile) }
        : {}),
      updatedAt: this.now(),
    }
    if (input.outputStatusPolicy === null) delete updated.outputStatusPolicy
    else if (input.outputStatusPolicy !== undefined) {
      updated.outputStatusPolicy = input.outputStatusPolicy
    }
    index.projects[i] = updated
    this.writeIndex(index)
    this.writeProjectMeta(updated)
    return updated
  }

  /** Archive (metadata-only, per cat-core). */
  archive(projectId: ProjectId | string): LinguistProject {
    const index = this.readIndex()
    const i = index.projects.findIndex((p) => p.id === projectId)
    const current = index.projects[i]
    if (!current) throw new StoreNotFoundError('project', projectId)
    const archived = coreArchiveProject(current, this.now())
    index.projects[i] = archived
    this.writeIndex(index)
    this.writeProjectMeta(archived)
    return archived
  }

  /**
   * 从索引移除项目，并把完整目录移动到数据根 trash/。
   *
   * 调用方负责先执行产品级归档/确认闸门。目录先原子移动，索引写失败时
   * 立即移回，避免留下「索引仍在、项目目录消失」的半删除状态。
   */
  remove(projectId: ProjectId | string): RemovedProject {
    const index = this.readIndex()
    const i = index.projects.findIndex((project) => project.id === projectId)
    const project = index.projects[i]
    if (!project) throw new StoreNotFoundError('project', projectId)

    const projectDir = this.projectDir(project.id)
    let recoveryName: string | undefined
    let recoveryDir: string | undefined
    if (existsSync(projectDir)) {
      const trashDir = join(this.rootDir, 'trash')
      mkdirSync(trashDir, { recursive: true })
      const timestamp = this.now().replace(/[^0-9A-Za-z.-]/g, '-')
      const baseName = `${project.id}-${timestamp}`
      recoveryName = baseName
      let suffix = 2
      while (existsSync(join(trashDir, recoveryName))) {
        recoveryName = `${baseName}-${suffix++}`
      }
      recoveryDir = join(trashDir, recoveryName)
      renameSync(projectDir, recoveryDir)
    }

    index.projects.splice(i, 1)
    try {
      this.writeIndex(index)
    } catch (error) {
      if (recoveryDir !== undefined) renameSync(recoveryDir, projectDir)
      throw error
    }
    return {
      project,
      ...(recoveryName !== undefined ? { recoveryName } : {}),
    }
  }

  /** Read project.json metadata from a project dir. */
  readProjectMeta(projectId: string): LinguistProject {
    const { databaseIdentity: _databaseIdentity, ...project } = this.readProjectManifest(projectId)
    return project
  }

  readProjectManifest(projectId: string): ProjectManifest {
    const path = this.projectMetaPath(projectId)
    if (!existsSync(path)) throw new StoreNotFoundError('project metadata', path)
    return readProjectManifestFile(path)
  }

  recordDatabaseIdentity(
    projectId: string,
    input: {
      applicationId: number
      schemaVersion: number
      migrated: boolean
    },
  ): ProjectManifest {
    const manifest = this.readProjectManifest(projectId)
    const dbPath = this.projectDbPath(projectId)
    const bytes = readFileSync(dbPath)
    const previous = manifest.databaseIdentity
    const databaseIdentity: ProjectDatabaseIdentity = {
      ...previous,
      version: 1,
      projectId,
      createdByVersion: previous?.createdByVersion ?? 'unknown',
      applicationId: input.applicationId,
      schemaVersion: input.schemaVersion,
      lastMigratedByVersion: input.migrated
        ? this.applicationVersion
        : previous?.lastMigratedByVersion ?? 'unknown',
      mainFileSnapshot: {
        state: 'post-migration-checkpoint',
        sizeBytes: bytes.byteLength,
        sha256: createHash('sha256').update(bytes).digest('hex'),
        measuredAt: this.now(),
      },
    }
    const updated = { ...manifest, databaseIdentity }
    atomicWriteJson(this.projectMetaPath(projectId), updated)
    return updated
  }

  private writeProjectMeta(
    project: LinguistProject,
    extension: Partial<ProjectManifest> = {},
  ): void {
    const path = this.projectMetaPath(project.id)
    const existing = existsSync(path) ? readProjectManifestFile(path) : undefined
    atomicWriteJson(path, { ...existing, ...extension, ...project })
  }

  private readIndex(): ProjectIndexFile {
    if (!existsSync(this.indexPath)) {
      return { schemaVersion: INDEX_SCHEMA_VERSION, projects: [] }
    }
    let parsed: unknown
    try {
      parsed = JSON.parse(readFileSync(this.indexPath, 'utf8'))
    } catch (err) {
      throw new StoreIndexCorruptError(this.indexPath, err instanceof Error ? err.message : String(err))
    }
    if (
      typeof parsed !== 'object' ||
      parsed === null ||
      (parsed as { schemaVersion?: unknown }).schemaVersion !== INDEX_SCHEMA_VERSION ||
      !Array.isArray((parsed as { projects?: unknown }).projects)
    ) {
      throw new StoreIndexCorruptError(
        this.indexPath,
        `expected { schemaVersion: ${INDEX_SCHEMA_VERSION}, projects: [...] }`,
      )
    }
    const file = parsed as ProjectIndexFile
    for (const project of file.projects) {
      assertValidProject(project, this.indexPath)
      normalizeProjectQualityProfile(project)
    }
    return file
  }

  private writeIndex(index: ProjectIndexFile): void {
    mkdirSync(this.rootDir, { recursive: true })
    atomicWriteJson(this.indexPath, index)
  }
}

export function readProjectManifestFile(filePath: string): ProjectManifest {
  let parsed: unknown
  try {
    parsed = JSON.parse(readFileSync(filePath, 'utf8'))
  } catch (err) {
    throw new StoreIndexCorruptError(filePath, err instanceof Error ? err.message : String(err))
  }
  assertValidProject(parsed, filePath)
  assertValidDatabaseIdentity(parsed.databaseIdentity, parsed.id, filePath)
  normalizeProjectQualityProfile(parsed)
  return parsed
}

function assertValidProject(value: unknown, filePath: string): asserts value is ProjectManifest {
  const p = value as Partial<LinguistProject> | null
  if (
    typeof p !== 'object' ||
    p === null ||
    p.schemaVersion !== 1 ||
    typeof p.id !== 'string' ||
    typeof p.name !== 'string' ||
    typeof p.sourceLocale !== 'string' ||
    typeof p.targetLocale !== 'string' ||
    typeof p.promaWorkspaceId !== 'string' ||
    typeof p.createdAt !== 'string' ||
    typeof p.updatedAt !== 'string'
  ) {
    throw new StoreIndexCorruptError(filePath, `invalid project entry: ${JSON.stringify(value)}`)
  }
}

function assertValidDatabaseIdentity(
  value: unknown,
  projectId: string,
  filePath: string,
): asserts value is ProjectDatabaseIdentity | undefined {
  if (value === undefined) return
  const identity = value as Partial<ProjectDatabaseIdentity> | null
  if (
    typeof identity !== 'object'
    || identity === null
    || identity.version !== 1
    || typeof identity.createdByVersion !== 'string'
    || identity.createdByVersion.length === 0
  ) {
    throw new StoreIndexCorruptError(filePath, 'invalid databaseIdentity')
  }
  if (identity.projectId !== projectId) {
    throw new StoreDatabaseIdentityError(
      filePath,
      `manifest project id ${projectId} does not match databaseIdentity ${String(identity.projectId)}`,
    )
  }
}

/**
 * PB-082 forward compatibility: project.json files written before the
 * qualityProfile field existed must read as 'balanced', and unknown/invalid
 * stored values fall back instead of failing validation (the validator above
 * tolerates the field; this normalizes it in memory). Normalization is
 * read-path only — old files are never rewritten proactively.
 * PB-096：glossaryPolicy 同例（缺省/未知回落 'prefer'，不回写）。
 * PB-097：tagProfile 同例（缺省/非法回落 undefined = 仅内置族，不回写；
 * 非法族条目整条丢弃，见 cat-core tag-profile.ts）。
 */
function normalizeProjectQualityProfile(project: LinguistProject): void {
  project.qualityProfile = normalizeQualityProfile(project.qualityProfile)
  project.glossaryPolicy = normalizeGlossaryPolicy(project.glossaryPolicy)
  // 缺省/非法时移除键而非置 undefined：内存对象形状与无此键的旧项目一致
  // （deepStrictEqual 区分「键存在值为 undefined」与「键不存在」）。
  const tagProfile = normalizeTagProfile(project.tagProfile)
  if (tagProfile === undefined) delete project.tagProfile
  else project.tagProfile = tagProfile
  project.workflowStage = normalizeWorkflowStage(project.workflowStage)
  project.qaProfile = normalizeQaProfile(project.qaProfile)
}

let tmpCounter = 0

/** Atomic JSON write: tmp file in the same directory + rename. */
function atomicWriteJson(path: string, value: unknown): void {
  const tmp = `${path}.tmp-${process.pid}-${tmpCounter++}`
  writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
  renameSync(tmp, path)
}
