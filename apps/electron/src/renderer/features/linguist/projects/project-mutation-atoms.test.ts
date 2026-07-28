import { describe, expect, test } from 'bun:test'
import type { LinguistProjectMutationEvent } from '@proma/shared'
import {
  INITIAL_PROJECT_MUTATION_STATE,
  affectedLoadedPageOffsets,
  getProjectMutationRefreshPlan,
  reduceProjectMutation,
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
