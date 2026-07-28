/**
 * PB-091 importer end-to-end tests: mkdtemp double roots (synthetic legacy
 * tree + fresh target root) covering the three source-resolution branches,
 * the asset-id collision skip, idempotent re-import refusal, --dry-run zero
 * writes, the rollback sidecar, readOnly reopen verification (counts +
 * digest), QA waive/open/drop paths, archive artifacts, the xliff_2_0
 * export-unavailable flag, and ledger chain validation.
 *
 * All trees are synthetic; no legacy repo data is ever touched.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { CatStore } from '@linguist/cat-store'
import { runCli, EXIT } from './cli'
import { renderChatTranscript } from './chat-transcript'
import { verifyLedgerChain } from './extract'
import { deriveImportProjectId, importLegacyProject, MIGRATION_TOOL_VERSION, type ImportReport } from './import'
import { catCoreStreamId } from './layout'
import { collectProjectDigestFiles, projectDigest } from './scan'

const NOW = '2026-07-26T00:00:00.000Z'
const now = () => NOW

// ---------------------------------------------------------------------------
// fixture helpers

function writeJson(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`)
}

function writeText(path: string, text: string): void {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, text)
}

function makeSegment(index: number, id: string, status: string, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    index,
    id,
    source: `source-${id}`,
    target: status === 'new' ? '' : `target-${id}`,
    rawSource: `source-${id}`,
    rawTarget: status === 'new' ? '' : `target-${id}`,
    locked: false,
    status,
    duplicateKey: `dup-${id}`,
    placeholderCount: 0,
    unresolvedPlaceholderCount: 0,
    ...extra,
  }
}

function makeBatch(
  projectId: string,
  batchId: string,
  format: string,
  sourceFile: string,
  segments: Record<string, unknown>[],
): Record<string, unknown> {
  return {
    schemaVersion: 1,
    format,
    projectId,
    batchId,
    sourceFile,
    sourceLanguage: 'en',
    targetLanguage: 'de',
    createdAt: '2025-01-01T00:00:00Z',
    updatedAt: '2025-02-01T00:00:00Z',
    tagReport: {},
    duplicateSourceGroups: [],
    segments,
  }
}

/** Build a VALID ledger jsonl (same hash formula as the legacy runtime). */
function ledgerJsonl(events: Array<Record<string, unknown>>): string {
  const lines: string[] = []
  let previousHash: string | undefined
  events.forEach((event, i) => {
    const row: Record<string, unknown> = { schemaVersion: 1, sequence: i + 1, ...event }
    if (previousHash !== undefined) row.previousHash = previousHash
    const hash = createHash('sha256').update(JSON.stringify(row)).digest('hex')
    lines.push(JSON.stringify({ ...row, hash }))
    previousHash = hash
  })
  return `${lines.join('\n')}\n`
}

interface Fixture {
  tmp: string
  legacyRoot: string
  extRoot: string
  projectDir: string
  fileBytes: Buffer
  uploadBytes: Buffer
}

/** Synthetic legacy tree p1: five batches covering every source branch + QA/TM/TB/proposals/exports. */
function makeFixture(): Fixture {
  const tmp = mkdtempSync(join(tmpdir(), 'la-legacy-import-'))
  const legacyRoot = join(tmp, 'legacy-root')
  const extRoot = join(tmp, 'ext-root')
  mkdirSync(extRoot, { recursive: true })
  const projectDir = join(legacyRoot, 'data', 'projects', 'p1')

  const fileBytes = Buffer.from('<mxliff>external source bytes</mxliff>')
  writeFileSync(join(extRoot, 'file.mxliff'), fileBytes)
  const uploadBytes = Buffer.from('<sdlxliff>uploaded copy</sdlxliff>')

  writeJson(join(projectDir, 'project.json'), {
    schemaVersion: 1,
    projectId: 'p1',
    projectName: 'Legacy One',
    root: extRoot,
    sourceLanguage: 'en',
    targetLanguage: 'de',
    createdAt: '2025-01-01T00:00:00.000Z',
    updatedAt: '2025-06-01T00:00:00.000Z',
  })

  writeJson(join(projectDir, 'tm.json'), [
    { id: 'tm-1', source: 'Hello', target: 'Hallo', srcLang: 'en', tgtLang: 'de', origin: 'reviewed', quality: 90, note: 'client TM', sourceKind: 'client_import', sourceBatchId: 'b1', sourceSegmentId: 's1', createdAt: '2024-01-01T00:00:00Z', updatedAt: '2024-02-01T00:00:00Z' },
    { id: 'tm-2', source: 'World', target: 'Welt', srcLang: 'en', tgtLang: 'de', origin: 'mt' },
  ])

  writeJson(join(projectDir, 'termbase.json'), [
    { id: 'tb-1', source: 'Term', target: 'Begriff', srcLang: 'en', tgtLang: 'de', note: 'keep', sourceFile: 'tb.xlsx', rowNo: 1, origin: 'manual' },
    { id: 'tb-2', source: 'Old', target: 'Alt', srcLang: 'en', tgtLang: 'de', sourceFile: 'tb.xlsx', rowNo: 2, origin: 'tbx', conceptId: 9 },
    { id: 'tb-3', source: 'Conf', target: 'X', srcLang: 'en', tgtLang: 'de', sourceFile: 'tb.xlsx', rowNo: 3, origin: 'table' },
  ])
  writeJson(join(projectDir, 'termbase_overrides.json'), [
    { source: 'Force', target: 'Erzwungen', reason: 'client wish', decidedBy: 'pm', ts: '2024-03-01' },
  ])
  writeJson(join(projectDir, 'term_history.json'), {
    rows: [],
    decisions: [
      { source: 'Term', target: 'Begriff', status: 'current', reason: 'confirmed', evidenceRows: [] },
      { source: 'Old', target: 'Alt', status: 'deprecated', reason: 'superseded', evidenceRows: [] },
      { source: 'Conf', status: 'conflict', conflictTargets: ['X'], reason: 'two winners', evidenceRows: [] },
    ],
  })

  writeText(
    join(projectDir, 'quality_decision_ledger.jsonl'),
    ledgerJsonl([
      { projectId: 'p1', batchId: 'b1', segmentId: 's1', findingId: 'f1', code: 'TERM_MISMATCH', severity: 'blocker', kind: 'delivery_finding', decision: 'open' },
      { projectId: 'p1', batchId: 'b1', segmentId: 's1', findingId: 'f1', code: 'TERM_MISMATCH', severity: 'blocker', kind: 'delivery_waiver', decision: 'accepted_risk', reason: 'client approved', actor: 'user' },
      { projectId: 'p1', batchId: 'b1', segmentId: 's2', findingId: 'f2', code: 'NUMBER_MISMATCH', severity: 'warning', kind: 'team_decision', decision: 'fix_required', reason: 'must fix', actor: 'lead_linguist' },
    ]),
  )

  // latest report for b1 (r0 is older and superseded)
  writeJson(join(projectDir, 'delivery_qa', 'r0.json'), {
    reportId: 'r0',
    projectId: 'p1',
    batchId: 'b1',
    generatedAt: '2024-06-01T00:00:00Z',
    findings: [{ id: 'f-old', type: 'SPACING', severity: 'advisory', segmentId: 's1', message: 'old', evidence: [] }],
    summary: { blockers: 0, warnings: 0, advisories: 1 },
  })
  writeJson(join(projectDir, 'delivery_qa', 'r1.json'), {
    reportId: 'r1',
    projectId: 'p1',
    batchId: 'b1',
    generatedAt: '2025-06-01T00:00:00Z',
    findings: [
      { id: 'f1', type: 'TERM_MISMATCH', severity: 'blocker', segmentId: 's1', message: 'term mismatch', evidence: ['termbase'] },
      { id: 'f2', type: 'NUMBER_MISMATCH', severity: 'warning', segmentId: 's2', message: 'number mismatch', evidence: [] },
      { id: 'f3', type: 'SPACING', severity: 'advisory', message: 'no segment attached', evidence: [] },
      { id: 'f4', type: 'TAG_MISMATCH', severity: 'warning', segmentId: 'ghost', message: 'unknown segment', evidence: [] },
    ],
    summary: { blockers: 1, warnings: 2, advisories: 1 },
  })

  // b1: external source present (phrase_mxliff) + proposal set + rendered report
  writeJson(
    join(projectDir, 'batches', 'b1', 'batch.json'),
    makeBatch('p1', 'b1', 'phrase_mxliff', join(extRoot, 'file.mxliff'), [
      makeSegment(0, 's1', 'confirmed', { locked: true, contextNote: 'note1', masterId: 'm1', resname: 'r1', originalTarget: 'target-s1', updatedAt: '2025-05-01T00:00:00Z', updateReason: 'edit', updateChangeType: 'terminology', updateEvidenceSources: ['tm'] }),
      makeSegment(1, 's2', 'draft', { placeholderCount: 1, unresolvedPlaceholderCount: 1, unresolvedPlaceholders: ['{1}'] }),
      makeSegment(2, 's3', 'new'),
    ]),
  )
  writeJson(join(projectDir, 'batches', 'b1', 'proposals', 'set1.json'), {
    schemaVersion: 1,
    projectId: 'p1',
    batchId: 'b1',
    proposalSetId: 'set1',
    title: 'review pass',
    status: 'active',
    createdAt: '2025-03-01T00:00:00Z',
    updatedAt: '2025-03-01T00:00:00Z',
    proposals: [{ proposalId: 'pr-1', index: 0, segmentId: 's2', source: 'source-s2', originalTarget: 'target-s2', proposedTarget: 'better', reason: 'fluency', changeType: 'style', evidenceSources: ['tm'], status: 'proposed', createdAt: '2025-03-01T00:00:00Z', updatedAt: '2025-03-01T00:00:00Z' }],
  })
  writeText(join(projectDir, 'batches', 'b1', 'reports', 'set1.md'), '# proposal report\n')

  // b2: paste batch (csv_paste) -> lost branch directly
  writeJson(join(projectDir, 'batches', 'b2', 'batch.json'), makeBatch('p1', 'b2', 'csv_paste', 'paste://csv/2025', [makeSegment(0, 'p1s1', 'draft')]))

  // b3: external gone, TWO uploads copies -> latest wins + ambiguity note
  writeJson(join(projectDir, 'batches', 'b3', 'batch.json'), makeBatch('p1', 'b3', 'sdlxliff', join(extRoot, 'gone.sdlxliff'), [makeSegment(0, 'u1', 'confirmed')]))
  mkdirSync(join(projectDir, 'uploads'), { recursive: true })
  writeFileSync(join(projectDir, 'uploads', '1699999999999-gone.sdlxliff'), Buffer.from('older copy'))
  writeFileSync(join(projectDir, 'uploads', '1700000000000-gone.sdlxliff'), uploadBytes)

  // b4: same sourceFile as b1 -> asset id collision -> skipped
  writeJson(join(projectDir, 'batches', 'b4', 'batch.json'), makeBatch('p1', 'b4', 'mqxliff', join(extRoot, 'file.mxliff'), [makeSegment(0, 'x1', 'draft')]))

  // b5: xliff_2_0, source lost -> passthrough + export unavailable
  writeJson(join(projectDir, 'batches', 'b5', 'batch.json'), makeBatch('p1', 'b5', 'xliff_2_0', join(extRoot, 'lost.xlf'), [makeSegment(0, 'z1', 'new')]))

  // exports (artifact references), incl. a nested file
  writeText(join(projectDir, 'exports', 'delivered.tmx'), '<tmx>delivered</tmx>\n')
  writeText(join(projectDir, 'exports', 'export_audit.jsonl'), '{"auditId":"a1"}\n')
  writeText(join(projectDir, 'exports', 'nested', 'part2.txt'), 'nested export\n')

  return { tmp, legacyRoot, extRoot, projectDir, fileBytes, uploadBytes }
}

