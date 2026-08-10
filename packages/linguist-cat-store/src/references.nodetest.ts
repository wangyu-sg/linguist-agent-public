import assert from 'node:assert/strict'
import { test } from 'node:test'
import { StoreNotFoundError, StoreReadOnlyError } from './errors'
import { TermEntriesRepository } from './repositories/term-entries'
import { TmUnitsRepository } from './repositories/tm-units'
import { CatStore } from './store'
import { makeClock, makeEntropy, makeTempDir } from './testkit'

const PROJECT_INPUT = {
  name: 'P',
  sourceLocale: 'en',
  targetLocale: 'zh-CN',
  promaWorkspaceId: 'ws',
}

function setup() {
  const now = makeClock()
  const store = new CatStore({ rootDir: makeTempDir(), entropy: makeEntropy(), now })
  const project = store.createProject(PROJECT_INPUT)
  return { store, project, now }
}

test('TM importMany: stable ids, same source with different targets, and repeat import is unchanged', () => {
  const { store, project } = setup()
  const db = store.openProject(project.id)
  const rows = [
    {
      source: 'Save',
      target: '保存',
      sourceLocale: 'en',
      targetLocale: 'zh-CN',
      origin: 'client_tm',
    },
    {
      source: 'Save',
      target: '存储',
      sourceLocale: 'en',
      targetLocale: 'zh-CN',
      origin: 'client_tm',
    },
  ]
  try {
    assert.deepEqual(db.tmUnits.importMany(rows), { imported: 2, unchanged: 0 })
    const ids = db.tmUnits.list({ limit: 1 }).map((item) => item.id)
    assert.equal(ids.length, 1)
    assert.match(ids[0]!, /^tmu_v2_[0-9a-f]{64}$/)
    assert.deepEqual(db.tmUnits.importMany(rows), { imported: 0, unchanged: 2 })
    assert.deepEqual(db.tmUnits.list().map((item) => item.target), ['保存', '存储'])
  } finally {
    db.close()
  }
})

test('approved exemplars reuse TM authority and retain bounded voice metadata', () => {
  const { store, project } = setup()
  const db = store.openProject(project.id)
  const input = {
    source: 'The gate is open.',
    target: '大门已经打开。',
    sourceLocale: 'en',
    targetLocale: 'zh-CN',
    speaker: 'Narrator',
    textType: 'dialogue',
    module: 'chapter-1',
    assetId: 'ast_v2_test',
    segmentId: 'seg_v2_test',
    note: '语气克制',
  }
  try {
    const created = db.tmUnits.addApprovedExemplar(input)
    assert.deepEqual(created, {
      id: created.id,
      ...input,
      approvedAt: created.approvedAt,
    })
    assert.match(created.approvedAt, /^2026-01-01T/)
    assert.equal(db.tmUnits.get(created.id)?.origin, 'approved-exemplar')
    assert.equal(db.tmUnits.addApprovedExemplar(input).id, created.id)
    assert.equal(db.tmUnits.count(), 1)

    const replaced = db.tmUnits.addApprovedExemplar({
      ...input,
      target: '大门现在关闭了。',
      note: '改为克制的警告语气',
    })
    assert.notEqual(replaced.id, created.id)
    assert.equal(replaced.target, '大门现在关闭了。')
    assert.equal(replaced.note, '改为克制的警告语气')
    assert.equal(db.tmUnits.count(), 1)
    assert.equal(db.tmUnits.listApprovedExemplars({ speaker: 'Narrator' })[0]!.id, replaced.id)

    db.tmUnits.addApprovedExemplar({
      ...input,
      speaker: 'System',
      textType: 'ui',
      segmentId: 'seg_v2_system',
      module: 'menu',
    })
    assert.deepEqual(
      db.tmUnits.listApprovedExemplars({ speaker: 'narrator', textType: 'dialogue', module: 'chapter-1' }),
      [replaced],
    )
    assert.equal(db.tmUnits.listApprovedExemplars({ speaker: 'Narrator', module: 'menu' }).length, 0)
  } finally {
    db.close()
  }
})

