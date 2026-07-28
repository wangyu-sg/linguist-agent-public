/**
 * Behavior tests for the session-bound CAT tools, driven against a
 * REAL CatStore in mkdtemp roots (node:sqlite — hence node --test, never
 * bun). Resolvers are fakes; the Electron binding resolver lands in PB-042.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import type { AgentToolResult, ExtensionContext } from '@earendil-works/pi-coding-agent'
import {
  createAsset,
  createSeededEntropy,
  deriveSegmentId,
  independentCriticCandidateHash,
  independentCriticProfileHash,
  SegmentLockedError,
  StaleProposalError,
  UnknownSegmentError,
  type Asset,
  type EntropySource,
  type LinguistProject,
  type Segment,
} from '@linguist/cat-core'
import {
  CatStore,
  StoreNotFoundError,
  StoreReadOnlyError,
  StoreSqliteUnavailableError,
  type ProjectDatabase,
} from '@linguist/cat-store'
import { createLinguistCatTools } from './factory'
import {
  LinguistCatAssetNotFoundError,
  LinguistCatBindingMissingError,
  LinguistCatProjectMissingError,
  type LinguistCatToolError,
} from './errors'
import {
  LINGUIST_CAT_TOOL_NAMES,
  type LinguistCatToolCallInfo,
  type LinguistCatToolMutation,
  type LinguistCatToolName,
  type PagedResult,
  type ResolveLinguistCatProject,
} from './types'

// ===== fixtures (local testkit; cat-core only, no cat-formats dependency) =====

function makeTempDir(): string {
  return mkdtempSync(join(tmpdir(), 'cat-tools-test-'))
}

/** Deterministic incrementing clock: 2026-01-01T00:00:00.000Z + n seconds. */
function makeClock(): () => string {
  let tick = 0
  return () => new Date(Date.UTC(2026, 0, 1, 0, 0, 0) + tick++ * 1000).toISOString()
}

function makeEntropy(seed = 'pb-041'): EntropySource {
  return createSeededEntropy(seed)
}

interface SeedAssetOptions {
  filename: string
  sha: string
  count: number
  sourcePrefix: string
  /** Fill every Nth target with a translation. */
  fillEvery?: number
}

function seedAsset(db: ProjectDatabase, project: LinguistProject, options: SeedAssetOptions): { asset: Asset; segments: Segment[] } {
  const asset = createAsset({
    projectId: project.id,
    formatId: 'fake_tsv',
    originalFilename: options.filename,
    sourceSha256: options.sha,
    segmentCount: options.count,
  })
  const segments: Segment[] = []
  for (let i = 0; i < options.count; i++) {
    const target = options.fillEvery !== undefined && i % options.fillEvery === 0 ? `译文 ${i}` : ''
    segments.push({
      id: deriveSegmentId(asset.id, i, `key-${i}`),
      assetId: asset.id,
      ordinal: i,
      key: `key-${i}`,
      source: `${options.sourcePrefix} source ${i}`,
      target,
      sourceLocale: 'en',
      targetLocale: 'zh-CN',
      status: target === '' ? 'untranslated' : 'translated',
      locked: false,
      revision: 0,
      sourceHash: `hash-${i}`,
    })
  }
  db.assets.insert(asset, segments)
  return { asset, segments }
}

interface Fixture {
  rootDir: string
  store: CatStore
  project: LinguistProject
  db: ProjectDatabase
  assetA: Asset
  assetB: Asset
  segmentsA: Segment[]
  segmentsB: Segment[]
}

function setup(): Fixture {
  const rootDir = makeTempDir()
  const store = new CatStore({ rootDir, entropy: makeEntropy(), now: makeClock() })
  const project = store.createProject({
    name: 'Demo 项目',
    sourceLocale: 'en',
    targetLocale: 'zh-CN',
    promaWorkspaceId: 'ws-1',
  })
  const db = store.openProject(project.id)
  const { asset: assetA, segments: segmentsA } = seedAsset(db, project, {
    filename: 'alpha.tsv',
    sha: 'a'.repeat(64),
    count: 8,
    fillEvery: 2,
    sourcePrefix: 'Alpha',
  })
  const { asset: assetB, segments: segmentsB } = seedAsset(db, project, {
    filename: 'beta.tsv',
    sha: 'b'.repeat(64),
    count: 4,
    sourcePrefix: 'Beta',
  })
  return { rootDir, store, project, db, assetA, assetB, segmentsA, segmentsB }
}

// ===== tool invocation helpers =====

const FAKE_EXTENSION_CTX = {} as ExtensionContext
type LinguistCatTool = ReturnType<typeof createLinguistCatTools>[number]

function toolByName(tools: LinguistCatTool[], name: string): LinguistCatTool {
  const tool = tools.find((candidate) => candidate.name === name)
  assert.ok(tool, `tool ${name} not registered`)
  return tool
}

async function invoke(tool: LinguistCatTool, params: unknown): Promise<AgentToolResult<unknown>> {
  return tool.execute('call-1', params as never, undefined, undefined, FAKE_EXTENSION_CTX)
}

/** Text payload of a tool result (first text block). */
function resultText(result: AgentToolResult<unknown>): string {
  const block = result.content[0]
  assert.ok(block && block.type === 'text', 'tool result must start with a text block')
  return block.text
}

function makeOkResolver(fixture: Fixture, calls?: LinguistCatToolCallInfo[]): ResolveLinguistCatProject {
  return (call) => {
    calls?.push(call)
    return { project: fixture.project, db: fixture.db }
  }
}

// ===== output discipline helpers =====

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

/** plan §7.4: tool outputs must never contain absolute filesystem paths. */
function assertNoAbsolutePaths(value: unknown, rootDir: string): void {
  for (const text of collectStrings(value)) {
    assert.ok(!text.includes(rootDir), `output leaks the store root: ${text.slice(0, 120)}`)
    assert.ok(!text.includes(homedir()), `output leaks the user home: ${text.slice(0, 120)}`)
    assert.ok(!text.startsWith('/'), `output contains a POSIX-absolute-looking value: ${text.slice(0, 120)}`)
    assert.ok(!/^[A-Za-z]:[\\/]/.test(text), `output contains a Windows-path-looking value: ${text.slice(0, 120)}`)
    assert.ok(!text.includes('~/.linguist-agent'), `output contains a home-relative path: ${text.slice(0, 120)}`)
  }
}

async function assertThrowsCode(promise: Promise<unknown>, code: string): Promise<Error> {
  try {
    await promise
  } catch (err) {
    assert.ok(err instanceof Error, 'thrown value must be an Error')
    assert.equal((err as LinguistCatToolError).code, code)
    assert.ok(err.message.startsWith(`[${code}]`), 'message must be prefixed with the stable code')
    return err
  }
  assert.fail(`expected a thrown error with code ${code}`)
}

// ===== tests =====

test('factory: CAT read/proposal/QA tools expose no accept, resolve, waive, or commit mutation', () => {
  const fixture = setup()
  try {
    const tools = createLinguistCatTools({ resolveProject: makeOkResolver(fixture) })
    assert.deepEqual(
      tools.map((tool) => tool.name),
      [...LINGUIST_CAT_TOOL_NAMES],
    )
    assert.equal(tools.some((tool) => /accept|resolve|waive|commit/i.test(tool.name)), false)
    assert.equal(tools.length, 12)
    for (const tool of tools) {
      assert.equal(typeof tool.label, 'string')
      assert.ok(tool.label.length > 0)
      assert.equal(typeof tool.description, 'string')
      assert.ok(tool.description.includes('bound'))
      assert.equal(typeof tool.promptSnippet, 'string')
      assert.ok(tool.parameters && typeof tool.parameters === 'object')
      assert.equal(typeof tool.execute, 'function')
    }
  } finally {
    fixture.db.close()
  }
})

test('independent-audit mode exposes evidence reads only and hides prior conclusions', () => {
  const fixture = setup()
  try {
    const tools = createLinguistCatTools({
      resolveProject: makeOkResolver(fixture),
      sessionMode: 'independent-audit',
    })
    assert.deepEqual(tools.map((tool) => tool.name), [
      'cat_project_summary',
      'cat_list_assets',
      'cat_get_segments',
      'cat_search_tm',
      'cat_search_terms',
      'cat_search_sentence_patterns',
      'cat_read_context_doc',
    ])
    assert.equal(tools.some((tool) =>
      /proposal|qa|critic|consistency|repair|commit/i.test(tool.name)), false)
  } finally {
    fixture.db.close()
  }
})