function runImport(legacyRoot: string, targetRoot: string, dryRun = false) {
  return importLegacyProject({ root: legacyRoot, projectId: 'p1', targetRoot, now, dryRun })
}

// ---------------------------------------------------------------------------
// the big end-to-end

test('import: full project migration (three source branches, collision, QA, TM/TB, archives, sidecar)', () => {
  const { legacyRoot, projectDir, fileBytes, uploadBytes } = makeFixture()
  const targetRoot = join(mkdtempSync(join(tmpdir(), 'la-import-target-')), 'linguist')

  const report = runImport(legacyRoot, targetRoot)
  const newId = deriveImportProjectId('p1')
  assert.equal(report.newProjectId, newId)
  assert.equal(report.dryRun, false)
  assert.equal(report.targetConflict, false)
  assert.deepEqual(report.project, { name: 'Legacy One', sourceLocale: 'en', targetLocale: 'de', promaWorkspaceId: 'legacy-p1' })

  // PB-092 report fields: copy is the default external-source mode; b2/b5 are
  // lost + b4 skipped + QA drops -> partial; the ext-root+uploads signal echoes.
  assert.equal(report.disposition, 'partial')
  assert.equal(report.externalSource, 'copy')
  assert.equal(report.refusal, null)
  assert.deepEqual(
    report.signals.map((s) => s.code),
    ['external-root-with-managed-uploads'],
  )
  assert.equal(report.chat.present, false)
  assert.equal(report.chat.archived, false)
  // PB-093: no chat.json -> no transcript artifact, nothing pi-session archived
  assert.equal(report.chat.transcript, null)
  assert.equal(report.chat.piSessionsArchived, 0)

  // source digest = PB-090 algorithm over the same tree
  assert.equal(report.sourceDigest, projectDigest(collectProjectDigestFiles(projectDir)))

  // assets: 4 imported, b4 skipped on collision
  assert.equal(report.totals.assets, 4)
  assert.equal(report.totals.assetsSkipped, 1)
  const byBatch = new Map(report.assets.map((a) => [a.batchId, a]))
  assert.equal(byBatch.get('b1')?.sourceResolution, 'external')
  assert.equal(byBatch.get('b1')?.formatId, 'phrase_mxliff_1_2')
  assert.equal(byBatch.get('b1')?.exportUnavailable, false)
  assert.equal(byBatch.get('b2')?.sourceResolution, 'lost') // paste: straight to lost
  assert.equal(byBatch.get('b2')?.formatId, 'csv_rfc4180')
  assert.equal(byBatch.get('b2')?.exportUnavailable, true) // lost -> no blob
  assert.equal(byBatch.get('b3')?.sourceResolution, 'uploads')
  assert.equal(byBatch.get('b3')?.sourceDetail, 'uploads/1700000000000-gone.sdlxliff')
  assert.equal(byBatch.get('b4')?.skipped, 'asset-id-collision')
  assert.equal(byBatch.get('b4')?.keptBatchId, 'b1')
  assert.equal(byBatch.get('b5')?.formatId, 'xliff_2_0')
  assert.equal(byBatch.get('b5')?.exportUnavailable, true)
  // lost branches anchor on the legacy batch.json digest (honest synthetic)
  const b2Digest = createHash('sha256').update(readFileSync(join(projectDir, 'batches', 'b2', 'batch.json'))).digest('hex')
  assert.equal(byBatch.get('b2')?.sourceSha256, b2Digest)
  // uploads ambiguity reported
  assert.ok(report.notes.some((n) => n.includes('2 uploads match "gone.sdlxliff"')), JSON.stringify(report.notes))
  assert.ok(report.notes.some((n) => n.includes('b4') && n.includes('skipped')))

  // segment totals + status mapping
  assert.equal(report.totals.segments, 6)
  assert.deepEqual(report.totals.segmentsByStatus, { draft: 2, translated: 2, untranslated: 2 })
  assert.equal(report.totals.lockedSegments, 1)

  // TM / TB / QA totals
  assert.deepEqual({ imported: report.totals.tmImported, unchanged: report.totals.tmUnchanged }, { imported: 2, unchanged: 0 })
  assert.deepEqual({ imported: report.totals.termsImported, unchanged: report.totals.termsUnchanged }, { imported: 4, unchanged: 0 })
  assert.deepEqual({ open: report.totals.qaOpen, waived: report.totals.qaWaived, dropped: report.totals.qaDropped }, { open: 1, waived: 1, dropped: 2 })

  // dropped fields are enumerated (no silent loss)
  assert.equal(report.droppedFields['tm.quality'], 1)
  assert.equal(report.droppedFields['tm.note'], 1)
  assert.equal(report.droppedFields['tm.sourceBatchId'], 1)
  assert.equal(report.droppedFields['termbase.conceptId'], 1)
  assert.equal(report.droppedFields['termbase.srcLang'], 3)
  assert.equal(report.droppedFields['segment.unresolvedPlaceholderCount'], 7) // every fixture segment carries it (incl. skipped b4)
  assert.equal(report.droppedFields['segment.unresolvedPlaceholders'], 1)
  assert.equal(report.droppedFields['batch.skipped-asset-id-collision'], 1)
  assert.equal(report.droppedFields['qa.finding-no-segment-id'], 1)
  assert.equal(report.droppedFields['qa.finding-unknown-segment'], 1)
  assert.equal(report.droppedFields['qa.report-superseded-by-newer'], 1)
  assert.equal(report.coercions['format.xliff_2_0:passthrough-export-unavailable'], 1)
  assert.equal(report.coercions['termbase.history-conflict->allowed'], 1)

  // archives: 1 proposal + 1 ledger + 3 exports, all written
  assert.equal(report.totals.proposalsArchived, 1)
  assert.equal(report.totals.exportsArchived, 3)
  assert.ok(report.archives.every((a) => a.written))
  const projectDirNew = join(targetRoot, 'projects', newId)
  assert.equal(readFileSync(join(projectDirNew, 'legacy-archive', 'proposals', 'b1', 'set1.json'), 'utf8'), readFileSync(join(projectDir, 'batches', 'b1', 'proposals', 'set1.json'), 'utf8'))
  assert.equal(readFileSync(join(projectDirNew, 'legacy-archive', 'quality_decision_ledger.jsonl'), 'utf8'), readFileSync(join(projectDir, 'quality_decision_ledger.jsonl'), 'utf8'))
  assert.equal(readFileSync(join(projectDirNew, 'exports', 'delivered.tmx'), 'utf8'), '<tmx>delivered</tmx>\n')
  assert.equal(readFileSync(join(projectDirNew, 'exports', 'nested', 'part2.txt'), 'utf8'), 'nested export\n')

  // sidecar (rollback anchor)
  const sidecar = JSON.parse(readFileSync(join(projectDirNew, 'legacy-import.json'), 'utf8')) as Record<string, unknown>
  assert.deepEqual(sidecar, {
    legacyProjectId: 'p1',
    legacyRoot: resolve(legacyRoot),
    legacyManifestUpdatedAt: '2025-06-01T00:00:00.000Z',
    sourceDigest: report.sourceDigest,
    importedAt: NOW,
    scannerVersion: MIGRATION_TOOL_VERSION,
    dryRun: false,
  })
  assert.equal(report.sidecar.written, true)
  assert.equal(report.rollback.length, 2)
  assert.ok(report.rollback.every((step) => step.includes(newId)))

  // ledger: valid chain, 2 reviews applied
  assert.deepEqual(report.ledger, { present: true, valid: true, events: 3, reviewsApplied: 2, error: null })

  // --- readOnly reopen: counts + content + digest match the report ----------
  const store = new CatStore({ rootDir: targetRoot, now })
  const project = store.getProject(newId)
  assert.equal(project.name, 'Legacy One')
  assert.equal(project.createdAt, NOW)
  const db = store.openProject(newId, { readOnly: true })
  try {
    assert.equal(db.assets.countByProject(), 4)
    const segments = db.segments.query({ limit: 100 })
    assert.equal(segments.length, 6)
    assert.ok(segments.every((s) => s.revision === 0))
    const s1 = segments.find((s) => s.key === 's1')
    assert.equal(s1?.status, 'translated')
    assert.equal(s1?.locked, true)
    assert.equal(s1?.context?.origin, 'm1')
    assert.equal(s1?.context?.note, 'note1')
    assert.equal(s1?.context?.meta?.originalTarget, 'target-s1')
    assert.equal(s1?.context?.meta?.updateEvidenceSources, '["tm"]')
    assert.equal(db.tmUnits.count(), 2)
    assert.equal(db.termEntries.count(), 4)
    const statuses = new Map(db.termEntries.list({ limit: 100 }).map((t) => [t.term, t.status]))
    assert.equal(statuses.get('Term'), 'preferred') // term_history current
    assert.equal(statuses.get('Old'), 'deprecated') // term_history deprecated
    assert.equal(statuses.get('Conf'), 'allowed') // conflict stays allowed
    assert.equal(statuses.get('Force'), 'preferred') // override synthesis
    assert.equal(db.termEntries.list({ limit: 100 }).find((t) => t.term === 'Force')?.note, 'client wish | Decided by: pm | 2024-03-01')
    assert.equal(db.qaFindings.count({ status: 'waived' }), 1)
    assert.equal(db.qaFindings.count({ status: 'open' }), 1)
    const waived = db.qaFindings.list({ status: 'waived' })
    assert.equal(waived[0]?.waiverReason, 'client approved')
    assert.equal(waived[0]?.severity, 'L1')
    // external + uploads sources are readable blobs; lost assets have none
    const b1Asset = db.assets.listByProject().find((a) => a.originalFilename === 'file.mxliff')!
    assert.deepEqual([...db.readAssetSource(b1Asset.id)], [...fileBytes])
    const b3Asset = db.assets.listByProject().find((a) => a.originalFilename === 'gone.sdlxliff')!
    assert.deepEqual([...db.readAssetSource(b3Asset.id)], [...uploadBytes])
    const b2Asset = db.assets.listByProject().find((a) => a.originalFilename === '2025') // basename of paste://csv/2025
    assert.throws(() => db.readAssetSource(b2Asset!.id), /not found/)
  } finally {
    db.close()
  }
})

