import { expect, test } from 'bun:test'
import type { AgentSessionMeta } from '@proma/shared'
import { buildAgentSessionTrees } from './agent-session-tree'

test('会话树将委派子会话收纳到父会话，并优先显示运行中的子会话', () => {
  const sessions: AgentSessionMeta[] = [
    { id: 'parent', title: '父会话', createdAt: 1, updatedAt: 1 },
    { id: 'idle', title: '空闲子会话', createdAt: 1, updatedAt: 3, parentSessionId: 'parent', sourceDelegationId: 'd1' },
    { id: 'running', title: '运行子会话', createdAt: 1, updatedAt: 2, parentSessionId: 'parent', sourceDelegationId: 'd2' },
  ]
  const trees = buildAgentSessionTrees(sessions, new Map([['running', 'running']]))
  expect(trees.map(tree => tree.session.id)).toEqual(['parent'])
  expect(trees[0]!.childSessions.map(session => session.id)).toEqual(['running', 'idle'])
})

test('父会话不在当前项目时，委派子会话仍作为根条目可达', () => {
  const child: AgentSessionMeta = { id: 'child', title: '子会话', createdAt: 1, updatedAt: 1, parentSessionId: 'other-project-parent', sourceDelegationId: 'd1' }
  expect(buildAgentSessionTrees([child])).toEqual([{ session: child, childSessions: [] }])
})
