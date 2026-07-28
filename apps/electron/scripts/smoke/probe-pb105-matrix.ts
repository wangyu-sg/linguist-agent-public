#!/usr/bin/env node
/**
 * PB-105 视觉、无障碍和性能矩阵探针 — 在【打包后的 .app】上跑自动化矩阵（G10 证据）
 *
 * 覆盖（playwright-core 真实渲染 + page.screenshot 落盘，禁止源码字符串替代）：
 * 1. fs.mkdtemp 临时 HOME；启动应用【前】播种：
 *    - settings.json 预写 mainWindowState {1280×820, isMaximized:false} + onboardingCompleted
 *      （避免临时 HOME 首启默认 maximize 的竞态，index.ts 的 ready-to-show 逻辑）
 *    - 10k 段 CAT 项目（packages/linguist-cat-store 的 headless CLI，与 probe-import.ts 同手法）
 *    - 1000-turn Agent 会话（~/.linguist-agent/agent-sessions.json 索引 + {id}.jsonl，
 *      SDKMessage 行格式、显式 uuid → 渲染层 data-message-id 可预测）
 *    - Chat 对话（通过打包 App preload API 创建，随后 reload 进入真实 ChatView）
 * 2. 启动打包应用（不触碰真实 ~/.linguist-agent），UI 路径再播一次 onboardingCompleted 后 reload
 * 3. 矩阵格（每格：设条件 → 真实点击导航 → 稳定等待 → page.screenshot → 页面级横向溢出断言）：
 *    - 尺寸格：1280×820 / 1024×700 / 800×600（minWidth/minHeight 下限）× light/dark
 *      × 四视图（Agent 1000-turn 会话 / Chat / CAT 10k 工作区 / Projects 列表）
 *    - zoom 格：200%（webContents.setZoomFactor，主进程 evaluate）× Agent + CAT
 *    - reduced motion 格：page.emulateMedia({ reducedMotion: 'reduce' })，
 *      断言 matchMedia 生效 + globals.css 安全网把既有动画元素的 transition-duration 压到 ~0
 *    - 1000-turn 性能格：最近窗口首载（≤10s）、顶部补载保持锚点（≤3s）、
 *      消息导航跳转中部 marker（≤3s），且完整历史总数仍为 2000
 *    - 10k 性能格：CAT 首屏渲染耗时、跳底后 [role="row"] DOM 计数 <80、滚动锚点稳定
 *    - axe 格：四视图（light）各跑 axe.run；任一 serious/critical 均为失败并影响退出码，
 *      全量 violations 摘要写 artifactDir/axe-report.json
 * 4. finally 关闭应用，不遗留后台进程；汇总 [PASS]/[FAIL] 表 + artifactDir 路径
 *
 * 手工项（VoiceOver / keyboard / IME / drag-resize / DMG 真机）不在本探针范围，
 * 由 G10 报告 knownLimitations 记录。
 *
 * 运行前提：已执行 `bun run smoke:pack`（产出 apps/electron/out/mac-arm64/*.app）
 *
 * 注意：与 G0/G1/PB-032/PB-033 探针相同，本脚本必须用 Node 运行
 * （`node scripts/smoke/probe-pb105-matrix.ts`），不能用 bun —— playwright-core 的
 * WebSocketTransport 在 bun 的 node:http 兼容层下无法完成 Electron 主进程
 * inspector 的 ws upgrade 握手（PB-004 实测）。Node 22.18+ 原生支持 .ts 类型擦除。
 */

import { _electron as electron, type ElectronApplication, type Page } from 'playwright-core'
import { execFileSync } from 'node:child_process'
import {
  cpSync,
  mkdtempSync,
  existsSync,
  mkdirSync,
  createWriteStream,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
  type WriteStream,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join, resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash, randomUUID } from 'node:crypto'

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url))
const APP_DIR = resolve(SCRIPT_DIR, '..', '..')
/** apps/electron/scripts/smoke → 上溯四级到仓根 */
const REPO_ROOT = resolve(SCRIPT_DIR, '..', '..', '..', '..')
const CLI_DIR = join(REPO_ROOT, 'packages', 'linguist-cat-store')
/** axe-core 可能被 bun workspaces 提升到仓根 node_modules，两处都解析 */
function resolveAxePath(): string {
  const candidates = [
    join(APP_DIR, 'node_modules', 'axe-core', 'axe.min.js'),
    join(REPO_ROOT, 'node_modules', 'axe-core', 'axe.min.js'),
  ]
  return candidates.find((p) => existsSync(p)) ?? candidates[0]!
}
const AXE_PATH = resolveAxePath()

/** 与 run-g0-smoke.ts 相同：glob out/mac-arm64/*.app，不写死 productName */
function resolvePackagedBinary(): string {
  const outDir = join(APP_DIR, 'out', 'mac-arm64')
  const appName = existsSync(outDir)
    ? readdirSync(outDir).find((entry) => entry.endsWith('.app'))
    : undefined
  if (!appName) {
    return join(outDir, '<未找到 .app，请先运行 bun run smoke:pack>')
  }
  const baseName = appName.slice(0, -'.app'.length)
  return join(outDir, appName, 'Contents', 'MacOS', baseName)
}

const PACKAGED_BINARY = resolvePackagedBinary()
const LONG_THREAD_ONLY = process.argv.includes('--long-thread-only')
const CHAT_CONVERSATION_TITLE = 'PB-105 Chat 矩阵对话'
const CHAT_MODEL_ID = 'pb105-matrix-model'

// ===== 结果收集 =====

interface CheckResult {
  name: string
  pass: boolean
  evidence: string
}

const results: CheckResult[] = []

