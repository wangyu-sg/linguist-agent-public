/**
 * 项目列表共享资源。
 *
 * 项目列表的真源仍在主进程；此处只缓存一次 IPC 结果。ProjectsView 与后续
 * Linguist Sidebar 读取同一 atom，因此首次加载、错误状态和显式刷新不会漂移。
 */

import { atom } from 'jotai'
import { atomWithRefresh, unwrap } from 'jotai/utils'
import type { LinguistProjectInfo } from '@proma/shared'
import { describeLinguistIpcError } from './project-utils'

export type LinguistProjectListState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; projects: LinguistProjectInfo[] }

async function loadLinguistProjectList(): Promise<LinguistProjectListState> {
  try {
    const result = await window.electronAPI.linguistProjectsList({ includeArchived: true })
    return result.ok
      ? { status: 'ready', projects: result.data }
      : { status: 'error', message: describeLinguistIpcError(result.error) }
  } catch {
    return { status: 'error', message: '与主进程通信异常（INTERNAL）' }
  }
}

/** 同一 Jotai store 内共享 in-flight Promise 与最近一次结果。 */
const linguistProjectListResourceAtom = atomWithRefresh(loadLinguistProjectList)
const loadingProjectListState: LinguistProjectListState = { status: 'loading' }
const unwrappedLinguistProjectListAtom = unwrap(
  linguistProjectListResourceAtom,
  () => loadingProjectListState,
)

/** 供 ProjectsView 与 Sidebar 直接消费的三态列表。 */
export const linguistProjectListStateAtom = atom<LinguistProjectListState>((get) => (
  get(unwrappedLinguistProjectListAtom)
))

/** 创建、归档、迁移后失效共享缓存；下一次读取自动复用新结果。 */
export const refreshLinguistProjectListAtom = atom(null, (_get, set) => {
  set(linguistProjectListResourceAtom)
})
