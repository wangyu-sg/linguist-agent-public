/**
 * LA-INTAKE-007 导入验证报告 + 条件撤销（node --test）：
 * - importAsset 结果携带结构化 Verification Report（段数/格式/语言对/
 *   source hash）；验证在插入同事务内回读，失败即整批回滚；
 * - undoImportAsset：Proposal/QA/历史评审件/导出/人工编辑任一引用即拒绝
 *   （IMPORT_UNDO_BLOCKED，detail 只含分类计数）；干净批次一键撤销
 *   （asset + segments + source blob 全消失）。归档 fail closed。
 * bun 无 node:sqlite，本文件不被 bun test 拾取（*.nodetest.ts）。
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import {
  CatFormatRegistry,
  sha256Hex,
  type CatFormatAdapter,
} from '@linguist/cat-formats'
import { assetSourceFileName } from '@linguist/cat-store'
import {
  LinguistImportUndoBlockedError,
  LinguistImportVerificationFailedError,
  LinguistProjectArchivedError,
} from './errors'
import { LinguistProjectService } from './project-service'
import { INPUT, makeClock, makeEntropy, makeService, makeTempDir, readFixture } from './test/service-testkit'

const CSV_FIXTURE = 'mini_dialogue.csv'

/** 导入 CSV fixture 并返回常用上下文。 */
async function importCsv(service: LinguistProjectService, projectId: string) {
  const bytes = readFixture(CSV_FIXTURE)
  const result = await service.importAsset(projectId, { bytes, filename: CSV_FIXTURE })
  assert.equal(result.status, 'imported')
  const db = service.openProject(projectId)
  const segments = db.segments.query({ assetId: result.assetId, limit: 1000 })
  return { bytes, result, db, segments }
}

function insertLegacyCriticArtifact(db: ReturnType<LinguistProjectService['openProject']>, segmentId: string) {
  db.catDb.db.prepare(`
    INSERT INTO critic_artifacts (artifact_id, segment_id, created_at, artifact_json)
    VALUES (?, ?, ?, ?)
  `).run('legacy-import-undo', segmentId, '2026-08-10T00:00:00.000Z', '{}')
}

/** 撤销被拒绝的公共断言：typed error + 下游计数精确 + 资产仍在。 */
function assertUndoBlocked(
  err: unknown,
  expected: Partial<Record<'proposals' | 'qaFindings' | 'legacyCriticArtifacts' | 'exports' | 'editedSegments' | 'jobs', number>>,
): asserts err is LinguistImportUndoBlockedError {
  assert.ok(err instanceof LinguistImportUndoBlockedError)
  assert.equal(err.code, 'IMPORT_UNDO_BLOCKED')
  assert.deepEqual(err.details, {
    proposals: 0,
    qaFindings: 0,
    legacyCriticArtifacts: 0,
    exports: 0,
    editedSegments: 0,
    jobs: 0,
    ...expected,
  })
}

test('import carries a structured verification report: four checks all passed', async () => {
  const service = makeService()
  try {
    const project = service.createProject(INPUT)
    const { result } = await importCsv(service, project.id)
    assert.equal(result.verification.ok, true)
    assert.deepEqual(
      result.verification.checks.map((check) => check.id),
      ['segment-count', 'format', 'language-pair', 'source-hash'],
    )
    for (const check of result.verification.checks) {
      assert.equal(check.passed, true, `${check.id}: ${check.detail}`)
      assert.equal(typeof check.detail, 'string')
    }
  } finally {
    service.closeAll()
  }
})

test('skipped-duplicate also carries a verification report (read-only, never throws)', async () => {
  const service = makeService()
  try {
    const project = service.createProject(INPUT)
    const bytes = readFixture(CSV_FIXTURE)
    await service.importAsset(project.id, { bytes, filename: CSV_FIXTURE })
    const duplicate = await service.importAsset(project.id, { bytes, filename: 'renamed.csv' })
    assert.equal(duplicate.status, 'skipped-duplicate')
    assert.equal(duplicate.verification.ok, true)
    assert.equal(duplicate.verification.checks.length, 4)
  } finally {
    service.closeAll()
  }
})

