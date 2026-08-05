import { afterAll, beforeAll, describe, expect, mock, test } from 'bun:test'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import * as os from 'node:os'
import { join } from 'node:path'
import { electronMock, resetElectronMock } from './test/electron-mock'

type ConfigPathsModule = typeof import('./config-paths')

let configPaths: ConfigPathsModule
let tempHome: string
const originalHome = process.env.HOME
const originalPromaDev = process.env.PROMA_DEV

mock.module('electron', () => electronMock)
mock.module('node:os', () => ({
  ...os,
  homedir: () => tempHome,
}))

beforeAll(async () => {
  tempHome = mkdtempSync(join(os.tmpdir(), 'linguist-config-path-security-'))
  process.env.HOME = tempHome
  process.env.PROMA_DEV = '0'
  resetElectronMock()
  configPaths = await import('./config-paths')
})

afterAll(() => {
  if (originalHome === undefined) delete process.env.HOME
  else process.env.HOME = originalHome
  if (originalPromaDev === undefined) delete process.env.PROMA_DEV
  else process.env.PROMA_DEV = originalPromaDev
  rmSync(tempHome, { recursive: true, force: true })
})

describe('Agent session workspace 路径边界', () => {
  test('Given 被篡改的 session metadata slug 或 ID When 解析 session cwd Then 在创建目录前拒绝路径穿越', () => {
    expect(() => configPaths.getAgentSessionWorkspacePath('../outside-workspace', '../outside-session'))
      .toThrow('无效受管路径段')

    expect(existsSync(join(tempHome, 'outside-workspace'))).toBe(false)
    expect(existsSync(join(tempHome, '.linguist-agent', 'outside-session'))).toBe(false)
  })

  test('Given 合法的 workspace slug 与 session ID When 解析 session cwd Then 目录严格位于受管根内', () => {
    const cwd = configPaths.getAgentSessionWorkspacePath('workspace-authoritative', 'session-authoritative')

    expect(cwd).toBe(join(
      tempHome,
      '.linguist-agent',
      'agent-workspaces',
      'workspace-authoritative',
      'session-authoritative',
    ))
    expect(existsSync(cwd)).toBe(true)
  })
})
