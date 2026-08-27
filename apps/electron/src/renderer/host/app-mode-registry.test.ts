import { expect, test } from 'bun:test'
import { findSessionToRestore } from './app-mode-registry'

test('Agent 模式不会恢复 Linguist 父会话的委派子会话', () => {
  const sessions = [
    { id: 'parent', title: '项目会话', linguistProjectId: 'project' },
    {
      id: 'child',
      title: '审校子会话',
      parentSessionId: 'parent',
      sourceDelegationId: 'delegation',
    },
    { id: 'ordinary', title: '普通 Agent' },
  ]

  expect(findSessionToRestore('agent', sessions, 'child', [], new Set())).toEqual(
    sessions[2]!,
  )
})