test('verification failure rolls the whole import back (IMPORT_VERIFICATION_FAILED, zero rows)', async () => {
  // 谎报 segmentCount 的 adapter：插入 1 段但声明 5 段，
  // 同事务回读验证的 segment-count 检查必须失败并触发整批回滚。
  const lyingAdapter: CatFormatAdapter = {
    id: 'lying_count',
    extensions: ['.lie'],
    detect: async (_bytes, filename) => (filename.endsWith('.lie') ? 1 : 0),
    import: async (input) => ({
      asset: {
        formatId: 'lying_count',
        originalFilename: input.filename,
        sourceSha256: sha256Hex(input.bytes),
        segmentCount: 5,
      },
      segments: [{
        ordinal: 0,
        key: 'k0',
        source: 's',
        target: '',
        sourceLocale: input.sourceLocale,
        targetLocale: input.targetLocale,
        status: 'untranslated',
        locked: false,
        revision: 0,
        sourceHash: 'h0',
      }],
      warnings: [],
      originalBytes: input.bytes,
    }),
    export: async () => {
      throw new Error('never reached')
    },
  }
  const registry = new CatFormatRegistry().register(lyingAdapter)
  let workspaceSeq = 0
  const service = new LinguistProjectService({
    rootDir: makeTempDir(),
    registry,
    entropy: makeEntropy('la-intake-007-verify'),
    now: makeClock(),
    workspaceCreator: () => `ws-la007-${++workspaceSeq}`,
  })
  service.init()
  try {
    const project = service.createProject(INPUT)
    await assert.rejects(
      () => service.importAsset(project.id, { bytes: new Uint8Array([1, 2, 3]), filename: 'bad.lie' }),
      (err: unknown) => {
        assert.ok(err instanceof LinguistImportVerificationFailedError)
        assert.equal(err.code, 'IMPORT_VERIFICATION_FAILED')
        assert.deepEqual(err.failedChecks, ['segment-count'])
        return true
      },
    )
    const db = service.openProject(project.id)
    assert.equal(db.assets.listByProject().length, 0, '验证失败不得留下 asset 行')
    assert.equal(db.segments.count({}), 0, '验证失败不得留下 segment 行')
  } finally {
    service.closeAll()
  }
})

test('undo blocked by a pending proposal; reference counts are exact and carry no client text', async () => {
  const service = makeService()
  try {
    const project = service.createProject(INPUT)
    const { result, db, segments } = await importCsv(service, project.id)
    const segment = segments[0]!
    db.proposals.insertPending({
      segmentId: segment.id,
      baseRevision: 0,
      proposedTarget: `${segment.target}（改）`,
    })
    assert.throws(
      () => service.undoImportAsset(project.id, result.assetId),
      (err: unknown) => {
        assertUndoBlocked(err, { proposals: 1 })
        return true
      },
    )
    assert.ok(db.assets.get(result.assetId) !== undefined, '拒绝撤销后资产必须仍在')
    assert.equal(db.segments.count({ assetId: result.assetId }), result.segmentCount)
  } finally {
    service.closeAll()
  }
})

test('undo blocked by QA findings and by legacy critic artifacts (each category counted)', async () => {
  const service = makeService()
  try {
    const project = service.createProject(INPUT)
    // 批次 A：QA finding；批次 B：评审件
    const a = await importCsv(service, project.id)
    a.db.qaFindings.insertOpen([{
      segmentId: a.segments[0]!.id,
      code: 'EMPTY_TARGET',
      severity: 'L1',
      message: '译文为空',
    }])
    assert.throws(
      () => service.undoImportAsset(project.id, a.result.assetId),
      (err: unknown) => {
        assertUndoBlocked(err, { qaFindings: 1 })
        return true
      },
    )

    const bBytes = readFixture('mini_items.json')
    const bResult = await service.importAsset(project.id, { bytes: bBytes, filename: 'mini_items.json' })
    const bDb = service.openProject(project.id)
    const bSegments = bDb.segments.query({ assetId: bResult.assetId, limit: 1000 })
    insertLegacyCriticArtifact(bDb, bSegments[0]!.id)
    assert.throws(
      () => service.undoImportAsset(project.id, bResult.assetId),
      (err: unknown) => {
        assertUndoBlocked(err, { legacyCriticArtifacts: 1 })
        return true
      },
    )
  } finally {
    service.closeAll()
  }
})

