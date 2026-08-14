import { afterAll, beforeAll, describe, expect, mock, test } from 'bun:test'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import * as os from 'node:os'
import { join } from 'node:path'
import type { SDKUserMessage } from '@proma/shared'
import * as piCodingAgent from '@earendil-works/pi-coding-agent'
import { electronMock, resetElectronMock } from './test/electron-mock'

type AgentSessionManager = typeof import('./agent-session-manager')
type AgentSessionContextPrompt = typeof import('./agent-session-context-prompt')

let manager: AgentSessionManager
let contextPrompt: AgentSessionContextPrompt
let tempHome: string
const originalHome = process.env.HOME
const originalPromaDev = process.env.PROMA_DEV

// agent-session-manager loads Pi lazily for fork/rewind, so this focused fake isolates
// entry-tree semantics without requiring a real Pi session JSONL fixture.
mock.module('@earendil-works/pi-coding-agent', () => ({
  ...piCodingAgent,
  SessionManager: {
    open: (sessionFile: string) => ({
      createBranchedSession: (entryId: string) => {
        const branchFile = join(tempHome, `.pi-branch-${entryId}.jsonl`)
        writeFileSync(branchFile, '', 'utf-8')
        return branchFile
      },
      getSessionFile: () => sessionFile,
      getSessionId: () => 'pi-test-session',
      getEntry: (entryId: string) => entryId === 'entry-keep' ? { id: entryId } : undefined,
    }),
    forkFrom: (_branchFile: string) => {
      const forkFile = join(tempHome, '.pi-fork.jsonl')
      writeFileSync(forkFile, '', 'utf-8')
      return {
        getSessionFile: () => forkFile,
        getSessionId: () => 'pi-fork-session',
        getEntry: (entryId: string) => entryId === 'entry-keep' ? { id: entryId } : undefined,
      }
    },
  },
}))

mock.module('electron', () => electronMock)

mock.module('node:os', () => ({
  ...os,
  homedir: () => tempHome,
}))

function jsonl(rows: string[]): string {
  return rows.join('\n') + '\n'
}

function writeAgentSessionJsonl(sessionId: string, rows: string[]): void {
  const dir = join(tempHome, '.linguist-agent', 'agent-sessions')
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, `${sessionId}.jsonl`), jsonl(rows), 'utf-8')
}

function writeAgentSessionsIndex(sessions: Array<{
  id: string
  title: string
  workspaceId: string
  createdAt: number
  updatedAt: number
  linguistProjectId?: string
  agentRuntime?: string
  sdkSessionId?: string
  piSessionFile?: string
  piEntryBindings?: Record<string, string>
  forkSourceSdkSessionId?: string
  resumeAtMessageUuid?: string
}>): void {
  const dir = join(tempHome, '.linguist-agent')
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'agent-sessions.json'), JSON.stringify({ version: 1, sessions }), 'utf-8')
}

function writeAgentWorkspacesIndex(workspaces: Array<{
  id: string
  name: string
  slug: string
  createdAt: number
  updatedAt: number
}>): void {
  const dir = join(tempHome, '.linguist-agent')
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'agent-workspaces.json'), JSON.stringify({ version: 2, workspaces }), 'utf-8')
}

function createIndexedSessions(count: number) {
  return Array.from({ length: count }, (_, index) => ({
    id: `session-${index}`,
    title: `会话 ${index}`,
    workspaceId: 'workspace-a',
    createdAt: index,
    updatedAt: index,
  }))
}

beforeAll(async () => {
  tempHome = mkdtempSync(join(os.tmpdir(), 'proma-agent-session-manager-'))
  process.env.HOME = tempHome
  process.env.PROMA_DEV = '0'
  resetElectronMock()
  manager = await import('./agent-session-manager')
  contextPrompt = await import('./agent-session-context-prompt')
})

afterAll(() => {
  if (originalHome === undefined) {
    delete process.env.HOME
  } else {
    process.env.HOME = originalHome
  }
  if (originalPromaDev === undefined) {
    delete process.env.PROMA_DEV
  } else {
    process.env.PROMA_DEV = originalPromaDev
  }
  rmSync(tempHome, { recursive: true, force: true })
})

