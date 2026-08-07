#!/usr/bin/env node
/**
 * G1 Pi 流式探针 — Pi AGENT 路径打包冒烟（G0 只覆盖 Chat 运行时路径，本脚本补齐 Pi 路径）
 *
 * 在【打包后的 .app】上验证：
 * 1. 启动本地 Fake Model Server（与 G0 同一个，OpenAI 兼容 SSE）
 * 2. 用 fs.mkdtemp 创建临时 HOME（打包应用写入 $HOME/.linguist-agent，不触碰真实 ~/.linguist-agent）
 * 3. playwright-core 使用隔离的 HOME 与 Electron userData 启动打包应用
 * 4. 通过 window.electronAPI 播种 fake 渠道 + onboardingCompleted
 * 5. 创建 Agent 工作区 + Pi Agent 会话（createAgentSession 默认 agentRuntime='pi'）
 * 6. electronAPI.sendAgentMessage 发送消息，订阅 onAgentStreamEvent / onAgentStreamComplete /
 *    onAgentStreamError 收集真实主→渲染 IPC 流式事件
 * 7. 断言：
 *    - 场景 A（fake-text）：≥2 个 _partial assistant 文本事件（流式中间态，部分文本不含最终标记），
 *      最终文本含 TEXT_FINAL_MARKER_G0，STREAM_COMPLETE 恰好 1 次
 *    - 场景 B（fake-thinking，服务端发 reasoning_content）：_partial assistant 事件中出现
 *      thinking 块且含 REASONING_DELTA_MARKER_G0，最终文本含 THINKING_FINAL_MARKER_G0，
 *      STREAM_COMPLETE 恰好 1 次
 *    - 场景 C（fake-stop-retry 流式中真实 Stop）：electronAPI.stopAgent（与 AgentView
 *      handleStop 同一 preload 调用）后 STREAM_COMPLETE 到达且 stoppedByUser=true，
 *      _partial 事件不再增长，无 STREAM_ERROR
 *    - 场景 D（同会话 Retry）：停止后的同一 Pi 会话重发同一条用户消息（与 AgentView
 *      handleRetry 同一 sendAgentMessage 路径），最终文本含 TEXT_FINAL_MARKER_G0，
 *      STREAM_COMPLETE 恰好 1 次且非 stoppedByUser
 *    - fake server 请求日志证明各场景的请求确实到达（stream=true）
 * 8. finally 中关闭应用与 Fake Server，不遗留后台进程
 *
 * 运行前提：已执行 `bun run smoke:pack`（产出 apps/electron/out/mac-arm64/*.app）
 *
 * 注意：与 G0 runner 相同，本脚本必须用 Node 运行（`node scripts/smoke/probe-pi-stream.ts`），
 * 不能用 bun —— playwright-core 的 WebSocketTransport 在 bun 的 node:http 兼容层下
 * 无法完成 Electron 主进程 inspector 的 ws upgrade 握手（PB-004 实测挂起至超时）。
 * Node 22.18+ 原生支持 .ts 类型擦除，无需转译。
 *
 * 运行路径说明：全部断言走 Pi AGENT 运行时路径
 * （electronAPI.sendAgentMessage → agent-orchestrator → pi-agent-adapter →
 * pi-ai openai-completions provider → fake server SSE → message_update partial
 * 合并（20fps）→ convertPiMessage → AgentEventBus → webContents.send → preload
 * onAgentStreamEvent）。provider `openai` 经 pi-model-registry 映射为 Pi API
 * `openai-completions`，baseUrl 为协议根 `http://127.0.0.1:<port>/v1`。
 */

import { _electron as electron, type ElectronApplication, type Page } from 'playwright-core'
import { mkdtempSync, existsSync, createWriteStream, readdirSync, rmSync, type WriteStream } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  startFakeModelServer,
  MARKERS,
  FAKE_MODEL_IDS,
  type FakeModelServer,
} from './fake-model-server.ts'
import { CURRENT_ONBOARDING_VERSION } from '../../src/types/settings.ts'

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

// ===== 渲染进程内的 Pi 流式事件收集器 =====
//
// SDKMessage（assistant，convertPiMessage 产出）结构：
//   { type:'assistant', _partial?: true, uuid, message: { content: [
//       { type:'text', text } | { type:'thinking', thinking } | { type:'tool_use', ... } ] } }
// _partial 帧为 20fps 合并后的流式中间态（累计全文）；message_end 帧无 _partial 为最终帧。