test('undo blocked by an export record and by human edits; combined counts exact', async () => {
  const service = makeService()
  try {
    const project = service.createProject(INPUT)
    const { result, db, segments } = await importCsv(service, project.id)
    // 人工编辑一段 + 记录一次导出 + 一条提案：三类计数同时精确
    db.segments.applyTargetEdit(segments[0]!.id, '人工译文', 0)
    db.exports.record({
      assetId: result.assetId,
      path: 'exports/demo.csv',
      sha256: 'e'.repeat(64),
      segmentCount: result.segmentCount,
    })
    db.proposals.insertPending({
      segmentId: segments[1]!.id,
      baseRevision: 0,
      proposedTarget: '提案译文',
    })
    assert.throws(
      () => service.undoImportAsset(project.id, result.assetId),
      (err: unknown) => {
        assertUndoBlocked(err, { proposals: 1, exports: 1, editedSegments: 1 })
        return true
      },
    )
  } finally {
    service.closeAll()
  }
})

test('undo blocked by a durable translation job, so its frozen segment scope cannot become dangling', async () => {
  const service = makeService()
  try {
    const project = service.createProject(INPUT)
    const { result, db, segments } = await importCsv(service, project.id)
    db.runs.createJob({
      jobId: 'job-import-undo',
      runId: 'run-import-undo',
      sessionId: 'session-import-undo',
      strategy: 'balanced',
      segmentIds: segments.map((segment) => segment.id),
      provenance: { schemaVersion: 1, runtime: 'test' },
    })

    assert.throws(
      () => service.undoImportAsset(project.id, result.assetId),
      (err: unknown) => {
        assertUndoBlocked(err, { jobs: 1 })
        return true
      },
    )
    assert.ok(db.assets.get(result.assetId) !== undefined, 'refused undo must leave the batch intact')
    assert.equal(service.checkProjectHealth(project.id).healthy, true)
  } finally {
    service.closeAll()
  }
})

test('clean undo removes asset + segments + source blob; re-import stays possible', async () => {
  const service = makeService()
  try {
    const project = service.createProject(INPUT)
    const { bytes, result, db } = await importCsv(service, project.id)
    const asset = db.assets.get(result.assetId)!
    const blobPath = join(service.getProjectPaths(project.id).sourceDir, assetSourceFileName(asset))
    assert.ok(existsSync(blobPath))

    const undone = service.undoImportAsset(project.id, result.assetId)
    assert.equal(undone.assetId, result.assetId)
    assert.equal(undone.deletedSegments, result.segmentCount)
    assert.equal(undone.sourceBlobRemoved, true)

    assert.equal(db.assets.get(result.assetId), undefined)
    assert.equal(db.segments.count({ assetId: result.assetId }), 0)
    assert.equal(existsSync(blobPath), false, 'source blob 必须随撤销消失')
    assert.equal(service.checkProjectHealth(project.id).healthy, true)

    // 撤销后同源字节可重新导入（重复检测不再命中已删资产）
    const reimported = await service.importAsset(project.id, { bytes, filename: CSV_FIXTURE })
    assert.equal(reimported.status, 'imported')
  } finally {
    service.closeAll()
  }
})

test('undo on archived project fails closed (PROJECT_ARCHIVED); unknown asset is STORE_NOT_FOUND', async () => {
  const service = makeService()
  try {
    const project = service.createProject(INPUT)
    const { result } = await importCsv(service, project.id)
    assert.throws(
      () => service.undoImportAsset(project.id, 'ast-0000000000000000'),
      (err: unknown) => (err as { code?: string }).code === 'STORE_NOT_FOUND',
    )
    service.archiveProject(project.id)
    assert.throws(
      () => service.undoImportAsset(project.id, result.assetId),
      (err: unknown) => {
        assert.ok(err instanceof LinguistProjectArchivedError)
        assert.equal(err.code, 'PROJECT_ARCHIVED')
        return true
      },
    )
  } finally {
    service.closeAll()
  }
})
