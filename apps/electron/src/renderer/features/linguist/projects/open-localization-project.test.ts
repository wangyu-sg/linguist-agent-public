import { describe, expect, test } from 'bun:test'
import { createStore } from 'jotai'
import type {
  LinguistProjectInfo,
  LinguistProjectOpenResult,
  LinguistIpcResult,
} from '@proma/shared'
import { activeViewAtom } from '@/atoms/active-view'
import { appModeAtom } from '@/atoms/app-mode'
import { agentSessionsAtom, currentAgentSessionIdAtom } from '@/atoms/agent-atoms'
import { currentConversationIdAtom } from '@/atoms/chat-atoms'
import { projectCurrentAgentSessionIdMapAtom } from '@/atoms/project-agent-session-atoms'
import {
  activeTabIdAtom,
  openLocalizationProjectTab,
  openTab,
  tabMruAtom,
  tabsAtom,
} from '@/atoms/tab-atoms'
import { linguistWorkbenchUiStateAtomFamily } from './cat-workspace-atoms'
import {
  openLocalizationProject,
  restoreLastLocalizationProject,
} from './open-localization-project'

function project(): LinguistProjectInfo {
  return {
    schemaVersion: 1,
    id: 'prj-0000000000000001',
    name: '游戏本地化',
    sourceLocale: 'en',
    targetLocale: 'zh-CN',
    promaWorkspaceId: 'workspace-1',
    createdAt: '2026-07-01T08:00:00.000Z',
    updatedAt: '2026-07-01T08:00:00.000Z',
  }
}

