import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const tempHome = mkdtempSync(join(tmpdir(), 'linguist-delegation-'))
process.env.HOME = tempHome

const projectService = await import('./project-service')
const sessionBinding = await import('./session-binding')
const sessionManager = await import('../agent-session-manager')
const collaboration = await import('../agent-collaboration-tools')
const headless = await import('../agent-headless-runner-registry')
const { readFixture } = await import('./test/service-testkit')

test('General 委派 Reviewer 时继承 workspace/project 并冻结真实 Segment 范围', async () => {
  const service = projectService.initLinguistProjectService({
    rootDir: join(tempHome, '.linguist-agent', 'linguist'),
  })
  try {
    const project = service.createProject({ name: '委派项目', sourceLocale: 'en', targetLocale: 'zh-CN' })
    const imported = await service.importAsset(project.id, {
      filename: 'mini_dialogue.csv',
      bytes: readFixture('mini_dialogue.csv'),
    })
    const parent = sessionBinding.createLinguistProjectChatSession(service, {
      projectId: project.id,
      role: 'general',
    })
    assert.ok(parent.workspaceId)

    let capturedInput: { workspaceId?: string; triggeredBy?: string; userMessage: string } | undefined
    headless.setHeadlessAgentRunner(async (input, callbacks) => {
      capturedInput = input
      callbacks.onComplete([])
    })
    const sdk = { defineTool: (tool: unknown) => tool } as never
    const tools = collaboration.buildPiCollaborationTools(sdk, {
      sessionId: parent.id,
      channelId: 'test-channel',
      workspaceId: parent.workspaceId,
    }) as Array<{ name: string; execute: (toolCallId: string, input: unknown) => Promise<unknown> }>
    const delegate = tools.find((tool) => tool.name === 'mcp__collaboration__delegate_agent')!

    await delegate.execute('call-reviewer', {
      task: '审校当前批次',
      linguistRole: 'reviewer',
      linguistScope: { batchId: imported.assetId },
    })

    const child = sessionManager.listAgentSessions().find((session) => session.parentSessionId === parent.id)
    assert.ok(child)
    assert.equal(child.workspaceId, parent.workspaceId)
    assert.equal(child.linguistProjectId, project.id)
    assert.equal(child.linguistRole, 'reviewer')
    assert.deepEqual(child.linguistDelegatedScope?.assetIds, [imported.assetId])
    assert.equal(child.linguistDelegatedScope?.segmentIds.length, imported.segmentCount)
    assert.equal(capturedInput?.workspaceId, parent.workspaceId)
    assert.equal(capturedInput?.triggeredBy, 'delegation')
    assert.match(capturedInput?.userMessage ?? '', /冻结 CAT 范围/)
  } finally {
    service.closeAll()
    rmSync(tempHome, { recursive: true, force: true })
  }
})
