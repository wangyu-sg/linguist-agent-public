#!/usr/bin/env node
/** 从保留的 LA 原始设计生成应用图标；托盘 Template 图标独立维护。 */

import { execFileSync } from 'node:child_process'
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const resourcesDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'resources')
const sourcePath = join(resourcesDir, 'icon-source.png')

function wrapIco(png256) {
  const header = Buffer.alloc(6)
  header.writeUInt16LE(0, 0)
  header.writeUInt16LE(1, 2)
  header.writeUInt16LE(1, 4)
  const entry = Buffer.alloc(16)
  entry.writeUInt16LE(1, 4)
  entry.writeUInt16LE(32, 6)
  entry.writeUInt32LE(png256.length, 8)
  entry.writeUInt32LE(22, 12)
  return Buffer.concat([header, entry, png256])
}

copyFileSync(sourcePath, join(resourcesDir, 'icon.png'))
const iconsetDir = mkdtempSync(join(tmpdir(), 'la-icon-')) + '.iconset'
mkdirSync(iconsetDir, { recursive: true })
for (const [size, name] of [
  [16, 'icon_16x16.png'], [32, 'icon_16x16@2x.png'],
  [32, 'icon_32x32.png'], [64, 'icon_32x32@2x.png'],
  [128, 'icon_128x128.png'], [256, 'icon_128x128@2x.png'],
  [256, 'icon_256x256.png'], [512, 'icon_256x256@2x.png'],
  [512, 'icon_512x512.png'], [1024, 'icon_512x512@2x.png'],
]) {
  const targetPath = join(iconsetDir, name)
  if (size === 1024) {
    copyFileSync(sourcePath, targetPath)
  } else {
    execFileSync('sips', ['-z', String(size), String(size), sourcePath, '--out', targetPath], { stdio: 'ignore' })
  }
}
execFileSync('iconutil', ['-c', 'icns', iconsetDir, '-o', join(resourcesDir, 'icon.icns')])
const icoPng = readFileSync(join(iconsetDir, 'icon_256x256.png'))
rmSync(iconsetDir, { recursive: true, force: true })
writeFileSync(join(resourcesDir, 'icon.ico'), wrapIco(icoPng))

console.log('[icon] 已从 icon-source.png 生成 icon.png / icon.icns / icon.ico')
