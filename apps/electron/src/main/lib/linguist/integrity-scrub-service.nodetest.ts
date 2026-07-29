import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { LinguistIntegrityScrubEvent } from '@proma/shared'
import { IntegrityScrubService } from './integrity-scrub-service'
import { INPUT, makeService, readFixture } from './test/service-testkit'

test('Full Integrity Scrub production runner executes in node:worker_threads', async () => {
  const service = makeService()
  const events: LinguistIntegrityScrubEvent[] = []
  const scrub = new IntegrityScrubService({
    getService: () => service,
    workerScript: new URL('./integrity-scrub-worker.ts', import.meta.url),
    workerOptions: { execArgv: process.execArgv },
    emit: (event) => events.push(event),
  })
  try {
    const project = service.createProject(INPUT)
    await service.importAsset(project.id, {
      bytes: readFixture('mini_items.json'),
      filename: 'mini_items.json',
    })
    const { jobId } = scrub.start(project.id)
    const terminal = await waitForTerminal(events, jobId)
    assert.equal(terminal.state, 'completed')
    if (terminal.state !== 'completed') return
    assert.equal(terminal.report.executor, 'worker_thread')
    assert.notEqual(terminal.report.workerThreadId, 0)
    assert.deepEqual(
      terminal.report.checks.map((check) => check.id),
      [
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
      ],
    )
    assert.ok(events.some((event) => event.state === 'running'))
  } finally {
    scrub.dispose()
    service.closeAll()
  }
})

test('Full Integrity Scrub cancellation terminates the worker and emits a terminal event', async () => {
  const service = makeService()
  const events: LinguistIntegrityScrubEvent[] = []
  const scrub = new IntegrityScrubService({
    getService: () => service,
    workerScript: new URL('./integrity-scrub-worker.ts', import.meta.url),
    workerOptions: { execArgv: process.execArgv },
    emit: (event) => events.push(event),
  })
  try {
    const project = service.createProject(INPUT)
    const { jobId } = scrub.start(project.id)
    assert.deepEqual(scrub.cancel(project.id, jobId), { cancelled: true })
    assert.equal(events.at(-1)?.state, 'cancelled')
    assert.equal(scrub.cancel(project.id, jobId).cancelled, false)
  } finally {
    scrub.dispose()
    service.closeAll()
  }
})

test('Full Integrity Scrub treats a clean worker exit without a report as failure', async () => {
  const service = makeService()
  const events: LinguistIntegrityScrubEvent[] = []
  const scrub = new IntegrityScrubService({
    getService: () => service,
    workerScript: new URL('data:text/javascript,'),
    emit: (event) => events.push(event),
  })
  try {
    const project = service.createProject(INPUT)
    const { jobId } = scrub.start(project.id)
    assert.equal((await waitForTerminal(events, jobId)).state, 'failed')
  } finally {
    scrub.dispose()
    service.closeAll()
  }
})

async function waitForTerminal(
  events: LinguistIntegrityScrubEvent[],
  jobId: string,
): Promise<Exclude<LinguistIntegrityScrubEvent, { state: 'running' }>> {
  const deadline = Date.now() + 10_000
  while (Date.now() < deadline) {
    const event = events.find((item) => item.jobId === jobId && item.state !== 'running')
    if (event !== undefined && event.state !== 'running') return event
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  throw new Error('worker did not finish')
}