test('TM/TB imports advance only their project event sequence after a committed change', () => {
  const { store, project } = setup()
  const db = store.openProject(project.id)
  const otherProject = store.createProject({
    ...PROJECT_INPUT,
    name: 'Other',
    promaWorkspaceId: 'ws-other',
  })
  const otherDb = store.openProject(otherProject.id)
  const tm = {
    source: 'Save',
    target: '保存',
    sourceLocale: 'en',
    targetLocale: 'zh-CN',
  }
  const term = {
    term: 'Cancel',
    translation: '取消',
    status: 'preferred' as const,
    caseSensitive: false,
  }
  try {
    assert.equal(db.runs.latestEventSequence, 0)
    db.tmUnits.list()
    db.termEntries.list()
    assert.equal(db.runs.latestEventSequence, 0, 'reference reads must not append events')

    assert.deepEqual(db.tmUnits.importMany([tm]), { imported: 1, unchanged: 0 })
    assert.equal(db.runs.latestEventSequence, 1)
    assert.equal(db.runs.getLatestEvent()?.kind, 'project-updated')
    assert.deepEqual(db.tmUnits.importMany([tm]), { imported: 0, unchanged: 1 })
    assert.equal(db.runs.latestEventSequence, 1, 'unchanged imports must not append events')

    assert.throws(() => db.catDb.transaction('forced TM rollback', () => {
      db.tmUnits.importMany([{
        ...tm,
        source: 'Load',
        target: '加载',
      }])
      throw new Error('force rollback')
    }), /force rollback/)
    assert.equal(db.runs.latestEventSequence, 1, 'rolled-back imports must not append events')
    assert.equal(db.tmUnits.count(), 1)

    assert.deepEqual(db.termEntries.importMany([term]), { imported: 1, unchanged: 0 })
    assert.equal(db.runs.latestEventSequence, 2)

    assert.deepEqual(otherDb.tmUnits.importMany([tm]), { imported: 1, unchanged: 0 })
    assert.equal(db.runs.latestEventSequence, 2, 'other project events must stay isolated')
    assert.equal(otherDb.runs.latestEventSequence, 1)
  } finally {
    otherDb.close()
    db.close()
  }
})

test('TM findMatches: normalizes text, scores exact/contains/fuzzy, and sorts deterministically', () => {
  const { store, project } = setup()
  const db = store.openProject(project.id)
  try {
    db.tmUnits.importMany([
      { source: 'Ａ   cat', target: '甲', sourceLocale: 'en', targetLocale: 'zh-CN' },
      { source: 'A cat today', target: '乙', sourceLocale: 'en', targetLocale: 'zh-CN' },
      { source: 'A cot', target: '丙', sourceLocale: 'en', targetLocale: 'zh-CN' },
      { source: 'A cat', target: '错误 locale', sourceLocale: 'fr', targetLocale: 'zh-CN' },
    ])

    const matches = db.tmUnits.findMatches({
      source: 'a cat',
      sourceLocale: 'en',
      targetLocale: 'zh-CN',
      threshold: 0.4,
      limit: 3,
    })
    assert.deepEqual(matches.map((item) => item.matchType), ['exact', 'contains', 'fuzzy'])
    assert.deepEqual(matches.map((item) => item.target), ['甲', '乙', '丙'])
    assert.equal(matches[0]?.score, 1)
    assert.equal(
      db.tmUnits.findMatches({
        source: 'a cat',
        sourceLocale: 'en',
        targetLocale: 'zh-CN',
        threshold: 0.7,
        limit: 3,
      })[1]?.matchType,
      'contains',
    )
  } finally {
    db.close()
  }
})

test('TM/Term findMatchesMany 复用一次批量读取并保持逐文本匹配语义', () => {
  const { store, project } = setup()
  const db = store.openProject(project.id)
  try {
    db.tmUnits.importMany([
      { source: 'Save game', target: '保存游戏', sourceLocale: 'en', targetLocale: 'zh-CN' },
      { source: 'Load game', target: '加载游戏', sourceLocale: 'en', targetLocale: 'zh-CN' },
    ])
    db.termEntries.importMany([
      { term: 'Save', translation: '保存', status: 'preferred', caseSensitive: false },
      { term: 'game', translation: '游戏', status: 'allowed', caseSensitive: false },
    ])

    const tm = db.tmUnits.findMatchesMany({
      sources: ['Save game', 'Load game'],
      sourceLocale: 'en',
      targetLocale: 'zh-CN',
      threshold: 0.6,
      limit: 3,
    })
    assert.equal(tm.get('Save game')?.[0]?.target, '保存游戏')
    assert.equal(tm.get('Load game')?.[0]?.target, '加载游戏')

    const terms = db.termEntries.findMatchesMany({
      texts: ['Save game', 'Load game'],
      limit: 5,
    })
    assert.deepEqual(terms.get('Save game')?.map((item) => item.term), ['Save', 'game'])
    assert.deepEqual(terms.get('Load game')?.map((item) => item.term), ['game'])
  } finally {
    db.close()
  }
})