describe('Agent 会话 JSONL 读取', () => {
  test('Given Linguist Turn 已发送 When 后续 Context 变化并重读历史 Then 原 Turn 保留自己的 snapshot', () => {
    const message: SDKUserMessage = {
      type: 'user',
      message: { content: [{ type: 'text', text: '翻译当前片段' }] },
      parent_tool_use_id: null,
      linguistContext: {
        schemaVersion: 1,
        projectId: 'prj-0123456789abcdef',
        selectedSegmentIds: ['seg-0123456789abcdef'],
        capturedAt: '2026-07-27T08:00:00.000Z',
        uiRevision: 1,
      },
    }
    manager.appendSDKMessages('session-with-context', [message])

    const stored = manager.getAgentSessionSDKMessages('session-with-context')[0]

    expect(stored).toMatchObject({
      linguistContext: {
        projectId: 'prj-0123456789abcdef',
        selectedSegmentIds: ['seg-0123456789abcdef'],
        uiRevision: 1,
      },
    })
  })

  test('Given 会话 JSONL 混入损坏行 When 读取 SDKMessage Then 跳过坏行并保留其它消息', () => {
    writeAgentSessionJsonl('session-with-bad-line', [
      JSON.stringify({ type: 'user', message: { content: [{ type: 'text', text: '你好' }] }, parent_tool_use_id: null }),
      '{ 这不是合法 JSON',
      JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: '仍然可读' }] }, parent_tool_use_id: null }),
    ])

    const messages = manager.getAgentSessionSDKMessages('session-with-bad-line')

    expect(messages.map((message) => message.type)).toEqual(['user', 'assistant'])
  })

  test('Given 会话 JSONL 存在损坏行 When 截断 SDKMessage Then 抛错避免重写不完整历史', () => {
    writeAgentSessionJsonl('session-truncate-bad-line', [
      JSON.stringify({ type: 'assistant', uuid: 'assistant-1', message: { content: [{ type: 'text', text: '完成' }] } }),
      '{ 这不是合法 JSON',
    ])

    expect(() => manager.truncateSDKMessages('session-truncate-bad-line', 'assistant-1'))
      .toThrow('JSONL 第 2 行解析失败')
  })
})

describe('Agent 会话分叉历史', () => {
  test('复制到 assistant 截断点时保留完成该轮的 success result', async () => {
    writeAgentSessionJsonl('fork-source', [
      JSON.stringify({
        type: 'assistant',
        message: { content: [{ type: 'text', text: '已完成' }] },
        parent_tool_use_id: null,
        uuid: 'assistant-complete',
      }),
      JSON.stringify({
        type: 'result',
        subtype: 'success',
        session_id: 'sdk-source',
      }),
      JSON.stringify({
        type: 'user',
        message: { role: 'user', content: '不应复制' },
        parent_tool_use_id: null,
      }),
    ])

    await manager.copyForkStoredSDKMessages({
      sourceSessionId: 'fork-source',
      destSessionId: 'fork-dest',
      upToMessageUuid: 'assistant-complete',
      includeCompletingResult: true,
    })

    expect(manager.getAgentSessionSDKMessages('fork-dest').map((message) => message.type))
      .toEqual(['assistant', 'result'])
  })
})

