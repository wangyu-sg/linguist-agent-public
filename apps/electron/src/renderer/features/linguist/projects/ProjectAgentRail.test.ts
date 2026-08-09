import { describe, expect, test } from 'bun:test'
import { createStore } from 'jotai/vanilla'
import type { AgentSessionMeta, LinguistAssetInfo } from '@proma/shared'
import { agentSessionsAtom } from '@/atoms/agent-atoms'
import { projectCurrentAgentSessionIdMapAtom } from '@/atoms/project-agent-session-atoms'
import {
  buildProjectAgentQuickActions,
  buildProjectComposerContextChips,
  createProjectAgentQuickActionPendingPrompt,
  loadProjectAgentRailSession,
  shouldAutoExpandAgentForSideChat,
} from './ProjectAgentRail'
import {
  captureLinguistTurnContextSnapshot,
  createSegmentAgentReference,
  linguistSegmentAgentReferenceAtomFamily,
  linguistWorkbenchUiStateAtomFamily,
  resolveVisibleSegmentAgentReference,
} from './cat-workspace-atoms'

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

  test('given 无选择且无当前片段 when 展示片段级快捷动作 then 明确要求先定位片段', () => {
    const store = createStore()
    const uiState = store.get(linguistWorkbenchUiStateAtomFamily('prj-0000000000000001'))

    const actions = buildProjectAgentQuickActions(uiState)
    const segmentActions = actions.filter((action) =>
      !['qa', 'terms', 'import', 'export'].includes(action.id))

    expect(segmentActions.map((action) => action.id)).toEqual([
      'translate',
      'review',
      'proofread',
      'translate-suggest',
      'review-suggest',
      'proofread-suggest',
    ])
    for (const action of segmentActions) {
      expect(action.disabled).toBe(true)
      expect(action.scope).toBe('请先选择片段或激活当前片段。')
    }
    expect(createProjectAgentQuickActionPendingPrompt(
      store,
      'prj-0000000000000001',
      'session-1',
      'translate',
    )).toBeNull()
  })

  test('given 快捷动作清单 when 检查岗位与直达写回措辞 then 主按钮直达写回、先看建议变体保留待查看', () => {
    const store = createStore()
    const uiStateAtom = linguistWorkbenchUiStateAtomFamily('prj-0000000000000001')
    store.set(uiStateAtom, { selectedSegmentIds: ['seg-0000000000000001'] })

    const actions = buildProjectAgentQuickActions(store.get(uiStateAtom))
    const primary = actions.filter((action) => action.placement === 'primary')
    expect(primary.map((action) => [action.id, action.role])).toEqual([
      ['translate', 'translator'],
      ['review', 'reviewer'],
      ['proofread', 'proofreader'],
    ])
    for (const action of primary) {
      expect(action.prompt).toContain('直接写回项目')
      expect(action.prompt).toContain('待查看建议')
    }
    const suggest = actions.filter((action) => action.id.endsWith('-suggest'))
    expect(suggest.map((action) => [action.id, action.role])).toEqual([
      ['translate-suggest', 'translator'],
      ['review-suggest', 'reviewer'],
      ['proofread-suggest', 'proofreader'],
    ])
    for (const action of suggest) {
      expect(action.placement).toBe('overflow')
      expect(action.prompt).toContain('先把结果保留为待查看建议')
    }
    const projectTasks = actions.filter((action) =>
      ['qa', 'terms', 'import', 'export'].includes(action.id))
    expect(projectTasks.map((action) => action.role)).toEqual([
      'general',
      'general',
      'general',
      'general',
    ])
    for (const action of projectTasks) {
      expect(action.placement).toBe('overflow')
      expect(action.disabled).toBe(false)
    }
  })

  test('given 当前批次 when 项目级快捷动作冻结快照 then QA/导入不带批次、术语/导出带批次且都不带选择', () => {
    const store = createStore()
    const projectId = 'prj-0000000000000001'
    const uiStateAtom = linguistWorkbenchUiStateAtomFamily(projectId)
    store.set(uiStateAtom, {
      activeAssetId: 'ast-0000000000000001',
      activeSegmentId: 'seg-0000000000000001',
      selectedSegmentIds: ['seg-0000000000000001'],
    })

    const qa = createProjectAgentQuickActionPendingPrompt(
      store, projectId, 'session-1', 'qa', '2026-07-27T08:00:00.000Z',
    )!.linguistContext!
    expect(qa).not.toHaveProperty('assetId')
    expect(qa.selectedSegmentIds).toEqual([])

    const importContext = createProjectAgentQuickActionPendingPrompt(
      store, projectId, 'session-1', 'import', '2026-07-27T08:00:00.000Z',
    )!.linguistContext!
    expect(importContext).not.toHaveProperty('assetId')
    expect(importContext.selectedSegmentIds).toEqual([])

    for (const actionId of ['terms', 'export'] as const) {
      const context = createProjectAgentQuickActionPendingPrompt(
        store, projectId, 'session-1', actionId, '2026-07-27T08:00:00.000Z',
      )!.linguistContext!
      expect(context.assetId).toBe('ast-0000000000000001')
      expect(context.selectedSegmentIds).toEqual([])
      expect(context).not.toHaveProperty('activeSegmentId')
      expect(Object.isFrozen(context)).toBe(true)
    }
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

  test('given Workbench 当前范围 when 组装 Composer chips and 清除 selection then 保留项目绑定与批次范围', () => {
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

    // 问题 12：键盘/编辑焦点（activeSegmentId）不再隐式产生 Agent segment scope。
    expect(chips.map(({ id, label }) => ({ id, label }))).toEqual([
      { id: 'project', label: '完美诸神' },
      { id: 'asset', label: '活动公告.json' },
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

  test('given 项目 A 已引用片段 when 项目 B 组装 Agent 上下文 then A 的引用不进入 B 的 chip 或 turn snapshot', () => {
    const store = createStore()
    const projectAId = 'prj-0000000000000001'
    const projectBId = 'prj-0000000000000002'
    const reference = createSegmentAgentReference(
      'seg-0000000000000001',
      'ast-0000000000000001',
    )
    const assets = [{
      assetId: 'ast-0000000000000001',
      filename: '批次.xlf',
      formatId: 'xliff',
      segmentCount: 1,
      sourceSha256: 'a'.repeat(64),
      segmentCounts: { untranslated: 1, draft: 0, translated: 0, reviewed: 0 },
      currentStageCounts: { untouched: 1, draft: 0, confirmed: 0 },
      openQaCount: 0,
    }]

    store.set(linguistSegmentAgentReferenceAtomFamily(projectAId), reference)
    expect(captureLinguistTurnContextSnapshot(store, projectAId).context.activeSegmentId)
      .toBe('seg-0000000000000001')

    const projectBChips = buildProjectComposerContextChips({
      projectId: projectBId,
      projectName: '项目 B',
      assets,
      uiState: store.get(linguistWorkbenchUiStateAtomFamily(projectBId)),
      segmentReference: store.get(linguistSegmentAgentReferenceAtomFamily(projectBId)),
      onClearSelectedSegments: () => {},
    })

    expect(projectBChips.some((chip) => chip.id === 'segment-reference')).toBe(false)
    expect(captureLinguistTurnContextSnapshot(store, projectBId).context.activeSegmentId)
      .toBeUndefined()
  })

  test('given 显式为 Agent 引用片段 when 组装 Composer chips then 出现可移除 chip 且只认本项目资产', () => {
    const assets = [{
      assetId: 'ast-0000000000000001',
      filename: '活动公告.json',
      formatId: 'json',
      segmentCount: 2,
      sourceSha256: 'a'.repeat(64),
      segmentCounts: { untranslated: 2, draft: 0, translated: 0, reviewed: 0 },
      currentStageCounts: { untouched: 2, draft: 0, confirmed: 0 },
      openQaCount: 0,
    }]
    const store = createStore()
    const reference = createSegmentAgentReference(
      'seg-0000000000000001',
      'ast-0000000000000001',
      1722000000000,
    )
    const projectId = 'prj-0000000000000001'
    store.set(linguistSegmentAgentReferenceAtomFamily(projectId), reference)

    let removed = false
    const chips = buildProjectComposerContextChips({
      projectId,
      projectName: '完美诸神',
      assets,
      uiState: store.get(linguistWorkbenchUiStateAtomFamily(projectId)),
      segmentReference: store.get(linguistSegmentAgentReferenceAtomFamily(projectId)),
      onRemoveSegmentReference: () => {
        removed = true
        store.set(linguistSegmentAgentReferenceAtomFamily(projectId), undefined)
      },
      onClearSelectedSegments: () => {},
    })

    const segmentChip = chips.find((chip) => chip.id === 'segment-reference')
    expect(segmentChip?.label).toBe('引用片段')
    expect(segmentChip?.scope).toBe('Agent 引用片段 · seg-0000000000000001')
    segmentChip?.onRemove?.()
    expect(removed).toBe(true)
    expect(store.get(linguistSegmentAgentReferenceAtomFamily(projectId))).toBeUndefined()

    // 其他项目的残留引用不会出现在本项目 Agent session 上。
    const foreign = buildProjectComposerContextChips({
      projectId: 'prj-0000000000000002',
      projectName: '另一项目',
      assets: [{
        ...assets[0]!,
        assetId: 'ast-0000000000000009',
      }],
      uiState: store.get(linguistWorkbenchUiStateAtomFamily('prj-0000000000000002')),
      segmentReference: createSegmentAgentReference(
        'seg-0000000000000001',
        'ast-0000000000000001',
        1722000000000,
      ),
      onClearSelectedSegments: () => {},
    })
    expect(foreign.some((chip) => chip.id === 'segment-reference')).toBe(false)
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

  test('given Companion Chat 会话变化 when 判定自动展开 then 仅新打开或切换才展开', () => {
    // 新打开侧问答：rail → 自动展开 full。
    expect(shouldAutoExpandAgentForSideChat(null, 'conv-1', 'rail', true)).toBe(true)
    // 切换到另一个问答会话：同样视为新打开。
    expect(shouldAutoExpandAgentForSideChat('conv-1', 'conv-2', 'rail', true)).toBe(true)
    // 问题 11 回归：「返回工作台」后 conversationId 不变，不得再次被推回 full。
    expect(shouldAutoExpandAgentForSideChat('conv-1', 'conv-1', 'rail', true)).toBe(false)
    // 已在 full / 无展开能力 / 问答已关闭：都不触发。
    expect(shouldAutoExpandAgentForSideChat('conv-1', 'conv-2', 'full', true)).toBe(false)
    expect(shouldAutoExpandAgentForSideChat(null, 'conv-1', 'rail', false)).toBe(false)
    expect(shouldAutoExpandAgentForSideChat('conv-1', null, 'rail', true)).toBe(false)
  })

  test('given 显式片段引用 when 按项目资产校验可见性 then 只认本项目批次', () => {
    const reference = createSegmentAgentReference('seg-1', 'ast-1', 1722000000000)
    expect(reference).toEqual({ segmentId: 'seg-1', assetId: 'ast-1', capturedAt: 1722000000000 })

    const assets = [
      { assetId: 'ast-1' },
      { assetId: 'ast-2' },
    ] as unknown as LinguistAssetInfo[]
    expect(resolveVisibleSegmentAgentReference(reference, assets)).toBe(reference)
    expect(
      resolveVisibleSegmentAgentReference(
        createSegmentAgentReference('seg-9', 'ast-9'),
        assets,
      ),
    ).toBeUndefined()
    expect(resolveVisibleSegmentAgentReference(undefined, assets)).toBeUndefined()
  })
})
