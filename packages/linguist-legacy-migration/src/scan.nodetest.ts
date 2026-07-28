/**
 * PB-090 scanner tests: programmatic mkdtemp synthetic trees covering the
 * six situations — normal v1, normal v2 + SQLite authority, invalid
 * permission mode, root-missing, internal-copy-only (uploads and blob-store
 * variants), orphan projects (missing/corrupt manifest + reverse
 * sqlite-only) — plus the read-only guarantee and digest stability.
 *
 * All trees are synthetic; no legacy repo data is ever touched. The SQLite
 * fixture database is created by the test itself (writable — it is our own
 * temp file, not a scanned artifact).
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { scanLegacyRoot, type HealthSignal, type ScanReport } from './scan'

// ---------------------------------------------------------------------------
// fixture helpers

function makeDir(): string {
  return mkdtempSync(join(tmpdir(), 'la-legacy-scan-'))
}

function writeJson(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`)
}

function writeText(path: string, text: string): void {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, text)
}

function makeManifest(projectId: string, root: string, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schemaVersion: 1,
    projectId,
    projectName: projectId,
    root,
    sourceLanguage: 'en',
    targetLanguage: 'zh-CN',
    createdAt: '2025-01-01T00:00:00.000Z',
    updatedAt: '2025-06-01T00:00:00.000Z',
    scan: {
      root,
      scannedAt: '2025-01-01T00:00:00.000Z',
      assets: [
        {
          path: join(root, 'a.docx'),
          relPath: 'a.docx',
          name: 'a.docx',
          ext: '.docx',
          sizeBytes: 100,
          role: 'source',
          confidence: 0.9,
          reasons: ['ext'],
        },
        {
          path: join(root, 'notes.txt'),
          relPath: 'notes.txt',
          name: 'notes.txt',
          ext: '.txt',
          sizeBytes: 40,
          role: 'reference',
          confidence: 0.7,
          reasons: ['ext'],
        },
      ],
      phraseTagPairs: [],
      warnings: [],
      questions: [],
    },
    assetRoleDecisions: [],
    phraseTagPairs: [],
    importPlan: ['batches/b1'],
    warnings: [],
    questions: [],
    ...extra,
  }
}

function makeSegment(index: number, status: string, locked: boolean): Record<string, unknown> {
  return {
    index,
    id: `s${index + 1}`,
    source: `Source ${index + 1}`,
    target: locked ? `目标 ${index + 1}` : '',
    rawSource: `Source ${index + 1}`,
    rawTarget: '',
    locked,
    status,
    duplicateKey: `k${index + 1}`,
    placeholderCount: 0,
    unresolvedPlaceholderCount: 0,
  }
}

function makeBatch(projectId: string, batchId: string, segments = [makeSegment(0, 'new', false), makeSegment(1, 'confirmed', true), makeSegment(2, 'draft', false)]): Record<string, unknown> {
  return {
    schemaVersion: 1,
    format: 'xliff_1_2',
    projectId,
    batchId,
    sourceFile: 'a.xlf',
    sourceLanguage: 'en',
    targetLanguage: 'zh-CN',
    createdAt: '2025-01-02T00:00:00.000Z',
    updatedAt: '2025-01-02T00:00:00.000Z',
    segments,
  }
}

function makeTmEntries(count: number): Array<Record<string, unknown>> {
  return Array.from({ length: count }, (_, i) => ({
    id: `tm-${i + 1}`,
    source: `TM source ${i + 1}`,
    target: `TM 目标 ${i + 1}`,
    origin: 'reviewed',
  }))
}

function signals(report: ScanReport, code: HealthSignal['code']): HealthSignal[] {
  return report.health.filter((s) => s.code === code)
}

/** sha256+bytes of every file under dir (read-only guarantee snapshots). */
function snapshotTree(dir: string): Map<string, { sha256: string; bytes: number }> {
  const out = new Map<string, { sha256: string; bytes: number }>()
  const stack = [dir]
  while (stack.length > 0) {
    const current = stack.pop()!
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const path = join(current, entry.name)
      if (entry.isDirectory()) {
        stack.push(path)
      } else if (entry.isFile()) {
        const bytes = readFileSync(path)
        out.set(path.slice(dir.length + 1), {
          sha256: createHash('sha256').update(bytes).digest('hex'),
          bytes: bytes.length,
        })
      }
    }
  }
  return out
}

