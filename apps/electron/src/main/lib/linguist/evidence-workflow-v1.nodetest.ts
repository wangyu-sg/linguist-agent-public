import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createServer } from 'node:http'
import { once } from 'node:events'
import { Agent } from '@earendil-works/pi-agent-core'
import { getModel, streamSimple } from '@earendil-works/pi-ai/compat'
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
import { createEvidenceSubmissionObserver } from './evidence-submission'

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
  const requests: string[] = []
  const provider = createServer(async (request, response) => {
    let body = ''
    for await (const chunk of request) body += String(chunk)
    requests.push(body)
    response.writeHead(200, { 'Content-Type': 'text/event-stream' })
    response.end(`data: ${JSON.stringify({ id: 'fake', object: 'chat.completion.chunk', choices: [{ index: 0, delta: { content: '已收到资料' }, finish_reason: null }] })}\n\ndata: ${JSON.stringify({ id: 'fake', object: 'chat.completion.chunk', choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] })}\n\ndata: [DONE]\n\n`)
  })
  provider.listen(0, '127.0.0.1')
  await once(provider, 'listening')
  const address = provider.address()
  assert.ok(address && typeof address !== 'string')
  const model = { ...getModel('openai', 'gpt-4o-mini'), api: 'openai-completions' as const, baseUrl: `http://127.0.0.1:${address.port}/v1` }
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
    const imageDoc = db.contextDocs.insert({ kind: 'image', originalFilename: 'reference.gif', blobRelpath: 'blobs/reference.gif', sha256: 'b'.repeat(64) })
    db.contextDocs.setEvidenceLink({ contextDocId: imageDoc.id, relation: { kind: 'segment', segmentId }, requiredness: 'required', mappingRevision: '1' })
    const image = { type: 'image' as const, mimeType: 'image/gif', data: Buffer.from('474946383961010001000000003b', 'hex').toString('base64') }
    const scope: ProjectDiscoveryScope = {
      roots: [],
      files: [],
      unavailable: [],
      managedEvidence: [{
        ref: { kind: 'asset', id: imported.asset.id },
        version: imported.asset.sourceSha256,
      }, { ref: { kind: 'context-doc', id: imageDoc.id }, version: imageDoc.sha256! }],
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
      let failBookkeeping = true
      const unverified: unknown[] = []
      const observer = createEvidenceSubmissionObserver(receipt => {
        if (failBookkeeping) throw new Error('synthetic receipt write failure')
        db.stageEvidence.recordReceipt(receipt)
      }, error => { unverified.push(error) })
      const tools = createLinguistCatTools({
        resolveProject: () => ({ project, db }),
        sessionId,
        linguistRole: role,
        stageEvidenceRunId: state.stageRunId,
        onEvidencePrepared: observer.prepare,
        readContextImage: async () => image,
        reviewScopeSegmentIds: [segmentId],
        generationProvenance: (toolCallId) => ({ runId: `${sessionId}:${toolCallId}` }),
      })
      const contextTool = toolByName(tools, 'cat_get_translation_context')
      const confirmTool = toolByName(tools, 'cat_confirm_segments')
      const prepared = await invoke(
        contextTool,
        `${role}-context`,
        { segmentIds: [segmentId], includeNeighbors: false },
      )
      assert.equal(db.stageEvidence.listReceipts(state.stageRunId).length, 0, '工具返回但没有下一次模型请求，不得签收')
      observer.onPayload({ messages: [] })
      observer.onResponse({ status: 200 })
      assert.equal(db.stageEvidence.listReceipts(state.stageRunId).length, 0, '压缩删除的内容不得签收')
      const agent = new Agent({
        initialState: { model, messages: [{ role: 'toolResult', toolCallId: `${role}-context`, toolName: contextTool.name, ...prepared, isError: false, timestamp: 0 }] },
        convertToLlm,
        transformContext: async messages => sanitizePiMessageImageContent(messages),
        streamFn: streamSimple,
        getApiKey: () => 'synthetic-test-key',
        onPayload: observer.onPayload,
        onResponse: observer.onResponse,
      })
      await agent.prompt('继续当前任务')
      assert.equal(agent.state.errorMessage, undefined)
      assert.ok(requests.at(-1)?.includes('pull down'), '真实本地 HTTP 请求必须包含译文')
      assert.equal(db.stageEvidence.listReceipts(state.stageRunId).length, 0)
      assert.equal(unverified.length, 1, '记账失败不能把已发生的模型请求变成失败')
      failBookkeeping = false
      await agent.prompt('继续')
      assert.equal(db.stageEvidence.listReceipts(state.stageRunId).length, 1, '重试不得重复记账')
      const visual = await invoke(toolByName(tools, 'cat_read_context_doc'), `${role}-image`, { docId: imageDoc.id })
      observer.onPayload({ content: visual.content })
      observer.onResponse({ status: 503 })
      assert.equal(db.stageEvidence.getPresentationCoverage(state.stageRunId).presented, 1, '失败响应不确认图片')
      for (const mode of ['text-only', 'invalid-image', 'visual'] as const) {
        const content = mode === 'invalid-image' ? visual.content.map(block => block.type === 'image' ? { ...block, data: 'invalid' } : block) : visual.content
        const visualAgent = new Agent({
          initialState: { model: mode === 'text-only' ? { ...model, input: ['text'] } : model,
            messages: [{ role: 'toolResult', toolCallId: `${role}-image`, toolName: 'cat_read_context_doc', content, isError: false, timestamp: 0 }] },
          convertToLlm, transformContext: async messages => sanitizePiMessageImageContent(messages),
          streamFn: streamSimple, getApiKey: () => 'synthetic-test-key',
          onPayload: observer.onPayload, onResponse: observer.onResponse,
        })
        await visualAgent.prompt('继续')
        assert.equal(visualAgent.state.errorMessage, undefined)
        assert.equal(requests.at(-1)?.includes(image.data), mode === 'visual')
        assert.equal(db.stageEvidence.getPresentationCoverage(state.stageRunId).presented, mode === 'visual' ? 2 : 1)
      }
      const result = await invoke(
        confirmTool,
        `${role}-confirm`,
        { items: [{ segmentId, expectedRevision: 0, decision: 'unchanged' }] },
      ) as AgentToolResult<{ fullReview?: { status: string } }>
      assert.equal(result.details?.fullReview?.status, 'complete')
    }
  } finally {
    provider.closeAllConnections()
    await new Promise<void>((resolve, reject) => provider.close(error => error ? reject(error) : resolve()))
    db.close()
  }
})
