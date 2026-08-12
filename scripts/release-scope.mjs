#!/usr/bin/env node
import { appendFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const DEFAULT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

function fail(message) {
  console.error(`[release-scope] 错误：${message}`)
  process.exit(2)
}

function parseArgs(argv) {
  const options = { root: DEFAULT_ROOT, to: 'HEAD', from: '' }
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    const value = () => argv[++index] ?? fail(`${arg} 缺少取值`)
    if (arg === '--from') options.from = value()
    else if (arg === '--to') options.to = value()
    else if (arg === '--root') options.root = resolve(value())
    else if (arg === '--help' || arg === '-h') {
      console.log('用法：node scripts/release-scope.mjs [--from <tag>] [--to <ref>] [--root <仓库>]')
      process.exit(0)
    } else fail(`未知选项：${arg}`)
  }
  return options
}

function git(root, args) {
  const result = spawnSync('git', args, { cwd: root, encoding: 'utf8' })
  if (result.status !== 0) fail(`git ${args.join(' ')} 失败：${result.stderr.trim()}`)
  return result.stdout.trim()
}

export function needsRelease(path) {
  return path === 'bun.lock'
    || path === 'package.json'
    || path.startsWith('apps/electron/')
    || path.startsWith('apps/cli/')
    || path.startsWith('packages/')
    || path.startsWith('resources/')
    || path.startsWith('patches/')
}

function emit(values) {
  for (const [key, value] of Object.entries(values)) console.log(`${key}=${value}`)
  if (!process.env.GITHUB_OUTPUT) return
  appendFileSync(process.env.GITHUB_OUTPUT, `${Object.entries(values).map(([key, value]) => `${key}=${value}`).join('\n')}\n`)
}

function main() {
  const options = parseArgs(process.argv.slice(2))
  const message = git(options.root, ['log', '-1', '--format=%B', options.to])
  if (/\[skip release\]/i.test(message)) {
    emit({ release: 'false', reason: 'skip-release', changed_count: '0' })
    return
  }

  if (!options.from) {
    emit({ release: 'true', reason: 'first-release', changed_count: '0' })
    return
  }

  const files = git(options.root, ['diff', '--name-only', `${options.from}..${options.to}`])
    .split(/\r?\n/)
    .filter(Boolean)
  const releaseFiles = files.filter(needsRelease)
  emit({
    release: String(releaseFiles.length > 0),
    reason: releaseFiles.length > 0 ? 'product-change' : 'non-product-change',
    changed_count: String(files.length),
  })
}

if (resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) main()
