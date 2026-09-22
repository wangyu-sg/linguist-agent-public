import { expect, test } from 'bun:test'
import { createStore } from 'jotai'
import type { AgentSessionMeta } from '@proma/shared'
import {
  agentDiffPanelTabAtom,
  agentSessionsAtom,
  agentSidePanelLayoutAtomFamily,
  agentSidePanelOpenAtomFamily,
  currentAgentSessionIdAtom,
  unviewedCompletedSessionIdsAtom,
} from '@/atoms/agent-atoms'
import {
  activeTabAtom,
  activeTabIdAtom,
  getPersistableTabState,
  getPersistedTabMru,
  openTab,
  sessionViewStateMapAtom,
  tabMruAtom,
  tabsAtom,
} from '@/atoms/tab-atoms'
import { channelFormDirtyAtom, settingsOpenAtom, settingsPendingSessionNavigationAtom } from '@/atoms/settings-tab'
import { previewFileMapAtom } from '@/atoms/preview-atoms'
import { projectSwitchGenerationAtom } from '@/host/project-switch'
import { restoreLastLocalizationProject } from '@/lib/linguist-navigation'
import { getInitialTabSwitchIndex } from '@/lib/tab-switching'
import { activateLinguistAgentSession } from './open-linguist-session'

const session = {
  id: 'project-session', title: '项目会话', createdAt: 1, updatedAt: 1,
  workspaceId: 'workspace-a', linguistProjectId: 'project-a',
} as AgentSessionMeta

test('跨 Agent/Chat 访问保留 MRU，Ctrl+Tab 返回上个访问会话而不是最近更新项', () => {
  const store = createStore()
  for (const id of ['a', 'b', 'c']) {
    const opened = openTab(store.get(tabsAtom), { type: id === 'b' ? 'chat' : 'agent', sessionId: id, title: id })
    store.set(tabsAtom, opened.tabs)
    store.set(activeTabIdAtom, opened.activeTabId)
  }
  const mru = store.get(tabMruAtom)
  expect(mru).toEqual(['c', 'b', 'a'])
  const candidates = [{ id: 'c' }, { id: 'a' }, { id: 'b' }]
  expect(candidates[getInitialTabSwitchIndex(candidates, 'c', mru, 1)]?.id).toBe('b')
  const persisted = getPersistableTabState(store.get(tabsAtom), store.get(activeTabIdAtom), mru)
  expect(getPersistedTabMru(persisted)).toEqual(['c', 'b', 'a'])
  expect(getPersistedTabMru({ mru: ['', 1, 'a', 'a', ...Array.from({ length: 60 }, (_, i) => `s-${i}`)] })).toHaveLength(50)
})

for (const entry of ['activate', 'restore'] as const) {
  test(`${entry} 项目会话恢复原生预览、保留右栏收起与宽度，并清除已查看标记`, () => {
    const store = createStore()
    store.set(agentSessionsAtom, [session])
    store.set(currentAgentSessionIdAtom, session.id)
    store.set(projectSwitchGenerationAtom, 1)
    store.set(sessionViewStateMapAtom, new Map([[session.id, { previewTabOpen: true, lastView: 'preview' }]]))
    store.set(previewFileMapAtom, new Map([[session.id, { filePath: '/workspace/reference.md' }]]))
    store.set(agentSidePanelOpenAtomFamily(session.id), false)
    const layout = { width: 730, hasOpenedWideWorkspace: true, widePanelWidthOverride: 730 }
    store.set(agentSidePanelLayoutAtomFamily(session.id), layout)
    store.set(unviewedCompletedSessionIdsAtom, new Set([session.id, 'other-session']))

    if (entry === 'activate') {
      expect(activateLinguistAgentSession(store, session, 'project-a', false, 1)).toBe(true)
    } else {
      store.set(settingsOpenAtom, true)
      expect(restoreLastLocalizationProject(store)).toBe(session.id)
      expect(store.get(settingsOpenAtom)).toBe(false)
    }

    expect(store.get(tabsAtom).map(tab => tab.type)).toEqual(['agent', 'preview'])
    expect(store.get(activeTabAtom)).toMatchObject({ type: 'preview', sessionId: session.id })
    expect(store.get(agentSidePanelOpenAtomFamily(session.id))).toBe(false)
    expect(store.get(agentSidePanelLayoutAtomFamily(session.id))).toEqual(layout)
    expect(store.get(agentDiffPanelTabAtom).get(session.id)).toBe('linguist')
    expect([...store.get(unviewedCompletedSessionIdsAtom)]).toEqual(['other-session'])
  })
}

test('切回项目会话保留原有右栏页签；过期导航不清其它会话状态', () => {
  const store = createStore()
  store.set(agentSessionsAtom, [session])
  store.set(projectSwitchGenerationAtom, 2)
  store.set(agentDiffPanelTabAtom, new Map([[session.id, 'files']]))
  store.set(unviewedCompletedSessionIdsAtom, new Set([session.id]))
  activateLinguistAgentSession(store, session, 'project-a', false, 1)
  expect(store.get(tabsAtom)).toEqual([])
  expect(store.get(unviewedCompletedSessionIdsAtom).has(session.id)).toBe(true)
  activateLinguistAgentSession(store, session, 'project-a', false, 2)
  expect(store.get(agentDiffPanelTabAtom).get(session.id)).toBe('files')
  expect(store.get(activeTabAtom)).toMatchObject({ type: 'agent', sessionId: session.id })
})


test('恢复项目会话遇到未保存的渠道表单时只登记待确认导航', () => {
  const store = createStore()
  store.set(agentSessionsAtom, [session])
  store.set(settingsOpenAtom, true)
  store.set(channelFormDirtyAtom, true)
  store.set(unviewedCompletedSessionIdsAtom, new Set([session.id]))
  expect(restoreLastLocalizationProject(store)).toBeNull()
  expect(store.get(settingsPendingSessionNavigationAtom)).toEqual({ type: 'agent', sessionId: session.id, title: session.title })
  expect(store.get(settingsOpenAtom)).toBe(true)
  expect(store.get(tabsAtom)).toEqual([])
  expect(store.get(currentAgentSessionIdAtom)).toBeNull()
  expect(store.get(unviewedCompletedSessionIdsAtom).has(session.id)).toBe(true)
})
