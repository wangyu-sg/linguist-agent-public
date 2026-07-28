#!/usr/bin/env node
/**
 * PB-032 Projects 页探针 — 在【打包后的 .app】上验证「项目」列表与创建 UI
 *
 * 覆盖（真实 UI 驱动，playwright-core）：
 * 1. fs.mkdtemp 临时 HOME 启动打包应用（不触碰真实 ~/.linguist-agent；无需 fake model
 *    server——项目页不依赖渠道，避开 safeStorage/Keychain 提示面）
 * 2. 播种 onboardingCompleted → reload 进入主界面
 * 3. 点击主模式「Linguist」页签 → 断言 ProjectsView 渲染：
 *    标题 + 空状态（含创建 CTA）
 * 4. 「新建项目」→ 断言对话框打开（名称/源语言/目标语言字段齐全）→ 取消
 * 5. 重新打开 → 填写并提交 → 断言对话框关闭、项目卡片出现（名称 + 语言对 +
 *    段计数），并以 electronAPI.linguistProjectsList 交叉核对主进程真源
 * 6. 点击卡片 → 断言详情头部：健康徽章「健康」+ 计数格 + Chat 工作台
 *    （role="tab" 选中态 + 「尚无项目对话」空状态，PB-034 起 Chat tab 落地）
 * 7. 返回列表 → 归档：卡片「归档」→ 确认对话框 → 断言进入「已归档」分组
 *    （默认折叠；展开后归档徽章可见）
 * 8. finally 关闭应用，不遗留后台进程
 *
 * 运行前提：已执行 `bun run smoke:pack`（产出 apps/electron/out/mac-arm64/*.app）
 *
 * 注意：与 G0/G1 相同，本脚本必须用 Node 运行
 * （`node scripts/smoke/probe-projects-view.ts`），不能用 bun ——
 * playwright-core 的 WebSocketTransport 在 bun 的 node:http 兼容层下
 * 无法完成 Electron 主进程 inspector 的 ws upgrade 握手（PB-004 实测）。
 * Node 22.18+ 原生支持 .ts 类型擦除，无需转译。
 */

import { _electron as electron, type ElectronApplication, type Page } from 'playwright-core'
import { mkdtempSync, existsSync, createWriteStream, readdirSync, type WriteStream } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url))
const APP_DIR = resolve(SCRIPT_DIR, '..', '..')

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

// ===== 结果收集 =====

interface CheckResult {
  name: string
  pass: boolean
  evidence: string
}

const results: CheckResult[] = []

