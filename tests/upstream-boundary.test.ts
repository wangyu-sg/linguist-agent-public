/**
 * PB-014: 上游修改边界测试（upstream modification boundary test）
 *
 * 对比 `git diff --name-only <baseline>...HEAD`，强制：
 *   a. 每个相对基线有改动的文件，要么落在 allowedNewPaths 白名单内，
 *      要么已登记在 docs/architecture/proma-touchpoints.json；
 *   b. 反向：登记册里每个文件相对基线确实仍有改动（stale 条目失败）。
 *
 * 注意：本测试比较的是 HEAD（已提交内容），未提交/未跟踪文件不在 diff 中，
 * 因此必须在 pre-push / 门禁阶段运行。git 不可用或基线不在本地时，
 * 相关用例打印警告并跳过（不让整个套件失败）。
 *
 * 规则详见 docs/architecture/PROMA_CORE_TOUCHPOINTS.md。
 */

import { expect, test } from 'bun:test'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

const REPO_ROOT = dirname(import.meta.dir)
const REGISTRY_PATH = join(REPO_ROOT, 'docs/architecture/proma-touchpoints.json')

interface Touchpoint {
  file: string
  ticket: string
  reason: string
}

interface Registry {
  baseline: string
  allowedNewPaths: string[]
  touchpoints: Touchpoint[]
}

function loadRegistry(): Registry {
  return JSON.parse(readFileSync(REGISTRY_PATH, 'utf8')) as Registry
}

/**
 * allowedNewPaths 匹配语义：
 * - 以 '/' 结尾 → 路径前缀（目录白名单）
 * - 含 '*' → 取 '*' 之前部分做前缀匹配（如 README*、packages/linguist-）
 * - 其他 → 精确路径
 */
export function isAllowedNewPath(file: string, allowedNewPaths: string[]): boolean {
  for (const entry of allowedNewPaths) {
    if (entry.endsWith('/')) {
      if (file.startsWith(entry)) return true
    } else if (entry.includes('*')) {
      if (file.startsWith(entry.slice(0, entry.indexOf('*')))) return true
    } else if (file === entry) {
      return true
    }
  }
  return false
}

/** 返回相对基线的改动文件列表；git 不可用或基线缺失时返回 null（调用方跳过）。 */
function changedFilesVsBaseline(baseline: string): string[] | null {
  try {
    const out = execFileSync('git', ['diff', '--name-only', `${baseline}...HEAD`], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe']
    })
    return out
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
  } catch {
    return null
  }
}

test('registry is well-formed (no git required)', () => {
  const registry = loadRegistry()
  expect(/^[0-9a-f]{40}$/.test(registry.baseline)).toBe(true)
  expect(Array.isArray(registry.allowedNewPaths)).toBe(true)
  expect(registry.allowedNewPaths.length).toBeGreaterThan(0)
  const seen = new Set<string>()
  for (const tp of registry.touchpoints) {
    expect(tp.file.length).toBeGreaterThan(0)
    expect(tp.file).not.toStartWith('/')
    expect(tp.file.includes('\\')).toBe(false)
    expect(/^(PB|LF|AC)-\d{3}/.test(tp.ticket)).toBe(true)
    expect(tp.reason.trim().length).toBeGreaterThan(0)
    expect(seen.has(tp.file)).toBe(false)
    seen.add(tp.file)
  }
})

test('no unregistered upstream modification (diff vs baseline)', () => {
  const registry = loadRegistry()
  const changed = changedFilesVsBaseline(registry.baseline)
  if (changed === null) {
    console.warn(
      '[upstream-boundary] git unavailable or baseline not present locally; skipping boundary check (not failing the suite)'
    )
    return
  }
  const registered = new Set(registry.touchpoints.map((tp) => tp.file))
  const unregistered = changed.filter(
    (file) => !isAllowedNewPath(file, registry.allowedNewPaths) && !registered.has(file)
  )
  expect(
    unregistered,
    `Unregistered Proma-core modifications detected. Register each file in docs/architecture/proma-touchpoints.json (+ PROMA_CORE_TOUCHPOINTS.md) with ticket and reason, or move new LA files into the allowed linguist paths:\n${unregistered.map((f) => `  - ${f}`).join('\n')}`
  ).toEqual([])
})

test('no stale registry entries (every touchpoint is actually modified)', () => {
  const registry = loadRegistry()
  const changed = changedFilesVsBaseline(registry.baseline)
  if (changed === null) {
    console.warn(
      '[upstream-boundary] git unavailable or baseline not present locally; skipping stale-entry check (not failing the suite)'
    )
    return
  }
  const changedSet = new Set(changed)
  const stale = registry.touchpoints.filter((tp) => !changedSet.has(tp.file)).map((tp) => tp.file)
  expect(
    stale,
    `Stale touchpoint registry entries (no longer modified vs baseline). Remove them from docs/architecture/proma-touchpoints.json and PROMA_CORE_TOUCHPOINTS.md:\n${stale.map((f) => `  - ${f}`).join('\n')}`
  ).toEqual([])
})
