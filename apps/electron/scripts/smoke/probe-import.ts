#!/usr/bin/env node
/**
 * LF-048 无 Agent 手工 CAT packaged Gate。
 *
 * 复用既有临时 HOME、CLI fixture 与 Playwright Electron 接缝，只验证当前
 * Linguist Workbench / Segment Grid / Bottom Dock。真实 IME 与 macOS Native
 * Save 无法由 Playwright 可靠驱动，默认明确记为 MANUAL；传入
 * --manual-verify 时保持应用运行，等待人工操作后由探针核验权威状态。
 *
 * 运行：
 * node --experimental-transform-types \
 *   --import ../../packages/linguist-cat-store/test/register-ts-loader.mjs \
 *   scripts/smoke/probe-import.ts
 *
 * 手工闭环：
 * 上述命令末尾追加 --manual-verify，并按终端打印的路径与动作完成操作。
 */

import { createHash } from 'node:crypto'
import { _electron as electron, type ElectronApplication, type Locator, type Page } from 'playwright-core'
import { execFileSync, spawnSync, type ChildProcess } from 'node:child_process'
import {
  createWriteStream,
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
  type WriteStream,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join, resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { CatStore } from '@linguist/cat-store'

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url))
const APP_DIR = resolve(SCRIPT_DIR, '..', '..')
/** apps/electron/scripts/smoke → 上溯四级到仓根（smoke→scripts→electron→apps→root） */
const REPO_ROOT = resolve(SCRIPT_DIR, '..', '..', '..', '..')
const CLI_DIR = join(REPO_ROOT, 'packages', 'linguist-cat-store')
const FIXTURES_DIR = join(REPO_ROOT, 'tests', 'linguist-fixtures')

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
const PACKAGED_APP = dirname(dirname(dirname(PACKAGED_BINARY)))
const MANUAL_VERIFY = process.argv.includes('--manual-verify')
const LF048_MANUAL_BUNDLE_ID = 'com.linguistagent.lf048.manual-verification'

// ===== 结果收集 =====

interface CheckResult {
  name: string
  pass: boolean
  evidence: string
}

const results: CheckResult[] = []
let manualCount = 0

function check(name: string, pass: boolean, evidence: string): void {
  results.push({ name, pass, evidence })
  const tag = pass ? 'PASS' : 'FAIL'
  console.log(`[${tag}] ${name} — ${evidence}`)
}

