/**
 * paths.ts 纯逻辑测试（bun 安全：纯 path 运算，无 fs / electron 依赖）。
 */

import { describe, expect, test } from 'bun:test'
import { join } from 'node:path'
import { projectPaths, resolveLinguistRootDir, toRootRelativePath } from './paths'

describe('resolveLinguistRootDir', () => {
  test('CAT root is <configDir>/linguist (never hardcoded ~/.linguist-agent)', () => {
    expect(resolveLinguistRootDir('/cfg')).toBe(join('/cfg', 'linguist'))
    expect(resolveLinguistRootDir('/home/u/.linguist-agent-dev')).toBe(join('/home/u/.linguist-agent-dev', 'linguist'))
  })
})

describe('projectPaths', () => {
  test('layout matches plan §5.2 (projects/<id>/{project.json,cat.db,source/,blobs/,exports/,backups/})', () => {
    const root = join('/cfg', 'linguist')
    const paths = projectPaths(root, 'prj-1')
    const dir = join(root, 'projects', 'prj-1')
    expect(paths.projectDir).toBe(dir)
    expect(paths.projectJsonPath).toBe(join(dir, 'project.json'))
    expect(paths.catDbPath).toBe(join(dir, 'cat.db'))
    expect(paths.sourceDir).toBe(join(dir, 'source'))
    expect(paths.blobsDir).toBe(join(dir, 'blobs'))
    expect(paths.exportsDir).toBe(join(dir, 'exports'))
    expect(paths.backupsDir).toBe(join(dir, 'backups'))
  })
})

describe('toRootRelativePath', () => {
  const root = join('/cfg', 'linguist')

  test('paths inside the root become root-relative (no machine-private prefix)', () => {
    const abs = join(root, 'projects', 'prj-1', 'backups', 'cat-2026.db')
    expect(toRootRelativePath(root, abs)).toBe(join('projects', 'prj-1', 'backups', 'cat-2026.db'))
  })

  test('paths outside the root are an internal bug and throw', () => {
    expect(() => toRootRelativePath(root, '/etc/passwd')).toThrow()
    expect(() => toRootRelativePath(root, join(root, '..', 'outside'))).toThrow()
    expect(() => toRootRelativePath(root, root)).toThrow()
  })
})