interface AssistantContentBlock {
  type: string
  text?: string
  thinking?: string
}

interface CollectedAssistant {
  partial: boolean
  texts: string[]
  thinkings: string[]
}

interface ProbeEvents {
  assistants: Array<{ sessionId: string } & CollectedAssistant>
  complete: Array<{ sessionId: string; stoppedByUser: boolean }>
  errors: Array<{ sessionId: string; error: string }>
}

async function installEventCollectors(page: Page): Promise<void> {
  await page.evaluate(() => {
    const w = window as unknown as {
      electronAPI: {
        onAgentStreamEvent: (cb: (e: {
          sessionId: string
          payload: {
            kind: string
            message?: {
              type?: string
              _partial?: boolean
              message?: { content?: AssistantContentBlock[] }
            }
          }
        }) => void) => () => void
        onAgentStreamComplete: (cb: (d: { sessionId: string; stoppedByUser?: boolean }) => void) => () => void
        onAgentStreamError: (cb: (d: { sessionId: string; error: string }) => void) => () => void
      }
      __piProbeEvents: ProbeEvents
      __piProbeUnsub?: Array<() => void>
    }
    if (w.__piProbeUnsub) for (const u of w.__piProbeUnsub) u()
    w.__piProbeEvents = { assistants: [], complete: [], errors: [] }
    const api = w.electronAPI
    w.__piProbeUnsub = [
      api.onAgentStreamEvent((e) => {
        if (e?.payload?.kind !== 'sdk_message') return
        const msg = e.payload.message
        if (!msg || msg.type !== 'assistant') return
        const content = msg.message?.content ?? []
        w.__piProbeEvents.assistants.push({
          sessionId: e.sessionId,
          partial: msg._partial === true,
          texts: content.filter((b) => b.type === 'text').map((b) => b.text ?? ''),
          thinkings: content.filter((b) => b.type === 'thinking').map((b) => b.thinking ?? ''),
        })
      }),
      api.onAgentStreamComplete((d) => w.__piProbeEvents.complete.push({ sessionId: d.sessionId, stoppedByUser: d.stoppedByUser === true })),
      api.onAgentStreamError((d) => w.__piProbeEvents.errors.push({ sessionId: d.sessionId, error: d.error })),
    ]
  })
}