function manual(name: string, evidence: string): void {
  manualCount += 1
  console.log(`[MANUAL] ${name} — ${evidence}`)
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

// ===== headless 播种（PB-025 CLI；node 运行，与应用共享同一 linguist 根布局） =====

interface SeededAsset {
  assetId: string
  filename: string
  formatId: string
  segments: number
  sha256: string
}

/** 运行 cat-store CLI，返回 stdout（stderr 的 ExperimentalWarning 忽略）。
 *  node 取 process.execPath（探针自身运行的 node），不依赖 PATH 解析。 */
function runCli(args: string[]): string {
  return execFileSync(
    process.execPath,
    ['--experimental-transform-types', '--import', './test/register-ts-loader.mjs', 'src/cli.ts', ...args],
    { cwd: CLI_DIR, encoding: 'utf8' },
  )
}

function isStaleEditRejectedByCas(
  linguistRoot: string,
  projectId: string,
  segmentId: string,
): boolean {
  const attempt = spawnSync(
    process.execPath,
    [
      '--experimental-transform-types',
      '--import',
      './test/register-ts-loader.mjs',
      'src/cli.ts',
      'edit',
      '--root',
      linguistRoot,
      '--project',
      projectId,
      '--segment',
      segmentId,
      '--target',
      '陈旧写入不得成功：{player}！',
      '--expected-revision',
      '3',
    ],
    { cwd: CLI_DIR, encoding: 'utf8' },
  )
  return attempt.status === 4 && attempt.stderr.includes('REVISION_CONFLICT')
}

function cliField(output: string, key: string): string {
  const line = output.split('\n').find((l) => l.startsWith(`${key}: `))
  if (line === undefined) throw new Error(`CLI 输出缺少字段 ${key}: ${output}`)
  return line.slice(key.length + 2).trim()
}

function readCliSegment(
  linguistRoot: string,
  projectId: string,
  segmentId: string,
): { id: string; source: string; target: string; revision: number; locked: boolean; ordinal: number } {
  const line = runCli([
    'segments',
    '--root',
    linguistRoot,
    '--project',
    projectId,
    '--limit',
    '200',
  ]).split('\n').find((candidate) => candidate.includes(`"id":"${segmentId}"`))
  if (line === undefined) throw new Error(`CLI 未返回 Segment ${segmentId}`)
  return JSON.parse(line) as {
    id: string
    source: string
    target: string
    revision: number
    locked: boolean
    ordinal: number
  }
}

function seedProjectWithAssets(linguistRoot: string, name: string, fixtures: string[]): { projectId: string; assets: SeededAsset[] } {
  const created = runCli(['create-project', '--root', linguistRoot, '--name', name, '--source', 'en', '--target', 'zh-CN'])
  const projectId = cliField(created, 'project')
  const assets: SeededAsset[] = []
  for (const fixture of fixtures) {
    const fixturePath = resolve(FIXTURES_DIR, fixture)
    const out = runCli(['import', '--root', linguistRoot, '--project', projectId, '--file', fixturePath])
    assets.push({
      assetId: cliField(out, 'asset'),
      filename: basename(fixturePath),
      formatId: cliField(out, 'format'),
      segments: Number.parseInt(cliField(out, 'segments'), 10),
      sha256: cliField(out, 'source-sha256'),
    })
  }
  return { projectId, assets }
}

function seed10kProject(
  linguistRoot: string,
  fixtureDir: string,
): { projectId: string; assetId: string; importMs: number } {
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
  const imported = runCli(['import', '--root', linguistRoot, '--project', projectId, '--file', fixture])
  return {
    projectId,
    assetId: cliField(imported, 'asset'),
    importMs: performance.now() - startedAt,
  }
}

function seedReferences(linguistRoot: string, projectId: string): void {
  const store = new CatStore({ rootDir: linguistRoot })
  const db = store.openProject(projectId)
  try {
    db.tmUnits.importMany([{
      source: 'Welcome back, {player}!',
      target: '欢迎回来，{player}！',
      sourceLocale: 'en',
      targetLocale: 'zh-CN',
      origin: 'project',
    }])
    db.termEntries.importMany([{
      term: 'player',
      translation: '玩家',
      status: 'preferred',
      caseSensitive: false,
      note: 'LF-048 synthetic term',
    }])
  } finally {
    db.close()
  }
}

function sha256(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex')
}

function placeholderCount(value: string, placeholder: string): number {
  return value.split(placeholder).length - 1
}

interface ManualAppClone {
  rootDir: string
  appPath: string
  binaryPath: string
  sourceAsarSha: string
  clonedAsarSha: string
}

function setPlistString(infoPlist: string, key: string, value: string): void {
  const setResult = spawnSync(
    '/usr/libexec/PlistBuddy',
    ['-c', `Set :${key} ${value}`, infoPlist],
    { encoding: 'utf8' },
  )
  if (setResult.status === 0) return
  execFileSync(
    '/usr/libexec/PlistBuddy',
    ['-c', `Add :${key} string ${value}`, infoPlist],
  )
}

function createManualAppClone(): ManualAppClone {
  const rootDir = mkdtempSync(join(tmpdir(), 'linguist-lf048-app-'))
  const appPath = join(rootDir, 'LF048 Manual Verification.app')
  try {
    execFileSync('/bin/cp', ['-cR', PACKAGED_APP, appPath])
    const infoPlist = join(appPath, 'Contents', 'Info.plist')
    setPlistString(infoPlist, 'CFBundleIdentifier', LF048_MANUAL_BUNDLE_ID)
    setPlistString(infoPlist, 'CFBundleDisplayName', 'LF048 Manual Verification')
    execFileSync('/usr/bin/codesign', ['--force', '--deep', '--sign', '-', appPath])

    const sourceAsarSha = sha256(join(PACKAGED_APP, 'Contents', 'Resources', 'app.asar'))
    const clonedAsarSha = sha256(join(appPath, 'Contents', 'Resources', 'app.asar'))
    return {
      rootDir,
      appPath,
      binaryPath: join(appPath, 'Contents', 'MacOS', basename(PACKAGED_BINARY)),
      sourceAsarSha,
      clonedAsarSha,
    }
  } catch (error) {
    rmSync(rootDir, { recursive: true, force: true })
    throw error
  }
}

async function waitForManualSentinel(sentinelPath: string): Promise<void> {
  let interrupted = false
  const deadline = Date.now() + MANUAL_SENTINEL_TIMEOUT_MS
  const onInterrupt = (): void => {
    interrupted = true
  }
  process.once('SIGINT', onInterrupt)
  process.once('SIGTERM', onInterrupt)
  try {
    while (!existsSync(sentinelPath)) {
      if (interrupted) throw new Error('手工验证等待已中断')
      if (Date.now() >= deadline) {
        throw new Error(`手工验证等待超时（${MANUAL_SENTINEL_TIMEOUT_MS / 60_000} 分钟）`)
      }
      await sleep(500)
    }
  } finally {
    process.off('SIGINT', onInterrupt)
    process.off('SIGTERM', onInterrupt)
  }
}

// ===== 应用启动 =====

interface LaunchedApp {
  app: ElectronApplication
  page: Page
}

/** 模块级追踪当前活跃 app 实例：launch 中途失败时 finally 仍能清理，不遗留进程 */
let activeApp: ElectronApplication | undefined
let activeProcess: ChildProcess | undefined

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

async function launchApp(
  tmpHome: string,
  logStream: WriteStream,
  executablePath: string,
): Promise<LaunchedApp> {
  const app = await electron.launch({
    executablePath,
    args: [`--user-data-dir=${join(tmpHome, '.electron-user-data')}`],
    env: { ...process.env, HOME: tmpHome, LINGUIST_SMOKE_PLAINTEXT_CREDENTIALS: '1' } as Record<string, string>,
    timeout: 120_000,
  })
  activeApp = app
  activeProcess = app.process()
  activeProcess.stdout?.pipe(logStream, { end: false })
  activeProcess.stderr?.pipe(logStream, { end: false })

  const page = await waitForMainWindow(app, 120_000)
  page.setDefaultTimeout(60_000)
  await page.waitForFunction(
    () => typeof (window as unknown as { electronAPI?: unknown }).electronAPI === 'object',
    undefined,
    { timeout: 60_000 },
  )
  return { app, page }
}

async function quitApp(app: ElectronApplication): Promise<void> {
  const proc = activeProcess ?? app.process()
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
  if (activeProcess === proc) activeProcess = undefined
}

// ===== 主流程 =====

const PROJECT_NAME = 'LF-048 手工 CAT Gate'
const TEN_K_PROJECT_NAME = 'LF-048 10k Grid'
const FIXTURE_NAME = 'mini_game_ui.xliff'
const WELCOME_SOURCE = 'Welcome back, {player}!'
const TM_TARGET = '欢迎回来，{player}！'
const SAVED_TARGET = '手工保存：{player}！'
const CONFIRMED_TARGET = '手工确认：{player}！'
const CONCURRENT_TARGET = '并发译文：{player}！'
const MANUAL_IME_TARGET = '真实 IME：你好，{player}！'
const ARCHIVED_PROJECT_NAME = 'LF-048 PB-033 归档只读'
const MANUAL_SENTINEL_TIMEOUT_MS = 30 * 60_000

interface CliSegment {
  id: string
  source: string
  target: string
  revision: number
  locked: boolean
  ordinal: number
}

function listCliSegments(linguistRoot: string, projectId: string, assetId?: string): CliSegment[] {
  return runCli([
    'segments',
    '--root', linguistRoot,
    '--project', projectId,
    ...(assetId === undefined ? [] : ['--asset', assetId]),
    '--limit', '200',
  ]).split('\n')
    .filter((line) => line.startsWith('{'))
    .map((line) => JSON.parse(line) as CliSegment)
}

async function enterMainUi(page: Page): Promise<void> {
  await page.evaluate(() =>
    (window as unknown as {
      electronAPI: { updateSettings: (updates: unknown) => Promise<unknown> }
    }).electronAPI.updateSettings({ onboardingCompleted: true }),
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
  } catch {
    // 无引导条时无需处理。
  }
}

async function visibleProjectList(page: Page): Promise<Locator> {
  const lists = page.getByRole('list', { name: '本地化项目', exact: true })
  let visible = lists.first()
  const found = await waitFor(async () => {
    let count = 0
    for (let index = 0; index < await lists.count(); index += 1) {
      const candidate = lists.nth(index)
      if (await candidate.isVisible()) {
        visible = candidate
        count += 1
      }
    }
    return count === 1
  }, 30_000)
  if (!found) throw new Error('未找到唯一可见的 Linguist 项目列表')
  return visible
}

async function openProject(
  page: Page,
  projectName: string,
  assetId: string,
): Promise<Locator> {
  const mode = page.getByRole('tablist', { name: '主工作模式' })
    .getByRole('tab', { name: 'Linguist', exact: true })
  if (await mode.getAttribute('aria-selected') !== 'true') await mode.click()
  const projectList = await visibleProjectList(page)
  await projectList.getByRole(
    'button',
    { name: `打开项目 ${projectName}`, exact: true },
  ).click()
  const workspace = page.locator(`section[aria-label="${projectName} 本地化工作台"]`)
  await workspace.waitFor({ timeout: 30_000 })
  const asset = workspace.locator(`[data-asset-id="${assetId}"]`)
  await asset.waitFor({ timeout: 30_000 })
  await asset.click()
  await workspace.getByRole('grid', { name: 'Segment Grid', exact: true })
    .waitFor({ timeout: 30_000 })
  return workspace
}

async function projectSessionCount(page: Page, projectId: string): Promise<number> {
  return page.evaluate(async (id) => {
    const result = await (window as unknown as {
      electronAPI: {
        linguistSessionsListForProject: (input: { projectId: string }) => Promise<
          { ok: true; data: Array<{ id: string }> }
          | { ok: false; error: { code: string } }
        >
      }
    }).electronAPI.linguistSessionsListForProject({ projectId: id })
    if (!result.ok) throw new Error(`项目会话读取失败：${result.error.code}`)
    return result.data.length
  }, projectId)
}

async function openDockTab(workspace: Locator, label: 'TM 匹配' | '术语' | 'QA'): Promise<Locator> {
  const toolbar = workspace.locator('header[aria-label="本地化工作台工具栏"]')
  const resources = toolbar.getByRole('button', { name: '资源', exact: true })
  if (await resources.getAttribute('aria-pressed') !== 'true') await resources.click()
  const dock = workspace.locator('section[aria-label="语言资源面板"]')
  await dock.waitFor({ timeout: 30_000 })
  const tab = dock.getByRole('tablist', { name: '语言资源', exact: true })
    .getByRole('tab', { name: label, exact: true })
  await tab.click()
  await waitFor(async () => await tab.getAttribute('aria-selected') === 'true', 10_000)
  return dock.getByRole('tabpanel')
}

async function openExportSettings(page: Page, workspace: Locator): Promise<{
  sheet: Locator
  exportButton: Locator
}> {
  await workspace.locator('header[aria-label="本地化工作台工具栏"]')
    .getByRole('button', { name: '项目设置', exact: true }).click()
  const sheet = page.getByRole('dialog', { name: '项目设置', exact: true })
  await sheet.waitFor({ timeout: 30_000 })
  const resourcesTab = sheet.getByRole('tablist', { name: '项目设置分类', exact: true })
    .getByRole('tab', { name: '资源', exact: true })
  await resourcesTab.click()
  const assets = sheet.locator('section[aria-label="资产（文件）"]')
  await assets.waitFor({ timeout: 30_000 })
  return {
    sheet,
    exportButton: assets.getByRole('button', { name: `导出 ${FIXTURE_NAME}`, exact: true }),
  }
}

async function readPersistedLocation(
  page: Page,
  projectId: string,
): Promise<{ assetId?: string; segmentId?: string }> {
  return page.evaluate(async (id) => {
    const settings = await (window as unknown as {
      electronAPI: { getSettings: () => Promise<Record<string, unknown>> }
    }).electronAPI.getSettings()
    const locations = settings.linguistProjectWorkbenchLocations as Record<string, unknown> | undefined
    const raw = locations?.[id]
    if (!raw || typeof raw !== 'object') return {}
    const location = raw as Record<string, unknown>
    return {
      assetId: typeof location.activeAssetId === 'string' ? location.activeAssetId : undefined,
      segmentId: typeof location.activeSegmentId === 'string' ? location.activeSegmentId : undefined,
    }
  }, projectId)
}

async function closeLogStream(stream: WriteStream): Promise<void> {
  await new Promise<void>((resolveClose) => stream.end(resolveClose))
}

interface ManualImeEvidence {
  compositionStarts: number
  compositionEnds: number
  commandEnterDuringComposition: number
  shortcutKeptEditorOpen: boolean
}

interface ManualNativeSaveEvidence {
  rejectionObserved: boolean
  rejectionText: string
}

async function observeManualNativeSaveRejection(page: Page): Promise<void> {
  await page.evaluate(() => {
    const evidence: ManualNativeSaveEvidence = {
      rejectionObserved: false,
      rejectionText: '',
    }
    ;(window as unknown as {
      __lf048ManualNativeSaveEvidence?: ManualNativeSaveEvidence
    }).__lf048ManualNativeSaveEvidence = evidence
    const scanAlerts = (): void => {
      for (const alert of document.querySelectorAll('[role="alert"]')) {
        const text = alert.textContent ?? ''
        if (
          text.includes('导出失败')
          && text.includes('导出目标已存在')
          && text.includes('INVALID_INPUT')
        ) {
          evidence.rejectionObserved = true
          evidence.rejectionText = text.replace(/\s+/gu, ' ').trim()
        }
      }
    }
    new MutationObserver(scanAlerts).observe(document.body, {
      childList: true,
      subtree: true,
      characterData: true,
    })
    scanAlerts()
  })
}

async function readManualNativeSaveEvidence(page: Page): Promise<ManualNativeSaveEvidence> {
  return page.evaluate(() => {
    return (window as unknown as {
      __lf048ManualNativeSaveEvidence?: ManualNativeSaveEvidence
    }).__lf048ManualNativeSaveEvidence ?? {
      rejectionObserved: false,
      rejectionText: '',
    }
  })
}

async function observeManualIme(editor: Locator): Promise<void> {
  await editor.evaluate((element) => {
    interface BrowserManualImeEvidence {
      compositionStarts: number
      compositionEnds: number
      commandEnterDuringComposition: number
      shortcutKeptEditorOpen: boolean
      composing: boolean
    }
    const evidence: BrowserManualImeEvidence = {
      compositionStarts: 0,
      compositionEnds: 0,
      commandEnterDuringComposition: 0,
      shortcutKeptEditorOpen: false,
      composing: false,
    }
    ;(window as unknown as {
      __lf048ManualImeEvidence?: BrowserManualImeEvidence
    }).__lf048ManualImeEvidence = evidence
    element.addEventListener('compositionstart', () => {
      evidence.compositionStarts += 1
      evidence.composing = true
    })
    element.addEventListener('compositionend', () => {
      evidence.compositionEnds += 1
      evidence.composing = false
    })
    element.addEventListener('keydown', (event) => {
      const keyboardEvent = event as KeyboardEvent
      if (
        keyboardEvent.key === 'Enter'
        && (keyboardEvent.metaKey || keyboardEvent.ctrlKey)
        && (evidence.composing || keyboardEvent.isComposing)
      ) {
        evidence.commandEnterDuringComposition += 1
        setTimeout(() => {
          evidence.shortcutKeptEditorOpen = element.isConnected
        }, 150)
      }
    })
  })
}

async function readManualImeEvidence(page: Page): Promise<ManualImeEvidence> {
  return page.evaluate(() => {
    const evidence = (window as unknown as {
      __lf048ManualImeEvidence?: ManualImeEvidence
    }).__lf048ManualImeEvidence
    return evidence ?? {
      compositionStarts: 0,
      compositionEnds: 0,
      commandEnterDuringComposition: 0,
      shortcutKeptEditorOpen: false,
    }
  })
}

async function main(): Promise<void> {
  console.log('=== LF-048 packaged 无 Agent 手工 CAT Gate ===')
  console.log(` packaged binary: ${PACKAGED_BINARY}`)
  if (!existsSync(PACKAGED_BINARY)) {
    check('packaged-binary-exists', false, `未找到 ${PACKAGED_BINARY}，请先运行 bun run smoke:pack`)
    summarizeAndExit(1)
  }
  check('packaged-binary-exists', true, PACKAGED_BINARY)

  const tmpHome = mkdtempSync(join(tmpdir(), 'linguist-lf048-home-'))
  const artifactDir = mkdtempSync(join(tmpdir(), 'linguist-lf048-artifacts-'))
  const logStream = createWriteStream(join(artifactDir, 'main-process.log'))
  const linguistRoot = join(tmpHome, '.linguist-agent', 'linguist')
  const repositoryFixture = join(FIXTURES_DIR, FIXTURE_NAME)
  const sourceFixture = MANUAL_VERIFY ? join(artifactDir, FIXTURE_NAME) : repositoryFixture
  const manualSafeExportPath = join(artifactDir, 'mini_game_ui.translated.zh-CN.xliff')
  const sentinelPath = join(artifactDir, 'LF048_MANUAL_DONE')
  let launched: LaunchedApp | undefined
  let manualClone: ManualAppClone | undefined

  console.log(` tmp HOME: ${tmpHome}`)
  console.log(` artifacts: ${artifactDir}`)

  try {
    manualClone = MANUAL_VERIFY ? createManualAppClone() : undefined
    const executablePath = manualClone?.binaryPath ?? PACKAGED_BINARY
    if (MANUAL_VERIFY) writeFileSync(sourceFixture, readFileSync(repositoryFixture))
    const seeded = seedProjectWithAssets(
      linguistRoot,
      PROJECT_NAME,
      [sourceFixture, 'mini_items.json'],
    )
    const archivedSeed = seedProjectWithAssets(linguistRoot, ARCHIVED_PROJECT_NAME, [])
    new CatStore({ rootDir: linguistRoot }).archiveProject(archivedSeed.projectId)
    const asset = seeded.assets.find((candidate) => candidate.filename === FIXTURE_NAME)
    const secondaryAsset = seeded.assets.find((candidate) => candidate.filename === 'mini_items.json')
    if (asset === undefined || secondaryAsset === undefined) {
      throw new Error('PB-033 fixture 资产播种不完整')
    }
    seedReferences(linguistRoot, seeded.projectId)
    const seeded10k = seed10kProject(linguistRoot, artifactDir)
    const segments = listCliSegments(linguistRoot, seeded.projectId, asset.assetId)
    const welcome = segments.find((segment) => segment.source === WELCOME_SOURCE)
    const locked = segments.find((segment) => segment.locked)
    if (welcome === undefined || locked === undefined) {
      throw new Error('fixture 缺少 Welcome 或 locked Segment')
    }
    const next = segments.find((segment) => segment.ordinal === welcome.ordinal + 1)
    if (next === undefined || next.locked) throw new Error('Welcome 后缺少可编辑 Segment')
    const cloneAsarIdentical = manualClone === undefined
      || manualClone.sourceAsarSha === manualClone.clonedAsarSha
    check(
      MANUAL_VERIFY ? 'cli-seed-and-manual-app-asar-identical' : 'cli-seed',
      asset.segments === 7
        && seeded.assets.length === 2
        && seeded10k.projectId !== seeded.projectId
        && cloneAsarIdentical,
      `${FIXTURE_NAME}=7 段；PB-033 assets=2；10k=${seeded10k.projectId}` +
      `；TM/TB 已播种；manual clone app.asar 一致=${cloneAsarIdentical}`,
    )
    if (!cloneAsarIdentical) throw new Error('手工验证 clone 的 app.asar SHA 与生产包不一致')

    launched = await launchApp(tmpHome, logStream, executablePath)
    await enterMainUi(launched.page)
    const page = launched.page
    const workspace = await openProject(page, PROJECT_NAME, asset.assetId)
    const cat = workspace.locator('section[aria-label="Segment 编辑器"]')
    const toolbar = workspace.locator('header[aria-label="本地化工作台工具栏"]')
    const agentButton = toolbar.getByRole('button', { name: 'Agent', exact: true })
    const noAgent = await projectSessionCount(page, seeded.projectId) === 0
      && await agentButton.getAttribute('aria-pressed') === 'false'
      && await workspace.locator('aside[aria-label="项目 Agent"]').count() === 0
    check('project-sessions-remain-empty', noAgent, `Session=0，Agent rail 未打开=${noAgent}`)

    const welcomeRow = cat.locator(`[role="row"][data-segment-id="${welcome.id}"]`)
    const lockedRow = cat.locator(`[role="row"][data-segment-id="${locked.id}"]`)
    const nextRow = cat.locator(`[role="row"][data-segment-id="${next.id}"]`)
    await welcomeRow.waitFor({ timeout: 30_000 })
    await welcomeRow.getByRole(
      'button',
      { name: `查看原始行 ${welcome.ordinal + 1} 上下文`, exact: true },
    ).click()

    const qaPanel = await openDockTab(workspace, 'QA')
    const qaFindings = qaPanel.locator('section[aria-label="当前片段 QA Findings"]')
    await qaFindings.getByRole('button', { name: '运行整个项目 QA', exact: true }).click()
    const emptyTarget = qaFindings.locator(
      `article[aria-label="QA Finding EMPTY_TARGET for ${welcome.id}"]`,
    )
    const qaWithoutAgent = await emptyTarget.waitFor({ timeout: 30_000 })
      .then(() => true).catch(() => false)
      && await projectSessionCount(page, seeded.projectId) === 0
    check('cat-qa-without-agent', qaWithoutAgent, `EMPTY_TARGET=${qaWithoutAgent}，Session=0`)

    await welcomeRow.focus()
    await welcomeRow.press('Enter')
    let editor = welcomeRow.getByRole(
      'textbox',
      { name: `编辑原始行 ${welcome.ordinal + 1} 译文`, exact: true },
    )
    await editor.fill('丢失占位符')
    const hardRail = await welcomeRow.getByText('必须保留源文中的标签和占位符', { exact: true })
      .isVisible()
      && await welcomeRow.getByRole('button', { name: '保存译文', exact: true }).isDisabled()
    await editor.fill('会被取消：{player}！')
    await welcomeRow.getByRole('button', { name: '取消编辑', exact: true }).click()
    const cancelled = readCliSegment(linguistRoot, seeded.projectId, welcome.id)
    check(
      'cat-edit-cancel',
      hardRail && cancelled.target === '' && cancelled.revision === 0,
      `hard rail=${hardRail}，取消后 revision=${cancelled.revision}，target 为空=${cancelled.target === ''}`,
    )

    await welcomeRow.getByRole(
      'button',
      { name: `编辑原始行 ${welcome.ordinal + 1} 译文`, exact: true },
    ).click()
    editor = welcomeRow.getByRole(
      'textbox',
      { name: `编辑原始行 ${welcome.ordinal + 1} 译文`, exact: true },
    )
    const tmPanel = await openDockTab(workspace, 'TM 匹配')
    const tmReplace = tmPanel.getByRole(
      'button',
      { name: /使用 100% Project Exact TM 替换当前译文草稿/u },
    )
    await tmReplace.waitFor({ timeout: 30_000 })
    await tmReplace.click()
    const tmDraft = await editor.inputValue()
    check(
      'cat-tm-replace-draft',
      tmDraft === TM_TARGET && readCliSegment(linguistRoot, seeded.projectId, welcome.id).revision === 0,
      `draft=${tmDraft}，DB revision 仍为 0`,
    )

    await editor.evaluate((element) => {
      const textarea = element as HTMLTextAreaElement
      textarea.setSelectionRange(0, 0)
    })
    const termPanel = await openDockTab(workspace, '术语')
    const termInsert = termPanel.getByRole(
      'button',
      { name: /插入.*术语 player → 玩家.*当前译文草稿/u },
    )
    await termInsert.waitFor({ timeout: 30_000 })
    await termInsert.click()
    const termDraft = await editor.inputValue()
    check(
      'cat-term-insert-draft',
      termDraft.includes('玩家') && termDraft.includes('{player}')
        && readCliSegment(linguistRoot, seeded.projectId, welcome.id).revision === 0,
      `draft=${termDraft}，占位符保留=${termDraft.includes('{player}')}，DB 未写`,
    )
    await welcomeRow.getByRole('button', { name: '取消编辑', exact: true }).click()

    await welcomeRow.getByRole(
      'button',
      { name: `编辑原始行 ${welcome.ordinal + 1} 译文`, exact: true },
    ).click()
    editor = welcomeRow.getByRole(
      'textbox',
      { name: `编辑原始行 ${welcome.ordinal + 1} 译文`, exact: true },
    )
    const placeholderChip = await welcomeRow.locator('[data-target-token="true"]')
      .filter({ hasText: '{player}' }).isVisible()
    await editor.fill(SAVED_TARGET)
    await welcomeRow.getByRole('button', { name: '保存译文', exact: true }).click()
    await editor.waitFor({ state: 'detached', timeout: 30_000 })
    const saved = readCliSegment(linguistRoot, seeded.projectId, welcome.id)
    check(
      'cat-edit-save-tag-placeholder',
      placeholderChip && saved.target === SAVED_TARGET && saved.revision === 1,
      `Tag/Placeholder chip=${placeholderChip}，target=${saved.target}，revision=${saved.revision}`,
    )

    await welcomeRow.getByRole(
      'button',
      { name: `编辑原始行 ${welcome.ordinal + 1} 译文`, exact: true },
    ).click()
    editor = welcomeRow.getByRole(
      'textbox',
      { name: `编辑原始行 ${welcome.ordinal + 1} 译文`, exact: true },
    )
    await editor.fill(CONFIRMED_TARGET)
    await welcomeRow.getByRole('button', { name: '确认译文并前进', exact: true }).click()
    const advanced = await waitFor(
      () => page.evaluate(
        (segmentId) => document.activeElement?.closest('[role="row"]')?.getAttribute('data-segment-id') === segmentId,
        next.id,
      ),
      30_000,
    )
    const confirmed = readCliSegment(linguistRoot, seeded.projectId, welcome.id)
    check(
      'cat-edit-confirm-and-advance',
      advanced && confirmed.target === CONFIRMED_TARGET && confirmed.revision === 2
        && await nextRow.getAttribute('aria-current') === 'true',
      `target/revision=${confirmed.target}/${confirmed.revision}，下一行焦点/active=${advanced}`,
    )

    await welcomeRow.getByRole(
      'button',
      { name: `查看原始行 ${welcome.ordinal + 1} 上下文`, exact: true },
    ).click()
    await welcomeRow.getByRole(
      'button',
      { name: `编辑原始行 ${welcome.ordinal + 1} 译文`, exact: true },
    ).click()
    editor = welcomeRow.getByRole(
      'textbox',
      { name: `编辑原始行 ${welcome.ordinal + 1} 译文`, exact: true },
    )
    await editor.fill('不得覆盖并发内容：{player}！')
    runCli([
      'edit',
      '--root', linguistRoot,
      '--project', seeded.projectId,
      '--segment', welcome.id,
      '--target', CONCURRENT_TARGET,
      '--expected-revision', '2',
    ])
    await welcomeRow.getByRole('button', { name: '保存译文', exact: true }).click()
    const conflict = await welcomeRow.getByText('译文已有更新，草稿尚未覆盖最新内容。', { exact: true })
      .waitFor({ timeout: 30_000 }).then(() => true).catch(() => false)
    const afterConflict = readCliSegment(linguistRoot, seeded.projectId, welcome.id)
    await welcomeRow.getByRole('button', { name: '重新加载最新译文', exact: true }).click()
    const latestLoaded = await waitFor(async () => await editor.inputValue() === CONCURRENT_TARGET, 30_000)
    check(
      'cat-edit-cas-conflict-no-overwrite',
      conflict && latestLoaded
        && afterConflict.target === CONCURRENT_TARGET && afterConflict.revision === 3,
      `conflict=${conflict}，latest=${latestLoaded}，DB=${afterConflict.target}/${afterConflict.revision}`,
    )
    await welcomeRow.getByRole('button', { name: '取消编辑', exact: true }).click()

    const lockedButton = lockedRow.getByRole(
      'button',
      { name: `原始行 ${locked.ordinal + 1} 已锁定，无法编辑`, exact: true },
    )
    const lockedDisabled = await lockedButton.isDisabled()
    await lockedRow.dblclick()
    check(
      'cat-locked-fail-closed',
      lockedDisabled && await lockedRow.locator('[data-target-editor]').count() === 0,
      `编辑按钮禁用=${lockedDisabled}，双击后 editor=0`,
    )

    await welcomeRow.getByRole(
      'button',
      { name: `查看原始行 ${welcome.ordinal + 1} 上下文`, exact: true },
    ).click()
    const finalQaPanel = await openDockTab(workspace, 'QA')
    const finalQaFindings = finalQaPanel.locator('section[aria-label="当前片段 QA Findings"]')
    await finalQaFindings.getByRole('button', { name: '运行整个项目 QA', exact: true }).click()
    const qaSettled = await waitFor(async () => {
      const button = cat.getByRole('button', { name: /^下一个 QA 问题（/u })
      const text = await button.textContent()
      return text !== null && !text.includes('未运行')
    }, 30_000)
    check(
      'cat-qa-rerun-after-manual-edit',
      qaSettled && await projectSessionCount(page, seeded.projectId) === 0,
      `QA 已重算=${qaSettled}，Session 仍为 0`,
    )

    const exportSettings = await openExportSettings(page, workspace)
    const assetsSection = exportSettings.sheet.locator('section[aria-label="资产（文件）"]')
    const primaryAssetRow = assetsSection.locator('li').filter({ hasText: asset.filename })
    const secondaryAssetRow = assetsSection.locator('li').filter({ hasText: secondaryAsset.filename })
    const importReady = await assetsSection.getByRole('button', { name: '导入文件', exact: true })
      .isEnabled()
    const exportReady = await exportSettings.exportButton.isEnabled()
      && await secondaryAssetRow.getByRole(
        'button',
        { name: `导出 ${secondaryAsset.filename}`, exact: true },
      ).isEnabled()
    const assetMetadataReady =
      await primaryAssetRow.getByText(asset.formatId, { exact: true }).isVisible()
      && await primaryAssetRow.getByText(`${asset.segments} 段`, { exact: true }).isVisible()
      && await primaryAssetRow.getByText(asset.sha256.slice(0, 12), { exact: false }).isVisible()
      && await secondaryAssetRow.getByText(secondaryAsset.formatId, { exact: true }).isVisible()
      && await secondaryAssetRow.getByText(
        `${secondaryAsset.segments} 段`,
        { exact: true },
      ).isVisible()
      && await secondaryAssetRow.getByText(
        secondaryAsset.sha256.slice(0, 12),
        { exact: false },
      ).isVisible()
      && await assetsSection
        .locator('button[aria-label^="复制"][aria-label$="SHA-256 摘要"]').count() === 2
    const summaryCheck = await page.evaluate(async (projectId) => {
      const result = await (window as unknown as {
        electronAPI: {
          linguistProjectsGetSummary: (input: { projectId: string }) => Promise<
            {
              ok: true
              data: {
                assetCount: number
                assets: Array<{ filename: string; sourceSha256: string }>
              }
            }
            | { ok: false; error: { code: string } }
          >
        }
      }).electronAPI.linguistProjectsGetSummary({ projectId })
      if (!result.ok) return { ok: false as const, code: result.error.code }
      return {
        ok: true as const,
        assetCount: result.data.assetCount,
        filenames: result.data.assets.map((entry) => entry.filename).sort(),
        shas: result.data.assets.map((entry) => entry.sourceSha256).sort(),
      }
    }, seeded.projectId)
    const expectedFilenames = seeded.assets.map((entry) => entry.filename).sort()
    const expectedShas = seeded.assets.map((entry) => entry.sha256).sort()
    const summaryMatches = summaryCheck.ok
      && summaryCheck.assetCount === 2
      && summaryCheck.filenames.join('\n') === expectedFilenames.join('\n')
      && summaryCheck.shas.join('\n') === expectedShas.join('\n')
    const invalidExport = await page.evaluate(async (projectId) => {
      return (window as unknown as {
        electronAPI: {
          linguistExportsSaveAsset: (input: unknown) => Promise<
            { ok: true; data: unknown }
            | { ok: false; error: { code: string } }
          >
        }
      }).electronAPI.linguistExportsSaveAsset({ projectId, assetId: 'bad' })
    }, seeded.projectId)
    await page.keyboard.press('Escape')
    await exportSettings.sheet.waitFor({ state: 'hidden', timeout: 30_000 })
    const sourceShaBefore = sha256(sourceFixture)
    const exported = runCli([
      'export',
      '--root', linguistRoot,
      '--project', seeded.projectId,
      '--asset', asset.assetId,
      '--out', 'lf048-safe-output.xliff',
    ])
    const exportPath = cliField(exported, 'path')
    const exportPreflight = importReady
      && exportReady
      && assetMetadataReady
      && summaryMatches
      && !invalidExport.ok && invalidExport.error.code === 'INVALID_INPUT'
      && existsSync(exportPath)
      && sha256(sourceFixture) === sourceShaBefore
    check(
      'pb033-assets-metadata-and-export-preflight',
      exportPreflight,
      `import/export 入口=${importReady}/${exportReady}，资产 metadata=${assetMetadataReady}` +
      `，summary 真源=${summaryMatches}，非法请求=${invalidExport.ok ? 'OK' : invalidExport.error.code}` +
      `，CLI staging（非 Native Save）=${existsSync(exportPath)}` +
      `，source SHA 未变=${sha256(sourceFixture) === sourceShaBefore}`,
    )
    if (MANUAL_VERIFY) {
      await observeManualNativeSaveRejection(page)
      await welcomeRow.getByRole(
        'button',
        { name: `编辑原始行 ${welcome.ordinal + 1} 译文`, exact: true },
      ).click()
      const manualEditor = welcomeRow.getByRole(
        'textbox',
        { name: `编辑原始行 ${welcome.ordinal + 1} 译文`, exact: true },
      )
      await manualEditor.waitFor({ timeout: 30_000 })
      await observeManualIme(manualEditor)
      await manualEditor.focus()
      await page.evaluate(() => {
        document.title = 'LF-048 Manual Verification'
      })
      await page.bringToFront()

      console.log('\n=== LF-048 MANUAL VERIFY READY ===')
      console.log(' window-title: LF-048 Manual Verification')
      console.log(` app-clone: ${manualClone?.appPath ?? 'ERROR: missing manual clone'}`)
      console.log(` bundle-id: ${LF048_MANUAL_BUNDLE_ID}`)
      console.log(` app-asar-sha: ${manualClone?.clonedAsarSha ?? 'ERROR: missing manual clone'}`)
      console.log(` artifact: ${artifactDir}`)
      console.log(` temp-home: ${tmpHome}`)
      console.log(` source: ${sourceFixture}`)
      console.log(` safe-export: ${manualSafeExportPath}`)
      console.log(` sentinel: ${sentinelPath}`)
      console.log(` project: ${seeded.projectId}`)
      console.log(` asset: ${asset.assetId}`)
      console.log(` segment: ${welcome.id}`)
      console.log(` ime-target: ${MANUAL_IME_TARGET}`)
      console.log(' 1. 当前译文编辑器已聚焦；⌘A 后用真实系统中文/日文 IME 输入 ime-target。')
      console.log(' 2. composition 尚未结束时按一次 ⌘Enter，确认编辑器没有提交；完成输入后点击“保存译文”。')
      console.log(' 3. 项目设置 → 资源 → 导出：先选择 source 并确认覆盖；看见“目标已存在 (INVALID_INPUT)”后再继续。')
      console.log(' 4. 再次导出到 safe-export，确认成功后创建空 sentinel 文件；探针将自行核验。')
      console.log(`=== WAITING FOR SENTINEL（最多 ${MANUAL_SENTINEL_TIMEOUT_MS / 60_000} 分钟）===\n`)
      await waitForManualSentinel(sentinelPath)

      let verifiedExport = ''
      if (existsSync(manualSafeExportPath)) {
        try {
          verifiedExport = runCli([
            'verify',
            '--root', linguistRoot,
            '--project', seeded.projectId,
            '--asset', asset.assetId,
            '--export', manualSafeExportPath,
          ])
        } catch {
          // 下方 check 将 verify 异常记为 FAIL。
        }
      }
      const sourceUnchanged = existsSync(sourceFixture) && sha256(sourceFixture) === sourceShaBefore
      const safeExportExists = existsSync(manualSafeExportPath)
        && readFileSync(manualSafeExportPath).byteLength > 0
      const exportVerified = verifiedExport !== ''
        && cliField(verifiedExport, 'verify') === 'OK'
      const nativeSaveEvidence = await readManualNativeSaveEvidence(page)
      check(
        'manual-native-save-artifact-and-rejection-verified',
        nativeSaveEvidence.rejectionObserved
          && sourceUnchanged
          && safeExportExists
          && exportVerified,
        `UI EEXIST/INVALID_INPUT=${nativeSaveEvidence.rejectionObserved}` +
        `，source SHA 未变=${sourceUnchanged}，safe export=${safeExportExists}` +
        `，reimport verify=${exportVerified}，UI=${nativeSaveEvidence.rejectionText}`,
      )

      const manualState = readCliSegment(linguistRoot, seeded.projectId, welcome.id)
      const staleCasRejected = manualState.revision === 4 && isStaleEditRejectedByCas(
        linguistRoot,
        seeded.projectId,
        welcome.id,
      )
      const afterStaleAttempt = readCliSegment(linguistRoot, seeded.projectId, welcome.id)
      const imeEvidence = await readManualImeEvidence(page)
      const placeholderPreserved = placeholderCount(MANUAL_IME_TARGET, '{player}') === 1
        && placeholderCount(manualState.target, '{player}') === 1
      check(
        'manual-ime-cat-state-verified',
        manualState.target === MANUAL_IME_TARGET
          && manualState.revision === 4
          && placeholderPreserved
          && staleCasRejected
          && afterStaleAttempt.target === MANUAL_IME_TARGET
          && afterStaleAttempt.revision === 4
          && imeEvidence.compositionStarts > 0
          && imeEvidence.compositionEnds > 0
          && imeEvidence.commandEnterDuringComposition > 0
          && imeEvidence.shortcutKeptEditorOpen,
        `target/revision=${manualState.target}/${manualState.revision}，placeholder=${placeholderPreserved}` +
        `，stale CAS 拒绝=${staleCasRejected}，composition=${imeEvidence.compositionStarts}` +
        `/${imeEvidence.compositionEnds}，composition 内快捷键=${imeEvidence.commandEnterDuringComposition}` +
        `，编辑器未提前关闭=${imeEvidence.shortcutKeptEditorOpen}`,
      )
    } else {
      manual('native-save-dialog', '选择既有源文件验证 COPYFILE_EXCL 拒绝，再保存到新 translated 文件')
      manual('real-ime', '使用真实系统中文/日文 IME，确认 composition 期间快捷键不提交')
    }

    await welcomeRow.getByRole(
      'button',
      { name: `查看原始行 ${welcome.ordinal + 1} 上下文`, exact: true },
    ).click()
    const persisted = await waitFor(async () => {
      const location = await readPersistedLocation(page, seeded.projectId)
      return location.assetId === asset.assetId && location.segmentId === welcome.id
    }, 10_000)
    await quitApp(launched.app)
    launched = undefined

    launched = await launchApp(tmpHome, logStream, executablePath)
    await enterMainUi(launched.page)
    const recoveredWorkspace = launched.page.locator(
      `section[aria-label="${PROJECT_NAME} 本地化工作台"]`,
    )
    await recoveredWorkspace.waitFor({ timeout: 30_000 })
    const recoveredLocation = await readPersistedLocation(launched.page, seeded.projectId)
    const recovered = readCliSegment(linguistRoot, seeded.projectId, welcome.id)
    const recoveredAssetCurrent = await recoveredWorkspace
      .locator(`[data-asset-id="${asset.assetId}"]`).getAttribute('aria-current') === 'page'
    const recoveredStatus = recoveredWorkspace.locator('footer[aria-label="本地化工作台状态栏"]')
    const recoveredSegmentVisible = await recoveredStatus
      .getByText(`当前片段：${welcome.id}`, { exact: true }).isVisible()
    check(
      'restart-recovers-manual-cat-state',
      persisted && recoveredAssetCurrent && recoveredSegmentVisible
        && recoveredLocation.segmentId === welcome.id
        && recovered.target === (MANUAL_VERIFY ? MANUAL_IME_TARGET : CONCURRENT_TARGET)
        && recovered.revision === (MANUAL_VERIFY ? 4 : 3)
        && await projectSessionCount(launched.page, seeded.projectId) === 0,
      `persisted=${persisted}，asset=${recoveredAssetCurrent}，segment=${recoveredSegmentVisible}` +
      `，target/revision=${recovered.target}/${recovered.revision}，Session=0`,
    )

    const tenKWorkspace = await openProject(
      launched.page,
      TEN_K_PROJECT_NAME,
      seeded10k.assetId,
    )
    const tenKCat = tenKWorkspace.locator('section[aria-label="Segment 编辑器"]')
    const tenKCount = await tenKCat.getByText('共 10000 段', { exact: true })
      .waitFor({ timeout: 30_000 }).then(() => true).catch(() => false)
    check(
      'cat-10k-loaded',
      tenKCount,
      `10000 段=${tenKCount}，CLI 导入=${seeded10k.importMs.toFixed(0)}ms`,
    )

    const searchInput = tenKCat.getByPlaceholder('搜索源文或译文')
    const searchSamples: number[] = []
    let searchPassed = true
    for (let sample = 0; sample < 20; sample += 1) {
      const query = `Source item ${9_000 + sample}`
      const startedAt = performance.now()
      await searchInput.fill(query)
      searchPassed &&= await tenKCat.getByText(query, { exact: true })
        .waitFor({ timeout: 30_000 }).then(() => true).catch(() => false)
      searchSamples.push(performance.now() - startedAt)
    }
    const sorted = [...searchSamples].sort((left, right) => left - right)
    const p95 = sorted[Math.ceil(sorted.length * 0.95) - 1]!
    check(
      'cat-10k-search',
      searchPassed && p95 <= 200,
      `20 次打包应用精确搜索=${searchPassed}，p95=${p95.toFixed(0)}ms（目标≤200ms）`,
    )

    await searchInput.fill('')
    await tenKCat.getByText('共 10000 段', { exact: true }).waitFor({ timeout: 30_000 })
    const virtualScroll = tenKCat.locator('[data-testid="cat-virtual-scroll"]')
    await virtualScroll.evaluate((element) => {
      element.scrollTop = element.scrollHeight
    })
    const lastSource = await tenKCat.getByText('Source item 9999', { exact: true })
      .waitFor({ timeout: 30_000 }).then(() => true).catch(() => false)
    const renderedRows = await tenKCat.locator('[role="row"]').count()
    const scrollBefore = await virtualScroll.evaluate((element) => element.scrollTop)
    await launched.page.waitForTimeout(500)
    const scrollAfter = await virtualScroll.evaluate((element) => element.scrollTop)
    check(
      'cat-10k-virtual-scroll-anchor',
      lastSource && renderedRows < 80 && Math.abs(scrollAfter - scrollBefore) < 2,
      `末行=${lastSource}，DOM rows=${renderedRows}，scroll delta=${Math.abs(scrollAfter - scrollBefore).toFixed(1)}px`,
    )

    const lastRow = tenKCat.locator('[role="row"][data-cat-row-index="9999"]')
    const lastButton = lastRow.getByRole('button', { name: '原始行 10000 已锁定，无法编辑' })
    const grid = tenKCat.getByRole('grid', { name: 'Segment Grid', exact: true })
    const gridSemantics = await grid.getAttribute('aria-rowcount') === '10001'
      && await grid.getAttribute('aria-colcount') === '6'
      && await lastButton.isDisabled()
    await lastRow.focus()
    await lastRow.press('ArrowUp')
    const arrowFocused = await launched.page.evaluate(() =>
      document.activeElement?.getAttribute('data-cat-row-index') === '9998',
    )
    const statusLabel = await lastRow
      .locator('[role="gridcell"][aria-label^="本轮状态："]').getAttribute('aria-label')
    const qaLabel = await lastRow
      .getByRole('button', { name: /^查看原始行 10000 QA：/u }).getAttribute('aria-label')
    check(
      'cat-keyboard-a11y-row-navigation',
      gridSemantics && arrowFocused
        && statusLabel === '本轮状态：已锁定'
        && qaLabel?.startsWith('查看原始行 10000 QA：') === true,
      `Grid=${gridSemantics}，ArrowUp=${arrowFocused}，labels=${statusLabel}/${qaLabel}`,
    )
    check(
      'cat-locked-fail-closed-10k',
      await lastButton.isDisabled() && await projectSessionCount(launched.page, seeded10k.projectId) === 0,
      '第 10000 行 locked 且 10k 项目 Session=0',
    )

    const manageProjects = launched.page.getByRole(
      'button',
      { name: '管理项目', exact: true },
    ).first()
    await manageProjects.click()
    await launched.page.getByRole('heading', { name: '项目', exact: true })
      .waitFor({ timeout: 30_000 })
    const expandArchived = launched.page.getByRole(
      'button',
      { name: '展开已归档项目', exact: true },
    )
    if (await expandArchived.count() > 0 && await expandArchived.isVisible()) {
      await expandArchived.click()
    }
    await launched.page.getByRole(
      'button',
      { name: `设置 ${ARCHIVED_PROJECT_NAME}`, exact: true },
    ).click()
    const archivedSettings = launched.page.getByRole(
      'dialog',
      { name: '项目设置', exact: true },
    )
    await archivedSettings.waitFor({ timeout: 30_000 })
    await archivedSettings.getByRole('tablist', { name: '项目设置分类', exact: true })
      .getByRole('tab', { name: '资源', exact: true }).click()
    const archivedAssets = archivedSettings.locator('section[aria-label="资产（文件）"]')
    await archivedAssets.waitFor({ timeout: 30_000 })
    const archivedImportDisabled = await archivedAssets
      .getByRole('button', { name: '导入文件', exact: true }).isDisabled()
    const archivedReadonlyHint = await archivedAssets
      .getByText('已归档项目为只读，无法导入', { exact: true }).isVisible()
    const tempHomeIsolated = existsSync(join(linguistRoot, 'projects', seeded.projectId))
      && existsSync(join(linguistRoot, 'projects', archivedSeed.projectId))
    check(
      'pb033-archived-readonly-and-temp-home',
      archivedImportDisabled && archivedReadonlyHint && tempHomeIsolated,
      `归档项目 import disabled=${archivedImportDisabled}，只读提示=${archivedReadonlyHint}` +
      `，全部数据位于 tmp HOME=${tempHomeIsolated}`,
    )
  } catch (error) {
    check('runner-completed', false, error instanceof Error ? error.message : String(error))
  } finally {
    try {
      if (launched !== undefined) await quitApp(launched.app)
    } catch (error) {
      console.error('LF-048 应用清理异常:', error instanceof Error ? error.message : String(error))
      try {
        activeProcess?.kill('SIGKILL')
      } catch {
        // 已退出。
      }
      activeApp = undefined
      activeProcess = undefined
    }
    try {
      await closeLogStream(logStream)
    } finally {
      rmSync(tmpHome, { recursive: true, force: true })
      if (manualClone !== undefined) {
        rmSync(manualClone.rootDir, { recursive: true, force: true })
      }
    }
    console.log(` 已清理 tmp HOME 与 manual app clone；诊断 artifact 保留于 ${artifactDir}`)
  }

  summarizeAndExit(results.some((result) => !result.pass) ? 1 : 0)
}

function summarizeAndExit(code: number): never {
  const passed = results.filter((result) => result.pass).length
  const failed = results.length - passed
  console.log(`\n=== LF-048 探针结果：${passed} PASS / ${failed} FAIL / ${manualCount} MANUAL ===`)
  process.exit(code)
}

main().catch((error) => {
  console.error('LF-048 探针异常:', error)
  if (activeProcess !== undefined) {
    try {
      activeProcess.kill('SIGKILL')
    } catch {
      // 已退出。
    }
  }
  process.exit(1)
})
