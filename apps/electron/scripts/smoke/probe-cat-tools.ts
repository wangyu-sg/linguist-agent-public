#!/usr/bin/env node
/**
 * PB-042 / PB-044 / PB-051 CAT customTools 探针 — 在【打包后的 .app】上验证
 * 六个会话绑定 CAT 工具装配进 Pi customTools，并执行 G4 完整脚本化对话。
 *
 * 观测面选择（如实记录）：工具是否到达模型、工具结果是否回到模型，唯一诚实的
 * 端到端观测面是「真实发往模型的 HTTP 请求体」。本探针给 fake model server 开启
 * captureTools（opt-in，默认关闭不影响既有探针），断言请求体 tools 数组与
 * role:"tool" 续接请求；工具活动事件经既有 onAgentStreamEvent 订阅面断言
 * （与 G1 pi 探针同一 surface，不新增通道）。
 *
 * 1. fs.mkdtemp 临时 HOME；启动【前】用 PB-025 headless CLI 播种项目 +
 *    import tests/linguist-fixtures/mini_items.json（含已知源文 "Health Potion"）。
 * 2. 启动打包应用；播种 fake 渠道 + onboardingCompleted。
 * 3. 经 IPC（linguistSessionsCreateForProject）创建项目对话 → 绑定在场。
 * 4. 项目对话发送 fake-cat-segments 消息（fake server 脚本化调用
 *    cat_get_segments，{"limit":5}）→ 断言：
 *    a. 首发请求体 tools 数组含全部 6 个 cat_*（Project Chat 有 CAT）；
 *    b. fake server 收到含 role:"tool" 的续接请求，且工具结果文本含播种源文
 *       "Health Potion"（工具在 App 内对真实项目库执行，非模型编造）；
 *    c. onAgentStreamEvent 出现 cat_get_segments 的 tool_use 块（工具活动经
 *       Proma 原流式系统，与 G1 同一 surface）；
 *    d. 最终标记文本 TOOL_ROUNDTRIP_FINAL_MARKER_G0 流式到达 + STREAM_COMPLETE。
 * 5. 同一会话再发 fake-text（sdkSessionId 已在 → resume 路径）→ 新请求体
 *    tools 仍含 6 个 cat_*（Session resume 后 Tool 仍绑定同 Project：工具数组
 *    每次发送重建、绑定实时重解析）。
 * 6. 普通会话（createAgentSession，不携带绑定）发送 fake-text → 请求体 tools
 *    数组不含任何 cat_*（普通 Chat Tool 列表无 CAT）。
 * 7. tmp HOME 隔离断言（agent-sessions.json 落在临时 HOME）。
 *
 * Permission/Stop/Retry 不回归由既有探针覆盖（run-g0-smoke 18 项、
 * probe-project-session 归档闸门）；本探针只证 CAT 工具机制。
 *
 * 运行前提：已执行 `bun run smoke:pack`（产出 apps/electron/out/mac-arm64/*.app）
 * 注意：必须用 Node 运行（同其余探针；playwright-core ws upgrade 在 bun 下失败）。
 */

import { _electron as electron, type ElectronApplication, type Page } from 'playwright-core'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, existsSync, createWriteStream, readdirSync, readFileSync, type WriteStream } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  startFakeModelServer,
  FAKE_MODEL_IDS,
  FAKE_CAT_TOOL_NAME,
  FAKE_CAT_SUMMARY_TOOL_NAME,
  FAKE_CAT_PROPOSAL_TOOL_NAME,
  FAKE_CAT_QA_TOOL_NAME,
  G5_PROPOSAL_MARKER,
  G5_PROPOSAL_TARGET,
  G4_SUMMARY_MARKER,
  QA_RUN_MARKER,
  MARKERS,
  type FakeModelServer,
} from './fake-model-server.ts'

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url))
const APP_DIR = resolve(SCRIPT_DIR, '..', '..')
/** apps/electron/scripts/smoke → 上溯四级到仓根 */
const REPO_ROOT = resolve(SCRIPT_DIR, '..', '..', '..', '..')
const CLI_DIR = join(REPO_ROOT, 'packages', 'linguist-cat-store')
const FIXTURE_PATH = join(REPO_ROOT, 'tests', 'linguist-fixtures', 'mini_items.json')

