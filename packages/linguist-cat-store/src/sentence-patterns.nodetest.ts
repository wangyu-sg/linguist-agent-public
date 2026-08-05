/**
 * SentencePatternsRepository tests (PB-095): CRUD + CSV 导入幂等 +
 * 状态筛选分页 + 项目隔离。
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { StoreNotFoundError } from './errors'
import { SentencePatternsRepository } from './repositories/sentence-patterns'
import { CatStore } from './store'
import { makeClock, makeEntropy, makeTempDir } from './testkit'

function setup() {
  const store = new CatStore({ rootDir: makeTempDir(), entropy: makeEntropy('pb-095-spn'), now: makeClock() })
  const project = store.createProject({ name: 'P', sourceLocale: 'en', targetLocale: 'zh-CN', promaWorkspaceId: 'ws' })
  const db = store.openProject(project.id)
  return { store, project, db }
}

test('sentence patterns: importMany is idempotent and defaults status to pending', () => {
  const { db } = setup()
  try {
    const inputs = [
      { source: 'Critical hit!', suggestedTarget: '暴击！', textType: 'dialogue', module: 'combat' },
      { source: 'You obtained an item.', draftTarget: '你获得了道具。' },
    ]
    const first = db.sentencePatterns.importMany(inputs)
    assert.deepEqual(first, { imported: 2, unchanged: 0 })
    const second = db.sentencePatterns.importMany(inputs)
    assert.deepEqual(second, { imported: 0, unchanged: 2 })

    const all = db.sentencePatterns.list()
    assert.equal(all.length, 2)
    assert.ok(all.every((pattern) => /^spn_v2_[0-9a-f]{64}$/.test(pattern.id)))
    assert.ok(all.every((pattern) => pattern.status === 'pending'))
    assert.equal(all[0]!.suggestedTarget, '暴击！')
  } finally {
    db.close()
  }
})

test('sentence patterns: upsert create/update + status transitions persisted', () => {
  const { db } = setup()
  try {
    const created = db.sentencePatterns.upsert({ source: 'Game over', suggestedTarget: '游戏结束' })
    assert.equal(created.status, 'pending')

    const confirmed = db.sentencePatterns.upsert({
      id: created.id,
      source: 'Game over',
      suggestedTarget: '游戏结束',
      status: 'confirmed',
      reviewer: 'reviewer-a',
    })
    assert.equal(confirmed.status, 'confirmed')
    assert.equal(confirmed.reviewer, 'reviewer-a')
    assert.notEqual(confirmed.updatedAt, created.updatedAt)
    assert.equal(confirmed.createdAt, created.createdAt)

    assert.throws(
      () => db.sentencePatterns.upsert({ id: 'spn-0000000000000000', source: 'x' }),
      (error) => error instanceof StoreNotFoundError,
    )
    db.sentencePatterns.delete(created.id)
    assert.equal(db.sentencePatterns.get(created.id), undefined)
  } finally {
    db.close()
  }
})

test('sentence patterns: filters (query/textType/status) + pagination + project isolation', () => {
  const { db } = setup()
  try {
    db.sentencePatterns.importMany([
      { source: 'Hello there', suggestedTarget: '你好', textType: 'dialogue', status: 'confirmed' },
      { source: 'Hello again', textType: 'dialogue' },
      { source: 'Settings saved', textType: 'ui', status: 'rejected' },
    ])
    const other = new SentencePatternsRepository(db.catDb, 'prj-0000000000000000', makeClock())
    other.importMany([{ source: 'Hello there', suggestedTarget: '你好', textType: 'dialogue', status: 'confirmed' }])

    assert.equal(db.sentencePatterns.count(), 3)
    assert.equal(db.sentencePatterns.count({ status: 'confirmed' }), 1)
    assert.equal(db.sentencePatterns.count({ textType: 'dialogue' }), 2)
    assert.equal(db.sentencePatterns.count({ query: 'hello' }), 2)
    assert.equal(db.sentencePatterns.count({ query: '你好' }), 1)

    const page = db.sentencePatterns.list({ limit: 2, offset: 2 })
    assert.equal(page.length, 1)

    const foreign = other.list()[0]!
    assert.equal(db.sentencePatterns.get(foreign.id), undefined)
    assert.throws(() => db.sentencePatterns.delete(foreign.id), (error) => error instanceof StoreNotFoundError)
  } finally {
    db.close()
  }
})
