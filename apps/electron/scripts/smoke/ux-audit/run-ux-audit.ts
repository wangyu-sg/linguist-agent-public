#!/usr/bin/env node
/**
 * Linguist UX 审计驱动 — dev 模式 Electron + fake model + 临时 HOME。
 *
 * 用途：为 docs/ux/LINGUIST_UX_AUDIT.md 采集真实界面证据。
 * 覆盖：Agent / Chat / Linguist 空状态、项目创建、Workbench、Segment 编辑、
 * 键盘导航、IME 组合输入、Agent Rail、Bottom Dock、角色会话、QA Finding、
 * 交付面板、深/浅主题、窄窗口、200% Zoom。
 * 每个步骤保存截图 + axe-core 违规 + 焦点探针到 out/ux-audit/<ts>/。
 *
 * 前提:
 *   1. `bun run dev:vite` 已在运行（renderer 走 127.0.0.1:5173）；
 *   2. 已执行 build:main / build:agent-runtime / build:preload /
 *      build:native-helpers / build:resources。
 *
 * 运行（必须用 Node，playwright-core 的 ws 握手在 bun 下挂起）：
 *   node scripts/smoke/ux-audit/run-ux-audit.ts
 *
 * 数据安全：全程使用 mkdtemp 临时 HOME 与 --user-data-dir，
 * 不触碰真实 ~/.linguist-agent-dev。
 */

import { _electron as electron, type ElectronApplication, type Locator, type Page } from 'playwright-core'
import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import {
  createWriteStream,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
  type WriteStream,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  startFakeModelServer,
  FAKE_MODEL_IDS,
  MARKERS,
  type FakeModelServer,
} from '../fake-model-server.ts'
import { CURRENT_ONBOARDING_VERSION } from '../../../src/types/settings.ts'

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url))
const APP_DIR = resolve(SCRIPT_DIR, '..', '..', '..')
const REPO_ROOT = resolve(APP_DIR, '..', '..')
const CLI_DIR = join(REPO_ROOT, 'packages', 'linguist-cat-store')
const FIXTURE_XLIFF = join(REPO_ROOT, 'tests', 'linguist-fixtures', 'mini_game_ui.xliff')
const FIXTURE_LOCKED = join(REPO_ROOT, 'tests', 'linguist-fixtures', 'locked_segments.xliff')

const require = createRequire(import.meta.url)
const ELECTRON_BINARY = require('electron') as string
const AXE_SOURCE = readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8')

const PROJECT_NAME = 'UX 审计游戏 UI'

// ===== 类型与结果收集 =====

interface AxeViolation {
  id: string
  impact: string | null
  help: string
  nodes: number
  targets: string[]
}

interface FocusProbe {
  tag: string
  role: string | null
  label: string | null
  text: string | null
}

interface StepRecord {
  name: string
  screenshot: string | null
  axe: AxeViolation[]
  focus: FocusProbe | null
  probes: Record<string, string>
  consoleErrors: string[]
}

const steps: StepRecord[] = []
const consoleErrors: string[] = []
let seq = 0

function sleep(ms: number): Promise<void> {
  return new Promise((resolveSleep) => setTimeout(resolveSleep, ms))
}

async function waitFor(
  fn: () => Promise<boolean>,
  timeoutMs: number,
  intervalMs = 250,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (await fn()) return true
    await sleep(intervalMs)
  }
  return false
}

function runCli(args: readonly string[]): string {
  return execFileSync(
    process.execPath,
    ['--experimental-transform-types', '--import', './test/register-ts-loader.mjs', 'src/cli.ts', ...args],
    { cwd: CLI_DIR, encoding: 'utf8' },
  )
}

function cliField(output: string, key: string): string {
  const line = output.split('\n').find((candidate) => candidate.startsWith(`${key}: `))
  if (line === undefined) throw new Error(`CLI 输出缺少字段 ${key}: ${output}`)
  return line.slice(key.length + 2).trim()
}

// ===== 探针 =====

async function probeFocus(page: Page): Promise<FocusProbe | null> {
  return page.evaluate(() => {
    const el = document.activeElement
    if (!el || el === document.body) return null
    return {
      tag: el.tagName,
      role: el.getAttribute('role'),
      label: el.getAttribute('aria-label'),
      text: el.textContent?.trim().slice(0, 60) ?? null,
    }
  })
}

