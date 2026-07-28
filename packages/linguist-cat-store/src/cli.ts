/**
 * linguist-cat CLI (PB-025) — the headless CAT vertical slice over
 * @linguist/cat-store: create project -> import -> list segments -> CAS
 * edit -> minimal QA -> template export -> reimport-verify. No UI, no
 * Agent/Pi, no network; every command runs against a local linguist root
 * dir (mkdtemp in tests).
 *
 * Runs under Node (node:sqlite — bun cannot run it), with the same
 * runner flags as this package's test script:
 *
 *   cd packages/linguist-cat-store
 *   node --experimental-transform-types --import ./test/register-ts-loader.mjs src/cli.ts <command> [flags]
 *
 * (`bun run cli -- <command> [flags]` from the same directory is a
 * shorthand for the exact line above — it still spawns node.)
 *
 * Commands (every command takes --root <dir> and --now <iso> for a pinned
 * clock; create-project also takes --seed <s> for deterministic ids):
 *
 *   create-project --root R --name X --source en --target zh-CN [--workspace-id ID] [--seed S] [--now ISO]
 *   import         --root R --project P --file F [--now ISO]
 *   segments       --root R --project P [--asset A] [--status S] [--limit N] [--now ISO]
 *   edit           --root R --project P --segment S --target T --expected-revision N [--now ISO]
 *   qa             --root R --project P [--asset A] [--now ISO]
 *   export         --root R --project P --asset A [--out PATH] [--now ISO]
 *   verify         --root R --project P --asset A --export PATH [--now ISO]
 *
 * Output conventions: stdout carries `key: value` summary lines plus one
 * JSON object per line for collection items (segments, import warnings,
 * QA findings). Errors go to stderr as `error[<CODE>]: <message>`.
 *
 * Exit codes: 0 ok; 1 unexpected; 2 usage error; 3 not found
 * (project/asset/segment/file); 4 domain rejection (REVISION_CONFLICT /
 * SEGMENT_LOCKED / ...); 5 format error (FORMAT_PARSE_ERROR /
 * FORMAT_UNSUPPORTED / FORMAT_EXPORT_ERROR / ...); 6 verify mismatch.
 *
 * QA note: `qa` runs the INTERIM minimal checker of src/minimal-qa.ts
 * (empty target + {curly}/<tag> placeholder multiset mismatch) — a
 * deliberate placeholder until the real QA Core lands in PB-070.
 *
 * Verify note: `verify` compares EFFECTIVE text (target if present, else
 * source) per segment between the database and the reimported export.
 * That single rule covers bilingual formats (export writes targets into
 * the template) and flat-JSON target-file semantics (an edited leaf is
 * read back as source on reimport of the translated file).
 */

import { existsSync, mkdirSync, readFileSync, realpathSync, renameSync, writeFileSync } from 'node:fs'
import { basename, dirname, isAbsolute, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  DomainError,
  createSeededEntropy,
  type Segment,
  type SegmentStatus,
} from '@linguist/cat-core'
import {
  CatFormatRegistry,
  CsvAdapter,
  FormatError,
  FormatUnsupportedError,
  JsonAdapter,
  XliffAdapter,
  sha256Hex,
  type CatFormatAdapter,
} from '@linguist/cat-formats'
import { StoreError, StoreNotFoundError } from './errors'
import { minimalQaSegment } from './minimal-qa'
import type { ProjectDatabase } from './project-database'
import type { SegmentQuery } from './repositories/segments'
import { CatStore } from './store'

export const EXIT = {
  OK: 0,
  UNEXPECTED: 1,
  USAGE: 2,
  NOT_FOUND: 3,
  DOMAIN_REJECTED: 4,
  FORMAT_ERROR: 5,
  VERIFY_MISMATCH: 6,
} as const

export interface CliIo {
  out: (line: string) => void
  err: (line: string) => void
}

const USAGE = `linguist-cat CLI (PB-025 headless vertical slice; runs under node)

Usage: node --experimental-transform-types --import ./test/register-ts-loader.mjs src/cli.ts <command> [flags]

Commands:
  create-project --root R --name X --source en --target zh-CN [--workspace-id ID] [--seed S] [--now ISO]
  import         --root R --project P --file F
  segments       --root R --project P [--asset A] [--status untranslated|draft|translated|reviewed] [--limit N]
  edit           --root R --project P --segment S --target T --expected-revision N
  qa             --root R --project P [--asset A]
  export         --root R --project P --asset A [--out PATH]
  verify         --root R --project P --asset A --export PATH

Determinism: --seed seeds project-id entropy, --now pins all timestamps of the invocation.
Exit codes: 0 ok, 1 unexpected, 2 usage, 3 not-found, 4 domain rejection, 5 format error, 6 verify mismatch.`

