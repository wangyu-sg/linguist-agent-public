import { expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { LEGAL_RESOURCES, verifyPackagedArtifact } from './verify-packaged-artifact'

function writeAsar(file: string, entries: Record<string, string>): void {
  const files: Record<string, { files?: Record<string, unknown>; offset?: string; size?: number }> = {}
  const contents: Buffer[] = []
  let offset = 0
  for (const [relativePath, value] of Object.entries(entries)) {
    const parts = relativePath.split('/')
    let directory = files
    for (const part of parts.slice(0, -1)) {
      const current = directory[part] ?? { files: {} }
      if (current.files === undefined) throw new Error(`测试 ASAR 路径冲突：${relativePath}`)
      directory[part] = current
      directory = current.files as Record<string, typeof current>
    }
    const content = Buffer.from(value)
    directory[parts.at(-1)!] = { offset: String(offset), size: content.length }
    contents.push(content)
    offset += content.length
  }
  const json = Buffer.from(JSON.stringify({ files }))
  const payloadSize = 4 + json.length
  const headerSize = 4 + Math.ceil(payloadSize / 4) * 4
  const size = Buffer.alloc(8)
  size.writeUInt32LE(4, 0)
  size.writeUInt32LE(headerSize, 4)
  const header = Buffer.alloc(headerSize)
  header.writeUInt32LE(Math.ceil(payloadSize / 4) * 4, 0)
  header.writeUInt32LE(json.length, 4)
  json.copy(header, 8)
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, Buffer.concat([size, header, ...contents]))
}

function asarEntries(piVersion = '0.82.1'): Record<string, string> {
  return {
    'dist/cat-job-worker.cjs': 'worker',
    'dist/linguist-integrity-scrub-worker.cjs': 'worker',
    'node_modules/@earendil-works/pi-coding-agent/package.json': `{"version":"${piVersion}"}`,
    'node_modules/@earendil-works/pi-coding-agent/dist/index.js': 'export {}',
    'node_modules/@earendil-works/pi-agent-core/package.json': `{"version":"${piVersion}"}`,
    'node_modules/@earendil-works/pi-agent-core/dist/index.js': 'export {}',
    'node_modules/@earendil-works/pi-ai/package.json': `{"version":"${piVersion}"}`,
    'node_modules/@earendil-works/pi-ai/dist/index.js': 'export {}',
    'node_modules/pdfjs-dist/package.json': '{"version":"4.10.38"}',
    'node_modules/pdfjs-dist/legacy/build/pdf.mjs': 'export const getDocument = () => undefined',
  }
}

test('packaged verifier 接受完整产物并拒绝被篡改的 legal 或 Pi runtime', () => {
  const root = mkdtempSync(join(tmpdir(), 'la-packaged-verifier-'))
  const repo = join(root, 'repo')
  const app = join(root, 'Linguist Agent.app')
  const resources = join(app, 'Contents', 'Resources')
  const write = (file: string, value = file): void => {
    mkdirSync(dirname(file), { recursive: true })
    writeFileSync(file, value)
  }

  try {
    writeAsar(join(resources, 'app.asar'), asarEntries())
    for (const [sourceRelative, packagedName] of LEGAL_RESOURCES) {
      write(join(repo, sourceRelative), sourceRelative)
      write(join(resources, 'legal', packagedName), sourceRelative)
    }
    const unpacked = join(resources, 'app.asar.unpacked', 'node_modules')
    write(join(unpacked, 'sharp', 'package.json'), '{"version":"0.35.3"}')
    write(join(unpacked, '@img', 'sharp-darwin-arm64', 'package.json'), '{"version":"0.35.3"}')
    write(join(unpacked, '@img', 'sharp-libvips-darwin-arm64', 'package.json'), '{"version":"1.3.2"}')
    write(join(resources, 'agent-island', 'macos-agent-island-helper'), 'binary')

    expect(() => verifyPackagedArtifact(app, repo)).not.toThrow()
    write(join(resources, 'legal', 'NOTICE.md'), 'tampered')
    expect(() => verifyPackagedArtifact(app, repo)).toThrow('打包 legal 资源与仓库不一致：NOTICE.md')
    write(join(resources, 'legal', 'NOTICE.md'), 'NOTICE.md')
    writeAsar(join(resources, 'app.asar'), asarEntries('0.80.9'))
    expect(() => verifyPackagedArtifact(app, repo)).toThrow('runtime 版本不匹配：node_modules/@earendil-works/pi-coding-agent/package.json')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