// ---------------------------------------------------------------------------
// dry-run / idempotency / CLI

test('import: dry-run writes nothing but computes the identical plan', () => {
  const { legacyRoot } = makeFixture()
  const targetRoot = join(mkdtempSync(join(tmpdir(), 'la-import-target-')), 'linguist')

  const report = runImport(legacyRoot, targetRoot, true)
  assert.equal(report.dryRun, true)
  assert.equal(report.newProjectId, deriveImportProjectId('p1'))
  assert.equal(report.totals.assets, 4)
  assert.equal(report.totals.segments, 6)
  assert.equal(report.sidecar.written, false)
  assert.ok(report.archives.every((a) => !a.written))
  // zero writes: no projects.json, no projects dir
  assert.equal(existsSync(join(targetRoot, 'projects.json')), false)
  assert.equal(existsSync(join(targetRoot, 'projects')), false)
})

test('import: repeated import is refused (idempotent, target conflict)', () => {
  const { legacyRoot } = makeFixture()
  const targetRoot = join(mkdtempSync(join(tmpdir(), 'la-import-target-')), 'linguist')

  const first = runImport(legacyRoot, targetRoot)
  assert.equal(first.targetConflict, false)
  const second = runImport(legacyRoot, targetRoot)
  assert.equal(second.targetConflict, true)
  assert.ok(second.notes.some((n) => n.includes('already exists')))
  assert.equal(second.sidecar.written, false)
  // the first project is untouched: still exactly one project in the index
  const store = new CatStore({ rootDir: targetRoot, now })
  assert.equal(store.listProjects().length, 1)
})

test('import CLI: dry-run, real run, conflict exit code, usage errors', () => {
  const { legacyRoot } = makeFixture()
  const targetRoot = join(mkdtempSync(join(tmpdir(), 'la-import-target-')), 'linguist')
  const lines: string[] = []
  const errs: string[] = []
  const io = { out: (l: string) => lines.push(l), err: (l: string) => errs.push(l) }

  // missing --target-root -> usage
  assert.equal(runCli(['import', '--root', legacyRoot, '--project', 'p1'], io), EXIT.USAGE)
  // unknown flag -> usage
  assert.equal(runCli(['import', '--root', legacyRoot, '--project', 'p1', '--target-root', targetRoot, '--bogus'], io), EXIT.USAGE)
  // dry-run -> ok, zero writes
  assert.equal(runCli(['import', '--root', legacyRoot, '--project', 'p1', '--target-root', targetRoot, '--now', NOW, '--dry-run'], io), EXIT.OK)
  assert.equal(existsSync(join(targetRoot, 'projects.json')), false)
  assert.ok(lines.some((l) => l === 'tool: linguist-legacy-import'))
  assert.ok(lines.some((l) => l === 'dry-run: true'))
  assert.ok(lines.some((l) => l.startsWith('dropped-fields: ')))
  assert.ok(lines.some((l) => l.startsWith('rollback: ')))
  // real run -> ok
  assert.equal(runCli(['import', '--root', legacyRoot, '--project', 'p1', '--target-root', targetRoot, '--now', NOW], io), EXIT.OK)
  // repeat -> conflict (4)
  assert.equal(runCli(['import', '--root', legacyRoot, '--project', 'p1', '--target-root', targetRoot, '--now', NOW], io), EXIT.CONFLICT)
  // unknown project -> not found (3)
  assert.equal(runCli(['import', '--root', legacyRoot, '--project', 'nope', '--target-root', targetRoot], io), EXIT.NOT_FOUND)
  assert.ok(errs.some((l) => l.includes('IMPORT_PROJECT_NOT_FOUND')))
})

test('import: --workspace-id/--name/--seed overrides', () => {
  const { legacyRoot } = makeFixture()
  const targetRoot = join(mkdtempSync(join(tmpdir(), 'la-import-target-')), 'linguist')
  const report = importLegacyProject({
    root: legacyRoot,
    projectId: 'p1',
    targetRoot,
    name: 'Renamed',
    workspaceId: 'ws-9',
    seed: 'custom-seed',
    now,
  })
  assert.equal(report.project.name, 'Renamed')
  assert.equal(report.project.promaWorkspaceId, 'ws-9')
  assert.equal(report.newProjectId, deriveImportProjectId('p1', 'custom-seed'))
  assert.notEqual(report.newProjectId, deriveImportProjectId('p1'))
})

