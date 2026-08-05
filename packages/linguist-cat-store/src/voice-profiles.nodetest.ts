/**
 * VoiceProfilesRepository tests (PB-095): CRUD + JSON 数组列（tone_markers/
 * taboos）+ 项目隔离。
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { StoreNotFoundError } from './errors'
import { VoiceProfilesRepository } from './repositories/voice-profiles'
import { CatStore } from './store'
import { makeClock, makeEntropy, makeTempDir } from './testkit'

function setup() {
  const store = new CatStore({ rootDir: makeTempDir(), entropy: makeEntropy('pb-095-vpr'), now: makeClock() })
  const project = store.createProject({ name: 'P', sourceLocale: 'en', targetLocale: 'zh-CN', promaWorkspaceId: 'ws' })
  const db = store.openProject(project.id)
  return { store, project, db }
}

test('voice profiles: upsert create/get round-trip with tone markers and taboos', () => {
  const { db } = setup()
  try {
    const created = db.voiceProfiles.upsert({
      speaker: '莉安',
      textType: 'dialogue',
      register: 'casual',
      person: 'first',
      toneMarkers: ['句尾上扬', '自嘲'],
      taboos: ['敬语', '书面语'],
      notes: '年轻游侠',
      updatedBy: 'pm-a',
    })
    assert.match(created.id, /^vpr_v2_[0-9a-f]{64}$/)
    assert.deepEqual(db.voiceProfiles.get(created.id), created)

    // 同 speaker+textType 重建幂等返回既有行。
    const again = db.voiceProfiles.upsert({ speaker: '莉安', textType: 'dialogue' })
    assert.equal(again.id, created.id)
    assert.equal(db.voiceProfiles.count(), 1)
  } finally {
    db.close()
  }
})

test('voice profiles: explicit-id upsert rewrites arrays; delete misses throw StoreNotFoundError', () => {
  const { db } = setup()
  try {
    const created = db.voiceProfiles.upsert({ speaker: '旁白' })
    const updated = db.voiceProfiles.upsert({
      id: created.id,
      speaker: '旁白',
      register: 'formal',
      toneMarkers: [],
      taboos: ['网络流行语'],
    })
    assert.deepEqual(updated.toneMarkers, [])
    assert.deepEqual(updated.taboos, ['网络流行语'])
    assert.equal(updated.person, undefined)

    assert.throws(
      () => db.voiceProfiles.upsert({ id: 'vpr-0000000000000000', speaker: 'x' }),
      (error) => error instanceof StoreNotFoundError,
    )
    db.voiceProfiles.delete(created.id)
    assert.equal(db.voiceProfiles.get(created.id), undefined)
  } finally {
    db.close()
  }
})

test('voice profiles: filters + pagination + project isolation', () => {
  const { db } = setup()
  try {
    db.voiceProfiles.upsert({ speaker: '莉安', textType: 'dialogue' })
    db.voiceProfiles.upsert({ speaker: '国王', textType: 'dialogue' })
    db.voiceProfiles.upsert({ speaker: '系统', textType: 'ui' })
    const other = new VoiceProfilesRepository(db.catDb, 'prj-0000000000000000', makeClock())
    other.upsert({ speaker: '莉安', textType: 'dialogue' })

    assert.equal(db.voiceProfiles.count(), 3)
    assert.equal(db.voiceProfiles.count({ textType: 'dialogue' }), 2)
    assert.equal(db.voiceProfiles.count({ query: '莉安' }), 1)
    assert.equal(db.voiceProfiles.list({ limit: 2, offset: 2 }).length, 1)

    const foreign = other.list()[0]!
    assert.equal(db.voiceProfiles.get(foreign.id), undefined)
    assert.throws(() => db.voiceProfiles.delete(foreign.id), (error) => error instanceof StoreNotFoundError)
  } finally {
    db.close()
  }
})
