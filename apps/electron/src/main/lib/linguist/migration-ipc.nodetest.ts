/**
 * Linguist legacy migration typed IPC handler tests (node --test; no
 * electron — handlers are driven directly with a stub directory picker, a
 * real LinguistMigrationService and mkdtemp roots; bun never picks up
 * *.nodetest.ts).
 *
 * Covers: the pickAndScan envelope shapes (cancel / projection / degraded
 * pre-picker refusal / wrong-directory INVALID_INPUT), import input
 * validation, the no-prior-scan and unknown-id refusals, the happy-path
 * aggregated report with forwarded progress events, and INTERNAL collapse
 * for untyped errors.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import type { LinguistIpcResult, LinguistMigrationProgress } from '@proma/shared'
import { createLinguistMigrationIpc, type LinguistMigrationDirectoryPicker } from './migration-ipc'
import { LinguistMigrationService } from './migration-service'

const NOW = '2026-07-26T00:00:00.000Z'

// ---------------------------------------------------------------------------
// helpers

function makeTempDir(): string {
  return mkdtempSync(join(tmpdir(), 'la-migration-ipc-'))
}

function writeJson(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`)
}

/** Minimal one-project legacy root (manifest + one chat row -> archived-only). */
function makeLegacyRoot(): string {
  const legacyRoot = makeTempDir()
  const dir = join(legacyRoot, 'data', 'projects', 'p1')
  writeJson(join(dir, 'project.json'), {
    schemaVersion: 1,
    projectId: 'p1',
    projectName: 'Legacy P1',
    sourceLanguage: 'en',
    targetLanguage: 'de',
    createdAt: '2025-01-01T00:00:00.000Z',
    updatedAt: '2025-06-01T00:00:00.000Z',
  })
  writeJson(join(dir, 'chat.json'), [
    { ts: '2025-03-01T10:00:00.000Z', kind: 'user', text: 'hello', sessionId: 'sess-1' },
  ])
  return legacyRoot
}

function makeService(targetRoot: string, available = true): LinguistMigrationService {
  return new LinguistMigrationService({ targetRoot, isAvailable: () => available, now: () => NOW })
}

function makeIpc(service: LinguistMigrationService) {
  return createLinguistMigrationIpc({ getService: () => service })
}

/** Picker stub: fixed result + call count (pre-picker failures must never call it). */
function makeDirPicker(filePaths: string[] | null): {
  picker: LinguistMigrationDirectoryPicker
  calls: () => number
} {
  let calls = 0
  const picker: LinguistMigrationDirectoryPicker = async (options) => {
    calls += 1
    assert.deepEqual(options.properties, ['openDirectory'])
    return filePaths === null ? { canceled: true, filePaths: [] } : { canceled: false, filePaths }
  }
  return { picker, calls: () => calls }
}

// ---------------------------------------------------------------------------

test('pickAndScan: user cancel is a typed result, not an error', async () => {
  const ipc = makeIpc(makeService(makeTempDir()))
  const { picker } = makeDirPicker(null)

  const result = await ipc.pickAndScan(undefined, picker)
  assert.equal(result.ok, true)
  if (result.ok) assert.deepEqual(result.data, { cancelled: true })
})

test('pickAndScan: degraded mode refuses BEFORE the picker (STORE_SQLITE_UNAVAILABLE)', async () => {
  const ipc = makeIpc(makeService(makeTempDir(), false))
  const { picker, calls } = makeDirPicker([makeTempDir()])

  const result = await ipc.pickAndScan(undefined, picker)
  assert.equal(result.ok, false)
  if (!result.ok) assert.equal(result.error.code, 'STORE_SQLITE_UNAVAILABLE')
  assert.equal(calls(), 0)
})

test('pickAndScan: a directory without data/ maps to INVALID_INPUT (wrong pick is a user error)', async () => {
  const ipc = makeIpc(makeService(makeTempDir()))
  const { picker } = makeDirPicker([makeTempDir()])

  const result = await ipc.pickAndScan(undefined, picker)
  assert.equal(result.ok, false)
  if (!result.ok) assert.equal(result.error.code, 'INVALID_INPUT')
})

