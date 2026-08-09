import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const smokeScripts = [
  'run-g0-smoke.ts',
  'probe-pi-stream.ts',
  'probe-pb074-e2e.ts',
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

describe('packaged smoke 主窗口识别合同', () => {
  for (const filename of smokeScripts) {
    test(`given ${filename} 冷启动 when 原生启动页与主窗口同时出现 then 忽略启动页`, () => {
      const source = readFileSync(join(import.meta.dir, filename), 'utf8')
      expect(source).toContain("!url.includes('/startup-splash/')")
    })
  }
})

test('given PB-074 驱动打包应用 when 需要多次重启 then 只连接 Renderer CDP 并拒绝异常退出', () => {
  const source = readFileSync(join(import.meta.dir, 'probe-pb074-e2e.ts'), 'utf8')
  const mainSource = readFileSync(join(import.meta.dir, '../../src/main/index.ts'), 'utf8')
  expect(source).toContain("spawn(PACKAGED_BINARY")
  expect(source).toContain("chromium.connectOverCDP")
  expect(source).toContain("processHandle.kill('SIGTERM')")
  expect(mainSource).toContain("process.once('SIGTERM', () => app.quit())")
  expect(source).not.toContain('_electron as electron')
  expect(source).not.toContain("node:inspector")
  expect(source).toContain('打包应用异常退出')
})
