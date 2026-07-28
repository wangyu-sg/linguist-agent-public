#!/usr/bin/env node
/**
 * LF-069 / G-F4 Agent-CAT Fusion packaged 探针。
 *
 * 只产生自动化证据，不宣布 Gate 通过。真实打包产物上的闭环：
 * 选 3 段 → Context Chip → 项目 Agent 快捷翻译 → 现有 CAT Tool 创建 3 条
 * Proposal → Tool Card 定位 → Accept 2 / Reject 1 → Grid 与 Timeline 同步
 * → 完整 Agent Tab 往返后状态仍在。
 *
 * 模型端使用本文件内的 hermetic OpenAI-compatible server。它只调用应用已经
 * 暴露的 cat_propose_translations；Proposal、审核和同步均由打包 App 的真实
 * 主进程、项目库和 Renderer 完成。
 *
 * 运行前提：
 *   cd apps/electron
 *   CSC_IDENTITY_AUTO_DISCOVERY=false bun run smoke:pack
 *   node scripts/smoke/probe-lf069-fusion.ts
 */

import { execFileSync } from 'node:child_process'
import {
  createWriteStream,
  existsSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  type WriteStream,
} from 'node:fs'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { finished } from 'node:stream/promises'
import { fileURLToPath } from 'node:url'
import { _electron as electron, type ElectronApplication, type Page } from 'playwright-core'

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url))
const APP_DIR = resolve(SCRIPT_DIR, '..', '..')
const REPO_ROOT = resolve(SCRIPT_DIR, '..', '..', '..', '..')
const CLI_DIR = join(REPO_ROOT, 'packages', 'linguist-cat-store')
const FIXTURE_PATH = join(REPO_ROOT, 'tests', 'linguist-fixtures', 'mini_items.json')
const PROJECT_NAME = 'LF-069 Agent-CAT Fusion 探针'
const MODEL_ID = 'fake-lf069-fusion'
const FINAL_MARKER = 'LF069_FUSION_FINAL_MARKER'
const CAT_PROPOSAL_TOOL = 'cat_propose_translations'

interface SeededSegment {
  id: string
  source: string
  target: string
  revision: number
}

interface PlannedProposal {
  segmentId: string
  baseRevision: number
  proposedTarget: string
}

interface ModelMessage {
  role?: string
  content?: unknown
}

interface ModelTool {
  function?: { name?: string }
}

interface ModelRequest {
  model?: string
  stream?: boolean
  messages?: ModelMessage[]
  tools?: ModelTool[]
}

interface FusionRequestLog {
  stream: boolean
  hasToolResult: boolean
  messageText: string
  toolNames: string[]
  toolResultText: string
}

interface FusionModelServer {
  baseUrl: string
  logs: FusionRequestLog[]
  close: () => Promise<void>
}

interface ProbeEvents {
  toolUses: Array<{ sessionId: string; name: string }>
  texts: Array<{ sessionId: string; text: string }>
  complete: Array<{ sessionId: string }>
  errors: Array<{ sessionId: string; error: string }>
}

interface CheckResult {
  name: string
  pass: boolean
  evidence: string
}

interface LaunchedApp {
  app: ElectronApplication
  page: Page
}

interface ExpandedProposalToolCard {
  card: ReturnType<Page['locator']>
  toolRowVisible: boolean
  toolRowCount: number
  expanded: boolean
  diagnostics: string
}

interface VisibleGridTargetResult {
  matched: boolean
  diagnostics: string[]
}

const results: CheckResult[] = []
let activeApp: ElectronApplication | undefined

function check(name: string, pass: boolean, evidence: string): void {
  results.push({ name, pass, evidence })
  console.log(`[${pass ? 'PASS' : 'FAIL'}] ${name} — ${evidence}`)
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolveSleep) => setTimeout(resolveSleep, ms))
}

