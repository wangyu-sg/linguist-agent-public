#!/usr/bin/env bun
/**
 * G0 Hermetic Smoke Runner — PB-004
 *
 * 在【打包后的 .app】上运行端到端 smoke：
 * 1. 启动本地 Fake Model Server（OpenAI 兼容，确定性场景）
 * 2. 用 fs.mkdtemp 创建临时 HOME（打包应用写入 $HOME/.linguist-agent，不触碰真实 ~/.linguist-agent）
 * 3. playwright-core 以临时 HOME + userData 启动打包应用
 * 4. 通过 window.electronAPI 播种渠道/设置/对话，真实 UI 发送消息
 * 5. 断言：preload API、窗口加载、文本流（DOM）、思考 delta、工具调用事件、
 *    唯一最终文本（DOM）、429 重试、上下文超长错误、中途停止、重启恢复
 * 6. finally 中关闭应用与 Fake Server，不遗留后台进程
 *
 * 运行前提：已执行 `bun run smoke:pack`（产出 apps/electron/out/mac-arm64/*.app，
 * 应用名随 electron-builder productName 变化，运行时按 glob 解析，不写死）
 *
 * 注意：本脚本必须用 Node 运行（`node scripts/smoke/run-g0-smoke.ts`），
 * 不能用 bun —— playwright-core 的 WebSocketTransport 在 bun 的 node:http 兼容层下
 * 无法完成 Electron 主进程 inspector 的 ws upgrade 握手（实测挂起至超时）。
 * Node 22.18+ 原生支持 .ts 类型擦除，无需转译。
 *
 * 运行路径说明：全部断言均走 Chat 运行时路径
 * （electronAPI.sendMessage → chat-service → OpenAIAdapter → SSE），
 * 工具调用断言利用 chat-service 的工具续接循环（unknown tool → error result →
 * role:"tool" 续接请求 → fake server 返回最终文本），无需 Pi agent 路径。
 */

import { _electron as electron, type ElectronApplication, type Page } from 'playwright-core'
import { mkdtempSync, existsSync, createWriteStream, readdirSync, rmSync, type WriteStream } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  startFakeModelServer,
  MARKERS,
  FAKE_TOOL_NAME,
  FAKE_MODEL_IDS,
  type FakeModelServer,
} from './fake-model-server.ts'

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url))
const APP_DIR = resolve(SCRIPT_DIR, '..', '..')

/**
 * 解析打包产物路径：glob out/mac-arm64/*.app（productName 可随品牌票变更，
 * 如 Proma → Linguist Agent），主二进制名与 .app 名一致（electron-builder 约定）。
 */
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

// ===== 渲染进程内的事件收集器（通过 preload 订阅真实流式事件） =====

interface SmokeEvents {
  chunks: Array<{ conversationId: string; delta: string }>
  reasoning: Array<{ conversationId: string; delta: string }>
  tools: Array<{ conversationId: string; activity: { type: string; toolName: string } }>
  complete: Array<{ conversationId: string; model?: string; messageId?: string }>
  errors: Array<{ conversationId: string; error: string }>
}

async function installEventCollectors(page: Page): Promise<void> {
  await page.evaluate(() => {
    const w = window as unknown as {
      electronAPI: Record<string, (cb: (e: never) => void) => () => void>
      __smokeEvents: SmokeEvents
      __smokeUnsub?: Array<() => void>
    }
    // 先清理上一轮订阅（reload 后 window 重建，无需清理；同页重复安装时防重复）
    if (w.__smokeUnsub) for (const u of w.__smokeUnsub) u()
    w.__smokeEvents = { chunks: [], reasoning: [], tools: [], complete: [], errors: [] }
    const api = w.electronAPI
    w.__smokeUnsub = [
      api.onStreamChunk((e: { conversationId: string; delta: string }) =>
        w.__smokeEvents.chunks.push(e)),
      api.onStreamReasoning((e: { conversationId: string; delta: string }) =>
        w.__smokeEvents.reasoning.push(e)),
      api.onStreamToolActivity((e: { conversationId: string; activity: { type: string; toolName: string } }) =>
        w.__smokeEvents.tools.push(e)),
      api.onStreamComplete((e: { conversationId: string; model?: string; messageId?: string }) =>
        w.__smokeEvents.complete.push(e)),
      api.onStreamError((e: { conversationId: string; error: string }) =>
        w.__smokeEvents.errors.push(e)),
    ] as Array<() => void>
  })
}