class UsageError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'UsageError'
  }
}

// ---------------------------------------------------------------------------
// flag parsing

function parseFlags(argv: readonly string[], allowed: readonly string[]): Map<string, string> {
  const flags = new Map<string, string>()
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!
    if (arg === '--' || !arg.startsWith('--')) {
      throw new UsageError(`unexpected argument "${arg}"; flags look like --name value or --name=value`)
    }
    const eq = arg.indexOf('=')
    let name: string
    let value: string
    if (eq >= 0) {
      name = arg.slice(2, eq)
      value = arg.slice(eq + 1)
    } else {
      name = arg.slice(2)
      const next = argv[i + 1]
      if (next === undefined) {
        throw new UsageError(`flag --${name} needs a value (use --${name}= for an empty one)`)
      }
      value = next
      i++
    }
    if (!allowed.includes(name)) throw new UsageError(`unknown flag --${name} for this command`)
    flags.set(name, value)
  }
  return flags
}

function required(flags: Map<string, string>, name: string): string {
  const value = flags.get(name)
  if (value === undefined) throw new UsageError(`missing required flag --${name}`)
  return value
}

function requiredNonEmpty(flags: Map<string, string>, name: string): string {
  const value = required(flags, name)
  if (value === '') throw new UsageError(`flag --${name} must not be empty`)
  return value
}

function parseCount(raw: string, name: string): number {
  if (!/^\d+$/.test(raw)) {
    throw new UsageError(`flag --${name} must be a non-negative integer, got "${raw}"`)
  }
  return Number.parseInt(raw, 10)
}

// ---------------------------------------------------------------------------
// shared context

interface CliContext {
  store: CatStore
  /** Pinned timestamp for this invocation (--now), or undefined for wall clock. */
  now?: string
  registry: CatFormatRegistry
}

function makeRegistry(): CatFormatRegistry {
  return new CatFormatRegistry()
    .register(new XliffAdapter())
    .register(new CsvAdapter())
    .register(new JsonAdapter())
}

function openContext(flags: Map<string, string>): CliContext {
  const rootDir = requiredNonEmpty(flags, 'root')
  const now = flags.get('now')
  const seed = flags.get('seed')
  const store = new CatStore({
    rootDir,
    ...(seed !== undefined ? { entropy: createSeededEntropy(seed) } : {}),
    ...(now !== undefined ? { now: () => now } : {}),
  })
  return { store, ...(now !== undefined ? { now } : {}), registry: makeRegistry() }
}

function adapterFor(registry: CatFormatRegistry, formatId: string): CatFormatAdapter {
  const adapter = registry.get(formatId)
  if (!adapter) throw new FormatUnsupportedError(formatId, registry.list().map((a) => a.id))
  return adapter
}

const SEGMENT_PAGE = 500

/** Fetch ALL segments of a project (or one asset), paging past the repo default limit. */
function fetchAllSegments(db: ProjectDatabase, assetId?: string): Segment[] {
  const all: Segment[] = []
  for (let offset = 0; ; offset += SEGMENT_PAGE) {
    const query: SegmentQuery = { limit: SEGMENT_PAGE, offset, ...(assetId !== undefined ? { assetId } : {}) }
    const batch = db.segments.query(query)
    all.push(...batch)
    if (batch.length < SEGMENT_PAGE) return all
  }
}

function resolveInProject(projectDir: string, path: string): string {
  return isAbsolute(path) ? path : join(projectDir, path)
}

let tmpCounter = 0

function writeFileAtomic(path: string, bytes: Uint8Array): void {
  const tmp = `${path}.tmp-${process.pid}-${tmpCounter++}`
  writeFileSync(tmp, bytes)
  renameSync(tmp, path)
}

// ---------------------------------------------------------------------------
// commands

