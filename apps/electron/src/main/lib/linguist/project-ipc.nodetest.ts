/**
 * Linguist 项目 typed IPC 处理器（node --test）：不经 Electron IPC 管线，
 * 直接驱动 createLinguistProjectIpc 的处理器（真实服务 + mkdtemp root +
 * stub picker + fixture 文件）。bun 无 node:sqlite，本文件不被 bun test
 * 拾取（*.nodetest.ts）。
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { LINGUIST_IMPORT_MAX_BYTES, type LinguistIpcResult } from '@proma/shared'
import { createLinguistProjectIpc, type LinguistImportFilePicker } from './project-ipc'
import type { LinguistProjectService } from './project-service'
import { INPUT, fixturePath, makeService, makeTempDir } from './test/service-testkit'

function makeIpc(service: LinguistProjectService) {
  return createLinguistProjectIpc({ getService: () => service })
}

/** picker stub：返回固定结果并记录调用次数（弹窗前校验不得触发 picker）。 */
function makePicker(filePaths: string[] | null): { picker: LinguistImportFilePicker; calls: () => number } {
  let calls = 0
  const picker: LinguistImportFilePicker = async () => {
    calls += 1
    return filePaths === null ? { canceled: true, filePaths: [] } : { canceled: false, filePaths }
  }
  return { picker, calls: () => calls }
}

const CSV_FIXTURE = 'mini_dialogue.csv'

test('happy path: create → list → open → getSummary → archive（信封 ok:true）', async () => {
  const service = makeService()
  try {
    const ipc = makeIpc(service)

    const created = await ipc.create({ ...INPUT })
    assert.equal(created.ok, true)
    if (!created.ok) return
    const projectId = created.data.id
    assert.match(projectId, /^prj-[0-9a-f]{16}$/)

    const listed = await ipc.list(undefined)
    assert.equal(listed.ok, true)
    if (listed.ok) assert.deepEqual(listed.data.map((p) => p.id), [projectId])

    const opened = await ipc.open({ projectId })
    assert.equal(opened.ok, true)
    if (opened.ok) {
      assert.equal(opened.data.project.id, projectId)
      assert.equal(opened.data.health.healthy, true)
      assert.deepEqual(
        opened.data.health.checks.map((c) => c.id),
        ['project_json', 'cat_db_open', 'schema_version', 'asset_sources'],
      )
    }

    const summary = await ipc.getSummary({ projectId })
    assert.equal(summary.ok, true)
    if (summary.ok) {
      assert.equal(summary.data.project.id, projectId)
      assert.equal(summary.data.assetCount, 0)
      assert.equal(summary.data.totalSegments, 0)
      assert.deepEqual(summary.data.segmentCounts, {
        untranslated: 0,
        draft: 0,
        translated: 0,
        reviewed: 0,
      })
    }

    const archived = await ipc.archive({ projectId })
    assert.equal(archived.ok, true)
    if (archived.ok) assert.equal(typeof archived.data.archivedAt, 'string')

    const listedAfter = await ipc.list({ includeArchived: false })
    assert.equal(listedAfter.ok, true)
    if (listedAfter.ok) assert.equal(listedAfter.data.length, 0)
    const listedAll = await ipc.list({ includeArchived: true })
    assert.equal(listedAll.ok, true)
    if (listedAll.ok) assert.equal(listedAll.data.length, 1)
  } finally {
    service.closeAll()
  }
})

