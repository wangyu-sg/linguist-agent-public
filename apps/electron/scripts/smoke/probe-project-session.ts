#!/usr/bin/env node
/**
 * PB-034 项目会话绑定探针 — 在【打包后的 .app】上验证 Project → Session 绑定全生命周期
 *
 * 覆盖（真实 UI 驱动 + 真实 IPC 交叉核对 + 真实 JSONL 落盘检查，playwright-core）：
 * 1. fs.mkdtemp 临时 HOME；启动【前】用 PB-025 headless CLI 在该 HOME 的
 *    .linguist-agent/linguist 根播种：项目（导入 mini_dialogue.csv，8 段）。
 * 2. 启动打包应用；播种 fake 渠道（Fake Model Server）+ onboardingCompleted。
 * 3. 侧边栏「项目」→ 打开项目 → Chat 标签页为真实可选中标签，空状态
 *    「尚无项目对话」；点击「新建项目对话」→ 跳转 Agent 会话，头部出现项目徽章。
 * 4. IPC 交叉核对：listForProject=1、getBinding=active（项目名快照、Pi runtime）；
 *    普通会话（createAgentSession）getBinding=null（规则 1：普通对话无 projectId）。
 * 5. 归档（IPC）→ 项目详情 Chat 列表仍可读、「新建项目对话」禁用+只读提示；
 *    重开绑定会话 → 徽章「已归档」+ 只读通告。
 * 6. 归档后发送（electronAPI.sendAgentMessage，与 AgentView 同一入口）→
 *    STREAM_ERROR（只读文案）、Fake Server 零请求（主进程在模型调用前拦截）、
 *    会话 JSONL 落盘 linguist_project_archived TypedError；重开会话历史可见
 *    （用户消息 + 类型化错误均渲染）。
 * 7. 退出应用 → 外部删除项目目录 → 同一 tmp HOME 重启：绑定仍在、
 *    getBinding=missing，发送被主进程阻断且 Fake Server 零请求。
 * 8. 用户从通告永久解绑 → getBinding=null、项目会话列表移除该会话；原会话
 *    随后作为普通 Agent 发送成功并到达 Fake Server。
 * 9. finally 关闭应用与 Fake Server，不遗留后台进程。
 *
 * 运行前提：已执行 `bun run smoke:pack`（产出 apps/electron/out/mac-arm64/*.app）
 *
 * 注意：与 G0/G1/PB-032/033 探针相同，本脚本必须用 Node 运行
 * （`node scripts/smoke/probe-project-session.ts`），不能用 bun —— playwright-core
 * 的 WebSocketTransport 在 bun 的 node:http 兼容层下无法完成 ws upgrade 握手。
 */

import { _electron as electron, type ElectronApplication, type Page } from 'playwright-core'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, existsSync, createWriteStream, readdirSync, readFileSync, rmSync, type WriteStream } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { startFakeModelServer, FAKE_MODEL_IDS, type FakeModelServer } from './fake-model-server.ts'

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url))
const APP_DIR = resolve(SCRIPT_DIR, '..', '..')
/** apps/electron/scripts/smoke → 上溯四级到仓根 */
const REPO_ROOT = resolve(SCRIPT_DIR, '..', '..', '..', '..')
const CLI_DIR = join(REPO_ROOT, 'packages', 'linguist-cat-store')
const FIXTURES_DIR = join(REPO_ROOT, 'tests', 'linguist-fixtures')

const PROJECT_NAME = 'PB-034 绑定探针项目'

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

async function waitFor(fn: () => Promise<boolean>, timeoutMs: number, intervalMs = 250): Promise<boolean> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (await fn()) return true
    await sleep(intervalMs)
  }
  return false
}

// ===== headless 播种（PB-025 CLI；与应用共享同一 linguist 根布局） =====

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

// ===== 应用启动（与 probe-import.ts 相同模式） =====

interface LaunchedApp {
  app: ElectronApplication
  page: Page
}

let activeApp: ElectronApplication | undefined

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

/** 播种 onboardingCompleted 并 reload（两次启动共用） */
async function enterMainUI(page: Page): Promise<void> {
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
    // 没有 banner 时忽略
  }
}

