import type { useStore } from 'jotai'
import type {
  LinguistIpcResult,
  LinguistProjectOpenRequest,
  LinguistProjectOpenResult,
} from '@proma/shared'
import { ensureProjectAgentSession } from './project-agent-session'
import { activateLinguistAgentSession } from './open-linguist-session'

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
): Promise<LinguistIpcResult<LinguistProjectOpenResult>> {
  const result = await openProject({ projectId })
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
  )) {
    return {
      ok: false,
      error: { code: 'INTERNAL', message: '项目会话绑定不一致' },
    }
  }
  return result
}
