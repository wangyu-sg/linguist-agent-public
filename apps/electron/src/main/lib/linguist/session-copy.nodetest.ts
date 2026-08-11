import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { AgentSessionMeta, SDKMessage } from '@proma/shared'
import type {
  LinguistSessionCopyDependencies,
  LinguistSessionCopyEligibility,
} from './session-copy'
import type { AgentSessionForkOptions } from '../agent-session-manager'
import { makeClock, makeEntropy, makeTempDir } from './test/service-testkit'
import { LinguistProjectService } from './project-service'

const tempHome = makeTempDir()
process.env.HOME = tempHome

const copy = await import('./session-copy')
const binding = await import('./session-binding')
const sessions = await import('../agent-session-manager')

const LINGUIST_ROOT = join(tempHome, '.linguist-agent', 'linguist')
let serviceSequence = 0

function makeService(): LinguistProjectService {
  const instance = ++serviceSequence
  let workspaceSequence = 0
  const service = new LinguistProjectService({
    rootDir: LINGUIST_ROOT,
    entropy: makeEntropy(`session-copy-${instance}`),
    now: makeClock(),
    workspaceCreator: () => `ws-session-copy-${instance}-${++workspaceSequence}`,
    workspaceResolver: () => true,
  })
  service.init()
  return service
}

function deps(
  service: LinguistProjectService,
  overrides: Partial<LinguistSessionCopyDependencies> = {},
): LinguistSessionCopyDependencies {
  return {
    getService: () => service,
    isSessionActive: () => false,
    ...overrides,
  }
}

function blockedReason(result: LinguistSessionCopyEligibility): string {
  assert.equal(result.eligible, false)
  return result.eligible ? '' : result.reason
}

function successResult(sessionId: string): SDKMessage {
  return {
    type: 'result',
    subtype: 'success',
    usage: { input_tokens: 1, output_tokens: 1 },
    session_id: sessionId,
  }
}

function seedPiArtifact(sessionId: string, assistantUuids: readonly string[]): void {
  const directory = join(tempHome, '.linguist-agent', 'sdk-config', 'sessions')
  mkdirSync(directory, { recursive: true })
  const piSessionFile = join(directory, `${sessionId}.jsonl`)
  writeFileSync(piSessionFile, '')
  sessions.updateAgentSessionMeta(sessionId, {
    sdkSessionId: `pi-${sessionId}`,
    piSessionFile,
    piEntryBindings: Object.fromEntries(assistantUuids.map((uuid) => [uuid, `entry-${uuid}`])),
  })
}

test('空白 Linguist 会话复制到健康活跃项目，并继承配置但清除侧栏/运行元数据', async () => {
  const service = makeService()
  const sourceProject = service.createProject({
    name: '源项目',
    sourceLocale: 'en',
    targetLocale: 'zh-CN',
  })
  const targetProject = service.createProject({
    name: '目标项目',
    sourceLocale: 'en',
    targetLocale: 'ja',
  })

  const source = binding.createLinguistProjectChatSession(service, {
    projectId: sourceProject.id,
    title: '术语讨论',
    role: 'reviewer',
  })
  sessions.updateAgentSessionMeta(source.id, {
    codexFastMode: true,
    openAIThinkingLevel: 'high',
    permissionMode: 'bypassPermissions',
    pinned: true,
    starred: true,
    archived: true,
    attachedDirectories: ['/tmp/secret'],
    attachedFiles: ['/tmp/secret.txt'],
    completedButUnconfirmed: true,
    sourceAutomationId: 'automation-secret',
    parentSessionId: 'parent-secret',
    delegationStatus: 'running',
  })

  assert.deepEqual(
    copy.getLinguistSessionCopyEligibility(deps(service), source.id),
    { eligible: true, mode: 'blank' },
  )

  const copied = await copy.copyLinguistSessionToProject(
    deps(service),
    { sessionId: source.id, targetProjectId: targetProject.id },
  )

  assert.equal(copied.title, '术语讨论（副本）')
  assert.equal(copied.linguistProjectId, targetProject.id)
  assert.equal(copied.linguistProjectName, '目标项目')
  assert.equal(copied.linguistRole, 'reviewer')
  assert.equal(copied.codexFastMode, true)
  assert.equal(copied.openAIThinkingLevel, 'high')
  assert.equal(copied.permissionMode, 'bypassPermissions')
  assert.equal(copied.workspaceId, targetProject.promaWorkspaceId)
  assert.equal(copied.pinned, undefined)
  assert.equal(copied.starred, undefined)
  assert.equal(copied.archived, undefined)
  assert.equal(copied.attachedDirectories, undefined)
  assert.equal(copied.attachedFiles, undefined)
  assert.equal(copied.completedButUnconfirmed, undefined)
  assert.equal(copied.sourceAutomationId, undefined)
  assert.equal(copied.parentSessionId, undefined)
  assert.equal(copied.delegationStatus, undefined)

  const original = sessions.getAgentSessionMeta(source.id)
  assert.equal(original?.linguistProjectId, sourceProject.id)
  assert.equal(original?.pinned, true)
  assert.equal(original?.sourceAutomationId, 'automation-secret')
  service.closeAll()
})