describe('openLocalizationProject', () => {
  test('given 项目可打开 when 用户打开 then 以主进程元数据创建并激活 Project Tab', async () => {
    const store = createStore()
    store.set(appModeAtom, 'agent')
    store.set(activeViewAtom, 'projects')
    store.set(currentAgentSessionIdAtom, 'agent-1')
    store.set(currentConversationIdAtom, 'chat-1')
    const opened: LinguistIpcResult<LinguistProjectOpenResult> = {
      ok: true,
      data: {
        project: project(),
        health: {
          kind: 'quick',
          projectId: project().id,
          healthy: true,
          checkedAt: '2026-07-01T08:00:00.000Z',
          checks: [],
        },
      },
    }

    const result = await openLocalizationProject(
      store,
      project().id,
      async () => opened,
    )

    expect(result).toBe(opened)
    expect(store.get(tabsAtom).find((tab) => tab.type === 'linguist-project')).toEqual({
      id: 'linguist-project:prj-0000000000000001',
      type: 'linguist-project',
      projectId: 'prj-0000000000000001',
      title: '游戏本地化',
    })
    expect(store.get(activeTabIdAtom)).toBe('linguist-project:prj-0000000000000001')
    expect(store.get(appModeAtom)).toBe('linguist')
    expect(store.get(activeViewAtom)).toBe('conversations')
    expect(store.get(currentAgentSessionIdAtom)).toBeNull()
    expect(store.get(currentConversationIdAtom)).toBeNull()
  })

  test('given 主进程拒绝打开 when 用户打开 then 保持当前导航不变', async () => {
    const store = createStore()
    const chat = openTab([], { type: 'chat', sessionId: 'chat-1', title: 'Chat' })
    store.set(tabsAtom, chat.tabs)
    store.set(activeTabIdAtom, chat.activeTabId)
    store.set(appModeAtom, 'chat')
    store.set(currentConversationIdAtom, 'chat-1')
    const failed: LinguistIpcResult<LinguistProjectOpenResult> = {
      ok: false,
      error: { code: 'PROJECT_NOT_FOUND', message: 'missing' },
    }

    const result = await openLocalizationProject(
      store,
      project().id,
      async () => failed,
    )

    expect(result).toBe(failed)
    expect(store.get(tabsAtom)).toEqual(chat.tabs)
    expect(store.get(activeTabIdAtom)).toBe(chat.activeTabId)
    expect(store.get(appModeAtom)).toBe('chat')
    expect(store.get(currentConversationIdAtom)).toBe('chat-1')
  })

  test('given Project rail 切到同一 Full Agent when 返回 Linguist then 保留 Session 映射与 Workbench 状态', async () => {
    const store = createStore()
    const projectTab = openLocalizationProjectTab([], {
      projectId: project().id,
      title: project().name,
    })
    const agentTab = openTab(projectTab.tabs, {
      type: 'agent',
      sessionId: 'agent-1',
      title: '项目 Agent',
    })
    store.set(tabsAtom, agentTab.tabs)
    store.set(activeTabIdAtom, agentTab.activeTabId)
    store.set(appModeAtom, 'agent')
    store.set(currentAgentSessionIdAtom, 'agent-1')
    store.set(agentSessionsAtom, [{
      id: 'agent-1',
      title: '项目 Agent',
      agentRuntime: 'pi',
      linguistProjectId: project().id,
      linguistProjectName: project().name,
      createdAt: 1,
      updatedAt: 2,
    }])
    store.set(projectCurrentAgentSessionIdMapAtom, new Map([[project().id, 'agent-1']]))
    store.set(linguistWorkbenchUiStateAtomFamily(project().id), {
      activeAssetId: 'asset-1',
      activeSegmentId: 'segment-1',
      selectedSegmentIds: ['segment-1', 'segment-2'],
      agentPresentation: 'rail',
      agentRailWidth: 512,
    })

    await openLocalizationProject(store, project().id, async () => ({
      ok: true,
      data: {
        project: project(),
        health: {
          kind: 'quick',
          projectId: project().id,
          healthy: true,
          checkedAt: '2026-07-01T08:00:00.000Z',
          checks: [],
        },
      },
    }))

    expect(store.get(activeTabIdAtom)).toBe(`linguist-project:${project().id}`)
    expect(store.get(appModeAtom)).toBe('linguist')
    expect(store.get(currentAgentSessionIdAtom)).toBeNull()
    expect(store.get(projectCurrentAgentSessionIdMapAtom).get(project().id)).toBe('agent-1')
    expect(store.get(linguistWorkbenchUiStateAtomFamily(project().id))).toMatchObject({
      activeAssetId: 'asset-1',
      activeSegmentId: 'segment-1',
      selectedSegmentIds: ['segment-1', 'segment-2'],
      agentPresentation: 'rail',
      agentRailWidth: 512,
    })
  })

  test('given 打开过多个项目 when 从其他模式回到 Linguist then 恢复最后打开的项目 Tab', () => {
    const store = createStore()
    const first = openLocalizationProjectTab([], { projectId: 'project-1', title: '项目一' })
    const second = openLocalizationProjectTab(first.tabs, { projectId: 'project-2', title: '项目二' })
    const chat = openTab(second.tabs, { type: 'chat', sessionId: 'chat-1', title: 'Chat' })
    store.set(tabsAtom, chat.tabs)
    store.set(activeTabIdAtom, chat.activeTabId)
    store.set(appModeAtom, 'chat')
    store.set(activeViewAtom, 'projects')
    store.set(currentConversationIdAtom, 'chat-1')

    const restored = restoreLastLocalizationProject(store)

    expect(restored?.projectId).toBe('project-2')
    expect(store.get(activeTabIdAtom)).toBe('linguist-project:project-2')
    expect(store.get(appModeAtom)).toBe('linguist')
    expect(store.get(activeViewAtom)).toBe('conversations')
    expect(store.get(currentConversationIdAtom)).toBeNull()
  })

  test('given 已激活较早 Project Tab when 从其他模式回到 Linguist then 按 Project MRU 恢复', () => {
    const store = createStore()
    const first = openLocalizationProjectTab([], { projectId: 'project-1', title: '项目一' })
    const second = openLocalizationProjectTab(first.tabs, { projectId: 'project-2', title: '项目二' })
    const chat = openTab(second.tabs, { type: 'chat', sessionId: 'chat-1', title: 'Chat' })
    store.set(tabsAtom, chat.tabs)
    store.set(activeTabIdAtom, 'linguist-project:project-1')
    store.set(activeTabIdAtom, chat.activeTabId)

    const restored = restoreLastLocalizationProject(store)

    expect(store.get(tabMruAtom)).toContain('linguist-project:project-1')
    expect(restored?.projectId).toBe('project-1')
  })

  test('given 没有 Project Tab when 切到 Linguist then 进入项目管理空态而不显示旧会话', () => {
    const store = createStore()
    const agent = openTab([], { type: 'agent', sessionId: 'agent-1', title: 'Agent' })
    store.set(tabsAtom, agent.tabs)
    store.set(activeTabIdAtom, agent.activeTabId)
    store.set(currentAgentSessionIdAtom, 'agent-1')

    const restored = restoreLastLocalizationProject(store)

    expect(restored).toBeNull()
    expect(store.get(activeTabIdAtom)).toBeNull()
    expect(store.get(appModeAtom)).toBe('linguist')
    expect(store.get(activeViewAtom)).toBe('projects')
    expect(store.get(currentAgentSessionIdAtom)).toBeNull()
  })
})
