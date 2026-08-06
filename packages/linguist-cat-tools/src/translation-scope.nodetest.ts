/**
 * LA-TRANS-001 Translation Scope / Coverage Ledger 行为测试。
 *
 * 与 tools.nodetest.ts 相同的驱动方式：真实 CatStore（mkdtemp 临时根，
 * node:sqlite —— 必须 node --test，不用 bun），resolver 为 fake。
 * 覆盖：begin 冻结与幂等、finalize 拒绝的精确计数、派生 failed
 * （锁定/过期段）、全部解释后落库 completed + project event、finalize
 * 幂等重放、explanation 冲突、跨会话 authority、归档/未绑定/缺项目
 * fail closed、scopeDigest 追踪与并行 scope 隔离（LA-CONTEXT-003）。
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
  type Asset,
  type EntropySource,
  type LinguistProject,
  type Segment,
} from '@linguist/cat-core'
import {
  CatStore,
  StoreAuthorityError,
  StoreJobStateError,
  StoreReadOnlyError,
  translationJobScopeDigest,
  type ProjectDatabase,
} from '@linguist/cat-store'
import { createLinguistCatTools } from './factory'
import {
  LinguistCatBindingMissingError,
  LinguistCatProjectMissingError,
  LinguistCatTranslationScopeIncompleteError,
  LINGUIST_CAT_TOOL_ERROR_CODES,
  type LinguistCatToolError,
} from './errors'
import {
  LINGUIST_CAT_TOOL_NAMES,
  type CatBeginTranslationScopeResult,
  type CatFinalizeTranslationScopeResult,
  type LinguistCatToolMutation,
  type ResolveLinguistCatProject,
} from './types'

// ===== fixtures（本地 testkit；仅依赖 cat-core，与 tools.nodetest.ts 同式）=====

function makeTempDir(): string {
  return mkdtempSync(join(tmpdir(), 'cat-scope-test-'))
}

/** 确定性递增时钟：2026-01-01T00:00:00.000Z + n 秒。 */
function makeClock(): () => string {
  let tick = 0
  return () => new Date(Date.UTC(2026, 0, 1, 0, 0, 0) + tick++ * 1000).toISOString()
}

function makeEntropy(seed = 'la-trans-001'): EntropySource {
  return createSeededEntropy(seed)
}

