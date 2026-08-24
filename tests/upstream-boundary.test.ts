/**
 * PB-014: 上游修改边界测试（upstream modification boundary test）
 *
 * 对比基线至 HEAD，并合并当前 tracked / untracked 工作树，强制：
 *   a. 每个相对基线有改动的文件，要么落在 allowedNewPaths 白名单内，
 *      要么已登记在 docs/architecture/proma-touchpoints.json，要么只做
 *      公开镜像规定的本机路径占位符替换；
 *   b. 反向：登记册里每个文件相对基线确实仍有改动（stale 条目失败）。
 *
 * 因此提交前即可验证将要交付的真实树；CI 的 clean checkout 行为不变。
 * git 不可用或基线不在本地时，相关用例打印警告并跳过。
 *
 * 规则详见 docs/architecture/PROMA_CORE_TOUCHPOINTS.md。
 */

import { expect, test } from 'bun:test'
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

const REPO_ROOT = dirname(import.meta.dir)
const REGISTRY_PATH = join(REPO_ROOT, 'docs/architecture/proma-touchpoints.json')
const USER_ROOT = '/Users'
const PUBLIC_PATH_SCRUBS = [
  [`${USER_ROOT}/${['wang', 'yu'].join('')}`, `${USER_ROOT}/<local>`],
  [`${USER_ROOT}/${['guo', 'hao'].join('')}`, `${USER_ROOT}/<author>`],
  [`${USER_ROOT}/${['big', 'mouth'].join('')}`, `${USER_ROOT}/<user>`],
] as const

interface Touchpoint {
  file: string
  ticket: string
  kind: 'product-fork' | 'host-seam' | 'temporary-deviation' | 'generated'
  owner: string
  mergePolicy: 'keep-la' | 'reapply-host-seam' | 'overlay' | 'regenerate'
  hook?: string
  reason: string
}

interface Registry {
  schemaVersion: number
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

export function applyPublicPathScrubs(content: string): string {
  return PUBLIC_PATH_SCRUBS.reduce(
    (scrubbed, [localPath, placeholder]) =>
      scrubbed.replaceAll(localPath, placeholder),
    content,
  )
}

export function isExactPublicPathScrub(
  baselineContent: string,
  candidateContent: string,
): boolean {
  const scrubbed = applyPublicPathScrubs(baselineContent)
  return scrubbed !== baselineContent && scrubbed === candidateContent
}

function readRevisionFile(revision: string, file: string): string | null {
  try {
    return execFileSync('git', ['show', `${revision}:${file}`], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      maxBuffer: 16 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
  } catch {
    return null
  }
}

function isPublicPathScrubOnly(file: string, baseline: string): boolean {
  const baselineContent = readRevisionFile(baseline, file)
  const worktreePath = join(REPO_ROOT, file)
  const candidateContent = existsSync(worktreePath)
    ? readFileSync(worktreePath, 'utf8')
    : null
  return (
    baselineContent !== null &&
    candidateContent !== null &&
    isExactPublicPathScrub(baselineContent, candidateContent)
  )
}

/** 返回当前工作树相对基线的 tracked/untracked 改动。 */
function changedFilesVsBaseline(baseline: string): string[] | null {
  try {
    const run = (args: string[]): string => execFileSync('git', args, {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe']
    })
    return [...new Set([
      run(['diff', '--name-only', baseline, '--']),
      run(['ls-files', '--others', '--exclude-standard']),
    ].join('\n')
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0))]
  } catch {
    return null
  }
}

test('registry is well-formed (no git required)', () => {
  const registry = loadRegistry()
  expect(registry.schemaVersion).toBe(3)
  expect(/^[0-9a-f]{40}$/.test(registry.baseline)).toBe(true)
  expect(Array.isArray(registry.allowedNewPaths)).toBe(true)
  expect(registry.allowedNewPaths.length).toBeGreaterThan(0)
  const seen = new Set<string>()
  for (const tp of registry.touchpoints) {
    expect(tp.file.length).toBeGreaterThan(0)
    expect(tp.file).not.toStartWith('/')
    expect(tp.file.includes('\\')).toBe(false)
    expect(/^(?:(?:PB|LF|AC)-\d{3}|LA-(?:SYNC|HOST)-\d{3})$/.test(tp.ticket)).toBe(true)
    expect(['product-fork', 'host-seam', 'temporary-deviation', 'generated']).toContain(tp.kind)
    expect(tp.owner.trim().length).toBeGreaterThan(0)
    expect(['keep-la', 'reapply-host-seam', 'overlay', 'regenerate']).toContain(tp.mergePolicy)
    if (tp.kind === 'host-seam' || tp.kind === 'temporary-deviation') {
      expect(tp.hook?.trim().length ?? 0).toBeGreaterThan(0)
    }
    expect(tp.reason.trim().length).toBeGreaterThan(0)
    expect(tp.reason).not.toMatch(/Local Host Seam: retain upstream|Local Host Seam: compose the Linguist|Permanent Product Fork: package identity/)
    expect(seen.has(tp.file)).toBe(false)
    seen.add(tp.file)
  }
})

test('public mirror path scrub allows exact placeholders only', () => {
  const baseline = PUBLIC_PATH_SCRUBS.map(
    ([localPath], index) => `path${index}=${localPath}/fixture`,
  ).join('\n')
  const scrubbed = PUBLIC_PATH_SCRUBS.map(
    ([, placeholder], index) => `path${index}=${placeholder}/fixture`,
  ).join('\n')

  expect(isExactPublicPathScrub(baseline, scrubbed)).toBe(true)
  expect(isExactPublicPathScrub(baseline, `${scrubbed}\nfunctional-change=true`)).toBe(false)
  expect(isExactPublicPathScrub(baseline, baseline)).toBe(false)
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
    (file) =>
      !isAllowedNewPath(file, registry.allowedNewPaths) &&
      !registered.has(file) &&
      !isPublicPathScrubOnly(file, registry.baseline),
  )
  expect(
    unregistered,
    `Unregistered Proma-core modifications detected. Register each file in docs/architecture/proma-touchpoints.json (+ PROMA_CORE_TOUCHPOINTS.md) with ticket and reason, move new LA files into the allowed linguist paths, or limit public sanitation to the exact machine-path placeholders:\n${unregistered.map((f) => `  - ${f}`).join('\n')}`
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
