#!/usr/bin/env node
/**
 * PB-074 完整纵向 E2E — 打包应用 + fake model + 真实 CAT 项目库。
 *
 * 自动覆盖：
 * create project（真实 UI）→ import XLIFF（PB-025 headless CLI，共用同一项目库）
 * → 通过 Linguist Sidebar 新建项目 Session（真实 UI）→ model 先读 Segment tool result，再据其中 id/revision
 * 创建 Proposal → 用户在当前行审核区接受 → QA 阻止导出 → 接受修复 blocking
 * → 重跑 QA → 用户填写原因 waiver → export → adapter reimport verify → 同 HOME 重启恢复。
 *
 * Playwright 无法可靠驱动 macOS 原生 Open/Save 对话框。Import 使用既有 headless CLI；
 * export/reimport 使用同一 XLIFF adapter 的 CLI 纵向缝。PB-073 的原生 Save/copy 由
 * export-ipc.nodetest.ts 注入 picker 覆盖；本探针只断言打包 UI 入口，不伪造原生对话框。
 *
 * 运行前提：
 *   cd apps/electron
 *   CSC_IDENTITY_AUTO_DISCOVERY=false bun run smoke:pack
 *   node scripts/smoke/probe-pb074-e2e.ts
 */

import { execFileSync, spawn, type ChildProcess } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  createWriteStream,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  type WriteStream,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  chromium,
  type Browser,
  type BrowserContext,
  type Locator,
  type Page,
} from 'playwright-core'
import { PNG } from 'pngjs'
import {
  FAKE_CAT_PROPOSAL_TOOL_NAME,
  FAKE_CAT_TOOL_NAME,
  FAKE_MODEL_IDS,
  PB074_FINAL_MARKER,
  PB074_PROPOSAL_TARGET,
  PB074_SOURCE,
  startFakeModelServer,
  type FakeModelServer,
} from './fake-model-server.ts'
import { CURRENT_ONBOARDING_VERSION } from '../../src/types/settings.ts'

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url))
const APP_DIR = resolve(SCRIPT_DIR, '..', '..')
const REPO_ROOT = resolve(SCRIPT_DIR, '..', '..', '..', '..')
const CLI_DIR = join(REPO_ROOT, 'packages', 'linguist-cat-store')
const FIXTURE_PATH = join(REPO_ROOT, 'tests', 'linguist-fixtures', 'mini_game_ui.xliff')
const LF056_FIXTURE_SEEDER_PATH = join(SCRIPT_DIR, 'seed-lf056-resources.ts')
const PROJECT_NAME = 'PB-074 纵向交付探针'
const DISTRACTOR_PROJECT_NAME = 'PB-074 恢复干扰项目'
const WAIVER_REASON = '交付方确认本轮保留强调语气，允许重复全角叹号'
const EXPORT_RELATIVE_PATH = 'exports/pb074-verified.xliff'
const MODEL_ID = 'fake-cat-pb074'
const LF026_ONLY = process.argv.includes('--lf026-only')
const LF056_ONLY = process.argv.includes('--lf056-only')
const PROPOSAL_ID_PATTERN = /prp(?:-[0-9a-f]{16}|_v2_[0-9a-f]{64})/
const UI_EVIDENCE_DIR_INPUT = process.env.LINGUIST_UI_EVIDENCE_DIR?.trim()
const UI_EVIDENCE_DIR = UI_EVIDENCE_DIR_INPUT ? resolve(UI_EVIDENCE_DIR_INPUT) : undefined

interface CheckResult {
  name: string
  pass: boolean
  evidence: string
}

interface ProbeEvents {
  toolUses: Array<{ sessionId: string; name: string }>
  texts: Array<{ sessionId: string; text: string }>
  complete: Array<{ sessionId: string }>
  errors: Array<{ sessionId: string; error: string }>
}

interface PackagedApp {
  browser: Browser
  context: BrowserContext
  process: ChildProcess
}

interface LaunchedApp {
  app: PackagedApp
  page: Page
}

interface PersistedLocalizationProjectTab {
  id: string
  type: string
  projectId: string
  sessionId?: unknown
}

interface PersistedLinguistLocation {
  activeAssetId?: string
  activeSegmentId?: string
  bottomDockOpen?: boolean
  bottomDockTab?: string
  bottomDockHeight?: number
}

interface PersistedLinguistState {
  tab: PersistedLocalizationProjectTab | undefined
  activeTabId: string | undefined
  location: PersistedLinguistLocation | undefined
  projectSessionId: string | undefined
}

interface PackagedSegmentState {
  target: string
  revision: number
  currentStageState: string
}

function countNonDominantPixels(pngBytes: Buffer): number {
  const image = PNG.sync.read(pngBytes)
  const colors = new Map<number, number>()
  let dominantCount = 0
  for (let index = 0; index < image.data.length; index += 4) {
    const color = (
      (image.data[index]! << 24)
      | (image.data[index + 1]! << 16)
      | (image.data[index + 2]! << 8)
      | image.data[index + 3]!
    ) >>> 0
    const count = (colors.get(color) ?? 0) + 1
    colors.set(color, count)
    dominantCount = Math.max(dominantCount, count)
  }
  return image.width * image.height - dominantCount
}

const results: CheckResult[] = []
let manualCount = 0
let activeApp: PackagedApp | undefined
const closedApps = new WeakSet<PackagedApp>()

function check(name: string, pass: boolean, evidence: string): void {
  results.push({ name, pass, evidence })
  console.log(`[${pass ? 'PASS' : 'FAIL'}] ${name} — ${evidence}`)
}

function manual(name: string, evidence: string): void {
  manualCount += 1
  console.log(`[MANUAL] ${name} — ${evidence}`)
}

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

function resolvePackagedBinary(): string {
  const outDir = join(APP_DIR, 'out', 'mac-arm64')
  const appName = existsSync(outDir)
    ? readdirSync(outDir).find((entry) => entry.endsWith('.app'))
    : undefined
  if (appName === undefined) return join(outDir, '<未找到 .app，请先运行 bun run smoke:pack>')
  const baseName = appName.slice(0, -'.app'.length)
  return join(outDir, appName, 'Contents', 'MacOS', baseName)
}

const PACKAGED_BINARY = resolvePackagedBinary()

function runCli(args: string[]): string {
  return execFileSync(
    process.execPath,
    ['--experimental-transform-types', '--import', './test/register-ts-loader.mjs', 'src/cli.ts', ...args],
    { cwd: CLI_DIR, encoding: 'utf8' },
  )
}

function runLf056FixtureSeeder(
  linguistRoot: string,
  projectId: string,
  segmentId: string,
): string {
  return execFileSync(
    process.execPath,
    [
      '--experimental-transform-types',
      '--import',
      join(CLI_DIR, 'test', 'register-ts-loader.mjs'),
      LF056_FIXTURE_SEEDER_PATH,
      '--root',
      linguistRoot,
      '--project',
      projectId,
      '--segment',
      segmentId,
    ],
    { cwd: APP_DIR, encoding: 'utf8' },
  ).trim()
}

function fileSha256(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex')
}

function cliField(output: string, key: string): string {
  const line = output.split('\n').find((candidate) => candidate.startsWith(`${key}: `))
  if (line === undefined) throw new Error(`CLI 输出缺少字段 ${key}: ${output}`)
  return line.slice(key.length + 2).trim()
}

async function waitForMainWindow(app: PackagedApp, timeoutMs: number): Promise<Page> {
  const isMain = (url: string): boolean => url.includes('index.html')
    && !url.includes('/startup-splash/')
    && !url.includes('window=')
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    for (const window of app.context.pages()) {
      if (isMain(window.url())) return window
    }
    try {
      const window = await app.context.waitForEvent('page', { timeout: 5_000 })
      if (isMain(window.url())) return window
    } catch (error) {
      if (!(error instanceof Error && error.name === 'TimeoutError')) throw error
    }
  }
  throw new Error(`未找到主窗口（现有窗口: ${app.context.pages().map((window) => window.url()).join(', ')}）`)
}

