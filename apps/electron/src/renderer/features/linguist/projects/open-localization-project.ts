import type { useStore } from 'jotai'
import type {
  LinguistIpcResult,
  LinguistProjectOpenRequest,
  LinguistProjectOpenResult,
} from '@proma/shared'
import { agentDiffPanelTabAtom, agentSidePanelOpenAtomFamily } from '@/atoms/agent-atoms'
import { ensureProjectAgentSession } from './project-agent-session'
import { activateLinguistAgentSession } from './open-linguist-session'
import { beginProjectNavigationAtom, projectSwitchGenerationAtom } from '@/host/project-switch'

export { restoreLastLocalizationProject } from '@/lib/linguist-navigation'

type JotaiStore = ReturnType<typeof useStore>
type OpenProject = (
  input: LinguistProjectOpenRequest,
) => Promise<LinguistIpcResult<LinguistProjectOpenResult>>

/**
 * 打开项目服务后进入项目 Agent，并在右侧工作区展示 CAT。
 */
export async function openLocalizationProject(
  store: JotaiStore,
  projectId: string,
  openProject: OpenProject = (input) => window.electronAPI.linguistProjectsOpen(input),
  generation = store.set(beginProjectNavigationAtom),
): Promise<LinguistIpcResult<LinguistProjectOpenResult>> {
  const result = await openProject({ projectId })
  if (store.get(projectSwitchGenerationAtom) !== generation) return result
  if (!result.ok) return result
  if (
    result.data.project.id !== projectId
    || result.data.health.projectId !== projectId
  ) {
    return {
      ok: false,
      error: { code: 'INTERNAL', message: '项目身份校验失败' },
    }
  }

  const session = await ensureProjectAgentSession(store, projectId)
  if (!session.ok) return session
  if (!activateLinguistAgentSession(
    store,
    session.data,
    projectId,
    result.data.project.archivedAt !== undefined,
    generation,
  )) {
    return {
      ok: false,
      error: { code: 'INTERNAL', message: '项目会话绑定不一致' },
    }
  }
  if (store.get(projectSwitchGenerationAtom) === generation) {
    store.set(agentSidePanelOpenAtomFamily(session.data.id), true)
    store.set(agentDiffPanelTabAtom, (previous) => new Map(previous).set(session.data.id, 'linguist'))
  }
  return result
}