async function runAxe(page: Page): Promise<AxeViolation[]> {
  try {
    const hasAxe = await page.evaluate(() => 'axe' in window)
    if (!hasAxe) await page.addScriptTag({ content: AXE_SOURCE })
    const violations = await page.evaluate(async () => {
      const axe = (window as unknown as {
        axe: { run: (doc: Document) => Promise<{ violations: Array<{
          id: string
          impact: string | null
          help: string
          nodes: Array<{ target: unknown[] }>
        }> }> }
      }).axe
      const result = await axe.run(document)
      return result.violations.map((violation) => ({
        id: violation.id,
        impact: violation.impact,
        help: violation.help,
        nodes: violation.nodes.length,
        targets: violation.nodes.slice(0, 3).map((node) => String(node.target[0]).slice(0, 140)),
      }))
    })
    return violations
  } catch (error) {
    return [{ id: 'axe-run-failed', impact: null, help: String(error).slice(0, 200), nodes: 0, targets: [] }]
  }
}

async function capture(
  page: Page,
  outDir: string,
  name: string,
  probes: Record<string, string> = {},
): Promise<void> {
  seq += 1
  const fileName = `${String(seq).padStart(2, '0')}-${name}.png`
  let screenshot: string | null = join(outDir, fileName)
  try {
    await page.screenshot({ path: screenshot })
  } catch {
    screenshot = null
  }
  const axe = await runAxe(page)
  const focus = await probeFocus(page)
  steps.push({ name, screenshot: fileName, axe, focus, probes, consoleErrors: [...consoleErrors] })
  consoleErrors.length = 0
  console.log(`[capture] ${fileName} axe=${axe.length} focus=${focus ? `${focus.tag}:${focus.role ?? '-'}` : 'none'}`)
}

// ===== 应用启动 =====

async function waitForVite(): Promise<void> {
  const ok = await waitFor(async () => {
    try {
      const res = await fetch('http://127.0.0.1:5173')
      return res.ok || res.status === 404
    } catch {
      return false
    }
  }, 30_000)
  if (!ok) throw new Error('vite dev server 不可达，请先运行 bun run dev:vite')
}

async function launchDevApp(tmpHome: string, logStream: WriteStream): Promise<{ app: ElectronApplication; page: Page }> {
  // electron.launch 在本机偶发 ws 已连接但 resolve 超时;失败时确保旧进程被杀再重试一次。
  let app: ElectronApplication | undefined
  let lastError: unknown
  for (let attempt = 0; attempt < 2 && app === undefined; attempt++) {
    try {
      app = await electron.launch({
        executablePath: ELECTRON_BINARY,
        args: [`--user-data-dir=${join(tmpHome, '.electron-user-data')}`, '.'],
        cwd: APP_DIR,
        // 与 run-g0-smoke 一致:未签名 dev 二进制访问 macOS Keychain 会弹授权窗,强制明文路径。
        env: { ...process.env, HOME: tmpHome, LINGUIST_SMOKE_PLAINTEXT_CREDENTIALS: '1' },
        timeout: 180_000,
      })
    } catch (error) {
      lastError = error
      console.warn(`[ux-audit] electron.launch 第 ${attempt + 1} 次失败,重试`)
    }
  }
  if (app === undefined) throw lastError
  app.process().stdout?.on('data', (chunk: Buffer) => logStream.write(chunk))
  app.process().stderr?.on('data', (chunk: Buffer) => logStream.write(chunk))

  // 快速任务等辅助窗口也加载 dev URL,必须用 ?window= 查询参数排除,只认主窗口。
  const isMainWindow = (url: string): boolean =>
    url.startsWith('http://127.0.0.1:5173') && !url.includes('window=')
  const page = await waitFor(async () => {
    const found = app.windows().find((win) => isMainWindow(win.url()))
    return found !== undefined
  }, 90_000).then((ok) => {
    if (!ok) throw new Error('未找到 dev 主窗口')
    return app.windows().find((win) => isMainWindow(win.url()))!
  })

  page.on('console', (message) => {
    if (message.type() !== 'error') return
    const text = message.text()
    if (text.includes('[vite]') || text.includes('React DevTools')) return
    consoleErrors.push(text.slice(0, 300))
  })
  page.on('pageerror', (error) => consoleErrors.push(`pageerror: ${String(error).slice(0, 300)}`))

  // vite 冷编译可能耗时数十秒,首轮渲染也可能白屏;等待主界面就绪,
  // 超时则 reload 重试,最终失败时 dump 全部窗口状态便于诊断。
  let mainUiReady = false
  for (let attempt = 0; attempt < 8 && !mainUiReady; attempt++) {
    mainUiReady = await page.getByRole('tablist', { name: '主工作模式' })
      .waitFor({ timeout: 30_000 })
      .then(() => true)
      .catch(() => false)
    if (!mainUiReady) {
      console.warn(`[ux-audit] 主界面未就绪,第 ${attempt + 1} 次 reload`)
      await page.reload().catch(() => undefined)
    }
  }
  if (!mainUiReady) {
    const urls = app.windows().map((win) => win.url())
    const bodyText = await page.evaluate(
      () => document.body?.innerText?.slice(0, 200) ?? '',
    ).catch(() => '(evaluate 失败)')
    console.error(`[ux-audit] 窗口列表: ${JSON.stringify(urls)}`)
    console.error(`[ux-audit] body 前 200 字符: ${bodyText}`)
    throw new Error('主界面多次 reload 后仍未就绪')
  }
  await waitFor(async () =>
    page.evaluate(() => typeof (window as unknown as { electronAPI?: unknown }).electronAPI === 'object'),
    60_000)
  return { app, page }
}