function check(name: string, pass: boolean, evidence: string): void {
  results.push({ name, pass, evidence })
  console.log(`[${pass ? 'PASS' : 'FAIL'}] ${name} — ${evidence}`)
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/** 轮询等待条件成立，超时返回 false（不抛异常，由调用方记录 PASS/FAIL） */
async function waitFor(fn: () => Promise<boolean>, timeoutMs: number, intervalMs = 250): Promise<boolean> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (await fn()) return true
    await sleep(intervalMs)
  }
  return false
}

// ===== headless 播种：10k CAT 项目（PB-025 CLI，与 probe-import.ts 同手法） =====

const TEN_K_PROJECT_NAME = 'PB-105 10k 矩阵项目'

/** node 取 process.execPath（探针自身运行的 node），不依赖 PATH 解析 */
function runCli(args: string[]): string {
  return execFileSync(
    process.execPath,
    ['--experimental-transform-types', '--import', './test/register-ts-loader.mjs', 'src/cli.ts', ...args],
    { cwd: CLI_DIR, encoding: 'utf8' },
  )
}

function cliField(output: string, key: string): string {
  const line = output.split('\n').find((l) => l.startsWith(`${key}: `))
  if (line === undefined) throw new Error(`CLI 输出缺少字段 ${key}: ${output}`)
  return line.slice(key.length + 2).trim()
}

function seed10kProject(linguistRoot: string, fixtureDir: string): { projectId: string; importMs: number } {
  const fixture = join(fixtureDir, '10k_segments.csv')
  const lines = ['key,source,target,locked,context']
  for (let index = 0; index < 10_000; index += 1) {
    lines.push(`row.${index},Source item ${index},,${index === 9_999 ? 'true' : ''},Synthetic row ${index}`)
  }
  writeFileSync(fixture, `${lines.join('\n')}\n`)
  const created = runCli([
    'create-project',
    '--root',
    linguistRoot,
    '--name',
    TEN_K_PROJECT_NAME,
    '--source',
    'en',
    '--target',
    'zh-CN',
  ])
  const projectId = cliField(created, 'project')
  const startedAt = performance.now()
  runCli(['import', '--root', linguistRoot, '--project', projectId, '--file', fixture])
  return { projectId, importMs: performance.now() - startedAt }
}

// ===== headless 播种：1000-turn Agent 会话（SDKMessage JSONL + 索引） =====

const AGENT_SESSION_TITLE = 'PB-105 1000-turn 矩阵会话'
const TOTAL_TURNS = 1_000

function padTurn(n: number): string {
  return String(n).padStart(4, '0')
}

/** 用户消息：有意义的伪技术文本 + 轮次 marker */
function buildUserText(turn: number): string {
  return [
    `PB105-TURN-${padTurn(turn)} 第 ${turn + 1} 轮：请 review 下面这段增量同步逻辑，`,
    `重点看 catalog 重建时 revision 的 CAS 语义是否等价，以及并发编辑冲突的回退路径。`,
  ].join('')
}

/** 助手消息：段落为主，周期性地混入代码块与列表，模拟真实负载 */
function buildAssistantText(turn: number): string {
  const parts: string[] = [
    `PB105-TURN-${padTurn(turn)} 回复：看完了。整体思路成立——先以 store 的 projection 为唯一真源，`,
    `再把 UI 层的乐观更新收敛到单一 dispatch。这样 revision 校验只发生在主进程，渲染层不需要关心冲突细节。`,
  ]
  if (turn % 10 === 0) {
    parts.push(
      '\n\n```ts\nexport function applyRevision(expected: number, next: string): SegmentPatch {\n',
      `  // turn ${turn}: CAS 校验失败时返回 null，由调用方刷新后重试\n`,
      '  return { expectedRevision: expected, target: next }\n}\n```',
    )
  }
  if (turn % 7 === 0) {
    parts.push(
      '\n\n建议按这个顺序处理：\n',
      `- 先补一条 ${turn} 轮提到的回归用例\n`,
      '- 再把冲突提示从 toast 改成行内状态\n',
      '- 最后统一刷新策略（拉取最新 revision 后重放用户输入）',
    )
  }
  return parts.join('')
}

/**
 * 生成 1000 个 user/assistant 轮次（2000 条消息）。
 * 用 SDKMessage 行格式并显式写 uuid：渲染层 data-message-id 直接取消息 uuid
 * （SDKMessageRenderer.getGroupId），探针可按 id 精确定位任意轮次。
 */
function seedAgentSession(promaDir: string): string {
  const sessionId = randomUUID()
  const sessionsDir = join(promaDir, 'agent-sessions')
  mkdirSync(sessionsDir, { recursive: true })

  const baseTime = Date.now() - TOTAL_TURNS * 60_000
  const jsonlLines: string[] = []
  for (let turn = 0; turn < TOTAL_TURNS; turn += 1) {
    jsonlLines.push(JSON.stringify({
      type: 'user',
      uuid: `pb105-user-${padTurn(turn)}`,
      message: { role: 'user', content: [{ type: 'text', text: buildUserText(turn) }] },
      parent_tool_use_id: null,
      _createdAt: baseTime + turn * 60_000,
    }))
    jsonlLines.push(JSON.stringify({
      type: 'assistant',
      uuid: `pb105-asst-${padTurn(turn)}`,
      message: {
        role: 'assistant',
        model: 'pb105-seed-model',
        content: [{ type: 'text', text: buildAssistantText(turn) }],
      },
      parent_tool_use_id: null,
      _createdAt: baseTime + turn * 60_000 + 5_000,
    }))
  }
  writeFileSync(join(sessionsDir, `${sessionId}.jsonl`), `${jsonlLines.join('\n')}\n`)

  const now = Date.now()
  writeFileSync(join(promaDir, 'agent-sessions.json'), JSON.stringify({
    version: 1,
    sessions: [{
      id: sessionId,
      title: AGENT_SESSION_TITLE,
      agentRuntime: 'pi',
      createdAt: now,
      updatedAt: now,
    }],
    openAIThinkingDefaultEnabledMigrationCompleted: true,
  }))
  return sessionId
}

