/**
 * PB-095 项目资产 IPC nodetest（node --test；真实服务 + fake picker）。
 * 覆盖：五类 kind 的 CRUD 往返、原生选择器导入（context doc / 句式 CSV）、
 * 归档只读拒绝（picker 不被调用）、INVALID_INPUT 信封、项目隔离、
 * image previewUrl 下发 / blob 缺失降级 / blobs/ 越界围栏。
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync, realpathSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { LinguistProjectMutationEvent } from '@proma/shared'
import { createLinguistAssetsIpc, type LinguistAssetsFilePicker } from './assets-ipc'
import type { LinguistAssetPreviewDeps } from './project-ipc'
import { INPUT, makeService, makeTempDir } from './test/service-testkit'
import { projectPaths } from './paths'

const CONTEXT_DOCX_FIXTURE = join(
  import.meta.dirname,
  'test',
  'fixtures',
  'context-doc-minimal.docx',
)

/** nodetest 用 fake：与 registerPromaFilePath 同 scheme，不触碰 Electron。 */
function fakeRegisterPreviewUrl(absPath: string): string {
  return `proma-file://fake-${absPath.split('/').pop()}`
}

/** nodetest 用 fake 预览转换栈：不触碰 file-preview-service 的重依赖。 */
function fakeAssetPreviewDeps(overrides: Partial<LinguistAssetPreviewDeps> = {}): LinguistAssetPreviewDeps {
  return {
    readText: async (filePath) => ({ content: readFileSync(filePath, 'utf-8') }),
    convertDocxToHtml: async () => ({ html: '<div class="office-preview">DOCX_HTML</div>' }),
    convertOfficeToHtml: async () => ({ html: '<div class="office-preview">XLSX_HTML</div>', text: 'xlsx text' }),
    registerPreviewUrl: fakeRegisterPreviewUrl,
    ...overrides,
  }
}

function picker(paths: string[] | null): { picker: LinguistAssetsFilePicker; calls: () => number } {
  let count = 0
  return {
    picker: async () => {
      count += 1
      return paths === null ? { canceled: true, filePaths: [] } : { canceled: false, filePaths: paths }
    },
    calls: () => count,
  }
}

test('assets IPC: style guide / tech constraint / voice profile CRUD round-trip', async () => {
  const service = makeService()
  try {
    const project = service.createProject(INPUT)
    const ipc = createLinguistAssetsIpc({ getService: () => service, registerPreviewUrl: fakeRegisterPreviewUrl })

    const rule = await ipc.upsert({
      projectId: project.id,
      kind: 'styleGuideRules',
      item: { groupKey: '标点', ruleText: '中文对话不使用半角逗号', goodExample: '等等，什么？', badExample: '等等, 什么?' },
    })
    assert.equal(rule.ok, true)
    if (!rule.ok) return
    const ruleId = (rule.data as { id: string }).id
    assert.match(ruleId, /^sgr_v2_[0-9a-f]{64}$/)

    const listed = await ipc.query({ projectId: project.id, kind: 'styleGuideRules', query: '逗号' })
    assert.equal(listed.ok, true)
    if (listed.ok) {
      assert.equal(listed.data.total, 1)
      assert.equal((listed.data.items[0] as { groupKey?: string }).groupKey, '标点')
    }

    const constraint = await ipc.upsert({
      projectId: project.id,
      kind: 'techConstraints',
      item: { kind: 'length', scope: 'ui', valueJson: '{"maxChars":12}' },
    })
    assert.equal(constraint.ok, true)

    const voice = await ipc.upsert({
      projectId: project.id,
      kind: 'voiceProfiles',
      item: { speaker: '莉安', toneMarkers: ['句尾上扬'], taboos: ['敬语'] },
    })
    assert.equal(voice.ok, true)
    if (voice.ok) assert.deepEqual((voice.data as { toneMarkers?: string[] }).toneMarkers, ['句尾上扬'])

    const removed = await ipc.delete({ projectId: project.id, kind: 'styleGuideRules', id: ruleId })
    assert.equal(removed.ok, true)
    const afterDelete = await ipc.query({ projectId: project.id, kind: 'styleGuideRules' })
    assert.equal(afterDelete.ok, true)
    if (afterDelete.ok) assert.equal(afterDelete.data.total, 0)
  } finally {
    service.closeAll()
  }
})

