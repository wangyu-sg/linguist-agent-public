#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const DEFAULT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

function fail(message) {
  console.error(`[release-notes] 错误：${message}`)
  process.exit(2)
}

function parseArgs(argv) {
  const options = { root: DEFAULT_ROOT, from: '', to: 'HEAD', out: 'release-notes.md', tag: '' }
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    const value = () => argv[++index] ?? fail(`${arg} 缺少取值`)
    if (arg === '--from') options.from = value()
    else if (arg === '--to') options.to = value()
    else if (arg === '--out') options.out = value()
    else if (arg === '--tag') options.tag = value()
    else if (arg === '--root') options.root = resolve(value())
    else fail(`未知选项：${arg}`)
  }
  return options
}

function git(root, args, optional = false) {
  const result = spawnSync('git', args, { cwd: root, encoding: 'utf8' })
  if (result.status !== 0) {
    if (optional) return ''
    fail(`git ${args.join(' ')} 失败：${result.stderr.trim()}`)
  }
  return result.stdout.trim()
}

function baselineAt(root, ref) {
  if (!ref) return undefined
  const raw = git(root, ['show', `${ref}:docs/architecture/proma-baseline.json`], true)
  if (!raw) return undefined
  try { return JSON.parse(raw).upstream?.tag } catch { return undefined }
}

function main() {
  const options = parseArgs(process.argv.slice(2))
  const packageJson = JSON.parse(readFileSync(join(options.root, 'apps/electron/package.json'), 'utf8'))
  const currentBaseline = JSON.parse(readFileSync(join(options.root, 'docs/architecture/proma-baseline.json'), 'utf8')).upstream?.tag
  const tag = options.tag || `v${packageJson.version}`
  const range = options.from ? `${options.from}..${options.to}` : options.to
  const subjects = git(options.root, ['log', '--format=%s', '--max-count=30', range])
    .split(/\r?\n/)
    .filter(Boolean)
  const changes = subjects.length > 0 ? subjects.map((subject) => `- ${subject}`).join('\n') : '- 维护与发布更新'
  const previousBaseline = baselineAt(options.root, options.from)
  const baselineLine = previousBaseline && previousBaseline !== currentBaseline
    ? `${previousBaseline} → ${currentBaseline}`
    : currentBaseline
  const notes = `## Linguist Agent ${tag}\n\n### Changes\n\n${changes}\n\n### Proma baseline\n\n- ${baselineLine}\n\n### Validation\n\n- 自动构建与发布流程已完成\n`
  writeFileSync(resolve(options.root, options.out), notes)
}

if (resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) main()
