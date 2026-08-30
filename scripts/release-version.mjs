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
  const options = { root: DEFAULT_ROOT, dryRun: false, upstreamTag: process.env.PROMA_UPSTREAM_TAG ?? '' }
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--dry-run') options.dryRun = true
    else if (arg === '--root') options.root = resolve(argv[++index] ?? fail('--root 缺少路径'))
    else if (arg === '--upstream-tag') options.upstreamTag = argv[++index] ?? fail('--upstream-tag 缺少取值')
    else if (arg === '--help' || arg === '-h') {
      console.log('用法：node scripts/release-version.mjs [--upstream-tag <Proma tag>] [--dry-run] [--root <仓库>]')
      process.exit(0)
    } else fail(`未知选项：${arg}`)
  }
  if (!options.upstreamTag) fail('缺少 --upstream-tag')
  return options
}

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'))
}

function versionTags(root, current) {
  const result = spawnSync('git', ['tag', '--list', `v${current[0]}.${current[1]}.*`, '--sort=-version:refname'], {
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

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')
}

function appendChangedEntry(body, entry) {
  const matches = [...body.matchAll(/^### Changed\s*$/gmu)]
  if (matches.length > 1) fail('CHANGELOG.md 的 Unreleased 包含重复 Changed 小节')
  if (matches.length === 0) return [body, `### Changed\n\n${entry}`].filter(Boolean).join('\n\n')

  const match = matches[0]
  const start = match.index ?? 0
  const remainder = body.slice(start + match[0].length)
  const nextHeading = /^###\s+/mu.exec(remainder)
  const changedBody = remainder.slice(0, nextHeading?.index ?? remainder.length).trim()
  const suffix = nextHeading ? remainder.slice(nextHeading.index).trim() : ''
  return [
    body.slice(0, start).trim(),
    `### Changed\n\n${[changedBody, entry].filter(Boolean).join('\n')}`,
    suffix,
  ].filter(Boolean).join('\n\n')
}

function promoteChangelog(markdown, currentVersion, nextVersion, previousUpstreamTag, nextUpstreamTag) {
  const unreleasedHeadings = [...markdown.matchAll(/^## \[Unreleased\]\s*$/gmu)]
  if (unreleasedHeadings.length !== 1) fail('CHANGELOG.md 必须且只能包含一个 Unreleased 小节')
  if (new RegExp(`^## \\[${escapeRegExp(nextVersion)}\\]`, 'mu').test(markdown)) {
    fail(`CHANGELOG.md 已存在版本 ${nextVersion}`)
  }

  const heading = unreleasedHeadings[0]
  const headingStart = heading.index ?? 0
  const bodyStart = headingStart + heading[0].length
  const remainder = markdown.slice(bodyStart)
  const nextSection = /^## \[[^\]]+\](?:\s+-\s+\d{4}-\d{2}-\d{2})?\s*$/mu.exec(remainder)
  if (!nextSection || nextSection.index === undefined) fail('CHANGELOG.md 的 Unreleased 后缺少已发布版本')

  const releaseBase = 'https://github.com/proma-ai/Proma/releases/tag'
  const baselineEntry = `- Proma 基线由 [${previousUpstreamTag}](${releaseBase}/${previousUpstreamTag}) 升级至 [${nextUpstreamTag}](${releaseBase}/${nextUpstreamTag})。`
  const releasedBody = appendChangedEntry(remainder.slice(0, nextSection.index).trim(), baselineEntry)
  const date = new Date().toISOString().slice(0, 10)
  let updated = `${markdown.slice(0, headingStart)}## [Unreleased]\n\n## [${nextVersion}] - ${date}\n\n${releasedBody}\n\n${remainder.slice(nextSection.index)}`

  const current = escapeRegExp(currentVersion)
  const unreleasedLinks = [...updated.matchAll(new RegExp(`^\\[Unreleased\\]:\\s+(.+/compare/)v${current}\\.\\.\\.HEAD\\s*$`, 'gmu'))]
  if (unreleasedLinks.length !== 1) fail(`CHANGELOG.md 的 Unreleased 比较链接必须从 v${currentVersion} 开始`)
  const link = unreleasedLinks[0]
  const compareBase = link[1]
  updated = updated.replace(
    link[0],
    `[Unreleased]: ${compareBase}v${nextVersion}...HEAD\n[${nextVersion}]: ${compareBase}v${currentVersion}...v${nextVersion}`,
  )
  return updated
}

function main() {
  const { root, dryRun, upstreamTag } = parseArgs(process.argv.slice(2))
  const packagePath = join(root, 'apps/electron/package.json')
  const baselinePath = join(root, 'docs/architecture/proma-baseline.json')
  const lockPath = join(root, 'bun.lock')
  const changelogPath = join(root, 'CHANGELOG.md')
  const packageJson = readJson(packagePath)
  const baseline = readJson(baselinePath)
  const current = parseVersion(packageJson.version)
  const previousUpstreamTag = baseline.upstream?.tag
  if (typeof previousUpstreamTag !== 'string') fail('Proma 基线缺少 upstream.tag')
  const previousUpstream = parseVersion(previousUpstreamTag.replace(/^v/u, ''))
  const nextUpstream = parseVersion(upstreamTag.replace(/^v/u, ''))
  if (compareVersions(nextUpstream, previousUpstream) <= 0) {
    fail(`Proma 目标基线 ${upstreamTag} 必须高于当前基线 ${previousUpstreamTag}`)
  }
  const tags = versionTags(root, current)
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

  const changelog = readFileSync(changelogPath, 'utf8')
  const updatedChangelog = promoteChangelog(
    changelog,
    packageJson.version,
    next,
    previousUpstreamTag,
    upstreamTag,
  )

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
    writeFileSync(changelogPath, updatedChangelog)
  }

  writeOutput({
    version: next,
    tag,
    changed_files: 'apps/electron/package.json,bun.lock,docs/architecture/proma-baseline.json,CHANGELOG.md',
    dry_run: String(dryRun),
  })
}

if (resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) main()