async function getEvents(page: Page): Promise<ProbeEvents> {
  return page.evaluate(() => (window as unknown as { __piProbeEvents: ProbeEvents }).__piProbeEvents)
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

// ===== 应用启动（与 run-g0-smoke.ts 相同模式） =====

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

// ===== Pi 会话驱动 =====

interface PiSessionInfo {
  sessionId: string
  agentRuntime: string
}

/** 创建 Pi Agent 会话（createAgentSession 缺省 agentRuntime='pi'，PB-011 后 Pi 为唯一可见内核） */
async function createPiSession(
  page: Page,
  title: string,
  channelId: string,
  workspaceId: string,
  modelId: string,
): Promise<PiSessionInfo> {
  return page.evaluate(
    async ([t, c, w, m]) => {
      const api = (window as unknown as {
        electronAPI: {
          createAgentSession: (
            title?: string,
            channelId?: string,
            workspaceId?: string,
            modelId?: string,
          ) => Promise<{ id: string; agentRuntime?: string }>
        }
      }).electronAPI
      const meta = await api.createAgentSession(t, c, w, m)
      return { sessionId: meta.id, agentRuntime: meta.agentRuntime ?? '<undefined>' }
    },
    [title, channelId, workspaceId, modelId] as const,
  )
}

async function sendPiMessage(
  page: Page,
  input: { sessionId: string; userMessage: string; channelId: string; modelId: string; workspaceId: string },
  wait = true,
): Promise<void> {
  await page.evaluate(async ({ args, wait }) => {
    const api = (window as unknown as {
      electronAPI: { sendAgentMessage: (input: unknown) => Promise<void> }
    }).electronAPI
    const sending = api.sendAgentMessage({
      sessionId: args.sessionId,
      userMessage: args.userMessage,
      channelId: args.channelId,
      modelId: args.modelId,
      agentRuntime: 'pi',
      workspaceId: args.workspaceId,
      startedAt: Date.now(),
    })
    if (wait) await sending
    else void sending.catch((error) => console.error('[G1探针] 后台 sendAgentMessage 失败:', error))
  }, { args: input, wait })
}

// ===== 主流程 =====

async function main(): Promise<void> {
  console.log('=== G1 Pi 流式探针（packaged .app + Fake Model Server + Pi AGENT 路径）===')
  console.log(` packaged binary: ${PACKAGED_BINARY}`)

  if (!existsSync(PACKAGED_BINARY)) {
    check('packaged-binary-exists', false, `未找到 ${PACKAGED_BINARY}，请先运行 bun run smoke:pack`)
    summarizeAndExit(1)
  }
  check('packaged-binary-exists', true, PACKAGED_BINARY)

  const tmpHome = mkdtempSync(join(tmpdir(), 'proma-g1-pi-probe-home-'))
  const artifactDir = mkdtempSync(join(tmpdir(), 'proma-g1-pi-probe-artifacts-'))
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

    // 3. 播种：fake 渠道 + onboarding 完成 + Agent 工作区
    const seeded = await page.evaluate(
      async ([baseUrl, modelIds, onboardingVersion]) => {
        const api = (window as unknown as {
          electronAPI: {
            createChannel: (input: unknown) => Promise<{ id: string }>
            updateSettings: (updates: unknown) => Promise<unknown>
            createAgentWorkspace: (name: string) => Promise<{ id: string }>
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
        await api.updateSettings({ onboardingCompleted: true, onboardingVersion })
        const workspace = await api.createAgentWorkspace('G1探针工作区')
        return { channelId: channel.id, workspaceId: workspace.id }
      },
      [server.baseUrl, [...FAKE_MODEL_IDS], CURRENT_ONBOARDING_VERSION] as const,
    )
    check('seed-channel-workspace', seeded.channelId.length > 0 && seeded.workspaceId.length > 0,
      `channelId=${seeded.channelId}，workspaceId=${seeded.workspaceId}，onboardingCompleted=true`)

    // reload 使 onboarding 设置生效（与 G0 相同的生效路径）
    await page.reload()
    await page.waitForFunction(
      () => typeof (window as unknown as { electronAPI?: unknown }).electronAPI === 'object',
      undefined,
      { timeout: 60_000 },
    )

    // ===== 场景 A：Pi 文本流（fake-text）=====
    let textSession: PiSessionInfo | undefined
    {
      textSession = await createPiSession(page, 'G1-Pi文本流', seeded.channelId, seeded.workspaceId, 'fake-text')
      check('pi-session-created-text', textSession.sessionId.length > 0 && textSession.agentRuntime === 'pi',
        `sessionId=${textSession.sessionId}，agentRuntime=${textSession.agentRuntime}`)

      await installEventCollectors(page)
      await sendPiMessage(page, {
        sessionId: textSession.sessionId,
        userMessage: '你能帮我做什么',
        channelId: seeded.channelId,
        modelId: 'fake-text',
        workspaceId: seeded.workspaceId,
      })

      // 流式中间态：等到至少 2 个 _partial 文本事件
      const partialsSeen = await waitFor(async () => {
        const ev = await getEvents(page)
        return ev.assistants.filter((a) => a.sessionId === textSession!.sessionId && a.partial && a.texts.length > 0).length >= 2
      }, 60_000)

      const completed = await waitFor(async () =>
        (await getEvents(page)).complete.some((c) => c.sessionId === textSession!.sessionId), 60_000)

      const ev = await getEvents(page)
      const mine = ev.assistants.filter((a) => a.sessionId === textSession!.sessionId)
      const partialTextEvents = mine.filter((a) => a.partial && a.texts.some((t) => t.length > 0))
      const allText = mine.map((a) => a.texts.join('')).join('')
      const finalSeen = allText.includes(MARKERS.text)
      // 流式中间态证据：存在某个 _partial 帧文本不含最终标记（部分文本先于完整文本到达）
      const intermediateSeen = partialTextEvents.some((a) => !a.texts.join('').includes(MARKERS.text))
      const completeCount = ev.complete.filter((c) => c.sessionId === textSession!.sessionId).length
      const errorEvents = ev.errors.filter((e) => e.sessionId === textSession!.sessionId)

      check('pi-text-streaming-partials', partialsSeen && intermediateSeen,
        `_partial 文本事件 ${partialTextEvents.length} 个（≥2=${partialsSeen}），存在不含最终标记的中间帧=${intermediateSeen}`)
      check('pi-text-final-and-complete', finalSeen && completed && completeCount === 1,
        `最终文本含 ${MARKERS.text}=${finalSeen}，STREAM_COMPLETE 次数=${completeCount}，STREAM_ERROR=${errorEvents.length}`)
    }

    // ===== 场景 B：Pi 思考流（fake-thinking，服务端发 reasoning_content）=====
    {
      const thinkSession = await createPiSession(page, 'G1-Pi思考流', seeded.channelId, seeded.workspaceId, 'fake-thinking')
      check('pi-session-created-thinking', thinkSession.sessionId.length > 0 && thinkSession.agentRuntime === 'pi',
        `sessionId=${thinkSession.sessionId}，agentRuntime=${thinkSession.agentRuntime}`)

      await installEventCollectors(page)
      await sendPiMessage(page, {
        sessionId: thinkSession.sessionId,
        userMessage: '请思考后回答',
        channelId: seeded.channelId,
        modelId: 'fake-thinking',
        workspaceId: seeded.workspaceId,
      })

      const completed = await waitFor(async () =>
        (await getEvents(page)).complete.some((c) => c.sessionId === thinkSession.sessionId), 60_000)

      const ev = await getEvents(page)
      const mine = ev.assistants.filter((a) => a.sessionId === thinkSession.sessionId)
      const partialThinkingEvents = mine.filter((a) => a.partial && a.thinkings.some((t) => t.length > 0))
      const allThinking = mine.map((a) => a.thinkings.join('')).join('')
      const thinkingMarkerSeen = allThinking.includes(MARKERS.thinkingReasoning)
      const allText = mine.map((a) => a.texts.join('')).join('')
      const finalSeen = allText.includes(MARKERS.thinking)
      const completeCount = ev.complete.filter((c) => c.sessionId === thinkSession.sessionId).length
      const errorEvents = ev.errors.filter((e) => e.sessionId === thinkSession.sessionId)

      check('pi-thinking-delta', thinkingMarkerSeen && partialThinkingEvents.length >= 1,
        `_partial thinking 事件 ${partialThinkingEvents.length} 个，thinking 块含 ${MARKERS.thinkingReasoning}=${thinkingMarkerSeen}`)
      check('pi-thinking-final-and-complete', finalSeen && completed && completeCount === 1,
        `最终文本含 ${MARKERS.thinking}=${finalSeen}，STREAM_COMPLETE 次数=${completeCount}，STREAM_ERROR=${errorEvents.length}`)
    }

    // ===== 场景 C/D：同一 Pi 会话流式中真实 Stop，随后同模型同会话重发拿到 final =====
    // Stop 与 AgentView handleStop 同为 electronAPI.stopAgent；Retry 使用与 handleRetry
    // 相同的 sendAgentMessage 路径。fake-stop-retry 的第二次请求只在同一模型下成功，
    // 防止探针通过偷偷切换模型掩盖原会话重试问题。
    {
      const stopSession = await createPiSession(page, 'G1-Pi停止重试', seeded.channelId, seeded.workspaceId, 'fake-stop-retry')
      check('pi-session-created-stop', stopSession.sessionId.length > 0 && stopSession.agentRuntime === 'pi',
        `sessionId=${stopSession.sessionId}，agentRuntime=${stopSession.agentRuntime}`)

      await installEventCollectors(page)
      const stopUserMessage = '开始长流输出'
      await sendPiMessage(page, {
        sessionId: stopSession.sessionId,
        userMessage: stopUserMessage,
        channelId: seeded.channelId,
        modelId: 'fake-stop-retry',
        workspaceId: seeded.workspaceId,
      }, false)

      // 流式中间态：等到至少 2 个 _partial 文本事件（流确实在跑）
      const streamingSeen = await waitFor(async () => {
        const ev = await getEvents(page)
        return ev.assistants.filter((a) => a.sessionId === stopSession.sessionId && a.partial && a.texts.length > 0).length >= 2
      }, 60_000)

      // 真实 Stop：与 AgentView handleStop 相同的 preload 调用
      await page.evaluate((id) =>
        (window as unknown as {
          electronAPI: { stopAgent: (sessionId: string) => Promise<void> }
        }).electronAPI.stopAgent(id), stopSession.sessionId)

      // UI 状态收敛：STREAM_COMPLETE 到达且 stoppedByUser=true
      const stopCompleted = await waitFor(async () =>
        (await getEvents(page)).complete.some((c) => c.sessionId === stopSession.sessionId && c.stoppedByUser), 30_000)

      const countAtStop = (await getEvents(page)).assistants
        .filter((a) => a.sessionId === stopSession.sessionId && a.partial).length
      // fake-stop-retry 首次请求 400ms/chunk；若未停止 1.2s 内会继续增长
      await sleep(1_200)
      const evAfterStop = await getEvents(page)
      const countAfterStop = evAfterStop.assistants
        .filter((a) => a.sessionId === stopSession.sessionId && a.partial).length
      const halted = countAfterStop <= countAtStop + 1
      const stopErrors = evAfterStop.errors.filter((e) => e.sessionId === stopSession.sessionId)
      check('pi-agent-stop-converges', streamingSeen && stopCompleted && halted && stopErrors.length === 0,
        `流式中间态=${streamingSeen}，stop 后 STREAM_COMPLETE(stoppedByUser=true)=${stopCompleted}，stop 时 _partial=${countAtStop}，1.2s 后=${countAfterStop}（流${halted ? '已停止' : '仍在继续'}），STREAM_ERROR=${stopErrors.length}`)

      // ----- Retry：同一 Pi 会话、同一模型重发同一条用户消息（handleRetry 的 sendAgentMessage 路径）-----
      await installEventCollectors(page)
      await sendPiMessage(page, {
        sessionId: stopSession.sessionId,
        userMessage: stopUserMessage,
        channelId: seeded.channelId,
        modelId: 'fake-stop-retry',
        workspaceId: seeded.workspaceId,
      }, false)

      const retryCompleted = await waitFor(async () =>
        (await getEvents(page)).complete.some((c) => c.sessionId === stopSession.sessionId), 60_000)

      const evRetry = await getEvents(page)
      const retryMine = evRetry.assistants.filter((a) => a.sessionId === stopSession.sessionId)
      const retryAllText = retryMine.map((a) => a.texts.join('')).join('')
      const retryFinalSeen = retryAllText.includes(MARKERS.text)
      const retryCompletes = evRetry.complete.filter((c) => c.sessionId === stopSession.sessionId)
      const retryStopped = retryCompletes.some((c) => c.stoppedByUser)
      const retryErrors = evRetry.errors.filter((e) => e.sessionId === stopSession.sessionId)
      check('pi-agent-retry-final', retryCompleted && retryFinalSeen && retryCompletes.length === 1 && !retryStopped && retryErrors.length === 0,
        `同模型同会话重发后最终文本含 ${MARKERS.text}=${retryFinalSeen}，STREAM_COMPLETE 次数=${retryCompletes.length}（stoppedByUser=${retryStopped}），STREAM_ERROR=${retryErrors.length}`)
    }

    // ===== fake server 侧证据：Pi 路径的请求确实到达（stream=true）=====
    {
      const textReqs = server.logs.filter((l) => l.model === 'fake-text' && l.stream === true)
      const thinkReqs = server.logs.filter((l) => l.model === 'fake-thinking' && l.stream === true)
      const stopRetryReqs = server.logs.filter((l) => l.model === 'fake-stop-retry' && l.stream === true)
      check('pi-requests-hit-fake-server', textReqs.length >= 1 && thinkReqs.length >= 1 && stopRetryReqs.length >= 2,
        `fake-text 流式请求 ${textReqs.length} 次（→ ${textReqs.map((l) => l.respondedStatus).join(',')}），fake-thinking 流式请求 ${thinkReqs.length} 次（→ ${thinkReqs.map((l) => l.respondedStatus).join(',')}），fake-stop-retry 同模型流式请求 ${stopRetryReqs.length} 次（→ ${stopRetryReqs.map((l) => l.respondedStatus).join(',')}）`)
    }

    // Fake server 请求日志摘要（证据）
    const summary = server.logs.map((l) =>
      `#${l.seq} ${l.method} ${l.model ?? l.url} stream=${l.stream ?? '-'} tool=${l.hasToolMessage ?? '-'} → ${l.respondedStatus}`,
    )
    console.log('--- fake server request log ---')
    for (const line of summary) console.log(`  ${line}`)

    // 无活跃会话遗留 running：临时 HOME 下应存在 agent-sessions 配置
    check('temp-home-config', existsSync(join(tmpHome, '.linguist-agent', 'channels.json')),
      `${join(tmpHome, '.linguist-agent', 'channels.json')} ${existsSync(join(tmpHome, '.linguist-agent', 'channels.json')) ? '存在' : '不存在'}（未触碰真实 ~/.linguist-agent）`)
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
  console.log(`=== G1 Pi 探针结果: ${passed} PASS / ${failed} FAIL ===`)
  process.exit(code)
}

await main()