test('cat_run_qa + cat_get_qa_findings: persist deterministic findings and page filtered results', async () => {
  const fixture = setup()
  try {
    const mutations: LinguistCatToolMutation[] = []
    const tools = createLinguistCatTools({
      resolveProject: makeOkResolver(fixture),
      onMutation: (mutation) => mutations.push(mutation),
    })
    const run = (await invoke(toolByName(tools, 'cat_run_qa'), {})).details as {
      total: number
      severityCounts: Record<string, number>
      dispositionCounts: Record<string, number>
    }
    assert.equal(run.total, 12)
    // PB-096：8 条 EMPTY_TARGET（L1 defect）+ 4 条 TARGET_LENGTH_WARNING（L3 defect）
    assert.deepEqual(run.severityCounts, { L0: 0, L1: 8, L2: 0, L3: 4, L4: 0 })
    assert.deepEqual(run.dispositionCounts, { defect: 12, needs_review: 0, query: 0, info: 0 })

    const page = (await invoke(toolByName(tools, 'cat_get_qa_findings'), {
      status: 'open',
      severity: 'L1',
      limit: 3,
    })).details as PagedResult<{ code: string; status: string; segmentRevision: number }>
    assert.equal(page.total, 8)
    assert.equal(page.items.length, 3)
    assert.equal(page.hasMore, true)
    assert.ok(page.items.every((finding) => finding.code === 'EMPTY_TARGET'))
    assert.ok(page.items.every((finding) => finding.status === 'open'))
    assert.ok(page.items.every((finding) => finding.segmentRevision === 0))
    assert.equal(mutations.length, 1)
    assert.equal(mutations[0]!.kind, 'qa-updated')
    assert.deepEqual(
      [...(mutations[0]!.segmentIds ?? [])].sort(),
      fixture.db.qaFindings.list({}).map((finding) => finding.segmentId as string).sort(),
    )
    assert.deepEqual(
      [...(mutations[0]!.qaFindingIds ?? [])].sort(),
      fixture.db.qaFindings.list({}).map((finding) => finding.id as string).sort(),
    )
  } finally {
    fixture.db.close()
  }
})

test('cat_project_summary: locales, counts, JSON round-trip; resolver receives call info', async () => {
  const fixture = setup()
  try {
    const calls: LinguistCatToolCallInfo[] = []
    const tools = createLinguistCatTools({ resolveProject: makeOkResolver(fixture, calls) })
    const result = await invoke(toolByName(tools, 'cat_project_summary'), {})
    const dto = result.details as {
      project: Record<string, unknown>
      assetCount: number
      totalSegments: number
      segmentCounts: Record<string, number>
      note?: string
    }
    assert.deepEqual(dto.project, {
      id: fixture.project.id,
      name: 'Demo 项目',
      sourceLocale: 'en',
      targetLocale: 'zh-CN',
      archived: false,
      createdAt: fixture.project.createdAt,
      updatedAt: fixture.project.updatedAt,
    })
    assert.equal(dto.assetCount, 2)
    assert.equal(dto.totalSegments, 12)
    assert.deepEqual(dto.segmentCounts, { untranslated: 8, draft: 0, translated: 4, reviewed: 0 })
    assert.equal(dto.note, undefined)
    // content text is the same DTO as JSON; the whole result is JSON-serializable
    assert.deepEqual(JSON.parse(resultText(result)), dto)
    assert.deepEqual(JSON.parse(JSON.stringify(result.details)), dto)
    // resolver saw the tool identity, never a project id from model input
    assert.deepEqual(calls, [{ toolName: 'cat_project_summary', toolCallId: 'call-1' }])
    assertNoAbsolutePaths(result, fixture.rootDir)
  } finally {
    fixture.db.close()
  }
})

test('cat_propose_translations creates proposals atomically without changing segments', async () => {
  const fixture = setup()
  try {
    const now = '2026-01-02T00:00:00.000Z'
    const mutations: LinguistCatToolMutation[] = []
    const tools = createLinguistCatTools({
      resolveProject: makeOkResolver(fixture),
      now: () => now,
      modelId: 'fake-model',
      sessionId: 'session-1',
      onMutation: (mutation) => mutations.push(mutation),
    })
    const before = fixture.db.segments.getByIds([
      fixture.segmentsA[0]!.id,
      fixture.segmentsA[1]!.id,
    ])
    const result = await invoke(toolByName(tools, 'cat_propose_translations'), {
      segmentProposals: [
        {
          segmentId: fixture.segmentsA[0]!.id,
          baseRevision: 0,
          proposedTarget: '译文 A 0',
          evidenceRefs: ['tm:1'],
        },
        {
          segmentId: fixture.segmentsA[1]!.id,
          baseRevision: 0,
          proposedTarget: '译文 B 1',
          warnings: ['需复核'],
        },
      ],
    })
    const dto = result.details as { runId: string; proposalIds: string[] }
    assert.equal(dto.runId, 'run:session-1:call-1')
    assert.equal(dto.proposalIds.length, 2)
    const pendingById = new Map(
      fixture.db.proposals.listPending().map((proposal) => [proposal.id as string, proposal]),
    )
    for (const id of dto.proposalIds) {
      assert.deepEqual(
        {
          modelId: pendingById.get(id)?.modelId,
          sessionId: pendingById.get(id)?.sessionId,
          runId: pendingById.get(id)?.runId,
          createdAt: pendingById.get(id)?.createdAt,
        },
        {
          modelId: 'fake-model',
          sessionId: 'session-1',
          runId: 'run:session-1:call-1',
          createdAt: now,
        },
      )
    }
    assert.deepEqual(
      fixture.db.segments.getByIds(before.map((segment) => segment.id)),
      before,
      'the agent tool must never mutate Segment rows',
    )
    assert.deepEqual(mutations, [{
      kind: 'proposal-created',
      segmentIds: [fixture.segmentsA[0]!.id as string, fixture.segmentsA[1]!.id as string],
      proposalIds: dto.proposalIds,
    }])
    await invoke(toolByName(tools, 'cat_propose_translations'), {
      segmentProposals: [
        {
          segmentId: fixture.segmentsA[0]!.id,
          baseRevision: 0,
          proposedTarget: '译文 A 0',
          evidenceRefs: ['tm:1'],
        },
        {
          segmentId: fixture.segmentsA[1]!.id,
          baseRevision: 0,
          proposedTarget: '译文 B 1',
          warnings: ['需复核'],
        },
      ],
    })
    assert.equal(mutations.length, 1, '幂等提案重跑没有真实写入，不得生成伪 mutation')

    const deliveryFailureTools = createLinguistCatTools({
      resolveProject: makeOkResolver(fixture),
      onMutation: () => {
        throw new Error('renderer gone')
      },
    })
    const committed = await invoke(toolByName(deliveryFailureTools, 'cat_propose_translations'), {
      segmentProposals: [{
        segmentId: fixture.segmentsA[2]!.id,
        baseRevision: 0,
        proposedTarget: '通知失败仍已提交 2',
      }],
    })
    const committedId = (committed.details as { proposalIds: string[] }).proposalIds[0]!
    assert.ok(fixture.db.proposals.getById(committedId), '通知失败不得把已提交写入伪装成失败')
  } finally {
    fixture.db.close()
  }
})

test('cat_propose_translations enforces batch, target, signature, lock and CAS rules', async () => {
  const fixture = setup()
  try {
    const taggedAsset = createAsset({
      projectId: fixture.project.id,
      formatId: 'fake_tsv',
      originalFilename: 'tagged.tsv',
      sourceSha256: 'c'.repeat(64),
      segmentCount: 1,
    })
    const taggedSegment: Segment = {
      id: deriveSegmentId(taggedAsset.id, 0, 'tagged'),
      assetId: taggedAsset.id,
      ordinal: 0,
      key: 'tagged',
      source: 'Hello {name} <b>world</b>\nLevel 7',
      target: '',
      sourceLocale: 'en',
      targetLocale: 'zh-CN',
      status: 'untranslated',
      locked: false,
      revision: 0,
      sourceHash: 'tagged-hash',
    }
    fixture.db.assets.insert(taggedAsset, [taggedSegment])
    const tool = toolByName(
      createLinguistCatTools({ resolveProject: makeOkResolver(fixture) }),
      'cat_propose_translations',
    )
    const item = {
      segmentId: fixture.segmentsA[0]!.id,
      baseRevision: 0,
      proposedTarget: '译文 0',
    }

    await assertThrowsCode(
      invoke(tool, { segmentProposals: Array.from({ length: 51 }, () => item) }),
      'INVALID_ARGUMENT',
    )
    await assertThrowsCode(
      invoke(tool, { segmentProposals: [{ ...item, proposedTarget: '   ' }] }),
      'INVALID_ARGUMENT',
    )
    await assertThrowsCode(
      invoke(tool, {
        segmentProposals: [{
          segmentId: taggedSegment.id,
          baseRevision: 0,
          proposedTarget: '你好 world',
        }],
      }),
      'INVALID_ARGUMENT',
    )
    await assertThrowsCode(
      invoke(tool, {
        segmentProposals: [{
          segmentId: taggedSegment.id,
          baseRevision: 0,
          proposedTarget: '你好 {name} <b>世界</b> Level 7',
        }],
      }),
      'INVALID_ARGUMENT',
    )
    await assertThrowsCode(
      invoke(tool, {
        segmentProposals: [{
          segmentId: taggedSegment.id,
          baseRevision: 0,
          proposedTarget: '你好 {name} <b>世界</b>\n等级 8',
        }],
      }),
      'INVALID_ARGUMENT',
    )

    fixture.db.segments.setLocked(fixture.segmentsA[0]!.id, true)
    await assert.rejects(invoke(tool, { segmentProposals: [item] }), SegmentLockedError)
    fixture.db.segments.setLocked(fixture.segmentsA[0]!.id, false)
    fixture.db.segments.applyTargetEdit(fixture.segmentsA[1]!.id, '人工译文', 0)
    await assert.rejects(
      invoke(tool, {
        segmentProposals: [{
          segmentId: fixture.segmentsA[1]!.id,
          baseRevision: 0,
          proposedTarget: '陈旧 1',
        }],
      }),
      StaleProposalError,
    )
    await assert.rejects(
      invoke(tool, {
        segmentProposals: [{
          segmentId: deriveSegmentId(fixture.assetA.id, 999),
          baseRevision: 0,
          proposedTarget: '未知',
        }],
      }),
      UnknownSegmentError,
    )
    assert.equal(fixture.db.proposals.listPending().length, 0)
  } finally {
    fixture.db.close()
  }
})

