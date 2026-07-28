/**
 * linguist-legacy-scan CLI (PB-090 read-only scanner) + linguist-legacy-import
 * (PB-091 importer, PB-092 disposition, PB-093 chat transcript). The scanner
 * reads a COPY of a legacy runtime root (<root>/data/...); the importer reads
 * that copy and writes a NEW project into --target-root. Neither starts the
 * legacy cat-server, neither writes to the scanned tree; SQLite is always
 * opened read-only.
 *
 * Runs under Node (node:sqlite — bun cannot run it), same runner flags as
 * this package's test script:
 *
 *   cd packages/linguist-legacy-migration
 *   node --experimental-transform-types --import ./test/register-ts-loader.mjs src/cli.ts scan --root <dir> [--json]
 *   node --experimental-transform-types --import ./test/register-ts-loader.mjs src/cli.ts import --root <dir> --project <id> --target-root <dir> [--dry-run]
 *
 * (`bun run cli -- ...` from the same directory is a shorthand for the exact
 * line above — it still spawns node.)
 *
 * Commands:
 *   scan   --root <dir> [--json] [--now ISO]
 *   import --root <dir> --project <id> --target-root <dir>
 *          [--name X] [--workspace-id ID] [--seed S] [--now ISO]
 *          [--external-source=copy|reference] [--salvage-orphan]
 *          [--dry-run] [--json]
 *
 * Output conventions: stdout carries `key: value` summary lines plus one
 * JSON object per line; --json prints the whole report as one JSON document.
 * Errors go to stderr as `error[<CODE>]: <message>`.
 *
 * Exit codes: 0 ok; 1 unexpected; 2 usage error; 3 scan root / legacy project
 * not found; 4 import target conflict (derived project already exists);
 * 5 legacy data error / import refused (quarantined) / store write failed
 * (report.disposition = quarantined | error; the full report still prints
 * to stdout).
 */

import { realpathSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { StoreProjectExistsError } from '@linguist/cat-store'
import { LegacyProjectNotFoundError } from './extract'
import { ImportDataError, importLegacyProject } from './import'
import { renderJson, renderText } from './report'
import { renderImportJson, renderImportText } from './report-import'
import { ScanRootError, scanLegacyRoot } from './scan'

export const EXIT = {
  OK: 0,
  UNEXPECTED: 1,
  USAGE: 2,
  NOT_FOUND: 3,
  CONFLICT: 4,
  DATA: 5,
} as const

export interface CliIo {
  out: (line: string) => void
  err: (line: string) => void
}

const USAGE = `linguist-legacy-scan/import CLI (PB-090 scanner + PB-091 importer + PB-092 disposition; runs under node)

Usage: node --experimental-transform-types --import ./test/register-ts-loader.mjs src/cli.ts <command> [flags]

Commands:
  scan   --root <dir> [--json] [--now ISO]
  import --root <dir> --project <id> --target-root <dir>
         [--name X] [--workspace-id ID] [--seed S] [--now ISO]
         [--external-source=copy|reference] [--salvage-orphan]
         [--dry-run] [--json]

--root points at a COPY of a legacy runtime root (the directory containing
data/); it is never modified. import writes ONLY into --target-root (new
linguist root): project + assets/segments/TM/TB/QA via the store API, archive
artifacts (proposals raw JSON, quality_decision_ledger.jsonl, exports/,
chat.json, the PB-093 read-only chat transcript legacy-archive/chat/
transcript.md, _pi_sessions/*.jsonl byte-verbatim under legacy-archive/chat/
pi-sessions/) and the rollback sidecar projects/<newId>/legacy-import.json.
--dry-run writes nothing. --workspace-id defaults to legacy-<projectId>;
--seed overrides the deterministic project-id entropy (default
sha256("legacy\\0"+projectId)).
--external-source=copy (default) reads external source bytes when the file
still exists; =reference never reads external bytes (managed uploads ->
blob-store -> lost chain) and records the external root in the sidecar.
Orphan projects (manifest missing/unparseable) are QUARANTINED by default:
nothing is written, the full report prints, exit 5; --salvage-orphan imports
them using the batch-payload language pair and the directory name. A project
id with a SQLite/read-cache manifest projection but no project directory is
always quarantined (evidence in refusal.evidence).
Exit codes: 0 ok, 1 unexpected, 2 usage, 3 not found, 4 target conflict,
5 legacy data error / quarantined / store write failed.`

class UsageError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'UsageError'
  }
}

// ---------------------------------------------------------------------------
// flag parsing (strict whitelist; booleanFlags take no value)

