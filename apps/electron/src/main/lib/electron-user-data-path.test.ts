import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  LINGUIST_ELECTRON_USER_DATA_DIR,
  resolveElectronUserDataPath,
  shouldSetDefaultElectronUserDataPath,
} from './electron-user-data-path'

describe('Electron userData 隔离', () => {
  test('given 正式版与开发版 when 解析目录 then 均使用 Linguist bundle id 且互不共享', () => {
    const appData = '/tmp/Application Support'
    const production = resolveElectronUserDataPath(appData, true)
    const development = resolveElectronUserDataPath(appData, false)

    expect(production).toBe(join(appData, 'com.linguistagent.app'))
    expect(development).toBe(join(appData, 'com.linguistagent.app.dev'))
    expect(production).not.toContain('@proma')
    expect(development).not.toBe(production)
    expect(resolveElectronUserDataPath(appData, false, 'worktree-a')).toBe(
      join(appData, 'com.linguistagent.app.dev-worktree-a'),
    )
    expect(LINGUIST_ELECTRON_USER_DATA_DIR).toBe('com.linguistagent.app')
  })

  test('given packaged smoke 显式传入 user-data-dir when 选择目录 then 不覆盖测试隔离', () => {
    expect(shouldSetDefaultElectronUserDataPath(['Linguist Agent'])).toBe(true)
    expect(shouldSetDefaultElectronUserDataPath([
      'Linguist Agent',
      '--user-data-dir=/private/tmp/isolated',
    ])).toBe(false)
    expect(shouldSetDefaultElectronUserDataPath([
      'Linguist Agent',
      '--user-data-dir',
      '/private/tmp/isolated',
    ])).toBe(false)
  })

  test('given Electron 启动入口 when 获取单实例锁 then 已先显式设置 userData', () => {
    const source = readFileSync(join(import.meta.dirname, '../index.ts'), 'utf8')
    const setPathAt = source.search(/app\.setPath\(\s*['"]userData['"]/u)
    const lockAt = source.indexOf('app.requestSingleInstanceLock()')

    expect(setPathAt).toBeGreaterThan(-1)
    expect(lockAt).toBeGreaterThan(setPathAt)
    expect(source).toContain('shouldSetDefaultElectronUserDataPath(process.argv)')
  })
})
