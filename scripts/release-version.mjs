#!/usr/bin/env node
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const DEFAULT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const VERSION_PATTERN = /^(\d+)\.(\d+)\.(\d+)$/

function fail(message) {
  console.error(`[release-version] 错误：${message}`)
  process.exit(2)
}

export function parseVersion(value) {
  const match = VERSION_PATTERN.exec(value)
  if (!match) throw new Error(`版本必须是 x.y.z：${value}`)
  return match.slice(1).map(Number)
}

export function compareVersions(left, right) {
  for (let index = 0; index < 3; index += 1) {
    if (left[index] !== right[index]) return left[index] - right[index]
  }
  return 0
}

function parseArgs(argv) {
  const options = { root: DEFAULT_ROOT, dryRun: false }
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--dry-run') options.dryRun = true
    else if (arg === '--root') options.root = resolve(argv[++index] ?? fail('--root 缺少路径'))
    else if (arg === '--help' || arg === '-h') {
      console.log('用法：node scripts/release-version.mjs [--dry-run] [--root <仓库>]')
      process.exit(0)
    } else fail(`未知选项：${arg}`)
  }
  return options
}

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'))
}

function versionTags(root) {
  const result = spawnSync('git', ['tag', '--list', 'v[0-9]*', '--sort=-version:refname'], {
    cwd: root,
    encoding: 'utf8',
  })
  if (result.status !== 0) fail(`无法读取 Git tag：${result.stderr.trim()}`)
  return result.stdout.split(/\r?\n/).filter(Boolean)
}

function writeOutput(values) {
  for (const [key, value] of Object.entries(values)) console.log(`${key}=${value}`)
  if (!process.env.GITHUB_OUTPUT) return
  appendFileSync(process.env.GITHUB_OUTPUT, `${Object.entries(values).map(([key, value]) => `${key}=${value}`).join('\n')}\n`)
}

function main() {
  const { root, dryRun } = parseArgs(process.argv.slice(2))
  const packagePath = join(root, 'apps/electron/package.json')
  const baselinePath = join(root, 'docs/architecture/proma-baseline.json')
  const lockPath = join(root, 'bun.lock')
  const packageJson = readJson(packagePath)
  const baseline = readJson(baselinePath)
  const current = parseVersion(packageJson.version)
  const tags = versionTags(root)
  const parsedTags = tags.flatMap((tag) => {
    try { return [{ tag, version: parseVersion(tag.slice(1)) }] } catch { return [] }
  })
  const newest = parsedTags.sort((a, b) => compareVersions(b.version, a.version))[0]

  if (newest && compareVersions(current, newest.version) < 0) {
    fail(`应用版本 ${packageJson.version} 低于现有 Tag ${newest.tag}`)
  }

  const next = `${current[0]}.${current[1]}.${current[2] + 1}`
  const tag = `v${next}`
  if (tags.includes(tag)) fail(`目标 Tag 已存在：${tag}`)

  packageJson.version = next
  baseline.product ??= {}
  baseline.product.linguistAgentVersion = next

  if (!dryRun) {
    const lock = readFileSync(lockPath, 'utf8')
    const workspaceVersion = /("apps\/electron":\s*\{\s*"name": "@proma\/electron",\s*"version": ")[^"]+(")/
    const updatedLock = lock.replace(workspaceVersion, `$1${next}$2`)
    if (updatedLock === lock) fail('bun.lock Electron workspace 版本未更新')
    writeFileSync(packagePath, `${JSON.stringify(packageJson, null, 2)}\n`)
    writeFileSync(baselinePath, `${JSON.stringify(baseline, null, 2)}\n`)
    writeFileSync(lockPath, updatedLock)
  }

  writeOutput({
    version: next,
    tag,
    changed_files: 'apps/electron/package.json,bun.lock,docs/architecture/proma-baseline.json',
    dry_run: String(dryRun),
  })
}

if (resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) main()
