import { resolveSessionAppMode } from '../host/app-mode-registry'
import { expect, test } from 'bun:test'
import type { AgentSessionMeta } from '@proma/shared'
import {
  findLatestMainAgentSession,
  getDelegatedChildSessionStatus,
  getAgentSessionLinguistProjectId,
  getAgentSessionLinguistProjectName,
  isDelegationObservationVisible,
  selectDelegatedSession,
} from './agent-session-list'

const session = (input: Partial<AgentSessionMeta> & Pick<AgentSessionMeta, 'id'>): AgentSessionMeta =>
  input as AgentSessionMeta

test('委派子会话的项目归属和徽标跟随 Linguist 父会话', () => {
  const parent = session({
    id: 'parent',
    linguistProjectId: 'project',
    linguistProjectName: 'HOK翻译',
  })
  const child = session({ id: 'child', parentSessionId: parent.id, sourceDelegationId: 'delegation' })
  const grandchild = session({ id: 'grandchild', parentSessionId: child.id, sourceDelegationId: 'nested-delegation' })
  const ordinary = session({ id: 'ordinary' })
  const sessions = [parent, child, grandchild, ordinary]

  expect(getAgentSessionLinguistProjectId(child, sessions)).toBe('project')
  expect(getAgentSessionLinguistProjectName(child, sessions)).toBe('HOK翻译')
  expect(getAgentSessionLinguistProjectId(grandchild, sessions)).toBe('project')
  expect(getAgentSessionLinguistProjectName(grandchild, sessions)).toBe('HOK翻译')
  expect(getAgentSessionLinguistProjectId(ordinary, sessions)).toBeUndefined()
})

test('每个父会话只保留一个委派观察对象', () => {
  const first = selectDelegatedSession(new Map(), 'parent', 'child-1')
  const second = selectDelegatedSession(first, 'parent', 'child-2')

  expect(second).toEqual(new Map([['parent', 'child-2']]))
  expect(isDelegationObservationVisible(true, 'files', { leftTab: 'files', rightTab: 'delegation' })).toBe(true)
  expect(isDelegationObservationVisible(false, 'delegation', null)).toBe(false)
})

test('委派子会话实时状态优先于持久化状态', () => {
  const child = session({ id: 'child', delegationStatus: 'running' })

  expect(getDelegatedChildSessionStatus(child, new Map())).toBe('running')
  expect(getDelegatedChildSessionStatus(child, new Map([['child', 'completed']]))).toBe('completed')
})

test('项目快捷切换选择最近的普通主会话', () => {
  const sessions = [
    session({ id: 'older', workspaceId: 'target', updatedAt: 1 }),
    session({ id: 'latest', workspaceId: 'target', updatedAt: 5 }),
    session({ id: 'delegated', workspaceId: 'target', updatedAt: 9, sourceDelegationId: 'delegation' }),
    session({ id: 'linguist', workspaceId: 'target', updatedAt: 8, linguistProjectId: 'project' }),
    session({ id: 'other', workspaceId: 'other', updatedAt: 10 }),
  ]

  expect(findLatestMainAgentSession(sessions, 'target', candidate => resolveSessionAppMode(candidate, sessions) === 'agent')?.id).toBe('latest')
})