// ===== 渲染进程内的流式事件收集（只收集 error/complete，发送阻断断言用） =====

interface ProbeEvents {
  complete: Array<{ sessionId: string }>
  errors: Array<{ sessionId: string; error: string }>
}

async function installEventCollectors(page: Page): Promise<void> {
  await page.evaluate(() => {
    const w = window as unknown as {
      electronAPI: {
        onAgentStreamComplete: (cb: (d: { sessionId: string }) => void) => () => void
        onAgentStreamError: (cb: (d: { sessionId: string; error: string }) => void) => () => void
      }
      __pb034Events: ProbeEvents
      __pb034Unsub?: Array<() => void>
    }
    if (w.__pb034Unsub) for (const u of w.__pb034Unsub) u()
    w.__pb034Events = { complete: [], errors: [] }
    w.__pb034Unsub = [
      w.electronAPI.onAgentStreamComplete((d) => w.__pb034Events.complete.push({ sessionId: d.sessionId })),
      w.electronAPI.onAgentStreamError((d) => w.__pb034Events.errors.push({ sessionId: d.sessionId, error: d.error })),
    ]
  })
}

async function getEvents(page: Page): Promise<ProbeEvents> {
  return page.evaluate(() => (window as unknown as { __pb034Events: ProbeEvents }).__pb034Events)
}

// ===== 主流程 =====

/**
 * 打开已归档项目的详情页（Chat 标签区在场为准）。两条真实路径都接受：
 * 1. 详情恢复路径——selectedProjectIdAtom 持久，返回项目视图可能直接
 *    恢复详情面板（本探针从项目详情创建会话后即此路径）；
 * 2. 列表路径——展开「已归档（1）」分组并点击项目卡片。
 */
async function openArchivedProjectDetail(page: Page): Promise<void> {
  const detailShown = await page.locator('section[aria-label="项目对话"]')
    .waitFor({ timeout: 10_000 }).then(() => true).catch(() => false)
  if (detailShown) return
  const group = page.getByText('已归档（1）', { exact: true }).first()
  const groupShown = await group.waitFor({ timeout: 15_000 }).then(() => true).catch(() => false)
  if (groupShown) await group.click()
  await page.locator(`button[aria-label="打开项目 ${PROJECT_NAME}"]`).waitFor({ timeout: 15_000 })
  await page.locator(`button[aria-label="打开项目 ${PROJECT_NAME}"]`).click()
  await page.locator('section[aria-label="项目对话"]').waitFor({ timeout: 30_000 })
}

