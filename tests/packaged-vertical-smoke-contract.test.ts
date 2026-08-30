import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = join(import.meta.dir, '..')

function source(path: string): string {
  return readFileSync(join(ROOT, path), 'utf8')
}

describe('LF-003 Packaged Vertical Smoke 合同', () => {
  test('Given runtime sync replaces app node_modules, When packaging starts, Then native rebuild runs first', () => {
    const manifest = JSON.parse(source('apps/electron/package.json')) as { scripts: Record<string, string> }

    for (const name of ['pack', 'dist', 'dist:mac', 'dist:win', 'dist:linux']) {
      const script = manifest.scripts[name]
      expect(script.indexOf('rebuild:node-pty')).toBeLessThan(script.indexOf('sync:runtime-deps'))
    }
  })

  test('Given a product batch, When smoke starts, Then it builds once and reuses native packaged probes', () => {
    const runner = source('apps/electron/scripts/smoke/run-vertical-smoke.ts')
    const agentProbe = source('apps/electron/scripts/smoke/probe-pi-stream.ts')
    const chatProbe = source('apps/electron/scripts/smoke/run-g0-smoke.ts')
    const fakeServer = source('apps/electron/scripts/smoke/fake-model-server.ts')

    expect(runner).toContain("args: ['run', 'smoke:pack']")
    expect(runner).toContain("if (bun !== 'bun') process.env.PATH = [dirname(bun), process.env.PATH].filter(Boolean).join(delimiter)")
    expect(runner).toContain("args: ['scripts/smoke/probe-pi-stream.ts']")
    expect(runner).toContain("args: ['scripts/smoke/run-g0-smoke.ts']")
    expect(runner).toContain("args: ['scripts/smoke/probe-pb074-e2e.ts']")
    expect(runner.indexOf("id: 'agent'")).toBeLessThan(runner.indexOf("id: 'chat'"))
    expect(runner.indexOf("id: 'chat'")).toBeLessThan(runner.indexOf("id: 'linguist-current'"))
    expect(agentProbe).toContain("args: [`--user-data-dir=${join(tmpHome, '.electron-user-data')}`]")
    // LA-SYNC-007：G1 覆盖 Agent 流式中真实 Stop（stoppedByUser 收敛）与同会话 Retry 后 final
    expect(agentProbe).toContain("'pi-agent-stop-converges'")
    expect(agentProbe).toContain("'pi-agent-retry-final'")
    expect(agentProbe).toContain('stopAgent')
    expect(agentProbe).toContain("'fake-stop-retry'")
    expect(fakeServer).toContain("case 'stop-retry'")
    // LA-SYNC-007：G0 覆盖 Chat → Agent → Chat 模式真实 UI 往返后 Chat 状态不丢
    expect(chatProbe).toContain("'chat-agent-mode-roundtrip'")
    expect(chatProbe).toContain("getByRole('tab', { name: 'Agent', exact: true })")
    const createAndOpen = chatProbe.slice(
      chatProbe.indexOf('async function createAndOpenConversation'),
      chatProbe.indexOf('/** 在 Chat 输入框中输入并回车发送 */'),
    )
    expect(createAndOpen).toContain('await ensureChatMode(page)')
    expect(chatProbe).toContain('button[aria-label="展开侧边栏"]')
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
    // LA-SYNC-007：agent-stop-retry-ui 与 chat-agent-roundtrip 已由 G1/G0 自动化关闭；
    // 仅 native-open-save-dialogs 保持 blocked（真机人工项）
    expect(runner).toContain("id: 'native-open-save-dialogs'")
    expect(runner).not.toContain("id: 'agent-stop-retry-ui'")
    expect(runner).not.toContain("id: 'chat-agent-roundtrip'")
    expect(contract).toContain('`blocked` 不能折算成 `passed`')
    expect(contract).toContain('G-F1 已由当前 packaged vertical 覆盖')
  })
})
