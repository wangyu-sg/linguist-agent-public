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
  StoreDatabaseIdentityError,
  StoreAuthorityError,
  StoreIdempotencyConflictError,
  StoreJobStateError,
  StoreError,
  StoreIndexCorruptError,
  StoreNotFoundError,
  StoreProjectOrderConflictError,
  StoreProjectExistsError,
  StoreReadOnlyError,
  StoreSchemaTooNewError,
  StoreSqliteUnavailableError,
  translateSqliteError,
  type StoreErrorCode,
} from './errors'

export {
  loadDatabaseSync,
  probeSqliteRuntime,
  type DatabaseSyncCtor,
  type SqliteDatabase,
  type SqliteRuntimeProbe,
  type SqliteStatement,
} from './runtime'

export { MIGRATIONS, SCHEMA_VERSION, type SchemaMigration } from './schema'

export {
  CatDatabase,
  LINGUIST_APPLICATION_ID,
  type AppliedMigration,
  type OpenCatDatabaseOptions,
} from './database'

export {
  PROJECT_SUBDIRS,
  ProjectIndex,
  readProjectManifestFile,
  type MainDatabaseSnapshot,
  type ProjectDatabaseIdentity,
  type ProjectIndexOptions,
  type ProjectManifest,
} from './project-index'

export { assetSourceFileName } from './asset-source'

export { ProjectDatabase, type ProjectDatabaseOptions } from './project-database'

export {
  RunHarnessRepository,
  translationJobScopeDigest,
  type CheckpointTranslationJobInput,
  type CreateTranslationJobInput,
  type DurableProjectEvent,
  type ExecuteRunMutationInput,
  type IdempotentRunMutation,
  type ProjectEventAck,
  type ProjectEventInput,
  type RunMutationChange,
  type RunMutationIdentity,
  type RunMutationOutcome,
  type RunChangeSummaryV1,
  type RunStateCapsuleV1,
  type RunUndoResult,
  type UndoRunOptions,
  type TranslationJob,
  type TranslationJobAuthority,
  type TranslationJobProvenance,
  type TranslationJobStatus,
  type TranslationJobStrategy,
} from './run-harness'

export { AssetsRepository, type InsertImportedResult } from './repositories/assets'
export { SegmentsRepository, type SegmentQuery } from './repositories/segments'
export {
  ProposalsRepository,
  type ApplyTranslationEdit,
  type ApplyTranslationsOptions,
  type ApplyTranslationsResult,
  type EditAndAcceptInput,
  type IdempotentProposalMutation,
  type ProposalAcceptOptions,
  type ProposalHardRuleOptions,
  type ProposalListFilter,
  type ProposalMutationItem,
  type ProposalWithDiff,
} from './repositories/proposals'
export {
  QaFindingsRepository,
  type QaFindingListFilter,
  type QaFindingOccurrence,
  type QaFindingPersistenceInput,
  type QaFindingStatusEvent,
  type QaRunPersistence,
} from './repositories/qa-findings'
export { CriticArtifactsRepository } from './repositories/critic-artifacts'
export {
  type PersistedCriticArtifact,
  type PersistedQaFinding,
} from './repositories/rows'
export { buildQaTermOptions, runProjectQa } from './qa-runner'
export { ExportsRepository, type ExportRecord, type RecordExportInput } from './repositories/exports'
export {
  TmUnitsRepository,
  type ReferenceImportResult,
  type TmMatchManyOptions,
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
  type TermEntryConflict,
  type TermEntryImportInput,
  type TermEntryMatch,
  type TermEntrySearch,
  type TermEntryStatus,
  type TermEntryUpsertInput,
  type TermMatchManyOptions,
  type TermMatchOptions,
  type TermMatchType,
  type TermValidationResult,
  type TermValidationSegment,
} from './repositories/term-entries'
export {
  ReferenceImportsRepository,
  type ReferenceImport,
  type ReferenceImportInput,
  type ReferenceImportKind,
} from './repositories/reference-imports'
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
  type BackupFaultInjector,
  type BackupFaultPoint,
  type BackupVerification,
  type ProjectBackupEntry,
  type ProjectBackupResult,
} from './backup'

export {
  RESTORE_TRANSACTION_FILE,
  recoverInterruptedRestore,
  restoreProjectBackup,
  type RestoreBackupResult,
  type RestoreFaultInjector,
  type RestoreFaultPoint,
} from './restore'

export {
  scanProjectIntegrity,
  type ProjectIntegrityCheck,
  type ProjectIntegrityCheckId,
  type ProjectIntegrityProblem,
  type ProjectIntegrityProgress,
  type ProjectIntegrityReport,
  type ProjectIntegrityStatus,
  type ScanProjectIntegrityOptions,
} from './integrity'

export { CatStore, type CatStoreOptions, type OpenProjectOptions } from './store'
