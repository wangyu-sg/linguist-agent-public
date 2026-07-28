/**
 * PB-025 end-to-end vertical-slice test: drives the REAL CLI as a
 * subprocess (the documented node invocation, see package.json `cli`
 * script) through create-project -> import -> unmodified export
 * (byte-stability) -> segments -> CAS edit matrix -> locked rejection ->
 * placeholder-breaking edit -> interim QA -> restore -> export -> verify
 * -> tampered verify, for ALL THREE fixture formats (xliff, csv, json) in
 * separate mkdtemp roots. After the CLI run, the project is re-opened
 * in-process (read-only) to assert what actually landed in the store.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { extname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { CatStore } from './store'

const PKG_DIR = fileURLToPath(new URL('../', import.meta.url))
const FIXTURES_DIR = fileURLToPath(new URL('../../../tests/linguist-fixtures/', import.meta.url))
const CLI_ARGS = ['--experimental-transform-types', '--import', './test/register-ts-loader.mjs', 'src/cli.ts']

interface CliResult {
  code: number
  stdout: string[]
  stderr: string
}

function makeClock(): () => string {
  let tick = 0
  return () => `2026-01-01T00:00:${String(tick++).padStart(2, '0')}.000Z`
}

/** Run the CLI as a subprocess; --now is auto-appended (pinned clock). */
function cli(args: string[], clock: () => string): CliResult {
  const result = spawnSync(process.execPath, [...CLI_ARGS, ...args, '--now', clock()], {
    cwd: PKG_DIR,
    encoding: 'utf8',
  })
  return {
    code: result.status ?? -1,
    stdout: result.stdout.split('\n').filter((line) => line !== ''),
    stderr: result.stderr,
  }
}

function cliOk(args: string[], clock: () => string): CliResult {
  const r = cli(args, clock)
  assert.equal(r.code, 0, `cli ${args.join(' ')} failed (exit ${r.code}): ${r.stderr}`)
  return r
}

/** Value of a `key: value` summary line. */
function value(lines: string[], key: string): string {
  const prefix = `${key}: `
  const line = lines.find((l) => l.startsWith(prefix))
  assert.ok(line, `expected "${prefix}" line in output: ${lines.join(' | ')}`)
  return line.slice(prefix.length)
}

function jsonObjects<T>(lines: string[]): T[] {
  return lines.filter((l) => l.startsWith('{')).map((l) => JSON.parse(l) as T)
}

function sha256Hex(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex')
}

interface SegmentLine {
  id: string
  asset: string
  ordinal: number
  key: string | null
  status: string
  locked: boolean
  revision: number
  source: string
  target: string
}

interface FindingLine {
  id: string
  segment: string
  code: string
  severity: string
  status: string
  message: string
}

interface FormatCase {
  name: string
  fixtureFile: string
  formatId: string
  segmentCount: number
  seed: string
  /** Spot-checked segment right after import. */
  spot: { key: string; source: string; target: string; status: string }
  /** Segment exercised through the CAS matrix (must start at revision 0, unlocked). */
  casKey: string
  casTarget1: string
  casTarget2: string
  /** Locked segment rejected on edit (fixture-dependent; json has none). */
  lockedKey?: string
  /** Segment (revision 0, unlocked) used for the placeholder-break/restore cycle. */
  placeholderKey: string
  badTarget: string
  restoredTarget: string
  /** Exact EMPTY_TARGET key set expected at QA run #1. */
  emptyTargetKeys: string[]
  /** Segment count for `segments --status untranslated` right after import. */
  untranslatedCount: number
  /** Open findings expected to persist after QA run #2 (EMPTY_TARGET only). */
  openFindingsAfterRestore: number
  /** Format-specific structural assertions on the final export. */
  assertStructure: (exported: string, fixtureText: string, c: FormatCase) => void
}

