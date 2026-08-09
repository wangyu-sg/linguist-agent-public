import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  asSegmentId,
  fnv1a64,
  InvalidStateTransitionError,
  sha256Hex,
} from '@linguist/cat-core'
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
    assert.ok(first.every((f) => /^qaf_v2_[0-9a-f]{64}$/.test(f.id)))

    // resolve one finding, then rerun: open ones are replaced, resolved stays
    db.qaFindings.transition(first[0]!.id, 'resolved')
    const rerun = db.qaFindings.replaceForSegment(seg, [
      { segmentId: seg, code: 'TAG_MISMATCH', severity: 'L2', message: 'tag mismatch' },
    ])
    assert.equal(rerun.length, 1)

    const all = db.qaFindings.list({ segmentId: seg })
    assert.equal(all.length, 3, 'resolved findings stay auditable + new open finding')
    assert.deepEqual(
      all.map((f) => `${f.code}:${f.status}`).sort(),
      ['NUMBER_MISMATCH:resolved', 'TAG_MISMATCH:open', 'TRAILING_SPACE:resolved'],
    )
    assert.equal(db.qaFindings.list({ segmentId: seg, status: 'open' }).length, 1)
    assert.equal(db.qaFindings.list({ status: 'resolved' }).length, 2)
  } finally {
    db.close()
  }
})

test('replaceForSegment: a recurring resolved finding stays resolved until explicit reopen', () => {
  const { db, segments } = setup()
  try {
    const seg = segments[0]!.id
    const input = { segmentId: seg, code: 'NUMBER_MISMATCH', severity: 'L1' as const, message: 'number missing' }
    const [finding] = db.qaFindings.replaceForSegment(seg, [input])
    db.qaFindings.transition(finding!.id, 'resolved')
    // Same revision/rule/evidence is another occurrence, not an implicit reopen.
    db.qaFindings.replaceForSegment(seg, [input])
    const after = db.qaFindings.getById(finding!.id)
    assert.equal(after?.status, 'resolved')
    assert.equal(db.qaFindings.list({ segmentId: seg }).length, 1)
    const occurrences = db.qaFindings.listOccurrences(finding!.id)
    assert.equal(occurrences.length, 2)
    assert.ok(occurrences.every((item) => /^qao_v2_[0-9a-f]{64}$/.test(item.occurrenceId)))
    assert.ok(db.qaFindings
      .listStatusEvents(finding!.id)
      .every((item) => /^qse_v2_[0-9a-f]{64}$/.test(item.eventId)))
  } finally {
    db.close()
  }
})

test('replaceForSegment: rerun reuses a persisted v1 identity without rewriting its id', () => {
  const { db, segments } = setup()
  try {
    const segmentId = segments[0]!.id
    const code = 'NUMBER_MISMATCH'
    const message = 'number missing'
    const legacyId = `qaf-${fnv1a64(`${segmentId}${code}${message}`)}`
    const legacyEvidenceHash = sha256Hex(new TextEncoder().encode(legacyId))
    db.catDb.db.prepare(`
      INSERT INTO qa_findings (
        id, segment_id, code, severity, issue_type, disposition, message, status,
        segment_revision, rule_version, evidence_hash, first_seen_run_id, created_at
      ) VALUES (?, ?, ?, 'L1', 'numbers_units_dates', 'defect', ?, 'open',
        0, 'deterministic-v1', ?, 'legacy-run', '2026-01-01T00:00:00.000Z')
    `).run(legacyId, segmentId, code, message, legacyEvidenceHash)

    const [rerun] = db.qaFindings.replaceForSegment(segmentId, [{
      segmentId,
      code,
      severity: 'L1',
      message,
    }])

    assert.equal(rerun!.id, legacyId)
    assert.equal(db.qaFindings.list({ segmentId }).length, 1)
  } finally {
    db.close()
  }
})

