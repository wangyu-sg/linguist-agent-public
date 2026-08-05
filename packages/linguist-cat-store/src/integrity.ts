import { join } from 'node:path'
import type { ProjectId } from '@linguist/cat-core'
import { LINGUIST_APPLICATION_ID } from './database'
import { StoreError } from './errors'
import {
  checkEventSequence,
  checkJobLineage,
  checkRunLineage,
} from './integrity-harness'
import {
  checkBlobDigests,
  checkExportManifests,
  hasCompleteDatabaseIdentity,
  checkProjectManifest,
  checkSourceDigests,
} from './integrity-managed-files'
import {
  checkForeignKeys,
  checkOrphans,
  checkProposalReferences,
  checkQaReferences,
  checkReviewReferences,
  checkSqlite,
} from './integrity-relational'
import {
  addProblem,
  integrityResult,
  type ProjectIntegrityCheck,
  type ProjectIntegrityReport,
  type ScanProjectIntegrityOptions,
} from './integrity-types'
import { ProjectDatabase } from './project-database'
import { SCHEMA_VERSION } from './schema'

export {
  getBlockingIntegrityProblems,
  type ProjectIntegrityCheck,
  type ProjectIntegrityCheckId,
  type ProjectIntegrityProblem,
  type ProjectIntegrityProgress,
  type ProjectIntegrityReport,
  type ProjectIntegrityStatus,
  type ScanProjectIntegrityOptions,
} from './integrity-types'

/** 全量项目扫描；同一只读句柄完成全部数据库与导出引用检查。 */
export function scanProjectIntegrity(options: ScanProjectIntegrityOptions): ProjectIntegrityReport {
  const manifest = checkProjectManifest(options.projectDir, options.expectedProjectId)
  const checks: ProjectIntegrityCheck[] = [manifest.check]
  const includeExports = options.includeExportManifests ?? true
  let project: ProjectDatabase
  try {
    project = ProjectDatabase.open(join(options.projectDir, 'cat.db'), {
      projectId: options.expectedProjectId as ProjectId,
      ...(manifest.manifest === undefined ? {} : { trustedManifest: manifest.manifest }),
      readOnly: true,
    })
  } catch (error) {
    const code = error instanceof StoreError ? error.code : 'UNKNOWN'
    checks.push(integrityResult('schema_version', 0, new Map([[`CAT_DB_OPEN_${code}`, 1]])))
    const unavailable = [
      'source_digests',
      'blob_digests',
      'sqlite_integrity',
      'foreign_keys',
      'orphans',
      'proposal_references',
      'qa_references',
      'review_references',
      'event_sequence',
      'job_lineage',
      'run_lineage',
      ...(includeExports ? ['export_manifests' as const] : []),
    ] as const
    for (const id of unavailable) {
      checks.push(integrityResult(
        id,
        0,
        new Map(),
        new Map([[`${id.toUpperCase()}_UNAVAILABLE`, 1]]),
      ))
    }
    return {
      projectId: options.expectedProjectId,
      outcome: 'failed',
      checks,
    }
  }

  const db = project.catDb
  try {
    const schemaFailed = new Map<string, number>()
    if (
      db.schemaVersion > SCHEMA_VERSION
      || (!options.allowOlderSchema && db.schemaVersion !== SCHEMA_VERSION)
    ) addProblem(schemaFailed, 'SCHEMA_VERSION_UNSUPPORTED')
    try {
      const applicationId = Number(
        (db.db.prepare('PRAGMA application_id').get() as { application_id: number }).application_id,
      )
      const userVersion = Number(
        (db.db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version,
      )
      const migration = db.db.prepare(
        'SELECT MAX(version) AS version FROM schema_migrations',
      ).get() as { version: number }
      if (
        applicationId !== LINGUIST_APPLICATION_ID
        || userVersion !== db.schemaVersion
        || Number(migration.version) !== db.schemaVersion
        || (
          db.schemaVersion >= 13
          && (
            manifest.manifest === undefined
            || !hasCompleteDatabaseIdentity(
              manifest.manifest,
              LINGUIST_APPLICATION_ID,
              db.schemaVersion,
            )
          )
        )
      ) addProblem(schemaFailed, 'DATABASE_IDENTITY_MISMATCH')
    } catch {
      addProblem(schemaFailed, 'DATABASE_IDENTITY_UNREADABLE')
    }
    checks.push(integrityResult('schema_version', 4, schemaFailed))

    const remaining = [
      checkSourceDigests(db, options.projectDir, options.onProgress),
      checkBlobDigests(db, options.projectDir, options.onProgress),
      checkSqlite(db, options.databasePragma ?? 'integrity_check'),
      checkForeignKeys(db),
      checkOrphans(db, options.expectedProjectId),
      checkProposalReferences(db),
      checkQaReferences(db),
      checkReviewReferences(db),
      checkEventSequence(db, options.expectedProjectId),
      checkJobLineage(db, options.expectedProjectId),
      checkRunLineage(db),
      ...(includeExports
        ? [checkExportManifests(db, options.projectDir, options.expectedProjectId)]
        : []),
    ]
    for (const check of remaining) {
      checks.push(check)
      options.onProgress?.({
        checkId: check.id,
        completedItems: check.checkedItems,
        totalItems: check.checkedItems,
      })
    }
    const outcome = checks.some((check) => check.status === 'failed')
      ? 'failed'
      : checks.some((check) => check.status === 'unavailable')
        ? 'incomplete'
        : 'passed'
    return {
      projectId: options.expectedProjectId,
      outcome,
      schemaVersion: db.schemaVersion,
      checks,
    }
  } finally {
    project.close()
  }
}