// ---------------------------------------------------------------------------
// ledger chain validation unit checks

test('ledger chain: valid, tampered hash, broken sequence, stray previousHash', () => {
  const good = verifyLedgerChain(ledgerJsonl([{ projectId: 'p1', kind: 'delivery_finding', decision: 'open' }]))
  assert.equal(good.valid, true)
  assert.equal(good.events.length, 1)

  const tampered = `${JSON.stringify({ schemaVersion: 1, sequence: 1, projectId: 'p1', kind: 'delivery_finding', decision: 'open', hash: '0'.repeat(64) })}\n`
  assert.equal(verifyLedgerChain(tampered).valid, false)

  const badSeq = `${JSON.stringify({ schemaVersion: 1, sequence: 2, projectId: 'p1', kind: 'x', decision: 'open', hash: 'abc' })}\n`
  assert.equal(verifyLedgerChain(badSeq).valid, false)

  const strayPrev = `${JSON.stringify({ schemaVersion: 1, sequence: 1, projectId: 'p1', kind: 'x', decision: 'open', previousHash: 'abc', hash: 'def' })}\n`
  assert.equal(verifyLedgerChain(strayPrev).valid, false)
})

test('import: invalid ledger -> findings import as open, reviews ignored, file still archived', () => {
  const { legacyRoot, projectDir } = makeFixture()
  // corrupt the chain
  writeText(join(projectDir, 'quality_decision_ledger.jsonl'), `${JSON.stringify({ schemaVersion: 1, sequence: 1, kind: 'delivery_waiver', decision: 'accepted_risk', findingId: 'f1', reason: 'x', hash: 'bad' })}\n`)
  const targetRoot = join(mkdtempSync(join(tmpdir(), 'la-import-target-')), 'linguist')
  const report = runImport(legacyRoot, targetRoot)
  assert.equal(report.ledger.valid, false)
  assert.equal(report.ledger.reviewsApplied, 0)
  assert.equal(report.totals.qaWaived, 0)
  assert.equal(report.totals.qaOpen, 2) // f1 + f2 both open now
  assert.ok(report.notes.some((n) => n.includes('chain invalid') || n.includes('failed chain validation')))
  assert.ok(report.archives.some((a) => a.kind === 'ledger' && a.written))
})

// ---------------------------------------------------------------------------
// PB-092 disposition layer: the six release-blocker situations

/** Minimal v1 project builder (one project dir, no sqlite layer). */
function makeV1Project(projectId: string, manifest: Record<string, unknown> | null): { legacyRoot: string; projectDir: string } {
  const legacyRoot = mkdtempSync(join(tmpdir(), 'la-legacy-pb092-'))
  const projectDir = join(legacyRoot, 'data', 'projects', projectId)
  mkdirSync(projectDir, { recursive: true })
  if (manifest !== null) writeJson(join(projectDir, 'project.json'), manifest)
  return { legacyRoot, projectDir }
}

function baseManifest(projectId: string, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schemaVersion: 1,
    projectId,
    projectName: `Project ${projectId}`,
    sourceLanguage: 'en',
    targetLanguage: 'de',
    createdAt: '2025-01-01T00:00:00.000Z',
    updatedAt: '2025-06-01T00:00:00.000Z',
    ...extra,
  }
}

test('pb092: invalid "full" permissionMode never blocks the import; the signal echoes into the report', () => {
  const { legacyRoot, projectDir } = makeV1Project('ip', baseManifest('ip'))
  writeJson(join(projectDir, 'agent_settings.json'), { modelProvider: 'pi', permissionMode: 'full', thinkingLevel: 'high' })
  writeJson(join(projectDir, 'tm.json'), [{ id: 'tm-1', source: 'a', target: 'b' }])
  const targetRoot = join(mkdtempSync(join(tmpdir(), 'la-import-target-')), 'linguist')

  const report = importLegacyProject({ root: legacyRoot, projectId: 'ip', targetRoot, now })
  assert.equal(report.disposition, 'imported') // zero assets/archives, TM imported, no degradation
  assert.equal(report.totals.tmImported, 1)
  const signal = report.signals.find((s) => s.code === 'invalid-permission-mode')
  assert.ok(signal, JSON.stringify(report.signals))
  assert.equal(signal.severity, 'warning')
  assert.deepEqual(signal.evidence, { permissionMode: 'full' })
  // the project really landed
  const store = new CatStore({ rootDir: targetRoot, now })
  assert.equal(store.listProjects().length, 1)
})

test('pb092: manifest root deleted -> uploads/blob-store miss -> lost source -> partial (+root-missing signal)', () => {
  const goneRoot = join(tmpdir(), 'la-pb092-gone-root')
  const { legacyRoot, projectDir } = makeV1Project('pm', baseManifest('pm', { root: goneRoot }))
  writeJson(join(projectDir, 'batches', 'b1', 'batch.json'), makeBatch('pm', 'b1', 'phrase_mxliff', join(goneRoot, 'f.mxliff'), [makeSegment(0, 's1', 'confirmed')]))
  const targetRoot = join(mkdtempSync(join(tmpdir(), 'la-import-target-')), 'linguist')

  const report = importLegacyProject({ root: legacyRoot, projectId: 'pm', targetRoot, now })
  assert.equal(report.disposition, 'partial')
  assert.equal(report.assets[0]?.sourceResolution, 'lost')
  assert.equal(report.assets[0]?.exportUnavailable, true)
  assert.deepEqual(
    report.signals.map((s) => s.code),
    ['root-missing'], // no uploads and no blobs -> no internal-copy-only
  )
  // honest synthetic anchor: source_sha256 = legacy batch.json digest
  const batchDigest = createHash('sha256').update(readFileSync(join(projectDir, 'batches', 'b1', 'batch.json'))).digest('hex')
  assert.equal(report.assets[0]?.sourceSha256, batchDigest)
})

test('pb092: --external-source=reference never reads external bytes; uploads copy wins and the path is reported', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'la-pb092-ref-'))
  const extRoot = join(tmp, 'ext')
  mkdirSync(extRoot, { recursive: true })
  const externalBytes = Buffer.from('EXTERNAL-BYTES-MUST-NOT-BE-READ')
  writeFileSync(join(extRoot, 'f.mxliff'), externalBytes)
  const legacyRoot = join(tmp, 'legacy')
  const projectDir = join(legacyRoot, 'data', 'projects', 'ref')
  writeJson(join(projectDir, 'project.json'), baseManifest('ref', { root: extRoot }))
  writeJson(join(projectDir, 'batches', 'b1', 'batch.json'), makeBatch('ref', 'b1', 'phrase_mxliff', join(extRoot, 'f.mxliff'), [makeSegment(0, 's1', 'confirmed')]))
  const uploadBytes = Buffer.from('managed uploads copy')
  mkdirSync(join(projectDir, 'uploads'), { recursive: true })
  writeFileSync(join(projectDir, 'uploads', '1700000000000-f.mxliff'), uploadBytes)
  const targetRoot = join(mkdtempSync(join(tmpdir(), 'la-import-target-')), 'linguist')

  const report = importLegacyProject({ root: legacyRoot, projectId: 'ref', targetRoot, now, externalSource: 'reference' })
  assert.equal(report.externalSource, 'reference')
  assert.equal(report.disposition, 'imported') // bytes recovered from uploads: no loss
  const asset = report.assets[0]!
  assert.equal(asset.sourceResolution, 'uploads')
  assert.ok(asset.sourceDetail?.includes('uploads/1700000000000-f.mxliff'))
  assert.ok(asset.sourceDetail?.includes(join(extRoot, 'f.mxliff')), 'report records the referenced external path')
  // external bytes were NOT read: the stored blob is the uploads copy
  assert.notEqual(asset.sourceSha256, createHash('sha256').update(externalBytes).digest('hex'))
  const store = new CatStore({ rootDir: targetRoot, now })
  const db = store.openProject(report.newProjectId, { readOnly: true })
  try {
    const stored = db.assets.listByProject()[0]!
    assert.deepEqual([...db.readAssetSource(stored.id)], [...uploadBytes])
  } finally {
    db.close()
  }
  // sidecar records the external root (user-private path, user-visible only)
  const sidecar = JSON.parse(readFileSync(join(targetRoot, 'projects', report.newProjectId, 'legacy-import.json'), 'utf8')) as Record<string, unknown>
  assert.equal(sidecar.externalSourceRoot, extRoot)
})

