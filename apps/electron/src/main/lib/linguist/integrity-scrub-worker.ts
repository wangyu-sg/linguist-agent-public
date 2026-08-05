import {
  lstatSync,
  readFileSync,
  readdirSync,
} from 'node:fs'
import { dirname, join } from 'node:path'
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
  rootDir: string
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
  'session_workspaces',
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

function checkSessionWorkspaces(rootDir: string, projectId: string): LinguistIntegrityCheck {
  const failed: ProblemCounts = new Map()
  const unavailable: ProblemCounts = new Map()
  const projectWorkspaces = join(rootDir, 'agent-workspaces', projectId)
  const workspaceStat = lstatSync(projectWorkspaces, { throwIfNoEntry: false })
  if (workspaceStat === undefined) return checkResult('session_workspaces', 0)
  if (workspaceStat.isSymbolicLink() || !workspaceStat.isDirectory()) {
    addProblem(failed, 'SESSION_WORKSPACE_ROOT_INVALID')
    return checkResult('session_workspaces', 0, failed)
  }

  let sessions: Array<{ id?: unknown; linguistProjectId?: unknown }> | undefined
  try {
    const parsed = JSON.parse(
      readFileSync(join(dirname(rootDir), 'agent-sessions.json'), 'utf8'),
    ) as { sessions?: unknown }
    if (!Array.isArray(parsed.sessions)) throw new Error('invalid index')
    sessions = parsed.sessions as Array<{ id?: unknown; linguistProjectId?: unknown }>
  } catch {
    addProblem(unavailable, 'SESSION_INDEX_UNAVAILABLE')
  }
  const byId = new Map(
    (sessions ?? [])
      .filter((session): session is { id: string; linguistProjectId?: unknown } =>
        typeof session.id === 'string')
      .map((session) => [session.id, session]),
  )
  let checkedItems = 0
  for (const sessionId of readdirSync(projectWorkspaces)) {
    checkedItems += 1
    const workspacePath = join(projectWorkspaces, sessionId)
    const stat = lstatSync(workspacePath)
    if (stat.isSymbolicLink() || !stat.isDirectory()) {
      addProblem(failed, 'SESSION_WORKSPACE_INVALID')
      continue
    }
    try {
      const manifestPath = join(workspacePath, 'SESSION_MANIFEST.json')
      const manifestStat = lstatSync(manifestPath)
      if (manifestStat.isSymbolicLink() || !manifestStat.isFile()) {
        addProblem(failed, 'SESSION_MANIFEST_NOT_REGULAR')
        continue
      }
      const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as {
        projectId?: unknown
        sessionId?: unknown
      }
      if (manifest.projectId !== projectId || manifest.sessionId !== sessionId) {
        addProblem(failed, 'SESSION_MANIFEST_REFERENCE_MISMATCH')
      }
    } catch {
      addProblem(failed, 'SESSION_MANIFEST_INVALID')
    }
    if (sessions !== undefined) {
      const session = byId.get(sessionId)
      if (session === undefined || session.linguistProjectId !== projectId) {
        addProblem(failed, 'SESSION_INDEX_REFERENCE_MISSING')
      }
    }
  }
  return checkResult('session_workspaces', checkedItems, failed, unavailable)
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
  const sessionCheck = checkSessionWorkspaces(input.rootDir, input.projectId)
  checks.push(sessionCheck)
  const checkIndex = CHECK_ORDER.indexOf(sessionCheck.id)
  onProgress({
    checkId: sessionCheck.id,
    completedItems: sessionCheck.checkedItems,
    totalItems: sessionCheck.checkedItems,
    completedChecks: checkIndex + 1,
    totalChecks: CHECK_ORDER.length,
    percent: Math.round(((checkIndex + 1) / CHECK_ORDER.length) * 100),
  })
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
