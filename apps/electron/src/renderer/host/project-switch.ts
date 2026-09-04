import { atom } from 'jotai'
import { agentChannelIdAtom, agentModelIdAtom, agentSessionsAtom, currentAgentSessionIdAtom, currentAgentWorkspaceIdAtom, unviewedCompletedSessionIdsAtom } from '../atoms/agent-atoms'
import { activeViewAtom } from '../atoms/active-view'
import { appModeAtom } from '../atoms/app-mode'
import { automationFormAtom } from '../atoms/automation-atoms'
import { activeTabIdAtom, openTab, tabsAtom } from '../atoms/tab-atoms'
import { channelFormDirtyAtom, settingsOpenAtom, settingsPendingSessionNavigationAtom } from '../atoms/settings-tab'
import { findLatestMainAgentSession, mergeFetchedAgentSessions, upsertAgentSession } from '../lib/agent-session-list'
import { resolveSessionAppMode } from './app-mode-registry'

// 所有项目入口共用代际；点击当前项目也必须取消较早的异步切换。
const projectSwitchGenerationAtom = atom(0)

export const selectProjectAtom = atom(null, async (get, set, { workspaceId, resetView }: { workspaceId: string; resetView?: boolean }) => {
  const generation = get(projectSwitchGenerationAtom) + 1
  set(projectSwitchGenerationAtom, generation)
  if (resetView === false) {
    // 内部工具页导航合同：只切 Workspace，不创建会话或改变工具页。
    if (!window.electronAPI.updateSettingsSync({ agentWorkspaceId: workspaceId })) throw new Error('项目设置保存失败')
    set(currentAgentWorkspaceIdAtom, workspaceId)
    return
  }
  const beforeFetch = get(agentSessionsAtom)
  const fetched = await window.electronAPI.listAgentSessions()
  if (get(projectSwitchGenerationAtom) !== generation) return
  const fetchedIds = new Set(fetched.map(session => session.id))
  // 保留 fetch 期间的新事件，删除只存在于旧 Renderer 快照的条目。
  const current = get(agentSessionsAtom).filter(session => fetchedIds.has(session.id) || !beforeFetch.includes(session))
  const sessions = mergeFetchedAgentSessions(current, fetched)
  set(agentSessionsAtom, sessions)
  let session = findLatestMainAgentSession(sessions, workspaceId, candidate => resolveSessionAppMode(candidate, sessions) === 'agent')
  if (!session) {
    session = await window.electronAPI.createAgentSession(undefined, get(agentChannelIdAtom) ?? undefined, workspaceId, get(agentModelIdAtom) ?? undefined)
    set(agentSessionsAtom, upsertAgentSession(get(agentSessionsAtom), session))
  }
  if (get(projectSwitchGenerationAtom) !== generation) return
  if (get(settingsOpenAtom) && get(channelFormDirtyAtom)) {
    set(settingsPendingSessionNavigationAtom, { type: 'agent', sessionId: session.id, title: session.title })
    return
  }
  // 现有同步 IPC 先原子落盘，再在同一 Jotai 写入中提交所有可见状态。
  // 不在任何 await 之前切标题，失败时原项目、会话和 Tab 自然保持原样。
  if (!window.electronAPI.updateSettingsSync({ agentWorkspaceId: workspaceId })) throw new Error('项目设置保存失败')
  const opened = openTab(get(tabsAtom), { type: 'agent', sessionId: session.id, title: session.title })
  set(tabsAtom, opened.tabs)
  set(activeTabIdAtom, opened.activeTabId)
  set(currentAgentSessionIdAtom, session.id)
  set(currentAgentWorkspaceIdAtom, workspaceId)
  set(appModeAtom, 'agent')
  set(activeViewAtom, 'conversations')
  set(settingsOpenAtom, false)
  set(automationFormAtom, { open: false, draft: null })
  set(unviewedCompletedSessionIdsAtom, previous => new Set([...previous].filter(id => id !== session.id)))
})
