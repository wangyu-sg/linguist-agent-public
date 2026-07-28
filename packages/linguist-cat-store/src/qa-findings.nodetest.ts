import { test } from 'node:test'
import assert from 'node:assert/strict'
import { asSegmentId, InvalidStateTransitionError } from '@linguist/cat-core'
import { StoreNotFoundError } from './errors'
import { CatStore } from './store'
import { makeClock, makeEntropy, makeImportedAsset, makeTempDir } from './testkit'

function setup() {
  const store = new CatStore({ rootDir: makeTempDir(), entropy: makeEntropy(), now: makeClock() })
  const project = store.createProject({ name: 'P', sourceLocale: 'en', targetLocale: 'zh-CN', promaWorkspaceId: 'ws' })
  const db = store.openProject(project.id)
  const { segments } = db.assets.insertImported(makeImportedAsset({ segmentCount: 2 }))
  return { store, project, db, segments }
}

test('replaceForSegment: rerun replaces open findings, keeps resolved/waived history', () => {
  const { db, segments } = setup()
  try {
    const seg = segments[0]!.id
    const first = db.qaFindings.replaceForSegment(seg, [
      { segmentId: seg, code: 'NUMBER_MISMATCH', severity: 'L1', message: 'number missing' },
      { segmentId: seg, code: 'TRAILING_SPACE', severity: 'L4', message: 'trailing space' },
    ])
    assert.equal(first.length, 2)
    assert.ok(first.every((f) => f.status === 'open'))

    // resolve one finding, then rerun: open ones are replaced, resolved stays
    db.qaFindings.transition(first[0]!.id, 'resolved')
    const rerun = db.qaFindings.replaceForSegment(seg, [
      { segmentId: seg, code: 'TAG_MISMATCH', severity: 'L2', message: 'tag mismatch' },
    ])
    assert.equal(rerun.length, 1)

    const all = db.qaFindings.list({ segmentId: seg })
    assert.equal(all.length, 2, 'resolved finding kept + new open finding')
    assert.deepEqual(
      all.map((f) => `${f.code}:${f.status}`).sort(),
      ['NUMBER_MISMATCH:resolved', 'TAG_MISMATCH:open'],
    )
    assert.equal(db.qaFindings.list({ segmentId: seg, status: 'open' }).length, 1)
    assert.equal(db.qaFindings.list({ status: 'resolved' }).length, 1)
  } finally {
    db.close()
  }
})

test('replaceForSegment: a recurring resolved finding reopens (problem still present)', () => {
  const { db, segments } = setup()
  try {
    const seg = segments[0]!.id
    const input = { segmentId: seg, code: 'NUMBER_MISMATCH', severity: 'L1' as const, message: 'number missing' }
    const [finding] = db.qaFindings.replaceForSegment(seg, [input])
    db.qaFindings.transition(finding!.id, 'resolved')
    // same content -> same content-derived id -> row replaced and reopened
    db.qaFindings.replaceForSegment(seg, [input])
    const after = db.qaFindings.getById(finding!.id)
    assert.equal(after?.status, 'open')
    assert.equal(db.qaFindings.list({ segmentId: seg }).length, 1)
  } finally {
    db.close()
  }
})

test('transition: open -> resolved/waived -> reopen; invalid transitions rejected', () => {
  const { db, segments } = setup()
  try {
    const seg = segments[0]!.id
    const [finding] = db.qaFindings.replaceForSegment(seg, [
      { segmentId: seg, code: 'C', severity: 'L4', message: 'm' },
    ])
    const evidence = {
      reason: '人工确认可忽略',
      operator: '测试审校员',
      at: '2026-07-29T10:00:00.000Z',
    }
    assert.equal(db.qaFindings.transition(finding!.id, 'waived', evidence).status, 'waived')
    assert.equal(db.qaFindings.getById(finding!.id)?.waiverReason, '人工确认可忽略')
    assert.equal(db.qaFindings.getById(finding!.id)?.waivedBy, '测试审校员')
    assert.equal(db.qaFindings.getById(finding!.id)?.waivedAt, evidence.at)
    assert.equal(db.qaFindings.getById(finding!.id)?.status, 'waived')
    assert.equal(db.qaFindings.transition(finding!.id, 'open').status, 'open')
    assert.equal(db.qaFindings.transition(finding!.id, 'resolved').status, 'resolved')
    // resolved -> waived is not a legal transition
    assert.throws(
      () => db.qaFindings.transition(finding!.id, 'waived'),
      (err: unknown) => {
        assert.ok(err instanceof InvalidStateTransitionError)
        assert.equal(err.code, 'INVALID_STATE_TRANSITION')
        return true
      },
    )
    assert.throws(() => db.qaFindings.transition('qaf-0000000000000000', 'resolved'), StoreNotFoundError)
  } finally {
    db.close()
  }
})

