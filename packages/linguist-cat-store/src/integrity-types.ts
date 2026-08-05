import type { CatDatabase } from './database'

export type ProjectIntegrityCheckId =
  | 'project_manifest'
  | 'schema_version'
  | 'source_digests'
  | 'blob_digests'
  | 'sqlite_integrity'
  | 'foreign_keys'
  | 'orphans'
  | 'proposal_references'
  | 'qa_references'
  | 'review_references'
  | 'event_sequence'
  | 'job_lineage'
  | 'run_lineage'
  | 'export_manifests'

export type ProjectIntegrityStatus = 'passed' | 'failed' | 'unavailable'

export interface ProjectIntegrityProblem {
  /** 稳定机器码；不含文件名、项目名、路径或客户文本。 */
  code: string
  count: number
}

export interface ProjectIntegrityCheck {
  id: ProjectIntegrityCheckId
  status: ProjectIntegrityStatus
  checkedItems: number
  failedItems: number
  unavailableItems: number
  problems: ProjectIntegrityProblem[]
}

export interface ProjectIntegrityReport {
  projectId: string
  outcome: 'passed' | 'failed' | 'incomplete'
  schemaVersion?: number
  checks: ProjectIntegrityCheck[]
}

export interface ProjectIntegrityProgress {
  checkId: ProjectIntegrityCheckId
  completedItems: number
  totalItems: number
}

export interface ScanProjectIntegrityOptions {
  projectDir: string
  expectedProjectId: string
  databasePragma?: 'integrity_check' | 'quick_check'
  /** 旧备份可在恢复后的可写打开中迁移；实时 scrub 不允许把旧 schema 说成通过。 */
  allowOlderSchema?: boolean
  /** 备份不携带 exports；Full Scrub 默认检查导出物及其 manifest。 */
  includeExportManifests?: boolean
  onProgress?: (progress: ProjectIntegrityProgress) => void
}

const RUN_HARNESS_SCHEMA_VERSION = 12
const REQUIRED_HARNESS_SCAN_CODES = new Set([
  'EVENT_SEQUENCE_SCAN_UNAVAILABLE',
  'JOB_LINEAGE_SCAN_UNAVAILABLE',
  'RUN_LINEAGE_SCAN_UNAVAILABLE',
])

/** 备份/恢复的阻断问题；可解释但无法映射的 file effect 仍保持 unavailable。 */
export function getBlockingIntegrityProblems(report: ProjectIntegrityReport): string[] {
  return report.checks.flatMap((check) => {
    const blocked = check.status === 'failed'
      || (
        (report.schemaVersion ?? 0) >= RUN_HARNESS_SCHEMA_VERSION
        && check.problems.some((problem) => REQUIRED_HARNESS_SCAN_CODES.has(problem.code))
      )
    return blocked
      ? check.problems.map((problem) => `${check.id}/${problem.code} x${problem.count}`)
      : []
  })
}

export type ProblemCounts = Map<string, number>

export function addProblem(problems: ProblemCounts, code: string, count = 1): void {
  if (count > 0) problems.set(code, (problems.get(code) ?? 0) + count)
}

export function integrityResult(
  id: ProjectIntegrityCheckId,
  checkedItems: number,
  failed: ProblemCounts = new Map(),
  unavailable: ProblemCounts = new Map(),
): ProjectIntegrityCheck {
  const failedItems = [...failed.values()].reduce((sum, count) => sum + count, 0)
  const unavailableItems = [...unavailable.values()].reduce((sum, count) => sum + count, 0)
  return {
    id,
    status: failedItems > 0 ? 'failed' : unavailableItems > 0 ? 'unavailable' : 'passed',
    checkedItems,
    failedItems,
    unavailableItems,
    problems: [...failed, ...unavailable]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([code, count]) => ({ code, count })),
  }
}

export function countRows(db: CatDatabase, sql: string, ...params: unknown[]): number {
  const row = db.db.prepare(sql).get(...params) as { n: number | bigint }
  return Number(row.n)
}

export function safeCount(
  db: CatDatabase,
  sql: string,
  failed: ProblemCounts,
  code: string,
  unavailable: ProblemCounts,
  ...params: unknown[]
): void {
  try {
    addProblem(failed, code, countRows(db, sql, ...params))
  } catch {
    addProblem(unavailable, `${code}_UNAVAILABLE`)
  }
}
