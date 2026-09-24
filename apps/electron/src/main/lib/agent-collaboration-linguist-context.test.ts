import { beforeAll, beforeEach, expect, mock, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { AgentSessionMeta, LinguistTurnContextV1 } from '@proma/shared'

type CollaborationToolsModule = typeof import('./agent-collaboration-tools')

interface ToolDefinition {
  name: string
  execute: (toolCallId: string, params: unknown, signal?: AbortSignal) => Promise<unknown>
}

const parentContext: LinguistTurnContextV1 = {
  schemaVersion: 1,
  projectId: 'prj-1111111111111111',
  assetId: 'ast-1111111111111111',
  selectedSegmentIds: [],
  capturedAt: '2026-01-01T00:00:00.000Z',
  uiRevision: 1,
}

const parent = {
  id: 'parent-session',
  workspaceId: 'workspace-test',
  channelId: 'channel-codex',
  linguistProjectId: parentContext.projectId,
  linguistProjectName: '测试项目',
  linguistRole: 'general',
  permissionMode: 'bypassPermissions',
} as unknown as AgentSessionMeta

const sessions = new Map<string, AgentSessionMeta>([[parent.id, parent]])
let capturedRunInput: Record<string, unknown> | undefined
const capturedRunInputs: Record<string, unknown>[] = []
let collaborationTools: CollaborationToolsModule

mock.module('./agent-session-manager', () => ({
  deleteAgentSession: (sessionId: string) => { sessions.delete(sessionId) },
  createAgentSession: (
    title: string,
    channelId: string,
    workspaceId: string,
    modelId: string,
    _agentCwdMode: unknown,
    _layout: unknown,
    linguistBinding: Partial<AgentSessionMeta>,
  ) => {
    const child = {
      id: 'child-session',
      title,
      channelId,
      workspaceId,
      modelId,
      ...linguistBinding,
      createdAt: 1,
      updatedAt: 1,
    } as unknown as AgentSessionMeta
    sessions.set(child.id, child)
    return child
  },
  getAgentSessionMeta: (sessionId: string) => sessions.get(sessionId),
  getAgentSessionSDKMessages: () => [],
  listAgentSessions: () => [...sessions.values()],
  updateAgentSessionMeta: (sessionId: string, updates: Partial<AgentSessionMeta>) => {
    const updated = { ...sessions.get(sessionId), ...updates } as AgentSessionMeta
    sessions.set(sessionId, updated)
    return updated
  },
}))

mock.module('./agent-headless-runner-registry', () => ({
  runRegisteredHeadlessAgent: (
    input: Record<string, unknown>,
    callbacks: { onComplete: (messages?: unknown[]) => void },
  ) => {
    capturedRunInput = input
    capturedRunInputs.push(input)
    if (typeof input.userMessage === 'string' && input.userMessage.startsWith('继续') && !input.userMessage.startsWith('继续等待')) {
      callbacks.onComplete([])
    }
    return Promise.resolve()
  },
  stopRegisteredAgent: () => {},
}))

mock.module('./agent-model-selection', () => ({
  assertEnabledModelForChannel: ({ modelId }: { modelId: string }) => modelId,
  listEnabledAgentModels: () => [],
}))

mock.module('./agent-workspace-manager', () => ({
  getProjectFilesPath: () => '/nonexistent-child-project',
  getWorkspaceAttachedDirectories: () => [],
  getWorkspaceAttachedFiles: () => [],
}))

mock.module('./linguist/project-service', () => ({
  getLinguistProjectService: () => ({
    openProject: () => ({
      assets: { get: (assetId: string) => assetId === parentContext.assetId ? { id: assetId } : undefined },
      segments: {
        queryIds: () => ['seg_v2_1111111111111111111111111111111111111111111111111111111111111111'],
        getByIds: (ids: readonly string[]) => ids.map((id) => ({ id })),
        getStageDecisionCoverage: (_stage: string, ids: readonly string[]) => ({ total: ids.length, pending: ids.length }),
      },
      stageEvidence: { list: () => [] },
    }),
  }),
}))

beforeAll(async () => {
  collaborationTools = await import('./agent-collaboration-tools')
})

beforeEach(() => {
  capturedRunInput = undefined
  capturedRunInputs.length = 0
})

test('Linguist 委派继承可信 Context，并应用目标渠道与推理档', async () => {
  const sdk = {
    defineTool: (definition: ToolDefinition) => definition,
  } as unknown as typeof import('@earendil-works/pi-coding-agent')
  const tools = collaborationTools.buildPiCollaborationTools(sdk, {
    sessionId: parent.id,
    channelId: parent.channelId!,
    modelId: 'gpt-5.5',
    workspaceId: parent.workspaceId,
    permissionMode: parent.permissionMode,
    linguistContext: parentContext,
  } as Parameters<CollaborationToolsModule['buildPiCollaborationTools']>[1]) as ToolDefinition[]
  const delegate = tools.find((tool) => tool.name === 'mcp__collaboration__delegate_agent')!
  const schema = (delegate as ToolDefinition & { parameters: { properties: { linguistScope: { properties: Record<string, unknown> } } } }).parameters
  expect(Object.keys(schema.properties.linguistScope.properties)).toEqual(['batchIds', 'segmentIds'])

  const result = await delegate.execute('tool-call-1', {
    task: '审校当前批次',
    channelId: 'channel-deepseek',
    modelId: 'deepseek-v4-pro',
    thinkingLevel: 'max',
    linguistRole: 'reviewer',
    linguistScope: { batchIds: [parentContext.assetId] },
  }) as { details: Record<string, unknown> }

  expect(capturedRunInput?.linguistContext).toMatchObject({
    schemaVersion: 1,
    projectId: parentContext.projectId,
    selectedSegmentIds: ['seg_v2_1111111111111111111111111111111111111111111111111111111111111111'],
    uiRevision: parentContext.uiRevision,
  })
  expect(capturedRunInput?.userMessage).toContain('"batchIds"')
  expect(capturedRunInput?.userMessage).not.toContain('"assetIds"')
  expect(capturedRunInput?.channelId).toBe('channel-deepseek')
  expect(sessions.get('child-session')).toMatchObject({
    channelId: 'channel-deepseek',
    modelId: 'deepseek-v4-pro',
    reasoningLevel: 'max',
  })
  expect(result.details).toMatchObject({
    effectiveChannelId: 'channel-deepseek',
    effectiveModelId: 'deepseek-v4-pro',
    delegation: { thinkingLevel: 'max' },
  })

  const list = tools.find((tool) => tool.name === 'mcp__collaboration__list_delegations')!
  const listed = await list.execute('list-call', {}) as { details: { delegations: Array<Record<string, unknown>> } }
  expect(listed.details.delegations[0]).toMatchObject({ status: 'running', resultAvailable: false })
  expect(listed.details.delegations[0]).not.toHaveProperty('goal')
  expect(listed.details.delegations[0]).not.toHaveProperty('resultSummary')

  await delegate.execute('tool-call-2', { task: '普通协作任务' })
  expect(capturedRunInput?.linguistContext).toMatchObject({
    projectId: parentContext.projectId,
    selectedSegmentIds: [],
  })
  expect(sessions.get('child-session')).toMatchObject({
    linguistProjectId: parentContext.projectId,
    linguistRole: 'general',
  })
})

test('Linguist 委派在父轮次没有 UI 快照时仍冻结自身 CAT 范围', async () => {
  const sdk = {
    defineTool: (definition: ToolDefinition) => definition,
  } as unknown as typeof import('@earendil-works/pi-coding-agent')
  const tools = collaborationTools.buildPiCollaborationTools(sdk, {
    sessionId: parent.id,
    channelId: parent.channelId!,
    modelId: 'gpt-5.5',
    workspaceId: parent.workspaceId,
    permissionMode: parent.permissionMode,
  } as Parameters<CollaborationToolsModule['buildPiCollaborationTools']>[1]) as ToolDefinition[]
  const delegate = tools.find((tool) => tool.name === 'mcp__collaboration__delegate_agent')!

  await delegate.execute('tool-call-without-parent-context', {
    task: '审校当前批次',
    linguistRole: 'reviewer',
    linguistScope: { batchIds: [parentContext.assetId] },
  })

  expect(capturedRunInput?.linguistContext).toMatchObject({
    schemaVersion: 1,
    projectId: parentContext.projectId,
    selectedSegmentIds: ['seg_v2_1111111111111111111111111111111111111111111111111111111111111111'],
  })
})

test('Linguist 委派追加后续指令时保留冻结 CAT 范围', async () => {
  const sdk = {
    defineTool: (definition: ToolDefinition) => definition,
  } as unknown as typeof import('@earendil-works/pi-coding-agent')
  const tools = collaborationTools.buildPiCollaborationTools(sdk, {
    sessionId: parent.id,
    channelId: parent.channelId!,
    modelId: 'gpt-5.5',
    workspaceId: parent.workspaceId,
    permissionMode: parent.permissionMode,
  } as Parameters<CollaborationToolsModule['buildPiCollaborationTools']>[1]) as ToolDefinition[]
  const delegate = tools.find((tool) => tool.name === 'mcp__collaboration__delegate_agent')!
  const stop = tools.find((tool) => tool.name === 'mcp__collaboration__stop_delegation')!
  const continueDelegation = tools.find((tool) => tool.name === 'mcp__collaboration__continue_delegation')!

  const started = await delegate.execute('tool-call-for-continuation', {
    task: '审校当前批次',
    linguistRole: 'reviewer',
    linguistScope: { batchIds: [parentContext.assetId] },
  }) as { details: { delegation: { delegationId: string } } }
  await stop.execute('stop-for-continuation', {
    delegationId: started.details.delegation.delegationId,
  })
  await continueDelegation.execute('continue-without-parent-context', {
    delegationId: started.details.delegation.delegationId,
    message: '继续审校。',
  })

  expect(capturedRunInput?.linguistContext).toMatchObject({
    projectId: parentContext.projectId,
    selectedSegmentIds: ['seg_v2_1111111111111111111111111111111111111111111111111111111111111111'],
  })
})

test('Linguist 委派续跑从持久化子会话绑定重建 Context', async () => {
  const sdk = {
    defineTool: (definition: ToolDefinition) => definition,
  } as unknown as typeof import('@earendil-works/pi-coding-agent')
  const tools = collaborationTools.buildPiCollaborationTools(sdk, {
    sessionId: parent.id,
    channelId: parent.channelId!,
    modelId: 'gpt-5.5',
    workspaceId: parent.workspaceId,
    permissionMode: parent.permissionMode,
    linguistContext: parentContext,
  } as Parameters<CollaborationToolsModule['buildPiCollaborationTools']>[1]) as ToolDefinition[]
  const delegate = tools.find((tool) => tool.name === 'mcp__collaboration__delegate_agent')!
  const stop = tools.find((tool) => tool.name === 'mcp__collaboration__stop_delegation')!
  const continueDelegation = tools.find((tool) => tool.name === 'mcp__collaboration__continue_delegation')!

  const first = await delegate.execute('continuation-delegate', {
    task: '审校当前批次',
    linguistRole: 'reviewer',
    linguistScope: { batchIds: [parentContext.assetId] },
  }) as { details: { delegation: { delegationId: string } } }
  expect(sessions.get('child-session')).toMatchObject({
    linguistProjectId: parentContext.projectId,
    linguistRole: 'reviewer',
    linguistDelegatedScope: {
      assetIds: [parentContext.assetId],
      segmentIds: ['seg_v2_1111111111111111111111111111111111111111111111111111111111111111'],
    },
  })
  await stop.execute('continuation-stop', {
    delegationId: first.details.delegation.delegationId,
  })

  await continueDelegation.execute('continuation-follow-up', {
    delegationId: first.details.delegation.delegationId,
    message: '继续检查冻结范围',
  })

  expect(capturedRunInputs).toHaveLength(2)
  expect(capturedRunInputs[1]).toMatchObject({
    sessionId: 'child-session',
    userMessage: '继续检查冻结范围',
  })
  expect(capturedRunInputs[1]?.linguistContext).toMatchObject({
    projectId: parentContext.projectId,
    selectedSegmentIds: ['seg_v2_1111111111111111111111111111111111111111111111111111111111111111'],
  })
  expect(sessions.get('child-session')).toMatchObject({
    linguistProjectId: parentContext.projectId,
    linguistRole: 'reviewer',
    linguistDelegatedScope: {
      assetIds: [parentContext.assetId],
      segmentIds: ['seg_v2_1111111111111111111111111111111111111111111111111111111111111111'],
    },
    delegationStatus: 'completed',
  })
})

test('等待超时与取消只释放等待，子会话仍需显式停止', async () => {
  const sdk = {
    defineTool: (definition: ToolDefinition) => definition,
  } as unknown as typeof import('@earendil-works/pi-coding-agent')
  const tools = collaborationTools.buildPiCollaborationTools(sdk, {
    sessionId: parent.id,
    channelId: parent.channelId!,
    workspaceId: parent.workspaceId,
    permissionMode: parent.permissionMode,
  } as Parameters<CollaborationToolsModule['buildPiCollaborationTools']>[1]) as ToolDefinition[]
  const delegate = tools.find((tool) => tool.name === 'mcp__collaboration__delegate_agent')!
  const wait = tools.find((tool) => tool.name === 'mcp__collaboration__wait_for_delegations')!
  const stop = tools.find((tool) => tool.name === 'mcp__collaboration__stop_delegation')!
  const continued = tools.find((tool) => tool.name === 'mcp__collaboration__continue_delegation')!

  const started = await delegate.execute('wait-cancel-start', { task: '保持运行供等待测试' }) as {
    details: { delegation: { delegationId: string } }
  }
  const delegationId = started.details.delegation.delegationId
  const timedOut = await wait.execute('wait-short-timeout', {
    delegationIds: [delegationId], timeoutSeconds: 0.001,
  }) as { details: { status: string; runningCount: number } }
  expect(timedOut.details).toMatchObject({ status: 'timeout', runningCount: 1 })

  const abortWait = new AbortController()
  const waiting = wait.execute('wait-abort', { delegationIds: [delegationId] }, abortWait.signal)
  abortWait.abort()
  await expect(waiting).rejects.toBeDefined()

  await stop.execute('wait-stop', { delegationId })
  const abortContinuation = new AbortController()
  const continuing = continued.execute('continue-abort', {
    delegationId, message: '继续等待后续结果',
  }, abortContinuation.signal)
  abortContinuation.abort()
  await expect(continuing).rejects.toBeDefined()

  const stillRunning = await wait.execute('wait-after-abort', {
    delegationIds: [delegationId], timeoutSeconds: 0.001,
  }) as { details: { status: string; runningCount: number } }
  expect(stillRunning.details).toMatchObject({ status: 'timeout', runningCount: 1 })
  await stop.execute('continue-stop', { delegationId })
})

test('必需文件缺失时返回 blocked-input，不创建子会话或启动 runner', async () => {
  const parentCwd = mkdtempSync(join(tmpdir(), 'collab-missing-'))
  try {
    const sdk = {
      defineTool: (definition: ToolDefinition) => definition,
    } as unknown as typeof import('@earendil-works/pi-coding-agent')
    const tools = collaborationTools.buildPiCollaborationTools(sdk, {
      sessionId: parent.id,
      channelId: parent.channelId!,
      workspaceId: parent.workspaceId,
      workspaceSlug: 'test-project',
      agentCwd: parentCwd,
      allowedRoots: [parentCwd],
    } as Parameters<CollaborationToolsModule['buildPiCollaborationTools']>[1]) as ToolDefinition[]
    const delegate = tools.find(tool => tool.name === 'mcp__collaboration__delegate_agent')!
    const sessionsBefore = sessions.size
    const result = await delegate.execute('missing-input-1', {
      task: '核验指定文件',
      inputs: [{ path: 'absent.xlf' }],
    }) as { details: { status: string; inputs: Array<{ state: string; reason: string }> } }
    expect(result.details.status).toBe('blocked-input')
    expect(result.details.inputs[0]).toMatchObject({ state: 'blocked-input', reason: '文件不存在' })
    expect(sessions.size).toBe(sessionsBefore)
    expect(capturedRunInputs).toHaveLength(0)
  } finally {
    rmSync(parentCwd, { recursive: true, force: true })
  }
})
