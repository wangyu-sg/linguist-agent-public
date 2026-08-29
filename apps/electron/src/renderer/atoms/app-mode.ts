/**
 * App Mode Atom - 应用模式状态
 *
 * - chat: 对话模式
 * - agent: Agent 模式（原 Flow）
 * - linguist: 本地化工作模式
 */

import { atomWithStorage } from 'jotai/utils'

export type PrimaryAppMode = 'agent' | 'chat' | 'linguist'
export type AppMode = PrimaryAppMode

/** App 模式，自动持久化到 localStorage */
export const appModeAtom = atomWithStorage<PrimaryAppMode>(
  'proma-app-mode',
  'agent',
)
