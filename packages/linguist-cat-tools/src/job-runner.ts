import type {
  ProjectDatabase,
  TranslationJob,
  TranslationJobProvenance,
  TranslationJobStrategy,
} from '@linguist/cat-store'
import { StoreJobStateError } from '@linguist/cat-store'

export interface WorkerJobProgress {
  jobId: string
  status: TranslationJob['status']
  cursor: number
  total: number
  completed: number
  failed: number
}

export interface WorkerJobComputation<TResult> {
  result: TResult
  completedSegmentIds?: readonly string[]
  failedSegmentIds?: readonly string[]
  proposalIds?: readonly string[]
  openItemIds?: readonly string[]
}

export interface CheckpointedWorkerJobInput<TWorkerResult, TResult> {
  db: ProjectDatabase
  jobId: string
  runId: string
  sessionId: string
  strategy: TranslationJobStrategy
  segmentIds: readonly string[]
  provenance: TranslationJobProvenance
  signal?: AbortSignal
  onProgress?: (progress: WorkerJobProgress) => void
  compute: (
    job: TranslationJob,
    signal?: AbortSignal,
  ) => Promise<WorkerJobComputation<TWorkerResult>>
  commit: (result: TWorkerResult, job: TranslationJob) => TResult
}

export interface QaWorkerJobInput<TWorkerResult, TResult>
  extends Omit<
    CheckpointedWorkerJobInput<TWorkerResult, TResult>,
    'jobId' | 'strategy' | 'provenance'
  > {
  modelId?: string
}

export interface ConsistencyPlanWorkerJobInput<TWorkerResult, TResult>
  extends QaWorkerJobInput<TWorkerResult, TResult> {}

function progress(job: TranslationJob): WorkerJobProgress {
  return {
    jobId: job.jobId,
    status: job.status,
    cursor: job.cursor,
    total: job.segmentIds.length,
    completed: job.completedSegmentIds.length,
    failed: job.failedSegmentIds.length,
  }
}

function report(
  callback: CheckpointedWorkerJobInput<unknown, unknown>['onProgress'],
  job: TranslationJob,
): void {
  try {
    callback?.(progress(job))
  } catch {
    // Job 状态已持久化；UI 进度回调失败不能改变可恢复状态。
  }
}

function abortError(): Error {
  const error = new Error('CAT worker job cancelled')
  error.name = 'AbortError'
  return error
}

function sameScope(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index])
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values)]
}

function validateComputation(
  db: ProjectDatabase,
  job: TranslationJob,
  pendingIds: readonly string[],
  computation: WorkerJobComputation<unknown>,
): { completed: string[]; failed: string[] } {
  const pending = new Set(pendingIds)
  const staleOrLocked = pendingIds.filter((segmentId) => {
    const segment = db.segments.getById(segmentId)
    return segment === undefined
      || segment.locked
      || segment.revision !== job.baseRevisions[segmentId]
  })
  const failed = unique([...staleOrLocked, ...(computation.failedSegmentIds ?? [])])
  const completed = unique(
    computation.completedSegmentIds
      ?? pendingIds.filter((segmentId) => !failed.includes(segmentId)),
  )
  if (
    [...completed, ...failed].some((segmentId) => !pending.has(segmentId))
    || completed.some((segmentId) => failed.includes(segmentId))
    || new Set([...completed, ...failed]).size !== pendingIds.length
  ) {
    throw new StoreJobStateError(
      job.jobId,
      'worker outcomes must cover the uncheckpointed scope exactly once',
    )
  }
  return { completed, failed }
}

/**
 * Durable Job rows are authoritative. The worker Promise only transports pure
 * snapshot computation; every resumable transition/checkpoint is persisted.
 */
