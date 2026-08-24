import { describe, expect, test } from 'bun:test'
import { createStore } from 'jotai'
import { activeViewAtom } from '@/atoms/active-view'
import { resolveActiveViewForMode } from '@/host/app-mode-registry'
import { appModeAtom } from '@/atoms/app-mode'
import { planningSelectedTodoIdAtom, planningTabAtom } from '@/atoms/planning-atoms'
import { openPlanningTodoFromReminder } from './PlanningReminderRail'

describe('PlanningReminderRail', () => {
  test('given Linguist mode, when opening a reminded Todo, then it switches to a visible Planning view', () => {
    const store = createStore()
    store.set(appModeAtom, 'linguist')
    store.set(activeViewAtom, 'conversations')

    openPlanningTodoFromReminder(store, 'todo-42')

    expect(store.get(appModeAtom)).toBe('agent')
    expect(store.get(activeViewAtom)).toBe('planning')
    expect(resolveActiveViewForMode(store.get(activeViewAtom), store.get(appModeAtom))).toBe('planning')
    expect(store.get(planningTabAtom)).toBe('todos')
    expect(store.get(planningSelectedTodoIdAtom)).toBe('todo-42')
  })
})
