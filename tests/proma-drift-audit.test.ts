import { expect, test } from 'bun:test'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'

test('Proma drift 全部完成分类且只保留五个 Main Host 触点', () => {
  const result = spawnSync(process.execPath, [
    join(import.meta.dir, '../scripts/audit-proma-drift.mjs'),
  ], { encoding: 'utf8' })

  expect(result.status, result.stderr).toBe(0)
  const audit = JSON.parse(result.stdout) as {
    summary: Record<string, number>
  }
  expect(audit.summary['host-seam']).toBe(5)
  expect(audit.summary['cosmetic-drift']).toBe(0)
  expect(audit.summary.stale).toBe(0)
  expect(audit.summary.accidental).toBe(0)
})