test('Eligibility 阻断普通、运行中、未完成和损坏历史', () => {
  const service = makeService()
  const project = service.createProject({
    name: 'Eligibility 项目',
    sourceLocale: 'en',
    targetLocale: 'zh-CN',
  })
  const ordinary = sessions.createAgentSession('普通会话')
  assert.equal(
    blockedReason(copy.getLinguistSessionCopyEligibility(deps(service), ordinary.id)),
    'NOT_LINGUIST_SESSION',
  )
  assert.equal(
    blockedReason(copy.getLinguistSessionCopyEligibility(deps(service), 'missing')),
    'SESSION_NOT_FOUND',
  )

  const running = binding.createLinguistProjectChatSession(service, { projectId: project.id })
  assert.equal(
    blockedReason(copy.getLinguistSessionCopyEligibility(
      deps(service, { isSessionActive: (id) => id === running.id }),
      running.id,
    )),
    'RUNNING',
  )

  const incomplete = binding.createLinguistProjectChatSession(service, { projectId: project.id })
  sessions.appendSDKMessages(incomplete.id, [{
    type: 'assistant',
    message: { content: [{ type: 'text', text: '尚未收束' }] },
    parent_tool_use_id: null,
    uuid: 'assistant-incomplete',
  }])
  assert.equal(
    blockedReason(copy.getLinguistSessionCopyEligibility(deps(service), incomplete.id)),
    'NO_COMPLETED_ASSISTANT',
  )

  const corrupt = binding.createLinguistProjectChatSession(service, { projectId: project.id })
  writeFileSync(
    join(tempHome, '.linguist-agent', 'agent-sessions', `${corrupt.id}.jsonl`),
    '{bad json\n',
  )
  assert.equal(
    blockedReason(copy.getLinguistSessionCopyEligibility(deps(service), corrupt.id)),
    'HISTORY_UNREADABLE',
  )
  service.closeAll()
})

test('已完成会话只传最新成功主线 assistant 给原生 fork，并使用目标 binding', async () => {
  const service = makeService()
  const sourceProject = service.createProject({
    name: '已归档源',
    sourceLocale: 'en',
    targetLocale: 'zh-CN',
  })
  const targetProject = service.createProject({
    name: '活跃目标',
    sourceLocale: 'en',
    targetLocale: 'fr',
  })
  const source = sessions.createAgentSession(
    '完整历史',
    'channel-id',
    undefined,
    'model-id',
    undefined,
    undefined,
    {
      linguistProjectId: sourceProject.id,
      linguistProjectName: sourceProject.name,
      linguistRole: 'proofreader',
    },
  )
  seedPiArtifact(source.id, ['assistant-one', 'assistant-two'])
  sessions.appendSDKMessages(source.id, [
    {
      type: 'assistant',
      message: { content: [{ type: 'text', text: '第一轮' }] },
      parent_tool_use_id: null,
      uuid: 'assistant-one',
    },
    successResult('sdk-source'),
    {
      type: 'assistant',
      message: { content: [{ type: 'text', text: '第二轮' }] },
      parent_tool_use_id: null,
      uuid: 'assistant-two',
    },
    successResult('sdk-source'),
  ])
  service.archiveProject(sourceProject.id)

  let observed:
    | {
        input: { sessionId: string; upToMessageUuid?: string }
        options: AgentSessionForkOptions
      }
    | undefined
  const forkSession: LinguistSessionCopyDependencies['forkSession'] = async (input, options) => {
    observed = { input, options }
    return sessions.createAgentSession(
      options.title,
      source.channelId,
      options.workspaceId,
      source.modelId,
      undefined,
      undefined,
      options.linguistBinding,
    )
  }

  const result = await copy.copyLinguistSessionToProject(
    deps(service, { forkSession }),
    { sessionId: source.id, targetProjectId: targetProject.id },
  )

  assert.equal(observed?.input.upToMessageUuid, 'assistant-two')
  assert.equal(observed?.options.copyWorkspaceFiles, false)
  assert.equal(observed?.options.inheritSessionConfig, true)
  assert.equal(observed?.options.requirePortableArtifacts, true)
  assert.equal(observed?.options.linguistBinding.linguistProjectId, targetProject.id)
  assert.equal(observed?.options.linguistBinding.linguistRole, 'proofreader')
  assert.equal(result.linguistProjectId, targetProject.id)
  service.closeAll()
})

