#!/usr/bin/env node
/**
 * PB-040 常驻项目 Skill 探针 — 在【打包后的 .app】上验证 project-assistant Skill 注入
 *
 * 断言点选择（如实记录）：Skill 是否到达模型，唯一诚实的端到端观测面是
 * 「真实发往模型的 HTTP 请求体」。本探针给 fake model server 开启
 * captureSystemPrompt（opt-in，默认关闭不影响既有探针），直接断言请求体中
 * system prompt 的 <available_skills> 段：
 * 1. fs.mkdtemp 临时 HOME；启动【前】用 PB-025 headless CLI 播种项目。
 * 2. 启动打包应用；播种 fake 渠道 + onboardingCompleted。
 * 3. 项目详情 → 新建项目对话（真实 UI）→ 徽章在场。
 * 4. 项目对话发送消息（fake-text 流式）→ 断言该次请求 system prompt 含
 *    <name>linguist-project-assistant</name>，且 <location> 指向打包产物内
 *    Contents/Resources/linguist-skills/project-assistant/SKILL.md
 *    （同时证明 extraResources 打包布线 + process.resourcesPath 解析）。
 * 5. 同一会话再发一条（sdkSessionId 已在 → resume 路径）→ 断言新请求的
 *    system prompt 仍含该 Skill（Session resume 一致：每次发送实时重解析）。
 * 6. 普通会话（createAgentSession，不携带绑定）发送消息 → 断言其请求
 *    system prompt 不含 linguist-project-assistant（普通 Chat 不出现）。
 * 7. tmp HOME 隔离断言（agent-sessions.json 落在临时 HOME）。
 *
 * 归档腿不重复覆盖：归档会话发送被 PB-034 主进程闸门阻断（probe-project-session
 * 已证 fake server 0 请求），Skill 注入规则由 project-skill.nodetest.ts 覆盖。
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
import { startFakeModelServer, FAKE_MODEL_IDS, type FakeModelServer } from './fake-model-server.ts'

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url))
const APP_DIR = resolve(SCRIPT_DIR, '..', '..')
/** apps/electron/scripts/smoke → 上溯四级到仓根 */
const REPO_ROOT = resolve(SCRIPT_DIR, '..', '..', '..', '..')
const CLI_DIR = join(REPO_ROOT, 'packages', 'linguist-cat-store')

const PROJECT_NAME = 'PB-040 Skill 探针项目'
const SKILL_NAME = 'linguist-project-assistant'

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

// ===== 应用启动（与 probe-project-session.ts 相同模式） =====

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

// ===== 渲染进程内的流式事件收集 =====

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
      __pb040Events: ProbeEvents
      __pb040Unsub?: Array<() => void>
    }
    if (w.__pb040Unsub) for (const u of w.__pb040Unsub) u()
    w.__pb040Events = { complete: [], errors: [] }
    w.__pb040Unsub = [
      w.electronAPI.onAgentStreamComplete((d) => w.__pb040Events.complete.push({ sessionId: d.sessionId })),
      w.electronAPI.onAgentStreamError((d) => w.__pb040Events.errors.push({ sessionId: d.sessionId, error: d.error })),
    ]
  })
}

async function getEvents(page: Page): Promise<ProbeEvents> {
  return page.evaluate(() => (window as unknown as { __pb040Events: ProbeEvents }).__pb040Events)
}

/** 通过 electronAPI 发送消息（与 AgentView 同一入口），等待该会话 STREAM_COMPLETE。 */
async function sendAndWaitComplete(
  page: Page,
  input: { sessionId: string; channelId: string; text: string },
): Promise<boolean> {
  await page.evaluate(async (args) => {
    const api = (window as unknown as {
      electronAPI: { sendAgentMessage: (input: unknown) => Promise<void> }
    }).electronAPI
    await api.sendAgentMessage({
      sessionId: args.sessionId,
      userMessage: args.text,
      channelId: args.channelId,
      modelId: 'fake-text',
      agentRuntime: 'pi',
      startedAt: Date.now(),
    })
  }, input)
  return waitFor(async () => (await getEvents(page)).complete.some((e) => e.sessionId === input.sessionId), 60_000)
}

// ===== 主流程 =====