test('waiveMany: 同一理由/操作者原子豁免精确 finding ids，失败时整批回滚', () => {
  const { db, segments } = setup()
  try {
    const findings = db.qaFindings.replaceForProject([
      {
        segmentId: segments[0]!.id,
        code: 'REPEATED_PUNCTUATION',
        severity: 'L3',
        message: 'subtitle punctuation',
      },
      {
        segmentId: segments[1]!.id,
        code: 'REPEATED_PUNCTUATION',
        severity: 'L3',
        message: 'subtitle punctuation',
      },
    ], new Map(segments.map((segment) => [String(segment.id), segment.revision])))
    const evidence = {
      reason: '字幕项目允许强调标点',
      operator: '王宇',
      at: '2026-07-29T11:00:00.000Z',
    }
    const waived = db.qaFindings.waiveMany(findings.map((finding) => finding.id), evidence)
    assert.equal(waived.length, 2)
    assert.ok(waived.every((finding) =>
      finding.status === 'waived'
      && finding.waiverReason === evidence.reason
      && finding.waivedBy === evidence.operator
      && finding.waivedAt === evidence.at))

    db.qaFindings.transition(findings[0]!.id, 'open')
    assert.throws(
      () => db.qaFindings.waiveMany(
        [findings[0]!.id, 'qaf-0000000000000000'],
        evidence,
      ),
      StoreNotFoundError,
    )
    assert.equal(db.qaFindings.getById(findings[0]!.id)?.status, 'open')
  } finally {
    db.close()
  }
})

test('insertOpen: advisory inserts keep existing rows, stay idempotent, reopen identical reviewed rows', () => {
  const { db, segments } = setup()
  try {
    const seg = segments[0]!.id
    const [existing] = db.qaFindings.replaceForSegment(seg, [
      { segmentId: seg, code: 'EMPTY_TARGET', severity: 'L1', message: 'target empty' },
    ])

    // insertOpen does NOT delete the existing open finding (unlike replaceForSegment)
    const inserted = db.qaFindings.insertOpen([
      { segmentId: seg, code: 'CRITIC_FIDELITY', severity: 'L2', message: '译文漏译。' },
    ])
    assert.equal(inserted.length, 1)
    assert.equal(inserted[0]!.status, 'open')
    assert.equal(inserted[0]!.segmentRevision, 0)
    assert.equal(db.qaFindings.list({ segmentId: seg }).length, 2)
    assert.equal(db.qaFindings.getById(existing!.id)?.status, 'open')

    // idempotent: same content-derived id re-inserted without duplication
    assert.doesNotThrow(() =>
      db.qaFindings.insertOpen([
        { segmentId: seg, code: 'CRITIC_FIDELITY', severity: 'L2', message: '译文漏译。' },
      ]),
    )
    assert.equal(db.qaFindings.list({ segmentId: seg }).length, 2)

    // a resolved row with identical content reopens (problem reviewed but still present)
    const critic = inserted[0]!
    db.qaFindings.transition(critic.id, 'resolved')
    db.qaFindings.insertOpen([{ segmentId: seg, code: 'CRITIC_FIDELITY', severity: 'L2', message: '译文漏译。' }])
    assert.equal(db.qaFindings.getById(critic.id)?.status, 'open')

    // unknown segment fails closed
    assert.throws(
      () => db.qaFindings.insertOpen([{ segmentId: asSegmentId('seg-0000000000000000'), code: 'C', severity: 'L4', message: 'm' }]),
      StoreNotFoundError,
    )
  } finally {
    db.close()
  }
})

test('countOpenByAsset: only open findings are grouped by the segment asset', () => {
  const { db, segments } = setup()
  try {
    const { asset: secondAsset, segments: secondSegments } = db.assets.insertImported(
      makeImportedAsset({ segmentCount: 1, filename: 'second.tsv', sourceSha256: 'b'.repeat(64) }),
    )
    const [first] = db.qaFindings.replaceForSegment(segments[0]!.id, [
      { segmentId: segments[0]!.id, code: 'FIRST', severity: 'L2', message: 'first' },
    ])
    db.qaFindings.replaceForSegment(secondSegments[0]!.id, [
      { segmentId: secondSegments[0]!.id, code: 'SECOND', severity: 'L3', message: 'second' },
    ])
    db.qaFindings.transition(first!.id, 'resolved')

    assert.deepEqual([...db.qaFindings.countOpenByAsset()], [[secondAsset.id, 1]])
  } finally {
    db.close()
  }
})