async function selectPrimaryMode(page: Page, label: 'Agent' | 'Chat' | '本地化'): Promise<void> {
  await page.getByRole('tablist', { name: '主工作模式' })
    .getByRole('tab', { name: label, exact: true })
    .click()
  await sleep(400)
}

/**
 * Radix Select 弹出层定位/重渲染期间 option 会失稳或短暂 detach,
 * 用 force 点击跳过稳定性检查,并轮询触发器回显校验选择结果,失败重开重试。
 */
async function selectLanguageOption(
  page: Page,
  dialog: Locator,
  triggerSelector: string,
  optionName: string,
): Promise<void> {
  for (let attempt = 0; attempt < 3; attempt++) {
    await dialog.locator(triggerSelector).click()
    const option = page.getByRole('option', { name: optionName, exact: true })
    await option.waitFor({ timeout: 15_000 })
    await sleep(500)
    // 用实时坐标走真实鼠标路径,避开元素动画/滚动中的稳定性检查。
    const box = await option.boundingBox()
    if (box) {
      await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2)
    } else {
      await option.click({ force: true })
    }
    // 轮询触发器回显,而不是一次性判断(React 回显可能滞后于点击)。
    const selected = await waitFor(
      async () => dialog.locator(triggerSelector)
        .getByText(optionName, { exact: true })
        .isVisible()
        .catch(() => false),
      5_000,
    )
    if (selected) return
    const popoverStillOpen = await option.isVisible().catch(() => false)
    const triggerText = await dialog.locator(triggerSelector).innerText().catch(() => '(读取失败)')
    console.warn(
      `[ux-audit] 语言选择第 ${attempt + 1} 次未生效(popover 仍开=${popoverStillOpen}),` +
      `触发器当前文本: ${triggerText.replace(/\n/g, ' | ')}`,
    )
    await page.keyboard.press('Escape').catch(() => undefined)
  }
  throw new Error(`选择语言失败: ${triggerSelector} → ${optionName}`)
}

// ===== 主流程 =====

