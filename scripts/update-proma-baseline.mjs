#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const DEFAULT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

function fail(message) {
  console.error(`[update-proma-baseline] 错误：${message}`)
  process.exit(2)
}

function parseArgs(argv) {
  const options = { root: DEFAULT_ROOT, date: new Date().toISOString().slice(0, 10) }
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    const value = () => argv[++index] ?? fail(`${arg} 缺少取值`)
    if (arg === '--tag') options.tag = value()
    else if (arg === '--commit') options.commit = value()
    else if (arg === '--merge-commit') options.mergeCommit = value()
    else if (arg === '--local-parent') options.localParent = value()
    else if (arg === '--upstream-parent') options.upstreamParent = value()
    else if (arg === '--branch') options.branch = value()
    else if (arg === '--upstream-app-version') options.upstreamAppVersion = value()
    else if (arg === '--date') options.date = value()
    else if (arg === '--root') options.root = resolve(value())
    else fail(`未知选项：${arg}`)
  }
  for (const name of ['tag', 'commit', 'mergeCommit', 'localParent', 'upstreamParent', 'branch']) {
    if (!options[name]) fail(`缺少 --${name.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)}`)
  }
  return options
}

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'))
}

function packageVersion(root, path) {
  return readJson(join(root, path)).version
}

function main() {
  const options = parseArgs(process.argv.slice(2))
  const baselinePath = join(options.root, 'docs/architecture/proma-baseline.json')
  const touchpointsPath = join(options.root, 'docs/architecture/proma-touchpoints.json')
  const markdownPath = join(options.root, 'docs/architecture/UPSTREAM_BASELINE.md')
  const baseline = readJson(baselinePath)
  const touchpoints = readJson(touchpointsPath)
  const rootPackage = readJson(join(options.root, 'package.json'))
  const electronPackage = readJson(join(options.root, 'apps/electron/package.json'))
  const schemaSource = readFileSync(join(options.root, 'packages/linguist-cat-store/src/schema.ts'), 'utf8')
  const schemaVersion = Number(/export const SCHEMA_VERSION = (\d+)/.exec(schemaSource)?.[1])
  if (!Number.isInteger(schemaVersion)) fail('无法读取 CAT SCHEMA_VERSION')

  baseline.upstream = {
    repository: 'https://github.com/proma-ai/Proma',
    tag: options.tag,
    commit: options.commit,
    electronAppVersion: options.upstreamAppVersion ?? options.tag.replace(/^v/, ''),
  }
  baseline.formalMerge = {
    commit: options.mergeCommit,
    localParent: options.localParent,
    upstreamParent: options.upstreamParent,
    branch: options.branch,
    date: options.date,
  }
  baseline.runtime = {
    bun: rootPackage.packageManager.replace(/^bun@/, ''),
    electron: electronPackage.devDependencies.electron.replace(/^\^/, ''),
    pi: electronPackage.dependencies['@earendil-works/pi-coding-agent'],
  }
  baseline.product = {
    ...baseline.product,
    linguistAgentVersion: electronPackage.version,
    sharedVersion: packageVersion(options.root, 'packages/shared/package.json'),
    catCoreVersion: packageVersion(options.root, 'packages/linguist-cat-core/package.json'),
    catFormatsVersion: packageVersion(options.root, 'packages/linguist-cat-formats/package.json'),
    catStoreVersion: packageVersion(options.root, 'packages/linguist-cat-store/package.json'),
    catToolsVersion: packageVersion(options.root, 'packages/linguist-cat-tools/package.json'),
    catSchema: schemaVersion,
  }

  touchpoints.baseline = options.commit
  touchpoints.formalMerge = options.mergeCommit
  touchpoints.recomputedOn = options.date
  touchpoints.comment = `Proma-core touchpoints tracked against ${options.tag}; automatic sync updates only the baseline metadata and preserves reviewed touchpoint reasons.`

  const product = baseline.product
  const markdown = `# Upstream Baseline — Proma ${options.tag}\n\n> 更新日期：${options.date}\n> 机读真源：[proma-baseline.json](./proma-baseline.json)\n\n| 项目 | 值 |\n|---|---|\n| upstream | \`${baseline.upstream.repository}\` |\n| tag / commit | \`${options.tag}\` / \`${options.commit}\` |\n| 本地起点 | \`${options.localParent}\` |\n| LA merge commit | \`${options.mergeCommit}\` |\n| 施工分支 | \`${options.branch}\` |\n\n## 运行时与产品版本\n\n| 项目 | 当前值 |\n|---|---|\n| Linguist Agent / upstream app | \`${product.linguistAgentVersion}\` / \`${baseline.upstream.electronAppVersion}\` |\n| Electron / Bun | \`${baseline.runtime.electron}\` / \`${baseline.runtime.bun}\` |\n| Pi Runtime | \`${baseline.runtime.pi}\` |\n| Shared | \`${product.sharedVersion}\` |\n| CAT Core / Formats / Store / Tools | \`${product.catCoreVersion} / ${product.catFormatsVersion} / ${product.catStoreVersion} / ${product.catToolsVersion}\` |\n| CAT schema | \`${product.catSchema}\` |\n\n## 保留差异\n\n- Linguist Agent 保留独立产品身份、数据根、三模式与 CAT Store。\n- Linguist 继续组合 Proma 原生 Workspace、Session、Agent Runtime、Skills、MCP、Memory、Files、Planning、Queue 与 Collaboration。\n- 触点人工说明继续由 [proma-touchpoints.json](./proma-touchpoints.json) 管理，自动同步只更新顶层基线。\n`

  writeFileSync(baselinePath, `${JSON.stringify(baseline, null, 2)}\n`)
  writeFileSync(touchpointsPath, `${JSON.stringify(touchpoints, null, 2)}\n`)
  writeFileSync(markdownPath, markdown)
}

if (resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) main()
