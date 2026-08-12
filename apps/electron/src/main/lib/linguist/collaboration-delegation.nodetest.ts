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
const sessionCatTools = await import('./session-cat-tools')
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

    const started = await delegate.execute('call-reviewer', {
      task: '审校当前批次',
      linguistRole: 'reviewer',
      linguistScope: { batchId: imported.assetId },
    }) as { details: { delegation: { status: string; linguistOutcome?: Record<string, unknown> } } }

    const child = sessionManager.listAgentSessions().find((session) => session.parentSessionId === parent.id)
    assert.ok(child)
    assert.equal(child.workspaceId, parent.workspaceId)
    assert.equal(child.linguistProjectId, project.id)
    assert.equal(child.linguistRole, 'reviewer')
    assert.equal(child.agentCwdMode, 'session')
    assert.deepEqual(child.linguistDelegatedScope?.assetIds, [imported.assetId])
    assert.equal(child.linguistDelegatedScope?.segmentIds.length, imported.segmentCount)
    assert.ok(sessionCatTools.resolveLinguistSessionCatTools(child, () => service).length > 0)
    assert.equal(capturedInput?.workspaceId, parent.workspaceId)
    assert.equal(capturedInput?.triggeredBy, 'delegation')
    assert.match(capturedInput?.userMessage ?? '', /冻结 CAT 范围/)
    assert.equal(started.details.delegation.status, 'completed')
    assert.deepEqual(started.details.delegation.linguistOutcome, {
      role: 'reviewer',
      stage: 'editing',
      total: imported.segmentCount,
      decided: 0,
      confirmed: 0,
      unchanged: 0,
      corrected: 0,
      blocked: 0,
      pending: imported.segmentCount,
      status: 'in_progress',
    })

    const db = service.openProject(project.id)
    const frozenSegments = db.segments.getByIds(child.linguistDelegatedScope!.segmentIds)
    const lockedCount = frozenSegments.filter((segment) => segment.locked).length
    for (const segment of frozenSegments) {
      if (segment.locked) {
        db.segments.recordCurrentStageDecision(
          segment.id,
          'editing',
          segment.revision,
          'blocked',
        )
        continue
      }
      const translated = db.segments.applyTargetEdit(
        segment.id,
        `译文 ${segment.id}`,
        segment.revision,
      ).segment
      db.segments.recordCurrentStageDecision(
        translated.id,
        'translation',
        translated.revision,
        'corrected',
      )
      db.segments.recordCurrentStageDecision(
        translated.id,
        'editing',
        translated.revision,
        'unchanged',
      )
    }
    const getResults = tools.find((tool) => tool.name === 'mcp__collaboration__get_delegation_results')!
    const completed = await getResults.execute('call-results', {
      delegationIds: [child.sourceDelegationId],
    }) as { details: { delegations: Array<{ linguistOutcome?: Record<string, unknown> }> } }
    assert.deepEqual(completed.details.delegations[0]?.linguistOutcome, {
      role: 'reviewer',
      stage: 'editing',
      total: imported.segmentCount,
      decided: imported.segmentCount,
      confirmed: 0,
      unchanged: imported.segmentCount - lockedCount,
      corrected: 0,
      blocked: lockedCount,
      pending: 0,
      status: lockedCount > 0 ? 'completed_with_blocks' : 'complete',
    })
  } finally {
    service.closeAll()
    rmSync(tempHome, { recursive: true, force: true })
  }
})