describe('Agent 会话 runtime 元数据', () => {
  test('Given 已保存 OpenAI medium 默认值 When 新建会话 Then 持久化 medium', () => {
    const settingsPath = join(tempHome, '.linguist-agent', 'settings.json')
    mkdirSync(join(tempHome, '.linguist-agent'), { recursive: true })
    writeFileSync(settingsPath, JSON.stringify({
      agentThinking: { type: 'adaptive' },
      agentEffort: 'max',
      defaultOpenAIThinkingLevel: 'medium',
    }), 'utf-8')

    try {
      const session = manager.createAgentSession('默认内核会话')

      expect(session.reasoningLevel).toBe('medium')
      expect(manager.getAgentSessionMeta(session.id)?.reasoningLevel).toBe('medium')
    } finally {
      rmSync(settingsPath, { force: true })
    }
  })

  test('Given 历史 Claude 会话 When 读取并尝试分叉或回退 Then 迁移为只读 transcript 并拒绝续接', async () => {
    writeAgentSessionsIndex([{
      id: 'legacy-claude-session',
      title: '历史 Claude 会话',
      workspaceId: 'workspace-a',
      createdAt: 1,
      updatedAt: 1,
      agentRuntime: 'claude',
      sdkSessionId: 'claude-artifact',
      piSessionFile: '/tmp/not-a-pi-session.jsonl',
      piEntryBindings: { 'assistant-1': 'entry-1' },
      forkSourceSdkSessionId: 'claude-source',
      resumeAtMessageUuid: 'assistant-1',
    }, {
      id: 'legacy-implicit-session',
      title: '缺少 runtime 的历史会话',
      workspaceId: 'workspace-a',
      createdAt: 2,
      updatedAt: 2,
    }])

    const migrated = manager.getAgentSessionMeta('legacy-claude-session')
    const implicitlyMigrated = manager.getAgentSessionMeta('legacy-implicit-session')

    expect(migrated).toMatchObject({
      legacyTranscript: { sourceRuntime: 'claude', continuationRequired: true },
    })
    expect(migrated?.sdkSessionId).toBeUndefined()
    expect(migrated?.piSessionFile).toBeUndefined()
    expect(migrated?.piEntryBindings).toBeUndefined()
    expect(implicitlyMigrated?.legacyTranscript).toEqual({ sourceRuntime: 'claude', continuationRequired: true })
    await expect(manager.forkAgentSession({ sessionId: 'legacy-claude-session', upToMessageUuid: 'assistant-1' }))
      .rejects.toThrow('历史 Claude transcript 为只读')
    await expect(manager.rewindPiAgentSession('legacy-claude-session', 'assistant-1'))
      .rejects.toThrow('历史 Claude transcript 为只读')
  })

  test('Given Pi session moved to another workspace When metadata is persisted Then clears the cwd-bound artifact and bindings', () => {
    writeAgentWorkspacesIndex([
      { id: 'workspace-a', name: '工作区 A', slug: 'workspace-a', createdAt: 1, updatedAt: 1 },
      { id: 'workspace-b', name: '工作区 B', slug: 'workspace-b', createdAt: 1, updatedAt: 1 },
    ])
    writeAgentSessionsIndex([{
      id: 'pi-session-to-move',
      title: 'Pi 会话',
      workspaceId: 'workspace-a',
      createdAt: 1,
      updatedAt: 1,
      agentRuntime: 'pi',
      sdkSessionId: 'pi-session-id',
      piSessionFile: '/tmp/pi-session.jsonl',
      piEntryBindings: { 'assistant-1': 'entry-1' },
    }])
    mkdirSync(join(tempHome, '.linguist-agent', 'agent-workspaces', 'workspace-a', 'pi-session-to-move'), { recursive: true })

    const moved = manager.moveSessionToWorkspace('pi-session-to-move', 'workspace-b')

    expect(moved.workspaceId).toBe('workspace-b')
    expect(moved.sdkSessionId).toBeUndefined()
    expect(moved.piSessionFile).toBeUndefined()
    expect(moved.piEntryBindings).toBeUndefined()
    expect(existsSync(join(tempHome, '.linguist-agent', 'agent-workspaces', 'workspace-b', 'pi-session-to-move'))).toBe(true)
  })

  test('Given 新安装用户保存关闭思考 When 连续新建会话 Then 不被旧版迁移改回 high', () => {
    const settingsPath = join(tempHome, '.linguist-agent', 'settings.json')
    const indexPath = join(tempHome, '.linguist-agent', 'agent-sessions.json')
    const indexBackupPath = `${indexPath}.bak`
    mkdirSync(join(tempHome, '.linguist-agent'), { recursive: true })
    rmSync(indexPath, { force: true })
    rmSync(indexBackupPath, { force: true })
    writeFileSync(settingsPath, JSON.stringify({
      agentThinking: { type: 'adaptive' },
      agentEffort: 'medium',
      defaultOpenAIThinkingLevel: 'off',
    }), 'utf-8')

    try {
      const firstSession = manager.createAgentSession('关闭思考会话一')
      const secondSession = manager.createAgentSession('关闭思考会话二')

      expect(manager.getAgentSessionMeta(firstSession.id)?.reasoningLevel).toBe('off')
      expect(manager.getAgentSessionMeta(secondSession.id)?.reasoningLevel).toBe('off')
    } finally {
      rmSync(settingsPath, { force: true })
      rmSync(indexPath, { force: true })
      rmSync(indexBackupPath, { force: true })
    }
  })

  test('Given session settings When updating Then persists reasoning depth per session', () => {
    const session = manager.createAgentSession('Codex 会话')

    const updated = manager.updateAgentSessionMeta(session.id, { reasoningLevel: 'xhigh' })

    expect(updated.reasoningLevel).toBe('xhigh')
    expect(manager.getAgentSessionMeta(session.id)).toMatchObject({ reasoningLevel: 'xhigh' })
  })

  test('Given a session When star state is updated Then it persists without changing freshness or archive state', () => {
    const session = manager.createAgentSession('星标会话')
    const archived = manager.updateAgentSessionMeta(session.id, { archived: true })

    const updated = manager.updateAgentSessionMeta(session.id, { starred: true })

    expect(updated).toMatchObject({ starred: true, archived: true })
    expect(updated.updatedAt).toBe(archived.updatedAt)
    expect(manager.getAgentSessionMeta(session.id)).toMatchObject({ starred: true, archived: true })
  })

  test('Given a user-stopped archived session When metadata is reread Then stop state persists without reopening it', () => {
    const session = manager.createAgentSession('停止状态会话')
    manager.updateAgentSessionMeta(session.id, { archived: true })
    manager.updateAgentSessionMeta(session.id, { stoppedByUser: true })

    expect(manager.listAgentSessions().find((item) => item.id === session.id)).toMatchObject({
      archived: true,
      stoppedByUser: true,
    })

    manager.updateAgentSessionMeta(session.id, { stoppedByUser: false })
    expect(manager.getAgentSessionMeta(session.id)).toMatchObject({
      archived: true,
      stoppedByUser: false,
    })
  })
})

