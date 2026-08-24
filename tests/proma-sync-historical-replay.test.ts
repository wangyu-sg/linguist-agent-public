import { expect, test } from 'bun:test'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'

test('固定 Proma v0.17.59 历史冲突得到 9 个确定性策略', () => {
  const result = spawnSync(process.execPath, [
    join(import.meta.dir, '../scripts/test-proma-sync-replay.mjs'),
    '--local', '3cfb14ff09baea1c042356b93be2809fb11774c5',
    '--upstream', '4546c5f7d0fbfa4ed1d58aec63705fc75a9020c2',
  ], { encoding: 'utf8' })

  expect(result.status, result.stderr).toBe(0)
  const replay = JSON.parse(result.stdout) as {
    conflicts: number
    deterministic: number
  }
  expect(replay).toMatchObject({
    conflicts: 9,
    deterministic: 9,
  })
})
