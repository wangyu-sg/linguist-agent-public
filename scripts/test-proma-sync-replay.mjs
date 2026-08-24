#!/usr/bin/env node

import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const EXPECTED = [
  'README.md',
  'README.en.md',
  'apps/electron/package.json',
  'apps/electron/src/main/lib/agent-orchestrator.ts',
  'apps/electron/src/renderer/components/agent/AgentPlaceholder.tsx',
  'apps/electron/src/renderer/components/agent/AgentView.tsx',
  'apps/electron/src/renderer/components/app-shell/AppShell.tsx',
  'packages/shared/package.json',
  'packages/shared/src/types/feishu.ts',
].sort()

function fail(message) {
  console.error(`SYNC_REPLAY_FAILED: ${message}`)
  process.exit(2)
}

function args(argv) {
  const values = {
    local: '3cfb14ff09baea1c042356b93be2809fb11774c5',
    upstream: '4546c5f7d0fbfa4ed1d58aec63705fc75a9020c2',
  }
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index]
    const value = argv[index + 1]
    if (!value || (key !== '--local' && key !== '--upstream')) fail(`未知或缺值参数：${key}`)
    values[key.slice(2)] = value
  }
  return values
}

function glob(pattern) {
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&')
  return new RegExp(`^${escaped.replaceAll('**', '\0').replaceAll('*', '[^/]*').replaceAll('\0', '.*')}$`)
}

function ruleFor(file, policy) {
  return policy.rules.find((rule) => rule.patterns.some((pattern) => glob(pattern).test(file)))
}

const refs = args(process.argv.slice(2))
const policy = JSON.parse(readFileSync(join(ROOT, 'docs/architecture/proma-sync-policy.json'), 'utf8'))
const temp = mkdtempSync(join(tmpdir(), 'proma-sync-replay-'))
try {
  const clone = spawnSync('git', ['clone', '--quiet', '--no-hardlinks', ROOT, join(temp, 'repo')], {
    encoding: 'utf8',
  })
  if (clone.status !== 0) fail(`临时仓库创建失败：${clone.stderr.trim()}`)
  const merge = spawnSync('git', ['merge-tree', '--write-tree', refs.local, refs.upstream], {
    cwd: join(temp, 'repo'),
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  })
  if (merge.status !== 1) fail(`历史样本应产生冲突，实际退出码 ${merge.status}：${merge.stderr.trim()}`)
  const conflicts = [...new Set(merge.stdout
    .split(/\r?\n/)
    .map((line) => line.match(/^\d{6} [0-9a-f]+ [123]\t(.+)$/)?.[1])
    .filter(Boolean))].sort()
  if (JSON.stringify(conflicts) !== JSON.stringify(EXPECTED)) {
    fail(`历史冲突集合改变：${JSON.stringify(conflicts)}`)
  }
  const files = conflicts.map((file) => {
    const rule = ruleFor(file, policy)
    if (!rule || rule.policy === 'manual') fail(`历史冲突未登记：${file}`)
    if (rule.policy === 'reapply-host-seam' && rule.status !== 'ready') {
      fail(`Host Seam 尚不可重放：${file}`)
    }
    return {
      file,
      policy: rule.policy,
      status: 'deterministic',
    }
  })
  console.log(JSON.stringify({
    local: refs.local,
    upstream: refs.upstream,
    conflicts: files.length,
    deterministic: files.length,
    files,
  }, null, 2))
} finally {
  rmSync(temp, { recursive: true, force: true })
}