const PROJECT_NAME = 'PB-042 CAT 工具探针项目'
const CAT_TOOL_NAMES = [
  'cat_project_summary',
  'cat_list_assets',
  'cat_get_segments',
  'cat_search_tm',
  'cat_search_terms',
  'cat_propose_translations',
  'cat_run_qa',
  'cat_get_qa_findings',
] as const
/** mini_items.json 中的已知源文叶子（工具结果必须携带，证明读的是真实项目库） */
const SEEDED_SOURCE = 'Health Potion'

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

// ===== 应用启动（与 probe-project-skill.ts 相同模式） =====

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

// ===== 渲染进程内的流式事件收集（onAgentStreamEvent —— 与 G1 pi 探针同一 surface） =====

interface ProbeEvents {
  toolUses: Array<{ sessionId: string; name: string }>
  texts: Array<{ sessionId: string; text: string }>
  complete: Array<{ sessionId: string }>
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
              message?: { content?: Array<{ type?: string; text?: string; name?: string }> }
            }
          }
        }) => void) => () => void
        onAgentStreamComplete: (cb: (d: { sessionId: string }) => void) => () => void
        onAgentStreamError: (cb: (d: { sessionId: string; error: string }) => void) => () => void
      }
      __pb042Events: ProbeEvents
      __pb042Unsub?: Array<() => void>
    }
    if (w.__pb042Unsub) for (const u of w.__pb042Unsub) u()
    w.__pb042Events = { toolUses: [], texts: [], complete: [], errors: [] }
    const api = w.electronAPI
    w.__pb042Unsub = [
      api.onAgentStreamEvent((e) => {
        if (e?.payload?.kind !== 'sdk_message') return
        const msg = e.payload.message
        if (!msg || msg.type !== 'assistant') return
        for (const block of msg.message?.content ?? []) {
          if (block.type === 'tool_use' && typeof block.name === 'string') {
            w.__pb042Events.toolUses.push({ sessionId: e.sessionId, name: block.name })
          }
          if (block.type === 'text' && typeof block.text === 'string') {
            w.__pb042Events.texts.push({ sessionId: e.sessionId, text: block.text })
          }
        }
      }),
      api.onAgentStreamComplete((d) => w.__pb042Events.complete.push({ sessionId: d.sessionId })),
      api.onAgentStreamError((d) => w.__pb042Events.errors.push({ sessionId: d.sessionId, error: d.error })),
    ]
  })
}

async function getEvents(page: Page): Promise<ProbeEvents> {
  return page.evaluate(() => (window as unknown as { __pb042Events: ProbeEvents }).__pb042Events)
}

/** 通过 electronAPI 发送消息（与 AgentView 同一入口），等待该会话 STREAM_COMPLETE。 */
async function sendAndWaitComplete(
  page: Page,
  input: { sessionId: string; channelId: string; modelId: string; text: string },
): Promise<boolean> {
  const completedBefore = (await getEvents(page)).complete.filter(
    (event) => event.sessionId === input.sessionId,
  ).length
  await page.evaluate(async (args) => {
    const api = (window as unknown as {
      electronAPI: { sendAgentMessage: (input: unknown) => Promise<void> }
    }).electronAPI
    await api.sendAgentMessage({
      sessionId: args.sessionId,
      userMessage: args.text,
      channelId: args.channelId,
      modelId: args.modelId,
      agentRuntime: 'pi',
      startedAt: Date.now(),
    })
  }, input)
  return waitFor(
    async () => (await getEvents(page)).complete.filter(
      (event) => event.sessionId === input.sessionId,
    ).length > completedBefore,
    90_000,
  )
}

