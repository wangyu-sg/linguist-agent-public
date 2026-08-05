import { describe, expect, test } from 'bun:test'
import type { LinguistProjectMutationEvent } from '@proma/shared'
import {
  INITIAL_PROJECT_MUTATION_STATE,
  affectedLoadedPageOffsets,
  getProjectMutationRefreshPlan,
  reduceProjectMutation,
  replayProjectMutations,
  subscribeToProjectMutations,
} from './project-mutation-atoms'

const proposalCreated: LinguistProjectMutationEvent = {
  projectId: 'project-a',
  revision: 1,
  kind: 'proposal-created',
  segmentIds: ['segment-205'],
  proposalIds: ['proposal-1'],
}

describe('LF-064 Workbench mutation 增量刷新', () => {
  test('given 匹配项目事件 when typed subscription 收到通知 then 只转发该项目并在卸载时退订', () => {
    let listener: ((event: LinguistProjectMutationEvent) => void) | undefined
    let unsubscribed = false
    const received: LinguistProjectMutationEvent[] = []
    const unsubscribe = subscribeToProjectMutations(
      'project-a',
      (event) => received.push(event),
      (callback) => {
        listener = callback
        return () => {
          unsubscribed = true
        }
      },
    )

    listener?.({ ...proposalCreated, projectId: 'project-b' })
    listener?.(proposalCreated)
    unsubscribe()

    expect(received).toEqual([proposalCreated])
    expect(unsubscribed).toBe(true)
  })

  test('given 每项目 revision when 收到重复或乱序事件 then 保留最后一次已接受事件', () => {
    const accepted = reduceProjectMutation(
      'project-a',
      INITIAL_PROJECT_MUTATION_STATE,
      { ...proposalCreated, revision: 3 },
    )

    expect(reduceProjectMutation(
      'project-a',
      accepted,
      { ...proposalCreated, revision: 3 },
    )).toBe(accepted)
    expect(reduceProjectMutation(
      'project-a',
      accepted,
      { ...proposalCreated, revision: 2 },
    )).toBe(accepted)
    expect(reduceProjectMutation(
      'project-a',
      accepted,
      { ...proposalCreated, projectId: 'project-b', revision: 4 },
    )).toBe(accepted)
  })

  test('given proposal mutation when 规划刷新 then 只命中 proposal 与相关上下文 seam', () => {
    const state = reduceProjectMutation(
      'project-a',
      INITIAL_PROJECT_MUTATION_STATE,
      proposalCreated,
    )

    expect(getProjectMutationRefreshPlan(state)).toEqual({
      summary: false,
      segments: 'none',
      proposals: true,
      qa: false,
      context: true,
      resources: false,
      segmentIds: ['segment-205'],
    })
  })

  test('given UI proposal-reviewed when 规划刷新 then Grid、Proposal、QA 与 Timeline revision 同步前进', () => {
    const state = reduceProjectMutation(
      'project-a',
      INITIAL_PROJECT_MUTATION_STATE,
      {
        projectId: 'project-a',
        revision: 1,
        kind: 'proposal-reviewed',
        segmentIds: ['segment-205'],
        proposalIds: ['proposal-1'],
      },
    )

    expect(getProjectMutationRefreshPlan(state)).toMatchObject({
      summary: true,
      segments: 'affected-pages',
      proposals: true,
      qa: true,
      context: true,
      segmentIds: ['segment-205'],
    })
    expect(state.lastRevision).toBe(1)
  })

  test('given revision gap when 规划刷新 then 回拉摘要和当前页并刷新各受影响 seam', () => {
    const state = reduceProjectMutation(
      'project-a',
      INITIAL_PROJECT_MUTATION_STATE,
      { ...proposalCreated, revision: 4 },
    )

    expect(getProjectMutationRefreshPlan(state)).toEqual({
      summary: true,
      segments: 'current-page',
      proposals: true,
      qa: true,
      context: true,
      resources: true,
      segmentIds: ['segment-205'],
    })
  })

  test('given renderer reconnect when durable events 分页补拉 then 顺序应用后才 ack', async () => {
    const calls: string[] = []
    const events = [
      {
        projectId: 'project-a',
        revision: 1,
        sequence: 1,
        kind: 'job-updated' as const,
        jobId: 'job-1',
        job: { status: 'running' as const, cursor: 1, total: 3, completed: 1, failed: 0 },
      },
      {
        ...proposalCreated,
        revision: 2,
        sequence: 2,
      },
      {
        projectId: 'project-a',
        revision: 3,
        sequence: 3,
        kind: 'qa-updated' as const,
        qaFindingIds: ['qa-1'],
      },
    ]
    const replayed = await replayProjectMutations(
      'project-a',
      INITIAL_PROJECT_MUTATION_STATE,
      {
        consumerId: 'renderer-test',
        pull: async ({ afterSequence }) => {
          calls.push(`pull:${afterSequence}`)
          return afterSequence === 0
            ? { ok: true, data: { events: events.slice(0, 2), hasMore: true } }
            : { ok: true, data: { events: events.slice(2), hasMore: false } }
        },
        ack: async ({ throughSequence }) => {
          calls.push(`ack:${throughSequence}`)
          return {
            ok: true,
            data: {
              consumerId: 'renderer-test',
              sequence: throughSequence,
              ackedAt: '2026-07-29T00:00:00.000Z',
            },
          }
        },
      },
    )

    expect(calls).toEqual(['pull:0', 'pull:2', 'ack:3'])
    expect(replayed.lastSequence).toBe(3)
    expect(replayed.lastRevision).toBe(3)
    expect(replayed.latest?.event.kind).toBe('qa-updated')
    expect(replayed.latest?.gap).toBe(true)
    expect(getProjectMutationRefreshPlan(replayed)).toMatchObject({
      summary: true,
      segments: 'current-page',
      proposals: true,
      qa: true,
      context: true,
      resources: true,
    })
  })

  test('given malformed replay window when event sequence 重复或跳号 then fail closed 且不 ack', async () => {
    for (const sequence of [2, 4]) {
      let acknowledged = false
      await expect(replayProjectMutations(
        'project-a',
        { ...INITIAL_PROJECT_MUTATION_STATE, lastSequence: 2 },
        {
          pull: async () => ({
            ok: true,
            data: {
              events: [{ ...proposalCreated, revision: sequence, sequence }],
              hasMore: false,
            },
          }),
          ack: async () => {
            acknowledged = true
            throw new Error('must not ack')
          },
        },
      )).rejects.toThrow('INVALID_PROJECT_EVENT_REPLAY')
      expect(acknowledged).toBe(false)
    }
  })

  test('given segment、QA 与 asset mutation when 规划刷新 then 分别命中行页、QA 与资源 seam', () => {
    const plan = (event: LinguistProjectMutationEvent) => getProjectMutationRefreshPlan(
      reduceProjectMutation('project-a', INITIAL_PROJECT_MUTATION_STATE, event),
    )

    expect(plan({
      projectId: 'project-a',
      revision: 1,
      kind: 'segment-updated',
      segmentIds: ['segment-205'],
    })).toMatchObject({
      summary: true,
      segments: 'affected-pages',
      proposals: false,
      qa: true,
      context: true,
      resources: false,
    })
    expect(plan({
      projectId: 'project-a',
      revision: 1,
      kind: 'qa-updated',
      segmentIds: ['segment-205'],
    })).toMatchObject({
      summary: true,
      segments: 'none',
      qa: true,
      context: true,
      resources: false,
    })
    expect(plan({
      projectId: 'project-a',
      revision: 1,
      kind: 'asset-updated',
    })).toMatchObject({
      summary: true,
      segments: 'current-page',
      qa: false,
      context: true,
      resources: true,
    })
  })

  test('given 受影响 segment 分布在已加载页 when 规划页刷新 then 只返回命中页且去重', () => {
    const ids = Array.from({ length: 450 }, (_, index) => `segment-${index}`)
    const loadedRows = new Map([[205, {}], [399, {}], [420, {}]])

    expect(affectedLoadedPageOffsets(
      ['segment-205', 'segment-399', 'segment-420', 'segment-not-visible'],
      ids,
      loadedRows,
      200,
    )).toEqual([200, 400])
  })
})