function seedAsset(
  db: ProjectDatabase,
  project: LinguistProject,
  options: { filename: string; sha: string; count: number; sourcePrefix: string },
): { asset: Asset; segments: Segment[] } {
  const asset = createAsset({
    projectId: project.id,
    formatId: 'fake_tsv',
    originalFilename: options.filename,
    sourceSha256: options.sha,
    segmentCount: options.count,
  })
  const segments: Segment[] = []
  for (let i = 0; i < options.count; i++) {
    segments.push({
      id: deriveSegmentId(asset.id, i, `key-${i}`),
      assetId: asset.id,
      ordinal: i,
      key: `key-${i}`,
      source: `${options.sourcePrefix} source ${i}`,
      target: '',
      sourceLocale: 'en',
      targetLocale: 'zh-CN',
      status: 'untranslated',
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
  segmentsA: Segment[]
}

function setup(segmentCount = 6): Fixture {
  const rootDir = makeTempDir()
  const store = new CatStore({ rootDir, entropy: makeEntropy(), now: makeClock() })
  const project = store.createProject({
    name: 'Scope 项目',
    sourceLocale: 'en',
    targetLocale: 'zh-CN',
    promaWorkspaceId: 'ws-1',
  })
  const db = store.openProject(project.id)
  const { asset: assetA, segments: segmentsA } = seedAsset(db, project, {
    filename: 'alpha.tsv',
    sha: 'a'.repeat(64),
    count: segmentCount,
    sourcePrefix: 'Alpha',
  })
  return { rootDir, store, project, db, assetA, segmentsA }
}

// ===== 调用辅助 =====

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

interface ScopeDeps {
  tools: LinguistCatTool[]
  mutations: LinguistCatToolMutation[]
}

function makeScopeTools(fixture: Fixture, sessionId = 'sess-scope'): ScopeDeps {
  const mutations: LinguistCatToolMutation[] = []
  const resolveProject: ResolveLinguistCatProject = () => ({
    project: fixture.project,
    db: fixture.db,
  })
  const tools = createLinguistCatTools({
    resolveProject,
    resultProjectId: fixture.project.id as string,
    sessionId,
    now: makeClock(),
    onMutation: (mutation) => mutations.push(mutation),
  })
  return { tools, mutations }
}

async function invokeBegin(
  deps: ScopeDeps,
  segmentIds: readonly string[],
  toolCallId = 'call-begin',
): Promise<CatBeginTranslationScopeResult> {
  const result = await invoke(toolByName(deps.tools, 'cat_begin_translation_scope'), {
    segmentIds,
  }, toolCallId)
  return result.details as CatBeginTranslationScopeResult
}

async function invokeFinalize(
  deps: ScopeDeps,
  scopeJobId: string,
  explanations: Array<{ segmentId: string; kind: 'skipped' | 'blocked'; reason: string }> = [],
  toolCallId = 'call-finalize',
): Promise<CatFinalizeTranslationScopeResult> {
  const result = await invoke(toolByName(deps.tools, 'cat_finalize_translation_scope'), {
    scopeJobId,
    explanations,
  }, toolCallId)
  return result.details as CatFinalizeTranslationScopeResult
}

async function propose(
  deps: ScopeDeps,
  segments: readonly Segment[],
  toolCallId: string,
): Promise<void> {
  // target 只含译文 + 序数：token/number signature 与 source（'Alpha source N'）一致才过硬规则。
  await invoke(toolByName(deps.tools, 'cat_propose_translations'), {
    segmentProposals: segments.map((segment) => ({
      segmentId: segment.id as string,
      baseRevision: segment.revision,
      proposedTarget: `译文 ${segment.ordinal}`,
    })),
  }, toolCallId)
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

/** plan §7.4：工具输出不得出现绝对文件系统路径。 */
function assertNoAbsolutePaths(value: unknown, rootDir: string): void {
  for (const text of collectStrings(value)) {
    assert.ok(!text.includes(rootDir), `output leaks the store root: ${text.slice(0, 120)}`)
    assert.ok(!text.includes(homedir()), `output leaks the user home: ${text.slice(0, 120)}`)
    assert.ok(!text.startsWith('/'), `output contains a POSIX-absolute-looking value: ${text.slice(0, 120)}`)
    assert.ok(!/^[A-Za-z]:[\\/]/.test(text), `output contains a Windows-path-looking value: ${text.slice(0, 120)}`)
  }
}

const SCOPE_INCOMPLETE = LINGUIST_CAT_TOOL_ERROR_CODES.TRANSLATION_SCOPE_INCOMPLETE
const INVALID_ARGUMENT = LINGUIST_CAT_TOOL_ERROR_CODES.INVALID_ARGUMENT
const BINDING_MISSING = LINGUIST_CAT_TOOL_ERROR_CODES.BINDING_MISSING
const PROJECT_MISSING = LINGUIST_CAT_TOOL_ERROR_CODES.PROJECT_MISSING

// ===== 注册与暴露面 =====

test('factory: standard 暴露 scope 工具且顺序与 LINGUIST_CAT_TOOL_NAMES 一致；independent-audit 不暴露', () => {
  const fixture = setup()
  try {
    const standard = createLinguistCatTools({
      resolveProject: () => ({ project: fixture.project, db: fixture.db }),
      sessionId: 'sess-scope',
    })
    assert.deepEqual(standard.map((tool) => tool.name), [...LINGUIST_CAT_TOOL_NAMES])
    assert.ok(LINGUIST_CAT_TOOL_NAMES.includes('cat_begin_translation_scope'))
    assert.ok(LINGUIST_CAT_TOOL_NAMES.includes('cat_finalize_translation_scope'))

    const audit = createLinguistCatTools({
      resolveProject: () => ({ project: fixture.project, db: fixture.db }),
      sessionId: 'sess-audit',
      sessionMode: 'independent-audit',
    })
    assert.ok(!audit.some((tool) => tool.name === 'cat_begin_translation_scope'))
    assert.ok(!audit.some((tool) => tool.name === 'cat_finalize_translation_scope'))
  } finally {
    fixture.db.close()
  }
})

// ===== begin：冻结、幂等与校验 =====

test('cat_begin_translation_scope: 冻结段 ID 与 baseRevision，provenance 标记 translation-scope', async () => {
  const fixture = setup()
  try {
    const deps = makeScopeTools(fixture)
    const scopeIds = fixture.segmentsA.slice(0, 4).map((segment) => segment.id as string)
    const dto = await invokeBegin(deps, scopeIds)
    assert.equal(dto.scopeJobId, 'job:translation-scope:sess-scope:call-begin')
    assert.equal(dto.runId, 'translation-scope:sess-scope:call-begin')
    assert.equal(dto.status, 'running')
    assert.equal(dto.requested, 4)
    assert.equal(dto.replayed, false)
    assert.equal((dto as unknown as { projectId?: string }).projectId, fixture.project.id as string)

    const job = fixture.db.runs.getJob(dto.scopeJobId, { sessionId: 'sess-scope' })
    assert.ok(job, 'scope job must be persisted')
    assert.deepEqual(job.segmentIds, scopeIds)
    // createJob 插入同事务快照每段 baseRevision（以 run-harness.ts createJob 现状代码为准）
    assert.deepEqual(job.baseRevisions, Object.fromEntries(scopeIds.map((id) => [id, 0])))
    // LA-CONTEXT-003：回执 digest 必须绑定持久化冻结快照（segmentIds + baseRevisions）
    assert.match(dto.scopeDigest, /^[a-f0-9]{64}$/)
    assert.equal(dto.scopeDigest, translationJobScopeDigest(job.segmentIds, job.baseRevisions))
    assert.equal(job.status, 'running')
    assert.equal(job.provenance.promptVersion, 'translation-scope-v1')
    assert.equal(
      (job.provenance as { kind?: string }).kind,
      'translation-scope',
      'provenance.kind must distinguish scope jobs from QA worker jobs',
    )
    assertNoAbsolutePaths(dto, fixture.rootDir)
  } finally {
    fixture.db.close()
  }
})

test('cat_begin_translation_scope: 同 toolCallId 同范围幂等重放；范围漂移与未知段 fail closed', async () => {
  const fixture = setup()
  try {
    const deps = makeScopeTools(fixture)
    const scopeIds = fixture.segmentsA.slice(0, 3).map((segment) => segment.id as string)
    const first = await invokeBegin(deps, scopeIds, 'call-x')
    const eventsAfterBegin = fixture.db.runs.listEvents().length

    const replay = await invokeBegin(deps, scopeIds, 'call-x')
    assert.equal(replay.replayed, true)
    assert.equal(replay.scopeJobId, first.scopeJobId)
    assert.equal(fixture.db.runs.listEvents().length, eventsAfterBegin, 'replay must not append events')

    await assert.rejects(
      invoke(toolByName(deps.tools, 'cat_begin_translation_scope'), {
        segmentIds: [...scopeIds, fixture.segmentsA[3]!.id as string],
      }, 'call-x'),
      StoreJobStateError,
    )
    await assert.rejects(
      invoke(toolByName(deps.tools, 'cat_begin_translation_scope'), {
        segmentIds: ['seg-0000000000000099'],
      }, 'call-y'),
      StoreJobStateError,
    )
    await assertThrowsCode(
      invoke(toolByName(deps.tools, 'cat_begin_translation_scope'), {
        segmentIds: [scopeIds[0], scopeIds[0]],
      }, 'call-z'),
      INVALID_ARGUMENT,
    )
  } finally {
    fixture.db.close()
  }
})

// ===== finalize：拒绝计数 → 补齐 → 成功落库 + 幂等重放 =====

test('cat_finalize_translation_scope: 部分提案被拒且计数精确；补齐后落库 completed 并幂等重放', async () => {
  const fixture = setup()
  try {
    const deps = makeScopeTools(fixture)
    const segments = fixture.segmentsA.slice(0, 5)
    const scopeIds = segments.map((segment) => segment.id as string)
    const begin = await invokeBegin(deps, scopeIds)

    // 只为前 2 段创建 pending Proposal；其余 3 段未解释
    await propose(deps, segments.slice(0, 2), 'call-propose-1')
    assert.equal(deps.mutations.length, 1, '提案本身有一次 proposal-created 通知')

    const refusal = await assertThrowsCode(
      invokeFinalize(deps, begin.scopeJobId),
      SCOPE_INCOMPLETE,
    )
    assert.ok(refusal instanceof LinguistCatTranslationScopeIncompleteError)
    assert.deepEqual(refusal.counts, {
      requested: 5,
      proposalCreated: 2,
      skipped: 0,
      blocked: 0,
      failed: 0,
      pending: 3,
    })
    assert.deepEqual(refusal.pendingSegmentIds, scopeIds.slice(2))
    assert.deepEqual(refusal.failedSegmentIds, [])
    const jobAfterRefusal = fixture.db.runs.getJob(begin.scopeJobId, { sessionId: 'sess-scope' })!
    assert.equal(jobAfterRefusal.status, 'running', '拒绝不得推进 job 状态')
    assert.equal(jobAfterRefusal.cursor, 0)
    assert.equal(deps.mutations.length, 1, '拒绝不得发出 mutation 通知')

    // 补齐：第 3 段提案，第 4/5 段分别 skipped / blocked（含 reason）
    await propose(deps, segments.slice(2, 3), 'call-propose-2')
    const finalized = await invokeFinalize(deps, begin.scopeJobId, [
      { segmentId: scopeIds[3]!, kind: 'skipped', reason: '段为纯数字，按项目规范不译' },
      { segmentId: scopeIds[4]!, kind: 'blocked', reason: '源文疑似缺词，等待客户澄清' },
    ])
    assert.equal(finalized.status, 'completed')
    assert.equal(finalized.replayed, false)
    assert.deepEqual(finalized.coverage, {
      requested: 5,
      proposalCreated: 3,
      skipped: 1,
      blocked: 1,
      failed: 0,
      pending: 0,
    })
    // LA-CONTEXT-003：finalize 回执 digest 与 begin 回执一致——同一冻结快照贯穿整个生命周期
    assert.equal(finalized.scopeDigest, begin.scopeDigest)

    // 落库真相：job completed + checkpoint 冻结覆盖 + openItemIds 记录解释
    const job = fixture.db.runs.getJob(begin.scopeJobId, { sessionId: 'sess-scope' })!
    assert.equal(job.status, 'completed')
    assert.equal(job.cursor, 5)
    assert.deepEqual(job.completedSegmentIds, scopeIds.slice(0, 3))
    // checkpoint 冻结顺序：skipped 段在前、blocked 段在后（各自按 scope 顺序）
    assert.deepEqual(job.failedSegmentIds, [scopeIds[3], scopeIds[4]])
    assert.deepEqual(job.openItemIds, [
      `translation-scope-skip:${scopeIds[3]}`,
      `translation-scope-blocked:${scopeIds[4]}`,
    ])
    assert.equal(job.proposalIds.length, 3)

    // project event：job-updated completed 已进入项目 outbox
    const completedEvent = fixture.db.runs.listEvents().find(
      (event) => event.kind === 'job-updated' && event.jobId === begin.scopeJobId
        && event.job?.status === 'completed',
    )
    assert.ok(completedEvent, 'finalize must append a job-updated completed project event')
    assert.deepEqual(deps.mutations.map((mutation) => mutation.kind), [
      'proposal-created',
      'proposal-created',
      'project-updated',
    ])
    assert.equal(deps.mutations[2]!.sequence, completedEvent.sequence)

    // 幂等重放：同参数再来一次，计数逐字节一致且无新事件/通知
    const eventsBeforeReplay = fixture.db.runs.listEvents().length
    const replayed = await invokeFinalize(deps, begin.scopeJobId, [
      { segmentId: scopeIds[3]!, kind: 'skipped', reason: '段为纯数字，按项目规范不译' },
      { segmentId: scopeIds[4]!, kind: 'blocked', reason: '源文疑似缺词，等待客户澄清' },
    ], 'call-finalize-replay')
    assert.equal(replayed.replayed, true)
    assert.deepEqual(replayed.coverage, finalized.coverage)
    assert.equal(replayed.scopeDigest, finalized.scopeDigest, 'replay must rebuild the same digest')
    assert.equal(fixture.db.runs.listEvents().length, eventsBeforeReplay, 'replay must not append events')
    assert.equal(deps.mutations.length, 3, 'replay must not notify again')
    assertNoAbsolutePaths(finalized, fixture.rootDir)
  } finally {
    fixture.db.close()
  }
})

test('cat_finalize_translation_scope: 锁定/过期段派生 failed；解释后按 blocked 落账', async () => {
  const fixture = setup()
  try {
    const deps = makeScopeTools(fixture)
    const segments = fixture.segmentsA.slice(0, 4)
    const scopeIds = segments.map((segment) => segment.id as string)
    const begin = await invokeBegin(deps, scopeIds)

    // begin 之后：段 2 被人工锁定，段 3 被人工编辑（revision 前移）
    fixture.db.segments.setLocked(scopeIds[1]!, true)
    fixture.db.segments.applyTargetEdit(scopeIds[2]!, '人工译文', 0)

    const refusal = await assertThrowsCode(
      invokeFinalize(deps, begin.scopeJobId),
      SCOPE_INCOMPLETE,
    )
    assert.ok(refusal instanceof LinguistCatTranslationScopeIncompleteError)
    assert.deepEqual(refusal.counts, {
      requested: 4,
      proposalCreated: 0,
      skipped: 0,
      blocked: 0,
      failed: 2,
      pending: 2,
    })
    assert.deepEqual(refusal.failedSegmentIds, [scopeIds[1], scopeIds[2]])
    assert.deepEqual(refusal.pendingSegmentIds, [scopeIds[0], scopeIds[3]])

    // 全部解释后成功：派生 failed 段以 blocked 入账，正常段以 skipped 入账
    const finalized = await invokeFinalize(deps, begin.scopeJobId, [
      { segmentId: scopeIds[0]!, kind: 'skipped', reason: '与上一段重复，沿用既有提案即可' },
      { segmentId: scopeIds[1]!, kind: 'blocked', reason: '段已锁定，需人工解锁' },
      { segmentId: scopeIds[2]!, kind: 'blocked', reason: 'begin 后译文被人工修改，范围已过期' },
      { segmentId: scopeIds[3]!, kind: 'skipped', reason: '无上下文，留待下一轮' },
    ])
    assert.deepEqual(finalized.coverage, {
      requested: 4,
      proposalCreated: 0,
      skipped: 2,
      blocked: 2,
      failed: 0,
      pending: 0,
    })
    const job = fixture.db.runs.getJob(begin.scopeJobId, { sessionId: 'sess-scope' })!
    assert.equal(job.status, 'completed')
    assert.deepEqual(job.completedSegmentIds, [])
    // checkpoint 冻结顺序：skipped（scope 顺序 s0、s3）在前，blocked（s1、s2）在后
    assert.deepEqual(job.failedSegmentIds, [scopeIds[0], scopeIds[3], scopeIds[1], scopeIds[2]])
    assert.deepEqual(job.openItemIds, [
      `translation-scope-skip:${scopeIds[0]}`,
      `translation-scope-skip:${scopeIds[3]}`,
      `translation-scope-blocked:${scopeIds[1]}`,
      `translation-scope-blocked:${scopeIds[2]}`,
    ])
  } finally {
    fixture.db.close()
  }
})

// ===== LA-CONTEXT-003：运行中改选（新 turn 新范围）不改变已开始 Job =====

test('translation scope: 后续不同范围的 begin 不改变已开始 job 的冻结快照与 digest', async () => {
  const fixture = setup()
  try {
    const deps = makeScopeTools(fixture)
    const segments = fixture.segmentsA
    const scopeA = segments.slice(0, 2).map((segment) => segment.id as string)
    const scopeB = segments.slice(2, 4).map((segment) => segment.id as string)

    // Turn 1：按当时选择 begin scope A 并推进（提案 = 运行中副作用）
    const beginA = await invokeBegin(deps, scopeA, 'call-turn-1')
    await propose(deps, segments.slice(0, 1), 'call-turn-1-propose')

    // Turn 2：用户已改选 Grid 选择，新 turn 携带新范围 begin scope B（不同 toolCallId = 不同 job）
    const beginB = await invokeBegin(deps, scopeB, 'call-turn-2')
    assert.notEqual(beginB.scopeDigest, beginA.scopeDigest, '不同冻结范围必须有不同 digest')

    // 已开始 job A 的持久化冻结状态不受 B 影响
    const jobA = fixture.db.runs.getJob(beginA.scopeJobId, { sessionId: 'sess-scope' })!
    assert.deepEqual(jobA.segmentIds, scopeA)
    assert.deepEqual(jobA.baseRevisions, Object.fromEntries(scopeA.map((id) => [id, 0])))
    assert.equal(jobA.status, 'running')
    assert.equal(jobA.cursor, 0)
    assert.equal(
      translationJobScopeDigest(jobA.segmentIds, jobA.baseRevisions),
      beginA.scopeDigest,
      'persisted frozen snapshot must still match the begin receipt digest',
    )

    // finalize A 仍按 A 自己的冻结范围结算（与 B 无关），digest 贯穿一致
    const finalizedA = await invokeFinalize(deps, beginA.scopeJobId, [
      { segmentId: scopeA[1]!, kind: 'skipped', reason: '本轮不译，留待后续范围' },
    ], 'call-turn-1-finalize')
    assert.equal(finalizedA.status, 'completed')
    assert.equal(finalizedA.scopeDigest, beginA.scopeDigest)
    assert.deepEqual(finalizedA.coverage, {
      requested: 2,
      proposalCreated: 1,
      skipped: 1,
      blocked: 0,
      failed: 0,
      pending: 0,
    })
    const jobB = fixture.db.runs.getJob(beginB.scopeJobId, { sessionId: 'sess-scope' })!
    assert.equal(jobB.status, 'running', 'finalize A must not touch scope B')
    assert.equal(jobB.cursor, 0)
  } finally {
    fixture.db.close()
  }
})

// ===== explanation 冲突与 authority =====

test('cat_finalize_translation_scope: explanation 冲突、越界段、未知 scope、跨会话 authority', async () => {
  const fixture = setup()
  try {
    const deps = makeScopeTools(fixture)
    const segments = fixture.segmentsA.slice(0, 3)
    const scopeIds = segments.map((segment) => segment.id as string)
    const begin = await invokeBegin(deps, scopeIds)
    await propose(deps, segments.slice(0, 1), 'call-propose-1')

    // 已有 pending 提案的段不得再被解释
    await assertThrowsCode(
      invokeFinalize(deps, begin.scopeJobId, [
        { segmentId: scopeIds[0]!, kind: 'skipped', reason: '矛盾解释' },
      ]),
      INVALID_ARGUMENT,
    )
    // 冻结范围之外的段不得解释
    await assertThrowsCode(
      invokeFinalize(deps, begin.scopeJobId, [
        { segmentId: fixture.segmentsA[5]!.id as string, kind: 'skipped', reason: '范围外解释' },
      ]),
      INVALID_ARGUMENT,
    )
    // reason 空白与重复段解释
    await assertThrowsCode(
      invokeFinalize(deps, begin.scopeJobId, [
        { segmentId: scopeIds[1]!, kind: 'skipped', reason: '   ' },
      ]),
      INVALID_ARGUMENT,
    )
    await assertThrowsCode(
      invokeFinalize(deps, begin.scopeJobId, [
        { segmentId: scopeIds[1]!, kind: 'skipped', reason: 'a' },
        { segmentId: scopeIds[1]!, kind: 'blocked', reason: 'b' },
      ]),
      INVALID_ARGUMENT,
    )
    // 未知 scopeJobId
    await assertThrowsCode(
      invokeFinalize(deps, 'job:translation-scope:sess-scope:nope'),
      INVALID_ARGUMENT,
    )
    // 跨会话 finalize 他人 scope：store authority fail closed
    const otherDeps = makeScopeTools(fixture, 'sess-other')
    await assert.rejects(
      invokeFinalize(otherDeps, begin.scopeJobId),
      StoreAuthorityError,
    )
  } finally {
    fixture.db.close()
  }
})

// ===== fail closed：归档只读 / 未绑定 / 项目缺失 =====

test('translation scope tools: 归档项目写路径 fail closed（StoreReadOnlyError 直传）', async () => {
  const fixture = setup()
  const deps = makeScopeTools(fixture)
  const segments = fixture.segmentsA.slice(0, 2)
  const scopeIds = segments.map((segment) => segment.id as string)
  const begin = await invokeBegin(deps, scopeIds)
  await propose(deps, segments, 'call-propose-1')
  fixture.db.close()

  fixture.store.archiveProject(fixture.project.id)
  const readOnlyDb = fixture.store.openProject(fixture.project.id, { readOnly: true })
  try {
    const archivedProject = fixture.store.getProject(fixture.project.id)
    const archivedTools = createLinguistCatTools({
      resolveProject: () => ({ project: archivedProject, db: readOnlyDb }),
      sessionId: 'sess-scope',
    })
    // 全部已覆盖的 finalize 在 checkpoint 写事务处 fail closed
    await assert.rejects(
      invoke(toolByName(archivedTools, 'cat_finalize_translation_scope'), {
        scopeJobId: begin.scopeJobId,
        explanations: [],
      }, 'call-finalize-archived'),
      StoreReadOnlyError,
    )
    await assert.rejects(
      invoke(toolByName(archivedTools, 'cat_begin_translation_scope'), {
        segmentIds: scopeIds,
      }, 'call-begin-archived'),
      StoreReadOnlyError,
    )
  } finally {
    readOnlyDb.close()
  }
})

test('translation scope tools: 未绑定会话与缺失项目 fail closed', async () => {
  const fixture = setup()
  try {
    const missing = createLinguistCatTools({
      resolveProject: () => new LinguistCatProjectMissingError('prj-0000000000000000'),
      sessionId: 'sess-scope',
    })
    await assertThrowsCode(
      invoke(toolByName(missing, 'cat_finalize_translation_scope'), { scopeJobId: 'job:x' }),
      PROJECT_MISSING,
    )

    const unbound = createLinguistCatTools({
      resolveProject: () => new LinguistCatBindingMissingError(),
      sessionId: 'sess-scope',
    })
    await assertThrowsCode(
      invoke(toolByName(unbound, 'cat_begin_translation_scope'), {
        segmentIds: [fixture.segmentsA[0]!.id as string],
      }),
      BINDING_MISSING,
    )
    // resolver 先于参数校验：未绑定时即使参数缺失也抛 BINDING_MISSING
    await assertThrowsCode(
      invoke(toolByName(unbound, 'cat_begin_translation_scope'), undefined),
      BINDING_MISSING,
    )
    await assertThrowsCode(
      invoke(toolByName(unbound, 'cat_finalize_translation_scope'), undefined),
      BINDING_MISSING,
    )
  } finally {
    fixture.db.close()
  }
})