test('PB-097 cat_propose_translations：tag 族违规拒绝提案（内置 printf 族 + 项目族）', async () => {
  const fixture = setup()
  try {
    const tagAsset = createAsset({
      projectId: fixture.project.id,
      formatId: 'fake_tsv',
      originalFilename: 'pb097.tsv',
      sourceSha256: 'd'.repeat(64),
      segmentCount: 2,
    })
    const makeSegment = (ordinal: number, key: string, source: string): Segment => ({
      id: deriveSegmentId(tagAsset.id, ordinal, key),
      assetId: tagAsset.id,
      ordinal,
      key,
      source,
      target: '',
      sourceLocale: 'en',
      targetLocale: 'zh-CN',
      status: 'untranslated',
      locked: false,
      revision: 0,
      sourceHash: `pb097-hash-${ordinal}`,
    })
    const printfSegment = makeSegment(0, 'printf', '命中率 %.2f%%')
    const grmSegment = makeSegment(1, 'grm', '获得 [Grm:Qty S=""] 个')
    fixture.db.assets.insert(tagAsset, [printfSegment, grmSegment])

    // 内置 printf 族（无需 tagProfile）：丢 %.2f%% 拒绝；保留放行
    const builtinTool = toolByName(
      createLinguistCatTools({ resolveProject: makeOkResolver(fixture) }),
      'cat_propose_translations',
    )
    await assertThrowsCode(
      invoke(builtinTool, {
        segmentProposals: [{ segmentId: printfSegment.id, baseRevision: 0, proposedTarget: '命中率' }],
      }),
      'INVALID_ARGUMENT',
    )
    const accepted = await invoke(builtinTool, {
      segmentProposals: [{ segmentId: printfSegment.id, baseRevision: 0, proposedTarget: '命中率 %.2f%%' }],
    })
    assert.equal((accepted.details as { proposalIds: string[] }).proposalIds.length, 1)
    // 未登记 tagProfile 时 [Grm:Qty …] 无内置族认领，不锁定
    const unregistered = await invoke(builtinTool, {
      segmentProposals: [{ segmentId: grmSegment.id, baseRevision: 0, proposedTarget: '获得 个' }],
    })
    assert.equal((unregistered.details as { proposalIds: string[] }).proposalIds.length, 1)

    // 项目族经 tagProfile 登记后：丢 [Grm:Qty …] 拒绝
    const tagProfile = {
      families: [{ id: 'grm-qty', pattern: '\\[Grm:Qty[^\\]]*\\]', class: 'singleton' as const }],
    }
    const profiledTool = toolByName(
      createLinguistCatTools({
        resolveProject: () => ({ project: { ...fixture.project, tagProfile }, db: fixture.db }),
      }),
      'cat_propose_translations',
    )
    await assertThrowsCode(
      invoke(profiledTool, {
        segmentProposals: [{ segmentId: grmSegment.id, baseRevision: 0, proposedTarget: '获得 个' }],
      }),
      'INVALID_ARGUMENT',
    )
  } finally {
    fixture.db.close()
  }
})

test('cat_project_summary: archived project reads fine (read-only open) and carries a note', async () => {
  const fixture = setup()
  fixture.db.close()
  fixture.store.archiveProject(fixture.project.id)
  const readOnlyDb = fixture.store.openProject(fixture.project.id, { readOnly: true })
  try {
    const archivedProject = fixture.store.getProject(fixture.project.id)
    const tools = createLinguistCatTools({
      resolveProject: () => ({ project: archivedProject, db: readOnlyDb }),
    })
    const summary = await invoke(toolByName(tools, 'cat_project_summary'), {})
    const dto = summary.details as { project: { archived: boolean; archivedAt?: string }; note?: string; totalSegments: number }
    assert.equal(dto.project.archived, true)
    assert.equal(typeof dto.project.archivedAt, 'string')
    assert.equal(dto.totalSegments, 12)
    assert.ok(dto.note?.includes('read-only'))

    // reads keep working on the archived (read-only) handle
    const segments = await invoke(toolByName(tools, 'cat_get_segments'), { limit: 5 })
    assert.equal((segments.details as PagedResult<unknown>).items.length, 5)
    await assert.rejects(
      invoke(toolByName(tools, 'cat_propose_translations'), {
        segmentProposals: [{
          segmentId: fixture.segmentsA[0]!.id as string,
          baseRevision: fixture.segmentsA[0]!.revision,
          proposedTarget: '归档项目不可写 0',
        }],
      }),
      StoreReadOnlyError,
    )
    assertNoAbsolutePaths(summary, fixture.rootDir)
  } finally {
    readOnlyDb.close()
  }
})

test('cat_list_assets: metadata page with stable ids and digests', async () => {
  const fixture = setup()
  try {
    const tools = createLinguistCatTools({ resolveProject: makeOkResolver(fixture) })
    const result = await invoke(toolByName(tools, 'cat_list_assets'), {})
    const dto = result.details as PagedResult<Record<string, unknown>>
    assert.equal(dto.total, 2)
    assert.equal(dto.limit, 50)
    assert.equal(dto.offset, 0)
    assert.equal(dto.hasMore, false)
    assert.equal(dto.items.length, 2)
    const byFilename = new Map(dto.items.map((item) => [item.filename, item]))
    const alpha = byFilename.get('alpha.tsv')
    assert.ok(alpha)
    assert.equal(alpha.assetId, fixture.assetA.id)
    assert.equal(alpha.formatId, 'fake_tsv')
    assert.equal(alpha.segmentCount, 8)
    assert.equal(alpha.sourceSha256, 'a'.repeat(64))
    assertNoAbsolutePaths(result, fixture.rootDir)
  } finally {
    fixture.db.close()
  }
})

test('cat_list_assets: pagination edges (offset beyond total, clamp note)', async () => {
  const fixture = setup()
  try {
    const tools = createLinguistCatTools({ resolveProject: makeOkResolver(fixture) })
    const tool = toolByName(tools, 'cat_list_assets')

    const page1 = (await invoke(tool, { limit: 1 })).details as PagedResult<{ assetId: string }>
    assert.deepEqual(
      { total: page1.total, limit: page1.limit, offset: page1.offset, hasMore: page1.hasMore, count: page1.items.length },
      { total: 2, limit: 1, offset: 0, hasMore: true, count: 1 },
    )
    const page2 = (await invoke(tool, { limit: 1, offset: 1 })).details as PagedResult<{ assetId: string }>
    assert.equal(page2.hasMore, false)
    assert.notEqual(page1.items[0]!.assetId, page2.items[0]!.assetId)

    const beyond = (await invoke(tool, { offset: 99 })).details as PagedResult<unknown>
    assert.equal(beyond.items.length, 0)
    assert.equal(beyond.total, 2)
    assert.equal(beyond.hasMore, false)

    const clamped = (await invoke(tool, { limit: 500 })).details as PagedResult<unknown>
    assert.equal(clamped.limit, 200)
    assert.ok(clamped.note?.includes('500'))
    assert.ok(clamped.note?.includes('200'))
  } finally {
    fixture.db.close()
  }
})

test('cat_get_segments: default page returns stable content-derived ids and shaped items', async () => {
  const fixture = setup()
  try {
    const tools = createLinguistCatTools({ resolveProject: makeOkResolver(fixture) })
    const result = await invoke(toolByName(tools, 'cat_get_segments'), {})
    const dto = result.details as PagedResult<Record<string, unknown>>
    assert.equal(dto.limit, 20)
    assert.equal(dto.total, 12)
    assert.equal(dto.hasMore, false)
    assert.equal(dto.items.length, 12)
    const seededIds = new Set([...fixture.segmentsA, ...fixture.segmentsB].map((segment) => segment.id as string))
    for (const item of dto.items) {
      assert.ok(seededIds.has(item.id as string), `unexpected segment id ${item.id}`)
      assert.deepEqual(
        Object.keys(item).sort(),
        [
          'assetId',
          'id',
          'key',
          'locked',
          'ordinal',
          'originalOrdinal',
          'revision',
          'segmentId',
          'source',
          'status',
          'target',
        ].sort(),
      )
    }
    const first = dto.items.find((item) => item.id === (fixture.segmentsA[0]!.id as string))!
    assert.equal(first.ordinal, 0)
    assert.equal(first.originalOrdinal, 1)
    assert.equal(first.segmentId, first.id)
    assert.equal(first.key, 'key-0')
    assert.equal(first.status, 'translated')
    assert.equal(first.locked, false)
    assert.equal(first.revision, 0)
    assert.equal(first.source, 'Alpha source 0')
    assert.equal(first.target, '译文 0')
    assertNoAbsolutePaths(result, fixture.rootDir)
  } finally {
    fixture.db.close()
  }
})