test('TM repositories isolate projects and reject content-id collisions', () => {
  const { store, project, now } = setup()
  const db = store.openProject(project.id)
  const row = { source: 'Open', target: '打开', sourceLocale: 'en', targetLocale: 'zh-CN' }
  try {
    db.tmUnits.importMany([row])
    const own = db.tmUnits.list()[0]!
    const otherProject = new TmUnitsRepository(db.catDb, 'prj-other', now)
    assert.equal(otherProject.get(own.id), undefined)
    assert.throws(() => otherProject.delete(own.id), StoreNotFoundError)
    assert.equal(otherProject.importMany([row]).imported, 1)
    assert.notEqual(otherProject.list()[0]?.id, own.id)

    db.catDb.db.prepare('UPDATE tm_units SET source = ? WHERE id = ?').run('corrupt', own.id)
    assert.throws(() => db.tmUnits.importMany([row]), /content id collision/)
  } finally {
    db.close()
  }
})

test('TM writes are rejected by a read-only project handle', () => {
  const { store, project } = setup()
  store.openProject(project.id).close()
  const db = store.openProject(project.id, { readOnly: true })
  try {
    assert.throws(
      () => db.tmUnits.importMany([
        { source: 'Open', target: '打开', sourceLocale: 'en', targetLocale: 'zh-CN' },
      ]),
      StoreReadOnlyError,
    )
    assert.throws(() => db.tmUnits.delete('tmu-0000000000000000'), StoreReadOnlyError)
  } finally {
    db.close()
  }
})

test('term importMany/list: required fields persist and repeat import is unchanged', () => {
  const { store, project } = setup()
  const db = store.openProject(project.id)
  const rows = [
    {
      term: 'Color',
      translation: '颜色',
      status: 'preferred' as const,
      caseSensitive: false,
      note: 'UI',
    },
    {
      term: 'Color',
      translation: '色彩',
      status: 'preferred' as const,
      caseSensitive: false,
    },
  ]
  try {
    assert.deepEqual(db.termEntries.importMany(rows), { imported: 2, unchanged: 0 })
    assert.deepEqual(db.termEntries.importMany(rows), { imported: 0, unchanged: 2 })
    assert.deepEqual(db.termEntries.importMany([{
      term: 'Color',
      translation: '颜色',
      status: 'preferred',
      caseSensitive: false,
    }]), {
      imported: 0,
      unchanged: 1,
    })
    const page = db.termEntries.list({ status: 'preferred', limit: 1 })
    assert.equal(page.length, 1)
    assert.match(page[0]!.id, /^ter_v2_[0-9a-f]{64}$/)
    assert.equal(page[0]!.status, 'preferred')
    assert.equal(page[0]!.caseSensitive, false)
    assert.equal(db.termEntries.count({ status: 'preferred' }), 2)
  } finally {
    db.close()
  }
})

test('term upsert/delete are project-scoped', () => {
  const { store, project, now } = setup()
  const db = store.openProject(project.id)
  try {
    const created = db.termEntries.upsert({
      term: 'API',
      translation: '接口',
      status: 'allowed',
      caseSensitive: true,
    })
    const updated = db.termEntries.upsert({
      id: created.id,
      term: 'API',
      translation: '应用接口',
      status: 'deprecated',
      caseSensitive: true,
      note: 'legacy',
    })
    assert.equal(updated.id, created.id)
    assert.equal(updated.status, 'deprecated')
    assert.equal(updated.note, 'legacy')

    const otherProject = new TermEntriesRepository(db.catDb, 'prj-other', now)
    assert.equal(otherProject.get(created.id), undefined)
    assert.throws(
      () => otherProject.upsert({ ...updated, id: created.id }),
      StoreNotFoundError,
    )
    assert.throws(() => otherProject.delete(created.id), StoreNotFoundError)
    db.termEntries.delete(created.id)
    assert.equal(db.termEntries.get(created.id), undefined)
  } finally {
    db.close()
  }
})

