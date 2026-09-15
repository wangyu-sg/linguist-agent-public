import { test } from 'node:test'
import assert from 'node:assert/strict'
import { rmSync } from 'node:fs'
import { CatStore } from './store'
import { makeClock, makeEntropy, makeImportedAsset, makeTempDir } from './testkit'

test('Context extraction persists child media, typed anchors, and Asset/Segment links without top-level asset noise', () => {
  const store = new CatStore({ rootDir: makeTempDir(), entropy: makeEntropy(), now: makeClock() })
  const project = store.createProject({
    name: 'Context Evidence',
    sourceLocale: 'zh-CN',
    targetLocale: 'en',
    promaWorkspaceId: 'workspace-1',
  })
  const db = store.openProject(project.id)
  try {
    const imported = db.assets.insertImported(makeImportedAsset({ segmentCount: 1 }))
    const parent = db.contextDocs.insert({
      kind: 'doc',
      originalFilename: 'brief.xlsx',
      blobRelpath: 'blobs/brief.xlsx',
      sha256: 'b'.repeat(64),
      textExtract: 'pull down',
    })
    const media = db.contextDocs.insert({
      kind: 'image',
      originalFilename: 'frame.png',
      blobRelpath: 'blobs/frame.png',
      sha256: 'c'.repeat(64),
      parentContextDocId: parent.id,
    })

    db.contextDocs.replaceExtraction(parent.id, [{
      id: 'anchor-cell',
      locator: { kind: 'sheet', sheet: 'Brief', row: 2, cell: 'B2' },
      label: 'Brief!B2',
      text: imported.segments[0]!.source,
    }, {
      id: 'anchor-image',
      locator: { kind: 'image', mediaId: media.id, sheet: 'Brief', row: 2, cell: 'B2' },
      mediaContextDocId: media.id,
    }])
    db.contextDocs.linkExtractionByExactText(parent.id, 'mapping-1')

    assert.equal(db.contextDocs.list().some((doc) => doc.id === media.id), false)
    assert.equal(db.contextDocs.list({ includeExtractedMedia: true }).some((doc) => doc.id === media.id), true)
    assert.deepEqual(db.contextDocs.listAnchors(parent.id).map((anchor) => anchor.id), [
      'anchor-cell',
      'anchor-image',
    ])
    assert.deepEqual(db.contextDocs.listEvidenceLinks(parent.id).map((link) => link.relation.kind), [
      'asset',
      'asset',
      'segment',
      'segment',
    ])
  } finally {
    db.close()
  }
})

test('大型 Context 精确关联不逐单元格扫描整个批次，保留 source/target/key 与同排传播', () => {
  const rootDir = makeTempDir()
  const store = new CatStore({ rootDir, entropy: makeEntropy(), now: makeClock() })
  const project = store.createProject({
    name: '大型参考表', sourceLocale: 'en', targetLocale: 'zh-CN', promaWorkspaceId: 'workspace-1',
  })
  const db = store.openProject(project.id)
  try {
    const imported = db.assets.insertImported(makeImportedAsset({ segmentCount: 865, fillEvery: 2 }))
    const doc = db.contextDocs.insert({
      kind: 'doc', originalFilename: 'large.xlsx', blobRelpath: 'blobs/large.xlsx',
    })
    const first = imported.segments[0]!
    const matches = [first.source, first.target, first.key!]
    db.contextDocs.replaceExtraction(doc.id, Array.from({ length: 30_000 }, (_, index) => ({
      id: `cell-${index}`,
      locator: { kind: 'sheet' as const, sheet: '参考', row: Math.floor(index / 2) + 1 },
      text: index < 6 && index % 2 === 0 ? matches[index / 2]! : index === 6 ? '' : `无匹配-${index}`,
    })))
    const started = performance.now()
    const links = db.contextDocs.linkExtractionByExactText(doc.id, 'large-1')
    const elapsed = performance.now() - started
    assert.equal(links.length, 12)
    for (let index = 0; index < 6; index++) {
      assert.ok(links.some((link) => link.anchorId === `cell-${index}`
        && link.relation.kind === 'segment' && link.relation.segmentId === first.id))
    }
    assert.ok(elapsed < 2_000, `Context 关联阻塞主线程 ${Math.round(elapsed)}ms`)
    assert.equal(db.contextDocs.linkExtractionByExactText(doc.id, 'large-2').length, links.length)
  } finally {
    db.close()
    rmSync(rootDir, { recursive: true, force: true })
  }
})