test('pb092: --external-source=reference without managed copies -> lost + synthetic digest (external untouched)', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'la-pb092-reflost-'))
  const extRoot = join(tmp, 'ext')
  mkdirSync(extRoot, { recursive: true })
  const externalBytes = Buffer.from('EXTERNAL-BYTES-MUST-NOT-BE-READ')
  writeFileSync(join(extRoot, 'f.mxliff'), externalBytes)
  const legacyRoot = join(tmp, 'legacy')
  const projectDir = join(legacyRoot, 'data', 'projects', 'rl')
  writeJson(join(projectDir, 'project.json'), baseManifest('rl', { root: extRoot }))
  writeJson(join(projectDir, 'batches', 'b1', 'batch.json'), makeBatch('rl', 'b1', 'phrase_mxliff', join(extRoot, 'f.mxliff'), [makeSegment(0, 's1', 'confirmed')]))
  const targetRoot = join(mkdtempSync(join(tmpdir(), 'la-import-target-')), 'linguist')

  const report = importLegacyProject({ root: legacyRoot, projectId: 'rl', targetRoot, now, externalSource: 'reference' })
  assert.equal(report.disposition, 'partial')
  const asset = report.assets[0]!
  assert.equal(asset.sourceResolution, 'lost')
  assert.equal(asset.exportUnavailable, true)
  // synthetic anchor on the legacy batch.json digest — never the external bytes
  const batchDigest = createHash('sha256').update(readFileSync(join(projectDir, 'batches', 'b1', 'batch.json'))).digest('hex')
  assert.equal(asset.sourceSha256, batchDigest)
  assert.notEqual(asset.sourceSha256, createHash('sha256').update(externalBytes).digest('hex'))
  const sidecar = JSON.parse(readFileSync(join(targetRoot, 'projects', report.newProjectId, 'legacy-import.json'), 'utf8')) as Record<string, unknown>
  assert.equal(sidecar.externalSourceRoot, extRoot)
})

test('pb092: internal copy only (v1, root gone, uploads present) -> uploads resolution + signal', () => {
  const goneRoot = join(tmpdir(), 'la-pb092-gone-root-ic')
  const { legacyRoot, projectDir } = makeV1Project('ic', baseManifest('ic', { root: goneRoot }))
  writeJson(join(projectDir, 'batches', 'b1', 'batch.json'), makeBatch('ic', 'b1', 'sdlxliff', join(goneRoot, 'doc.sdlxliff'), [makeSegment(0, 's1', 'confirmed')]))
  const uploadBytes = Buffer.from('the only surviving copy')
  mkdirSync(join(projectDir, 'uploads'), { recursive: true })
  writeFileSync(join(projectDir, 'uploads', '1699999999999-doc.sdlxliff'), uploadBytes)
  const targetRoot = join(mkdtempSync(join(tmpdir(), 'la-import-target-')), 'linguist')

  const report = importLegacyProject({ root: legacyRoot, projectId: 'ic', targetRoot, now })
  assert.equal(report.disposition, 'imported') // managed copy recovered: no loss
  assert.equal(report.assets[0]?.sourceResolution, 'uploads')
  assert.deepEqual(
    report.signals.map((s) => s.code),
    ['root-missing', 'internal-copy-only'],
  )
  const store = new CatStore({ rootDir: targetRoot, now })
  const db = store.openProject(report.newProjectId, { readOnly: true })
  try {
    assert.deepEqual([...db.readAssetSource(db.assets.listByProject()[0]!.id)], [...uploadBytes])
  } finally {
    db.close()
  }
})

// --- v2 helpers: real SQLite fixture (node:sqlite, same pattern as scan.nodetest)

interface SqliteFixtureDb {
  close(): void
}

function createCatCoreFixture(dbPath: string, projections: Array<{ streamId: string; value: unknown }>): SqliteFixtureDb {
  mkdirSync(dirname(dbPath), { recursive: true })
  const require = createRequire(import.meta.url)
  const { DatabaseSync } = require('node:sqlite') as {
    DatabaseSync: new (path: string) => {
      exec(sql: string): void
      prepare(sql: string): { run(...params: unknown[]): unknown }
      close(): void
    }
  }
  const db = new DatabaseSync(dbPath)
  db.exec(`
    CREATE TABLE streams (stream_id TEXT PRIMARY KEY, revision INTEGER NOT NULL);
    CREATE TABLE projections (stream_id TEXT PRIMARY KEY, revision INTEGER NOT NULL, projection_json TEXT NOT NULL);
  `)
  for (const p of projections) {
    db.prepare('INSERT INTO streams(stream_id, revision) VALUES (?, 0)').run(p.streamId)
    db.prepare('INSERT INTO projections(stream_id, revision, projection_json) VALUES (?, 0, ?)').run(
      p.streamId,
      JSON.stringify({ value: p.value }),
    )
  }
  return db
}

interface V2Fixture {
  legacyRoot: string
  projectDir: string
  blobBytes: Buffer
  blobSha256: string
  sourceFile: string
}

/** v2 tree: authority + sqlite projections (manifest/batch/source refs) + one CAS blob; batch has NO legacy batch.json. */
function makeV2BlobFixture(options: { tamperBlob?: boolean; projectDir?: boolean } = {}): V2Fixture {
  const legacyRoot = mkdtempSync(join(tmpdir(), 'la-legacy-v2-'))
  const projectId = 'v2p'
  const goneRoot = join(tmpdir(), 'la-pb092-gone-root-v2')
  const sourceFile = join(goneRoot, 'managed.mxliff')
  writeJson(join(legacyRoot, 'data', '.schema.json'), { schemaVersion: 2, migratedAt: '2025-08-01T00:00:00.000Z', backupId: 'schema-1-to-2-x' })
  writeJson(join(legacyRoot, 'data', 'runtime', 'cat-core-sqlite-v1', 'authority-v1.json'), { version: 1 })

  const blobBytes = options.tamperBlob === true ? Buffer.from('TAMPERED blob bytes') : Buffer.from('<mxliff>managed CAS copy</mxliff>')
  const blobSha256 = createHash('sha256').update(Buffer.from('<mxliff>managed CAS copy</mxliff>')).digest('hex')
  const blobPath = join(legacyRoot, 'data', 'runtime', 'cat-core-sqlite-v1', 'blob-store', 'blobs', 'sha256', blobSha256.slice(0, 2), blobSha256)
  mkdirSync(dirname(blobPath), { recursive: true })
  writeFileSync(blobPath, blobBytes)

  const manifest = baseManifest(projectId, { root: goneRoot })
  const batch = makeBatch(projectId, 'b1', 'phrase_mxliff', sourceFile, [makeSegment(0, 's1', 'confirmed')])
  const sourceRef = {
    id: 'batch-deadbeef',
    projectId,
    ownerKind: 'batch',
    ownerId: 'b1',
    path: sourceFile,
    sha256: blobSha256,
    bytes: Buffer.from('<mxliff>managed CAS copy</mxliff>').length,
    blobRefId: blobSha256,
  }
  const db = createCatCoreFixture(join(legacyRoot, 'data', 'runtime', 'cat-core-sqlite-v1', 'cat-core.sqlite'), [
    { streamId: catCoreStreamId('manifest', projectId), value: manifest },
    { streamId: catCoreStreamId('batch', projectId, 'b1'), value: batch },
    { streamId: catCoreStreamId('source', projectId, 'batch:b1'), value: [sourceRef] },
  ])
  db.close()

  const projectDir = join(legacyRoot, 'data', 'projects', projectId)
  if (options.projectDir !== false) mkdirSync(projectDir, { recursive: true })
  return { legacyRoot, projectDir, blobBytes, blobSha256, sourceFile }
}

test('pb092: v2 managed copy in the CAS blob-store is recovered via source_refs (not misjudged as lost)', () => {
  const { legacyRoot, blobSha256 } = makeV2BlobFixture()
  const targetRoot = join(mkdtempSync(join(tmpdir(), 'la-import-target-')), 'linguist')

  const report = importLegacyProject({ root: legacyRoot, projectId: 'v2p', targetRoot, now })
  assert.equal(report.disposition, 'imported')
  assert.equal(report.domains.manifest, 'sqlite')
  assert.equal(report.domains.batches.b1, 'sqlite')
  const asset = report.assets[0]!
  assert.equal(asset.sourceResolution, 'blob-store')
  assert.equal(asset.sourceSha256, blobSha256)
  assert.equal(asset.exportUnavailable, false)
  // the real bytes landed as the new asset blob
  const store = new CatStore({ rootDir: targetRoot, now })
  const db = store.openProject(report.newProjectId, { readOnly: true })
  try {
    assert.deepEqual([...db.readAssetSource(db.assets.listByProject()[0]!.id)], [...Buffer.from('<mxliff>managed CAS copy</mxliff>')])
  } finally {
    db.close()
  }
})