async function cmdCreateProject(flags: Map<string, string>, io: CliIo): Promise<number> {
  const ctx = openContext(flags)
  const project = ctx.store.createProject({
    name: requiredNonEmpty(flags, 'name'),
    sourceLocale: requiredNonEmpty(flags, 'source'),
    targetLocale: requiredNonEmpty(flags, 'target'),
    promaWorkspaceId: flags.get('workspace-id') ?? 'cli',
  })
  io.out(`project: ${project.id}`)
  io.out(`name: ${project.name}`)
  io.out(`source-locale: ${project.sourceLocale}`)
  io.out(`target-locale: ${project.targetLocale}`)
  io.out(`dir: ${ctx.store.index.projectDir(project.id)}`)
  return EXIT.OK
}

async function cmdImport(flags: Map<string, string>, io: CliIo): Promise<number> {
  const ctx = openContext(flags)
  const project = ctx.store.getProject(required(flags, 'project'))
  const filePath = requiredNonEmpty(flags, 'file')
  if (!existsSync(filePath)) throw new StoreNotFoundError('file', filePath)
  const bytes = readFileSync(filePath)
  const filename = basename(filePath)
  const adapter = await ctx.registry.detectBest(bytes, filename)
  const imported = await adapter.import({
    bytes,
    filename,
    sourceLocale: project.sourceLocale,
    targetLocale: project.targetLocale,
  })
  const db = ctx.store.openProject(project.id)
  try {
    const { asset, segments } = db.assets.insertImported(imported)
    const sourceBlob = db.saveAssetSource(asset.id, imported.originalBytes)
    io.out(`asset: ${asset.id}`)
    io.out(`format: ${asset.formatId}`)
    io.out(`segments: ${segments.length}`)
    io.out(`source-sha256: ${asset.sourceSha256}`)
    io.out(`source-blob: ${sourceBlob}`)
    for (const warning of imported.warnings) {
      io.out(JSON.stringify({ warning: warning.code, message: warning.message, segment: warning.segmentKey ?? null }))
    }
    io.out(`warnings: ${imported.warnings.length}`)
  } finally {
    db.close()
  }
  return EXIT.OK
}

const SEGMENT_STATUSES: readonly SegmentStatus[] = ['untranslated', 'draft', 'translated', 'reviewed']

async function cmdSegments(flags: Map<string, string>, io: CliIo): Promise<number> {
  const ctx = openContext(flags)
  const project = ctx.store.getProject(required(flags, 'project'))
  const query: SegmentQuery = {}
  const assetId = flags.get('asset')
  if (assetId !== undefined) query.assetId = assetId
  const status = flags.get('status')
  if (status !== undefined) {
    if (!SEGMENT_STATUSES.includes(status as SegmentStatus)) {
      throw new UsageError(`--status must be one of ${SEGMENT_STATUSES.join(' | ')}, got "${status}"`)
    }
    query.status = status as SegmentStatus
  }
  const limit = flags.get('limit')
  if (limit !== undefined) {
    const n = parseCount(limit, 'limit')
    if (n === 0) throw new UsageError('flag --limit must be >= 1')
    query.limit = n
  }
  const db = ctx.store.openProject(project.id)
  try {
    const segments = db.segments.query(query)
    for (const s of segments) {
      io.out(JSON.stringify({
        id: s.id,
        asset: s.assetId,
        ordinal: s.ordinal,
        key: s.key ?? null,
        status: s.status,
        locked: s.locked,
        revision: s.revision,
        source: s.source,
        target: s.target,
      }))
    }
    io.out(`segments: ${segments.length}`)
  } finally {
    db.close()
  }
  return EXIT.OK
}

async function cmdEdit(flags: Map<string, string>, io: CliIo): Promise<number> {
  const ctx = openContext(flags)
  const project = ctx.store.getProject(required(flags, 'project'))
  const segmentId = required(flags, 'segment')
  // An empty target is legitimate: it clears the translation (status -> untranslated).
  const target = required(flags, 'target')
  const expectedRevision = parseCount(required(flags, 'expected-revision'), 'expected-revision')
  const db = ctx.store.openProject(project.id)
  try {
    const result = db.segments.applyTargetEdit(segmentId, target, expectedRevision, {
      source: 'human',
      ...(ctx.now !== undefined ? { now: ctx.now } : {}),
    })
    io.out(`segment: ${result.segment.id}`)
    io.out(`revision: ${result.segment.revision}`)
    io.out(`status: ${result.segment.status}`)
  } finally {
    db.close()
  }
  return EXIT.OK
}

