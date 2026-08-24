#!/usr/bin/env node

import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const DEFAULTS = {
  repo: REPO_ROOT,
  baseline: join(REPO_ROOT, 'docs/architecture/proma-baseline.json'),
  ledger: join(REPO_ROOT, 'docs/architecture/proma-touchpoints.json'),
  audit: join(REPO_ROOT, 'docs/architecture/proma-drift-audit.json'),
}

function fail(message) {
  console.error(`PROMA_DRIFT_AUDIT_FAILED: ${message}`)
  process.exit(2)
}

function parseArgs(argv) {
  const options = { ...DEFAULTS }
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    index += 1
    if (!argv[index]) fail(`${arg} 缺少取值`)
    if (arg === '--repo') options.repo = resolve(argv[index])
    else if (arg === '--baseline-file') options.baseline = resolve(argv[index])
    else if (arg === '--ledger') options.ledger = resolve(argv[index])
    else if (arg === '--audit') options.audit = resolve(argv[index])
    else fail(`未知选项：${arg}`)
  }
  return options
}

function readJson(path, label) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'))
  } catch (error) {
    fail(`${label}不可读或不是合法 JSON：${path}（${error.message}）`)
  }
}

function git(repo, args) {
  const result = spawnSync('git', args, { cwd: repo, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
  if (result.status !== 0) fail(`git ${args.join(' ')} 失败：${(result.stderr || result.error?.message || '').trim()}`)
  return result.stdout
}

function matches(file, pattern) {
  const wildcard = pattern.indexOf('**')
  return wildcard === -1 ? file === pattern : file.startsWith(pattern.slice(0, wildcard))
}

function actionFor(classification) {
  return {
    'la-owned': 'keep-la',
    'product-fork': 'keep-la',
    'host-seam': 'reapply-host-seam',
    generated: 'regenerate',
    'cosmetic-drift': 'restore-upstream',
    stale: 'remove-touchpoint',
    accidental: 'manual-review',
  }[classification]
}

function isAllowedNewPath(file, allowedNewPaths) {
  return allowedNewPaths.some((entry) => entry.endsWith('/')
    ? file.startsWith(entry)
    : entry.includes('*')
      ? file.startsWith(entry.slice(0, entry.indexOf('*')))
      : file === entry)
}

function classify(file, rules, touchpoint, allowedNewPaths) {
  const override = rules.overrides.find((entry) => entry.file === file)
  if (override) return override
  for (const rule of rules.rules) {
    if (rule.paths.some((pattern) => matches(file, pattern))) return rule
  }
  if (isAllowedNewPath(file, allowedNewPaths)) {
    return { classification: 'la-owned', reason: '路径属于触点账本登记的 LA 自有范围' }
  }
  if (touchpoint?.kind === 'generated' || ['overlay', 'regenerate'].includes(touchpoint?.mergePolicy)) {
    return { classification: 'generated', reason: touchpoint.reason }
  }
  if (touchpoint?.kind === 'host-seam' || touchpoint?.mergePolicy === 'reapply-host-seam') {
    return { classification: 'host-seam', reason: touchpoint.reason }
  }
  if (touchpoint?.kind === 'product-fork' || touchpoint?.reason?.startsWith('Permanent Product Fork:') || touchpoint?.reason?.startsWith('Local Host Seam:')) {
    return { classification: 'product-fork', reason: touchpoint.reason }
  }
  if (touchpoint?.kind === 'temporary-deviation' || touchpoint?.reason?.startsWith('Temporary Deviation:')) {
    return { classification: 'host-seam', reason: touchpoint.reason }
  }
  return { classification: 'accidental', reason: '差异未命中已登记的 LA 所有权或 Host Seam 规则' }
}

const options = parseArgs(process.argv.slice(2))
const baseline = readJson(options.baseline, '基线文件')
const ledger = readJson(options.ledger, '触点账本')
const rules = readJson(options.audit, 'Drift 审计规则')
const baselineRef = baseline?.upstream?.commit
if (typeof baselineRef !== 'string' || !baselineRef) fail('基线文件缺少 upstream.commit')
if (!Array.isArray(ledger.touchpoints) || !Array.isArray(ledger.allowedNewPaths)) fail('触点账本缺少 touchpoints 或 allowedNewPaths')
if (rules?.schemaVersion !== 1 || !Array.isArray(rules.rules) || !Array.isArray(rules.overrides)) {
  fail('Drift 审计规则必须使用 schemaVersion=1，并提供 rules/overrides')
}

git(options.repo, ['cat-file', '-e', `${baselineRef}^{commit}`])
const changedRows = git(options.repo, ['diff', '--numstat', baselineRef, '--'])
  .split(/\r?\n/)
  .filter(Boolean)
  .map((line) => {
    const [added, deleted, ...parts] = line.split('\t')
    return { file: parts.join('\t'), added: Number(added) || 0, deleted: Number(deleted) || 0 }
  })
const changed = new Set(changedRows.map((row) => row.file))
const touchpoints = new Map(ledger.touchpoints.map((entry) => [entry.file, entry]))
const files = changedRows.map((row) => {
  const classification = classify(row.file, rules, touchpoints.get(row.file), ledger.allowedNewPaths)
  return {
    file: row.file,
    classification: classification.classification,
    runtimeBehaviorChanged: !['cosmetic-drift', 'generated'].includes(classification.classification),
    recommendedAction: actionFor(classification.classification),
    reason: classification.reason,
    changedLines: row.added + row.deleted,
  }
})
for (const touchpoint of ledger.touchpoints) {
  if (!changed.has(touchpoint.file)) {
    files.push({
      file: touchpoint.file,
      classification: 'stale',
      runtimeBehaviorChanged: false,
      recommendedAction: 'remove-touchpoint',
      reason: '账本仍有登记，但当前分支相对 Proma 基线已无差异',
      changedLines: 0,
    })
  }
}
const summary = Object.fromEntries(
  ['la-owned', 'product-fork', 'host-seam', 'generated', 'cosmetic-drift', 'stale', 'accidental']
    .map((classification) => [classification, files.filter((entry) => entry.classification === classification).length]),
)
const highConflictFiles = files
  .filter((entry) => !['la-owned', 'generated', 'stale'].includes(entry.classification))
  .sort((left, right) => right.changedLines - left.changedLines || left.file.localeCompare(right.file))
  .slice(0, 20)
  .map(({ file, classification, changedLines }) => ({ file, classification, changedLines }))

console.log(JSON.stringify({
  schemaVersion: 1,
  baseline: baselineRef,
  head: git(options.repo, ['rev-parse', 'HEAD']).trim(),
  summary,
  highConflictFiles,
  files: files.sort((left, right) => left.file.localeCompare(right.file)),
}, null, 2))