test('assets IPC: sentence pattern CSV import via picker + status filter + project isolation', async () => {
  const service = makeService()
  try {
    const project = service.createProject(INPUT)
    const other = service.createProject({ ...INPUT, name: 'other' })
    const temp = makeTempDir()
    const csvPath = join(temp, 'patterns.csv')
    writeFileSync(
      csvPath,
      'source,suggested_target,text_type,status\nCritical hit!,暴击！,dialogue,confirmed\nHello there,,ui,\n',
    )
    const ipc = createLinguistAssetsIpc({ getService: () => service, registerPreviewUrl: fakeRegisterPreviewUrl })

    const imported = await ipc.importSentencePatterns({ projectId: project.id }, picker([csvPath]).picker)
    assert.equal(imported.ok, true)
    if (imported.ok) {
      assert.equal(imported.data.cancelled, false)
      if (!imported.data.cancelled) {
        assert.equal(imported.data.imported, 2)
        assert.equal(imported.data.filename, 'patterns.csv')
      }
    }

    const confirmed = await ipc.query({ projectId: project.id, kind: 'sentencePatterns', status: 'confirmed' })
    assert.equal(confirmed.ok, true)
    if (confirmed.ok) {
      assert.equal(confirmed.data.total, 1)
      assert.equal((confirmed.data.items[0] as { suggestedTarget?: string }).suggestedTarget, '暴击！')
    }
    // 缺省 status = pending
    const pending = await ipc.query({ projectId: project.id, kind: 'sentencePatterns', status: 'pending' })
    assert.equal(pending.ok, true)
    if (pending.ok) assert.equal(pending.data.total, 1)

    // 项目隔离：另一项目不可见。
    const isolated = await ipc.query({ projectId: other.id, kind: 'sentencePatterns' })
    assert.equal(isolated.ok, true)
    if (isolated.ok) assert.equal(isolated.data.total, 0)

    // 取消是正常分支。
    const cancelled = await ipc.importSentencePatterns({ projectId: project.id }, picker(null).picker)
    assert.equal(cancelled.ok, true)
    if (cancelled.ok) assert.equal(cancelled.data.cancelled, true)
  } finally {
    service.closeAll()
  }
})

test('assets IPC: context doc import stores blob + metadata; note update; delete removes blob', async () => {
  const service = makeService()
  try {
    const project = service.createProject(INPUT)
    const temp = makeTempDir()
    const mdPath = join(temp, '背景设定.md')
    const pngPath = join(temp, 'hud.png')
    const mutations: LinguistProjectMutationEvent[] = []
    writeFileSync(mdPath, '# 世界观\n王国与森林。')
    writeFileSync(pngPath, new Uint8Array([0x89, 0x50, 0x4e, 0x47]))
    const ipc = createLinguistAssetsIpc({
      getService: () => service,
      registerPreviewUrl: fakeRegisterPreviewUrl,
      onProjectMutation: (event) => mutations.push(event),
    })

    const docResult = await ipc.importContextDoc({ projectId: project.id, note: '世界观 v2' }, picker([mdPath]).picker)
    assert.equal(docResult.ok, true)
    if (!docResult.ok) return
    assert.equal(docResult.data.cancelled, false)
    if (docResult.data.cancelled) return
    assert.equal(docResult.data.doc.kind, 'doc')
    assert.equal(docResult.data.doc.hasTextExtract, true)
    assert.equal(docResult.data.doc.textExtractLength, '# 世界观\n王国与森林。'.length)
    assert.equal(docResult.data.doc.note, '世界观 v2')
    // 线格式绝不带 blob 路径 / 抽取全文。
    assert.equal('blobRelpath' in docResult.data.doc, false)
    assert.equal('textExtract' in docResult.data.doc, false)

    const imageResult = await ipc.importContextDoc({ projectId: project.id }, picker([pngPath]).picker)
    assert.equal(imageResult.ok, true)
    if (imageResult.ok && !imageResult.data.cancelled) {
      assert.equal(imageResult.data.doc.kind, 'image')
      assert.equal(imageResult.data.doc.hasTextExtract, false)
    }

    // note 更新（contextDocs 的唯一 upsert 形态）。
    const noted = await ipc.upsert({
      projectId: project.id,
      kind: 'contextDocs',
      item: { id: docResult.data.doc.id, note: '改名备注' },
    })
    assert.equal(noted.ok, true)
    if (noted.ok) assert.equal((noted.data as { note?: string }).note, '改名备注')

    // blob 字节确实落在项目 blobs/ 下；删除行后 blob 被清尾。
    const rootDir = (service as unknown as { rootDir: string }).rootDir
    const projectDir = projectPaths(rootDir, project.id).projectDir
    const blobsBefore = existsSync(join(projectDir, 'blobs'))
    assert.equal(blobsBefore, true)
    const deleted = await ipc.delete({ projectId: project.id, kind: 'contextDocs', id: docResult.data.doc.id })
    assert.equal(deleted.ok, true)
    const listed = await ipc.query({ projectId: project.id, kind: 'contextDocs' })
    assert.equal(listed.ok, true)
    if (listed.ok) assert.equal(listed.data.total, 1)
    assert.equal(mutations.length, 4)
    assert.deepEqual(
      mutations.map((event) => event.kind),
      ['asset-updated', 'asset-updated', 'asset-updated', 'asset-updated'],
    )
    for (let index = 1; index < mutations.length; index += 1) {
      assert.equal(mutations[index]?.revision, (mutations[index - 1]?.revision ?? 0) + 1)
    }
  } finally {
    service.closeAll()
  }
})