async function cmdQa(flags: Map<string, string>, io: CliIo): Promise<number> {
  const ctx = openContext(flags)
  const project = ctx.store.getProject(required(flags, 'project'))
  const db = ctx.store.openProject(project.id)
  try {
    const segments = fetchAllSegments(db, flags.get('asset'))
    let findingCount = 0
    for (const segment of segments) {
      // INTERIM minimal QA (src/minimal-qa.ts) until PB-070; rerun semantics
      // come from the qa_findings repository (replace open findings per segment).
      const findings = db.qaFindings.replaceForSegment(segment.id, minimalQaSegment(segment))
      for (const f of findings) {
        io.out(JSON.stringify({
          id: f.id,
          segment: f.segmentId,
          code: f.code,
          severity: f.severity,
          status: f.status,
          message: f.message,
        }))
      }
      findingCount += findings.length
    }
    io.out(`segments-checked: ${segments.length}`)
    io.out(`findings: ${findingCount}`)
  } finally {
    db.close()
  }
  return EXIT.OK
}

async function cmdExport(flags: Map<string, string>, io: CliIo): Promise<number> {
  const ctx = openContext(flags)
  const project = ctx.store.getProject(required(flags, 'project'))
  const db = ctx.store.openProject(project.id)
  try {
    const assetId = required(flags, 'asset')
    const asset = db.assets.get(assetId)
    if (!asset) throw new StoreNotFoundError('asset', assetId)
    const adapter = adapterFor(ctx.registry, asset.formatId)
    // Template bytes come from the persisted source blob (sha-verified by the store).
    const originalBytes = db.readAssetSource(asset.id)
    const segments = fetchAllSegments(db, asset.id)
    const bytes = await adapter.export({ originalBytes, asset, segments })
    const projectDir = ctx.store.index.projectDir(project.id)
    const outFlag = flags.get('out')
    const outPath =
      outFlag === undefined
        ? join(projectDir, 'exports', basename(asset.originalFilename))
        : resolveInProject(projectDir, outFlag)
    mkdirSync(dirname(outPath), { recursive: true })
    writeFileAtomic(outPath, bytes)
    const sha256 = sha256Hex(bytes)
    const rel = relative(projectDir, outPath)
    const record = db.exports.record({
      assetId: asset.id,
      path: rel.startsWith('..') ? outPath : rel,
      sha256,
      segmentCount: segments.length,
      ...(ctx.now !== undefined ? { now: ctx.now } : {}),
    })
    io.out(`export: ${record.id}`)
    io.out(`path: ${outPath}`)
    io.out(`sha256: ${sha256}`)
    io.out(`segments: ${segments.length}`)
  } finally {
    db.close()
  }
  return EXIT.OK
}

async function cmdVerify(flags: Map<string, string>, io: CliIo): Promise<number> {
  const ctx = openContext(flags)
  const project = ctx.store.getProject(required(flags, 'project'))
  const db = ctx.store.openProject(project.id)
  try {
    const assetId = required(flags, 'asset')
    const asset = db.assets.get(assetId)
    if (!asset) throw new StoreNotFoundError('asset', assetId)
    const adapter = adapterFor(ctx.registry, asset.formatId)
    const exportPath = resolveInProject(
      ctx.store.index.projectDir(project.id),
      requiredNonEmpty(flags, 'export'),
    )
    if (!existsSync(exportPath)) throw new StoreNotFoundError('export file', exportPath)
    const reimported = await adapter.import({
      bytes: readFileSync(exportPath),
      filename: basename(exportPath),
      sourceLocale: project.sourceLocale,
      targetLocale: project.targetLocale,
    })
    const dbSegments = fetchAllSegments(db, asset.id)
    const mismatches: string[] = []
    if (reimported.segments.length !== dbSegments.length) {
      mismatches.push(`segment count: export has ${reimported.segments.length}, database has ${dbSegments.length}`)
    }
    const reimportedByPosition = new Map<string, (typeof reimported.segments)[number]>()
    for (const s of reimported.segments) reimportedByPosition.set(`${s.ordinal} ${s.key ?? ''}`, s)
    let compared = 0
    for (const dbSegment of dbSegments) {
      const label = dbSegment.key ?? `#${dbSegment.ordinal}`
      const re = reimportedByPosition.get(`${dbSegment.ordinal} ${dbSegment.key ?? ''}`)
      if (!re) {
        mismatches.push(`${label}: missing in export`)
        continue
      }
      compared++
      // Effective text (target if present, else source) — see the header note.
      const expected = dbSegment.target !== '' ? dbSegment.target : dbSegment.source
      const actual = re.target !== '' ? re.target : re.source
      if (actual !== expected) {
        mismatches.push(`${label}: expected ${JSON.stringify(expected)}, export has ${JSON.stringify(actual)}`)
      }
    }
    if (mismatches.length > 0) {
      for (const line of mismatches) io.out(`mismatch: ${line}`)
      io.out('verify: FAILED')
      io.out(`mismatches: ${mismatches.length}`)
      return EXIT.VERIFY_MISMATCH
    }
    io.out('verify: OK')
    io.out(`segments: ${compared}`)
    return EXIT.OK
  } finally {
    db.close()
  }
}

