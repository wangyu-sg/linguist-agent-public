/**
 * LA-UPSYNC-001：scripts/proma-sync-impact.mjs 回归测试（node --test）
 *
 * 全部为合成 fixture：临时目录里的迷你 git 仓库 / diff-file / 迷你账本与基线 JSON，
 * 不使用真实客户数据。覆盖：
 * 1. --diff-file 纯文件模式：命中触点正确分组、未命中计数、git 缺失时 stale 降级警告；
 * 2. 迷你 git 仓库全链路：--from/--to git diff、stale 警告触发、--out markdown；
 * 3. fail closed：git 不可用 / ref 不存在 / 账本缺失 / diff-file 缺失 / 缺目标，
 *    全部非零退出且有清晰错误，不静默产出空报告。
 */

import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'

const REPO_ROOT = dirname(dirname(fileURLToPath(import.meta.url)))
const SCRIPT = join(REPO_ROOT, 'scripts/proma-sync-impact.mjs')

function makeTempDir(t) {
  const dir = mkdtempSync(join(tmpdir(), 'proma-sync-impact-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  return dir
}

function runScript(args, options = {}) {
  return spawnSync(process.execPath, [SCRIPT, ...args], {
    encoding: 'utf8',
    env: options.env ?? process.env,
  })
}

function writeJson(path, value) {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`)
}

/** 迷你账本：三条触点分别落在三个分类 */
const FIXTURE_TOUCHPOINTS = [
  { file: 'src/fork.ts', ticket: 'LA-SYNC-005', reason: 'Permanent Product Fork: 合成 fork 原因' },
  { file: 'src/seam.ts', ticket: 'LA-SYNC-004', reason: 'Local Host Seam: 合成 seam 原因' },
  { file: 'src/deviation.ts', ticket: 'LA-SYNC-003', reason: 'Temporary Deviation: 合成 deviation 原因' },
]

function git(repo, args) {
  return execFileSync('git', args, { cwd: repo, encoding: 'utf8' }).trim()
}

/** 造迷你 git 仓库：baseline tag 后，main 改 fork/seam，upstream 分支改 fork/seam/deviation/up */
function makeMiniRepo(t) {
  const repo = makeTempDir(t)
  git(repo, ['init', '-q', '-b', 'main'])
  git(repo, ['config', 'user.name', 'fixture'])
  git(repo, ['config', 'user.email', 'fixture@example.invalid'])
  for (const file of ['fork.ts', 'seam.ts', 'deviation.ts', 'up.ts']) {
    mkdirSync(join(repo, 'src'), { recursive: true })
    writeFileSync(join(repo, 'src', file), `// ${file} v1\n`)
  }
  git(repo, ['add', '.'])
  git(repo, ['commit', '-q', '-m', 'baseline'])
  git(repo, ['tag', 'baseline'])
  const baselineCommit = git(repo, ['rev-parse', 'baseline'])

  // 本仓（main）：只改 fork.ts 与 seam.ts → deviation.ts 成为 stale 登记条目
  for (const file of ['fork.ts', 'seam.ts']) {
    writeFileSync(join(repo, 'src', file), `// ${file} local v2\n`)
  }
  git(repo, ['commit', '-qam', 'local work'])

  // 模拟上游：从 baseline 切分支，改 fork/seam/deviation/up 四个文件
  git(repo, ['checkout', '-q', '-b', 'upstream', 'baseline'])
  for (const file of ['fork.ts', 'seam.ts', 'deviation.ts', 'up.ts']) {
    writeFileSync(join(repo, 'src', file), `// ${file} upstream v2\n`)
  }
  git(repo, ['commit', '-qam', 'upstream work'])
  git(repo, ['tag', 'upstream-v2'])
  git(repo, ['checkout', '-q', 'main'])
  return { repo, baselineCommit }
}

test('diff-file 模式：分组、未命中计数、无 git 时 stale 降级警告', (t) => {
  const dir = makeTempDir(t)
  const ledger = join(dir, 'ledger.json')
  const baselineFile = join(dir, 'baseline.json')
  const diffFile = join(dir, 'upstream.diff')
  writeJson(ledger, { baseline: 'b'.repeat(40), allowedNewPaths: [], touchpoints: FIXTURE_TOUCHPOINTS })
  writeJson(baselineFile, { upstream: { commit: 'a'.repeat(40) } })
  // 上游改了 fork.ts、deviation.ts，外加两个未登记文件
  writeFileSync(diffFile, 'src/fork.ts\nsrc/deviation.ts\nsrc/unknown-a.ts\ndocs/unknown-b.md\n')

  const result = runScript(['--diff-file', diffFile, '--ledger', ledger, '--baseline-file', baselineFile, '--local-repo', dir])
  assert.equal(result.status, 0, result.stderr)
  const out = result.stdout
  // 命中 2 条，按分类排序：Permanent Product Fork 先于 Temporary Deviation
  assert.ok(out.includes('命中登记触点: 2 / 3'))
  const forkIndex = out.indexOf('[Permanent Product Fork]')
  const deviationIndex = out.indexOf('[Temporary Deviation]')
  assert.ok(forkIndex !== -1 && deviationIndex !== -1 && forkIndex < deviationIndex)
  assert.ok(out.includes('- src/fork.ts [LA-SYNC-005]'))
  assert.ok(out.includes('- src/deviation.ts [LA-SYNC-003]'))
  assert.ok(!out.includes('[Local Host Seam]'), '未受影响的分类不应出现')
  // 未命中计数 = 2
  assert.ok(out.includes('未命中触点的上游变更文件: 2'))
  assert.ok(out.includes('- src/unknown-a.ts'))
  // 本仓非 git → stale 检查降级为跳过警告，而不是静默当成无 stale
  assert.ok(out.includes('stale 检查：跳过'))
})

test('迷你 git 仓库全链路：git diff 命中、stale 警告触发、--out markdown', (t) => {
  const { repo, baselineCommit } = makeMiniRepo(t)
  const dir = makeTempDir(t)
  const ledger = join(dir, 'ledger.json')
  const baselineFile = join(dir, 'baseline.json')
  const outFile = join(dir, 'report.md')
  writeJson(ledger, { baseline: baselineCommit, allowedNewPaths: [], touchpoints: FIXTURE_TOUCHPOINTS })
  writeJson(baselineFile, { upstream: { commit: baselineCommit } })

  const result = runScript(['--to', 'upstream-v2', '--repo', repo, '--local-repo', repo, '--ledger', ledger, '--baseline-file', baselineFile, '--out', outFile])
  assert.equal(result.status, 0, result.stderr)
  const out = result.stdout
  // 上游改了 4 个文件，命中 3 条触点，1 条未命中
  assert.ok(out.includes('上游变更文件总数: 4'))
  assert.ok(out.includes('命中登记触点: 3 / 3'))
  assert.ok(out.includes('未命中触点的上游变更文件: 1'))
  // 三个分类齐全且顺序正确
  const forkIndex = out.indexOf('[Permanent Product Fork]')
  const seamIndex = out.indexOf('[Local Host Seam]')
  const deviationIndex = out.indexOf('[Temporary Deviation]')
  assert.ok(forkIndex !== -1 && seamIndex !== -1 && deviationIndex !== -1)
  assert.ok(forkIndex < seamIndex && seamIndex < deviationIndex)
  // deviation.ts 本仓未改（stale）且被上游触及 → 触发受影响 stale 警告
  assert.ok(out.includes('stale 共 1 条'))
  assert.ok(out.includes('警告：1 条受影响触点已 stale'))
  assert.ok(out.includes('- src/deviation.ts [LA-SYNC-003]'))
  // --out 写出 markdown
  assert.ok(existsSync(outFile))
  const md = readFileSync(outFile, 'utf8')
  assert.ok(md.includes('# Proma 上游同步影响报告'))
  assert.ok(md.includes('src/deviation.ts'))
  assert.ok(md.includes('src/up.ts'))
})

test('默认不写任何报告文件', (t) => {
  const dir = makeTempDir(t)
  const ledger = join(dir, 'ledger.json')
  writeJson(ledger, { baseline: 'b'.repeat(40), allowedNewPaths: [], touchpoints: FIXTURE_TOUCHPOINTS })
  const diffFile = join(dir, 'upstream.diff')
  writeFileSync(diffFile, 'src/fork.ts\n')
  const result = runScript(['--diff-file', diffFile, '--ledger', ledger, '--local-repo', dir])
  assert.equal(result.status, 0, result.stderr)
  assert.ok(!existsSync(join(dir, 'report.md')))
})

test('fail closed：git 不可用 / 坏输入全部非零退出且有清晰错误', (t) => {
  const dir = makeTempDir(t)
  const ledger = join(dir, 'ledger.json')
  writeJson(ledger, { baseline: 'b'.repeat(40), allowedNewPaths: [], touchpoints: FIXTURE_TOUCHPOINTS })

  // 1. git 二进制不可用（PATH 清空）→ 非零退出
  const noGit = runScript(['--to', 'upstream-v2', '--repo', dir, '--ledger', ledger], { env: { PATH: join(dir, 'nowhere') } })
  assert.notEqual(noGit.status, 0)
  assert.ok(noGit.stderr.includes('错误'))

  // 2. --repo 指向非 git 目录 → 非零退出
  const notRepo = runScript(['--to', 'upstream-v2', '--repo', dir, '--ledger', ledger])
  assert.notEqual(notRepo.status, 0)
  assert.ok(notRepo.stderr.includes('错误'))

  // 3. --to 引用不存在的 ref（真实 git 仓库）→ 非零退出
  const { repo } = makeMiniRepo(t)
  const badRef = runScript(['--to', 'no-such-ref', '--repo', repo, '--local-repo', repo, '--ledger', ledger])
  assert.notEqual(badRef.status, 0)
  assert.ok(badRef.stderr.includes('错误'))

  // 4. diff-file 不存在 → 非零退出
  const missingDiff = runScript(['--diff-file', join(dir, 'missing.diff'), '--ledger', ledger])
  assert.notEqual(missingDiff.status, 0)
  assert.ok(missingDiff.stderr.includes('diff-file'))

  // 5. 账本不存在 → 非零退出
  const missingLedger = runScript(['--diff-file', join(dir, 'x.diff'), '--ledger', join(dir, 'missing.json')])
  assert.notEqual(missingLedger.status, 0)
  assert.ok(missingLedger.stderr.includes('账本'))

  // 6. 既无 --to 也无 --diff-file → 非零退出
  const noTarget = runScript(['--ledger', ledger])
  assert.notEqual(noTarget.status, 0)
  assert.ok(noTarget.stderr.includes('--to'))
})