// ===== 主流程 =====

async function main(): Promise<void> {
  console.log('=== PB-042 / PB-044 CAT customTools 探针（packaged .app + fake server tools 捕获）===')
  console.log(` packaged binary: ${PACKAGED_BINARY}`)

  if (!existsSync(PACKAGED_BINARY)) {
    check('packaged-binary-exists', false, `未找到 ${PACKAGED_BINARY}，请先运行 bun run smoke:pack`)
    summarizeAndExit(1)
  }
  check('packaged-binary-exists', true, PACKAGED_BINARY)

  const tmpHome = mkdtempSync(join(tmpdir(), 'proma-pb042-probe-home-'))
  const artifactDir = mkdtempSync(join(tmpdir(), 'proma-pb042-probe-artifacts-'))
  const mainLogPath = join(artifactDir, 'main-process.log')
  const logStream = createWriteStream(mainLogPath)
  console.log(` tmp HOME: ${tmpHome}`)
  console.log(` artifacts: ${artifactDir}`)

  // 1. 启动前播种项目 + 导入 fixture 资产
  const linguistRoot = join(tmpHome, '.linguist-agent', 'linguist')
  let projectId = ''
  let segmentCount = 0
  let seededSegments: Array<{ id: string; source: string }> = []
  try {
    const created = runCli(['create-project', '--root', linguistRoot, '--name', PROJECT_NAME, '--source', 'en', '--target', 'zh-CN'])
    projectId = cliField(created, 'project')
    const imported = runCli(['import', '--root', linguistRoot, '--project', projectId, '--file', FIXTURE_PATH])
    segmentCount = Number(cliField(imported, 'segments'))
    const segmentLines = runCli([
      'segments',
      '--root',
      linguistRoot,
      '--project',
      projectId,
      '--limit',
      '4',
    ]).split('\n').filter((line) => line.startsWith('{'))
    seededSegments = segmentLines.map((line) => JSON.parse(line) as { id: string; source: string })
    if (seededSegments.length !== 4 || seededSegments[0]?.source !== SEEDED_SOURCE) {
      throw new Error(`前四段不符合预期: ${segmentLines.join(' | ')}`)
    }
  } catch (err) {
    check('cli-seed', false, `CLI 播种失败：${err instanceof Error ? err.message : String(err)}`)
    summarizeAndExit(1)
  }
  check('cli-seed', true, `项目 ${projectId}，导入 mini_items.json（${segmentCount} 段）`)

  let server: FakeModelServer | undefined
  let launched: LaunchedApp | undefined
  let sessionId = ''
  let channelId = ''

  try {
    server = await startFakeModelServer(0, { captureTools: true })
    console.log(` fake model server: ${server.baseUrl}（captureTools=on）`)

    launched = await launchApp(tmpHome, logStream)
    const { page } = launched
    check('packaged-launch', true, '主窗口获取成功，window.electronAPI 就绪')

    // 2. 播种 fake 渠道 + onboarding
    channelId = await page.evaluate(async (args) => {
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

    // 3. 经 IPC 创建项目对话（PB-034 绑定入口；UI 路径已由 probe-project-skill 覆盖）
    const createdChat = await page.evaluate(async (pid) => {
      const api = (window as unknown as {
        electronAPI: {
          linguistSessionsCreateForProject: (input: { projectId: string }) => Promise<
            | { ok: true; data: { id: string; linguistProjectId?: string } }
            | { ok: false; error: { code: string; message?: string } }
          >
        }
      }).electronAPI
      const created = await api.linguistSessionsCreateForProject({ projectId: pid })
      return created.ok
        ? { ok: true as const, id: created.data.id, bound: created.data.linguistProjectId === pid }
        : { ok: false as const, code: created.error.code }
    }, projectId)
    check('create-project-chat-ipc', createdChat.ok && createdChat.bound,
      createdChat.ok ? `项目会话 ${createdChat.id}，绑定 linguistProjectId 在场` : `创建失败：${JSON.stringify(createdChat)}`)
    if (!createdChat.ok) summarizeAndExit(1)
    sessionId = createdChat.id
    await installEventCollectors(page)

    // 4. 项目对话发送 fake-cat-segments：脚本化调用 cat_get_segments
    const beforeTool = server.logs.length
    const toolDone = await sendAndWaitComplete(page, {
      sessionId,
      channelId,
      modelId: 'fake-cat-segments',
      text: '请读取项目段（探针脚本化触发 cat_get_segments）',
    })
    const toolRoundLogs = server.logs.slice(beforeTool).filter((l) => l.stream === true && l.model === 'fake-cat-segments')
    // a. 首发请求（无 role:"tool"）的 tools 数组含全部 8 个 cat_*
    const firstRequest = toolRoundLogs.find((l) => l.hasToolMessage !== true)
    const firstToolNames = firstRequest?.toolNames ?? []
    const missingCatNames = CAT_TOOL_NAMES.filter((name) => !firstToolNames.includes(name))
    check('project-chat-cat-tools-advertised', toolRoundLogs.length > 0 && missingCatNames.length === 0,
      `首发流式请求数=${toolRoundLogs.length}，请求体 tools 含 8 个 cat_*=${missingCatNames.length === 0}` +
      `（tools 总数=${firstToolNames.length}${missingCatNames.length > 0 ? `，缺: ${missingCatNames.join(',')}` : ''}）`)
    // b. 续接请求含 role:"tool"，且工具结果文本携带播种源文（工具在 App 内真实执行）
    const followup = toolRoundLogs.find((l) => l.hasToolMessage === true)
    const toolResultText = followup?.toolResultText ?? ''
    check('cat-tool-executed-in-app', followup !== undefined && toolResultText.includes(SEEDED_SOURCE),
      `续接请求（role:"tool"）=${followup !== undefined}，结果文本含播种源文 "${SEEDED_SOURCE}"=${toolResultText.includes(SEEDED_SOURCE)}` +
      `（结果文本长度=${toolResultText.length}）`)
    // c. 工具活动经 onAgentStreamEvent（Proma 原流式系统，G1 同一 surface）
    const events = await getEvents(page)
    const toolUseSeen = events.toolUses.some((t) => t.sessionId === sessionId && t.name === FAKE_CAT_TOOL_NAME)
    check('tool-activity-via-agent-stream', toolUseSeen,
      `onAgentStreamEvent 捕获 tool_use ${FAKE_CAT_TOOL_NAME}=${toolUseSeen}（本会话 tool_use 数=${events.toolUses.filter((t) => t.sessionId === sessionId).length}）`)
    // d. 最终文本流式到达 + STREAM_COMPLETE
    const finalTextSeen = events.texts.some((t) => t.sessionId === sessionId && t.text.includes(MARKERS.tool))
    check('final-text-streamed', toolDone && finalTextSeen,
      `STREAM_COMPLETE=${toolDone}，最终标记 ${MARKERS.tool} 流式到达=${finalTextSeen}` +
      `${events.errors.length > 0 ? `，errors=${JSON.stringify(events.errors)}` : ''}`)

    // PB-044：计划规定的精确 Project Chat 真机脚本。
    const beforeSummaryLogs = server.logs.length
    const beforeSummaryTexts = events.texts.filter((event) => event.sessionId === sessionId).length
    const summaryDone = await sendAndWaitComplete(page, {
      sessionId,
      channelId,
      modelId: 'fake-cat-summary',
      text: '总结这个项目',
    })
    const summaryLogs = server.logs.slice(beforeSummaryLogs).filter(
      (entry) => entry.stream === true && entry.model === 'fake-cat-summary',
    )
    const summaryFollowup = summaryLogs.find((entry) => entry.hasToolMessage === true)
    const summaryResult = summaryFollowup?.toolResultText ?? ''
    const summaryEvents = await getEvents(page)
    const summaryToolSeen = summaryEvents.toolUses.some(
      (event) => event.sessionId === sessionId && event.name === FAKE_CAT_SUMMARY_TOOL_NAME,
    )
    const summaryTexts = summaryEvents.texts
      .filter((event) => event.sessionId === sessionId)
      .slice(beforeSummaryTexts)
    const summaryFinalSeen = summaryTexts.some((event) => event.text.includes(G4_SUMMARY_MARKER))
    check(
      'g4-project-summary-roundtrip',
      summaryDone
        && summaryLogs.length >= 2
        && summaryToolSeen
        && summaryResult.includes(PROJECT_NAME)
        && summaryFinalSeen
        && summaryTexts.length >= 2,
      `用户「总结这个项目」→ ${FAKE_CAT_SUMMARY_TOOL_NAME}=${summaryToolSeen}` +
      ` → tool result 含项目名=${summaryResult.includes(PROJECT_NAME)}` +
      ` → 流式 final=${summaryFinalSeen}（text events=${summaryTexts.length}，complete=${summaryDone}）`,
    )

    // PB-071：Agent 实际执行 cat_run_qa；不存在 resolve/waive tool。
    const beforeQaLogs = server.logs.length
    const beforeQaTexts = events.texts.filter((event) => event.sessionId === sessionId).length
    const qaDone = await sendAndWaitComplete(page, {
      sessionId,
      channelId,
      modelId: 'fake-cat-qa',
      text: '运行项目 QA',
    })
    const qaLogs = server.logs.slice(beforeQaLogs).filter(
      (entry) => entry.stream === true && entry.model === 'fake-cat-qa',
    )
    const qaFollowup = qaLogs.find((entry) => entry.hasToolMessage === true)
    const qaToolResult = qaFollowup?.toolResultText ?? ''
    const qaEvents = await getEvents(page)
    const qaToolSeen = qaEvents.toolUses.some(
      (event) => event.sessionId === sessionId && event.name === FAKE_CAT_QA_TOOL_NAME,
    )
    const qaFinalSeen = qaEvents.texts
      .filter((event) => event.sessionId === sessionId)
      .slice(beforeQaTexts)
      .some((event) => event.text.includes(QA_RUN_MARKER))
    const qaForbiddenTools = (qaLogs.find((entry) => entry.hasToolMessage !== true)?.toolNames ?? [])
      .filter((name) => /resolve|waive/i.test(name))
    check(
      'pb071-agent-runs-qa-without-review-tools',
      qaDone && qaToolSeen && qaToolResult.includes('severityCounts') && qaFinalSeen && qaForbiddenTools.length === 0,
      `tool=${qaToolSeen}，结果含 severityCounts=${qaToolResult.includes('severityCounts')}，final=${qaFinalSeen}` +
      `，resolve/waive tools=${qaForbiddenTools.length}`,
    )

    // 5. resume 一致：同一会话再发 fake-text（sdkSessionId 已在 → resume 路径），
    //    新请求体 tools 仍含 8 个 cat_*（工具每次发送重建、绑定实时重解析）
    const beforeResume = server.logs.length
    const resumeDone = await sendAndWaitComplete(page, {
      sessionId,
      channelId,
      modelId: 'fake-text',
      text: 'PB-042 resume 一致第二条',
    })
    const resumeStream = server.logs.slice(beforeResume).filter((l) => l.stream === true && l.model === 'fake-text')
    const resumeToolNames = resumeStream.at(-1)?.toolNames ?? []
    const resumeMissing = CAT_TOOL_NAMES.filter((name) => !resumeToolNames.includes(name))
    check('resume-tools-consistent', resumeDone && resumeStream.length > 0 && resumeMissing.length === 0,
      `STREAM_COMPLETE=${resumeDone}，resume 请求 tools 仍含 8 个 cat_*=${resumeMissing.length === 0}（tools 总数=${resumeToolNames.length}）`)

    // 6. 普通会话（createAgentSession，绝不携带绑定）：请求体 tools 无任何 cat_*
    const normalSessionId = await page.evaluate(async () => {
      const api = (window as unknown as {
        electronAPI: { createAgentSession: (title?: string) => Promise<{ id: string; linguistProjectId?: string }> }
      }).electronAPI
      const meta = await api.createAgentSession('PB-042 普通对话')
      return meta.linguistProjectId === undefined ? meta.id : ''
    })
    check('normal-chat-unbound', normalSessionId.length > 0, `普通会话未携带 linguistProjectId（id=${normalSessionId || '<绑定异常>'}）`)
    const beforeNormal = server.logs.length
    const normalDone = await sendAndWaitComplete(page, {
      sessionId: normalSessionId,
      channelId,
      modelId: 'fake-text',
      text: 'PB-042 普通对话消息',
    })
    const normalStream = server.logs.slice(beforeNormal).filter((l) => l.stream === true && l.model === 'fake-text')
    const normalToolNames = normalStream.at(-1)?.toolNames ?? []
    const leakedCatNames = normalToolNames.filter((name) => name.startsWith('cat_'))
    check('normal-chat-no-cat-tools', normalDone && normalStream.length > 0 && leakedCatNames.length === 0,
      `STREAM_COMPLETE=${normalDone}，普通会话 tools 数组（${normalToolNames.length} 个）含 cat_*=${leakedCatNames.length > 0}` +
      `${leakedCatNames.length > 0 ? `，泄漏: ${leakedCatNames.join(',')}` : ''}`)

    // 7. G5：Agent 只能创建 Proposal；用户在 Project「建议」页点击接受后 Segment 才更新。
    const beforeProposal = server.logs.length
    const proposalDone = await sendAndWaitComplete(page, {
      sessionId,
      channelId,
      modelId: 'fake-cat-proposal',
      text: `请为项目首段创建翻译建议，segmentId=${seededSegments[0]!.id}`,
    })
    const proposalLogs = server.logs.slice(beforeProposal).filter(
      (entry) => entry.stream === true && entry.model === 'fake-cat-proposal',
    )
    const proposalFollowup = proposalLogs.find((entry) => entry.hasToolMessage === true)
    const proposalToolResult = proposalFollowup?.toolResultText ?? ''
    const proposalToolNames = proposalLogs.find((entry) => entry.hasToolMessage !== true)?.toolNames ?? []
    const forbiddenWriteTools = proposalToolNames.filter((name) => /accept|commit|reject/i.test(name))
    const proposalEvents = await getEvents(page)
    const proposalToolSeen = proposalEvents.toolUses.some(
      (event) => event.sessionId === sessionId && event.name === FAKE_CAT_PROPOSAL_TOOL_NAME,
    )
    const proposalFinalSeen = proposalEvents.texts.some(
      (event) => event.sessionId === sessionId && event.text.includes(G5_PROPOSAL_MARKER),
    )
    check(
      'g5-agent-creates-proposal-only',
      proposalDone
        && proposalToolSeen
        && proposalToolResult.includes('prp-')
        && proposalFinalSeen
        && forbiddenWriteTools.length === 0,
      `tool=${proposalToolSeen}，result 含 proposalId=${proposalToolResult.includes('prp-')}` +
      `，final=${proposalFinalSeen}，Agent accept/commit/reject tools=${forbiddenWriteTools.length}`,
    )

    await page.getByRole('tab', { name: 'Linguist', exact: true }).click()
    await page.getByRole('list', { name: '本地化项目', exact: true })
      .getByRole('button', { name: `打开项目 ${PROJECT_NAME}`, exact: true }).click()
    await page.getByRole('tab', { name: 'CAT', exact: true }).click()
    const catWorkspace = page.locator('section[aria-label="Segment 编辑器"]')
    const firstRow = catWorkspace.locator(`[role="row"][data-segment-id="${seededSegments[0]!.id}"]`)
    const pendingMarker = await firstRow.getByText('Proposal 待审', { exact: true })
      .waitFor({ timeout: 30_000 }).then(() => true).catch(() => false)
    await firstRow.getByRole('button', { name: '查看原始行 1 上下文' }).click()
    const proposalReview = firstRow.locator('section[aria-label="当前行翻译建议"]')
    const proposalVisible = await proposalReview.getByText(G5_PROPOSAL_TARGET, { exact: true })
      .waitFor({ timeout: 30_000 }).then(() => true).catch(() => false)
    check('pb064-grid-proposal-inline-diff', pendingMarker && proposalVisible,
      `Grid pending marker=${pendingMarker}，行内 diff 建议译文=${proposalVisible}`)

    await proposalReview.getByRole('button', { name: 'Accept', exact: true }).click()
    const markerCleared = await firstRow.getByText('Proposal 待审', { exact: true })
      .waitFor({ state: 'detached', timeout: 30_000 }).then(() => true).catch(() => false)
    const acceptedSegmentLine = runCli([
      'segments',
      '--root',
      linguistRoot,
      '--project',
      projectId,
      '--limit',
      '1',
    ]).split('\n').find((line) => line.startsWith('{'))
    const acceptedSegment = acceptedSegmentLine === undefined
      ? {}
      : JSON.parse(acceptedSegmentLine) as { target?: unknown; revision?: unknown }
    check(
      'g5-human-accept-updates-segment',
      markerCleared && acceptedSegment.target === G5_PROPOSAL_TARGET && acceptedSegment.revision === 1,
      `Grid marker 清空=${markerCleared}，target=${String(acceptedSegment.target)}` +
      `，revision=${String(acceptedSegment.revision)}`,
    )

    // PB-064：两个所选 Proposal 原子批量拒绝；第三个在行内审核打开后制造竞态，显示 conflict + stale badge。
    for (const segment of seededSegments.slice(1, 4)) {
      const done = await sendAndWaitComplete(page, {
        sessionId,
        channelId,
        modelId: 'fake-cat-proposal',
        text: `请创建翻译建议，segmentId=${segment.id}`,
      })
      if (!done) throw new Error(`Proposal 创建未完成: ${segment.id}`)
    }
    await page.getByRole('tab', { name: 'Chat', exact: true }).click()
    await page.getByRole('tab', { name: 'CAT', exact: true }).click()
    const reloadedWorkspace = page.locator('section[aria-label="Segment 编辑器"]')
    await reloadedWorkspace.getByText('Proposal 待审', { exact: true }).first().waitFor({ timeout: 30_000 })
    await reloadedWorkspace.getByRole('checkbox', { name: '选择原始行 2' }).check()
    await reloadedWorkspace.getByRole('checkbox', { name: '选择原始行 3' }).check()
    await reloadedWorkspace.getByRole('button', { name: '拒绝所选建议' }).click()
    const pendingAfterBulk = await page.evaluate(async (pid) => {
      const api = (window as unknown as {
        electronAPI: {
          linguistProposalsListPending: (input: { projectId: string }) => Promise<
            { ok: true; data: Array<{ segmentId: string }> } | { ok: false }
          >
        }
      }).electronAPI
      const result = await api.linguistProposalsListPending({ projectId: pid })
      return result.ok ? result.data.map((proposal) => proposal.segmentId) : []
    }, projectId)
    check('pb064-selected-bulk-reject',
      pendingAfterBulk.length === 1 && pendingAfterBulk[0] === seededSegments[3]!.id,
      `批量拒绝后 pending=${pendingAfterBulk.join(',')}（仅保留第 4 段）`)

    const fourthRow = reloadedWorkspace.locator(`[role="row"][data-segment-id="${seededSegments[3]!.id}"]`)
    await fourthRow.getByRole('button', { name: '查看原始行 4 上下文' }).click()
    const fourthReview = fourthRow.locator('section[aria-label="当前行翻译建议"]')
    const acceptBeforeRace = fourthReview.getByRole('button', { name: 'Accept', exact: true })
    await acceptBeforeRace.waitFor({ timeout: 15_000 })
    runCli([
      'edit',
      '--root',
      linguistRoot,
      '--project',
      projectId,
      '--segment',
      seededSegments[3]!.id,
      '--target',
      '并发人工译文',
      '--expected-revision',
      '0',
    ])
    await acceptBeforeRace.click()
    const conflictToast = await page.getByText('建议已发生冲突', { exact: true })
      .waitFor({ timeout: 30_000 }).then(() => true).catch(() => false)
    const staleBadge = await fourthRow.getByText('Proposal 已过期', { exact: true })
      .waitFor({ timeout: 30_000 }).then(() => true).catch(() => false)
    const staleAcceptDisabled = await fourthReview.getByRole('button', { name: 'Accept', exact: true }).isDisabled()
    check('pb064-conflict-stale-badge',
      conflictToast && staleBadge && staleAcceptDisabled,
      `冲突 toast=${conflictToast}，stale badge=${staleBadge}，接受禁用=${staleAcceptDisabled}`)
    await fourthReview.getByRole('button', { name: 'Reject', exact: true }).click()

    // G6：关闭并用同一临时 HOME 重启，已接受译文与 Proposal 终态必须从 SQLite 恢复。
    await quitApp(launched.app)
    launched = undefined
    launched = await launchApp(tmpHome, logStream)
    await enterMainUI(launched.page)
    await launched.page.getByRole('tab', { name: 'Linguist', exact: true }).click()
    await launched.page.getByRole('list', { name: '本地化项目', exact: true })
      .getByRole('button', { name: `打开项目 ${PROJECT_NAME}`, exact: true }).click()
    await launched.page.getByRole('tab', { name: 'CAT', exact: true }).click()
    const restartedWorkspace = launched.page.locator('section[aria-label="Segment 编辑器"]')
    const acceptedAfterRestart = await restartedWorkspace.getByText(G5_PROPOSAL_TARGET, { exact: true })
      .waitFor({ timeout: 30_000 }).then(() => true).catch(() => false)
    const pendingAfterRestart = await launched.page.evaluate(async (pid) => {
      const result = await (window as unknown as {
        electronAPI: {
          linguistProposalsListPending: (input: { projectId: string }) => Promise<
            { ok: true; data: unknown[] } | { ok: false }
          >
        }
      }).electronAPI.linguistProposalsListPending({ projectId: pid })
      return result.ok ? result.data.length : -1
    }, projectId)
    check('g6-restart-cat-state-recovered',
      acceptedAfterRestart && pendingAfterRestart === 0,
      `同 HOME 重启后已接受译文可见=${acceptedAfterRestart}，pending Proposal=${pendingAfterRestart}`)

    // 8. tmp HOME 隔离：会话索引落在临时 HOME
    const indexPath = join(tmpHome, '.linguist-agent', 'agent-sessions.json')
    const indexOk = existsSync(indexPath) && readFileSync(indexPath, 'utf-8').includes(projectId)
    check('temp-home-isolation', indexOk,
      `${indexPath} 存在且含项目 id=${indexOk}（未触碰真实 ~/.linguist-agent）`)
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
  console.log(`\n=== PB-042 / PB-044 / G5 / PB-064 / G6 / PB-071 探针结果：${passed} PASS / ${failed} FAIL ===`)
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