test('pb092: tampered CAS blob fails the integrity check -> lost + note (never trusted)', () => {
  const { legacyRoot, sourceFile } = makeV2BlobFixture({ tamperBlob: true })
  const targetRoot = join(mkdtempSync(join(tmpdir(), 'la-import-target-')), 'linguist')

  const report = importLegacyProject({ root: legacyRoot, projectId: 'v2p', targetRoot, now })
  assert.equal(report.disposition, 'partial')
  const asset = report.assets[0]!
  assert.equal(asset.sourceResolution, 'lost')
  assert.equal(asset.exportUnavailable, true)
  assert.ok(report.notes.some((n) => n.includes('failed integrity check')), JSON.stringify(report.notes))
  // synthetic anchor: no legacy batch.json -> deterministic digest of the projection payload
  assert.ok(asset.sourceSha256 !== null && /^[0-9a-f]{64}$/.test(asset.sourceSha256))
  assert.ok(asset.sourceDetail?.includes(sourceFile))
  // no blob was stored for the asset
  const store = new CatStore({ rootDir: targetRoot, now })
  const db = store.openProject(report.newProjectId, { readOnly: true })
  try {
    assert.throws(() => db.readAssetSource(db.assets.listByProject()[0]!.id), /not found/)
  } finally {
    db.close()
  }
})

test('pb092: orphan project (unparseable manifest) is quarantined by default — zero writes, full report, exit 5', () => {
  const { legacyRoot, projectDir } = makeV1Project('orphan', null)
  writeText(join(projectDir, 'project.json'), '{ not json')
  writeJson(join(projectDir, 'batches', 'b1', 'batch.json'), makeBatch('orphan', 'b1', 'phrase_mxliff', 'gone.mxliff', [makeSegment(0, 's1', 'confirmed')]))
  const targetRoot = join(mkdtempSync(join(tmpdir(), 'la-import-target-')), 'linguist')

  const report = importLegacyProject({ root: legacyRoot, projectId: 'orphan', targetRoot, now })
  assert.equal(report.disposition, 'quarantined')
  assert.equal(report.refusal?.reason, 'orphan-project')
  assert.ok(report.signals.some((s) => s.code === 'orphan-project'))
  // zero writes: no projects.json, no projects dir
  assert.equal(existsSync(join(targetRoot, 'projects.json')), false)
  assert.equal(existsSync(join(targetRoot, 'projects')), false)
  // the report is still complete
  assert.equal(report.tool, 'linguist-legacy-import')
  assert.equal(report.legacyProjectId, 'orphan')
  assert.equal(report.newProjectId, deriveImportProjectId('orphan'))
  assert.equal(report.domains.batches.b1, 'legacy-json')
  assert.deepEqual(report.assets, [])
  assert.equal(report.totals.assets, 0)
  assert.equal(report.sidecar.written, false)
  assert.ok(report.notes.some((n) => n.includes('quarantined')))

  // CLI: exit 5 and --json stdout is the complete report
  const lines: string[] = []
  const io = { out: (l: string) => lines.push(l), err: () => {} }
  assert.equal(runCli(['import', '--root', legacyRoot, '--project', 'orphan', '--target-root', targetRoot, '--now', NOW, '--json'], io), EXIT.DATA)
  const parsed = JSON.parse(lines.join('\n')) as ImportReport
  assert.equal(parsed.disposition, 'quarantined')
  assert.equal(parsed.refusal?.reason, 'orphan-project')
  assert.equal(parsed.newProjectId, deriveImportProjectId('orphan'))
  assert.ok(Array.isArray(parsed.signals) && Array.isArray(parsed.archives) && Array.isArray(parsed.notes))
  assert.equal(existsSync(join(targetRoot, 'projects')), false)
})

test('pb092: --salvage-orphan imports an orphan project (batch-payload languages, directory name, salvage note)', () => {
  const { legacyRoot, projectDir } = makeV1Project('orphan', null)
  writeText(join(projectDir, 'project.json'), '{ not json')
  writeJson(join(projectDir, 'batches', 'b1', 'batch.json'), makeBatch('orphan', 'b1', 'phrase_mxliff', 'gone.mxliff', [makeSegment(0, 's1', 'confirmed')]))
  writeJson(join(projectDir, 'tm.json'), [{ id: 'tm-1', source: 'a', target: 'b' }])
  const targetRoot = join(mkdtempSync(join(tmpdir(), 'la-import-target-')), 'linguist')

  const report = importLegacyProject({ root: legacyRoot, projectId: 'orphan', targetRoot, now, salvageOrphan: true })
  assert.equal(report.project.name, 'orphan') // directory name
  assert.equal(report.project.sourceLocale, 'en') // batch payload
  assert.equal(report.project.targetLocale, 'de')
  assert.ok(report.notes.some((n) => n.includes('salvaged')), JSON.stringify(report.notes))
  assert.notEqual(report.disposition, 'quarantined')
  assert.equal(report.refusal, null)
  assert.equal(report.totals.assets, 1)
  assert.equal(report.totals.tmImported, 1)
  const store = new CatStore({ rootDir: targetRoot, now })
  assert.equal(store.getProject(report.newProjectId).name, 'orphan')
})

test('pb092: --salvage-orphan without any language pair stays quarantined (nothing fabricated)', () => {
  const { legacyRoot, projectDir } = makeV1Project('orphan2', null)
  // no manifest at all + a batch payload without languages
  const batch = makeBatch('orphan2', 'b1', 'phrase_mxliff', 'gone.mxliff', [makeSegment(0, 's1', 'confirmed')])
  delete batch.sourceLanguage
  delete batch.targetLanguage
  writeJson(join(projectDir, 'batches', 'b1', 'batch.json'), batch)
  const targetRoot = join(mkdtempSync(join(tmpdir(), 'la-import-target-')), 'linguist')

  const report = importLegacyProject({ root: legacyRoot, projectId: 'orphan2', targetRoot, now, salvageOrphan: true })
  assert.equal(report.disposition, 'quarantined')
  assert.equal(report.refusal?.reason, 'orphan-project-no-locales')
  assert.equal(existsSync(join(targetRoot, 'projects')), false)
})

test('pb092: orphan-sqlite project (projection without directory) is always quarantined with layer evidence', () => {
  const { legacyRoot } = makeV2BlobFixture({ projectDir: false })
  const targetRoot = join(mkdtempSync(join(tmpdir(), 'la-import-target-')), 'linguist')

  const report = importLegacyProject({ root: legacyRoot, projectId: 'v2p', targetRoot, now, salvageOrphan: true })
  assert.equal(report.disposition, 'quarantined')
  assert.equal(report.refusal?.reason, 'orphan-sqlite-project')
  assert.deepEqual(report.refusal?.evidence, { readCacheHasProjections: false, blobStoreBlobs: 1 })
  assert.ok(report.signals.some((s) => s.code === 'orphan-sqlite-project'))
  assert.equal(report.domains.manifest, 'sqlite')
  assert.equal(existsSync(join(targetRoot, 'projects')), false)

  // a genuinely unknown id (no directory, no projection) still exits 3
  const lines: string[] = []
  const errs: string[] = []
  const io = { out: (l: string) => lines.push(l), err: (l: string) => errs.push(l) }
  assert.equal(runCli(['import', '--root', legacyRoot, '--project', 'nope', '--target-root', targetRoot], io), EXIT.NOT_FOUND)
  assert.ok(errs.some((l) => l.includes('IMPORT_PROJECT_NOT_FOUND')))
})

