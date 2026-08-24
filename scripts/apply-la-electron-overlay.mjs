#!/usr/bin/env node

import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

function fail(code, message) {
  console.error(`${code}: ${message}`)
  process.exit(2)
}

function readJson(path, label) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'))
  } catch (error) {
    fail('OVERLAY_INVALID', `${label}不可读或不是合法 JSON：${path}（${error.message}）`)
  }
}

function parseArgs(argv) {
  const options = {
    base: join(REPO_ROOT, 'apps/electron/package.json'),
    overlay: join(REPO_ROOT, 'config/la-electron-overlay.json'),
  }
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    const value = () => {
      index += 1
      if (!argv[index]) fail('OVERLAY_INVALID', `${arg} 缺少取值`)
      return resolve(argv[index])
    }
    if (arg === '--base') options.base = value()
    else if (arg === '--overlay') options.overlay = value()
    else if (arg === '--output') options.output = value()
    else fail('OVERLAY_INVALID', `未知选项：${arg}`)
  }
  options.output ??= options.base
  return options
}

function same(left, right) {
  return JSON.stringify(left) === JSON.stringify(right)
}

function readPath(root, path) {
  let value = root
  for (const part of path) {
    if (value === null || typeof value !== 'object') return undefined
    value = value[part]
  }
  return value
}

function parentAt(root, path) {
  let value = root
  for (const part of path.slice(0, -1)) {
    const next = value[part]
    if (next === undefined) value[part] = {}
    else if (next === null || typeof next !== 'object' || Array.isArray(next)) {
      throw new Error(`路径不是对象：${path.join('.')}`)
    }
    value = value[part]
  }
  return value
}

export function applyElectronOverlay(base, overlay) {
  if (overlay?.schemaVersion !== 1 || !Array.isArray(overlay.operations)) {
    throw new Error('overlay 必须使用 schemaVersion=1 并提供 operations')
  }
  const result = structuredClone(base)
  for (const operation of overlay.operations) {
    const path = operation?.path
    if (!Array.isArray(path) || path.length === 0 || path.some((part) => typeof part !== 'string' || !part)) {
      throw new Error('operation.path 必须是非空字符串数组')
    }
    const current = readPath(result, path)
    const alreadyApplied = operation.remove === true ? current === undefined : same(current, operation.value)
    if (!alreadyApplied && operation.overwrite !== true) {
      if ('expected' in operation) {
        if (!same(current, operation.expected)) {
          const error = new Error(`${path.join('.')} 的上游值已改变`)
          error.code = 'OVERLAY_CONFLICT'
          throw error
        }
      } else if (current !== undefined) {
        const error = new Error(`${path.join('.')} 已由上游定义`)
        error.code = 'OVERLAY_CONFLICT'
        throw error
      }
    }
    if (alreadyApplied) continue
    const parent = parentAt(result, path)
    const key = path.at(-1)
    if (operation.remove === true) delete parent[key]
    else parent[key] = structuredClone(operation.value)
  }
  return result
}

const options = parseArgs(process.argv.slice(2))
try {
  const result = applyElectronOverlay(
    readJson(options.base, 'Proma manifest'),
    readJson(options.overlay, 'LA overlay'),
  )
  writeFileSync(options.output, `${JSON.stringify(result, null, 2)}\n`)
  console.log(`overlay applied: ${options.output}`)
} catch (error) {
  fail(error?.code === 'OVERLAY_CONFLICT' ? error.code : 'OVERLAY_INVALID', error.message)
}