test('assets IPC: real DOCX import extracts readable context text', async () => {
  const service = makeService()
  try {
    const project = service.createProject(INPUT)
    const expectedText = 'Context fixture：王国与森林。'
    const mutations: LinguistProjectMutationEvent[] = []
    const ipc = createLinguistAssetsIpc({
      getService: () => service,
      registerPreviewUrl: fakeRegisterPreviewUrl,
      onProjectMutation: (event) => mutations.push(event),
    })

    const imported = await ipc.importContextDoc(
      { projectId: project.id },
      picker([CONTEXT_DOCX_FIXTURE]).picker,
    )
    assert.equal(imported.ok, true)
    if (!imported.ok || imported.data.cancelled) return
    assert.equal(imported.data.doc.hasTextExtract, true)
    assert.equal(imported.data.doc.textExtractLength, expectedText.length)
    assert.equal(mutations.length, 1)
    assert.equal(mutations[0]?.projectId, project.id)
    assert.equal(mutations[0]?.kind, 'asset-updated')

    const visible = await ipc.query({
      projectId: project.id,
      kind: 'contextDocs',
      limit: 20,
      offset: 0,
    })
    assert.equal(visible.ok, true)
    if (visible.ok) {
      assert.equal(visible.data.total, 1)
      assert.equal(visible.data.items[0]?.id, imported.data.doc.id)
    }

    const stored = service.queryProjectAssets(project.id, 'contextDocs', {
      limit: 20,
      offset: 0,
    })
    assert.equal(stored.total, 1)
    const storedDoc = stored.items[0]
    assert.ok(storedDoc !== undefined && 'textExtract' in storedDoc)
    if (storedDoc !== undefined && 'textExtract' in storedDoc) {
      assert.equal(storedDoc.textExtract, expectedText)
    }
  } finally {
    service.closeAll()
  }
})

test('assets IPC: malformed DOCX fails closed with a stable sanitized diagnostic and stores nothing', async () => {
  const service = makeService()
  try {
    const project = service.createProject(INPUT)
    const temp = makeTempDir()
    const docxPath = join(temp, '损坏文档.docx')
    writeFileSync(docxPath, 'not an OOXML document')
    const fake = picker([docxPath])
    const ipc = createLinguistAssetsIpc({
      getService: () => service,
      registerPreviewUrl: fakeRegisterPreviewUrl,
    })

    const imported = await ipc.importContextDoc({ projectId: project.id }, fake.picker)
    assert.equal(imported.ok, false)
    if (imported.ok) return
    assert.equal(imported.error.code, 'CONTEXT_DOC_EXTRACT_FAILED')
    assert.match(imported.error.message, /DOCX_PARSE_FAILED/)
    assert.match(imported.error.message, /Word|LibreOffice/)
    assert.match(imported.error.message, /另存为/)
    assert.equal(imported.error.message.includes(temp), false)
    assert.equal(fake.calls(), 1)

    const stored = service.queryProjectAssets(project.id, 'contextDocs', {
      limit: 20,
      offset: 0,
    })
    assert.equal(stored.total, 0)
    const rootDir = (service as unknown as { rootDir: string }).rootDir
    const projectDir = projectPaths(rootDir, project.id).projectDir
    assert.equal(readdirSync(join(projectDir, 'blobs')).length, 0)
  } finally {
    service.closeAll()
  }
})

