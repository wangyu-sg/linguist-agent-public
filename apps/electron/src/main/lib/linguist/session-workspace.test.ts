import { afterEach, describe, expect, test } from 'bun:test'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  ensureLinguistSessionWorkspace,
  moveLinguistSessionWorkspaceToTrash,
} from './session-workspace'

const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('Linguist session workspace', () => {
  test('Given 首次运行的项目会话 When 确保工作区 Then 建稳定目录与 manifest', () => {
    const configDir = mkdtempSync(join(tmpdir(), 'la-session-workspace-'))
    roots.push(configDir)

    const cwd = ensureLinguistSessionWorkspace(configDir, {
      projectId: 'project-1',
      sessionId: 'session-1',
      projectDisplayName: 'Project',
      role: 'reviewer',
      strategy: 'best',
      createdAt: '2026-07-29T00:00:00.000Z',
    })

    expect(cwd).toBe(join(configDir, 'linguist', 'agent-workspaces', 'project-1', 'session-1'))
    for (const child of ['.context', '.claude', 'scripts', 'reports', 'scratch', 'extracted']) {
      expect(existsSync(join(cwd, child))).toBe(true)
    }
    expect(JSON.parse(readFileSync(join(cwd, 'SESSION_MANIFEST.json'), 'utf8'))).toEqual({
      projectId: 'project-1',
      sessionId: 'session-1',
      role: 'reviewer',
      strategy: 'best',
      createdAt: '2026-07-29T00:00:00.000Z',
      projectDisplayName: 'Project',
    })
  })

  test('Given 删除 Linguist 会话 When 处置工作区 Then 移入受管 Trash', () => {
    const configDir = mkdtempSync(join(tmpdir(), 'la-session-trash-'))
    roots.push(configDir)
    const input = {
      projectId: 'project-1',
      sessionId: 'session-1',
      projectDisplayName: 'Project',
      role: 'assistant' as const,
      strategy: 'balanced' as const,
      createdAt: '2026-07-29T00:00:00.000Z',
    }
    const cwd = ensureLinguistSessionWorkspace(configDir, input)

    const trashed = moveLinguistSessionWorkspaceToTrash(
      configDir,
      input.projectId,
      input.sessionId,
      '2026-07-29T01:02:03.000Z',
    )

    expect(existsSync(cwd)).toBe(false)
    expect(trashed).toBe(
      join(configDir, 'linguist', 'trash', 'agent-workspaces', 'project-1', 'session-1-2026-07-29T01-02-03.000Z'),
    )
    expect(existsSync(trashed!)).toBe(true)
  })

  test('Given 路径分隔符伪装成 ID When 解析 Then fail closed', () => {
    const configDir = mkdtempSync(join(tmpdir(), 'la-session-invalid-'))
    roots.push(configDir)
    expect(() => ensureLinguistSessionWorkspace(configDir, {
      projectId: '../outside',
      sessionId: 'session-1',
      projectDisplayName: 'Project',
      role: 'assistant',
      strategy: 'balanced',
      createdAt: '2026-07-29T00:00:00.000Z',
    })).toThrow('projectId')
  })
})
