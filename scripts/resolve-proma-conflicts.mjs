#!/usr/bin/env node

import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const DEFAULT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

function fail(code, message) {
  console.error(`${code}: ${message}`)
  process.exit(2)
}

function parseArgs(argv) {
  const options = {
    repo: DEFAULT_ROOT,
    policy: join(DEFAULT_ROOT, 'docs/architecture/proma-sync-policy.json'),
    files: [],
    dryRun: false,
  }
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--dry-run') options.dryRun = true
    else if (arg === '--repo' || arg === '--policy' || arg === '--file') {
      index += 1
      if (!argv[index]) fail('SYNC_POLICY_INVALID', `${arg} 缺少取值`)
      if (arg === '--repo') options.repo = resolve(argv[index])
      else if (arg === '--policy') options.policy = resolve(argv[index])
      else options.files.push(argv[index])
    } else fail('SYNC_POLICY_INVALID', `未知选项：${arg}`)
  }
  return options
}

function readJson(path, label) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'))
  } catch (error) {
    fail('SYNC_POLICY_INVALID', `${label}不可读或不是合法 JSON：${path}（${error.message}）`)
  }
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd,
    encoding: 'utf8',
    input: options.input,
    maxBuffer: 64 * 1024 * 1024,
  })
  if (result.status !== 0 && !options.allowFailure) {
    fail(options.code ?? 'SYNC_RESOLUTION_FAILED', `${command} ${args.join(' ')} 失败：${(result.stderr || result.stdout).trim()}`)
  }
  return result
}

function glob(pattern) {
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&')
  const source = escaped.replaceAll('**', '\0').replaceAll('*', '[^/]*').replaceAll('\0', '.*')
  return new RegExp(`^${source}$`)
}

function resolveRule(file, policy) {
  return policy.rules.find((rule) => rule.patterns.some((pattern) => glob(pattern).test(file)))
}

function git(repo, args, options) {
  return run('git', args, { cwd: repo, ...options })
}

function unresolvedFiles(repo) {
  return git(repo, ['diff', '--name-only', '--diff-filter=U']).stdout
    .split(/\r?\n/)
    .map((file) => file.trim())
    .filter(Boolean)
}

function stages(repo, file) {
  return new Set(git(repo, ['ls-files', '-u', '--', file]).stdout
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => Number(line.match(/\s([123])\t/)?.[1])))
}

function checkoutStage(repo, file, side) {
  const stage = side === 'ours' ? 2 : 3
  if (stages(repo, file).has(stage)) {
    git(repo, ['checkout', `--${side}`, '--', file])
    git(repo, ['add', '--', file])
  } else {
    git(repo, ['rm', '-f', '--', file])
  }
}

function applyOverlay(repo, file) {
  checkoutStage(repo, file, 'theirs')
  const result = run(process.execPath, [
    join(repo, 'scripts/apply-la-electron-overlay.mjs'),
    '--base', join(repo, file),
    '--overlay', join(repo, 'config/la-electron-overlay.json'),
    '--output', join(repo, file),
  ], { cwd: repo, allowFailure: true })
  if (result.status !== 0) fail('OVERLAY_CONFLICT', (result.stderr || result.stdout).trim())
  git(repo, ['add', '--', file])
}

const options = parseArgs(process.argv.slice(2))
const policy = readJson(options.policy, '同步策略')
if (policy?.schemaVersion !== 1 || !Array.isArray(policy.rules)) {
  fail('SYNC_POLICY_INVALID', '同步策略必须使用 schemaVersion=1 并提供 rules')
}
const knownPolicies = new Set(['keep-la', 'take-upstream', 'overlay', 'host-seam', 'regenerate', 'manual'])
for (const rule of policy.rules) {
  if (!Array.isArray(rule.patterns) || !knownPolicies.has(rule.policy)) {
    fail('SYNC_POLICY_INVALID', '每条策略必须提供 patterns 和六种已知 policy 之一')
  }
}
const files = options.files.length > 0 ? options.files : unresolvedFiles(options.repo)
const baselinePath = resolve(options.repo, policy.baselineFile)
const baseline = readJson(baselinePath, 'Proma 基线')?.upstream?.commit
if (typeof baseline !== 'string' || !baseline) fail('SYNC_POLICY_INVALID', 'Proma 基线缺少 upstream.commit')

const results = []
for (const file of files) {
  const rule = resolveRule(file, policy)
  if (!rule || rule.policy === 'manual') fail('UNKNOWN_CONFLICT', `未登记冲突：${file}`)
  results.push({ file, policy: rule.policy, status: options.dryRun ? 'classified' : 'resolved' })
  if (options.dryRun) continue
  if (rule.policy === 'host-seam') {
    fail('HOST_SEAM_CONTRACT_CHANGED', `${file} 的 Host Seam 与上游发生冲突，必须人工复核`)
  }
  if (rule.policy === 'keep-la') checkoutStage(options.repo, file, 'ours')
  else if (rule.policy === 'take-upstream') checkoutStage(options.repo, file, 'theirs')
  else if (rule.policy === 'overlay') applyOverlay(options.repo, file)
  else if (rule.policy === 'regenerate') checkoutStage(options.repo, file, 'ours')
}
console.log(JSON.stringify({ files: results, unresolved: unresolvedFiles(options.repo) }, null, 2))