test('assets IPC: archived project rejects writes before native picker', async () => {
  const service = makeService()
  try {
    const project = service.createProject(INPUT)
    service.archiveProject(project.id)
    const ipc = createLinguistAssetsIpc({ getService: () => service, registerPreviewUrl: fakeRegisterPreviewUrl })

    const upserted = await ipc.upsert({
      projectId: project.id,
      kind: 'styleGuideRules',
      item: { ruleText: 'x' },
    })
    assert.equal(upserted.ok, false)
    if (!upserted.ok) assert.equal(upserted.error.code, 'PROJECT_ARCHIVED')

    const fake = picker([join(makeTempDir(), 'unused.md')])
    const imported = await ipc.importContextDoc({ projectId: project.id }, fake.picker)
    assert.equal(imported.ok, false)
    if (!imported.ok) assert.equal(imported.error.code, 'PROJECT_ARCHIVED')
    assert.equal(fake.calls(), 0)

    // 归档只读：查询仍可用。
    const listed = await ipc.query({ projectId: project.id, kind: 'styleGuideRules' })
    assert.equal(listed.ok, true)
  } finally {
    service.closeAll()
  }
})

test('assets IPC: INVALID_INPUT envelope for bad kind / bad status / bad valueJson / bad id', async () => {
  const service = makeService()
  try {
    const project = service.createProject(INPUT)
    const ipc = createLinguistAssetsIpc({ getService: () => service, registerPreviewUrl: fakeRegisterPreviewUrl })

    const badKind = await ipc.query({ projectId: project.id, kind: 'bogus' })
    assert.equal(badKind.ok, false)
    if (!badKind.ok) assert.equal(badKind.error.code, 'INVALID_INPUT')

    const badStatus = await ipc.query({ projectId: project.id, kind: 'sentencePatterns', status: 'bogus' })
    assert.equal(badStatus.ok, false)
    if (!badStatus.ok) assert.equal(badStatus.error.code, 'INVALID_INPUT')

    const badJson = await ipc.upsert({
      projectId: project.id,
      kind: 'techConstraints',
      item: { kind: 'length', valueJson: '{not json' },
    })
    assert.equal(badJson.ok, false)
    if (!badJson.ok) assert.equal(badJson.error.code, 'INVALID_INPUT')

    const badId = await ipc.delete({ projectId: project.id, kind: 'voiceProfiles', id: 'not-an-id' })
    assert.equal(badId.ok, false)
    if (!badId.ok) assert.equal(badId.error.code, 'INVALID_INPUT')

    const blankRule = await ipc.upsert({ projectId: project.id, kind: 'styleGuideRules', item: { ruleText: '  ' } })
    assert.equal(blankRule.ok, false)
    if (!blankRule.ok) assert.equal(blankRule.error.code, 'INVALID_INPUT')
  } finally {
    service.closeAll()
  }
})