/** 预写 settings.json：固定首窗口尺寸（避开 maximize 竞态）+ onboarding 双保险 */
function seedSettings(promaDir: string): void {
  mkdirSync(promaDir, { recursive: true })
  writeFileSync(join(promaDir, 'settings.json'), JSON.stringify({
    onboardingCompleted: true,
    themeMode: 'light',
    mainWindowState: { width: 1280, height: 820, x: 80, y: 80, isMaximized: false },
  }))
}

// ===== 应用启动（与 run-g0-smoke.ts 同模式） =====

interface LaunchedApp {
  app: ElectronApplication
  page: Page
}

/** 模块级追踪当前活跃 app 实例：launch 中途失败时 finally 仍能清理，不遗留进程 */
let activeApp: ElectronApplication | undefined

/** 等待主窗口（index.html 且无 ?window= 查询参数；辅助窗口排除） */
async function waitForMainWindow(app: ElectronApplication, timeoutMs: number): Promise<Page> {
  const isMain = (url: string): boolean => url.includes('index.html') && !url.includes('window=')
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    for (const w of app.windows()) {
      if (isMain(w.url())) return w
    }
    try {
      const w = await app.waitForEvent('window', { timeout: 5_000 })
      if (isMain(w.url())) return w
    } catch {
      // 5s 内无新窗口，继续轮询
    }
  }
  throw new Error(`未找到主窗口（现有窗口: ${app.windows().map((w) => w.url()).join(', ')}）`)
}

async function launchApp(tmpHome: string, logStream: WriteStream): Promise<LaunchedApp> {
  const launchBinary = prepareLaunchBinary(tmpHome)
  const app = await electron.launch({
    executablePath: launchBinary,
    args: [`--user-data-dir=${join(tmpHome, '.electron-user-data')}`],
    env: { ...process.env, HOME: tmpHome, LINGUIST_SMOKE_PLAINTEXT_CREDENTIALS: '1' } as Record<string, string>,
    timeout: 120_000,
  })
  activeApp = app
  app.process().stdout?.pipe(logStream, { end: false })
  app.process().stderr?.pipe(logStream, { end: false })

  const page = await waitForMainWindow(app, 120_000)
  page.setDefaultTimeout(60_000)
  await page.waitForFunction(
    () => typeof (window as unknown as { electronAPI?: unknown }).electronAPI === 'object',
    undefined,
    { timeout: 60_000 },
  )
  return { app, page }
}

/** 为并行 Session 复制一个独立 bundle，避免固定 CFBundleIdentifier 争抢单实例锁。 */
function prepareLaunchBinary(tmpHome: string): string {
  if (process.platform !== 'darwin') return PACKAGED_BINARY

  const sourceApp = resolve(dirname(PACKAGED_BINARY), '..', '..')
  const targetApp = join(tmpHome, 'PB105 Matrix.app')
  cpSync(sourceApp, targetApp, { recursive: true, verbatimSymlinks: true })

  const plistPath = join(targetApp, 'Contents', 'Info.plist')
  const bundleId = `com.linguistagent.pb105.${process.pid}`
  execFileSync('/usr/libexec/PlistBuddy', ['-c', `Set :CFBundleIdentifier ${bundleId}`, plistPath])
  execFileSync('codesign', ['--force', '--deep', '--sign', '-', targetApp])

  return join(targetApp, 'Contents', 'MacOS', basename(PACKAGED_BINARY))
}

async function quitApp(app: ElectronApplication): Promise<void> {
  const proc = app.process()
  const exited = new Promise<void>((resolve) => {
    if (proc.killed || proc.exitCode !== null) resolve()
    else proc.once('exit', () => resolve())
  })
  await Promise.race([
    (async () => {
      try {
        await app.close()
      } catch {
        // close 异常时走 kill 兜底
      }
    })(),
    sleep(45_000),
  ])
  const killed = await Promise.race([exited.then(() => true), sleep(20_000).then(() => false)])
  if (!killed) {
    try {
      proc.kill('SIGKILL')
    } catch {
      // 已退出
    }
    await Promise.race([exited, sleep(5_000)])
  }
  if (activeApp === app) activeApp = undefined
}

// ===== UI 驱动 =====

/** 等待应用主界面就绪（AppShell 挂载），并尽力关闭教程 Banner */
async function waitForAppReady(page: Page): Promise<void> {
  await page.waitForFunction(
    () => typeof (window as unknown as { electronAPI?: unknown }).electronAPI === 'object',
    undefined,
    { timeout: 60_000 },
  )
  await page.locator('.mode-switcher-track').first().waitFor({ timeout: 60_000 })
  try {
    const dismiss = page.getByText('稍后再学', { exact: true }).first()
    if (await dismiss.isVisible({ timeout: 3_000 })) await dismiss.click()
  } catch {
    // 没有 banner 时忽略
  }
}

