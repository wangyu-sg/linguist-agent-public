import { describe, expect, test } from 'bun:test'
import type { AgentSessionMeta } from '@proma/shared'
import { routeExternalAgentSession } from './external-agent-session-opener'

function session(overrides: Partial<AgentSessionMeta> = {}): AgentSessionMeta {
  return {
    id: 'session-a',
    title: '外部打开会话',
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  }
}

describe('菜单栏 / Agent Island 外部会话打开路由', () => {
  test('Given 未注入 Linguist opener When 外部请求打开项目会话 Then fail closed 且不降级为普通 Agent', async () => {
    let ordinaryOpened = false

    const result = await routeExternalAgentSession(
      session({ linguistProjectId: 'prj-project-a' }),
      null,
      () => { ordinaryOpened = true },
    )

    expect(result.kind).toBe('blocked')
    expect(ordinaryOpened).toBe(false)
  })

  test('Given 注入的 Linguist opener When 外部请求打开项目会话 Then 交给该 opener 并不触发普通路由', async () => {
    let openedSessionId: string | undefined
    let ordinaryOpened = false

    const result = await routeExternalAgentSession(
      session({ id: 'linguist-session', linguistProjectId: 'prj-project-a' }),
      async (sessionId) => { openedSessionId = sessionId },
      () => { ordinaryOpened = true },
    )

    expect(result.kind).toBe('opened-linguist')
    expect(openedSessionId).toBe('linguist-session')
    expect(ordinaryOpened).toBe(false)
  })

  test('Given 普通 Agent 会话 When 外部请求打开 Then 保持原有普通 Agent 路由', async () => {
    let ordinaryOpened = false

    const result = await routeExternalAgentSession(
      session(),
      null,
      () => { ordinaryOpened = true },
    )

    expect(result.kind).toBe('opened-ordinary')
    expect(ordinaryOpened).toBe(true)
  })
})