test('pb092: chat-only project imports metadata-only as archived-only (bytes archived verbatim)', () => {
  const { legacyRoot, projectDir } = makeV1Project('chatp', baseManifest('chatp'))
  const chatRows = [
    { ts: '2025-03-01T10:00:00.000Z', kind: 'user', text: 'hello', sessionId: 'sess-1' },
    { ts: '2025-03-01T10:00:05.000Z', kind: 'assistant', text: 'hi', sessionId: 'sess-1' },
    { ts: '2025-03-02T09:00:00.000Z', kind: 'user', text: 'no session row' },
  ]
  writeJson(join(projectDir, 'chat.json'), chatRows)
  writeText(join(projectDir, '_pi_sessions', 'sess-1.jsonl'), '{"type":"session","id":"sess-1"}\n{"type":"message","role":"user"}\n')
  writeText(join(projectDir, 'agent_events.jsonl'), '{"hidden":"thinking"}\n')
  const targetRoot = join(mkdtempSync(join(tmpdir(), 'la-import-target-')), 'linguist')

  const report = importLegacyProject({ root: legacyRoot, projectId: 'chatp', targetRoot, now })
  assert.equal(report.disposition, 'archived-only')
  assert.equal(report.totals.assets, 0)
  assert.equal(report.totals.tmImported, 0)
  assert.equal(report.totals.termsImported, 0)
  // chat carriers: chat.json archived; sessions manifest; agent_events excluded
  assert.equal(report.chat.present, true)
  assert.equal(report.chat.entries, 3)
  assert.equal(report.chat.malformedChatSessions, 1)
  assert.equal(report.chat.agentEventsPresent, true)
  assert.equal(report.chat.archived, true)
  assert.deepEqual(report.chat.sessions, [{ name: 'sess-1.jsonl', lines: 2, bytes: Buffer.byteLength('{"type":"session","id":"sess-1"}\n{"type":"message","role":"user"}\n') }])
  const chatArchive = report.archives.find((a) => a.kind === 'chat')
  assert.ok(chatArchive?.written)
  assert.equal(chatArchive.from, 'chat.json')
  const newProjectDir = join(targetRoot, 'projects', report.newProjectId)
  assert.equal(readFileSync(join(newProjectDir, 'legacy-archive', 'chat', 'chat.json'), 'utf8'), readFileSync(join(projectDir, 'chat.json'), 'utf8'))
  // PB-093: transcript rendered (1 session, 3 rows, 1 unassigned) + pi-session bytes archived
  assert.ok(report.chat.transcript !== null)
  assert.deepEqual(
    { sessions: report.chat.transcript.sessions, rows: report.chat.transcript.rows, malformedRows: report.chat.transcript.malformedRows, unassignedRows: report.chat.transcript.unassignedRows },
    { sessions: 1, rows: 3, malformedRows: 0, unassignedRows: 1 },
  )
  assert.equal(report.chat.transcript.path, join('projects', report.newProjectId, 'legacy-archive', 'chat', 'transcript.md'))
  const transcriptBytes = readFileSync(join(newProjectDir, 'legacy-archive', 'chat', 'transcript.md'))
  assert.equal(createHash('sha256').update(transcriptBytes).digest('hex'), report.chat.transcript.sha256)
  assert.equal(report.chat.piSessionsArchived, 1)
  assert.equal(
    readFileSync(join(newProjectDir, 'legacy-archive', 'chat', 'pi-sessions', 'sess-1.jsonl'), 'utf8'),
    readFileSync(join(projectDir, '_pi_sessions', 'sess-1.jsonl'), 'utf8'),
  )
  // no agent_events bytes were archived; _pi_sessions live under chat/pi-sessions/
  assert.equal(existsSync(join(newProjectDir, 'legacy-archive', 'agent_events.jsonl')), false)
  assert.equal(existsSync(join(newProjectDir, 'legacy-archive', '_pi_sessions')), false)
  // metadata-only project: sidecar marks archivedOnly, zero assets is not a runnable project
  const sidecar = JSON.parse(readFileSync(join(newProjectDir, 'legacy-import.json'), 'utf8')) as Record<string, unknown>
  assert.equal(sidecar.archivedOnly, true)
  const store = new CatStore({ rootDir: targetRoot, now })
  const db = store.openProject(report.newProjectId, { readOnly: true })
  try {
    assert.equal(db.assets.countByProject(), 0)
    assert.equal(db.tmUnits.count(), 0)
  } finally {
    db.close()
  }
})

test('pb092: readable manifest without any language pair is quarantined (missing-locales)', () => {
  const { legacyRoot } = makeV1Project('nolang', (() => {
    const m = baseManifest('nolang')
    delete m.sourceLanguage
    delete m.targetLanguage
    return m
  })())
  const targetRoot = join(mkdtempSync(join(tmpdir(), 'la-import-target-')), 'linguist')
  const report = importLegacyProject({ root: legacyRoot, projectId: 'nolang', targetRoot, now })
  assert.equal(report.disposition, 'quarantined')
  assert.equal(report.refusal?.reason, 'missing-locales')
  assert.equal(existsSync(join(targetRoot, 'projects')), false)
})

test('pb092: CLI parses --external-source / --salvage-orphan and rejects bad values', () => {
  const { legacyRoot } = makeV1Project('flags', baseManifest('flags'))
  const targetRoot = join(mkdtempSync(join(tmpdir(), 'la-import-target-')), 'linguist')
  const lines: string[] = []
  const errs: string[] = []
  const io = { out: (l: string) => lines.push(l), err: (l: string) => errs.push(l) }

  assert.equal(
    runCli(['import', '--root', legacyRoot, '--project', 'flags', '--target-root', targetRoot, '--now', NOW, '--external-source=bogus'], io),
    EXIT.USAGE,
  )
  assert.ok(errs.some((l) => l.includes('--external-source must be copy or reference')))
  assert.equal(
    runCli(['import', '--root', legacyRoot, '--project', 'flags', '--target-root', targetRoot, '--now', NOW, '--external-source=reference', '--salvage-orphan', '--dry-run'], io),
    EXIT.OK,
  )
  assert.ok(lines.some((l) => l === 'external-source: reference'))
  assert.ok(lines.some((l) => l === 'disposition: imported'))
})

// ---------------------------------------------------------------------------
// PB-093: chat history -> read-only archived transcript artifact

/** Chat-only fixture: five ChatEvent kinds + usage + unassigned + malformed + two pi-sessions. */
function makeChatFixture(projectId = 'chat93'): { legacyRoot: string; projectDir: string; piSessionBytes: Map<string, Buffer> } {
  const { legacyRoot, projectDir } = makeV1Project(projectId, baseManifest(projectId))
  writeJson(join(projectDir, 'chat.json'), [
    { ts: '2025-03-01T10:00:00.000Z', kind: 'user', text: '翻译这段：`Hello, 世界`', sessionId: 's1' },
    { ts: '2025-03-01T10:00:01.000Z', kind: 'tool', text: 'tool_start grep', sessionId: 's1', toolCallId: 'tc-9' },
    { ts: '2025-03-01T10:00:02.000Z', kind: 'assistant', text: '译文：你好，世界', sessionId: 's1', usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15, costUsd: 0.001 } },
    { ts: '2025-03-01T10:00:03.000Z', kind: 'system', text: 'Agent run stopped by user.', sessionId: 's1' },
    { ts: '2025-03-02T09:00:00.000Z', kind: 'user', text: 'unassigned row' },
    { bogus: true },
  ])
  const piSessionBytes = new Map<string, Buffer>([
    ['s0.jsonl', Buffer.from('{"type":"session","id":"s0"}\n')],
    // carries a thinking block on purpose: byte-verbatim preservation is the contract
    ['s1.jsonl', Buffer.from('{"type":"session","id":"s1"}\n{"type":"message","role":"user"}\n{"type":"message","role":"assistant","thinking":"秘密思考"}\n')],
  ])
  mkdirSync(join(projectDir, '_pi_sessions'), { recursive: true })
  for (const [name, bytes] of piSessionBytes) writeFileSync(join(projectDir, '_pi_sessions', name), bytes)
  writeText(join(projectDir, 'agent_events.jsonl'), '{"hidden":"thinking"}\n')
  return { legacyRoot, projectDir, piSessionBytes }
}

/** Byte-exact expected transcript for makeChatFixture('chat93') under the pinned clock. */
function expectedChat93Transcript(sourceDigest: string): string {
  return [
    '# 旧聊天归档转录（read-only archived transcript）',
    '',
    '> **只读归档**：本文件是旧 Linguist Agent 聊天历史的一次性静态渲染，**不可继续执行**；旧 Runtime / Tool / Prompt / Session 语义与新仓不兼容（PB-093）。',
    '> **工具行为**仅为旧 Runtime 写下的单行调用摘要（`tool_start <name>` / `tool_end <name> ok|error`），**不可重放**；工具参数与结果从不写入 chat.json，故不在本归档中。',
    `> **provenance**：legacyProjectId=\`chat93\` · sourceDigest=\`${sourceDigest}\` · archivedAt=\`${NOW}\` · generator=\`linguist-legacy-import ${MIGRATION_TOOL_VERSION}\``,
    '',
    '## 会话 `s1`',
    '',
    '### 用户 · 2025-03-01T10:00:00.000Z',
    '',
    '翻译这段：`Hello, 世界`',
    '',
    '> tool_start grep · toolCallId=tc-9',
    '',
    '### 助手 · 2025-03-01T10:00:02.000Z',
    '',
    '译文：你好，世界',
    '',
    '> usage: input=10 output=5 total=15 cost=$0.001',
    '',
    '**[system] · 2025-03-01T10:00:03.000Z** — Agent run stopped by user.',
    '',
    '## 未分配会话',
    '',
    '_无 sessionId 的行（旧仓 malformed_chat_session 口径，计入迁移报告）。_',
    '',
    '### 用户 · 2025-03-02T09:00:00.000Z',
    '',
    'unassigned row',
    '',
    '## 附录：无法归档的行',
    '',
    '以下 1 行不符合 ChatEvent 形状（非对象或缺 ts/kind/text），原文 JSON 逐行保留：',
    '',
    '~~~json',
    '{"bogus":true}',
    '~~~',
    '',
  ].join('\n')
}

