/**
 * StyleGuideRulesRepository tests (PB-095): CRUD + 分页 + 项目隔离。
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { StoreNotFoundError } from './errors'
import { StyleGuideRulesRepository } from './repositories/style-guide-rules'
import { CatStore } from './store'
import { makeClock, makeEntropy, makeTempDir } from './testkit'

function setup() {
  const store = new CatStore({ rootDir: makeTempDir(), entropy: makeEntropy('pb-095-sgr'), now: makeClock() })
  const project = store.createProject({ name: 'P', sourceLocale: 'en', targetLocale: 'zh-CN', promaWorkspaceId: 'ws' })
  const db = store.openProject(project.id)
  return { store, project, db }
}

test('style guide rules: upsert create/get/list round-trip with examples', () => {
  const { db } = setup()
  try {
    const created = db.styleGuideRules.upsert({
      groupKey: '标点',
      ruleText: '中文对话不使用半角逗号',
      sourceExample: 'Wait, what?',
      goodExample: '等等，什么？',
      badExample: '等等, 什么?',
      updatedBy: 'reviewer-a',
    })
    assert.match(created.id, /^sgr_v2_[0-9a-f]{64}$/)
    assert.equal(created.updatedBy, 'reviewer-a')
    assert.equal(created.screenshotRef, undefined)

    const fetched = db.styleGuideRules.get(created.id)
    assert.deepEqual(fetched, created)

    // 同内容重建幂等返回既有行。
    const again = db.styleGuideRules.upsert({ groupKey: '标点', ruleText: '中文对话不使用半角逗号' })
    assert.equal(again.id, created.id)
    assert.equal(db.styleGuideRules.count(), 1)
  } finally {
    db.close()
  }
})

test('style guide rules: explicit-id upsert updates in place; delete misses throw StoreNotFoundError', () => {
  const { db } = setup()
  try {
    const created = db.styleGuideRules.upsert({ ruleText: '初版规则' })
    const updated = db.styleGuideRules.upsert({ id: created.id, ruleText: '修订规则', badExample: '反例' })
    assert.equal(updated.id, created.id)
    assert.equal(updated.ruleText, '修订规则')
    assert.equal(db.styleGuideRules.get(created.id)?.badExample, '反例')
    assert.notEqual(updated.updatedAt, created.updatedAt)

    assert.throws(
      () => db.styleGuideRules.upsert({ id: 'sgr-0000000000000000', ruleText: 'x' }),
      (error) => error instanceof StoreNotFoundError,
    )
    db.styleGuideRules.delete(created.id)
    assert.equal(db.styleGuideRules.get(created.id), undefined)
    assert.throws(
      () => db.styleGuideRules.delete(created.id),
      (error) => error instanceof StoreNotFoundError,
    )
  } finally {
    db.close()
  }
})

test('style guide rules: list filters (query/groupKey) + pagination + project isolation', () => {
  const { db, project } = setup()
  try {
    db.styleGuideRules.upsert({ groupKey: '标点', ruleText: '规则 Alpha 逗号' })
    db.styleGuideRules.upsert({ groupKey: '标点', ruleText: '规则 Beta 句号' })
    db.styleGuideRules.upsert({ groupKey: '用词', ruleText: '规则 Gamma 敬语' })
    // 同库另一项目的行（直接换 projectId 构造仓储模拟隔离）。
    const other = new StyleGuideRulesRepository(db.catDb, 'prj-0000000000000000', makeClock())
    other.upsert({ groupKey: '标点', ruleText: '规则 Alpha 逗号' })

    assert.equal(db.styleGuideRules.count(), 3)
    assert.equal(db.styleGuideRules.count({ groupKey: '标点' }), 2)
    assert.equal(db.styleGuideRules.count({ query: 'alpha' }), 1)

    const page1 = db.styleGuideRules.list({ limit: 2, offset: 0 })
    const page2 = db.styleGuideRules.list({ limit: 2, offset: 2 })
    assert.equal(page1.length, 2)
    assert.equal(page2.length, 1)
    const ids = new Set([...page1, ...page2].map((rule) => rule.id))
    assert.equal(ids.size, 3)

    // 其他项目的 id 在本项目不可见（get/delete 均按 project_id 过滤）。
    const foreign = other.list()[0]!
    assert.equal(db.styleGuideRules.get(foreign.id), undefined)
    assert.throws(() => db.styleGuideRules.delete(foreign.id), (error) => error instanceof StoreNotFoundError)
    assert.equal(project.id !== 'prj-0000000000000000', true)
  } finally {
    db.close()
  }
})
