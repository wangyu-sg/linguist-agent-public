import { expect, test } from 'bun:test'
import { lstatSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readJsonFileSafe, writeJsonFileAtomic } from './safe-file'

test.each(['.tmp', '.bak', ''])('JSON 原子写不沿 %s 符号链接修改其他文件', (suffix) => {
  const dir = mkdtempSync(join(tmpdir(), 'la-json-symlink-'))
  const path = join(dir, 'config.json')
  const victim = join(dir, 'victim.json')
  try {
    writeFileSync(victim, '{"keep":true}')
    if (suffix) writeFileSync(path, '{"previous":true}')
    symlinkSync(victim, path + suffix)

    writeJsonFileAtomic(path, { updated: true })

    expect(readFileSync(victim, 'utf8')).toBe('{"keep":true}')
    expect(JSON.parse(readFileSync(path, 'utf8'))).toEqual({ updated: true })
    expect(lstatSync(path).isSymbolicLink()).toBe(false)
    expect(lstatSync(path + '.bak').isSymbolicLink()).toBe(false)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('JSON 备份写入失败时保留主文件，并仍可从有效备份恢复', () => {
  const dir = mkdtempSync(join(tmpdir(), 'la-json-backup-'))
  const path = join(dir, 'config.json')
  try {
    writeJsonFileAtomic(path, { previous: true })
    mkdirSync(path + '.bak')
    expect(() => writeJsonFileAtomic(path, { updated: true })).toThrow()
    expect(readJsonFileSafe<{ previous: boolean }>(path)).toEqual({ previous: true })

    rmSync(path + '.bak', { recursive: true })
    writeJsonFileAtomic(path, { updated: true })
    writeFileSync(path, '{')
    expect(readJsonFileSafe<{ previous: boolean }>(path)).toEqual({ previous: true })
    expect(JSON.parse(readFileSync(path, 'utf8'))).toEqual({ previous: true })
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
