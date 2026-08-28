import { expect, test } from 'bun:test'
import type { AgentSessionMeta } from '@proma/shared'
import { resolveProjectAgentSessionIds } from './project-agent-session-atoms'

test('Linguist 项目会话选择包含继承父会话归属的旧委派', () => {
  const parent = {
    id: 'parent',
    linguistProjectId: 'prj-1111111111111111',
    createdAt: 1,
    updatedAt: 1,
  } as AgentSessionMeta
  const child = {
    id: 'child',
    parentSessionId: parent.id,
    sourceDelegationId: 'delegation-1',
    createdAt: 2,
    updatedAt: 2,
  } as AgentSessionMeta

  const selected = resolveProjectAgentSessionIds(new Map(), [parent, child])

  expect(selected.get(parent.linguistProjectId!)).toBe(child.id)
})
