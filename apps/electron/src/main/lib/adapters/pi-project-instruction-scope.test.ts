import { expect, test } from 'bun:test'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Type, InMemoryCredentialStore, createAssistantMessageEventStream, type AssistantMessage } from '@earendil-works/pi-ai'
import { getModel } from '@earendil-works/pi-ai/compat'
import { createAgentSession, DefaultResourceLoader, ModelRuntime, SessionManager, SettingsManager } from '@earendil-works/pi-coding-agent'
import { ProjectInstructionScopeController } from './pi-project-instruction-scope'

test('子目录规则阻断当前工具批，在同一任务下一模型轮持久交付并允许重试', async () => {
  const root = mkdtempSync(join(tmpdir(), 'proma-scope-turn-'))
  const nested = join(root, 'nested')
  mkdirSync(nested)
  writeFileSync(join(nested, 'AGENTS.md'), 'SCOPE_RULE_01957: nested 输出必须保留占位符。')
  const controller = new ProjectInstructionScopeController({ projectRoot: root, cwd: root, initialSources: [] })
  const settingsManager = SettingsManager.inMemory({ compaction: { enabled: false }, retry: { enabled: false }, cacheWarming: 'off' })
  const sessionManager = SessionManager.inMemory(root)
  const credentials = new InMemoryCredentialStore()
  await credentials.modify('openai', async () => ({ type: 'api_key', key: 'synthetic-no-network' }))
  const modelRuntime = await ModelRuntime.create({
    credentials,
    modelsPath: null,
    allowModelNetwork: false,
    refreshOnCreate: false,
  })
  const resourceLoader = new DefaultResourceLoader({
    cwd: root, agentDir: join(root, 'agent'), settingsManager,
    noExtensions: true, noSkills: true, noPromptTemplates: true, noThemes: true, noContextFiles: true,
    systemPromptOverride: () => 'SYNTHETIC_BASE_PROMPT',
    extensionFactories: [controller.createExtension()],
  })
  await resourceLoader.reload()
  let executed = 0
  const { session } = await createAgentSession({
    cwd: root, agentDir: join(root, 'agent'), settingsManager, sessionManager, modelRuntime, resourceLoader,
    model: getModel('openai', 'gpt-4o-mini'), noTools: 'builtin',
    customTools: [{
      name: 'read', label: 'Synthetic read', description: 'Test only',
      parameters: Type.Object({ path: Type.String() }),
      async execute() { executed++; return { content: [{ type: 'text', text: 'synthetic file' }], details: {} } },
    }],
  })
  const requests: string[] = []
  const executionsAtRequest: number[] = []
  session.agent.toolExecution = 'sequential'
  session.agent.streamFunction = (model, context) => {
    requests.push(JSON.stringify(context))
    executionsAtRequest.push(executed)
    const round = requests.length
    const content: AssistantMessage['content'] = round < 3
      ? Array.from({ length: round === 1 ? 2 : 1 }, (_, index) => ({
          type: 'toolCall' as const, id: `read-${round}-${index}`, name: 'read', arguments: { path: join(nested, 'item.txt') },
        }))
      : [{ type: 'text', text: 'done' }]
    const message: AssistantMessage = {
      role: 'assistant', api: model.api, provider: model.provider, model: model.id, content,
      stopReason: round < 3 ? 'toolUse' : 'stop', timestamp: Date.now(),
      usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
    }
    const stream = createAssistantMessageEventStream()
    stream.push({ type: 'done', reason: message.stopReason as 'toolUse' | 'stop', message })
    return stream
  }
  try {
    await session.prompt('读取 nested/item.txt')
    expect(session.agent.state.errorMessage).toBeUndefined()
    expect(requests).toHaveLength(3)
    expect(executionsAtRequest).toEqual([0, 0, 1])
    expect(requests[0]).not.toContain('SCOPE_RULE_01957')
    expect(requests[1]).toContain('SCOPE_RULE_01957')
    const entries = sessionManager.getEntries()
    const rules = entries.filter(entry => entry.type === 'custom_message' && entry.customType === 'proma-project-instructions')
    expect(rules).toHaveLength(1)
    expect(JSON.stringify(sessionManager.buildSessionContext().messages)).toContain('SCOPE_RULE_01957')
    const toolResults = session.agent.state.messages.filter(message => message.role === 'toolResult')
    expect(toolResults.map(message => message.isError)).toEqual([true, true, false])
  } finally {
    session.dispose()
    rmSync(root, { recursive: true, force: true })
  }
}, 15000)
