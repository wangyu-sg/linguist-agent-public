#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const DEFAULT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

function fail(message) {
  console.error(`[release-notes] 错误：${message}`)
  process.exit(2)
}

function parseArgs(argv) {
  const options = { root: DEFAULT_ROOT, out: 'release-notes.md', tag: '' }
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    const value = () => argv[++index] ?? fail(`${arg} 缺少取值`)
    if (arg === '--out') options.out = value()
    else if (arg === '--tag') options.tag = value()
    else if (arg === '--root') options.root = resolve(value())
    else fail(`未知选项：${arg}`)
  }
  return options
}

export function extractChangelogVersion(markdown, tag) {
  const version = tag.trim().replace(/^v/u, '')
  if (!version) throw new Error('未指定发布版本')

  const escapedVersion = version.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')
  const headingPattern = new RegExp(
    `^## \\[${escapedVersion}\\] - \\d{4}-\\d{2}-\\d{2}\\s*$`,
    'gmu',
  )
  const headings = [...markdown.matchAll(headingPattern)]
  if (headings.length !== 1) {
    throw new Error(
      headings.length === 0
        ? `CHANGELOG.md 缺少版本 ${version}`
        : `CHANGELOG.md 包含重复版本 ${version}`,
    )
  }

  const heading = headings[0][0].trimEnd()
  const contentStart = (headings[0].index ?? 0) + headings[0][0].length
  const remainder = markdown.slice(contentStart)
  const boundary = /^(?:##\s+|\[[^\]\r\n]+\]:\s+\S+)/mu.exec(remainder)
  const content = remainder.slice(0, boundary?.index ?? remainder.length).trim()
  if (!content) throw new Error(`CHANGELOG.md 的版本 ${version} 没有发布内容`)

  return `${heading}\n\n${content}`
}

function main() {
  try {
    const options = parseArgs(process.argv.slice(2))
    const packageJson = JSON.parse(
      readFileSync(join(options.root, 'apps/electron/package.json'), 'utf8'),
    )
    const tag = options.tag || `v${packageJson.version}`
    const changelog = readFileSync(join(options.root, 'CHANGELOG.md'), 'utf8')
    const content = extractChangelogVersion(changelog, tag)
    writeFileSync(resolve(options.root, options.out), `${content}\n`)
  } catch (error) {
    fail(error instanceof Error ? error.message : String(error))
  }
}

if (resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) main()