// ---------------------------------------------------------------------------
// situation 1: normal v1 tree (no .schema.json, legacy JSON everywhere)

test('v1: legacy JSON project scans with counts, digest and both-sides signal', () => {
  const root = makeDir()
  const external = makeDir()
  writeText(join(external, 'a.docx'), 'source bytes')

  const pid = 'alpha'
  const pdir = join(root, 'data', 'projects', pid)
  writeJson(join(pdir, 'project.json'), makeManifest(pid, external, { extraField: 'surprise' }))
  writeJson(join(pdir, 'tm.json'), makeTmEntries(2))
  writeText(join(pdir, 'tm_audit.jsonl'), '{"op":"upsert"}\n{"op":"upsert"}\n')
  writeJson(join(pdir, 'termbase.json'), [{ id: 'tb-1', source: 'term', target: '术语' }])
  writeJson(join(pdir, 'termbase_overrides.json'), [{ source: 'term', target: '术语' }])
  writeJson(join(pdir, 'batches', 'b1', 'batch.json'), makeBatch(pid, 'b1'))
  writeJson(join(pdir, 'batches', 'b1', 'proposals', 'p1.json'), { proposalSetId: 'p1' })
  writeText(join(pdir, 'batches', 'b1', 'reports', 'p1.md'), '# report\n')
  writeText(join(pdir, 'uploads', '20250101-a.docx'), 'managed copy')
  writeJson(join(pdir, 'chat.json'), [
    { ts: '2025-01-03T00:00:00.000Z', kind: 'user', text: 'hi', sessionId: 's1' },
    { ts: '2025-01-03T00:00:01.000Z', kind: 'assistant', text: 'hello', sessionId: 's1' },
  ])
  writeJson(join(pdir, 'agent_selected_session.json'), { sessionId: 's1' })
  writeJson(join(pdir, 'agent_settings.json'), { permissionMode: 'ask', modelId: 'm' })
  writeText(join(pdir, 'mystery.bin'), '???')

  const before = snapshotTree(root)
  const report = scanLegacyRoot({ root, now: () => '2026-01-01T00:00:00.000Z' })
  const after = snapshotTree(root)

  assert.equal(report.schemaVersion, 1)
  assert.equal(report.schemaMarker, null)
  assert.equal(report.sqlite.authority, false)
  assert.equal(report.projects.length, 1)

  const p = report.projects[0]!
  assert.equal(p.manifest.source, 'legacy-json')
  assert.equal(p.manifest.readable, true)
  assert.equal(p.manifest.manifest?.root, external)
  assert.equal(p.sourceRoot.exists, true)
  assert.equal(p.assets.count, 2)
  assert.deepEqual(p.assets.byRole, { source: 1, reference: 1 })
  assert.equal(p.uploads.files, 1)
  assert.equal(p.batches.length, 1)
  assert.equal(p.batches[0]!.segmentCount, 3)
  assert.equal(p.batches[0]!.lockedCount, 1)
  assert.deepEqual(p.batches[0]!.statusCounts, { new: 1, confirmed: 1, draft: 1 })
  assert.equal(p.batches[0]!.proposals, 1)
  assert.equal(p.batches[0]!.reports, 1)
  assert.equal(p.tm.entries, 2)
  assert.equal(p.tm.auditLines, 2)
  assert.equal(p.termbase.entries, 1)
  assert.equal(p.termbase.overrides, 1)
  assert.equal(p.chat.present, true)
  assert.equal(p.chat.entries, 2)
  assert.equal(p.chat.selectedSession, true)

  // unsupported fields: unknown manifest field + unknown project file
  const unsupportedPaths = p.unsupportedFields.map((f) => f.path)
  assert.ok(unsupportedPaths.includes('manifest.extraField'), `missing manifest.extraField in ${unsupportedPaths}`)
  assert.ok(unsupportedPaths.includes('mystery.bin'), `missing mystery.bin in ${unsupportedPaths}`)

  // external root exists AND uploads present => copies on both sides
  assert.equal(signals(report, 'external-root-with-managed-uploads').length, 1)
  assert.equal(signals(report, 'root-missing').length, 0)
  assert.equal(signals(report, 'orphan-project').length, 0)

  // digest covers the key files and is stable across scans
  const digestPaths = p.digestFiles.map((f) => f.relPath)
  for (const expected of ['project.json', 'tm.json', 'termbase.json', 'chat.json', 'batches/b1/batch.json', 'uploads/20250101-a.docx']) {
    assert.ok(digestPaths.includes(expected), `digest missing ${expected}`)
  }
  assert.match(p.digest, /^[0-9a-f]{64}$/)
  const second = scanLegacyRoot({ root, now: () => '2026-01-01T00:00:00.000Z' })
  assert.equal(second.projects[0]!.digest, p.digest)

  // read-only guarantee: the tree is byte-identical after the scan
  assert.deepEqual(after, before)
})