async function waitFor(
  predicate: () => Promise<boolean>,
  timeoutMs: number,
  intervalMs = 250,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (await predicate()) return true
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

function cliField(output: string, key: string): string {
  const line = output.split('\n').find((candidate) => candidate.startsWith(`${key}: `))
  if (line === undefined) throw new Error(`CLI 输出缺少字段 ${key}: ${output}`)
  return line.slice(key.length + 2).trim()
}

function messageText(messages: readonly ModelMessage[] | undefined): string {
  return (messages ?? [])
    .map((message) => typeof message.content === 'string'
      ? message.content
      : JSON.stringify(message.content ?? ''))
    .join('\n')
}

async function readRequestBody(request: IncomingMessage): Promise<string> {
  let body = ''
  for await (const chunk of request) {
    body += Buffer.isBuffer(chunk) ? chunk.toString('utf8') : String(chunk)
  }
  return body
}

function sseChunk(
  delta: Record<string, unknown>,
  finishReason: 'stop' | 'tool_calls' | null = null,
): string {
  return `data: ${JSON.stringify({
    id: 'chatcmpl-lf069',
    object: 'chat.completion.chunk',
    created: 1_700_000_000,
    model: MODEL_ID,
    choices: [{ index: 0, delta, finish_reason: finishReason }],
  })}\n\n`
}

function writeJson(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { 'content-type': 'application/json' })
  response.end(JSON.stringify(body))
}

function writeSse(response: ServerResponse, chunks: readonly string[]): void {
  response.writeHead(200, {
    'content-type': 'text/event-stream',
    'cache-control': 'no-cache',
    connection: 'keep-alive',
  })
  for (const chunk of chunks) response.write(chunk)
  response.end('data: [DONE]\n\n')
}

async function startFusionModelServer(
  proposals: readonly PlannedProposal[],
): Promise<FusionModelServer> {
  const logs: FusionRequestLog[] = []
  const server = createServer((request, response) => {
    void (async () => {
      const url = request.url ?? ''
      if (request.method === 'GET' && url.startsWith('/v1/models')) {
        writeJson(response, 200, {
          object: 'list',
          data: [{ id: MODEL_ID, object: 'model', created: 1_700_000_000, owned_by: 'fake' }],
        })
        return
      }
      if (request.method !== 'POST' || !url.startsWith('/v1/chat/completions')) {
        writeJson(response, 404, { error: { message: 'not found' } })
        return
      }

      const body = JSON.parse(await readRequestBody(request)) as ModelRequest
      const hasToolResult = body.messages?.some((message) => message.role === 'tool') === true
      const toolResultText = (body.messages ?? [])
        .filter((message) => message.role === 'tool')
        .map((message) => typeof message.content === 'string'
          ? message.content
          : JSON.stringify(message.content ?? ''))
        .join('\n')
      logs.push({
        stream: body.stream === true,
        hasToolResult,
        messageText: messageText(body.messages),
        toolNames: (body.tools ?? [])
          .map((tool) => tool.function?.name)
          .filter((name): name is string => typeof name === 'string'),
        toolResultText,
      })

      if (body.stream !== true) {
        writeJson(response, 200, {
          id: 'chatcmpl-lf069-title',
          object: 'chat.completion',
          created: 1_700_000_000,
          model: MODEL_ID,
          choices: [{
            index: 0,
            message: { role: 'assistant', content: 'LF-069 Fusion' },
            finish_reason: 'stop',
          }],
        })
        return
      }

      if (hasToolResult) {
        writeSse(response, [
          sseChunk({ role: 'assistant' }),
          sseChunk({ content: `三条翻译建议已创建。${FINAL_MARKER}` }, 'stop'),
        ])
        return
      }

      writeSse(response, [
        sseChunk({ role: 'assistant' }),
        sseChunk({
          tool_calls: [{
            index: 0,
            id: 'call_lf069_proposals',
            type: 'function',
            function: {
              name: CAT_PROPOSAL_TOOL,
              arguments: JSON.stringify({ segmentProposals: proposals }),
            },
          }],
        }),
        sseChunk({}, 'tool_calls'),
      ])
    })().catch((error) => {
      if (!response.writableEnded) {
        writeJson(response, 500, {
          error: { message: error instanceof Error ? error.message : String(error) },
        })
      }
    })
  })

  await new Promise<void>((resolveListen, rejectListen) => {
    server.once('error', rejectListen)
    server.listen(0, '127.0.0.1', () => resolveListen())
  })
  const address = server.address()
  if (address === null || typeof address === 'string') {
    await new Promise<void>((resolveClose) => server.close(() => resolveClose()))
    throw new Error('Fake model server 未获得 TCP 端口')
  }
  return {
    baseUrl: `http://127.0.0.1:${address.port}/v1`,
    logs,
    close: () => new Promise<void>((resolveClose, rejectClose) => {
      server.close((error) => error ? rejectClose(error) : resolveClose())
    }),
  }
}

