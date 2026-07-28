/**
 * settings-service 默认 Agent runtime 解析测试（PB-011 / D-002）
 *
 * 首版仅展示 Pi runtime：新安装与缺省字段的设置都必须解析出 pi；
 * 维护者显式持久化的 claude 覆盖仍需被尊重（Claude 代码路径保留）。
 */
import { afterAll, beforeAll, describe, expect, mock, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import * as os from 'node:os'
import { join } from 'node:path'

type SettingsService = typeof import('./settings-service')

let service: SettingsService
let tempHome: string

mock.module('node:os', () => ({
  ...os,
  homedir: () => tempHome,
}))

function settingsPath(): string {
  return join(tempHome, '.linguist-agent', 'settings.json')
}

function writeSettings(data: Record<string, unknown>): void {
  mkdirSync(join(tempHome, '.linguist-agent'), { recursive: true })
  writeFileSync(settingsPath(), JSON.stringify(data), 'utf-8')
}

beforeAll(async () => {
  tempHome = mkdtempSync(join(os.tmpdir(), 'la-settings-service-'))
  service = await import('./settings-service')
})

afterAll(() => {
  rmSync(tempHome, { recursive: true, force: true })
})

describe('默认 Agent runtime 解析（D-002）', () => {
  test('Given settings.json 不存在 When getSettings Then agentRuntime 默认为 pi', () => {
    rmSync(settingsPath(), { force: true })
    expect(service.getSettings().agentRuntime).toBe('pi')
  })

  test('Given settings.json 缺少 agentRuntime 字段 When getSettings Then agentRuntime 回退为 pi', () => {
    writeSettings({ themeMode: 'dark' })
    try {
      expect(service.getSettings().agentRuntime).toBe('pi')
    } finally {
      rmSync(settingsPath(), { force: true })
    }
  })

  test('Given 维护者持久化 agentRuntime 为 claude When getSettings Then 保留 claude 覆盖', () => {
    writeSettings({ agentRuntime: 'claude' })
    try {
      expect(service.getSettings().agentRuntime).toBe('claude')
    } finally {
      rmSync(settingsPath(), { force: true })
    }
  })
})
