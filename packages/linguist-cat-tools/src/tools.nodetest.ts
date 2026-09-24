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
  createStageEvidenceBaseline,
  deriveSegmentId,
  tmSourceHash,
  RevisionConflictError,
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
  runAssetQa,
  StoreIdempotencyConflictError,
  StoreNotFoundError,
  StoreReadOnlyError,
  StoreSqliteUnavailableError,
  type ProjectDatabase,
  type RecordStageEvidenceReceiptInput,
} from '@linguist/cat-store'
import { createLinguistCatTools } from './factory'
import {
  runConsistencyPlanWorkerJob,
  runQaWorkerJob,
  type WorkerJobProgress,
} from './job-runner'
import {
  LinguistCatBatchNotFoundError,
  LinguistCatBindingMissingError,
  LinguistCatProjectMissingError,
  type LinguistCatToolError,
} from './errors'
import {
  LINGUIST_CAT_TOOL_NAMES,
  type LinguistCatToolCallInfo,
  type LinguistCatToolMutation,
  type LinguistCatToolName,
  type CatApplyTranslationsResult,
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

/** 测试中按真实分片合同组回一页，不把空 contexts 当作丢失正文。 */
async function completeContextPage(tool: LinguistCatTool, params: Record<string, unknown>): Promise<Pick<
  import('./types').CatGetTranslationContextResult, 'contexts' | 'shared' | 'unprovidedReferences' | 'projectRules'
>> {
  let page = (await invoke(tool, params)).details as import('./types').CatGetTranslationContextResult
  if (page.contextFragment === undefined) return page
  let json = ''
  while (page.contextFragment !== undefined) {
    assert.equal(page.contextFragment.offset, json.length)
    assert.ok(page.usedBytes <= page.maxBytes)
    json += page.contextFragment.text
    if (json.length === page.contextFragment.totalChars) return JSON.parse(json)
    assert.ok(page.nextCursor)
    page = (await invoke(tool, { ...params, cursor: page.nextCursor })).details as import('./types').CatGetTranslationContextResult
  }
  throw new Error('context fragment did not complete')
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

test('factory: CAT tools expose project-local accept and export but no resolve or waive mutation', () => {
  const fixture = setup()
  try {
    const tools = createLinguistCatTools({ resolveProject: makeOkResolver(fixture) })
    assert.deepEqual(
      tools.map((tool) => tool.name),
      [...LINGUIST_CAT_TOOL_NAMES],
    )
    assert.ok(toolByName(tools, 'cat_export_batch'))
    assert.equal(tools.some((tool) => /resolve|waive|deliver/i.test(tool.name)), false)
    assert.ok(toolByName(tools, 'cat_accept_proposals'))
    assert.equal(tools.length, LINGUIST_CAT_TOOL_NAMES.length)
    for (const tool of tools) {
      assert.equal(typeof tool.label, 'string')
      assert.ok(tool.label.length > 0)
      assert.equal(typeof tool.description, 'string')
      assert.ok(tool.description.length > 0)
      assert.equal(typeof tool.promptSnippet, 'string')
      assert.ok(tool.parameters && typeof tool.parameters === 'object')
      assert.equal(typeof tool.execute, 'function')
    }
  } finally {
    fixture.db.close()
  }
})

test('import result keeps all file statuses while model receives compact tag diagnostics', async () => {
  const fixture = setup()
  try {
    const examples = Array.from({ length: 500 }, (_, index) => ({
      id: `example-${index}`, segmentId: `segment-${index}`, side: 'source' as const, value: '[value]',
    }))
    const pattern = {
      patternShape: '[value]', examples, frequency: 500,
      sourceTargetPreservation: { exactValueRate: 1, shapeRate: 1, countRate: 1 },
      pairingEvidence: { opening: 0, closing: 0, balanced: true, pairKeys: [] },
      suggestedVariableParts: [],
    }
    const importResources = async () => ({
      found: 3, ready: 0, imported: 2, skippedDuplicate: 0, needsInput: 1, unsupported: 0, failed: 0, truncated: false,
      items: [
        { filename: 'first.xliff', status: 'imported' as const, resourceKind: 'batch' as const, resourceId: 'asset-1', unknownTagSummary: [pattern] },
        { filename: 'second.xliff', status: 'needs-input' as const, message: '缺少映射' },
        { filename: 'memory.tmx', status: 'imported' as const, resourceKind: 'tm' as const, resourceId: 'reference-1' },
      ],
    })
    const tool = toolByName(createLinguistCatTools({ resolveProject: makeOkResolver(fixture), importResources }), 'cat_import_resources')
    const result = await invoke(tool, { paths: ['first.xliff', 'second.xliff', 'memory.tmx'] })
    const model = JSON.parse(resultText(result))
    assert.deepEqual(model.items.map((item: { status: string }) => item.status), ['imported', 'needs-input', 'imported'])
    assert.equal(model.items[0].batchId, 'asset-1')
    assert.equal('resourceId' in model.items[0], false)
    assert.equal(model.items[2].resourceId, 'reference-1')
    assert.equal((result.details as { items: Array<{ batchId?: string }> }).items[0]?.batchId, 'asset-1')
    assert.equal(model.items[0].unknownTagSummary.patterns[0].exampleCount, 500)
    assert.equal(model.items[0].unknownTagSummary.patterns[0].example.id, 'example-0')
    assert.equal((result.details as { items: Array<{ unknownTagSummary?: Array<{ examples: unknown[] }> }> }).items[0]?.unknownTagSummary?.[0]?.examples.length, 500)
    assert.ok(resultText(result).length < 2_000)
  } finally { fixture.db.close() }
})

test('cat_confirm_segments: Reviewer 的 101 段冻结范围跨两批后才 complete', async () => {
  const fixture = setup()
  const { asset, segments } = seedAsset(fixture.db, fixture.project, {
    filename: 'review-101.tsv',
    sha: '1'.repeat(64),
    count: 101,
    fillEvery: 1,
    sourcePrefix: 'Review',
  })
  const scope = segments.map((segment) => segment.id as string)
  try {
    const stageRunId = 'stage-review-101'
    const requirement = {
      evidence: { ref: { kind: 'asset' as const, id: asset.id }, version: asset.sourceSha256 },
      purpose: 'source-authority' as const,
      requiredness: 'required' as const,
      scope: { kind: 'assets' as const, assetIds: [asset.id] },
      anchorIds: [],
      rationale: '主批次 Source',
    }
    const baseline = createStageEvidenceBaseline({
      stageRunId,
      discoveryScopeHash: 'scope',
      mappingRevision: 'mapping',
      ruleSetRevision: 'rules',
      segmentIds: scope,
      evidence: [requirement.evidence],
    })
    fixture.db.stageEvidence.create({
      stageRunId,
      sessionId: 'review-session',
      plan: {
        stageRunId,
        role: 'reviewer',
        stage: 'editing',
        assetIds: [asset.id],
        segmentIds: scope,
        requirements: [requirement],
      },
      baseline,
    })
    const tools = createLinguistCatTools({
      resolveProject: makeOkResolver(fixture),
      sessionId: 'review-session',
      linguistRole: 'reviewer',
      stageEvidenceRunId: stageRunId,
      reviewScopeSegmentIds: scope,
    })
    const tool = toolByName(tools, 'cat_confirm_segments')
    const first = (await invoke(tool, {
      items: segments.slice(0, 100).map((segment) => ({
        segmentId: segment.id,
        expectedRevision: 0,
        decision: 'unchanged',
      })),
    }, 'confirm-page-1')).details as { coverage: { confirmed: number; unchanged: number; pending: number; status: string } }
    assert.deepEqual(first.coverage, {
      scope: 'delegated',
      total: 101,
      confirmed: 0,
      unchanged: 100,
      corrected: 0,
      blocked: 0,
      pending: 1,
      status: 'in_progress',
    })

    const second = (await invoke(tool, {
      items: [{
        segmentId: segments[100]!.id,
        expectedRevision: 0,
        decision: 'unchanged',
      }],
    }, 'confirm-page-2')).details as {
      stage: string
      coverage: { pending: number; status: string }
      fullReview: { status: string; pendingEvidence: number }
    }
    assert.equal(second.stage, 'editing')
    assert.equal(second.coverage.pending, 0)
    assert.equal(second.coverage.status, 'complete')
    assert.deepEqual(second.fullReview, {
      status: 'blocked',
      requiredEvidence: 1,
      presentedEvidence: 0,
      pendingEvidence: 1,
      blockingGaps: 0,
      warnings: 0,
    })
    fixture.db.stageEvidence.recordReceipt({
      stageRunId,
      baselineHash: baseline.baselineHash,
      sessionId: 'review-session',
      generationRunId: 'generation-after-read',
      segmentIds: scope,
      evidence: [{ ref: requirement.evidence.ref, anchorIds: [], version: requirement.evidence.version, submission: 'provider-response-v1' }],
    })
    const completed = (await invoke(tool, {
      items: [{
        segmentId: segments[100]!.id,
        expectedRevision: 0,
        decision: 'unchanged',
      }],
    }, 'confirm-after-evidence')).details as { fullReview: { status: string } }
    assert.equal(completed.fullReview.status, 'complete')
    assert.equal(fixture.db.segments.listStageEvents(segments[100]!.id).at(-1)?.action, 'unchanged')
  } finally {
    fixture.db.close()
  }
})

test('cat_confirm_segments: corrected 先写回，blocked 可记录 locked/stale；岗位决定 stage', async () => {
  const fixture = setup()
  try {
    const correctedSegment = fixture.segmentsA[0]!
    fixture.db.segments.applyTargetEdit(correctedSegment.id, 'Reviewer 最新译文', 0)
    const lockedSegment = fixture.segmentsA[2]!
    fixture.db.segments.setLocked(lockedSegment.id, true)
    const staleSegment = fixture.segmentsA[4]!
    fixture.db.segments.applyTargetEdit(staleSegment.id, '并发新译文', 0)

    const reviewerTools = createLinguistCatTools({
      resolveProject: makeOkResolver(fixture),
      sessionId: 'review-session',
      linguistRole: 'reviewer',
    })
    const result = (await invoke(toolByName(reviewerTools, 'cat_confirm_segments'), {
      items: [
        { segmentId: correctedSegment.id, expectedRevision: 1, decision: 'corrected' },
        { segmentId: lockedSegment.id, expectedRevision: 0, decision: 'blocked' },
        { segmentId: staleSegment.id, expectedRevision: 0, decision: 'blocked' },
      ],
    }, 'confirm-mixed')).details as {
      stage: string
      coverage: { corrected: number; blocked: number; status: string }
    }
    assert.equal(result.stage, 'editing')
    assert.equal(result.coverage.corrected, 1)
    assert.equal(result.coverage.blocked, 2)
    assert.equal(result.coverage.status, 'completed_with_blocks')
    assert.equal(fixture.db.segments.listStageEvents(staleSegment.id).at(-1)?.segmentRevision, 1)

    const proofreaderTools = createLinguistCatTools({
      resolveProject: makeOkResolver(fixture),
      sessionId: 'proof-session',
      linguistRole: 'proofreader',
    })
    const proof = (await invoke(toolByName(proofreaderTools, 'cat_confirm_segments'), {
      items: [{ segmentId: correctedSegment.id, expectedRevision: 1, decision: 'unchanged' }],
    }, 'confirm-proof')).details as { stage: string }
    assert.equal(proof.stage, 'proofreading')
  } finally {
    fixture.db.close()
  }
})

test('cat_export_batch delegates the bound batch and absolute destination without leaking its path', async () => {
  const fixture = setup()
  try {
    let exportedInput: { assetId: string; destinationPath: string; validation: string; overwrite: boolean } | undefined
    const tools = createLinguistCatTools({
      resolveProject: makeOkResolver(fixture),
      exportAsset: async (assetId, destinationPath, validation, overwrite) => {
        exportedInput = { assetId, destinationPath, validation, overwrite }
        return {
          filename: 'alpha.translated.zh-CN.tsv',
          sha256: 'c'.repeat(64),
          sizeBytes: 42,
          verifiedAt: '2026-08-07T00:00:00.000Z',
          verifiedSegments: fixture.segmentsA.length,
          validation,
        }
      },
    })
    const properties = (toolByName(tools, 'cat_export_batch').parameters as {
      properties: Record<string, unknown>
    }).properties
    assert.deepEqual(Object.keys(properties), ['batchId', 'destinationPath', 'validation', 'overwrite'])
    assert.equal('mode' in properties, false)
    const result = await invoke(toolByName(tools, 'cat_export_batch'), {
      batchId: fixture.assetA.id,
      destinationPath: '/Users/test/Desktop/alpha.translated.zh-CN.tsv',
      validation: 'as-is',
      overwrite: true,
    })
    assert.deepEqual(exportedInput, {
      assetId: fixture.assetA.id,
      destinationPath: '/Users/test/Desktop/alpha.translated.zh-CN.tsv',
      validation: 'as-is',
      overwrite: true,
    })
    assert.deepEqual(result.details, {
      filename: 'alpha.translated.zh-CN.tsv',
      sha256: 'c'.repeat(64),
      sizeBytes: 42,
      verifiedAt: '2026-08-07T00:00:00.000Z',
      verifiedSegments: fixture.segmentsA.length,
      validation: 'as-is',
    })
    assert.equal(collectStrings(result.details).some((value) => value.includes('/Users/test')), false)
    await assertThrowsCode(invoke(toolByName(tools, 'cat_export_batch'), {
      batchId: 'ast-0000000000000000',
      destinationPath: '/Users/test/Desktop/missing.tsv',
    }), 'BATCH_NOT_FOUND')
  } finally {
    fixture.db.close()
  }
})

test('cat_accept_proposals atomically applies pending proposals without exporting files', async () => {
  const fixture = setup()
  try {
    fixture.db.segments.applyTargetEdit(
      fixture.segmentsA[0]!.id,
      '原有译文',
      0,
      { status: 'translated' },
    )
    fixture.db.segments.confirmCurrentStage(fixture.segmentsA[0]!.id, 'translation', 1)
    const mutations: LinguistCatToolMutation[] = []
    const tools = createLinguistCatTools({
      resolveProject: makeOkResolver(fixture),
      sessionId: 'session-accept',
      onMutation: (mutation) => mutations.push(mutation),
    })
    const proposed = await invoke(toolByName(tools, 'cat_propose_translations'), {
      segmentProposals: [{
        segmentId: fixture.segmentsA[0]!.id,
        baseRevision: 1,
        proposedTarget: '已由 Agent 写入 0',
      }],
    })
    const proposalId = (proposed.details as { proposalIds: string[] }).proposalIds[0]!
    const accepted = await invoke(toolByName(tools, 'cat_accept_proposals'), {
      proposals: [{ proposalId, expectedRevision: 1 }],
    })
    assert.deepEqual(accepted.details, {
      accepted: [{
        proposalId,
        segmentId: fixture.segmentsA[0]!.id,
        revision: 2,
        status: 'translated',
      }],
      replayed: false,
    })
    assert.equal(fixture.db.segments.getById(fixture.segmentsA[0]!.id)?.target, '已由 Agent 写入 0')
    assert.equal(fixture.db.segments.getById(fixture.segmentsA[0]!.id)?.currentStageState, 'draft')
    assert.equal(mutations.at(-1)?.kind, 'project-updated')
  } finally {
    fixture.db.close()
  }
})

test('project inventory refresh has no path input and returns the host-signed evidence summary', async () => {
  const fixture = setup()
  try {
    let calls = 0
    const tools = createLinguistCatTools({
      resolveProject: makeOkResolver(fixture),
      refreshProjectEvidenceInventory: async () => {
        calls += 1
        return {
          status: 'ready',
          discoveryScopeHash: 'scope-hash',
          discovered: 1,
          registered: 1,
          readyToImport: 1,
          unmapped: 0,
          media: 0,
          versionConflicts: 0,
          unsupported: 0,
          failed: 0,
          truncated: false,
          items: [{ filename: 'source.xliff', status: 'ready', resourceKind: 'batch', resourceId: fixture.assetA.id }],
          gaps: [],
        }
      },
    })

    const result = (await invoke(toolByName(tools, 'cat_refresh_project_inventory'), {})).details as {
      status: string
      discoveryScopeHash: string
      items: Array<{ batchId?: string; resourceId?: string }>
    }
    assert.equal(calls, 1)
    assert.equal(result.status, 'ready')
    assert.equal(result.discoveryScopeHash, 'scope-hash')
    assert.equal(result.items[0]?.batchId, fixture.assetA.id)
    assert.equal('resourceId' in result.items[0]!, false)
  } finally {
    fixture.db.close()
  }
})

test('workbook tools preview evidence and save a reusable bound-project profile', async () => {
  const fixture = setup()
  try {
    const mutations: LinguistCatToolMutation[] = []
    let savedPath: string | undefined
    const tools = createLinguistCatTools({
      resolveProject: makeOkResolver(fixture),
      onMutation: (mutation) => mutations.push(mutation),
      previewWorkbookMapping: async () => ({
        filename: 'strings.xlsx',
        workbookFingerprint: 'd'.repeat(64),
        sheets: [{
          name: 'Strings',
          state: 'visible',
          headerRowNumbers: [1],
          headerSignature: 'e'.repeat(64),
          headers: [{ ref: 'A1', value: 'ID' }, { ref: 'B1', value: 'Source' }, { ref: 'C1', value: 'Target' }],
          sampleRows: [{ rowNo: 2, cells: [{ ref: 'B2', value: 'Play', kind: 'text' }] }],
          mergedRanges: [],
          truncated: false,
          suggestion: {
            columns: { key: 'ID', source: 'Source', target: 'Target' },
            confidence: 0.95,
            reasons: ['source 命中列名 "Source"', 'target 命中列名 "Target"'],
          },
        }],
        skippedSheets: [],
      }),
      saveWorkbookMapping: async (filePath, input) => {
        savedPath = filePath
        return {
          id: 'wbm_0123456789abcdef01234567',
          name: input.name,
          workbookFingerprint: 'd'.repeat(64),
          filenamePattern: input.filenamePattern ?? 'strings.xlsx',
          sheetName: input.sheetName,
          headerSignature: 'e'.repeat(64),
          columns: input.columns,
          createdAt: '2026-08-10T00:00:00.000Z',
          updatedAt: '2026-08-10T00:00:00.000Z',
        }
      },
    })
    const preview = (await invoke(toolByName(tools, 'cat_preview_workbook_mapping'), {
      filePath: '/authorized/strings.xlsx',
    })).details as { filename: string; sheets: Array<{ suggestion: { confidence: number } }> }
    assert.equal(preview.filename, 'strings.xlsx')
    assert.equal(preview.sheets[0]?.suggestion.confidence, 0.95)
    assertNoAbsolutePaths(preview, fixture.rootDir)

    const saved = (await invoke(toolByName(tools, 'cat_save_workbook_mapping'), {
      filePath: '/authorized/strings.xlsx',
      name: 'Game strings',
      filenamePattern: 'strings-*.xlsx',
      sheetName: 'Strings',
      columns: { key: 'ID', source: 'Source', target: 'Target', locked: 'Lock' },
    })).details as { id: string; filenamePattern: string; columns: { locked?: string } }
    assert.equal(savedPath, '/authorized/strings.xlsx')
    assert.equal(saved.id, 'wbm_0123456789abcdef01234567')
    assert.equal(saved.filenamePattern, 'strings-*.xlsx')
    assert.equal(saved.columns.locked, 'Lock')
    assert.equal(mutations.at(-1)?.kind, 'project-updated')
    assertNoAbsolutePaths(saved, fixture.rootDir)
  } finally {
    fixture.db.close()
  }
})

test('voice tools reuse profiles and translated segments as bounded approved context', async () => {
  const fixture = setup()
  try {
    const tools = createLinguistCatTools({ resolveProject: makeOkResolver(fixture) })
    const profile = (await invoke(toolByName(tools, 'cat_upsert_voice_profile'), {
      speaker: 'Narrator',
      textType: 'dialogue',
      register: 'formal',
      person: 'third-person',
      toneMarkers: ['restrained'],
      taboos: ['internet slang'],
    })).details as { id: string; speaker: string; register: string }
    assert.equal(profile.speaker, 'Narrator')
    assert.equal(profile.register, 'formal')

    await assertThrowsCode(invoke(toolByName(tools, 'cat_add_approved_exemplar'), {
      segmentId: fixture.segmentsA[0]!.id,
      speaker: 'Narrator',
      textType: 'dialogue',
    }), 'INVALID_ARGUMENT')
    for (const index of [0, 2, 4]) {
      fixture.db.segments.confirmCurrentStage(
        fixture.segmentsA[index]!.id,
        fixture.project.workflowStage ?? 'translation',
        fixture.segmentsA[index]!.revision,
        { actor: 'local-user', now: `2026-01-01T00:00:0${index}.000Z` },
      )
    }

    const approvedIds: string[] = []
    for (const index of [0, 2, 4]) {
      const exemplar = (await invoke(toolByName(tools, 'cat_add_approved_exemplar'), {
        segmentId: fixture.segmentsA[index]!.id,
        speaker: 'Narrator',
        textType: 'dialogue',
        module: 'menu',
        note: `approved ${index}`,
      })).details as { id: string; batchId: string; segmentId: string; approvedAt: string }
      approvedIds.push(exemplar.id)
      assert.equal(exemplar.batchId, fixture.assetA.id)
      assert.equal(exemplar.segmentId, fixture.segmentsA[index]!.id)
      assert.match(exemplar.approvedAt, /^2026-/)
    }
    const duplicate = (await invoke(toolByName(tools, 'cat_add_approved_exemplar'), {
      segmentId: fixture.segmentsA[0]!.id,
      speaker: 'Narrator',
      textType: 'dialogue',
      module: 'menu',
    })).details as { id: string }
    assert.equal(duplicate.id, approvedIds[0])

    const context = (await invoke(toolByName(tools, 'cat_get_voice_context'), {
      speaker: 'Narrator',
      textType: 'dialogue',
      module: 'menu',
      limit: 3,
    })).details as {
      profile: { id: string }
      exemplars: Array<{ source: string; target: string; segmentId: string; batchId: string }>
    }
    assert.equal(context.profile.id, profile.id)
    assert.equal(context.exemplars.length, 3)
    assert.ok(context.exemplars.every((item) => item.source !== '' && item.target !== ''))
    assert.ok(context.exemplars.every((item) => item.batchId === fixture.assetA.id && !('assetId' in item)))
    assertNoAbsolutePaths(context, fixture.rootDir)

    await assertThrowsCode(invoke(toolByName(tools, 'cat_add_approved_exemplar'), {
      segmentId: fixture.segmentsA[1]!.id,
      speaker: 'Narrator',
      textType: 'dialogue',
    }), 'INVALID_ARGUMENT')
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
    const run = (await invoke(toolByName(tools, 'cat_run_qa'), {
      batchId: fixture.assetA.id,
    })).details as {
      total: number
      severityCounts: Record<string, number>
      dispositionCounts: Record<string, number>
    }
    assert.equal(run.total, 8)
    // 当前批次：4 条 EMPTY_TARGET（L1 defect）+ 4 条 TARGET_LENGTH_WARNING（L3 defect）
    assert.deepEqual(run.severityCounts, { L0: 0, L1: 4, L2: 0, L3: 4, L4: 0 })
    assert.deepEqual(run.dispositionCounts, { defect: 8, needs_review: 0, query: 0, info: 0 })
    assert.equal(fixture.db.qaFindings.list({ assetId: fixture.assetB.id }).length, 0)

    const page = (await invoke(toolByName(tools, 'cat_get_qa_findings'), {
      status: 'open',
      severity: 'L1',
      limit: 3,
    })).details as PagedResult<{ code: string; status: string; segmentRevision: number }>
    assert.equal(page.total, 4)
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
    const repeated = (await invoke(toolByName(tools, 'cat_run_qa'), {
      batchId: fixture.assetA.id,
    })).details
    assert.deepEqual(repeated, run)
    assert.equal(mutations.length, 1)
    const fixedSegment = fixture.segmentsA[1]!
    const resolvedId = fixture.db.qaFindings.list({ segmentId: fixedSegment.id, status: 'open' })[0]!.id as string
    fixture.db.segments.applyTargetEdit(fixedSegment.id, '阿尔法源文 1', 0)
    await invoke(toolByName(tools, 'cat_run_qa'), {
      batchId: fixture.assetA.id,
    }, 'call-2')
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
    assert.equal(summary.changes.qaFindingsCreated, 8)
    assert.deepEqual(summary.eventSequence, { first: 1, last: 5 })
    assert.equal(summary.canUndo, false)

    await invoke(toolByName(tools, 'cat_run_qa'), {
      batchId: fixture.assetB.id,
    }, 'call-b')
    const otherBatchFinding = fixture.db.qaFindings.list({
      assetId: fixture.assetB.id,
      status: 'open',
    })[0]!
    runAssetQa(fixture.db, fixture.assetA.id)
    assert.equal(fixture.db.qaFindings.getById(otherBatchFinding.id)?.status, 'open')
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
      batchCount: number
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
    assert.equal(dto.batchCount, 2)
    assert.equal(dto.totalSegments, 12)
    assert.deepEqual(dto.segmentCounts, { untranslated: 8, draft: 0, translated: 4, reviewed: 0 })
    assert.equal(dto.note, undefined)
    assert.deepEqual(JSON.parse(resultText(result)), dto)
    // resolver saw the tool identity, never a project id from model input
    assert.deepEqual(calls, [{ toolName: 'cat_project_summary', toolCallId: 'call-1' }])
    assertNoAbsolutePaths(result, fixture.rootDir)
  } finally {
    fixture.db.close()
  }
})

test('cat_project_summary includeDelivery returns a narrow read-only preflight for one asset', async () => {
  const fixture = setup()
  try {
    let preflightCalls = 0
    const tools = createLinguistCatTools({
      resolveProject: makeOkResolver(fixture),
      sessionId: 'summary-session',
      linguistRole: 'reviewer',
      readDeliveryPreflight: (assetId) => {
        preflightCalls += 1
        assert.equal(assetId, fixture.assetA.id)
        return {
          assetId,
          workflowStage: 'editing',
          segmentCount: fixture.assetA.segmentCount,
          lockedSegments: 0,
          unconfirmedUnlockedSegments: fixture.assetA.segmentCount,
          pendingProposalCount: 0,
          qa: { openErrors: 0, openWarnings: 1, waived: 0 },
          evidence: { status: 'not-applicable', stageRuns: 0, required: 0, presented: 0, pending: 0 },
          ready: false,
          blockers: [{ code: 'UNCONFIRMED_SEGMENTS', count: fixture.assetA.segmentCount, message: 'needs review' }],
        }
      },
    })
    const beforeStageEvents = fixture.db.runs.latestEventSequence
    const overview = (await invoke(toolByName(tools, 'cat_project_summary'), {})).details as { delivery?: unknown }
    assert.equal(overview.delivery, undefined)
    const result = (await invoke(toolByName(tools, 'cat_project_summary'), {
      batchId: fixture.assetA.id,
      includeDelivery: true,
    })).details as { delivery: Record<string, unknown> }
    assert.deepEqual(result.delivery, {
      batchId: fixture.assetA.id,
      workflowStage: 'editing',
      archived: false,
      segmentCount: fixture.assetA.segmentCount,
      lockedSegments: 0,
      unconfirmedUnlockedSegments: fixture.assetA.segmentCount,
      pendingProposalCount: 0,
      qa: { openErrors: 0, openWarnings: 1, waived: 0 },
      qaFreshness: 'not-evaluated',
      evidence: { status: 'not-applicable', stageRuns: 0, required: 0, presented: 0, pending: 0 },
      ready: false,
      blockers: [{ code: 'UNCONFIRMED_SEGMENTS', count: fixture.assetA.segmentCount, message: 'needs review' }],
      verifiedExport: false,
      currentTask: null,
    })
    assert.equal(preflightCalls, 1)
    assert.equal(fixture.db.runs.latestEventSequence, beforeStageEvents)
    assertNoAbsolutePaths(result, fixture.rootDir)
    await assertThrowsCode(invoke(toolByName(tools, 'cat_project_summary'), { batchId: fixture.assetA.id }), 'INVALID_ARGUMENT')
    await assertThrowsCode(invoke(toolByName(tools, 'cat_project_summary'), { includeDelivery: true }), 'INVALID_ARGUMENT')
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

test('cat_apply_translations defaults to direct apply and can leave Pending proposals', async () => {
  const fixture = setup()
  try {
    const mutations: LinguistCatToolMutation[] = []
    const tools = createLinguistCatTools({
      resolveProject: makeOkResolver(fixture),
      now: () => '2026-01-02T00:00:00.000Z',
      sessionId: 'session-apply',
      onMutation: (mutation) => mutations.push(mutation),
    })
    const first = fixture.segmentsA[0]!
    const second = fixture.segmentsA[1]!
    const applied = (await invoke(toolByName(tools, 'cat_apply_translations'), {
      edits: [{ segmentId: first.id, baseRevision: 0, target: '一次写回 0' }],
    })).details as { applied: number; pending: number; proposalIds: string[] }
    assert.deepEqual((applied as { failed?: unknown }).failed, [])
    assert.equal(applied.applied, 1)
    assert.equal(applied.pending, 0)
    assert.equal(fixture.db.segments.getById(first.id)?.target, '一次写回 0')
    assert.equal(fixture.db.proposals.getById(applied.proposalIds[0]!)?.status, 'accepted')
    const runId = 'run:session-apply:call-1'
    assert.equal(fixture.db.runs.getRunChangeSummary(runId).canUndo, true)
    assert.equal(fixture.db.runs.undoRun(runId, { actorId: 'test' }).status, 'completed')
    assert.equal(fixture.db.segments.getById(first.id)?.target, '译文 0')
    assert.equal(fixture.db.proposals.getById(applied.proposalIds[0]!), undefined)

    const pending = (await invoke(toolByName(tools, 'cat_apply_translations'), {
      edits: [{ segmentId: second.id, baseRevision: 0, target: '先看建议 1' }],
      mode: 'proposal',
    }, 'call-2')).details as { applied: number; pending: number }
    assert.equal(pending.applied, 0)
    assert.equal(pending.pending, 1)
    assert.equal(fixture.db.segments.getById(second.id)?.target, '')
    assert.deepEqual(mutations.map((mutation) => mutation.kind), ['project-updated', 'proposal-created'])
  } finally {
    fixture.db.close()
  }
})

test('apply 回执只含成功 savepoint，replay 保留原 revision，旧回执不能确认新写入', async () => {
  const fixture = setup()
  try {
    const [first, second, stale, locked, malformed, sqlFailure] = fixture.segmentsA
    assert.ok(first && second && stale && locked && malformed && sqlFailure)
    fixture.db.segments.applyTargetEdit(stale.id, '外部修改', 0)
    fixture.db.segments.setLocked(locked.id, true)
    fixture.db.catDb.db.exec(`CREATE TRIGGER reject_test_target BEFORE UPDATE OF target ON segments
      WHEN NEW.target = 'reject-target' BEGIN SELECT RAISE(ABORT, 'TEST_ACCEPT_FAILURE'); END`)
    const tools = createLinguistCatTools({ resolveProject: makeOkResolver(fixture), sessionId: 'receipt-test' })
    const tool = toolByName(tools, 'cat_apply_translations')
    const params = { edits: [
      { segmentId: first.id, baseRevision: 0, target: '成功一' },
      { segmentId: second.id, baseRevision: 0, target: '成功二' },
      { segmentId: stale.id, baseRevision: 0, target: '过期' },
      { segmentId: locked.id, baseRevision: 0, target: '锁定' },
      { segmentId: malformed.id, baseRevision: 0, target: '新增 {undeclared}' },
      { segmentId: sqlFailure.id, baseRevision: 0, target: 'reject-target' },
    ] }
    const result = (await invoke(tool, params)).details as CatApplyTranslationsResult
    assert.equal(result.applied, 2)
    assert.deepEqual(result.stale, [stale.id])
    assert.deepEqual(result.locked, [locked.id])
    assert.deepEqual(result.failed.map(item => item.segmentId), [malformed.id, sqlFailure.id])
    assert.equal(result.proposalIds.length, 2, '接受失败回滚的 proposal 不得出现在成功结果')
    assert.deepEqual(result.appliedItems, [first, second].map((segment, index) => ({
      segmentId: segment.id, proposalId: result.proposalIds[index], baseRevision: 0, revision: 1,
    })))
    assert.equal(fixture.db.proposals.list({}).length, 2)
    fixture.db.segments.applyTargetEdit(first.id, '再次外部修改', 1)
    const replay = (await invoke(tool, params)).details as CatApplyTranslationsResult
    assert.deepEqual(replay, result)
    assert.equal(fixture.db.segments.getById(first.id)?.revision, 2)
    assert.throws(() => fixture.db.segments.recordCurrentStageDecision(first.id, 'translation', 1, 'corrected'), RevisionConflictError)
    const { appliedItems: _items, ...historical } = result
    fixture.db.catDb.db.prepare('UPDATE proposal_mutations SET result_json = ? WHERE run_id = ? AND tool_call_id = ?')
      .run(JSON.stringify(historical), 'run:receipt-test:call-1', 'call-1')
    assert.deepEqual((await invoke(tool, params)).details, historical, '旧回执缺字段时原样返回，不查当前版本补造')
    assert.throws(() => fixture.db.catDb.transaction('外层失败', () => {
      fixture.db.proposals.applyTranslations([{ segmentId: second.id, baseRevision: 1, target: '应回滚' }])
      throw new Error('OUTER_FAILURE')
    }), /OUTER_FAILURE/)
    assert.equal(fixture.db.segments.getById(second.id)?.revision, 1)
    assert.equal(fixture.db.proposals.list({}).length, 2)
    const pending = (await invoke(tool, {
      mode: 'proposal', edits: [{ segmentId: second.id, baseRevision: 1, target: '仅候选' }],
    }, 'pending')).details as CatApplyTranslationsResult
    assert.equal(pending.pending, 1)
    assert.deepEqual(pending.appliedItems, [])
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
    await assert.doesNotReject(
      invoke(tool, {
        segmentProposals: [{
          segmentId: taggedSegment.id,
          baseRevision: 0,
          proposedTarget: '你好 {name} <b>世界</b> Level 7',
        }],
      }, 'soft-newline'),
    )
    await assert.doesNotReject(
      invoke(tool, {
        segmentProposals: [{
          segmentId: taggedSegment.id,
          baseRevision: 0,
          proposedTarget: '你好 {name} <b>世界</b>\n等级 8',
        }],
      }, 'soft-number'),
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
    assert.equal(fixture.db.proposals.listPending().length, 2)
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

test('cat_list_batches: metadata page with stable ids and digests', async () => {
  const fixture = setup()
  try {
    const tools = createLinguistCatTools({ resolveProject: makeOkResolver(fixture) })
    const result = await invoke(toolByName(tools, 'cat_list_batches'), {})
    const dto = result.details as PagedResult<Record<string, unknown>>
    assert.equal(dto.total, 2)
    assert.equal(dto.limit, 50)
    assert.equal(dto.offset, 0)
    assert.equal(dto.hasMore, false)
    assert.equal(dto.items.length, 2)
    const byFilename = new Map(dto.items.map((item) => [item.filename, item]))
    const alpha = byFilename.get('alpha.tsv')
    assert.ok(alpha)
    assert.equal(alpha.batchId, fixture.assetA.id)
    assert.equal(alpha.formatId, 'fake_tsv')
    assert.equal(alpha.segmentCount, 8)
    assert.equal(alpha.sourceSha256, 'a'.repeat(64))
    assertNoAbsolutePaths(result, fixture.rootDir)
  } finally {
    fixture.db.close()
  }
})

test('cat_list_batches: pagination edges (offset beyond total, clamp note)', async () => {
  const fixture = setup()
  try {
    const tools = createLinguistCatTools({ resolveProject: makeOkResolver(fixture) })
    const tool = toolByName(tools, 'cat_list_batches')

    const page1 = (await invoke(tool, { limit: 1 })).details as PagedResult<{ batchId: string }>
    assert.deepEqual(
      { total: page1.total, limit: page1.limit, offset: page1.offset, hasMore: page1.hasMore, count: page1.items.length },
      { total: 2, limit: 1, offset: 0, hasMore: true, count: 1 },
    )
    const page2 = (await invoke(tool, { limit: 1, offset: 1 })).details as PagedResult<{ batchId: string }>
    assert.equal(page2.hasMore, false)
    assert.notEqual(page1.items[0]!.batchId, page2.items[0]!.batchId)

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
          'batchId',
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

test('cat_get_segments: index view keeps content paging and filters without sending text', async () => {
  const fixture = setup()
  try {
    const tool = toolByName(createLinguistCatTools({ resolveProject: makeOkResolver(fixture) }), 'cat_get_segments')
    const filter = { batchId: fixture.assetA.id as string, status: 'translated', search: 'alpha', limit: 2 }
    const content = (await invoke(tool, filter)).details as PagedResult<{ id: string; source: string; target: string }>
    const explicitContent = (await invoke(tool, { ...filter, view: 'content' })).details
    assert.deepEqual(explicitContent, content)

    const first = await invoke(tool, { ...filter, view: 'index' })
    const second = await invoke(tool, { ...filter, view: 'index', offset: 2 })
    const index = first.details as PagedResult<Record<string, unknown>>
    const next = second.details as PagedResult<Record<string, unknown>>
    assert.equal(index.total, content.total)
    assert.equal(index.limit, content.limit)
    assert.equal(index.hasMore, true)
    assert.deepEqual(
      [...index.items, ...next.items].map(item => item.id),
      ((await invoke(tool, { ...filter, limit: 20 })).details as PagedResult<{ id: string }>).items.map(item => item.id),
    )
    for (const item of [...index.items, ...next.items]) {
      assert.ok(!('source' in item) && !('target' in item))
      assert.equal(item.segmentId, item.id)
      assert.equal(typeof item.currentStageState, 'string')
    }
    assert.ok(!resultText(first).includes('Alpha source'))
    await assertThrowsCode(invoke(tool, { view: 'brief' }), 'INVALID_ARGUMENT')
  } finally {
    fixture.db.close()
  }
})

test('cat_get_segments: batchId filter; unknown batch throws BATCH_NOT_FOUND', async () => {
  const fixture = setup()
  try {
    const tools = createLinguistCatTools({ resolveProject: makeOkResolver(fixture) })
    const tool = toolByName(tools, 'cat_get_segments')

    const filtered = (await invoke(tool, { batchId: fixture.assetB.id as string })).details as PagedResult<{ batchId: string; id: string }>
    assert.equal(filtered.total, 4)
    assert.equal(filtered.items.length, 4)
    for (const item of filtered.items) assert.equal(item.batchId, fixture.assetB.id as string)
    assert.deepEqual(
      filtered.items.map((item) => item.id),
      fixture.segmentsB.map((segment) => segment.id as string),
    )

    await assertThrowsCode(invoke(tool, { batchId: 'ast-0000000000000000' }), 'BATCH_NOT_FOUND')
    try {
      await invoke(tool, { batchId: 'ast-0000000000000000' })
      assert.fail('must throw')
    } catch (err) {
      assert.ok(err instanceof LinguistCatBatchNotFoundError)
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
    assert.equal(await total({ status: 'translated', batchId: fixture.assetB.id as string }), 0)
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
      'INSERT INTO tm_units (id, project_id, source, target, source_locale, target_locale, origin, source_id, source_hash, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    )
    insertTm.run('tmu-1', fixture.project.id, 'Hello world', '你好，世界', 'en', 'zh-CN', 'import', 'tools-test', tmSourceHash('Hello world', 'en', 'zh-CN'), '2026-01-01T00:00:00.000Z')
    insertTm.run('tmu-2', fixture.project.id, 'Goodbye world', '再见，世界', 'en', 'zh-CN', null, 'tools-test', tmSourceHash('Goodbye world', 'en', 'zh-CN'), '2026-01-01T00:00:01.000Z')
    insertTm.run('tmu-3', 'prj-0000000000000000', 'Hello from another project', '另一个项目', 'en', 'zh-CN', null, 'tools-test', tmSourceHash('Hello from another project', 'en', 'zh-CN'), '2026-01-01T00:00:02.000Z')
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

    const tmMatch = (await invoke(toolByName(tools, 'cat_search_tm'), { query: 'Hello world', mode: 'segment' }))
      .details as { mode: string; results: Array<Record<string, unknown>>; total: number }
    assert.equal(tmMatch.mode, 'segment')
    assert.equal(tmMatch.total, 1)
    assert.equal(tmMatch.results[0]?.matchClass, 'exact')

    await assertThrowsCode(invoke(toolByName(tools, 'cat_search_tm'), { query: '   ' }), 'INVALID_ARGUMENT')
  } finally {
    fixture.db.close()
  }
})

test('terminology tools close CRUD, conflict, and current-segment validation in the bound project', async () => {
  const fixture = setup()
  try {
    const mutations: LinguistCatToolMutation[] = []
    const tools = createLinguistCatTools({
      resolveProject: makeOkResolver(fixture),
      onMutation: (mutation) => mutations.push(mutation),
    })
    const created = (await invoke(toolByName(tools, 'cat_upsert_terms'), {
      terms: [
        { term: 'Alpha', translation: '阿尔法', status: 'required' },
        { term: 'Alpha', translation: '艾尔法', status: 'preferred' },
        { term: 'source', translation: '源', status: 'preferred' },
        { term: 'Legacy', translation: '禁词', status: 'forbidden' },
      ],
    })).details as { terms: Array<{ id: string; term: string }>; count: number }
    assert.equal(created.count, 4)
    assert.deepEqual(mutations, [{ kind: 'project-updated' }])

    const conflicts = (await invoke(toolByName(tools, 'cat_list_term_conflicts'), {})).details as {
      conflicts: Array<{ normalizedTerm: string }>
      count: number
    }
    assert.equal(conflicts.count, 1)
    assert.equal(conflicts.conflicts[0]?.normalizedTerm, 'alpha')

    fixture.db.catDb.db.prepare('UPDATE segments SET target = ? WHERE id = ?')
      .run('错误译文并含禁词', fixture.segmentsA[0]!.id)
    const validation = (await invoke(toolByName(tools, 'cat_validate_terms'), {
      segmentIds: [fixture.segmentsA[0]!.id],
    })).details as {
      missingRequired: unknown[]
      forbiddenHits: unknown[]
      preferredNotUsed: unknown[]
      unresolvedConflicts: unknown[]
    }
    assert.equal(validation.missingRequired.length, 0)
    assert.equal(validation.forbiddenHits.length, 0)
    assert.equal(validation.preferredNotUsed.length, 2)
    assert.equal(validation.unresolvedConflicts.length, 1)

    const sourceTerm = created.terms.find((entry) => entry.term === 'source')!
    const deleted = (await invoke(toolByName(tools, 'cat_delete_terms'), {
      termIds: [sourceTerm.id],
    })).details as { count: number; deletedTermIds: string[] }
    assert.deepEqual(deleted, { count: 1, deletedTermIds: [sourceTerm.id] })
    assert.equal(fixture.db.termEntries.get(sourceTerm.id), undefined)
    const numeric = (await invoke(toolByName(tools, 'cat_upsert_terms'), {
      terms: [{ term: '123', translation: '一二三', status: 'preferred' }],
    })).details as { count: number }
    assert.equal(numeric.count, 1)
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
      sourceId: 'tools-test',
      occurrenceKey: fixture.segmentsA[2]!.id as string,
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
        'SELECT * FROM tm_units WHERE project_id = ? AND source_locale',
        'FROM tm_units AS u',
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
        batchId: string
        revision: number
        previous: Array<{ segmentId: string }>
        next: Array<{ segmentId: string }>
        requiredTerms: Array<{ id: string }>
        preferredTerms: Array<{ id: string }>
        tm: Array<{ unitId: string }>
        evidence: Array<{ id: string; kind: string }>
      }>
      truncated: boolean
      nextCursor?: string
    }

    assert.deepEqual(
      dto.contexts.map((context) => context.segmentId),
      [fixture.segmentsA[2]!.id, fixture.segmentsA[0]!.id],
    )
    assert.deepEqual(dto.contexts.map((context) => context.batchId), [fixture.assetA.id, fixture.assetA.id])
    assert.deepEqual(dto.contexts.map((context) => context.revision), [1, 0])
    assert.deepEqual(dto.contexts[0]!.previous.map((item) => item.segmentId), [
      fixture.segmentsA[1]!.id,
    ])
    assert.deepEqual(dto.contexts[0]!.next.map((item) => item.segmentId), [
      fixture.segmentsA[3]!.id,
    ])
    assert.equal(dto.contexts[0]!.requiredTerms.length, 0)
    assert.equal(dto.contexts[0]!.preferredTerms.length, 2)
    assert.equal(dto.contexts[0]!.tm.length, 1)
    assert.ok(dto.contexts[0]!.evidence.some((item) => item.kind === 'segment-revision'))
    assert.ok(dto.contexts[0]!.evidence.some((item) => item.kind === 'term'))
    assert.ok(dto.contexts[0]!.evidence.some((item) => item.kind === 'tm'))
    assert.equal(dto.truncated, false)
    assert.equal(dto.nextCursor, undefined)
    assert.equal(contextQueries, 3, '句段、TM 和术语各执行一次批量读取；邻接走有界索引查询')
    assert.deepEqual(
      fixture.db.segments.getByIds(before.map((segment) => segment.id)),
      before,
      'context reads must not mutate Segment rows',
    )
  } finally {
    fixture.db.close()
  }
})

test('cat_get_translation_context maps batch scope to the stored Stage scope', async () => {
  const fixture = setup()
  try {
    let storedScope: string | undefined
    const tools = createLinguistCatTools({
      resolveProject: makeOkResolver(fixture),
      prepareStage: (_segmentIds, task) => { storedScope = task?.scope },
    })
    const result = await invoke(toolByName(tools, 'cat_get_translation_context'), {
      segmentIds: [fixture.segmentsA[0]!.id],
      stageScope: 'batches',
    })
    const contexts = (result.details as { contexts: Array<Record<string, unknown>> }).contexts
    assert.equal(storedScope, 'assets')
    assert.equal(contexts[0]?.batchId, fixture.assetA.id)
    assert.equal('assetId' in contexts[0]!, false)
  } finally {
    fixture.db.close()
  }
})

test('readOnly context and document reads do not prepare Stage or evidence, and reject scope options before side effects', async () => {
  const fixture = setup()
  try {
    const contextDoc = fixture.db.contextDocs.insert({
      kind: 'doc',
      originalFilename: 'brief.md',
      blobRelpath: 'blobs/brief.md',
      textExtract: 'read-only context',
    })
    let prepareStageCalls = 0
    let prepareContextDocCalls = 0
    let evidenceCalls = 0
    const tools = createLinguistCatTools({
      resolveProject: makeOkResolver(fixture),
      prepareStage: () => { prepareStageCalls += 1 },
      prepareContextDoc: () => { prepareContextDocCalls += 1 },
      stageEvidenceRunId: 'missing-stage-is-not-used',
      onEvidencePrepared: () => { evidenceCalls += 1 },
    })
    const beforeSegments = fixture.db.segments.getByIds([fixture.segmentsA[0]!.id]).map(({ id, target, revision }) => ({ id, target, revision }))
    const beforeStageStates = fixture.db.stageEvidence.list().map(({ stageRunId, sessionId, role, plan }) => ({ stageRunId, sessionId, role, segmentIds: plan.segmentIds }))
    const beforeReceipts = fixture.db.stageEvidence.list().flatMap(state => fixture.db.stageEvidence.listReceipts(state.stageRunId))
    const beforeEvents = JSON.stringify(fixture.db.runs.listEvents())
    const context = (await invoke(toolByName(tools, 'cat_get_translation_context'), {
      segmentIds: [fixture.segmentsA[0]!.id],
      readOnly: true,
    })).details as { readOnly?: boolean; stageEvidence?: unknown; contexts: unknown[] }
    assert.equal(context.readOnly, true)
    assert.equal(context.stageEvidence, undefined)
    assert.equal(context.contexts.length, 1)
    const document = (await invoke(toolByName(tools, 'cat_read_context_doc'), {
      docId: contextDoc.id,
      readOnly: true,
    })).details as { readOnly?: boolean; text?: string }
    assert.equal(document.readOnly, true)
    assert.equal(document.text, 'read-only context')
    assert.equal(prepareStageCalls, 0)
    assert.equal(prepareContextDocCalls, 0)
    assert.equal(evidenceCalls, 0)
    assert.deepEqual(fixture.db.segments.getByIds([fixture.segmentsA[0]!.id]).map(({ id, target, revision }) => ({ id, target, revision })), beforeSegments)
    assert.deepEqual(fixture.db.stageEvidence.list().map(({ stageRunId, sessionId, role, plan }) => ({ stageRunId, sessionId, role, segmentIds: plan.segmentIds })), beforeStageStates)
    assert.deepEqual(fixture.db.stageEvidence.list().flatMap(state => fixture.db.stageEvidence.listReceipts(state.stageRunId)), beforeReceipts)
    assert.equal(JSON.stringify(fixture.db.runs.listEvents()), beforeEvents)

    await assertThrowsCode(invoke(toolByName(tools, 'cat_get_translation_context'), {
      segmentIds: [fixture.segmentsA[0]!.id],
      readOnly: true,
      stageScope: 'batches',
    }), 'INVALID_ARGUMENT')
    assert.equal(prepareStageCalls, 0)
  } finally {
    fixture.db.close()
  }
})

test('proposal mode preserves the existing Stage and enforces the trusted delegated scope', async () => {
  const fixture = setup()
  try {
    const segment = fixture.segmentsA[0]!
    const outside = fixture.segmentsB[0]!
    let prepareStageCalls = 0
    const tools = createLinguistCatTools({
      resolveProject: makeOkResolver(fixture),
      delegatedScopeSegmentIds: [segment.id],
      prepareStage: () => { prepareStageCalls += 1 },
    })
    const before = fixture.db.segments.getById(segment.id)!
    const stageCount = fixture.db.stageEvidence.list().length
    const created = (await invoke(toolByName(tools, 'cat_apply_translations'), {
      edits: [{ segmentId: segment.id, baseRevision: before.revision, target: '提案译文' }],
      mode: 'proposal',
    })).details as { proposalIds: string[] }
    assert.equal(created.proposalIds.length, 1)
    const after = fixture.db.segments.getById(segment.id)!
    assert.equal(after.target, before.target)
    assert.equal(after.revision, before.revision)
    assert.equal(fixture.db.stageEvidence.list().length, stageCount)
    assert.equal(prepareStageCalls, 0)

    await assertThrowsCode(invoke(toolByName(tools, 'cat_propose_translations'), {
      segmentProposals: [{ segmentId: outside.id, baseRevision: outside.revision, proposedTarget: '越界建议' }],
    }), 'INVALID_ARGUMENT')
    assert.equal(prepareStageCalls, 0)
    const outsideAfter = fixture.db.segments.getById(outside.id)!
    assert.equal(outsideAfter.target, outside.target)
    assert.equal(outsideAfter.revision, outside.revision)
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
      contexts: Array<{ segmentId: string; source: string; currentTarget: string }>
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
    // v3 cursor 绑定请求形状、尚未提供的内容及偏移
    assert.match(firstPage.nextCursor ?? '', /^ctx3-[0-9a-f]{16}-[0-9a-f]{16}-\d+$/)
    assert.deepEqual(
      firstPage.suggestedSegmentIds,
      segmentIds.slice(firstPage.contexts.length),
    )
    // LA-CONTEXT-002：返回页每段 source 永不空、永不半截
    for (const context of firstPage.contexts) {
      assert.ok(context.source.length > 0, 'returned page sources must never be empty')
      const expected = fixture.db.segments.getById(context.segmentId)?.target
      assert.equal(context.currentTarget, expected, '预算降级不得丢弃当前 Target')
    }
    assert.ok(firstPage.usedBytes <= firstPage.maxBytes)
    assert.ok(Buffer.byteLength(JSON.stringify(firstPage), 'utf8') <= firstPage.maxBytes)
    assert.deepEqual(JSON.parse(resultText(first)), first.details)

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

    fixture.db.catDb.db
      .prepare('UPDATE segments SET context_json = ? WHERE id = ?')
      .run(
        JSON.stringify({ note: '审校备注'.repeat(2_000) }),
        fixture.segmentsA[0]!.id,
      )
    const degraded = await completeContextPage(tool, {
      segmentIds: [fixture.segmentsA[0]!.id],
      includeNeighbors: false,
      tmLimitPerSegment: 0,
      termLimitPerSegment: 0,
      maxBytes: 1_800,
    })
    assert.equal(degraded.contexts[0]!.currentTarget, '译文 0')
    assert.equal(degraded.contexts[0]!.notes, '审校备注'.repeat(2_000))

    const boundedTool = toolByName(createLinguistCatTools({
      resolveProject: makeOkResolver(fixture),
      resultProjectId: fixture.project.id as string,
    }), 'cat_get_translation_context')
    // 单句核心超预算时必须提供可完成的分片续页。
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
    assert.ok(minimumBudget.nextCursor?.startsWith('ctx4-'))
    assert.equal(minimumBudget.minimumRequiredBytes, undefined)
    assert.ok(minimumBudget.usedBytes <= minimumBudget.maxBytes)
    assert.ok(Buffer.byteLength(JSON.stringify(minimumResult.details), 'utf8') <= 1_024)
  } finally {
    fixture.db.close()
  }
})

test('cat_get_translation_context: 资料分页不因 Proposal、已处理批次或无关写入失效', async () => {
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
    // Proposal 不改变当前双语正文，正常写回已提供的批次也不污染剩余页。
    await invoke(toolByName(tools, 'cat_propose_translations'), {
      segmentProposals: [{ segmentId: fixture.segmentsA[0]!.id, baseRevision: 0, proposedTarget: '漂移译文 0' }],
    })
    fixture.db.segments.applyTargetEdit(fixture.segmentsA[0]!.id, '当前批次写回 0', 0)
    fixture.db.segments.applyTargetEdit(fixture.segmentsB[0]!.id, '无关批次写回 0', 0)
    const continued = (await invoke(contextTool, { ...pageParams, maxBytes: 32_000, cursor: first.nextCursor })).details as { contexts: unknown[] }
    assert.ok(continued.contexts.length > 0)
    // 原 v2 有效游标仍能恢复；它没有新内容指纹，沿用原事件快照合同。
    const legacyCursor = `ctx2-${hash}-${fixture.db.runs.latestEventSequence}-${offset}`
    assert.ok((await invoke(contextTool, { ...pageParams, maxBytes: 32_000, cursor: legacyCursor })).details)
    // 从第一页重拉：生成新内容快照，可继续翻页
    const restarted = (await invoke(contextTool, pageParams)).details as {
      nextCursor?: string
    }
    assert.match(restarted.nextCursor ?? '', /^ctx3-[0-9a-f]{16}-[0-9a-f]{16}-\d+$/)
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

test('cat_get_translation_context: 剩余 Source/Target、适用 TM/TB 与规则改变使快照漂移', async () => {
  const fixture = setup()
  try {
    const tools = createLinguistCatTools({ resolveProject: makeOkResolver(fixture) })
    const contextTool = toolByName(tools, 'cat_get_translation_context')
    const pageParams = {
      segmentIds: fixture.segmentsA.map((segment) => segment.id as string),
      includeNeighbors: false,
      tmLimitPerSegment: 5,
      termLimitPerSegment: 10,
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
      fixture.segmentsA.at(-1)!.id,
      '人工提交译文',
      0,
    ))
    await assertDriftAfter(() => {
      fixture.db.tmUnits.importMany([{
        source: 'Alpha source 1',
        target: '阿尔法源文 1',
        sourceLocale: 'en',
        targetLocale: 'zh-CN',
        sourceId: 'tools-test',
        occurrenceKey: 'alpha-1',
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
      term: 'Alpha',
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

test('cat_get_translation_context: 规则全集可续读，预算不足不推进规则页，必要术语不受可选限额影响', async () => {
  const fixture = setup()
  try {
    for (let index = 0; index < 25; index++) fixture.db.styleGuideRules.upsert({ groupKey: index === 24 ? '必须' : '标点', ruleText: `规则 ${index}：示例文本` })
    fixture.db.techConstraints.upsert({ kind: 'length', valueJson: '{"maximum":100}', scope: fixture.assetA.id })
    fixture.db.techConstraints.upsert({ kind: 'length', valueJson: '{"maximum":20}', scope: fixture.assetB.id })
    const tool = toolByName(createLinguistCatTools({ resolveProject: makeOkResolver(fixture) }), 'cat_get_translation_context')
    const params = { segmentIds: [fixture.segmentsA[0]!.id], includeNeighbors: false, tmLimitPerSegment: 0, termLimitPerSegment: 0 }
    const seen = new Set<string>()
    let offset = 0
    do {
      const page = (await invoke(tool, { ...params, rulesOnly: true, rulesOffset: offset, maxBytes: 2_000 })).details as import('./types').CatGetTranslationContextResult
      assert.equal(page.ruleCoverage.total, 26)
      assert.ok(page.projectRules!.length > 0)
      assert.ok(Buffer.byteLength(JSON.stringify(page)) <= 2_000)
      page.projectRules!.forEach(rule => seen.add(rule.ruleId))
      if (page.ruleCoverage.remaining === 0) break
      assert.ok(page.ruleCoverage.nextOffset! > offset)
      offset = page.ruleCoverage.nextOffset!
    } while (true)
    assert.equal(seen.size, 26)
    const first = (await invoke(tool, { ...params, maxBytes: 32_000 })).details as import('./types').CatGetTranslationContextResult
    assert.equal(first.projectRules?.length, 20)
    assert.ok(first.projectRules!.slice(0, 2).some(rule => rule.groupKey === '必须'))
    assert.equal(first.ruleCoverage.remaining, 6)
    const huge = fixture.db.styleGuideRules.upsert({ groupKey: '必须', ruleText: '必要规则'.repeat(2_000) })
    const hugeOffset = fixture.db.getProjectRules([fixture.segmentsA[0]!]).findIndex(rule => rule.ruleId === huge.id)
    const insufficient = (await invoke(tool, { ...params, rulesOnly: true, rulesOffset: hugeOffset, maxBytes: 1_024 })).details as import('./types').CatGetTranslationContextResult
    assert.ok(insufficient.contextFragment)
    assert.ok(insufficient.nextCursor)
    assert.equal(insufficient.ruleCoverage.nextOffset, undefined)
    let rulePage = insufficient
    let ruleJson = rulePage.contextFragment!.text
    while (rulePage.nextCursor) {
      rulePage = (await invoke(tool, { ...params, rulesOnly: true, rulesOffset: hugeOffset, maxBytes: 1024, cursor: rulePage.nextCursor })).details as import('./types').CatGetTranslationContextResult
      assert.equal(rulePage.contextFragment!.offset, ruleJson.length)
      ruleJson += rulePage.contextFragment!.text
    }
    assert.equal(JSON.parse(ruleJson).projectRules[0].ruleText, huge.ruleText)
    fixture.db.styleGuideRules.delete(huge.id)
    for (const rule of fixture.db.styleGuideRules.list()) fixture.db.styleGuideRules.delete(rule.id)
    for (const rule of fixture.db.techConstraints.list()) fixture.db.techConstraints.delete(rule.id)
    fixture.db.termEntries.upsert({ term: 'Alpha', translation: '阿尔法', status: 'required', caseSensitive: false })
    fixture.db.termEntries.upsert({ term: 'source', translation: '阿法', status: 'forbidden', caseSensitive: false })
    fixture.db.catDb.db.prepare('UPDATE segments SET context_json = ? WHERE id = ?').run(JSON.stringify({ note: '冗长备注'.repeat(2_000) }), params.segmentIds[0])
    const terms = await completeContextPage(tool, { ...params, maxBytes: 4_000 })
    assert.equal(terms.contexts[0]!.requiredTerms.length, 1)
    assert.equal(terms.contexts[0]!.forbiddenTerms.length, 1)
    assert.equal(terms.contexts[0]!.notes, '冗长备注'.repeat(2_000))
  } finally { fixture.db.close() }
})

test('binding errors: unbound session, missing project, resolver that throws typed errors', async () => {
  const fixture = setup()
  try {
    const minimalParams: Record<LinguistCatToolName, unknown> = {
      cat_project_summary: {},
      cat_list_batches: {},
      cat_get_segments: {},
      cat_import_resources: { paths: ['/missing'] },
      cat_refresh_project_inventory: {},
      cat_preview_workbook_mapping: { filePath: '/missing.xlsx' },
      cat_save_workbook_mapping: {
        filePath: '/missing.xlsx',
        sheetName: 'Sheet1',
        columns: { source: 'Source', target: 'Target' },
      },
      cat_upsert_voice_profile: { speaker: 'Narrator' },
      cat_add_approved_exemplar: {
        segmentId: fixture.segmentsA[0]!.id,
        speaker: 'Narrator',
        textType: 'dialogue',
      },
      cat_get_voice_context: { speaker: 'Narrator' },
      cat_scan_unknown_tag_patterns: {},
      cat_save_tag_profile_candidate: {
        name: 'test',
        regex: '\\[test\\]',
        kind: 'standalone',
        evidenceExampleIds: ['example'],
        confidence: 1,
        explanation: 'test',
      },
      cat_export_batch: { batchId: fixture.assetA.id, destinationPath: '/missing' },
      cat_get_translation_context: { segmentIds: [fixture.segmentsA[0]!.id] },
      cat_get_proposal_snapshot: { proposalId: 'prp-0000000000000000' },
      cat_apply_translations: {
        edits: [{ segmentId: fixture.segmentsA[0]!.id, baseRevision: 0, target: 'x' }],
      },
      cat_confirm_segments: {
        items: [{
          segmentId: fixture.segmentsA[0]!.id,
          expectedRevision: 0,
          decision: 'unchanged',
        }],
      },
      cat_search_tm: { query: 'x' },
      cat_search_terms: { query: 'x' },
      cat_upsert_terms: {
        terms: [{ term: 'Save', translation: '保存', status: 'preferred' }],
      },
      cat_delete_terms: { termIds: ['ter-0000000000000000'] },
      cat_list_term_conflicts: {},
      cat_validate_terms: { segmentIds: [fixture.segmentsA[0]!.id] },
      cat_propose_translations: {
        segmentProposals: [{ segmentId: fixture.segmentsA[0]!.id, baseRevision: 0, proposedTarget: 'x' }],
      },
      cat_accept_proposals: {
        proposals: [{ proposalId: 'prp-0000000000000000', expectedRevision: 0 }],
      },
      cat_run_qa: { batchId: fixture.assetA.id },
      cat_get_qa_findings: {},
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
      ['cat_list_batches', { limit: 1 }],
      ['cat_get_segments', { limit: 3, search: 'source' }],
      ['cat_search_tm', { query: 'x' }],
      ['cat_search_terms', { query: 'x' }],
      ['cat_run_qa', { batchId: fixture.assetA.id }],
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


// ===== Consistency plan / apply =====

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
    dimensions: { batchIds: string[]; assetIds?: string[] }
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
    assert.equal(dto.findingCount, 3)
    const group = dto.groups[0]!
    assert.match(group.groupId, /^csg-[0-9a-f]{16}$/)
    assert.equal(group.source, 'Save your work')
    assert.deepEqual(group.segmentIds, segs.map((seg) => seg.id as string))
    assert.deepEqual(group.dimensions.batchIds, [segs[0]!.assetId])
    assert.equal('assetIds' in group.dimensions, false)
    assert.deepEqual(group.candidateTargets, [
      { target: '保存你的工作', count: 2, lockedCount: 0 },
      { target: '储存你的工作', count: 1, lockedCount: 0 },
    ])
    const codes = group.findings.map((finding) => finding.code)
    assert.equal(codes.filter((code) => code === 'INCONSISTENT_REPEATED_SOURCE').length, 3)
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
    // 持久化的确定性 finding 把锁定段作为候选上下文，但自身绝不修复。
    fixture.db.qaFindings.insertOpen([
      { segmentId: segs[3]!.id, code: 'INCONSISTENT_REPEATED_SOURCE', severity: 'L2', message: '锁定段译文为审校基准之一。' },
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
      { segmentId: segs[2]!.id, code: 'INCONSISTENT_REPEATED_SOURCE', severity: 'L2', message: '锁定段仅作上下文。' },
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

test('cat_read_context_doc: paged extract read + image fallback metadata + not-found passthrough', async () => {
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
      parentContextDocId: doc.id,
    })
    fixture.db.contextDocs.replaceExtraction(doc.id, [{
      id: 'ctxa-hud',
      locator: { kind: 'image', mediaId: 'ctxm-hud', page: 2 },
      mediaContextDocId: image.id,
    }])
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
      anchors?: Array<{ id: string }>
      extractedMedia?: Array<{ docId: string; anchorIds: string[] }>
    }
    assert.equal(page1.filename, '设定.md')
    assert.equal(page1.docNote, '世界观')
    assert.deepEqual(page1.anchors?.map((anchor) => anchor.id), ['ctxa-hud'])
    assert.deepEqual(page1.extractedMedia, [{
      docId: image.id,
      filename: 'hud.png',
      anchorIds: ['ctxa-hud'],
    }])
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

    // 无宿主图片 reader 时只回元数据；Electron 绑定层负责附加 ImageContent。
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
    assert.ok(binary.note?.includes('No plain-text extract'))

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

test('Stage Evidence 工具只准备正文与图片描述，不提前记录提交回执', async () => {
  const fixture = setup()
  try {
    const segment = fixture.segmentsA[0]!
    const parent = fixture.db.contextDocs.insert({
      kind: 'doc',
      originalFilename: 'visual-brief.xlsx',
      blobRelpath: 'blobs/visual-brief.xlsx',
      sha256: 'd'.repeat(64),
      textExtract: '[anchor=anchor-text] Pull direction is downward.',
    })
    const image = fixture.db.contextDocs.insert({
      kind: 'image',
      originalFilename: 'frame.png',
      blobRelpath: 'blobs/frame.png',
      sha256: 'e'.repeat(64),
      parentContextDocId: parent.id,
    })
    fixture.db.contextDocs.replaceExtraction(parent.id, [{
      id: 'anchor-text',
      locator: { kind: 'sheet', sheet: 'Brief', row: 2, cell: 'B2', rowKind: 'data' },
      text: 'Pull direction is downward.',
    }, {
      id: 'anchor-image',
      locator: { kind: 'image', mediaId: image.id, sheet: 'Brief', row: 2, cell: 'B2' },
      mediaContextDocId: image.id,
    }])
    for (const anchorId of ['anchor-text', 'anchor-image']) {
      fixture.db.contextDocs.setEvidenceLink({
        contextDocId: parent.id,
        anchorId,
        relation: { kind: 'segment', segmentId: segment.id },
        requiredness: 'required',
        mappingRevision: 'mapping-1',
      })
    }
    const stageRunId = 'stage:receipt-test'
    const requirements = [{
      evidence: {
        ref: { kind: 'asset' as const, id: fixture.assetA.id },
        version: fixture.assetA.sourceSha256,
      },
      purpose: 'source-authority' as const,
      requiredness: 'required' as const,
      scope: { kind: 'assets' as const, assetIds: [fixture.assetA.id] },
      anchorIds: [],
      rationale: 'source',
    }, {
      evidence: {
        ref: { kind: 'context-doc' as const, id: parent.id },
        version: fixture.db.contextDocs.evidenceVersion(parent.id, [segment.id], [fixture.assetA.id])!,
      },
      purpose: 'visual-fact' as const,
      requiredness: 'required' as const,
      scope: { kind: 'segments' as const, segmentIds: [segment.id] },
      anchorIds: ['anchor-image', 'anchor-text'],
      rationale: 'linked context',
    }]
    const baseline = createStageEvidenceBaseline({
      stageRunId,
      discoveryScopeHash: 'scope-1',
      mappingRevision: 'mapping-1',
      ruleSetRevision: 'rules-1',
      segmentIds: [segment.id],
      evidence: requirements.map((item) => item.evidence),
    })
    fixture.db.stageEvidence.create({
      stageRunId,
      sessionId: 'review-session',
      plan: {
        stageRunId,
        role: 'reviewer',
        stage: 'editing',
        assetIds: [fixture.assetA.id],
        segmentIds: [segment.id],
        requirements,
      },
      baseline,
    })
    const prepared: RecordStageEvidenceReceiptInput[] = []
    const tools = createLinguistCatTools({
      resolveProject: makeOkResolver(fixture),
      sessionId: 'review-session',
      stageEvidenceRunId: stageRunId,
      onEvidencePrepared: receipt => { prepared.push(receipt) },
      generationProvenance: (toolCallId) => ({ runId: `generation:${toolCallId}` }),
      readContextImage: async () => ({ data: 'iVBORw0KGgo=', mimeType: 'image/png' }),
    })

    const contextResult = (await invoke(
      toolByName(tools, 'cat_get_translation_context'),
      { segmentIds: [segment.id], includeNeighbors: false },
      'context-call',
    )).details as {
      contexts: Array<{ contextRefs: Array<{ ref: string }> }>
      shared: { context: Record<string, { anchorId?: string }> }
      unprovidedReferences: Array<{ docId: string; anchorIds: string[]; history: { status: string } }>
      stageEvidence: { required: number; presented: number; pending: number }
    }
    assert.deepEqual(contextResult.contexts[0]?.contextRefs.map(item => contextResult.shared.context[item.ref]!.anchorId), ['anchor-text'])
    assert.equal(contextResult.unprovidedReferences.length, 1)
    assert.equal(contextResult.unprovidedReferences[0]!.docId, image.id)
    assert.deepEqual(contextResult.unprovidedReferences[0]!.anchorIds, ['anchor-image'])
    assert.equal(contextResult.unprovidedReferences[0]!.history.status, 'pending')
    assert.deepEqual(contextResult.stageEvidence, {
      stageRunId,
      status: 'in_progress',
      scopeSegments: 1,
      pendingSegments: 1,
      blockedSegments: 0,
      required: 2,
      presented: 0,
      pending: 2,
    })

    const imageResult = await invoke(toolByName(tools, 'cat_read_context_doc'), { docId: image.id }, 'image-call')
    assert.equal(imageResult.content.some((block) => block.type === 'image'), true)
    assert.equal(fixture.db.stageEvidence.getPresentationCoverage(stageRunId).presented, 0)
    assert.equal(fixture.db.stageEvidence.listReceipts(stageRunId).length, 0)
    assert.equal(prepared.length, 2)
    assert.ok(prepared[1]?.evidence.every(item => item.visual && item.submission === undefined))
    const body = (await invoke(toolByName(tools, 'cat_read_context_doc'), { docId: parent.id }, 'body-call')).details as import('./types').CatReadContextDocResult
    assert.equal(prepared.length, 3)
    await invoke(toolByName(tools, 'cat_read_context_doc'), {
      docId: parent.id, metadataOnly: true, docVersion: body.docVersion,
      offset: body.offset, limit: body.limit, metadataOffset: 1,
    }, 'metadata-call')
    assert.equal(prepared.length, 3, '元数据续页不准备正文或图片 receipt')
    for (const receipt of prepared) fixture.db.stageEvidence.recordReceipt({
      ...receipt, evidence: receipt.evidence.map(item => ({ ...item, submission: 'provider-response-v1' })),
    })
    const covered = (await invoke(toolByName(tools, 'cat_get_translation_context'), {
      segmentIds: [segment.id], includeNeighbors: false,
    }, 'covered-context')).details as import('./types').CatGetTranslationContextResult
    assert.equal(covered.stageEvidence?.pending, 0)
    assert.equal(covered.unprovidedReferences?.[0]?.history.status, 'covered')
    assert.equal(covered.unprovidedReferences?.[0]?.docId, image.id, '本次未附图像仍可路由，但不声称历史欠项')
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


test('超大单句上下文以完整 JSON 分片续读，长文本无丢失且快照变化拒绝续页', async () => {
  const fixture = setup()
  try {
    const segment = fixture.segmentsA[0]!
    const text = '😀必需上下文'.repeat(3000)
    const doc = fixture.db.contextDocs.insert({ kind: 'doc', originalFilename: 'large.txt', blobRelpath: 'blobs/large.txt', sha256: 'c'.repeat(64), textExtract: text })
    fixture.db.contextDocs.replaceExtraction(doc.id, Array.from({ length: 1500 }, (_, index) => ({ id: `anchor-${index}`, locator: { kind: 'paragraph' as const, index }, text: 'required' })))
    fixture.db.catDb.transaction('fixture links', () => {
      for (let index = 0; index < 1500; index++) fixture.db.contextDocs.setEvidenceLink({ contextDocId: doc.id, anchorId: `anchor-${index}`, relation: { kind: 'segment', segmentId: segment.id }, requiredness: 'required', mappingRevision: 'v1' })
    })
    const tool = toolByName(createLinguistCatTools({ resolveProject: makeOkResolver(fixture), resultProjectId: fixture.project.id }), 'cat_get_translation_context')
    const request = { segmentIds: [segment.id], includeNeighbors: false, tmLimitPerSegment: 0, termLimitPerSegment: 0, maxBytes: 4096, readOnly: true }
    let cursor: string | undefined
    let json = ''
    let firstCursor: string | undefined
    do {
      const result = await invoke(tool, { ...request, cursor })
      const page = result.details as { contextFragment?: { offset: number; text: string; totalChars: number }; nextCursor?: string; usedBytes: number }
      assert.ok(page.contextFragment, 'oversized context must return a fragment')
      assert.equal(page.contextFragment.offset, json.length)
      assert.equal(Buffer.byteLength(resultText(result)), page.usedBytes)
      assert.ok(page.usedBytes <= request.maxBytes)
      json += page.contextFragment.text
      cursor = page.nextCursor
      firstCursor ??= cursor
    } while (cursor)
    const restored = JSON.parse(json)
    assert.equal(restored.contexts[0].source, segment.source)
    assert.equal(restored.unprovidedReferences[0].anchorIds.length, 1500)
    assert.equal(new Set(restored.unprovidedReferences[0].anchorIds).size, 1500)
    assert.equal(fixture.db.stageEvidence.list().length, 0)
    fixture.db.contextDocs.setEvidenceLink({ contextDocId: doc.id, anchorId: 'anchor-0', relation: { kind: 'segment', segmentId: segment.id }, requiredness: 'conditional', mappingRevision: 'v2' })
    await assertThrowsCode(invoke(tool, { ...request, cursor: firstCursor }), 'CONTEXT_DRIFT')
  } finally { fixture.db.close() }
})

test('超长 Source、Target 与必需术语出处可无损重组，续页预算改变不改变载荷', async () => {
  const fixture = setup()
  try {
    const segment = fixture.segmentsA[0]!
    const source = `Alpha ${'😀源文'.repeat(1000)}`
    const target = '🧩译文'.repeat(1000)
    fixture.db.catDb.db.prepare('UPDATE segments SET source = ?, target = ? WHERE id = ?').run(source, target, segment.id)
    const note = '术语出处'.repeat(1000)
    fixture.db.termEntries.upsert({ term: 'Alpha', translation: '阿尔法', status: 'required', caseSensitive: false, note })
    const tool = toolByName(createLinguistCatTools({ resolveProject: makeOkResolver(fixture) }), 'cat_get_translation_context')
    let cursor: string | undefined, json = '', pages = 0
    do {
      const maxBytes = pages++ % 2 === 0 ? 1024 : 8192
      const result = await invoke(tool, { segmentIds: [segment.id], includeNeighbors: false, tmLimitPerSegment: 0, termLimitPerSegment: 0, readOnly: true, maxBytes, cursor })
      const page = result.details as import('./types').CatGetTranslationContextResult
      assert.ok(page.contextFragment)
      assert.equal(page.contextFragment.offset, json.length)
      assert.ok(Buffer.byteLength(resultText(result)) <= maxBytes)
      json += page.contextFragment.text
      cursor = page.nextCursor
    } while (cursor)
    const restored = JSON.parse(json)
    assert.equal(restored.contexts[0].source, source)
    assert.equal(restored.contexts[0].currentTarget, target)
    assert.equal(restored.contexts[0].requiredTerms[0].note, note)
  } finally { fixture.db.close() }
})

test('schema2 在装页前共享正文与 Voice，保留异源权威、每段 requiredness 和边界邻文', async () => {
  const fixture = setup()
  try {
    const { asset, segments } = seedAsset(fixture.db, fixture.project, {
      filename: 'shared-context.tsv', sha: '7'.repeat(64), count: 22, sourcePrefix: 'Shared', fillEvery: 1,
    })
    const selected = segments.slice(1, 21)
    const text = 'A shared reference paragraph. '.repeat(60)
    const docIds: string[] = []
    for (const index of [1, 2]) {
      const doc = fixture.db.contextDocs.insert({ kind: 'doc', originalFilename: `guide-${index}.txt`, blobRelpath: `blobs/guide-${index}.txt`, textExtract: text })
      docIds.push(doc.id)
      fixture.db.contextDocs.setEvidenceLink({ contextDocId: doc.id, relation: { kind: 'asset', assetId: asset.id }, requiredness: index === 1 ? 'required' : 'optional', mappingRevision: 'v1' })
    }
    fixture.db.contextDocs.setEvidenceLink({ contextDocId: docIds[1]!, relation: { kind: 'segment', segmentId: selected[0]!.id }, requiredness: 'required', mappingRevision: 'v1' })
    for (const segment of selected) fixture.db.catDb.db.prepare('UPDATE segments SET context_json = ? WHERE id = ?').run(JSON.stringify({ note: 'A meaningful note', origin: 'Tutorial', meta: { speaker: 'Narrator', textType: 'dialogue', module: 'intro', unrelatedInternal: 'do not repeat this' } }), segment.id)
    const tools = createLinguistCatTools({ resolveProject: makeOkResolver(fixture) })
    await invoke(toolByName(tools, 'cat_upsert_voice_profile'), { speaker: 'Narrator', register: 'formal', toneMarkers: ['restrained'] })
    const result = await invoke(toolByName(tools, 'cat_get_translation_context'), {
      segmentIds: selected.map(item => item.id), tmLimitPerSegment: 0, termLimitPerSegment: 0, neighborCount: 1, maxBytes: 45_000, readOnly: true,
    })
    const dto = result.details as import('./types').CatGetTranslationContextResult
    assert.equal(dto.contextFormatVersion, 2)
    assert.equal(dto.contexts.length, 20, '共享后整组放入相同预算，不先按未去重的体量切页')
    assert.equal(dto.truncated, false)
    assert.equal(Object.keys(dto.shared.context).length, 2, '同文异源不能合并为一条权威')
    assert.equal(Object.keys(dto.shared.voices).length, 1)
    assert.deepEqual(Object.values(dto.shared.neighbors).map(item => item.segmentId), [segments[0]!.id, segments[21]!.id])
    assert.equal(resultText(result).split(text).length - 1, 2)
    assert.equal(dto.contexts[0]!.contextRefs.find(ref => dto.shared.context[ref.ref]!.docId === docIds[1])?.requiredness, 'required')
    assert.equal(dto.contexts[1]!.contextRefs.find(ref => dto.shared.context[ref.ref]!.docId === docIds[1])?.requiredness, 'optional')
    for (const [index, context] of dto.contexts.entries()) {
      assert.equal(context.source, selected[index]!.source)
      assert.equal(context.currentTarget, selected[index]!.target)
      assert.equal(context.notes, 'A meaningful note')
      assert.equal(context.origin, 'Tutorial')
      assert.equal(context.textType, 'dialogue')
      assert.equal(context.module, 'intro')
      assert.ok(context.voiceRefs.every(ref => dto.shared.voices[ref] !== undefined))
      for (const ref of [...context.previous, ...context.next]) assert.ok(dto.contexts.some(item => item.segmentId === ref.segmentId && item.revision === ref.revision)
        || dto.shared.neighbors[`${ref.segmentId}@${ref.revision}`] !== undefined)
    }
    assert.ok(!resultText(result).includes('unrelatedInternal'))
    assert.equal(dto.usedBytes, Buffer.byteLength(resultText(result)))
    const expanded = dto.contexts.map(context => ({ ...context,
      linkedContext: context.contextRefs.map(ref => ({ ...dto.shared.context[ref.ref], requiredness: ref.requiredness })),
      voiceProfiles: context.voiceRefs.map(ref => dto.shared.voices[ref]),
    }))
    assert.ok(Buffer.byteLength(JSON.stringify(expanded)) > dto.maxBytes, '以完整相同内容验证去重确实改变本组装页结果')
  } finally { fixture.db.close() }
})

test('schema2 极小预算分片仍保留完整双语、原生标签位置、key 和语义备注', async () => {
  const fixture = setup()
  try {
    const segment = fixture.segmentsA[0]!
    const source = '<b>Alpha</b>\n{count} ready'
    const target = '  已有 <b>阿尔法</b>\n{count}  '
    const note = '控制角色说话范围。'.repeat(400)
    fixture.db.catDb.db.prepare('UPDATE segments SET source = ?, target = ?, context_json = ? WHERE id = ?').run(source, target, JSON.stringify({ note }), segment.id)
    const tool = toolByName(createLinguistCatTools({ resolveProject: makeOkResolver(fixture) }), 'cat_get_translation_context')
    const page = await completeContextPage(tool, { segmentIds: [segment.id], includeNeighbors: false, tmLimitPerSegment: 0, termLimitPerSegment: 0, maxBytes: 1024, readOnly: true })
    const actual = page.contexts[0]!
    assert.equal(actual.source, source)
    assert.equal(actual.currentTarget, target)
    assert.equal(actual.notes, note)
    assert.equal(actual.key, segment.key)
    assert.equal(actual.originalOrdinal, segment.ordinal + 1)
    assert.ok(actual.tags.length > 0)
    assert.ok(actual.targetTags.length > 0)
    assert.equal(source.slice(actual.tags[0]!.start, actual.tags[0]!.end), '<b>')
    assert.equal(target.slice(actual.targetTags[0]!.start, actual.targetTags[0]!.end), '<b>')
  } finally { fixture.db.close() }
})

test('metadataOnly 续取同版本同正文范围，省去正文且不能静默拼接版本', async () => {
  const fixture = setup()
  try {
    const text = 'Long reference content. '.repeat(300)
    const doc = fixture.db.contextDocs.insert({ kind: 'doc', originalFilename: 'metadata.txt', blobRelpath: 'blobs/metadata.txt', textExtract: text })
    const anchors = Array.from({ length: 45 }, (_, index) => ({ id: `meta-${index}`, locator: { kind: 'paragraph' as const, index, textRange: { start: 0, end: text.length } }, text }))
    fixture.db.contextDocs.replaceExtraction(doc.id, anchors)
    let preparation = 0
    const tool = toolByName(createLinguistCatTools({ resolveProject: makeOkResolver(fixture), prepareContextDoc: () => { preparation++ } }), 'cat_read_context_doc')
    const first = (await invoke(tool, { docId: doc.id, offset: 0, limit: 8000 })).details as import('./types').CatReadContextDocResult
    assert.equal(first.text, text)
    assert.equal(first.nextMetadataOffset, 20)
    const args = { docId: doc.id, offset: first.offset, limit: first.limit, docVersion: first.docVersion, metadataOffset: first.nextMetadataOffset, metadataOnly: true }
    const metadataResult = await invoke(tool, args)
    const metadata = metadataResult.details as import('./types').CatReadContextDocResult
    assert.equal(metadata.metadataOnly, true)
    assert.equal(metadata.text, undefined)
    assert.equal(metadata.docVersion, first.docVersion)
    assert.equal(metadata.offset, first.offset)
    assert.equal(metadata.limit, first.limit)
    assert.deepEqual(metadata.anchors?.map(anchor => anchor.id), fixture.db.contextDocs.listAnchors(doc.id).slice(20, 40).map(anchor => anchor.id))
    assert.ok(metadata.anchors?.every(anchor => anchor.text === undefined))
    assert.equal(preparation, 1)
    assert.ok(Buffer.byteLength(resultText(metadataResult)) < first.usedBytes!)
    const standalone = (await invoke(tool, { docId: doc.id, offset: first.offset, limit: first.limit, metadataOffset: 20 })).details as import('./types').CatReadContextDocResult
    assert.equal(standalone.text, text, 'metadataOffset 本身不是此前已读凭证，独立读取仍附正文')
    await assertThrowsCode(invoke(tool, { docId: doc.id, metadataOnly: true, offset: 0, limit: 1 }), 'INVALID_ARGUMENT')
    fixture.db.contextDocs.insert({ kind: 'doc', originalFilename: 'metadata.txt', blobRelpath: 'blobs/metadata.txt', textExtract: text,
      extractionWarnings: [{ code: 'PARTIAL_EXTRACTION', message: 'A newly detected extraction limitation.' }],
    })
    await assertThrowsCode(invoke(tool, args), 'CONTEXT_DRIFT')
    args.docVersion = ((await invoke(tool, { docId: doc.id, offset: first.offset, limit: first.limit })).details as import('./types').CatReadContextDocResult).docVersion
    fixture.db.contextDocs.replaceExtraction(doc.id, [...anchors, { id: 'new-anchor', locator: { kind: 'paragraph', index: 45 }, text: 'new metadata' }])
    await assertThrowsCode(invoke(tool, args), 'CONTEXT_DRIFT')
  } finally { fixture.db.close() }
})

test('schema2 分片期间原件披露状态变化须拒绝拼接，但保留已有历史 receipt', async () => {
  const fixture = setup()
  try {
    const segment = fixture.segmentsA[0]!
    fixture.db.catDb.db.prepare('UPDATE segments SET source = ? WHERE id = ?').run('Source '.repeat(1200), segment.id)
    const doc = fixture.db.contextDocs.insert({ kind: 'doc', originalFilename: 'required.txt', blobRelpath: 'blobs/required.txt', textExtract: 'Required reference. '.repeat(180) })
    fixture.db.contextDocs.setEvidenceLink({ contextDocId: doc.id, relation: { kind: 'segment', segmentId: segment.id }, requiredness: 'required', mappingRevision: 'v1' })
    const stageRunId = 'stage:fragment-history'
    const requirement = {
      evidence: { ref: { kind: 'context-doc' as const, id: doc.id }, version: fixture.db.contextDocs.evidenceVersion(doc.id, [segment.id], [fixture.assetA.id])! },
      purpose: 'style' as const, requiredness: 'required' as const,
      scope: { kind: 'segments' as const, segmentIds: [segment.id] }, anchorIds: [], rationale: 'required reference',
    }
    fixture.db.stageEvidence.create({
      stageRunId, sessionId: 'fragment-session',
      plan: { stageRunId, role: 'reviewer', stage: 'editing', assetIds: [fixture.assetA.id], segmentIds: [segment.id], requirements: [requirement] },
      baseline: createStageEvidenceBaseline({ stageRunId, discoveryScopeHash: 'scope', mappingRevision: 'v1', ruleSetRevision: 'v1', segmentIds: [segment.id], evidence: [requirement.evidence] }),
    })
    const prepared: RecordStageEvidenceReceiptInput[] = []
    const tools = createLinguistCatTools({ resolveProject: makeOkResolver(fixture), stageEvidenceRunId: stageRunId, sessionId: 'fragment-session', onEvidencePrepared: receipt => { prepared.push(receipt) } })
    const contextTool = toolByName(tools, 'cat_get_translation_context')
    const params = { segmentIds: [segment.id], includeNeighbors: false, tmLimitPerSegment: 0, termLimitPerSegment: 0, maxBytes: 1024 }
    const first = (await invoke(contextTool, params, 'first-fragment')).details as import('./types').CatGetTranslationContextResult
    assert.ok(first.contextFragment)
    await invoke(toolByName(tools, 'cat_read_context_doc'), { docId: doc.id, limit: 8000 }, 'body-read')
    const bodyReceipt = prepared.find(item => item.toolCallId === 'body-read')!
    fixture.db.stageEvidence.recordReceipt({ ...bodyReceipt, evidence: bodyReceipt.evidence.map(item => ({ ...item, submission: 'provider-response-v1' })) })
    assert.equal(fixture.db.stageEvidence.getPresentationCoverage(stageRunId).pending.length, 0)
    await assertThrowsCode(invoke(contextTool, { ...params, cursor: first.nextCursor }, 'old-fragment'), 'CONTEXT_DRIFT')
    assert.equal(fixture.db.stageEvidence.listReceipts(stageRunId).length, 1)
  } finally { fixture.db.close() }
})
