import { expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = join(import.meta.dir, '..')

test('Agent Orchestrator 只通过单一 Linguist Host Extension 接入', () => {
  const source = readFileSync(
    join(ROOT, 'apps/electron/src/main/lib/agent-orchestrator.ts'),
    'utf8',
  )
  const linguistImports = source.match(/^import .*from ['"]\.\/linguist\//gm) ?? []
  const calls = source.match(/resolveLinguistAgentHostExtension\(/g) ?? []

  expect(linguistImports).toHaveLength(1)
  expect(calls).toHaveLength(2)
  expect(source.match(/\/\/ LA-HOST-SEAM: agent-extension/g)).toHaveLength(1)
  expect(source).not.toMatch(/buildLinguistPrompt|resolveLinguistSessionCatTools|composeAgentTools|getLinguistProjectService|resolveAgentExecutionScope/)
  expect(source).toContain('async sendMessage(')
  expect(source).toContain('async queueMessage(')
})

test('Collaboration 只通过 Linguist Delegation Host Extension 接入', () => {
  const source = readFileSync(
    join(ROOT, 'apps/electron/src/main/lib/agent-collaboration-tools.ts'),
    'utf8',
  )
  const linguistImports = source.match(/^import .*from ['"]\.\/linguist\//gm) ?? []

  expect(linguistImports).toHaveLength(1)
  expect(source).toContain('resolveLinguistDelegationMetadata(')
  expect(source).toContain('resolveLinguistDelegationOutcome(')
  expect(source.match(/\/\/ LA-HOST-SEAM: linguist-delegation/g)).toHaveLength(1)
  expect(source).not.toMatch(/getLinguistProjectService|\.openProject\(|\.segments\.(?:queryIds|getStageDecisionCoverage)/)
})

test('Main IPC 只注册一次 Linguist IPC Adapter', () => {
  const source = readFileSync(join(ROOT, 'apps/electron/src/main/ipc.ts'), 'utf8')

  expect(source.match(/registerLinguistIpc\(\)/g)).toHaveLength(1)
  expect(source.match(/from ['"]\.\/lib\/linguist\//g)).toHaveLength(1)
  expect(source.match(/\/\/ LA-HOST-SEAM: linguist-ipc/g)).toHaveLength(1)
  expect(source).not.toMatch(/LINGUIST_[A-Z_]+_IPC_CHANNELS|createLinguist|getLinguistProjectService/)
})

test('Preload 只组合一次 Linguist API', () => {
  const source = readFileSync(join(ROOT, 'apps/electron/src/preload/index.ts'), 'utf8')

  expect(source.match(/exposeLinguistApi\(\)/g)).toHaveLength(1)
  expect(source.match(/from ['"]\.\/linguist-api['"]/g)).toHaveLength(1)
  expect(source.match(/\/\/ LA-HOST-SEAM: linguist-preload/g)).toHaveLength(1)
  expect(source).not.toMatch(/LINGUIST_[A-Z_]+_IPC_CHANNELS|linguistProjectsList:/)
})

test('Pi Compaction 只在一个临时触点重注入 Linguist Context', () => {
  const source = readFileSync(
    join(ROOT, 'apps/electron/src/main/lib/adapters/pi-agent-adapter.ts'),
    'utf8',
  )

  expect(source.match(/\/\/ LA-HOST-SEAM: pi-compaction-temporary-deviation/g)).toHaveLength(1)
  expect(source).toContain('input.compactionContinuationContext')
  expect(source).toContain('buildPiCompactionContinuationPrompt(')
})
