/**
 * LinguistProjectService 生命周期 / 句柄缓存 / 健康检查 / 备份（node --test）。
 * bun 无 node:sqlite，本文件不被 bun test 拾取（*.nodetest.ts）。
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { ProjectDatabase, StoreReadOnlyError } from '@linguist/cat-store'
import {
  LinguistExportBlockedByQaError,
  LinguistProjectArchivedError,
  LinguistProjectNotFoundError,
} from './errors'
import { LinguistProjectService } from './project-service'
import { INPUT, makeService, makeTempDir, readFixture } from './test/service-testkit'

test('lifecycle: create → list → get → paths → archive（含显式 workspace id 透传）', () => {
  const service = makeService()
  try {
    const status = service.getStatus()
    assert.equal(status.degraded, false)
    assert.equal(status.sqlite.ok, true)

    const project = service.createProject(INPUT)
    assert.match(project.id, /^prj-/)
    assert.equal(project.promaWorkspaceId, 'ws-test-1')
    // 创建时已尽力预建 cat.db（含 migrations）
    assert.ok(existsSync(service.getProjectPaths(project.id).catDbPath))

    const explicit = service.createProject({ ...INPUT, name: 'B', promaWorkspaceId: 'ws-explicit' })
    assert.equal(explicit.promaWorkspaceId, 'ws-explicit')

    assert.deepEqual(service.listProjects().map((p) => p.id), [project.id, explicit.id])
    assert.equal(service.getProject(project.id).name, 'Demo')

    const paths = service.getProjectPaths(project.id)
    assert.ok(paths.projectDir.endsWith(join('projects', project.id)))
    assert.ok(paths.catDbPath.endsWith('cat.db'))
    assert.ok(paths.projectJsonPath.endsWith('project.json'))

    const archived = service.archiveProject(project.id)
    assert.equal(typeof archived.archivedAt, 'string')
    assert.deepEqual(service.listProjects().map((p) => p.id), [explicit.id])
    assert.deepEqual(
      service.listProjects({ includeArchived: true }).map((p) => p.id),
      [project.id, explicit.id],
    )
  } finally {
    service.closeAll()
  }
})

test('default workspace allocator follows agent-workspace id convention (randomUUID)', () => {
  const service = new LinguistProjectService({ rootDir: makeTempDir() })
  service.init()
  try {
    const project = service.createProject(INPUT)
    assert.match(
      project.promaWorkspaceId,
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    )
  } finally {
    service.closeAll()
  }
})

test('setQualityProfile: 新建项目缺省 balanced；设置后 round-trip；归档拒绝；不存在 PROJECT_NOT_FOUND', () => {
  const service = makeService()
  try {
    const project = service.createProject(INPUT)
    // 新建项目不写该字段（读取规范化兜底为 balanced）
    assert.equal(service.getProject(project.id).qualityProfile, 'balanced')

    const updated = service.setQualityProfile(project.id, 'best')
    assert.equal(updated.qualityProfile, 'best')
    assert.notEqual(updated.updatedAt, project.updatedAt)
    assert.equal(service.getProject(project.id).qualityProfile, 'best')
    // project.json 落盘携带新值
    const rawMeta = JSON.parse(
      readFileSync(service.getProjectPaths(project.id).projectJsonPath, 'utf8'),
    ) as Record<string, unknown>
    assert.equal(rawMeta.qualityProfile, 'best')

    assert.throws(
      () => service.setQualityProfile('prj-0000000000000000', 'fast'),
      (err: unknown) => {
        assert.ok(err instanceof LinguistProjectNotFoundError)
        assert.equal(err.code, 'PROJECT_NOT_FOUND')
        return true
      },
    )

    service.archiveProject(project.id)
    assert.throws(
      () => service.setQualityProfile(project.id, 'fast'),
      (err: unknown) => {
        assert.ok(err instanceof LinguistProjectArchivedError)
        assert.equal(err.code, 'PROJECT_ARCHIVED')
        return true
      },
    )
    // 拒绝后原值不变
    assert.equal(service.getProject(project.id).qualityProfile, 'best')
  } finally {
    service.closeAll()
  }
})

test('archived project opens read-only; writes rejected at store and service level', async () => {
  const service = makeService()
  try {
    const project = service.createProject(INPUT)
    const bytes = readFixture('mini_dialogue.csv')
    await service.importAsset(project.id, { bytes, filename: 'mini_dialogue.csv' })

    service.archiveProject(project.id)

    const handle = service.openProject(project.id)
    assert.equal(handle.readOnly, true)
    assert.throws(() => handle.segments.setLocked('seg-x', true), StoreReadOnlyError)

    await assert.rejects(
      () => service.importAsset(project.id, { bytes, filename: 'mini_dialogue.csv' }),
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

test('openProject caches handles; closeProject drops; mode changes reopen; archived forces read-only', () => {
  const service = makeService()
  try {
    const project = service.createProject(INPUT)

    const a = service.openProject(project.id)
    assert.equal(a.readOnly, false)
    assert.equal(service.openProject(project.id), a)

    service.closeProject(project.id)
    const b = service.openProject(project.id)
    assert.notEqual(a, b)

    // 可写缓存 + 只读请求 → 重开只读句柄
    const ro = service.openProject(project.id, { readOnly: true })
    assert.notEqual(b, ro)
    assert.equal(ro.readOnly, true)
    // 只读缓存 + 可写请求 → 重开可写句柄
    const w = service.openProject(project.id)
    assert.equal(w.readOnly, false)

    // 归档后即使请求可写也强制只读（fail closed）
    service.archiveProject(project.id)
    assert.equal(service.openProject(project.id).readOnly, true)
  } finally {
    service.closeAll()
  }
})

test('health report: healthy project passes all checks', async () => {
  const service = makeService()
  try {
    const project = service.createProject(INPUT)
    await service.importAsset(project.id, { bytes: readFixture('mini_items.json'), filename: 'mini_items.json' })
    const report = service.checkProjectHealth(project.id)
    assert.equal(report.projectId, project.id)
    assert.equal(report.kind, 'quick')
    assert.equal(report.healthy, true)
    assert.deepEqual(
      report.checks.map((c) => c.id),
      ['project_json', 'cat_db_open', 'schema_version', 'asset_sources'],
    )
    assert.ok(report.checks.every((c) => c.ok))
    assert.deepEqual(
      report.checks.map((c) => c.scope),
      ['complete', 'complete', 'complete', 'sampled'],
    )
    assert.equal(report.checks[3]?.checkedItems, 1)
    assert.equal(report.checks[3]?.totalItems, 1)
    assert.match(report.checks[3]?.detail ?? '', /1 checked/)
  } finally {
    service.closeAll()
  }
})

test('health report: missing cat.db / corrupt project.json / tampered source blob fail closed', async () => {
  // cat.db 缺失
  const s1 = makeService()
  try {
    const p1 = s1.createProject(INPUT)
    rmSync(s1.getProjectPaths(p1.id).catDbPath)
    const report = s1.checkProjectHealth(p1.id)
    assert.equal(report.healthy, false)
    assert.equal(report.checks.find((c) => c.id === 'project_json')?.ok, true)
    assert.equal(report.checks.find((c) => c.id === 'cat_db_open')?.ok, false)
    assert.equal(report.checks.find((c) => c.id === 'cat_db_open')?.detail, 'STORE_NOT_FOUND')
  } finally {
    s1.closeAll()
  }

  // project.json 损坏
  const s2 = makeService()
  try {
    const p2 = s2.createProject(INPUT)
    writeFileSync(s2.getProjectPaths(p2.id).projectJsonPath, '{oops', 'utf8')
    const report = s2.checkProjectHealth(p2.id)
    assert.equal(report.healthy, false)
    assert.equal(report.checks.find((c) => c.id === 'project_json')?.ok, false)
    assert.equal(report.checks.find((c) => c.id === 'project_json')?.detail, 'STORE_INDEX_CORRUPT')
    assert.equal(report.checks.find((c) => c.id === 'cat_db_open')?.ok, false)
    assert.equal(report.checks.find((c) => c.id === 'cat_db_open')?.detail, 'STORE_INDEX_CORRUPT')
  } finally {
    s2.closeAll()
  }

  // source blob 被篡改 → sha256 抽查失败
  const s3 = makeService()
  try {
    const p3 = s3.createProject(INPUT)
    const imported = await s3.importAsset(p3.id, { bytes: readFixture('mini_items.json'), filename: 'mini_items.json' })
    writeFileSync(join(s3.getProjectPaths(p3.id).sourceDir, `${imported.assetId}.json`), 'tampered')
    const report = s3.checkProjectHealth(p3.id)
    assert.equal(report.healthy, false)
    const sources = report.checks.find((c) => c.id === 'asset_sources')
    assert.equal(sources?.ok, false)
    assert.match(sources?.detail ?? '', /STORE_ASSET_SOURCE_MISMATCH/)
  } finally {
    s3.closeAll()
  }

  // PB-110：asset 行在、source blob 缺（旧导入次序的崩溃窗口残留）
  // → 健康检查必须能发现（STORE_NOT_FOUND）
  const s4 = makeService()
  try {
    const p4 = s4.createProject(INPUT)
    const imported = await s4.importAsset(p4.id, { bytes: readFixture('mini_items.json'), filename: 'mini_items.json' })
    rmSync(join(s4.getProjectPaths(p4.id).sourceDir, `${imported.assetId}.json`))
    const report = s4.checkProjectHealth(p4.id)
    assert.equal(report.healthy, false)
    const sources = report.checks.find((c) => c.id === 'asset_sources')
    assert.equal(sources?.ok, false)
    assert.match(sources?.detail ?? '', /STORE_NOT_FOUND/)
  } finally {
    s4.closeAll()
  }
})

test('health check on archived project works (read-only) and stays healthy', async () => {
  const service = makeService()
  try {
    const project = service.createProject(INPUT)
    await service.importAsset(project.id, { bytes: readFixture('mini_items.json'), filename: 'mini_items.json' })
    service.archiveProject(project.id)
    assert.equal(service.checkProjectHealth(project.id).healthy, true)
  } finally {
    service.closeAll()
  }
})

test('backup produces a full directory backup (PB-111) and returns name + root-relative dir', async () => {
  const service = makeService()
  try {
    const project = service.createProject(INPUT)
    const imported = await service.importAsset(project.id, { bytes: readFixture('mini_dialogue.csv'), filename: 'mini_dialogue.csv' })

    const backup = service.backupProject(project.id)
    assert.ok(backup.backupName.startsWith('backup-'))
    assert.ok(backup.backupDir.startsWith(join('projects', project.id, 'backups', 'backup-')))
    assert.equal(backup.method, 'vacuum_into')
    // 相对路径不泄露根外信息
    assert.ok(!backup.backupDir.startsWith('/') && !backup.backupDir.includes('..'))
    assert.ok(backup.fileCount >= 3, 'manifest 至少含 cat.db / project.json / source blob')
    assert.ok(backup.totalSizeBytes > 0)
    assert.ok(backup.schemaVersion > 0)

    const absDir = join(service.rootDir, backup.backupDir)
    assert.ok(existsSync(join(absDir, 'cat.db')))
    assert.ok(existsSync(join(absDir, 'project.json')))
    assert.ok(existsSync(join(absDir, 'manifest.json')))
    // source blob 随备份走（PB-111 票面：source/blobs 进备份）
    assert.equal(readdirSync(join(absDir, 'source')).length, 1)

    // 备份副本可只读打开且数据完整
    const copy = ProjectDatabase.open(join(absDir, 'cat.db'), { projectId: project.id, readOnly: true })
    try {
      assert.equal(copy.assets.get(imported.assetId)?.segmentCount, imported.segmentCount)
    } finally {
      copy.close()
    }
  } finally {
    service.closeAll()
  }
})

test('unknown project id maps to PROJECT_NOT_FOUND across operations', async () => {
  const service = makeService()
  try {
    const UNKNOWN = 'prj-0000000000000000'
    for (const fn of [
      () => service.getProject(UNKNOWN),
      () => service.openProject(UNKNOWN),
      () => service.archiveProject(UNKNOWN),
      () => service.backupProject(UNKNOWN),
      () => service.checkProjectHealth(UNKNOWN),
      () => service.getProjectPaths(UNKNOWN),
    ]) {
      assert.throws(fn, (err: unknown) => {
        assert.ok(err instanceof LinguistProjectNotFoundError)
        assert.equal(err.code, 'PROJECT_NOT_FOUND')
        return true
      })
    }
    await assert.rejects(
      () => service.importAsset(UNKNOWN, { bytes: new Uint8Array(0), filename: 'x.csv' }),
      LinguistProjectNotFoundError,
    )
  } finally {
    service.closeAll()
  }
})

test('PB-072: blocking QA prevents staging; explicit human waivers allow a verified export without touching source', async () => {
  const service = makeService()
  try {
    const project = service.createProject(INPUT)
    const imported = await service.importAsset(project.id, {
      bytes: readFixture('mini_items.json'),
      filename: 'mini_items.json',
    })
    const sourcePath = join(service.getProjectPaths(project.id).sourceDir, `${imported.assetId}.json`)
    const originalSource = readFileSync(sourcePath)

    assert.equal(service.runQa(project.id).filter((finding) => finding.severity === 'L0' || finding.severity === 'L1').length, 7)
    await assert.rejects(
      () => service.stageExport(project.id, imported.assetId),
      (err: unknown) => {
        assert.ok(err instanceof LinguistExportBlockedByQaError)
        assert.equal(err.code, 'EXPORT_BLOCKED_BY_QA')
        assert.equal(err.openBlockingFindings, 7)
        return true
      },
    )
    assert.deepEqual(service.openProject(project.id).exports.listByAsset(imported.assetId), [])

    for (const finding of service.listQaFindings(project.id, { status: 'open' }).items) {
      service.waiveQaFinding(
        project.id,
        finding.id,
        '本次人工确认允许导出',
        '测试审校员',
      )
    }
    const staged = await service.stageExport(project.id, imported.assetId)
    assert.ok(staged.relativePath.startsWith('exports/'))
    assert.ok(existsSync(staged.stagingPath))
    assert.equal(staged.artifact.assetId, imported.assetId)
    assert.match(staged.artifact.sha256, /^[a-f0-9]{64}$/)
    assert.equal(staged.verifiedSegments, imported.segmentCount)
    assert.deepEqual(readFileSync(sourcePath), originalSource)
    assert.deepEqual(service.openProject(project.id).exports.listByAsset(imported.assetId), [staged.artifact])
  } finally {
    service.closeAll()
  }
})

test('getProjectSummary includes Store-derived per-asset progress and open QA counts', async () => {
  const service = makeService()
  try {
    const project = service.createProject(INPUT)

    // 空项目：assets 为空数组（不是 undefined），计数全零
    const empty = service.getProjectSummary(project.id)
    assert.deepEqual(empty.assets, [])
    assert.equal(empty.assetCount, 0)
    assert.equal(empty.totalSegments, 0)

    // 导入两个不同 fixture → 资产按创建序累积，字段与导入结果一一对应
    const first = await service.importAsset(project.id, {
      bytes: readFixture('mini_dialogue.csv'),
      filename: 'mini_dialogue.csv',
    })
    const second = await service.importAsset(project.id, {
      bytes: readFixture('mini_items.json'),
      filename: 'mini_items.json',
    })

    const db = service.openProject(project.id)
    const [firstSegment] = db.segments.query({ assetId: first.assetId, limit: 1 })
    const [secondSegment] = db.segments.query({ assetId: second.assetId, limit: 1 })
    assert.ok(firstSegment)
    assert.ok(secondSegment)
    db.segments.applyTargetEdit(firstSegment.id, '已确认', firstSegment.revision, { status: 'reviewed' })
    db.segments.applyTargetEdit(secondSegment.id, '已翻译', secondSegment.revision, { status: 'translated' })
    db.qaFindings.replaceForSegment(firstSegment.id, [
      { segmentId: firstSegment.id, code: 'FIRST', severity: 'L2', message: 'first' },
      { segmentId: firstSegment.id, code: 'SECOND', severity: 'L3', message: 'second' },
    ])
    const [resolved] = db.qaFindings.list({ segmentId: firstSegment.id, status: 'open' })
    assert.ok(resolved)
    db.qaFindings.transition(resolved.id, 'resolved')

    const summary = service.getProjectSummary(project.id)
    assert.equal(summary.assetCount, 2)
    assert.equal(summary.assets.length, 2)
    assert.equal(summary.totalSegments, first.segmentCount + second.segmentCount)

    const [a1, a2] = summary.assets
    const {
      segmentCounts: a1SegmentCounts,
      currentStageCounts: a1CurrentStageCounts,
      openQaCount: a1OpenQaCount,
      ...a1Metadata
    } = a1!
    const {
      segmentCounts: a2SegmentCounts,
      currentStageCounts: a2CurrentStageCounts,
      openQaCount: a2OpenQaCount,
      ...a2Metadata
    } = a2!
    assert.deepEqual(a1Metadata, {
      assetId: first.assetId,
      filename: 'mini_dialogue.csv',
      formatId: first.formatId,
      segmentCount: first.segmentCount,
      sourceSha256: first.sourceSha256,
    })
    assert.deepEqual(a2Metadata, {
      assetId: second.assetId,
      filename: 'mini_items.json',
      formatId: second.formatId,
      segmentCount: second.segmentCount,
      sourceSha256: second.sourceSha256,
    })
    assert.deepEqual(a1SegmentCounts, db.segments.countByAssetAndStatus().get(first.assetId))
    assert.deepEqual(a2SegmentCounts, db.segments.countByAssetAndStatus().get(second.assetId))
    assert.deepEqual(
      a1CurrentStageCounts,
      db.segments.countByAssetAndCurrentStageState().get(first.assetId),
    )
    assert.deepEqual(
      a2CurrentStageCounts,
      db.segments.countByAssetAndCurrentStageState().get(second.assetId),
    )
    assert.equal(a1SegmentCounts.reviewed, 1)
    assert.equal(a1OpenQaCount, 1)
    assert.equal(a2OpenQaCount, 0)
    // 线格式形状含每资产 Store 聚合；sha 为 64 位 hex。
    assert.deepEqual(
      Object.keys(a1!).sort(),
      [
        'assetId',
        'currentStageCounts',
        'filename',
        'formatId',
        'openQaCount',
        'segmentCount',
        'segmentCounts',
        'sourceSha256',
      ],
    )
    assert.match(a1!.sourceSha256, /^[0-9a-f]{64}$/)
  } finally {
    service.closeAll()
  }
})

test('Prepare Delivery: E 阶段先报告阻断，全部确认后验证 SDL 状态、标签、变化数和 SHA', async () => {
  const service = makeService()
  try {
    const project = service.createProject({
      name: 'Delivery',
      sourceLocale: 'zh-CN',
      targetLocale: 'en-US',
      workflowStage: 'editing',
    })
    const imported = await service.importAsset(project.id, {
      bytes: readFixture('minimal_delivery.sdlxliff'),
      filename: 'minimal_delivery.sdlxliff',
    })
    const db = service.openProject(project.id)
    const segments = db.segments.query({ assetId: imported.assetId, limit: 10 })
    const pending = db.proposals.insertPending({
      segmentId: segments[0]!.id,
      baseRevision: segments[0]!.revision,
      proposedTarget: segments[0]!.target,
      evidenceRefs: [],
      termRefs: [],
      warnings: [],
    })

    const blocked = await service.prepareDelivery(project.id, imported.assetId)
    assert.equal(blocked.preflight.ready, false)
    assert.equal(blocked.preflight.pendingProposalCount, 1)
    assert.equal(blocked.preflight.unconfirmedUnlockedSegments, 2)
    assert.deepEqual(blocked.preflight.blockers.map((blocker) => blocker.code), [
      'PENDING_PROPOSALS',
      'UNCONFIRMED_SEGMENTS',
    ])
    assert.equal(blocked.verification, undefined)
    assert.equal(blocked.reportMarkdown.includes('不可交付'), true)

    db.proposals.reject(pending.id)
    for (const segment of segments) {
      db.segments.confirmCurrentStage(segment.id, 'editing', segment.revision)
    }
    db.qaFindings.replaceForSegment(segments[0]!.id, [{
      segmentId: segments[0]!.id,
      code: 'STYLE_NOTE',
      severity: 'L2',
      message: 'style',
    }])
    const [waived] = db.qaFindings.list({ segmentId: segments[0]!.id, status: 'open' })
    assert.ok(waived)
    db.qaFindings.transition(waived.id, 'waived', {
      reason: '客户确认',
      operator: 'reviewer',
      at: '2026-07-29T12:00:00.000Z',
    })
    db.qaFindings.replaceForSegment(segments[1]!.id, [{
      segmentId: segments[1]!.id,
      code: 'STYLE_WARNING',
      severity: 'L3',
      message: 'style warning',
    }])

    const prepared = await service.prepareDelivery(project.id, imported.assetId)
    assert.equal(prepared.preflight.ready, true)
    assert.equal(prepared.preflight.expectedNativeStatus, 'ApprovedTranslation')
    assert.equal(prepared.preflight.qa.openErrors, 0)
    assert.equal(prepared.preflight.qa.openWarnings, 1)
    assert.equal(prepared.preflight.qa.waived, 1)
    assert.deepEqual(prepared.preflight.stageCounts, {
      untouched: 0,
      draft: 0,
      confirmed: 2,
    })
    assert.ok(prepared.verification)
    assert.equal(prepared.verification.verifiedSegments, 2)
    assert.equal(prepared.verification.verifiedSourceSegments, 2)
    assert.equal(prepared.verification.verifiedTargetSegments, 2)
    assert.equal(prepared.verification.verifiedNativeStatusSegments, 2)
    assert.equal(prepared.verification.changedTargetSegments, 0)
    assert.equal(prepared.verification.changedNativeStatusSegments, 2)
    assert.equal(prepared.verification.tagsPreserved, true)
    assert.match(prepared.verification.sha256, /^[0-9a-f]{64}$/)
    assert.equal(
      prepared.verification.suggestedFilename,
      'minimal_delivery.translated.en-US.sdlxliff',
    )
    assert.equal(prepared.reportMarkdown.includes('ApprovedTranslation'), true)
    assert.equal(prepared.reportMarkdown.includes(prepared.verification.sha256), true)
  } finally {
    service.closeAll()
  }
})
