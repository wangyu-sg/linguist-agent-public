import { describe, expect, test } from 'bun:test'
import { createStore } from 'jotai'
import {
  activeSessionIdAtom,
  activeTabIdAtom,
  closeTab,
  ensureScratchPadTab,
  focusScratchPadTab,
  getMostRecentLocalizationProjectTab,
  getPersistedTabMru,
  getPersistableTabState,
  openTab,
  openLocalizationProjectTab,
  projectCurrentAgentSessionIdMapAtom,
  restorePersistedTabState,
  tabStreamingMapAtom,
  tabIndicatorMapAtom,
  tabMruAtom,
  tabsAtom,
  updateTabTitle,
  SCRATCH_PAD_ID,
  type TabItem,
} from './tab-atoms'
import { agentSessionsAtom, agentStreamingStatesAtom } from './agent-atoms'

describe('Localization Project Tab', () => {
  test('given 本地化项目 when 打开并激活 then 不伪造 sessionId', () => {
    const result = openLocalizationProjectTab([], {
      projectId: 'project-1',
      title: '游戏本地化',
    })
    const projectTab = result.tabs.find((tab) => tab.type === 'linguist-project')
    const store = createStore()
    store.set(tabsAtom, result.tabs)
    store.set(activeTabIdAtom, result.activeTabId)

    expect(projectTab).toEqual({
      id: 'linguist-project:project-1',
      type: 'linguist-project',
      projectId: 'project-1',
      title: '游戏本地化',
    })
    expect(projectTab && 'sessionId' in projectTab).toBe(false)
    expect(store.get(activeSessionIdAtom)).toBeNull()
  })

  test('given Agent 与项目入口 when 切到 Chat 再回项目 then 项目 Tab 始终保留且关闭不影响会话', () => {
    const agent = openTab([], { type: 'agent', sessionId: 'agent-1', title: 'Agent' })
    const linguist = openLocalizationProjectTab(agent.tabs, {
      projectId: 'project-1',
      title: '游戏本地化',
    })
    const chat = openTab(linguist.tabs, {
      type: 'chat',
      sessionId: 'chat-1',
      title: 'Chat',
    })
    const reopened = openLocalizationProjectTab(chat.tabs, {
      projectId: 'project-1',
      title: '游戏本地化',
    })
    const closed = closeTab(reopened.tabs, reopened.activeTabId, reopened.activeTabId)

    expect(chat.tabs.map((tab) => tab.type)).toEqual([
      'scratch',
      'linguist-project',
      'chat',
    ])
    expect(reopened.tabs.filter((tab) => tab.type === 'linguist-project')).toHaveLength(1)
    expect(closed.tabs.some((tab) => tab.type === 'linguist-project')).toBe(false)
    expect(closed.tabs.some((tab) => tab.type === 'chat')).toBe(true)
  })

  test('given Project、Agent 与 Preview Tab when 关闭 Project Tab then 不删除项目外的 Tab', () => {
    const project = openLocalizationProjectTab([], { projectId: 'project-1', title: '项目' })
    const preview = openTab(project.tabs, { type: 'preview', sessionId: 'agent-1', title: '预览' })
    const closed = closeTab(preview.tabs, preview.activeTabId, 'linguist-project:project-1')

    expect(closed.tabs.map((tab) => tab.id)).toEqual([
      '__scratch-pad__',
      'agent-1',
      '__preview__:agent-1',
    ])
    expect(closed.activeTabId).toBe('__preview__:agent-1')
  })

  test('given Project Tab when 激活 then 项目入口进入 MRU 且可稳定取回', () => {
    const first = openLocalizationProjectTab([], { projectId: 'project-1', title: '项目一' })
    const second = openLocalizationProjectTab(first.tabs, { projectId: 'project-2', title: '项目二' })
    const store = createStore()
    store.set(tabsAtom, second.tabs)
    store.set(activeTabIdAtom, second.activeTabId)
    store.set(activeTabIdAtom, 'linguist-project:project-1')

    expect(store.get(tabMruAtom)).toEqual([
      'linguist-project:project-1',
      'linguist-project:project-2',
    ])
    expect(getMostRecentLocalizationProjectTab(store.get(tabsAtom), store.get(tabMruAtom))?.projectId)
      .toBe('project-1')
  })

  test('given 最近 Project Tab when 关闭 then 从 MRU 移除并激活相邻项目', () => {
    const first = openLocalizationProjectTab([], { projectId: 'project-1', title: '项目一' })
    const second = openLocalizationProjectTab(first.tabs, { projectId: 'project-2', title: '项目二' })
    const store = createStore()
    store.set(tabsAtom, second.tabs)
    store.set(activeTabIdAtom, second.activeTabId)
    const closed = closeTab(store.get(tabsAtom), store.get(activeTabIdAtom), second.activeTabId)
    store.set(tabsAtom, closed.tabs)
    store.set(activeTabIdAtom, closed.activeTabId)

    expect(store.get(activeTabIdAtom)).toBe('linguist-project:project-1')
    expect(store.get(tabMruAtom)).toEqual(['linguist-project:project-1'])
  })

  test('given Project Tab 已打开 when 打开 Agent Preview then Preview 仍只归属 Agent Session', () => {
    const linguist = openLocalizationProjectTab([], {
      projectId: 'project-1',
      title: '游戏本地化',
    })
    const preview = openTab(linguist.tabs, {
      type: 'preview',
      sessionId: 'agent-1',
      title: '预览',
    })

    expect(preview.tabs.map((tab) => tab.type)).toEqual([
      'scratch',
      'linguist-project',
      'agent',
      'preview',
    ])
    expect(preview.tabs.find((tab) => tab.type === 'preview')).toMatchObject({
      sessionId: 'agent-1',
    })
    expect(preview.tabs.find((tab) => tab.type === 'linguist-project')).not.toHaveProperty('sessionId')
  })

  test('given 项目和会话 Tab when 持久化、补齐 Scratch、更新项目名 then 项目身份不丢失', () => {
    const linguist = openLocalizationProjectTab([], {
      projectId: 'project-1',
      title: '旧项目名',
    })
    const chat = openTab(linguist.tabs, {
      type: 'chat',
      sessionId: 'chat-1',
      title: 'Chat',
    })
    const ensured = ensureScratchPadTab(chat.tabs.filter((tab) => tab.type !== 'scratch'))
    const renamed = updateTabTitle(ensured, 'project-1', '新项目名')
    const persisted = getPersistableTabState(renamed, 'linguist-project:project-1')

    expect(ensured.map((tab) => tab.type)).toEqual([
      'scratch',
      'linguist-project',
      'chat',
    ])
    expect(persisted).toEqual({
      tabs: [
        {
          id: 'linguist-project:project-1',
          type: 'linguist-project',
          projectId: 'project-1',
          title: '新项目名',
        },
        {
          id: 'chat-1',
          type: 'chat',
          sessionId: 'chat-1',
          title: 'Chat',
        },
      ],
      activeTabId: 'linguist-project:project-1',
    })
  })

  test('given Project MRU when 持久化并恢复 then 只保留有效项目入口顺序', () => {
    const first = openLocalizationProjectTab([], { projectId: 'project-1', title: '项目一' })
    const second = openLocalizationProjectTab(first.tabs, { projectId: 'project-2', title: '项目二' })
    const persisted = getPersistableTabState(
      second.tabs,
      second.activeTabId,
      ['linguist-project:project-1', 'missing', 'linguist-project:project-2'],
    )
    const restored = restorePersistedTabState(persisted, new Set(), new Map([
      ['project-1', 'active' as const],
      ['project-2', 'active' as const],
    ]))

    expect(getPersistedTabMru(persisted, restored.tabs)).toEqual([
      'linguist-project:project-1',
      'linguist-project:project-2',
    ])
  })

  test('given 项目当前 Agent Session 映射 when Agent 运行 then Project Tab 显示运行；未映射则 idle', () => {
    const first = openLocalizationProjectTab([], {
      projectId: 'project-1',
      title: '项目一',
    })
    const second = openLocalizationProjectTab(first.tabs, {
      projectId: 'project-2',
      title: '项目二',
    })
    const store = createStore()
    store.set(tabsAtom, second.tabs)
    store.set(agentSessionsAtom, [{
      id: 'agent-1',
      title: '项目一会话',
      linguistProjectId: 'project-1',
      linguistProjectName: '项目一',
      createdAt: 1,
      updatedAt: 2,
    }])
    store.set(projectCurrentAgentSessionIdMapAtom, new Map([
      ['project-1', 'agent-1'],
    ]))
    store.set(agentStreamingStatesAtom, new Map([
      ['agent-1', { running: true, content: '', toolActivities: [] }],
    ]))

    expect(store.get(tabStreamingMapAtom)).toEqual(new Map([
      ['linguist-project:project-1', true],
      ['linguist-project:project-2', false],
    ]))
    expect(store.get(tabIndicatorMapAtom)).toEqual(new Map([
      ['linguist-project:project-1', 'running'],
      ['linguist-project:project-2', 'idle'],
    ]))
  })

  test('given 旧会话与已删除项目的持久化数据 when 恢复 then 旧数据可读且项目进入 repair state', () => {
    const restored = restorePersistedTabState({
      tabs: [
        { id: 'chat-1', type: 'chat', sessionId: 'chat-1', title: '旧 Chat' },
        {
          id: 'linguist-project:deleted',
          type: 'linguist-project',
          projectId: 'deleted',
          title: '已删除项目',
        },
      ],
      activeTabId: 'linguist-project:deleted',
    }, new Set(['chat-1']), new Map())

    expect(restored).toEqual({
      tabs: [
        { id: 'chat-1', type: 'chat', sessionId: 'chat-1', title: '旧 Chat' },
        {
          id: 'linguist-project:deleted',
          type: 'linguist-project',
          projectId: 'deleted',
          title: '已删除项目',
          repairState: 'missing',
        },
      ],
      activeTabId: 'linguist-project:deleted',
    })

    const archived = restorePersistedTabState({
      tabs: [{
        id: 'linguist-project:archived',
        type: 'linguist-project',
        projectId: 'archived',
        title: '归档项目',
      }],
      activeTabId: 'linguist-project:archived',
    }, new Set(), new Map([['archived', 'archived']]))
    expect(archived.tabs[0]).toEqual({
      id: 'linguist-project:archived',
      type: 'linguist-project',
      projectId: 'archived',
      title: '归档项目',
      repairState: undefined,
    })
  })

  test('given 缺失项目的历史会话仍存在 when 恢复 then 保留只读历史选择', () => {
    const restored = restorePersistedTabState({
      tabs: [{
        id: 'linguist-project:deleted',
        type: 'linguist-project',
        projectId: 'deleted',
        title: '已删除项目',
        historySessionId: 'agent-history',
      }],
      activeTabId: 'linguist-project:deleted',
    }, new Set(['agent-history']), new Map())

    expect(restored.tabs[0]).toMatchObject({
      repairState: 'missing',
      historySessionId: 'agent-history',
    })
  })
})