describe('Agent 会话创建回滚', () => {
  test('Given session 工作目录无法创建 When 新建会话 Then 不遗留索引中的半成品会话', () => {
    const workspaceId = 'workspace-create-rollback'
    const workspaceSlug = 'blocked-session-workspace'
    const title = '不应遗留的创建失败会话'
    const blockedPath = join(tempHome, '.linguist-agent', 'agent-workspaces', workspaceSlug)
    writeAgentWorkspacesIndex([
      { id: workspaceId, name: '创建回滚测试', slug: workspaceSlug, createdAt: 1, updatedAt: 1 },
    ])
    mkdirSync(join(tempHome, '.linguist-agent', 'agent-workspaces'), { recursive: true })
    writeFileSync(blockedPath, '阻止创建 session 子目录', 'utf-8')

    try {
      expect(() => manager.createAgentSession(title, undefined, workspaceId, undefined, 'pi')).toThrow()
      expect(manager.listAgentSessions().some((item) => item.title === title)).toBe(false)
    } finally {
      rmSync(blockedPath, { force: true })
    }
  })
})

describe('Agent 会话正文搜索', () => {
  test('Given 用户/助手正文和内部块 When 搜索 Then 只返回最多两个不同正文消息命中', async () => {
    writeAgentSessionsIndex([{
      id: 'search-content-session',
      title: '正文搜索测试',
      workspaceId: 'workspace-a',
      createdAt: 1,
      updatedAt: 1,
    }])
    writeAgentSessionJsonl('search-content-session', [
      JSON.stringify({
        type: 'assistant',
        uuid: 'assistant-internal',
        message: {
          content: [
            { type: 'thinking', thinking: '命中词隐藏思考' },
            { type: 'tool_use', name: 'Read', input: { query: '命中词工具参数' } },
          ],
        },
      }),
      JSON.stringify({
        type: 'user',
        uuid: 'user-1',
        message: { content: [{ type: 'text', text: '用户正文命中词' }] },
      }),
      JSON.stringify({
        type: 'assistant',
        uuid: 'assistant-1',
        message: { content: [{ type: 'text', text: '助手正文命中词' }] },
      }),
      JSON.stringify({
        type: 'user',
        uuid: 'tool-result-user',
        message: { content: [{ type: 'tool_result', content: '命中词工具结果' }] },
      }),
    ])

    const results = await manager.searchAgentSessionMessages('命中词')

    expect(results).toHaveLength(2)
    expect(results.map((result) => result.messageId)).toEqual(['user-1', 'assistant-1'])
    expect(results.every((result) => result.role === 'user' || result.role === 'assistant')).toBe(true)
  })

  test('Given 单会话中有多个不同质量的命中 When 搜索 Then 只保留两条最佳结果并让 user 同分优先', async () => {
    writeAgentSessionsIndex([{
      id: 'ranked-search-session',
      title: '排序搜索测试',
      workspaceId: 'workspace-a',
      createdAt: 1,
      updatedAt: 1,
    }])
    writeAgentSessionJsonl('ranked-search-session', [
      JSON.stringify({ type: 'assistant', uuid: 'fuzzy', message: { content: [{ type: 'text', text: '搜索优方案' }] } }),
      JSON.stringify({ type: 'assistant', uuid: 'fragment', message: { content: [{ type: 'text', text: '搜索优化内容' }] } }),
      JSON.stringify({ type: 'assistant', uuid: 'assistant-exact', message: { content: [{ type: 'text', text: '搜索优化方案' }] } }),
      JSON.stringify({ type: 'user', uuid: 'user-exact', message: { content: [{ type: 'text', text: '搜索优化方案' }] } }),
    ])

    const results = await manager.searchAgentSessionMessages('搜索优化方案')

    expect(results.map((result) => result.messageId)).toEqual(['user-exact', 'assistant-exact'])
    expect(results.map((result) => result.role)).toEqual(['user', 'assistant'])
  })

  test('Given 重复的 Agent SDK snapshot When 搜索 Then 每个 messageId 只返回最佳命中一次', async () => {
    writeAgentSessionsIndex([{
      id: 'deduplicated-search-session',
      title: '去重搜索测试',
      workspaceId: 'workspace-a',
      createdAt: 1,
      updatedAt: 1,
    }])
    writeAgentSessionJsonl('deduplicated-search-session', [
      JSON.stringify({ type: 'assistant', uuid: 'duplicate', message: { content: [{ type: 'text', text: '搜索优方案' }] } }),
      JSON.stringify({ type: 'assistant', uuid: 'duplicate', message: { content: [{ type: 'text', text: '搜索优化方案' }] } }),
      JSON.stringify({ type: 'user', uuid: 'user-exact', message: { content: [{ type: 'text', text: '搜索优化方案' }] } }),
    ])

    const results = await manager.searchAgentSessionMessages('搜索优化方案')

    expect(results.map((result) => result.messageId)).toEqual(['user-exact', 'duplicate'])
    expect(results).toHaveLength(2)
  })

  test('Given 超过 100 个命中会话 When 搜索 Then 最多返回 100 个会话且每个最多两个命中', async () => {
    const sessions = createIndexedSessions(101)
    writeAgentSessionsIndex(sessions)
    for (const session of sessions) {
      writeAgentSessionJsonl(session.id, [
        JSON.stringify({ type: 'user', uuid: `${session.id}-1`, message: { content: [{ type: 'text', text: '命中词一' }] } }),
        JSON.stringify({ type: 'assistant', uuid: `${session.id}-2`, message: { content: [{ type: 'text', text: '命中词二' }] } }),
        JSON.stringify({ type: 'user', uuid: `${session.id}-3`, message: { content: [{ type: 'text', text: '命中词三' }] } }),
      ])
    }

    const results = await manager.searchAgentSessionMessages('命中词')
    const sessionIds = new Set(results.map((result) => result.sessionId))

    expect(sessionIds).toHaveLength(100)
    expect(results).toHaveLength(200)
    expect([...sessionIds][0]).toBe('session-100')
    expect(results.filter((result) => result.sessionId === 'session-100')).toHaveLength(2)
  })
})

