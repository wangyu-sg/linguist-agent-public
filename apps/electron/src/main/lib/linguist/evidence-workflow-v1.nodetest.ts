import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { AgentToolResult, ExtensionContext } from '@earendil-works/pi-coding-agent'
import { createSeededEntropy } from '@linguist/cat-core'
import { CatStore } from '@linguist/cat-store'
import { createLinguistCatTools } from '@linguist/cat-tools'
import type { ProjectDiscoveryScope } from './project-discovery-scope'
import { ensureStageEvidenceForSession } from './stage-evidence-host'

const EXTENSION_CONTEXT = {} as ExtensionContext
type LinguistCatTool = ReturnType<typeof createLinguistCatTools>[number]

function toolByName(tools: LinguistCatTool[], name: string): LinguistCatTool {
  const tool = tools.find((candidate) => candidate.name === name)
  assert.ok(tool)
  return tool
}

function invoke(tool: LinguistCatTool, toolCallId: string, params: unknown): Promise<AgentToolResult<unknown>> {
  return tool.execute(toolCallId, params as never, undefined, undefined, EXTENSION_CONTEXT)
}

test('Translator → Reviewer → Proofreader 共用宿主 Evidence 闭环并分别完成 Full Review', async () => {
  const store = new CatStore({
    rootDir: mkdtempSync(join(tmpdir(), 'evidence-workflow-v1-')),
    entropy: createSeededEntropy('evidence-workflow-v1'),
  })
  const project = store.createProject({
    name: 'Simple Batch',
    sourceLocale: 'zh-CN',
    targetLocale: 'en',
    promaWorkspaceId: 'workspace-1',
  })
  const db = store.openProject(project.id)
  try {
    const imported = db.assets.insertImported({
      asset: {
        formatId: 'fixture',
        originalFilename: 'batch.xlf',
        sourceSha256: 'a'.repeat(64),
        segmentCount: 1,
      },
      segments: [{
        ordinal: 0,
        key: 'one',
        source: '向下拉',
        target: 'pull down',
        sourceLocale: 'zh-CN',
        targetLocale: 'en',
        status: 'translated',
        locked: false,
        revision: 0,
        sourceHash: 'one',
      }],
      warnings: [],
      originalBytes: new Uint8Array([1]),
    })
    const segmentId = imported.segments[0]!.id as string
    const scope: ProjectDiscoveryScope = {
      roots: [],
      files: [],
      unavailable: [],
      managedEvidence: [{
        ref: { kind: 'asset', id: imported.asset.id },
        version: imported.asset.sourceSha256,
      }],
      hash: 'simple-scope',
    }

    for (const role of ['translator', 'reviewer', 'proofreader'] as const) {
      const sessionId = `session-${role}`
      const state = ensureStageEvidenceForSession({
        session: { id: sessionId, linguistRole: role },
        db,
        discoveryScope: scope,
        fallbackSegmentIds: [segmentId],
      })
      assert.ok(state)
      const tools = createLinguistCatTools({
        resolveProject: () => ({ project, db }),
        sessionId,
        linguistRole: role,
        stageEvidenceRunId: state.stageRunId,
        reviewScopeSegmentIds: [segmentId],
        generationProvenance: (toolCallId) => ({ runId: `${sessionId}:${toolCallId}` }),
      })
      const contextTool = toolByName(tools, 'cat_get_translation_context')
      const confirmTool = toolByName(tools, 'cat_confirm_segments')
      await invoke(
        contextTool,
        `${role}-context`,
        { segmentIds: [segmentId], includeNeighbors: false },
      )
      const result = await invoke(
        confirmTool,
        `${role}-confirm`,
        { items: [{ segmentId, expectedRevision: 0, decision: 'unchanged' }] },
      ) as AgentToolResult<{ fullReview?: { status: string } }>
      assert.equal(result.details?.fullReview?.status, 'complete')
    }
  } finally {
    db.close()
  }
})
