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
  const options = { root: DEFAULT_ROOT, from: '', to: 'HEAD', out: 'release-notes.md', tag: '', upstreamNotes: '' }
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    const value = () => argv[++index] ?? fail(`${arg} 缺少取值`)
    if (arg === '--from') options.from = value()
    else if (arg === '--to') options.to = value()
    else if (arg === '--out') options.out = value()
    else if (arg === '--tag') options.tag = value()
    else if (arg === '--upstream-notes') options.upstreamNotes = resolve(value())
    else if (arg === '--root') options.root = resolve(value())
    else fail(`未知选项：${arg}`)
  }
  return options
}

const CHANGE_LABELS = {
  feat: '新增',
  fix: '修复',
  perf: '优化',
  refactor: '调整',
}

const INTERNAL_SCOPES = new Set(['build', 'ci', 'docs', 'release', 'sync', 'test'])

export function releaseNoteForCommit(subject, body = '') {
  const explicit = body.split(/\r?\n/)
    .map((line) => /^Release-Note:\s*(.+)$/i.exec(line)?.[1]?.trim())
    .find(Boolean)
  if (explicit) return explicit.toLowerCase() === 'skip' ? undefined : explicit

  const match = /^(feat|fix|perf|refactor)(?:\(([^)]+)\))?!?:\s*(.+)$/i.exec(subject)
  if (!match || INTERNAL_SCOPES.has((match[2] ?? '').toLowerCase())) return undefined
  return `**${CHANGE_LABELS[match[1].toLowerCase()]}**：${match[3].trim()}`
}

export function buildReleaseNotes({ tag, notes, currentBaseline, previousBaseline, upstreamNotes = '' }) {
  const sections = [`## Linguist Agent ${tag}`]
  if (notes.length > 0) {
    sections.push(`### Linguist Agent 更新\n\n${notes.map((note) => `- ${note}`).join('\n')}`)
  } else if (!previousBaseline || previousBaseline === currentBaseline) {
    sections.push('本版本仅包含发布基础设施维护，不涉及应用功能变化。')
  }

  if (previousBaseline && previousBaseline !== currentBaseline) {
    const source = `https://github.com/proma-ai/Proma/releases/tag/${currentBaseline}`
    const body = upstreamNotes.trim() || `详见 [Proma ${currentBaseline} Release](${source})。`
    sections.push(`### Proma ${currentBaseline} 更新\n\n> 上游基线：${previousBaseline} → ${currentBaseline} · [原始 Release](${source})\n\n${body}`)
  } else {
    sections.push(`### Proma 基线\n\n- ${currentBaseline}`)
  }
  return `${sections.join('\n\n')}\n`
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
  const commits = git(options.root, ['log', '--format=%s%x1f%b%x1e', '--max-count=100', range])
    .split('\x1e')
    .map((record) => record.trim())
    .filter(Boolean)
    .map((record) => {
      const [subject = '', body = ''] = record.split('\x1f')
      return { subject: subject.trim(), body: body.trim() }
    })
  const notes = commits
    .map(({ subject, body }) => releaseNoteForCommit(subject, body))
    .filter(Boolean)
  const previousBaseline = baselineAt(options.root, options.from)
  const upstreamNotes = options.upstreamNotes ? readFileSync(options.upstreamNotes, 'utf8') : ''
  const content = buildReleaseNotes({ tag, notes, currentBaseline, previousBaseline, upstreamNotes })
  writeFileSync(resolve(options.root, options.out), content)
}

if (resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) main()