test('assets IPC: image context doc 查询附带 proma-file previewUrl；doc 无；blob 缺失与越界降级', async () => {
  const service = makeService()
  try {
    const project = service.createProject(INPUT)
    const temp = makeTempDir()
    const mdPath = join(temp, 'notes.md')
    const pngPath = join(temp, 'ui.png')
    writeFileSync(mdPath, 'hello')
    writeFileSync(pngPath, new Uint8Array([0x89, 0x50, 0x4e, 0x47]))
    const ipc = createLinguistAssetsIpc({ getService: () => service, registerPreviewUrl: fakeRegisterPreviewUrl })

    await ipc.importContextDoc({ projectId: project.id }, picker([mdPath]).picker)
    const imageImport = await ipc.importContextDoc({ projectId: project.id }, picker([pngPath]).picker)
    assert.equal(imageImport.ok, true)
    if (!imageImport.ok || imageImport.data.cancelled) return
    const imageId = imageImport.data.doc.id
    // 导入结果（非查询路径）不带 previewUrl。
    assert.equal('previewUrl' in imageImport.data.doc, false)

    const listed = await ipc.query({ projectId: project.id, kind: 'contextDocs' })
    assert.equal(listed.ok, true)
    if (!listed.ok) return
    assert.equal(listed.data.total, 2)
    const imageItem = listed.data.items.find((item) => (item as { id: string }).id === imageId) as {
      kind: string
      previewUrl?: string
    }
    const docItem = listed.data.items.find((item) => (item as { id: string }).id !== imageId) as {
      kind: string
      previewUrl?: string
    }
    // image 条目返回 proma-file: scheme URL；doc 条目无 previewUrl。
    assert.equal(imageItem.kind, 'image')
    assert.ok(imageItem.previewUrl?.startsWith('proma-file://'))
    assert.equal(docItem.kind, 'doc')
    assert.equal(docItem.previewUrl, undefined)

    // 越界围栏：指向项目内 blobs/ 之外现存文件（cat.db）的 relpath 解析为 undefined。
    assert.equal(service.resolveContextDocBlobPath(project.id, 'blobs/../cat.db'), undefined)

    // blob 文件被外部清掉：查询仍成功，previewUrl 降级省略，不抛错。
    const rootDir = (service as unknown as { rootDir: string }).rootDir
    const projectDir = projectPaths(rootDir, project.id).projectDir
    const pngBlobs = readdirSync(join(projectDir, 'blobs')).filter((name) => name.endsWith('.png'))
    assert.equal(pngBlobs.length, 1)
    rmSync(join(projectDir, 'blobs', pngBlobs[0] as string))
    const relisted = await ipc.query({ projectId: project.id, kind: 'contextDocs' })
    assert.equal(relisted.ok, true)
    if (relisted.ok) {
      assert.equal(relisted.data.total, 2)
      const degraded = relisted.data.items.find((item) => (item as { id: string }).id === imageId) as {
        previewUrl?: string
      }
      assert.equal(degraded.previewUrl, undefined)
    }
  } finally {
    service.closeAll()
  }
})

test('assets IPC: previewContextDoc 三态分派（md → text / docx → html / image → url），路径不离 blobs/', async () => {
  const service = makeService()
  try {
    const project = service.createProject(INPUT)
    const temp = makeTempDir()
    const mdPath = join(temp, '术语备忘.md')
    const pngPath = join(temp, 'hud.png')
    writeFileSync(mdPath, '# 世界观\n王国与森林。')
    writeFileSync(pngPath, new Uint8Array([0x89, 0x50, 0x4e, 0x47]))
    const seenPaths: string[] = []
    const deps = fakeAssetPreviewDeps({
      readText: async (filePath) => {
        seenPaths.push(filePath)
        return { content: readFileSync(filePath, 'utf-8') }
      },
      convertDocxToHtml: async (filePath) => {
        seenPaths.push(filePath)
        return { html: '<div class="office-preview">DOCX_HTML</div>' }
      },
    })
    const ipc = createLinguistAssetsIpc({
      getService: () => service,
      registerPreviewUrl: fakeRegisterPreviewUrl,
      assetPreview: deps,
    })

    const mdImport = await ipc.importContextDoc({ projectId: project.id }, picker([mdPath]).picker)
    assert.equal(mdImport.ok, true)
    if (!mdImport.ok || mdImport.data.cancelled) return
    const docxImport = await ipc.importContextDoc({ projectId: project.id }, picker([CONTEXT_DOCX_FIXTURE]).picker)
    assert.equal(docxImport.ok, true)
    if (!docxImport.ok || docxImport.data.cancelled) return
    const pngImport = await ipc.importContextDoc({ projectId: project.id }, picker([pngPath]).picker)
    assert.equal(pngImport.ok, true)
    if (!pngImport.ok || pngImport.data.cancelled) return

    const rootDir = (service as unknown as { rootDir: string }).rootDir
    // 与实现同侧：macOS temp 目录 /var → /private/var 符号链接，比较前 realpath。
    const blobsRoot = realpathSync(join(projectPaths(rootDir, project.id).projectDir, 'blobs'))

    // md → text 态：直读内容，filename 为原始文件名；响应不含路径。
    const mdPreview = await ipc.previewContextDoc({ projectId: project.id, docId: mdImport.data.doc.id })
    assert.equal(mdPreview.ok, true)
    if (mdPreview.ok) {
      assert.equal(mdPreview.data.kind, 'text')
      if (mdPreview.data.kind === 'text') {
        assert.equal(mdPreview.data.text, '# 世界观\n王国与森林。')
        assert.equal(mdPreview.data.truncated, false)
      }
      assert.equal(mdPreview.data.filename, '术语备忘.md')
      assert.equal(JSON.stringify(mdPreview.data).includes(blobsRoot), false)
    }

    // docx → html 态：转换栈收到的路径已围栏在 blobs/ 内。
    const docxPreview = await ipc.previewContextDoc({ projectId: project.id, docId: docxImport.data.doc.id })
    assert.equal(docxPreview.ok, true)
    if (docxPreview.ok) {
      assert.equal(docxPreview.data.kind, 'html')
      if (docxPreview.data.kind === 'html') {
        assert.match(docxPreview.data.html, /DOCX_HTML/)
      }
    }

    // image → url 态：proma-file:// 不透明 token，绝不带盘上路径。
    const pngPreview = await ipc.previewContextDoc({ projectId: project.id, docId: pngImport.data.doc.id })
    assert.equal(pngPreview.ok, true)
    if (pngPreview.ok) {
      assert.equal(pngPreview.data.kind, 'url')
      if (pngPreview.data.kind === 'url') {
        assert.ok(pngPreview.data.url.startsWith('proma-file://'))
        assert.equal(pngPreview.data.ext, 'png')
        assert.equal(pngPreview.data.url.includes(blobsRoot), false)
      }
    }

    // 转换栈实际收到的路径全部在 blobs/ 内（realpath 围栏生效）。
    assert.equal(seenPaths.length, 2)
    for (const seen of seenPaths) {
      assert.ok(seen.startsWith(blobsRoot), `path escaped blobs/: ${seen}`)
    }
  } finally {
    service.closeAll()
  }
})