test('rename and active reorder validate at IPC boundary and preserve archived tail', async () => {
  const service = makeService()
  try {
    const ipc = makeIpc(service)
    const first = service.createProject({ ...INPUT, name: '一' })
    const second = service.createProject({ ...INPUT, name: '二' })
    const archived = service.createProject({ ...INPUT, name: '归档' })
    service.archiveProject(archived.id)

    const renamed = await ipc.rename({ projectId: first.id, name: '新名称' })
    assert.equal(renamed.ok, true)
    if (renamed.ok) assert.equal(renamed.data.name, '新名称')

    const reordered = await ipc.reorderActive({
      orderedProjectIds: [second.id, first.id],
    })
    assert.equal(reordered.ok, true)
    if (reordered.ok) {
      assert.deepEqual(reordered.data.map((project) => project.id), [second.id, first.id])
    }
    assert.deepEqual(
      service.listProjects({ includeArchived: true }).map((project) => project.id),
      [second.id, first.id, archived.id],
    )

    const incomplete = await ipc.reorderActive({ orderedProjectIds: [first.id] })
    assert.equal(incomplete.ok, false)
    if (!incomplete.ok) assert.equal(incomplete.error.code, 'PROJECT_ORDER_CONFLICT')

    const invalidName = await ipc.rename({ projectId: first.id, name: '   ' })
    assert.equal(invalidName.ok, false)
    if (!invalidName.ok) assert.equal(invalidName.error.code, 'INVALID_INPUT')

    const archivedRename = await ipc.rename({ projectId: archived.id, name: '不可改名' })
    assert.equal(archivedRename.ok, false)
    if (!archivedRename.ok) assert.equal(archivedRename.error.code, 'PROJECT_ARCHIVED')
  } finally {
    service.closeAll()
  }
})

test('delete: requires archive and exact project-name confirmation, then moves project out of index', async () => {
  const service = makeService()
  try {
    const ipc = makeIpc(service)
    const project = service.createProject(INPUT)

    const active = await ipc.delete({ projectId: project.id, confirmationName: project.name })
    assert.equal(active.ok, false)
    if (!active.ok) assert.equal(active.error.code, 'PROJECT_DELETE_REQUIRES_ARCHIVE')

    await ipc.archive({ projectId: project.id })
    const mismatch = await ipc.delete({ projectId: project.id, confirmationName: `${project.name} ` })
    assert.equal(mismatch.ok, false)
    if (!mismatch.ok) assert.equal(mismatch.error.code, 'PROJECT_DELETE_CONFIRMATION_MISMATCH')

    const deleted = await ipc.delete({ projectId: project.id, confirmationName: project.name })
    assert.equal(deleted.ok, true)
    if (deleted.ok) {
      assert.equal(deleted.data.projectId, project.id)
      assert.match(deleted.data.recoveryName ?? '', new RegExp(`^${project.id}-`))
    }

    const listed = await ipc.list({ includeArchived: true })
    assert.equal(listed.ok, true)
    if (listed.ok) assert.equal(listed.data.some((item) => item.id === project.id), false)
  } finally {
    service.closeAll()
  }
})

test('validation negatives: bad id / bad locale / oversized name / wrong types → INVALID_INPUT', async () => {
  const service = makeService()
  try {
    const ipc = makeIpc(service)
    const project = service.createProject(INPUT)

    const cases: { name: string; run: () => Promise<LinguistIpcResult<unknown>> }[] = [
      { name: 'non-object input', run: () => ipc.create('nope') },
      { name: 'array input', run: () => ipc.create([]) },
      { name: 'bad projectId (not prj-)', run: () => ipc.open({ projectId: 'xyz' }) },
      { name: 'bad projectId (uppercase hex)', run: () => ipc.open({ projectId: 'prj-0123456789ABCDEF' }) },
      { name: 'bad projectId (short)', run: () => ipc.open({ projectId: 'prj-0123' }) },
      { name: 'numeric projectId', run: () => ipc.getSummary({ projectId: 42 }) },
      { name: 'bad locale (english)', run: () => ipc.create({ ...INPUT, sourceLocale: 'english' }) },
      { name: 'bad locale (en_)', run: () => ipc.create({ ...INPUT, targetLocale: 'en_US' }) },
      { name: 'bad locale (empty)', run: () => ipc.create({ ...INPUT, sourceLocale: '' }) },
      { name: 'oversized name (121)', run: () => ipc.create({ ...INPUT, name: 'x'.repeat(121) }) },
      { name: 'blank name', run: () => ipc.create({ ...INPUT, name: '   ' }) },
      { name: 'non-string name', run: () => ipc.create({ ...INPUT, name: 7 }) },
      { name: 'bad includeArchived', run: () => ipc.list({ includeArchived: 'yes' }) },
      { name: 'bad workspaceId (empty)', run: () => ipc.create({ ...INPUT, promaWorkspaceId: '' }) },
      { name: 'bad archive id', run: () => ipc.archive({ projectId: project.id.slice(0, -1) }) },
      { name: 'unknown profile literal', run: () => ipc.setQualityProfile({ projectId: project.id, profile: 'turbo' }) },
      { name: 'uppercase profile literal', run: () => ipc.setQualityProfile({ projectId: project.id, profile: 'FAST' }) },
      { name: 'missing profile', run: () => ipc.setQualityProfile({ projectId: project.id }) },
      { name: 'non-string profile', run: () => ipc.setQualityProfile({ projectId: project.id, profile: 1 }) },
      { name: 'bad setQualityProfile id', run: () => ipc.setQualityProfile({ projectId: 'nope', profile: 'fast' }) },
    ]
    for (const c of cases) {
      const result = await c.run()
      assert.equal(result.ok, false, c.name)
      if (!result.ok) assert.equal(result.error.code, 'INVALID_INPUT', c.name)
    }
  } finally {
    service.closeAll()
  }
})

