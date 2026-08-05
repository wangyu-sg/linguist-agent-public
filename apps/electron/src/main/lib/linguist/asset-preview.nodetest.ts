/**
 * PB-089 CAT 资产源文件预览 nodetest（node --test；真实服务 + fake 转换栈）。
 *
 * 覆盖：text/html/url 三态分派（docx/xlsx 转换函数经依赖注入 fake，断言
 * 收到的路径已围栏在 source/ 内）、text 截断护栏、blob 缺失 → STORE_NOT_FOUND
 * 错误信封、source/ 越界围栏（符号链接伪造）、归档项目可读、INVALID_INPUT
 * （坏 projectId/assetId）、未知资产 id → STORE_NOT_FOUND、未知扩展名降级
 * url 态、转换失败 → INTERNAL。
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { sha256Hex } from '@linguist/cat-formats'
import { assetSourceFileName } from '@linguist/cat-store'
import { createLinguistProjectIpc, type LinguistAssetPreviewDeps } from './project-ipc'
import { INPUT, makeService, readFixture } from './test/service-testkit'
import type { LinguistProjectService } from './project-service'

/** nodetest 用 fake 转换栈：不触碰 file-preview-service 的重依赖。 */
function fakePreviewDeps(overrides: Partial<LinguistAssetPreviewDeps> = {}): LinguistAssetPreviewDeps {
  return {
    readText: async (filePath) => ({ content: readFileSync(filePath, 'utf-8') }),
    convertDocxToHtml: async () => ({ html: '<div class="office-preview">DOCX_HTML</div>' }),
    convertOfficeToHtml: async () => ({ html: '<div class="office-preview">XLSX_HTML</div>', text: 'xlsx text' }),
    registerPreviewUrl: (absPath) => `proma-file://fake-${absPath.split('/').pop()}`,
    ...overrides,
  }
}

/**
 * 不经过格式解析直接落一个资产行 + source blob（伪造任意扩展名用——
 * importAsset 白名单不允许 docx 以外的新格式凭空进来，测试需要覆盖
 * 白名单外/Office 扩展名的分派）。
 */
function forgeAsset(
  service: LinguistProjectService,
  projectId: string,
  filename: string,
  bytes: Uint8Array,
): string {
  const db = service.openProject(projectId)
  const { asset } = db.assets.insertImported({
    asset: {
      formatId: 'fake',
      originalFilename: filename,
      sourceSha256: sha256Hex(bytes),
      segmentCount: 0,
    },
    segments: [],
    warnings: [],
    originalBytes: bytes,
  })
  db.saveAssetSource(asset.id, bytes)
  return asset.id
}

test('asset preview: xliff 走 text 态（真实导入 + 直读，无截断）', async () => {
  const service = makeService()
  try {
    const project = service.createProject(INPUT)
    const imported = await service.importAsset(project.id, {
      bytes: readFixture('mini_game_ui.xliff'),
      filename: 'mini_game_ui.xliff',
    })
    const ipc = createLinguistProjectIpc({ getService: () => service, assetPreview: fakePreviewDeps() })

    const result = await ipc.previewAssetSource({ projectId: project.id, assetId: imported.assetId })
    assert.equal(result.ok, true)
    if (!result.ok) return
    assert.equal(result.data.kind, 'text')
    if (result.data.kind !== 'text') return
    assert.equal(result.data.filename, 'mini_game_ui.xliff')
    assert.equal(result.data.truncated, false)
    assert.ok(result.data.text.includes('<?xml') || result.data.text.includes('xliff'))
  } finally {
    service.closeAll()
  }
})

test('asset preview: text 截断护栏（>200k 字符截断并置 truncated）', async () => {
  const service = makeService()
  try {
    const project = service.createProject(INPUT)
    const big = new TextEncoder().encode('key,value\n'.repeat(30_000)) // 330k 字符
    const assetId = forgeAsset(service, project.id, 'big.csv', big)
    const ipc = createLinguistProjectIpc({ getService: () => service, assetPreview: fakePreviewDeps() })

    const result = await ipc.previewAssetSource({ projectId: project.id, assetId })
    assert.equal(result.ok, true)
    if (!result.ok) return
    assert.equal(result.data.kind, 'text')
    if (result.data.kind !== 'text') return
    assert.equal(result.data.truncated, true)
    assert.equal(result.data.text.length, 200_000)
  } finally {
    service.closeAll()
  }
})

