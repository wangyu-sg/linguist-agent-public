import { afterEach, describe, expect, test } from 'bun:test'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { AgentSessionMeta } from '@proma/shared'
import { saveFilesToManagedAgentSession } from './agent-session-file-storage'

const temporaryRoots: string[] = []

afterEach(() => {
  while (temporaryRoots.length > 0) {
    const root = temporaryRoots.pop()
    if (root) rmSync(root, { recursive: true, force: true })
  }
})

function makeTemporaryRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'linguist-agent-session-files-'))
  temporaryRoots.push(root)
  return root
}

function makeSession(id = 'session-authoritative'): AgentSessionMeta {
  return {
    id,
    title: '附件测试会话',
    workspaceId: 'workspace-authoritative',
    createdAt: 1,
    updatedAt: 1,
  }
}

describe('受管 Agent 会话附件写入', () => {
  test('Given 伪造的 workspaceSlug When 保存附件 Then 只写入会话元数据授权的目录', () => {
    const root = makeTemporaryRoot()
    const authoritativeDir = join(root, 'managed', 'session-authoritative')
    const results = saveFilesToManagedAgentSession({
      workspaceSlug: '../../renderer-controlled',
      sessionId: 'session-authoritative',
      files: [{ filename: 'note.txt', data: Buffer.from('可信目录').toString('base64') }],
    }, {
      getSessionMeta: (id) => id === 'session-authoritative' ? makeSession(id) : undefined,
      resolveExecutionScope: () => ({ kind: 'agent-workspace', cwd: authoritativeDir }),
    })

    expect(results).toHaveLength(1)
    expect(results[0]?.targetPath).toBe(join(authoritativeDir, 'note.txt'))
    expect(readFileSync(join(authoritativeDir, 'note.txt'), 'utf-8')).toBe('可信目录')
    expect(existsSync(join(root, 'renderer-controlled'))).toBe(false)
  })

  test('Given 路径穿越文件名 When 保存附件 Then 在解析受管目录前拒绝且零写入', () => {
    const root = makeTemporaryRoot()
    let resolvedScope = false

    expect(() => saveFilesToManagedAgentSession({
      workspaceSlug: 'workspace-ignored',
      sessionId: 'session-authoritative',
      files: [{ filename: '../escaped.txt', data: Buffer.from('不应写入').toString('base64') }],
    }, {
      getSessionMeta: () => makeSession(),
      resolveExecutionScope: () => {
        resolvedScope = true
        return { kind: 'agent-workspace', cwd: join(root, 'managed') }
      },
    })).toThrow('文件名不安全')

    expect(resolvedScope).toBe(false)
    expect(existsSync(join(root, 'escaped.txt'))).toBe(false)
    expect(existsSync(join(root, 'managed'))).toBe(false)
  })

  test('Given 非法 base64 数据 When 保存附件 Then 在解析受管目录前拒绝且零写入', () => {
    const root = makeTemporaryRoot()
    let resolvedScope = false

    expect(() => saveFilesToManagedAgentSession({
      workspaceSlug: 'workspace-ignored',
      sessionId: 'session-authoritative',
      files: [{ filename: 'note.txt', data: '%%% not-base64 %%%' }],
    }, {
      getSessionMeta: () => makeSession(),
      resolveExecutionScope: () => {
        resolvedScope = true
        return { kind: 'agent-workspace', cwd: join(root, 'managed') }
      },
    })).toThrow('base64')

    expect(resolvedScope).toBe(false)
    expect(existsSync(join(root, 'managed'))).toBe(false)
  })

  test('Given 不存在的会话 When 保存附件 Then 不解析或创建任何目录', () => {
    const root = makeTemporaryRoot()
    let resolvedScope = false

    expect(() => saveFilesToManagedAgentSession({
      workspaceSlug: 'workspace-ignored',
      sessionId: 'unknown-session',
      files: [{ filename: 'note.txt', data: Buffer.from('不应写入').toString('base64') }],
    }, {
      getSessionMeta: () => undefined,
      resolveExecutionScope: () => {
        resolvedScope = true
        return { kind: 'agent-workspace', cwd: join(root, 'managed') }
      },
    })).toThrow('会话不存在')

    expect(resolvedScope).toBe(false)
    expect(existsSync(join(root, 'managed'))).toBe(false)
  })

  test('Given 无受管会话目录的 home scope When 保存附件 Then 拒绝写入', () => {
    const root = makeTemporaryRoot()

    expect(() => saveFilesToManagedAgentSession({
      workspaceSlug: 'workspace-ignored',
      sessionId: 'session-authoritative',
      files: [{ filename: 'note.txt', data: Buffer.from('不应写入').toString('base64') }],
    }, {
      getSessionMeta: () => makeSession(),
      resolveExecutionScope: () => ({ kind: 'home', cwd: join(root, 'home') }),
    })).toThrow('没有受管附件目录')

    expect(existsSync(join(root, 'home'))).toBe(false)
  })
})