test('assets IPC: previewContextDoc 归档项目仍可预览（纯读）；未知 id / 坏形状 / 未注入转换栈', async () => {
  const service = makeService()
  try {
    const project = service.createProject(INPUT)
    const temp = makeTempDir()
    const mdPath = join(temp, 'notes.md')
    writeFileSync(mdPath, 'hello')
    const ipc = createLinguistAssetsIpc({
      getService: () => service,
      registerPreviewUrl: fakeRegisterPreviewUrl,
      assetPreview: fakeAssetPreviewDeps(),
    })
    const imported = await ipc.importContextDoc({ projectId: project.id }, picker([mdPath]).picker)
    assert.equal(imported.ok, true)
    if (!imported.ok || imported.data.cancelled) return

    // 归档：预览是纯读操作，仍可用。
    service.archiveProject(project.id)
    const archived = await ipc.previewContextDoc({ projectId: project.id, docId: imported.data.doc.id })
    assert.equal(archived.ok, true)
    if (archived.ok) assert.equal(archived.data.kind, 'text')

    // 合法形状但不存在的 doc id → STORE_NOT_FOUND。
    const missing = await ipc.previewContextDoc({ projectId: project.id, docId: 'ctx-0123456789abcdef' })
    assert.equal(missing.ok, false)
    if (!missing.ok) assert.equal(missing.error.code, 'STORE_NOT_FOUND')

    // 坏形状 docId / projectId → INVALID_INPUT。
    const badDoc = await ipc.previewContextDoc({ projectId: project.id, docId: 'not-a-doc' })
    assert.equal(badDoc.ok, false)
    if (!badDoc.ok) assert.equal(badDoc.error.code, 'INVALID_INPUT')
    const badProject = await ipc.previewContextDoc({ projectId: 'nope', docId: imported.data.doc.id })
    assert.equal(badProject.ok, false)
    if (!badProject.ok) assert.equal(badProject.error.code, 'INVALID_INPUT')

    // 未注入转换栈 → INTERNAL 降级（不泄露内部细节）。
    const unwired = createLinguistAssetsIpc({
      getService: () => service,
      registerPreviewUrl: fakeRegisterPreviewUrl,
    })
    const degraded = await unwired.previewContextDoc({ projectId: project.id, docId: imported.data.doc.id })
    assert.equal(degraded.ok, false)
    if (!degraded.ok) {
      assert.equal(degraded.error.code, 'INTERNAL')
      assert.equal(degraded.error.message, 'Unexpected internal error.')
    }
  } finally {
    service.closeAll()
  }
})
