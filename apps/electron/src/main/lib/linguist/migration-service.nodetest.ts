/**
 * Linguist legacy migration service tests (node --test — bun has no
 * node:sqlite, see @linguist/cat-store runtime.ts; *.nodetest.ts is never
 * picked up by bun test).
 *
 * Synthetic double roots (mkdtemp legacy tree + fresh linguist target root)
 * covering: scan projection shape, the full scan -> import -> verify chain
 * with ordered progress events, transcript sha256 re-render comparison
 * (pass + both tamper branches), read-only reopen counts, idempotent
 * target-conflict re-import, per-project error entries, and the degraded
 * sqlite defensive refusal. No legacy repo data is ever touched.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { CatStore } from '@linguist/cat-store'
import type { LinguistMigrationProgress } from '@proma/shared'
import {
  LinguistMigrationInputError,
  LinguistMigrationService,
  LinguistMigrationUnavailableError,
} from './migration-service'

const NOW = '2026-07-26T00:00:00.000Z'

// ---------------------------------------------------------------------------
// fixture helpers (minimal legacy tree, mirrored from @linguist/legacy-migration tests)

function writeJson(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`)
}

function writeText(path: string, text: string): void {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, text)
}

function makeSegment(index: number, id: string, status: string): Record<string, unknown> {
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

interface Fixture {
  legacyRoot: string
  targetRoot: string
  extFile: string
}

/**
 * Three-project legacy tree:
 * - 'demo'      full project (batch with live external source + TM + TB +
 *               chat.json + pi-session) -> imported, transcript rendered.
 * - 'chat-only' manifest + chat.json only -> archived-only.
 * - 'orphan'    no manifest, one batch with languages -> quarantined.
 */
function makeFixture(): Fixture {
  const tmp = mkdtempSync(join(tmpdir(), 'la-migration-service-'))
  const legacyRoot = join(tmp, 'legacy-root')
  const targetRoot = join(tmp, 'linguist-target')
  const extFile = join(tmp, 'ext-root', 'file.mxliff')
  writeText(extFile, '<mxliff>external source bytes</mxliff>')

  const demo = join(legacyRoot, 'data', 'projects', 'demo')
  writeJson(join(demo, 'project.json'), baseManifest('demo', { root: join(tmp, 'ext-root') }))
  writeJson(
    join(demo, 'batches', 'b1', 'batch.json'),
    makeBatch('demo', 'b1', 'phrase_mxliff', extFile, [
      makeSegment(0, 's1', 'confirmed'),
      makeSegment(1, 's2', 'draft'),
    ]),
  )
  writeJson(join(demo, 'tm.json'), [{ id: 'tm-1', source: 'Hello', target: 'Hallo' }])
  writeJson(join(demo, 'termbase.json'), [{ id: 'tb-1', source: 'Term', target: 'Begriff' }])
  writeJson(join(demo, 'chat.json'), [
    { ts: '2025-03-01T10:00:00.000Z', kind: 'user', text: 'hello', sessionId: 'sess-1' },
    { ts: '2025-03-01T10:00:05.000Z', kind: 'assistant', text: 'hi', sessionId: 'sess-1' },
    { ts: '2025-03-02T09:00:00.000Z', kind: 'user', text: 'no session row' },
  ])
  writeText(join(demo, '_pi_sessions', 'sess-1.jsonl'), '{"type":"session","id":"sess-1"}\n')

  const chatOnly = join(legacyRoot, 'data', 'projects', 'chat-only')
  writeJson(join(chatOnly, 'project.json'), baseManifest('chat-only'))
  writeJson(join(chatOnly, 'chat.json'), [
    { ts: '2025-04-01T08:00:00.000Z', kind: 'user', text: 'hi there', sessionId: 's' },
  ])

  const orphan = join(legacyRoot, 'data', 'projects', 'orphan')
  writeJson(
    join(orphan, 'batches', 'b1', 'batch.json'),
    makeBatch('orphan', 'b1', 'phrase_mxliff', extFile, [makeSegment(0, 's1', 'confirmed')]),
  )

  return { legacyRoot, targetRoot, extFile }
}

function makeService(targetRoot: string, available = true): LinguistMigrationService {
  return new LinguistMigrationService({ targetRoot, isAvailable: () => available, now: () => NOW })
}

// ---------------------------------------------------------------------------

test('scanRoot: wire projection shape (counts, locales, chat flag, orphan flag)', () => {
  const { legacyRoot, targetRoot } = makeFixture()
  const service = makeService(targetRoot)

  const scan = service.scanRoot(legacyRoot)
  assert.equal(scan.rootPath, legacyRoot)
  assert.equal(scan.schemaVersion, 1)
  assert.deepEqual(scan.totals, { projects: 3, batches: 2, segments: 3 })

  const demo = scan.projects.find((p) => p.projectId === 'demo')
  assert.ok(demo)
  assert.equal(demo.name, 'Project demo')
  assert.deepEqual([demo.sourceLocale, demo.targetLocale], ['en', 'de'])
  assert.equal(demo.batches, 1)
  assert.equal(demo.segments, 2)
  assert.equal(demo.tmEntries, 1)
  assert.equal(demo.termEntries, 1)
  assert.equal(demo.chatPresent, true)
  assert.equal(demo.orphan, false)

  const orphan = scan.projects.find((p) => p.projectId === 'orphan')
  assert.ok(orphan)
  assert.equal(orphan.orphan, true)
  assert.equal(orphan.sourceLocale, null)

  const chatOnly = scan.projects.find((p) => p.projectId === 'chat-only')
  assert.ok(chatOnly)
  assert.equal(chatOnly.chatPresent, true)
  assert.equal(chatOnly.batches, 0)
})