async function waitForMainWindow(app: ElectronApplication, timeoutMs: number): Promise<Page> {
  const isMain = (url: string): boolean => url.includes('index.html') && !url.includes('window=')
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    for (const window of app.windows()) {
      if (isMain(window.url())) return window
    }
    try {
      const window = await app.waitForEvent('window', { timeout: 5_000 })
      if (isMain(window.url())) return window
    } catch (error) {
      if (!(error instanceof Error && error.name === 'TimeoutError')) throw error
    }
  }
  throw new Error(`未找到主窗口（${app.windows().map((window) => window.url()).join(', ')}）`)
}

async function launchApp(tmpHome: string, logStream: WriteStream): Promise<LaunchedApp> {
  const app = await electron.launch({
    executablePath: PACKAGED_BINARY,
    args: [`--user-data-dir=${join(tmpHome, '.electron-user-data')}`],
    env: {
      ...process.env,
      HOME: tmpHome,
      LINGUIST_SMOKE_PLAINTEXT_CREDENTIALS: '1',
    } as Record<string, string>,
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
  const processHandle = app.process()
  const exited = new Promise<void>((resolveExit) => {
    if (processHandle.killed || processHandle.exitCode !== null) resolveExit()
    else processHandle.once('exit', () => resolveExit())
  })
  await Promise.race([app.close().catch(() => undefined), sleep(45_000)])
  const closed = await Promise.race([exited.then(() => true), sleep(20_000).then(() => false)])
  if (!closed) {
    try {
      processHandle.kill('SIGKILL')
    } catch {
      // 已退出
    }
    await Promise.race([exited, sleep(5_000)])
  }
  if (activeApp === app) activeApp = undefined
}

async function configureApp(page: Page, server: FusionModelServer): Promise<string> {
  const channelId = await page.evaluate(async (input) => {
    const api = (window as unknown as {
      electronAPI: {
        createChannel: (channel: unknown) => Promise<{ id: string }>
        updateSettings: (updates: unknown) => Promise<unknown>
      }
    }).electronAPI
    const channel = await api.createChannel({
      name: 'LF-069 hermetic',
      provider: 'openai',
      baseUrl: input.baseUrl,
      apiKey: 'sk-fake',
      models: [{ id: input.modelId, name: input.modelId, enabled: true }],
      enabled: true,
    })
    await api.updateSettings({
      onboardingCompleted: true,
      agentChannelId: channel.id,
      agentModelId: input.modelId,
      agentRuntime: 'pi',
    })
    return channel.id
  }, { baseUrl: server.baseUrl, modelId: MODEL_ID })
  await page.reload()
  await page.waitForFunction(
    () => typeof (window as unknown as { electronAPI?: unknown }).electronAPI === 'object',
    undefined,
    { timeout: 60_000 },
  )
  return channelId
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
      __lf069Events: ProbeEvents
      __lf069Unsub?: Array<() => void>
    }
    for (const unsubscribe of state.__lf069Unsub ?? []) unsubscribe()
    state.__lf069Events = { toolUses: [], texts: [], complete: [], errors: [] }
    state.__lf069Unsub = [
      state.electronAPI.onAgentStreamEvent((event) => {
        if (event.payload.kind !== 'sdk_message' || event.payload.message?.type !== 'assistant') return
        for (const block of event.payload.message.message?.content ?? []) {
          if (block.type === 'tool_use' && typeof block.name === 'string') {
            state.__lf069Events.toolUses.push({ sessionId: event.sessionId, name: block.name })
          }
          if (block.type === 'text' && typeof block.text === 'string') {
            state.__lf069Events.texts.push({ sessionId: event.sessionId, text: block.text })
          }
        }
      }),
      state.electronAPI.onAgentStreamComplete((data) => state.__lf069Events.complete.push(data)),
      state.electronAPI.onAgentStreamError((data) => state.__lf069Events.errors.push(data)),
    ]
  })
}

async function getEvents(page: Page): Promise<ProbeEvents> {
  return page.evaluate(
    () => (window as unknown as { __lf069Events: ProbeEvents }).__lf069Events,
  )
}

async function selectPrimaryMode(page: Page, label: 'Agent' | 'Linguist'): Promise<void> {
  const tab = page.getByRole('tablist', { name: '主工作模式' })
    .getByRole('tab', { name: label, exact: true })
  await tab.click()
  const selected = await waitFor(async () => await tab.getAttribute('aria-selected') === 'true', 10_000)
  if (!selected) throw new Error(`主工作模式未切换到 ${label}`)
}

