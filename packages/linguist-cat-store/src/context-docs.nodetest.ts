/**
 * ContextDocsRepository tests (PB-095): 元数据 CRUD + text_extract 分页读
 * + 项目隔离；blob 字节读写走 blobs.ts（服务层组合，此处各测各的）。
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { readProjectBlob, removeProjectBlob, saveProjectBlob } from './blobs'
import { StoreNotFoundError } from './errors'
import { ContextDocsRepository } from './repositories/context-docs'
import { CatStore } from './store'
import { makeClock, makeEntropy, makeImportedAsset, makeTempDir } from './testkit'

function setup() {
  const store = new CatStore({ rootDir: makeTempDir(), entropy: makeEntropy('pb-095-ctx'), now: makeClock() })
  const project = store.createProject({ name: 'P', sourceLocale: 'en', targetLocale: 'zh-CN', promaWorkspaceId: 'ws' })
  const db = store.openProject(project.id)
  return { store, project, db }
}

test('context docs: insert/get round-trip incl. text extract; re-insert is idempotent', () => {
  const { db } = setup()
  try {
    const created = db.contextDocs.insert({
      kind: 'doc',
      originalFilename: '背景设定.md',
      blobRelpath: 'blobs/ctx-demo.md',
      sha256: 'a'.repeat(64),
      note: '世界观 v2',
      textExtract: '# 世界观\n王国与森林。',
    })
    assert.match(created.id, /^ctx_v2_[0-9a-f]{64}$/)
    assert.deepEqual(db.contextDocs.get(created.id), created)

    const again = db.contextDocs.insert({
      kind: 'doc',
      originalFilename: '背景设定.md',
      blobRelpath: 'blobs/ctx-demo.md',
      sha256: 'a'.repeat(64),
    })
    assert.equal(again.id, created.id)
    assert.equal(db.contextDocs.count(), 1)
  } finally {
    db.close()
  }
})

test('context docs: re-import backfills a missing text extract without overwriting an existing extract', () => {
  const { db } = setup()
  try {
    const legacy = db.contextDocs.insert({
      kind: 'doc',
      originalFilename: '背景设定.docx',
      blobRelpath: 'blobs/ctx-demo.docx',
      sha256: 'b'.repeat(64),
    })
    assert.equal(legacy.textExtract, undefined)

    const backfilled = db.contextDocs.insert({
      kind: 'doc',
      originalFilename: '背景设定.docx',
      blobRelpath: 'blobs/ctx-demo.docx',
      sha256: 'b'.repeat(64),
      textExtract: '第一次成功解析的正文',
    })
    assert.equal(backfilled.textExtract, '第一次成功解析的正文')
    assert.equal(db.contextDocs.count(), 1)

    const unchanged = db.contextDocs.insert({
      kind: 'doc',
      originalFilename: '背景设定.docx',
      blobRelpath: 'blobs/ctx-demo.docx',
      sha256: 'b'.repeat(64),
      textExtract: '后续解析器输出不应静默改写既有正文',
    })
    assert.equal(unchanged.textExtract, '第一次成功解析的正文')
  } finally {
    db.close()
  }
})

test('context docs: updateNote / delete; misses throw StoreNotFoundError', () => {
  const { db } = setup()
  try {
    const created = db.contextDocs.insert({
      kind: 'image',
      originalFilename: 'ui.png',
      blobRelpath: 'blobs/ctx-ui.png',
    })
    assert.equal(created.textExtract, undefined)

    const noted = db.contextDocs.updateNote(created.id, '主界面截图')
    assert.equal(noted.note, '主界面截图')
    const cleared = db.contextDocs.updateNote(created.id)
    assert.equal(cleared.note, undefined)

    assert.throws(
      () => db.contextDocs.updateNote('ctx-0000000000000000', 'x'),
      (error) => error instanceof StoreNotFoundError,
    )
    db.contextDocs.delete(created.id)
    assert.equal(db.contextDocs.get(created.id), undefined)
    assert.throws(() => db.contextDocs.delete(created.id), (error) => error instanceof StoreNotFoundError)
  } finally {
    db.close()
  }
})

test('context docs: filters + pagination + project isolation', () => {
  const { db } = setup()
  try {
    db.contextDocs.insert({ kind: 'doc', originalFilename: 'lore.md', blobRelpath: 'blobs/a.md', note: '设定' })
    db.contextDocs.insert({ kind: 'image', originalFilename: 'hud.png', blobRelpath: 'blobs/b.png' })
    const other = new ContextDocsRepository(db.catDb, 'prj-0000000000000000', makeClock())
    other.insert({ kind: 'doc', originalFilename: 'lore.md', blobRelpath: 'blobs/a.md', note: '设定' })

    assert.equal(db.contextDocs.count(), 2)
    assert.equal(db.contextDocs.count({ kind: 'image' }), 1)
    assert.equal(db.contextDocs.count({ query: 'lore' }), 1)
    assert.equal(db.contextDocs.list({ limit: 1, offset: 1 }).length, 1)

    const foreign = other.list()[0]!
    assert.equal(db.contextDocs.get(foreign.id), undefined)
    assert.throws(() => db.contextDocs.delete(foreign.id), (error) => error instanceof StoreNotFoundError)
  } finally {
    db.close()
  }
})

test('context docs: Segment 关联可查询、幂等解除，并拒绝未知 Segment', () => {
  const { db } = setup()
  try {
    const { segments } = db.assets.insertImported(makeImportedAsset({ segmentCount: 2 }))
    const doc = db.contextDocs.insert({
      kind: 'image',
      originalFilename: 'hud.png',
      blobRelpath: 'blobs/hud.png',
    })
    const segmentId = segments[0]!.id

    assert.deepEqual(db.contextDocs.list({ segmentId }), [])
    db.contextDocs.setSegmentLink(doc.id, segmentId, true)
    db.contextDocs.setSegmentLink(doc.id, segmentId, true)
    assert.deepEqual(db.contextDocs.list({ segmentId }).map((item) => item.id), [doc.id])

    db.contextDocs.setSegmentLink(doc.id, segmentId, false)
    db.contextDocs.setSegmentLink(doc.id, segmentId, false)
    assert.deepEqual(db.contextDocs.list({ segmentId }), [])
    assert.throws(
      () => db.contextDocs.setSegmentLink(doc.id, 'seg_v2_'.padEnd(71, '0'), true),
      (error) => error instanceof StoreNotFoundError,
    )
  } finally {
    db.close()
  }
})

test('project blobs: atomic save/read round-trip; missing blob throws; remove is best-effort', () => {
  const { db } = setup()
  try {
    const bytes = new TextEncoder().encode('# 设定\n正文')
    saveProjectBlob(db.blobsDir, 'ctx-demo.md', bytes)
    assert.deepEqual(new Uint8Array(readProjectBlob(db.blobsDir, 'ctx-demo.md')), bytes)
    // 落盘路径确实是项目 blobs/ 目录。
    assert.deepEqual(new Uint8Array(readFileSync(join(db.blobsDir, 'ctx-demo.md'))), bytes)

    assert.throws(
      () => readProjectBlob(db.blobsDir, 'missing.png'),
      (error) => error instanceof StoreNotFoundError,
    )
    removeProjectBlob(db.blobsDir, 'ctx-demo.md')
    assert.throws(() => readProjectBlob(db.blobsDir, 'ctx-demo.md'), (error) => error instanceof StoreNotFoundError)
    // 删除不存在的文件不抛（清尾语义）。
    removeProjectBlob(db.blobsDir, 'never-existed.png')
  } finally {
    db.close()
  }
})