async function getEvents(page: Page): Promise<SmokeEvents> {
  return page.evaluate(() => (window as unknown as { __smokeEvents: SmokeEvents }).__smokeEvents)
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

/** 等待主窗口（index.html 且无 ?window= 查询参数；快速任务/听写等辅助窗口排除） */
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
    args: [`--user-data-dir=${join(tmpHome, '.electron-user-data')}`],
    env: { ...process.env, HOME: tmpHome, LINGUIST_SMOKE_PLAINTEXT_CREDENTIALS: '1' } as Record<string, string>,
    timeout: 120_000,
  })
  activeApp = app

  // 主进程 stdout/stderr 落盘，作为报告证据（launch 前的早期日志可能错过）
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

// ===== UI 驱动 =====

/**
 * 确保应用处于 Chat 模式并已完成首启动画。
 *
 * Proma 默认启动在 Agent 模式（appModeAtom 默认值 'agent'，localStorage key
 * 'proma-app-mode'）。这里写入应用自身的持久化偏好后 reload，
 * ModeSwitcher 挂载时读取该值进入 Chat 模式——与用户在 ModeSwitcher 上
 * 点击「Chat」等价（同一存储键），但比多层弹层点击更稳定。
 */
async function ensureChatMode(page: Page): Promise<void> {
  await page.evaluate(() => window.localStorage.setItem('proma-app-mode', JSON.stringify('chat')))
  await page.reload()
  await page.waitForFunction(
    () => typeof (window as unknown as { electronAPI?: unknown }).electronAPI === 'object',
    undefined,
    { timeout: 60_000 },
  )
  // AppShell 挂载标志：ModeSwitcher（Agent/Chat 分段控件）
  await page.locator('.mode-switcher-track').first().waitFor({ timeout: 60_000 })
  // 教程 Banner 非模态但会遮挡，尽力关闭
  try {
    const dismiss = page.getByText('稍后再学', { exact: true }).first()
    if (await dismiss.isVisible({ timeout: 3_000 })) await dismiss.click()
  } catch {
    // 没有 banner 时忽略
  }
}

/** 在侧边栏中打开指定标题的 Chat 对话（rail 按钮优先，标题文本兜底） */
async function openConversationByTitle(page: Page, title: string): Promise<void> {
  const railButton = page.locator(`button[aria-label="打开Chat 对话：${title}"]`)
  try {
    await railButton.first().click({ timeout: 10_000 })
  } catch {
    await page.getByText(title, { exact: true }).first().click({ timeout: 15_000 })
  }
  // 等待 Chat 输入框出现（ChatView 已挂载）
  await page.locator('[data-input-mode="chat"] .ProseMirror').first().waitFor({ timeout: 30_000 })
}

/** 通过 preload API 创建对话（返回 id），刷新侧边栏后点击打开 */
async function createAndOpenConversation(
  page: Page,
  title: string,
  modelId: string,
  channelId: string,
): Promise<string> {
  const conversationId = await page.evaluate(
    async ([t, m, c]) => {
      const api = (window as unknown as {
        electronAPI: {
          createConversation: (title?: string, modelId?: string, channelId?: string) => Promise<{ id: string }>
        }
      }).electronAPI
      const meta = await api.createConversation(t, m, c)
      return meta.id
    },
    [title, modelId, channelId] as const,
  )

  await ensureChatMode(page)
  await openConversationByTitle(page, title)
  return conversationId
}

/** 在 Chat 输入框中输入并回车发送 */
async function typeAndSend(page: Page, text: string): Promise<void> {
  const input = page.locator('[data-input-mode="chat"] .ProseMirror').first()
  await input.click()
  await page.keyboard.type(text, { delay: 20 })
  await page.keyboard.press('Enter')
}

// ===== 主流程 =====

