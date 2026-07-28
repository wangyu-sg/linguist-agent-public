import { test } from 'node:test'
import assert from 'node:assert/strict'
import { probeSqliteRuntime } from './runtime'

test('probe: node:sqlite is available under the node test runner', () => {
  const probe = probeSqliteRuntime()
  assert.equal(probe.ok, true, probe.notes.join('; '))
  assert.equal(probe.nodeVersion, process.version)
})

test('probe: backup API fallback is reported (Node 22 has no db.backup)', () => {
  const probe = probeSqliteRuntime()
  const major = Number(process.version.slice(1).split('.')[0])
  assert.equal(probe.hasBackupApi, major > 23 || (major === 23 && Number(process.version.slice(1).split('.')[1]) >= 4))
  if (!probe.hasBackupApi) {
    assert.ok(
      probe.notes.some((n) => n.includes('VACUUM INTO')),
      `expected a VACUUM INTO fallback note, got: ${probe.notes.join(' | ')}`,
    )
  }
})
