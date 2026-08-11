/**
 * Shared helpers for the linguist service test suite (*.nodetest.ts, run
 * under node --test — bun has no node:sqlite, see @linguist/cat-store
 * runtime.ts). Every test uses mkdtemp linguist roots; clock, entropy and
 * the workspace allocator are injected for determinism.
 */

import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createSeededEntropy, type EntropySource } from '@linguist/cat-core'
import { LinguistProjectService } from '../project-service'

export const INPUT = { name: 'Demo', sourceLocale: 'en', targetLocale: 'zh-CN' } as const

const TEMP_DIRS = new Set<string>()
let cleanupRegistered = false

function registerTempDirCleanup(): void {
  if (cleanupRegistered) return
  cleanupRegistered = true
  process.once('exit', () => {
    for (const path of TEMP_DIRS) {
      try {
        rmSync(path, { recursive: true, force: true })
      } catch (error) {
        console.warn('[Linguist 测试清理] 无法删除临时目录:', error)
      }
    }
    TEMP_DIRS.clear()
  })
}

export function makeTempDir(): string {
  const path = mkdtempSync(join(tmpdir(), 'linguist-service-test-'))
  TEMP_DIRS.add(path)
  registerTempDirCleanup()
  return path
}

/** Deterministic incrementing clock: 2026-01-01T00:00:00.000Z + n seconds. */
export function makeClock(): () => string {
  let tick = 0
  return () => new Date(Date.UTC(2026, 0, 1, 0, 0, 0) + tick++ * 1000).toISOString()
}

export function makeEntropy(seed = 'pb-030'): EntropySource {
  return createSeededEntropy(seed)
}

/** Service over a fresh mkdtemp root with injected clock/entropy/allocator. */
export function makeService(rootDir = makeTempDir()): LinguistProjectService {
  let workspaceSeq = 0
  const service = new LinguistProjectService({
    rootDir,
    entropy: makeEntropy(),
    now: makeClock(),
    workspaceCreator: () => `ws-test-${++workspaceSeq}`,
    workspaceResolver: () => true,
  })
  service.init()
  return service
}

/** Repo-root tests/linguist-fixtures (…/lib/linguist/test → 7 级上溯到仓根)。 */
const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..', '..', '..', '..')
const FIXTURES_DIR = join(REPO_ROOT, 'tests', 'linguist-fixtures')

export function readFixture(name: string): Uint8Array {
  return readFileSync(join(FIXTURES_DIR, name))
}

/** fixture 的绝对路径（picker stub 用——主进程读盘流程需要真实文件路径）。 */
export function fixturePath(name: string): string {
  return join(FIXTURES_DIR, name)
}
