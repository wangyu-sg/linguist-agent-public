import { expect, test } from 'bun:test'
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { spawnSync } from 'node:child_process'

const ROOT = join(import.meta.dir, '..')
const POLICY = join(ROOT, 'docs/architecture/proma-sync-policy.json')

test('同步影响报告按 touchpoint.kind 分类，不依赖 reason 前缀', () => {
  const fixture = mkdtempSync(join(tmpdir(), 'sync-impact-kind-'))
  try {
    const ledger = join(fixture, 'ledger.json')
    const diff = join(fixture, 'upstream.diff')
    writeFileSync(ledger, JSON.stringify({
      baseline: 'fixture',
      touchpoints: [
        { file: 'src/fork.ts', ticket: 'LA-SYNC-001', kind: 'product-fork', reason: '无前缀理由' },
        { file: 'src/seam.ts', ticket: 'LA-SYNC-002', kind: 'host-seam', reason: '无前缀理由' },
      ],
    }))
    writeFileSync(diff, 'src/fork.ts\nsrc/seam.ts\n')

    const result = spawnSync(process.execPath, [
      join(ROOT, 'scripts/proma-sync-impact.mjs'),
      '--from', 'fixture',
      '--diff-file', diff,
      '--ledger', ledger,
      '--local-repo', fixture,
    ], { encoding: 'utf8' })

    expect(result.status, result.stderr).toBe(0)
    expect(result.stdout).toContain('[Permanent Product Fork] 1 条')
    expect(result.stdout).toContain('[Local Host Seam] 1 条')
  } finally {
    rmSync(fixture, { recursive: true, force: true })
  }
})

test('同步策略只自动保留明确的 LA Skill 与品牌资源', () => {
  const resolve = (file: string) => spawnSync(process.execPath, [
    join(ROOT, 'scripts/resolve-proma-conflicts.mjs'),
    '--repo', ROOT,
    '--policy', POLICY,
    '--dry-run',
    '--file', file,
  ], { encoding: 'utf8' })

  expect(resolve('apps/electron/default-skills/cultural-lqa/SKILL.md').status).toBe(0)
  expect(resolve('apps/electron/default-skills/agent-collaboration/SKILL.md').status).toBe(0)
  expect(resolve('apps/electron/resources/icon.svg').status).toBe(0)
  expect(resolve('apps/electron/src/main/lib/agent-orchestrator.ts').stdout).toContain('"policy": "host-seam"')
  expect(resolve('apps/electron/default-skills/automation/SKILL.md').stderr).toContain('UNKNOWN_CONFLICT')
  expect(resolve('apps/electron/resources/entitlements.mac.plist').stderr).toContain('UNKNOWN_CONFLICT')
})

test('Host Seam 冲突必须 fail closed', () => {
  const fixture = mkdtempSync(join(tmpdir(), 'host-seam-resolution-'))
  const file = 'apps/electron/src/main/lib/agent-orchestrator.ts'
  const git = (args: string[]) => spawnSync('git', args, { cwd: fixture, encoding: 'utf8' })
  try {
    const agentPath = join(fixture, file)
    mkdirSync(dirname(agentPath), { recursive: true })
    cpSync(join(ROOT, file), agentPath)
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

    const base = readFileSync(agentPath, 'utf8')
    writeFileSync(
      agentPath,
      base.replace(
        '// LA-HOST-SEAM: agent-extension',
        "// LA-HOST-SEAM: agent-extension\nconst syncResolutionFixture = 'ours'",
      ),
    )
    expect(git(['add', file]).status).toBe(0)
    expect(git(['commit', '-q', '-m', 'ours']).status).toBe(0)

    expect(git(['switch', '-q', 'upstream']).status).toBe(0)
    writeFileSync(
      agentPath,
      `${base.replace(
        '// LA-HOST-SEAM: agent-extension',
        "// LA-HOST-SEAM: agent-extension\nconst syncResolutionFixture = 'theirs'",
      )}\n// upstream-preserved\n`,
    )
    expect(git(['add', file]).status).toBe(0)
    expect(git(['commit', '-q', '-m', 'upstream']).status).toBe(0)
    expect(git(['switch', '-q', 'main']).status).toBe(0)
    expect(git(['merge', '--no-commit', 'upstream']).status).not.toBe(0)

    const result = spawnSync(process.execPath, [
      join(ROOT, 'scripts/resolve-proma-conflicts.mjs'),
      '--repo', fixture,
      '--policy', POLICY,
    ], { encoding: 'utf8' })
    expect(result.status).not.toBe(0)
    expect(result.stderr).toContain('HOST_SEAM_CONTRACT_CHANGED')
    expect(git(['diff', '--name-only', '--diff-filter=U']).stdout.trim()).toBe(file)
  } finally {
    rmSync(fixture, { recursive: true, force: true })
  }
})

