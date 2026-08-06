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
  StoreIdempotencyConflictError,
  StoreNotFoundError,
  StoreReadOnlyError,
  StoreSqliteUnavailableError,
  type ProjectDatabase,
} from '@linguist/cat-store'
import { createLinguistCatTools } from './factory'
import {
  runConsistencyPlanWorkerJob,
  runQaWorkerJob,
  type WorkerJobProgress,
} from './job-runner'
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

async function invoke(
  tool: LinguistCatTool,
  params: unknown,
  toolCallId = 'call-1',
): Promise<AgentToolResult<unknown>> {
  return tool.execute(toolCallId, params as never, undefined, undefined, FAKE_EXTENSION_CTX)
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
    assert.equal(tools.length, LINGUIST_CAT_TOOL_NAMES.length)
    assert.equal(
      (toolByName(tools, 'cat_submit_critic_review').parameters as { type?: string }).type,
      'object',
    )
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

test('intake tools use opaque session-source callbacks and never accept paths', async () => {
  const fixture = setup()
  try {
    let importedToken = ''
    const tools = createLinguistCatTools({
      resolveProject: makeOkResolver(fixture),
      listIntakeSources: () => [{
        sourceToken: 'attached-file:test-token',
        filename: 'source.xliff',
        sizeBytes: 12,
        status: 'ready',
      }],
      importIntakeAsset: async (sourceToken) => {
        importedToken = sourceToken
        return {
          sourceToken,
          filename: 'source.xliff',
          status: 'imported',
          assetId: fixture.assetA.id as string,
          formatId: 'xliff_1_2',
          segmentCount: 1,
          sourceSha256: 'a'.repeat(64),
          warnings: [],
        }
      },
    })
    const sources = (await invoke(toolByName(tools, 'cat_list_intake_sources'), {})).details as {
      sources: Array<{ sourceToken: string; filename: string; sizeBytes: number; status: string }>
    }
    assert.deepEqual(sources.sources, [{
      sourceToken: 'attached-file:test-token',
      filename: 'source.xliff',
      sizeBytes: 12,
      status: 'ready',
    }])
    assertNoAbsolutePaths(sources, fixture.rootDir)
    const imported = (await invoke(toolByName(tools, 'cat_import_asset'), {
      sourceToken: 'attached-file:test-token',
    })).details as { sourceToken: string; filename: string; status: string }
    assert.equal(importedToken, 'attached-file:test-token')
    assert.equal(imported.status, 'imported')
    assert.equal(imported.filename, 'source.xliff')
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
      'cat_get_translation_context',
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
    assert.equal(mutations[0]!.sequence, 4)
    assert.deepEqual(
      [...(mutations[0]!.segmentIds ?? [])].sort(),
      fixture.db.qaFindings.list({}).map((finding) => finding.segmentId as string).sort(),
    )
    assert.deepEqual(
      [...(mutations[0]!.qaFindingIds ?? [])].sort(),
      fixture.db.qaFindings.list({}).map((finding) => finding.id as string).sort(),
    )
    const repeated = (await invoke(toolByName(tools, 'cat_run_qa'), {})).details
    assert.deepEqual(repeated, run)
    assert.equal(mutations.length, 1)
    const fixedSegment = fixture.segmentsA[1]!
    const resolvedId = fixture.db.qaFindings.list({ segmentId: fixedSegment.id, status: 'open' })[0]!.id as string
    fixture.db.segments.applyTargetEdit(fixedSegment.id, '阿尔法源文 1', 0)
    await invoke(toolByName(tools, 'cat_run_qa'), {}, 'call-2')
    assert.equal(mutations.length, 2)
    assert.deepEqual(mutations[1]!.resolvedQaFindingIds, [resolvedId])
    assert.ok(mutations[1]!.segmentIds?.includes(fixedSegment.id))
    assert.equal(fixture.db.qaFindings.getById(resolvedId)?.status, 'resolved')
    assert.equal(fixture.db.runs.listEvents().length, 11, 'human segment edit now uses the durable outbox')
    assert.deepEqual(
      fixture.db.runs.listEvents().filter((event) => event.kind === 'qa-updated').at(-1)?.resolvedQaFindingIds,
      [resolvedId],
    )
    const summary = fixture.db.runs.getRunChangeSummary('qa:session-unavailable:call-1')
    assert.equal(summary.mutationCount, 1)
    assert.equal(summary.changes.qaFindingsCreated, 12)
    assert.deepEqual(summary.eventSequence, { first: 1, last: 5 })
    assert.equal(summary.canUndo, false)
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
    assert.ok(resultText(result).includes('Structured data is available in details.'))
    assert.notEqual(resultText(result), JSON.stringify(dto, null, 2))
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
      generationProvenance: (toolCallId) => ({
        sessionId: 'session-1',
        runId: `run:session-1:${toolCallId}`,
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
        turnContextSnapshot: '{"activeSegmentId":"seg-1"}',
        turnContextHash: '3'.repeat(64),
        toolsetHash: '4'.repeat(64),
      }),
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
      const issuance = fixture.db.proposals.listIssuances(id)[0]!
      assert.equal(issuance.runtime, 'claude')
      assert.equal(issuance.modelProvider, 'anthropic')
      assert.equal(issuance.toolCallId, 'call-1')
      assert.equal(issuance.toolsetHash, '4'.repeat(64))
    }
    assert.deepEqual(
      fixture.db.segments.getByIds(before.map((segment) => segment.id)),
      before,
      'the agent tool must never mutate Segment rows',
    )
    assert.deepEqual(mutations, [{
      kind: 'proposal-created',
      sequence: 1,
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
    assert.deepEqual(fixture.db.runs.listEvents().map((event) => event.sequence), [1])
    assert.equal(fixture.db.runs.getRunChangeSummary(dto.runId).mutationCount, 1)
    await assert.rejects(
      invoke(toolByName(tools, 'cat_propose_translations'), {
        segmentProposals: [{
          segmentId: fixture.segmentsA[2]!.id,
          baseRevision: 0,
          proposedTarget: '同一 toolCall 的冲突 payload 2',
        }],
      }),
      StoreIdempotencyConflictError,
    )
    assert.equal(fixture.db.proposals.listPending().length, 2)

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
    }, 'call-unregistered-tag')
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
      }, 'call-profiled-tag'),
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

test('cat_get_translation_context: input order, revision, neighbors, TM/TB evidence, and read-only semantics', async () => {
  const fixture = setup()
  try {
    fixture.db.tmUnits.importMany([{
      source: fixture.segmentsA[2]!.source,
      target: 'TM 译文',
      sourceLocale: 'en',
      targetLocale: 'zh-CN',
      origin: 'approved',
    }])
    fixture.db.termEntries.importMany([
      {
        term: 'source',
        translation: '来源',
        status: 'preferred',
        caseSensitive: false,
      },
      {
        term: 'source',
        translation: '源文',
        status: 'required',
        caseSensitive: false,
      },
    ])
    fixture.db.segments.applyTargetEdit(fixture.segmentsA[2]!.id, '人工译文', 0)
    const before = fixture.db.segments.getByIds([
      fixture.segmentsA[2]!.id,
      fixture.segmentsA[0]!.id,
    ])
    const sqlite = fixture.db.catDb.db
    const prepare = sqlite.prepare.bind(sqlite)
    let contextQueries = 0
    sqlite.prepare = ((sql: string) => {
      const statement = prepare(sql)
      if (![
        'SELECT * FROM segments WHERE id IN',
        'WITH requested',
        'SELECT * FROM tm_units WHERE project_id = ? AND source_locale',
        'SELECT * FROM term_entries WHERE project_id = ?',
      ].some((needle) => sql.includes(needle))) return statement
      return new Proxy(statement, {
        get(target, property) {
          const value = Reflect.get(target, property, target)
          if (property !== 'all') return typeof value === 'function' ? value.bind(target) : value
          return (...args: unknown[]) => {
            contextQueries += 1
            return Reflect.apply(value as (...values: unknown[]) => unknown, target, args)
          }
        },
      })
    }) as typeof sqlite.prepare
    const tools = createLinguistCatTools({ resolveProject: makeOkResolver(fixture) })
    const result = await invoke(toolByName(tools, 'cat_get_translation_context'), {
      segmentIds: [fixture.segmentsA[2]!.id, fixture.segmentsA[0]!.id],
      includeNeighbors: true,
      neighborCount: 1,
      tmLimitPerSegment: 2,
      termLimitPerSegment: 2,
      maxBytes: 32_000,
    })
    const dto = result.details as {
      contexts: Array<{
        segmentId: string
        revision: number
        previous: Array<{ segmentId: string }>
        next: Array<{ segmentId: string }>
        requiredTerms: Array<{ id: string }>
        preferredTerms: Array<{ id: string }>
        tmMatches: Array<{ id: string }>
        evidence: Array<{ id: string; kind: string }>
      }>
      truncated: boolean
      nextCursor?: string
    }

    assert.deepEqual(
      dto.contexts.map((context) => context.segmentId),
      [fixture.segmentsA[2]!.id, fixture.segmentsA[0]!.id],
    )
    assert.deepEqual(dto.contexts.map((context) => context.revision), [1, 0])
    assert.deepEqual(dto.contexts[0]!.previous.map((item) => item.segmentId), [
      fixture.segmentsA[1]!.id,
    ])
    assert.deepEqual(dto.contexts[0]!.next.map((item) => item.segmentId), [
      fixture.segmentsA[3]!.id,
    ])
    assert.equal(dto.contexts[0]!.requiredTerms.length, 1)
    assert.equal(dto.contexts[0]!.preferredTerms.length, 1)
    assert.equal(dto.contexts[0]!.tmMatches.length, 1)
    assert.ok(dto.contexts[0]!.evidence.some((item) => item.kind === 'segment-revision'))
    assert.ok(dto.contexts[0]!.evidence.some((item) => item.kind === 'term'))
    assert.ok(dto.contexts[0]!.evidence.some((item) => item.kind === 'tm'))
    assert.equal(dto.truncated, false)
    assert.equal(dto.nextCursor, undefined)
    assert.equal(contextQueries, 4, '2 segments still use one bulk query per data family')
    assert.deepEqual(
      fixture.db.segments.getByIds(before.map((segment) => segment.id)),
      before,
      'context reads must not mutate Segment rows',
    )
  } finally {
    fixture.db.close()
  }
})

test('cat_get_translation_context: enforces 50-item and UTF-8 byte budgets with resumable truncation', async () => {
  const fixture = setup()
  try {
    const tools = createLinguistCatTools({ resolveProject: makeOkResolver(fixture) })
    const tool = toolByName(tools, 'cat_get_translation_context')
    await assertThrowsCode(
      invoke(tool, {
        segmentIds: Array.from({ length: 51 }, () => fixture.segmentsA[0]!.id),
      }),
      'INVALID_ARGUMENT',
    )

    const segmentIds = fixture.segmentsA.slice(0, 8).map((segment) => segment.id as string)
    const first = await invoke(tool, {
      segmentIds,
      includeNeighbors: false,
      tmLimitPerSegment: 0,
      termLimitPerSegment: 0,
      maxBytes: 1_800,
    })
    const firstPage = first.details as {
      contexts: Array<{ segmentId: string; source: string }>
      cursor: string | null
      truncated: boolean
      nextCursor?: string
      suggestedSegmentIds?: string[]
      maxBytes: number
      usedBytes: number
    }
    assert.equal(firstPage.cursor, null)
    assert.equal(firstPage.truncated, true)
    assert.ok(firstPage.contexts.length > 0 && firstPage.contexts.length < segmentIds.length)
    // LA-CONTEXT-001：v2 cursor 绑定请求形状 + 事件快照（无事件时为 0）+ 偏移
    assert.match(firstPage.nextCursor ?? '', /^ctx2-[0-9a-f]{16}-0-\d+$/)
    assert.deepEqual(
      firstPage.suggestedSegmentIds,
      segmentIds.slice(firstPage.contexts.length),
    )
    // LA-CONTEXT-002：返回页每段 source 永不空、永不半截
    for (const context of firstPage.contexts) {
      assert.ok(context.source.length > 0, 'returned page sources must never be empty')
    }
    assert.ok(firstPage.usedBytes <= firstPage.maxBytes)
    assert.ok(Buffer.byteLength(JSON.stringify(firstPage), 'utf8') <= firstPage.maxBytes)
    assert.ok(resultText(first).length < 500)
    assert.notEqual(resultText(first), JSON.stringify(firstPage, null, 2))

    const second = (await invoke(tool, {
      segmentIds,
      includeNeighbors: false,
      tmLimitPerSegment: 0,
      termLimitPerSegment: 0,
      maxBytes: 32_000,
      cursor: firstPage.nextCursor,
    })).details as { contexts: Array<{ segmentId: string; source: string }>; truncated: boolean }
    assert.deepEqual(
      second.contexts.map((context) => context.segmentId),
      segmentIds.slice(firstPage.contexts.length),
    )
    assert.equal(second.truncated, false)
    for (const context of second.contexts) {
      assert.ok(context.source.length > 0, 'returned page sources must never be empty')
    }
    await assertThrowsCode(invoke(tool, {
      segmentIds: [...segmentIds].reverse(),
      includeNeighbors: false,
      tmLimitPerSegment: 0,
      termLimitPerSegment: 0,
      maxBytes: 32_000,
      cursor: firstPage.nextCursor,
    }), 'INVALID_ARGUMENT')
    await assertThrowsCode(invoke(tool, {
      segmentIds,
      includeNeighbors: false,
      tmLimitPerSegment: 0,
      termLimitPerSegment: 0,
      maxBytes: 32_000,
      cursor: String(firstPage.contexts.length),
    }), 'INVALID_ARGUMENT')

    const boundedTool = toolByName(createLinguistCatTools({
      resolveProject: makeOkResolver(fixture),
      resultProjectId: fixture.project.id as string,
    }), 'cat_get_translation_context')
    // LA-CONTEXT-002：预算放不下第一段最小核心 → 空页 + minimumRequiredBytes，cursor 不推进
    const { segments: longSegments } = seedAsset(fixture.db, fixture.project, {
      filename: 'long.tsv',
      sha: 'c'.repeat(64),
      count: 1,
      sourcePrefix: '长'.repeat(400),
    })
    const minimumResult = await invoke(boundedTool, {
      segmentIds: [longSegments[0]!.id],
      includeNeighbors: false,
      tmLimitPerSegment: 0,
      termLimitPerSegment: 0,
      maxBytes: 1_024,
    })
    const minimumBudget = minimumResult.details as {
      contexts: unknown[]
      cursor: string | null
      truncated: boolean
      nextCursor?: string
      minimumRequiredBytes?: number
      usedBytes: number
      maxBytes: number
    }
    assert.deepEqual(minimumBudget.contexts, [])
    assert.equal(minimumBudget.cursor, null)
    assert.equal(minimumBudget.truncated, true)
    assert.equal(minimumBudget.nextCursor, undefined, '预算不足的空页不得推进 cursor')
    assert.ok(
      minimumBudget.minimumRequiredBytes !== undefined
        && minimumBudget.minimumRequiredBytes > minimumBudget.maxBytes,
      'minimumRequiredBytes 必须超过当前预算',
    )
    assert.ok(minimumBudget.usedBytes <= minimumBudget.maxBytes)
    assert.ok(Buffer.byteLength(JSON.stringify(minimumResult.details), 'utf8') <= 1_024)
  } finally {
    fixture.db.close()
  }
})

test('cat_get_translation_context: cursor binds the project event snapshot (LA-CONTEXT-001)', async () => {
  const fixture = setup()
  try {
    const tools = createLinguistCatTools({ resolveProject: makeOkResolver(fixture) })
    const contextTool = toolByName(tools, 'cat_get_translation_context')
    const segmentIds = fixture.segmentsA.map((segment) => segment.id as string)
    const pageParams = {
      segmentIds,
      includeNeighbors: false,
      tmLimitPerSegment: 0,
      termLimitPerSegment: 0,
      maxBytes: 1_800,
    }
    assert.equal(fixture.db.runs.latestEventSequence, 0)
    const first = (await invoke(contextTool, pageParams)).details as {
      contexts: Array<{ segmentId: string }>
      nextCursor?: string
    }
    assert.ok(first.nextCursor !== undefined)
    // 快照未变：第二页正常返回
    const second = (await invoke(contextTool, {
      ...pageParams,
      maxBytes: 32_000,
      cursor: first.nextCursor,
    })).details as { contexts: unknown[] }
    assert.ok(second.contexts.length > 0)
    // 旧格式 cursor 一律 INVALID_ARGUMENT
    const [, hash, , offset] = first.nextCursor.split('-')
    await assertThrowsCode(
      invoke(contextTool, { ...pageParams, cursor: `ctx-${hash}-${offset}` }),
      'INVALID_ARGUMENT',
    )
    // 产生 project event 的 mutation（proposal-created）后，旧 cursor 报 CONTEXT_DRIFT
    // 译文须保留 source 的数字签名（hard rules）
    await invoke(toolByName(tools, 'cat_propose_translations'), {
      segmentProposals: [{
        segmentId: fixture.segmentsA[0]!.id,
        baseRevision: 0,
        proposedTarget: '漂移译文 0',
      }],
    })
    assert.equal(fixture.db.runs.latestEventSequence, 1)
    await assertThrowsCode(
      invoke(contextTool, { ...pageParams, maxBytes: 32_000, cursor: first.nextCursor }),
      'CONTEXT_DRIFT',
    )
    // 从第一页重拉：新 cursor 绑定新事件快照，可继续翻页
    const restarted = (await invoke(contextTool, pageParams)).details as {
      nextCursor?: string
    }
    assert.match(restarted.nextCursor ?? '', /^ctx2-[0-9a-f]{16}-1-\d+$/)
    const resumed = (await invoke(contextTool, {
      ...pageParams,
      maxBytes: 32_000,
      cursor: restarted.nextCursor,
    })).details as { contexts: unknown[] }
    assert.ok(resumed.contexts.length > 0)
  } finally {
    fixture.db.close()
  }
})

test('cat_get_translation_context: public human and TM/TB commits invalidate a paged cursor (LA-CONTEXT-001)', async () => {
  const fixture = setup()
  try {
    const tools = createLinguistCatTools({ resolveProject: makeOkResolver(fixture) })
    const contextTool = toolByName(tools, 'cat_get_translation_context')
    const pageParams = {
      segmentIds: fixture.segmentsA.map((segment) => segment.id as string),
      includeNeighbors: false,
      tmLimitPerSegment: 0,
      termLimitPerSegment: 0,
      maxBytes: 1_800,
    }
    const firstCursor = async (): Promise<string> => {
      const page = (await invoke(contextTool, pageParams)).details as { nextCursor?: string }
      assert.ok(page.nextCursor !== undefined)
      return page.nextCursor
    }
    const assertDriftAfter = async (mutate: () => void): Promise<void> => {
      const cursor = await firstCursor()
      const before = fixture.db.runs.latestEventSequence
      mutate()
      assert.equal(fixture.db.runs.latestEventSequence, before + 1)
      await assertThrowsCode(
        invoke(contextTool, { ...pageParams, maxBytes: 32_000, cursor }),
        'CONTEXT_DRIFT',
      )
    }

    await assertDriftAfter(() => fixture.db.segments.applyTargetEdit(
      fixture.segmentsA[0]!.id,
      '人工提交译文',
      0,
    ))
    await assertDriftAfter(() => {
      fixture.db.tmUnits.importMany([{
        source: 'Alpha source 1',
        target: '阿尔法源文 1',
        sourceLocale: 'en',
        targetLocale: 'zh-CN',
      }])
    })
    await assertDriftAfter(() => {
      fixture.db.termEntries.importMany([{
        term: 'Alpha',
        translation: '阿尔法',
        status: 'preferred',
        caseSensitive: false,
      }])
    })

    const tm = fixture.db.tmUnits.list({ limit: 1 })[0]!
    await assertDriftAfter(() => fixture.db.tmUnits.delete(tm.id))

    const term = fixture.db.termEntries.upsert({
      term: 'Beta',
      translation: '贝塔',
      status: 'allowed',
      caseSensitive: false,
    })
    await assertDriftAfter(() => fixture.db.termEntries.upsert({
      ...term,
      translation: '贝塔修订',
    }))
    await assertDriftAfter(() => fixture.db.termEntries.delete(term.id))

    const rule = fixture.db.styleGuideRules.upsert({ ruleText: '使用全角标点' })
    await assertDriftAfter(() => fixture.db.styleGuideRules.upsert({
      id: rule.id,
      ruleText: '使用全角标点，句末加句号',
    }))
    await assertDriftAfter(() => fixture.db.styleGuideRules.delete(rule.id))
  } finally {
    fixture.db.close()
  }
})

test('cat_get_translation_context: includeProjectRules injects bounded rules on the first page only (LA-CONTEXT-001)', async () => {
  const fixture = setup()
  try {
    for (let index = 0; index < 25; index += 1) {
      fixture.db.styleGuideRules.upsert({
        groupKey: index % 2 === 0 ? '标点' : '用词',
        ruleText: `规则 ${index}：示例文本`,
      })
    }
    const tools = createLinguistCatTools({ resolveProject: makeOkResolver(fixture) })
    const tool = toolByName(tools, 'cat_get_translation_context')
    const segmentIds = fixture.segmentsA.map((segment) => segment.id as string)
    const params = {
      segmentIds,
      includeProjectRules: true,
      includeNeighbors: false,
      tmLimitPerSegment: 0,
      termLimitPerSegment: 0,
    }
    const first = (await invoke(tool, { ...params, maxBytes: 6_000 })).details as {
      contexts: Array<{ segmentId: string; source: string }>
      truncated: boolean
      nextCursor?: string
      projectRules?: Array<{ ruleId: string; groupKey?: string; ruleText: string }>
    }
    // 有界注入：25 条规则只返回上限 20 条，且为结构化条目
    assert.equal(first.projectRules?.length, 20)
    for (const rule of first.projectRules ?? []) {
      assert.ok(rule.ruleId.startsWith('sgr_v2_'))
      assert.ok(rule.ruleText.length > 0)
    }
    assert.ok(first.projectRules!.some((rule) => rule.groupKey === '标点'))
    assert.equal(first.truncated, true)
    assert.ok(first.nextCursor !== undefined)
    assert.ok(first.contexts.length > 0)
    for (const context of first.contexts) {
      assert.ok(context.source.length > 0, 'returned page sources must never be empty')
    }
    // 第二页不再携带规则
    const second = (await invoke(tool, {
      ...params,
      maxBytes: 32_000,
      cursor: first.nextCursor,
    })).details as { contexts: unknown[]; projectRules?: unknown[] }
    assert.equal(second.projectRules, undefined)
    assert.ok(second.contexts.length > 0)
    // 未显式开启则不注入
    const withoutRules = (await invoke(tool, {
      segmentIds: segmentIds.slice(0, 1),
      includeNeighbors: false,
      tmLimitPerSegment: 0,
      termLimitPerSegment: 0,
      maxBytes: 32_000,
    })).details as { projectRules?: unknown[] }
    assert.equal(withoutRules.projectRules, undefined)
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
      cat_list_intake_sources: {},
      cat_import_asset: { sourceToken: 'attached-file:missing' },
      cat_get_translation_context: { segmentIds: [fixture.segmentsA[0]!.id] },
      cat_get_proposal_snapshot: { proposalId: 'prp-0000000000000000' },
      cat_search_tm: { query: 'x' },
      cat_search_terms: { query: 'x' },
      cat_propose_translations: {
        segmentProposals: [{ segmentId: fixture.segmentsA[0]!.id, baseRevision: 0, proposedTarget: 'x' }],
      },
      cat_run_qa: {},
      cat_get_qa_findings: {},
      cat_submit_critic_review: {
        snapshotId: 'psn:prp-0000000000000000',
        snapshotHash: '0'.repeat(64),
        verdict: 'issues',
        summary: 'x',
        findings: [{
          category: 'fidelity',
          severity: 'L2',
          issueType: 'omission',
          evidenceRefs: ['tm:x'],
          explanation: 'x',
        }],
      },
      cat_plan_consistency_repairs: {},
      cat_create_consistency_proposals: {
        planId: 'csp-0000000000000000',
        selections: [{
          groupId: 'csg-0000000000000000',
          proposedTarget: 'x',
          segmentIds: [fixture.segmentsA[0]!.id],
        }],
      },
      cat_search_sentence_patterns: {},
      cat_read_context_doc: { docId: 'ctx-0000000000000000' },
      cat_begin_translation_scope: { segmentIds: [fixture.segmentsA[0]!.id] },
      cat_finalize_translation_scope: { scopeJobId: 'job-0000000000000000' },
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
        assert.ok(resultText(result).length < 500)
        assert.notEqual(resultText(result), JSON.stringify(result.details, null, 2))
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
  reviewId: string
  artifactId: string
  verdict: 'pass' | 'issues' | 'abstain'
  findingIds: string[]
  qaFindingIds: string[]
  repairScope?: { authority: string; canCommit: boolean; segmentIds: string[]; findingIds: string[] }
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
  return (result.details as { proposalIds: string[] }).proposalIds[0]!
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

async function reviewSnapshotInput(
  tools: ReturnType<typeof createLinguistCatTools>,
  proposalId: string,
) {
  const snapshot = (await invoke(toolByName(tools, 'cat_get_proposal_snapshot'), {
    proposalId,
  })).details as { snapshotId: string; snapshotHash: string }
  return {
    snapshotId: snapshot.snapshotId,
    snapshotHash: snapshot.snapshotHash,
  }
}

test('cat_get_proposal_snapshot: fixed candidate/context/provenance hash becomes stale after revision change', async () => {
  const fixture = setup()
  try {
    const segment = fixture.segmentsA[2]!
    const proposalId = await proposeAsCandidate(
      fixture,
      segment.id,
      'sess-candidate',
      `候选 ${segment.source}`,
    )
    const tools = createLinguistCatTools({ resolveProject: makeOkResolver(fixture) })
    const before = fixture.db.segments.getById(segment.id)
    const first = (await invoke(toolByName(tools, 'cat_get_proposal_snapshot'), {
      proposalId,
    })).details as {
      snapshotId: string
      snapshotHash: string
      proposalId: string
      status: string
      segmentId: string
      source: string
      currentTarget: string
      proposedTarget: string
      currentRevision: number
      baseRevision: number
      context: {
        previous: Array<{ segmentId: string }>
        next: Array<{ segmentId: string }>
      }
      evidence: Array<{ id: string; kind: string }>
      issuanceCount: number
      issuances: Array<{ id: string; sessionId?: string }>
      producer: { id: string; sessionId?: string; runId?: string; modelId?: string }
    }
    assert.match(first.snapshotId, /^psn:/)
    assert.match(first.snapshotHash, /^[a-f0-9]{64}$/)
    assert.equal(first.proposalId, proposalId)
    assert.equal(first.status, 'pending')
    assert.equal(first.segmentId, segment.id)
    assert.equal(first.source, segment.source)
    assert.equal(first.currentTarget, segment.target)
    assert.equal(first.proposedTarget, `候选 ${segment.source}`)
    assert.equal(first.currentRevision, 0)
    assert.equal(first.baseRevision, 0)
    assert.deepEqual(first.context.previous.map((item) => item.segmentId), [
      fixture.segmentsA[1]!.id,
    ])
    assert.deepEqual(first.context.next.map((item) => item.segmentId), [
      fixture.segmentsA[3]!.id,
    ])
    assert.ok(first.evidence.some((item) => item.kind === 'segment-revision'))
    assert.equal(first.issuanceCount, 1)
    assert.match(first.issuances[0]?.id ?? '', /^pis_v2_[a-f0-9]{64}$/)
    assert.equal(first.producer.sessionId, 'sess-candidate')
    assert.deepEqual(fixture.db.segments.getById(segment.id), before)

    fixture.db.segments.applyTargetEdit(segment.id, '人工新译文', 0)
    const stale = (await invoke(toolByName(tools, 'cat_get_proposal_snapshot'), {
      proposalId,
    })).details as typeof first
    assert.equal(stale.snapshotId, first.snapshotId)
    assert.notEqual(stale.snapshotHash, first.snapshotHash)
    assert.equal(stale.status, 'stale')
    assert.equal(stale.currentRevision, 1)
  } finally {
    fixture.db.close()
  }
})

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

test('cat_submit_critic_review: pass persists snapshot-bound reviewer provenance without fake QA findings', async () => {
  const fixture = setup()
  try {
    const segment = fixture.segmentsA[0]!
    const proposalId = await proposeAsCandidate(fixture, segment.id, 'sess-candidate')
    const reviewerTools = createLinguistCatTools({
      resolveProject: makeOkResolver(fixture),
      sessionId: 'sess-reviewer',
      modelId: 'review-model',
      criticSkillBytes: () => 'reviewer-prompt-v2',
      generationProvenance: (toolCallId) => ({
        sessionId: 'sess-reviewer',
        runId: 'review-run',
        toolCallId,
        modelProvider: 'anthropic',
        modelId: 'review-model',
        runtime: 'claude',
        role: 'reviewer',
        linguistPromptVersion: '2.0.0',
        promptHash: '1'.repeat(64),
        projectDigestHash: '2'.repeat(64),
        projectDigestRevision: 'project-r1',
        turnContextVersion: 1,
        turnContextSnapshot: '{"activeSegmentId":"seg-1"}',
        turnContextHash: '3'.repeat(64),
        toolsetHash: '4'.repeat(64),
      }),
    })
    const snapshot = (await invoke(
      toolByName(reviewerTools, 'cat_get_proposal_snapshot'),
      { proposalId },
    )).details as { snapshotId: string; snapshotHash: string }
    const result = await invoke(toolByName(reviewerTools, 'cat_submit_critic_review'), {
      snapshotId: snapshot.snapshotId,
      snapshotHash: snapshot.snapshotHash,
      verdict: 'pass',
      summary: '未发现实质问题。',
      findings: [],
    })
    const dto = result.details as {
      reviewId: string
      artifactId: string
      verdict: string
      findingIds: string[]
      qaFindingIds: string[]
    }
    assert.equal(dto.reviewId, dto.artifactId)
    assert.equal(dto.verdict, 'pass')
    assert.deepEqual(dto.findingIds, [])
    assert.deepEqual(dto.qaFindingIds, [])
    const artifact = fixture.db.criticArtifacts.getById(dto.reviewId) as unknown as {
      schemaVersion: number
      verdict: string
      snapshot: { snapshotId: string; snapshotHash: string; proposalId: string }
      reviewer: {
        sessionId: string
        modelId?: string
        promptVersion: string
        generation?: { runId?: string; toolsetHash?: string }
      }
    }
    assert.equal(artifact.schemaVersion, 2)
    assert.equal(artifact.verdict, 'pass')
    assert.deepEqual(artifact.snapshot, {
      snapshotId: snapshot.snapshotId,
      snapshotHash: snapshot.snapshotHash,
      proposalId,
    })
    assert.equal(artifact.reviewer.sessionId, 'sess-reviewer')
    assert.equal(artifact.reviewer.modelId, 'review-model')
    assert.match(artifact.reviewer.promptVersion, /^[a-f0-9]{64}$/)
    assert.equal(artifact.reviewer.generation?.runId, 'review-run')
    assert.equal(artifact.reviewer.generation?.toolsetHash, '4'.repeat(64))
    assert.equal(fixture.db.qaFindings.list({ segmentId: segment.id }).length, 0)
    assert.equal(fixture.db.proposals.getById(proposalId)?.status, 'pending')
    assert.equal(fixture.db.segments.getById(segment.id)?.revision, segment.revision)
  } finally {
    fixture.db.close()
  }
})

test('cat_submit_critic_review: abstain persists reason; stale snapshot is rejected without writes', async () => {
  const fixture = setup()
  try {
    const abstainProposalId = await proposeAsCandidate(
      fixture,
      fixture.segmentsA[0]!.id,
      'sess-candidate-abstain',
    )
    const reviewerTools = makeCriticTools(fixture, 'sess-reviewer-abstain')
    const abstainSnapshot = await reviewSnapshotInput(reviewerTools, abstainProposalId)
    const abstain = (await invoke(toolByName(reviewerTools, 'cat_submit_critic_review'), {
      ...abstainSnapshot,
      verdict: 'abstain',
      reason: '缺少角色语气资料，无法可靠判断。',
      findings: [],
    })).details as CriticReviewDto
    assert.equal(abstain.verdict, 'abstain')
    assert.deepEqual(abstain.findingIds, [])
    assert.deepEqual(abstain.qaFindingIds, [])
    const artifact = fixture.db.criticArtifacts.getById(abstain.reviewId)
    assert.equal(artifact?.schemaVersion, 2)
    if (artifact?.schemaVersion !== 2) assert.fail('expected review artifact v2')
    assert.equal(artifact.reason, '缺少角色语气资料，无法可靠判断。')

    const staleProposalId = await proposeAsCandidate(
      fixture,
      fixture.segmentsA[1]!.id,
      'sess-candidate-stale',
    )
    const staleSnapshot = await reviewSnapshotInput(reviewerTools, staleProposalId)
    fixture.db.segments.applyTargetEdit(fixture.segmentsA[1]!.id, '人工改稿', 0)
    const before = fixture.db.criticArtifacts.listBySegment(fixture.segmentsA[1]!.id).length
    await assert.rejects(
      invoke(toolByName(reviewerTools, 'cat_submit_critic_review'), {
        ...staleSnapshot,
        verdict: 'pass',
        findings: [],
      }, 'call-stale-review'),
      (error: unknown) =>
        (error as { code?: string }).code === 'STALE_PROPOSAL',
    )
    assert.equal(
      fixture.db.criticArtifacts.listBySegment(fixture.segmentsA[1]!.id).length,
      before,
    )
  } finally {
    fixture.db.close()
  }
})

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
    const snapshot = await reviewSnapshotInput(tools, proposalId)

    const result = await invoke(toolByName(tools, 'cat_submit_critic_review'), {
      ...snapshot,
      verdict: 'issues',
      summary: '发现两项需要人工复核的问题。',
      findings: REVIEW_FINDINGS,
    })
    const dto = result.details as CriticReviewDto

    // 返回形状：advisory 范围，canCommit 烧死 false
    assert.match(dto.artifactId, /^critic_v2_[0-9a-f]{64}$/)
    assert.equal(dto.findingIds.length, 2)
    assert.ok(dto.findingIds.every((id) => /^cf_v2_[0-9a-f]{64}$/.test(id)))
    assert.equal(dto.qaFindingIds.length, 2)
    assert.ok(dto.qaFindingIds.every((id) => /^qaf_v2_[0-9a-f]{64}$/.test(id)))
    assert.equal(dto.reviewId, dto.artifactId)
    assert.equal(dto.verdict, 'issues')
    assert.equal(dto.repairScope?.authority, 'advisory_finding')
    assert.equal(dto.repairScope?.canCommit, false)
    assert.deepEqual(dto.repairScope?.segmentIds, [seg.id])
    assert.deepEqual(dto.repairScope?.findingIds, [...dto.findingIds].sort())

    // artifact 落库：身份/哈希全部由运行时派生
    const artifact = fixture.db.criticArtifacts.getById(dto.artifactId)
    assert.ok(artifact)
    assert.equal(artifact.schemaVersion, 2)
    if (artifact.schemaVersion !== 2) assert.fail('expected review artifact v2')
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
    assert.equal(artifact.reviewer.criticId, 'session:sess-critic')
    assert.equal(artifact.reviewer.executionId, 'sess-critic')
    // 未注入 skill 字节 → 回退档案哈希
    assert.equal(artifact.reviewer.profileHash, independentCriticProfileHash('linguist-critic-profile:v1'))

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
      sequence: 2,
      segmentIds: [seg.id as string],
      proposalIds: [proposalId],
      qaFindingIds: dto.qaFindingIds,
    }])
    assert.deepEqual(
      qaRows.map((row) => row.id).sort(),
      [...dto.qaFindingIds].sort(),
    )
    assert.equal(qaRows.find((row) => row.code === 'CRITIC_FIDELITY')?.message, '译文漏译了源文第二分句。')
    assert.ok(qaRows.every((row) =>
      fixture.db.criticArtifacts.traceByQaFindingId(row.id as string).length === 1))
    const qaToolResult = (await invoke(toolByName(tools, 'cat_get_qa_findings'), {
      status: 'open',
    })).details as {
      items: Array<{
        id: string
        criticReviews?: Array<{
          reviewId: string
          criticFindingId: string
          proposalId: string
          snapshotId: string
          reviewerSessionId: string
        }>
      }>
    }
    const linked = qaToolResult.items.filter((item) => dto.qaFindingIds.includes(item.id))
    assert.equal(linked.length, 2)
    assert.ok(linked.every((item) => item.criticReviews?.[0]?.reviewId === dto.reviewId))
    assert.ok(linked.every((item) => item.criticReviews?.[0]?.proposalId === proposalId))
    assert.ok(linked.every((item) => item.criticReviews?.[0]?.snapshotId === snapshot.snapshotId))
    assert.ok(linked.every((item) => item.criticReviews?.[0]?.reviewerSessionId === 'sess-critic'))

    // 段与提案不被触碰
    const segmentAfter = fixture.db.segments.getById(seg.id)
    assert.equal(segmentAfter?.target, seg.target)
    assert.equal(segmentAfter?.revision, seg.revision)
    assert.equal(fixture.db.proposals.getById(proposalId)?.status, 'pending')

    // 幂等：同一评审重提 → 同 artifactId / qaFindingIds，不产生重复行
    const again = (
      await invoke(toolByName(tools, 'cat_submit_critic_review'), {
        ...snapshot,
        verdict: 'issues',
        summary: '发现两项需要人工复核的问题。',
        findings: REVIEW_FINDINGS,
      })
    ).details as CriticReviewDto
    assert.equal(again.artifactId, dto.artifactId)
    assert.deepEqual(again.qaFindingIds, dto.qaFindingIds)
    assert.equal(fixture.db.criticArtifacts.listBySegment(seg.id).length, 1)
    assert.equal(fixture.db.qaFindings.list({ segmentId: seg.id }).length, 2)
    assert.equal(mutations.length, 1, '幂等重提没有真实写入，不得生成伪 mutation')
    const summary = fixture.db.runs.getRunChangeSummary('critic-review:sess-critic:call-1')
    assert.equal(summary.changes.criticReviewsCreated, 1)
    assert.equal(summary.changes.qaFindingsCreated, 2)
    assert.equal(fixture.db.runs.listEvents().length, 2)
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
    const snapshot = await reviewSnapshotInput(tools, proposalId)
    await assert.rejects(
      invoke(toolByName(tools, 'cat_submit_critic_review'), {
        ...snapshot,
        verdict: 'issues',
        summary: '发现问题。',
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

test('cat_submit_critic_review: 提案不存在 / 跨项目 / snapshot hash 不匹配被拒', async () => {
  const fixture = setup()
  const other = setup()
  try {
    const seg = fixture.segmentsA[0]!
    const tools = makeCriticTools(fixture, 'sess-critic')

    // 不存在
    try {
      await invoke(toolByName(tools, 'cat_submit_critic_review'), {
        snapshotId: 'psn:prp-0000000000000000',
        snapshotHash: '0'.repeat(64),
        verdict: 'issues',
        summary: '发现问题。',
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
        snapshotId: `psn:${foreignProposalId}`,
        snapshotHash: '0'.repeat(64),
        verdict: 'issues',
        summary: '发现问题。',
        findings: [REVIEW_FINDINGS[0]],
      })
      assert.fail('must throw')
    } catch (err) {
      assert.equal((err as { code?: string }).code, 'STORE_NOT_FOUND')
    }

    // Snapshot hash 不匹配：即使 proposalId 有效也拒绝。
    const proposalId = await proposeAsCandidate(fixture, seg.id, 'sess-candidate')
    const snapshot = await reviewSnapshotInput(tools, proposalId)
    await assertThrowsCode(
      invoke(toolByName(tools, 'cat_submit_critic_review'), {
        ...snapshot,
        snapshotHash: 'f'.repeat(64),
        verdict: 'issues',
        summary: '发现问题。',
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
    const snapshot = await reviewSnapshotInput(tools, proposalId)

    await assert.rejects(
      invoke(toolByName(tools, 'cat_submit_critic_review'), {
        ...snapshot,
        verdict: 'issues',
        summary: '发现问题。',
        findings: [{ ...REVIEW_FINDINGS[0], evidenceRefs: ['tool_trace: call-9'] }],
      }),
      /must contain citable evidenceRefs, not audit-only trace\./,
    )
    await assertThrowsCode(
      invoke(toolByName(tools, 'cat_submit_critic_review'), {
        ...snapshot,
        verdict: 'issues',
        summary: '发现问题。',
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
    const snapshot = await reviewSnapshotInput(withSkill, proposalId)
    const dto = (
      await invoke(toolByName(withSkill, 'cat_submit_critic_review'), {
        ...snapshot,
        verdict: 'issues',
        summary: '发现问题。',
        findings: [REVIEW_FINDINGS[0]],
      })
    ).details as CriticReviewDto
    const artifact = fixture.db.criticArtifacts.getById(dto.artifactId)
    assert.equal(artifact?.schemaVersion, 2)
    if (artifact?.schemaVersion !== 2) assert.fail('expected review artifact v2')
    assert.equal(artifact.reviewer.profileHash, independentCriticProfileHash('skill-bytes-v1'))

    // 工厂未注入 sessionId → 评审身份无从派生，拒绝
    const noSession = createLinguistCatTools({ resolveProject: makeOkResolver(fixture) })
    await assertThrowsCode(
      invoke(toolByName(noSession, 'cat_submit_critic_review'), {
        ...snapshot,
        verdict: 'issues',
        summary: '发现问题。',
        findings: [REVIEW_FINDINGS[0]],
      }),
      'INVALID_ARGUMENT',
    )
  } finally {
    fixture.db.close()
  }
})

// ===== Phase L: consistency plan / apply =====

interface ConsistencyPlanDto {
  planId: string
  findingCount: number
  groupCount: number
  groups: Array<{
    groupId: string
    source: string
    segmentIds: string[]
    findingIds: string[]
    candidateTargets: Array<{ target: string; count: number; lockedCount: number }>
    findings: Array<{ findingId: string; segmentId: string; code: string; locked: boolean }>
  }>
  note?: string
}

interface ConsistencyApplyDto {
  planId: string
  runId: string
  proposalIds: string[]
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

test('cat_plan_consistency_repairs: 返回候选与快照 planId，绝不写库', async () => {
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

    const result = await invoke(toolByName(tools, 'cat_plan_consistency_repairs'), {})
    const dto = result.details as ConsistencyPlanDto

    assert.match(dto.planId, /^csp-[0-9a-f]{16}$/)
    assert.equal(dto.groupCount, 1)
    // 内存 runQa 对同 source 三段出 INCONSISTENT_REPEATED_SOURCE ×3，加库中 CRITIC_ 行
    assert.equal(dto.findingCount, 4)
    const group = dto.groups[0]!
    assert.match(group.groupId, /^csg-[0-9a-f]{16}$/)
    assert.equal(group.source, 'Save your work')
    assert.deepEqual(group.segmentIds, segs.map((seg) => seg.id as string))
    assert.deepEqual(group.candidateTargets, [
      { target: '保存你的工作', count: 2, lockedCount: 0 },
      { target: '储存你的工作', count: 1, lockedCount: 0 },
    ])
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
    assert.deepEqual(fixture.db.runs.listEvents(), [])
    assert.deepEqual(mutations, [])
    assertNoAbsolutePaths(result, fixture.rootDir)
  } finally {
    fixture.db.close()
  }
})

test('cat_create_consistency_proposals: 仅按显式选择建 Proposal，重复 apply 幂等', async () => {
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

    const plan = (
      await invoke(toolByName(tools, 'cat_plan_consistency_repairs'), {})
    ).details as ConsistencyPlanDto
    const group = plan.groups[0]!
    assert.equal(group.findings.find((finding) => finding.segmentId === segs[3]!.id)?.locked, true)
    assert.equal(fixture.db.proposals.count(), 0, 'plan 必须零写入')

    const selection = {
      planId: plan.planId,
      selections: [{
        groupId: group.groupId,
        proposedTarget: '保存你的工作',
        segmentIds: [segs[2]!.id as string],
      }],
    }
    const result = await invoke(toolByName(tools, 'cat_create_consistency_proposals'), selection)
    const dto = result.details as ConsistencyApplyDto
    assert.equal(dto.planId, plan.planId)
    assert.equal(dto.proposalIds.length, 1)
    const proposal = fixture.db.proposals.getById(dto.proposalIds[0]!)
    assert.ok(proposal)
    assert.equal(proposal.segmentId, segs[2]!.id)
    assert.equal(proposal.proposedTarget, '保存你的工作')
    assert.equal(proposal.baseRevision, 0)
    assert.equal(proposal.status, 'pending')
    assert.equal(proposal.modelId, 'fake-model')
    assert.equal(proposal.sessionId, 'session-1')
    assert.equal(proposal.createdAt, '2026-01-02T00:00:00.000Z')
    assert.ok(proposal.evidenceRefs.length > 0, 'evidenceRefs 应带该段的 finding ids 供人审追溯')

    assert.deepEqual(mutations, [{
      kind: 'proposal-created',
      sequence: 1,
      segmentIds: [segs[2]!.id as string],
      proposalIds: dto.proposalIds,
    }])

    // 段行绝不被工具改动（人审前）
    for (const seg of segs) {
      const after = fixture.db.segments.getById(seg.id)
      assert.equal(after?.target, seg.target)
      assert.equal(after?.revision, seg.revision)
    }

    // 同一 plan + 同一显式选择重放：内容派生 proposal id 幂等。
    const again = (
      await invoke(toolByName(tools, 'cat_create_consistency_proposals'), selection)
    ).details as ConsistencyApplyDto
    assert.deepEqual(again.proposalIds, dto.proposalIds)
    assert.equal(fixture.db.proposals.listPending().length, 1)
    assert.equal(mutations.length, 1, '幂等重跑没有真实写入，不得生成伪 mutation')
    assert.equal(fixture.db.runs.getRunChangeSummary(dto.runId!).changes.proposalsCreated, 1)
    assert.equal(fixture.db.runs.listEvents().length, 1)
    assertNoAbsolutePaths(result, fixture.rootDir)
  } finally {
    fixture.db.close()
  }
})

test('cat_create_consistency_proposals: stale plan、locked 与 hard gate 均 fail closed', async () => {
  const fixture = setup()
  try {
    const segs = seedConsistencyAsset(fixture, [
      { key: 'r0', source: 'Hello {name}', target: '你好 {name}' },
      { key: 'r1', source: 'Hello {name}', target: '您好 {name}' },
      { key: 'r2', source: 'Hello {name}', target: '哈喽 {name}', locked: true },
    ])
    fixture.db.qaFindings.insertOpen([
      { segmentId: segs[2]!.id, code: 'CRITIC_CONSISTENCY', severity: 'L2', message: '锁定段仅作上下文。' },
    ])
    const tools = createLinguistCatTools({ resolveProject: makeOkResolver(fixture) })
    const plan = (
      await invoke(toolByName(tools, 'cat_plan_consistency_repairs'), {})
    ).details as ConsistencyPlanDto
    const group = plan.groups[0]!

    await assertThrowsCode(invoke(toolByName(tools, 'cat_create_consistency_proposals'), {
      planId: plan.planId,
      selections: [{
        groupId: group.groupId,
        proposedTarget: '不能改锁定段 {name}',
        segmentIds: [segs[2]!.id],
      }],
    }), 'INVALID_ARGUMENT')

    await assertThrowsCode(invoke(toolByName(tools, 'cat_create_consistency_proposals'), {
      planId: plan.planId,
      selections: [{
        groupId: group.groupId,
        proposedTarget: '丢失占位符',
        segmentIds: [segs[1]!.id],
      }],
    }), 'INVALID_ARGUMENT')
    assert.equal(fixture.db.proposals.listPending().length, 0)

    fixture.db.segments.applyTargetEdit(segs[1]!.id, '人工更新 {name}', 0)
    await assertThrowsCode(invoke(toolByName(tools, 'cat_create_consistency_proposals'), {
      planId: plan.planId,
      selections: [{
        groupId: group.groupId,
        proposedTarget: '你好 {name}',
        segmentIds: [segs[1]!.id],
      }],
    }), 'INVALID_ARGUMENT')
    assert.equal(fixture.db.proposals.listPending().length, 0)
  } finally {
    fixture.db.close()
  }
})

test('cat_plan_consistency_repairs: 无一致性命中返回空 plan + note', async () => {
  const fixture = setup()
  try {
    const tools = createLinguistCatTools({ resolveProject: makeOkResolver(fixture) })
    const dto = (
      await invoke(toolByName(tools, 'cat_plan_consistency_repairs'), {})
    ).details as ConsistencyPlanDto
    assert.equal(dto.findingCount, 0)
    assert.equal(dto.groupCount, 0)
    assert.ok(dto.note)
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

test('QA worker adapter pauses on error and resumes the same durable Job after reopen', async () => {
  const fixture = setup()
  const segmentIds = fixture.segmentsA.slice(0, 3).map((segment) => segment.id as string)
  const progress: WorkerJobProgress[] = []
  let attempts = 0
  const base = {
    runId: 'qa-worker-recovery',
    sessionId: 'session-worker-recovery',
    segmentIds,
    onProgress: (update: WorkerJobProgress) => progress.push(update),
  }
  try {
    await assert.rejects(
      runQaWorkerJob({
        ...base,
        db: fixture.db,
        compute: async () => {
          attempts += 1
          throw new Error('worker crashed')
        },
        commit: () => 'unreachable',
      }),
      /worker crashed/,
    )
    assert.equal(
      fixture.db.runs.getJob(
        'job:qa:session-worker-recovery:qa-worker-recovery',
        { sessionId: base.sessionId },
      )?.status,
      'paused',
    )
    fixture.db.close()

    const reopened = fixture.store.openProject(fixture.project.id)
    reopened.segments.applyTargetEdit(segmentIds[2]!, '人工并行修订', 0)
    const result = await runQaWorkerJob({
      ...base,
      db: reopened,
      compute: async () => {
        attempts += 1
        return { result: 'worker-result' }
      },
      commit: (workerResult) => `committed:${workerResult}`,
    })
    const job = reopened.runs.getJob(
      'job:qa:session-worker-recovery:qa-worker-recovery',
      { sessionId: base.sessionId },
    )
    assert.equal(result, 'committed:worker-result')
    assert.equal(attempts, 2)
    assert.equal(job?.status, 'completed')
    assert.equal(job?.cursor, segmentIds.length)
    assert.deepEqual(job?.completedSegmentIds, segmentIds.slice(0, 2))
    assert.deepEqual(job?.failedSegmentIds, segmentIds.slice(2))
    assert.ok(progress.some((update) => update.status === 'paused'))
    assert.ok(progress.some((update) => update.status === 'completed'))
    reopened.close()
  } finally {
    try {
      fixture.db.close()
    } catch {
      // 已为 reopen 主动关闭。
    }
  }
})

test('consistency worker adapter persists advisory progress and rejects Proposal output', async () => {
  const fixture = setup()
  const segmentIds = fixture.segmentsA.slice(0, 2).map((segment) => segment.id as string)
  const base = {
    db: fixture.db,
    runId: 'consistency-plan-worker',
    sessionId: 'session-consistency-worker',
    segmentIds,
  }
  try {
    await assert.rejects(
      runConsistencyPlanWorkerJob({
        ...base,
        compute: async () => ({
          result: { planId: 'plan-invalid' },
          proposalIds: ['proposal-must-not-be-created'],
        }),
        commit: () => 'unreachable',
      }),
      /cannot create proposals/,
    )
    assert.equal(fixture.db.proposals.listPending().length, 0)

    let committedPlan: { planId: string } | undefined
    const result = await runConsistencyPlanWorkerJob({
      ...base,
      compute: async () => ({
        result: { planId: 'plan-advisory-1' },
        openItemIds: ['plan-advisory-1'],
      }),
      commit: (plan) => {
        committedPlan = plan
        return plan.planId
      },
    })
    const job = fixture.db.runs.getJob(
      'job:consistency-plan:session-consistency-worker:consistency-plan-worker',
      { sessionId: base.sessionId },
    )
    assert.equal(result, 'plan-advisory-1')
    assert.deepEqual(committedPlan, { planId: 'plan-advisory-1' })
    assert.deepEqual(job?.openItemIds, ['plan-advisory-1'])
    assert.equal(job?.status, 'completed')
    assert.equal(fixture.db.proposals.listPending().length, 0)
    assert.deepEqual(
      fixture.db.runs.listEvents(),
      [],
      'advisory consistency jobs persist recovery state without advancing the project outbox',
    )
  } finally {
    fixture.db.close()
  }
})

test('worker adapter cancellation is durable and never calls compute', async () => {
  const fixture = setup()
  const controller = new AbortController()
  controller.abort()
  let computed = false
  try {
    await assert.rejects(
      runQaWorkerJob({
        db: fixture.db,
        runId: 'qa-worker-cancelled',
        sessionId: 'session-worker-cancelled',
        segmentIds: fixture.segmentsA.slice(0, 1).map((segment) => segment.id as string),
        signal: controller.signal,
        compute: async () => {
          computed = true
          return { result: null }
        },
        commit: () => null,
      }),
      (error: unknown) => error instanceof Error && error.name === 'AbortError',
    )
    assert.equal(computed, false)
    assert.equal(
      fixture.db.runs.getJob(
        'job:qa:session-worker-cancelled:qa-worker-cancelled',
        { sessionId: 'session-worker-cancelled' },
      )?.status,
      'cancelled',
    )
  } finally {
    fixture.db.close()
  }
})
