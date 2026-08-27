#!/usr/bin/env node

import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const DEFAULT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

function fail(code, message) {
  console.error(`${code}: ${message}`)
  process.exit(2)
}

function parseRoot(argv) {
  if (argv.length === 0) return DEFAULT_ROOT
  if (argv.length === 2 && argv[0] === '--root') return resolve(argv[1])
  fail('HOST_SEAM_CONTRACT_CHANGED', '仅支持可选参数 --root <仓库目录>')
}

function occurrences(source, pattern) {
  return source.match(pattern)?.length ?? 0
}

function readSource(root, file) {
  try {
    return readFileSync(join(root, file), 'utf8')
  } catch (error) {
    fail('HOST_SEAM_CONTRACT_CHANGED', `${file} 不可读（${error.message}）`)
  }
}

const contracts = [
  {
    file: 'apps/electron/src/main/lib/agent-orchestrator.ts',
    anchor: 'agent-extension',
    importPattern: /^import .*from ['"]\.\/linguist\/agent-host-extension['"]/gm,
    required: ['async sendMessage(', 'async queueMessage(', 'resolveLinguistAgentHostExtension('],
    forbidden: /buildLinguistPrompt|resolveLinguistSessionCatTools|getLinguistProjectService/,
  },
  {
    file: 'apps/electron/src/main/lib/agent-collaboration-tools.ts',
    anchor: 'linguist-delegation',
    importPattern: /^import .*from ['"]\.\/linguist\/delegation-host-extension['"]/gm,
    required: ['resolveLinguistDelegationMetadata(', 'resolveLinguistDelegationOutcome('],
    forbidden: /getLinguistProjectService|\.openProject\(|\.segments\.(?:queryIds|getStageDecisionCoverage)/,
  },
  {
    file: 'apps/electron/src/main/ipc.ts',
    anchor: 'linguist-ipc',
    importPattern: /^import .*from ['"]\.\/lib\/linguist\/register-ipc['"]/gm,
    required: ['export function registerIpcHandlers(): void', 'registerLinguistIpc()'],
    forbidden: /LINGUIST_[A-Z_]+_IPC_CHANNELS|createLinguist|getLinguistProjectService/,
  },
  {
    file: 'apps/electron/src/preload/index.ts',
    anchor: 'linguist-preload',
    importPattern: /^import .*from ['"]\.\/linguist-api['"]/gm,
    required: ["contextBridge.exposeInMainWorld('electronAPI', electronAPI)", 'exposeLinguistApi()'],
    forbidden: /LINGUIST_[A-Z_]+_IPC_CHANNELS|linguistProjectsList:/,
  },
]

const root = parseRoot(process.argv.slice(2))
for (const contract of contracts) {
  const source = readSource(root, contract.file)
  const anchor = `// LA-HOST-SEAM: ${contract.anchor}`
  if (source.split(anchor).length - 1 !== 1) {
    fail('HOST_SEAM_ANCHOR_MISSING', `${contract.file} 必须且只能包含一个 ${anchor}`)
  }
  if (occurrences(source, contract.importPattern) !== 1) {
    fail('HOST_SEAM_CONTRACT_CHANGED', `${contract.file} 的 Host Adapter import 不再是一个`)
  }
  for (const required of contract.required) {
    if (!source.includes(required)) {
      fail('HOST_SEAM_CONTRACT_CHANGED', `${contract.file} 缺少原宿主合同：${required}`)
    }
  }
  if (contract.forbidden.test(source)) {
    fail('HOST_SEAM_CONTRACT_CHANGED', `${contract.file} 又直接包含 Linguist 领域实现`)
  }
}

const piFile = 'apps/electron/src/main/lib/adapters/pi-agent-adapter.ts'
const piSource = readSource(root, piFile)
const piAnchor = '// LA-HOST-SEAM: pi-compaction-temporary-deviation'
if (piSource.split(piAnchor).length - 1 !== 1) {
  fail('HOST_SEAM_ANCHOR_MISSING', `${piFile} 必须且只能包含一个 ${piAnchor}`)
}
for (const required of ['input.compactionContinuationContext', 'buildPiCompactionContinuationPrompt(']) {
  if (!piSource.includes(required)) {
    fail('HOST_SEAM_CONTRACT_CHANGED', `${piFile} 缺少压缩续跑合同：${required}`)
  }
}

const rendererAdapters = [
  {
    file: 'apps/electron/src/renderer/host/agent-host-extension.tsx',
    anchor: 'renderer-agent-extension',
    required: ['export function useAgentHostExtension(', 'export function useAgentSurfaceHostPresentation('],
    forbidden: /from ['"]@\/features\/linguist\/projects\/ProjectAgentRail['"]/,
  },
  {
    file: 'apps/electron/src/renderer/host/app-mode-registry.ts',
    anchor: 'app-mode-registry',
    required: ['export const APP_MODE_DEFINITIONS', 'export function resolveActiveViewForMode(', 'export function resolveRightRailPolicy('],
  },
]
for (const contract of rendererAdapters) {
  const source = readSource(root, contract.file)
  const anchor = `// LA-HOST-SEAM: ${contract.anchor}`
  if (source.split(anchor).length - 1 !== 1) {
    fail('HOST_SEAM_ANCHOR_MISSING', `${contract.file} 必须且只能包含一个 ${anchor}`)
  }
  for (const required of contract.required) {
    if (!source.includes(required)) {
      fail('HOST_SEAM_CONTRACT_CHANGED', `${contract.file} 缺少 Renderer Host 合同：${required}`)
    }
  }
  if (contract.forbidden?.test(source)) {
    fail('HOST_SEAM_CONTRACT_CHANGED', `${contract.file} 重新形成 Renderer 循环依赖`)
  }
}

const agentView = readSource(root, 'apps/electron/src/renderer/components/agent/AgentView.tsx')
if (
  occurrences(agentView, /from ['"]@\/host\/agent-host-extension['"]/g) !== 1
  || !agentView.includes("useAgentHostExtension(sessionId, embedded ? 'rail' : 'full')")
  || /from ['"][^'"]*features\/linguist\//.test(agentView)
) {
  fail('HOST_SEAM_CONTRACT_CHANGED', 'AgentView 不再只通过 Renderer Agent Host Adapter 接入 Linguist')
}
const appShell = readSource(root, 'apps/electron/src/renderer/components/app-shell/AppShell.tsx')
if (
  occurrences(appShell, /from ['"]@\/host\/app-mode-registry['"]/g) !== 1
  || !appShell.includes('resolveRightRailPolicy({')
  || /from ['"][^'"]*features\/linguist\//.test(appShell)
) {
  fail('HOST_SEAM_CONTRACT_CHANGED', 'AppShell 不再只通过 App Mode Registry 接入 Linguist')
}

console.log('host seams verified: 7')