test('cat_get_segments: pagination — deterministic order across pages, clamp, offset beyond total', async () => {
  const fixture = setup()
  try {
    const tools = createLinguistCatTools({ resolveProject: makeOkResolver(fixture) })
    const tool = toolByName(tools, 'cat_get_segments')

    const page1 = (await invoke(tool, { limit: 5 })).details as PagedResult<{ id: string }>
    const page2 = (await invoke(tool, { limit: 5, offset: 5 })).details as PagedResult<{ id: string }>
    const page3 = (await invoke(tool, { limit: 5, offset: 10 })).details as PagedResult<{ id: string }>
    assert.equal(page1.hasMore, true)
    assert.equal(page2.hasMore, true)
    assert.equal(page3.hasMore, false)
    assert.equal(page3.items.length, 2)
    const pagedIds = [...page1.items, ...page2.items, ...page3.items].map((item) => item.id)
    const full = (await invoke(tool, { limit: 20 })).details as PagedResult<{ id: string }>
    assert.deepEqual(pagedIds, full.items.map((item) => item.id))

    const beyond = (await invoke(tool, { offset: 999 })).details as PagedResult<unknown>
    assert.equal(beyond.items.length, 0)
    assert.equal(beyond.total, 12)
    assert.equal(beyond.hasMore, false)

    const clamped = (await invoke(tool, { limit: 5000 })).details as PagedResult<unknown>
    assert.equal(clamped.limit, 100)
    assert.equal(clamped.items.length, 12) // clamped to the hard max, capped by total
    assert.ok(clamped.note?.includes('5000'))
    assert.ok(clamped.note?.includes('100'))
  } finally {
    fixture.db.close()
  }
})

test('cat_get_segments: assetId filter; unknown asset throws ASSET_NOT_FOUND', async () => {
  const fixture = setup()
  try {
    const tools = createLinguistCatTools({ resolveProject: makeOkResolver(fixture) })
    const tool = toolByName(tools, 'cat_get_segments')

    const filtered = (await invoke(tool, { assetId: fixture.assetB.id as string })).details as PagedResult<{ assetId: string; id: string }>
    assert.equal(filtered.total, 4)
    assert.equal(filtered.items.length, 4)
    for (const item of filtered.items) assert.equal(item.assetId, fixture.assetB.id as string)
    assert.deepEqual(
      filtered.items.map((item) => item.id),
      fixture.segmentsB.map((segment) => segment.id as string),
    )

    await assertThrowsCode(invoke(tool, { assetId: 'ast-0000000000000000' }), 'ASSET_NOT_FOUND')
    try {
      await invoke(tool, { assetId: 'ast-0000000000000000' })
      assert.fail('must throw')
    } catch (err) {
      assert.ok(err instanceof LinguistCatAssetNotFoundError)
    }
  } finally {
    fixture.db.close()
  }
})

test('cat_get_segments: status and search filters (LIKE wildcards stay literal)', async () => {
  const fixture = setup()
  try {
    const tools = createLinguistCatTools({ resolveProject: makeOkResolver(fixture) })
    const tool = toolByName(tools, 'cat_get_segments')
    const total = async (params: unknown): Promise<number> =>
      ((await invoke(tool, params)).details as PagedResult<unknown>).total

    assert.equal(await total({ status: 'translated' }), 4)
    assert.equal(await total({ status: 'untranslated' }), 8)
    assert.equal(await total({ search: 'alpha' }), 8) // LIKE is ascii-case-insensitive
    assert.equal(await total({ search: 'Beta source 2' }), 1)
    assert.equal(await total({ search: '译文' }), 4)
    assert.equal(await total({ search: '100%' }), 0)
    assert.equal(await total({ status: 'translated', assetId: fixture.assetB.id as string }), 0)
    await assertThrowsCode(invoke(tool, { status: 'bogus' }), 'INVALID_ARGUMENT')
    await assertThrowsCode(invoke(tool, { limit: 0 }), 'INVALID_ARGUMENT')
    await assertThrowsCode(invoke(tool, { offset: -1 }), 'INVALID_ARGUMENT')
  } finally {
    fixture.db.close()
  }
})

test('cat_search_tm / cat_search_terms: empty tables give clean empty results with a note', async () => {
  const fixture = setup()
  try {
    const tools = createLinguistCatTools({ resolveProject: makeOkResolver(fixture) })
    const tm = (await invoke(toolByName(tools, 'cat_search_tm'), { query: 'anything' })).details as {
      results: unknown[]
      total: number
      limit: number
      note?: string
    }
    assert.equal(tm.results.length, 0)
    assert.equal(tm.total, 0)
    assert.equal(tm.limit, 20)
    assert.ok(tm.note?.includes('No TM units matched'))

    const terms = (await invoke(toolByName(tools, 'cat_search_terms'), { query: 'anything', limit: 500 }))
      .details as { results: unknown[]; total: number; limit: number; note?: string }
    assert.equal(terms.results.length, 0)
    assert.equal(terms.limit, 50) // clamped to the hard max even when empty
    assert.ok(terms.note?.includes('No term entries matched'))
  } finally {
    fixture.db.close()
  }
})