test('目标必须不同、活跃且健康；复制失败不改变源会话', async () => {
  const service = makeService()
  const sourceProject = service.createProject({
    name: '源',
    sourceLocale: 'en',
    targetLocale: 'zh-CN',
  })
  const archivedTarget = service.createProject({
    name: '归档目标',
    sourceLocale: 'en',
    targetLocale: 'ja',
  })
  const source = binding.createLinguistProjectChatSession(service, { projectId: sourceProject.id })
  service.archiveProject(archivedTarget.id)
  const before = sessions.getAgentSessionMeta(source.id)

  await assert.rejects(
    copy.copyLinguistSessionToProject(
      deps(service),
      { sessionId: source.id, targetProjectId: sourceProject.id },
    ),
    copy.LinguistSessionCopyTargetError,
  )
  await assert.rejects(
    copy.copyLinguistSessionToProject(
      deps(service),
      { sessionId: source.id, targetProjectId: archivedTarget.id },
    ),
    copy.LinguistSessionCopyTargetError,
  )
  assert.deepEqual(sessions.getAgentSessionMeta(source.id), before)
  service.closeAll()
})

test('空白复制在元数据继承失败时回滚新会话', async () => {
  const service = makeService()
  const sourceProject = service.createProject({
    name: '回滚源',
    sourceLocale: 'en',
    targetLocale: 'zh-CN',
  })
  const targetProject = service.createProject({
    name: '回滚目标',
    sourceLocale: 'en',
    targetLocale: 'de',
  })
  const source = binding.createLinguistProjectChatSession(service, { projectId: sourceProject.id })
  const beforeIds = new Set(sessions.listAgentSessions().map((session) => session.id))

  await assert.rejects(
    copy.copyLinguistSessionToProject(
      deps(service, {
        createBlankSession: (sourceMeta, title, workspaceId, linguistBinding) => {
          const created = sessions.createAgentSession(
            title,
            sourceMeta.channelId,
            workspaceId,
            sourceMeta.modelId,
            undefined,
            undefined,
            linguistBinding,
          )
          sessions.deleteAgentSession(created.id)
          throw new Error('继承失败')
        },
      }),
      { sessionId: source.id, targetProjectId: targetProject.id },
    ),
    /继承失败/,
  )
  assert.deepEqual(
    sessions.listAgentSessions().filter((session) => !beforeIds.has(session.id)),
    [],
  )
  service.closeAll()
})

