#!/usr/bin/env node
/**
 * LF-003 Packaged Vertical Smoke 总入口。
 *
 * 只编排既有 packaged probes；Playwright、Fake Model、临时 HOME 与清理逻辑
 * 继续由各 probe 负责。仍未自动化的覆盖项写入 blocked，不伪造通过。
 */

import { createHash } from 'node:crypto'
import { spawn, spawnSync } from 'node:child_process'
import {
  createReadStream,
  createWriteStream,
  existsSync,
  mkdirSync,
  readdirSync,
  writeFileSync,
} from 'node:fs'
import { homedir } from 'node:os'
import { delimiter, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

type StepStatus = 'passed' | 'failed' | 'not_reached'

interface StepDefinition {
  id: 'package' | 'agent' | 'chat' | 'linguist-current'
  title: string
  executable: string
  args: string[]
  coverage: string
}

interface StepEvidence {
  id: StepDefinition['id']
  title: string
  command: string
  coverage: string
  status: StepStatus
  startedAt?: string
  finishedAt?: string
  exitCode?: number | null
  signal?: NodeJS.Signals | null
  logPath: string
  evidence?: string
}

interface CoverageGap {
  id: string
  status: 'blocked'
  reason: string
  unlock: string
}

interface ArtifactEvidence {
  appPath: string
  asarPath: string
  asarSha256: string
}

interface VerticalSmokeEvidence {
  schemaVersion: 1
  sourceHead: string
  workingTreeDirty: boolean
  workingTreeStatus: string[]
  startedAt: string
  finishedAt?: string
  runStatus: 'running' | 'passed' | 'failed'
  coverageStatus: 'partial'
  reportPath: string
  artifact?: ArtifactEvidence
  steps: StepEvidence[]
  coverageGaps: CoverageGap[]
}

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url))
const APP_DIR = resolve(SCRIPT_DIR, '..', '..')
const REPORT_DIR = join(APP_DIR, 'out', 'smoke', 'vertical')
const REPORT_PATH = join(REPORT_DIR, 'vertical-smoke-report.json')

const COVERAGE_GAPS: CoverageGap[] = [
  {
    id: 'agent-stop-retry-ui',
    status: 'blocked',
    reason: 'G1 已覆盖 Agent 流式与 Thinking，但尚无原生 Agent Stop/Retry 的 packaged UI 断言。',
    unlock: '扩展 G1，复用同一 Pi 会话和 Fake Model 场景。',
  },
  {
    id: 'chat-agent-roundtrip',
    status: 'blocked',
    reason: 'G0 覆盖 Chat 流式、Stop、Retry 与恢复，但尚未断言切回 Agent 后状态不丢。',
    unlock: '主模式与 Tab 融合稳定后扩展 G0。',
  },
  {
    id: 'native-open-save-dialogs',
    status: 'blocked',
    reason: 'G7 的原生 Open/Save 对话框仍是 MANUAL，不能折算成自动通过。',
    unlock: '保留真机人工证据，或引入可审计的系统对话框自动化。',
  },
]

function resolveBunExecutable(): string {
  if (spawnSync('bun', ['--version'], { stdio: 'ignore' }).status === 0) return 'bun'
  const userBun = join(homedir(), '.bun', 'bin', 'bun')
  if (existsSync(userBun)) return userBun
  throw new Error('未找到 Bun；请安装仓库固定的 Bun 1.3.14 并加入 PATH')
}

function resolveHead(): string {
  const result = spawnSync('git', ['rev-parse', 'HEAD'], {
    cwd: APP_DIR,
    encoding: 'utf8',
  })
  if (result.status !== 0) throw new Error(`无法读取 Git HEAD：${result.stderr.trim()}`)
  return result.stdout.trim()
}

function resolveWorkingTreeStatus(): string[] {
  const result = spawnSync('git', ['status', '--porcelain', '--untracked-files=all'], {
    cwd: APP_DIR,
    encoding: 'utf8',
  })
  if (result.status !== 0) throw new Error(`无法读取 Git 工作区状态：${result.stderr.trim()}`)
  return result.stdout.split('\n').filter(Boolean)
}

function commandText(step: StepDefinition): string {
  return [step.executable, ...step.args].join(' ')
}

function logPath(id: StepDefinition['id']): string {
  return join(REPORT_DIR, `${id}.log`)
}

function writeEvidence(evidence: VerticalSmokeEvidence): void {
  mkdirSync(REPORT_DIR, { recursive: true })
  writeFileSync(REPORT_PATH, `${JSON.stringify(evidence, null, 2)}\n`, 'utf8')
}

async function runStep(step: StepDefinition): Promise<StepEvidence> {
  const startedAt = new Date().toISOString()
  const outputPath = logPath(step.id)
  const log = createWriteStream(outputPath)

  console.log(`\n=== ${step.title} ===`)
  console.log(`$ ${commandText(step)}`)

  const result = await new Promise<{ exitCode: number | null; signal: NodeJS.Signals | null }>(
    (resolveResult) => {
      const child = spawn(step.executable, step.args, {
        cwd: APP_DIR,
        env: { ...process.env, FORCE_COLOR: '0' },
        stdio: ['inherit', 'pipe', 'pipe'],
      })
      let settled = false
      const finish = (exitCode: number | null, signal: NodeJS.Signals | null): void => {
        if (settled) return
        settled = true
        log.end(() => resolveResult({ exitCode, signal }))
      }
      child.stdout?.on('data', (chunk: Buffer) => {
        process.stdout.write(chunk)
        log.write(chunk)
      })
      child.stderr?.on('data', (chunk: Buffer) => {
        process.stderr.write(chunk)
        log.write(chunk)
      })
      child.once('error', (error) => {
        const message = `启动失败：${error.message}\n`
        process.stderr.write(message)
        log.write(message)
        finish(null, null)
      })
      child.once('close', finish)
    },
  )

  return {
    id: step.id,
    title: step.title,
    command: commandText(step),
    coverage: step.coverage,
    status: result.exitCode === 0 ? 'passed' : 'failed',
    startedAt,
    finishedAt: new Date().toISOString(),
    exitCode: result.exitCode,
    signal: result.signal,
    logPath: outputPath,
  }
}