test('cat_search_tm / cat_search_terms: seeded rows are found (search is real, project-scoped)', async () => {
  const fixture = setup()
  try {
    const insertTm = fixture.db.catDb.db.prepare(
      'INSERT INTO tm_units (id, project_id, source, target, source_locale, target_locale, origin, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    )
    insertTm.run('tmu-1', fixture.project.id, 'Hello world', '你好，世界', 'en', 'zh-CN', 'import', '2026-01-01T00:00:00.000Z')
    insertTm.run('tmu-2', fixture.project.id, 'Goodbye world', '再见，世界', 'en', 'zh-CN', null, '2026-01-01T00:00:01.000Z')
    insertTm.run('tmu-3', 'prj-0000000000000000', 'Hello from another project', '另一个项目', 'en', 'zh-CN', null, '2026-01-01T00:00:02.000Z')
    const insertTerm = fixture.db.catDb.db.prepare(
      'INSERT INTO term_entries (id, project_id, term, translation, note, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    )
    insertTerm.run('ter-1', fixture.project.id, 'term base', '术语库', 'preferred', '2026-01-01T00:00:00.000Z')
    insertTerm.run('ter-2', fixture.project.id, 'memory', '记忆', null, '2026-01-01T00:00:01.000Z')

    const tools = createLinguistCatTools({ resolveProject: makeOkResolver(fixture) })
    const tm = (await invoke(toolByName(tools, 'cat_search_tm'), { query: 'hello' })).details as {
      results: Array<Record<string, unknown>>
      total: number
      note?: string
    }
    assert.equal(tm.total, 1) // project-scoped: tmu-3 is invisible
    assert.deepEqual(tm.results[0], {
      id: 'tmu-1',
      source: 'Hello world',
      target: '你好，世界',
      sourceLocale: 'en',
      targetLocale: 'zh-CN',
      origin: 'import',
    })
    assert.equal(tm.note, undefined)
    const tmTargetSide = (await invoke(toolByName(tools, 'cat_search_tm'), { query: '世界' })).details as {
      results: unknown[]
      total: number
    }
    assert.equal(tmTargetSide.total, 2)

    const terms = (await invoke(toolByName(tools, 'cat_search_terms'), { query: 'term' })).details as {
      results: Array<Record<string, unknown>>
      total: number
    }
    assert.equal(terms.total, 1)
    assert.deepEqual(terms.results[0], {
      id: 'ter-1',
      term: 'term base',
      translation: '术语库',
      status: 'allowed',
      caseSensitive: false,
      note: 'preferred',
    })
    const termsTranslationSide = (await invoke(toolByName(tools, 'cat_search_terms'), { query: '记忆' }))
      .details as { results: Array<Record<string, unknown>> }
    assert.deepEqual(termsTranslationSide.results[0], {
      id: 'ter-2',
      term: 'memory',
      translation: '记忆',
      status: 'allowed',
      caseSensitive: false,
    })

    const tmMatch = (await invoke(toolByName(tools, 'cat_search_tm'), { query: 'Hello world', mode: 'match' }))
      .details as { mode: string; results: Array<Record<string, unknown>>; total: number }
    assert.equal(tmMatch.mode, 'match')
    assert.equal(tmMatch.total, 1)
    assert.equal(tmMatch.results[0]?.matchType, 'exact')

    await assertThrowsCode(invoke(toolByName(tools, 'cat_search_tm'), { query: '   ' }), 'INVALID_ARGUMENT')
  } finally {
    fixture.db.close()
  }
})

test('binding errors: unbound session, missing project, resolver that throws typed errors', async () => {
  const fixture = setup()
  try {
    const minimalParams: Record<LinguistCatToolName, unknown> = {
      cat_project_summary: {},
      cat_list_assets: {},
      cat_get_segments: {},
      cat_search_tm: { query: 'x' },
      cat_search_terms: { query: 'x' },
      cat_propose_translations: {
        segmentProposals: [{ segmentId: fixture.segmentsA[0]!.id, baseRevision: 0, proposedTarget: 'x' }],
      },
      cat_run_qa: {},
      cat_get_qa_findings: {},
      cat_submit_critic_review: {
        segmentId: fixture.segmentsA[0]!.id,
        candidateProposalId: 'prp-0000000000000000',
        findings: [{ category: 'fidelity', severity: 'warning', evidenceRefs: ['tm:x'], explanation: 'x' }],
      },
      cat_run_batch_consistency: {},
      cat_search_sentence_patterns: {},
      cat_read_context_doc: { docId: 'ctx-0000000000000000' },
    }

    // unbound session: every tool throws BINDING_MISSING before touching the store
    const unboundTools = createLinguistCatTools({ resolveProject: () => new LinguistCatBindingMissingError() })
    for (const name of LINGUIST_CAT_TOOL_NAMES) {
      const err = await assertThrowsCode(invoke(toolByName(unboundTools, name), minimalParams[name]), 'BINDING_MISSING')
      assert.ok(err instanceof LinguistCatBindingMissingError)
    }

    // bound project gone: PROJECT_MISSING
    const missingTools = createLinguistCatTools({
      resolveProject: () => new LinguistCatProjectMissingError('prj-0000000000000000'),
    })
    await assertThrowsCode(invoke(toolByName(missingTools, 'cat_project_summary'), {}), 'PROJECT_MISSING')

    // store runtime unavailable: typed store error passes through unchanged
    const sqliteDown = createLinguistCatTools({
      resolveProject: () => {
        throw new StoreSqliteUnavailableError('fake test runtime')
      },
    })
    try {
      await invoke(toolByName(sqliteDown, 'cat_get_segments'), {})
      assert.fail('must throw')
    } catch (err) {
      assert.ok(err instanceof StoreSqliteUnavailableError)
      assert.equal((err as StoreSqliteUnavailableError).code, 'STORE_SQLITE_UNAVAILABLE')
    }
  } finally {
    fixture.db.close()
  }
})

test('output discipline: recursive no-absolute-path scan, JSON round-trip, zero console output', async () => {
  const fixture = setup()
  try {
    const tools = createLinguistCatTools({ resolveProject: makeOkResolver(fixture) })
    const calls: Array<[LinguistCatToolName, unknown]> = [
      ['cat_project_summary', {}],
      ['cat_list_assets', { limit: 1 }],
      ['cat_get_segments', { limit: 3, search: 'source' }],
      ['cat_search_tm', { query: 'x' }],
      ['cat_search_terms', { query: 'x' }],
      ['cat_run_qa', {}],
      ['cat_get_qa_findings', { limit: 3 }],
      ['cat_search_sentence_patterns', { limit: 3 }],
    ]
    const original = { log: console.log, info: console.info, warn: console.warn, error: console.error }
    let consoleCalls = 0
    console.log = console.info = console.warn = console.error = (() => {
      consoleCalls += 1
    }) as typeof console.log
    try {
      for (const [name, params] of calls) {
        const result = await invoke(toolByName(tools, name), params)
        assertNoAbsolutePaths(result, fixture.rootDir)
        assert.deepEqual(JSON.parse(JSON.stringify(result.details)), result.details)
        assert.deepEqual(JSON.parse(resultText(result)), result.details)
      }
    } finally {
      console.log = original.log
      console.info = original.info
      console.warn = original.warn
      console.error = original.error
    }
    // plan §7.4: never log customer text — the tools log nothing at all
    assert.equal(consoleCalls, 0)
  } finally {
    fixture.db.close()
  }
})

test('perf: 10k-segment project — paged queries stay capped and fast', async () => {
  const rootDir = makeTempDir()
  const store = new CatStore({ rootDir, entropy: makeEntropy('pb-041-perf'), now: makeClock() })
  const project = store.createProject({ name: 'Big', sourceLocale: 'en', targetLocale: 'zh-CN', promaWorkspaceId: 'ws' })
  const db = store.openProject(project.id)
  try {
    const { segments } = seedAsset(db, project, {
      filename: 'big.tsv',
      sha: 'c'.repeat(64),
      count: 10_000,
      sourcePrefix: 'Big',
      fillEvery: 3,
    })
    const tools = createLinguistCatTools({ resolveProject: () => ({ project, db }) })
    const tool = toolByName(tools, 'cat_get_segments')

    const durations: number[] = []
    const offsets = [0, 1000, 2500, 5000, 7500, 9900, 10_000]
    for (let round = 0; round < 3; round++) {
      for (const offset of offsets) {
        const started = performance.now()
        const result = await invoke(tool, { limit: 100, offset })
        durations.push(performance.now() - started)
        const dto = result.details as PagedResult<{ id: string }>
        assert.equal(dto.total, 10_000)
        assert.ok(dto.items.length <= 100, 'page size is hard-capped')
        assert.ok(resultText(result).length < 1_000_000, 'result payload stays small')
      }
    }
    // exact ids at a page boundary
    const page = (await invoke(tool, { limit: 100, offset: 9900 })).details as PagedResult<{ id: string; ordinal: number }>
    assert.equal(page.items[0]!.id, segments[9900]!.id as string)
    assert.equal(page.items[0]!.ordinal, 9900)
    assert.equal(page.hasMore, false)

    durations.sort((a, b) => a - b)
    const p95 = durations[Math.floor(0.95 * (durations.length - 1))]!
    const totalMs = durations.reduce((sum, value) => sum + value, 0)
    // generous bounds (each call is normally <10ms on node:sqlite)
    assert.ok(p95 < 500, `p95 paged query too slow: ${p95.toFixed(1)}ms`)
    assert.ok(totalMs < 5_000, `21 paged queries too slow overall: ${totalMs.toFixed(1)}ms`)
  } finally {
    db.close()
  }
})

// ===== PB-083: cat_submit_critic_review =====

interface CriticReviewDto {
  artifactId: string
  findingIds: string[]
  qaFindingIds: string[]
  repairScope: { authority: string; canCommit: boolean; segmentIds: string[]; findingIds: string[] }
}

/** 先由「候选会话」提案，再用「评审会话」提交评审（两会话独立，满足独立性闸门）。 */
async function proposeAsCandidate(
  fixture: Fixture,
  segmentId: string,
  candidateSessionId: string,
  proposedTarget?: string,
): Promise<string> {
  // 默认目标带源文，数字/占位符/标签签名与源文一致，稳过确定性硬门
  const target = proposedTarget ?? `候选 ${fixture.db.segments.getById(segmentId)!.source}`
  const candidateTools = createLinguistCatTools({
    resolveProject: makeOkResolver(fixture),
    sessionId: candidateSessionId,
  })
  const result = await invoke(toolByName(candidateTools, 'cat_propose_translations'), {
    segmentProposals: [{ segmentId, baseRevision: 0, proposedTarget: target }],
  })
  return (JSON.parse(resultText(result)) as { proposalIds: string[] }).proposalIds[0]!
}

function makeCriticTools(
  fixture: Fixture,
  sessionId: string,
  criticSkillBytes?: () => string | Uint8Array | undefined,
  onMutation?: (mutation: LinguistCatToolMutation) => void,
) {
  return createLinguistCatTools({
    resolveProject: makeOkResolver(fixture),
    sessionId,
    ...(criticSkillBytes !== undefined ? { criticSkillBytes } : {}),
    ...(onMutation !== undefined ? { onMutation } : {}),
  })
}

const REVIEW_FINDINGS = [
  {
    category: 'fidelity',
    severity: 'L2',
    issueType: 'omission',
    evidenceRefs: ['tm:unit-1', 'seg source text'],
    explanation: '译文漏译了源文第二分句。',
  },
  {
    category: 'terminology',
    severity: 'L1',
    issueType: 'terminology_soft',
    evidenceRefs: ['term: 术语库 v3'],
    explanation: '术语与术语库指定译法不一致。',
    suggestedRepair: '改用术语库译法。',
  },
] as const

test('cat_submit_critic_review: happy path 双写（artifact + QA findings），身份由运行时派生', async () => {
  const fixture = setup()
  try {
    const seg = fixture.segmentsA[0]!
    const proposalId = await proposeAsCandidate(fixture, seg.id, 'sess-candidate')
    const mutations: LinguistCatToolMutation[] = []
    const tools = makeCriticTools(
      fixture,
      'sess-critic',
      undefined,
      (mutation) => mutations.push(mutation),
    )

    const result = await invoke(toolByName(tools, 'cat_submit_critic_review'), {
      segmentId: seg.id,
      candidateProposalId: proposalId,
      findings: REVIEW_FINDINGS,
    })
    const dto = JSON.parse(resultText(result)) as CriticReviewDto

    // 返回形状：advisory 范围，canCommit 烧死 false
    assert.ok(dto.artifactId.startsWith('critic:'))
    assert.equal(dto.findingIds.length, 2)
    assert.ok(dto.findingIds.every((id) => id.startsWith('cf:')))
    assert.equal(dto.qaFindingIds.length, 2)
    assert.ok(dto.qaFindingIds.every((id) => id.startsWith('qaf-')))
    assert.equal(dto.repairScope.authority, 'advisory_finding')
    assert.equal(dto.repairScope.canCommit, false)
    assert.deepEqual(dto.repairScope.segmentIds, [seg.id])
    assert.deepEqual(dto.repairScope.findingIds, [...dto.findingIds].sort())

    // artifact 落库：身份/哈希全部由运行时派生
    const artifact = fixture.db.criticArtifacts.getById(dto.artifactId)
    assert.ok(artifact)
    assert.equal(artifact.subject.segmentId, seg.id)
    assert.equal(artifact.subject.risk, 'high')
    assert.equal(artifact.subject.candidateId, proposalId)
    assert.equal(
      artifact.subject.candidateHash,
      independentCriticCandidateHash({
        proposalId,
        segmentId: seg.id,
        target: `候选 ${seg.source}`,
        revision: 0,
      }),
    )
    assert.equal(artifact.subject.candidateExecutionId, 'sess-candidate')
    assert.equal(artifact.subject.candidateProducerId, 'session:sess-candidate')
    assert.equal(artifact.critic.criticId, 'session:sess-critic')
    assert.equal(artifact.critic.executionId, 'sess-critic')
    // 未注入 skill 字节 → 回退档案哈希
    assert.equal(artifact.critic.profileHash, independentCriticProfileHash('linguist-critic-profile:v1'))

    // QA findings 落库：CRITIC_<CATEGORY> code、severity/issueType 透传、needs_review、message=explanation
    const qaRows = fixture.db.qaFindings.list({ segmentId: seg.id })
    assert.equal(qaRows.length, 2)
    assert.deepEqual(
      qaRows.map((row) => `${row.code}:${row.severity}:${row.status}`).sort(),
      ['CRITIC_FIDELITY:L2:open', 'CRITIC_TERMINOLOGY:L1:open'],
    )
    assert.deepEqual(
      qaRows.map((row) => `${row.issueType}:${row.disposition}`).sort(),
      ['omission:needs_review', 'terminology_soft:needs_review'],
    )
    assert.ok(qaRows.every((row) => row.segmentRevision === seg.revision))
    assert.deepEqual(mutations, [{
      kind: 'project-updated',
      segmentIds: [seg.id as string],
      proposalIds: [proposalId],
      qaFindingIds: dto.qaFindingIds,
    }])
    assert.deepEqual(
      qaRows.map((row) => row.id).sort(),
      [...dto.qaFindingIds].sort(),
    )
    assert.equal(qaRows.find((row) => row.code === 'CRITIC_FIDELITY')?.message, '译文漏译了源文第二分句。')

    // 段与提案不被触碰
    const segmentAfter = fixture.db.segments.getById(seg.id)
    assert.equal(segmentAfter?.target, seg.target)
    assert.equal(segmentAfter?.revision, seg.revision)
    assert.equal(fixture.db.proposals.getById(proposalId)?.status, 'pending')

    // 幂等：同一评审重提 → 同 artifactId / qaFindingIds，不产生重复行
    const again = JSON.parse(
      resultText(
        await invoke(toolByName(tools, 'cat_submit_critic_review'), {
          segmentId: seg.id,
          candidateProposalId: proposalId,
          findings: REVIEW_FINDINGS,
        }),
      ),
    ) as CriticReviewDto
    assert.equal(again.artifactId, dto.artifactId)
    assert.deepEqual(again.qaFindingIds, dto.qaFindingIds)
    assert.equal(fixture.db.criticArtifacts.listBySegment(seg.id).length, 1)
    assert.equal(fixture.db.qaFindings.list({ segmentId: seg.id }).length, 2)
    assert.equal(mutations.length, 1, '幂等重提没有真实写入，不得生成伪 mutation')
  } finally {
    fixture.db.close()
  }
})

test('cat_submit_critic_review: 同会话评审自己的提案被独立性闸门拒绝', async () => {
  const fixture = setup()
  try {
    const seg = fixture.segmentsA[0]!
    const proposalId = await proposeAsCandidate(fixture, seg.id, 'sess-1')
    const tools = makeCriticTools(fixture, 'sess-1')
    await assert.rejects(
      invoke(toolByName(tools, 'cat_submit_critic_review'), {
        segmentId: seg.id,
        candidateProposalId: proposalId,
        findings: [REVIEW_FINDINGS[0]],
      }),
      /Independent Critic must use a different (execution|actor) from the candidate producer\./,
    )
    // 拒绝即无落库
    assert.equal(fixture.db.criticArtifacts.listBySegment(seg.id).length, 0)
    assert.equal(fixture.db.qaFindings.list({ segmentId: seg.id }).length, 0)
  } finally {
    fixture.db.close()
  }
})

test('cat_submit_critic_review: 提案不存在 / 跨项目 / 段不匹配被拒', async () => {
  const fixture = setup()
  const other = setup()
  try {
    const seg = fixture.segmentsA[0]!
    const tools = makeCriticTools(fixture, 'sess-critic')

    // 不存在
    try {
      await invoke(toolByName(tools, 'cat_submit_critic_review'), {
        segmentId: seg.id,
        candidateProposalId: 'prp-0000000000000000',
        findings: [REVIEW_FINDINGS[0]],
      })
      assert.fail('must throw')
    } catch (err) {
      assert.equal((err as { code?: string }).code, 'STORE_NOT_FOUND')
    }

    // 跨项目：别的项目的提案 id 在本项目库查无此行
    const foreignProposalId = await proposeAsCandidate(other, other.segmentsA[0]!.id, 'sess-candidate')
    try {
      await invoke(toolByName(tools, 'cat_submit_critic_review'), {
        segmentId: seg.id,
        candidateProposalId: foreignProposalId,
        findings: [REVIEW_FINDINGS[0]],
      })
      assert.fail('must throw')
    } catch (err) {
      assert.equal((err as { code?: string }).code, 'STORE_NOT_FOUND')
    }

    // 段不匹配：提案属于 segmentsA[0]，谎称 segmentsA[1]
    const proposalId = await proposeAsCandidate(fixture, seg.id, 'sess-candidate')
    await assertThrowsCode(
      invoke(toolByName(tools, 'cat_submit_critic_review'), {
        segmentId: fixture.segmentsA[1]!.id,
        candidateProposalId: proposalId,
        findings: [REVIEW_FINDINGS[0]],
      }),
      'INVALID_ARGUMENT',
    )
  } finally {
    fixture.db.close()
    other.db.close()
  }
})

test('cat_submit_critic_review: 审计专用证据与空 findings 被拒', async () => {
  const fixture = setup()
  try {
    const seg = fixture.segmentsA[0]!
    const proposalId = await proposeAsCandidate(fixture, seg.id, 'sess-candidate')
    const tools = makeCriticTools(fixture, 'sess-critic')

    await assert.rejects(
      invoke(toolByName(tools, 'cat_submit_critic_review'), {
        segmentId: seg.id,
        candidateProposalId: proposalId,
        findings: [{ ...REVIEW_FINDINGS[0], evidenceRefs: ['tool_trace: call-9'] }],
      }),
      /must contain citable evidenceRefs, not audit-only trace\./,
    )
    await assertThrowsCode(
      invoke(toolByName(tools, 'cat_submit_critic_review'), {
        segmentId: seg.id,
        candidateProposalId: proposalId,
        findings: [],
      }),
      'INVALID_ARGUMENT',
    )
    assert.equal(fixture.db.criticArtifacts.listBySegment(seg.id).length, 0)
  } finally {
    fixture.db.close()
  }
})

test('cat_submit_critic_review: profileHash 取评审 skill 字节 sha256；无 session 绑定拒写', async () => {
  const fixture = setup()
  try {
    const seg = fixture.segmentsA[0]!
    const proposalId = await proposeAsCandidate(fixture, seg.id, 'sess-candidate')

    const withSkill = makeCriticTools(fixture, 'sess-critic', () => 'skill-bytes-v1')
    const dto = JSON.parse(
      resultText(
        await invoke(toolByName(withSkill, 'cat_submit_critic_review'), {
          segmentId: seg.id,
          candidateProposalId: proposalId,
          findings: [REVIEW_FINDINGS[0]],
        }),
      ),
    ) as CriticReviewDto
    assert.equal(
      fixture.db.criticArtifacts.getById(dto.artifactId)?.critic.profileHash,
      independentCriticProfileHash('skill-bytes-v1'),
    )

    // 工厂未注入 sessionId → 评审身份无从派生，拒绝
    const noSession = createLinguistCatTools({ resolveProject: makeOkResolver(fixture) })
    await assertThrowsCode(
      invoke(toolByName(noSession, 'cat_submit_critic_review'), {
        segmentId: seg.id,
        candidateProposalId: proposalId,
        findings: [REVIEW_FINDINGS[0]],
      }),
      'INVALID_ARGUMENT',
    )
  } finally {
    fixture.db.close()
  }
})

// ===== PB-084: cat_run_batch_consistency =====

interface BatchConsistencyDto {
  mode: string
  findingCount: number
  groupCount: number
  groups: Array<{
    source: string
    segmentIds: string[]
    findingIds: string[]
    suggestedTarget?: string
    findings: Array<{ findingId: string; segmentId: string; code: string; locked: boolean }>
  }>
  proposalIds?: string[]
  skipped?: Array<{ segmentId: string; reason: string }>
  note?: string
}

/** 造一组同 source 不同 target 的段（一致性场景专用）。 */
function seedConsistencyAsset(
  fixture: Fixture,
  rows: Array<{ key: string; source: string; target: string; locked?: boolean }>,
): Segment[] {
  const asset = createAsset({
    projectId: fixture.project.id,
    formatId: 'fake_tsv',
    originalFilename: `consistency-${rows.length}-${rows[0]?.key ?? 'x'}.tsv`,
    sourceSha256: 'd'.repeat(64),
    segmentCount: rows.length,
  })
  const segments: Segment[] = rows.map((row, index) => ({
    id: deriveSegmentId(asset.id, index, row.key),
    assetId: asset.id,
    ordinal: index,
    key: row.key,
    source: row.source,
    target: row.target,
    sourceLocale: 'en',
    targetLocale: 'zh-CN',
    status: 'translated',
    locked: row.locked ?? false,
    revision: 0,
    sourceHash: `hash-${row.key}`,
  }))
  fixture.db.assets.insert(asset, segments)
  return segments
}

test('cat_run_batch_consistency check-only: 按 source 分组报告，绝不写库', async () => {
  const fixture = setup()
  try {
    const segs = seedConsistencyAsset(fixture, [
      { key: 'r0', source: 'Save your work', target: '保存你的工作' },
      { key: 'r1', source: 'Save your work', target: '保存你的工作' },
      { key: 'r2', source: 'Save your work', target: '储存你的工作' },
    ])
    // 预置一条 critic 一致性 finding（模拟 PB-083 评审已落库的行）
    fixture.db.qaFindings.insertOpen([
      { segmentId: segs[2]!.id, code: 'CRITIC_CONSISTENCY', severity: 'L2', message: '与项目惯例译法不一致。' },
    ])
    const qaRowsBefore = fixture.db.qaFindings.count({})
    const mutations: LinguistCatToolMutation[] = []
    const tools = createLinguistCatTools({
      resolveProject: makeOkResolver(fixture),
      onMutation: (mutation) => mutations.push(mutation),
    })

    const result = await invoke(toolByName(tools, 'cat_run_batch_consistency'), {})
    const dto = JSON.parse(resultText(result)) as BatchConsistencyDto

    assert.equal(dto.mode, 'check-only')
    assert.equal(dto.groupCount, 1)
    // 内存 runQa 对同 source 三段出 INCONSISTENT_REPEATED_SOURCE ×3，加库中 CRITIC_ 行
    assert.equal(dto.findingCount, 4)
    const group = dto.groups[0]!
    assert.equal(group.source, 'Save your work')
    assert.deepEqual(group.segmentIds, segs.map((seg) => seg.id as string))
    assert.equal(group.suggestedTarget, '保存你的工作') // 多数 2v1
    const codes = group.findings.map((finding) => finding.code)
    assert.equal(codes.filter((code) => code === 'INCONSISTENT_REPEATED_SOURCE').length, 3)
    assert.ok(codes.includes('CRITIC_CONSISTENCY'))
    assert.ok(group.findings.every((finding) => !finding.locked))
    // EMPTY_TARGET / TARGET_LENGTH_WARNING 等非一致性 code 不进报告
    assert.ok(codes.every((code) => !['EMPTY_TARGET', 'TARGET_LENGTH_WARNING'].includes(code)))

    // 零写库：findings 行数不变、无 proposals、段行不动
    assert.equal(fixture.db.qaFindings.count({}), qaRowsBefore)
    assert.equal(fixture.db.proposals.listPending().length, 0)
    assert.equal(fixture.db.segments.getById(segs[2]!.id)?.target, '储存你的工作')
    assert.deepEqual(mutations, [])
    assertNoAbsolutePaths(result, fixture.rootDir)
  } finally {
    fixture.db.close()
  }
})

test('cat_run_batch_consistency repair: 只修复命中段，走 Proposal 审核链且幂等', async () => {
  const fixture = setup()
  try {
    const segs = seedConsistencyAsset(fixture, [
      { key: 'r0', source: 'Save your work', target: '保存你的工作' },
      { key: 'r1', source: 'Save your work', target: '保存你的工作' },
      { key: 'r2', source: 'Save your work', target: '储存你的工作' },
      { key: 'r3', source: 'Save your work', target: '存档你的工作', locked: true },
    ])
    // critic finding 把锁定段拉进组：其 target 参与计票，但自身绝不修复
    fixture.db.qaFindings.insertOpen([
      { segmentId: segs[3]!.id, code: 'CRITIC_CONSISTENCY', severity: 'L2', message: '锁定段译文为审校基准之一。' },
    ])
    const mutations: LinguistCatToolMutation[] = []
    const tools = createLinguistCatTools({
      resolveProject: makeOkResolver(fixture),
      now: () => '2026-01-02T00:00:00.000Z',
      modelId: 'fake-model',
      sessionId: 'session-1',
      onMutation: (mutation) => mutations.push(mutation),
    })

    const result = await invoke(toolByName(tools, 'cat_run_batch_consistency'), { mode: 'repair' })
    const dto = JSON.parse(resultText(result)) as BatchConsistencyDto

    assert.equal(dto.mode, 'repair')
    assert.equal(dto.groupCount, 1)
    const group = dto.groups[0]!
    assert.equal(group.segmentIds.length, 4)
    // 保存 2 票、储存/存档各 1 票 → 建议 保存你的工作
    assert.equal(group.suggestedTarget, '保存你的工作')
    assert.equal(group.findings.find((finding) => finding.segmentId === segs[3]!.id)?.locked, true)

    // 只有 r2（储存）出 proposal；r0/r1 已一致、r3 锁定
    assert.equal(dto.proposalIds?.length, 1)
    const proposal = fixture.db.proposals.getById(dto.proposalIds![0]!)
    assert.ok(proposal)
    assert.equal(proposal.segmentId, segs[2]!.id)
    assert.equal(proposal.proposedTarget, '保存你的工作')
    assert.equal(proposal.baseRevision, 0)
    assert.equal(proposal.status, 'pending')
    assert.equal(proposal.modelId, 'fake-model')
    assert.equal(proposal.sessionId, 'session-1')
    assert.equal(proposal.createdAt, '2026-01-02T00:00:00.000Z')
    assert.ok(proposal.evidenceRefs.length > 0, 'evidenceRefs 应带该段的 finding ids 供人审追溯')

    const skippedById = new Map(dto.skipped?.map((item) => [item.segmentId, item.reason]))
    assert.match(skippedById.get(segs[0]!.id) ?? '', /already consistent/)
    assert.match(skippedById.get(segs[1]!.id) ?? '', /already consistent/)
    assert.match(skippedById.get(segs[3]!.id) ?? '', /locked/)
    assert.deepEqual(mutations, [{
      kind: 'proposal-created',
      segmentIds: [segs[2]!.id as string],
      proposalIds: dto.proposalIds,
    }])

    // 段行绝不被工具改动（人审前）
    for (const seg of segs) {
      const after = fixture.db.segments.getById(seg.id)
      assert.equal(after?.target, seg.target)
      assert.equal(after?.revision, seg.revision)
    }

    // 幂等：同状态重跑 → 同 proposalIds、无重复行
    const again = JSON.parse(
      resultText(await invoke(toolByName(tools, 'cat_run_batch_consistency'), { mode: 'repair' })),
    ) as BatchConsistencyDto
    assert.deepEqual(again.proposalIds, dto.proposalIds)
    assert.equal(fixture.db.proposals.listPending().length, 1)
    assert.equal(mutations.length, 1, '幂等重跑没有真实写入，不得生成伪 mutation')
    assertNoAbsolutePaths(result, fixture.rootDir)
  } finally {
    fixture.db.close()
  }
})

test('cat_run_batch_consistency repair: 多数译文撞确定性硬门的段跳过，不掀翻整批', async () => {
  const fixture = setup()
  try {
    const segs = seedConsistencyAsset(fixture, [
      { key: 'r0', source: 'Hello', target: '你好 {name}' },
      { key: 'r1', source: 'Hello', target: '你好 {name}' },
      { key: 'r2', source: 'Hello', target: '你好' },
    ])
    const tools = createLinguistCatTools({ resolveProject: makeOkResolver(fixture) })
    const dto = JSON.parse(
      resultText(await invoke(toolByName(tools, 'cat_run_batch_consistency'), { mode: 'repair' })),
    ) as BatchConsistencyDto
    // 建议译文带源文没有的占位符 → 给 r2 出 proposal 会撞 PLACEHOLDER 硬门 → 跳过
    assert.deepEqual(dto.proposalIds, [])
    assert.equal(fixture.db.proposals.listPending().length, 0)
    const hardRuleSkip = dto.skipped?.find((item) => item.segmentId === segs[2]!.id)
    assert.match(hardRuleSkip?.reason ?? '', /hard rule/)
  } finally {
    fixture.db.close()
  }
})

test('cat_run_batch_consistency: 无一致性命中 → 空报告 + note，repair 不建提案', async () => {
  const fixture = setup()
  try {
    const tools = createLinguistCatTools({ resolveProject: makeOkResolver(fixture) })
    for (const mode of ['check-only', 'repair'] as const) {
      const dto = JSON.parse(
        resultText(await invoke(toolByName(tools, 'cat_run_batch_consistency'), { mode })),
      ) as BatchConsistencyDto
      assert.equal(dto.findingCount, 0)
      assert.equal(dto.groupCount, 0)
      assert.ok(dto.note)
      if (mode === 'repair') assert.deepEqual(dto.proposalIds, [])
    }
    assert.equal(fixture.db.proposals.listPending().length, 0)
  } finally {
    fixture.db.close()
  }
})

// ===== PB-095：cat_search_sentence_patterns / cat_read_context_doc =====

test('cat_search_sentence_patterns: filters + pagination hard cap + empty note', async () => {
  const fixture = setup()
  try {
    fixture.db.sentencePatterns.importMany([
      { source: 'Critical hit!', suggestedTarget: '暴击！', textType: 'dialogue', status: 'confirmed' },
      { source: 'Hello there', textType: 'dialogue' },
      { source: 'Settings saved', textType: 'ui', status: 'rejected' },
    ])
    const tools = createLinguistCatTools({ resolveProject: makeOkResolver(fixture) })
    const tool = toolByName(tools, 'cat_search_sentence_patterns')

    const all = (await invoke(tool, {})).details as PagedResult<Record<string, unknown>>
    assert.equal(all.total, 3)
    assert.equal(all.items.length, 3)
    assert.equal(all.hasMore, false)
    assert.equal(all.note, undefined)

    const byStatus = (await invoke(tool, { status: 'confirmed' })).details as PagedResult<Record<string, unknown>>
    assert.equal(byStatus.total, 1)
    assert.equal(byStatus.items[0]!.suggestedTarget, '暴击！')

    const byQuery = (await invoke(tool, { query: 'hello' })).details as PagedResult<unknown>
    assert.equal(byQuery.total, 1)
    const byTextType = (await invoke(tool, { textType: 'ui' })).details as PagedResult<unknown>
    assert.equal(byTextType.total, 1)

    // 分页硬顶：clamp 到 50 + note（不抛错）。
    const clamped = (await invoke(tool, { limit: 500 })).details as PagedResult<unknown>
    assert.equal(clamped.limit, 50)
    assert.ok(clamped.note?.includes('500'))
    assert.ok(clamped.note?.includes('50'))

    const paged = (await invoke(tool, { limit: 2, offset: 2 })).details as PagedResult<unknown>
    assert.equal(paged.items.length, 1)
    assert.equal(paged.hasMore, false)

    await assertThrowsCode(invoke(tool, { query: '   ' }), 'INVALID_ARGUMENT')
    await assertThrowsCode(invoke(tool, { status: 'bogus' }), 'INVALID_ARGUMENT')

    // 空结果带 note，非错误。
    const empty = (await invoke(tool, { query: 'nothing-matches' })).details as PagedResult<unknown>
    assert.equal(empty.total, 0)
    assert.ok(empty.note?.includes('No sentence patterns matched'))
  } finally {
    fixture.db.close()
  }
})

test('cat_read_context_doc: paged extract read + image metadata-only + not-found passthrough', async () => {
  const fixture = setup()
  try {
    const longText = `第一段。${'字'.repeat(9000)}`
    const doc = fixture.db.contextDocs.insert({
      kind: 'doc',
      originalFilename: '设定.md',
      blobRelpath: 'blobs/ctx-lore.md',
      sha256: 'c'.repeat(64),
      note: '世界观',
      textExtract: longText,
    })
    const image = fixture.db.contextDocs.insert({
      kind: 'image',
      originalFilename: 'hud.png',
      blobRelpath: 'blobs/ctx-hud.png',
    })
    const noExtract = fixture.db.contextDocs.insert({
      kind: 'doc',
      originalFilename: 'data.bin',
      blobRelpath: 'blobs/ctx-data.bin',
    })
    const tools = createLinguistCatTools({ resolveProject: makeOkResolver(fixture) })
    const tool = toolByName(tools, 'cat_read_context_doc')

    // 第一页（默认 4000 字符）→ hasMore；第二页接续；末页收口。
    const page1 = (await invoke(tool, { docId: doc.id })).details as {
      text: string
      totalChars: number
      hasMore: boolean
      offset: number
      limit: number
      filename: string
      docNote?: string
    }
    assert.equal(page1.filename, '设定.md')
    assert.equal(page1.docNote, '世界观')
    assert.equal(page1.totalChars, longText.length)
    assert.equal(page1.text.length, 4000)
    assert.equal(page1.hasMore, true)
    const page2 = (await invoke(tool, { docId: doc.id, offset: 4000, limit: 8000 })).details as {
      text: string
      hasMore: boolean
    }
    assert.equal(page2.text, longText.slice(4000))
    assert.equal(page2.hasMore, false)
    assert.equal(page1.text + page2.text, longText)

    // 字符数硬顶：clamp + note。
    const clamped = (await invoke(tool, { docId: doc.id, limit: 99999 })).details as {
      limit: number
      note?: string
    }
    assert.equal(clamped.limit, 8000)
    assert.ok(clamped.note?.includes('99999'))

    // 图片：只回元数据说明，不回字节。
    const imageResult = (await invoke(tool, { docId: image.id })).details as {
      kind: string
      text?: string
      totalChars: number
      note?: string
    }
    assert.equal(imageResult.kind, 'image')
    assert.equal(imageResult.text, undefined)
    assert.equal(imageResult.totalChars, 0)
    assert.ok(imageResult.note?.includes('image'))

    // 无抽取文本：note 说明。
    const binary = (await invoke(tool, { docId: noExtract.id })).details as { text?: string; note?: string }
    assert.equal(binary.text, undefined)
    assert.ok(binary.note?.includes('no plain-text extract'))

    // 未知 docId：store 类型化错误穿透（STORE_NOT_FOUND）。
    try {
      await invoke(tool, { docId: 'ctx-0000000000000000' })
      assert.fail('must throw')
    } catch (err) {
      assert.ok(err instanceof StoreNotFoundError)
      assert.equal((err as StoreNotFoundError).code, 'STORE_NOT_FOUND')
    }

    // 输出纪律：无绝对路径泄漏。
    assertNoAbsolutePaths(page1, fixture.rootDir)
  } finally {
    fixture.db.close()
  }
})

test('cat_search_terms: PB-095 annotation columns (module/category/imageRef) ride the response', async () => {
  const fixture = setup()
  try {
    fixture.db.termEntries.upsert({
      term: 'Potion',
      translation: '药水',
      status: 'preferred',
      caseSensitive: false,
      module: 'items',
      category: 'consumable',
      imageRef: 'blobs/ctx-potion.png',
    })
    fixture.db.termEntries.upsert({ term: 'Elixir', translation: '灵药', status: 'allowed', caseSensitive: false })
    const tools = createLinguistCatTools({ resolveProject: makeOkResolver(fixture) })
    const dto = (await invoke(toolByName(tools, 'cat_search_terms'), { query: '药' })).details as {
      results: Array<Record<string, unknown>>
    }
    const annotated = dto.results.find((entry) => entry.term === 'Potion')
    assert.deepEqual(annotated, {
      id: annotated!.id,
      term: 'Potion',
      translation: '药水',
      status: 'preferred',
      caseSensitive: false,
      module: 'items',
      category: 'consumable',
      imageRef: 'blobs/ctx-potion.png',
    })
    // 未标注的行不出现新字段（可空列缺省而非 null 泄漏）。
    const plain = dto.results.find((entry) => entry.term === 'Elixir')
    assert.equal(plain !== undefined && !('module' in plain), true)
    assert.equal(plain !== undefined && !('imageRef' in plain), true)
  } finally {
    fixture.db.close()
  }
})
