/** 真实 packaged 窗口导航；空临时项目，无模型请求或真实用户数据。 */
import assert from 'node:assert/strict'
import { mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { _electron as electron } from 'playwright-core'
import type { AgentSessionMeta } from '@proma/shared'
import { CURRENT_ONBOARDING_VERSION } from '../../src/types/settings.ts'

const appDir = fileURLToPath(new URL('../../', import.meta.url))
const out = join(appDir, 'out/mac-arm64')
const bundles = readdirSync(out).filter(name => name.endsWith('.app'))
assert.equal(bundles.length, 1)
const home = mkdtempSync(join(tmpdir(), 'la-project-switch-'))
const app = await electron.launch({
  executablePath: resolve(out, bundles[0]!, 'Contents/MacOS/Linguist Agent'),
  args: [`--user-data-dir=${join(home, 'chromium')}`],
  env: { ...process.env, HOME: home, LINGUIST_SMOKE_PLAINTEXT_CREDENTIALS: '1' },
  timeout: 60_000,
})
try {
  const deadline = Date.now() + 60_000
  let mainWindow = app.windows().find(window => window.url().endsWith('/dist/renderer/index.html'))
  while (!mainWindow) {
    assert.ok(Date.now() < deadline, '主窗口启动超时')
    await new Promise(resolve => setTimeout(resolve, 100))
    mainWindow = app.windows().find(window => window.url().endsWith('/dist/renderer/index.html'))
  }
  const page = mainWindow
  await page.waitForFunction(() => Boolean(window.electronAPI))
  await page.evaluate(async version => {
    await window.electronAPI.updateSettings({ onboardingCompleted: true, onboardingVersion: version })
  }, CURRENT_ONBOARDING_VERSION)
  const fixture = await page.evaluate(async () => {
    const api = window.electronAPI
    const a = await api.createAgentWorkspace({ name: 'Switch A' })
    const b = await api.createAgentWorkspace({ name: 'Switch B' })
    await api.createAgentSession('A older', undefined, a.id)
    const latest = await api.createAgentSession('A latest', undefined, a.id)
    await api.updateSettings({ agentWorkspaceId: a.id })
    return { a, b, latest }
  })
  await page.reload()
  await page.getByRole('tab', { name: 'Agent', exact: true }).click()
  await page.getByRole('button', { name: '收起侧边栏', exact: true }).click()

  async function select(name: string): Promise<void> {
    await page.getByRole('button', { name: '切换到 Agent 模式（悬停查看项目）', exact: true }).hover()
    await page.getByRole('button', { name, exact: true }).click()
  }
  async function verify(workspaceId: string, expectedTitle?: string): Promise<string> {
    const deadline = Date.now() + 15_000
    let session: AgentSessionMeta | null = null
    while (!session) {
      assert.ok(Date.now() < deadline, '目标 Workspace / Session / Tab 尚未一致落盘')
      session = await page.evaluate(async ({ id, title }) => {
        const api = window.electronAPI
        const settings = await api.getSettings()
        const tab = settings.tabState?.tabs.find(item => item.id === settings.tabState?.activeTabId)
        if (tab?.type !== 'agent') return null
        const session = (await api.listAgentSessions()).find(item => item.id === tab.sessionId)
        return settings.agentWorkspaceId === id && session?.workspaceId === id && !session.isDraft && (!title || session.title === title) ? session : null
      }, { id: workspaceId, title: expectedTitle })
      if (!session) await new Promise(resolve => setTimeout(resolve, 100))
    }
    if (expectedTitle) assert.equal(session.title, expectedTitle)
    await page.locator('[data-agent-presentation="full"]').getByRole('button', { name: `会话菜单：${session.title}`, exact: true }).waitFor()
    assert.ok((await page.getByRole('button', { name: `打开标签页：${session.title}`, exact: true }).getAttribute('class'))!.includes('app-tab-active'))
    await page.getByRole('button', { name: '切换到 Agent 模式（悬停查看项目）', exact: true }).hover()
    const name = workspaceId === fixture.a.id ? fixture.a.name : fixture.b.name
    assert.ok((await page.getByRole('button', { name, exact: true }).getAttribute('class'))!.includes('shadow-'))
    await page.mouse.move(500, 300)
    return session.id
  }

  await select('Switch A')
  assert.equal(await verify(fixture.a.id, 'A latest'), fixture.latest.id)
  // Renderer 初始化之后创建，要求选择动作重新向主进程取权威列表。
  const fresh = await page.evaluate(async id => window.electronAPI.createAgentSession('A refreshed', undefined, id), fixture.a.id)
  await select('Switch B')
  const createdB = await verify(fixture.b.id)
  assert.notEqual(createdB, fixture.latest.id)
  await select('Switch A')
  assert.equal(await verify(fixture.a.id, 'A refreshed'), fresh.id)
  await select('Switch B')
  await select('Switch A')
  await verify(fixture.a.id, 'A refreshed')
  console.log('PASS：实际侧栏 → 权威 Session → 持久化 Workspace / Tab → 中央 AgentView；空项目创建、列表刷新与 A→B→A 一致。')
  console.log('范围：真实窗口与 IPC；无模型调用。延迟响应与失败注入由独立 Jotai 状态回归覆盖。')
} finally {
  await app.close()
  rmSync(home, { recursive: true, force: true })
}
