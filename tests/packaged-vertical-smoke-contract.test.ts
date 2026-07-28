import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = join(import.meta.dir, '..')

function source(path: string): string {
  return readFileSync(join(ROOT, path), 'utf8')
}

describe('LF-003 Packaged Vertical Smoke 合同', () => {
  test('Given a product batch, When smoke starts, Then it builds once and reuses native packaged probes', () => {
    const runner = source('apps/electron/scripts/smoke/run-vertical-smoke.ts')
    const agentProbe = source('apps/electron/scripts/smoke/probe-pi-stream.ts')

    expect(runner).toContain("args: ['run', 'smoke:pack']")
    expect(runner).toContain("if (bun !== 'bun') process.env.PATH = [dirname(bun), process.env.PATH].filter(Boolean).join(delimiter)")
    expect(runner).toContain("args: ['scripts/smoke/probe-pi-stream.ts']")
    expect(runner).toContain("args: ['scripts/smoke/run-g0-smoke.ts']")
    expect(runner).toContain("args: ['scripts/smoke/probe-pb074-e2e.ts']")
    expect(runner.indexOf("id: 'agent'")).toBeLessThan(runner.indexOf("id: 'chat'"))
    expect(runner.indexOf("id: 'chat'")).toBeLessThan(runner.indexOf("id: 'linguist-current'"))
    expect(agentProbe).toContain("args: [`--user-data-dir=${join(tmpHome, '.electron-user-data')}`]")
  })

  test('Given packaging or a vertical path fails, When the run ends, Then evidence is fail-closed', () => {
    const runner = source('apps/electron/scripts/smoke/run-vertical-smoke.ts')

    expect(runner).toContain('workingTreeDirty')
    expect(runner).toContain('workingTreeStatus')
    expect(runner).toContain("status: 'not_reached'")
    expect(runner).toContain("packResult.status !== 'passed'")
    expect(runner).toContain("step.status === 'failed'")
    expect(runner).toContain('process.exitCode = failed ? 1 : 0')
    expect(runner).toContain('vertical-smoke-report.json')
  })

  test('Given some native and cross-mode cases remain manual, When evidence is written, Then missing coverage stays blocked instead of passed', () => {
    const runner = source('apps/electron/scripts/smoke/run-vertical-smoke.ts')
    const contract = source('docs/roadmap/LF003_PACKAGED_VERTICAL_SMOKE_CONTRACT.md')

    expect(runner).toContain("coverageStatus: 'partial'")
    expect(runner).toContain("status: 'blocked'")
    expect(runner).not.toContain("status: 'skipped'")
    expect(runner).not.toContain("id: 'linguist-workbench'")
    expect(contract).toContain('`blocked` 不能折算成 `passed`')
    expect(contract).toContain('G-F1 已由当前 packaged vertical 覆盖')
  })
})