async function main(): Promise<void> {
  console.log('=== PB-034 项目会话绑定探针（packaged .app + CLI 播种 + 真实 UI 驱动）===')
  console.log(` packaged binary: ${PACKAGED_BINARY}`)

  if (!existsSync(PACKAGED_BINARY)) {
    check('packaged-binary-exists', false, `未找到 ${PACKAGED_BINARY}，请先运行 bun run smoke:pack`)
    summarizeAndExit(1)
  }
  check('packaged-binary-exists', true, PACKAGED_BINARY)

  const tmpHome = mkdtempSync(join(tmpdir(), 'proma-pb034-probe-home-'))
  const artifactDir = mkdtempSync(join(tmpdir(), 'proma-pb034-probe-artifacts-'))
  const mainLogPath = join(artifactDir, 'main-process.log')
  const logStream = createWriteStream(mainLogPath)
  console.log(` tmp HOME: ${tmpHome}`)
  console.log(` artifacts: ${artifactDir}`)

  // 1. 启动前播种项目 + 1 个资产（8 段）
  const linguistRoot = join(tmpHome, '.linguist-agent', 'linguist')
  let projectId = ''
  let seededSegments = 0
  try {
    const created = runCli(['create-project', '--root', linguistRoot, '--name', PROJECT_NAME, '--source', 'en', '--target', 'zh-CN'])
    projectId = cliField(created, 'project')
    const imported = runCli(['import', '--root', linguistRoot, '--project', projectId, '--file', join(FIXTURES_DIR, 'mini_dialogue.csv')])
    seededSegments = Number.parseInt(cliField(imported, 'segments'), 10)
  } catch (err) {
    check('cli-seed', false, `CLI 播种失败：${err instanceof Error ? err.message : String(err)}`)
    summarizeAndExit(1)
  }
  check('cli-seed', true, `项目 ${projectId}（mini_dialogue.csv=${seededSegments} 段）`)

  let server: FakeModelServer | undefined
  let launched: LaunchedApp | undefined
  let sessionId = ''

  try {
    server = await startFakeModelServer(0)
    console.log(` fake model server: ${server.baseUrl}`)

    launched = await launchApp(tmpHome, logStream)
    const { page } = launched
    check('packaged-launch', true, '主窗口获取成功，window.electronAPI 就绪')

    // 2. 播种 fake 渠道 + onboarding（发送腿需要可用渠道到达绑定闸门）
    const channelId = await page.evaluate(async (args) => {
      const api = (window as unknown as {
        electronAPI: { createChannel: (input: unknown) => Promise<{ id: string }> }
      }).electronAPI
      const channel = await api.createChannel({
        name: 'fake',
        provider: 'openai',
        baseUrl: args.baseUrl,
        apiKey: 'sk-fake',
        models: args.modelIds.map((id) => ({ id, name: id, enabled: true })),
        enabled: true,
      })
      return channel.id
    }, { baseUrl: server.baseUrl, modelIds: [...FAKE_MODEL_IDS] as string[] })
    check('seed-channel', channelId.length > 0, `channelId=${channelId}`)
    await enterMainUI(page)

    // 3. 项目详情 → Chat 标签页为真实标签 + 空状态
    await page.getByRole('tab', { name: 'Linguist', exact: true }).click()
    const activeProjectButton = page.getByRole('list', { name: '本地化项目', exact: true })
      .getByRole('button', { name: `打开项目 ${PROJECT_NAME}`, exact: true })
    await activeProjectButton.waitFor({ timeout: 30_000 })
    await activeProjectButton.click()
    const chatTab = page.getByRole('tab', { name: 'Chat' })
    const chatTabSelected = await chatTab.waitFor({ timeout: 30_000 })
      .then(async () => (await chatTab.getAttribute('aria-selected')) === 'true')
      .catch(() => false)
    const emptyState = await page.getByText('尚无项目对话', { exact: true }).first()
      .waitFor({ timeout: 30_000 }).then(() => true).catch(() => false)
    check('detail-chat-tab-real', chatTabSelected && emptyState,
      `Chat 标签可选中=${chatTabSelected}，空状态「尚无项目对话」=${emptyState}`)

    // 4. 新建项目对话 → 跳转 Agent 会话 + 项目徽章
    await page.getByRole('button', { name: '新建项目对话' }).click()
    const badge = page.locator('[data-testid="linguist-project-badge"]')
    const badgeVisible = await badge.waitFor({ timeout: 30_000 }).then(() => true).catch(() => false)
    const badgeText = badgeVisible ? await badge.innerText() : ''
    check('create-project-chat-badge', badgeVisible && badgeText.includes(PROJECT_NAME),
      `徽章可见=${badgeVisible}，文案含项目名=${badgeText.includes(PROJECT_NAME)}（「${badgeText}」）`)

    // 5. IPC 交叉核对：listForProject / getBinding(active) / Pi runtime
    const bindingCheck = await page.evaluate(async (pid) => {
      const api = (window as unknown as {
        electronAPI: {
          linguistSessionsListForProject: (input: { projectId: string }) => Promise<
            | { ok: true; data: Array<{ id: string; title: string; updatedAt: number }> }
            | { ok: false; error: { code: string } }
          >
          linguistSessionsGetBinding: (input: { sessionId: string }) => Promise<
            | { ok: true; data: { binding: { projectId: string; projectName: string; status: string } | null } }
            | { ok: false; error: { code: string } }
          >
          getAgentSessionMeta?: undefined
          listAgentSessions: () => Promise<Array<{ id: string; agentRuntime?: string; linguistProjectId?: string }>>
        }
      }).electronAPI
      const list = await api.linguistSessionsListForProject({ projectId: pid })
      if (!list.ok) return { ok: false as const, stage: 'list', code: list.error.code }
      if (list.data.length !== 1) return { ok: false as const, stage: 'list-length', length: list.data.length }
      const sid = list.data[0]!.id
      const binding = await api.linguistSessionsGetBinding({ sessionId: sid })
      if (!binding.ok) return { ok: false as const, stage: 'getBinding', code: binding.error.code }
      const sessions = await api.listAgentSessions()
      const meta = sessions.find((s) => s.id === sid)
      return {
        ok: true as const,
        sessionId: sid,
        title: list.data[0]!.title,
        bindingStatus: binding.data.binding?.status ?? '<null>',
        bindingProjectId: binding.data.binding?.projectId ?? '<null>',
        bindingProjectName: binding.data.binding?.projectName ?? '<null>',
        agentRuntime: meta?.agentRuntime ?? '<undefined>',
        metaProjectId: meta?.linguistProjectId ?? '<undefined>',
      }
    }, projectId)
    const ipcOk = bindingCheck.ok
      && bindingCheck.bindingStatus === 'active'
      && bindingCheck.bindingProjectId === projectId
      && bindingCheck.bindingProjectName === PROJECT_NAME
      && bindingCheck.agentRuntime === 'pi'
      && bindingCheck.metaProjectId === projectId
    check('ipc-binding-cross-check', ipcOk,
      bindingCheck.ok
        ? `list=1，status=${bindingCheck.bindingStatus}，projectName=「${bindingCheck.bindingProjectName}」，runtime=${bindingCheck.agentRuntime}，meta.linguistProjectId 一致`
        : `交叉核对失败：${JSON.stringify(bindingCheck)}`)
    if (bindingCheck.ok) sessionId = bindingCheck.sessionId

    // 6. 规则 1：普通会话（侧栏新建路径 createAgentSession）不携带绑定
    const normalChatUnbound = await page.evaluate(async () => {
      const api = (window as unknown as {
        electronAPI: {
          createAgentSession: (title?: string) => Promise<{ id: string; linguistProjectId?: string }>
          linguistSessionsGetBinding: (input: { sessionId: string }) => Promise<
            | { ok: true; data: { binding: unknown | null } }
            | { ok: false; error: { code: string } }
          >
        }
      }).electronAPI
      const meta = await api.createAgentSession('PB-034 普通对话')
      if (meta.linguistProjectId !== undefined) return { unbound: false, stage: 'meta-field' }
      const binding = await api.linguistSessionsGetBinding({ sessionId: meta.id })
      return { unbound: binding.ok && binding.data.binding === null, stage: binding.ok ? 'binding' : binding.error.code }
    })
    check('normal-chat-unbound', normalChatUnbound.unbound === true,
      `普通会话 linguistProjectId 缺省且 getBinding=null（${normalChatUnbound.stage}）`)

    // 7. 归档（IPC）→ 项目详情 Chat 列表可读 + 新建禁用 + 只读提示
    const archived = await page.evaluate(async (pid) => {
      const api = (window as unknown as {
        electronAPI: {
          linguistProjectsArchive: (input: { projectId: string }) => Promise<
            | { ok: true; data: { archivedAt?: string } }
            | { ok: false; error: { code: string } }
          >
        }
      }).electronAPI
      const result = await api.linguistProjectsArchive({ projectId: pid })
      return result.ok && result.data.archivedAt !== undefined
    }, projectId)
    check('archive-via-ipc', archived, `linguistProjectsArchive(${projectId}) archivedAt 写入=${archived}`)

    // 回到项目视图 → 打开归档详情（详情恢复 / 列表分组两条路径均可）→ Chat 列表
    await page.getByRole('tab', { name: 'Linguist', exact: true }).click()
    await openArchivedProjectDetail(page)
    const chatRow = page.locator('section[aria-label="项目对话"] button', { hasText: PROJECT_NAME }).first()
    const chatRowVisible = await chatRow.waitFor({ timeout: 30_000 }).then(() => true).catch(() => false)
    const createButton = page.getByRole('button', { name: '新建项目对话' })
    const createDisabled = await createButton.waitFor({ timeout: 15_000 })
      .then(async () => createButton.isDisabled()).catch(() => false)
    const readOnlyHint = await page.getByText('已归档项目为只读，无法新建对话', { exact: false }).first()
      .waitFor({ timeout: 15_000 }).then(() => true).catch(() => false)
    check('archived-chat-list-readonly', chatRowVisible && createDisabled && readOnlyHint,
      `列表可读=${chatRowVisible}，新建禁用=${createDisabled}，只读提示=${readOnlyHint}`)

    // 8. 打开归档项目的绑定会话 → 徽章「已归档」+ 只读通告
    if (chatRowVisible) await chatRow.click()
    const archivedBadge = page.locator('[data-testid="linguist-project-badge"][data-binding-status="archived"]')
    const archivedNotice = page.locator('[data-testid="linguist-binding-notice"][data-binding-status="archived"]')
    const archivedBadgeShown = await archivedBadge.waitFor({ timeout: 30_000 }).then(() => true).catch(() => false)
    const archivedNoticeShown = await archivedNotice.waitFor({ timeout: 30_000 }).then(() => true).catch(() => false)
    check('archived-badge-notice', archivedBadgeShown && archivedNoticeShown,
      `徽章 archived=${archivedBadgeShown}，只读通告=${archivedNoticeShown}`)

    // 9. 归档后发送：主进程闸门拦截（与 AgentView 同一 sendAgentMessage 入口）
    await installEventCollectors(page)
    await page.evaluate(async (args) => {
      const api = (window as unknown as {
        electronAPI: { sendAgentMessage: (input: unknown) => Promise<void> }
      }).electronAPI
      await api.sendAgentMessage({
        sessionId: args.sid,
        userMessage: '归档后这条消息不应到达模型 PB-034',
        channelId: args.cid,
        modelId: 'fake-text',
        agentRuntime: 'pi',
        startedAt: Date.now(),
      })
    }, { sid: sessionId, cid: channelId })
    const errorSeen = await waitFor(async () =>
      (await getEvents(page)).errors.some((e) => e.sessionId === sessionId && e.error.includes('只读')), 30_000)
    // 落盘证据：会话 JSONL 内含 linguist_project_archived TypedError + 用户消息已持久化（历史可读）
    const jsonlPath = join(tmpHome, '.linguist-agent', 'agent-sessions', `${sessionId}.jsonl`)
    const jsonl = existsSync(jsonlPath) ? readFileSync(jsonlPath, 'utf-8') : ''
    const persistedError = jsonl.includes('linguist_project_archived')
    const persistedUserMsg = jsonl.includes('归档后这条消息不应到达模型 PB-034')
    check('send-blocked-main-level', errorSeen && persistedError && persistedUserMsg,
      `STREAM_ERROR 含「只读」=${errorSeen}，JSONL 落盘 linguist_project_archived=${persistedError}，用户消息持久化=${persistedUserMsg}`)

    // 10. Fake Server 零请求：闸门在模型调用之前拦截
    const fakeRequests = server.logs.length
    check('fake-server-no-request', fakeRequests === 0,
      `fake server 请求数=${fakeRequests}（=0 证明发送在到达模型前被主进程阻断）`)

    // 11. 重开绑定会话：历史可见（用户消息 + 类型化错误渲染），会话只读
    await page.getByRole('tab', { name: 'Linguist', exact: true }).click()
    await openArchivedProjectDetail(page)
    await page.locator('section[aria-label="项目对话"] button', { hasText: PROJECT_NAME }).first().click()
    const historyUserMsg = await page.getByText('归档后这条消息不应到达模型 PB-034', { exact: false }).first()
      .waitFor({ timeout: 30_000 }).then(() => true).catch(() => false)
    const historyError = await page.getByText('项目已归档（只读）', { exact: false }).first()
      .waitFor({ timeout: 30_000 }).then(() => true).catch(() => false)
    check('archived-history-readable', historyUserMsg && historyError,
      `历史用户消息渲染=${historyUserMsg}，类型化错误渲染=${historyError}`)

    // 12. 退出应用 → 外部删除项目目录 → 重启 → fail closed（missing）
    await quitApp(launched.app)
    launched = undefined
    rmSync(join(linguistRoot, 'projects', projectId), { recursive: true, force: true })

    launched = await launchApp(tmpHome, logStream)
    const page2 = launched.page
    // onboardingCompleted 已持久化在 tmp HOME；等待主界面（无需再次播种设置）
    await page2.waitForFunction(
      () => typeof (window as unknown as { electronAPI?: unknown }).electronAPI === 'object',
      undefined,
      { timeout: 60_000 },
    )
    // 侧栏打开绑定会话（标题 = 项目名快照）
    const sidebarSession = page2.getByText(PROJECT_NAME, { exact: true }).first()
    const sidebarSessionVisible = await sidebarSession.waitFor({ timeout: 30_000 }).then(() => true).catch(() => false)
    if (sidebarSessionVisible) await sidebarSession.click()
    const missingBadge = page2.locator('[data-testid="linguist-project-badge"][data-binding-status="missing"]')
    const missingNotice = page2.locator('[data-testid="linguist-binding-notice"][data-binding-status="missing"]')
    const missingBadgeShown = await missingBadge.waitFor({ timeout: 30_000 }).then(() => true).catch(() => false)
    const missingNoticeShown = await missingNotice.waitFor({ timeout: 30_000 }).then(() => true).catch(() => false)
    check('relaunch-missing-blocked', sidebarSessionVisible && missingBadgeShown && missingNoticeShown,
      `侧栏会话在场=${sidebarSessionVisible}，徽章 missing=${missingBadgeShown}，阻断通告=${missingNoticeShown}`)

    // 13. 重启后：绑定跨重启存活（listForProject=1）、getBinding=missing、应用其余功能正常
    const relaunchState = await page2.evaluate(async (args) => {
      const api = (window as unknown as {
        electronAPI: {
          linguistSessionsListForProject: (input: { projectId: string }) => Promise<
            | { ok: true; data: Array<{ id: string }> }
            | { ok: false; error: { code: string } }
          >
          linguistSessionsGetBinding: (input: { sessionId: string }) => Promise<
            | { ok: true; data: { binding: { status: string; projectName: string; project?: unknown } | null } }
            | { ok: false; error: { code: string } }
          >
        }
      }).electronAPI
      const list = await api.linguistSessionsListForProject({ projectId: args.pid })
      const binding = await api.linguistSessionsGetBinding({ sessionId: args.sid })
      return {
        listOk: list.ok && list.data.length === 1,
        bindingStatus: binding.ok ? (binding.data.binding?.status ?? '<null>') : `<error:${binding.error.code}>`,
        projectNameSnapshot: binding.ok ? (binding.data.binding?.projectName ?? '<null>') : '<error>',
        projectAbsent: binding.ok ? binding.data.binding?.project === undefined : false,
      }
    }, { pid: projectId, sid: sessionId })
    // 14. missing 发送必须在模型前阻断，不能静默退化为普通 Agent。
    await installEventCollectors(page2)
    await page2.evaluate(async (args) => {
      const api = (window as unknown as {
        electronAPI: { sendAgentMessage: (input: unknown) => Promise<void> }
      }).electronAPI
      await api.sendAgentMessage({
        sessionId: args.sid,
        userMessage: '项目缺失时这条消息不应到达模型 AC-005',
        channelId: args.cid,
        modelId: 'fake-text',
        agentRuntime: 'pi',
        startedAt: Date.now(),
      })
    }, { sid: sessionId, cid: channelId })
    const missingErrorSeen = await waitFor(async () =>
      (await getEvents(page2)).errors.some((event) =>
        event.sessionId === sessionId && event.error.includes('缺失')), 30_000)
    const missingJsonl = existsSync(jsonlPath) ? readFileSync(jsonlPath, 'utf-8') : ''
    const missingBlocked = missingErrorSeen
      && missingJsonl.includes('linguist_project_missing')
      && server.logs.length === 0
    check('missing-send-fail-closed', missingBlocked,
      `STREAM_ERROR 含缺失=${missingErrorSeen}，JSONL 有 linguist_project_missing=${missingJsonl.includes('linguist_project_missing')}，fake 请求=${server.logs.length}`)

    // 15. 通告中的唯一出口：用户确认永久解绑；随后成为普通 Agent。
    page2.once('dialog', (dialog) => {
      void dialog.accept()
    })
    await page2.getByRole('button', { name: '解除绑定并作为普通 Agent 继续' }).click()
    const detached = await waitFor(async () => page2.evaluate(async (args) => {
      const api = (window as unknown as {
        electronAPI: {
          linguistSessionsGetBinding: (input: { sessionId: string }) => Promise<
            | { ok: true; data: { binding: unknown | null } }
            | { ok: false; error: { code: string } }
          >
          linguistSessionsListForProject: (input: { projectId: string }) => Promise<
            | { ok: true; data: Array<{ id: string }> }
            | { ok: false; error: { code: string } }
          >
          listAgentSessions: () => Promise<Array<{ id: string; linguistProjectId?: string }>>
        }
      }).electronAPI
      const binding = await api.linguistSessionsGetBinding({ sessionId: args.sid })
      const list = await api.linguistSessionsListForProject({ projectId: args.pid })
      const meta = (await api.listAgentSessions()).find((item) => item.id === args.sid)
      return binding.ok
        && binding.data.binding === null
        && list.ok
        && list.data.length === 0
        && meta?.linguistProjectId === undefined
    }, { sid: sessionId, pid: projectId }), 30_000)
    const badgeRemoved = await waitFor(async () => await missingBadge.count() === 0, 10_000)
    check('permanent-detach', detached && badgeRemoved,
      `getBinding=null + listForProject=0 + meta 无绑定=${detached}，徽章移除=${badgeRemoved}`)

    await installEventCollectors(page2)
    await page2.evaluate(async (args) => {
      const api = (window as unknown as {
        electronAPI: { sendAgentMessage: (input: unknown) => Promise<void> }
      }).electronAPI
      await api.sendAgentMessage({
        sessionId: args.sid,
        userMessage: '解绑后作为普通 Agent 发送 AC-005',
        channelId: args.cid,
        modelId: 'fake-text',
        agentRuntime: 'pi',
        startedAt: Date.now(),
      })
    }, { sid: sessionId, cid: channelId })
    const detachedSendComplete = await waitFor(async () =>
      (await getEvents(page2)).complete.some((event) => event.sessionId === sessionId), 30_000)
    check('detached-session-sends-as-ordinary-agent', detachedSendComplete && server.logs.length > 0,
      `STREAM_COMPLETE=${detachedSendComplete}，fake 请求=${server.logs.length}`)

    // 应用存活证据：项目视图可正常打开（index 中项目条目打开失败走可恢复错误态，不崩 App）
    await page2.getByRole('tab', { name: 'Linguist', exact: true }).click()
    const projectsViewAlive = await page2.getByRole('heading', { name: '项目', exact: true }).first()
      .waitFor({ timeout: 30_000 }).then(() => true).catch(() => false)
    const relaunchOk = relaunchState.listOk
      && relaunchState.bindingStatus === 'missing'
      && relaunchState.projectNameSnapshot === PROJECT_NAME
      && relaunchState.projectAbsent
      && projectsViewAlive
    check('relaunch-binding-persisted-app-alive', relaunchOk,
      `listForProject=1=${relaunchState.listOk}，status=${relaunchState.bindingStatus}，快照名=「${relaunchState.projectNameSnapshot}」，project 缺省=${relaunchState.projectAbsent}，项目视图存活=${projectsViewAlive}`)

    // 16. tmp HOME 隔离：解绑后的索引不再保留项目绑定。
    const indexPath = join(tmpHome, '.linguist-agent', 'agent-sessions.json')
    const indexText = existsSync(indexPath) ? readFileSync(indexPath, 'utf-8') : ''
    const indexDetached = indexText.includes(sessionId) && !indexText.includes(projectId)
    check('temp-home-isolation', indexDetached,
      `${indexPath} 存在且含会话、无绑定项目 id=${indexDetached}（未触碰真实 ~/.linguist-agent）`)
  } catch (error) {
    check('runner-completed', false, `运行异常: ${error instanceof Error ? error.message : String(error)}`)
  } finally {
    if (launched !== undefined) await quitApp(launched.app)
    if (server) await server.close()
    logStream.end()
  }

  summarizeAndExit(results.some((r) => !r.pass) ? 1 : 0)
}

function summarizeAndExit(code: number): never {
  const passed = results.filter((r) => r.pass).length
  const failed = results.length - passed
  console.log(`\n=== PB-034 探针结果：${passed} PASS / ${failed} FAIL ===`)
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
