import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { sha256Hex } from '@linguist/cat-formats'
import { saveProjectBlob } from './blobs'
import { scanProjectIntegrity } from './integrity'
import { SCHEMA_VERSION } from './schema'
import { CatStore } from './store'
import { makeClock, makeEntropy, makeImportedAsset, makeTempDir } from './testkit'

function setup() {
  const store = new CatStore({ rootDir: makeTempDir(), entropy: makeEntropy('integrity'), now: makeClock() })
  const project = store.createProject({
    name: 'Integrity',
    sourceLocale: 'en',
    targetLocale: 'zh-CN',
    promaWorkspaceId: 'ws-integrity',
  })
  const projectDir = join(store.rootDir, 'projects', project.id)
  return { store, project, projectDir }
}

test('Full Integrity Scrub checks every source digest, not the Quick Health sample', () => {
  const { store, project, projectDir } = setup()
  const db = store.openProject(project.id)
  const sourcePaths: string[] = []
  for (let index = 0; index < 25; index += 1) {
    const bytes = Buffer.from(`source-${index}`)
    const imported = db.assets.insertImported(makeImportedAsset({
      filename: `asset-${index}.txt`,
      sourceSha256: sha256Hex(bytes),
      segmentCount: 1,
    }))
    sourcePaths.push(join(db.sourceDir, `${imported.asset.id}.txt`))
    db.saveAssetSource(imported.asset.id, bytes)
  }
  db.close()

  writeFileSync(sourcePaths[24]!, 'tampered')
  const report = scanProjectIntegrity({ projectDir, expectedProjectId: project.id })
  const sources = report.checks.find((check) => check.id === 'source_digests')
  assert.equal(sources?.checkedItems, 25)
  assert.equal(sources?.status, 'failed')
  assert.deepEqual(sources?.problems, [{ code: 'SOURCE_DIGEST_MISMATCH', count: 1 }])
  assert.equal(report.outcome, 'failed')
})

test('Full Integrity Scrub reports unavailable blob evidence instead of claiming success', () => {
  const { store, project, projectDir } = setup()
  const db = store.openProject(project.id)
  const bytes = Buffer.from('context')
  saveProjectBlob(db.blobsDir, 'ctx.md', bytes)
  db.contextDocs.insert({
    kind: 'doc',
    originalFilename: 'ctx.md',
    blobRelpath: 'blobs/ctx.md',
  })
  db.close()

  const report = scanProjectIntegrity({ projectDir, expectedProjectId: project.id })
  const blobs = report.checks.find((check) => check.id === 'blob_digests')
  assert.equal(blobs?.status, 'unavailable')
  assert.equal(blobs?.checkedItems, 1)
  assert.equal(blobs?.unavailableItems, 1)
  assert.deepEqual(blobs?.problems, [{ code: 'BLOB_DIGEST_UNAVAILABLE', count: 1 }])
  assert.equal(report.outcome, 'incomplete')
})

test('Full Integrity Scrub validates managed TM/TB import source blobs', () => {
  const { store, project, projectDir } = setup()
  const db = store.openProject(project.id)
  const bytes = Buffer.from('source,target\nHello,你好\n')
  const sha256 = sha256Hex(bytes)
  const blobName = `ref-${sha256}`
  saveProjectBlob(db.blobsDir, blobName, bytes)
  db.referenceImports.insert({
    kind: 'tm',
    originalFilename: 'memory.csv',
    sourceSha256: sha256,
    blobRelpath: `blobs/${blobName}`,
  })
  db.close()

  writeFileSync(join(projectDir, 'blobs', blobName), 'tampered')
  const report = scanProjectIntegrity({ projectDir, expectedProjectId: project.id })
  const blobs = report.checks.find((check) => check.id === 'blob_digests')
  assert.equal(blobs?.checkedItems, 1)
  assert.equal(blobs?.status, 'failed')
  assert.deepEqual(blobs?.problems, [{ code: 'BLOB_DIGEST_MISMATCH', count: 1 }])
})

