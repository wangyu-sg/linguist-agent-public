import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const smokeScripts = [
  'run-g0-smoke.ts',
  'probe-pi-stream.ts',
  'probe-pb105-matrix.ts',
] as const

describe('packaged smoke 临时 HOME 清理合同', () => {
  for (const filename of smokeScripts) {
    test(`given ${filename} 完成或失败 when 退出 then 删除临时 HOME`, () => {
      const source = readFileSync(join(import.meta.dir, filename), 'utf8')
      expect(source).toContain('rmSync(tmpHome, { recursive: true, force: true })')
    })
  }

  test('given Node CAT service 测试创建大量 fixture when 测试进程退出 then 集中清理', () => {
    const source = readFileSync(
      join(import.meta.dir, '../../src/main/lib/linguist/test/service-testkit.ts'),
      'utf8',
    )
    expect(source).toContain("process.once('exit'")
    expect(source).toContain("mkdtempSync(join(tmpdir(), 'linguist-service-test-'))")
    expect(source).toContain('rmSync(path, { recursive: true, force: true })')
  })
})
