import { describe, expect, test } from 'bun:test'
import { createStore } from 'jotai/vanilla'
import type { AgentSessionMeta, LinguistIpcResult } from '@proma/shared'
import { agentSessionsAtom } from '@/atoms/agent-atoms'
import { projectCurrentAgentSessionIdMapAtom } from '@/atoms/project-agent-session-atoms'
import { activeTabIdAtom, tabsAtom } from '@/atoms/tab-atoms'
import { linguistWorkbenchUiStateAtomFamily } from './cat-workspace-atoms'
import {
  createActiveLinguistProjectSession,
  createProjectAgentSession,
  ensureProjectAgentSession,
  resolveActiveLinguistProjectId,
  selectFallbackLinguistSession,
  selectProjectAgentSessionForHistory,
} from './project-agent-session'

function session(id: string, projectId: string): AgentSessionMeta {
  return {
    id,
    title: id,
    linguistProjectId: projectId,
    linguistProjectName: projectId,
    createdAt: 1,
    updatedAt: 2,
  }
}

describe('Project Agent Session 懒创建', () => {
  test('given Project Tab、Full Agent 或 Preview when 派生当前 CAT 项目 then 都沿会话绑定解析且不借普通会话', () => {
    const sessions = [session('alpha-session', 'alpha'), {
      ...session('ordinary', 'ignored'),
      linguistProjectId: undefined,
    }]

    expect(resolveActiveLinguistProjectId({
      id: 'linguist-project:alpha',
      type: 'linguist-project',
      projectId: 'alpha',
      title: 'Alpha',
    }, sessions)).toBe('alpha')
    expect(resolveActiveLinguistProjectId({
      id: 'alpha-tab',
      type: 'agent',
      sessionId: 'alpha-session',
      title: 'Alpha Agent',
    }, sessions)).toBe('alpha')
    expect(resolveActiveLinguistProjectId({
      id: 'alpha-preview',
      type: 'preview',
      sessionId: 'alpha-session',
      title: 'Preview',
    }, sessions)).toBe('alpha')
    expect(resolveActiveLinguistProjectId({
      id: 'ordinary-tab',
      type: 'agent',
      sessionId: 'ordinary',
      title: 'Ordinary',
    }, sessions)).toBeNull()
  })

  test('given 项目已有会话 when 用户显式新建 then 仍创建并按所选岗位登记新会话', async () => {
    const store = createStore()
    store.set(agentSessionsAtom, [session('alpha-existing', 'alpha')])
    const requests: unknown[] = []

    const result = await createProjectAgentSession(
      store,
      'alpha',
      'reviewer',
      async (request) => {
        requests.push(request)
        return { ok: true, data: session('alpha-created', 'alpha') }
      },
    )

    expect(requests).toEqual([{ projectId: 'alpha', role: 'reviewer' }])
    expect(result.ok).toBeTrue()
    expect(store.get(agentSessionsAtom).map((item) => item.id)).toEqual([
      'alpha-created',
      'alpha-existing',
    ])
    expect(store.get(projectCurrentAgentSessionIdMapAtom).get('alpha')).toBe('alpha-created')
  })

  test('given Full Agent 绑定当前 CAT 项目 when 点击顶部按钮 then 新建 General 会话并展开 Full', async () => {
    const store = createStore()
    store.set(agentSessionsAtom, [session('alpha-current', 'alpha')])
    store.set(tabsAtom, [{
      id: 'alpha-tab',
      type: 'agent',
      sessionId: 'alpha-current',
      title: 'Alpha Agent',
    }])
    store.set(activeTabIdAtom, 'alpha-tab')
    const requests: unknown[] = []

    const result = await createActiveLinguistProjectSession(store, async (request) => {
      requests.push(request)
      return { ok: true, data: session('alpha-new', 'alpha') }
    })

    expect(result.ok).toBeTrue()
    expect(requests).toEqual([{ projectId: 'alpha', role: 'general' }])
    expect(store.get(linguistWorkbenchUiStateAtomFamily('alpha')).agentPresentation).toBe('full')
  })

  test('given 没有当前 CAT 项目 when 点击顶部按钮 then fail closed 且不调用创建 IPC', async () => {
    const store = createStore()
    let createCalls = 0
    const result = await createActiveLinguistProjectSession(store, async () => {
      createCalls += 1
      return { ok: true, data: session('unexpected', 'alpha') }
    })

    expect(result).toEqual({
      ok: false,
      error: { code: 'INVALID_INPUT', message: '请先打开一个本地化项目' },
    })
    expect(createCalls).toBe(0)
  })

  test('given 当前项目会话被移除 when 选择 fallback then 只在同项目优先 pinned 再按最近更新', () => {
    const store = createStore()
    store.set(agentSessionsAtom, [
      { ...session('alpha-current', 'alpha'), updatedAt: 10 },
      { ...session('alpha-recent', 'alpha'), updatedAt: 30 },
      { ...session('alpha-pinned', 'alpha'), pinned: true, updatedAt: 20 },
      { ...session('alpha-archived', 'alpha'), archived: true, pinned: true, updatedAt: 40 },
      { ...session('beta-pinned', 'beta'), pinned: true, updatedAt: 50 },
    ])
    store.set(projectCurrentAgentSessionIdMapAtom, new Map([
      ['alpha', 'alpha-current'],
      ['beta', 'beta-pinned'],
    ]))

    expect(selectFallbackLinguistSession(store, 'alpha', 'alpha-current'))
      .toBe('alpha-pinned')
    expect(store.get(projectCurrentAgentSessionIdMapAtom)).toEqual(new Map([
      ['alpha', 'alpha-pinned'],
      ['beta', 'beta-pinned'],
    ]))
  })

  test('given 当前项目没有其他活跃会话 when 选择 fallback then 清除指针且不借用其他项目会话', () => {
    const store = createStore()
    store.set(agentSessionsAtom, [
      { ...session('alpha-current', 'alpha'), archived: true },
      session('beta-current', 'beta'),
    ])
    store.set(projectCurrentAgentSessionIdMapAtom, new Map([
      ['alpha', 'alpha-current'],
      ['beta', 'beta-current'],
    ]))

    expect(selectFallbackLinguistSession(store, 'alpha', 'alpha-current')).toBeUndefined()
    expect(store.get(projectCurrentAgentSessionIdMapAtom)).toEqual(new Map([
      ['beta', 'beta-current'],
    ]))
  })

  test('given 归档会话 when 显式查看历史 then 只允许同项目并保留选择', () => {
    const store = createStore()
    store.set(agentSessionsAtom, [
      { ...session('alpha-history', 'alpha'), archived: true },
      { ...session('beta-history', 'beta'), archived: true },
    ])

    expect(selectProjectAgentSessionForHistory(store, 'alpha', 'beta-history')).toBeFalse()
    expect(selectProjectAgentSessionForHistory(store, 'alpha', 'alpha-history')).toBeTrue()
    expect(store.get(projectCurrentAgentSessionIdMapAtom).get('alpha')).toBe('alpha-history')
  })

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
