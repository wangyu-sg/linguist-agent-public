import { describe, expect, test } from 'bun:test'
import type { LinguistIntegrityScrubEvent } from '@proma/shared'
import {
  INITIAL_PROJECT_INTEGRITY_STATE,
  reduceProjectIntegrityEvent,
} from './project-integrity-atoms'

const projectId = 'prj-0123456789abcdef'
const jobId = 'scrub-00000000-0000-4000-8000-000000000000'

describe('Full Integrity Scrub project-scoped state', () => {
  test('ignores another project and keeps unavailable distinct from passed', () => {
    const other: LinguistIntegrityScrubEvent = {
      projectId: 'prj-fedcba9876543210',
      jobId,
      state: 'cancelled',
    }
    expect(reduceProjectIntegrityEvent(projectId, INITIAL_PROJECT_INTEGRITY_STATE, other))
      .toBe(INITIAL_PROJECT_INTEGRITY_STATE)

    const completed: LinguistIntegrityScrubEvent = {
      projectId,
      jobId,
      state: 'completed',
      report: {
        schemaVersion: 1,
        kind: 'full',
        projectId,
        jobId,
        executor: 'worker_thread',
        workerThreadId: 2,
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
      },
    }
    const state = reduceProjectIntegrityEvent(projectId, INITIAL_PROJECT_INTEGRITY_STATE, completed)
    expect(state.status).toBe('completed')
    if (state.status === 'completed') {
      expect(state.report.outcome).toBe('incomplete')
      expect(state.report.checks[0]?.status).toBe('unavailable')
    }
  })
})
