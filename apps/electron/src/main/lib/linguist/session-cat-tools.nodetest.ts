/**
 * PB-042 session-cat-tools nodetest（node --test；真实 LinguistProjectService +
 * 真实会话元数据 + 真实 fixture 导入，无 mock）：
 *
 * - 项目对话（active）→ 15 个工具；经应用 resolver 端到端驱动 execute：
 *   summary/list_assets/get_segments 对 mkdtemp 项目 + mini_items.json 播种
 *   断言真实 DTO（资产 id、段计数、段 id 跨调用稳定、assetId/status 过滤、
 *   未知 assetId → ASSET_NOT_FOUND、空 TM/TB 干净空 + note）；
 * - 输出纪律：DTO 无绝对路径（递归扫描）、JSON round-trip；
 * - 普通会话 → []（普通 Chat Tool 列表无 CAT）；
 * - 绑定 missing → 仍装配（文档化选择），execute 抛 PROJECT_MISSING；
 * - 重启 resume：同一 linguist root 重建服务后重解析，段 id 一致（绑定同项目）；
 * - 归档腿：归档后 execute 仍只读可读（openProject 强制只读），summary 带
 *   archived: true + note（发送阻断是 PB-034 闸门职责，不在本票）。
 *
 * 引导纪律同 session-binding.nodetest.ts：先设 HOME 再动态 import。
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { makeClock, makeEntropy, makeTempDir, readFixture } from './test/service-testkit'
import { LinguistProjectService } from './project-service'
import { LINGUIST_CAT_TOOL_NAMES, type PagedResult, type CatSegmentListItem } from '@linguist/cat-tools'
import type { LinguistProjectMutationEvent } from '@proma/shared'

// —— 先建 tmp HOME，再动态 import 触达 config-paths 的模块 ——
const tempHome = makeTempDir()
process.env.HOME = tempHome

const binding = await import('./session-binding')
const catTools = await import('./session-cat-tools')
const sessionManager = await import('../agent-session-manager')
type SessionCatTool = ReturnType<typeof catTools.resolveLinguistSessionCatTools>[number]

const LINGUIST_ROOT = join(tempHome, '.linguist-agent', 'linguist')

let serviceSeq = 0

function makeServiceOnLinguistRoot(): LinguistProjectService {
  let workspaceSeq = 0
  const service = new LinguistProjectService({
    rootDir: LINGUIST_ROOT,
    entropy: makeEntropy(`pb-042-${++serviceSeq}`),
    now: makeClock(),
    workspaceAllocator: () => `ws-pb042-${serviceSeq}-${++workspaceSeq}`,
  })
  service.init()
  return service
}

// ===== 工具驱动辅助 =====

function toolByName(tools: SessionCatTool[], name: string): SessionCatTool {
  const tool = tools.find((candidate) => candidate.name === name)
  assert.ok(tool, `tool ${name} not registered`)
  return tool
}

async function invoke(tool: SessionCatTool, params: unknown): Promise<Record<string, unknown>> {
  const result = await tool.execute('call-1', params as never, undefined, undefined, {} as never)
  const block = result.content[0]
  assert.ok(block && block.type === 'text', 'tool result must start with a text block')
  assert.match(block.text, /^CAT tool result/, 'content 只承载短摘要，不复制完整 DTO')
  assert.ok(result.details !== undefined, '结构化 DTO 必须由 details 承载')
  return result.details as unknown as Record<string, unknown>
}

function collectStrings(value: unknown, out: string[] = []): string[] {
  if (typeof value === 'string') {
    out.push(value)
    return out
  }
  if (Array.isArray(value)) {
    for (const item of value) collectStrings(item, out)
    return out
  }
  if (value !== null && typeof value === 'object') {
    for (const item of Object.values(value)) collectStrings(item, out)
  }
  return out
}

const PROJECT_INPUT = { name: 'CAT 工具项目', sourceLocale: 'en', targetLocale: 'zh-CN' } as const

test('bound active session: CAT tools execute end-to-end against a real seeded project', async () => {
  const service = makeServiceOnLinguistRoot()
  const project = service.createProject({ ...PROJECT_INPUT })
  const imported = await service.importAsset(project.id, {
    bytes: readFixture('mini_items.json'),
    filename: 'mini_items.json',
  })
  assert.ok(imported.segmentCount > 0, 'fixture 应产生段')

  const meta = binding.createLinguistProjectChatSession(service, { projectId: project.id })
  assert.equal(meta.linguistProjectId, project.id)
  const tools = catTools.resolveLinguistSessionCatTools(
    { ...meta, modelId: 'fake-model' },
    () => service,
    undefined,
    (toolCallId) => ({
      sessionId: meta.id,
      runId: 'agent-turn-1',
      toolCallId,
      modelProvider: 'anthropic',
      modelId: 'fake-model',
      runtime: 'claude',
      role: 'assistant',
      strategy: 'balanced',
      linguistPromptVersion: '2.0.0',
      promptHash: '1'.repeat(64),
      projectDigestHash: '2'.repeat(64),
      projectDigestRevision: 'project-r1',
      turnContextVersion: 1,
      turnContextSnapshot: '{"schemaVersion":1}',
      turnContextHash: '3'.repeat(64),
      toolsetHash: '4'.repeat(64),
    }),
  )
  assert.deepEqual(tools.map((t) => t.name), [...LINGUIST_CAT_TOOL_NAMES])
  assert.equal(
    tools.some((tool) => /accept|reject/i.test(tool.name)),
    false,
    'LF-067: Agent Tool 永远不暴露 Proposal accept/reject 权限',
  )

  // summary：真实项目聚合
  const summary = await invoke(toolByName(tools, 'cat_project_summary'), {})
  const summaryProject = summary.project as Record<string, unknown>
  assert.equal(summaryProject.id, project.id)
  assert.equal(summaryProject.name, PROJECT_INPUT.name)
  assert.equal(summaryProject.archived, false)
  assert.equal(summary.projectId, project.id)
  assert.equal(summary.assetCount, 1)
  assert.equal(summary.totalSegments, imported.segmentCount)

  // list_assets：资产 id/文件名真实
  const assets = (await invoke(toolByName(tools, 'cat_list_assets'), {})) as unknown as PagedResult<{
    assetId: string
    filename: string
    segmentCount: number
  }>
  assert.equal(assets.total, 1)
  assert.equal(assets.items[0]!.assetId, imported.assetId)
  assert.equal(assets.items[0]!.filename, 'mini_items.json')
  assert.equal(assets.items[0]!.segmentCount, imported.segmentCount)

  // get_segments：总数 + 已知源文 + id 跨调用稳定
  const segments = (await invoke(toolByName(tools, 'cat_get_segments'), {})) as unknown as PagedResult<CatSegmentListItem>
  assert.equal(segments.total, imported.segmentCount)
  assert.ok(segments.items.some((s) => s.source.includes('Health Potion')), '应含 fixture 源文')
  assert.equal((segments as unknown as { projectId: string }).projectId, project.id)
  assert.equal(
    (segments as unknown as { segmentId: string }).segmentId,
    segments.items[0]!.id,
  )
  const segmentsAgain = (await invoke(toolByName(tools, 'cat_get_segments'), {})) as unknown as PagedResult<CatSegmentListItem>
  assert.deepEqual(segmentsAgain.items.map((s) => s.id), segments.items.map((s) => s.id))

  // assetId 过滤：同源资产 → 同总数；未知 assetId → ASSET_NOT_FOUND
  const byAsset = (await invoke(toolByName(tools, 'cat_get_segments'), { assetId: imported.assetId })) as unknown as PagedResult<CatSegmentListItem>
  assert.equal(byAsset.total, imported.segmentCount)
  await assert.rejects(
    invoke(toolByName(tools, 'cat_get_segments'), { assetId: 'asset-does-not-exist' }),
    (error: unknown) => error instanceof Error && (error as { code?: string }).code === 'ASSET_NOT_FOUND',
  )

  // status 过滤：导入后全部 untranslated
  const untranslated = (await invoke(toolByName(tools, 'cat_get_segments'), { status: 'untranslated' })) as unknown as PagedResult<CatSegmentListItem>
  assert.equal(untranslated.total, imported.segmentCount)
  assert.ok(untranslated.items.every((s) => s.status === 'untranslated'))

  // QA：Agent 可以运行和读取 Finding，但工具名集合没有 resolve/waive。
  const qaRun = await invoke(toolByName(tools, 'cat_run_qa'), {})
  // PB-096：7 条 EMPTY_TARGET 全部 L1 defect
  assert.equal(qaRun.total, 7)
  assert.deepEqual(qaRun.severityCounts, { L0: 0, L1: 7, L2: 0, L3: 0, L4: 0 })
  const qaFindings = (await invoke(toolByName(tools, 'cat_get_qa_findings'), { status: 'open' })) as unknown as PagedResult<{
    code: string
    status: string
  }>
  assert.equal(qaFindings.total, 7)
  assert.ok(qaFindings.items.every((finding) => finding.code === 'EMPTY_TARGET' && finding.status === 'open'))
  assert.equal(tools.some((tool) => /resolve|waive|accept|commit/i.test(tool.name)), false)

  // 空 TM/TB：干净空 + note（非错误）
  const tm = await invoke(toolByName(tools, 'cat_search_tm'), { query: 'Health' })
  assert.equal(tm.total, 0)
  assert.match(String(tm.note), /No TM units matched/)
  const tb = await invoke(toolByName(tools, 'cat_search_terms'), { query: 'Health' })
  assert.equal(tb.total, 0)
  assert.match(String(tb.note), /No term entries matched/)

  // propose：会话 provenance 由宿主注入；只写 Proposal，不改 Segment
  const proposedSegment = segments.items.find((segment) => !segment.locked)!
  const proposalResult = await invoke(toolByName(tools, 'cat_propose_translations'), {
    segmentProposals: [{
      segmentId: proposedSegment.id,
      baseRevision: proposedSegment.revision,
      proposedTarget: '建议译文',
    }],
  })
  assert.equal(proposalResult.projectId, project.id)
  assert.equal(proposalResult.segmentId, proposedSegment.id)
  const proposalId = (proposalResult.proposalIds as string[])[0]!
  const proposal = service.openProject(project.id).proposals.getById(proposalId)
  assert.equal(proposal?.sessionId, meta.id)
  assert.equal(proposal?.modelId, 'fake-model')
  const issuance = service.openProject(project.id).proposals.listIssuances(proposalId)[0]!
  assert.equal(issuance.runId, 'agent-turn-1')
  assert.equal(issuance.toolCallId, 'call-1')
  assert.equal(issuance.runtime, 'claude')
  assert.equal(issuance.modelProvider, 'anthropic')
  assert.equal(issuance.toolsetHash, '4'.repeat(64))
  assert.equal(service.openProject(project.id).segments.getById(proposedSegment.id)?.target, proposedSegment.target)

  // 输出纪律：summary/segments DTO 递归无绝对路径（linguist root 绝不出现）
  for (const dto of [summary, segments]) {
    for (const value of collectStrings(dto)) {
      assert.ok(!value.includes(LINGUIST_ROOT), `DTO 泄漏绝对路径: ${value}`)
      assert.ok(!value.includes(tempHome), `DTO 泄漏绝对路径: ${value}`)
    }
  }

  service.closeAll()
})

test('LF-063: bound CAT writes emit ordered host-owned project mutation events; reads stay silent', async () => {
  const service = makeServiceOnLinguistRoot()
  const project = service.createProject({ ...PROJECT_INPUT, name: 'mutation event 项目' })
  await service.importAsset(project.id, {
    bytes: readFixture('mini_items.json'),
    filename: 'mini_items.json',
  })
  const meta = binding.createLinguistProjectChatSession(service, { projectId: project.id })
  const mutations: LinguistProjectMutationEvent[] = []
  const tools = catTools.resolveLinguistSessionCatTools(
    { ...meta, modelId: 'fake-model' },
    () => service,
    (mutation) => mutations.push(mutation),
  )

  const segments = (await invoke(
    toolByName(tools, 'cat_get_segments'),
    { limit: 1 },
  )) as unknown as PagedResult<CatSegmentListItem>
  assert.equal(mutations.length, 0, '只读 CAT Tool 不得伪造 mutation')

  const segment = segments.items[0]!
  const proposal = await invoke(toolByName(tools, 'cat_propose_translations'), {
    segmentProposals: [{
      segmentId: segment.id,
      baseRevision: segment.revision,
      proposedTarget: '事件建议译文',
    }],
  })
  await invoke(toolByName(tools, 'cat_run_qa'), {})
  const durableEvents = service.openProject(project.id).runs.listEvents()

  assert.equal(mutations.length, 2)
  assert.deepEqual(mutations[0], {
    projectId: project.id,
    revision: mutations[0]!.revision,
    sequence: 1,
    kind: 'proposal-created',
    segmentIds: [segment.id],
    proposalIds: proposal.proposalIds,
  })
  assert.equal(mutations[1]!.projectId, project.id)
  assert.ok(mutations[1]!.revision > mutations[0]!.revision)
  assert.equal(mutations[1]!.sequence, 5)
  assert.equal(mutations[1]!.kind, 'qa-updated')
  assert.ok((mutations[1]!.segmentIds?.length ?? 0) > 0)
  assert.ok((mutations[1]!.qaFindingIds?.length ?? 0) > 0)
  assert.deepEqual(
    durableEvents.map((event) => [event.sequence, event.kind, event.job?.status ?? null]),
    [
      [1, 'proposal-created', null],
      [2, 'job-updated', 'pending'],
      [3, 'job-updated', 'running'],
      [4, 'job-updated', 'running'],
      [5, 'qa-updated', null],
      [6, 'job-updated', 'completed'],
    ],
  )

  service.closeAll()
})

test('normal chat gets no CAT tools; missing binding attaches throwing tools (documented)', async () => {
  const service = makeServiceOnLinguistRoot()
  const project = service.createProject({ ...PROJECT_INPUT, name: '普通会话对照项目' })

  // 普通会话（侧栏新建，绝不携带绑定）→ []
  const normal = sessionManager.createAgentSession('普通对话', undefined, undefined, undefined, 'pi')
  assert.equal(normal.linguistProjectId, undefined)
  assert.deepEqual(catTools.resolveLinguistSessionCatTools(normal, () => service), [])

  // 绑定 missing（索引无此项目）→ 仍装配标准工具；execute 抛 PROJECT_MISSING
  const missingMeta = sessionManager.createAgentSession('缺失项目会话', undefined, undefined, undefined, 'pi', {
    linguistProjectId: 'proj-does-not-exist',
    linguistProjectName: '已删除项目',
  })
  const tools = catTools.resolveLinguistSessionCatTools(missingMeta, () => service)
  assert.deepEqual(tools.map((t) => t.name), [...LINGUIST_CAT_TOOL_NAMES])
  await assert.rejects(
    invoke(toolByName(tools, 'cat_project_summary'), {}),
    (error: unknown) => {
      assert.ok(error instanceof Error)
      assert.equal((error as { code?: string }).code, 'PROJECT_MISSING')
      assert.match(error.message, /proj-does-not-exist/)
      return true
    },
  )

  service.closeAll()
})

test('auditor binding receives only evidence reads; Proposal/QA conclusions and writes are absent', () => {
  const service = makeServiceOnLinguistRoot()
  const project = service.createProject({ ...PROJECT_INPUT, name: '独立审计项目' })
  const meta = binding.createLinguistProjectChatSession(service, {
    projectId: project.id,
    role: 'auditor',
  })
  const tools = catTools.resolveLinguistSessionCatTools(meta, () => service)
  assert.deepEqual(tools.map((tool) => tool.name), [
    'cat_project_summary',
    'cat_list_assets',
    'cat_get_segments',
    'cat_get_translation_context',
    'cat_search_tm',
    'cat_search_terms',
    'cat_search_sentence_patterns',
    'cat_read_context_doc',
  ])
  assert.equal(tools.some((tool) =>
    /proposal|qa|critic|consistency/i.test(tool.name)), false)
  service.closeAll()
})

test('restart resume: rebuilt service on the same root resolves the same project; archived stays read-only readable', async () => {
  const service = makeServiceOnLinguistRoot()
  const project = service.createProject({ ...PROJECT_INPUT, name: 'resume 项目' })
  const imported = await service.importAsset(project.id, {
    bytes: readFixture('mini_items.json'),
    filename: 'mini_items.json',
  })
  const meta = binding.createLinguistProjectChatSession(service, { projectId: project.id })
  const before = (await invoke(
    toolByName(catTools.resolveLinguistSessionCatTools(meta, () => service), 'cat_get_segments'),
    {},
  )) as unknown as PagedResult<CatSegmentListItem>
  service.closeAll()

  // 模拟重启：同一 linguist root 重建服务；同一会话元数据重解析（resume 一致性）
  const resumed = makeServiceOnLinguistRoot()
  const tools = catTools.resolveLinguistSessionCatTools(meta, () => resumed)
  const after = (await invoke(toolByName(tools, 'cat_get_segments'), {})) as unknown as PagedResult<CatSegmentListItem>
  assert.equal(after.total, imported.segmentCount)
  assert.deepEqual(after.items.map((s) => s.id), before.items.map((s) => s.id))

  // 归档腿：归档后 resolver 实时反映（openProject 强制只读）；只读工具仍可读
  resumed.archiveProject(project.id)
  const summary = await invoke(toolByName(tools, 'cat_project_summary'), {})
  assert.equal((summary.project as Record<string, unknown>).archived, true)
  assert.match(String(summary.note), /archived|read-only/i)
  const segments = (await invoke(toolByName(tools, 'cat_get_segments'), {})) as unknown as PagedResult<CatSegmentListItem>
  assert.equal(segments.total, imported.segmentCount)

  resumed.closeAll()
})

test('PB-110 archived project: write tools reject with STORE_READ_ONLY and write nothing (tool assembly layer)', async () => {
  const service = makeServiceOnLinguistRoot()
  const project = service.createProject({ ...PROJECT_INPUT, name: '归档写拒绝项目' })
  // 播种同 source 译文分歧的段（2×译文一 + 1×译文不同），让
  // consistency plan/apply 产生真实修复输入——无修复
  // 输入时 repair 根本不会发起写，覆盖不到只读拒绝路径。
  const seededDb = service.openProject(project.id)
  const repeated = (ordinal: number, target: string) => ({
    ordinal,
    key: `r${ordinal}`,
    source: '这是需要保持一致的重复文本',
    target,
    sourceLocale: 'en',
    targetLocale: 'zh-CN',
    status: 'translated' as const,
    locked: false,
    revision: 0,
    sourceHash: `rh-${ordinal}`,
  })
  seededDb.assets.insertImported({
    asset: {
      formatId: 'fake_tsv',
      originalFilename: 'repeat.tsv',
      sourceSha256: 'd'.repeat(64),
      segmentCount: 3,
    },
    segments: [repeated(0, '译文一'), repeated(1, '译文一'), repeated(2, '译文不同')],
    warnings: [],
    originalBytes: new TextEncoder().encode('fake'),
  })
  const meta = binding.createLinguistProjectChatSession(service, { projectId: project.id })
  const tools = catTools.resolveLinguistSessionCatTools({ ...meta, modelId: 'fake-model' }, () => service)

  // 归档前：拿到一个可提议的段（baseRevision 对齐，排除参数类拒绝路径）
  const segmentsBefore = (await invoke(toolByName(tools, 'cat_get_segments'), {})) as unknown as PagedResult<CatSegmentListItem>
  const target = segmentsBefore.items.find((segment) => !segment.locked)!
  const inconsistent = segmentsBefore.items.find((segment) => segment.target === '译文不同')!

  service.archiveProject(project.id)

  // 归档后 openProject 强制只读（service 缓存句柄即只读句柄，借用不 close）
  const db = service.openProject(project.id)
  assert.equal(db.readOnly, true)
  const countsBefore = {
    pendingProposals: db.proposals.listPending().length,
    qaFindings: db.qaFindings.count({}),
    segmentRevision: db.segments.getById(target.id)?.revision,
  }

  const assertStoreReadOnly = (error: unknown) => {
    assert.ok(error instanceof Error)
    assert.equal((error as { code?: string }).code, 'STORE_READ_ONLY')
    return true
  }
  await assert.rejects(
    invoke(toolByName(tools, 'cat_propose_translations'), {
      segmentProposals: [{
        segmentId: target.id,
        baseRevision: target.revision,
        proposedTarget: '归档后不应落库的译文',
      }],
    }),
    assertStoreReadOnly,
  )
  await assert.rejects(invoke(toolByName(tools, 'cat_run_qa'), {}), assertStoreReadOnly)
  // plan 只读；apply 对显式选择发起 Proposal 写入 → 只读拒绝
  const plan = await invoke(toolByName(tools, 'cat_plan_consistency_repairs'), {})
  assert.ok((plan.findingCount as number) > 0, '前置：一致性分歧必须存在，否则 apply 无写路径')
  const group = (plan.groups as Array<{ groupId: string }>)[0]!
  await assert.rejects(
    invoke(toolByName(tools, 'cat_create_consistency_proposals'), {
      planId: plan.planId,
      selections: [{
        groupId: group.groupId,
        proposedTarget: '译文一',
        segmentIds: [inconsistent.id],
      }],
    }),
    assertStoreReadOnly,
  )

  // 三个写工具均不得产生任何写入：proposal / finding / segment 计数前后不变
  assert.equal(db.proposals.listPending().length, countsBefore.pendingProposals)
  assert.equal(db.qaFindings.count({}), countsBefore.qaFindings)
  assert.equal(db.segments.getById(target.id)?.revision, countsBefore.segmentRevision)

  service.closeAll()
})

test('CAT tool names must not conflict with existing custom tools', () => {
  const service = makeServiceOnLinguistRoot()
  const project = service.createProject({ ...PROJECT_INPUT, name: '名称冲突项目' })
  const meta = binding.createLinguistProjectChatSession(service, { projectId: project.id })
  const tools = catTools.resolveLinguistSessionCatTools(meta, () => service)

  assert.doesNotThrow(() =>
    catTools.assertNoLinguistCatToolNameConflict(['Read', 'mcp__demo__search'], tools),
  )
  assert.throws(
    () => catTools.assertNoLinguistCatToolNameConflict(['cat_get_segments'], tools),
    /cat_get_segments/,
  )

  service.closeAll()
})