async function main(): Promise<void> {
  console.log('=== PB-040 常驻项目 Skill 探针（packaged .app + fake server system prompt 捕获）===')
  console.log(` packaged binary: ${PACKAGED_BINARY}`)

  if (!existsSync(PACKAGED_BINARY)) {
    check('packaged-binary-exists', false, `未找到 ${PACKAGED_BINARY}，请先运行 bun run smoke:pack`)
    summarizeAndExit(1)
  }
  check('packaged-binary-exists', true, PACKAGED_BINARY)

  const tmpHome = mkdtempSync(join(tmpdir(), 'proma-pb040-probe-home-'))
  const artifactDir = mkdtempSync(join(tmpdir(), 'proma-pb040-probe-artifacts-'))
  const mainLogPath = join(artifactDir, 'main-process.log')
  const logStream = createWriteStream(mainLogPath)
  console.log(` tmp HOME: ${tmpHome}`)
  console.log(` artifacts: ${artifactDir}`)

  // 1. 启动前播种项目
  const linguistRoot = join(tmpHome, '.linguist-agent', 'linguist')
  let projectId = ''
  try {
    const created = runCli(['create-project', '--root', linguistRoot, '--name', PROJECT_NAME, '--source', 'en', '--target', 'zh-CN'])
    projectId = cliField(created, 'project')
  } catch (err) {
    check('cli-seed', false, `CLI 播种失败：${err instanceof Error ? err.message : String(err)}`)
    summarizeAndExit(1)
  }
  check('cli-seed', true, `项目 ${projectId}`)

  let server: FakeModelServer | undefined
  let launched: LaunchedApp | undefined
  let sessionId = ''
  let channelId = ''

  try {
    server = await startFakeModelServer(0, { captureSystemPrompt: true })
    console.log(` fake model server: ${server.baseUrl}（captureSystemPrompt=on）`)

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

    // 3. 项目详情 → 新建项目对话（真实 UI）→ 徽章在场
    await page.getByRole('tab', { name: 'Linguist', exact: true }).click()
    const projectButton = page.getByRole('list', { name: '本地化项目', exact: true })
      .getByRole('button', { name: `打开项目 ${PROJECT_NAME}`, exact: true })
    await projectButton.waitFor({ timeout: 30_000 })
    await projectButton.click()
    await page.getByRole('button', { name: '新建项目对话' }).click()
    const badgeVisible = await page.locator('[data-testid="linguist-project-badge"]')
      .waitFor({ timeout: 30_000 }).then(() => true).catch(() => false)
    check('create-project-chat-badge', badgeVisible, `项目徽章可见=${badgeVisible}`)

    // 取项目会话 id（IPC 真源）
    sessionId = await page.evaluate(async (pid) => {
      const api = (window as unknown as {
        electronAPI: {
          linguistSessionsListForProject: (input: { projectId: string }) => Promise<
            | { ok: true; data: Array<{ id: string }> }
            | { ok: false; error: { code: string } }
          >
        }
      }).electronAPI
      const list = await api.linguistSessionsListForProject({ projectId: pid })
      return list.ok && list.data.length === 1 ? list.data[0]!.id : ''
    }, projectId)
    if (!sessionId) {
      check('resolve-project-session-id', false, 'listForProject 未返回唯一会话')
      summarizeAndExit(1)
    }
    await installEventCollectors(page)

    // 4. 项目对话首发：断言发往模型的 system prompt 含常驻 Skill（打包 Resources 路径）
    const beforeFirst = server.logs.length
    const firstDone = await sendAndWaitComplete(page, { sessionId, channelId, text: 'PB-040 项目对话首发' })
    const firstStream = server.logs.slice(beforeFirst).filter((l) => l.stream === true)
    const firstPrompt = firstStream.at(-1)?.systemPrompt ?? ''
    const firstHasSkillName = firstPrompt.includes(`<name>${SKILL_NAME}</name>`)
    const packagedLocation = 'Contents/Resources/linguist-skills/project-assistant/SKILL.md'
    const firstHasPackagedLocation = firstPrompt.includes(packagedLocation)
    check('project-chat-skill-injected', firstDone && firstHasSkillName && firstHasPackagedLocation,
      `STREAM_COMPLETE=${firstDone}，system prompt 含 <name>${SKILL_NAME}</name>=${firstHasSkillName}，` +
      `location 含 ${packagedLocation}=${firstHasPackagedLocation}（流式请求数=${firstStream.length}，prompt 长度=${firstPrompt.length}）`)

    // 5. resume 一致：同一会话再发一条（sdkSessionId 已在 → resume 路径），新请求仍含 Skill
    const beforeResume = server.logs.length
    const resumeDone = await sendAndWaitComplete(page, { sessionId, channelId, text: 'PB-040 resume 一致第二条' })
    const resumeStream = server.logs.slice(beforeResume).filter((l) => l.stream === true)
    const resumePrompt = resumeStream.at(-1)?.systemPrompt ?? ''
    const resumeHasSkill = resumePrompt.includes(`<name>${SKILL_NAME}</name>`)
    check('resume-skill-consistent', resumeDone && resumeHasSkill,
      `STREAM_COMPLETE=${resumeDone}，resume 请求 system prompt 仍含 ${SKILL_NAME}=${resumeHasSkill}（每次发送实时重解析，不持久化 Skill 列表）`)

    // 6. 普通会话（createAgentSession，绝不携带绑定）：system prompt 不含项目 Skill
    const normalSessionId = await page.evaluate(async () => {
      const api = (window as unknown as {
        electronAPI: { createAgentSession: (title?: string) => Promise<{ id: string; linguistProjectId?: string }> }
      }).electronAPI
      const meta = await api.createAgentSession('PB-040 普通对话')
      return meta.linguistProjectId === undefined ? meta.id : ''
    })
    check('normal-chat-unbound', normalSessionId.length > 0, `普通会话未携带 linguistProjectId（id=${normalSessionId || '<绑定异常>'}）`)
    const beforeNormal = server.logs.length
    const normalDone = await sendAndWaitComplete(page, { sessionId: normalSessionId, channelId, text: 'PB-040 普通对话消息' })
    const normalStream = server.logs.slice(beforeNormal).filter((l) => l.stream === true)
    const normalPrompt = normalStream.at(-1)?.systemPrompt ?? ''
    const normalHasSkill = normalPrompt.includes(SKILL_NAME)
    check('normal-chat-skill-absent', normalDone && !normalHasSkill,
      `STREAM_COMPLETE=${normalDone}，普通会话 system prompt 不含 ${SKILL_NAME}=${!normalHasSkill}（prompt 长度=${normalPrompt.length}）`)

    // 7. tmp HOME 隔离：会话索引落在临时 HOME
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
  console.log(`\n=== PB-040 探针结果：${passed} PASS / ${failed} FAIL ===`)
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