test('pickAndScan: picked legacy root returns the scan projection with rootPath', async () => {
  const ipc = makeIpc(makeService(makeTempDir()))
  const legacyRoot = makeLegacyRoot()
  const { picker } = makeDirPicker([legacyRoot])

  const result = await ipc.pickAndScan(undefined, picker)
  assert.equal(result.ok, true)
  if (!result.ok) return
  assert.equal(result.data.cancelled, false)
  if (result.data.cancelled) return
  assert.equal(result.data.rootPath, legacyRoot)
  assert.equal(result.data.schemaVersion, 1)
  assert.deepEqual(result.data.totals, { projects: 1, batches: 0, segments: 0 })
  const project = result.data.projects[0]
  assert.ok(project)
  assert.equal(project.projectId, 'p1')
  assert.equal(project.name, 'Legacy P1')
  assert.equal(project.chatPresent, true)
})

test('import: validation negatives -> INVALID_INPUT (before any service call)', async () => {
  const ipc = makeIpc(makeService(makeTempDir()))
  const cases: { name: string; input: unknown }[] = [
    { name: 'non-record input', input: 'nope' },
    { name: 'missing projectIds', input: {} },
    { name: 'empty projectIds', input: { projectIds: [] } },
    { name: 'non-array projectIds', input: { projectIds: 'p1' } },
    { name: 'numeric entry', input: { projectIds: [42] } },
    { name: 'empty entry', input: { projectIds: [''] } },
    { name: 'path separator entry', input: { projectIds: ['../p1'] } },
    { name: 'too many ids', input: { projectIds: Array.from({ length: 501 }, (_, i) => `p${String(i)}`) } },
    { name: 'bad externalSource', input: { projectIds: ['p1'], options: { externalSource: 'link' } } },
    { name: 'non-boolean salvageOrphan', input: { projectIds: ['p1'], options: { salvageOrphan: 'yes' } } },
    { name: 'non-record options', input: { projectIds: ['p1'], options: 7 } },
  ]
  for (const c of cases) {
    const result = await ipc.import(c.input)
    assert.equal(result.ok, false, c.name)
    if (!result.ok) assert.equal(result.error.code, 'INVALID_INPUT', c.name)
  }
})

test('import: without a prior scan / with ids outside the scan -> INVALID_INPUT', async () => {
  const service = makeService(makeTempDir())
  const ipc = makeIpc(service)

  const noScan = await ipc.import({ projectIds: ['p1'] })
  assert.equal(noScan.ok, false)
  if (!noScan.ok) assert.equal(noScan.error.code, 'INVALID_INPUT')

  const legacyRoot = makeLegacyRoot()
  const { picker } = makeDirPicker([legacyRoot])
  const scanned = await ipc.pickAndScan(undefined, picker)
  assert.equal(scanned.ok, true)

  const unknown = await ipc.import({ projectIds: ['p1', 'ghost'] })
  assert.equal(unknown.ok, false)
  if (!unknown.ok) assert.equal(unknown.error.code, 'INVALID_INPUT')
})

test('import: happy path returns the aggregated report; progress events forwarded in order', async () => {
  const ipc = makeIpc(makeService(makeTempDir()))
  const legacyRoot = makeLegacyRoot()
  const { picker } = makeDirPicker([legacyRoot])
  const scanned = await ipc.pickAndScan(undefined, picker)
  assert.equal(scanned.ok, true)

  const events: LinguistMigrationProgress[] = []
  const result: LinguistIpcResult<unknown> = await ipc.import(
    { projectIds: ['p1'], options: { externalSource: 'copy' } },
    (event) => events.push(event),
  )
  assert.equal(result.ok, true)
  if (!result.ok) return
  const report = result.data as {
    counts: Record<string, number>
    projects: Array<{ legacyProjectId: string; disposition: string; verify: { status: string } }>
  }
  assert.deepEqual(report.counts, { imported: 0, partial: 0, 'archived-only': 1, quarantined: 0, error: 0 })
  assert.equal(report.projects[0]?.legacyProjectId, 'p1')
  assert.equal(report.projects[0]?.verify.status, 'passed')
  assert.deepEqual(events, [
    { projectId: 'p1', phase: 'import', index: 1, total: 1 },
    { projectId: 'p1', phase: 'verify', index: 1, total: 1 },
  ])
})

test('untyped errors collapse to INTERNAL without leaking internals', async () => {
  const broken = {
    assertAvailable() {},
    scanRoot() {
      throw new Error('boom: secret-internal-detail')
    },
  } as unknown as LinguistMigrationService
  const ipc = createLinguistMigrationIpc({ getService: () => broken })
  const { picker } = makeDirPicker([makeTempDir()])

  const result = await ipc.pickAndScan(undefined, picker)
  assert.equal(result.ok, false)
  if (!result.ok) {
    assert.equal(result.error.code, 'INTERNAL')
    assert.ok(!result.error.message.includes('secret-internal-detail'))
  }
})