test('term findMatches honors case sensitivity, status filters, contains, and conflict sorting', () => {
  const { store, project } = setup()
  const db = store.openProject(project.id)
  try {
    db.termEntries.importMany([
      { term: 'API', translation: '接口', status: 'allowed', caseSensitive: true },
      { term: 'api', translation: '应用接口', status: 'forbidden', caseSensitive: false },
      { term: 'Color', translation: '颜色', status: 'preferred', caseSensitive: false },
      { term: 'Color', translation: '色彩', status: 'preferred', caseSensitive: false },
    ])

    const apiMatches = db.termEntries.findMatches({ text: 'api', limit: 10 })
    assert.deepEqual(apiMatches.map((item) => item.translation), ['应用接口'])
    assert.equal(apiMatches[0]?.matchType, 'exact')

    const colorMatches = db.termEntries.findMatches({ text: 'Choose COLOR settings', limit: 10 })
    assert.deepEqual(colorMatches.map((item) => item.translation), ['色彩', '颜色'])
    assert.ok(colorMatches.every((item) => item.matchType === 'contains' && item.conflict))
    assert.deepEqual(
      db.termEntries.findMatches({ text: 'Use api and color', limit: 10 }).map((item) => item.status),
      ['preferred', 'preferred', 'forbidden'],
    )

    assert.deepEqual(
      db.termEntries.findMatches({
        text: 'Use api and color',
        statuses: ['forbidden'],
        limit: 10,
      }).map((item) => item.status),
      ['forbidden'],
    )
  } finally {
    db.close()
  }
})

test('term findMatches uses whole-word matching for Latin terms and contiguous matching for CJK', () => {
  const { store, project } = setup()
  const db = store.openProject(project.id)
  try {
    db.termEntries.importMany([
      { term: 'art', translation: '艺术', status: 'preferred', caseSensitive: false },
      { term: '药水', translation: 'potion', status: 'preferred', caseSensitive: false },
    ])
    assert.equal(db.termEntries.findMatches({ text: 'start here' }).length, 0)
    assert.equal(db.termEntries.findMatches({ text: 'the art is ready' }).length, 1)
    assert.equal(db.termEntries.findMatches({ text: '超级药水' }).length, 1)
  } finally {
    db.close()
  }
})

test('term matcher keeps the longest overlapping CJK match and independent short spans', () => {
  const { store, project } = setup()
  const db = store.openProject(project.id)
  try {
    db.termEntries.importMany([
      { term: '宇宙', translation: 'cosmos', status: 'preferred', caseSensitive: false },
      { term: '宇宙飞船', translation: 'spaceship', status: 'required', caseSensitive: false },
      { term: '宇宙无敌大刀', translation: 'cosmic blade', status: 'allowed', caseSensitive: false },
    ])
    const matches = db.termEntries.findMatches({ text: '宇宙飞船飞过宇宙', limit: 10 })
    assert.deepEqual(matches.map((match) => [match.term, match.start, match.end]), [
      ['宇宙飞船', 0, 4],
      ['宇宙', 6, 8],
    ])
  } finally {
    db.close()
  }
})

test('term matcher scopes conflicts and protects low-discrimination single characters', () => {
  const { store, project } = setup()
  const db = store.openProject(project.id)
  try {
    db.termEntries.importMany([
      { term: 'Charge', translation: '冲锋', status: 'preferred', caseSensitive: false, module: 'combat' },
      { term: 'Charge', translation: '收费', status: 'preferred', caseSensitive: false, module: 'billing' },
      { term: '剑', translation: 'sword', status: 'preferred', caseSensitive: false, module: 'weapon' },
    ])
    assert.equal(db.termEntries.listConflicts().length, 1)
    assert.equal(db.termEntries.listConflicts({ module: 'combat' }).length, 0)
    assert.equal(db.termEntries.findMatches({ text: '宝剑' }).length, 0)
    const scoped = db.termEntries.findMatches({ text: '宝剑', module: 'weapon' })
    assert.equal(scoped[0]?.term, '剑')
    assert.equal(scoped[0]?.lowDiscrimination, true)
  } finally {
    db.close()
  }
})