test('v1: digest changes when a key file changes', () => {
  const root = makeDir()
  const external = makeDir()
  const pid = 'alpha'
  const pdir = join(root, 'data', 'projects', pid)
  writeJson(join(pdir, 'project.json'), makeManifest(pid, external))
  writeJson(join(pdir, 'tm.json'), makeTmEntries(1))

  const first = scanLegacyRoot({ root })
  writeJson(join(pdir, 'tm.json'), makeTmEntries(2))
  const second = scanLegacyRoot({ root })
  assert.notEqual(second.projects[0]!.digest, first.projects[0]!.digest)
})

// ---------------------------------------------------------------------------
// situation 2: v2 tree with SQLite authority (real read-only sqlite probe)

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

/** Independent reimplementation of the legacy stream-id formula (cross-check). */
function streamId(kind: string, projectId: string, id = 'root'): string {
  const suffix = createHash('sha256').update(projectId + String.fromCodePoint(0) + id).digest('hex').slice(0, 48)
  return `cat-core-${kind}-${suffix}`
}

test('v2: SQLite authority wins, divergence and reverse orphan are reported', () => {
  const root = makeDir()
  const external = makeDir()
  writeJson(join(root, 'data', '.schema.json'), {
    schemaVersion: 2,
    migratedAt: '2025-08-01T00:00:00.000Z',
    sourceManifestHash: 'abc',
    backupId: 'schema-1-to-2-deadbeef',
  })

  const pid = 'bravo'
  const sqliteManifest = makeManifest(pid, external, { updatedAt: '2025-09-01T00:00:00.000Z' })
  const ghostManifest = makeManifest('ghost', external)
  const dbPath = join(root, 'data', 'runtime', 'cat-core-sqlite-v1', 'cat-core.sqlite')
  const db = createCatCoreFixture(dbPath, [
    { streamId: streamId('manifest', pid), value: sqliteManifest },
    { streamId: streamId('manifest', 'ghost'), value: ghostManifest },
    { streamId: streamId('tm', pid), value: makeTmEntries(3) },
    { streamId: streamId('batch', pid, 'b1'), value: makeBatch(pid, 'b1', [makeSegment(0, 'new', false)]) },
  ])
  db.close()

  writeJson(join(root, 'data', 'runtime', 'cat-core-sqlite-v1', 'authority-v1.json'), { owner: 'test' })
  writeText(
    join(root, 'data', 'runtime', 'cat-core-sqlite-v1', 'blob-store', 'blobs', 'sha256', 'ab', 'ab'.padEnd(64, '0')),
    'blob-bytes',
  )

  // legacy side: same project exists with an OLDER manifest and smaller tm
  const pdir = join(root, 'data', 'projects', pid)
  writeJson(join(pdir, 'project.json'), makeManifest(pid, external))
  writeJson(join(pdir, 'tm.json'), makeTmEntries(1))

  const report = scanLegacyRoot({ root, now: () => '2026-01-01T00:00:00.000Z' })

  assert.equal(report.schemaVersion, 2)
  assert.equal(report.schemaMarker?.backupId, 'schema-1-to-2-deadbeef')
  assert.equal(report.sqlite.authority, true)
  assert.equal(report.sqlite.opened, true)
  assert.equal(report.sqlite.error, null)
  assert.match(report.sqlite.dbSha256 ?? '', /^[0-9a-f]{64}$/)
  assert.deepEqual(report.sqlite.projectIds, ['bravo', 'ghost'])
  assert.deepEqual(report.sqliteOnlyProjects, ['ghost'])
  assert.deepEqual(report.sqlite.blobStore, { present: true, blobs: 1, bytes: 10 })

  const p = report.projects[0]!
  assert.equal(p.projectId, 'bravo')
  assert.equal(p.manifest.source, 'sqlite')
  assert.equal(p.manifest.manifest?.updatedAt, '2025-09-01T00:00:00.000Z')
  assert.equal(p.tm.source, 'sqlite')
  assert.equal(p.tm.entries, 3)
  assert.equal(p.batches.length, 1)
  assert.equal(p.batches[0]!.source, 'sqlite')
  assert.equal(p.batches[0]!.segmentCount, 1)

  const codes = report.health.map((s) => s.code)
  assert.ok(codes.includes('sqlite-authority-active'))
  assert.ok(codes.includes('sqlite-legacy-divergence'), `expected divergence signal in ${codes.join(',')}`)
  assert.ok(codes.includes('orphan-sqlite-project'))

  // read-only: database bytes must not change across a scan
  const dbBytesBefore = readFileSync(dbPath)
  scanLegacyRoot({ root })
  assert.deepEqual(readFileSync(dbPath), dbBytesBefore)
})

