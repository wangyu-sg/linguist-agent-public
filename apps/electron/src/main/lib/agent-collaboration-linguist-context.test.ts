import { beforeAll, beforeEach, expect, mock, test } from 'bun:test'
import type { AgentSessionMeta, LinguistTurnContextV1 } from '@proma/shared'

type CollaborationToolsModule = typeof import('./agent-collaboration-tools')

interface ToolDefinition {
  name: string
  execute: (toolCallId: string, params: unknown) => Promise<unknown>
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
    if (typeof input.userMessage === 'string' && input.userMessage.startsWith('继续')) {
      callbacks.onComplete([])
    }
    return Promise.resolve()
  },
  stopRegisteredAgent: () => {},
}))

mock.module('./agent-model-selection', () => ({
  assertEnabledModelForChannel: ({ modelId }: { modelId: string }) => modelId,
  listEnabledAgentModels: () => [],
  listEnabledAgentModelsForChannel: () => ({
    channelId: 'channel-deepseek',
    channelName: 'DeepSeek',
    provider: 'deepseek',
    models: [],
  }),
}))

mock.module('./adapters/pi-model-registry', () => ({
  resolvePiReasoningCapability: () => Promise.resolve({
    source: 'profile',
    levels: ['off', 'low', 'high', 'max'],
    defaultLevel: 'high',
  }),
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

  const result = await delegate.execute('tool-call-1', {
    task: '审校当前资产',
    channelId: 'channel-deepseek',
    modelId: 'deepseek-v4-pro',
    reasoningEffort: 'max',
    linguistRole: 'reviewer',
    linguistScope: { assetIds: [parentContext.assetId] },
  }) as { details: Record<string, unknown> }

  expect(capturedRunInput?.linguistContext).toMatchObject({
    schemaVersion: 1,
    projectId: parentContext.projectId,
    selectedSegmentIds: ['seg_v2_1111111111111111111111111111111111111111111111111111111111111111'],
    uiRevision: parentContext.uiRevision,
  })
  expect(capturedRunInput?.channelId).toBe('channel-deepseek')
  expect(sessions.get('child-session')).toMatchObject({
    channelId: 'channel-deepseek',
    modelId: 'deepseek-v4-pro',
    reasoningLevel: 'max',
  })
  expect(result.details).toMatchObject({
    effectiveChannelId: 'channel-deepseek',
    effectiveModelId: 'deepseek-v4-pro',
    effectiveReasoningEffort: 'max',
  })

  await delegate.execute('tool-call-2', { task: '普通协作任务' })
  expect(capturedRunInput?.linguistContext).toMatchObject({
    projectId: parentContext.projectId,
    selectedSegmentIds: ['seg_v2_1111111111111111111111111111111111111111111111111111111111111111'],
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
    task: '审校当前资产',
    linguistRole: 'reviewer',
    linguistScope: { assetIds: [parentContext.assetId] },
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
    task: '审校当前资产',
    linguistRole: 'reviewer',
    linguistScope: { assetIds: [parentContext.assetId] },
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
    task: '审校当前资产',
    linguistRole: 'reviewer',
    linguistScope: { assetIds: [parentContext.assetId] },
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