async function launchApp(tmpHome: string, logStream: WriteStream): Promise<LaunchedApp> {
  const userDataDir = join(tmpHome, '.electron-user-data')
  const activePortPath = join(userDataDir, 'DevToolsActivePort')
  rmSync(activePortPath, { force: true })
  const processHandle = spawn(PACKAGED_BINARY, [
    '--remote-debugging-port=0',
    `--user-data-dir=${userDataDir}`,
  ], {
    env: {
      ...process.env,
      HOME: tmpHome,
      LINGUIST_SMOKE_PLAINTEXT_CREDENTIALS: '1',
    } as Record<string, string>,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  processHandle.stdout?.pipe(logStream, { end: false })
  processHandle.stderr?.pipe(logStream, { end: false })
  let port: number | undefined
  const endpointReady = await waitFor(async () => {
    if (processHandle.exitCode !== null || processHandle.signalCode !== null) {
      throw new Error(`打包应用在 CDP 就绪前退出: code=${processHandle.exitCode ?? 'null'} signal=${processHandle.signalCode ?? 'null'}`)
    }
    if (!existsSync(activePortPath)) return false
    const candidate = Number.parseInt(readFileSync(activePortPath, 'utf8').split('\n')[0] ?? '', 10)
    if (!Number.isInteger(candidate) || candidate <= 0) return false
    port = candidate
    return true
  }, 120_000)
  if (!endpointReady || port === undefined) {
    processHandle.kill('SIGKILL')
    throw new Error('打包应用 CDP 端点未在 120 秒内就绪')
  }
  const cdpEndpoint = `http://127.0.0.1:${port}`
  const mainTargetReady = await waitFor(async () => {
    if (processHandle.exitCode !== null || processHandle.signalCode !== null) {
      throw new Error(`打包应用在主窗口就绪前退出: code=${processHandle.exitCode ?? 'null'} signal=${processHandle.signalCode ?? 'null'}`)
    }
    try {
      const response = await fetch(`${cdpEndpoint}/json/list`)
      if (!response.ok) return false
      const targets = await response.json() as Array<{ type?: unknown; url?: unknown }>
      return targets.some((target) => target.type === 'page'
        && typeof target.url === 'string'
        && target.url.includes('index.html')
        && !target.url.includes('/startup-splash/'))
    } catch {
      return false
    }
  }, 120_000)
  if (!mainTargetReady) {
    processHandle.kill('SIGKILL')
    throw new Error('打包应用主窗口未在 120 秒内就绪')
  }
  let browser: Browser
  try {
    browser = await chromium.connectOverCDP(cdpEndpoint, { timeout: 120_000 })
  } catch (error) {
    processHandle.kill('SIGKILL')
    throw error
  }
  const context = browser.contexts()[0]
  if (context === undefined) {
    await browser.close()
    processHandle.kill('SIGKILL')
    throw new Error('打包应用 CDP 未提供默认 BrowserContext')
  }
  const app = { browser, context, process: processHandle }
  activeApp = app
  const page = await waitForMainWindow(app, 120_000)
  page.setDefaultTimeout(60_000)
  await page.waitForFunction(
    () => typeof (window as unknown as { electronAPI?: unknown }).electronAPI === 'object',
    undefined,
    { timeout: 60_000 },
  )
  return { app, page }
}

async function quitApp(app: PackagedApp): Promise<void> {
  if (closedApps.has(app)) return
  const processHandle = app.process
  closedApps.add(app)
  let exitStatus: { code: number | null; signal: NodeJS.Signals | null } | undefined
  const exited = new Promise<void>((resolveExit) => {
    if (processHandle.exitCode !== null || processHandle.signalCode !== null) {
      exitStatus = { code: processHandle.exitCode, signal: processHandle.signalCode }
      resolveExit()
    } else {
      processHandle.once('exit', (code, signal) => {
        exitStatus = { code, signal }
        resolveExit()
      })
    }
  })
  processHandle.kill('SIGTERM')
  const closed = await Promise.race([exited.then(() => true), sleep(20_000).then(() => false)])
  if (!closed) {
    try {
      processHandle.kill('SIGKILL')
    } catch (error) {
      console.warn('[PB-074] app process 已在 kill 前退出:', error)
    }
    await Promise.race([exited, sleep(5_000)])
  }
  await app.browser.close().catch(() => {})
  if (activeApp === app) activeApp = undefined
  if (exitStatus !== undefined
    && (exitStatus.signal !== null || (exitStatus.code !== null && exitStatus.code !== 0))) {
    throw new Error(`打包应用异常退出: code=${exitStatus?.code ?? 'null'} signal=${exitStatus?.signal ?? 'null'}`)
  }
}

async function closeLogStream(stream: WriteStream): Promise<void> {
  if (stream.closed) return
  await new Promise<void>((resolveClose, rejectClose) => {
    stream.once('error', rejectClose)
    stream.end(resolveClose)
  })
}

async function enterMainUI(page: Page): Promise<void> {
  await page.evaluate((onboardingVersion) =>
    (window as unknown as {
      electronAPI: { updateSettings: (updates: unknown) => Promise<unknown> }
    }).electronAPI.updateSettings({ onboardingCompleted: true, onboardingVersion }),
    CURRENT_ONBOARDING_VERSION,
  )
  await page.reload()
  await page.waitForFunction(
    () => typeof (window as unknown as { electronAPI?: unknown }).electronAPI === 'object',
    undefined,
    { timeout: 60_000 },
  )
  try {
    const dismiss = page.getByText('稍后再学', { exact: true }).first()
    if (await dismiss.isVisible({ timeout: 3_000 })) await dismiss.click()
  } catch (error) {
    if (!(error instanceof Error && error.name === 'TimeoutError')) throw error
  }
}

async function installEventCollectors(page: Page): Promise<void> {
  await page.evaluate(() => {
    const state = window as unknown as {
      electronAPI: {
        onAgentStreamEvent: (callback: (event: {
          sessionId: string
          payload: {
            kind: string
            message?: {
              type?: string
              message?: { content?: Array<{ type?: string; text?: string; name?: string }> }
            }
          }
        }) => void) => () => void
        onAgentStreamComplete: (callback: (data: { sessionId: string }) => void) => () => void
        onAgentStreamError: (callback: (data: { sessionId: string; error: string }) => void) => () => void
      }
      __pb074Events: ProbeEvents
      __pb074Unsub?: Array<() => void>
    }
    for (const unsubscribe of state.__pb074Unsub ?? []) unsubscribe()
    state.__pb074Events = { toolUses: [], texts: [], complete: [], errors: [] }
    state.__pb074Unsub = [
      state.electronAPI.onAgentStreamEvent((event) => {
        if (event.payload.kind !== 'sdk_message' || event.payload.message?.type !== 'assistant') return
        for (const block of event.payload.message.message?.content ?? []) {
          if (block.type === 'tool_use' && typeof block.name === 'string') {
            state.__pb074Events.toolUses.push({ sessionId: event.sessionId, name: block.name })
          }
          if (block.type === 'text' && typeof block.text === 'string') {
            state.__pb074Events.texts.push({ sessionId: event.sessionId, text: block.text })
          }
        }
      }),
      state.electronAPI.onAgentStreamComplete((data) => state.__pb074Events.complete.push(data)),
      state.electronAPI.onAgentStreamError((data) => state.__pb074Events.errors.push(data)),
    ]
  })
}

async function getEvents(page: Page): Promise<ProbeEvents> {
  return page.evaluate(
    () => (window as unknown as { __pb074Events: ProbeEvents }).__pb074Events,
  )
}

async function translateSelectedAndWaitComplete(
  page: Page,
  workspace: Locator,
  sessionId: string,
): Promise<boolean> {
  const eventsBefore = await getEvents(page)
  const completedBefore = eventsBefore.complete.filter(
    (event) => event.sessionId === sessionId,
  ).length
  const errorsBefore = eventsBefore.errors.filter(
    (event) => event.sessionId === sessionId,
  ).length
  await workspace.getByRole('button', { name: '翻译已选', exact: true }).click()
  await waitFor(
    async () => {
      const events = await getEvents(page)
      return events.complete.filter((event) => event.sessionId === sessionId).length > completedBefore
        || events.errors.filter((event) => event.sessionId === sessionId).length > errorsBefore
    },
    120_000,
  )
  return (await getEvents(page)).complete.filter(
    (event) => event.sessionId === sessionId,
  ).length > completedBefore
}

async function seedChannel(page: Page, server: FakeModelServer): Promise<string> {
  return page.evaluate(async (args) => {
    const api = (window as unknown as {
      electronAPI: {
        createChannel: (input: unknown) => Promise<{ id: string }>
        updateSettings: (updates: unknown) => Promise<unknown>
      }
    }).electronAPI
    const channel = await api.createChannel({
      name: 'PB-074 fake',
      provider: 'openai',
      baseUrl: args.baseUrl,
      apiKey: 'sk-fake',
      models: args.modelIds.map((id) => ({ id, name: id, enabled: true })),
      enabled: true,
    })
    await api.updateSettings({
      agentChannelId: channel.id,
      agentModelId: args.modelId,
    })
    return channel.id
  }, {
    baseUrl: server.baseUrl,
    modelId: MODEL_ID,
    modelIds: [...FAKE_MODEL_IDS] as string[],
  })
}

async function createProjectViaUi(page: Page): Promise<string> {
  await page.getByRole('tab', { name: '本地化', exact: true }).click()
  await page.getByRole('button', { name: '新建项目' }).filter({ hasText: '新建项目' }).first().click()
  const dialog = page.getByRole('dialog', { name: '新建项目', exact: true })
  await dialog.locator('#project-create-name').fill(PROJECT_NAME)
  await dialog.locator('#project-create-source')
    .getByText('简体中文（zh-CN）', { exact: true })
    .waitFor({ timeout: 30_000 })
  await dialog.locator('#project-create-target')
    .getByText('英语（美国，en-US）', { exact: true })
    .waitFor({ timeout: 30_000 })
  await dialog.locator('#project-create-source').click()
  await page.getByRole('option', { name: '英语（美国，en-US）', exact: true }).click()
  await dialog.locator('#project-create-target').click()
  await page.getByRole('option', { name: '简体中文（zh-CN）', exact: true }).click()
  await dialog.getByRole('button', { name: '创建项目', exact: true }).click()
  const projectList = await resolveVisibleLinguistProjectList(page)
  await projectList.list.getByRole(
    'button',
    { name: `打开项目 ${PROJECT_NAME}`, exact: true },
  ).waitFor({ timeout: 30_000 })
  return page.evaluate(async (projectName) => {
    const result = await (window as unknown as {
      electronAPI: {
        linguistProjectsList: (input: { includeArchived: boolean }) => Promise<
          { ok: true; data: Array<{ id: string; name: string }> }
          | { ok: false; error: { code: string } }
        >
      }
    }).electronAPI.linguistProjectsList({ includeArchived: true })
    if (result.ok === false) throw new Error(`list projects failed: ${result.error.code}`)
    const project = result.data.find((candidate) => candidate.name === projectName)
    if (project === undefined) throw new Error('created project missing from list')
    return project.id
  }, PROJECT_NAME)
}

async function selectPrimaryMode(
  page: Page,
  label: 'Agent' | 'Chat' | '本地化',
): Promise<void> {
  const tab = page.getByRole('tablist', { name: '主工作模式' })
    .getByRole('tab', { name: label, exact: true })
  await tab.click()
  const selected = await waitFor(async () => await tab.getAttribute('aria-selected') === 'true', 10_000)
  if (!selected) throw new Error(`主工作模式未切换到 ${label}`)
}

async function listProjectSessionIds(page: Page, projectId: string): Promise<string[]> {
  return page.evaluate(async (id) => {
    const result = await (window as unknown as {
      electronAPI: {
        linguistSessionsListForProject: (input: { projectId: string }) => Promise<
          { ok: true; data: Array<{ id: string }> }
          | { ok: false; error: { code: string } }
        >
      }
    }).electronAPI.linguistSessionsListForProject({ projectId: id })
    if (result.ok === false) throw new Error(`项目会话读取失败: ${result.error.code}`)
    return result.data.map((session) => session.id)
  }, projectId)
}

async function resolveVisibleLinguistProjectList(page: Page): Promise<{
  list: Locator
  totalCount: number
  visibleCount: number
}> {
  const lists = page.getByRole('list', { name: '本地化项目', exact: true })
  let totalCount = 0
  let list = lists.first()
  let visibleCount = 0
  await waitFor(async () => {
    totalCount = await lists.count()
    visibleCount = 0
    for (let index = 0; index < totalCount; index += 1) {
      const candidate = lists.nth(index)
      if (await candidate.isVisible()) {
        list = candidate
        visibleCount += 1
      }
    }
    return visibleCount === 1
  }, 30_000)
  return { list, totalCount, visibleCount }
}

async function openSidebarProject(page: Page, projectName: string): Promise<Locator> {
  const resolved = await resolveVisibleLinguistProjectList(page)
  if (resolved.visibleCount !== 1) {
    throw new Error(`可见本地化项目列表异常: ${resolved.visibleCount}`)
  }
  await resolved.list.getByRole(
    'button',
    { name: `打开项目 ${projectName}`, exact: true },
  ).click()
  const workspace = page.locator(`section[aria-label="${projectName} 本地化工作台"]`)
  await workspace.waitFor({ timeout: 30_000 })
  return workspace
}

async function readPersistedLinguistState(
  page: Page,
  projectId: string,
): Promise<PersistedLinguistState> {
  return page.evaluate(async (id) => {
    const settings = await (window as unknown as {
      electronAPI: { getSettings: () => Promise<Record<string, unknown>> }
    }).electronAPI.getSettings()
    const tabState = settings.tabState as { tabs?: unknown[]; activeTabId?: unknown } | undefined
    const tab = tabState?.tabs?.find((candidate): candidate is PersistedLocalizationProjectTab => {
      if (!candidate || typeof candidate !== 'object') return false
      const value = candidate as Record<string, unknown>
      return value.type === 'linguist-project' && value.projectId === id && typeof value.id === 'string'
    })
    const locations = settings.linguistProjectWorkbenchLocations as Record<string, unknown> | undefined
    const rawLocation = locations?.[id]
    const location = rawLocation && typeof rawLocation === 'object'
      ? rawLocation as PersistedLinguistLocation
      : undefined
    const projectSessionIds = settings.linguistProjectAgentSessionIds as Record<string, unknown> | undefined
    return {
      tab,
      activeTabId: typeof tabState?.activeTabId === 'string' ? tabState.activeTabId : undefined,
      location,
      projectSessionId: typeof projectSessionIds?.[id] === 'string' ? projectSessionIds[id] : undefined,
    }
  }, projectId)
}

async function isPersistedLinguistState(
  page: Page,
  projectId: string,
  assetId: string,
  segmentId: string,
  sessionId?: string,
): Promise<boolean> {
  const state = await readPersistedLinguistState(page, projectId)
  return state.tab?.id === `linguist-project:${projectId}`
    && state.activeTabId === `linguist-project:${projectId}`
    && state.tab.type === 'linguist-project'
    && state.tab.projectId === projectId
    && state.tab.sessionId === undefined
    && state.location?.activeAssetId === assetId
    && state.location?.activeSegmentId === segmentId
    && (sessionId === undefined || state.projectSessionId === sessionId)
}

async function createAndOpenProjectSessionViaSidebar(
  page: Page,
  projectId: string,
): Promise<{ sessionId: string; fullAgentOpened: boolean }> {
  const resolvedProjectList = await resolveVisibleLinguistProjectList(page)
  if (resolvedProjectList.visibleCount !== 1) {
    throw new Error(
      `可见本地化项目列表异常: total=${resolvedProjectList.totalCount}` +
      `，visible=${resolvedProjectList.visibleCount}`,
    )
  }
  const projectList = resolvedProjectList.list
  const projectButton = projectList.getByRole(
    'button',
    { name: `打开项目 ${PROJECT_NAME}`, exact: true },
  )
  await projectButton.click()
  const workspace = page.locator(`section[aria-label="${PROJECT_NAME} 本地化工作台"]`)
  await workspace.waitFor({ timeout: 30_000 })
  const before = await listProjectSessionIds(page, projectId)
  if (before.length !== 0) throw new Error(`打开项目不应创建 Session，实际已有 ${before.length} 个`)

  await page.getByRole('button', { name: `在项目 ${PROJECT_NAME} 中新建会话`, exact: true }).click()
  await page.getByRole('menuitem', { name: /通用项目 Agent/u }).click()
  let createdSessionIds: string[] = []
  const created = await waitFor(async () => {
    createdSessionIds = await listProjectSessionIds(page, projectId)
    return createdSessionIds.length === 1
  }, 30_000)
  if (!created) throw new Error(`项目 Session 创建异常: ${createdSessionIds.length}`)
  const sessionId = createdSessionIds[0]!
  const fullAgent = page.locator(
    'aside[aria-label="项目 Agent"][data-workbench-slot="agent-full"]',
  )
  await fullAgent.waitFor({ timeout: 30_000 })
  const returnToWorkbench = fullAgent.getByRole(
    'button',
    { name: '返回本地化工作台', exact: true },
  )
  const fullAgentOpened = await returnToWorkbench.isVisible()
    && await projectButton.getAttribute('aria-current') === 'page'
  await returnToWorkbench.click()
  await workspace.waitFor({ timeout: 30_000 })
  return { sessionId, fullAgentOpened }
}

async function openLinguistWorkbenchAndSelectLocation(
  page: Page,
  projectId: string,
  assetId: string,
  segmentId: string,
): Promise<{
  modesDiscoverable: boolean
  legacyManagementRemoved: boolean
  multipleProjectsDiscoverable: boolean
  projectListEvidence: string
  projectActionsMenuPainted: boolean
  projectActionsMenuEvidence: string
  sidebarCurrentCorrect: boolean
  projectTabVisible: boolean
  locationVisible: boolean
}> {
  const modeTabs = page.getByRole('tablist', { name: '主工作模式' })
  const agentMode = modeTabs.getByRole('tab', { name: 'Agent', exact: true })
  const chatMode = modeTabs.getByRole('tab', { name: 'Chat', exact: true })
  const linguistMode = modeTabs.getByRole('tab', { name: '本地化', exact: true })
  const modesDiscoverable = await agentMode.isVisible()
    && await chatMode.isVisible()
    && await linguistMode.isVisible()

  await selectPrimaryMode(page, 'Agent')
  await selectPrimaryMode(page, 'Chat')
  await selectPrimaryMode(page, '本地化')
  const resolvedProjectList = await resolveVisibleLinguistProjectList(page)
  const projectList = resolvedProjectList.list
  const projectRows = projectList.getByRole('button', { name: /^打开项目 /u })
  const projectButton = projectList.getByRole(
    'button',
    { name: `打开项目 ${PROJECT_NAME}`, exact: true },
  )
  const distractorButton = projectList.getByRole(
    'button',
    { name: `打开项目 ${DISTRACTOR_PROJECT_NAME}`, exact: true },
  )
  const projectRowCount = await projectRows.count()
  const projectLabels = await projectRows.evaluateAll((buttons) => (
    buttons.map((button) => button.getAttribute('aria-label') ?? '<missing>')
  ))
  const mainCount = await projectButton.count()
  const distractorCount = await distractorButton.count()
  const mainVisible = mainCount === 1 && await projectButton.isVisible()
  const distractorVisible = distractorCount === 1 && await distractorButton.isVisible()
  const multipleProjectsDiscoverable = resolvedProjectList.visibleCount === 1
    && projectRowCount === 2
    && mainVisible
    && distractorVisible
    && new Set(projectLabels).size === 2
  const projectListEvidence = `lists=${resolvedProjectList.totalCount}` +
    `，visibleLists=${resolvedProjectList.visibleCount}，rows=${projectRowCount}` +
    `，main=${mainCount}/${mainVisible}，distractor=${distractorCount}/${distractorVisible}` +
    `，labels=${JSON.stringify(projectLabels)}`
  const legacyManagementRemoved = await page.getByRole(
    'button',
    { name: '管理项目', exact: true },
  ).count() === 0
  await projectList.getByRole(
    'button',
    { name: `管理项目 ${PROJECT_NAME}`, exact: true },
  ).click()
  const projectActionsMenu = page.locator('[role="menu"]').filter({ hasText: '重命名' })
  await projectActionsMenu.waitFor({ state: 'visible', timeout: 10_000 })
  const projectActionsPaintedPixels = countNonDominantPixels(
    await projectActionsMenu.screenshot(),
  )
  const projectActionsMenuPainted = projectActionsPaintedPixels > 100
  const projectActionsMenuEvidence = `非背景像素=${projectActionsPaintedPixels}`
  await page.keyboard.press('Escape')

  await projectButton.click()
  const workspace = page.locator(`section[aria-label="${PROJECT_NAME} 本地化工作台"]`)
  await workspace.waitFor({ timeout: 30_000 })
  const projectTabVisible = await waitFor(async () => {
    const state = await readPersistedLinguistState(page, projectId)
    const tabVisible = await page.getByRole(
      'button',
      { name: `打开标签页：${PROJECT_NAME}`, exact: true },
    ).isVisible()
    return tabVisible
      && state.tab?.id === `linguist-project:${projectId}`
      && state.activeTabId === `linguist-project:${projectId}`
      && state.tab.type === 'linguist-project'
      && state.tab.projectId === projectId
      && state.tab.sessionId === undefined
  }, 10_000)
  const sidebarCurrentCorrect = await projectButton.getAttribute('aria-current') === 'page'

  const asset = workspace.locator(`[data-asset-id="${assetId}"]`)
  await asset.click()
  const row = workspace.locator(`[role="row"][data-segment-id="${segmentId}"]`)
  await row.waitFor({ timeout: 30_000 })
  await row.getByRole('button', { name: /查看原始行 \d+ 上下文/u }).click()
  const status = workspace.locator('footer[aria-label="本地化工作台状态栏"]')
  const locationVisible = await asset.getAttribute('aria-current') === 'page'
    && await workspace.locator('header[aria-label="本地化工作台工具栏"]')
      .getByText('mini_game_ui.xliff', { exact: true }).isVisible()
    && await isSegmentStatusVisible(status, segmentId)

  for (const mode of ['Agent', '本地化', 'Chat', '本地化'] as const) {
    await selectPrimaryMode(page, mode)
    if (mode === '本地化') await workspace.waitFor({ timeout: 30_000 })
  }
  const roundtripLocationVisible = await asset.getAttribute('aria-current') === 'page'
    && await isSegmentStatusVisible(status, segmentId)
  return {
    modesDiscoverable,
    legacyManagementRemoved,
    multipleProjectsDiscoverable,
    projectListEvidence,
    projectActionsMenuPainted,
    projectActionsMenuEvidence,
    sidebarCurrentCorrect,
    projectTabVisible,
    locationVisible: locationVisible && roundtripLocationVisible,
  }
}

async function isSegmentStatusVisible(status: Locator, segmentId: string): Promise<boolean> {
  const label = status.locator(`span[title="${segmentId}"]`)
  return await label.isVisible()
    && await label.getByText(`当前片段：${segmentId.slice(0, 12)}…`, { exact: true }).isVisible()
}

async function readRecoveredLinguistLocation(
  page: Page,
  projectId: string,
  assetId: string,
  segmentId: string,
): Promise<{
  modeSelected: boolean
  projectTabVisible: boolean
  locationVisible: boolean
}> {
  const mode = page.getByRole('tablist', { name: '主工作模式' })
    .getByRole('tab', { name: '本地化', exact: true })
  const workspace = page.locator(`section[aria-label="${PROJECT_NAME} 本地化工作台"]`)
  await workspace.waitFor({ timeout: 30_000 })
  const asset = workspace.locator(`[data-asset-id="${assetId}"]`)
  const status = workspace.locator('footer[aria-label="本地化工作台状态栏"]')
  const persisted = await readPersistedLinguistState(page, projectId)
  const tabVisible = await page.getByRole(
    'button',
    { name: `打开标签页：${PROJECT_NAME}`, exact: true },
  ).isVisible()
  return {
    modeSelected: await mode.getAttribute('aria-selected') === 'true',
    projectTabVisible: tabVisible
      && persisted.tab?.id === `linguist-project:${projectId}`
      && persisted.activeTabId === `linguist-project:${projectId}`
      && persisted.tab.type === 'linguist-project'
      && persisted.tab.projectId === projectId
      && persisted.tab.sessionId === undefined,
    locationVisible: await asset.getAttribute('aria-current') === 'page'
      && await workspace.locator('header[aria-label="本地化工作台工具栏"]')
        .getByText('mini_game_ui.xliff', { exact: true }).isVisible()
      && await isSegmentStatusVisible(status, segmentId),
  }
}


async function openQaFindings(workspace: Locator): Promise<Locator> {
  const toolbar = workspace.locator('header[aria-label="本地化工作台工具栏"]')
  const resourcesButton = toolbar.getByRole('button', { name: '语言资产', exact: true })
  if (await resourcesButton.getAttribute('aria-pressed') !== 'true') {
    await resourcesButton.click()
  }
  const dock = workspace.locator('section[aria-label="语言资产面板"]')
  await dock.waitFor({ timeout: 30_000 })
  const qaTab = dock
    .getByRole('tablist', { name: '语言资产', exact: true })
    .getByRole('tab', { name: 'QA', exact: true })
  await qaTab.click()
  const qaSelected = await waitFor(
    async () => await qaTab.getAttribute('aria-selected') === 'true',
    30_000,
  )
  if (!qaSelected) throw new Error('语言资产 QA Tab 未成功打开')
  const panel = dock.getByRole('tabpanel')
  await panel.waitFor({ timeout: 30_000 })
  const findings = panel.locator('section[aria-label="QA Findings"]')
  await findings.waitFor({ timeout: 30_000 })
  return findings
}

async function runQa(findings: Locator, expectedFinding: Locator): Promise<void> {
  const button = findings.getByRole('button', { name: '运行项目 QA', exact: true })
  await button.click()
  await expectedFinding.waitFor({ timeout: 30_000 })
}

async function openDockTab(
  dock: Locator,
  label: 'TM 匹配' | '术语' | 'QA' | '上下文/证据' | '预览',
): Promise<Locator> {
  const tab = dock
    .getByRole('tablist', { name: '语言资产', exact: true })
    .getByRole('tab', { name: label, exact: true })
  await tab.click()
  const selected = await waitFor(
    async () => await tab.getAttribute('aria-selected') === 'true',
    30_000,
  )
  if (!selected) throw new Error(`语言资产 ${label} Tab 未成功打开`)
  const panel = dock.getByRole('tabpanel')
  await panel.waitFor({ timeout: 30_000 })
  return panel
}

async function readPackagedSegmentState(
  page: Page,
  projectId: string,
  segmentId: string,
  search = 'Welcome back',
): Promise<PackagedSegmentState | undefined> {
  return page.evaluate(async (input) => {
    const result = await (window as unknown as {
      electronAPI: {
        linguistCatQuery: (request: unknown) => Promise<
          {
            ok: true
            data: {
              segments: Array<{
                id: string
                target: string
                revision: number
                currentStageState: string
              }>
            }
          }
          | { ok: false; error: { code: string } }
        >
      }
    }).electronAPI.linguistCatQuery({
      projectId: input.projectId,
      search: input.search,
      limit: 10,
      offset: 0,
    })
    if (!result.ok) throw new Error(`读取片段失败: ${result.error.code}`)
    return result.data.segments.find((segment) => segment.id === input.segmentId)
  }, { projectId, segmentId, search })
}

async function verifyCleanTargetConfirmShortcut(
  page: Page,
  workspace: Locator,
  projectId: string,
  segmentId: string,
): Promise<void> {
  const row = workspace.locator(`[role="row"][data-segment-id="${segmentId}"]`)
  await row.getByRole('button', { name: /编辑原始行 \d+ 译文/u }).click()
  const editor = row.getByRole('textbox', { name: /编辑原始行 \d+ 译文/u })
  const confirm = row.getByRole('button', { name: '确认审校并前进', exact: true })
  await editor.waitFor({ timeout: 30_000 })
  const before = await readPackagedSegmentState(page, projectId, segmentId, 'Start Game')
  const enabled = await confirm.isEnabled()
  await editor.press('Meta+Enter')
  let after: PackagedSegmentState | undefined
  const confirmed = await waitFor(async () => {
    after = await readPackagedSegmentState(page, projectId, segmentId, 'Start Game')
    return after?.currentStageState === 'confirmed'
  }, 30_000)
  check(
    'lf092-clean-target-cmd-enter-confirms-review',
    enabled && confirmed && after?.target === before?.target && after?.revision === before?.revision,
    `enabled=${enabled}，stage=${after?.currentStageState ?? '<missing>'}` +
    `，target unchanged=${after?.target === before?.target}` +
    `，revision=${before?.revision ?? '<missing>'}→${after?.revision ?? '<missing>'}`,
  )
}

async function runLanguageResourceDockGate(
  page: Page,
  workspace: Locator,
  projectId: string,
  distractorProjectId: string,
  segmentId: string,
  alternateSegmentId: string,
  sourceBlobPath: string,
  sourceHashBefore: string,
): Promise<void> {
  const toolbar = workspace.locator('header[aria-label="本地化工作台工具栏"]')
  const resourcesButton = toolbar.getByRole('button', { name: '语言资产', exact: true })
  if (await resourcesButton.getAttribute('aria-pressed') !== 'true') {
    await resourcesButton.click()
  }
  const dock = workspace.locator('section[aria-label="语言资产面板"]')
  await dock.waitFor({ timeout: 30_000 })
  const tabs = dock.getByRole('tablist', { name: '语言资产', exact: true })
  for (const label of ['TM 匹配', '术语', 'QA', '上下文/证据', '预览']) {
    await tabs.getByRole('tab', { name: label, exact: true }).waitFor({ timeout: 30_000 })
  }

  const row = workspace.locator(`[role="row"][data-segment-id="${segmentId}"]`)
  await row.getByRole('button', { name: /编辑原始行 \d+ 译文/u }).click()
  const editor = row.getByRole('textbox', { name: /编辑原始行 \d+ 译文/u })
  await editor.waitFor({ timeout: 30_000 })
  const undo = row.getByRole('button', { name: '撤销译文编辑', exact: true })

  const tmPanel = await openDockTab(dock, 'TM 匹配')
  const tmMatches = tmPanel.getByRole('list', { name: '当前片段 TM 匹配', exact: true })
  await tmMatches.waitFor({ timeout: 30_000 })
  const tmTarget = '欢迎回来，{player}！'
  await tmMatches.getByRole(
    'button',
    { name: /使用 100% Client Exact TM 替换当前译文草稿/u },
  ).click()
  const replaceApplied = await waitFor(async () => await editor.inputValue() === tmTarget, 10_000)
  const afterReplace = await readPackagedSegmentState(page, projectId, segmentId)
  await undo.click()
  const replaceUndone = await waitFor(async () => await editor.inputValue() === '', 10_000)

  const tmInsertDraft = '前缀｜后缀'
  const tmInsertPrefix = '前缀'
  const tmInsertSuffix = '｜后缀'
  await editor.fill(tmInsertDraft)
  await editor.evaluate((element, caret) => {
    if (!(element instanceof HTMLTextAreaElement)) throw new Error('Target Editor 不是 textarea')
    element.setSelectionRange(caret, caret)
  }, tmInsertPrefix.length)
  await tmMatches.getByRole(
    'button',
    { name: /使用 100% Client Exact TM 插入当前译文草稿/u },
  ).click()
  const insertApplied = await waitFor(
    async () => await editor.inputValue() === `${tmInsertPrefix}${tmTarget}${tmInsertSuffix}`,
    10_000,
  )
  const afterInsert = await readPackagedSegmentState(page, projectId, segmentId)
  await undo.click()
  const insertUndone = await waitFor(
    async () => await editor.inputValue() === tmInsertDraft,
    10_000,
  )
  check(
    'lf056-tm-replace-insert-undo-draft-only',
    replaceApplied
      && insertApplied
      && replaceUndone
      && insertUndone
      && afterReplace?.target === ''
      && afterReplace.revision === 0
      && afterInsert?.target === ''
      && afterInsert.revision === 0,
    `replace/insert=${replaceApplied}/${insertApplied}` +
    `，undo=${replaceUndone}/${insertUndone}` +
    `，DB=${afterInsert?.target ?? '<missing>'}@r${afterInsert?.revision ?? '<missing>'}`,
  )

  await editor.fill('{player}')
  await editor.evaluate((element) => {
    if (!(element instanceof HTMLTextAreaElement)) throw new Error('Target Editor 不是 textarea')
    element.setSelectionRange(0, 0)
  })
  const termPanel = await openDockTab(dock, '术语')
  const termMatches = termPanel.getByRole('list', { name: '当前片段术语匹配', exact: true })
  await termMatches.waitFor({ timeout: 30_000 })
  const preferredTermMatch = termMatches.getByRole('listitem')
    .filter({ hasText: 'Welcome' })
    .filter({ hasText: '欢迎' })
  await preferredTermMatch.getByText('推荐', { exact: true }).waitFor({ timeout: 30_000 })
  const termAction = preferredTermMatch.getByRole(
    'button',
    { name: /^插入.+术语 Welcome → 欢迎到当前译文草稿$/u },
  )
  await termAction.waitFor({ timeout: 30_000 })
  const termStatusVisible = await preferredTermMatch.getByText('推荐', { exact: true }).isVisible()
  await termAction.click()
  const termInserted = await waitFor(
    async () => await editor.inputValue() === '欢迎{player}',
    10_000,
  )
  const afterTerm = await readPackagedSegmentState(page, projectId, segmentId)
  await undo.click()
  const termUndone = await waitFor(
    async () => await editor.inputValue() === '{player}',
    10_000,
  )
  check(
    'lf056-term-insert-undo-draft-only',
    termStatusVisible
      && termInserted
      && termUndone
      && afterTerm?.target === ''
      && afterTerm.revision === 0,
    `preferred status=${termStatusVisible}，insert=${termInserted}，undo=${termUndone}` +
    `，DB=${afterTerm?.target ?? '<missing>'}@r${afterTerm?.revision ?? '<missing>'}`,
  )
  await row.getByRole('button', { name: '取消编辑', exact: true }).click()

  const qaFindings = await openQaFindings(workspace)
  const emptyTargetArticle = qaFindings.locator(
    `article[aria-label="QA Finding EMPTY_TARGET for ${segmentId}"]`,
  )
  await runQa(qaFindings, emptyTargetArticle)
  const qaLabels = await qaFindings
    .locator('article[aria-label^="QA Finding "]')
    .evaluateAll((articles) => articles.map((article) => article.getAttribute('aria-label') ?? ''))
  check(
    'lf056-qa-current-segment',
    await emptyTargetArticle.isVisible()
      && qaLabels.length > 0
      && qaLabels.every((label) => label.endsWith(`for ${segmentId}`)),
    `当前片段 ${segmentId} 显示 EMPTY_TARGET，visible=${JSON.stringify(qaLabels)}`,
  )

  const contextPanel = await openDockTab(dock, '上下文/证据')
  const contextSources = contextPanel.locator('section[aria-label="片段上下文来源"]')
  const evidence = contextPanel.locator('section[aria-label="建议的证据来源"]')
  await contextSources.getByText('必须保留玩家占位符', { exact: true }).waitFor({
    timeout: 30_000,
  })
  await evidence.getByText(/tm:tmu_v2_[0-9a-f]{64}/u).waitFor({ timeout: 30_000 })
  const contextVisible = await contextSources.getByText('System', { exact: true }).isVisible()
    && await contextSources.getByText('client', { exact: true }).isVisible()
  const evidenceVisible = await evidence.getByText(/style:sgr_v2_[0-9a-f]{64}/u).isVisible()
    && await evidence.getByText(/voice:vpr_v2_[0-9a-f]{64}/u).isVisible()
    && await evidence.getByText(/context:segment-origin/u).isVisible()
    && await evidence.getByText(/term:ter_v2_[0-9a-f]{64}/u).isVisible()
  const openTermsFromEvidence = evidence.getByRole('button', { name: '查看术语', exact: true })
  await openTermsFromEvidence.click()
  const evidenceJumpedToTerms = await tabs
    .getByRole('tab', { name: '术语', exact: true })
    .getAttribute('aria-selected') === 'true'
  check(
    'lf056-context-evidence',
    contextVisible && evidenceVisible && evidenceJumpedToTerms,
    `sources=${contextVisible}，provenance=${evidenceVisible}，term jump=${evidenceJumpedToTerms}`,
  )

  const alternateRow = workspace.locator(
    `[role="row"][data-segment-id="${alternateSegmentId}"]`,
  )
  await alternateRow.getByRole('button', { name: /查看原始行 \d+ 上下文/u }).click()
  const alternateTmPanel = await openDockTab(dock, 'TM 匹配')
  await alternateTmPanel.getByText('当前片段无 TM 匹配', { exact: true }).waitFor({
    timeout: 30_000,
  })
  const alternateTermPanel = await openDockTab(dock, '术语')
  await alternateTermPanel.getByText('当前片段无术语匹配', { exact: true }).waitFor({
    timeout: 30_000,
  })
  const alternateQaPanel = await openDockTab(dock, 'QA')
  const alternateFinding = alternateQaPanel.locator(
    `article[aria-label="QA Finding EMPTY_TARGET for ${alternateSegmentId}"]`,
  )
  await alternateFinding.waitFor({ timeout: 30_000 })
  const alternateQaLabels = await alternateQaPanel
    .locator('article[aria-label^="QA Finding "]')
    .evaluateAll((articles) => articles.map((article) => article.getAttribute('aria-label') ?? ''))
  const alternateContextPanel = await openDockTab(dock, '上下文/证据')
  await alternateContextPanel.getByText('当前片段没有待查看建议', { exact: true }).waitFor({
    timeout: 30_000,
  })
  const alternateResourcesVisible = alternateQaLabels.length > 0
    && alternateQaLabels.every((label) => label.endsWith(`for ${alternateSegmentId}`))
    && await alternateContextPanel.getByText(/Main menu primary button/u).isVisible()

  await row.getByRole('button', { name: /查看原始行 \d+ 上下文/u }).click()
  const restoredTmPanel = await openDockTab(dock, 'TM 匹配')
  await restoredTmPanel.getByRole('list', { name: '当前片段 TM 匹配', exact: true }).waitFor({
    timeout: 30_000,
  })
  const restoredTermPanel = await openDockTab(dock, '术语')
  await restoredTermPanel.getByRole('list', { name: '当前片段术语匹配', exact: true }).waitFor({
    timeout: 30_000,
  })
  const restoredContextPanel = await openDockTab(dock, '上下文/证据')
  const restoredEvidence = restoredContextPanel.locator(
    'section[aria-label="建议的证据来源"]',
  )
  await restoredEvidence.getByText(/tm:tmu_v2_[0-9a-f]{64}/u).waitFor({ timeout: 30_000 })
  check(
    'lf056-active-segment-resources-refresh',
    alternateResourcesVisible
      && await restoredEvidence.getByText(/term:ter_v2_[0-9a-f]{64}/u).isVisible(),
    `alternate=${alternateSegmentId} QA=${JSON.stringify(alternateQaLabels)}` +
    `，back=${segmentId} TM/Terms/Evidence restored`,
  )

  const previewPanel = await openDockTab(dock, '预览')
  await previewPanel.getByText('mini_game_ui.xliff', { exact: true }).waitFor({ timeout: 30_000 })
  await previewPanel.getByText(/^XLIFF 1\.2 · \d+ 段 · 只读$/u).waitFor({ timeout: 30_000 })
  const agentRailButton = toolbar.getByRole('button', { name: 'Agent', exact: true })
  if (await agentRailButton.getAttribute('aria-pressed') !== 'true') {
    await agentRailButton.click()
  }
  await workspace
    .getByRole('group', { name: '项目 Agent rail 控制', exact: true })
    .waitFor({ timeout: 30_000 })
  await previewPanel
    .getByRole('button', { name: '在预览标签页中打开', exact: true })
    .click()
  const previewTab = page.getByRole(
    'button',
    { name: '打开标签页：预览：mini_game_ui.xliff', exact: true },
  )
  await previewTab.waitFor({ timeout: 30_000 })
  await previewTab.click()
  const semanticPreview = page.locator('[aria-label="批次语义预览"]')
  await semanticPreview.waitFor({ timeout: 30_000 })
  await semanticPreview.locator('li').filter({ hasText: PB074_SOURCE }).waitFor({ timeout: 30_000 })
  await page.getByRole('button', { name: '查看原始文件', exact: true }).click()
  const rawPreview = page.locator('[aria-label="原始文件预览"]')
  await rawPreview.waitFor({ timeout: 30_000 })
  await rawPreview.locator('pre').filter({ hasText: PB074_SOURCE }).waitFor({ timeout: 30_000 })
  const editablePreviewCount = await rawPreview.locator(
    'textarea, input, [contenteditable="true"]',
  ).count()
  const sourceHashAfter = fileSha256(sourceBlobPath)
  check(
    'lf056-preview-readonly-source-unchanged',
    editablePreviewCount === 0 && sourceHashBefore === sourceHashAfter,
    `editable=${editablePreviewCount}，source sha256=${sourceHashAfter.slice(0, 12)}…`,
  )

  await page
    .getByRole('button', { name: `打开标签页：${PROJECT_NAME}`, exact: true })
    .click()
  await workspace.waitFor({ timeout: 30_000 })
  if (await agentRailButton.getAttribute('aria-pressed') === 'true') {
    await agentRailButton.click()
  }
  await resourcesButton.click()
  await dock.waitFor({ state: 'hidden', timeout: 30_000 })
  await resourcesButton.click()
  await dock.waitFor({ state: 'visible', timeout: 30_000 })

  const tmTab = tabs.getByRole('tab', { name: 'TM 匹配', exact: true })
  await tmTab.focus()
  await tmTab.press('ArrowRight')
  const keyboardSelectedTerms = await tabs
    .getByRole('tab', { name: '术语', exact: true })
    .getAttribute('aria-selected') === 'true'

  const separator = dock.getByRole(
    'separator',
    { name: '调整语言资产面板高度', exact: true },
  )
  const separatorBox = await separator.boundingBox()
  if (separatorBox === null) throw new Error('语言资产面板高度分隔条不可见')
  const pointerStartHeight = Number(await separator.getAttribute('aria-valuenow'))
  await page.mouse.move(
    separatorBox.x + separatorBox.width / 2,
    separatorBox.y + separatorBox.height / 2,
  )
  await page.mouse.down()
  await page.mouse.move(
    separatorBox.x + separatorBox.width / 2,
    separatorBox.y - 80,
    { steps: 5 },
  )
  await page.mouse.up()
  const pointerHeightChanged = await waitFor(
    async () => Number(await separator.getAttribute('aria-valuenow')) > pointerStartHeight,
    10_000,
  )
  const pointerEndHeight = Number(await separator.getAttribute('aria-valuenow'))
  await separator.press('End')
  const keyboardHeight = await separator.getAttribute('aria-valuenow')
  await openDockTab(dock, '预览')

  await page.setViewportSize({ width: 900, height: 720 })
  const narrowOverlay = await dock.evaluate(
    (element) => getComputedStyle(element).position === 'absolute',
  )
  await page.setViewportSize({ width: 1280, height: 800 })

  const persisted = await waitFor(async () => {
    const state = await readPersistedLinguistState(page, projectId)
    return state.location?.bottomDockOpen === true
      && state.location.bottomDockTab === 'preview'
      && state.location.bottomDockHeight === 480
  }, 10_000)

  const distractorWorkspace = await openSidebarProject(page, DISTRACTOR_PROJECT_NAME)
  const distractorResourcesButton = distractorWorkspace
    .locator('header[aria-label="本地化工作台工具栏"]')
    .getByRole('button', { name: '语言资产', exact: true })
  if (await distractorResourcesButton.getAttribute('aria-pressed') !== 'true') {
    await distractorResourcesButton.click()
  }
  const distractorDock = distractorWorkspace.locator('section[aria-label="语言资产面板"]')
  await distractorDock.waitFor({ timeout: 30_000 })
  await openDockTab(distractorDock, '术语')
  const distractorSeparator = distractorDock.getByRole(
    'separator',
    { name: '调整语言资产面板高度', exact: true },
  )
  await distractorSeparator.press('Home')
  const distractorPersisted = await waitFor(async () => {
    const state = await readPersistedLinguistState(page, distractorProjectId)
    return state.location?.bottomDockOpen === true
      && state.location.bottomDockTab === 'terms'
      && state.location.bottomDockHeight === 160
  }, 10_000)

  const mainWorkspace = await openSidebarProject(page, PROJECT_NAME)
  const mainDock = mainWorkspace.locator('section[aria-label="语言资产面板"]')
  await mainDock.waitFor({ timeout: 30_000 })
  const mainPreviewSelected = await mainDock
    .getByRole('tablist', { name: '语言资产', exact: true })
    .getByRole('tab', { name: '预览', exact: true })
    .getAttribute('aria-selected') === 'true'
  const mainHeight = await mainDock
    .getByRole('separator', { name: '调整语言资产面板高度', exact: true })
    .getAttribute('aria-valuenow')

  const mainState = await readPersistedLinguistState(page, projectId)
  const distractorState = await readPersistedLinguistState(page, distractorProjectId)
  const isolated = mainState.location !== undefined
    && distractorState.location !== undefined
    && mainState.location.bottomDockTab === 'preview'
    && mainState.location.bottomDockHeight === 480
    && distractorState.location.bottomDockTab === 'terms'
    && distractorState.location.bottomDockHeight === 160
  check(
    'lf056-dock-project-isolation',
    pointerHeightChanged
      && keyboardSelectedTerms
      && keyboardHeight === '480'
      && narrowOverlay
      && persisted
      && distractorPersisted
      && isolated
      && mainPreviewSelected
      && mainHeight === '480',
    `pointer=${pointerHeightChanged} (${pointerStartHeight}→${pointerEndHeight})` +
      `，键盘 Tab=${keyboardSelectedTerms}，height=${keyboardHeight}` +
      `，narrow overlay=${narrowOverlay}，main persisted=${persisted}` +
      `，distractor persisted=${distractorPersisted}，isolated=${isolated}`,
  )
}

async function verifyLanguageResourceDockRecovery(
  page: Page,
  workspace: Locator,
  projectId: string,
  distractorProjectId: string,
): Promise<void> {
  const dock = workspace.locator('section[aria-label="语言资产面板"]')
  await dock.waitFor({ timeout: 30_000 })
  const previewTab = dock
    .getByRole('tablist', { name: '语言资产', exact: true })
    .getByRole('tab', { name: '预览', exact: true })
  const separator = dock.getByRole(
    'separator',
    { name: '调整语言资产面板高度', exact: true },
  )
  const mainState = await readPersistedLinguistState(page, projectId)
  const mainRestored = await previewTab.getAttribute('aria-selected') === 'true'
    && await separator.getAttribute('aria-valuenow') === '480'
    && mainState.location?.bottomDockOpen === true
    && mainState.location.bottomDockTab === 'preview'
    && mainState.location.bottomDockHeight === 480

  const distractorWorkspace = await openSidebarProject(page, DISTRACTOR_PROJECT_NAME)
  const distractorDock = distractorWorkspace.locator('section[aria-label="语言资产面板"]')
  await distractorDock.waitFor({ timeout: 30_000 })
  const distractorState = await readPersistedLinguistState(page, distractorProjectId)
  const distractorRestored = await distractorDock
    .getByRole('tablist', { name: '语言资产', exact: true })
    .getByRole('tab', { name: '术语', exact: true })
    .getAttribute('aria-selected') === 'true'
    && await distractorDock
      .getByRole('separator', { name: '调整语言资产面板高度', exact: true })
      .getAttribute('aria-valuenow') === '160'
    && distractorState.location?.bottomDockOpen === true
    && distractorState.location.bottomDockTab === 'terms'
    && distractorState.location.bottomDockHeight === 160

  const mainWorkspace = await openSidebarProject(page, PROJECT_NAME)
  const mainDock = mainWorkspace.locator('section[aria-label="语言资产面板"]')
  await mainDock.waitFor({ timeout: 30_000 })
  const mainStillRestored = await mainDock
    .getByRole('tablist', { name: '语言资产', exact: true })
    .getByRole('tab', { name: '预览', exact: true })
    .getAttribute('aria-selected') === 'true'
    && await mainDock
      .getByRole('separator', { name: '调整语言资产面板高度', exact: true })
      .getAttribute('aria-valuenow') === '480'
  check(
    'lf056-dock-restart-restores-layout',
    mainRestored && distractorRestored && mainStillRestored,
    `main=${mainState.location?.bottomDockTab}/${mainState.location?.bottomDockHeight}` +
      `，distractor=${distractorState.location?.bottomDockTab}/${distractorState.location?.bottomDockHeight}` +
      `，roundtrip=${mainStillRestored}`,
  )
}

/** 可选的 packaged 视觉证据；未设置目录时默认 smoke 路径零变化。 */
async function captureLinguistUiEvidence(page: Page): Promise<void> {
  if (UI_EVIDENCE_DIR === undefined) return
  mkdirSync(UI_EVIDENCE_DIR, { recursive: true })

  const applyTheme = async (themeMode: 'dark' | 'light'): Promise<void> => {
    await page.evaluate(async (mode) => {
      window.localStorage.setItem('proma-theme-mode', mode)
      const settings = await (window as unknown as {
        electronAPI: {
          updateSettings: (updates: { themeMode: 'dark' | 'light' }) => Promise<{ themeMode: string }>
        }
      }).electronAPI.updateSettings({ themeMode: mode })
      if (settings.themeMode !== mode) throw new Error(`主题未保存：${settings.themeMode}`)
    }, themeMode)
    await page.reload({ waitUntil: 'domcontentloaded' })
    await page.waitForFunction(
      () => typeof (window as unknown as { electronAPI?: unknown }).electronAPI === 'object',
      undefined,
      { timeout: 60_000 },
    )
    await page.waitForFunction(
      (dark) => document.documentElement.classList.contains('dark') === dark,
      themeMode === 'dark',
      { timeout: 30_000 },
    )
  }

  const locateSurface = async (): Promise<{ workspace: Locator; sidebar: Locator }> => {
    const activeWorkspace = page.locator(`section[aria-label="${PROJECT_NAME} 本地化工作台"]`)
    await activeWorkspace.waitFor({ timeout: 30_000 })
    const { list: projectList } = await resolveVisibleLinguistProjectList(page)
    const projectButton = projectList.getByRole(
      'button',
      { name: `打开项目 ${PROJECT_NAME}`, exact: true },
    )
    const sidebarRestored = await waitFor(
      async () => await projectButton.getAttribute('aria-current') === 'page',
      30_000,
    )
    if (!sidebarRestored) throw new Error('视觉证据截图前未恢复当前本地化项目侧边栏')
    return { workspace: activeWorkspace, sidebar: projectList }
  }

  const saveScreenshot = async (filename: string): Promise<void> => {
    await page.evaluate(async () => {
      await document.fonts.ready
      return true
    })
    await page.screenshot({
      path: join(UI_EVIDENCE_DIR, filename),
      animations: 'disabled',
    })
  }

  await page.setViewportSize({ width: 1280, height: 800 })
  await applyTheme('dark')
  await locateSurface()
  await saveScreenshot('01-dark-linguist-sidebar-workbench.png')

  await applyTheme('light')
  let surface = await locateSurface()
  await saveScreenshot('02-light-linguist-sidebar-workbench.png')

  await page.setViewportSize({ width: 900, height: 720 })
  await page.waitForFunction(() => window.innerWidth === 900 && window.innerHeight === 720)
  surface = await locateSurface()
  await saveScreenshot('03-narrow-light-linguist-sidebar-workbench.png')

  const [workspaceBox, sidebarBox, toolbarBox, layout] = await Promise.all([
    surface.workspace.boundingBox(),
    surface.sidebar.boundingBox(),
    surface.workspace
      .locator('header[aria-label="本地化工作台工具栏"]')
      .boundingBox(),
    page.evaluate(() => ({
      viewportWidth: window.innerWidth,
      documentOverflow: Math.max(
        document.documentElement.scrollWidth,
        document.body.scrollWidth,
      ) - window.innerWidth,
    })),
  ])
  const boxes = [workspaceBox, sidebarBox, toolbarBox]
  const keyRectsInsideViewport = boxes.every(
    (box) => box !== null && box.x >= -1 && box.x + box.width <= layout.viewportWidth + 1,
  )
  check(
    'lf056-ui-evidence-light-dark-narrow',
    layout.documentOverflow <= 1 && keyRectsInsideViewport,
    `screenshots=${UI_EVIDENCE_DIR}，overflow=${layout.documentOverflow}px` +
      `，侧边栏/工作台/工具栏未越界=${keyRectsInsideViewport}`,
  )

  await page.setViewportSize({ width: 1280, height: 800 })
  await applyTheme('dark')
  await locateSurface()
}

async function openProjectAssetsSettings(
  page: Page,
  workspace: Locator,
): Promise<{ sheet: Locator; assets: Locator }> {
  const toolbar = workspace.locator('header[aria-label="本地化工作台工具栏"]')
  await toolbar.getByRole('button', { name: '项目设置', exact: true }).click()
  const sheet = page.getByRole('dialog', { name: '项目设置', exact: true })
  await sheet.waitFor({ timeout: 30_000 })
  await sheet.getByRole('heading', { name: '项目设置', exact: true }).waitFor({ timeout: 30_000 })
  const resourcesTab = sheet
    .getByRole('tablist', { name: '项目设置分类', exact: true })
    .getByRole('tab', { name: '语言资产', exact: true })
  await resourcesTab.click()
  const resourcesSelected = await waitFor(
    async () => await resourcesTab.getAttribute('aria-selected') === 'true',
    30_000,
  )
  if (!resourcesSelected) throw new Error('项目设置语言资产 Tab 未成功打开')
  const assets = sheet.locator('section[aria-label="批次（文件）"]')
  await assets.waitFor({ timeout: 30_000 })
  return { sheet, assets }
}

/** 真实 packaged 主进程：CAT 备份/恢复使用 node:sqlite，完整性扫描使用 worker_threads。 */
async function verifyPackagedCatInfrastructure(
  page: Page,
  projectId: string,
  segmentId: string,
): Promise<{
  backupRestored: boolean
  workerCompleted: boolean
  evidence: string
}> {
  return page.evaluate(async (input) => {
    const api = (window as unknown as {
      electronAPI: {
        linguistCatQuery: (request: unknown) => Promise<
          { ok: true; data: { segments: Array<{ id: string; target: string; revision: number }> } }
          | { ok: false; error: { code: string } }
        >
        linguistProjectsBackup: (request: unknown) => Promise<
          { ok: true; data: { backupName: string; fileCount: number; method: string } }
          | { ok: false; error: { code: string } }
        >
        linguistBackupsPreviewRestore: (request: unknown) => Promise<
          { ok: true; data: { restorable: boolean; verification?: { ok: boolean } } }
          | { ok: false; error: { code: string } }
        >
        linguistCatEditSegment: (request: unknown) => Promise<
          { ok: true; data: { target: string; revision: number } }
          | { ok: false; error: { code: string } }
        >
        linguistBackupsRestore: (request: unknown) => Promise<
          { ok: true; data: { preRestoreName: string } }
          | { ok: false; error: { code: string } }
        >
        linguistIntegrityStart: (request: unknown) => Promise<
          { ok: true; data: { jobId: string } }
          | { ok: false; error: { code: string } }
        >
        onLinguistIntegrityProgress: (callback: (event: unknown) => void) => () => void
      }
    }).electronAPI
    const query = async () => {
      const result = await api.linguistCatQuery({
        projectId: input.projectId,
        search: 'Welcome back',
        limit: 10,
        offset: 0,
      })
      return result.ok ? result.data.segments.find((segment) => segment.id === input.segmentId) : undefined
    }
    const before = await query()
    if (before === undefined) {
      return { backupRestored: false, workerCompleted: false, evidence: '读取恢复前 Segment 失败' }
    }

    const backup = await api.linguistProjectsBackup({ projectId: input.projectId })
    if (!backup.ok) {
      return { backupRestored: false, workerCompleted: false, evidence: `backup=${backup.error.code}` }
    }
    const preview = await api.linguistBackupsPreviewRestore({
      projectId: input.projectId,
      backupName: backup.data.backupName,
    })
    const edited = await api.linguistCatEditSegment({
      projectId: input.projectId,
      segmentId: input.segmentId,
      target: 'packaged backup smoke mutation',
      expectedRevision: before.revision,
    })
    const mutated = await query()
    const restored = await api.linguistBackupsRestore({
      projectId: input.projectId,
      backupName: backup.data.backupName,
    })
    const after = await query()

    const events: Array<Record<string, unknown>> = []
    const unsubscribe = api.onLinguistIntegrityProgress((event) => {
      if (typeof event === 'object' && event !== null) events.push(event as Record<string, unknown>)
    })
    const started = await api.linguistIntegrityStart({ projectId: input.projectId })
    let terminal: Record<string, unknown> | undefined
    if (started.ok) {
      const deadline = Date.now() + 60_000
      while (Date.now() < deadline) {
        terminal = events.find((event) => (
          event.jobId === started.data.jobId
          && (event.state === 'completed' || event.state === 'failed' || event.state === 'cancelled')
        ))
        if (terminal !== undefined) break
        await new Promise<void>((resolve) => window.setTimeout(resolve, 100))
      }
    }
    unsubscribe()

    const report = terminal?.report as Record<string, unknown> | undefined
    const backupRestored = preview.ok
      && preview.data.restorable
      && preview.data.verification?.ok === true
      && edited.ok
      && mutated?.target === 'packaged backup smoke mutation'
      && restored.ok
      && restored.data.preRestoreName.startsWith('pre-restore-')
      && after?.target === before.target
      && after?.revision === before.revision
    const workerCompleted = started.ok
      && terminal?.state === 'completed'
      && report?.executor === 'worker_thread'
      && typeof report.workerThreadId === 'number'
      && report.workerThreadId > 0
      && report.outcome === 'passed'
    return {
      backupRestored,
      workerCompleted,
      evidence: `backup=${backup.data.method}/${backup.data.fileCount}` +
        `，preview=${preview.ok ? preview.data.restorable : preview.error.code}` +
        `，edit=${edited.ok}` +
        `，restore=${restored.ok ? restored.data.preRestoreName : restored.error.code}` +
        `，worker=${terminal?.state ?? (started.ok ? 'timeout' : started.error.code)}` +
        `/${report?.executor ?? 'none'}/${report?.workerThreadId ?? 'none'}`,
    }
  }, { projectId, segmentId })
}

async function main(): Promise<void> {
  console.log('=== PB-074 packaged vertical E2E ===')
  console.log(` packaged binary: ${PACKAGED_BINARY}`)
  if (!existsSync(PACKAGED_BINARY)) {
    check('packaged-binary-exists', false, `未找到 ${PACKAGED_BINARY}`)
    summarizeAndExit(1)
  }
  check('packaged-binary-exists', true, PACKAGED_BINARY)

  const tmpHome = mkdtempSync(join(tmpdir(), 'proma-pb074-probe-home-'))
  const artifactDir = mkdtempSync(join(tmpdir(), 'proma-pb074-probe-artifacts-'))
  const logStream = createWriteStream(join(artifactDir, 'main-process.log'))
  const linguistRoot = join(tmpHome, '.linguist-agent', 'linguist')
  console.log(` tmp HOME: ${tmpHome}`)
  console.log(` artifacts: ${artifactDir}`)

  let server: FakeModelServer | undefined
  let launched: LaunchedApp | undefined
  let projectId = ''
  let assetId = ''
  let segmentId = ''
  let alternateSegmentId = ''
  let sourceBlobPath = ''
  let sourceHashBefore = ''
  let channelId = ''
  let sessionId = ''

  try {
    launched = await launchApp(tmpHome, logStream)
    await enterMainUI(launched.page)
    projectId = await createProjectViaUi(launched.page)
    check('create-project-ui', projectId.length > 0, `项目 ${projectId}，en-US → zh-CN`)

    await quitApp(launched.app)
    launched = undefined

    const imported = runCli([
      'import',
      '--root', linguistRoot,
      '--project', projectId,
      '--file', FIXTURE_PATH,
    ])
    assetId = cliField(imported, 'asset')
    sourceBlobPath = join(
      linguistRoot,
      'projects',
      projectId,
      cliField(imported, 'source-blob'),
    )
    sourceHashBefore = fileSha256(sourceBlobPath)
    const importedSegments = Number(cliField(imported, 'segments'))
    const segmentsOutput = runCli([
      'segments',
      '--root', linguistRoot,
      '--project', projectId,
      '--asset', assetId,
      '--limit', '100',
    ])
    const importedSegmentRows = segmentsOutput
      .split('\n')
      .filter((line) => line.startsWith('{'))
      .map((line) => JSON.parse(line) as { id: string; source: string; target: string; revision: number })
    const welcome = importedSegmentRows.find((segment) => segment.source === PB074_SOURCE)
    if (welcome === undefined) throw new Error(`XLIFF 导入后找不到源文 ${PB074_SOURCE}`)
    const alternate = importedSegmentRows.find((segment) => segment.source === 'Start Game')
    if (alternate === undefined) throw new Error('XLIFF 导入后找不到备用片段 Start Game')
    segmentId = welcome.id
    alternateSegmentId = alternate.id
    check(
      'import-xliff-headless-seam',
      importedSegments === 7 && welcome.target === '' && welcome.revision === 0,
      `mini_game_ui.xliff → ${importedSegments} 段，Welcome=${segmentId}，target 为空`,
    )
    if (!LF056_ONLY) {
      manual('native-open-dialog', 'Playwright 不驱动 macOS Open；真实 XLIFF 由 PB-025 CLI 导入同一项目库')
    }
    if (LF056_ONLY) {
      runCli([
        'edit',
        '--root', linguistRoot,
        '--project', projectId,
        '--segment', alternateSegmentId,
        '--target', '',
        '--expected-revision', String(alternate.revision),
      ])
      const seeded = runLf056FixtureSeeder(linguistRoot, projectId, segmentId)
      check(
        'lf056-public-repository-fixture',
        PROPOSAL_ID_PATTERN.test(seeded),
        `公共 repository fixture=${seeded}`,
      )
    }
    const distractor = runCli([
      'create-project',
      '--root', linguistRoot,
      '--name', DISTRACTOR_PROJECT_NAME,
      '--source', 'en-US',
      '--target', 'zh-CN',
    ])
    const distractorProjectId = cliField(distractor, 'project')
    check(
      'lf026-two-project-restore-fixture',
      distractorProjectId.length > 0 && distractorProjectId !== projectId,
      `待恢复项目=${projectId}，更新的干扰项目=${distractorProjectId}`,
    )

    if (!LF026_ONLY && !LF056_ONLY) {
      server = await startFakeModelServer(0, { captureTools: true })
    }
    launched = await launchApp(tmpHome, logStream)
    await enterMainUI(launched.page)
    if (server !== undefined) {
      channelId = await seedChannel(launched.page, server)
    }
    const navigation = await openLinguistWorkbenchAndSelectLocation(
      launched.page,
      projectId,
      assetId,
      segmentId,
    )
    check(
      'lf026-linguist-navigation-discoverable',
      navigation.modesDiscoverable
        && navigation.legacyManagementRemoved
        && navigation.multipleProjectsDiscoverable
        && navigation.projectActionsMenuPainted
        && navigation.sidebarCurrentCorrect
        && navigation.projectTabVisible
        && navigation.locationVisible,
      `三模式=${navigation.modesDiscoverable}，旧管理入口已移除=${navigation.legacyManagementRemoved}` +
      `，两个项目身份明确=${navigation.multipleProjectsDiscoverable}` +
      `（${navigation.projectListEvidence}）` +
      `，项目菜单已绘制=${navigation.projectActionsMenuPainted}` +
      `（${navigation.projectActionsMenuEvidence}）` +
      `，侧栏 aria-current=${navigation.sidebarCurrentCorrect}` +
      `，Project Tab=${navigation.projectTabVisible}，Asset/Segment=${navigation.locationVisible}`,
    )
    await captureLinguistUiEvidence(launched.page)
    if (!LF026_ONLY && !LF056_ONLY) {
      const workflowStage = await launched.page.evaluate(async (id) => {
        const result = await (window as unknown as {
          electronAPI: {
            linguistProjectsSetWorkflowConfig: (request: unknown) => Promise<
              { ok: true; data: { workflowStage?: string } }
              | { ok: false; error: { code: string } }
            >
          }
        }).electronAPI.linguistProjectsSetWorkflowConfig({
          projectId: id,
          workflowStage: 'editing',
          outputStatusPolicy: null,
          qaProfile: 'general',
        })
        if (!result.ok) throw new Error(`设置审校阶段失败: ${result.error.code}`)
        return result.data.workflowStage
      }, projectId)
      check(
        'lf092-review-workflow-fixture',
        workflowStage === 'editing',
        `workflowStage=${workflowStage ?? '<missing>'}`,
      )
    }
    if (LF056_ONLY) {
      const workspace = launched.page.locator(`section[aria-label="${PROJECT_NAME} 本地化工作台"]`)
      await runLanguageResourceDockGate(
        launched.page,
        workspace,
        projectId,
        distractorProjectId,
        segmentId,
        alternateSegmentId,
        sourceBlobPath,
        sourceHashBefore,
      )
    }

    await quitApp(launched.app)
    launched = undefined
    launched = await launchApp(tmpHome, logStream)
    await enterMainUI(launched.page)
    const recoveredNavigation = await readRecoveredLinguistLocation(
      launched.page,
      projectId,
      assetId,
      segmentId,
    )
    check(
      'lf026-restart-recovers-project-location',
      recoveredNavigation.modeSelected
        && recoveredNavigation.projectTabVisible
        && recoveredNavigation.locationVisible,
      `Linguist=${recoveredNavigation.modeSelected}，Project Tab=${recoveredNavigation.projectTabVisible}` +
      `，Asset/Segment=${recoveredNavigation.locationVisible}`,
    )
    if (LF056_ONLY) {
      const workspace = launched.page.locator(`section[aria-label="${PROJECT_NAME} 本地化工作台"]`)
      await verifyLanguageResourceDockRecovery(
        launched.page,
        workspace,
        projectId,
        distractorProjectId,
      )
    }

    if (!LF026_ONLY && !LF056_ONLY) {
      const workspace = launched.page.locator(`section[aria-label="${PROJECT_NAME} 本地化工作台"]`)
      await workspace.waitFor({ timeout: 30_000 })
      await verifyCleanTargetConfirmShortcut(
        launched.page,
        workspace,
        projectId,
        alternateSegmentId,
      )
      await workspace
        .locator(`[role="row"][data-segment-id="${segmentId}"]`)
        .getByRole('button', { name: /查看原始行 \d+ 上下文/u })
        .click()

      const projectSession = await createAndOpenProjectSessionViaSidebar(launched.page, projectId)
      sessionId = projectSession.sessionId
      const persistedBeforeExit = await waitFor(
        () => isPersistedLinguistState(launched!.page, projectId, assetId, segmentId, sessionId),
        10_000,
      )
      check(
        'lf026-sidebar-session-and-persistence',
        projectSession.fullAgentOpened && persistedBeforeExit,
        `侧栏 Session=${sessionId}，Full Agent=${projectSession.fullAgentOpened}` +
        `，tab/location/session 已持久化=${persistedBeforeExit}`,
      )

      if (server === undefined) throw new Error('Fake Model Server 未启动')
      await workspace.waitFor({ timeout: 30_000 })
      const agentSettings = await launched.page.evaluate(async () => {
        const settings = await (window as unknown as {
          electronAPI: { getSettings: () => Promise<Record<string, unknown>> }
        }).electronAPI.getSettings()
        return {
          channelId: typeof settings.agentChannelId === 'string' ? settings.agentChannelId : undefined,
          modelId: typeof settings.agentModelId === 'string' ? settings.agentModelId : undefined,
        }
      })
      const agentPanelButton = workspace
        .locator('header[aria-label="本地化工作台工具栏"]')
        .getByRole('button', { name: 'Agent', exact: true })
      const agentRail = workspace.locator('aside[aria-label="项目 Agent"]')
      if (await agentPanelButton.getAttribute('aria-pressed') === 'true') {
        const scrim = workspace.locator('[data-workbench-slot="agent-rail-scrim"]')
        if (await scrim.isVisible()) await scrim.click({ position: { x: 8, y: 200 } })
        else await agentPanelButton.click()
        await waitFor(async () => await agentPanelButton.getAttribute('aria-pressed') === 'false', 10_000)
      }
      const row = workspace.locator(`[role="row"][data-segment-id="${segmentId}"]`)
      await row.waitFor({ timeout: 30_000 })
      const segmentCheckbox = row.getByRole('checkbox')
      await segmentCheckbox.check()
      const segmentSelected = await segmentCheckbox.isChecked()
      await agentPanelButton.click()
      const railOpen = await waitFor(
        async () => await agentPanelButton.getAttribute('aria-pressed') === 'true'
          && await agentRail.isVisible(),
        30_000,
      )
      const quickAction = workspace.getByRole('button', { name: '翻译已选', exact: true })
      const quickActionReady = await quickAction.isVisible() && await quickAction.isEnabled()
      const projectSessionIds = await listProjectSessionIds(launched.page, projectId)
      const configReady = agentSettings.channelId === channelId
        && agentSettings.modelId === MODEL_ID
      const sessionReady = projectSessionIds.includes(sessionId)
      check(
        'pb074-project-agent-ready',
        configReady && sessionReady && railOpen && segmentSelected && quickActionReady,
        `channel=${agentSettings.channelId ?? 'none'}/${channelId}` +
        `，model=${agentSettings.modelId ?? 'none'}/${MODEL_ID}` +
        `，session=${sessionId}/${sessionReady}` +
        `，rail=${railOpen}，selected=${segmentSelected}，quickAction=${quickActionReady}`,
      )
      if (!configReady || !sessionReady || !railOpen || !segmentSelected || !quickActionReady) {
        throw new Error('项目 Agent 快捷翻译前置条件未就绪')
      }

      await installEventCollectors(launched.page)
      const logsBefore = server.logs.length
      const completed = await translateSelectedAndWaitComplete(launched.page, workspace, sessionId)
      const logs = server.logs.slice(logsBefore).filter(
        (entry) => entry.model === MODEL_ID && entry.stream === true,
      )
      const events = await getEvents(launched.page)
      const sessionErrors = events.errors.filter((event) => event.sessionId === sessionId)
      const toolNames = events.toolUses
        .filter((event) => event.sessionId === sessionId)
        .map((event) => event.name)
      const readResultSeen = logs.some(
        (entry) => entry.hasToolMessage === true && entry.toolResultText?.includes(PB074_SOURCE) === true,
      )
      const proposalResultSeen = logs.some(
        (entry) => entry.hasToolMessage === true
          && entry.toolResultText !== undefined
          && PROPOSAL_ID_PATTERN.test(entry.toolResultText),
      )
      const finalSeen = events.texts.some(
        (event) => event.sessionId === sessionId && event.text.includes(PB074_FINAL_MARKER),
      )
      check(
        'model-reads-then-proposes',
        completed
          && logs.length >= 3
          && toolNames.includes(FAKE_CAT_TOOL_NAME)
          && toolNames.includes(FAKE_CAT_PROPOSAL_TOOL_NAME)
          && readResultSeen
          && proposalResultSeen
          && finalSeen
          && sessionErrors.length === 0,
        `complete=${completed}，requests=${logs.length}，tools=${toolNames.join('→')}` +
        `，read result=${readResultSeen}，proposal result=${proposalResultSeen}，final=${finalSeen}` +
        `，errors=${sessionErrors.length === 0
          ? 'none'
          : sessionErrors.map((event) => event.error).join(' | ')}`,
      )

      await selectPrimaryMode(launched.page, '本地化')
      await workspace.waitFor({ timeout: 30_000 })
      const scrim = workspace.locator('[data-workbench-slot="agent-rail-scrim"]')
      if (await scrim.isVisible()) {
        await scrim.click({ position: { x: 8, y: 200 } })
        await scrim.waitFor({ state: 'hidden', timeout: 10_000 })
      }
      await row.getByRole('button', { name: /查看原始行 \d+ 上下文/u }).click()
      const proposalReview = row.locator('section[aria-label="当前行翻译建议"]')
      await proposalReview.waitFor({ timeout: 30_000 })
      await proposalReview.getByText(PB074_PROPOSAL_TARGET, { exact: true }).waitFor({ timeout: 30_000 })

      const qaFindings = await openQaFindings(workspace)
      const emptyTargetArticle = qaFindings.locator(
        `article[aria-label="QA Finding EMPTY_TARGET for ${segmentId}"]`,
      )
      await runQa(qaFindings, emptyTargetArticle)
      const blocking = await launched.page.evaluate(async (input) => {
        const api = (window as unknown as {
          electronAPI: {
            linguistCatListQaFindings: (request: unknown) => Promise<
              { ok: true; data: { items: Array<{ code: string; severity: string; segmentId: string }> } }
              | { ok: false; error: { code: string } }
            >
            linguistExportsSaveAsset: (request: unknown) => Promise<
              { ok: true; data: unknown }
              | { ok: false; error: { code: string } }
            >
          }
        }).electronAPI
        const findings = await api.linguistCatListQaFindings({
          projectId: input.projectId,
          status: 'open',
          severity: 'L1',
          limit: 100,
          offset: 0,
        })
        const exportAttempt = await api.linguistExportsSaveAsset({
          projectId: input.projectId,
          assetId: input.assetId,
        })
        return {
          emptyTarget: findings.ok && findings.data.items.some(
            (finding) => finding.code === 'EMPTY_TARGET' && finding.segmentId === input.segmentId,
          ),
          exportCode: exportAttempt.ok === true ? 'OK' : exportAttempt.error.code,
        }
      }, { projectId, assetId, segmentId })
      check(
        'qa-blocks-export-before-human-fix',
        blocking.emptyTarget && blocking.exportCode === 'EXPORT_BLOCKED_BY_QA',
        `EMPTY_TARGET=${blocking.emptyTarget}，export=${blocking.exportCode}（原生 Save 未打开）`,
      )

      await proposalReview.getByRole('button', { name: '接受', exact: true }).click()
      await proposalReview.waitFor({ state: 'detached', timeout: 30_000 })
      const accepted = await launched.page.evaluate(async (input) => {
        const result = await (window as unknown as {
          electronAPI: {
            linguistCatQuery: (request: unknown) => Promise<
              { ok: true; data: { segments: Array<{ id: string; target: string; revision: number }> } }
              | { ok: false; error: { code: string } }
            >
          }
        }).electronAPI.linguistCatQuery({
          projectId: input.projectId,
          search: 'Welcome back',
          limit: 10,
          offset: 0,
        })
        return result.ok ? result.data.segments.find((segment) => segment.id === input.segmentId) : undefined
      }, { projectId, segmentId })
      check(
        'human-accepts-proposal',
        accepted?.target === PB074_PROPOSAL_TARGET && accepted.revision === 1,
        `target=${accepted?.target ?? '<missing>'}，revision=${accepted?.revision ?? '<missing>'}`,
      )

      const repeatedArticle = qaFindings.locator(
        `article[aria-label="QA Finding REPEATED_PUNCTUATION for ${segmentId}"]`,
      )
      await runQa(qaFindings, repeatedArticle)
      await repeatedArticle.getByRole('button', { name: '豁免此条', exact: true }).click()
      await repeatedArticle.getByPlaceholder('填写豁免原因').fill(WAIVER_REASON)
      await repeatedArticle.getByRole('button', { name: '确认豁免', exact: true }).click()
      await repeatedArticle.waitFor({ state: 'detached', timeout: 30_000 })
      const waived = await launched.page.evaluate(async (input) => {
        const api = (window as unknown as {
          electronAPI: {
            linguistCatListQaFindings: (request: unknown) => Promise<
              { ok: true; data: { items: Array<{ code: string; segmentId: string; waiverReason?: string }> } }
              | { ok: false; error: { code: string } }
            >
          }
        }).electronAPI
        const result = await api.linguistCatListQaFindings({
          projectId: input.projectId,
          status: 'waived',
          limit: 100,
          offset: 0,
        })
        const blocking = await api.linguistCatListQaFindings({
          projectId: input.projectId,
          status: 'open',
          severity: 'L1',
          limit: 100,
          offset: 0,
        })
        return {
          finding: result.ok
            ? result.data.items.find(
              (finding) => finding.code === 'REPEATED_PUNCTUATION' && finding.segmentId === input.segmentId,
            )
            : undefined,
          openBlocking: blocking.ok ? blocking.data.items.length : -1,
        }
      }, { projectId, segmentId })
      check(
        'human-waives-qa-with-reason',
        waived.finding?.waiverReason === WAIVER_REASON && waived.openBlocking === 0,
        `REPEATED_PUNCTUATION waiver=${waived.finding?.waiverReason ?? '<missing>'}，open blocking=${waived.openBlocking}`,
      )

      const infrastructure = await verifyPackagedCatInfrastructure(launched.page, projectId, segmentId)
      check(
        'packaged-cat-backup-restore-and-worker',
        infrastructure.backupRestored && infrastructure.workerCompleted,
        infrastructure.evidence,
      )

      const projectSettings = await openProjectAssetsSettings(launched.page, workspace)
      const exportButtonReady = await projectSettings.assets.getByRole(
        'button',
        { name: '导出 mini_game_ui.xliff', exact: true },
      ).isEnabled()
      check('packaged-export-entry-ready', exportButtonReady, `导出按钮可用=${exportButtonReady}`)
      manual(
        'native-save-dialog',
        '不点击原生 Save；PB-073 注入 picker nodetest 覆盖 staging→Save→copy，仍需人工真机点选一次',
      )
      const closeProjectSettings = projectSettings.sheet.getByRole(
        'button',
        { name: 'Close', exact: true },
      )
      const closeButtonReady = await closeProjectSettings.isVisible()
      await closeProjectSettings.click()
      const projectSettingsClosed = await waitFor(
        async () => !await projectSettings.sheet.isVisible(),
        30_000,
      )
      check(
        'lf092-project-settings-close-button',
        closeButtonReady && projectSettingsClosed,
        `close visible=${closeButtonReady}，sheet hidden=${projectSettingsClosed}`,
      )
      const persistedAtExit = await waitFor(
        () => isPersistedLinguistState(launched!.page, projectId, assetId, segmentId, sessionId),
        10_000,
      )
      check(
        'lf026-final-persistence-before-exit',
        persistedAtExit,
        `退出前 tab/location/session 已持久化=${persistedAtExit}`,
      )

      await quitApp(launched.app)
      launched = undefined

      const exported = runCli([
        'export',
        '--root', linguistRoot,
        '--project', projectId,
        '--asset', assetId,
        '--out', EXPORT_RELATIVE_PATH,
      ])
      const exportPath = cliField(exported, 'path')
      const exportId = cliField(exported, 'export')
      const exportSha = cliField(exported, 'sha256')
      const verified = runCli([
        'verify',
        '--root', linguistRoot,
        '--project', projectId,
        '--asset', assetId,
        '--export', EXPORT_RELATIVE_PATH,
      ])
      check(
        'export-reimport-verify',
        /^exp_v2_[0-9a-f]{64}$/.test(exportId)
          && exportSha.length === 64
          && existsSync(exportPath)
          && cliField(verified, 'verify') === 'OK'
          && Number(cliField(verified, 'segments')) === 7,
        `artifact=${exportId}，sha256=${exportSha.slice(0, 12)}…，reimport=${cliField(verified, 'verify')}` +
        `，segments=${cliField(verified, 'segments')}`,
      )

      launched = await launchApp(tmpHome, logStream)
      await enterMainUI(launched.page)
      const finalRecoveredNavigation = await readRecoveredLinguistLocation(
        launched.page,
        projectId,
        assetId,
        segmentId,
      )
      const finalPersisted = await isPersistedLinguistState(
        launched.page,
        projectId,
        assetId,
        segmentId,
        sessionId,
      )
      const recovered = await launched.page.evaluate(async (input) => {
        const api = (window as unknown as {
          electronAPI: {
            linguistCatQuery: (request: unknown) => Promise<
              { ok: true; data: { segments: Array<{ id: string; target: string; revision: number }> } }
              | { ok: false; error: { code: string } }
            >
            linguistCatListQaFindings: (request: unknown) => Promise<
              { ok: true; data: { items: Array<{ code: string; segmentId: string; waiverReason?: string }> } }
              | { ok: false; error: { code: string } }
            >
            linguistSessionsListForProject: (request: unknown) => Promise<
              { ok: true; data: Array<{ id: string }> }
              | { ok: false; error: { code: string } }
            >
          }
        }).electronAPI
        const segments = await api.linguistCatQuery({
          projectId: input.projectId,
          search: 'Welcome back',
          limit: 10,
          offset: 0,
        })
        const findings = await api.linguistCatListQaFindings({
          projectId: input.projectId,
          status: 'waived',
          limit: 100,
          offset: 0,
        })
        const sessions = await api.linguistSessionsListForProject({ projectId: input.projectId })
        const segment = segments.ok
          ? segments.data.segments.find((candidate) => candidate.id === input.segmentId)
          : undefined
        const finding = findings.ok
          ? findings.data.items.find(
            (candidate) => candidate.code === 'REPEATED_PUNCTUATION' && candidate.segmentId === input.segmentId,
          )
          : undefined
        return {
          target: segment?.target,
          revision: segment?.revision,
          waiverReason: finding?.waiverReason,
          sessionRecovered: sessions.ok && sessions.data.some((session) => session.id === input.sessionId),
        }
      }, { projectId, segmentId, sessionId })
      check(
        'restart-recovers-delivery-state',
        recovered.target === PB074_PROPOSAL_TARGET
          && recovered.revision === 1
          && recovered.waiverReason === WAIVER_REASON
          && recovered.sessionRecovered
          && finalRecoveredNavigation.modeSelected
          && finalRecoveredNavigation.projectTabVisible
          && finalRecoveredNavigation.locationVisible
          && finalPersisted
          && existsSync(exportPath),
        `target/revision=${recovered.target}/${recovered.revision}，waiver=${recovered.waiverReason === WAIVER_REASON}` +
        `，session=${recovered.sessionRecovered}，Linguist/location=${finalRecoveredNavigation.modeSelected}/${finalRecoveredNavigation.locationVisible}` +
        `，persisted=${finalPersisted}，artifact=${existsSync(exportPath)}`,
      )
      check(
        'temp-home-isolation',
        projectId.length > 0 && exportPath.startsWith(linguistRoot),
        `所有项目/会话/artifact 均位于 ${tmpHome}`,
      )
    }
  } catch (error) {
    check('runner-completed', false, error instanceof Error ? error.message : String(error))
  } finally {
    if (launched !== undefined) await quitApp(launched.app)
    if (server !== undefined) await server.close()
    try {
      await closeLogStream(logStream)
    } finally {
      rmSync(tmpHome, { recursive: true, force: true })
    }
    console.log(` 已清理 tmp HOME；诊断 artifact 保留于 ${artifactDir}`)
  }

  summarizeAndExit(results.some((result) => !result.pass) ? 1 : 0)
}

function summarizeAndExit(code: number): never {
  const passed = results.filter((result) => result.pass).length
  const failed = results.length - passed
  console.log(`\n=== PB-074 探针结果：${passed} PASS / ${failed} FAIL / ${manualCount} MANUAL ===`)
  process.exit(code)
}

main().catch((error) => {
  console.error('PB-074 探针执行异常:', error)
  if (activeApp !== undefined) {
    try {
      activeApp.process.kill('SIGKILL')
    } catch (killError) {
      console.warn('[PB-074] 异常收尾时进程已退出:', killError)
    }
  }
  process.exit(1)
})
