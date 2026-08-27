import type { createStore } from 'jotai/vanilla'
import type {
  AgentSessionMeta,
  LinguistIpcResult,
  LinguistProjectOpenRequest,
  LinguistProjectOpenResult,
} from '@proma/shared'
import {
  agentDiffPanelTabAtom,
  agentSessionsAtom,
  agentSidePanelOpenAtomFamily,
  currentAgentSessionIdAtom,
  currentAgentWorkspaceIdAtom,
} from '@/atoms/agent-atoms'
import {
  activeTabIdAtom,
  openLocalizationProjectTab,
  openTab,
  tabsAtom,
} from '@/atoms/tab-atoms'
import { enterLinguistNavigation } from '@/lib/linguist-navigation'
import { getAgentSessionLinguistProjectId } from '@/lib/agent-session-list'
import { openLocalizationProject } from './open-localization-project'
import {
  ensureProjectAgentSession,
  selectProjectAgentSession,
  selectProjectAgentSessionForHistory,
} from './project-agent-session'

type JotaiStore = ReturnType<typeof createStore>
type OpenProject = (
  input: LinguistProjectOpenRequest,
) => Promise<LinguistIpcResult<LinguistProjectOpenResult>>

export interface OpenLinguistSessionResult {
  projectId: string
  readOnlyHistory: boolean
}

function openMissingProjectHistory(
  store: JotaiStore,
  session: AgentSessionMeta,
  projectId: string,
): void {
  const opened = openLocalizationProjectTab(store.get(tabsAtom), {
    projectId,
    title: session.linguistProjectName ?? projectId,
  })
  store.set(
    tabsAtom,
    opened.tabs.map((tab) =>
      tab.id === opened.activeTabId && tab.type === 'linguist-project'
        ? {
            ...tab,
            repairState: 'missing' as const,
            historySessionId: session.id,
          }
        : tab,
    ),
  )
  enterLinguistNavigation(store, opened.activeTabId, 'conversations')
}

/** 所有 Linguist 会话入口共用：先打开权威项目，再进入原生 Agent Tab。 */
export async function openLinguistAgentSession(
  store: JotaiStore,
  sessionId: string,
  openProject: OpenProject = (input) => window.electronAPI.linguistProjectsOpen(input),
): Promise<LinguistIpcResult<OpenLinguistSessionResult>> {
  const session = store.get(agentSessionsAtom).find((item) => item.id === sessionId)
  const sessions = store.get(agentSessionsAtom)
  const projectId = session ? getAgentSessionLinguistProjectId(session, sessions) : undefined
  if (!session || !projectId) {
    return {
      ok: false,
      error: { code: 'INVALID_INPUT', message: '会话不是 Linguist 项目会话' },
    }
  }

  const opened = await openLocalizationProject(store, projectId, openProject)
  if (!opened.ok) {
    if (
      opened.error.code === 'PROJECT_NOT_FOUND'
      || opened.error.code === 'PROJECT_UNHEALTHY'
      || opened.error.code === 'STORE_NOT_FOUND'
    ) {
      openMissingProjectHistory(store, session, projectId)
      return { ok: true, data: { projectId, readOnlyHistory: true } }
    }
    return opened
  }

  const readOnlyHistory = opened.data.project.archivedAt !== undefined
    || session.archived === true
  const selected = readOnlyHistory
    ? selectProjectAgentSessionForHistory(store, projectId, sessionId)
    : selectProjectAgentSession(store, projectId, sessionId)
  if (!selected) {
    return {
      ok: false,
      error: { code: 'INTERNAL', message: '项目会话绑定不一致' },
    }
  }
  const openedAgent = openTab(store.get(tabsAtom), {
    type: 'agent',
    sessionId: session.id,
    title: session.title,
  })
  store.set(tabsAtom, openedAgent.tabs)
  store.set(activeTabIdAtom, openedAgent.activeTabId)
  store.set(currentAgentSessionIdAtom, session.id)
  if (session.workspaceId) store.set(currentAgentWorkspaceIdAtom, session.workspaceId)
  return { ok: true, data: { projectId, readOnlyHistory } }
}

/**
 * K3「Agent 能力 → Files」入口：确保项目会话存在后进入 Full AgentView，
 * 并展开原生 Files 侧面板。不新建第二套文件管理界面。
 */
export async function openLinguistProjectFilesPanel(
  store: JotaiStore,
  projectId: string,
  openProject: OpenProject = (input) => window.electronAPI.linguistProjectsOpen(input),
): Promise<LinguistIpcResult<OpenLinguistSessionResult>> {
  const ensured = await ensureProjectAgentSession(store, projectId)
  if (!ensured.ok) return ensured
  const opened = await openLinguistAgentSession(store, ensured.data.id, openProject)
  if (!opened.ok) return opened
  store.set(agentSidePanelOpenAtomFamily(ensured.data.id), true)
  store.set(agentDiffPanelTabAtom, (prev) => new Map(prev).set(ensured.data.id, 'files'))
  return opened
}
