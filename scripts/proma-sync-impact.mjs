#!/usr/bin/env node
/**
 * LA-UPSYNC-001：Proma 上游同步影响报告（本地 Sync Bot，只读 dry-run）
 *
 * 用法：
 *   node scripts/proma-sync-impact.mjs [--from <baselineRef>] --to <ref>
 *   node scripts/proma-sync-impact.mjs [--from <baselineRef>] --diff-file <path>
 *
 * 选项：
 *   --from <ref>          上游基线 ref；默认读 --baseline-file 的 upstream.commit，
 *                         再回落到账本 baseline 字段
 *   --to <ref>            模拟上游目标（tag/commit），与 --diff-file 二选一
 *   --diff-file <path>    直接消费 `git diff --name-only` 输出（无网/无上游 remote 时用）
 *   --repo <path>         含上游历史的 git 仓库（默认本仓根目录）
 *   --local-repo <path>   用于 stale 检查的本仓（默认本仓根目录），
 *                         对该仓跑 `git diff --name-only <baseline>...HEAD`
 *   --ledger <path>       触点账本（默认 docs/architecture/proma-touchpoints.json）
 *   --baseline-file <p>   基线 JSON（默认 docs/architecture/proma-baseline.json）
 *   --out <path>          额外写出 markdown 报告（默认只打 stdout，不写 docs/）
 *
 * 输出：
 *   1. 受影响触点清单，按分类分组（Permanent Product Fork > Local Host Seam > 其他）；
 *   2. 未命中触点的上游变更文件计数；
 *   3. 受影响但已 stale 的登记条目警告（本仓相对基线不再修改，可退役）。
 *
 * 数据完整性 fail closed：diff 来源不可用（git 缺失、ref 不存在、账本/基线/diff-file
 * 不可读）时非零退出并打印明确错误，绝不静默产出空报告。stale 辅助检查在 git 不可用
 * 时降级为「跳过 + 警告」，与 tests/upstream-boundary.test.ts 的 skip 语义一致。
 *
 * 本脚本不写上游仓库、不发布任何产物。
 */
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const DEFAULT_LEDGER = join(REPO_ROOT, 'docs/architecture/proma-touchpoints.json')
const DEFAULT_BASELINE_FILE = join(REPO_ROOT, 'docs/architecture/proma-baseline.json')

const TOUCHPOINT_KIND_LABELS = {
  'product-fork': 'Permanent Product Fork',
  'host-seam': 'Local Host Seam',
  'temporary-deviation': 'Temporary Deviation',
  generated: 'Generated / Overlay',
}
const TOUCHPOINT_KIND_ORDER = Object.keys(TOUCHPOINT_KIND_LABELS)

function fail(message) {
  console.error(`[proma-sync-impact] 错误：${message}`)
  process.exit(2)
}

function parseArgs(argv) {
  const opts = { repo: REPO_ROOT, localRepo: REPO_ROOT, ledger: DEFAULT_LEDGER, baselineFile: DEFAULT_BASELINE_FILE }
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    const takeValue = () => {
      i += 1
      if (i >= argv.length) fail(`选项 ${arg} 缺少取值`)
      return argv[i]
    }
    switch (arg) {
      case '--from': opts.from = takeValue(); break
      case '--to': opts.to = takeValue(); break
      case '--diff-file': opts.diffFile = takeValue(); break
      case '--repo': opts.repo = takeValue(); break
      case '--local-repo': opts.localRepo = takeValue(); break
      case '--ledger': opts.ledger = takeValue(); break
      case '--baseline-file': opts.baselineFile = takeValue(); break
      case '--out': opts.out = takeValue(); break
      case '--help': case '-h':
        console.log('用法：node scripts/proma-sync-impact.mjs [--from <ref>] (--to <ref> | --diff-file <path>) [--repo <path>] [--local-repo <path>] [--ledger <path>] [--baseline-file <path>] [--out <path>]')
        process.exit(0)
        break
      default: fail(`未知选项：${arg}`)
    }
  }
  return opts
}

function readJson(path, label) {
  let raw
  try {
    raw = readFileSync(path, 'utf8')
  } catch (error) {
    fail(`${label}不可读：${path}（${error.message}）`)
  }
  try {
    return JSON.parse(raw)
  } catch (error) {
    fail(`${label}不是合法 JSON：${path}（${error.message}）`)
  }
}

/** 账本最小结构校验：fail closed，畸形账本直接退出 */
function loadLedger(path) {
  const ledger = readJson(path, '触点账本')
  if (!Array.isArray(ledger.touchpoints)) fail(`触点账本缺少 touchpoints 数组：${path}`)
  for (const tp of ledger.touchpoints) {
    if (typeof tp?.file !== 'string' || tp.file.length === 0) fail(`触点账本存在缺 file 的条目：${path}`)
    if (typeof tp?.ticket !== 'string' || typeof tp?.reason !== 'string') fail(`触点账本条目缺 ticket/reason：${tp.file}`)
    if (!Object.hasOwn(TOUCHPOINT_KIND_LABELS, tp.kind)) fail(`触点账本条目 kind 无效：${tp.file}`)
  }
  return ledger
}

