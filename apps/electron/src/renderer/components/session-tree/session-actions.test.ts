import { describe, expect, test } from 'bun:test'
import { deleteSessionTarget } from './session-actions'

describe('Session actions', () => {
  test('given Linguist session target when 当前 app mode 未参与分派 then 只走 Agent 删除入口', async () => {
    const calls: string[] = []

    await deleteSessionTarget(
      { kind: 'linguist-session', id: 'session-1', projectId: 'project-1' },
      {
        deleteChatConversation: async (id) => {
          calls.push(`chat:${id}`)
        },
        deleteAgentSession: async (id) => {
          calls.push(`agent:${id}`)
        },
      },
    )

    expect(calls).toEqual(['agent:session-1'])
  })
})