async function projectSessionId(page: Page, projectId: string): Promise<string | undefined> {
  return page.evaluate(async (id) => {
    const result = await (window as unknown as {
      electronAPI: {
        linguistSessionsListForProject: (input: { projectId: string }) => Promise<
          { ok: true; data: Array<{ id: string }> }
          | { ok: false; error: { code: string } }
        >
      }
    }).electronAPI.linguistSessionsListForProject({ projectId: id })
    if (!result.ok) {
      throw new Error(`项目 Session 查询失败: ${'error' in result ? result.error.code : 'UNKNOWN'}`)
    }
    return result.data[0]?.id
  }, projectId)
}

async function persistedActiveTabId(page: Page): Promise<string | null> {
  return page.evaluate(async () => {
    const settings = await (window as unknown as {
      electronAPI: {
        getSettings: () => Promise<{ tabState?: unknown }>
      }
    }).electronAPI.getSettings()
    if (!settings.tabState || typeof settings.tabState !== 'object') return null
    const activeTabId = (settings.tabState as Record<string, unknown>).activeTabId
    return typeof activeTabId === 'string' ? activeTabId : null
  })
}

async function reviewProposal(
  workspace: ReturnType<Page['locator']>,
  segmentId: string,
  operation: 'Accept' | 'Reject',
): Promise<boolean> {
  const row = workspace.locator(`[role="row"][data-segment-id="${segmentId}"]`)
  await row.waitFor({ timeout: 30_000 })
  await row.getByRole('button', { name: /查看原始行 \d+ 上下文/u }).click()
  const review = row.locator('section[aria-label="当前行翻译建议"]')
  await review.waitFor({ timeout: 30_000 })
  await review.getByRole('button', { name: operation, exact: true }).click()
  return review.waitFor({ state: 'detached', timeout: 30_000 })
    .then(() => true)
    .catch(() => false)
}

async function readSegments(
  page: Page,
  projectId: string,
  assetId: string,
): Promise<Array<{ id: string; target: string; revision: number }>> {
  return page.evaluate(async (input) => {
    const result = await (window as unknown as {
      electronAPI: {
        linguistCatQuery: (request: unknown) => Promise<
          { ok: true; data: { segments: Array<{ id: string; target: string; revision: number }> } }
          | { ok: false; error: { code: string } }
        >
      }
    }).electronAPI.linguistCatQuery({
      projectId: input.projectId,
      assetId: input.assetId,
      limit: 20,
      offset: 0,
    })
    if (!result.ok) {
      throw new Error(`Segment 查询失败: ${'error' in result ? result.error.code : 'UNKNOWN'}`)
    }
    return result.data.segments
  }, { projectId, assetId })
}

async function expandProposalToolCard(
  scope: ReturnType<Page['locator']>,
): Promise<ExpandedProposalToolCard> {
  const toolRow = scope.getByRole('button', { name: '创建 3 条翻译建议', exact: true })
  const isToolRowVisible = async (): Promise<boolean> => {
    const count = await toolRow.count()
    return count === 1 && await toolRow.isVisible()
  }
  let toolRowVisible = await isToolRowVisible()
  let processGroupExpanded = false
  if (!toolRowVisible) {
    const processGroups = scope.getByRole('button', { name: /执行过程：.*次工具调用/u })
    const processGroup = processGroups.last()
    const processGroupVisible = await waitFor(async () => {
      const count = await processGroups.count()
      return count > 0 && await processGroup.isVisible()
    }, 30_000)
    if (processGroupVisible) {
      await processGroup.click()
      processGroupExpanded = true
      toolRowVisible = await waitFor(isToolRowVisible, 30_000)
    }
  }
  const toolRowCount = await toolRow.count()
  const clicked = toolRowVisible && toolRowCount === 1
  if (clicked) await toolRow.click()

  const cards = scope.locator('section[aria-label="翻译建议结果摘要"]')
  const card = cards.last()
  const cardVisible = clicked
    ? await card.waitFor({ state: 'visible', timeout: 30_000 })
      .then(() => true)
      .catch(() => false)
    : false
  const cardCount = await cards.count()
  const scopeText = (await scope.innerText().catch(() => ''))
    .replace(/\s+/g, ' ')
    .slice(0, 500)
  return {
    card,
    toolRowVisible,
    toolRowCount,
    expanded: clicked && cardVisible && cardCount === 1,
    diagnostics: `过程组已展开=${processGroupExpanded}，工具行可见=${toolRowVisible}，tool count=${toolRowCount}` +
      `，已点击=${clicked}，Card 可见=${cardVisible}，card count=${cardCount}，text=${scopeText}`,
  }
}