function createAgentTab(id = 'agent-1'): TabItem {
  return {
    id,
    type: 'agent',
    sessionId: id,
    title: 'Agent 会话',
  }
}

describe('Scratch Pad Tab 恢复', () => {
  test('given 草稿已拖到右侧分屏 when Ctrl+Tab 聚焦草稿 then 恢复完整草稿并关闭分屏', () => {
    const result = focusScratchPadTab([
      createAgentTab(),
      {
        id: '__preview__:agent-1',
        type: 'preview',
        sessionId: 'agent-1',
        title: '预览：README.md',
      },
    ])

    expect(result.activeTabId).toBe(SCRATCH_PAD_ID)
    expect(result.scratchPanelOpen).toBe(false)
    expect(result.tabs.map((tab) => tab.id)).toEqual([
      SCRATCH_PAD_ID,
      'agent-1',
      '__preview__:agent-1',
    ])
  })

  test('given 顶部已有固定草稿 when 再次聚焦 then 不重复创建草稿标签', () => {
    const existingScratch: TabItem = {
      id: SCRATCH_PAD_ID,
      type: 'scratch',
      sessionId: SCRATCH_PAD_ID,
      title: 'Scratch Pad',
    }

    const result = focusScratchPadTab([existingScratch, createAgentTab()])

    expect(result.tabs.filter((tab) => tab.id === SCRATCH_PAD_ID)).toEqual([existingScratch])
    expect(result.scratchPanelOpen).toBe(false)
  })
})
