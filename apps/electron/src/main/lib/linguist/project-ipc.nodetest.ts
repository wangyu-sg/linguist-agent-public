/**
 * Linguist 项目 typed IPC 处理器（node --test）：不经 Electron IPC 管线，
 * 直接驱动 createLinguistProjectIpc 的处理器（真实服务 + mkdtemp root +
 * stub picker + fixture 文件）。bun 无 node:sqlite，本文件不被 bun test
 * 拾取（*.nodetest.ts）。
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { LINGUIST_IMPORT_MAX_BYTES, type LinguistIpcResult } from '@proma/shared'
import { XlsxAdapter } from '@linguist/cat-formats'
import JSZip from 'jszip'
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

/** Small real OOXML workbook: cover sheet first, nonstandard bilingual batch second. */
async function nonstandardXlsx(): Promise<Uint8Array> {
  const zip = new JSZip()
  zip.file('xl/workbook.xml', `<?xml version="1.0"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="封面" sheetId="1" r:id="rId1"/><sheet name="批次" sheetId="2" r:id="rId2"/></sheets></workbook>`)
  zip.file('xl/_rels/workbook.xml.rels', `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet2.xml"/></Relationships>`)
  zip.file('xl/worksheets/sheet1.xml', `<?xml version="1.0"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>说明</t></is></c></row><row r="2"><c r="A2" t="inlineStr"><is><t>不是翻译批次</t></is></c></row></sheetData></worksheet>`)
  zip.file('xl/worksheets/sheet2.xml', `<?xml version="1.0"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>文本编号</t></is></c><c r="B1" t="inlineStr"><is><t>中文原文</t></is></c><c r="C1" t="inlineStr"><is><t>英文译文</t></is></c><c r="D1" t="inlineStr"><is><t>备注</t></is></c></row><row r="2"><c r="A2" t="inlineStr"><is><t>menu.start</t></is></c><c r="B2" t="inlineStr"><is><t>开始游戏</t></is></c><c r="C2" t="inlineStr"><is><t></t></is></c><c r="D2" t="inlineStr"><is><t>主菜单</t></is></c></row></sheetData></worksheet>`)
  return zip.generateAsync({ type: 'uint8array' })
}

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
      { name: 'unknown independentReview literal', run: () => ipc.setExecutionPolicy({ projectId: project.id, executionPolicy: { independentReview: 'turbo' } }) },
      { name: 'uppercase independentReview literal', run: () => ipc.setExecutionPolicy({ projectId: project.id, executionPolicy: { independentReview: 'OFF' } }) },
      { name: 'missing executionPolicy', run: () => ipc.setExecutionPolicy({ projectId: project.id }) },
      { name: 'non-object executionPolicy', run: () => ipc.setExecutionPolicy({ projectId: project.id, executionPolicy: 1 }) },
      { name: 'bad setExecutionPolicy id', run: () => ipc.setExecutionPolicy({ projectId: 'nope', executionPolicy: { independentReview: 'off' } }) },
      { name: 'bad setLocales locale', run: () => ipc.setLocales({ projectId: project.id, sourceLocale: 'english', targetLocale: 'zh-CN' }) },
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
      () => ipc.setExecutionPolicy({ projectId: UNKNOWN, executionPolicy: { independentReview: 'off' } }),
      () => ipc.setLocales({ projectId: UNKNOWN, sourceLocale: 'en', targetLocale: 'ja' }),
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

test('setExecutionPolicy: 两档 round-trip 经信封返回更新后项目；归档 → PROJECT_ARCHIVED', async () => {
  const service = makeService()
  try {
    const ipc = makeIpc(service)
    const project = service.createProject(INPUT)

    // 新建项目经 open 通道返回缺省 off（读取规范化）
    const opened = await ipc.open({ projectId: project.id })
    assert.equal(opened.ok, true)
    if (opened.ok) assert.deepEqual(opened.data.project.executionPolicy, { independentReview: 'off' })

    for (const independentReview of ['risk-based', 'off'] as const) {
      const result = await ipc.setExecutionPolicy({ projectId: project.id, executionPolicy: { independentReview } })
      assert.equal(result.ok, true, independentReview)
      if (result.ok) assert.deepEqual(result.data.executionPolicy, { independentReview })
      assert.deepEqual(service.getProject(project.id).executionPolicy, { independentReview })
    }

    await ipc.archive({ projectId: project.id })
    const rejected = await ipc.setExecutionPolicy({ projectId: project.id, executionPolicy: { independentReview: 'risk-based' } })
    assert.equal(rejected.ok, false)
    if (!rejected.ok) assert.equal(rejected.error.code, 'PROJECT_ARCHIVED')
  } finally {
    service.closeAll()
  }
})

