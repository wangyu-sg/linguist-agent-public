import { describe, expect, test } from 'bun:test'
import { Provider, createStore } from 'jotai'
import { renderToStaticMarkup } from 'react-dom/server'
import type {
  LinguistIpcResult,
  LinguistLatestRunSummaryResult,
  LinguistRunSummaryRequest,
  LinguistRunUndoRequest,
  LinguistRunUndoResult,
} from '@proma/shared'
import {
  ProjectRunSummary,
  linguistProjectRunSummaryAtomFamily,
  loadProjectRunSummary,
  mergeProjectRunSummaryState,
  undoLatestProjectRun,
} from './ProjectRunSummary'

describe('ProjectRunSummary K-004/K-005', () => {
  test('shows the latest run, exact undo action, partial refusals, and the recovery boundary', () => {
    const store = createStore()
    store.set(linguistProjectRunSummaryAtomFamily('prj-a'), {
      status: 'ready',
      summary: {
        schemaVersion: 1,
        projectId: 'prj-a',
        runId: 'run-a',
        job: {
          jobId: 'job-a',
          status: 'completed',
          scopedSegments: 4,
          cursor: 4,
          completedSegments: 3,
          failedSegments: 1,
        },
        mutationCount: 4,
        changes: {
          proposalsCreated: 2,
          qaFindingsCreated: 1,
          qaFindingsUpdated: 0,
          filesTouched: 1,
          total: 4,
          undone: 1,
        },
        eventSequence: { first: 8, last: 12 },
        canUndo: true,
      },
      undoResult: {
        runId: 'run-a',
        status: 'partial',
        reverted: [{ entityType: 'proposal', entityId: 'proposal-a' }],
        refused: [{
          entityType: 'proposal',
          entityId: 'proposal-b',
          reason: 'segment revision changed from 2 to 3',
        }],
      },
    })

    const html = renderToStaticMarkup(
      <Provider store={store}>
        <ProjectRunSummary
          projectId="prj-a"
          sessionId="session-a"
          archived={false}
          refreshSequence={12}
        />
      </Provider>,
    )

    expect(html).toContain('本次运行')
    expect(html).toContain('撤销本次 CAT 变更')
    expect(html).toContain('完成 3 / 4')
    expect(html).toContain('Proposal 2')
    expect(html).toContain('文件 1（仅记录）')
    expect(html).toContain('部分完成：已撤销 1 项，拒绝 1 项')
    expect(html).toContain('proposal-b')
    expect(html).toContain('片段已有后续修订')
    expect(html).toContain('不会覆盖')
    expect(html).toContain('Proma File Rewind')
    expect(html).toContain('外部 MCP / 程序副作用仅记录')
  })

  test('disables undo without a bound session or for an archived project', () => {
    const store = createStore()
    store.set(linguistProjectRunSummaryAtomFamily('prj-a'), {
      status: 'ready',
      summary: {
        schemaVersion: 1,
        projectId: 'prj-a',
        runId: 'run-a',
        mutationCount: 1,
        changes: {
          proposalsCreated: 1,
          qaFindingsCreated: 0,
          qaFindingsUpdated: 0,
          filesTouched: 0,
          total: 1,
          undone: 0,
        },
        canUndo: true,
      },
    })

    for (const props of [
      { sessionId: undefined, archived: false },
      { sessionId: 'session-a', archived: true },
    ]) {
      const html = renderToStaticMarkup(
        <Provider store={store}>
          <ProjectRunSummary
            projectId="prj-a"
            refreshSequence={1}
            {...props}
          />
        </Provider>,
      )
      expect(html).toContain('disabled=""')
    }
  })

  test('renderer sends the displayed run as a CAS token but never actor authority', async () => {
    let summaryRequest: LinguistRunSummaryRequest | undefined
    const loaded = await loadProjectRunSummary('prj-a', async (input) => {
      summaryRequest = input
      return {
        ok: true,
        data: { summary: null },
      } satisfies LinguistIpcResult<LinguistLatestRunSummaryResult>
    })
    expect(summaryRequest).toEqual({ projectId: 'prj-a' })
    expect(loaded).toEqual({ status: 'ready', summary: null })

    let undoRequest: LinguistRunUndoRequest | undefined
    const undone = await undoLatestProjectRun('prj-a', 'session-a', 'run-a', async (input) => {
      undoRequest = input
      return {
        ok: true,
        data: {
          runId: 'run-a',
          status: 'completed',
          reverted: [],
          refused: [],
        },
      } satisfies LinguistIpcResult<LinguistRunUndoResult>
    })
    expect(undoRequest).toEqual({
      projectId: 'prj-a',
      sessionId: 'session-a',
      expectedRunId: 'run-a',
    })
    expect(undone.ok).toBe(true)
  })

  test('a durable refresh never carries an earlier run undo result onto a newer run', () => {
    const next = {
      status: 'ready' as const,
      summary: {
        schemaVersion: 1 as const,
        projectId: 'prj-a',
        runId: 'run-b',
        mutationCount: 0,
        changes: {
          proposalsCreated: 0,
          qaFindingsCreated: 0,
          qaFindingsUpdated: 0,
          filesTouched: 0,
          total: 0,
          undone: 0,
        },
        canUndo: false,
      },
    }
    expect(mergeProjectRunSummaryState(next, {
      status: 'ready',
      summary: null,
      undoResult: {
        runId: 'run-a',
        status: 'completed',
        reverted: [],
        refused: [],
      },
    })).toEqual(next)
  })
})