test('缺失源项目只要历史 artifact 可读仍可复制', async () => {
  const service = makeService()
  const sourceProject = service.createProject({
    name: '会被删除',
    sourceLocale: 'en',
    targetLocale: 'zh-CN',
  })
  const targetProject = service.createProject({
    name: '仍然活跃',
    sourceLocale: 'en',
    targetLocale: 'es',
  })
  const source = sessions.createAgentSession(
    '缺失源历史',
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    {
      linguistProjectId: sourceProject.id,
      linguistProjectName: sourceProject.name,
      linguistRole: 'translator',
    },
  )
  seedPiArtifact(source.id, ['assistant-readable'])
  sessions.appendSDKMessages(source.id, [
    {
      type: 'assistant',
      message: { content: [{ type: 'text', text: '可读历史' }] },
      parent_tool_use_id: null,
      uuid: 'assistant-readable',
    },
    successResult('sdk-missing-source'),
  ])
  service.archiveProject(sourceProject.id)
  service.deleteProject(sourceProject.id, sourceProject.name)

  const copied = await copy.copyLinguistSessionToProject(
    deps(service, {
      forkSession: async (_input, options) => sessions.createAgentSession(
        options.title,
        undefined,
        options.workspaceId,
        undefined,
        undefined,
        undefined,
        options.linguistBinding,
      ),
    }),
    { sessionId: source.id, targetProjectId: targetProject.id },
  )
  assert.equal(copied.linguistProjectId, targetProject.id)
  assert.equal(
    readFileSync(
      join(tempHome, '.linguist-agent', 'agent-sessions', `${source.id}.jsonl`),
      'utf-8',
    ).includes('assistant-readable'),
    true,
  )
  service.closeAll()
})

test('原生分叉失败返回稳定阻断原因且不留下副本', async () => {
  const service = makeService()
  const sourceProject = service.createProject({
    name: '原生失败源',
    sourceLocale: 'en',
    targetLocale: 'zh-CN',
  })
  const targetProject = service.createProject({
    name: '原生失败目标',
    sourceLocale: 'en',
    targetLocale: 'de',
  })
  const source = sessions.createAgentSession(
    '原生失败',
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    {
      linguistProjectId: sourceProject.id,
      linguistProjectName: sourceProject.name,
      linguistRole: 'general',
    },
  )
  seedPiArtifact(source.id, ['assistant-native-failure'])
  sessions.appendSDKMessages(source.id, [
    {
      type: 'assistant',
      message: { content: [{ type: 'text', text: '完成' }] },
      parent_tool_use_id: null,
      uuid: 'assistant-native-failure',
    },
    successResult('sdk-native-failure'),
  ])
  const beforeIds = sessions.listAgentSessions().map((session) => session.id)

  await assert.rejects(
    copy.copyLinguistSessionToProject(
      deps(service, {
        forkSession: async () => {
          throw new Error('/private/native/artifact is corrupt')
        },
      }),
      { sessionId: source.id, targetProjectId: targetProject.id },
    ),
    (error: unknown) => {
      assert.ok(error instanceof copy.LinguistSessionCopyBlockedError)
      assert.equal(error.reason, 'HISTORY_UNREADABLE')
      assert.equal(error.message.includes('/private/'), false)
      return true
    },
  )
  assert.deepEqual(sessions.listAgentSessions().map((session) => session.id), beforeIds)
  service.closeAll()
})

test('目标在异步分叉期间归档时回滚已创建副本', async () => {
  const service = makeService()
  const sourceProject = service.createProject({
    name: '竞态源',
    sourceLocale: 'en',
    targetLocale: 'zh-CN',
  })
  const targetProject = service.createProject({
    name: '竞态目标',
    sourceLocale: 'en',
    targetLocale: 'fr',
  })
  const source = sessions.createAgentSession(
    '竞态历史',
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    {
      linguistProjectId: sourceProject.id,
      linguistProjectName: sourceProject.name,
      linguistRole: 'general',
    },
  )
  seedPiArtifact(source.id, ['assistant-target-race'])
  sessions.appendSDKMessages(source.id, [
    {
      type: 'assistant',
      message: { content: [{ type: 'text', text: '完成' }] },
      parent_tool_use_id: null,
      uuid: 'assistant-target-race',
    },
    successResult('sdk-target-race'),
  ])
  let copiedId: string | undefined

  await assert.rejects(
    copy.copyLinguistSessionToProject(
      deps(service, {
        forkSession: async (_input, options) => {
          const created = sessions.createAgentSession(
            options.title,
            undefined,
            options.workspaceId,
            undefined,
            undefined,
            undefined,
            options.linguistBinding,
          )
          copiedId = created.id
          service.archiveProject(targetProject.id)
          return created
        },
      }),
      { sessionId: source.id, targetProjectId: targetProject.id },
    ),
    copy.LinguistSessionCopyTargetError,
  )
  assert.ok(copiedId)
  assert.equal(sessions.getAgentSessionMeta(copiedId!), undefined)
  assert.ok(sessions.getAgentSessionMeta(source.id))
  service.closeAll()
})
