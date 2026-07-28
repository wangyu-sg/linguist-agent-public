/**
 * @linguist/cat-store — per-project SQLite persistence (PB-024).
 *
 * Depends on @linguist/cat-core (domain) and @linguist/cat-formats
 * (ImportedCatAsset binding). Dependency direction: cat-core <- formats <-
 * store <- tools. Runs on node:sqlite in the Electron main process; bun
 * has no node:sqlite, so the test suite runs via the package `test` script
 * (node --test, see src/*.nodetest.ts).
 */

export {
  STORE_ERROR_CODES,
  StoreAssetSourceMismatchError,
  StoreBackupCorruptError,
  StoreBackupLegacyError,
  StoreBusyError,
  StoreError,
  StoreIndexCorruptError,
  StoreNotFoundError,
  StoreProjectExistsError,
  StoreReadOnlyError,
  StoreSchemaTooNewError,
  StoreSqliteUnavailableError,
  translateSqliteError,
  type StoreErrorCode,
} from './errors'

export {
  probeSqliteRuntime,
  type DatabaseSyncCtor,
  type SqliteDatabase,
  type SqliteRuntimeProbe,
  type SqliteStatement,
} from './runtime'

export { MIGRATIONS, SCHEMA_VERSION, type SchemaMigration } from './schema'

export {
  CatDatabase,
  type AppliedMigration,
  type OpenCatDatabaseOptions,
} from './database'

export { PROJECT_SUBDIRS, ProjectIndex, type ProjectIndexOptions } from './project-index'

export { assetSourceFileName } from './asset-source'

export { ProjectDatabase, type ProjectDatabaseOptions } from './project-database'

export { AssetsRepository, type InsertImportedResult } from './repositories/assets'
export { SegmentsRepository, type SegmentQuery } from './repositories/segments'
export {
  ProposalsRepository,
  type EditAndAcceptInput,
  type IdempotentProposalMutation,
  type ProposalMutationItem,
} from './repositories/proposals'
export {
  QaFindingsRepository,
  type QaFindingListFilter,
} from './repositories/qa-findings'
export { CriticArtifactsRepository } from './repositories/critic-artifacts'
export { type PersistedQaFinding } from './repositories/rows'
export { runProjectQa } from './qa-runner'
export { ExportsRepository, type ExportRecord, type RecordExportInput } from './repositories/exports'
export {
  TmUnitsRepository,
  type ReferenceImportResult,
  type TmMatchOptions,
  type TmMatchType,
  type TmUnit,
  type TmUnitImportInput,
  type TmUnitMatch,
  type TmUnitSearch,
} from './repositories/tm-units'
export {
  TermEntriesRepository,
  type TermEntry,
  type TermEntryImportInput,
  type TermEntryMatch,
  type TermEntrySearch,
  type TermEntryStatus,
  type TermEntryUpsertInput,
  type TermMatchOptions,
  type TermMatchType,
} from './repositories/term-entries'
export {
  StyleGuideRulesRepository,
  type StyleGuideRuleInput,
  type StyleGuideRuleSearch,
  type StyleGuideRuleUpsertInput,
} from './repositories/style-guide-rules'
export {
  SentencePatternsRepository,
  type SentencePatternInput,
  type SentencePatternSearch,
  type SentencePatternUpsertInput,
} from './repositories/sentence-patterns'
export {
  ContextDocsRepository,
  type ContextDocInput,
  type ContextDocSearch,
} from './repositories/context-docs'
export {
  TechConstraintsRepository,
  type TechConstraintInput,
  type TechConstraintSearch,
  type TechConstraintUpsertInput,
} from './repositories/tech-constraints'
export {
  VoiceProfilesRepository,
  type VoiceProfileInput,
  type VoiceProfileSearch,
  type VoiceProfileUpsertInput,
} from './repositories/voice-profiles'
export {
  type ContextDoc,
  type ContextDocKind,
  type SentencePattern,
  type SentencePatternStatus,
  type StyleGuideRule,
  type TechConstraint,
  type TechConstraintKind,
  type VoiceProfile,
} from './repositories/rows'
export {
  projectBlobFileName,
  readProjectBlob,
  removeProjectBlob,
  saveProjectBlob,
} from './blobs'
export { minimalQaSegment } from './minimal-qa'

export {
  stageAssetExport,
  type ExportVerification,
  type StageAssetExportInput,
  type StagedAssetExport,
} from './export-staging'

export {
  BACKUP_DIR_NAME_PATTERN,
  LEGACY_BACKUP_FILE_PATTERN,
  PRE_RESTORE_PREFIX,
  createProjectBackup,
  listProjectBackups,
  readBackupManifest,
  resolveBackupPath,
  verifyBackup,
  type BackupManifest,
  type BackupManifestFile,
  type BackupVerification,
  type ProjectBackupEntry,
  type ProjectBackupResult,
} from './backup'

export { restoreProjectBackup, type RestoreBackupResult } from './restore'

export { CatStore, type CatStoreOptions, type OpenProjectOptions } from './store'