describe('Agent 会话引用搜索', () => {
  test('Given 工作区有超过 20 个会话 When 请求最近 200 条 Then 按更新时间返回 200 条', async () => {
    writeAgentSessionsIndex(createIndexedSessions(220))

    const results = await manager.searchAgentSessionReferences({
      workspaceId: 'workspace-a',
      limit: 200,
    })

    expect(results).toHaveLength(200)
    expect(results[0]?.sessionId).toBe('session-219')
    expect(results.at(-1)?.sessionId).toBe('session-20')
    expect(results.every((result) => result.matchSource === 'recent')).toBe(true)
  })

  test('Given 请求数量超过性能上限 When 搜索可引用会话 Then 最多返回 200 条', async () => {
    writeAgentSessionsIndex(createIndexedSessions(220))

    const results = await manager.searchAgentSessionReferences({
      workspaceId: 'workspace-a',
      limit: 500,
    })

    expect(results).toHaveLength(200)
  })

  test('Given 未指定工作区 When 搜索可引用会话 Then 返回全部工作区的最近会话并标示来源', async () => {
    writeAgentWorkspacesIndex([
      { id: 'workspace-a', name: '产品研发', slug: 'product-dev', createdAt: 1, updatedAt: 1 },
      { id: 'workspace-b', name: '客户支持', slug: 'customer-support', createdAt: 2, updatedAt: 2 },
      { id: 'workspace-c', name: '当前项目', slug: 'current-project', createdAt: 3, updatedAt: 3 },
    ])
    writeAgentSessionsIndex([
      { id: 'workspace-a-session', title: '同名会话', workspaceId: 'workspace-a', createdAt: 1, updatedAt: 1 },
      { id: 'workspace-b-session', title: '同名会话', workspaceId: 'workspace-b', createdAt: 2, updatedAt: 2 },
      { id: 'current-session', title: '当前会话', workspaceId: 'workspace-c', createdAt: 3, updatedAt: 3 },
    ])

    const results = await manager.searchAgentSessionReferences({
      excludeSessionId: 'current-session',
      limit: 200,
    })

    expect(results).toMatchObject([
      { sessionId: 'workspace-b-session', workspaceName: '客户支持', workspaceSlug: 'customer-support' },
      { sessionId: 'workspace-a-session', workspaceName: '产品研发', workspaceSlug: 'product-dev' },
    ])
  })

  test('Given 普通与 Linguist 绑定会话同时存在 When 搜索可引用会话 Then 只返回普通 Agent 会话', async () => {
    writeAgentSessionsIndex([
      { id: 'ordinary-current', title: '普通当前会话', workspaceId: 'workspace-a', createdAt: 0, updatedAt: 0 },
      { id: 'ordinary-session', title: '普通会话', workspaceId: 'workspace-a', createdAt: 1, updatedAt: 1 },
      {
        id: 'linguist-bound-session',
        title: 'Linguist 私有会话',
        workspaceId: 'workspace-a',
        linguistProjectId: 'prj-0123456789abcdef',
        createdAt: 2,
        updatedAt: 2,
      },
    ])

    const results = await manager.searchAgentSessionReferences({
      workspaceId: 'workspace-a',
      excludeSessionId: 'ordinary-current',
    })

    expect(results.map((result) => result.sessionId)).toEqual(['ordinary-session'])
  })

  test('Given Linguist 当前会话引用项目内会话 When 搜索可引用会话 Then 仅返回同一项目而排除普通和跨项目会话', async () => {
    writeAgentSessionsIndex([
      {
        id: 'linguist-current',
        title: '项目甲当前会话',
        workspaceId: 'workspace-a',
        linguistProjectId: 'prj-project-a',
        createdAt: 1,
        updatedAt: 1,
      },
      {
        id: 'linguist-same-project',
        title: '项目甲同项目会话',
        workspaceId: 'workspace-a',
        linguistProjectId: 'prj-project-a',
        createdAt: 2,
        updatedAt: 2,
      },
      { id: 'ordinary-session', title: '普通会话', workspaceId: 'workspace-a', createdAt: 3, updatedAt: 3 },
      {
        id: 'linguist-other-project',
        title: '项目乙会话',
        workspaceId: 'workspace-a',
        linguistProjectId: 'prj-project-b',
        createdAt: 4,
        updatedAt: 4,
      },
    ])

    const results = await manager.searchAgentSessionReferences({
      workspaceId: 'workspace-a',
      excludeSessionId: 'linguist-current',
    })

    expect(results.map((result) => result.sessionId)).toEqual(['linguist-same-project'])
  })

  test('Given 消息内容命中 When 搜索可引用会话 Then 异步返回匹配片段和工作区来源', async () => {
    writeAgentWorkspacesIndex([
      { id: 'workspace-b', name: '客户支持', slug: 'customer-support', createdAt: 1, updatedAt: 1 },
    ])
    writeAgentSessionsIndex([
      { id: 'message-session', title: '项目讨论', workspaceId: 'workspace-b', createdAt: 1, updatedAt: 1 },
    ])
    writeAgentSessionJsonl('message-session', [
      JSON.stringify({ type: 'user', message: { content: [{ type: 'text', text: '需要核对跨工作区的会话引用。' }] } }),
    ])

    const results = await manager.searchAgentSessionReferences({ query: '跨工作区' })

    expect(results).toHaveLength(1)
    expect(results[0]).toMatchObject({
      sessionId: 'message-session',
      workspaceName: '客户支持',
      workspaceSlug: 'customer-support',
      matchSource: 'message',
      snippet: expect.stringContaining('跨工作区'),
    })
  })

  test('Given 正文扫描预算耗尽 When 较旧会话标题命中 Then 仍返回标题命中结果', async () => {
    const scannedSessions = Array.from({ length: 50 }, (_, index) => ({
      id: `body-scan-${index}`,
      title: `普通会话 ${index}`,
      workspaceId: 'workspace-a',
      createdAt: 100 - index,
      updatedAt: 100 - index,
    }))
    writeAgentSessionsIndex([
      ...scannedSessions,
      { id: 'older-title-match', title: '目标会话', workspaceId: 'workspace-a', createdAt: 1, updatedAt: 1 },
    ])
    for (const session of scannedSessions) {
      writeAgentSessionJsonl(session.id, [
        JSON.stringify({ type: 'user', message: { content: [{ type: 'text', text: '没有匹配内容' }] } }),
      ])
    }

    const results = await manager.searchAgentSessionReferences({ query: '目标' })

    expect(results).toMatchObject([{ sessionId: 'older-title-match', matchSource: 'title' }])
  })

  test('Given 正文命中在单文件扫描上限之后 When 搜索引用 Then 不读取超出输入补全预算的历史', async () => {
    writeAgentSessionsIndex([
      { id: 'oversized-session', title: '大历史', workspaceId: 'workspace-a', createdAt: 1, updatedAt: 1 },
    ])
    writeAgentSessionJsonl('oversized-session', [
      JSON.stringify({
        type: 'user',
        message: { content: [{ type: 'text', text: `${'x'.repeat(300 * 1024)}隐藏关键词` }] },
      }),
    ])

    const results = await manager.searchAgentSessionReferences({ query: '隐藏关键词' })

    expect(results).toEqual([])
  })
})