test('unknown project id → PROJECT_NOT_FOUND across id-taking channels', async () => {
  const service = makeService()
  try {
    const ipc = makeIpc(service)
    const UNKNOWN = 'prj-0000000000000000'
    const { picker, calls } = makePicker([fixturePath(CSV_FIXTURE)])

    for (const run of [
      () => ipc.open({ projectId: UNKNOWN }),
      () => ipc.getSummary({ projectId: UNKNOWN }),
      () => ipc.archive({ projectId: UNKNOWN }),
      () => ipc.setQualityProfile({ projectId: UNKNOWN, profile: 'fast' }),
      () => ipc.import({ projectId: UNKNOWN }, picker),
    ]) {
      const result = await run()
      assert.equal(result.ok, false)
      if (!result.ok) assert.equal(result.error.code, 'PROJECT_NOT_FOUND')
    }
    // 项目校验失败时绝不触发 picker（弹窗前失败）
    assert.equal(calls(), 0)
  } finally {
    service.closeAll()
  }
})

test('setQualityProfile: 三档 round-trip 经信封返回更新后项目；归档 → PROJECT_ARCHIVED', async () => {
  const service = makeService()
  try {
    const ipc = makeIpc(service)
    const project = service.createProject(INPUT)

    // 新建项目经 open 通道返回缺省 balanced（读取规范化）
    const opened = await ipc.open({ projectId: project.id })
    assert.equal(opened.ok, true)
    if (opened.ok) assert.equal(opened.data.project.qualityProfile, 'balanced')

    for (const profile of ['fast', 'balanced', 'best'] as const) {
      const result = await ipc.setQualityProfile({ projectId: project.id, profile })
      assert.equal(result.ok, true, profile)
      if (result.ok) assert.equal(result.data.qualityProfile, profile)
      assert.equal(service.getProject(project.id).qualityProfile, profile)
    }

    await ipc.archive({ projectId: project.id })
    const rejected = await ipc.setQualityProfile({ projectId: project.id, profile: 'fast' })
    assert.equal(rejected.ok, false)
    if (!rejected.ok) assert.equal(rejected.error.code, 'PROJECT_ARCHIVED')
  } finally {
    service.closeAll()
  }
})

test('workflow config: 新建与修改 T/E/P 和原生输出策略均经严格 IPC 契约持久化', async () => {
  const service = makeService()
  try {
    const ipc = makeIpc(service)
    const created = await ipc.create({
      ...INPUT,
      workflowStage: 'editing',
      outputStatusPolicy: {
        sdlxliff_1_2: { editing: 'ApprovedTranslation' },
      },
      qaProfile: 'subtitle',
    })
    assert.equal(created.ok, true)
    if (!created.ok) return
    assert.equal(created.data.workflowStage, 'editing')
    assert.equal(created.data.qaProfile, 'subtitle')
    assert.equal(
      created.data.outputStatusPolicy?.sdlxliff_1_2?.editing,
      'ApprovedTranslation',
    )

    const updated = await ipc.setWorkflowConfig({
      projectId: created.data.id,
      workflowStage: 'proofreading',
      outputStatusPolicy: {
        sdlxliff_1_2: { proofreading: 'ApprovedSignOff' },
      },
      qaProfile: 'general',
    })
    assert.equal(updated.ok, true)
    if (updated.ok) {
      assert.equal(updated.data.workflowStage, 'proofreading')
      assert.equal(updated.data.qaProfile, 'general')
      assert.equal(
        updated.data.outputStatusPolicy?.sdlxliff_1_2?.proofreading,
        'ApprovedSignOff',
      )
    }

    for (const input of [
      { projectId: created.data.id, workflowStage: 'review' },
      { projectId: created.data.id, workflowStage: 'editing', qaProfile: 'game' },
      { projectId: created.data.id, workflowStage: 'editing', outputStatusPolicy: [] },
      {
        projectId: created.data.id,
        workflowStage: 'editing',
        outputStatusPolicy: { sdlxliff_1_2: { unknown: 'ApprovedTranslation' } },
      },
      {
        projectId: created.data.id,
        workflowStage: 'editing',
        outputStatusPolicy: { sdlxliff_1_2: { editing: '' } },
      },
    ]) {
      const result = await ipc.setWorkflowConfig(input)
      assert.equal(result.ok, false)
      if (!result.ok) assert.equal(result.error.code, 'INVALID_INPUT')
    }
  } finally {
    service.closeAll()
  }
})

