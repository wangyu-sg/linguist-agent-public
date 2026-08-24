import { expect, test } from 'bun:test'
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { spawnSync } from 'node:child_process'

const ROOT = join(import.meta.dir, '..')
const POLICY = join(ROOT, 'docs/architecture/proma-sync-policy.json')

test('同步策略登记六种 policy，未知冲突 Fail Closed', () => {
  const policy = JSON.parse(readFileSync(POLICY, 'utf8')) as {
    rules: Array<{ policy: string }>
  }
  expect(new Set(policy.rules.map((rule) => rule.policy))).toEqual(new Set([
    'keep-la',
    'take-upstream',
    'overlay',
    'reapply-host-seam',
    'regenerate',
    'manual',
  ]))

  const result = spawnSync(process.execPath, [
    join(ROOT, 'scripts/resolve-proma-conflicts.mjs'),
    '--dry-run',
    '--file', 'unknown/core-file.ts',
  ], { encoding: 'utf8' })
  expect(result.status).not.toBe(0)
  expect(result.stderr).toContain('UNKNOWN_CONFLICT')
})

test('移除 Main Host Anchor 后验证器以稳定错误码失败', () => {
  const fixture = mkdtempSync(join(tmpdir(), 'host-seam-contract-'))
  const files = [
    'apps/electron/src/main/lib/agent-orchestrator.ts',
    'apps/electron/src/main/lib/agent-collaboration-tools.ts',
    'apps/electron/src/main/lib/adapters/pi-agent-adapter.ts',
    'apps/electron/src/main/ipc.ts',
    'apps/electron/src/preload/index.ts',
  ]
  try {
    for (const file of files) {
      const target = join(fixture, file)
      mkdirSync(dirname(target), { recursive: true })
      cpSync(join(ROOT, file), target)
    }
    const target = join(fixture, files[0])
    writeFileSync(
      target,
      readFileSync(target, 'utf8').replace('// LA-HOST-SEAM: agent-extension', ''),
    )
    const result = spawnSync(process.execPath, [
      join(ROOT, 'scripts/verify-host-seams.mjs'),
      '--root', fixture,
    ], { encoding: 'utf8' })

    expect(result.status).not.toBe(0)
    expect(result.stderr).toContain('HOST_SEAM_ANCHOR_MISSING')
  } finally {
    rmSync(fixture, { recursive: true, force: true })
  }
})

test('Host Seam 冲突只保留 LA 冲突块，并保留上游非冲突改动', () => {
  const fixture = mkdtempSync(join(tmpdir(), 'host-seam-resolution-'))
  const files = [
    'apps/electron/src/main/lib/agent-orchestrator.ts',
    'apps/electron/src/main/lib/agent-collaboration-tools.ts',
    'apps/electron/src/main/lib/adapters/pi-agent-adapter.ts',
    'apps/electron/src/main/ipc.ts',
    'apps/electron/src/preload/index.ts',
    'scripts/verify-host-seams.mjs',
  ]
  const git = (args: string[]) => spawnSync('git', args, { cwd: fixture, encoding: 'utf8' })
  try {
    for (const file of files) {
      const target = join(fixture, file)
      mkdirSync(dirname(target), { recursive: true })
      cpSync(join(ROOT, file), target)
    }
    mkdirSync(join(fixture, 'docs/architecture'), { recursive: true })
    writeFileSync(
      join(fixture, 'docs/architecture/proma-baseline.json'),
      '{"upstream":{"commit":"fixture"}}\n',
    )
    expect(git(['init', '-q', '-b', 'main']).status).toBe(0)
    expect(git(['config', 'user.name', 'Henry Wang']).status).toBe(0)
    expect(git(['config', 'user.email', 'tests@example.com']).status).toBe(0)
    expect(git(['add', '.']).status).toBe(0)
    expect(git(['commit', '-q', '-m', 'base']).status).toBe(0)
    expect(git(['branch', 'upstream']).status).toBe(0)

    const agentPath = join(fixture, files[0])
    const base = readFileSync(agentPath, 'utf8')
    writeFileSync(
      agentPath,
      base.replace(
        '// LA-HOST-SEAM: agent-extension',
        "// LA-HOST-SEAM: agent-extension\nconst syncResolutionFixture = 'ours'",
      ),
    )
    expect(git(['add', files[0]]).status).toBe(0)
    expect(git(['commit', '-q', '-m', 'ours']).status).toBe(0)

    expect(git(['switch', '-q', 'upstream']).status).toBe(0)
    writeFileSync(
      agentPath,
      `${base.replace(
        '// LA-HOST-SEAM: agent-extension',
        "// LA-HOST-SEAM: agent-extension\nconst syncResolutionFixture = 'theirs'",
      )}\n// upstream-preserved\n`,
    )
    expect(git(['add', files[0]]).status).toBe(0)
    expect(git(['commit', '-q', '-m', 'upstream']).status).toBe(0)
    expect(git(['switch', '-q', 'main']).status).toBe(0)
    expect(git(['merge', '--no-commit', 'upstream']).status).not.toBe(0)

    const result = spawnSync(process.execPath, [
      join(ROOT, 'scripts/resolve-proma-conflicts.mjs'),
      '--repo', fixture,
      '--policy', POLICY,
    ], { encoding: 'utf8' })
    expect(result.status, result.stderr).toBe(0)
    const resolved = readFileSync(agentPath, 'utf8')
    expect(resolved).toContain("syncResolutionFixture = 'ours'")
    expect(resolved).not.toContain("syncResolutionFixture = 'theirs'")
    expect(resolved).toContain('// upstream-preserved')
    expect(git(['diff', '--name-only', '--diff-filter=U']).stdout.trim()).toBe('')
  } finally {
    rmSync(fixture, { recursive: true, force: true })
  }
})