export async function runCheckpointedWorkerJob<TWorkerResult, TResult>(
  input: CheckpointedWorkerJobInput<TWorkerResult, TResult>,
): Promise<TResult> {
  const authority = { sessionId: input.sessionId }
  let job = input.db.runs.getJob(input.jobId, authority)
  if (job === undefined) {
    job = input.db.runs.createJob({
      jobId: input.jobId,
      runId: input.runId,
      sessionId: input.sessionId,
      strategy: input.strategy,
      segmentIds: input.segmentIds,
      provenance: input.provenance,
    })
  } else if (
    job.runId !== input.runId
    || job.strategy !== input.strategy
    || !sameScope(job.segmentIds, input.segmentIds)
  ) {
    throw new StoreJobStateError(input.jobId, 'existing job identity or frozen scope differs')
  }
  if (job.status === 'cancelled') {
    throw new StoreJobStateError(job.jobId, 'cancelled jobs cannot resume')
  }
  if (input.signal?.aborted) {
    if (job.status !== 'completed') {
      job = input.db.runs.transitionJob(job.jobId, authority, 'cancelled')
      report(input.onProgress, job)
    }
    throw abortError()
  }
  if (job.status === 'pending' || job.status === 'paused' || job.status === 'failed') {
    job = input.db.runs.transitionJob(job.jobId, authority, 'running')
  }
  report(input.onProgress, job)

  try {
    const computation = await input.compute(job, input.signal)
    if (input.signal?.aborted) throw abortError()

    if (job.status !== 'completed' && job.cursor < job.segmentIds.length) {
      const pendingIds = job.segmentIds.slice(job.cursor)
      const outcomes = validateComputation(input.db, job, pendingIds, computation)
      job = input.db.runs.checkpointJob({
        jobId: job.jobId,
        sessionId: input.sessionId,
        cursor: job.segmentIds.length,
        completedSegmentIds: unique([...job.completedSegmentIds, ...outcomes.completed]),
        failedSegmentIds: unique([...job.failedSegmentIds, ...outcomes.failed]),
        proposalIds: unique([...job.proposalIds, ...(computation.proposalIds ?? [])]),
        openItemIds: unique([...job.openItemIds, ...(computation.openItemIds ?? [])]),
      })
      report(input.onProgress, job)
    }

    const committed = input.commit(computation.result, job)
    if (job.status !== 'completed') {
      job = input.db.runs.transitionJob(job.jobId, authority, 'completed')
      report(input.onProgress, job)
    }
    return committed
  } catch (error) {
    const current = input.db.runs.getJob(input.jobId, authority)
    if (current !== undefined && current.status !== 'completed' && current.status !== 'cancelled') {
      const status = input.signal?.aborted || (error instanceof Error && error.name === 'AbortError')
        ? 'cancelled'
        : 'paused'
      const updated = input.db.runs.transitionJob(current.jobId, authority, status)
      report(input.onProgress, updated)
    }
    throw error
  }
}

export function runQaWorkerJob<TWorkerResult, TResult>(
  input: QaWorkerJobInput<TWorkerResult, TResult>,
): Promise<TResult> {
  return runCheckpointedWorkerJob({
    ...input,
    jobId: `job:qa:${input.sessionId}:${input.runId}`,
    strategy: 'balanced',
    provenance: {
      schemaVersion: 1,
      runtime: 'node-worker_threads',
      role: 'assistant',
      promptVersion: 'qa-worker-v1',
      ...(input.modelId === undefined ? {} : { modelId: input.modelId }),
    },
  })
}

/**
 * 只运行 advisory consistency 计算并持久化 Job 进度；LF-084 的显式
 * plan/apply 工具仍是创建 pending Proposal 的唯一入口。
 */
export function runConsistencyPlanWorkerJob<TWorkerResult, TResult>(
  input: ConsistencyPlanWorkerJobInput<TWorkerResult, TResult>,
): Promise<TResult> {
  return runCheckpointedWorkerJob({
    ...input,
    compute: async (job, signal) => {
      const computation = await input.compute(job, signal)
      if ((computation.proposalIds?.length ?? 0) > 0) {
        throw new StoreJobStateError(
          job.jobId,
          'consistency worker may persist an advisory plan but cannot create proposals',
        )
      }
      return computation
    },
    jobId: `job:consistency-plan:${input.sessionId}:${input.runId}`,
    strategy: 'balanced',
    provenance: {
      schemaVersion: 1,
      runtime: 'node-worker_threads',
      role: 'assistant',
      promptVersion: 'consistency-advisory-worker-v1',
      projectEventPolicy: 'suppress',
      ...(input.modelId === undefined ? {} : { modelId: input.modelId }),
    },
  })
}