/** 切换主题：主进程设置 + localStorage 缓存（proma-theme-mode）双写后 reload（atoms/theme.ts 持久化路径） */
async function setTheme(page: Page, mode: 'light' | 'dark'): Promise<void> {
  await page.evaluate((themeMode) => {
    window.localStorage.setItem('proma-theme-mode', JSON.stringify(themeMode))
    return (window as unknown as {
      electronAPI: { updateSettings: (updates: unknown) => Promise<unknown> }
    }).electronAPI.updateSettings({ themeMode })
  }, mode)
  await page.reload()
  await waitForAppReady(page)
  // 确认 DOM class 已切换
  await waitFor(async () => page.evaluate(
    (m) => document.documentElement.classList.contains('dark') === (m === 'dark'), mode,
  ), 10_000)
}

/** 主进程 evaluate 设置窗口尺寸（先 unmaximize，避免 maximize 状态下 setSize 无效）。
 *  窗口查找与 waitForMainWindow 同准则（index.html 且无 ?window=）——不能用
 *  getAllWindows()[0]，快速任务等辅助窗口可能先创建，setSize/setZoomFactor 会
 *  打到隐藏窗口上（首轮实测：尺寸与 zoom 均未生效）。 */
async function setWindowSize(app: ElectronApplication, page: Page, width: number, height: number): Promise<boolean> {
  await app.evaluate(({ BrowserWindow }, size) => {
    const win = BrowserWindow.getAllWindows().find((w) => {
      const url = w.webContents.getURL()
      return url.includes('index.html') && !url.includes('window=')
    })
    if (!win) throw new Error('主进程未找到主窗口')
    if (win.isMaximized()) win.unmaximize()
    win.setSize(size.width, size.height)
  }, { width, height })
  // 等渲染层视口跟随
  const applied = await waitFor(async () => page.evaluate(
    (target) => Math.abs(window.innerWidth - target.width) <= 2 && Math.abs(window.innerHeight - target.height) <= 2,
    { width, height },
  ), 10_000)
  await sleep(300)
  return applied
}

type MatrixView = 'agent' | 'chat' | 'cat' | 'projects'

/** 真实点击路径导航到目标视图，并等待该视图就绪标志 */
async function navigateToView(page: Page, view: MatrixView): Promise<void> {
  if (view === 'chat') {
    const chatTab = page.getByRole('tab', { name: 'Chat', exact: true })
    if (await chatTab.getAttribute('aria-selected') !== 'true') await chatTab.click()
    await page.getByText(CHAT_CONVERSATION_TITLE, { exact: true }).first().click({ timeout: 15_000 })
    await page.locator('[data-input-mode="chat"] .ProseMirror').first().waitFor({ timeout: 30_000 })
    return
  }

  if (view === 'agent') {
    const agentTab = page.getByRole('tab', { name: 'Agent', exact: true })
    if (await agentTab.getAttribute('aria-selected') !== 'true') await agentTab.click()
    const sessionRow = page.locator(
      `[data-session-switch-type="agent"][data-session-switch-title="${AGENT_SESSION_TITLE}"]`,
    )
    const railButton = page.locator(`button[aria-label="打开Agent 会话：${AGENT_SESSION_TITLE}"]`)
    if (await sessionRow.first().isVisible().catch(() => false)) {
      await sessionRow.first().click()
    } else if (await railButton.first().isVisible().catch(() => false)) {
      await railButton.first().click()
    } else {
      await page.getByText(AGENT_SESSION_TITLE, { exact: true }).first().click({ timeout: 15_000 })
    }
    // 就绪标志：会话消息区出现 turn 容器。
    // 2000-turn 首挂载 ~10s；zoom 200% 下更慢（AgentMessages 的 ready 淡入门
    // 要等 rAF，opacity-0 期间 Playwright 判定 hidden），给足 180s 预算。
    await page.locator('[data-message-role]').first().waitFor({ timeout: 180_000 })
    return
  }
  // Linguist 模式的项目行直达 Workbench；“管理项目”是独立次级入口。
  const linguistTab = page.getByRole('tab', { name: 'Linguist', exact: true })
  if (await linguistTab.getAttribute('aria-selected') !== 'true') await linguistTab.click()
  const projectList = page.getByRole('list', { name: '本地化项目' })
  await projectList.waitFor({ timeout: 30_000 })
  if (view === 'projects') {
    await page.getByRole('button', { name: '管理项目', exact: true }).click()
    await page.getByRole('heading', { name: '项目', exact: true }).waitFor({ timeout: 30_000 })
    return
  }
  await projectList
    .getByRole('button', { name: `打开项目 ${TEN_K_PROJECT_NAME}`, exact: true })
    .click()
  const segmentEditor = page.locator('section[aria-label="Segment 编辑器"]')
  await segmentEditor.getByText('共 10000 段', { exact: true }).waitFor({ timeout: 60_000 })
}

interface OverflowSnapshot {
  scrollWidth: number
  innerWidth: number
}

interface AxeViolation {
  id: string
  impact: string | null
  help: string
  nodeCount: number
  sampleNodes: Array<{
    target: string
    html: string
    failureSummary?: string
  }>
}

async function scanAxe(page: Page): Promise<AxeViolation[]> {
  return page.evaluate(async () => {
    const axe = (window as unknown as {
      axe: {
        run: (context: Document, options: unknown) => Promise<{
          violations: Array<{
            id: string
            impact: string | null
            help: string
            nodes: Array<{
              target: string[]
              html: string
              failureSummary?: string
            }>
          }>
        }>
      }
    }).axe
    const result = await axe.run(document, { resultTypes: ['violations'] })
    return result.violations.map((violation) => ({
      id: violation.id,
      impact: violation.impact,
      help: violation.help,
      nodeCount: violation.nodes.length,
      sampleNodes: violation.nodes.map((node) => ({
        target: node.target.join(' '),
        html: node.html,
        failureSummary: node.failureSummary,
      })),
    }))
  })
}