test('term cleaning, compiled-cache invalidation, and post-translation validation share one repository', () => {
  const { store, project } = setup()
  const db = store.openProject(project.id)
  try {
    assert.throws(() => db.termEntries.upsert({
      term: '   ', translation: '空', status: 'preferred', caseSensitive: false,
    }), /non-empty/)
    assert.deepEqual(db.termEntries.importMany([
      { term: '123', translation: '一二三', status: 'preferred', caseSensitive: false },
    ]), { imported: 0, unchanged: 0 })
    db.termEntries.importMany([
      { term: 'Potion', translation: '药水', status: 'required', caseSensitive: false },
      { term: 'Potion', translation: '药剂', status: 'preferred', caseSensitive: false },
      { term: 'Menu', translation: '菜单', status: 'preferred', caseSensitive: false },
      { term: 'Legacy', translation: '禁词', status: 'forbidden', caseSensitive: false },
    ])
    assert.equal(db.termEntries.findMatches({ text: 'Use Shield' }).length, 0)
    db.termEntries.upsert({
      term: 'Shield', translation: '盾牌', status: 'allowed', caseSensitive: false,
    })
    assert.equal(db.termEntries.findMatches({ text: 'Use Shield' })[0]?.translation, '盾牌')

    assert.deepEqual(db.termEntries.validateSegments([{
      segmentId: 'seg-1',
      source: 'Open the Potion Menu',
      target: '打开药剂并显示禁词',
    }]), {
      missingRequired: [{
        segmentId: 'seg-1',
        termId: db.termEntries.list({ status: 'required' })[0]!.id,
        term: 'Potion',
        expected: '药水',
      }],
      forbiddenHits: [{
        segmentId: 'seg-1',
        termId: db.termEntries.list({ status: 'forbidden' })[0]!.id,
        forbidden: '禁词',
      }],
      preferredNotUsed: [{
        segmentId: 'seg-1',
        termId: db.termEntries.list({ status: 'preferred' }).find((entry) => entry.term === 'Menu')!.id,
        term: 'Menu',
        preferred: '菜单',
      }],
      unresolvedConflicts: [{
        segmentId: 'seg-1',
        term: 'potion',
        termIds: db.termEntries.list({ query: 'Potion' }).map((entry) => entry.id).sort(),
      }],
    })
  } finally {
    db.close()
  }
})

test('term compiled buckets remain usable at 10k and 50k entries', { timeout: 30_000 }, () => {
  const { store, project } = setup()
  const db = store.openProject(project.id)
  const rows = (start: number, count: number) => Array.from({ length: count }, (_, offset) => ({
    term: `term${String(start + offset).padStart(5, '0')}`,
    translation: `译${start + offset}`,
    status: 'allowed' as const,
    caseSensitive: false,
  }))
  try {
    db.termEntries.importMany(rows(0, 10_000))
    assert.equal(db.termEntries.findMatches({ text: 'Use term09999 now' })[0]?.translation, '译9999')
    db.termEntries.importMany(rows(10_000, 40_000))
    assert.equal(db.termEntries.findMatches({ text: 'Use term49999 now' })[0]?.translation, '译49999')
  } finally {
    db.close()
  }
})

test('term batch rollback, collision detection, and read-only rejection', () => {
  const { store, project } = setup()
  const db = store.openProject(project.id)
  const original = { term: 'Save', translation: '保存', status: 'allowed' as const, caseSensitive: false }
  try {
    db.termEntries.importMany([original])
    const id = db.termEntries.list()[0]!.id
    db.catDb.db.prepare('UPDATE term_entries SET term = ? WHERE id = ?').run('corrupt', id)
    assert.throws(
      () => db.termEntries.importMany([
        { term: 'Fresh', translation: '新', status: 'allowed', caseSensitive: false },
        original,
      ]),
      /content id collision/,
    )
    assert.equal(db.termEntries.count({ query: 'Fresh' }), 0)
  } finally {
    db.close()
  }

  const readOnly = store.openProject(project.id, { readOnly: true })
  try {
    assert.throws(() => readOnly.termEntries.importMany([original]), StoreReadOnlyError)
    assert.throws(
      () => readOnly.termEntries.upsert(original),
      StoreReadOnlyError,
    )
    assert.throws(() => readOnly.termEntries.delete('ter-0000000000000000'), StoreReadOnlyError)
  } finally {
    readOnly.close()
  }
})