async function main(): Promise<void> {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
  const outDir = join(APP_DIR, 'out', 'ux-audit', stamp)
  mkdirSync(outDir, { recursive: true })
  const tmpHome = mkdtempSync(join(tmpdir(), 'proma-ux-audit-home-'))
  const logStream = createWriteStream(join(outDir, 'main-process.log'))
  console.log(` tmp HOME: ${tmpHome}`)
  console.log(` evidence: ${outDir}`)

  await waitForVite()

  let server: FakeModelServer | undefined
  let app: ElectronApplication | undefined

  try {
    server = await startFakeModelServer(0)
    console.log(` fake model server: ${server.baseUrl}`)

    // 预置配置：启动前直接写临时 HOME 的 settings/channels,应用首帧即跳过引导,
    // 不依赖运行时播种 + reload(避免 Onboarding 门禁与编译竞态)。
    // 注意:该环境为未签名 dev 二进制,safeStorage 不可用,apiKey 明文与运行时行为一致。
    const configDir = join(tmpHome, '.linguist-agent-dev')
    mkdirSync(configDir, { recursive: true })
    const channelId = 'ch_ux_audit_fake'
    const now = Date.now()
    writeFileSync(join(configDir, 'channels.json'), JSON.stringify({
      version: 5,
      channels: [{
        id: channelId,
        name: 'fake',
        provider: 'openai',
        baseUrl: server.baseUrl,
        apiKey: 'sk-fake',
        models: [...FAKE_MODEL_IDS].map((id) => ({ id, name: id, enabled: true })),
        enabled: true,
        createdAt: now,
        updatedAt: now,
      }],
    }))
    writeFileSync(join(configDir, 'settings.json'), JSON.stringify({
      onboardingCompleted: true,
      onboardingVersion: CURRENT_ONBOARDING_VERSION,
      themeMode: 'light',
      agentChannelId: channelId,
      agentModelId: 'fake-text',
      // 教程浮层 dismiss 走同一 settings 通道;临时 HOME 每次全新,预置避免污染证据(U-05)。
      tutorialBannerDismissed: true,
    }))

    const launched = await launchDevApp(tmpHome, logStream)
    app = launched.app
    const { page } = launched

    // dev 模式主进程默认 dock DevTools(main/index.ts isDev 分支),实测独占约 555px 视口宽,
    // 会让全部布局证据失真。启动后探测并关闭,使视口与 setSize 请求一致。
    const browserWindow = await app.browserWindow(page)
    const devToolsOpened = await browserWindow.evaluate((win) => win.webContents.isDevToolsOpened())
    if (devToolsOpened) {
      await browserWindow.evaluate((win) => { win.webContents.closeDevTools() })
      await sleep(500)
    }
    console.log(` devtools at launch: ${devToolsOpened}${devToolsOpened ? ' (已关闭)' : ''}`)

    // 初始窗口尺寸(应用启动时会恢复持久化 bounds,可能覆盖 setSize;设完读回校验并重试)
    let cssWidth = 0
    for (let attempt = 0; attempt < 3; attempt++) {
      await browserWindow.evaluate((win) => win.setSize(1440, 900))
      await sleep(800)
      cssWidth = await page.evaluate(() => window.innerWidth)
      if (cssWidth >= 1400) break
      console.warn(`[ux-audit] 视口宽度 ${cssWidth}px 低于预期,重设窗口尺寸(第 ${attempt + 1} 次)`)
    }
    console.log(` viewport: ${cssWidth}x${await page.evaluate(() => window.innerHeight)}`)

    // S01/S02: Agent / Chat 模式
    await selectPrimaryMode(page, 'Agent')
    await capture(page, outDir, 'agent-mode')
    await selectPrimaryMode(page, 'Chat')
    await capture(page, outDir, 'chat-mode')

    // S03: Linguist 空状态
    await selectPrimaryMode(page, '本地化')
    await capture(page, outDir, 'linguist-empty')

    // S04: 新建项目对话框（含焦点探针）
    await page.getByRole('button', { name: '新建项目' }).filter({ hasText: '新建项目' }).first().click()
    const createDialog = page.getByRole('dialog', { name: '新建项目', exact: true })
    await createDialog.waitFor({ timeout: 15_000 })
    const dialogFocus = await probeFocus(page)
    await capture(page, outDir, 'create-project-dialog', {
      dialogInitialFocus: dialogFocus ? `${dialogFocus.tag}:${dialogFocus.label ?? dialogFocus.text ?? ''}` : 'none',
    })

    // 对话框内焦点探针：Escape 后焦点应回到触发按钮
    await createDialog.locator('#project-create-name').fill(PROJECT_NAME)
    await createDialog.locator('#project-create-source')
      .getByText('简体中文（zh-CN）', { exact: true }).waitFor({ timeout: 30_000 })
    await createDialog.locator('#project-create-target')
      .getByText('英语（美国，en-US）', { exact: true }).waitFor({ timeout: 30_000 })
    await selectLanguageOption(page, createDialog, '#project-create-source', '英语（美国，en-US）')
    await selectLanguageOption(page, createDialog, '#project-create-target', '简体中文（zh-CN）')
    await createDialog.getByRole('button', { name: '创建项目', exact: true }).click()
    const openButton = page.getByRole('button', { name: `打开项目 ${PROJECT_NAME}`, exact: true })
    await openButton.waitFor({ timeout: 30_000 })
    const focusAfterCreate = await probeFocus(page)
    await capture(page, outDir, 'project-created', {
      focusAfterCreate: focusAfterCreate ? `${focusAfterCreate.tag}:${focusAfterCreate.text ?? ''}` : 'none',
    })

    const projectId = await page.evaluate(async (name) => {
      const result = await (window as unknown as {
        electronAPI: {
          linguistProjectsList: (input: { includeArchived: boolean }) => Promise<
            { ok: true; data: Array<{ id: string; name: string }> } | { ok: false; error: { code: string } }
          >
        }
      }).electronAPI.linguistProjectsList({ includeArchived: true })
      if (!result.ok) throw new Error(`list projects failed: ${result.error.code}`)
      const project = result.data.find((candidate) => candidate.name === name)
      if (project === undefined) throw new Error('created project missing from list')
      return project.id
    }, PROJECT_NAME)
    console.log(` projectId: ${projectId}`)

    // CLI 导入两个批次 + 项目级 QA（生成真实 Findings）
    const linguistRoot = join(tmpHome, '.linguist-agent-dev', 'linguist')
    const import1 = runCli(['import', '--root', linguistRoot, '--project', projectId, '--file', FIXTURE_XLIFF])
    const asset1 = cliField(import1, 'asset')
    const import2 = runCli(['import', '--root', linguistRoot, '--project', projectId, '--file', FIXTURE_LOCKED])
    const asset2 = cliField(import2, 'asset')
    const qaOutput = runCli(['qa', '--root', linguistRoot, '--project', projectId, '--asset', asset1])
    console.log(` assets: ${asset1} ${asset2}; qa: ${qaOutput.trim().split('\n')[0]}`)

    // CLI 直写项目库不会产生应用内 mutation 事件;reload 让 Workbench 重新加载 summary。
    // tabState/appMode 已持久化,reload 后回到同一项目工作台。
    await page.reload()
    await page.getByRole('tablist', { name: '主工作模式' }).waitFor({ timeout: 180_000 })
    const workbench = page.locator(`section[aria-label="${PROJECT_NAME} 本地化工作台"]`)
    const workbenchVisible = await waitFor(async () => workbench.isVisible(), 60_000)
    if (!workbenchVisible) {
      await capture(page, outDir, 'workbench-open-failed')
      throw new Error('Workbench section 未出现')
    }
    const grid = page.getByRole('grid', { name: 'Segment Grid' })
    const gridVisible = await waitFor(async () => grid.isVisible(), 120_000)
    if (!gridVisible) {
      await capture(page, outDir, 'workbench-no-grid')
      throw new Error('Segment Grid 未出现')
    }
    await sleep(1000)
    await capture(page, outDir, 'workbench-light')

    // S06: Segment 选择与焦点
    const rows = grid.locator('[role="row"][data-segment-id]')
    const rowCount = await rows.count()
    await rows.nth(1).click()
    await sleep(300)
    await capture(page, outDir, 'segment-selected', { rowCount: String(rowCount) })

    // S07: Enter 进入编辑 → Target 编辑（textarea 仅在编辑态挂载）
    try {
      await page.keyboard.press('Enter')
      const targetArea = rows.nth(1).locator('textarea').first()
      await targetArea.waitFor({ timeout: 10_000 })
      await targetArea.click()
      await targetArea.pressSequentially('欢迎回来，旅行者！', { delay: 20 })
      await sleep(400)
      await capture(page, outDir, 'target-editing')
      await page.keyboard.press('Meta+s')
      await sleep(600)
      await capture(page, outDir, 'target-saved')
      await page.keyboard.press('Escape')
    } catch (error) {
      await capture(page, outDir, 'target-edit-failed', { error: String(error).slice(0, 160) })
    }

    // S08: 键盘导航探针
    await sleep(200)
    const focusBeforeArrow = await probeFocus(page)
    await page.keyboard.press('ArrowDown')
    await sleep(300)
    const focusAfterArrow = await probeFocus(page)
    await capture(page, outDir, 'keyboard-nav', {
      focusBeforeArrow: JSON.stringify(focusBeforeArrow),
      focusAfterArrow: JSON.stringify(focusAfterArrow),
    })

    // S09: IME 组合输入探针 — 组合期间 Enter 不得误触提交/确认
    try {
      await rows.nth(2).click()
      await sleep(200)
      await page.keyboard.press('Enter')
      const imeArea = rows.nth(2).locator('textarea').first()
      await imeArea.waitFor({ timeout: 10_000 })
      const cdp = await page.context().newCDPSession(page)
      await cdp.send('Input.imeSetComposition', { text: 'ceshi', selectionStart: 5, selectionEnd: 5 })
      await page.keyboard.press('Enter')
      await sleep(300)
      const imeValue = await imeArea.inputValue().catch(() => '<no textarea value>')
      const confirmDialogVisible = await page.getByRole('alertdialog').isVisible().catch(() => false)
      await cdp.send('Input.insertText', { text: '测试' })
      await page.keyboard.press('Escape')
      await capture(page, outDir, 'ime-composition', {
        imeValueDuringProbe: imeValue,
        confirmDialogDuringImeEnter: String(confirmDialogVisible),
      })
    } catch (error) {
      await capture(page, outDir, 'ime-probe-failed', { error: String(error).slice(0, 160) })
    }

    // S10: 创建通用 Agent 会话(落地 full 呈现) → 「返回工作台」→ 头部 Agent 开关打开 Rail
    const workbenchSection = page.locator('section[aria-label$="本地化工作台"]')
    let rail = page.locator('[data-agent-presentation="rail"]')
    let railVisible = false
    try {
      await page.getByRole('button', { name: `在项目 ${PROJECT_NAME} 中新建会话`, exact: true }).click()
      await page.getByRole('menuitem', { name: /通用项目 Agent/u }).click()
      await sleep(1500)
      const landingTab = await page.locator('[role="tab"][data-state="active"], [role="tab"][aria-selected="true"]')
        .first().textContent().catch(() => null)
      await capture(page, outDir, 'after-session-create', { landingTab: landingTab?.trim() ?? 'n/a' })
      // 会话创建后是 full 呈现(dock/grid 均不渲染),必须先返回工作台。
      const backToWorkbench = page.getByRole('button', { name: '返回本地化工作台', exact: true })
      await backToWorkbench.waitFor({ timeout: 15_000 })
      await backToWorkbench.click()
      await sleep(800)
      const agentToggle = workbenchSection.getByRole('button', { name: 'Agent', exact: true })
      await agentToggle.waitFor({ timeout: 15_000 })
      if ((await agentToggle.getAttribute('aria-pressed')) !== 'true') await agentToggle.click()
      railVisible = await waitFor(async () => rail.isVisible(), 20_000)
    } catch (error) {
      await capture(page, outDir, 'agent-rail-create-failed', { error: String(error).slice(0, 160) })
    }
    await sleep(800)
    await capture(page, outDir, 'agent-rail-open', { railVisible: String(railVisible) })
    const gridBox = await grid.boundingBox().catch(() => null)
    const railBox = railVisible ? await rail.boundingBox().catch(() => null) : null
    steps[steps.length - 1]!.probes.gridWidth = gridBox ? String(Math.round(gridBox.width)) : 'gone'
    steps[steps.length - 1]!.probes.railWidth = railBox ? String(Math.round(railBox.width)) : 'n/a'

    // S11: Rail 内发送消息（fake model 流式回复）
    if (railVisible) {
      const composer = rail.locator('[contenteditable="true"], textarea').first()
      await composer.click()
      await page.keyboard.type('请审校当前 Segment', { delay: 10 })
      await page.keyboard.press('Enter')
      const gotReply = await waitFor(async () =>
        (await rail.textContent())?.includes(MARKERS.text) === true, 45_000)
      await capture(page, outDir, 'agent-rail-reply', { fakeModelReply: String(gotReply) })
    }

    // S11b: U-03 窄视口浮层脱困——收窄到 <xl(1280) 视口,rail 才是绝对浮层,
    // scrim 点击与 ESC 都必须能关闭;结束后恢复默认宽度,避免污染后续证据。
    if (railVisible) {
      await browserWindow.evaluate((win) => win.setSize(1100, 800))
      await sleep(700)
      const scrim = page.locator('[data-workbench-slot="agent-rail-scrim"]')
      const scrimVisible = await scrim.isVisible().catch(() => false)
      let scrimClosed = false
      if (scrimVisible) {
        await scrim.click({ position: { x: 8, y: 200 } })
        scrimClosed = await waitFor(async () => !(await rail.isVisible()), 5_000)
      }
      // 重新打开,验证 ESC 关闭(焦点放在 rail 头部非输入控件上,输入框内 Esc 不关 rail)。
      let escClosed = false
      if (scrimClosed) {
        const agentToggleAgain = workbenchSection.getByRole('button', { name: 'Agent', exact: true })
        if ((await agentToggleAgain.getAttribute('aria-pressed')) !== 'true') await agentToggleAgain.click()
        await rail.waitFor({ timeout: 10_000 })
        // 「收起项目 Agent」在 rail 头部(aside 内、AgentView 根之外),须按 aside 范围查找;
        // 且 rail 重开后需等其可见再聚焦,否则焦点停在 aside 外的开关上,ESC 不会冒泡到 aside。
        const railAside = page.locator('[data-workbench-slot="agent-rail"]')
        const railHideButton = railAside.getByRole('button', { name: '收起项目 Agent', exact: true })
        await railHideButton.waitFor({ timeout: 10_000 }).catch(() => undefined)
        if (await railHideButton.isVisible().catch(() => false)) await railHideButton.focus()
        await page.keyboard.press('Escape')
        escClosed = await waitFor(async () => !(await rail.isVisible()), 5_000)
      }
      // 关闭后焦点应回到工作台工具栏的 Agent 开关,focus 探针会记录。
      await capture(page, outDir, 'agent-rail-overlay-escape', {
        scrimVisible: String(scrimVisible),
        scrimClosed: String(scrimClosed),
        escClosed: String(escClosed),
        cssWidth: String(await page.evaluate(() => window.innerWidth)),
      })
      await browserWindow.evaluate((win) => win.setSize(1440, 900))
      await sleep(700)
    }

    // S12: Bottom Dock 各 Tab(默认收起,先经工作台工具栏开关打开)
    // 窄视口下 rail 是绝对定位浮层,会覆盖 dock;先收起 rail 再操作 dock。
    const agentToggleBeforeDock = workbenchSection.getByRole('button', { name: 'Agent', exact: true })
    if ((await agentToggleBeforeDock.getAttribute('aria-pressed').catch(() => null)) === 'true') {
      await agentToggleBeforeDock.click()
      await sleep(500)
    }
    const dockToggle = workbenchSection.getByRole('button', { name: '语言资产', exact: true })
    if ((await dockToggle.getAttribute('aria-pressed')) !== 'true') {
      await dockToggle.click()
      await sleep(500)
    }
    const dock = page.getByRole('tablist', { name: '语言资产' })
    await dock.waitFor({ timeout: 15_000 })
    for (const tabLabel of ['TM 匹配', '术语', 'QA', '上下文/证据', '预览', '待查看建议'] as const) {
      const tab = dock.getByRole('tab', { name: tabLabel, exact: true })
      if (await tab.isVisible().catch(() => false)) {
        await tab.click()
        await sleep(500)
        await capture(page, outDir, `dock-${tabLabel.replaceAll('/', '-')}`)
      }
    }

    // S13: QA Finding 定位探针（QA CLI 已生成 Findings）
    await dock.getByRole('tab', { name: 'QA', exact: true }).click()
    await sleep(600)
    const qaRegion = page.getByRole('region', { name: 'QA Findings' })
    const qaRegionAlt = page.locator('[aria-label="QA Findings"]')
    const qaScope = (await qaRegion.count()) > 0 ? qaRegion : qaRegionAlt
    const findingButtons = qaScope.locator('button')
    const findingNames: string[] = []
    const findingCount = await findingButtons.count()
    for (let i = 0; i < Math.min(findingCount, 12); i++) {
      const name = await findingButtons.nth(i).getAttribute('aria-label')
        ?? (await findingButtons.nth(i).textContent())?.trim().slice(0, 50) ?? ''
      findingNames.push(name)
    }
    // 尝试点击第一个疑似定位按钮,观察 Segment 焦点
    let qaJumpResult = 'no-candidate'
    for (let i = 0; i < findingCount; i++) {
      const name = findingNames[i] ?? ''
      if (/定位|跳转|跳到|查看片段|Segment/u.test(name) && !/筛选|运行|上一页|下一页/u.test(name)) {
        await findingButtons.nth(i).click()
        await sleep(500)
        const focusAfterJump = await probeFocus(page)
        qaJumpResult = `clicked "${name}" -> focus=${JSON.stringify(focusAfterJump)}`
        break
      }
    }
    await capture(page, outDir, 'qa-finding-jump', {
      findingButtonNames: findingNames.join(' | ').slice(0, 400),
      qaJumpResult,
    })

    // S14: 角色会话（双语审校 / 目标语校对）
    for (const roleName of ['双语审校', '目标语校对'] as const) {
      try {
        await page.getByRole('button', { name: `在项目 ${PROJECT_NAME} 中新建会话`, exact: true }).click()
        await page.getByRole('menuitem', { name: new RegExp(roleName, 'u') }).click()
        await sleep(1200)
        await capture(page, outDir, `role-session-${roleName}`)
      } catch (error) {
        steps.push({
          name: `role-session-${roleName}`, screenshot: null, axe: [], focus: null,
          probes: { error: String(error).slice(0, 200) }, consoleErrors: [],
        })
      }
    }

    // S15: 交付面板(角色会话创建后停在 full 呈现,先回工作台恢复 dock 渲染)
    const backBeforeDelivery = page.getByRole('button', { name: '返回本地化工作台', exact: true })
    if (await backBeforeDelivery.isVisible().catch(() => false)) {
      await backBeforeDelivery.click()
      await sleep(800)
    }
    // 「返回工作台」会顺带打开 rail;窄视口下 rail 浮层遮挡 dock 左侧 Tab,先收起。
    const agentToggleDelivery = workbenchSection.getByRole('button', { name: 'Agent', exact: true })
    if ((await agentToggleDelivery.getAttribute('aria-pressed').catch(() => null)) === 'true') {
      await agentToggleDelivery.click()
      await sleep(500)
    }
    await dock.getByRole('tab', { name: '准备交付', exact: true }).click()
    await sleep(600)
    await capture(page, outDir, 'delivery-panel')
    const asIsButton = page.getByRole('button', { name: /按现状|as-is|As-is/iu })
    if (await asIsButton.first().isVisible().catch(() => false)) {
      await asIsButton.first().click()
      await sleep(500)
      const alertVisible = await page.getByRole('alertdialog').isVisible().catch(() => false)
      await capture(page, outDir, 'delivery-as-is-confirm', { alertDialog: String(alertVisible) })
      if (alertVisible) {
        await page.getByRole('alertdialog').getByRole('button', { name: /取消|Cancel/u }).click().catch(() => undefined)
      }
    }

    // S16: 深色主题(经 IPC 写设置后 reload,让 renderer 主题 atom 重新水合;
    // updateSettings 的主题广播跳过发起方窗口,直接 evaluate 不会改变本窗口主题)
    await page.evaluate(async () => {
      await (window as unknown as {
        electronAPI: { updateSettings: (updates: { themeMode: string }) => Promise<unknown> }
      }).electronAPI.updateSettings({ themeMode: 'dark' })
    })
    await page.reload()
    await page.getByRole('tablist', { name: '主工作模式' }).waitFor({ timeout: 60_000 })
    await workbenchSection.waitFor({ timeout: 30_000 })
    await sleep(1000)
    await capture(page, outDir, 'workbench-dark')
    await dock.getByRole('tab', { name: 'QA', exact: true }).click().catch(() => undefined)
    await sleep(400)
    await capture(page, outDir, 'workbench-dark-2')
    // 回到浅色,避免后续窄窗口/Zoom 证据混入深色主题
    await page.evaluate(async () => {
      await (window as unknown as {
        electronAPI: { updateSettings: (updates: { themeMode: string }) => Promise<unknown> }
      }).electronAPI.updateSettings({ themeMode: 'light' })
    })
    await page.reload()
    await page.getByRole('tablist', { name: '主工作模式' }).waitFor({ timeout: 60_000 })
    await workbenchSection.waitFor({ timeout: 30_000 })
    await sleep(1000)

    // S17: 窄窗口 1280 / 1024
    await browserWindow.evaluate((win) => win.setSize(1280, 800))
    await sleep(800)
    const gridBox1280 = await grid.boundingBox()
    await capture(page, outDir, 'narrow-1280', {
      gridWidth: gridBox1280 ? String(Math.round(gridBox1280.width)) : 'hidden',
      cssWidth: String(await page.evaluate(() => window.innerWidth)),
    })
    await browserWindow.evaluate((win) => win.setSize(1024, 768))
    await sleep(800)
    const gridBox1024 = await grid.boundingBox()
    const railVisible1024 = await rail.isVisible().catch(() => false)
    await capture(page, outDir, 'narrow-1024', {
      gridWidth: gridBox1024 ? String(Math.round(gridBox1024.width)) : 'hidden',
      railVisible: String(railVisible1024),
      cssWidth: String(await page.evaluate(() => window.innerWidth)),
    })
    // 窄窗口下再开 rail:验证绝对浮层行为及其对 grid 的遮挡
    const agentToggleNarrow = workbenchSection.getByRole('button', { name: 'Agent', exact: true })
    if ((await agentToggleNarrow.getAttribute('aria-pressed').catch(() => null)) !== 'true') {
      await agentToggleNarrow.click()
      await sleep(600)
    }
    const railBox1024 = await rail.boundingBox().catch(() => null)
    await capture(page, outDir, 'narrow-1024-rail-open', {
      railWidth: railBox1024 ? String(Math.round(railBox1024.width)) : 'hidden',
    })
    if ((await agentToggleNarrow.getAttribute('aria-pressed').catch(() => null)) === 'true') {
      await agentToggleNarrow.click()
      await sleep(400)
    }

    // S18: 200% Zoom——两档窗口:1440(等效 720,主区应直接达标)与 1024(等效 512,
    // 触发左栏强制折叠为图标栏)。探针记录两种 regime 下的主区实际宽度。
    await browserWindow.evaluate((win) => win.setSize(1440, 900))
    await sleep(500)
    await browserWindow.evaluate((win) => { win.webContents.setZoomFactor(2) })
    await sleep(800)
    const gridBoxZoom = await grid.boundingBox()
    const hasHorizontalScroll = await page.evaluate(() =>
      document.documentElement.scrollWidth > document.documentElement.clientWidth + 8)
    await capture(page, outDir, 'zoom-200', {
      gridWidth: gridBoxZoom ? String(Math.round(gridBoxZoom.width)) : 'hidden',
      pageHorizontalScroll: String(hasHorizontalScroll),
      cssWidth: String(await page.evaluate(() => window.innerWidth)),
    })
    await browserWindow.evaluate((win) => win.setSize(1024, 768))
    await sleep(800)
    const gridBoxZoomNarrow = await grid.boundingBox()
    await capture(page, outDir, 'zoom-200-narrow', {
      gridWidth: gridBoxZoomNarrow ? String(Math.round(gridBoxZoomNarrow.width)) : 'hidden',
      cssWidth: String(await page.evaluate(() => window.innerWidth)),
    })
    await browserWindow.evaluate((win) => {
      win.webContents.setZoomFactor(1)
      win.setSize(1440, 900)
    })
    await sleep(500)

    // S19: Agent / Chat 回归抽查
    await selectPrimaryMode(page, 'Agent')
    await capture(page, outDir, 'agent-mode-final')
    await selectPrimaryMode(page, 'Chat')
    await capture(page, outDir, 'chat-mode-final')
  } finally {
    writeFileSync(
      join(outDir, 'audit-report.json'),
      JSON.stringify({ generatedAt: new Date().toISOString(), steps }, null, 2),
    )
    if (app) await app.close().catch(() => undefined)
    if (server) await server.close().catch(() => undefined)
    logStream.end()
    console.log(` report: ${join(outDir, 'audit-report.json')}`)
  }
}

main().catch((error) => {
  console.error('[ux-audit] 失败:', error)
  process.exitCode = 1
})