// ---------------------------------------------------------------------------
// dispatch

type CommandHandler = (flags: Map<string, string>, io: CliIo) => Promise<number>

interface CommandSpec {
  flags: readonly string[]
  handler: CommandHandler
}

const COMMON_FLAGS = ['root', 'now'] as const

const COMMANDS: Record<string, CommandSpec> = {
  'create-project': {
    flags: [...COMMON_FLAGS, 'seed', 'name', 'source', 'target', 'workspace-id'],
    handler: cmdCreateProject,
  },
  import: { flags: [...COMMON_FLAGS, 'project', 'file'], handler: cmdImport },
  segments: { flags: [...COMMON_FLAGS, 'project', 'asset', 'status', 'limit'], handler: cmdSegments },
  edit: {
    flags: [...COMMON_FLAGS, 'project', 'segment', 'target', 'expected-revision'],
    handler: cmdEdit,
  },
  qa: { flags: [...COMMON_FLAGS, 'project', 'asset'], handler: cmdQa },
  export: { flags: [...COMMON_FLAGS, 'project', 'asset', 'out'], handler: cmdExport },
  verify: { flags: [...COMMON_FLAGS, 'project', 'asset', 'export'], handler: cmdVerify },
}

function reportError(err: unknown, io: CliIo): number {
  if (err instanceof UsageError) {
    io.err(`error[USAGE]: ${err.message}`)
    return EXIT.USAGE
  }
  if (err instanceof DomainError) {
    io.err(`error[${err.code}]: ${err.message}`)
    return EXIT.DOMAIN_REJECTED
  }
  if (err instanceof FormatError) {
    io.err(`error[${err.code}]: ${err.message}`)
    return EXIT.FORMAT_ERROR
  }
  if (err instanceof StoreError) {
    io.err(`error[${err.code}]: ${err.message}`)
    return err.code === 'STORE_NOT_FOUND' ? EXIT.NOT_FOUND : EXIT.UNEXPECTED
  }
  io.err(`error[UNEXPECTED]: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}`)
  return EXIT.UNEXPECTED
}

export async function runCli(argv: readonly string[], io: CliIo): Promise<number> {
  const [command, ...rest] = argv
  if (command === undefined) {
    io.err(USAGE)
    return EXIT.USAGE
  }
  if (command === 'help' || command === '--help' || command === '-h') {
    io.out(USAGE)
    return EXIT.OK
  }
  const spec = COMMANDS[command]
  if (!spec) {
    io.err(`error[USAGE]: unknown command "${command}" (run without arguments for usage)`)
    return EXIT.USAGE
  }
  try {
    const flags = parseFlags(rest, spec.flags)
    return await spec.handler(flags, io)
  } catch (err) {
    return reportError(err, io)
  }
}

// ---------------------------------------------------------------------------
// entry point (only when executed directly, not when imported by tests)

function invokedAsMain(): boolean {
  const script = process.argv[1]
  if (!script) return false
  try {
    return realpathSync(script) === realpathSync(fileURLToPath(import.meta.url))
  } catch {
    return false
  }
}

if (invokedAsMain()) {
  runCli(process.argv.slice(2), {
    out: (line) => process.stdout.write(`${line}\n`),
    err: (line) => process.stderr.write(`${line}\n`),
  }).then(
    (code) => {
      process.exitCode = code
    },
    (err: unknown) => {
      process.stderr.write(`error[UNEXPECTED]: ${err instanceof Error ? err.message : String(err)}\n`)
      process.exitCode = EXIT.UNEXPECTED
    },
  )
}
