import { beforeAll, expect, mock, test } from 'bun:test'

type SessionIpc = typeof import('./session-ipc')

mock.module('../agent-session-manager', () => ({
  detachAgentSessionLinguistBinding: () => null,
  getAgentSessionMeta: () => undefined,
  updateAgentSessionLinguistRole: () => {
    throw Object.assign(
      new Error('已执行的 Linguist 会话不能切换岗位，请新建对应岗位对话'),
      { code: 'INVALID_INPUT' },
    )
  },
}))

mock.module('./session-binding', () => ({
  createLinguistProjectChatSession: () => { throw new Error('not used') },
  getLinguistSessionBinding: () => { throw new Error('not used') },
  listLinguistProjectChatSessions: () => [],
}))

mock.module('./session-copy', () => ({
  copyLinguistSessionToProject: () => { throw new Error('not used') },
  getLinguistSessionCopyEligibility: () => { throw new Error('not used') },
}))

let createLinguistSessionIpc: SessionIpc['createLinguistSessionIpc']

beforeAll(async () => {
  ({ createLinguistSessionIpc } = await import('./session-ipc'))
})

test('岗位身份拒绝通过现有 typed IPC 信封返回 INVALID_INPUT', async () => {
  const ipc = createLinguistSessionIpc({
    getService: () => undefined as never,
    isSessionActive: () => false,
  })

  const result = await ipc.updateRole({ sessionId: 'linguist-used-role', role: 'reviewer' })

  expect(result).toEqual({
    ok: false,
    error: {
      code: 'INVALID_INPUT',
      message: '已执行的 Linguist 会话不能切换岗位，请新建对应岗位对话',
    },
  })
})