test('setLocales: 空项目可改语言对；已有批次或 TM/TB 时 fail closed 且元数据不变', async () => {
  const service = makeService()
  try {
    const ipc = makeIpc(service)
    const empty = service.createProject(INPUT)

    const changed = await ipc.setLocales({
      projectId: empty.id,
      sourceLocale: 'zh-CN',
      targetLocale: 'en-US',
    })
    assert.equal(changed.ok, true)
    if (changed.ok) {
      assert.equal(changed.data.sourceLocale, 'zh-CN')
      assert.equal(changed.data.targetLocale, 'en-US')
    }

    const withBatch = service.createProject({ ...INPUT, name: '已有批次' })
    await service.importAsset(withBatch.id, {
      filename: CSV_FIXTURE,
      bytes: readFileSync(fixturePath(CSV_FIXTURE)),
    })
    const blockedBatch = await ipc.setLocales({
      projectId: withBatch.id,
      sourceLocale: 'ja',
      targetLocale: 'en',
    })
    assert.equal(blockedBatch.ok, false)
    if (!blockedBatch.ok) assert.equal(blockedBatch.error.code, 'PROJECT_LOCALE_CHANGE_BLOCKED')
    assert.equal(service.getProject(withBatch.id).sourceLocale, INPUT.sourceLocale)

    const withTerms = service.createProject({ ...INPUT, name: '已有术语' })
    service.upsertTermReference(withTerms.id, {
      term: 'Start',
      translation: '开始',
      status: 'preferred',
      caseSensitive: false,
    })
    const blockedTerms = await ipc.setLocales({
      projectId: withTerms.id,
      sourceLocale: 'ja',
      targetLocale: 'en',
    })
    assert.equal(blockedTerms.ok, false)
    if (!blockedTerms.ok) assert.equal(blockedTerms.error.code, 'PROJECT_LOCALE_CHANGE_BLOCKED')

    const archived = service.createProject({ ...INPUT, name: '已归档' })
    service.archiveProject(archived.id)
    const blockedArchived = await ipc.setLocales({
      projectId: archived.id,
      sourceLocale: 'ja',
      targetLocale: 'en',
    })
    assert.equal(blockedArchived.ok, false)
    if (!blockedArchived.ok) assert.equal(blockedArchived.error.code, 'PROJECT_ARCHIVED')
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
    if (result.data.cancelled || result.data.requiresXlsxMapping) return
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

test('import: nonstandard XLSX waits for explicit mapping, rejects forged confirmation, and survives reopen/export', async () => {
  const root = makeTempDir()
  const service = makeService(root)
  try {
    const project = service.createProject(INPUT)
    const sourcePath = join(makeTempDir(), 'nonstandard.xlsx')
    writeFileSync(sourcePath, await nonstandardXlsx())
    const ipc = makeIpc(service)

    const picked = await ipc.import({ projectId: project.id }, makePicker([sourcePath]).picker)
    assert.equal(picked.ok, true)
    if (!picked.ok || picked.data.cancelled || !picked.data.requiresXlsxMapping) return
    assert.equal(service.openProject(project.id).assets.countByProject(), 0)
    const pending = picked.data
    const batch = pending.preview.sheets.find((sheet) => sheet.name === '批次')
    assert.ok(batch !== undefined)
    assert.deepEqual(batch.headerRowNumbers, [1])
    assert.equal(batch.sampleRows[0]?.rowNo, 2)
    assert.equal(batch.columns.find((column) => column.header === '中文原文')?.selectable, true)

    const forged = await ipc.confirmXlsxMapping({
      projectId: project.id,
      mappingId: pending.mappingId,
      sourceSha256: '0'.repeat(64),
      sheetName: '批次',
      columns: { key: '文本编号', source: '中文原文', target: '英文译文', context: '备注' },
    })
    assert.equal(forged.ok, false)
    if (!forged.ok) assert.equal(forged.error.code, 'INVALID_INPUT')
    assert.equal(service.openProject(project.id).assets.countByProject(), 0)

    const confirmed = await ipc.confirmXlsxMapping({
      projectId: project.id,
      mappingId: pending.mappingId,
      sourceSha256: pending.sourceSha256,
      sheetName: '批次',
      columns: { key: '文本编号', source: '中文原文', target: '英文译文', context: '备注' },
    })
    assert.equal(confirmed.ok, true)
    if (!confirmed.ok) return
    assert.equal(confirmed.data.requiresXlsxMapping, false)
    assert.equal(confirmed.data.status, 'imported')
    const stored = service.openProject(project.id).assets.get(confirmed.data.assetId)
    assert.equal(
      stored?.formatConfigJson,
      JSON.stringify({
        version: 1,
        sheetName: '批次',
        columns: { key: '文本编号', source: '中文原文', target: '英文译文', context: '备注' },
      }),
    )

    // A token is one-shot after the exact source was imported.
    const replay = await ipc.confirmXlsxMapping({
      projectId: project.id,
      mappingId: pending.mappingId,
      sourceSha256: pending.sourceSha256,
      sheetName: '批次',
      columns: { source: '中文原文', target: '英文译文' },
    })
    assert.equal(replay.ok, false)
    if (!replay.ok) assert.equal(replay.error.code, 'INVALID_INPUT')

    service.closeAll()
    const reopened = makeService(root)
    try {
      const reopenedAsset = reopened.openProject(project.id).assets.get(confirmed.data.assetId)
      assert.equal(reopenedAsset?.formatConfigJson, stored?.formatConfigJson)
      const segment = reopened.openProject(project.id).segments.query({ assetId: confirmed.data.assetId, limit: 1 })[0]!
      reopened.openProject(project.id).segments.applyTargetEdit(segment.id, 'Start game', segment.revision)
      const staged = await reopened.stageExport(project.id, confirmed.data.assetId)
      const stagedBytes = new Uint8Array(readFileSync(staged.stagingPath))
      const roundTripped = await new XlsxAdapter().import({
        bytes: stagedBytes,
        filename: 'nonstandard.xlsx',
        sourceLocale: 'en',
        targetLocale: 'zh-CN',
        formatConfigJson: reopenedAsset?.formatConfigJson,
      })
      assert.deepEqual(roundTripped.segments.map((segment) => [segment.key, segment.target]), [['menu.start', 'Start game']])
      const stagedZip = await JSZip.loadAsync(stagedBytes)
      assert.ok((await stagedZip.file('xl/worksheets/sheet1.xml')!.async('text')).includes('不是翻译批次'))
    } finally {
      reopened.closeAll()
    }
  } finally {
    service.closeAll()
  }
})

test('import: the same XLSX bytes with a different confirmed mapping fail closed until the old batch is undone', async () => {
  const service = makeService()
  try {
    const project = service.createProject(INPUT)
    const sourcePath = join(makeTempDir(), 'mapping-conflict.xlsx')
    writeFileSync(sourcePath, await nonstandardXlsx())
    const ipc = makeIpc(service)

    const firstPreview = await ipc.import({ projectId: project.id }, makePicker([sourcePath]).picker)
    assert.equal(firstPreview.ok, true)
    if (!firstPreview.ok || firstPreview.data.cancelled || !firstPreview.data.requiresXlsxMapping) return
    const first = await ipc.confirmXlsxMapping({
      projectId: project.id,
      mappingId: firstPreview.data.mappingId,
      sourceSha256: firstPreview.data.sourceSha256,
      sheetName: '批次',
      columns: { key: '文本编号', source: '中文原文', target: '英文译文', context: '备注' },
    })
    assert.equal(first.ok, true)
    if (!first.ok) return

    const samePreview = await ipc.import({ projectId: project.id }, makePicker([sourcePath]).picker)
    assert.equal(samePreview.ok, true)
    if (!samePreview.ok || samePreview.data.cancelled || !samePreview.data.requiresXlsxMapping) return
    const same = await ipc.confirmXlsxMapping({
      projectId: project.id,
      mappingId: samePreview.data.mappingId,
      sourceSha256: samePreview.data.sourceSha256,
      sheetName: '批次',
      columns: { key: '文本编号', source: '中文原文', target: '英文译文', context: '备注' },
    })
    assert.equal(same.ok, true)
    if (!same.ok) return
    assert.equal(same.data.status, 'skipped-duplicate')
    assert.equal(same.data.assetId, first.data.assetId)

    const remapPreview = await ipc.import({ projectId: project.id }, makePicker([sourcePath]).picker)
    assert.equal(remapPreview.ok, true)
    if (!remapPreview.ok || remapPreview.data.cancelled || !remapPreview.data.requiresXlsxMapping) return
    const remap = await ipc.confirmXlsxMapping({
      projectId: project.id,
      mappingId: remapPreview.data.mappingId,
      sourceSha256: remapPreview.data.sourceSha256,
      sheetName: '批次',
      columns: { key: '文本编号', source: '英文译文', target: '中文原文', context: '备注' },
    })
    assert.equal(remap.ok, false)
    if (!remap.ok) {
      assert.equal(remap.error.code, 'FORMAT_PARSE_ERROR')
      assert.match(remap.error.message, /undo/i)
    }

    const assets = service.openProject(project.id).assets.listByProject()
    assert.equal(assets.length, 1, 'a rejected remap must not change the existing batch')
    assert.equal(assets[0]?.id, first.data.assetId)
    assert.equal(
      assets[0]?.formatConfigJson,
      JSON.stringify({
        version: 1,
        sheetName: '批次',
        columns: { key: '文本编号', source: '中文原文', target: '英文译文', context: '备注' },
      }),
    )
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
    if (!importedCsv.ok || importedCsv.data.cancelled || importedCsv.data.requiresXlsxMapping) return

    const { picker: pickJson } = makePicker([fixturePath('mini_items.json')])
    const importedJson = await ipc.import({ projectId: project.id }, pickJson)
    assert.equal(importedJson.ok, true)
    if (!importedJson.ok || importedJson.data.cancelled || importedJson.data.requiresXlsxMapping) return

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

test('undoImportAsset: clean batch succeeds; summary drops the batch (LA-INTAKE-007)', async () => {
  const service = makeService()
  try {
    const ipc = makeIpc(service)
    const project = service.createProject(INPUT)
    const { picker } = makePicker([fixturePath(CSV_FIXTURE)])
    const imported = await ipc.import({ projectId: project.id }, picker)
    assert.equal(imported.ok, true)
    if (!imported.ok || imported.data.cancelled || imported.data.requiresXlsxMapping) return
    // 导入结果随线上行携带验证报告（全部通过）
    assert.equal(imported.data.verification.ok, true)
    assert.equal(imported.data.verification.checks.length, 4)

    const undone = await ipc.undoImportAsset({
      projectId: project.id,
      assetId: imported.data.assetId,
    })
    assert.equal(undone.ok, true)
    if (!undone.ok) return
    assert.equal(undone.data.assetId, imported.data.assetId)
    assert.equal(undone.data.deletedSegments, imported.data.segmentCount)
    assert.equal(undone.data.sourceBlobRemoved, true)

    const summary = await ipc.getSummary({ projectId: project.id })
    assert.equal(summary.ok, true)
    if (summary.ok) {
      assert.equal(summary.data.assetCount, 0)
      assert.deepEqual(summary.data.assets, [])
    }
  } finally {
    service.closeAll()
  }
})

test('undoImportAsset: blocked error envelope carries per-category counts only (no client text)', async () => {
  const service = makeService()
  try {
    const ipc = makeIpc(service)
    const project = service.createProject(INPUT)
    const { picker } = makePicker([fixturePath(CSV_FIXTURE)])
    const imported = await ipc.import({ projectId: project.id }, picker)
    assert.equal(imported.ok, true)
    if (!imported.ok || imported.data.cancelled || imported.data.requiresXlsxMapping) return

    const db = service.openProject(project.id)
    const segment = db.segments.query({ assetId: imported.data.assetId, limit: 1 })[0]!
    db.proposals.insertPending({
      segmentId: segment.id,
      baseRevision: 0,
      proposedTarget: `${segment.target}（改）`,
    })

    const blocked = await ipc.undoImportAsset({
      projectId: project.id,
      assetId: imported.data.assetId,
    })
    assert.equal(blocked.ok, false)
    if (blocked.ok) return
    assert.equal(blocked.error.code, 'IMPORT_UNDO_BLOCKED')
    assert.deepEqual(blocked.error.details, {
      proposals: 1,
      qaFindings: 0,
      criticArtifacts: 0,
      exports: 0,
      editedSegments: 0,
      jobs: 0,
    })
    // 资产仍在（拒绝是零写入分支）
    assert.ok(db.assets.get(imported.data.assetId) !== undefined)
  } finally {
    service.closeAll()
  }
})

test('undoImportAsset: invalid ids → INVALID_INPUT; archived project → PROJECT_ARCHIVED', async () => {
  const service = makeService()
  try {
    const ipc = makeIpc(service)
    const project = service.createProject(INPUT)
    const { picker } = makePicker([fixturePath(CSV_FIXTURE)])
    const imported = await ipc.import({ projectId: project.id }, picker)
    assert.equal(imported.ok, true)
    if (!imported.ok || imported.data.cancelled || imported.data.requiresXlsxMapping) return

    for (const input of [
      { projectId: 'bad', assetId: imported.data.assetId },
      { projectId: project.id, assetId: 'not-an-asset-id' },
      { projectId: project.id },
    ]) {
      const result = await ipc.undoImportAsset(input)
      assert.equal(result.ok, false)
      if (!result.ok) assert.equal(result.error.code, 'INVALID_INPUT')
    }

    await ipc.archive({ projectId: project.id })
    const archived = await ipc.undoImportAsset({
      projectId: project.id,
      assetId: imported.data.assetId,
    })
    assert.equal(archived.ok, false)
    if (!archived.ok) assert.equal(archived.error.code, 'PROJECT_ARCHIVED')
  } finally {
    service.closeAll()
  }
})
