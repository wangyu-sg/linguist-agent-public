import type { useStore } from 'jotai'
import type {
  LinguistIpcResult,
  LinguistProjectOpenRequest,
  LinguistProjectOpenResult,
} from '@proma/shared'
import {
  openLocalizationProjectTab,
  tabsAtom,
} from '@/atoms/tab-atoms'
import { enterLinguistNavigation } from '@/lib/linguist-navigation'

export { restoreLastLocalizationProject } from '@/lib/linguist-navigation'

type JotaiStore = ReturnType<typeof useStore>
type OpenProject = (
  input: LinguistProjectOpenRequest,
) => Promise<LinguistIpcResult<LinguistProjectOpenResult>>

/**
 * 打开项目服务后进入一等 Project Tab。失败时不改变当前导航。
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

  const opened = openLocalizationProjectTab(store.get(tabsAtom), {
    projectId: result.data.project.id,
    title: result.data.project.name,
  })
  store.set(tabsAtom, opened.tabs)
  enterLinguistNavigation(store, opened.activeTabId, 'conversations')
  return result
}
