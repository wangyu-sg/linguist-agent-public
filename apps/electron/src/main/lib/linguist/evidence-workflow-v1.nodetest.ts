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
import { createSeededEntropy, type ContextExtraction, type ContextAnchor } from '@linguist/cat-core'
import { CatStore } from '@linguist/cat-store'
import { createLinguistCatTools, type CatReadContextDocResult } from '@linguist/cat-tools'
import type { ProjectDiscoveryScope } from './project-discovery-scope'
import { ensureStageEvidenceForSession } from './stage-evidence-host'
import { toolResult } from '../../../../../../packages/linguist-cat-tools/src/tool-runtime'
import { normalizeLegacyCatSessionFile } from './legacy-cat-session'
import { sanitizePiMessageImageContent } from '../image-content-validation'
import { createEvidenceSubmissionObserver } from './evidence-submission'
import { formatContextExtractionText } from './context-extractor'

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

test('Context 跨页区间有间隙不完成，连续覆盖支持旧无 anchor 文本且最终输出有界', async () => {
  const store = new CatStore({ rootDir: mkdtempSync(join(tmpdir(), 'evidence-pages-')), entropy: createSeededEntropy('pages') })
  const project = store.createProject({ name: 'Pages', sourceLocale: 'en', targetLocale: 'zh-CN', promaWorkspaceId: 'workspace' })
  const db = store.openProject(project.id)
  try {
    const asset = db.assets.insertImported({ asset: { formatId: 'fixture', originalFilename: 'batch.xlf', sourceSha256: 'a'.repeat(64), segmentCount: 1 },
      segments: [{ ordinal: 0, key: 'one', source: 'source', target: '译文', sourceLocale: 'en', targetLocale: 'zh-CN', status: 'translated', locked: false, revision: 0, sourceHash: 'source' }], warnings: [], originalBytes: new Uint8Array([1]) })
    for (const legacy of [false, true]) {
      const body = '中😀文\n[anchor=fake] 客户原文\n'.repeat(130)
      const extraction: ContextExtraction = { textSections: [{ id: 'text', anchorId: 'real', text: body }],
        anchors: [{ id: 'real', locator: { kind: 'paragraph', index: 0 }, textSectionId: 'text' }], media: [], warnings: [] }
      const text = legacy ? body : formatContextExtractionText(extraction)!
      const doc = db.contextDocs.insert({ kind: 'doc', originalFilename: `${legacy}.txt`, blobRelpath: `blobs/${legacy}.txt`, sha256: (legacy ? 'c' : 'b').repeat(64), textExtract: text })
      if (!legacy) db.contextDocs.replaceExtraction(doc.id, [{ id: 'real', locator: extraction.anchors[0]!.locator, text: body }])
      if (!legacy) {
        const preserved = db.contextDocs.listAnchors(doc.id)
        assert.throws(() => db.contextDocs.replaceExtraction(doc.id, [{ id: 'bad', locator: { kind: 'paragraph', index: 0, textRange: { start: 0, end: text.length + 1 } }, text }]), /offsets do not match/)
        assert.deepEqual(db.contextDocs.listAnchors(doc.id), preserved)
      }
      const segmentId = asset.segments[0]!.id
      db.contextDocs.setEvidenceLink({ contextDocId: doc.id, ...(legacy ? {} : { anchorId: 'real' }), relation: { kind: 'segment', segmentId }, requiredness: 'required', mappingRevision: '1' })
      const state = ensureStageEvidenceForSession({ session: { id: doc.id, linguistRole: 'reviewer' }, db, fallbackSegmentIds: [segmentId],
        discoveryScope: { roots: [], files: [], unavailable: [], hash: doc.id, managedEvidence: [{ ref: { kind: 'asset', id: asset.asset.id }, version: asset.asset.sourceSha256 }, { ref: { kind: 'context-doc', id: doc.id }, version: doc.sha256! }] } })!
      const observer = createEvidenceSubmissionObserver(receipt => { db.stageEvidence.recordReceipt(receipt) }, error => { throw error })
      const tools = createLinguistCatTools({ resolveProject: () => ({ project, db }), resultProjectId: project.id, sessionId: doc.id, stageEvidenceRunId: state.stageRunId, onEvidencePrepared: observer.prepare })
      const tool = toolByName(tools, 'cat_read_context_doc')
      const pages: Array<{ offset: number; result: AgentToolResult<unknown> }> = []
      let offset = 0
      do {
        const result = await invoke(tool, `${doc.id}:${offset}`, { docId: doc.id, offset, limit: 1_000, maxBytes: 1_800 })
        const dto = result.details as { text: string; nextOffset?: number; usedBytes: number }
        assert.ok(Buffer.byteLength(result.content.filter(block => block.type === 'text').map(block => block.text).join(''), 'utf8') <= 1_800)
        assert.ok(dto.text.length > 0)
        pages.push({ offset, result })
        offset = dto.nextOffset ?? text.length
      } while (offset < text.length)
      assert.equal(pages.map(page => (page.result.details as { text: string }).text).join(''), text)
      for (const page of pages.slice(1)) {
        observer.onPayload({ content: page.result.content })
        observer.onResponse({ status: 200 })
      }
      assert.ok(db.stageEvidence.getPresentationCoverage(state.stageRunId).pending.some(item => item.evidence.id === doc.id), '第一页缺失不能伪报已完整阅读')
      observer.onPayload({ content: pages[0]!.result.content })
      observer.onResponse({ status: 200 })
      assert.ok(!db.stageEvidence.getPresentationCoverage(state.stageRunId).pending.some(item => item.evidence.id === doc.id))
      const count = db.stageEvidence.listReceipts(state.stageRunId).length
      observer.onPayload({ content: pages[0]!.result.content })
      observer.onResponse({ status: 200 })
      assert.equal(db.stageEvidence.listReceipts(state.stageRunId).length, count)
    }
    const large = db.contextDocs.insert({ kind: 'doc', originalFilename: 'catalog.txt', blobRelpath: 'blobs/catalog.txt', textExtract: '目录正文',
      extractionWarnings: Array.from({ length: 37 }, (_, index) => ({ code: `warning-${index}`, message: '必须披露的抽取问题'.repeat(10) })) })
    const anchors: Array<Omit<ContextAnchor, 'contextDocId'>> = []
    for (let index = 0; index < 60; index++) {
      const image = db.contextDocs.insert({ kind: 'image', originalFilename: `${index}.gif`, blobRelpath: `blobs/${index}.gif`, parentContextDocId: large.id })
      anchors.push({ id: `media-${index}`, locator: { kind: 'image', mediaId: image.id }, mediaContextDocId: image.id, label: '目录标签'.repeat(35) })
    }
    db.contextDocs.replaceExtraction(large.id, anchors)
    const reader = toolByName(createLinguistCatTools({ resolveProject: () => ({ project, db }), resultProjectId: project.id }), 'cat_read_context_doc')
    let metadataOffset = 0
    const seen = new Set<string>()
    const warnings = new Set<string>()
    do {
      const result = await invoke(reader, `catalog-${metadataOffset}`, { docId: large.id, metadataOffset, maxBytes: 3_200 })
      const dto = result.details as CatReadContextDocResult
      assert.ok(Buffer.byteLength(JSON.stringify(result.details), 'utf8') <= 3_200)
      dto.anchors?.forEach(anchor => seen.add(anchor.id))
      dto.extractionWarnings?.forEach(warning => warnings.add(warning.code))
      if (dto.nextMetadataOffset === undefined) break
      assert.ok(dto.nextMetadataOffset > metadataOffset)
      metadataOffset = dto.nextMetadataOffset
    } while (true)
    assert.equal(seen.size, 60)
    assert.equal(warnings.size, 37)
    db.contextDocs.updateNote(large.id, '长备注'.repeat(1_000))
    const insufficient = (await invoke(reader, 'small-budget', { docId: large.id, maxBytes: 1_024 })).details as CatReadContextDocResult
    assert.ok(insufficient.minimumRequiredBytes! > 1_024)
    assert.equal(insufficient.nextOffset, undefined)
  } finally { db.close() }
})

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

    for (let index = 0; index < 25; index++) db.styleGuideRules.upsert({ ruleText: `语言规则 ${index}：保留客户要求` })
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
      assert.equal(db.stageEvidence.getPresentationCoverage(state.stageRunId).presented, 21, '失败响应不确认图片')
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
        assert.equal(db.stageEvidence.getPresentationCoverage(state.stageRunId).presented, mode === 'visual' ? 22 : 21)
      }
      const pendingRules = await invoke(confirmTool, `${role}-before-rules`, { items: [{ segmentId, expectedRevision: 0, decision: 'unchanged' }] }) as AgentToolResult<{ fullReview: { status: string } }>
      assert.equal(pendingRules.details.fullReview.status, 'blocked', '逐段决定齐全也不能跳过剩余项目规则')
      const rules = await invoke(contextTool, `${role}-remaining-rules`, { segmentIds: [segmentId], rulesOnly: true, rulesOffset: 20 })
      agent.state.messages = [...agent.state.messages, { role: 'toolResult', toolName: contextTool.name, toolCallId: `${role}-remaining-rules`, ...rules, isError: false, timestamp: 1 }]
      await agent.prompt('已补充余下项目规则，继续确认')
      assert.equal(agent.state.errorMessage, undefined)
      assert.equal(db.stageEvidence.getPresentationCoverage(state.stageRunId).pending.length, 0)
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