test('scanRoot: directory without data/ maps to INVALID_INPUT and keeps no session state', async () => {
  const { targetRoot } = makeFixture()
  const service = makeService(targetRoot)
  const empty = mkdtempSync(join(tmpdir(), 'la-migration-empty-'))

  assert.throws(
    () => service.scanRoot(empty),
    (err: unknown) => err instanceof LinguistMigrationInputError && err.code === 'INVALID_INPUT',
  )
  // the failed scan must not become the session scan: import still refuses
  await assert.rejects(
    () => service.importSelected({ projectIds: ['demo'] }),
    (err: unknown) => err instanceof LinguistMigrationInputError && /no legacy root scanned/.test(err.message),
  )
})

test('importSelected: full chain import -> verify with aggregated report and ordered progress', async () => {
  const { legacyRoot, targetRoot } = makeFixture()
  const service = makeService(targetRoot)
  service.scanRoot(legacyRoot)

  const events: LinguistMigrationProgress[] = []
  const report = await service.importSelected({ projectIds: ['demo', 'chat-only', 'orphan'] }, (event) =>
    events.push(event),
  )

  assert.deepEqual(report.counts, { imported: 1, partial: 0, 'archived-only': 1, quarantined: 1, error: 0 })
  assert.deepEqual(events, [
    { projectId: 'demo', phase: 'import', index: 1, total: 3 },
    { projectId: 'demo', phase: 'verify', index: 1, total: 3 },
    { projectId: 'chat-only', phase: 'import', index: 2, total: 3 },
    { projectId: 'chat-only', phase: 'verify', index: 2, total: 3 },
    { projectId: 'orphan', phase: 'import', index: 3, total: 3 },
    { projectId: 'orphan', phase: 'verify', index: 3, total: 3 },
  ])

  const demo = report.projects.find((p) => p.legacyProjectId === 'demo')
  assert.ok(demo)
  assert.equal(demo.disposition, 'imported')
  assert.equal(demo.targetConflict, false)
  assert.match(demo.newProjectId, /^prj-[0-9a-f]{16}$/)
  assert.deepEqual(demo.totals, {
    assets: 1,
    segments: 2,
    tmImported: 1,
    termsImported: 1,
    qaOpen: 0,
    qaWaived: 0,
  })
  assert.ok(demo.transcript !== null)
  assert.deepEqual(
    { sessions: demo.transcript.sessions, rows: demo.transcript.rows },
    { sessions: 1, rows: 3 },
  )
  assert.match(demo.transcript.sha256, /^[0-9a-f]{64}$/)
  assert.equal(demo.archivesWritten > 0, true)
  assert.equal(demo.rollback.length, 2)
  // verify: transcript re-render + bytes + three store-count checks, all green
  assert.equal(demo.verify.status, 'passed')
  assert.deepEqual(
    demo.verify.checks.map((c) => c.id),
    ['transcript-rerender', 'transcript-bytes', 'store-assets', 'store-references', 'store-qa'],
  )
  assert.ok(demo.verify.checks.every((c) => c.ok), JSON.stringify(demo.verify.checks))

  const chatOnly = report.projects.find((p) => p.legacyProjectId === 'chat-only')
  assert.ok(chatOnly)
  assert.equal(chatOnly.disposition, 'archived-only')
  assert.equal(chatOnly.verify.status, 'passed')

  const orphan = report.projects.find((p) => p.legacyProjectId === 'orphan')
  assert.ok(orphan)
  assert.equal(orphan.disposition, 'quarantined')
  assert.equal(orphan.refusal?.reason, 'orphan-project')
  assert.equal(orphan.verify.status, 'skipped')
  assert.deepEqual(orphan.verify.checks, [])

  // migrated projects land in the linguist root (= project list); read-only
  // reopen confirms the stored counts independently of the report
  const store = new CatStore({ rootDir: targetRoot })
  const ids = store.listProjects().map((p) => p.id as string)
  assert.ok(ids.includes(demo.newProjectId))
  assert.ok(ids.includes(chatOnly.newProjectId))
  const db = store.openProject(demo.newProjectId, { readOnly: true })
  try {
    assert.equal(db.assets.countByProject(), 1)
    assert.equal(db.segments.count(), 2)
    assert.equal(db.tmUnits.count(), 1)
    assert.equal(db.termEntries.count(), 1)
  } finally {
    db.close()
  }
})

