import { test } from 'node:test'
import assert from 'node:assert/strict'
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