async function visibleGridTargetsMatch(
  workspace: ReturnType<Page['locator']>,
  expected: ReadonlyArray<{ segmentId: string; target: string }>,
): Promise<VisibleGridTargetResult> {
  const diagnostics: string[] = []
  let matched = true
  for (const item of expected) {
    const row = workspace.locator(`[role="row"][data-segment-id="${item.segmentId}"]`)
    const rowReady = await waitFor(async () => await row.count() === 1, 30_000)
    const rowCount = await row.count()
    if (!rowReady || rowCount !== 1) {
      matched = false
      diagnostics.push(`${item.segmentId}: row count=${rowCount}`)
      continue
    }

    const activateButton = row.getByRole('button', { name: /查看原始行 \d+ 上下文/u })
    const activateButtonCount = await activateButton.count()
    const clicked = activateButtonCount === 1 && await activateButton.click()
      .then(() => true)
      .catch(() => false)
    const active = clicked && await waitFor(
      async () => await row.getAttribute('aria-current') === 'true',
      30_000,
    )
    const targetCell = row.locator('[role="gridcell"][aria-label^="译文："]')
    const targetControl = targetCell.locator('button[data-target-edit]')
    const controlReady = await waitFor(async () => {
      const count = await targetControl.count()
      return count === 1 && await targetControl.isVisible()
    }, 30_000)
    const cellCount = await targetCell.count()
    const actual = cellCount === 1 ? await targetCell.getAttribute('aria-label') : null
    const expectedLabel = `译文：${item.target || '空'}`
    const itemMatched = active && controlReady && cellCount === 1 && actual === expectedLabel
    matched = matched && itemMatched
    diagnostics.push(
      `${item.segmentId}: activate button count=${activateButtonCount}，clicked=${clicked}` +
      `，active=${active}，target control visible=${controlReady}` +
      `，cell count=${cellCount}，expected=${JSON.stringify(expectedLabel)}` +
      `，actual=${JSON.stringify(actual)}，matched=${itemMatched}`,
    )
  }
  return { matched, diagnostics }
}

