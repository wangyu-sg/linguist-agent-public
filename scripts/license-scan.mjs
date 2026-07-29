#!/usr/bin/env node
/**
 * PB-115 依赖许可扫描与门禁（license:scan）
 *
 * 用法：bun run license:scan
 *
 * 本仓是 bun workspace + 根目录提升安装，license-checker 的 --production 在
 * monorepo 下不可靠（只认起始目录的 node_modules 与 package.json），因此：
 *
 * 1. 自行从各 workspace 清单（root + packages/* + apps/* 的
 *    dependencies / optionalDependencies / peerDependencies）按 node 向上
 *    查找规则解析生产依赖闭包（含传递依赖、嵌套版本）；
 * 2. 用 license-checker-rseidelsohn 对根 node_modules 全量扫描一次，取其
 *    许可元数据（能识别 LICENSE 文件级 "Custom" 专有许可）；
 * 3. 写出机器可读 SBOM：docs/release/sbom-full.json；
 * 4. 打印许可分布 summary；
 * 5. 门禁：命中黑名单许可（强 copyleft / 非开源 / 未知）即 exit 1，
 *    第一方包与 EXCEPTIONS 中的已登记豁免除外。
 */
import { promises as fs } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// license-checker-rseidelsohn 为 CJS 且无 default export，走 createRequire 兼容 bun
const require = createRequire(import.meta.url)
const checker = require('license-checker-rseidelsohn')

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const OUT_FILE = path.join(root, 'docs/release/sbom-full.json')

/** 第一方包（本仓 workspace 包，随产品整体以 AGPL-3.0 发布，不参与第三方许可门禁） */
const FIRST_PARTY = /^(proma|@proma\/|@linguist\/)/

/**
 * 已登记豁免（双许可选择 / 专有组件），处置依据见 THIRD_PARTY_NOTICES.md
 * key 为包名（不带版本）
 */
const EXCEPTIONS = new Map([
  ['jszip', '双许可 (MIT OR GPL-3.0-or-later)，按 MIT 采用'],
  ['@anthropic-ai/claude-agent-sdk', 'Anthropic 专有许可（© Anthropic PBC, All rights reserved），再分发依据见 THIRD_PARTY_NOTICES.md'],
  ['@anthropic-ai/claude-agent-sdk-linux-arm64', '同上（Anthropic 专有平台包）'],
  ['@anthropic-ai/claude-agent-sdk-linux-arm64-musl', '同上（Anthropic 专有平台包）'],
  ['@anthropic-ai/claude-agent-sdk-linux-x64', '同上（Anthropic 专有平台包）'],
  ['@anthropic-ai/claude-agent-sdk-linux-x64-musl', '同上（Anthropic 专有平台包）'],
  ['@anthropic-ai/claude-agent-sdk-darwin-arm64', '同上（Anthropic 专有平台包）'],
  ['@anthropic-ai/claude-agent-sdk-darwin-x64', '同上（Anthropic 专有平台包）'],
  ['@anthropic-ai/claude-agent-sdk-win32-arm64', '同上（Anthropic 专有平台包）'],
  ['@anthropic-ai/claude-agent-sdk-win32-x64', '同上（Anthropic 专有平台包）'],
])

/**
 * 门禁黑名单：强 copyleft / 非开源 / 未声明。
 * AGPL-3.0 为本项目自身许可，不在黑名单内；
 * MIT / Apache-2.0 / BSD / ISC / OFL / CC0 等宽松许可放行；
 * MPL-2.0（弱 copyleft，文件级）放行，dompurify 双许可按 Apache-2.0 采用。
 */
const BLACKLIST = [
  /^GPL-2\.0/i,
  /^GPL-3\.0/i,
  /^LGPL/i,
  /^SSPL/i,
  /^Commons[- ]Clause/i,
  /^BUSL/i,
  /^CC-BY-SA/i,
  /^UNLICENSED$/i,
  /^UNKNOWN$/i,
  /^Custom:/i,
]

/** license-checker 的 key 形如 `name@version`（scoped 包为 `@scope/name@version`） */
function packageName(key) {
  const at = key.lastIndexOf('@')
  return at > 0 ? key.slice(0, at) : key
}

async function readJson(file) {
  try {
    return JSON.parse(await fs.readFile(file, 'utf8'))
  } catch {
    return null
  }
}

/** node 向上查找：从 fromDir 起逐级在 node_modules/<name>/package.json 解析 */
async function resolvePackage(name, fromDir) {
  let dir = fromDir
  for (;;) {
    const manifest = await readJson(path.join(dir, 'node_modules', name, 'package.json'))
    if (manifest) return { manifest, dir: path.join(dir, 'node_modules', name) }
    const parent = path.dirname(dir)
    if (parent === dir) return null
    dir = parent
  }
}

// 收集 workspace 目录及其清单
const workspaceDirs = [root]
for (const group of ['packages', 'apps']) {
  const groupDir = path.join(root, group)
  for (const name of await fs.readdir(groupDir)) {
    const dir = path.join(groupDir, name)
    const manifest = await readJson(path.join(dir, 'package.json'))
    if (manifest) workspaceDirs.push(dir)
  }
}