test('QA lifecycle matrix: occurrences preserve terminal evidence; revision/rule changes create new identities', () => {
  const { db, segments } = setup()
  try {
    const [firstSegment, secondSegment] = segments
    const inputs = [
      {
        segmentId: firstSegment!.id,
        code: 'NUMBER_MISMATCH',
        severity: 'L1' as const,
        message: 'number missing',
        evidenceHash: 'number-token-42',
      },
      {
        segmentId: secondSegment!.id,
        code: 'TAG_MISMATCH',
        severity: 'L0' as const,
        message: 'tag missing',
        evidenceHash: 'tag-x',
      },
    ]
    const revisions = new Map(segments.map((segment) => [String(segment.id), segment.revision]))
    const first = db.qaFindings.replaceForProject(inputs, revisions, {
      runId: 'qa:run-1',
      observedAt: '2026-07-29T01:00:00.000Z',
      ruleVersion: 'rules-v1',
    })
    const rerun = db.qaFindings.replaceForProject(inputs, revisions, {
      runId: 'qa:run-2',
      observedAt: '2026-07-29T01:01:00.000Z',
      ruleVersion: 'rules-v1',
    })
    assert.deepEqual(rerun.map((finding) => finding.id), first.map((finding) => finding.id))
    assert.ok(first.every((finding) => db.qaFindings.listOccurrences(finding.id).length === 2))

    db.qaFindings.transition(first[0]!.id, 'waived', {
      reason: '数字由运行时注入',
      operator: 'reviewer-1',
      at: '2026-07-29T01:02:00.000Z',
    })
    db.qaFindings.transition(first[1]!.id, 'resolved')
    db.qaFindings.replaceForProject(inputs, revisions, {
      runId: 'qa:run-3',
      observedAt: '2026-07-29T01:03:00.000Z',
      ruleVersion: 'rules-v1',
    })
    const waived = db.qaFindings.getById(first[0]!.id)
    assert.equal(waived?.status, 'waived')
    assert.equal(waived?.waiverReason, '数字由运行时注入')
    assert.equal(waived?.waivedBy, 'reviewer-1')
    assert.equal(db.qaFindings.getById(first[1]!.id)?.status, 'resolved')

    db.segments.applyTargetEdit(firstSegment!.id, 'revision one', 0)
    const [newRevision] = db.qaFindings.replaceForSegment(firstSegment!.id, [inputs[0]!], {
      runId: 'qa:run-4',
      observedAt: '2026-07-29T01:04:00.000Z',
      ruleVersion: 'rules-v1',
    })
    assert.notEqual(newRevision!.id, first[0]!.id)
    assert.equal(newRevision!.segmentRevision, 1)
    assert.equal(db.qaFindings.getById(first[0]!.id)?.status, 'waived')

    const [newRule] = db.qaFindings.replaceForSegment(firstSegment!.id, [inputs[0]!], {
      runId: 'qa:run-5',
      observedAt: '2026-07-29T01:05:00.000Z',
      ruleVersion: 'rules-v2',
    })
    assert.notEqual(newRule!.id, newRevision!.id)
    assert.equal(newRule!.ruleVersion, 'rules-v2')
    assert.equal(db.qaFindings.getById(newRevision!.id)?.status, 'resolved')

    db.qaFindings.replaceForSegment(firstSegment!.id, [], {
      runId: 'qa:run-6',
      observedAt: '2026-07-29T01:06:00.000Z',
      ruleVersion: 'rules-v2',
    })
    assert.equal(db.qaFindings.getById(newRule!.id)?.status, 'resolved')
    assert.ok(
      db.qaFindings
        .listStatusEvents(newRule!.id)
        .some((event) => event.reason === 'not observed in QA rerun'),
    )

    const [legacy] = db.qaFindings.insertOpen([{
      segmentId: firstSegment!.id,
      code: 'CRITIC_FIDELITY',
      severity: 'L2',
      message: 'review evidence',
      evidenceHash: 'critic-finding-1',
    }], { runId: 'critic:run-1', observedAt: '2026-07-29T01:07:00.000Z' })
    db.qaFindings.replaceForProject([], new Map(segments.map((segment) => [
      String(segment.id),
      db.segments.getById(segment.id)!.revision,
    ])), {
      runId: 'qa:run-7',
      observedAt: '2026-07-29T01:08:00.000Z',
      ruleVersion: 'rules-v2',
    })
    assert.equal(db.qaFindings.getById(legacy!.id)?.status, 'open')
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

test('insertOpen: advisory inserts keep existing rows, stay idempotent, preserve terminal rows', () => {
  const { db, segments } = setup()
  try {
    const seg = segments[0]!.id
    const [existing] = db.qaFindings.replaceForSegment(seg, [
      { segmentId: seg, code: 'EMPTY_TARGET', severity: 'L1', message: 'target empty' },
    ])

    // insertOpen does NOT delete the existing open finding (unlike replaceForSegment)
    const inserted = db.qaFindings.insertOpen([
      { segmentId: seg, code: 'MANUAL_REVIEW', severity: 'L2', message: '译文漏译。' },
    ])
    assert.equal(inserted.length, 1)
    assert.equal(inserted[0]!.status, 'open')
    assert.equal(inserted[0]!.segmentRevision, 0)
    assert.equal(db.qaFindings.list({ segmentId: seg }).length, 2)
    assert.equal(db.qaFindings.getById(existing!.id)?.status, 'open')

    // idempotent: same content-derived id re-inserted without duplication
    assert.doesNotThrow(() =>
      db.qaFindings.insertOpen([
        { segmentId: seg, code: 'MANUAL_REVIEW', severity: 'L2', message: '译文漏译。' },
      ]),
    )
    assert.equal(db.qaFindings.list({ segmentId: seg }).length, 2)

    // A resolved row with identical identity remains terminal; reopen is explicit.
    const advisory = inserted[0]!
    db.qaFindings.transition(advisory.id, 'resolved')
    db.qaFindings.insertOpen([{ segmentId: seg, code: 'MANUAL_REVIEW', severity: 'L2', message: '译文漏译。' }])
    assert.equal(db.qaFindings.getById(advisory.id)?.status, 'resolved')
    assert.equal(db.qaFindings.transition(advisory.id, 'open').status, 'open')

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