const CASES: FormatCase[] = [
  {
    name: 'xliff',
    fixtureFile: 'mini_game_ui.xliff',
    formatId: 'xliff_1_2',
    segmentCount: 7,
    seed: 'pb-025-xliff',
    spot: { key: 'menu.start', source: 'Start Game', target: '开始游戏', status: 'translated' },
    casKey: 'menu.options',
    casTarget1: '选项（改）',
    casTarget2: '选项设置',
    lockedKey: 'legal.copyright',
    placeholderKey: 'hud.score',
    badTarget: '得分',
    restoredTarget: '得分：{score}！',
    emptyTargetKeys: ['player.welcome'],
    untranslatedCount: 1,
    openFindingsAfterRestore: 1,
    assertStructure: (exported, fixtureText, c) => {
      assert.ok(exported.includes('<tool tool-id="LA"'), 'xliff header/tool tag preserved')
      assert.equal(exported.split('<trans-unit').length - 1, c.segmentCount, 'all trans-units present')
      assert.ok(exported.includes('translate="no"'), 'locked unit flag preserved')
      assert.ok(
        exported.includes('按 <g id="1" ctype="bold">Enter</g> 继续'),
        'unedited inline-tag segment byte-preserved',
      )
      assert.ok(exported.includes(c.casTarget2), 'edited target written')
      assert.ok(exported.includes(c.restoredTarget), 'restored placeholder target written')
      assert.ok(fixtureText.includes('<xliff version="1.2"'), 'fixture sanity')
    },
  },
  {
    name: 'csv',
    fixtureFile: 'mini_dialogue.csv',
    formatId: 'csv_rfc4180',
    segmentCount: 8,
    seed: 'pb-025-csv',
    spot: {
      key: 'dlg.guard.gate',
      source: 'Halt! State your business, traveler.',
      target: '站住！说明你的来意，旅人。',
      status: 'translated',
    },
    casKey: 'dlg.arya.shop',
    casTarget1: '本店商品应有尽有，朋友。',
    casTarget2: '小店商品齐全，朋友。',
    lockedKey: 'legal.eula',
    placeholderKey: 'dlg.guard.bribe',
    badTarget: '站住！{who} 说明你的来意。',
    restoredTarget: '贿赂？你好大的胆子！',
    emptyTargetKeys: ['dlg.child.riddle', 'dlg.ghost.whisper'],
    untranslatedCount: 4,
    openFindingsAfterRestore: 2,
    assertStructure: (exported, fixtureText, c) => {
      const exportedLines = exported.split('\n')
      const fixtureLines = fixtureText.split('\n')
      assert.equal(exportedLines[0], fixtureLines[0], 'csv header row byte-preserved')
      const lockedRow = fixtureLines.find((l) => l.startsWith('legal.eula,'))
      assert.ok(lockedRow !== undefined)
      assert.ok(exportedLines.includes(lockedRow), 'locked row byte-preserved')
      assert.equal(exportedLines.length, fixtureLines.length, 'row structure preserved (incl. quoted newline)')
      assert.ok(exported.includes(c.casTarget2), 'edited target written')
      assert.ok(exported.includes(c.restoredTarget), 'restored target written')
    },
  },
  {
    name: 'json',
    fixtureFile: 'mini_items.json',
    formatId: 'json_i18n',
    segmentCount: 8,
    seed: 'pb-025-json',
    spot: { key: 'items.potion.name', source: 'Health Potion', target: '', status: 'untranslated' },
    casKey: 'items.potion.name',
    casTarget1: '生命药水',
    casTarget2: '高级生命药水',
    // mini_items.json has no locked entry; the locked-edit rejection is covered by the xliff/csv legs.
    lockedKey: undefined,
    placeholderKey: 'items.potion.desc',
    badTarget: '恢复生命。"喝吧，旅人！"',
    restoredTarget: '恢复 {count} 点生命。\n"喝吧，旅人！"',
    emptyTargetKeys: ['items.potion.lore', 'items.sword.name', 'items.sword.desc', 'items.sword.flavor', 'ui.equip'],
    untranslatedCount: 8,
    openFindingsAfterRestore: 5,
    assertStructure: (exported, _fixtureText, c) => {
      const parsed = JSON.parse(exported) as {
        items: { potion: { name: string; desc: string; lore: string } }
        ui: { compare_hint: string }
        meta: { version: number; premium_only: boolean; event_end: null }
      }
      assert.deepEqual(parsed.meta, { version: 3, premium_only: false, event_end: null }, 'non-string leaves preserved')
      assert.equal(parsed.items.potion.lore, '晨露酿造，回甘绵长', 'unedited CJK leaf preserved')
      assert.equal(parsed.items.potion.name, c.casTarget2, 'edited leaf holds the translation')
      assert.equal(parsed.items.potion.desc, c.restoredTarget, 'restored leaf written with escapes decoded')
      assert.equal(parsed.ui.compare_hint, '', 'empty-string leaf preserved')
    },
  },
]