async function snapshotPageOverflow(page: Page): Promise<OverflowSnapshot> {
  return page.evaluate(() => {
    const el = document.scrollingElement ?? document.documentElement
    return { scrollWidth: el.scrollWidth, innerWidth: window.innerWidth }
  })
}

/** CAT 虚拟滚动容器自身的横向滚动（组件行为，与页面级溢出区分记录） */
async function snapshotCatInternalScroll(page: Page): Promise<{ scrollWidth: number; clientWidth: number } | null> {
  return page.evaluate(() => {
    const grid = document.querySelector('[data-testid="cat-virtual-scroll"]')
    if (!grid) return null
    return { scrollWidth: grid.scrollWidth, clientWidth: grid.clientWidth }
  })
}

// ===== 主流程 =====

const SIZES: Array<{ width: number; height: number; label: string }> = [
  { width: 1280, height: 820, label: '1280x820' },
  { width: 1024, height: 700, label: '1024x700' },
  { width: 800, height: 600, label: '800x600' },
]
const VIEWS: MatrixView[] = ['agent', 'chat', 'cat', 'projects']

async function main(): Promise<void> {
  console.log('=== PB-105 视觉/无障碍/性能矩阵探针（packaged .app + 真实渲染截图）===')
  console.log(` packaged binary: ${PACKAGED_BINARY}`)

  if (!existsSync(PACKAGED_BINARY)) {
    check('packaged-binary-exists', false, `未找到 ${PACKAGED_BINARY}，请先运行 bun run smoke:pack`)
    summarizeAndExit(1)
  }
  check('packaged-binary-exists', true, PACKAGED_BINARY)

  if (!existsSync(AXE_PATH)) {
    check('axe-core-installed', false, `未找到 ${AXE_PATH}，请先 bun add -d axe-core`)
    summarizeAndExit(1)
  }
  check('axe-core-installed', true, AXE_PATH)

  const tmpHome = mkdtempSync(join(tmpdir(), 'proma-pb105-home-'))
  const artifactDir = mkdtempSync(join(tmpdir(), 'proma-pb105-artifacts-'))
  const screenshotsDir = join(artifactDir, 'screenshots')
  mkdirSync(screenshotsDir, { recursive: true })
  const mainLogPath = join(artifactDir, 'main-process.log')
  const logStream = createWriteStream(mainLogPath)
  console.log(` tmp HOME: ${tmpHome}`)
  console.log(` artifacts: ${artifactDir}`)

  // 1. 启动前播种
  const promaDir = join(tmpHome, '.linguist-agent')
  const linguistRoot = join(promaDir, 'linguist')
  let sessionId = ''
  try {
    seedSettings(promaDir)
    const seeded10k = seed10kProject(linguistRoot, artifactDir)
    sessionId = seedAgentSession(promaDir)
    check('seed', true,
      `settings.json 预写；10k 项目 ${seeded10k.projectId}（CLI 导入 ${seeded10k.importMs.toFixed(0)}ms）；` +
      `1000-turn 会话 ${sessionId}（2000 条消息）`)
  } catch (err) {
    check('seed', false, `播种失败：${err instanceof Error ? err.message : String(err)}`)
    logStream.end()
    rmSync(tmpHome, { recursive: true, force: true })
    summarizeAndExit(1)
  }

  const screenshotFiles: string[] = []
  const shoot = async (page: Page, name: string): Promise<void> => {
    await page.screenshot({ path: join(screenshotsDir, name) })
    screenshotFiles.push(name)
  }

  let launched: LaunchedApp | undefined

  try {
    launched = await launchApp(tmpHome, logStream)
    const { app, page } = launched
    check('packaged-launch', true, '主窗口获取成功，window.electronAPI 就绪')

    // UI 路径双保险播种 onboardingCompleted → reload 进主界面
    await page.evaluate(() =>
      (window as unknown as {
        electronAPI: { updateSettings: (updates: unknown) => Promise<unknown> }
      }).electronAPI.updateSettings({ onboardingCompleted: true }),
    )
    await page.evaluate(async ({ title, modelId }) => {
      const api = (window as unknown as {
        electronAPI: {
          createConversation: (title?: string) => Promise<{ id: string }>
          createChannel: (input: unknown) => Promise<{ id: string }>
        }
      }).electronAPI
      await api.createConversation(title)
      await api.createChannel({
        name: 'PB-105 Matrix',
        provider: 'openai',
        baseUrl: 'http://127.0.0.1:9',
        apiKey: 'sk-pb105-matrix',
        models: [{ id: modelId, name: modelId, enabled: true }],
        enabled: true,
      })
    }, { title: CHAT_CONVERSATION_TITLE, modelId: CHAT_MODEL_ID })
    await page.reload()
    await waitForAppReady(page)

    if (!LONG_THREAD_ONLY) {
      // ===== 尺寸 × 主题 × 视图矩阵 =====
      for (const theme of ['light', 'dark'] as const) {
        await setTheme(page, theme)
        for (const size of SIZES) {
          const sizeApplied = await setWindowSize(app, page, size.width, size.height)
          check(`viewport-${size.label}-${theme}`, sizeApplied,
            sizeApplied ? `innerWidth/Height 已变为 ${size.width}×${size.height}` : `setSize 后视口未跟随（目标 ${size.width}×${size.height}）`)
          for (const view of VIEWS) {
            const cellName = `${view}-${size.label}-${theme}`
            try {
              await navigateToView(page, view)
              await sleep(800)
              await shoot(page, `${cellName}.png`)
              const overflow = await snapshotPageOverflow(page)
              const noOverflow = overflow.scrollWidth <= overflow.innerWidth + 1
              let evidence = `innerWidth=${overflow.innerWidth}，scrollWidth=${overflow.scrollWidth}`
              if (view === 'cat') {
                const inner = await snapshotCatInternalScroll(page)
                if (inner) evidence += `，CAT 容器内部 scroll=${inner.scrollWidth}/client=${inner.clientWidth}（组件行为）`
              }
              check(`matrix-${cellName}`, noOverflow, evidence)
            } catch (err) {
              await shoot(page, `${cellName}-debug.png`).catch(() => undefined)
              check(`matrix-${cellName}`, false, `格子执行异常：${err instanceof Error ? err.message : String(err)}`)
            }
          }
        }
      }

      // ===== zoom 200% 格（1280×820 light，Agent + CAT） =====
      await setTheme(page, 'light')
      await setWindowSize(app, page, 1280, 820)
      await app.evaluate(({ BrowserWindow }) => {
        const win = BrowserWindow.getAllWindows().find((w) => {
          const url = w.webContents.getURL()
          return url.includes('index.html') && !url.includes('window=')
        })
        win?.webContents.setZoomFactor(2)
      })
      await sleep(500)
      const zoomFactor = await app.evaluate(({ BrowserWindow }) => {
        const win = BrowserWindow.getAllWindows().find((w) => {
          const url = w.webContents.getURL()
          return url.includes('index.html') && !url.includes('window=')
        })
        return win?.webContents.getZoomFactor() ?? 0
      })
      check('zoom-factor-applied', Math.abs(zoomFactor - 2) < 0.01, `setZoomFactor(2) → ${zoomFactor}`)

      for (const view of ['agent', 'cat'] as const) {
        const cellName = `${view}-1280x820-light-zoom200`
        try {
          await navigateToView(page, view)
          await sleep(800)
          await shoot(page, `${cellName}.png`)
          const overflow = await snapshotPageOverflow(page)
          const noOverflow = overflow.scrollWidth <= overflow.innerWidth + 1
          let evidence = `zoom200 CSS 视口 innerWidth=${overflow.innerWidth}，scrollWidth=${overflow.scrollWidth}`
          let contentVisible = true
          if (view === 'cat') {
            const inner = await snapshotCatInternalScroll(page)
            if (inner) evidence += `，CAT 容器内部 scroll=${inner.scrollWidth}/client=${inner.clientWidth}（组件行为，允许）`
            contentVisible = await page
              .locator('section[aria-label="Segment 编辑器"] [data-testid="cat-virtual-scroll"]')
              .isVisible()
            evidence += `，Segment Grid 可见=${contentVisible}`
          }
          check(`matrix-${cellName}`, noOverflow && contentVisible, evidence)
        } catch (err) {
          await shoot(page, `${cellName}-debug.png`).catch(() => undefined)
          check(`matrix-${cellName}`, false, `格子执行异常：${err instanceof Error ? err.message : String(err)}`)
        }
      }
      await app.evaluate(({ BrowserWindow }) => {
        const win = BrowserWindow.getAllWindows().find((w) => {
          const url = w.webContents.getURL()
          return url.includes('index.html') && !url.includes('window=')
        })
        win?.webContents.setZoomFactor(1)
      })

      // ===== reduced motion 格（light Agent 视图） =====
      // 基线：未 emulate 时既有动画元素的 transition-duration（globals.css 安全网的对照组）
      const baselineDuration = await page.evaluate(() => {
        const el = document.querySelector('.mode-btn')
        return el ? getComputedStyle(el).transitionDuration : null
      })
      await page.emulateMedia({ reducedMotion: 'reduce' })
      await navigateToView(page, 'agent')
      await sleep(800)
      await shoot(page, 'agent-1280x820-light-rm.png')
      const rmState = await page.evaluate(() => {
        const el = document.querySelector('.mode-btn')
        return {
          matches: window.matchMedia('(prefers-reduced-motion: reduce)').matches,
          duration: el ? getComputedStyle(el).transitionDuration : null,
        }
      })
      const parseSeconds = (raw: string | null): number =>
        (raw ?? '0s').split(',').reduce((max, part) => {
          const trimmed = part.trim()
          const value = trimmed.endsWith('ms') ? Number.parseFloat(trimmed) / 1000 : Number.parseFloat(trimmed)
          return Number.isFinite(value) ? Math.max(max, value) : max
        }, 0)
      const baselineSec = parseSeconds(baselineDuration)
      const reducedSec = parseSeconds(rmState.duration)
      check('matrix-agent-1280x820-light-rm',
        rmState.matches && reducedSec <= 0.001 && baselineSec > 0.05,
        `matchMedia reduce=${rmState.matches}，对照元素 transition-duration：基线=${baselineDuration} → reduce=${rmState.duration}（globals.css 安全网）`)
      await page.emulateMedia({ reducedMotion: 'no-preference' })
    }

    // ===== 1000-turn 性能格（冷载：最近窗口首载 + 顶部补载 + 消息导航跳转） =====
    await page.reload()
    await waitForAppReady(page)
    const lastTurnId = `pb105-asst-${padTurn(TOTAL_TURNS - 1)}`
    const midTurnId = `pb105-asst-${padTurn(Math.floor(TOTAL_TURNS / 2) - 1)}`
    // 首载只挂最近窗口；完整历史仍留在内存与 minimap，不一次性触发 1000 次 Markdown 挂载。
    const openStartedAt = performance.now()
    await navigateToView(page, 'agent')
    const firstRoleMs = performance.now() - openStartedAt
    const lastTurn = page.locator(`[data-message-id="${lastTurnId}"]`)
    const lastAttached = await lastTurn.waitFor({ state: 'attached', timeout: 30_000 })
      .then(() => true).catch(() => false)
    const lastAttachedMs = performance.now() - openStartedAt
    let openMs = Number.POSITIVE_INFINITY
    let lastVisible = false
    if (lastAttached) {
      await lastTurn.scrollIntoViewIfNeeded()
      lastVisible = await lastTurn.waitFor({ state: 'visible', timeout: 30_000 })
        .then(() => true).catch(() => false)
      openMs = performance.now() - openStartedAt
    }
    const messageWindow = page.getByTestId('agent-message-window')
    const initialWindow = await messageWindow.evaluate((element) => ({
      start: Number(element.getAttribute('data-window-start')),
      end: Number(element.getAttribute('data-window-end')),
      total: Number(element.getAttribute('data-window-total')),
    }))
    const initialRoleCount = await page.locator('[data-message-role]').count()
    check('perf-1000turn-open', lastVisible && openMs <= 10_000,
      `打开会话→末尾 turn（${lastTurnId}）可见=${lastVisible}，总耗时=${Number.isFinite(openMs) ? openMs.toFixed(0) : 'N/A'}ms` +
      `（首条窗口消息=${firstRoleMs.toFixed(0)}ms，末尾挂载=${lastAttachedMs.toFixed(0)}ms；软阈值≤10s）`)
    check('perf-1000turn-initial-window',
      initialWindow.total === TOTAL_TURNS * 2
        && initialWindow.end === initialWindow.total
        && initialRoleCount > 0
        && initialRoleCount <= 120,
      `完整历史=${initialWindow.total}，首载窗口=${initialWindow.start}..${initialWindow.end}，DOM messages=${initialRoleCount}（≤120）`)

    const log = page.getByTestId('agent-message-scroll')
    const firstMountedId = await page.locator('[data-message-id]').first().getAttribute('data-message-id')
    const loadOlderStartedAt = performance.now()
    const anchorOffsetBefore = await log.evaluate((element, id) => {
      element.scrollTop = 0
      element.dispatchEvent(new Event('scroll'))
      const target = id
        ? Array.from(element.querySelectorAll<HTMLElement>('[data-message-id]'))
          .find((node) => node.getAttribute('data-message-id') === id)
        : undefined
      return target
        ? target.getBoundingClientRect().top - element.getBoundingClientRect().top
        : Number.POSITIVE_INFINITY
    }, firstMountedId)
    const olderLoaded = await waitFor(async () => {
      const start = Number(await messageWindow.getAttribute('data-window-start'))
      return start < initialWindow.start
    }, 10_000)
    const loadOlderMs = performance.now() - loadOlderStartedAt
    const anchorOffset = firstMountedId
      ? await page.locator(`[data-message-id="${firstMountedId}"]`).evaluate((element) => {
        const container = element.closest('[data-testid="agent-message-scroll"]')
        if (!container) return Number.POSITIVE_INFINITY
        return element.getBoundingClientRect().top - container.getBoundingClientRect().top
      }).catch(() => Number.POSITIVE_INFINITY)
      : Number.POSITIVE_INFINITY
    const restoredScrollTop = await log.evaluate((element) => element.scrollTop)
    check('perf-1000turn-load-older',
      olderLoaded
        && Math.abs(anchorOffset - anchorOffsetBefore) <= 4
        && restoredScrollTop > 0
        && loadOlderMs <= 3_000,
      `顶部补载=${olderLoaded}，原首条锚点 delta=${Number.isFinite(anchorOffset) ? Math.abs(anchorOffset - anchorOffsetBefore).toFixed(1) : 'N/A'}px，` +
      `恢复 scrollTop=${restoredScrollTop.toFixed(0)}，` +
      `耗时=${loadOlderMs.toFixed(0)}ms（软阈值≤3s）`)

    const jumpStartedAt = performance.now()
    await page.keyboard.press('Meta+f')
    const minimapSearch = page.getByPlaceholder('搜索消息...')
    await minimapSearch.waitFor({ state: 'visible', timeout: 10_000 })
    await minimapSearch.fill('PB105-TURN-0499 回复')
    await page.getByRole('button', { name: /PB105-TURN-0499 回复/ }).first().click()
    const midTurn = page.locator(`[data-message-id="${midTurnId}"]`)
    const midVisible = await midTurn.waitFor({ state: 'visible', timeout: 10_000 })
      .then(() => true).catch(() => false)
    const jumpMs = performance.now() - jumpStartedAt
    const jumpedWindow = await messageWindow.evaluate((element) => ({
      start: Number(element.getAttribute('data-window-start')),
      end: Number(element.getAttribute('data-window-end')),
      total: Number(element.getAttribute('data-window-total')),
    }))
    const jumpedRoleCount = await page.locator('[data-message-role]').count()
    check('perf-1000turn-jump-mid',
      midVisible
        && jumpMs <= 3_000
        && jumpedWindow.total === TOTAL_TURNS * 2
        && jumpedRoleCount <= 120,
      `消息导航跳转第 500 轮（${midTurnId}）可见=${midVisible}，耗时=${jumpMs.toFixed(0)}ms；` +
      `窗口=${jumpedWindow.start}..${jumpedWindow.end}/${jumpedWindow.total}，DOM messages=${jumpedRoleCount}（≤120）`)

    if (!LONG_THREAD_ONLY) {
      // ===== 10k CAT 性能格 =====
      const catStartedAt = performance.now()
      await navigateToView(page, 'cat')
      const catLoadMs = performance.now() - catStartedAt
      const tenKWorkspace = page.locator('section[aria-label="Segment 编辑器"]')
      const virtualScroll = tenKWorkspace.locator('[data-testid="cat-virtual-scroll"]')
      await virtualScroll.evaluate((element) => {
        element.scrollTop = element.scrollHeight
      })
      const lastSource = await tenKWorkspace.getByText('Source item 9999', { exact: true })
        .waitFor({ timeout: 30_000 }).then(() => true).catch(() => false)
      const renderedRows = await tenKWorkspace.locator('[role="row"]').count()
      const scrollBefore = await virtualScroll.evaluate((element) => element.scrollTop)
      await page.waitForTimeout(500)
      const scrollAfter = await virtualScroll.evaluate((element) => element.scrollTop)
      check('perf-10k-grid',
        lastSource && renderedRows < 80 && Math.abs(scrollAfter - scrollBefore) < 2,
        `首屏渲染=${catLoadMs.toFixed(0)}ms，末行=${lastSource}，DOM rows=${renderedRows}（<80），` +
        `scroll delta=${Math.abs(scrollAfter - scrollBefore).toFixed(1)}px（<2px）`)

      // ===== axe 格（三视图，light；单视图失败不终止后续视图） =====
      const axeReport: Record<string, unknown> = {}
      for (const view of VIEWS) {
        try {
          await navigateToView(page, view)
          await sleep(800)
          await page.addScriptTag({ path: AXE_PATH })
          const violations = await scanAxe(page)
          axeReport[view] = violations
          const serious = violations.filter((v) => v.impact === 'serious' || v.impact === 'critical')
          check(`axe-${view}`, serious.length === 0,
            `violations 总数=${violations.length}，serious/critical=${serious.length}` +
            (serious.length > 0 ? `（${serious.map((v) => `${v.id}×${v.nodeCount}`).join(', ')}）` : ''))
          if (view === 'chat') {
            try {
              const interactive: Record<string, AxeViolation[]> = {}

              const editTitle = page.getByRole('button', { name: '编辑标题', exact: true })
              await editTitle.focus()
              await page.keyboard.press('Enter')
              await page.getByRole('textbox', { name: '对话标题' }).waitFor()
              await sleep(300)
              interactive.title = await scanAxe(page)
              await page.keyboard.press('Escape')

              const modelTrigger = page.locator('.model-selector-trigger')
              await modelTrigger.focus()
              await page.keyboard.press('Enter')
              await page.getByRole('textbox', { name: '搜索模型' }).waitFor()
              await sleep(300)
              interactive.model = await scanAxe(page)
              await page.keyboard.press('Escape')

              const toolTrigger = page.getByRole('button', { name: '工具', exact: true })
              await toolTrigger.focus()
              await page.keyboard.press('Enter')
              await page.getByRole('switch').first().waitFor()
              await sleep(300)
              interactive.tools = await scanAxe(page)
              await page.keyboard.press('Escape')

              const promptTrigger = page.locator('button[title="选择提示词"], button[title^="提示词:"]').first()
              await promptTrigger.focus()
              await page.keyboard.press('Enter')
              await page.getByRole('menuitem', { name: '编辑提示词', exact: true }).waitFor()
              await sleep(300)
              interactive.systemPrompt = await scanAxe(page)
              await page.keyboard.press('Escape')

              axeReport['chat-interactions'] = interactive
              const interactiveSerious = Object.values(interactive)
                .flat()
                .filter((violation) => violation.impact === 'serious' || violation.impact === 'critical')
              check('axe-chat-interactions', interactiveSerious.length === 0,
                `标题/模型/工具/提示词四个键盘展开态，serious/critical=${interactiveSerious.length}`)
            } catch (err) {
              axeReport['chat-interactions'] = { error: err instanceof Error ? err.message : String(err) }
              check('axe-chat-interactions', false,
                `Chat 交互态 Axe 执行异常：${err instanceof Error ? err.message : String(err)}`)
            }
          }
        } catch (err) {
          axeReport[view] = { error: err instanceof Error ? err.message : String(err) }
          check(`axe-${view}`, false, `axe 格执行异常：${err instanceof Error ? err.message : String(err)}`)
        }
      }
      writeFileSync(join(artifactDir, 'axe-report.json'), JSON.stringify(axeReport, null, 2))
    }
  } catch (error) {
    check('runner-completed', false, `运行异常: ${error instanceof Error ? error.message : String(error)}`)
  } finally {
    try {
      if (activeApp) await quitApp(activeApp)
    } finally {
      logStream.end()
      rmSync(tmpHome, { recursive: true, force: true })
    }
  }

  // 机器可读结果（供主 agent 撰写 G10 报告）
  const appAsarPath = resolve(dirname(PACKAGED_BINARY), '..', 'Resources', 'app.asar')
  writeFileSync(join(artifactDir, 'matrix-results.json'), JSON.stringify({
    gitHead: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: REPO_ROOT, encoding: 'utf8' }).trim(),
    gitDirty: execFileSync('git', ['status', '--porcelain'], { cwd: REPO_ROOT, encoding: 'utf8' }).trim() !== '',
    appAsarSha256: existsSync(appAsarPath)
      ? createHash('sha256').update(readFileSync(appAsarPath)).digest('hex')
      : null,
    artifactDir,
    screenshots: screenshotFiles,
    results,
  }, null, 2))

  summarizeAndExit(results.some((r) => !r.pass) ? 1 : 0)
}

function summarizeAndExit(code: number): never {
  const failed = results.filter((r) => !r.pass).length
  const passed = results.filter((r) => r.pass).length
  console.log(`\n=== PB-105 矩阵结果：${passed} PASS / ${failed} FAIL ===`)
  process.exit(code)
}

main().catch((err) => {
  console.error('探针执行异常:', err)
  if (activeApp !== undefined) {
    try {
      activeApp.process().kill('SIGKILL')
    } catch {
      // 已退出
    }
  }
  process.exit(1)
})
