/**
 * App Mode Atom - 应用模式状态
 *
 * - chat: 对话模式
 * - agent: Agent 模式（原 Flow）
 * - linguist: 本地化工作模式
 *
 * Scratch 是 Tab/工具面，不再是用户主模式。历史持久化的 scratch
 * 值会安全回退到 Agent，避免旧 localStorage 让应用落入无入口模式。
 */

import { atomWithStorage, createJSONStorage } from 'jotai/utils'

export type PrimaryAppMode = 'agent' | 'chat' | 'linguist'

/** @deprecated 使用 PrimaryAppMode；保留别名以降低既有消费者的迁移成本。 */
export type AppMode = PrimaryAppMode

const primaryAppModeStorage = createJSONStorage<unknown>()

type PrimaryAppModeStorage = {
  getItem: (key: string, initialValue: PrimaryAppMode) => PrimaryAppMode
  setItem: (key: string, value: PrimaryAppMode) => void
  removeItem: (key: string) => void
  subscribe?: (
    key: string,
    callback: (value: PrimaryAppMode) => void,
    initialValue: PrimaryAppMode,
  ) => (() => void) | undefined
}

/** 将历史或损坏的持久化值收敛到安全的主模式。 */
export function normalizePrimaryAppMode(value: unknown): PrimaryAppMode {
  if (value === 'agent' || value === 'chat' || value === 'linguist') return value
  return 'agent'
}

const normalizedPrimaryAppModeStorage: PrimaryAppModeStorage = {
  getItem(key, initialValue) {
    return normalizePrimaryAppMode(primaryAppModeStorage.getItem(key, initialValue))
  },
  setItem(key, value) {
    primaryAppModeStorage.setItem(key, value)
  },
  removeItem(key) {
    primaryAppModeStorage.removeItem(key)
  },
  subscribe: primaryAppModeStorage.subscribe
    ? (key, callback, initialValue) => primaryAppModeStorage.subscribe!(
        key,
        (value) => callback(normalizePrimaryAppMode(value)),
        initialValue,
      )
    : undefined,
}

/** App 模式，自动持久化到 localStorage */
export const appModeAtom = atomWithStorage<PrimaryAppMode>(
  'proma-app-mode',
  'agent',
  normalizedPrimaryAppModeStorage,
)
