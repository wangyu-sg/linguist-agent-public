import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildQaTermOptions, runProjectQa } from './qa-runner'
import { CatStore } from './store'
import { makeClock, makeEntropy, makeImportedAsset, makeTempDir } from './testkit'
test('PB-071 project QA persists revision-bound findings and waiver reasons', () => {
  const store = new CatStore({ rootDir: makeTempDir(), entropy: makeEntropy(), now: makeClock() })
  const project = store.createProject({
    name: 'QA',
    sourceLocale: 'en',
    targetLocale: 'zh-CN',
    promaWorkspaceId: 'ws',
  })
  const db = store.openProject(project.id)
  try {
    const { segments } = db.assets.insertImported(makeImportedAsset({ segmentCount: 3 }))
    const first = runProjectQa(db)
    assert.equal(first.length, 3)
    assert.ok(first.every((finding) =>
      finding.code === 'EMPTY_TARGET'
      && finding.severity === 'L1'
      && finding.segmentRevision === 0,
    ))

    const waived = db.qaFindings.transition(first[0]!.id, 'waived', {
      reason: '源文件明确要求留空',
      operator: '测试审校员',
      at: '2026-07-29T00:00:00.000Z',
    })
    assert.equal(waived.waiverReason, '源文件明确要求留空')
    assert.equal(db.qaFindings.getById(first[0]!.id)?.waiverReason, '源文件明确要求留空')

    db.segments.applyTargetEdit(segments[0]!.id, '译文 0 内容充足', 0)
    const rerun = runProjectQa(db)
    assert.equal(rerun.length, 2)
    assert.equal(db.qaFindings.list({ status: 'open' }).length, 2)
    assert.equal(db.qaFindings.list({ status: 'waived' }).length, 1)
  } finally {
    db.close()
  }
})

test('deterministic project QA rerun leaves legacy prefixed findings untouched', () => {
  const store = new CatStore({ rootDir: makeTempDir(), entropy: makeEntropy(), now: makeClock() })
  const project = store.createProject({
    name: 'QA-LEGACY',
    sourceLocale: 'en',
    targetLocale: 'zh-CN',
    promaWorkspaceId: 'ws',
  })
  const db = store.openProject(project.id)
  try {
    const { segments } = db.assets.insertImported(makeImportedAsset({ segmentCount: 1, fillEvery: 1 }))
    const legacy = db.qaFindings.insertOpen([{
      segmentId: segments[0]!.id,
      code: 'CRITIC_FIDELITY',
      severity: 'L2',
      message: '独立复核发现疑似漏译。',
    }])[0]!

    runProjectQa(db)

    assert.equal(db.qaFindings.getById(legacy.id)?.status, 'open')
  } finally {
    db.close()
  }
})

test('术语接线：required/forbidden 阻断，preferred 仅建议，一词多译进入 query', () => {
  const store = new CatStore({ rootDir: makeTempDir(), entropy: makeEntropy(), now: makeClock() })
  const project = store.createProject({
    name: 'QA-TERM',
    sourceLocale: 'en',
    targetLocale: 'zh-CN',
    promaWorkspaceId: 'ws',
  })
  const db = store.openProject(project.id)
  try {
    db.termEntries.importMany([
      { term: 'Potion', translation: '药水', status: 'required', caseSensitive: false },
      // required 与 preferred 的不同译法仍是冲突组。
      { term: 'Potion', translation: '药剂', status: 'preferred', caseSensitive: false },
      { term: 'Menu', translation: '菜单', status: 'preferred', caseSensitive: false },
      { term: 'Save', translation: '禁译词', status: 'forbidden', caseSensitive: false },
    ])
    const { segments } = db.assets.insertImported(makeImportedAsset({ segmentCount: 2, fillEvery: 1 }))
    db.segments.applyTargetEdit(segments[0]!.id, '喝了它再说', 0)
    db.segments.applyTargetEdit(segments[1]!.id, '这里有禁译词出现', 0)
    // 源文手动改写为含术语的文本（imported 段源文不含 Potion/Save）
    db.catDb.db.prepare('UPDATE segments SET source = ? WHERE id = ?').run('Drink the Potion from the Menu now', segments[0]!.id)
    db.catDb.db.prepare('UPDATE segments SET source = ? WHERE id = ?').run('Press Save to continue', segments[1]!.id)

    const findings = runProjectQa(db)
    const byCode = new Map(findings.map((finding) => [finding.code, finding]))

    assert.deepEqual(
      buildQaTermOptions(db).requiredTerminology?.map((term) => term.sourceTerm),
      ['Potion'],
      'preferred 不得冒充 required',
    )
    // required 缺失始终阻断。
    const required = byCode.get('REQUIRED_TERM')
    assert.ok(required !== undefined)
    assert.equal(required.severity, 'L1')
    assert.equal(required.issueType, 'terminology_hard')
    assert.equal(required.disposition, 'defect')

    // forbidden 永远 strict 阻断：L1 defect（terminology_hard）
    const forbidden = byCode.get('FORBIDDEN_TERM')
    assert.ok(forbidden !== undefined)
    assert.equal(forbidden.severity, 'L1')
    assert.equal(forbidden.issueType, 'terminology_hard')
    assert.equal(forbidden.disposition, 'defect')

    // 一词多译冲突：glossary_conflict / query
    const conflict = byCode.get('GLOSSARY_CONFLICT')
    assert.ok(conflict !== undefined)
    assert.equal(conflict.issueType, 'glossary_conflict')
    assert.equal(conflict.disposition, 'query')
    assert.ok(conflict.message.includes('Potion'))

    const off = runProjectQa(db, { glossaryPolicy: 'off' })
    assert.equal(off.find((finding) => finding.code === 'REQUIRED_TERM')?.severity, 'L1')
  } finally {
    db.close()
  }
})