test('asset preview: docx / xlsx 走 html 态（转换函数收到 source/ 内路径）', async () => {
  const service = makeService()
  try {
    const project = service.createProject(INPUT)
    const seenPaths: string[] = []
    const deps = fakePreviewDeps({
      convertDocxToHtml: async (filePath) => {
        seenPaths.push(filePath)
        return { html: '<div class="office-preview">DOCX_HTML</div>' }
      },
      convertOfficeToHtml: async (filePath) => {
        seenPaths.push(filePath)
        return { html: '<div class="office-preview">XLSX_HTML</div>', text: 'xlsx text' }
      },
    })
    const ipc = createLinguistProjectIpc({ getService: () => service, assetPreview: deps })

    const docxId = forgeAsset(service, project.id, 'memo.docx', new TextEncoder().encode('fake docx'))
    const docx = await ipc.previewAssetSource({ projectId: project.id, assetId: docxId })
    assert.equal(docx.ok, true)
    if (docx.ok) {
      assert.equal(docx.data.kind, 'html')
      if (docx.data.kind === 'html') {
        assert.ok(docx.data.html.includes('DOCX_HTML'))
        assert.equal(docx.data.text, undefined)
        assert.equal(docx.data.filename, 'memo.docx')
      }
    }

    const xlsxId = forgeAsset(service, project.id, 'glossary.xlsx', new TextEncoder().encode('fake xlsx'))
    const xlsx = await ipc.previewAssetSource({ projectId: project.id, assetId: xlsxId })
    assert.equal(xlsx.ok, true)
    if (xlsx.ok) {
      assert.equal(xlsx.data.kind, 'html')
      if (xlsx.data.kind === 'html') {
        assert.ok(xlsx.data.html.includes('XLSX_HTML'))
        assert.equal(xlsx.data.text, 'xlsx text')
      }
    }

    // 转换函数收到的必须是项目 source/ 内的绝对路径（服务层围栏产物；
    // realpath 对齐——macOS tmpdir 的 /var → /private/var）
    const sourceRoot = realpathSync(service.getProjectPaths(project.id).sourceDir)
    assert.equal(seenPaths.length, 2)
    for (const p of seenPaths) assert.ok(p.startsWith(sourceRoot), `路径越出 source/: ${p}`)
  } finally {
    service.closeAll()
  }
})

test('asset preview: 未知扩展名降级 url 态（registerPreviewUrl 收到围栏路径）', async () => {
  const service = makeService()
  try {
    const project = service.createProject(INPUT)
    const seenPaths: string[] = []
    const deps = fakePreviewDeps({
      registerPreviewUrl: (absPath) => {
        seenPaths.push(absPath)
        return `proma-file://fake-${absPath.split('/').pop()}`
      },
    })
    const ipc = createLinguistProjectIpc({ getService: () => service, assetPreview: deps })

    const assetId = forgeAsset(service, project.id, 'legacy.tmx', new TextEncoder().encode('<tmx></tmx>'))
    const result = await ipc.previewAssetSource({ projectId: project.id, assetId })
    assert.equal(result.ok, true)
    if (!result.ok) return
    assert.equal(result.data.kind, 'url')
    if (result.data.kind !== 'url') return
    assert.ok(result.data.url.startsWith('proma-file://'))
    assert.equal(result.data.ext, 'tmx')
    assert.equal(result.data.filename, 'legacy.tmx')
    const sourceRoot = realpathSync(service.getProjectPaths(project.id).sourceDir)
    assert.equal(seenPaths.length, 1)
    assert.ok((seenPaths[0] as string).startsWith(sourceRoot))
  } finally {
    service.closeAll()
  }
})

test('asset preview: blob 缺失 → STORE_NOT_FOUND 错误信封', async () => {
  const service = makeService()
  try {
    const project = service.createProject(INPUT)
    const imported = await service.importAsset(project.id, {
      bytes: readFixture('mini_dialogue.csv'),
      filename: 'mini_dialogue.csv',
    })
    // 删掉 source blob（模拟盘上损坏）；资产行仍在
    const db = service.openProject(project.id)
    const asset = db.assets.get(imported.assetId)
    assert.ok(asset !== undefined)
    rmSync(join(db.sourceDir, assetSourceFileName(asset)))

    const ipc = createLinguistProjectIpc({ getService: () => service, assetPreview: fakePreviewDeps() })
    const result = await ipc.previewAssetSource({ projectId: project.id, assetId: imported.assetId })
    assert.equal(result.ok, false)
    if (result.ok) return
    assert.equal(result.error.code, 'STORE_NOT_FOUND')
  } finally {
    service.closeAll()
  }
})

