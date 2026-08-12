import { afterEach, describe, expect, test } from 'bun:test'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  migrateLegacyLinguistSessionWorkspace,
  resolveLegacyLinguistSessionWorkspacePath,
} from './session-workspace'

const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('Linguist 历史 session workspace', () => {
  test('Given 原生 workbench 为空 When 首次打开历史会话 Then 只复制用户产物且保留旧目录', () => {
    const configDir = mkdtempSync(join(tmpdir(), 'la-session-workspace-'))
    roots.push(configDir)
    const source = resolveLegacyLinguistSessionWorkspacePath(configDir, 'project-1', 'session-1')
    const destination = join(configDir, 'native-workbench')
    mkdirSync(join(source, 'reports'), { recursive: true })
    mkdirSync(join(source, '.claude'), { recursive: true })
    mkdirSync(join(source, 'memory'), { recursive: true })
    mkdirSync(destination)
    writeFileSync(join(source, 'reports', 'report.md'), 'report')
    writeFileSync(join(source, 'notes.txt'), 'notes')
    writeFileSync(join(source, 'SESSION_MANIFEST.json'), '{}')
    writeFileSync(join(source, '.claude', 'settings.json'), '{}')
    writeFileSync(join(source, 'memory', 'MEMORY.md'), 'memory')

    migrateLegacyLinguistSessionWorkspace(
      configDir,
      'project-1',
      'session-1',
      destination,
    )

    expect(readFileSync(join(destination, 'reports', 'report.md'), 'utf8')).toBe('report')
    expect(readFileSync(join(destination, 'notes.txt'), 'utf8')).toBe('notes')
    expect(existsSync(join(destination, 'SESSION_MANIFEST.json'))).toBe(false)
    expect(existsSync(join(destination, '.claude'))).toBe(false)
    expect(existsSync(join(destination, 'memory'))).toBe(false)
    expect(existsSync(source)).toBe(true)
  })

  test('Given 原生 workbench 已有文件 When 打开历史会话 Then 不覆盖也不迁移', () => {
    const configDir = mkdtempSync(join(tmpdir(), 'la-session-workspace-'))
    roots.push(configDir)
    const source = resolveLegacyLinguistSessionWorkspacePath(configDir, 'project-1', 'session-1')
    const destination = join(configDir, 'native-workbench')
    mkdirSync(source, { recursive: true })
    mkdirSync(destination)
    writeFileSync(join(source, 'notes.txt'), 'legacy')
    writeFileSync(join(destination, 'notes.txt'), 'native')

    migrateLegacyLinguistSessionWorkspace(configDir, 'project-1', 'session-1', destination)

    expect(readFileSync(join(destination, 'notes.txt'), 'utf8')).toBe('native')
    expect(readFileSync(join(source, 'notes.txt'), 'utf8')).toBe('legacy')
  })

  test('Given 路径分隔符伪装成 ID When 解析 Then fail closed', () => {
    expect(() => resolveLegacyLinguistSessionWorkspacePath(
      '/config',
      '../outside',
      'session-1',
    )).toThrow('projectId')
  })
})