function check(name: string, pass: boolean, evidence: string): void {
  results.push({ name, pass, evidence })
  const tag = pass ? 'PASS' : 'FAIL'
  console.log(`[${tag}] ${name} — ${evidence}`)
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

// ===== 应用启动 =====

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
  const app = await electron.launch({
    executablePath: PACKAGED_BINARY,
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

// ===== 主流程 =====

const PROJECT_NAME = '探针项目 PB-032'

async function main(): Promise<void> {
  console.log('=== PB-032 Projects 页探针（packaged .app + 真实 UI 驱动）===')
  console.log(` packaged binary: ${PACKAGED_BINARY}`)

  if (!existsSync(PACKAGED_BINARY)) {
    check('packaged-binary-exists', false, `未找到 ${PACKAGED_BINARY}，请先运行 bun run smoke:pack`)
    summarizeAndExit(1)
  }
  check('packaged-binary-exists', true, PACKAGED_BINARY)

  const tmpHome = mkdtempSync(join(tmpdir(), 'proma-pb032-probe-home-'))
  const artifactDir = mkdtempSync(join(tmpdir(), 'proma-pb032-probe-artifacts-'))
  const mainLogPath = join(artifactDir, 'main-process.log')
  const logStream = createWriteStream(mainLogPath)
  console.log(` tmp HOME: ${tmpHome}`)
  console.log(` artifacts: ${artifactDir}`)

  let launched: LaunchedApp | undefined

  try {
    launched = await launchApp(tmpHome, logStream)
    const { page } = launched
    check('packaged-launch', true, '主窗口获取成功，window.electronAPI 就绪')

    // 播种 onboardingCompleted → reload 进入主界面（与 G0 同手法；不播种渠道，
    // 项目页不需要模型，也避开 safeStorage/Keychain 提示面）
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
    // 教程 Banner 非模态但可能遮挡，尽力关闭（与 G0 同手法）
    try {
      const dismiss = page.getByText('稍后再学', { exact: true }).first()
      if (await dismiss.isVisible({ timeout: 3_000 })) await dismiss.click()
    } catch {
      // 没有 banner 时忽略
    }

    // 1. 侧边栏「项目」入口
    const sidebarEntry = page.getByRole('tab', { name: 'Linguist', exact: true })
    const entryVisible = await sidebarEntry.waitFor({ timeout: 30_000 }).then(() => true).catch(() => false)
    check('sidebar-projects-entry', entryVisible, 'Linguist 模式页签可见')
    if (!entryVisible) throw new Error('侧边栏无「项目」入口，中止后续断言')
    await sidebarEntry.click()

    // 2. ProjectsView 渲染：标题 + 空状态
    const headingVisible = await page.getByRole('heading', { name: '项目', exact: true }).first()
      .waitFor({ timeout: 15_000 }).then(() => true).catch(() => false)
    const emptyVisible = await page.getByText('还没有项目', { exact: true }).first()
      .waitFor({ timeout: 15_000 }).then(() => true).catch(() => false)
    check('projects-view-empty-state', headingVisible && emptyVisible,
      `标题=${headingVisible}，空状态「还没有项目」=${emptyVisible}`)

    // 3. 新建项目对话框打开/取消
    // 注意：侧边栏「项目」分组头部另有同名 aria-label 图标按钮（工作区分组入口，
    // 无文本内容）；filter(hasText) 只匹配视图内带文本的 CTA/标题栏按钮（两状态唯一）。
    await page.getByRole('button', { name: '新建项目' }).filter({ hasText: '新建项目' }).first().click()
    const dialog = page.getByRole('dialog')
    const dialogVisible = await dialog.waitFor({ timeout: 10_000 }).then(() => true).catch(() => false)
    const fieldsReady = dialogVisible && await waitFor(async () =>
      (await page.locator('#project-create-name').count()) === 1
      && (await page.locator('#project-create-source').count()) === 1
      && (await page.locator('#project-create-target').count()) === 1, 10_000)
    check('create-dialog-opens', dialogVisible && fieldsReady,
      `dialog=${dialogVisible}，名称/源语言/目标语言字段=${fieldsReady}`)
    // 取消后应回到空状态（校验对话框可正常关闭）
    await dialog.getByRole('button', { name: '取消' }).click()
    const dialogClosed = await waitFor(async () => (await page.getByRole('dialog').count()) === 0, 10_000)
    check('create-dialog-cancel', dialogClosed, `取消后 dialog 关闭=${dialogClosed}`)

    // 4. 重新打开 → 填写并提交 → 卡片出现
    await page.getByRole('button', { name: '新建项目' }).filter({ hasText: '新建项目' }).first().click()
    await page.locator('#project-create-name').fill(PROJECT_NAME)
    // 草稿默认 en → zh-CN；显式重填以驱动输入路径
    await page.locator('#project-create-source').fill('en')
    await page.locator('#project-create-target').fill('zh-CN')
    await page.getByRole('dialog').getByRole('button', { name: '创建项目' }).click()
    const activeProjectButton = page.getByRole('list', { name: '本地化项目', exact: true })
      .getByRole('button', { name: `打开项目 ${PROJECT_NAME}`, exact: true })
    const cardAppeared = await activeProjectButton
      .waitFor({ timeout: 30_000 }).then(() => true).catch(() => false)
    const localePairVisible = await page.getByText('en → zh-CN', { exact: true }).first()
      .waitFor({ timeout: 15_000 }).then(() => true).catch(() => false)
    // 段计数（新建项目应为 0 段 · 0 资产；摘要并发补拉后落字）
    const countsVisible = await page.getByText('0 段 · 0 资产', { exact: true }).first()
      .waitFor({ timeout: 30_000 }).then(() => true).catch(() => false)
    check('project-created-card', cardAppeared && localePairVisible && countsVisible,
      `卡片=${cardAppeared}，语言对=${localePairVisible}，计数「0 段 · 0 资产」=${countsVisible}`)

    // 5. 主进程真源交叉核对（UI 之外，list 通道亦应见到该项目）
    const listCheck = await page.evaluate(async () => {
      const api = (window as unknown as {
        electronAPI: {
          linguistProjectsList: (input?: { includeArchived?: boolean }) => Promise<
            { ok: true; data: Array<{ id: string; name: string; archivedAt?: string }> } | { ok: false; error: { code: string } }
          >
        }
      }).electronAPI
      const result = await api.linguistProjectsList({ includeArchived: true })
      if (!result.ok) return { ok: false as const, code: result.error.code }
      const found = result.data.find((p) => p.name === '探针项目 PB-032')
      return { ok: true as const, found: found !== undefined, count: result.data.length, id: found?.id ?? '' }
    })
    check('ipc-list-cross-check', listCheck.ok && listCheck.found === true,
      listCheck.ok ? `主进程 list 含新项目（共 ${listCheck.count} 个，id=${listCheck.id}）` : `list 通道失败：${listCheck.code}`)

    // 6. 打开卡片 → 详情头部：健康徽章 + 计数格 + Chat 工作台（PB-034 落地）
    await activeProjectButton.click()
    const healthBadge = await page.getByText('健康', { exact: true }).first()
      .waitFor({ timeout: 30_000 }).then(() => true).catch(() => false)
    const totalCell = await page.getByText('总段数', { exact: true }).first()
      .waitFor({ timeout: 15_000 }).then(() => true).catch(() => false)
    const chatTab = page.getByRole('tab', { name: 'Chat' })
    const chatTabSelected = await chatTab.waitFor({ timeout: 15_000 })
      .then(async () => (await chatTab.getAttribute('aria-selected')) === 'true')
      .catch(() => false)
    const chatsEmptyState = await page.getByText('尚无项目对话', { exact: true }).first()
      .waitFor({ timeout: 15_000 }).then(() => true).catch(() => false)
    check('project-detail-health', healthBadge && totalCell && chatTabSelected && chatsEmptyState,
      `健康徽章=${healthBadge}，计数格=${totalCell}，Chat tab 选中=${chatTabSelected}，对话空状态=${chatsEmptyState}`)

    // 7. 返回列表 → 归档 → 已归档分组
    await page.getByRole('button', { name: '返回项目列表' }).click()
    const backToList = await activeProjectButton
      .waitFor({ timeout: 15_000 }).then(() => true).catch(() => false)
    check('back-to-list', backToList, `返回列表后卡片仍在=${backToList}`)

    await page.locator(`button[aria-label="归档 ${PROJECT_NAME}"]`).click()
    const confirmVisible = await page.getByRole('alertdialog')
      .waitFor({ timeout: 10_000 }).then(() => true).catch(() => false)
    await page.getByRole('alertdialog').getByRole('button', { name: '归档', exact: true }).click()
    const archivedSection = await page.getByText('已归档（1）', { exact: true }).first()
      .waitFor({ timeout: 30_000 }).then(() => true).catch(() => false)
    check('archive-confirm-flow', confirmVisible && archivedSection,
      `确认对话框=${confirmVisible}，「已归档（1）」分组出现=${archivedSection}`)
    // 默认折叠 → 展开后应见到归档卡片与归档徽章
    await page.getByText('已归档（1）', { exact: true }).first().click()
    const archivedCardBack = await page.locator(`button[aria-label="打开项目 ${PROJECT_NAME}"]`)
      .waitFor({ timeout: 15_000 }).then(() => true).catch(() => false)
    const archivedBadge = await waitFor(async () =>
      (await page.getByText('已归档', { exact: true }).count()) >= 1, 15_000)
    check('archived-section-expand', archivedCardBack && archivedBadge,
      `展开后归档卡片=${archivedCardBack}，归档徽章=${archivedBadge}`)

    // 8. 项目数据落在临时 HOME 的 linguist 根（不触碰真实 ~/.linguist-agent）
    const linguistRoot = join(tmpHome, '.linguist-agent', 'linguist')
    check('temp-home-isolation', existsSync(linguistRoot), `${linguistRoot} 存在=${existsSync(linguistRoot)}`)
  } finally {
    if (launched !== undefined) await quitApp(launched.app)
    logStream.end()
  }

  summarizeAndExit(results.some((r) => !r.pass) ? 1 : 0)
}

function summarizeAndExit(code: number): never {
  const passed = results.filter((r) => r.pass).length
  const failed = results.length - passed
  console.log(`\n=== PB-032 探针结果：${passed} PASS / ${failed} FAIL ===`)
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
