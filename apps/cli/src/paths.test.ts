import { afterEach, describe, expect, test } from 'bun:test'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { resolveConfigDir } from './paths'

const originalPromaDev = process.env.PROMA_DEV

afterEach(() => {
  if (originalPromaDev === undefined) delete process.env.PROMA_DEV
  else process.env.PROMA_DEV = originalPromaDev
})

describe('CLI 数据根', () => {
  test('Given 默认模式 When 解析配置根 Then 使用 Linguist Agent 独立目录', () => {
    delete process.env.PROMA_DEV
    expect(resolveConfigDir()).toBe(join(homedir(), '.linguist-agent'))
  })

  test('Given 开发模式 When 解析配置根 Then 使用隔离的开发目录', () => {
    expect(resolveConfigDir({ dev: true })).toBe(join(homedir(), '.linguist-agent-dev'))
  })
})