// BFS 计算生产依赖闭包
/** @type {Map<string, {name: string, version: string, dir: string, optional: boolean, firstParty: boolean}>} */
const closure = new Map()
const unresolvedOptional = []
const unresolvedRequired = []

/** name@version 作为闭包 key（同一名称可有多版本） */
async function enqueue(name, fromDir, optional) {
  if (FIRST_PARTY.test(name)) {
    // 第一方 workspace 包：不记入第三方清单，但要继续追它的生产依赖
    for (const dir of workspaceDirs) {
      const manifest = await readJson(path.join(dir, 'package.json'))
      if (manifest && manifest.name === name) {
        await enqueueManifestDeps(manifest, dir)
        return
      }
    }
    return
  }
  const resolved = await resolvePackage(name, fromDir)
  if (!resolved) {
    ;(optional ? unresolvedOptional : unresolvedRequired).push(`${name} (from ${path.relative(root, fromDir)})`)
    return
  }
  const version = resolved.manifest.version ?? '0.0.0'
  const key = `${name}@${version}`
  if (closure.has(key)) return
  closure.set(key, { name, version, dir: resolved.dir, optional, firstParty: false })
  await enqueueManifestDeps(resolved.manifest, resolved.dir)
}

async function enqueueManifestDeps(manifest, dir) {
  const depGroups = [
    [manifest.dependencies, false],
    [manifest.optionalDependencies, true],
  ]
  for (const [deps, optional] of depGroups) {
    for (const name of Object.keys(deps ?? {})) {
      await enqueue(name, dir, optional)
    }
  }
}

for (const dir of workspaceDirs) {
  const manifest = await readJson(path.join(dir, 'package.json'))
  // workspace 种子额外计入 peerDependencies（由宿主安装，发行物口径属于运行时）
  for (const name of Object.keys(manifest.peerDependencies ?? {})) {
    await enqueue(name, dir, false)
  }
  await enqueueManifestDeps(manifest, dir)
}

// license-checker 全量扫描（根 + 各 workspace 本地 node_modules），取许可元数据
function scanDir(start) {
  return new Promise((resolve) => {
    checker.init({ start }, (err, packages) => (err ? resolve({}) : resolve(packages)))
  })
}
const licenseMeta = {}
for (const dir of workspaceDirs) {
  Object.assign(licenseMeta, await scanDir(dir))
}

// 汇总第三方清单与许可
const thirdParty = {}
for (const [key, pkg] of closure) {
  const meta = licenseMeta[key]
  let licenses = meta?.licenses
  if (licenses == null) {
    const manifest = await readJson(path.join(pkg.dir, 'package.json'))
    const lic = manifest?.license ?? manifest?.licenses
    licenses = Array.isArray(lic)
      ? lic.map((l) => l.type ?? l).join(' OR ')
      : (lic ?? 'UNKNOWN')
  }
  thirdParty[key] = {
    licenses: String(licenses),
    ...(meta?.repository ? { repository: meta.repository } : {}),
    ...(pkg.optional ? { optional: true } : {}),
    path: path.relative(root, pkg.dir),
  }
}

// 许可分布 summary
const summary = {}
for (const info of Object.values(thirdParty)) {
  summary[info.licenses] = (summary[info.licenses] ?? 0) + 1
}

// 门禁
const violations = []
for (const [key, info] of Object.entries(thirdParty)) {
  if (EXCEPTIONS.has(packageName(key))) continue
  if (BLACKLIST.some((re) => re.test(info.licenses))) violations.push(`${key} => ${info.licenses}`)
}
for (const item of unresolvedRequired) violations.push(`${item} => 无法解析已安装版本`)

// 写 SBOM（key 排序，稳定 diff）
const sorted = Object.fromEntries(
  Object.entries(thirdParty).sort(([a], [b]) => a.localeCompare(b)),
)
await fs.mkdir(path.dirname(OUT_FILE), { recursive: true })
await fs.writeFile(OUT_FILE, JSON.stringify(sorted, null, 2) + '\n')

// 输出
console.log(`扫描 workspace：${workspaceDirs.length} 个（生产依赖闭包，含传递依赖）`)
console.log(`第三方依赖：${Object.keys(thirdParty).length} 个`)
console.log(`SBOM 已写出：${path.relative(root, OUT_FILE)}`)
console.log('\n许可分布：')
for (const [lic, count] of Object.entries(summary).sort((a, b) => b[1] - a[1])) {
  console.log(`  ${lic}: ${count}`)
}
console.log('\n已登记豁免：')
for (const key of Object.keys(thirdParty)) {
  const name = packageName(key)
  if (EXCEPTIONS.has(name)) console.log(`  ${key} => ${thirdParty[key].licenses}（${EXCEPTIONS.get(name)}）`)
}
if (unresolvedOptional.length > 0) {
  console.log('\n本平台未安装的可选依赖（不计入门禁）：')
  for (const item of unresolvedOptional) console.log(`  ${item}`)
}

if (violations.length > 0) {
  console.error('\n许可门禁失败，命中黑名单：')
  for (const v of violations) console.error(`  ${v}`)
  process.exit(1)
}
console.log('\n许可门禁通过（无黑名单许可）。')