test('pb093: transcript.md lands byte-exact (golden), sha256 in report; pi-sessions archived byte-verbatim', () => {
  const { legacyRoot, projectDir, piSessionBytes } = makeChatFixture()
  const targetRoot = join(mkdtempSync(join(tmpdir(), 'la-import-target-')), 'linguist')

  const report = importLegacyProject({ root: legacyRoot, projectId: 'chat93', targetRoot, now })
  // chat-only project: archived-only, the transcript is the main artifact
  assert.equal(report.disposition, 'archived-only')
  assert.equal(report.totals.assets, 0)
  const digest = projectDigest(collectProjectDigestFiles(projectDir))
  assert.equal(report.sourceDigest, digest)

  // report.chat.transcript descriptor
  const transcript = report.chat.transcript
  assert.ok(transcript !== null)
  assert.equal(transcript.path, join('projects', report.newProjectId, 'legacy-archive', 'chat', 'transcript.md'))
  assert.deepEqual(
    { sessions: transcript.sessions, rows: transcript.rows, malformedRows: transcript.malformedRows, unassignedRows: transcript.unassignedRows },
    { sessions: 1, rows: 5, malformedRows: 1, unassignedRows: 1 },
  )

  // on-disk bytes: exact golden + sha256/bytes consistency with the report
  const newProjectDir = join(targetRoot, 'projects', report.newProjectId)
  const transcriptBytes = readFileSync(join(newProjectDir, 'legacy-archive', 'chat', 'transcript.md'))
  assert.equal(transcriptBytes.toString('utf8'), expectedChat93Transcript(digest))
  assert.equal(createHash('sha256').update(transcriptBytes).digest('hex'), transcript.sha256)
  assert.equal(transcriptBytes.length, transcript.bytes)

  // archive entries: chat + chat-transcript + 2 pi-session, all written
  const byKind = new Map<string, number>()
  for (const archive of report.archives) byKind.set(archive.kind, (byKind.get(archive.kind) ?? 0) + 1)
  assert.deepEqual(byKind, new Map([['chat', 1], ['chat-transcript', 1], ['pi-session', 2]]))
  assert.ok(report.archives.every((a) => a.written))
  const transcriptArchive = report.archives.find((a) => a.kind === 'chat-transcript')!
  assert.equal(transcriptArchive.from, 'chat.json')
  assert.equal(transcriptArchive.sha256, transcript.sha256)

  // pi-sessions: byte-verbatim, sha256 in the archive entry matches the source bytes
  assert.equal(report.chat.piSessionsArchived, 2)
  for (const [name, bytes] of piSessionBytes) {
    const archived = readFileSync(join(newProjectDir, 'legacy-archive', 'chat', 'pi-sessions', name))
    assert.deepEqual([...archived], [...bytes])
    const entry = report.archives.find((a) => a.kind === 'pi-session' && a.from === `_pi_sessions/${name}`)!
    assert.equal(entry.sha256, createHash('sha256').update(bytes).digest('hex'))
    assert.equal(entry.bytes, bytes.length)
  }
  // agent_events stays excluded
  assert.equal(existsSync(join(newProjectDir, 'legacy-archive', 'agent_events.jsonl')), false)

  // report notes declare verbatim pass-through + thinking-content preservation
  assert.ok(report.notes.some((n) => n.includes('verbatim') && n.includes('no Markdown escaping')), JSON.stringify(report.notes))
  assert.ok(report.notes.some((n) => n.includes('hidden thinking content')), JSON.stringify(report.notes))

  // archived-only marker in the sidecar
  const sidecar = JSON.parse(readFileSync(join(newProjectDir, 'legacy-import.json'), 'utf8')) as Record<string, unknown>
  assert.equal(sidecar.archivedOnly, true)
})

test('pb093: dry-run plans the transcript but writes zero bytes', () => {
  const { legacyRoot } = makeChatFixture()
  const targetRoot = join(mkdtempSync(join(tmpdir(), 'la-import-target-')), 'linguist')

  const report = importLegacyProject({ root: legacyRoot, projectId: 'chat93', targetRoot, now, dryRun: true })
  assert.equal(report.dryRun, true)
  // the plan is fully populated (sha256 computable pre-write: deterministic render)
  assert.ok(report.chat.transcript !== null)
  assert.match(report.chat.transcript.sha256, /^[0-9a-f]{64}$/)
  assert.equal(report.chat.transcript.rows, 5)
  assert.equal(report.chat.piSessionsArchived, 0)
  assert.equal(report.chat.archived, false)
  assert.ok(report.archives.some((a) => a.kind === 'chat-transcript' && !a.written))
  assert.equal(report.archives.filter((a) => a.kind === 'pi-session').length, 2)
  assert.ok(report.archives.every((a) => !a.written))
  // zero writes
  assert.equal(existsSync(join(targetRoot, 'projects.json')), false)
  assert.equal(existsSync(join(targetRoot, 'projects')), false)
})

test('pb093: repeated import is refused; the first transcript stays untouched', () => {
  const { legacyRoot } = makeChatFixture()
  const targetRoot = join(mkdtempSync(join(tmpdir(), 'la-import-target-')), 'linguist')

  const first = importLegacyProject({ root: legacyRoot, projectId: 'chat93', targetRoot, now })
  assert.equal(first.targetConflict, false)
  const transcriptPath = join(targetRoot, 'projects', first.newProjectId, 'legacy-archive', 'chat', 'transcript.md')
  const before = readFileSync(transcriptPath)

  const second = importLegacyProject({ root: legacyRoot, projectId: 'chat93', targetRoot, now })
  assert.equal(second.targetConflict, true)
  // the refused plan still describes the transcript (nothing written)
  assert.ok(second.chat.transcript !== null)
  assert.equal(second.chat.piSessionsArchived, 0)
  assert.ok(second.archives.every((a) => !a.written))
  // same input + same clock -> the refused plan is byte-identical to what landed
  assert.equal(second.chat.transcript.sha256, first.chat.transcript!.sha256)
  assert.deepEqual([...readFileSync(transcriptPath)], [...before])
  const store = new CatStore({ rootDir: targetRoot, now })
  assert.equal(store.listProjects().length, 1)
})

test('pb093: empty chat.json array -> transcript null (chat.json bytes still archived)', () => {
  const { legacyRoot, projectDir } = makeV1Project('chatempty', baseManifest('chatempty'))
  writeJson(join(projectDir, 'chat.json'), [])
  const targetRoot = join(mkdtempSync(join(tmpdir(), 'la-import-target-')), 'linguist')

  const report = importLegacyProject({ root: legacyRoot, projectId: 'chatempty', targetRoot, now })
  assert.equal(report.chat.present, true)
  assert.equal(report.chat.entries, 0)
  assert.equal(report.chat.transcript, null)
  assert.ok(!report.archives.some((a) => a.kind === 'chat-transcript'))
  // chat.json bytes are still archived verbatim
  const chatArchive = report.archives.find((a) => a.kind === 'chat')
  assert.ok(chatArchive?.written)
  assert.equal(
    readFileSync(join(targetRoot, 'projects', report.newProjectId, 'legacy-archive', 'chat', 'chat.json'), 'utf8'),
    readFileSync(join(projectDir, 'chat.json'), 'utf8'),
  )
})

test('pb093: transcript is re-renderable (PB-094 hook) — manual re-render matches sha256', () => {
  const { legacyRoot } = makeChatFixture()
  const targetRoot = join(mkdtempSync(join(tmpdir(), 'la-import-target-')), 'linguist')

  const report = importLegacyProject({ root: legacyRoot, projectId: 'chat93', targetRoot, now })
  assert.ok(report.chat.transcript !== null)
  // independent re-render from the archived chat.json bytes with the same provenance
  const archivedChatJson = JSON.parse(
    readFileSync(join(targetRoot, 'projects', report.newProjectId, 'legacy-archive', 'chat', 'chat.json'), 'utf8'),
  ) as unknown
  const reRendered = renderChatTranscript({
    rows: archivedChatJson,
    provenance: {
      legacyProjectId: 'chat93',
      sourceDigest: report.sourceDigest,
      archivedAt: NOW,
      generator: `linguist-legacy-import ${MIGRATION_TOOL_VERSION}`,
    },
  })
  assert.ok(reRendered !== null)
  assert.equal(createHash('sha256').update(reRendered.markdown, 'utf8').digest('hex'), report.chat.transcript.sha256)
})