test('verifyProject: tampered transcript.md fails transcript-bytes; tampered chat.json fails transcript-rerender', async () => {
  const { legacyRoot, targetRoot } = makeFixture()
  const service = makeService(targetRoot)
  service.scanRoot(legacyRoot)
  const report = await service.importSelected({ projectIds: ['demo'] })
  const demo = report.projects[0]
  assert.ok(demo?.transcript)
  assert.equal(demo.verify.status, 'passed')

  // tamper with the rendered artifact itself: bytes check fails while the
  // re-render (from the untouched archived chat.json) still matches
  const transcriptPath = join(targetRoot, demo.transcript.path)
  const original = readFileSync(transcriptPath)
  writeFileSync(transcriptPath, Buffer.concat([original, Buffer.from('tampered\n')]))
  let verify = service.verifyProject(demo)
  assert.equal(verify.status, 'failed')
  assert.equal(verify.checks.find((c) => c.id === 'transcript-bytes')?.ok, false)
  assert.equal(verify.checks.find((c) => c.id === 'transcript-rerender')?.ok, true)

  // restore, then tamper with the archived chat.json rows: the re-render no
  // longer matches the report while transcript.md bytes are still intact
  writeFileSync(transcriptPath, original)
  writeJson(join(targetRoot, 'projects', demo.newProjectId, 'legacy-archive', 'chat', 'chat.json'), [
    { ts: '2025-03-01T10:00:00.000Z', kind: 'user', text: 'tampered row', sessionId: 'sess-1' },
  ])
  verify = service.verifyProject(demo)
  assert.equal(verify.status, 'failed')
  assert.equal(verify.checks.find((c) => c.id === 'transcript-rerender')?.ok, false)
  assert.equal(verify.checks.find((c) => c.id === 'transcript-bytes')?.ok, true)
})

test('targetConflict: idempotent re-import is refused; verify runs store checks only', async () => {
  const { legacyRoot, targetRoot } = makeFixture()
  const service = makeService(targetRoot)
  service.scanRoot(legacyRoot)

  const first = await service.importSelected({ projectIds: ['demo'] })
  assert.equal(first.projects[0]?.targetConflict, false)

  const second = await service.importSelected({ projectIds: ['demo'] })
  const demo = second.projects[0]
  assert.ok(demo)
  assert.equal(demo.targetConflict, true)
  // the transcript plan of a conflict report was never written -> transcript
  // checks are skipped; store counts still re-verify the first import
  assert.equal(demo.verify.status, 'passed')
  assert.deepEqual(
    demo.verify.checks.map((c) => c.id),
    ['store-assets', 'store-references', 'store-qa'],
  )
  // still exactly one project in the target root
  const store = new CatStore({ rootDir: targetRoot })
  assert.equal(store.listProjects().length, 1)
})

test('importSelected: a project whose directory vanished after the scan becomes an error entry; loop continues', async () => {
  const { legacyRoot, targetRoot } = makeFixture()
  const service = makeService(targetRoot)
  service.scanRoot(legacyRoot)
  rmSync(join(legacyRoot, 'data', 'projects', 'orphan'), { recursive: true, force: true })

  const report = await service.importSelected({ projectIds: ['orphan', 'demo'] })
  assert.equal(report.counts.error, 1)
  assert.equal(report.counts.imported, 1)
  const orphan = report.projects.find((p) => p.legacyProjectId === 'orphan')
  assert.ok(orphan)
  assert.equal(orphan.disposition, 'error')
  assert.equal(orphan.verify.status, 'skipped')
  assert.ok(orphan.notes.some((n) => n.includes('import failed')))
  assert.equal(report.projects.find((p) => p.legacyProjectId === 'demo')?.disposition, 'imported')
})

test('importSelected: without a prior scan / with ids outside the scan -> INVALID_INPUT', async () => {
  const { legacyRoot, targetRoot } = makeFixture()
  const service = makeService(targetRoot)

  await assert.rejects(
    () => service.importSelected({ projectIds: ['demo'] }),
    (err: unknown) => err instanceof LinguistMigrationInputError && err.code === 'INVALID_INPUT',
  )
  service.scanRoot(legacyRoot)
  await assert.rejects(
    () => service.importSelected({ projectIds: ['demo', 'ghost'] }),
    (err: unknown) =>
      err instanceof LinguistMigrationInputError && /not present in the last scan/.test(err.message),
  )
})

test('degraded mode: scan and import both refuse defensively with STORE_SQLITE_UNAVAILABLE', async () => {
  const { legacyRoot, targetRoot } = makeFixture()
  const service = makeService(targetRoot, false)

  assert.throws(
    () => service.scanRoot(legacyRoot),
    (err: unknown) =>
      err instanceof LinguistMigrationUnavailableError && err.code === 'STORE_SQLITE_UNAVAILABLE',
  )
  await assert.rejects(
    () => service.importSelected({ projectIds: ['demo'] }),
    (err: unknown) =>
      err instanceof LinguistMigrationUnavailableError && err.code === 'STORE_SQLITE_UNAVAILABLE',
  )
})
