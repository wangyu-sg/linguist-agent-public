import { describe, expect, test } from 'bun:test'
import { createStore } from 'jotai'
import type { AgentSessionMeta } from '@proma/shared'
import { agentSessionsAtom } from '@/atoms/agent-atoms'
import { projectCurrentAgentSessionIdMapAtom } from '@/atoms/project-agent-session-atoms'
import {
  captureLinguistTurnContextSnapshot,
  clearQaFindingsCapability,
  clearLinguistWorkbenchUiStateAtom,
  createSegmentAgentReference,
  disposeLinguistWorkbenchAtomFamiliesAtom,
  getLinguistWorkbenchAtomFamilyCacheSizes,
  getInvalidLinguistWorkbenchLocationPatch,
  linguistQaFindingsCapabilityAtomFamily,
  linguistSegmentAgentReferenceAtomFamily,
  linguistTargetEditorCapabilityAtomFamily,
  linguistWorkbenchLocationsAtom,
  parseLinguistWorkbenchLocations,
  restoreLinguistWorkbenchLocationsAtom,
  serializeLinguistWorkbenchLocations,
  linguistWorkbenchUiStateAtomFamily,
  updateTargetEditorCapability,
  type LinguistQaFindingsCapability,
} from './cat-workspace-atoms'
import type { TargetEditorHandle } from './TargetEditor'

function editorHandle(): TargetEditorHandle {
  return {
    replace: () => true,
    insert: () => true,
    undo: () => true,
    redo: () => true,
    focus: () => undefined,
  }
}