function runSlice(c: FormatCase): void {
  const clock = makeClock()
  const rootDir = mkdtempSync(join(tmpdir(), `cat-cli-slice-${c.name}-`))
  const fixturePath = join(FIXTURES_DIR, c.fixtureFile)
  const fixtureBytes = readFileSync(fixturePath)
  const fixtureSha = sha256Hex(fixtureBytes)
  const fixtureText = fixtureBytes.toString('utf8')
  const ext = extname(c.fixtureFile)

  // 1. create-project -------------------------------------------------------
  const created = cliOk(
    ['create-project', '--root', rootDir, '--name', `slice-${c.name}`, '--source', 'en', '--target', 'zh-CN', '--seed', c.seed],
    clock,
  )
  const projectId = value(created.stdout, 'project')
  assert.match(projectId, /^prj-[0-9a-f]{16}$/)
  const projectDir = join(rootDir, 'projects', projectId)
  assert.ok(existsSync(join(projectDir, 'project.json')))
  assert.ok(existsSync(join(projectDir, 'source')))

  // 2. import ---------------------------------------------------------------
  const imported = cliOk(['import', '--root', rootDir, '--project', projectId, '--file', fixturePath], clock)
  assert.equal(value(imported.stdout, 'format'), c.formatId)
  assert.equal(value(imported.stdout, 'segments'), String(c.segmentCount))
  assert.equal(value(imported.stdout, 'source-sha256'), fixtureSha)
  const assetId = value(imported.stdout, 'asset')
  const sourceBlob = value(imported.stdout, 'source-blob')
  const sourceBlobPath = join(projectDir, sourceBlob)
  assert.ok(existsSync(sourceBlobPath), 'original bytes persisted under source/')
  assert.deepEqual(readFileSync(sourceBlobPath), fixtureBytes, 'source blob is byte-identical to the fixture')

  // 3. unmodified export: byte-stable template round-trip -------------------
  const unmodifiedRel = `exports/unmodified${ext}`
  const unmodified = cliOk(
    ['export', '--root', rootDir, '--project', projectId, '--asset', assetId, '--out', unmodifiedRel],
    clock,
  )
  assert.equal(value(unmodified.stdout, 'sha256'), fixtureSha, 'unmodified export is byte-stable')
  assert.deepEqual(readFileSync(join(projectDir, unmodifiedRel)), fixtureBytes)

  // 4. segments --------------------------------------------------------------
  const listed = cliOk(['segments', '--root', rootDir, '--project', projectId], clock)
  const segments = jsonObjects<SegmentLine>(listed.stdout)
  assert.equal(segments.length, c.segmentCount)
  assert.equal(value(listed.stdout, 'segments'), String(c.segmentCount))
  const byKey = new Map(segments.map((s) => [s.key, s]))
  const spot = byKey.get(c.spot.key)
  assert.ok(spot, `spot segment ${c.spot.key} present`)
  assert.equal(spot.source, c.spot.source)
  assert.equal(spot.target, c.spot.target)
  assert.equal(spot.status, c.spot.status)
  assert.equal(spot.revision, 0)
  // --asset and --status filters
  const byAsset = cliOk(['segments', '--root', rootDir, '--project', projectId, '--asset', assetId], clock)
  assert.equal(jsonObjects<SegmentLine>(byAsset.stdout).length, c.segmentCount)
  const untranslated = cliOk(['segments', '--root', rootDir, '--project', projectId, '--status', 'untranslated'], clock)
  assert.equal(jsonObjects<SegmentLine>(untranslated.stdout).length, c.untranslatedCount)

  // 5. CAS matrix on casKey --------------------------------------------------
  const cas = byKey.get(c.casKey)!
  const staleFirst = cli(
    ['edit', '--root', rootDir, '--project', projectId, '--segment', cas.id, '--target', 'x', '--expected-revision', '1'],
    clock,
  )
  assert.equal(staleFirst.code, 4, 'edit with a future expected revision is a conflict')
  assert.ok(staleFirst.stderr.includes('error[REVISION_CONFLICT]'), staleFirst.stderr)
  const edit1 = cliOk(
    ['edit', '--root', rootDir, '--project', projectId, '--segment', cas.id, '--target', c.casTarget1, '--expected-revision', '0'],
    clock,
  )
  assert.equal(value(edit1.stdout, 'revision'), '1')
  assert.equal(value(edit1.stdout, 'status'), 'draft')
  const staleSecond = cli(
    ['edit', '--root', rootDir, '--project', projectId, '--segment', cas.id, '--target', 'x', '--expected-revision', '0'],
    clock,
  )
  assert.equal(staleSecond.code, 4, 'replaying a stale revision is a conflict')
  assert.ok(staleSecond.stderr.includes('error[REVISION_CONFLICT]'), staleSecond.stderr)
  const edit2 = cliOk(
    ['edit', '--root', rootDir, '--project', projectId, '--segment', cas.id, '--target', c.casTarget2, '--expected-revision', '1'],
    clock,
  )
  assert.equal(value(edit2.stdout, 'revision'), '2')

  // 6. locked segment rejection ---------------------------------------------
  if (c.lockedKey !== undefined) {
    const locked = byKey.get(c.lockedKey)!
    assert.equal(locked.locked, true, `${c.lockedKey} imported as locked`)
    const rejected = cli(
      ['edit', '--root', rootDir, '--project', projectId, '--segment', locked.id, '--target', 'x', '--expected-revision', '0'],
      clock,
    )
    assert.equal(rejected.code, 4)
    assert.ok(rejected.stderr.includes('error[SEGMENT_LOCKED]'), rejected.stderr)
  }

  // 7. placeholder-breaking edit, then QA #1 ---------------------------------
  const placeholder = byKey.get(c.placeholderKey)!
  cliOk(
    ['edit', '--root', rootDir, '--project', projectId, '--segment', placeholder.id, '--target', c.badTarget, '--expected-revision', '0'],
    clock,
  )
  const qa1 = cliOk(['qa', '--root', rootDir, '--project', projectId], clock)
  const findings1 = jsonObjects<FindingLine>(qa1.stdout)
  assert.equal(value(qa1.stdout, 'segments-checked'), String(c.segmentCount))
  const keyOf = (segmentId: string): string | null | undefined => segments.find((s) => s.id === segmentId)?.key
  const codesByKey = new Map<string | null | undefined, string[]>()
  for (const f of findings1) {
    const key = keyOf(f.segment)
    codesByKey.set(key, [...(codesByKey.get(key) ?? []), f.code])
  }
  assert.deepEqual(
    findings1.filter((f) => f.code === 'EMPTY_TARGET').map((f) => keyOf(f.segment)).sort(),
    [...c.emptyTargetKeys].sort(),
    'QA finds exactly the planted/remaining empty targets',
  )
  assert.deepEqual(codesByKey.get(c.placeholderKey), ['PLACEHOLDER_MISMATCH'], 'QA catches the broken placeholder')
  for (const f of findings1) {
    // PB-096 五档 severity：EMPTY_TARGET → L1，PLACEHOLDER_MISMATCH → L0
    assert.equal(f.severity, f.code === 'PLACEHOLDER_MISMATCH' ? 'L0' : 'L1')
    assert.equal(f.status, 'open')
  }

  // 8. restore the placeholder, then QA #2 (rerun semantics) ------------------
  cliOk(
    ['edit', '--root', rootDir, '--project', projectId, '--segment', placeholder.id, '--target', c.restoredTarget, '--expected-revision', '1'],
    clock,
  )
  const qa2 = cliOk(['qa', '--root', rootDir, '--project', projectId], clock)
  const findings2 = jsonObjects<FindingLine>(qa2.stdout)
  assert.equal(findings2.filter((f) => f.code === 'PLACEHOLDER_MISMATCH').length, 0, 'rerun clears the fixed mismatch')
  assert.equal(findings2.length, c.emptyTargetKeys.length, 'only the empty-target findings remain')

  // 9. final export ------------------------------------------------------------
  const exported = cliOk(['export', '--root', rootDir, '--project', projectId, '--asset', assetId], clock)
  const exportPath = value(exported.stdout, 'path')
  assert.equal(exportPath, join(projectDir, 'exports', c.fixtureFile))
  assert.equal(value(exported.stdout, 'segments'), String(c.segmentCount))
  const exportedBytes = readFileSync(exportPath)
  assert.equal(value(exported.stdout, 'sha256'), sha256Hex(exportedBytes), 'printed digest matches the file')
  c.assertStructure(exportedBytes.toString('utf8'), fixtureText, c)

  // 10. verify: reimport + compare ---------------------------------------------
  const verified = cliOk(['verify', '--root', rootDir, '--project', projectId, '--asset', assetId, '--export', exportPath], clock)
  assert.ok(verified.stdout.includes('verify: OK'))
  assert.equal(value(verified.stdout, 'segments'), String(c.segmentCount))

  // 11. tampered export must fail verify with exit 6 ----------------------------
  const tamperedPath = join(projectDir, 'exports', `tampered${ext}`)
  const tamperedText = exportedBytes.toString('utf8').replace(c.casTarget2, 'TAMPERED译文')
  assert.notEqual(tamperedText, exportedBytes.toString('utf8'), 'tamper actually changed the file')
  writeFileSync(tamperedPath, tamperedText, 'utf8')
  const tampered = cli(['verify', '--root', rootDir, '--project', projectId, '--asset', assetId, '--export', tamperedPath], clock)
  assert.equal(tampered.code, 6, 'tampered export exits 6')
  assert.ok(tampered.stdout.includes('verify: FAILED'))
  assert.ok(
    tampered.stdout.some((l) => l.startsWith('mismatch: ') && l.includes(c.casKey)),
    `mismatch line names ${c.casKey}: ${tampered.stdout.join(' | ')}`,
  )

  // 12. in-process store assertions (what actually landed) ----------------------
  const store = new CatStore({ rootDir })
  const db = store.openProject(projectId, { readOnly: true })
  try {
    const exportRecords = db.exports.listByProject()
    assert.deepEqual(
      exportRecords.map((r) => r.path).sort(),
      [`exports/${c.fixtureFile}`, `exports/unmodified${ext}`].sort(),
      'both exports recorded in the audit trail',
    )
    const revisions = db.segments.listRevisions(cas.id)
    assert.deepEqual(revisions.map((r) => r.revision), [1, 2])
    assert.deepEqual(revisions.map((r) => r.target), [c.casTarget1, c.casTarget2])
    const openFindings = db.qaFindings.list({ status: 'open' })
    assert.equal(openFindings.length, c.openFindingsAfterRestore)
    assert.equal(db.readAssetSource(assetId) instanceof Uint8Array, true)
  } finally {
    db.close()
  }
}

