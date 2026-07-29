import { describe, expect, test } from 'bun:test'
import type { AgentSessionMeta } from '@proma/shared'
import {
  buildAgentSessionTrees,
  buildPinnedAgentSessionTrees,
  getSessionTreeStatus,
  isLinguistProjectSession,
  isOrdinaryAgentSession,
  selectVisibleAgentSessionTrees,
  treeContainsSessionId,
} from './agent-session-tree'

function session(id: string, overrides: Partial<AgentSessionMeta> = {}): AgentSessionMeta {
  return {
    id,
    title: id,
    createdAt: 1,
    updatedAt: 2,
    ...overrides,
  }
}

describe('agent-session-tree', () => {
  test('given 普通与 Linguist 会话 when 按模式过滤 then 两棵树严格隔离', () => {
    const ordinary = session('ordinary')
    const linguist = session('linguist', { linguistProjectId: 'project-a' })

    expect([ordinary, linguist].filter(isOrdinaryAgentSession).map((item) => item.id))
      .toEqual(['ordinary'])
    expect([ordinary, linguist].filter((item) => isLinguistProjectSession(item, 'project-a')).map((item) => item.id))
      .toEqual(['linguist'])
  })

  test('given 委派子会话 when 构建共享树 then 子会话归入母会话且状态向上聚合', () => {
    const root = session('root')
    const child = session('child', {
      parentSessionId: root.id,
      sourceDelegationId: 'delegation-1',
    })
    const [tree] = buildAgentSessionTrees([root, child])

    expect(tree?.childSessions.map((item) => item.id)).toEqual(['child'])
    expect(treeContainsSessionId(tree!, child.id)).toBe(true)
    expect(getSessionTreeStatus(tree!, new Map([[child.id, 'blocked']]))).toBe('blocked')
  })

  test('given 新旧会话与活跃状态 when 选择项目预览 then 两种模式共享三天窗口和状态优先级', () => {
    const now = 10 * 86_400_000
    const trees = buildAgentSessionTrees([
      session('old-idle', { updatedAt: now - 4 * 86_400_000 }),
      session('recent-idle', { updatedAt: now - 1_000 }),
      session('running', { updatedAt: now - 5 * 86_400_000 }),
      session('blocked', { updatedAt: now - 6 * 86_400_000 }),
    ])
    const selected = selectVisibleAgentSessionTrees({
      trees,
      indicatorMap: new Map([
        ['running', 'running'],
        ['blocked', 'blocked'],
      ]),
      now,
    })

    expect(selected.visible.map((tree) => tree.session.id)).toEqual([
      'blocked',
      'running',
      'recent-idle',
    ])
    expect(selected.hiddenCount).toBe(1)
  })

  test('given 当前旧会话 when 不在三天窗口 then 仍保证可见', () => {
    const now = 10 * 86_400_000
    const trees = buildAgentSessionTrees([
      session('old-current', { updatedAt: 1 }),
      session('recent', { updatedAt: now }),
    ])
    const selected = selectVisibleAgentSessionTrees({
      trees,
      indicatorMap: new Map(),
      currentSessionId: 'old-current',
      now,
    })

    expect(selected.visible.map((tree) => tree.session.id)).toContain('old-current')
  })

  test('given 置顶母会话与委派子会话 when 构建置顶树 then 母会话只出现一次且保留全部子会话', () => {
    const root = session('root', { pinned: true })
    const child = session('child', {
      pinned: true,
      parentSessionId: root.id,
      sourceDelegationId: 'delegation-1',
    })
    const unpinnedChild = session('child-2', {
      parentSessionId: root.id,
      sourceDelegationId: 'delegation-2',
    })
    const trees = buildPinnedAgentSessionTrees([root, child, unpinnedChild])

    expect(trees.map((tree) => tree.session.id)).toEqual(['root'])
    expect(trees[0]?.childSessions.map((item) => item.id)).toEqual(['child', 'child-2'])
  })
})