/** 解析基线：--from 优先，其次 baseline-file upstream.commit，最后账本 baseline */
function resolveBaseline(opts, ledger) {
  if (opts.from) return opts.from
  if (existsSync(opts.baselineFile)) {
    const baseline = readJson(opts.baselineFile, '基线文件')
    if (typeof baseline?.upstream?.commit === 'string' && baseline.upstream.commit.length > 0) {
      return baseline.upstream.commit
    }
  }
  if (typeof ledger.baseline === 'string' && ledger.baseline.length > 0) return ledger.baseline
  fail('无法确定基线 ref：请用 --from 显式指定，或提供含 upstream.commit 的 --baseline-file')
}

function parseNameOnly(text) {
  return text.split(/\r?\n/).map((line) => line.trim()).filter((line) => line.length > 0)
}

/** 返回 { ok, files?, error? }；git 缺失或 ref 不存在都算失败 */
function gitDiffNameOnly(repo, range) {
  const result = spawnSync('git', ['diff', '--name-only', range], {
    cwd: repo,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  })
  if (result.error) return { ok: false, error: `无法执行 git：${result.error.message}` }
  if (result.status !== 0) {
    const detail = (result.stderr || '').trim()
    return { ok: false, error: `git diff --name-only ${range} 失败（退出码 ${result.status}）${detail ? `：${detail}` : ''}` }
  }
  return { ok: true, files: parseNameOnly(result.stdout) }
}

/** 上游变更集合：--diff-file 直读，否则 git diff <from>...<to> */
function loadUpstreamChanges(opts, baseline) {
  if (opts.diffFile) {
    let raw
    try {
      raw = readFileSync(opts.diffFile, 'utf8')
    } catch (error) {
      fail(`diff-file 不可读：${opts.diffFile}（${error.message}）`)
    }
    return { files: parseNameOnly(raw), source: `diff-file ${opts.diffFile}` }
  }
  if (!opts.to) fail('缺少上游目标：请提供 --to <ref> 或 --diff-file <path>')
  if (!existsSync(opts.repo)) fail(`上游仓库路径不存在：${opts.repo}`)
  const result = gitDiffNameOnly(opts.repo, `${baseline}...${opts.to}`)
  if (!result.ok) fail(`无法计算上游变更（fail closed，不产出空报告）：${result.error}`)
  return { files: result.files, source: `${opts.repo}: ${baseline}...${opts.to}` }
}

/** stale 检查：本仓相对基线的改动集合；git 不可用时降级为 unknown（不静默当成无 stale） */
function loadLocalChanges(localRepo, baseline) {
  if (!existsSync(localRepo)) return { status: 'unknown', reason: `本仓路径不存在：${localRepo}` }
  const result = gitDiffNameOnly(localRepo, `${baseline}...HEAD`)
  if (!result.ok) return { status: 'unknown', reason: result.error }
  return { status: 'ok', files: new Set(result.files) }
}

function compareKind(a, b) {
  return TOUCHPOINT_KIND_ORDER.indexOf(a) - TOUCHPOINT_KIND_ORDER.indexOf(b)
}

function buildReport({ baseline, upstream, ledgerPath, ledger, local }) {
  const touchpointByFile = new Map()
  for (const tp of ledger.touchpoints) {
    if (!touchpointByFile.has(tp.file)) touchpointByFile.set(tp.file, tp)
  }
  const changedSet = new Set(upstream.files)

  const affected = []
  for (const file of changedSet) {
    const tp = touchpointByFile.get(file)
    if (tp) affected.push(tp)
  }
  const unhit = upstream.files.filter((file) => !touchpointByFile.has(file))

  const groups = new Map()
  for (const tp of affected) {
    if (!groups.has(tp.kind)) groups.set(tp.kind, [])
    groups.get(tp.kind).push(tp)
  }
  const orderedGroups = [...groups.entries()].sort(([a], [b]) => compareKind(a, b))

  let stale = []
  let affectedStale = []
  if (local.status === 'ok') {
    stale = ledger.touchpoints.filter((tp) => !local.files.has(tp.file))
    const staleFiles = new Set(stale.map((tp) => tp.file))
    affectedStale = affected.filter((tp) => staleFiles.has(tp.file))
  }

  return {
    baseline,
    source: upstream.source,
    ledgerPath,
    totalChanged: upstream.files.length,
    totalTouchpoints: ledger.touchpoints.length,
    affectedCount: affected.length,
    orderedGroups,
    unhit,
    local,
    stale,
    affectedStale,
  }
}

const UNHIT_STDOUT_LIMIT = 50

