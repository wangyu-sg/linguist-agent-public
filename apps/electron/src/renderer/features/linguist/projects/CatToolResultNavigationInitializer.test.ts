import { describe, expect, test } from 'bun:test'
import { createStore } from 'jotai'
import type {
  LinguistCatContextResult,
  LinguistIpcResult,
  LinguistProjectOpenResult,
} from '@proma/shared'
import { activeTabIdAtom, tabsAtom } from '@/atoms/tab-atoms'
import { linguistWorkbenchUiStateAtomFamily } from './cat-workspace-atoms'
import { navigateToCatResult } from './CatToolResultNavigationInitializer'

const PROJECT_ID = 'prj-0000000000000001'
const OTHER_PROJECT_ID = 'prj-0000000000000002'
const SEGMENT_ID = 'seg-0000000000000001'
const ASSET_ID = 'ast-0000000000000001'

function openedProject(
  projectId = PROJECT_ID,
): LinguistIpcResult<LinguistProjectOpenResult> {
  return {
    ok: true,
    data: {
      project: {
        schemaVersion: 1,
        id: projectId,
        name: '游戏本地化',
        sourceLocale: 'en',
        targetLocale: 'zh-CN',
        promaWorkspaceId: 'workspace-1',
        createdAt: '2026-07-01T08:00:00.000Z',
        updatedAt: '2026-07-01T08:00:00.000Z',
        qualityProfile: 'balanced',
      },
      health: {
        projectId,
        healthy: true,
        checkedAt: '2026-07-01T08:00:00.000Z',
        checks: [],
      },
    },
  }
}

function segmentContext(
  segmentId = SEGMENT_ID,
): LinguistIpcResult<LinguistCatContextResult> {
  return {
    ok: true,
    data: {
      segment: {
        id: segmentId,
        assetId: ASSET_ID,
        ordinal: 0,
        source: '客户正文不进入导航状态',
        target: '',
        sourceLocale: 'en',
        targetLocale: 'zh-CN',
        status: 'untranslated',
        locked: false,
        revision: 0,
        sourceHash: 'source-hash',
      },
      qaFindings: [],
      tmMatches: [],
      termMatches: [],
    },
  }
}

describe('CAT Tool Result 定位', () => {
  test('given Project-only result when 点击 then 打开并聚焦原生 Project Tab', async () => {
    const store = createStore()
    const outcome = await navigateToCatResult(
      store,
      { projectId: PROJECT_ID },
      {
        openProject: async () => openedProject(),
        getContext: async () => {
          throw new Error('Project-only 不应读取 Segment')
        },
      },
    )

    expect(outcome).toBe('project')
    expect(store.get(activeTabIdAtom)).toBe(`linguist-project:${PROJECT_ID}`)
    expect(store.get(tabsAtom).some(
      (tab) => tab.type === 'linguist-project' && tab.projectId === PROJECT_ID,
    )).toBe(true)
  })

  test('given Project + Segment result when Segment 属于项目 then 清除过滤并激活命中行', async () => {
    const store = createStore()
    store.set(linguistWorkbenchUiStateAtomFamily(PROJECT_ID), {
      search: '旧筛选',
      segmentStageStateFilter: 'confirmed',
    })

    const outcome = await navigateToCatResult(
      store,
      { projectId: PROJECT_ID, segmentId: SEGMENT_ID },
      {
        openProject: async () => openedProject(),
        getContext: async (input) => {
          expect(input).toEqual({ projectId: PROJECT_ID, segmentId: SEGMENT_ID })
          return segmentContext()
        },
      },
    )

    expect(outcome).toBe('segment')
    expect(store.get(linguistWorkbenchUiStateAtomFamily(PROJECT_ID))).toMatchObject({
      activeAssetId: ASSET_ID,
      activeSegmentId: SEGMENT_ID,
      assetActiveSegmentIds: { [ASSET_ID]: SEGMENT_ID },
      search: '',
      segmentStageStateFilter: undefined,
    })
  })

  test('given 跨项目或错配 Segment when 点击 then 不污染其他项目选择', async () => {
    const store = createStore()
    store.set(linguistWorkbenchUiStateAtomFamily(OTHER_PROJECT_ID), {
      activeAssetId: 'ast-0000000000000002',
      activeSegmentId: 'seg-0000000000000002',
    })

    const outcome = await navigateToCatResult(
      store,
      { projectId: PROJECT_ID, segmentId: SEGMENT_ID },
      {
        openProject: async () => openedProject(),
        getContext: async () => segmentContext('seg-0000000000000003'),
      },
    )

    expect(outcome).toBe('project')
    expect(store.get(linguistWorkbenchUiStateAtomFamily(PROJECT_ID)).activeSegmentId).toBeUndefined()
    expect(store.get(linguistWorkbenchUiStateAtomFamily(OTHER_PROJECT_ID))).toMatchObject({
      activeAssetId: 'ast-0000000000000002',
      activeSegmentId: 'seg-0000000000000002',
    })
  })

  test('given 主进程返回另一项目 when 点击 then 拒绝导航且不创建错误 Tab', async () => {
    const store = createStore()
    const outcome = await navigateToCatResult(
      store,
      { projectId: PROJECT_ID },
      {
        openProject: async () => openedProject(OTHER_PROJECT_ID),
        getContext: async () => segmentContext(),
      },
    )

    expect(outcome).toBe('none')
    expect(store.get(tabsAtom).some((tab) => tab.type === 'linguist-project')).toBe(false)
  })
})
