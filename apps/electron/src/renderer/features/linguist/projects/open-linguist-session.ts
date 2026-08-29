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
  openTab,
  tabsAtom,
} from '@/atoms/tab-atoms'
import { enterLinguistNavigation } from '@/lib/linguist-navigation'
import { getAgentSessionLinguistProjectId } from '@/lib/agent-session-list'
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

export function activateLinguistAgentSession(
  store: JotaiStore,
  session: AgentSessionMeta,
  projectId: string,
  readOnlyHistory: boolean,
): boolean {
  const selected = readOnlyHistory
    ? selectProjectAgentSessionForHistory(store, projectId, session.id)
    : selectProjectAgentSession(store, projectId, session.id)
  if (!selected) return false

  const opened = openTab(store.get(tabsAtom).filter((tab) => tab.type !== 'linguist-project'), {
    type: 'agent',
    sessionId: session.id,
    title: session.title,
  })
  store.set(tabsAtom, opened.tabs)
  enterLinguistNavigation(store, opened.activeTabId, 'conversations')
  store.set(currentAgentSessionIdAtom, session.id)
  if (session.workspaceId) store.set(currentAgentWorkspaceIdAtom, session.workspaceId)
  store.set(agentSidePanelOpenAtomFamily(session.id), true)
  store.set(agentDiffPanelTabAtom, (previous) => new Map(previous).set(session.id, 'linguist'))
  return true
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

  const opened = await openProject({ projectId })
  if (!opened.ok) {
    if (
      opened.error.code === 'PROJECT_NOT_FOUND'
      || opened.error.code === 'PROJECT_UNHEALTHY'
      || opened.error.code === 'STORE_NOT_FOUND'
    ) {
      if (!activateLinguistAgentSession(store, session, projectId, true)) {
        return {
          ok: false,
          error: { code: 'INTERNAL', message: '项目会话绑定不一致' },
        }
      }
      return { ok: true, data: { projectId, readOnlyHistory: true } }
    }
    return opened
  }
  if (opened.data.project.id !== projectId || opened.data.health.projectId !== projectId) {
    return {
      ok: false,
      error: { code: 'INTERNAL', message: '项目身份校验失败' },
    }
  }

  const readOnlyHistory = opened.data.project.archivedAt !== undefined
    || session.archived === true
  if (!activateLinguistAgentSession(store, session, projectId, readOnlyHistory)) {
    return {
      ok: false,
      error: { code: 'INTERNAL', message: '项目会话绑定不一致' },
    }
  }
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
