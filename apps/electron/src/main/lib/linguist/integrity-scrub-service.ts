import { randomUUID } from 'node:crypto'
import { Worker, type WorkerOptions } from 'node:worker_threads'
import type {
  LinguistIntegrityScrubEvent,
  LinguistIntegrityScrubProgress,
  LinguistIntegrityScrubReport,
} from '@proma/shared'
import type { LinguistProjectService } from './project-service'
import type { IntegrityScrubWorkerInput } from './integrity-scrub-worker'

interface ActiveScrub {
  projectId: string
  jobId: string
  worker: Worker
  cancelled: boolean
  settled: boolean
}

export interface IntegrityScrubServiceOptions {
  getService: () => LinguistProjectService
  workerScript: string | URL
  emit: (event: LinguistIntegrityScrubEvent) => void
  now?: () => string
  workerOptions?: Omit<WorkerOptions, 'workerData'>
}

/** 一项目最多一个真实 Worker；完成报告只保留最近一份供显式导出。 */
export class IntegrityScrubService {
  private readonly activeByProject = new Map<string, ActiveScrub>()
  private readonly reportByProject = new Map<string, LinguistIntegrityScrubReport>()
  private readonly now: () => string

  constructor(private readonly options: IntegrityScrubServiceOptions) {
    this.now = options.now ?? (() => new Date().toISOString())
  }

  start(projectId: string): { jobId: string } {
    const existing = this.activeByProject.get(projectId)
    if (existing !== undefined) return { jobId: existing.jobId }

    const service = this.options.getService()
    service.getProject(projectId)
    const input: IntegrityScrubWorkerInput = {
      projectId,
      projectDir: service.getProjectPaths(projectId).projectDir,
      jobId: `scrub-${randomUUID()}`,
      startedAt: this.now(),
    }
    const worker = new Worker(this.options.workerScript, {
      ...this.options.workerOptions,
      workerData: input,
    })
    const active: ActiveScrub = {
      projectId,
      jobId: input.jobId,
      worker,
      cancelled: false,
      settled: false,
    }
    this.activeByProject.set(projectId, active)

    worker.on('message', (message: unknown) => {
      if (active.cancelled || active.settled || typeof message !== 'object' || message === null) return
      const item = message as {
        type?: unknown
        progress?: LinguistIntegrityScrubProgress
        report?: LinguistIntegrityScrubReport
      }
      if (item.type === 'progress' && item.progress !== undefined) {
        this.options.emit({
          projectId,
          jobId: input.jobId,
          state: 'running',
          progress: item.progress,
        })
      } else if (
        item.type === 'report'
        && item.report?.projectId === projectId
        && item.report.jobId === input.jobId
        && item.report.executor === 'worker_thread'
      ) {
        active.settled = true
        this.activeByProject.delete(projectId)
        this.reportByProject.set(projectId, item.report)
        this.options.emit({
          projectId,
          jobId: input.jobId,
          state: 'completed',
          report: item.report,
        })
      } else if (item.type === 'error') {
        this.fail(active)
      }
    })
    worker.on('error', () => this.fail(active))
    worker.on('exit', (code) => {
      if (!active.cancelled && !active.settled) this.fail(active)
    })
    return { jobId: input.jobId }
  }

  cancel(projectId: string, jobId: string): { cancelled: boolean } {
    const active = this.activeByProject.get(projectId)
    if (active === undefined || active.jobId !== jobId) return { cancelled: false }
    active.cancelled = true
    active.settled = true
    this.activeByProject.delete(projectId)
    void active.worker.terminate()
    this.options.emit({ projectId, jobId, state: 'cancelled' })
    return { cancelled: true }
  }

  getReport(projectId: string, jobId: string): LinguistIntegrityScrubReport | undefined {
    const report = this.reportByProject.get(projectId)
    return report?.jobId === jobId ? report : undefined
  }

  dispose(): void {
    for (const active of this.activeByProject.values()) {
      active.cancelled = true
      void active.worker.terminate()
    }
    this.activeByProject.clear()
  }

  private fail(active: ActiveScrub): void {
    if (active.cancelled || active.settled) return
    active.settled = true
    this.activeByProject.delete(active.projectId)
    this.options.emit({
      projectId: active.projectId,
      jobId: active.jobId,
      state: 'failed',
      errorCode: 'WORKER_FAILED',
    })
  }
}