test('import: user cancel is a typed result, not an error', async () => {
  const service = makeService()
  try {
    const ipc = makeIpc(service)
    const project = service.createProject(INPUT)
    const { picker } = makePicker(null)

    const result = await ipc.import({ projectId: project.id }, picker)
    assert.equal(result.ok, true)
    if (result.ok) assert.deepEqual(result.data, { cancelled: true })
  } finally {
    service.closeAll()
  }
})

test('import: main reads picked file itself and returns service result + basename', async () => {
  const service = makeService()
  try {
    const ipc = makeIpc(service)
    const project = service.createProject(INPUT)
    const { picker } = makePicker([fixturePath(CSV_FIXTURE)])

    const result = await ipc.import({ projectId: project.id }, picker)
    assert.equal(result.ok, true)
    if (!result.ok) return
    assert.equal(result.data.cancelled, false)
    if (result.data.cancelled) return
    assert.equal(result.data.filename, CSV_FIXTURE)
    assert.equal(result.data.status, 'imported')
    assert.match(result.data.assetId, /^ast_v2_[0-9a-f]{64}$/)
    assert.ok(result.data.segmentCount > 0)
    assert.ok(Array.isArray(result.data.warnings))
    assert.match(result.data.sourceSha256, /^[0-9a-f]{64}$/)

    // 摘要随即反映导入（计数通道联动）
    const summary = await ipc.getSummary({ projectId: project.id })
    assert.equal(summary.ok, true)
    if (summary.ok) {
      assert.equal(summary.data.assetCount, 1)
      assert.equal(summary.data.totalSegments, result.data.segmentCount)
      const sum = Object.values(summary.data.segmentCounts).reduce((a, b) => a + b, 0)
      assert.equal(sum, result.data.segmentCount)
    }
  } finally {
    service.closeAll()
  }
})

test('getSummary: assets list reflects imports in creation order (PB-033 wire shape)', async () => {
  const service = makeService()
  try {
    const ipc = makeIpc(service)
    const project = service.createProject(INPUT)

    // 空项目：assets 为空数组随信封返回（不是 undefined）
    const before = await ipc.getSummary({ projectId: project.id })
    assert.equal(before.ok, true)
    if (before.ok) assert.deepEqual(before.data.assets, [])

    const { picker: pickCsv } = makePicker([fixturePath(CSV_FIXTURE)])
    const importedCsv = await ipc.import({ projectId: project.id }, pickCsv)
    assert.equal(importedCsv.ok, true)
    if (!importedCsv.ok || importedCsv.data.cancelled) return

    const { picker: pickJson } = makePicker([fixturePath('mini_items.json')])
    const importedJson = await ipc.import({ projectId: project.id }, pickJson)
    assert.equal(importedJson.ok, true)
    if (!importedJson.ok || importedJson.data.cancelled) return

    // 摘要随即反映两次导入：资产按创建序累积，字段与导入结果一一对应
    const summary = await ipc.getSummary({ projectId: project.id })
    assert.equal(summary.ok, true)
    if (!summary.ok) return
    assert.equal(summary.data.assetCount, 2)
    assert.equal(summary.data.assets.length, 2)
    const [a1, a2] = summary.data.assets
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
      assetId: importedCsv.data.assetId,
      filename: CSV_FIXTURE,
      formatId: importedCsv.data.formatId,
      segmentCount: importedCsv.data.segmentCount,
      sourceSha256: importedCsv.data.sourceSha256,
    })
    assert.deepEqual(a2Metadata, {
      assetId: importedJson.data.assetId,
      filename: 'mini_items.json',
      formatId: importedJson.data.formatId,
      segmentCount: importedJson.data.segmentCount,
      sourceSha256: importedJson.data.sourceSha256,
    })
    assert.equal(Object.values(a1SegmentCounts).reduce((total, count) => total + count, 0), a1!.segmentCount)
    assert.equal(Object.values(a2SegmentCounts).reduce((total, count) => total + count, 0), a2!.segmentCount)
    assert.equal(Object.values(a1CurrentStageCounts).reduce((total, count) => total + count, 0), a1!.segmentCount)
    assert.equal(Object.values(a2CurrentStageCounts).reduce((total, count) => total + count, 0), a2!.segmentCount)
    assert.equal(a1OpenQaCount, 0)
    assert.equal(a2OpenQaCount, 0)
  } finally {
    service.closeAll()
  }
})

