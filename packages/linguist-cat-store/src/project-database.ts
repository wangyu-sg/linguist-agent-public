/**
 * ProjectDatabase — one open cat.db plus its repositories. Obtained via
 * CatStore.openProject(); close() when done. Read-only handles reject all
 * writes with StoreReadOnlyError before any SQL is attempted.
 */

import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type { Asset, ProjectId } from '@linguist/cat-core'
import { sha256Hex } from '@linguist/cat-formats'
import {
  assetSourceFileName,
  readAssetSourceFile,
  saveAssetSourceFile,
} from './asset-source'
import {
  CatDatabase,
  LINGUIST_APPLICATION_ID,
  type OpenCatDatabaseOptions,
} from './database'
import {
  StoreAssetSourceMismatchError,
  StoreDatabaseIdentityError,
  StoreNotFoundError,
} from './errors'
import { readProjectManifestFile, type ProjectManifest } from './project-index'
import { AssetsRepository } from './repositories/assets'
import { ContextDocsRepository } from './repositories/context-docs'
import { LegacyCriticArtifactsReader } from './legacy-compat/critic-artifacts-reader'
import { ExportsRepository } from './repositories/exports'
import { ProposalsRepository } from './repositories/proposals'
import { QaFindingsRepository } from './repositories/qa-findings'
import { ReferenceImportsRepository } from './repositories/reference-imports'
import { SegmentsRepository } from './repositories/segments'
import { SentencePatternsRepository } from './repositories/sentence-patterns'
import { StyleGuideRulesRepository } from './repositories/style-guide-rules'
import { TechConstraintsRepository } from './repositories/tech-constraints'
import { TermEntriesRepository } from './repositories/term-entries'
import { TmUnitsRepository } from './repositories/tm-units'
import { VoiceProfilesRepository } from './repositories/voice-profiles'
import { RunHarnessRepository } from './run-harness'

export interface ProjectDatabaseOptions extends Omit<
  OpenCatDatabaseOptions,
  'expectedProjectId' | 'expectedApplicationId' | 'expectedSchemaVersion'
> {
  projectId: ProjectId
  /** Host-read project.json identity; on-disk opens otherwise read the sibling manifest. */
  trustedManifest?: ProjectManifest
}

export class ProjectDatabase {
  readonly catDb: CatDatabase
  readonly projectId: ProjectId
  readonly assets: AssetsRepository
  readonly segments: SegmentsRepository
  readonly proposals: ProposalsRepository
  readonly qaFindings: QaFindingsRepository
  readonly exports: ExportsRepository
  readonly tmUnits: TmUnitsRepository
  readonly termEntries: TermEntriesRepository
  readonly referenceImports: ReferenceImportsRepository
  readonly legacyCriticArtifacts: LegacyCriticArtifactsReader
  readonly styleGuideRules: StyleGuideRulesRepository
  readonly sentencePatterns: SentencePatternsRepository
  readonly contextDocs: ContextDocsRepository
  readonly techConstraints: TechConstraintsRepository
  readonly voiceProfiles: VoiceProfilesRepository
  readonly runs: RunHarnessRepository

  private constructor(catDb: CatDatabase, projectId: ProjectId, now: () => string) {
    this.catDb = catDb
    this.projectId = projectId
    this.runs = new RunHarnessRepository(catDb, projectId, now)
    this.assets = new AssetsRepository(catDb, projectId, now)
    this.segments = new SegmentsRepository(catDb, this.runs)
    this.proposals = new ProposalsRepository(catDb)
    this.qaFindings = new QaFindingsRepository(catDb, now)
    this.exports = new ExportsRepository(catDb, projectId, now)
    this.tmUnits = new TmUnitsRepository(catDb, projectId, now, this.runs)
    this.termEntries = new TermEntriesRepository(catDb, projectId, now, this.runs)
    this.referenceImports = new ReferenceImportsRepository(catDb, projectId, now)
    this.legacyCriticArtifacts = new LegacyCriticArtifactsReader(catDb)
    this.styleGuideRules = new StyleGuideRulesRepository(catDb, projectId, now, this.runs)
    this.sentencePatterns = new SentencePatternsRepository(catDb, projectId, now)
    this.contextDocs = new ContextDocsRepository(catDb, projectId, now)
    this.techConstraints = new TechConstraintsRepository(catDb, projectId, now)
    this.voiceProfiles = new VoiceProfilesRepository(catDb, projectId, now)
  }