function parseFlags(argv: readonly string[], allowed: readonly string[], booleanFlags: readonly string[] = []): Map<string, string> {
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
      if (booleanFlags.includes(name)) {
        value = 'true'
      } else {
        const next = argv[i + 1]
        if (next === undefined) {
          throw new UsageError(`flag --${name} needs a value (use --${name}= for an empty one)`)
        }
        value = next
        i++
      }
    }
    if (!allowed.includes(name)) throw new UsageError(`unknown flag --${name} for this command`)
    if (booleanFlags.includes(name) && value !== 'true' && value !== 'false') {
      throw new UsageError(`flag --${name} is boolean (use --${name} or --${name}=true|false)`)
    }
    flags.set(name, value)
  }
  return flags
}

function requiredNonEmpty(flags: Map<string, string>, name: string): string {
  const value = flags.get(name)
  if (value === undefined) throw new UsageError(`missing required flag --${name}`)
  if (value === '') throw new UsageError(`flag --${name} must not be empty`)
  return value
}

// ---------------------------------------------------------------------------
// commands

function cmdScan(flags: Map<string, string>, io: CliIo): number {
  const root = requiredNonEmpty(flags, 'root')
  const now = flags.get('now')
  const report = scanLegacyRoot({ root, ...(now !== undefined ? { now: () => now } : {}) })
  if (flags.get('json') === 'true') {
    io.out(renderJson(report))
  } else {
    for (const line of renderText(report)) io.out(line)
  }
  return EXIT.OK
}

function cmdImport(flags: Map<string, string>, io: CliIo): number {
  const root = requiredNonEmpty(flags, 'root')
  const projectId = requiredNonEmpty(flags, 'project')
  const targetRoot = requiredNonEmpty(flags, 'target-root')
  const now = flags.get('now')
  const name = flags.get('name')
  const workspaceId = flags.get('workspace-id')
  const seed = flags.get('seed')
  const externalSource = flags.get('external-source') ?? 'copy'
  if (externalSource !== 'copy' && externalSource !== 'reference') {
    throw new UsageError(`--external-source must be copy or reference, got ${JSON.stringify(externalSource)}`)
  }
  const report = importLegacyProject({
    root,
    projectId,
    targetRoot,
    ...(name !== undefined ? { name } : {}),
    ...(workspaceId !== undefined ? { workspaceId } : {}),
    ...(seed !== undefined ? { seed } : {}),
    ...(now !== undefined ? { now: () => now } : {}),
    dryRun: flags.get('dry-run') === 'true',
    externalSource,
    salvageOrphan: flags.get('salvage-orphan') === 'true',
  })
  if (flags.get('json') === 'true') {
    io.out(renderImportJson(report))
  } else {
    for (const line of renderImportText(report)) io.out(line)
  }
  if (report.targetConflict) return EXIT.CONFLICT
  // quarantine refusal / mid-flight store failure: full report on stdout, exit 5
  if (report.disposition === 'quarantined' || report.disposition === 'error') return EXIT.DATA
  return EXIT.OK
}

// ---------------------------------------------------------------------------
// dispatch

interface CommandSpec {
  flags: readonly string[]
  booleanFlags?: readonly string[]
  handler: (flags: Map<string, string>, io: CliIo) => number
}

const COMMANDS: Record<string, CommandSpec> = {
  scan: { flags: ['root', 'json', 'now'], booleanFlags: ['json'], handler: cmdScan },
  import: {
    flags: ['root', 'project', 'target-root', 'name', 'workspace-id', 'seed', 'now', 'dry-run', 'json', 'external-source', 'salvage-orphan'],
    booleanFlags: ['dry-run', 'json', 'salvage-orphan'],
    handler: cmdImport,
  },
}

function reportError(err: unknown, io: CliIo): number {
  if (err instanceof UsageError) {
    io.err(`error[USAGE]: ${err.message}`)
    return EXIT.USAGE
  }
  if (err instanceof ScanRootError || err instanceof LegacyProjectNotFoundError) {
    io.err(`error[${err.code}]: ${err.message}`)
    return EXIT.NOT_FOUND
  }
  if (err instanceof StoreProjectExistsError) {
    io.err(`error[${err.code}]: ${err.message} (idempotent import: the derived project id already exists in --target-root; nothing was written)`)
    return EXIT.CONFLICT
  }
  if (err instanceof ImportDataError) {
    io.err(`error[${err.code}]: ${err.message}`)
    return EXIT.DATA
  }
  io.err(`error[UNEXPECTED]: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}`)
  return EXIT.UNEXPECTED
}

export function runCli(argv: readonly string[], io: CliIo): number {
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
    const flags = parseFlags(rest, spec.flags, spec.booleanFlags ?? [])
    return spec.handler(flags, io)
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
  try {
    process.exitCode = runCli(process.argv.slice(2), {
      out: (line) => process.stdout.write(`${line}\n`),
      err: (line) => process.stderr.write(`${line}\n`),
    })
  } catch (err) {
    process.stderr.write(`error[UNEXPECTED]: ${err instanceof Error ? err.message : String(err)}\n`)
    process.exitCode = EXIT.UNEXPECTED
  }
}
