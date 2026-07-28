/**
 * PB-090 CLI smoke tests: drives the REAL CLI as a subprocess (the
 * documented node invocation, see package.json `cli` script) against a
 * synthetic legacy tree — text mode, --json mode, not-found, usage errors —
 * and asserts the scanned tree is byte-identical afterwards (read-only).
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdtempSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const PKG_DIR = fileURLToPath(new URL('../', import.meta.url))
const CLI_ARGS = ['--experimental-transform-types', '--import', './test/register-ts-loader.mjs', 'src/cli.ts']

interface CliResult {
  code: number
  stdout: string
  stderr: string
}

function cli(args: string[]): CliResult {
  const result = spawnSync(process.execPath, [...CLI_ARGS, ...args], {
    cwd: PKG_DIR,
    encoding: 'utf8',
  })
  return { code: result.status ?? -1, stdout: result.stdout, stderr: result.stderr }
}

function writeJson(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, `${JSON.stringify(value)}\n`)
}

function snapshotTree(dir: string): Map<string, string> {
  const out = new Map<string, string>()
  const stack = [dir]
  while (stack.length > 0) {
    const current = stack.pop()!
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const path = join(current, entry.name)
      if (entry.isDirectory()) stack.push(path)
      else if (entry.isFile()) out.set(path.slice(dir.length + 1), createHash('sha256').update(readFileSync(path)).digest('hex'))
    }
  }
  return out
}

function makeFixture(): { root: string; external: string } {
  const root = mkdtempSync(join(tmpdir(), 'la-legacy-scan-cli-'))
  const external = mkdtempSync(join(tmpdir(), 'la-legacy-scan-src-'))
  const pdir = join(root, 'data', 'projects', 'alpha')
  writeJson(join(pdir, 'project.json'), {
    schemaVersion: 1,
    projectId: 'alpha',
    projectName: 'alpha',
    root: external,
    sourceLanguage: 'en',
    targetLanguage: 'zh-CN',
    createdAt: '2025-01-01T00:00:00.000Z',
    updatedAt: '2025-06-01T00:00:00.000Z',
    scan: { root: external, scannedAt: '2025-01-01T00:00:00.000Z', assets: [], phraseTagPairs: [], warnings: [], questions: [] },
    assetRoleDecisions: [],
    phraseTagPairs: [],
    importPlan: [],
    warnings: [],
    questions: [],
  })
  writeJson(join(pdir, 'tm.json'), [{ id: 'tm-1', source: 'a', target: '甲' }])
  writeJson(join(pdir, 'chat.json'), [{ ts: '2025-01-03T00:00:00.000Z', kind: 'user', text: 'hi' }])
  return { root, external }
}

test('cli scan: text mode emits summary lines and one JSON line per project', () => {
  const { root } = makeFixture()
  const r = cli(['scan', '--root', root, '--now', '2026-01-01T00:00:00.000Z'])
  assert.equal(r.code, 0, `stderr: ${r.stderr}`)
  assert.ok(r.stdout.includes('tool: linguist-legacy-scan\n'), r.stdout)
  assert.ok(r.stdout.includes('generated-at: 2026-01-01T00:00:00.000Z\n'), r.stdout)
  assert.ok(r.stdout.includes('schema-version: 1\n'), r.stdout)
  assert.ok(r.stdout.includes('sqlite-authority: absent\n'), r.stdout)
  assert.ok(r.stdout.includes('projects: 1\n'), r.stdout)
  const projectLines = r.stdout.split('\n').filter((l) => l.startsWith('{"project":'))
  assert.equal(projectLines.length, 1)
  const project = JSON.parse(projectLines[0]!) as { project: string; tmEntries: number; chatPresent: boolean }
  assert.equal(project.project, 'alpha')
  assert.equal(project.tmEntries, 1)
  assert.equal(project.chatPresent, true)
})

test('cli scan --json: whole report is one JSON document', () => {
  const { root } = makeFixture()
  const r = cli(['scan', '--root', root, '--json', '--now', '2026-01-01T00:00:00.000Z'])
  assert.equal(r.code, 0, `stderr: ${r.stderr}`)
  const report = JSON.parse(r.stdout) as {
    tool: string
    generatedAt: string
    projects: Array<{ projectId: string; digest: string }>
    totals: { projects: number }
  }
  assert.equal(report.tool, 'linguist-legacy-scan')
  assert.equal(report.generatedAt, '2026-01-01T00:00:00.000Z')
  assert.equal(report.totals.projects, 1)
  assert.match(report.projects[0]!.digest, /^[0-9a-f]{64}$/)
})

test('cli scan: missing root exits 3 with SCAN_ROOT_NOT_FOUND', () => {
  const r = cli(['scan', '--root', join(tmpdir(), 'la-legacy-scan-no-such-dir')])
  assert.equal(r.code, 3)
  assert.ok(r.stderr.includes('error[SCAN_ROOT_NOT_FOUND]:'), r.stderr)
})

test('cli: unknown flag exits 2 with USAGE error', () => {
  const { root } = makeFixture()
  const r = cli(['scan', '--root', root, '--bogus', 'x'])
  assert.equal(r.code, 2)
  assert.ok(r.stderr.includes('error[USAGE]:'), r.stderr)
})

test('cli: no arguments prints usage to stderr and exits 2; help exits 0', () => {
  const none = cli([])
  assert.equal(none.code, 2)
  assert.ok(none.stderr.includes('Usage:'), none.stderr)
  const help = cli(['help'])
  assert.equal(help.code, 0)
  assert.ok(help.stdout.includes('Usage:'), help.stdout)
})

test('cli scan is read-only: tree is byte-identical after two runs', () => {
  const { root } = makeFixture()
  const before = snapshotTree(root)
  const first = cli(['scan', '--root', root, '--now', '2026-01-01T00:00:00.000Z'])
  const second = cli(['scan', '--root', root, '--now', '2026-01-01T00:00:00.000Z'])
  assert.equal(first.code, 0, `stderr: ${first.stderr}`)
  assert.equal(second.code, 0, `stderr: ${second.stderr}`)
  assert.deepEqual(snapshotTree(root), before)
  // pinned clock => identical stdout across runs
  assert.equal(first.stdout, second.stdout)
})

// ---------------------------------------------------------------------------
// PB-092: import disposition flags + quarantine exit code (real subprocess)

function makeOrphanFixture(): { root: string } {
  const root = mkdtempSync(join(tmpdir(), 'la-legacy-orphan-cli-'))
  const pdir = join(root, 'data', 'projects', 'orphan')
  mkdirSync(join(pdir, 'batches', 'b1'), { recursive: true })
  writeFileSync(join(pdir, 'project.json'), '{ not json')
  writeJson(join(pdir, 'batches', 'b1', 'batch.json'), {
    schemaVersion: 1,
    format: 'phrase_mxliff',
    projectId: 'orphan',
    batchId: 'b1',
    sourceFile: 'gone.mxliff',
    sourceLanguage: 'en',
    targetLanguage: 'de',
    segments: [],
  })
  return { root }
}

test('cli import: orphan project is quarantined — exit 5, full report on stdout, zero writes', () => {
  const { root } = makeOrphanFixture()
  const targetParent = mkdtempSync(join(tmpdir(), 'la-legacy-target-cli-'))
  const target = join(targetParent, 'linguist')
  const r = cli(['import', '--root', root, '--project', 'orphan', '--target-root', target, '--now', '2026-01-01T00:00:00.000Z'])
  assert.equal(r.code, 5, `stderr: ${r.stderr}`)
  assert.ok(r.stdout.includes('disposition: quarantined\n'), r.stdout)
  assert.ok(r.stdout.includes('refusal: orphan-project\n'), r.stdout)

  const rj = cli(['import', '--root', root, '--project', 'orphan', '--target-root', target, '--now', '2026-01-01T00:00:00.000Z', '--json'])
  assert.equal(rj.code, 5, `stderr: ${rj.stderr}`)
  const report = JSON.parse(rj.stdout) as { disposition: string; refusal: { reason: string } | null; signals: unknown[]; archives: unknown[] }
  assert.equal(report.disposition, 'quarantined')
  assert.equal(report.refusal?.reason, 'orphan-project')
  assert.ok(Array.isArray(report.signals) && Array.isArray(report.archives))
  // zero writes: the linguist target root was never even created
  assert.equal(readdirSync(targetParent).length, 0)

  // --salvage-orphan rescues the same project
  const rs = cli(['import', '--root', root, '--project', 'orphan', '--target-root', target, '--now', '2026-01-01T00:00:00.000Z', '--salvage-orphan'])
  assert.equal(rs.code, 0, `stderr: ${rs.stderr}`)
  assert.ok(rs.stdout.includes('project-name: orphan\n'), rs.stdout)
})

test('cli import: --external-source validates its value (usage error on anything else)', () => {
  const { root } = makeOrphanFixture()
  const target = join(mkdtempSync(join(tmpdir(), 'la-legacy-target-cli-')), 'linguist')
  const bad = cli(['import', '--root', root, '--project', 'orphan', '--target-root', target, '--external-source=bogus'])
  assert.equal(bad.code, 2)
  assert.ok(bad.stderr.includes('--external-source must be copy or reference'), bad.stderr)
  // boolean form of --salvage-orphan is accepted (=false)
  const ok = cli(['import', '--root', root, '--project', 'orphan', '--target-root', target, '--salvage-orphan=false'])
  assert.equal(ok.code, 5) // still quarantined, flag parsed fine
})

// ---------------------------------------------------------------------------
// PB-093: import --json carries the chat transcript artifact descriptor

test('cli import --json: chat.transcript fields present and transcript.md byte-consistent on disk', () => {
  const { root } = makeFixture() // alpha: chat.json = one user row without sessionId
  const target = join(mkdtempSync(join(tmpdir(), 'la-legacy-target-cli-')), 'linguist')
  const r = cli(['import', '--root', root, '--project', 'alpha', '--target-root', target, '--now', '2026-01-01T00:00:00.000Z', '--json'])
  assert.equal(r.code, 0, `stderr: ${r.stderr}`)
  const report = JSON.parse(r.stdout) as {
    newProjectId: string
    chat: {
      present: boolean
      piSessionsArchived: number
      transcript: {
        path: string
        sha256: string
        bytes: number
        sessions: number
        rows: number
        malformedRows: number
        unassignedRows: number
      } | null
    }
  }
  assert.equal(report.chat.present, true)
  const transcript = report.chat.transcript
  assert.ok(transcript !== null, 'transcript descriptor must be present in --json output')
  assert.equal(transcript.path, join('projects', report.newProjectId, 'legacy-archive', 'chat', 'transcript.md'))
  // the alpha row has no sessionId -> unassigned section, no session sections
  assert.deepEqual(
    { sessions: transcript.sessions, rows: transcript.rows, malformedRows: transcript.malformedRows, unassignedRows: transcript.unassignedRows },
    { sessions: 0, rows: 1, malformedRows: 0, unassignedRows: 1 },
  )
  assert.match(transcript.sha256, /^[0-9a-f]{64}$/)
  assert.equal(report.chat.piSessionsArchived, 0)
  // the file really landed, byte-consistent with the reported sha256/bytes
  const onDisk = readFileSync(join(target, transcript.path))
  assert.equal(createHash('sha256').update(onDisk).digest('hex'), transcript.sha256)
  assert.equal(onDisk.length, transcript.bytes)
  const markdown = onDisk.toString('utf8')
  assert.ok(markdown.includes('read-only archived transcript'))
  assert.ok(markdown.includes('## 未分配会话'))

  // text mode exposes the same artifact as summary lines
  const rt = cli(['import', '--root', root, '--project', 'alpha', '--target-root', join(mkdtempSync(join(tmpdir(), 'la-legacy-target-cli-')), 'linguist'), '--now', '2026-01-01T00:00:00.000Z'])
  assert.equal(rt.code, 0, `stderr: ${rt.stderr}`)
  assert.ok(rt.stdout.includes(`chat-transcript: ${transcript.path} sha256=${transcript.sha256}`), rt.stdout)
  assert.ok(rt.stdout.includes('pi-sessions-archived: 0\n'), rt.stdout)
})

test('cli import --json: project without chat.json reports chat.transcript = null', () => {
  const { root } = makeOrphanFixture() // orphan has no chat.json, but is quarantined; use a salvaged run instead
  const target = join(mkdtempSync(join(tmpdir(), 'la-legacy-target-cli-')), 'linguist')
  const r = cli(['import', '--root', root, '--project', 'orphan', '--target-root', target, '--now', '2026-01-01T00:00:00.000Z', '--salvage-orphan', '--json'])
  assert.equal(r.code, 0, `stderr: ${r.stderr}`)
  const report = JSON.parse(r.stdout) as { chat: { present: boolean; transcript: null | unknown; piSessionsArchived: number } }
  assert.equal(report.chat.present, false)
  assert.equal(report.chat.transcript, null)
  assert.equal(report.chat.piSessionsArchived, 0)
})
