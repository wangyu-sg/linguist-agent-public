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
    const expand = page.getByRole('button', { name: '展开侧边栏', exact: true })
    if (await expand.isVisible()) await expand.click()
    await page.getByRole('button', { name: `打开项目 ${name}`, exact: true }).click()
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
    assert.equal(await page.getByRole('button', { name: /^打开标签页：/ }).count(), 0, 'Agent 主区不应显示中心会话标签栏')
    const name = workspaceId === fixture.a.id ? fixture.a.name : fixture.b.name
    assert.equal(await page.getByRole('button', { name: `打开项目 ${name}`, exact: true }).getAttribute('aria-current'), 'page')
    await page.mouse.move(500, 300)
    await page.getByRole('button', { name: '收起侧边栏', exact: true }).click()
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
  // Linguist 复用同一个原生窗口：覆盖项目接入造成的布局与导航回归。
  const project = await page.evaluate(async () => {
    const created = await window.electronAPI.linguistProjectsCreate({
      name: '长项目名称用于侧栏与顶栏布局验证 Long Project', sourceLocale: 'zh-CN', targetLocale: 'en-US',
    })
    if (!created.ok) throw new Error(created.error.message)
    const session = await window.electronAPI.linguistSessionsCreateForProject({
      projectId: created.data.id, title: 'Linguist layout', role: 'general',
    })
    if (!session.ok) throw new Error(session.error.message)
    return created.data
  })
  await page.reload()
  await page.getByRole('button', { name: '展开侧边栏', exact: true }).click()
  await page.getByRole('tab', { name: 'Linguist', exact: true }).click()
  const projectButton = page.getByRole('button', { name: `打开项目 ${project.name}`, exact: true })
  await projectButton.click()
  await page.getByRole('button', { name: '会话菜单：Linguist layout', exact: true }).waitFor()
  await app.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows().find(window => window.webContents.getURL().endsWith('/dist/renderer/index.html'))!.setSize(900, 720)
  })
  // 等待原生窗口 resize 与 CSS 过渡落定，再检查真实元素边界。
  await page.waitForTimeout(400)
  const titleBounds = await page.getByRole('button', { name: '会话菜单：Linguist layout', exact: true }).boundingBox()
  const nameBounds = await projectButton.locator('span').filter({ hasText: project.name }).first().boundingBox()
  const roleBounds = await page.getByRole('button', { name: '当前岗位：通用项目 Agent', exact: true }).boundingBox()
  const mainBounds = await page.locator('[data-agent-presentation="full"]').boundingBox()
  assert.ok(titleBounds && titleBounds.width >= 60, '窄主区会话标题不能被徽标挤空')
  assert.ok(nameBounds && nameBounds.width >= 60, '侧栏项目名称不能被额外装饰挤空')
  assert.ok(roleBounds && mainBounds && roleBounds.x + roleBounds.width <= mainBounds.x + mainBounds.width, '岗位菜单不能超出主区')
  await page.getByRole('tab', { name: '文件', exact: true }).click()
  await projectButton.hover()
  await page.getByRole('button', { name: '项目菜单', exact: true }).click()
  await page.getByRole('menuitem', { name: '项目设置', exact: true }).click()
  await page.getByRole('dialog').waitFor()
  await page.keyboard.press('Escape')
  await page.getByRole('button', { name: '折叠右侧工作区', exact: true }).click()
  await page.getByRole('button', { name: '展开右侧工作区', exact: true }).waitFor()
  await page.reload()
  await page.getByRole('button', { name: '会话菜单：Linguist layout', exact: true }).waitFor()
  await page.getByRole('button', { name: '展开右侧工作区', exact: true }).waitFor()
  await page.getByRole('button', { name: '展开右侧工作区', exact: true }).click()
  await page.getByRole('tab', { name: 'CAT', exact: true }).waitFor()
  console.log('PASS：Linguist 窄窗标题与项目名、Files 中打开项目设置、Renderer 冷恢复保持右栏收起、顶栏重新展开。')
  console.log('PASS：实际侧栏 → 权威 Session → 持久化 Workspace / Tab → 中央 AgentView；空项目创建、列表刷新与 A→B→A 一致。')
  console.log('范围：真实窗口与 IPC；无模型调用。延迟响应与失败注入由独立 Jotai 状态回归覆盖。')
} finally {
  await app.close()
  rmSync(home, { recursive: true, force: true })
}