test('同步链生成无冲突且通过 Host Seam 验证的最终树', () => {
  const fixture = mkdtempSync(join(tmpdir(), 'proma-sync-e2e-'))
  const git = (args: string[]) => spawnSync('git', args, { cwd: fixture, encoding: 'utf8' })
  const seamFiles = [
    'apps/electron/src/main/lib/agent-orchestrator.ts',
    'apps/electron/src/main/lib/agent-collaboration-tools.ts',
    'apps/electron/src/main/lib/adapters/pi-builtin-tools.ts',
    'apps/electron/src/main/lib/adapters/pi-agent-adapter.ts',
    'apps/electron/src/main/ipc.ts',
    'apps/electron/src/preload/index.ts',
    'apps/electron/src/renderer/host/agent-host-extension.tsx',
    'apps/electron/src/renderer/host/app-mode-registry.ts',
    'apps/electron/src/renderer/components/agent/AgentView.tsx',
    'apps/electron/src/renderer/components/agent/SidePanel.tsx',
    'apps/electron/src/renderer/components/app-shell/AppShell.tsx',
  ]
  try {
    for (const file of seamFiles) {
      const target = join(fixture, file)
      mkdirSync(dirname(target), { recursive: true })
      cpSync(join(ROOT, file), target)
    }
    mkdirSync(join(fixture, 'apps/electron'), { recursive: true })
    mkdirSync(join(fixture, 'config'), { recursive: true })
    mkdirSync(join(fixture, 'docs/architecture'), { recursive: true })
    writeFileSync(join(fixture, 'README.md'), 'base\n')
    writeFileSync(join(fixture, 'apps/electron/package.json'), `${JSON.stringify({
      name: 'proma-fixture',
      version: '1.0.0',
    }, null, 2)}\n`)
    writeFileSync(join(fixture, 'config/la-electron-overlay.json'), `${JSON.stringify({
      schemaVersion: 1,
      operations: [
        { path: ['name'], expected: 'proma-upstream', value: 'linguist-fixture' },
        { path: ['scripts', 'linguist'], value: 'fixture' },
      ],
    }, null, 2)}\n`)
    writeFileSync(join(fixture, 'docs/architecture/proma-baseline.json'), '{"upstream":{"commit":"fixture"}}\n')

    expect(git(['init', '-q', '-b', 'main']).status).toBe(0)
    expect(git(['config', 'user.name', 'Henry Wang']).status).toBe(0)
    expect(git(['config', 'user.email', 'tests@example.com']).status).toBe(0)
    expect(git(['add', '.']).status).toBe(0)
    expect(git(['commit', '-q', '-m', 'base']).status).toBe(0)
    expect(git(['branch', 'upstream']).status).toBe(0)

    writeFileSync(join(fixture, 'README.md'), 'ours\n')
    expect(git(['add', 'README.md']).status).toBe(0)
    expect(git(['commit', '-q', '-m', 'ours']).status).toBe(0)

    expect(git(['switch', '-q', 'upstream']).status).toBe(0)
    writeFileSync(join(fixture, 'README.md'), 'theirs\n')
    writeFileSync(join(fixture, 'apps/electron/package.json'), `${JSON.stringify({
      name: 'proma-upstream',
      version: '1.1.0',
      upstreamOnly: true,
    }, null, 2)}\n`)
    expect(git(['add', 'README.md', 'apps/electron/package.json']).status).toBe(0)
    expect(git(['commit', '-q', '-m', 'upstream']).status).toBe(0)
    expect(git(['switch', '-q', 'main']).status).toBe(0)
    expect(git(['merge', '--no-commit', 'upstream']).status).not.toBe(0)

    const resolver = spawnSync(process.execPath, [
      join(ROOT, 'scripts/resolve-proma-conflicts.mjs'),
      '--repo', fixture,
      '--policy', POLICY,
    ], { encoding: 'utf8' })
    expect(resolver.status, resolver.stderr).toBe(0)

    const upstreamPackage = join(fixture, 'upstream-package.json')
    writeFileSync(upstreamPackage, git(['show', 'upstream:apps/electron/package.json']).stdout)
    const overlay = spawnSync(process.execPath, [
      join(ROOT, 'scripts/apply-la-electron-overlay.mjs'),
      '--base', upstreamPackage,
      '--overlay', join(fixture, 'config/la-electron-overlay.json'),
      '--output', join(fixture, 'apps/electron/package.json'),
    ], { encoding: 'utf8' })
    expect(overlay.status, overlay.stderr).toBe(0)
    expect(git(['add', 'apps/electron/package.json']).status).toBe(0)

    const verifier = spawnSync(process.execPath, [
      join(ROOT, 'scripts/verify-host-seams.mjs'),
      '--root', fixture,
    ], { encoding: 'utf8' })
    expect(verifier.status, verifier.stderr).toBe(0)
    expect(git(['diff', '--name-only', '--diff-filter=U']).stdout.trim()).toBe('')
    expect(git(['write-tree']).stdout.trim()).toMatch(/^[0-9a-f]{40}$/)
    expect(readFileSync(join(fixture, 'README.md'), 'utf8')).toBe('ours\n')
    expect(JSON.parse(readFileSync(join(fixture, 'apps/electron/package.json'), 'utf8'))).toEqual({
      name: 'linguist-fixture',
      version: '1.1.0',
      upstreamOnly: true,
      scripts: { linguist: 'fixture' },
    })
  } finally {
    rmSync(fixture, { recursive: true, force: true })
  }
})