test('import: archived project rejected before picker (PROJECT_ARCHIVED)', async () => {
  const service = makeService()
  try {
    const ipc = makeIpc(service)
    const project = service.createProject(INPUT)
    await ipc.archive({ projectId: project.id })
    const { picker, calls } = makePicker([fixturePath(CSV_FIXTURE)])

    const result = await ipc.import({ projectId: project.id }, picker)
    assert.equal(result.ok, false)
    if (!result.ok) assert.equal(result.error.code, 'PROJECT_ARCHIVED')
    assert.equal(calls(), 0)
  } finally {
    service.closeAll()
  }
})

test('import: picked file over 50MB → IMPORT_TOO_LARGE（先于读盘，服务零写入）', async () => {
  const service = makeService()
  try {
    const ipc = makeIpc(service)
    const project = service.createProject(INPUT)
    const bigPath = join(makeTempDir(), 'big.xliff')
    writeFileSync(bigPath, new Uint8Array(LINGUIST_IMPORT_MAX_BYTES + 1))
    const { picker } = makePicker([bigPath])

    const result = await ipc.import({ projectId: project.id }, picker)
    assert.equal(result.ok, false)
    if (!result.ok) assert.equal(result.error.code, 'IMPORT_TOO_LARGE')
    assert.equal(service.openProject(project.id).assets.countByProject(), 0)
  } finally {
    service.closeAll()
  }
})

test('import: unsupported content passes FORMAT_UNSUPPORTED through', async () => {
  const service = makeService()
  try {
    const ipc = makeIpc(service)
    const project = service.createProject(INPUT)
    const binPath = join(makeTempDir(), 'data.bin')
    writeFileSync(binPath, new Uint8Array([0x00, 0x01, 0x02, 0x03, 0xff, 0xfe, 0xfd]))
    const { picker } = makePicker([binPath])

    const result = await ipc.import({ projectId: project.id }, picker)
    assert.equal(result.ok, false)
    if (!result.ok) assert.equal(result.error.code, 'FORMAT_UNSUPPORTED')
  } finally {
    service.closeAll()
  }
})

test('import: invalid projectId → INVALID_INPUT and picker never called', async () => {
  const service = makeService()
  try {
    const ipc = makeIpc(service)
    const { picker, calls } = makePicker([fixturePath(CSV_FIXTURE)])
    const result = await ipc.import({ projectId: 'bad' }, picker)
    assert.equal(result.ok, false)
    if (!result.ok) assert.equal(result.error.code, 'INVALID_INPUT')
    assert.equal(calls(), 0)
  } finally {
    service.closeAll()
  }
})

test('untyped errors collapse to INTERNAL without leaking internals', async () => {
  const broken = {
    listProjects() {
      throw new Error('boom: secret-internal-detail')
    },
  } as unknown as LinguistProjectService
  const ipc = createLinguistProjectIpc({ getService: () => broken })

  const result = await ipc.list(undefined)
  assert.equal(result.ok, false)
  if (!result.ok) {
    assert.equal(result.error.code, 'INTERNAL')
    assert.ok(!result.error.message.includes('secret-internal-detail'))
  }
})
