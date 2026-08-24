#!/usr/bin/env node

import { createHash } from 'node:crypto'
import { closeSync, existsSync, openSync, readFileSync, readSync, readdirSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export const LEGAL_RESOURCES = [
  ['LICENSE', 'LICENSE'],
  ['NOTICE.md', 'NOTICE.md'],
  ['ATTRIBUTION.md', 'ATTRIBUTION.md'],
  ['THIRD_PARTY_NOTICES.md', 'THIRD_PARTY_NOTICES.md'],
  ['docs/release/SBOM.md', 'SBOM.md'],
  ['docs/release/sbom-full.json', 'sbom-full.json'],
] as const

const ASAR_RUNTIME_PACKAGES = [
  ['@earendil-works/pi-coding-agent', '0.84.2', 'dist/index.js'],
  ['@earendil-works/pi-agent-core', '0.84.2', 'dist/index.js'],
  ['@earendil-works/pi-ai', '0.84.2', 'dist/index.js'],
  ['pdfjs-dist', '4.10.38', 'legacy/build/pdf.mjs'],
] as const

const ASAR_WORKERS = [
  'dist/cat-job-worker.cjs',
  'dist/linguist-integrity-scrub-worker.cjs',
] as const

interface AsarEntry {
  files?: Record<string, AsarEntry>
  offset?: string
  size?: number
  unpacked?: boolean
}

function sha256(file: string): string {
  return createHash('sha256').update(readFileSync(file)).digest('hex')
}

function requireFile(file: string, label: string): void {
  if (!existsSync(file) || !statSync(file).isFile()) throw new Error(`打包产物缺少 ${label}：${file}`)
}

function requirePackageVersion(file: string, expected: string): void {
  requireFile(file, 'runtime package.json')
  const actual = JSON.parse(readFileSync(file, 'utf8')).version
  if (actual !== expected) throw new Error(`runtime 版本不匹配：${file}，期望 ${expected}，实际 ${actual ?? '<missing>'}`)
}

function readAsarFile(archive: string, relativePath: string): Buffer {
  const parts = relativePath.split('/')
  if (parts.length === 0 || parts.some((part) => part.length === 0 || part === '.' || part === '..')) {
    throw new Error(`非法 app.asar 路径：${relativePath}`)
  }

  const fd = openSync(archive, 'r')
  try {
    const prefix = Buffer.alloc(16)
    if (readSync(fd, prefix, 0, prefix.length, 0) !== prefix.length) {
      throw new Error(`无法读取 app.asar 头：${archive}`)
    }
    const headerSize = prefix.readUInt32LE(4)
    const jsonSize = prefix.readUInt32LE(12)
    if (headerSize < 8 || jsonSize === 0 || jsonSize > headerSize - 8) {
      throw new Error(`app.asar 头无效：${archive}`)
    }
    const json = Buffer.alloc(jsonSize)
    if (readSync(fd, json, 0, json.length, 16) !== json.length) {
      throw new Error(`无法读取 app.asar 文件表：${archive}`)
    }
    const header = JSON.parse(json.toString('utf8')) as AsarEntry
    let entry: AsarEntry | undefined = header
    for (const part of parts) entry = entry?.files?.[part]
    if (entry === undefined || entry.files !== undefined) {
      throw new Error(`app.asar 缺少 ${relativePath}：${archive}`)
    }
    if (entry.unpacked) return readFileSync(join(`${archive}.unpacked`, ...parts))
    const size = entry.size
    const offset = Number(entry.offset)
    if (!Number.isSafeInteger(size) || size < 0 || !Number.isSafeInteger(offset) || offset < 0) {
      throw new Error(`app.asar 文件元数据无效：${relativePath}`)
    }
    const contents = Buffer.alloc(size)
    if (size > 0 && readSync(fd, contents, 0, size, 8 + headerSize + offset) !== size) {
      throw new Error(`无法读取 app.asar 文件：${relativePath}`)
    }
    return contents
  } finally {
    closeSync(fd)
  }
}

function requireAsarFile(archive: string, relativePath: string): void {
  readAsarFile(archive, relativePath)
}

function requireAsarPackageVersion(archive: string, packageName: string, expected: string): void {
  const relativePath = `node_modules/${packageName}/package.json`
  const actual = JSON.parse(readAsarFile(archive, relativePath).toString('utf8')).version
  if (actual !== expected) {
    throw new Error(`runtime 版本不匹配：${relativePath}，期望 ${expected}，实际 ${actual ?? '<missing>'}`)
  }
}

export function verifyPackagedArtifact(appPath: string, repoRoot: string): void {
  const resources = join(appPath, 'Contents', 'Resources')
  const asar = join(resources, 'app.asar')
  requireFile(asar, 'app.asar')

  for (const [sourceRelative, packagedName] of LEGAL_RESOURCES) {
    const source = join(repoRoot, sourceRelative)
    const packaged = join(resources, 'legal', packagedName)
    requireFile(source, `仓库 legal source ${sourceRelative}`)
    requireFile(packaged, `legal/${packagedName}`)
    if (sha256(source) !== sha256(packaged)) throw new Error(`打包 legal 资源与仓库不一致：${packagedName}`)
  }

  const unpacked = join(resources, 'app.asar.unpacked', 'node_modules')
  requirePackageVersion(join(unpacked, 'sharp', 'package.json'), '0.35.3')
  requirePackageVersion(join(unpacked, '@img', 'sharp-darwin-arm64', 'package.json'), '0.35.3')
  requirePackageVersion(join(unpacked, '@img', 'sharp-libvips-darwin-arm64', 'package.json'), '1.3.2')
  requireFile(join(resources, 'agent-island', 'macos-agent-island-helper'), 'Agent Island native helper')

  for (const [packageName, version, entry] of ASAR_RUNTIME_PACKAGES) {
    requireAsarPackageVersion(asar, packageName, version)
    requireAsarFile(asar, `node_modules/${packageName}/${entry}`)
  }
  for (const worker of ASAR_WORKERS) requireAsarFile(asar, worker)
}

function defaultAppPath(appDir: string): string {
  const outDir = join(appDir, 'out', 'mac-arm64')
  const apps = existsSync(outDir) ? readdirSync(outDir).filter((entry) => entry.endsWith('.app')) : []
  if (apps.length !== 1) throw new Error(`打包目录必须恰好有一个 .app，实际 ${apps.length} 个`)
  return join(outDir, apps[0]!)
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const appDir = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
  const repoRoot = resolve(appDir, '..', '..')
  const appPath = process.argv[2] ? resolve(process.argv[2]) : defaultAppPath(appDir)
  verifyPackagedArtifact(appPath, repoRoot)
  console.log(`打包产物完整性通过：${appPath}`)
}