for (const c of CASES) {
  test(`slice (${c.name}): create -> import -> segments -> CAS edit -> qa -> export -> verify`, () => {
    runSlice(c)
  })
}

test('cli: typed errors carry meaningful exit codes', () => {
  const clock = makeClock()
  const rootDir = mkdtempSync(join(tmpdir(), 'cat-cli-errors-'))

  const unknown = cli(['frobnicate'], clock)
  assert.equal(unknown.code, 2)
  assert.ok(unknown.stderr.includes('error[USAGE]'))

  const missingFlag = cli(['create-project', '--root', rootDir, '--source', 'en', '--target', 'zh-CN'], clock)
  assert.equal(missingFlag.code, 2)
  assert.ok(missingFlag.stderr.includes('--name'))

  const unknownFlag = cli(
    ['create-project', '--root', rootDir, '--name', 'x', '--source', 'en', '--target', 'zh-CN', '--frobnicate', '1'],
    clock,
  )
  assert.equal(unknownFlag.code, 2)
  assert.ok(unknownFlag.stderr.includes('--frobnicate'))

  const created = cliOk(
    ['create-project', '--root', rootDir, '--name', 'errors', '--source', 'en', '--target', 'zh-CN', '--seed', 'pb-025-errors'],
    clock,
  )
  const projectId = value(created.stdout, 'project')

  const missingFile = cli(['import', '--root', rootDir, '--project', projectId, '--file', join(rootDir, 'nope.xliff')], clock)
  assert.equal(missingFile.code, 3)
  assert.ok(missingFile.stderr.includes('error[STORE_NOT_FOUND]'), missingFile.stderr)

  const unsupportedPath = join(rootDir, 'image.png')
  writeFileSync(unsupportedPath, new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x01, 0xff]))
  const unsupported = cli(['import', '--root', rootDir, '--project', projectId, '--file', unsupportedPath], clock)
  assert.equal(unsupported.code, 5)
  assert.ok(unsupported.stderr.includes('error[FORMAT_UNSUPPORTED]'), unsupported.stderr)

  const unknownProject = cli(['segments', '--root', rootDir, '--project', 'prj-0000000000000000'], clock)
  assert.equal(unknownProject.code, 3)
  assert.ok(unknownProject.stderr.includes('error[STORE_NOT_FOUND]'))

  const unknownSegment = cli(
    ['edit', '--root', rootDir, '--project', projectId, '--segment', 'seg-0000000000000000', '--target', 'x', '--expected-revision', '0'],
    clock,
  )
  assert.equal(unknownSegment.code, 4)
  assert.ok(unknownSegment.stderr.includes('error[UNKNOWN_SEGMENT]'), unknownSegment.stderr)

  const badRevision = cli(
    ['edit', '--root', rootDir, '--project', projectId, '--segment', 'seg-0000000000000000', '--target', 'x', '--expected-revision', 'abc'],
    clock,
  )
  assert.equal(badRevision.code, 2)
})