  static open(dbPath: string, options: ProjectDatabaseOptions): ProjectDatabase {
    const now = options.now ?? (() => new Date().toISOString())
    const {
      projectId,
      trustedManifest: suppliedManifest,
      ...databaseOptions
    } = options
    const trustedManifest = dbPath === ':memory:'
      ? undefined
      : suppliedManifest
        ?? readProjectManifestFile(join(dirname(dbPath), 'project.json'))
    if (trustedManifest !== undefined) {
      if (
        trustedManifest.id !== projectId
        || (
          trustedManifest.databaseIdentity !== undefined
          && trustedManifest.databaseIdentity.projectId !== projectId
        )
      ) {
        throw new StoreDatabaseIdentityError(
          dbPath,
          `requested project ${projectId} does not match trusted manifest ${trustedManifest.id}`,
        )
      }
      if (
        trustedManifest.databaseIdentity?.applicationId !== undefined
        && trustedManifest.databaseIdentity.applicationId !== LINGUIST_APPLICATION_ID
      ) {
        throw new StoreDatabaseIdentityError(
          dbPath,
          `manifest application_id ${trustedManifest.databaseIdentity.applicationId} is not Linguist`,
        )
      }
      const identity = trustedManifest.databaseIdentity
      if (
        !existsSync(dbPath)
        && (
          identity?.applicationId !== undefined
          || identity?.schemaVersion !== undefined
          || identity?.mainFileSnapshot !== undefined
        )
      ) {
        throw new StoreNotFoundError('cat database recorded by manifest', dbPath)
      }
    }
    const catDb = CatDatabase.open(dbPath, {
      ...databaseOptions,
      expectedProjectId: projectId,
      ...(trustedManifest?.databaseIdentity?.applicationId !== undefined
        ? { expectedApplicationId: trustedManifest.databaseIdentity.applicationId }
        : {}),
      ...(trustedManifest?.databaseIdentity?.schemaVersion !== undefined
        ? { expectedSchemaVersion: trustedManifest.databaseIdentity.schemaVersion }
        : {}),
    })
    return new ProjectDatabase(catDb, projectId, now)
  }

  get readOnly(): boolean {
    return this.catDb.readOnly
  }

  get schemaVersion(): number {
    return this.catDb.schemaVersion
  }

  /** Absolute path of the project source/ dir (plan §5.2 layout). */
  get sourceDir(): string {
    if (this.catDb.path === ':memory:') {
      throw new StoreNotFoundError('project source dir (in-memory database has no project dir)', this.catDb.path)
    }
    return join(dirname(this.catDb.path), 'source')
  }

  /** Absolute path of the project blobs/ dir（PB-095 项目资产字节落点）。 */
  get blobsDir(): string {
    if (this.catDb.path === ':memory:') {
      throw new StoreNotFoundError('project blobs dir (in-memory database has no project dir)', this.catDb.path)
    }
    return join(dirname(this.catDb.path), 'blobs')
  }

  /**
   * Persist an asset's original imported bytes under
   * source/<assetId><ext> (the export template of plan §6.3). The asset
   * row must already exist; the bytes must match its recorded
   * sourceSha256 (CAS anchor) — a mismatch throws
   * StoreAssetSourceMismatchError instead of writing. Atomic tmp+rename;
   * saving the same asset again overwrites idempotently. Returns the
   * project-dir-relative blob path.
   */
  saveAssetSource(assetId: string, bytes: Uint8Array): string {
    this.catDb.assertWritable(`save asset source ${assetId}`)
    const asset = this.assets.get(assetId)
    if (!asset) throw new StoreNotFoundError('asset', assetId)
    if (sha256Hex(bytes) !== asset.sourceSha256) {
      throw new StoreAssetSourceMismatchError(asset.id)
    }
    const fileName = assetSourceFileName(asset)
    saveAssetSourceFile(this.sourceDir, fileName, bytes)
    return `source/${fileName}`
  }

  /**
   * PB-110：导入路径专用的「先写 blob」变体——asset 行尚未插入时调用。
   * asset 由调用方经 createAsset 预先推导（id 内容寻址，与 insertImported
   * 的推导完全一致），因此无需读行即可获得 CAS anchor 与 blob 文件名；
   * sha256 校验照做，mismatch 抛 StoreAssetSourceMismatchError 且一字节
   * 不写。崩溃窗口只留孤儿 blob（健康检查不扫、重导入幂等覆盖），绝不
   * 留「asset 行在、source blob 缺」——后者是导出硬失败态。
   */
  saveAssetSourceForImport(asset: Asset, bytes: Uint8Array): string {
    this.catDb.assertWritable(`save asset source ${asset.id}`)
    if (sha256Hex(bytes) !== asset.sourceSha256) {
      throw new StoreAssetSourceMismatchError(asset.id)
    }
    const fileName = assetSourceFileName(asset)
    saveAssetSourceFile(this.sourceDir, fileName, bytes)
    return `source/${fileName}`
  }

  /**
   * Read an asset's source blob back (export template). Missing asset row
   * or missing blob -> StoreNotFoundError; bytes that no longer match the
   * recorded sourceSha256 -> StoreAssetSourceMismatchError.
   */
  readAssetSource(assetId: string): Uint8Array {
    const asset = this.assets.get(assetId)
    if (!asset) throw new StoreNotFoundError('asset', assetId)
    const bytes = readAssetSourceFile(this.sourceDir, assetSourceFileName(asset))
    if (sha256Hex(bytes) !== asset.sourceSha256) {
      throw new StoreAssetSourceMismatchError(asset.id)
    }
    return bytes
  }

  close(): void {
    this.catDb.close()
  }
}
