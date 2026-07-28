/**
 * TechConstraintsRepository tests (PB-095): CRUD + kind/scope 筛选 +
 * 项目隔离（value_json 原样存取，QA 消费归 PB-097）。
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { StoreNotFoundError } from './errors'
import { TechConstraintsRepository } from './repositories/tech-constraints'
import { CatStore } from './store'
import { makeClock, makeEntropy, makeTempDir } from './testkit'

function setup() {
  const store = new CatStore({ rootDir: makeTempDir(), entropy: makeEntropy('pb-095-tcn'), now: makeClock() })
  const project = store.createProject({ name: 'P', sourceLocale: 'en', targetLocale: 'zh-CN', promaWorkspaceId: 'ws' })
  const db = store.openProject(project.id)
  return { store, project, db }
}

test('tech constraints: upsert create/update round-trip; scope omitted means global', () => {
  const { db } = setup()
  try {
    const created = db.techConstraints.upsert({
      kind: 'length',
      valueJson: JSON.stringify({ maxChars: 40 }),
      note: '技能描述上限',
    })
    assert.ok(created.id.startsWith('tcn-'))
    assert.equal(created.scope, undefined)
    assert.deepEqual(db.techConstraints.get(created.id), created)

    const updated = db.techConstraints.upsert({
      id: created.id,
      kind: 'length',
      scope: 'skill_desc',
      valueJson: JSON.stringify({ maxChars: 30 }),
    })
    assert.equal(updated.scope, 'skill_desc')
    assert.notEqual(updated.updatedAt, created.updatedAt)

    assert.throws(
      () => db.techConstraints.upsert({ id: 'tcn-0000000000000000', kind: 'length', valueJson: '{}' }),
      (error) => error instanceof StoreNotFoundError,
    )
    db.techConstraints.delete(created.id)
    assert.equal(db.techConstraints.get(created.id), undefined)
  } finally {
    db.close()
  }
})

test('tech constraints: filters + pagination + project isolation', () => {
  const { db } = setup()
  try {
    db.techConstraints.upsert({ kind: 'length', scope: 'ui', valueJson: '{"maxChars":12}' })
    db.techConstraints.upsert({ kind: 'rich_text', valueJson: '{"allowedTags":["b","i"]}' })
    db.techConstraints.upsert({ kind: 'tag_note', valueJson: '{"tag":"ph"}' })
    const other = new TechConstraintsRepository(db.catDb, 'prj-0000000000000000', makeClock())
    other.upsert({ kind: 'length', scope: 'ui', valueJson: '{"maxChars":12}' })

    assert.equal(db.techConstraints.count(), 3)
    assert.equal(db.techConstraints.count({ kind: 'length' }), 1)
    assert.equal(db.techConstraints.count({ scope: 'ui' }), 1)
    assert.equal(db.techConstraints.list({ limit: 2, offset: 2 }).length, 1)

    const foreign = other.list()[0]!
    assert.equal(db.techConstraints.get(foreign.id), undefined)
    assert.throws(() => db.techConstraints.delete(foreign.id), (error) => error instanceof StoreNotFoundError)
  } finally {
    db.close()
  }
})
