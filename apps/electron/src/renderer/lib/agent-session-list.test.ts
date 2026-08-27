import { expect, test } from 'bun:test'
import type { AgentSessionMeta } from '@proma/shared'
import {
  getAgentSessionLinguistProjectId,
  getAgentSessionLinguistProjectName,
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
