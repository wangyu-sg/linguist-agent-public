import { expect, test } from 'bun:test'
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { spawnSync } from 'node:child_process'

const ROOT = join(import.meta.dir, '..')
const POLICY = join(ROOT, 'docs/architecture/proma-sync-policy.json')

test('Host Seam 冲突只保留 LA 冲突块，并保留上游非冲突改动', () => {
  const fixture = mkdtempSync(join(tmpdir(), 'host-seam-resolution-'))
  const files = [
    'apps/electron/src/main/lib/agent-orchestrator.ts',
    'apps/electron/src/main/lib/agent-collaboration-tools.ts',
    'apps/electron/src/main/lib/adapters/pi-agent-adapter.ts',
    'apps/electron/src/main/ipc.ts',
    'apps/electron/src/preload/index.ts',
    'apps/electron/src/renderer/host/agent-host-extension.tsx',
    'apps/electron/src/renderer/host/app-mode-registry.ts',
    'apps/electron/src/renderer/components/agent/AgentView.tsx',
    'apps/electron/src/renderer/components/app-shell/AppShell.tsx',
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
