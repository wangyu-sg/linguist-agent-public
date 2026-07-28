import { describe, expect, test } from 'bun:test'
import { createStore } from 'jotai/vanilla'
import type { AgentSessionMeta } from '@proma/shared'
import { agentSessionsAtom } from '@/atoms/agent-atoms'
import { projectCurrentAgentSessionIdMapAtom } from '@/atoms/project-agent-session-atoms'
import { linguistWorkbenchUiStateAtomFamily } from './cat-workspace-atoms'
import {
  buildProjectAgentQuickActions,
  buildProjectComposerContextChips,
  createProjectAgentQuickActionPendingPrompt,
  loadProjectAgentRailSession,
} from './ProjectAgentRail'

function session(id: string, projectId: string): AgentSessionMeta {
  return {
    id,
    title: id,
    agentRuntime: 'pi',
    linguistProjectId: projectId,
    linguistProjectName: projectId,
    createdAt: 1,
    updatedAt: 2,
  }
}

function segmentIds(count: number): string[] {
  return Array.from(
    { length: count },
    (_, index) => `seg-${index.toString(16).padStart(16, '0')}`,
  )
}

describe('ProjectAgentRail', () => {
  test.each([
    {
      name: '无选择但有当前片段',
      selectedSegmentIds: [],
      activeSegmentId: 'seg-0000000000000001',
      disabled: false,
      scope: '当前片段',
    },
    {
      name: '选择 1 段',
      selectedSegmentIds: ['seg-0000000000000001'],
      activeSegmentId: undefined,
      disabled: false,
      scope: '已选 1 个片段',
    },
    {
      name: '选择 50 段',
      selectedSegmentIds: segmentIds(50),
      activeSegmentId: undefined,
      disabled: false,
      scope: '已选 50 个片段',
    },
    {
      name: '选择 51 段',
      selectedSegmentIds: segmentIds(51),
      activeSegmentId: undefined,
      disabled: true,
      scope: '请缩小到 50 段以内',
    },
    {
      name: '选择超过 Context 上限',
      selectedSegmentIds: segmentIds(101),
      activeSegmentId: undefined,
      disabled: true,
      scope: '请缩小到 50 段以内',
    },
  ])('given $name when 展示翻译与审校快捷动作 then 范围不会静默截断', ({
    selectedSegmentIds,
    activeSegmentId,
    disabled,
    scope,
  }) => {
    const store = createStore()
    const uiStateAtom = linguistWorkbenchUiStateAtomFamily('prj-0000000000000001')
    store.set(uiStateAtom, { selectedSegmentIds: [...selectedSegmentIds], activeSegmentId })

    const actions = buildProjectAgentQuickActions(store.get(uiStateAtom))
    const translate = actions.find((action) => action.id === 'translate')!
    const review = actions.find((action) => action.id === 'review')!

    expect(translate.disabled).toBe(disabled)
    expect(review.disabled).toBe(disabled)
    expect(translate.scope).toContain(scope)
    expect(review.scope).toContain(scope)

    const pending = createProjectAgentQuickActionPendingPrompt(
      store,
      'prj-0000000000000001',
      'session-1',
      'translate',
      '2026-07-27T08:00:00.000Z',
    )
    expect(pending === null).toBe(disabled)
    if (pending && selectedSegmentIds.length > 0) {
      expect(pending.linguistContext?.selectedSegmentIds).toHaveLength(
        selectedSegmentIds.length,
      )
    }
  })

  test('given 无选择且无当前片段 when 展示翻译与审校动作 then 明确要求先定位片段', () => {
    const store = createStore()
    const uiState = store.get(linguistWorkbenchUiStateAtomFamily('prj-0000000000000001'))

    const actions = buildProjectAgentQuickActions(uiState)

    expect(actions.filter((action) => action.id !== 'qa')).toMatchObject([
      { id: 'translate', disabled: true, scope: '请先选择片段或激活当前片段。' },
      { id: 'review', disabled: true, scope: '请先选择片段或激活当前片段。' },
    ])
    expect(createProjectAgentQuickActionPendingPrompt(
      store,
      'prj-0000000000000001',
      'session-1',
      'translate',
    )).toBeNull()
  })

  test('given 任意 selection when 运行 QA then prompt 与冻结 Context 都明确是整个项目', () => {
    const store = createStore()
    const projectId = 'prj-0000000000000001'
    const uiStateAtom = linguistWorkbenchUiStateAtomFamily(projectId)
    store.set(uiStateAtom, {
      activeAssetId: 'ast-0000000000000001',
      activeSegmentId: 'seg-0000000000000001',
      selectedSegmentIds: segmentIds(101),
    })

    const pending = createProjectAgentQuickActionPendingPrompt(
      store,
      projectId,
      'session-1',
      'qa',
      '2026-07-27T08:00:00.000Z',
    )!
    const context = pending.linguistContext!

    expect(pending.message).toContain('整个项目')
    expect(pending.message).toContain('当前选择不限制检查范围')
    expect(context).toMatchObject({
      projectId,
      selectedSegmentIds: [],
    })
    expect(context).not.toHaveProperty('assetId')
    expect(context).not.toHaveProperty('activeSegmentId')
    expect(Object.isFrozen(context)).toBe(true)
    expect(buildProjectAgentQuickActions(store.get(uiStateAtom))
      .find((action) => action.id === 'qa')?.label).toBe('项目 QA')
  })

  test('given 点击翻译动作时已选 1 段 when 随后选择变化 then pending prompt 保留点击时冻结快照', () => {
    const store = createStore()
    const projectId = 'prj-0000000000000001'
    const uiStateAtom = linguistWorkbenchUiStateAtomFamily(projectId)
    store.set(uiStateAtom, {
      selectedSegmentIds: ['seg-0000000000000001'],
    })

    const pending = createProjectAgentQuickActionPendingPrompt(
      store,
      projectId,
      'session-1',
      'translate',
      '2026-07-27T08:00:00.000Z',
    )!
    store.set(uiStateAtom, {
      selectedSegmentIds: ['seg-0000000000000002'],
    })
    const context = pending.linguistContext!

    expect(pending.message).toContain('已选 1 个片段')
    expect(context.selectedSegmentIds).toEqual([
      'seg-0000000000000001',
    ])
    expect(Object.isFrozen(context)).toBe(true)
  })

  test('given Workbench 当前范围 when 组装 Composer chips and 清除 selection then 保留项目绑定与活动范围', () => {
    const store = createStore()
    const uiStateAtom = linguistWorkbenchUiStateAtomFamily('prj-0000000000000001')
    store.set(uiStateAtom, {
      activeAssetId: 'ast-0000000000000001',
      activeSegmentId: 'seg-0000000000000001',
      selectedSegmentIds: [
        'seg-0000000000000001',
        'seg-0000000000000002',
      ],
    })
    const clearSelection = (): void => {
      store.set(uiStateAtom, { selectedSegmentIds: [] })
    }

    const chips = buildProjectComposerContextChips({
      projectId: 'prj-0000000000000001',
      projectName: '完美诸神',
      assets: [{
        assetId: 'ast-0000000000000001',
        filename: '活动公告.json',
        formatId: 'json',
        segmentCount: 2,
        sourceSha256: 'a'.repeat(64),
        segmentCounts: { untranslated: 2, draft: 0, translated: 0, reviewed: 0 },
        currentStageCounts: { untouched: 2, draft: 0, confirmed: 0 },
        openQaCount: 0,
      }],
      uiState: store.get(uiStateAtom),
      onClearSelectedSegments: clearSelection,
    })

    expect(chips.map(({ id, label }) => ({ id, label }))).toEqual([
      { id: 'project', label: '完美诸神' },
      { id: 'asset', label: '活动公告.json' },
      { id: 'active-segment', label: '当前片段' },
      { id: 'selection', label: '已选 2 段' },
    ])
    expect(chips.every((chip) => !chip.scope.includes('/Users/'))).toBe(true)

    chips.find((chip) => chip.id === 'selection')?.onRemove?.()

    expect(store.get(uiStateAtom)).toMatchObject({
      projectId: 'prj-0000000000000001',
      activeAssetId: 'ast-0000000000000001',
      activeSegmentId: 'seg-0000000000000001',
      selectedSegmentIds: [],
    })
  })

  test('given 项目已有会话 when 首次展开 rail then 直接复用且不创建新会话', async () => {
    const store = createStore()
    const existing = session('alpha-existing', 'alpha')
    store.set(agentSessionsAtom, [existing])
    let createCalls = 0

    const state = await loadProjectAgentRailSession(store, 'alpha', async () => {
      createCalls += 1
      return { ok: true, data: session('unexpected', 'alpha') }
    })

    expect(state).toEqual({ status: 'ready', sessionId: existing.id })
    expect(createCalls).toBe(0)
    expect(store.get(projectCurrentAgentSessionIdMapAtom).get('alpha')).toBe(existing.id)
  })

  test('given 项目没有会话 when 首次展开 rail then 创建一次并返回原生会话', async () => {
    const store = createStore()
    const created = session('alpha-created', 'alpha')
    let createCalls = 0

    const state = await loadProjectAgentRailSession(store, 'alpha', async () => {
      createCalls += 1
      return { ok: true, data: created }
    })

    expect(state).toEqual({ status: 'ready', sessionId: created.id })
    expect(createCalls).toBe(1)
    expect(store.get(agentSessionsAtom)).toEqual([created])
  })

  test('given 会话创建失败 when 展开 rail then fail-closed 且允许后续重试', async () => {
    const store = createStore()
    const failed = await loadProjectAgentRailSession(store, 'alpha', async () => ({
      ok: false,
      error: { code: 'INTERNAL', message: 'provider unavailable' },
    }))
    const rejected = await loadProjectAgentRailSession(store, 'alpha', async () => {
      throw new Error('ipc disconnected')
    })
    const recovered = await loadProjectAgentRailSession(store, 'alpha', async () => ({
      ok: true,
      data: session('alpha-recovered', 'alpha'),
    }))

    expect(failed).toEqual({
      status: 'error',
      error: { code: 'INTERNAL', message: 'provider unavailable' },
    })
    expect(rejected).toEqual({
      status: 'error',
      error: { code: 'INTERNAL', message: '项目 Agent 会话创建失败' },
    })
    expect(recovered).toEqual({ status: 'ready', sessionId: 'alpha-recovered' })
  })

  test('given 两个项目 when 分别展开 rail then 会话选择按项目隔离', async () => {
    const store = createStore()

    const alpha = await loadProjectAgentRailSession(store, 'alpha', async () => ({
      ok: true,
      data: session('alpha-session', 'alpha'),
    }))
    const beta = await loadProjectAgentRailSession(store, 'beta', async () => ({
      ok: true,
      data: session('beta-session', 'beta'),
    }))

    expect(alpha).toEqual({ status: 'ready', sessionId: 'alpha-session' })
    expect(beta).toEqual({ status: 'ready', sessionId: 'beta-session' })
    expect(store.get(projectCurrentAgentSessionIdMapAtom)).toEqual(new Map([
      ['alpha', 'alpha-session'],
      ['beta', 'beta-session'],
    ]))
  })
})