// ---------------------------------------------------------------------------
// situation 3: invalid permission mode never aborts the scan

test('invalid permissionMode ("full") is recorded as unsupported + signal, scan continues', () => {
  const root = makeDir()
  const external = makeDir()
  const pid = 'gamma'
  const pdir = join(root, 'data', 'projects', pid)
  writeJson(join(pdir, 'project.json'), makeManifest(pid, external))
  writeJson(join(pdir, 'tm.json'), makeTmEntries(2))
  writeJson(join(pdir, 'agent_settings.json'), {
    permissionMode: 'full',
    thinkingLevel: 'ultra',
    modelId: 'm',
    surpriseKey: true,
  })

  const report = scanLegacyRoot({ root })
  const p = report.projects[0]!
  assert.equal(p.manifest.readable, true)
  assert.equal(p.tm.entries, 2)

  const perm = signals(report, 'invalid-permission-mode')
  assert.equal(perm.length, 1)
  assert.equal(perm[0]!.severity, 'warning')

  const unsupported = p.unsupportedFields.map((f) => `${f.scope}:${f.path}`)
  assert.ok(unsupported.includes('agent-settings:agent-settings.permissionMode'))
  assert.ok(unsupported.includes('agent-settings:agent-settings.thinkingLevel'))
  assert.ok(unsupported.includes('agent-settings:agent-settings.surpriseKey'))
})

// ---------------------------------------------------------------------------
// situations 4+5: root-missing degrades to workspace-only; internal copies

test('root-missing + internal-copy-only (uploads and blob-store variants)', () => {
  const root = makeDir()
  const gone = join(root, 'does-not-exist-anywhere')

  // variant A: root gone, uploads/ has durable copies
  const aDir = join(root, 'data', 'projects', 'delta')
  writeJson(join(aDir, 'project.json'), makeManifest('delta', gone))
  writeText(join(aDir, 'uploads', '20250101-a.docx'), 'copy A')
  writeText(join(aDir, 'uploads', '20250102-b.docx'), 'copy B')

  // variant B: root gone, no uploads, but blob-store has blobs
  const bDir = join(root, 'data', 'projects', 'echo')
  writeJson(join(bDir, 'project.json'), makeManifest('echo', gone))
  writeText(
    join(root, 'data', 'runtime', 'cat-core-sqlite-v1', 'blob-store', 'blobs', 'sha256', 'cd', 'cd'.padEnd(64, '0')),
    'blob',
  )

  const report = scanLegacyRoot({ root })
  const delta = report.projects.find((p) => p.projectId === 'delta')!
  const echo = report.projects.find((p) => p.projectId === 'echo')!

  assert.equal(delta.sourceRoot.exists, false)
  assert.equal(delta.uploads.files, 2)
  assert.equal(echo.sourceRoot.exists, false)
  assert.equal(echo.uploads.files, 0)

  const rootMissing = signals(report, 'root-missing').map((s) => s.projectId)
  assert.deepEqual(rootMissing.sort(), ['delta', 'echo'])

  const internalOnly = signals(report, 'internal-copy-only')
  assert.equal(internalOnly.length, 2)
  const deltaEvidence = internalOnly.find((s) => s.projectId === 'delta')!.evidence!
  assert.equal(deltaEvidence.uploads, 2)
  const echoEvidence = internalOnly.find((s) => s.projectId === 'echo')!.evidence!
  assert.equal(echoEvidence.uploads, 0)
  assert.ok((echoEvidence.blobStoreBlobs as number) > 0)

  // no authority marker was created by the blob-store-only runtime dir
  assert.equal(report.sqlite.authority, false)
  // both-sides signal must NOT fire when the root is gone
  assert.equal(signals(report, 'external-root-with-managed-uploads').length, 0)
  // scan still digests workspace files
  assert.match(delta.digest, /^[0-9a-f]{64}$/)
})