async function main(): Promise<void> {
  console.log('=== LF-069 Agent-CAT Fusion packaged 自动化探针 ===')
  console.log(` packaged binary: ${PACKAGED_BINARY}`)
  if (!existsSync(PACKAGED_BINARY)) {
    check('packaged-binary-exists', false, `未找到 ${PACKAGED_BINARY}`)
    summarizeAndExit()
    return
  }
  check('packaged-binary-exists', true, PACKAGED_BINARY)

  let tmpHome: string | undefined
  let logStream: WriteStream | undefined
  let server: FusionModelServer | undefined
  let launched: LaunchedApp | undefined
  try {
    tmpHome = mkdtempSync(join(tmpdir(), 'proma-lf069-probe-home-'))
    const artifactDir = mkdtempSync(join(tmpdir(), 'proma-lf069-probe-artifacts-'))
    logStream = createWriteStream(join(artifactDir, 'main-process.log'))
    // 异步写入错误由 finally 中的 finished 统一记录，避免先变成未处理事件。
    logStream.on('error', () => undefined)
    const linguistRoot = join(tmpHome, '.linguist-agent', 'linguist')
    console.log(` tmp HOME: ${tmpHome}`)
    console.log(` artifacts: ${artifactDir}`)

    const created = runCli([
      'create-project',
      '--root', linguistRoot,
      '--name', PROJECT_NAME,
      '--source', 'en',
      '--target', 'zh-CN',
    ])
    const projectId = cliField(created, 'project')
    const imported = runCli([
      'import',
      '--root', linguistRoot,
      '--project', projectId,
      '--file', FIXTURE_PATH,
    ])
    const assetId = cliField(imported, 'asset')
    const seededSegments = runCli([
      'segments',
      '--root', linguistRoot,
      '--project', projectId,
      '--asset', assetId,
      '--limit', '3',
    ]).split('\n')
      .filter((line) => line.startsWith('{'))
      .map((line) => JSON.parse(line) as SeededSegment)
    if (seededSegments.length !== 3) {
      check('cli-seed-three-segments', false, `只得到 ${seededSegments.length} 段`)
      throw new Error('CLI 未准备 3 个探针片段')
    }
    check('cli-seed-three-segments', true, `项目 ${projectId}，资产 ${assetId}，3 段 revision=0`)

    const targets = [
      '生命药水',
      '恢复 {count} 点生命值。\n“喝吧，旅人！”',
      '晨露酿造，回甘绵长',
    ] as const
    const planned = seededSegments.map((segment, index): PlannedProposal => ({
      segmentId: segment.id,
      baseRevision: segment.revision,
      proposedTarget: targets[index]!,
    }))

    server = await startFusionModelServer(planned)
    launched = await launchApp(tmpHome, logStream)
    const { page } = launched
    const channelId = await configureApp(page, server)
    check('hermetic-provider-configured', channelId.length > 0, `channel=${channelId}`)
    await installEventCollectors(page)

    await selectPrimaryMode(page, 'Linguist')
    const projectButton = page.getByRole('list', { name: '本地化项目' })
      .getByRole('button', { name: `打开项目 ${PROJECT_NAME}`, exact: true })
    await projectButton.click()
    const workspace = page.locator(`section[aria-label="${PROJECT_NAME} 本地化工作台"]`)
    await workspace.waitFor({ timeout: 30_000 })
    await workspace.locator(`[data-asset-id="${assetId}"]`).click()

    const agentPanelButton = workspace
      .locator('header[aria-label="本地化工作台工具栏"]')
      .getByRole('button', { name: 'Agent', exact: true })
    await agentPanelButton.click()
    const agentRail = workspace.locator('aside[aria-label="项目 Agent"]')
    const railOpen = await waitFor(
      async () => await agentPanelButton.getAttribute('aria-pressed') === 'true'
        && await agentRail.isVisible(),
      30_000,
    )
    check(
      'project-agent-rail-open',
      railOpen,
      `aria-pressed=${await agentPanelButton.getAttribute('aria-pressed')}，Agent aside 可见=${await agentRail.isVisible()}`,
    )
    if (!railOpen) throw new Error('项目 Agent 面板未成功打开')

    let selectedCheckboxCount = 0
    for (let index = 0; index < seededSegments.length; index += 1) {
      const checkbox = workspace.getByRole('checkbox', { name: `选择原始行 ${index + 1}` })
      await checkbox.waitFor({ timeout: 30_000 })
      await checkbox.check()
      if (await checkbox.isChecked()) selectedCheckboxCount += 1
    }
    check(
      'three-segments-selected',
      selectedCheckboxCount === 3,
      `已勾选 Segment checkbox=${selectedCheckboxCount}/3`,
    )
    const chip = workspace.getByRole('group', { name: '当前 Linguist 上下文' })
      .getByText('已选 3 段', { exact: true })
    const chipVisible = await chip.waitFor({ timeout: 30_000 })
      .then(() => true)
      .catch(() => false)
    check(
      'three-segments-context-chip-visible',
      chipVisible,
      `Agent rail=${railOpen}，已选=${selectedCheckboxCount}/3，Context Chip=${chipVisible}`,
    )

    const sessionReady = await waitFor(
      async () => (await projectSessionId(page, projectId)) !== undefined,
      30_000,
    )
    const sessionId = await projectSessionId(page, projectId)
    check(
      'project-agent-session-ready',
      sessionReady && sessionId !== undefined,
      `Agent rail 已挂载=${railOpen}，Session ready=${sessionReady}，session=${sessionId ?? 'none'}`,
    )
    if (!sessionReady || sessionId === undefined) throw new Error('项目 Agent Session 未就绪')
    const completedBefore = (await getEvents(page)).complete
      .filter((event) => event.sessionId === sessionId).length
    await workspace.getByRole('button', { name: '翻译已选', exact: true }).click()
    const completed = await waitFor(
      async () => (await getEvents(page)).complete
        .filter((event) => event.sessionId === sessionId).length > completedBefore,
      120_000,
    )

    const events = await getEvents(page)
    const initialRequest = server.logs.find((entry) => entry.stream && !entry.hasToolResult)
    const toolFollowup = server.logs.find((entry) => entry.stream && entry.hasToolResult)
    const contextReachedModel = seededSegments.every(
      (segment) => initialRequest?.messageText.includes(segment.id) === true,
    )
    const proposalToolAdvertised = initialRequest?.toolNames.includes(CAT_PROPOSAL_TOOL) === true
    const proposalIds = toolFollowup?.toolResultText.match(/prp-[0-9a-f]{16}/g) ?? []
    const toolEvent = events.toolUses.some(
      (event) => event.sessionId === sessionId && event.name === CAT_PROPOSAL_TOOL,
    )
    const finalText = events.texts.some(
      (event) => event.sessionId === sessionId && event.text.includes(FINAL_MARKER),
    )
    check(
      'quick-action-real-agent-cat-roundtrip',
      completed
        && contextReachedModel
        && proposalToolAdvertised
        && new Set(proposalIds).size === 3
        && toolEvent
        && finalText
        && events.errors.length === 0,
      `complete=${completed}，Context 3/3=${contextReachedModel}，tool advertised=${proposalToolAdvertised}` +
      `，proposalIds=${new Set(proposalIds).size}，tool event=${toolEvent}，final=${finalText}` +
      `${events.errors.length > 0 ? `，errors=${JSON.stringify(events.errors)}` : ''}`,
    )

    const railToolCard = await expandProposalToolCard(agentRail)
    check(
      'native-tool-row-visible',
      railToolCard.toolRowVisible && railToolCard.toolRowCount === 1,
      railToolCard.diagnostics,
    )
    const card = railToolCard.card
    const cardVisible = await card.getByText('已创建 3 条待审核建议', { exact: true })
      .waitFor({ timeout: 30_000 }).then(() => true).catch(() => false)
    check(
      'native-tool-row-expanded',
      railToolCard.expanded && cardVisible,
      railToolCard.diagnostics,
    )
    if (!railToolCard.expanded || !cardVisible) throw new Error('CAT Tool 行展开后未显示唯一结果卡')
    await card.getByRole('button', { name: '在 CAT 中查看', exact: true }).click()
    const firstLocated = await waitFor(
      async () => await workspace
        .locator(`[role="row"][data-segment-id="${seededSegments[0]!.id}"]`)
        .getAttribute('aria-current') === 'true',
      30_000,
    )
    check('tool-card-locates-grid-row', firstLocated, `卡片定位 ${seededSegments[0]!.id}`)

    const acceptFirst = await reviewProposal(workspace, seededSegments[0]!.id, 'Accept')
    const acceptSecond = await reviewProposal(workspace, seededSegments[1]!.id, 'Accept')
    const rejectThird = await reviewProposal(workspace, seededSegments[2]!.id, 'Reject')
    const timelineSynced = await card
      .getByText('审核结果：已接受 2 · 已拒绝 1', { exact: true })
      .waitFor({ timeout: 30_000 }).then(() => true).catch(() => false)
    const current = await readSegments(page, projectId, assetId)
    const byId = new Map(current.map((segment) => [segment.id, segment]))
    const storeSynced = byId.get(seededSegments[0]!.id)?.target === targets[0]
      && byId.get(seededSegments[0]!.id)?.revision === 1
      && byId.get(seededSegments[1]!.id)?.target === targets[1]
      && byId.get(seededSegments[1]!.id)?.revision === 1
      && byId.get(seededSegments[2]!.id)?.target === seededSegments[2]!.target
      && byId.get(seededSegments[2]!.id)?.revision === seededSegments[2]!.revision
    const visibleGridResult = await visibleGridTargetsMatch(workspace, [
      { segmentId: seededSegments[0]!.id, target: targets[0] },
      { segmentId: seededSegments[1]!.id, target: targets[1] },
      { segmentId: seededSegments[2]!.id, target: seededSegments[2]!.target },
    ])
    const visibleGridSynced = visibleGridResult.matched
    check(
      'accept-two-reject-one-syncs-grid-and-timeline',
      acceptFirst && acceptSecond && rejectThird && storeSynced && visibleGridSynced && timelineSynced,
      `Accept=${acceptFirst}/${acceptSecond}，Reject=${rejectThird}，Store=${storeSynced}` +
      `，逐行可见 Grid=${visibleGridSynced}，Timeline=${timelineSynced}` +
      `，Grid diagnostics=${visibleGridResult.diagnostics.join(' | ')}`,
    )

    await workspace.getByRole('button', { name: '在完整 Agent Tab 中打开', exact: true }).click()
    const fullAgent = page.locator('[data-agent-presentation="full"]')
    const fullAgentVisible = await waitFor(
      async () => await fullAgent.count() === 1 && await fullAgent.isVisible(),
      30_000,
    )
    const fullSessionActive = await waitFor(
      async () => await persistedActiveTabId(page) === sessionId,
      30_000,
    )
    const fullToolCard = await expandProposalToolCard(fullAgent)
    const fullStateVisible = fullAgentVisible
      && fullSessionActive
      && fullToolCard.expanded
      && await fullToolCard.card
        .getByText('审核结果：已接受 2 · 已拒绝 1', { exact: true })
        .waitFor({ timeout: 30_000 }).then(() => true).catch(() => false)
    const projectTabs = page.getByRole('button', {
      name: `打开标签页：${PROJECT_NAME}`,
      exact: true,
    })
    const projectTabCount = await projectTabs.count()
    const projectTabClicked = projectTabCount > 0
      && await projectTabs.first().click().then(() => true).catch(() => false)
    const projectTabActive = projectTabClicked && await waitFor(
      async () => await workspace.isVisible()
        && await persistedActiveTabId(page) === `linguist-project:${projectId}`,
      30_000,
    )
    const returnedRailToolCard = await expandProposalToolCard(agentRail)
    const railStateVisible = projectTabActive
      && returnedRailToolCard.expanded
      && await returnedRailToolCard.card
        .getByText('审核结果：已接受 2 · 已拒绝 1', { exact: true })
        .waitFor({ timeout: 30_000 }).then(() => true).catch(() => false)
    const afterRoundtrip = await readSegments(page, projectId, assetId)
    const roundtripStore = afterRoundtrip.find((segment) => segment.id === seededSegments[0]!.id)?.target === targets[0]
      && afterRoundtrip.find((segment) => segment.id === seededSegments[1]!.id)?.target === targets[1]
      && afterRoundtrip.find((segment) => segment.id === seededSegments[2]!.id)?.revision === 0
    const roundtripGridResult = await visibleGridTargetsMatch(workspace, [
      { segmentId: seededSegments[0]!.id, target: targets[0] },
      { segmentId: seededSegments[1]!.id, target: targets[1] },
      { segmentId: seededSegments[2]!.id, target: seededSegments[2]!.target },
    ])
    const roundtripGrid = roundtripGridResult.matched
    check(
      'full-agent-roundtrip-preserves-fusion-state',
      fullStateVisible && railStateVisible && roundtripStore && roundtripGrid,
      `full Agent 可见=${fullAgentVisible}，session active=${fullSessionActive}` +
      `，重展=${fullStateVisible}（${fullToolCard.diagnostics}）` +
      `，Project Tab count=${projectTabCount}，clicked=${projectTabClicked}` +
      `，active=${projectTabActive}，返回 rail 重展=${railStateVisible}` +
      `（${returnedRailToolCard.diagnostics}）` +
      `，Store=${roundtripStore}，逐行可见 Grid=${roundtripGrid}` +
      `，Grid diagnostics=${roundtripGridResult.diagnostics.join(' | ')}`,
    )
  } catch (error) {
    check('probe-completed-without-exception', false, error instanceof Error ? error.stack ?? error.message : String(error))
  } finally {
    const appToClose = launched?.app ?? activeApp
    if (appToClose !== undefined) {
      await quitApp(appToClose).catch((error) => {
        check('packaged-app-cleanup', false, error instanceof Error ? error.message : String(error))
      })
    }
    if (server !== undefined) {
      await server.close().catch((error) => {
        check('fake-model-server-cleanup', false, error instanceof Error ? error.message : String(error))
      })
    }
    if (logStream !== undefined) {
      try {
        const flushed = finished(logStream)
        logStream.end()
        await flushed
      } catch (error) {
        logStream.destroy()
        check('main-process-log-flushed', false, error instanceof Error ? error.message : String(error))
      }
    }
    if (tmpHome !== undefined) {
      try {
        rmSync(tmpHome, { recursive: true, force: true })
      } catch (error) {
        check('temporary-home-cleanup', false, error instanceof Error ? error.message : String(error))
      }
    }
  }

  summarizeAndExit()
}

function summarizeAndExit(): void {
  const failed = results.filter((result) => !result.pass)
  console.log('\n=== LF-069 自动化证据汇总 ===')
  console.log(` checks: ${results.length - failed.length}/${results.length} passed`)
  console.log(' Gate 状态：本脚本不判定；仍需审阅当前 packaged artifact 与真机交互证据。')
  process.exitCode = failed.length === 0 ? 0 : 1
}

main().catch((error) => {
  console.error('LF-069 packaged 探针异常：', error)
  process.exitCode = 1
})
