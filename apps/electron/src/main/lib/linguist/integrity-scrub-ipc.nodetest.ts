import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import type { LinguistIntegrityScrubReport } from '@proma/shared'
import {
  buildRedactedIntegrityReport,
  createIntegrityScrubIpc,
} from './integrity-scrub-ipc'
import { INPUT, makeService } from './test/service-testkit'

function report(projectId: string): LinguistIntegrityScrubReport {
  return {
    schemaVersion: 1,
    kind: 'full',
    projectId,
    jobId: 'scrub-00000000-0000-4000-8000-000000000000',
    executor: 'worker_thread',
    workerThreadId: 7,
    outcome: 'incomplete',
    startedAt: '2026-07-29T00:00:00.000Z',
    completedAt: '2026-07-29T00:00:01.000Z',
    checks: [{
      id: 'session_workspaces',
      status: 'unavailable',
      checkedItems: 1,
      failedItems: 0,
      unavailableItems: 1,
      problems: [{ code: 'SESSION_INDEX_UNAVAILABLE', count: 1 }],
    }],
  }
}

test('saved Full Integrity Scrub report is redacted and verified', async () => {
  const service = makeService()
  try {
    const project = service.createProject(INPUT)
    const completed = report(project.id)
    const outputDir = mkdtempSync(join(tmpdir(), 'integrity-report-'))
    const output = join(outputDir, 'report.json')
    const ipc = createIntegrityScrubIpc({
      getProjectService: () => service,
      scrub: {
        start: () => ({ jobId: completed.jobId }),
        cancel: () => ({ cancelled: true }),
        getReport: () => completed,
      },
    })
    const result = await ipc.exportReport(
      { projectId: project.id, jobId: completed.jobId },
      async () => ({ canceled: false, filePath: output }),
    )
    assert.equal(result.ok, true)
    if (!result.ok || result.data.cancelled) return
    assert.equal(result.data.filename, 'report.json')
    const raw = readFileSync(output, 'utf8')
    assert.doesNotMatch(raw, new RegExp(project.id))
    assert.doesNotMatch(raw, /scrub-00000000/)
    assert.doesNotMatch(raw, /CUSTOMER|\/Users\//)
    assert.equal(JSON.parse(raw).privacy.redacted, true)
  } finally {
    service.closeAll()
  }
})

test('redacted report preserves structured unavailable evidence', () => {
  const redacted = buildRedactedIntegrityReport(report('prj-0123456789abcdef'))
  assert.equal(redacted.checks[0]?.status, 'unavailable')
  assert.deepEqual(redacted.checks[0]?.problems, [{
    code: 'SESSION_INDEX_UNAVAILABLE',
    count: 1,
  }])
  assert.equal('projectId' in redacted, false)
  assert.equal('jobId' in redacted, false)
})
