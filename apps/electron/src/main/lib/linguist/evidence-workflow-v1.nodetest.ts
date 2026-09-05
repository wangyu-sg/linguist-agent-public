import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { AgentToolResult, ExtensionContext } from '@earendil-works/pi-coding-agent'
import { convertToLlm, SessionManager } from '@earendil-works/pi-coding-agent'
import { createSeededEntropy } from '@linguist/cat-core'
import { CatStore } from '@linguist/cat-store'
import { createLinguistCatTools } from '@linguist/cat-tools'
import type { ProjectDiscoveryScope } from './project-discovery-scope'
import { ensureStageEvidenceForSession } from './stage-evidence-host'
import { toolResult } from '../../../../../../packages/linguist-cat-tools/src/tool-runtime'
import { normalizeLegacyCatSessionFile } from './legacy-cat-session'
import { sanitizePiMessageImageContent } from '../image-content-validation'

test('CAT 自含正文与合法图片经过真实 Pi 转换后仍进入模型内容', () => {
  const result = toolResult({ text: '必须实际提供的参考正文' })
  const image = { type: 'image' as const, mimeType: 'image/gif', data: Buffer.from('474946383961010001000000003b', 'hex').toString('base64') }
  const messages = convertToLlm(sanitizePiMessageImageContent([{
    role: 'toolResult' as const, toolCallId: 'context-image', toolName: 'cat_read_context_doc',
    content: [...result.content, image], details: result.details, isError: false, timestamp: 0,
  }]))
  assert.ok(messages[0]?.role === 'toolResult')
  assert.equal(messages[0].content.filter(block => block.type === 'image').length, 1)
  assert.ok(result.content.some(block => block.type === 'text' && block.text.includes('必须实际提供的参考正文')))
  const mixed = convertToLlm(sanitizePiMessageImageContent([{
    role: 'toolResult' as const, toolCallId: 'mcp-image', toolName: 'mcp_reference',
    content: [{ type: 'text' as const, text: '前' }, image, { type: 'text' as const, text: '后' },
      { ...image, data: 'invalid' }], isError: false, timestamp: 0,
  }]))
  assert.ok(mixed[0]?.role === 'toolResult')
  assert.deepEqual(mixed[0].content.slice(0, 3), [{ type: 'text', text: '前' }, image, { type: 'text', text: '后' }])
  assert.equal(mixed[0].content.filter(block => block.type === 'image').length, 1)
})

test('旧 CAT 会话备份迁移后保留正文、图片和 Pi 树身份，重复恢复不再写入', () => {
  const root = mkdtempSync(join(tmpdir(), 'cat-legacy-session-'))
  const file = join(root, 'session.jsonl')
  const rows = [
    { type: 'session', version: 3, id: 'legacy', timestamp: new Date(0).toISOString(), cwd: root },
    { type: 'message', id: 'user', parentId: null, timestamp: new Date(1).toISOString(), message: { role: 'user', content: '读取参考', timestamp: 1 } },
    { type: 'message', id: 'result', parentId: 'user', timestamp: new Date(2).toISOString(), message: {
      role: 'toolResult', toolName: 'cat_read_context_doc', toolCallId: 'old-call', isError: false, timestamp: 2,
      content: [{ type: 'text', text: 'CAT tool result. Structured data is available in details.' },
        { type: 'image', mimeType: 'image/gif', data: Buffer.from('474946383961010001000000003b', 'hex').toString('base64') }],
      details: { docId: 'anonymous', text: '历史正文' },
    } },
  ]
  const original = rows.map(row => JSON.stringify(row)).join('\n') + '\n'
  writeFileSync(file, original)
  normalizeLegacyCatSessionFile(file)
  assert.equal(readFileSync(`${file}.before-cat-content-v1`, 'utf8'), original)
  const session = SessionManager.open(file, root, root)
  assert.equal(session.getLeafId(), 'result')
  assert.equal(session.getEntry('result')?.parentId, 'user')
  const messages = convertToLlm(session.buildSessionContext().messages)
  assert.ok(JSON.stringify(messages).includes('历史正文'))
  assert.ok(JSON.stringify(messages).includes('image/gif'))
  const migrated = readFileSync(file, 'utf8')
  normalizeLegacyCatSessionFile(file)
  assert.equal(readFileSync(file, 'utf8'), migrated)
  session.appendCompaction('旧任务摘要', 'result', 200)
  session.appendMessage({ role: 'user', content: '继续', timestamp: 3 })
  const resumed = SessionManager.open(file, root, root)
  const retained = convertToLlm(resumed.buildSessionContext().messages)
  assert.ok(JSON.stringify(retained).includes('历史正文'))
  assert.ok(JSON.stringify(retained).includes('image/gif'))
  resumed.branch('result')
  assert.equal(resumed.getLeafId(), 'result')
})

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
