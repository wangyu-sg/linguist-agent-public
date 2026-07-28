import type { AppMode } from '@/atoms/app-mode'

export const MODE_SWITCHER_MODES = [
  { value: 'agent', label: 'Agent' },
  { value: 'chat', label: 'Chat' },
  { value: 'linguist', label: 'Linguist' },
] as const satisfies readonly { value: AppMode; label: string }[]

type ModeNavigationKey = 'ArrowLeft' | 'ArrowRight' | 'Home' | 'End'

interface RestorableSession {
  id: string
  title: string
  archived?: boolean
}

interface RestorableTab {
  id?: string
  type: string
  title: string
  sessionId?: string
}

export function canRestoreSessionForMode(mode: AppMode): mode is 'agent' | 'chat' {
  return mode === 'agent' || mode === 'chat'
}

/** 按上次会话、已打开标签、最近会话的顺序选择模式落点。 */
export function findSessionToRestore(
  mode: 'agent' | 'chat',
  sessions: readonly RestorableSession[],
  lastId: string | null,
  tabs: readonly RestorableTab[],
  draftSessionIds: ReadonlySet<string>,
): RestorableSession | null {
  const last = lastId ? sessions.find((session) => session.id === lastId) : undefined
  if (last) return last

  const tab = tabs.find((item) => item.type === mode && item.sessionId)
  if (tab?.sessionId) return { id: tab.sessionId, title: tab.title }

  return sessions.find((session) => !session.archived && !draftSessionIds.has(session.id)) ?? null
}

export function getModeSliderTranslateX(mode: AppMode): number {
  return MODE_SWITCHER_MODES.findIndex((item) => item.value === mode) * 100
}

export function getNextMode(mode: AppMode, key: ModeNavigationKey): AppMode {
  if (key === 'Home') return MODE_SWITCHER_MODES[0].value
  if (key === 'End') return MODE_SWITCHER_MODES.at(-1)!.value

  const currentIndex = MODE_SWITCHER_MODES.findIndex((item) => item.value === mode)
  const direction = key === 'ArrowRight' ? 1 : -1
  const nextIndex = (currentIndex + direction + MODE_SWITCHER_MODES.length) % MODE_SWITCHER_MODES.length
  return MODE_SWITCHER_MODES[nextIndex]!.value
}
