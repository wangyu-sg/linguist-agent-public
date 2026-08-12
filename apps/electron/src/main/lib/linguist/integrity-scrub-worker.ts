import {
  isMainThread,
  parentPort,
  threadId,
  workerData,
} from 'node:worker_threads'
import { scanProjectIntegrity } from '@linguist/cat-store'
import type {
  LinguistIntegrityCheck,
  LinguistIntegrityCheckId,
  LinguistIntegrityScrubProgress,
  LinguistIntegrityScrubReport,
} from '@proma/shared'

export interface IntegrityScrubWorkerInput {
  projectDir: string
  projectId: string
  jobId: string
  startedAt: string
}

type ProblemCounts = Map<string, number>

const CHECK_ORDER: readonly LinguistIntegrityCheckId[] = [
  'project_manifest',
  'schema_version',
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
  'export_manifests',
]

function addProblem(problems: ProblemCounts, code: string, count = 1): void {
  if (count > 0) problems.set(code, (problems.get(code) ?? 0) + count)
}

function checkResult(
  id: LinguistIntegrityCheckId,
  checkedItems: number,
  failed: ProblemCounts = new Map(),
  unavailable: ProblemCounts = new Map(),
): LinguistIntegrityCheck {
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

export function runFullIntegrityScrub(
  input: IntegrityScrubWorkerInput,
  onProgress: (progress: LinguistIntegrityScrubProgress) => void = () => undefined,
): LinguistIntegrityScrubReport {
  const report = scanProjectIntegrity({
    projectDir: input.projectDir,
    expectedProjectId: input.projectId,
    onProgress(progress) {
      const checkIndex = CHECK_ORDER.indexOf(progress.checkId)
      const fraction = progress.totalItems === 0
        ? 1
        : Math.min(1, progress.completedItems / progress.totalItems)
      onProgress({
        ...progress,
        completedChecks: checkIndex,
        totalChecks: CHECK_ORDER.length,
        percent: Math.round(((checkIndex + fraction) / CHECK_ORDER.length) * 100),
      })
    },
  })
  const checks: LinguistIntegrityCheck[] = [...report.checks]
  const outcome = checks.some((check) => check.status === 'failed')
    ? 'failed'
    : checks.some((check) => check.status === 'unavailable')
      ? 'incomplete'
      : 'passed'
  return {
    schemaVersion: 1,
    kind: 'full',
    projectId: input.projectId,
    jobId: input.jobId,
    executor: 'worker_thread',
    workerThreadId: threadId,
    outcome,
    startedAt: input.startedAt,
    completedAt: new Date().toISOString(),
    checks,
  }
}

if (!isMainThread) {
  const input = workerData as IntegrityScrubWorkerInput
  try {
    const report = runFullIntegrityScrub(input, (progress) => {
      parentPort?.postMessage({ type: 'progress', progress })
    })
    parentPort?.postMessage({ type: 'report', report })
  } catch {
    parentPort?.postMessage({ type: 'error', errorCode: 'WORKER_FAILED' })
    process.exitCode = 1
  }
}