test('asset preview: source/ 越界围栏（符号链接指向项目内 source/ 之外）', async () => {
  const service = makeService()
  try {
    const project = service.createProject(INPUT)
    const imported = await service.importAsset(project.id, {
      bytes: readFixture('mini_items.json'),
      filename: 'mini_items.json',
    })
    const db = service.openProject(project.id)
    const asset = db.assets.get(imported.assetId)
    assert.ok(asset !== undefined)
    // 伪造：blob 位置换成指向 source/ 之外的符号链接（realpath 后越界）
    const { projectDir, sourceDir } = service.getProjectPaths(project.id)
    const outsidePath = join(projectDir, 'outside.txt')
    writeFileSync(outsidePath, 'escape hatch')
    rmSync(join(sourceDir, assetSourceFileName(asset)))
    symlinkSync(outsidePath, join(sourceDir, assetSourceFileName(asset)))

    const ipc = createLinguistProjectIpc({ getService: () => service, assetPreview: fakePreviewDeps() })
    const result = await ipc.previewAssetSource({ projectId: project.id, assetId: imported.assetId })
    assert.equal(result.ok, false)
    if (result.ok) return
    assert.equal(result.error.code, 'STORE_NOT_FOUND')
  } finally {
    service.closeAll()
  }
})

test('asset preview: 归档项目允许预览（纯读操作）', async () => {
  const service = makeService()
  try {
    const project = service.createProject(INPUT)
    const imported = await service.importAsset(project.id, {
      bytes: readFixture('mini_dialogue.csv'),
      filename: 'mini_dialogue.csv',
    })
    service.archiveProject(project.id)

    const ipc = createLinguistProjectIpc({ getService: () => service, assetPreview: fakePreviewDeps() })
    const result = await ipc.previewAssetSource({ projectId: project.id, assetId: imported.assetId })
    assert.equal(result.ok, true)
    if (!result.ok) return
    assert.equal(result.data.kind, 'text')
  } finally {
    service.closeAll()
  }
})

test('asset preview: INVALID_INPUT（坏 projectId / assetId 形状）', async () => {
  const service = makeService()
  try {
    const project = service.createProject(INPUT)
    const ipc = createLinguistProjectIpc({ getService: () => service, assetPreview: fakePreviewDeps() })

    const badAsset = await ipc.previewAssetSource({ projectId: project.id, assetId: 'not-an-asset' })
    assert.equal(badAsset.ok, false)
    if (!badAsset.ok) assert.equal(badAsset.error.code, 'INVALID_INPUT')

    // PB-095 的项目资产 id（sgr/…）不属于本通道
    const wrongDomain = await ipc.previewAssetSource({ projectId: project.id, assetId: 'sgr-0123456789abcdef' })
    assert.equal(wrongDomain.ok, false)
    if (!wrongDomain.ok) assert.equal(wrongDomain.error.code, 'INVALID_INPUT')

    const badProject = await ipc.previewAssetSource({ projectId: 'nope', assetId: 'ast-0123456789abcdef' })
    assert.equal(badProject.ok, false)
    if (!badProject.ok) assert.equal(badProject.error.code, 'INVALID_INPUT')
  } finally {
    service.closeAll()
  }
})

test('asset preview: 合法形状但不存在的资产 id → STORE_NOT_FOUND', async () => {
  const service = makeService()
  try {
    const project = service.createProject(INPUT)
    const ipc = createLinguistProjectIpc({ getService: () => service, assetPreview: fakePreviewDeps() })
    const result = await ipc.previewAssetSource({ projectId: project.id, assetId: 'ast-0123456789abcdef' })
    assert.equal(result.ok, false)
    if (result.ok) return
    assert.equal(result.error.code, 'STORE_NOT_FOUND')
  } finally {
    service.closeAll()
  }
})

test('asset preview: 转换失败 → INTERNAL（不泄露内部细节）', async () => {
  const service = makeService()
  try {
    const project = service.createProject(INPUT)
    const docxId = forgeAsset(service, project.id, 'broken.docx', new TextEncoder().encode('not a zip'))
    const deps = fakePreviewDeps({ convertDocxToHtml: async () => null })
    const ipc = createLinguistProjectIpc({ getService: () => service, assetPreview: deps })

    const result = await ipc.previewAssetSource({ projectId: project.id, assetId: docxId })
    assert.equal(result.ok, false)
    if (result.ok) return
    assert.equal(result.error.code, 'INTERNAL')
    assert.equal(result.error.message, 'Unexpected internal error.')
  } finally {
    service.closeAll()
  }
})