describe('项目级 Workbench UI 状态', () => {
  test('given 两个项目的 TargetEditor when 注册能力 then 仅保存各自 segmentId 与命令句柄', () => {
    const store = createStore()
    const projectA = linguistTargetEditorCapabilityAtomFamily('project-a')
    const projectB = linguistTargetEditorCapabilityAtomFamily('project-b')
    const handleA = editorHandle()
    const handleB = editorHandle()

    store.set(projectA, updateTargetEditorCapability(undefined, 'segment-a', handleA))
    store.set(projectB, updateTargetEditorCapability(undefined, 'segment-b', handleB))

    expect(store.get(projectA)).toEqual({ segmentId: 'segment-a', handle: handleA })
    expect(store.get(projectB)).toEqual({ segmentId: 'segment-b', handle: handleB })
    expect(Object.keys(store.get(projectA)!)).toEqual(['segmentId', 'handle'])
  })

  test('given 新编辑器已注册 when 旧编辑器随后卸载 then segmentId 校验保留新能力', () => {
    const oldHandle = editorHandle()
    const newHandle = editorHandle()
    const oldCapability = updateTargetEditorCapability(undefined, 'segment-old', oldHandle)
    const current = updateTargetEditorCapability(oldCapability, 'segment-new', newHandle)

    expect(updateTargetEditorCapability(current, 'segment-old', undefined)).toBe(current)
    expect(updateTargetEditorCapability(current, 'segment-new', undefined)).toBeUndefined()
  })

  test('given 新 QA 能力已注册 when 旧 Workspace 随后卸载 then identity 校验保留新能力', () => {
    const oldCapability: LinguistQaFindingsCapability = {
      jumpToFinding: () => undefined,
      refreshAfterMutation: async () => undefined,
      refreshToken: 1,
    }
    const newCapability: LinguistQaFindingsCapability = {
      jumpToFinding: () => undefined,
      refreshAfterMutation: async () => undefined,
      refreshToken: 2,
    }

    expect(clearQaFindingsCapability(newCapability, oldCapability)).toBe(newCapability)
    expect(clearQaFindingsCapability(newCapability, newCapability)).toBeUndefined()
  })

  test('given 项目级 QA 能力 when Bottom Dock 调用跳转命令 then 转发 Finding 且不保存正文列表', () => {
    const store = createStore()
    const receivedIds: string[] = []
    const capabilityAtom = linguistQaFindingsCapabilityAtomFamily('project-a')
    const capability: LinguistQaFindingsCapability = {
      jumpToFinding: (finding) => receivedIds.push(finding.id),
      refreshAfterMutation: async () => undefined,
      refreshToken: 3,
    }
    store.set(capabilityAtom, capability)

    store.get(capabilityAtom)?.jumpToFinding({
      id: 'finding-a',
      segmentId: 'segment-a',
      code: 'QA001',
      severity: 'L1',
      issueType: 'ui_terminology',
      message: '术语不一致',
      status: 'open',
      disposition: 'defect',
      segmentRevision: 2,
      currentRevision: 2,
    })

    expect(receivedIds).toEqual(['finding-a'])
    expect(Object.keys(store.get(capabilityAtom)!)).toEqual([
      'jumpToFinding',
      'refreshAfterMutation',
      'refreshToken',
    ])
  })

  test('given 同一项目 Rail 与 Full Agent when 点击发送 then 捕获同一冻结 Context snapshot', () => {
    const store = createStore()
    const projectId = 'prj-0123456789abcdef'
    const projectState = linguistWorkbenchUiStateAtomFamily(projectId)
    store.set(projectState, {
      activeAssetId: 'ast-0123456789abcdef',
      activeSegmentId: 'seg-0123456789abcdef',
      selectedSegmentIds: ['seg-fedcba9876543210'],
    })

    const railSnapshot = captureLinguistTurnContextSnapshot(
      store,
      projectId,
      '2026-07-27T08:00:00.000Z',
    )
    const fullSnapshot = captureLinguistTurnContextSnapshot(
      store,
      projectId,
      '2026-07-27T08:00:00.000Z',
    )

    expect(fullSnapshot).toEqual(railSnapshot)
    expect(railSnapshot.context.uiRevision).toBe(1)
    expect(Object.isFrozen(railSnapshot.context)).toBe(true)
    expect(Object.isFrozen(railSnapshot.context.selectedSegmentIds)).toBe(true)
  })

  test('given 已捕获 Turn Context when Workbench 随后变化 then 旧 Turn 不漂移且下一 Turn revision 前进', () => {
    const store = createStore()
    const projectId = 'prj-0123456789abcdef'
    const projectState = linguistWorkbenchUiStateAtomFamily(projectId)
    store.set(projectState, {
      selectedSegmentIds: ['seg-0123456789abcdef'],
    })
    const first = captureLinguistTurnContextSnapshot(
      store,
      projectId,
      '2026-07-27T08:00:00.000Z',
    )

    store.set(projectState, {
      selectedSegmentIds: ['seg-fedcba9876543210'],
    })
    const second = captureLinguistTurnContextSnapshot(
      store,
      projectId,
      '2026-07-27T08:01:00.000Z',
    )

    expect(first.context.selectedSegmentIds).toEqual(['seg-0123456789abcdef'])
    expect(first.context.uiRevision).toBe(1)
    expect(second.context.selectedSegmentIds).toEqual(['seg-fedcba9876543210'])
    expect(second.context.uiRevision).toBe(2)
  })

  test('given 仅有键盘焦点片段而无显式引用 when 捕获 snapshot then 焦点不进 turn context；显式引用才进', () => {
    const store = createStore()
    const projectId = 'prj-0123456789abcdef'
    const projectState = linguistWorkbenchUiStateAtomFamily(projectId)
    store.set(projectState, { activeSegmentId: 'seg-0123456789abcdef' })

    // 仅焦点（编辑/滚动/恢复位置）时：默认只有 Project + Batch scope
    const focusOnly = captureLinguistTurnContextSnapshot(
      store,
      projectId,
      '2026-07-27T08:00:00.000Z',
    )
    expect(focusOnly.context.activeSegmentId).toBeUndefined()

    // 显式「为 Agent 引用」后：引用片段进入 turn context
    store.set(
      linguistSegmentAgentReferenceAtomFamily(projectId),
      createSegmentAgentReference('seg-0123456789abcdef', 'ast-0123456789abcdef'),
    )
    const withReference = captureLinguistTurnContextSnapshot(
      store,
      projectId,
      '2026-07-27T08:01:00.000Z',
    )
    expect(withReference.context.activeSegmentId).toBe('seg-0123456789abcdef')

    // 移除引用后恢复默认 scope，焦点变化不影响 turn context
    store.set(linguistSegmentAgentReferenceAtomFamily(projectId), undefined)
    store.set(projectState, { activeSegmentId: 'seg-fedcba9876543210' })
    const removed = captureLinguistTurnContextSnapshot(
      store,
      projectId,
      '2026-07-27T08:02:00.000Z',
    )
    expect(removed.context.activeSegmentId).toBeUndefined()
  })

  test('given 引用另一批次片段 when 捕获 snapshot then 批次随引用对齐且丢弃旧批次选择', () => {
    const store = createStore()
    const projectId = 'prj-0123456789abcdef'
    store.set(linguistWorkbenchUiStateAtomFamily(projectId), {
      activeAssetId: 'ast-aaaaaaaaaaaaaaaa',
      selectedSegmentIds: ['seg-aaaaaaaaaaaaaaaa'],
    })
    store.set(
      linguistSegmentAgentReferenceAtomFamily(projectId),
      createSegmentAgentReference('seg-bbbbbbbbbbbbbbbb', 'ast-bbbbbbbbbbbbbbbb'),
    )

    const snapshot = captureLinguistTurnContextSnapshot(
      store,
      projectId,
      '2026-07-27T08:01:00.000Z',
    )

    expect(snapshot.context).toMatchObject({
      assetId: 'ast-bbbbbbbbbbbbbbbb',
      activeSegmentId: 'seg-bbbbbbbbbbbbbbbb',
      selectedSegmentIds: [],
    })
  })

  test('given 合法的项目偏好 when 解析并再次序列化 then 保留位置与两侧布局且不串项目', () => {
    const locations = parseLinguistWorkbenchLocations({
      'project-a': {
        activeAssetId: 'asset-a',
        activeSegmentId: 'segment-a',
        assetNavigatorOpen: false,
        assetNavigatorWidth: 300,
        agentPresentation: 'full',
        agentRailWidth: 560,
        bottomDockOpen: false,
        bottomDockTab: 'qa',
        bottomDockHeight: 300,
      },
      'project-b': {
        activeSegmentId: 'segment-b',
        assetNavigatorOpen: true,
        assetNavigatorWidth: 900,
        agentPresentation: 'closed',
        agentRailWidth: 900,
        bottomDockOpen: true,
        bottomDockTab: 'invalid',
        bottomDockHeight: 900,
      },
      '': { activeAssetId: 'ignored' },
      'project-c': {
        activeAssetId: 42,
        assetNavigatorOpen: 'yes',
        assetNavigatorWidth: 'wide',
        agentPresentation: 'wide',
        agentRailWidth: 'wide',
      },
    })

    expect([...locations]).toEqual([
      ['project-a', {
        activeAssetId: 'asset-a',
        activeSegmentId: 'segment-a',
        assetNavigatorOpen: false,
        assetNavigatorWidth: 300,
        agentPresentation: 'full',
        agentRailWidth: 520,
        bottomDockOpen: false,
        bottomDockTab: 'qa',
        bottomDockHeight: 300,
      }],
      ['project-b', {
        activeSegmentId: 'segment-b',
        assetNavigatorOpen: true,
        assetNavigatorWidth: 420,
        agentPresentation: 'closed',
        agentRailWidth: 520,
        bottomDockOpen: true,
        bottomDockHeight: 480,
      }],
    ])
    expect(serializeLinguistWorkbenchLocations(locations)).toEqual({
      'project-a': {
        activeAssetId: 'asset-a',
        activeSegmentId: 'segment-a',
        assetNavigatorOpen: false,
        assetNavigatorWidth: 300,
        agentPresentation: 'full',
        agentRailWidth: 520,
        bottomDockOpen: false,
        bottomDockTab: 'qa',
        bottomDockHeight: 300,
      },
      'project-b': {
        activeSegmentId: 'segment-b',
        assetNavigatorOpen: true,
        assetNavigatorWidth: 420,
        agentPresentation: 'closed',
        agentRailWidth: 520,
        bottomDockOpen: true,
        bottomDockHeight: 480,
      },
    })
  })

  test('given 旧版 Rail 开合偏好 when 解析并序列化 then 迁移到 agentPresentation', () => {
    const locations = parseLinguistWorkbenchLocations({
      'project-a': { agentRailOpen: true },
      'project-b': { agentRailOpen: false },
    })

    expect(serializeLinguistWorkbenchLocations(locations)).toEqual({
      'project-a': { agentPresentation: 'rail' },
      'project-b': { agentPresentation: 'closed' },
    })
  })

  test('given 已保存的位置指向缺失 Asset 或 Segment when CAT 查询完成 then 仅清除无效 ID', () => {
    expect(getInvalidLinguistWorkbenchLocationPatch(
      { activeAssetId: 'asset-a', activeSegmentId: 'segment-a' },
      new Set(['asset-a']),
      new Set(['segment-a']),
    )).toBeNull()
    expect(getInvalidLinguistWorkbenchLocationPatch(
      { activeAssetId: 'missing-asset', activeSegmentId: 'segment-a' },
      new Set(['asset-a']),
      new Set(['segment-a']),
    )).toEqual({ activeAssetId: undefined, activeSegmentId: undefined })
    expect(getInvalidLinguistWorkbenchLocationPatch(
      { activeAssetId: 'asset-a', activeSegmentId: 'missing-segment' },
      new Set(['asset-a']),
      new Set(['segment-a']),
    )).toEqual({ activeSegmentId: undefined })
  })

  test('given 重启恢复的位置与 Rail 布局 when 回填 Project atom then 同项目恢复且已有运行期状态不被覆盖', () => {
    const store = createStore()
    store.set(linguistWorkbenchUiStateAtomFamily('project-b'), {
      search: '正在编辑',
      agentPresentation: 'rail',
      agentRailWidth: 500,
    })

    store.set(restoreLinguistWorkbenchLocationsAtom, {
      'project-a': {
        activeAssetId: 'asset-a',
        activeSegmentId: 'segment-a',
        assetNavigatorOpen: false,
        assetNavigatorWidth: 300,
        agentPresentation: 'rail',
        agentRailWidth: 560,
        bottomDockOpen: false,
        bottomDockTab: 'qa',
        bottomDockHeight: 300,
      },
      'project-b': {
        activeAssetId: 'asset-b',
        activeSegmentId: 'segment-b',
        agentPresentation: 'closed',
        agentRailWidth: 360,
      },
    })

    expect(store.get(linguistWorkbenchUiStateAtomFamily('project-a'))).toMatchObject({
      activeAssetId: 'asset-a',
      activeSegmentId: 'segment-a',
      agentPresentation: 'rail',
      agentRailWidth: 520,
      bottomDockOpen: false,
      bottomDockTab: 'qa',
      bottomDockHeight: 300,
    })
    const projectB = store.get(linguistWorkbenchUiStateAtomFamily('project-b'))
    expect(projectB.search).toBe('正在编辑')
    expect(projectB.agentPresentation).toBe('rail')
    expect(projectB.agentRailWidth).toBe(500)
    expect(projectB.activeAssetId).toBeUndefined()
    expect(projectB.activeSegmentId).toBeUndefined()
  })

  test('given 两个项目 when 修改其中一个项目的筛选、选择和布局 then 另一个项目保持默认状态', () => {
    const store = createStore()
    const projectA = linguistWorkbenchUiStateAtomFamily('project-a')
    const projectB = linguistWorkbenchUiStateAtomFamily('project-b')

    store.set(projectA, {
      activeAssetId: 'asset-a',
      activeSegmentId: 'segment-a',
      selectedSegmentIds: ['segment-a', 'segment-b'],
      search: 'menu',
      segmentStageStateFilter: 'draft',
      qaFilter: 'open',
      assetNavigatorOpen: false,
      assetNavigatorWidth: 300,
      bottomDockOpen: false,
      bottomDockTab: 'qa',
      bottomDockHeight: 320,
      agentPresentation: 'closed',
      agentRailWidth: 500,
    })

    expect(store.get(projectA)).toMatchObject({
      projectId: 'project-a',
      activeAssetId: 'asset-a',
      activeSegmentId: 'segment-a',
      selectedSegmentIds: ['segment-a', 'segment-b'],
      search: 'menu',
      segmentStageStateFilter: 'draft',
      qaFilter: 'open',
      assetNavigatorOpen: false,
      assetNavigatorWidth: 300,
      bottomDockOpen: false,
      bottomDockTab: 'qa',
      bottomDockHeight: 320,
      agentPresentation: 'closed',
      agentRailWidth: 500,
    })
    const stateB = store.get(projectB)
    expect(stateB).toMatchObject({
      projectId: 'project-b',
      selectedSegmentIds: [],
      search: '',
      assetNavigatorOpen: true,
      bottomDockOpen: true,
      agentPresentation: 'closed',
    })
    expect(stateB.activeAssetId).toBeUndefined()
    expect(stateB.activeSegmentId).toBeUndefined()
    expect(stateB.segmentStageStateFilter).toBeUndefined()
    expect(stateB.qaFilter).toBeUndefined()
  })

  test('given 两个项目的侧栏布局不同 when 读取 settings 持久化值 then 分别保存各自开合与宽度', () => {
    const store = createStore()
    store.set(linguistWorkbenchUiStateAtomFamily('project-a'), {
      assetNavigatorOpen: false,
      assetNavigatorWidth: 300,
      agentPresentation: 'full',
      agentRailWidth: 560,
      bottomDockOpen: false,
      bottomDockTab: 'qa',
      bottomDockHeight: 300,
    })
    store.set(linguistWorkbenchUiStateAtomFamily('project-b'), {
      assetNavigatorOpen: true,
      assetNavigatorWidth: 220,
      agentPresentation: 'closed',
      agentRailWidth: 360,
      bottomDockOpen: true,
      bottomDockTab: 'tm',
      bottomDockHeight: 240,
    })

    expect(store.get(linguistWorkbenchLocationsAtom)).toEqual({
      'project-a': {
        assetNavigatorOpen: false,
        assetNavigatorWidth: 300,
        agentPresentation: 'full',
        agentRailWidth: 520,
        bottomDockOpen: false,
        bottomDockTab: 'qa',
        bottomDockHeight: 300,
      },
      'project-b': {
        assetNavigatorOpen: true,
        assetNavigatorWidth: 220,
        agentPresentation: 'closed',
        agentRailWidth: 360,
        bottomDockOpen: true,
        bottomDockTab: 'tm',
        bottomDockHeight: 240,
      },
    })
  })

  test('given 同一项目已产生 UI 状态 when 关闭后重新取得项目 Atom then 恢复本次应用会话中的状态', () => {
    const store = createStore()
    store.set(linguistWorkbenchUiStateAtomFamily('project-a'), {
      activeAssetId: 'asset-a',
      activeSegmentId: 'segment-a',
      selectedSegmentIds: ['segment-a'],
      search: 'continue',
      bottomDockTab: 'context',
    })

    const reopened = store.get(linguistWorkbenchUiStateAtomFamily('project-a'))

    expect(reopened).toMatchObject({
      activeAssetId: 'asset-a',
      activeSegmentId: 'segment-a',
      selectedSegmentIds: ['segment-a'],
      search: 'continue',
      bottomDockTab: 'context',
    })
  })

  test('given 连续打开并关闭 500 个项目 when 释放 Workbench then Atom cache 不单向增长且位置状态可恢复', () => {
    const store = createStore()
    const before = getLinguistWorkbenchAtomFamilyCacheSizes()

    for (let index = 0; index < 500; index += 1) {
      const projectId = `project-cache-${index}`
      const workbenchAtom = linguistWorkbenchUiStateAtomFamily(projectId)
      linguistTargetEditorCapabilityAtomFamily(projectId)
      linguistQaFindingsCapabilityAtomFamily(projectId)
      linguistSegmentAgentReferenceAtomFamily(projectId)
      store.set(workbenchAtom, { search: `query-${index}` })
      store.set(disposeLinguistWorkbenchAtomFamiliesAtom, projectId)
    }

    expect(getLinguistWorkbenchAtomFamilyCacheSizes()).toEqual(before)
    expect(store.get(linguistWorkbenchUiStateAtomFamily('project-cache-499')).search)
      .toBe('query-499')
    store.set(disposeLinguistWorkbenchAtomFamiliesAtom, 'project-cache-499')
  })

  test('given 项目已有 UI 状态 when 项目被删除 then 清理该项目且不影响其他项目', () => {
    const store = createStore()
    const projectA = linguistWorkbenchUiStateAtomFamily('project-a')
    const projectB = linguistWorkbenchUiStateAtomFamily('project-b')
    store.set(projectA, { search: 'delete me', selectedSegmentIds: ['segment-a'] })
    store.set(projectB, { search: 'keep me', selectedSegmentIds: ['segment-b'] })

    store.set(clearLinguistWorkbenchUiStateAtom, 'project-a')

    expect(store.get(projectA)).toMatchObject({ search: '', selectedSegmentIds: [] })
    expect(store.get(projectB)).toMatchObject({
      search: 'keep me',
      selectedSegmentIds: ['segment-b'],
    })
  })

  test('given Workbench 与 Sidebar 选择项目会话 when 任一入口切换 then 共用同一真源', () => {
    const store = createStore()
    const sessions: AgentSessionMeta[] = [
      {
        id: 'session-a',
        title: 'A',
        agentRuntime: 'pi',
        linguistProjectId: 'project-a',
        linguistProjectName: 'Project A',
        createdAt: 1,
        updatedAt: 2,
      },
      {
        id: 'session-b',
        title: 'B',
        agentRuntime: 'pi',
        linguistProjectId: 'project-a',
        linguistProjectName: 'Project A',
        createdAt: 1,
        updatedAt: 3,
      },
    ]
    store.set(agentSessionsAtom, sessions)
    const projectA = linguistWorkbenchUiStateAtomFamily('project-a')

    store.set(projectA, { activeProjectAgentSessionId: 'session-a' })
    expect(store.get(projectCurrentAgentSessionIdMapAtom).get('project-a')).toBe('session-a')

    store.set(projectCurrentAgentSessionIdMapAtom, new Map([['project-a', 'session-b']]))
    expect(store.get(projectA).activeProjectAgentSessionId).toBe('session-b')
  })
})
