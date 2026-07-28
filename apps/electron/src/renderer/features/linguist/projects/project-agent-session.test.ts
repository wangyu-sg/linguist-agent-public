import { describe, expect, test } from 'bun:test'
import { createStore } from 'jotai/vanilla'
import type { AgentSessionMeta, LinguistIpcResult } from '@proma/shared'
import { agentSessionsAtom } from '@/atoms/agent-atoms'
import { projectCurrentAgentSessionIdMapAtom } from '@/atoms/project-agent-session-atoms'
import { ensureProjectAgentSession } from './project-agent-session'

function session(id: string, projectId: string): AgentSessionMeta {
  return {
    id,
    title: id,
    agentRuntime: 'pi',
    linguistProjectId: projectId,
    linguistProjectName: projectId,
    createdAt: 1,
    updatedAt: 2,
  }
}

describe('Project Agent Session 懒创建', () => {
  test('given 项目已有有效会话 when 首次需要 Agent then 复用会话且不调用创建 IPC', async () => {
    const store = createStore()
    const existing = session('alpha-existing', 'alpha')
    store.set(agentSessionsAtom, [existing])
    let createCalls = 0

    const result = await ensureProjectAgentSession(store, 'alpha', async () => {
      createCalls += 1
      return { ok: true, data: session('unexpected', 'alpha') }
    })

    expect(result).toEqual({ ok: true, data: existing })
    expect(createCalls).toBe(0)
    expect(store.get(projectCurrentAgentSessionIdMapAtom).get('alpha')).toBe(existing.id)
  })

  test('given 项目没有会话 when Agent rail 与发送同时首次请求 then 只创建一次并登记原生会话', async () => {
    const store = createStore()
    const created = session('alpha-created', 'alpha')
    let createCalls = 0
    const create = async (): Promise<LinguistIpcResult<AgentSessionMeta>> => {
      createCalls += 1
      await Promise.resolve()
      return { ok: true, data: created }
    }

    const [rail, send] = await Promise.all([
      ensureProjectAgentSession(store, 'alpha', create),
      ensureProjectAgentSession(store, 'alpha', create),
    ])

    expect(rail).toEqual({ ok: true, data: created })
    expect(send).toEqual(rail)
    expect(createCalls).toBe(1)
    expect(store.get(agentSessionsAtom)).toEqual([created])
    expect(store.get(projectCurrentAgentSessionIdMapAtom).get('alpha')).toBe(created.id)
  })

  test('given 创建 IPC 返回错误或错绑会话 when 首次需要 Agent then 不污染项目选择', async () => {
    const store = createStore()
    const failed = await ensureProjectAgentSession(store, 'alpha', async () => ({
      ok: false,
      error: { code: 'INTERNAL', message: 'failed' },
    }))
    const mismatched = await ensureProjectAgentSession(store, 'alpha', async () => ({
      ok: true,
      data: session('beta-created', 'beta'),
    }))

    expect(failed.ok).toBeFalse()
    expect(mismatched).toEqual({
      ok: false,
      error: { code: 'INTERNAL', message: '项目会话绑定不一致' },
    })
    expect(store.get(agentSessionsAtom)).toEqual([])
    expect(store.get(projectCurrentAgentSessionIdMapAtom).has('alpha')).toBeFalse()
  })
})