function renderStdout(report) {
  const lines = []
  lines.push('Proma 上游同步影响报告（LA-UPSYNC-001，只读）')
  lines.push(`基线: ${report.baseline}`)
  lines.push(`上游变更来源: ${report.source}`)
  lines.push(`触点账本: ${report.ledgerPath}`)
  lines.push('')
  lines.push(`上游变更文件总数: ${report.totalChanged}`)
  lines.push(`命中登记触点: ${report.affectedCount} / ${report.totalTouchpoints}`)
  lines.push('')
  if (report.orderedGroups.length === 0) {
    lines.push('受影响触点：无（本次上游变更不触及任何登记 seam/fork）')
  } else {
    lines.push('受影响触点（按分类，严重度从高到低）:')
    for (const [kind, items] of report.orderedGroups) {
      const classification = TOUCHPOINT_KIND_LABELS[kind]
      lines.push(`  [${classification}] ${items.length} 条`)
      for (const tp of items) lines.push(`    - ${tp.file} [${tp.ticket}]`)
    }
  }
  lines.push('')
  lines.push(`未命中触点的上游变更文件: ${report.unhit.length}`)
  for (const file of report.unhit.slice(0, UNHIT_STDOUT_LIMIT)) lines.push(`  - ${file}`)
  if (report.unhit.length > UNHIT_STDOUT_LIMIT) lines.push(`  … 另有 ${report.unhit.length - UNHIT_STDOUT_LIMIT} 条未列出（见 --out 报告）`)
  lines.push('')
  if (report.local.status !== 'ok') {
    lines.push(`stale 检查：跳过（${report.local.reason}）`)
  } else {
    lines.push(`stale 检查：本仓相对基线改动 ${report.local.files.size} 个文件；登记条目中 stale 共 ${report.stale.length} 条`)
    if (report.affectedStale.length > 0) {
      lines.push(`警告：${report.affectedStale.length} 条受影响触点已 stale（本仓相对基线不再修改，可退役登记或复核原因）:`)
      for (const tp of report.affectedStale) lines.push(`  - ${tp.file} [${tp.ticket}]`)
    }
  }
  return lines.join('\n')
}

function renderMarkdown(report) {
  const lines = []
  lines.push('# Proma 上游同步影响报告（LA-UPSYNC-001）')
  lines.push('')
  lines.push(`- 基线: \`${report.baseline}\``)
  lines.push(`- 上游变更来源: \`${report.source}\``)
  lines.push(`- 触点账本: \`${report.ledgerPath}\``)
  lines.push(`- 生成时间: ${new Date().toISOString()}`)
  lines.push('')
  lines.push('## 概览')
  lines.push('')
  lines.push(`- 上游变更文件总数: ${report.totalChanged}`)
  lines.push(`- 命中登记触点: ${report.affectedCount} / ${report.totalTouchpoints}`)
  lines.push(`- 未命中触点的上游变更文件: ${report.unhit.length}`)
  lines.push('')
  lines.push('## 受影响触点（按分类分组）')
  lines.push('')
  if (report.orderedGroups.length === 0) {
    lines.push('无。')
  } else {
    for (const [kind, items] of report.orderedGroups) {
      const classification = TOUCHPOINT_KIND_LABELS[kind]
      lines.push(`### ${classification}（${items.length} 条）`)
      lines.push('')
      for (const tp of items) lines.push(`- \`${tp.file}\` [${tp.ticket}] ${tp.reason}`)
      lines.push('')
    }
  }
  lines.push('## 未命中触点的上游变更文件')
  lines.push('')
  if (report.unhit.length === 0) lines.push('无。')
  for (const file of report.unhit) lines.push(`- \`${file}\``)
  lines.push('')
  lines.push('## stale 检查')
  lines.push('')
  if (report.local.status !== 'ok') {
    lines.push(`跳过：${report.local.reason}`)
  } else {
    lines.push(`登记条目中 stale 共 ${report.stale.length} 条；其中受本次上游变更影响 ${report.affectedStale.length} 条。`)
    for (const tp of report.affectedStale) lines.push(`- ⚠️ \`${tp.file}\` [${tp.ticket}]（受影响且已 stale，可退役登记或复核原因）`)
  }
  lines.push('')
  return lines.join('\n')
}

const opts = parseArgs(process.argv.slice(2))
const ledger = loadLedger(opts.ledger)
const baseline = resolveBaseline(opts, ledger)
const upstream = loadUpstreamChanges(opts, baseline)
const local = loadLocalChanges(opts.localRepo, baseline)
const report = buildReport({ baseline, upstream, ledgerPath: opts.ledger, ledger, local })

console.log(renderStdout(report))
if (opts.out) {
  try {
    mkdirSync(dirname(resolve(opts.out)), { recursive: true })
    writeFileSync(opts.out, `${renderMarkdown(report)}\n`)
    console.log(`\nmarkdown 报告已写出：${opts.out}`)
  } catch (error) {
    fail(`无法写出 --out 报告：${opts.out}（${error.message}）`)
  }
}