describe('Pi entry binding recovery', () => {
  test('Given Pi branch excludes later entries When fork Then keeps only bindings in the fork artifact', async () => {
    const piSessionFile = join(tempHome, '.pi-source-fork.jsonl')
    writeFileSync(piSessionFile, '', 'utf-8')
    writeAgentSessionsIndex([{
      id: 'pi-fork-source', title: 'Pi source', workspaceId: 'workspace-a', createdAt: 1, updatedAt: 1,
      agentRuntime: 'pi', sdkSessionId: 'pi-source-session', piSessionFile,
      piEntryBindings: {
        'assistant-keep': 'entry-keep',
        'assistant-stale': 'entry-stale',
        'assistant-missing': 'missing-entry',
      },
    }])
    writeAgentSessionJsonl('pi-fork-source', [
      JSON.stringify({ type: 'user', uuid: 'user-1', message: { content: [{ type: 'text', text: '开始' }] } }),
      JSON.stringify({ type: 'assistant', uuid: 'assistant-keep', message: { content: [{ type: 'text', text: '保留' }] } }),
      JSON.stringify({ type: 'assistant', uuid: 'assistant-stale', message: { content: [{ type: 'text', text: '丢弃' }] } }),
    ])

    const forked = await manager.forkAgentSession({ sessionId: 'pi-fork-source', upToMessageUuid: 'assistant-keep' })

    expect(forked.piEntryBindings).toEqual({ 'assistant-keep': 'entry-keep' })
    expect(manager.getAgentSessionMeta(forked.id)?.piEntryBindings).toEqual({ 'assistant-keep': 'entry-keep' })
    expect(forked.piSessionFile && existsSync(forked.piSessionFile)).toBe(true)
  })

  test('Given rewind excludes transcript and artifact entries When rewinding Then keeps only valid retained assistant bindings', async () => {
    const piSessionFile = join(tempHome, '.pi-source-rewind.jsonl')
    writeFileSync(piSessionFile, '', 'utf-8')
    writeAgentSessionsIndex([{
      id: 'pi-rewind-source', title: 'Pi rewind', workspaceId: 'workspace-a', createdAt: 1, updatedAt: 1,
      agentRuntime: 'pi', sdkSessionId: 'pi-source-session', piSessionFile,
      piEntryBindings: {
        'assistant-keep': 'entry-keep',
        'assistant-stale': 'entry-stale',
        'assistant-alias': 'entry-keep',
        'assistant-broken': 'missing-entry',
      },
    }])
    writeAgentSessionJsonl('pi-rewind-source', [
      JSON.stringify({ type: 'user', uuid: 'user-1', message: { content: [{ type: 'text', text: '开始' }] } }),
      JSON.stringify({ type: 'assistant', uuid: 'assistant-keep', message: { content: [{ type: 'text', text: '保留' }] } }),
      JSON.stringify({ type: 'user', uuid: 'user-after', message: { content: [{ type: 'text', text: '后续' }] } }),
      JSON.stringify({ type: 'assistant', uuid: 'assistant-stale', message: { content: [{ type: 'text', text: '丢弃' }] } }),
    ])

    const retainedCount = await manager.rewindPiAgentSession('pi-rewind-source', 'assistant-keep')

    expect(retainedCount).toBe(2)
    expect(manager.getAgentSessionMeta('pi-rewind-source')?.piEntryBindings).toEqual({ 'assistant-keep': 'entry-keep' })
    expect(manager.getAgentSessionSDKMessages('pi-rewind-source').map((message) => (message as { uuid?: string }).uuid))
      .toEqual(['user-1', 'assistant-keep'])
  })
})

