import { afterAll, beforeAll, describe, expect, mock, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import * as os from 'node:os'
import { join } from 'node:path'
import type { SDKUserMessage } from '@proma/shared'
import { electronMock, resetElectronMock } from './test/electron-mock'

type AgentSessionManager = typeof import('./agent-session-manager')
type AgentSessionContextPrompt = typeof import('./agent-session-context-prompt')

let manager: AgentSessionManager
let contextPrompt: AgentSessionContextPrompt
let tempHome: string
const originalHome = process.env.HOME
const originalPromaDev = process.env.PROMA_DEV
const originalClaudeConfigDir = process.env.CLAUDE_CONFIG_DIR

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

function writeSdkSessionJsonl(sdkSessionId: string, rows: string[]): void {
  const dir = join(tempHome, '.linguist-agent', 'sdk-config', 'projects', 'test-project')
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, `${sdkSessionId}.jsonl`), jsonl(rows), 'utf-8')
}

function writeAgentSessionsIndex(sessions: Array<{
  id: string
  title: string
  workspaceId: string
  createdAt: number
  updatedAt: number
  linguistProjectId?: string
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
  delete process.env.CLAUDE_CONFIG_DIR
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
  if (originalClaudeConfigDir === undefined) {
    delete process.env.CLAUDE_CONFIG_DIR
  } else {
    process.env.CLAUDE_CONFIG_DIR = originalClaudeConfigDir
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

  test('Given SDK rewind JSONL 存在损坏行 When 从快照恢复文件 Then 严格失败避免误报成功', () => {
    const cwd = join(tempHome, 'workspace')
    mkdirSync(cwd, { recursive: true })
    writeSdkSessionJsonl('sdk-session-with-bad-line', [
      JSON.stringify({ type: 'user', uuid: 'user-1', message: { content: [{ type: 'text', text: '修改文件' }] } }),
      '{ 这不是合法 JSON',
      JSON.stringify({
        type: 'file-history-snapshot',
        isSnapshotUpdate: false,
        snapshot: {
          messageId: 'user-1',
          trackedFileBackups: {
            'a.txt': { backupFileName: null },
          },
        },
      }),
    ])

    const result = manager.rewindFilesFromSnapshot('sdk-session-with-bad-line', 'user-1', cwd)

    expect(result.canRewind).toBe(false)
    expect(result.error).toContain('JSONL 第 2 行解析失败')
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
  test('Given 已保存 OpenAI medium 默认值 When 新建 Pi 或 Claude 会话 Then 默认并持久化 medium', () => {
    const settingsPath = join(tempHome, '.linguist-agent', 'settings.json')
    mkdirSync(join(tempHome, '.linguist-agent'), { recursive: true })
    writeFileSync(settingsPath, JSON.stringify({
      agentThinking: { type: 'adaptive' },
      agentEffort: 'max',
      defaultOpenAIThinkingLevel: 'medium',
    }), 'utf-8')

    try {
      const defaultRuntimeSession = manager.createAgentSession('默认内核会话')
      const claudeRuntimeSession = manager.createAgentSession('Claude 内核会话', undefined, undefined, undefined, 'claude')

      expect(defaultRuntimeSession.agentRuntime).toBe('pi')
      expect(claudeRuntimeSession.agentRuntime).toBe('claude')
      expect(manager.getAgentSessionMeta(defaultRuntimeSession.id)?.agentRuntime).toBe('pi')
      expect(manager.getAgentSessionMeta(claudeRuntimeSession.id)?.agentRuntime).toBe('claude')
      expect(defaultRuntimeSession.reasoningLevel).toBe('medium')
      expect(claudeRuntimeSession.reasoningLevel).toBe('medium')
      expect(manager.getAgentSessionMeta(defaultRuntimeSession.id)?.reasoningLevel).toBe('medium')
      expect(manager.getAgentSessionMeta(claudeRuntimeSession.id)?.reasoningLevel).toBe('medium')
    } finally {
      rmSync(settingsPath, { force: true })
    }
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
    const session = manager.createAgentSession('Codex 会话', undefined, undefined, undefined, 'pi')

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
