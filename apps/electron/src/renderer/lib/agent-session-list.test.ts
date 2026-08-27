import { expect, test } from 'bun:test'
import type { AgentSessionMeta } from '@proma/shared'
import { getAgentSessionLinguistProjectId } from './agent-session-list'

const session = (input: Partial<AgentSessionMeta> & Pick<AgentSessionMeta, 'id'>): AgentSessionMeta =>
  input as AgentSessionMeta

test('委派子会话的列表归属跟随 Linguist 父会话', () => {
  const parent = session({ id: 'parent', linguistProjectId: 'project' })
  const child = session({ id: 'child', parentSessionId: parent.id, sourceDelegationId: 'delegation' })
  const ordinary = session({ id: 'ordinary' })
  const sessions = [parent, child, ordinary]

  expect(getAgentSessionLinguistProjectId(child, sessions)).toBe('project')
  expect(getAgentSessionLinguistProjectId(ordinary, sessions)).toBeUndefined()
})