describe('Agent 会话引用 prompt', () => {
  test('Given 用户显式引用跨工作区会话 When 构建发送 prompt Then 保留该会话上下文', () => {
    writeAgentSessionsIndex([
      { id: 'current-session', title: '当前工作区会话', workspaceId: 'workspace-a', createdAt: 1, updatedAt: 1 },
      { id: 'other-workspace-session', title: '其他工作区会话', workspaceId: 'workspace-b', createdAt: 2, updatedAt: 2 },
    ])

    const processWithResourcesPath = process as NodeJS.Process & { resourcesPath?: string }
    const originalResourcesPath = processWithResourcesPath.resourcesPath
    processWithResourcesPath.resourcesPath = tempHome
    try {
      const prompt = contextPrompt.buildReferencedSessionsPrompt(
        'current-session',
        ['other-workspace-session'],
      )

      expect(prompt).toContain('id="other-workspace-session"')
      expect(prompt).toContain('title="其他工作区会话"')
      expect(prompt).not.toContain('同工作区')
    } finally {
      Object.defineProperty(processWithResourcesPath, 'resourcesPath', {
        value: originalResourcesPath,
        configurable: true,
        writable: true,
      })
    }
  })

  test('Given 用户显式提及 Linguist 绑定会话 When 构建发送 prompt Then 不注入项目私有历史', () => {
    writeAgentSessionsIndex([
      { id: 'current-session', title: '当前会话', workspaceId: 'workspace-a', createdAt: 1, updatedAt: 1 },
      { id: 'ordinary-session', title: '普通引用', workspaceId: 'workspace-a', createdAt: 2, updatedAt: 2 },
      {
        id: 'linguist-bound-session',
        title: 'Linguist 私有引用',
        workspaceId: 'workspace-a',
        linguistProjectId: 'prj-0123456789abcdef',
        createdAt: 3,
        updatedAt: 3,
      },
    ])

    const processWithResourcesPath = process as NodeJS.Process & { resourcesPath?: string }
    const originalResourcesPath = processWithResourcesPath.resourcesPath
    processWithResourcesPath.resourcesPath = tempHome
    try {
      const prompt = contextPrompt.buildReferencedSessionsPrompt(
        'current-session',
        ['ordinary-session', 'linguist-bound-session'],
      )

      expect(prompt).toContain('id="ordinary-session"')
      expect(prompt).not.toContain('linguist-bound-session')
    } finally {
      Object.defineProperty(processWithResourcesPath, 'resourcesPath', {
        value: originalResourcesPath,
        configurable: true,
        writable: true,
      })
    }
  })

  test('Given Linguist 当前会话显式提及同项目与跨项目会话 When 构建发送 prompt Then 只注入同项目历史', () => {
    writeAgentSessionsIndex([
      {
        id: 'linguist-current',
        title: '项目甲当前会话',
        workspaceId: 'workspace-a',
        linguistProjectId: 'prj-project-a',
        createdAt: 1,
        updatedAt: 1,
      },
      {
        id: 'linguist-same-project',
        title: '项目甲同项目会话',
        workspaceId: 'workspace-a',
        linguistProjectId: 'prj-project-a',
        createdAt: 2,
        updatedAt: 2,
      },
      { id: 'ordinary-session', title: '普通会话', workspaceId: 'workspace-a', createdAt: 3, updatedAt: 3 },
      {
        id: 'linguist-other-project',
        title: '项目乙会话',
        workspaceId: 'workspace-a',
        linguistProjectId: 'prj-project-b',
        createdAt: 4,
        updatedAt: 4,
      },
    ])

    const processWithResourcesPath = process as NodeJS.Process & { resourcesPath?: string }
    const originalResourcesPath = processWithResourcesPath.resourcesPath
    processWithResourcesPath.resourcesPath = tempHome
    try {
      const prompt = contextPrompt.buildReferencedSessionsPrompt(
        'linguist-current',
        ['linguist-same-project', 'ordinary-session', 'linguist-other-project'],
      )

      expect(prompt).toContain('id="linguist-same-project"')
      expect(prompt).not.toContain('ordinary-session')
      expect(prompt).not.toContain('linguist-other-project')
    } finally {
      Object.defineProperty(processWithResourcesPath, 'resourcesPath', {
        value: originalResourcesPath,
        configurable: true,
        writable: true,
      })
    }
  })
})

describe('Agent 会话持久化边界', () => {
  test('Given 路径型会话 ID When 读取消息 Then 在访问文件系统前拒绝', () => {
    expect(() => manager.getAgentSessionSDKMessages('../conversations/secret'))
      .toThrow('无效 Agent 会话 ID')
  })

  test('Given Linguist 绑定会话 When 迁移到普通项目 Then 在目标解析前拒绝', () => {
    const session = manager.createAgentSession(
      '绑定会话',
      undefined,
      undefined,
      undefined,
      'pi',
      {
        linguistProjectId: 'prj-0123456789abcdef',
        linguistProjectName: '测试项目',
        linguistRole: 'general',
      },
    )

    expect(() => manager.moveSessionToWorkspace(session.id, 'ordinary-workspace'))
      .toThrow('Linguist 项目会话不能迁移')
  })
})