// ---------------------------------------------------------------------------
// situation 6: orphan projects (missing manifest, corrupt manifest)

test('orphan projects: missing manifest => warning, corrupt manifest => error; workspace still scanned', () => {
  const root = makeDir()
  const external = makeDir()

  const missingDir = join(root, 'data', 'projects', 'orphan-missing')
  mkdirSync(missingDir, { recursive: true })
  writeJson(join(missingDir, 'chat.json'), [{ ts: '2025-01-01T00:00:00.000Z', kind: 'user', text: 'hi' }])

  const corruptDir = join(root, 'data', 'projects', 'orphan-corrupt')
  writeText(join(corruptDir, 'project.json'), '{not json')
  writeJson(join(corruptDir, 'tm.json'), makeTmEntries(1))

  const report = scanLegacyRoot({ root })
  assert.equal(report.projects.length, 2)

  const orphans = signals(report, 'orphan-project')
  assert.equal(orphans.length, 2)
  const missing = orphans.find((s) => s.projectId === 'orphan-missing')!
  const corrupt = orphans.find((s) => s.projectId === 'orphan-corrupt')!
  assert.equal(missing.severity, 'warning')
  assert.equal(corrupt.severity, 'error')

  const missingScan = report.projects.find((p) => p.projectId === 'orphan-missing')!
  assert.equal(missingScan.manifest.readable, false)
  assert.equal(missingScan.chat.present, true)
  assert.equal(missingScan.chat.entries, 1)

  const corruptScan = report.projects.find((p) => p.projectId === 'orphan-corrupt')!
  assert.equal(corruptScan.manifest.readable, false)
  assert.equal(corruptScan.tm.entries, 1)
})

// ---------------------------------------------------------------------------
// read-cache layer: authority active but sqlite unreadable => fallback

test('read-cache fallback: authority active + corrupt sqlite falls back to read-cache JSON', () => {
  const root = makeDir()
  const external = makeDir()
  const pid = 'foxtrot'
  writeJson(join(root, 'data', 'runtime', 'cat-core-sqlite-v1', 'authority-v1.json'), { owner: 'test' })
  writeText(join(root, 'data', 'runtime', 'cat-core-sqlite-v1', 'cat-core.sqlite'), 'not a sqlite database')
  writeJson(join(root, 'data', 'runtime', 'cat-core-sqlite-v1', 'read-cache', pid, 'manifest.json'), makeManifest(pid, external))
  writeJson(join(root, 'data', 'runtime', 'cat-core-sqlite-v1', 'read-cache', pid, 'tm.json'), makeTmEntries(4))
  writeJson(join(root, 'data', 'projects', pid, 'project.json'), makeManifest(pid, external))

  const report = scanLegacyRoot({ root })
  const p = report.projects[0]!
  assert.equal(report.sqlite.authority, true)
  assert.equal(report.sqlite.opened, false)
  assert.ok(signals(report, 'sqlite-unreadable').length >= 1)
  assert.equal(p.manifest.source, 'read-cache')
  assert.equal(p.tm.source, 'read-cache')
  assert.equal(p.tm.entries, 4)
  // termbase has no projection anywhere => read-cache-miss signal, no crash
  assert.equal(p.termbase.source, 'none')
  assert.ok(signals(report, 'read-cache-missing-projection').length >= 1)
})