test('Full Integrity Scrub checks foreign keys and Proposal/QA/Review lineage', () => {
  const { store, project, projectDir } = setup()
  const db = store.openProject(project.id)
  const bytes = Buffer.from('source')
  const { asset, segments } = db.assets.insertImported(makeImportedAsset({
    filename: 'asset.txt',
    sourceSha256: sha256Hex(bytes),
    segmentCount: 1,
  }))
  db.saveAssetSource(asset.id, bytes)
  db.catDb.db.exec('PRAGMA foreign_keys = OFF')
  db.catDb.db.prepare(`
    INSERT INTO proposals
      (id, segment_id, base_revision, proposed_target, evidence_refs_json, term_refs_json,
       warnings_json, created_at, status, reissued_from_proposal_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run('prp-broken', segments[0]!.id, 99, 'x', '[]', '[]', '[]', '2026-01-01T00:00:00.000Z', 'pending', 'prp-missing')
  db.catDb.db.prepare(`
    INSERT INTO critic_artifacts (artifact_id, segment_id, created_at, artifact_json)
    VALUES (?, ?, ?, ?)
  `).run('critic-broken', segments[0]!.id, '2026-01-01T00:00:00.000Z', '{bad-json')
  db.catDb.db.prepare(`
    INSERT INTO qa_findings
      (id, segment_id, code, severity, message, status, segment_revision,
       issue_type, disposition, rule_version, evidence_hash, first_seen_run_id, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    'qaf-broken',
    'seg-missing',
    'EMPTY_TARGET',
    'L1',
    'missing',
    'open',
    0,
    'omission',
    'defect',
    'v1',
    'hash',
    'run',
    '2026-01-01T00:00:00.000Z',
  )
  db.close()

  const report = scanProjectIntegrity({ projectDir, expectedProjectId: project.id })
  assert.equal(report.checks.find((check) => check.id === 'foreign_keys')?.status, 'failed')
  assert.equal(report.checks.find((check) => check.id === 'proposal_references')?.status, 'failed')
  assert.equal(report.checks.find((check) => check.id === 'qa_references')?.status, 'failed')
  assert.equal(report.checks.find((check) => check.id === 'review_references')?.status, 'failed')
})

test('Full Integrity Scrub validates v13 Proposal Issuance references and provenance JSON', () => {
  const { store, project, projectDir } = setup()
  const db = store.openProject(project.id)
  const bytes = Buffer.from('issuance-source')
  const { asset, segments } = db.assets.insertImported(makeImportedAsset({
    filename: 'issuance.txt',
    sourceSha256: sha256Hex(bytes),
    segmentCount: 1,
  }))
  db.saveAssetSource(asset.id, bytes)
  const proposal = db.proposals.insertPending({
    segmentId: segments[0]!.id,
    baseRevision: 0,
    proposedTarget: '候选译文 0',
  }, {
    issuance: {
      idempotencyKey: 'issuance-integrity',
      sessionId: 'session-integrity',
      runId: 'run-integrity',
      toolCallId: 'tool-integrity',
      runtime: 'worker',
      turnContextVersion: 1,
      turnContextSnapshot: '{"schemaVersion":1}',
    },
  })
  db.close()

  const valid = scanProjectIntegrity({ projectDir, expectedProjectId: project.id })
  assert.equal(valid.schemaVersion, SCHEMA_VERSION)
  assert.equal(valid.checks.find((check) => check.id === 'schema_version')?.status, 'passed')
  assert.equal(valid.checks.find((check) => check.id === 'proposal_references')?.status, 'passed')

  const corrupt = store.openProject(project.id)
  corrupt.catDb.db.exec('PRAGMA foreign_keys = OFF')
  corrupt.catDb.db.prepare(`
    INSERT INTO proposals
      (id, segment_id, base_revision, proposed_target, evidence_refs_json,
       term_refs_json, warnings_json, created_at, status)
    VALUES (?, ?, 0, 'missing issuance', '[]', '[]', '[]', ?, 'pending')
  `).run('prp-no-issuance', segments[0]!.id, '2026-07-29T00:00:00.000Z')
  corrupt.catDb.db.prepare(`
    INSERT INTO proposals
      (id, segment_id, base_revision, proposed_target, evidence_refs_json,
       term_refs_json, warnings_json, created_at, status)
    VALUES (?, 'seg-missing', 0, 'missing segment', '[]', '[]', '[]', ?, 'pending')
  `).run('prp-missing-segment', '2026-07-29T00:00:01.000Z')
  corrupt.catDb.db.prepare(`
    INSERT INTO proposal_issuances
      (issuance_id, proposal_id, evidence_refs_json, term_refs_json, created_at)
    VALUES
      ('pis_v2_orphan', 'prp-missing', '[]', '[]', '2026-07-29T00:00:02.000Z'),
      ('pis_v2_missing_segment', 'prp-missing-segment', '[]', '[]', '2026-07-29T00:00:03.000Z')
  `).run()
  corrupt.catDb.db.prepare(`
    UPDATE proposal_issuances
    SET evidence_refs_json = '{',
        turn_context_snapshot_json = '{'
    WHERE proposal_id = ?
  `).run(proposal.id)
  corrupt.close()

  const report = scanProjectIntegrity({ projectDir, expectedProjectId: project.id })
  const problems = new Set(
    report.checks
      .find((check) => check.id === 'proposal_references')
      ?.problems.map((problem) => problem.code),
  )
  assert.ok(problems.has('PROPOSAL_ISSUANCE_MISSING'))
  assert.ok(problems.has('PROPOSAL_ISSUANCE_ORPHAN'))
  assert.ok(problems.has('PROPOSAL_ISSUANCE_SEGMENT_MISSING'))
  assert.ok(problems.has('PROPOSAL_ISSUANCE_PROVENANCE_JSON_INVALID'))
})

test('Full Integrity Scrub fails closed when v13 manifest and database identity diverge', () => {
  const { store, project, projectDir } = setup()
  store.openProject(project.id).close()
  const projectJson = join(projectDir, 'project.json')
  const manifest = JSON.parse(readFileSync(projectJson, 'utf8')) as {
    databaseIdentity: { schemaVersion: number }
  }
  manifest.databaseIdentity.schemaVersion = 12
  writeFileSync(projectJson, JSON.stringify(manifest))

  const report = scanProjectIntegrity({ projectDir, expectedProjectId: project.id })
  const schema = report.checks.find((check) => check.id === 'schema_version')
  assert.equal(schema?.status, 'failed')
  assert.ok(schema?.problems.some((problem) =>
    problem.code === 'CAT_DB_OPEN_STORE_DATABASE_IDENTITY'))
})

test('Full Integrity Scrub checks Harness event sequence, job checkpoint, and run lineage', () => {
  const { store, project, projectDir } = setup()
  const db = store.openProject(project.id)
  const bytes = Buffer.from('harness-source')
  const { asset, segments } = db.assets.insertImported(makeImportedAsset({
    filename: 'harness.txt',
    sourceSha256: sha256Hex(bytes),
    segmentCount: 1,
  }))
  db.saveAssetSource(asset.id, bytes)
  const segment = segments[0]!
  db.runs.createJob({
    jobId: 'job-integrity',
    runId: 'run-integrity',
    sessionId: 'session-integrity',
    strategy: 'balanced',
    segmentIds: [segment.id as string],
    provenance: { schemaVersion: 1, runtime: 'worker' },
  })
  db.runs.transitionJob('job-integrity', { sessionId: 'session-integrity' }, 'running')
  const mutation = db.runs.executeMutation({
    identity: {
      runId: 'run-integrity',
      toolCallId: 'tool-integrity',
      idempotencyKey: 'mutation-integrity',
    },
    operation: 'cat_propose_translations',
    payload: { segmentId: segment.id as string },
    mutate: () => {
      const proposal = db.proposals.insertPending({
        segmentId: segment.id,
        baseRevision: segment.revision,
        proposedTarget: '候选译文 0',
        runId: 'run-integrity',
      })
      return {
        result: { proposalId: proposal.id as string },
        changes: [{
          entityType: 'proposal' as const,
          entityId: proposal.id as string,
          changeKind: 'created' as const,
          segmentId: segment.id as string,
          expectedRevision: segment.revision,
          after: proposal,
        }],
        event: {
          kind: 'proposal-created' as const,
          segmentIds: [segment.id as string],
          proposalIds: [proposal.id as string],
        },
      }
    },
  })
  db.runs.checkpointJob({
    jobId: 'job-integrity',
    sessionId: 'session-integrity',
    cursor: 1,
    completedSegmentIds: [segment.id as string],
    failedSegmentIds: [],
    proposalIds: [mutation.result.proposalId],
    openItemIds: [],
  })
  db.runs.createJob({
    jobId: 'job-internal-check',
    runId: 'run-internal-check',
    sessionId: 'session-internal-check',
    strategy: 'balanced',
    segmentIds: [segment.id as string],
    provenance: {
      schemaVersion: 1,
      runtime: 'worker',
      projectEventPolicy: 'suppress',
    },
  })
  db.runs.transitionJob(
    'job-internal-check',
    { sessionId: 'session-internal-check' },
    'running',
  )
  db.close()

  const valid = scanProjectIntegrity({ projectDir, expectedProjectId: project.id })
  assert.equal(valid.checks.find((check) => check.id === 'event_sequence')?.status, 'passed')
  assert.equal(valid.checks.find((check) => check.id === 'job_lineage')?.status, 'passed')
  assert.equal(valid.checks.find((check) => check.id === 'run_lineage')?.status, 'passed')

  const corrupt = store.openProject(project.id)
  corrupt.catDb.db.exec('PRAGMA foreign_keys = OFF')
  corrupt.catDb.db.exec('DELETE FROM project_events WHERE sequence = (SELECT MIN(sequence) FROM project_events)')
  corrupt.catDb.db.prepare('UPDATE translation_jobs SET cursor = 99 WHERE job_id = ?').run('job-integrity')
  corrupt.catDb.db.prepare('UPDATE run_changes SET run_id = ? WHERE mutation_key = ?')
    .run('run-other', 'mutation-integrity')
  corrupt.close()

  const report = scanProjectIntegrity({ projectDir, expectedProjectId: project.id })
  assert.equal(report.checks.find((check) => check.id === 'event_sequence')?.status, 'failed')
  assert.equal(report.checks.find((check) => check.id === 'job_lineage')?.status, 'failed')
  assert.equal(report.checks.find((check) => check.id === 'run_lineage')?.status, 'failed')
})