function notReached(step: StepDefinition, reason: string): StepEvidence {
  return {
    id: step.id,
    title: step.title,
    command: commandText(step),
    coverage: step.coverage,
    status: 'not_reached',
    logPath: logPath(step.id),
    evidence: reason,
  }
}

function resolvePackagedApp(): { appPath: string; asarPath: string } {
  const outDir = join(APP_DIR, 'out', 'mac-arm64')
  const apps = existsSync(outDir)
    ? readdirSync(outDir).filter((entry) => entry.endsWith('.app'))
    : []
  if (apps.length !== 1) {
    throw new Error(`打包目录必须恰好有一个 .app，实际 ${apps.length} 个：${apps.join(', ') || '<none>'}`)
  }
  const appPath = join(outDir, apps[0]!)
  const asarPath = join(appPath, 'Contents', 'Resources', 'app.asar')
  if (!existsSync(asarPath)) throw new Error(`打包产物缺少 app.asar：${asarPath}`)
  return { appPath, asarPath }
}

async function sha256(path: string): Promise<string> {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(path)) hash.update(chunk)
  return hash.digest('hex')
}

async function main(): Promise<void> {
  mkdirSync(REPORT_DIR, { recursive: true })
  const bun = resolveBunExecutable()
  if (bun !== 'bun') process.env.PATH = [dirname(bun), process.env.PATH].filter(Boolean).join(delimiter)
  const steps: StepDefinition[] = [
    {
      id: 'package',
      title: '真实打包 Electron',
      executable: bun,
      args: ['run', 'smoke:pack'],
      coverage: '从当前工作区构建未签名 packaged Electron。',
    },
    {
      id: 'agent',
      title: 'Agent packaged vertical',
      executable: process.execPath,
      args: ['scripts/smoke/probe-pi-stream.ts'],
      coverage: 'Pi Agent 冷启动、发送、Streaming、Thinking 与 final。',
    },
    {
      id: 'chat',
      title: 'Chat packaged vertical',
      executable: process.execPath,
      args: ['scripts/smoke/run-g0-smoke.ts'],
      coverage: 'Chat 创建、Streaming、Thinking、Tool、Retry、Stop 与重启恢复。',
    },
    {
      id: 'linguist-current',
      title: 'Linguist 当前 packaged vertical',
      executable: process.execPath,
      args: ['scripts/smoke/probe-pb074-e2e.ts'],
      coverage: 'Linguist Mode、Project Tab、Workbench、Agent-CAT、Proposal、QA、CAT backup/restore、node:sqlite、Integrity Worker、导出验证与重启恢复。',
    },
  ]

  const workingTreeStatus = resolveWorkingTreeStatus()
  const evidence: VerticalSmokeEvidence = {
    schemaVersion: 1,
    sourceHead: resolveHead(),
    workingTreeDirty: workingTreeStatus.length > 0,
    workingTreeStatus,
    startedAt: new Date().toISOString(),
    runStatus: 'running',
    coverageStatus: 'partial',
    reportPath: REPORT_PATH,
    steps: [],
    coverageGaps: COVERAGE_GAPS,
  }
  writeEvidence(evidence)

  const [packageStep, ...verticalSteps] = steps
  const packResult = await runStep(packageStep!)
  evidence.steps.push(packResult)

  if (packResult.status === 'passed') {
    try {
      const artifact = resolvePackagedApp()
      evidence.artifact = {
        ...artifact,
        asarSha256: await sha256(artifact.asarPath),
      }
    } catch (error) {
      packResult.status = 'failed'
      packResult.evidence = error instanceof Error ? error.message : String(error)
    }
  }
  writeEvidence(evidence)

  if (packResult.status !== 'passed') {
    evidence.steps.push(
      ...verticalSteps.map((step) => notReached(step, 'package 失败，禁止对陈旧或缺失产物执行探针')),
    )
    evidence.finishedAt = new Date().toISOString()
    evidence.runStatus = 'failed'
    writeEvidence(evidence)
    console.error(`\nLF-003 FAIL：打包失败；证据 ${REPORT_PATH}`)
    process.exitCode = 1
    return
  }

  for (const step of verticalSteps) {
    evidence.steps.push(await runStep(step))
    writeEvidence(evidence)
  }

  const failed = evidence.steps.some((step) => step.status === 'failed')
  evidence.finishedAt = new Date().toISOString()
  evidence.runStatus = failed ? 'failed' : 'passed'
  writeEvidence(evidence)

  console.log(`\nLF-003 ${failed ? 'FAIL' : 'PASS'}：已执行覆盖=${evidence.runStatus}，合同覆盖=${evidence.coverageStatus}`)
  console.log(`证据：${REPORT_PATH}`)
  console.log(`未覆盖项：${evidence.coverageGaps.length} BLOCKED`)
  process.exitCode = failed ? 1 : 0
}

main().catch((error) => {
  console.error('LF-003 Packaged Vertical Smoke 异常：', error)
  process.exitCode = 1
})
