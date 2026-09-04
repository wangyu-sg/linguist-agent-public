import { expect, test } from 'bun:test'
import { spawnSync } from 'node:child_process'
test('启动、引导与打包使用同一产品身份', () => {
  const result = spawnSync(process.execPath, ['scripts/verify-product-identity.mjs'], { encoding: 'utf8' })
  expect(result.status, result.stderr).toBe(0)
})