async function main(): Promise<void> {
  console.log('=== G0 Hermetic Smoke（packaged .app + Fake Model Server）===')
  console.log(` packaged binary: ${PACKAGED_BINARY}`)

  if (!existsSync(PACKAGED_BINARY)) {
    check('packaged-binary-exists', false, `未找到 ${PACKAGED_BINARY}，请先运行 bun run smoke:pack`)
    summarizeAndExit(1)
  }
  check('packaged-binary-exists', true, PACKAGED_BINARY)

  const tmpHome = mkdtempSync(join(tmpdir(), 'proma-g0-smoke-home-'))
  const artifactDir = mkdtempSync(join(tmpdir(), 'proma-g0-smoke-artifacts-'))
  const mainLogPath = join(artifactDir, 'main-process.log')
  const logStream = createWriteStream(mainLogPath)
  console.log(` tmp HOME: ${tmpHome}`)
  console.log(` artifacts: ${artifactDir}`)

  let server: FakeModelServer | undefined
  let launched: LaunchedApp | undefined

  try {
    // 1. 启动 Fake Model Server
    server = await startFakeModelServer(0)
    console.log(` fake model server: ${server.baseUrl}`)
    check('fake-server-started', true, server.baseUrl)

    // 2. 启动打包应用
    launched = await launchApp(tmpHome, logStream)
    const { page } = launched
    check('packaged-launch', true, 'firstWindow 获取成功，window.electronAPI 就绪')

    // (a) preload API 存在
    const preloadType = await page.evaluate(() => typeof (window as unknown as { electronAPI?: unknown }).electronAPI)
    check('preload-api-exists', preloadType === 'object', `typeof window.electronAPI === '${preloadType}'`)

    // (b) 主窗口加载完成（首启应为 Onboarding 门禁页）
    const readyState = await page.evaluate(() => document.readyState)
    const uiRendered = await waitFor(async () =>
      page.evaluate(() => document.body.innerText.trim().length > 0), 60_000)
    const firstPaintText = await page.evaluate(() => document.body.innerText.trim().slice(0, 60))
    check('main-window-loaded', readyState !== 'loading' && uiRendered,
      `document.readyState=${readyState}，首屏内容=${uiRendered}（「${firstPaintText.replaceAll('\n', ' ') }…」，首启 Onboarding 门禁页）`)

    // 3. 播种：fake 渠道 + onboarding 完成
    const channelId = await page.evaluate(
      async ([baseUrl, modelIds]) => {
        const api = (window as unknown as {
          electronAPI: {
            createChannel: (input: unknown) => Promise<{ id: string }>
            updateSettings: (updates: unknown) => Promise<unknown>
          }
        }).electronAPI
        const channel = await api.createChannel({
          name: 'fake',
          provider: 'openai',
          baseUrl,
          apiKey: 'sk-fake',
          models: (modelIds as string[]).map((id) => ({ id, name: id, enabled: true })),
          enabled: true,
        })
        await api.updateSettings({ onboardingCompleted: true })
        return channel.id
      },
      [server.baseUrl, [...FAKE_MODEL_IDS]] as const,
    )
    check('seed-channel-and-settings', channelId.length > 0, `channelId=${channelId}，onboardingCompleted=true`)

    // reload 使 onboarding 设置生效（App 挂载时已读过一次 settings），并进入 Chat 模式
    await ensureChatMode(page)
    check('onboarding-skipped', true, 'reload 后直接进入主界面 ModeSwitcher（未显示 Onboarding）')

    // 确认配置写入临时 HOME 而非真实 ~/.linguist-agent
    const configDirUsed = await page.evaluate(() =>
      (window as unknown as {
        electronAPI: { listConversations: () => Promise<unknown[]> }
      }).electronAPI.listConversations().then((c) => Array.isArray(c)),
    )
    check('temp-home-config', configDirUsed && existsSync(join(tmpHome, '.linguist-agent', 'channels.json')),
      `${join(tmpHome, '.linguist-agent', 'channels.json')} ${existsSync(join(tmpHome, '.linguist-agent', 'channels.json')) ? '存在' : '不存在'}`)

    // ===== 场景 1：文本流（DOM 断言流式中间态 + 唯一最终文本）=====
    {
      const title = 'G0文本流'
      const convId = await createAndOpenConversation(page, title, 'fake-text', channelId)
      await installEventCollectors(page)
      await typeAndSend(page, '你能帮我做什么')

      // 流式中间态：部分文本出现时 complete 尚未到达
      const partialSeen = await page.getByText('你好！', { exact: false }).first()
        .waitFor({ timeout: 30_000 }).then(() => true).catch(() => false)
      const eventsAtPartial = await getEvents(page)
      const completedEarly = eventsAtPartial.complete.some((e) => e.conversationId === convId)
      check('text-streaming-visible-in-dom', partialSeen && !completedEarly,
        `部分文本「你好！」${partialSeen ? '已' : '未'}出现在 DOM，此时 STREAM_COMPLETE ${completedEarly ? '已到达（不符合流式中间态）' : '未到达（确为流式中间态）'}`)

      // 唯一最终文本
      const finalSeen = await page.getByText(MARKERS.text, { exact: false }).first()
        .waitFor({ timeout: 30_000 }).then(() => true).catch(() => false)
      const completed = await waitFor(async () =>
        (await getEvents(page)).complete.some((e) => e.conversationId === convId), 30_000)
      const events = await getEvents(page)
      const chunkCount = events.chunks.filter((e) => e.conversationId === convId).length
      check('text-unique-final', finalSeen && completed,
        `DOM 含 ${MARKERS.text}=${finalSeen}，STREAM_COMPLETE=${completed}，chunk 事件 ${chunkCount} 个`)
    }

    // ===== 场景 2：思考/推理 delta =====
    {
      const title = 'G0思考流'
      const convId = await createAndOpenConversation(page, title, 'fake-thinking', channelId)
      await installEventCollectors(page)
      await typeAndSend(page, '请思考后回答')

      const reasoningSeen = await waitFor(async () =>
        (await getEvents(page)).reasoning.some(
          (e) => e.conversationId === convId && e.delta.includes(MARKERS.thinkingReasoning),
        ), 30_000)
      const finalSeen = await page.getByText(MARKERS.thinking, { exact: false }).first()
        .waitFor({ timeout: 30_000 }).then(() => true).catch(() => false)
      const events = await getEvents(page)
      const reasoningChunks = events.reasoning.filter((e) => e.conversationId === convId).length
      check('thinking-delta', reasoningSeen && finalSeen,
        `onStreamReasoning 收到 ${reasoningChunks} 个 delta（含 ${MARKERS.thinkingReasoning}=${reasoningSeen}），最终文本 DOM=${finalSeen}`)
    }

    // ===== 场景 3：工具调用事件 + tool-result-then-final 续接 =====
    {
      const title = 'G0工具调用'
      const convId = await createAndOpenConversation(page, title, 'fake-tool', channelId)
      await installEventCollectors(page)
      await typeAndSend(page, '调用工具查天气')

      const toolSeen = await waitFor(async () =>
        (await getEvents(page)).tools.some(
          (e) => e.conversationId === convId && e.activity.type === 'start' && e.activity.toolName === FAKE_TOOL_NAME,
        ), 30_000)
      const finalSeen = await page.getByText(MARKERS.tool, { exact: false }).first()
        .waitFor({ timeout: 30_000 }).then(() => true).catch(() => false)
      const toolFollowupSent = server.logs.some((l) => l.model === 'fake-tool' && l.hasToolMessage === true)
      check('tool-call-event-and-roundtrip', toolSeen && finalSeen && toolFollowupSent,
        `STREAM_TOOL_ACTIVITY(start, ${FAKE_TOOL_NAME})=${toolSeen}，服务端收到 role:"tool" 续接请求=${toolFollowupSent}，最终文本 DOM=${finalSeen}`)
    }

    // ===== 场景 4：429 重试后成功 =====
    {
      const title = 'G0重试'
      const convId = await createAndOpenConversation(page, title, 'fake-retry', channelId)
      await installEventCollectors(page)
      await typeAndSend(page, '测试重试')

      const finalSeen = await page.getByText(MARKERS.retry, { exact: false }).first()
        .waitFor({ timeout: 60_000 }).then(() => true).catch(() => false)
      const retryLogs = server.logs.filter((l) => l.model === 'fake-retry' && l.stream === true)
      const saw429 = retryLogs.some((l) => l.respondedStatus === 429)
      const sawSuccessAfter = retryLogs.some((l) => l.respondedStatus === 200)
      check('retry-429-then-success', finalSeen && saw429 && sawSuccessAfter,
        `首个流式请求 429=${saw429}，后续 200=${sawSuccessAfter}（共 ${retryLogs.length} 次），最终文本 DOM=${finalSeen}`)
    }

    // ===== 场景 5：上下文超长 400 错误 =====
    {
      const title = 'G0上下文超长'
      const convId = await createAndOpenConversation(page, title, 'fake-context', channelId)
      await installEventCollectors(page)
      await typeAndSend(page, '触发上下文错误')

      const errorSeen = await waitFor(async () =>
        (await getEvents(page)).errors.some(
          (e) => e.conversationId === convId && e.error.includes(MARKERS.context),
        ), 30_000)
      const events = await getEvents(page)
      const err = events.errors.find((e) => e.conversationId === convId)
      check('context-too-long-error', errorSeen,
        `STREAM_ERROR ${errorSeen ? `收到: ${(err?.error ?? '').slice(0, 120)}` : '未收到'}`)
    }

    // ===== 场景 6：中途停止（cancel 慢速滴灌）=====
    {
      const title = 'G0中途停止'
      const convId = await createAndOpenConversation(page, title, 'fake-cancel', channelId)
      await installEventCollectors(page)
      await typeAndSend(page, '开始长流输出')

      // 等到至少 2 个 chunk 到达（流已开始）
      const started = await waitFor(async () =>
        (await getEvents(page)).chunks.filter((e) => e.conversationId === convId).length >= 2, 30_000)

      // 调 stopGeneration 停止
      await page.evaluate((id) =>
        (window as unknown as {
          electronAPI: { stopGeneration: (conversationId: string) => Promise<void> }
        }).electronAPI.stopGeneration(id), convId)

      const countAtStop = (await getEvents(page)).chunks.filter((e) => e.conversationId === convId).length
      // 若未停止，400ms/chunk 会继续增长；等待 1.6s 后应不再增长
      await sleep(1_600)
      const eventsAfter = await getEvents(page)
      const countAfter = eventsAfter.chunks.filter((e) => e.conversationId === convId).length
      const halted = started && countAfter <= countAtStop + 1
      check('stop-mid-stream', halted,
        `stop 前 chunk=${countAtStop}，1.6s 后 chunk=${countAfter}（流${halted ? '已停止' : '仍在继续'}）`)

      // 部分消息应已持久化（stopped 标记）
      const partialSaved = await page.evaluate(async ([id, marker]) => {
        const msgs = await (window as unknown as {
          electronAPI: { getConversationMessages: (id: string) => Promise<Array<{ role: string; content: string; stopped?: boolean }>> }
        }).electronAPI.getConversationMessages(id)
        const last = msgs[msgs.length - 1]
        return !!last && last.role === 'assistant' && last.stopped === true && last.content.includes(marker)
      }, [convId, MARKERS.cancelPrefix] as const)
      check('stop-partial-persisted', partialSaved, `部分助手消息含 stopped=true 且内容含 ${MARKERS.cancelPrefix}*=${partialSaved}`)
    }

    // ===== 场景 7：重启恢复（同一临时 HOME 重启，会话/消息仍在）=====
    console.log('  .. 退出应用，准备以同一临时 HOME 重启')
    await quitApp(launched.app)
    launched = undefined

    const relaunched = await launchApp(tmpHome, logStream)
    launched = relaunched
    const page2 = relaunched.page
    await ensureChatMode(page2)

    const persisted = await page2.evaluate(async (marker) => {
      const api = (window as unknown as {
        electronAPI: {
          listConversations: () => Promise<Array<{ id: string; title: string }>>
          getConversationMessages: (id: string) => Promise<Array<{ role: string; content: string }>>
        }
      }).electronAPI
      const conversations = await api.listConversations()
      const textConv = conversations.find((c) => c.title === '标题-fake-text' || c.title === 'G0文本流')
      if (!textConv) return { found: false, titles: conversations.map((c) => c.title), hasMarker: false }
      const msgs = await api.getConversationMessages(textConv.id)
      return {
        found: true,
        titles: conversations.map((c) => c.title),
        hasMarker: msgs.some((m) => m.role === 'assistant' && m.content.includes(marker)),
        id: textConv.id,
        title: textConv.title,
      }
    }, MARKERS.text)
    check('restart-conversations-persisted', persisted.found && persisted.hasMarker,
      `listConversations=${JSON.stringify(persisted.titles)}，文本对话消息含 ${MARKERS.text}=${persisted.hasMarker}`)

    // DOM 级：侧边栏可见并打开后最终消息可见
    let domRecovery = false
    if (persisted.found && persisted.title) {
      try {
        await openConversationByTitle(page2, persisted.title)
        await page2.getByText(MARKERS.text, { exact: false }).first().waitFor({ timeout: 30_000 })
        domRecovery = true
      } catch {
        domRecovery = false
      }
    }
    check('restart-recovery-dom', domRecovery,
      `重启后侧边栏打开「${persisted.title ?? '?'}」，DOM 中 ${MARKERS.text} ${domRecovery ? '可见' : '不可见'}`)

    // Fake server 请求日志摘要（证据）
    const summary = server.logs.map((l) =>
      `#${l.seq} ${l.method} ${l.model ?? l.url} stream=${l.stream ?? '-'} tool=${l.hasToolMessage ?? '-'} → ${l.respondedStatus}`,
    )
    console.log('--- fake server request log ---')
    for (const line of summary) console.log(`  ${line}`)
  } catch (error) {
    check('runner-completed', false, `运行异常: ${error instanceof Error ? error.message : String(error)}`)
  } finally {
    await Promise.allSettled([
      ...(activeApp ? [quitApp(activeApp)] : []),
      ...(server ? [server.close()] : []),
    ])
    logStream.end()
    rmSync(tmpHome, { recursive: true, force: true })
  }

  summarizeAndExit(results.some((r) => !r.pass) ? 1 : 0)
}

function summarizeAndExit(code: number): never {
  const passed = results.filter((r) => r.pass).length
  const failed = results.length - passed
  console.log(`=== G0 Smoke 结果: ${passed} PASS / ${failed} FAIL ===`)
  process.exit(code)
}

await main()
