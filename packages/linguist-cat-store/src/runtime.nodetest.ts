import { test } from 'node:test'
import assert from 'node:assert/strict'
import { probeSqliteRuntime } from './runtime'

test('probe: node:sqlite is available under the node test runner', () => {
  const probe = probeSqliteRuntime()
  assert.equal(probe.ok, true, probe.notes.join('; '))
  assert.equal(probe.nodeVersion, process.version)
})

test('probe: backup capability and fallback are reported from the runtime surface', () => {
  const probe = probeSqliteRuntime()
  assert.ok(
    probe.notes.some((note) => probe.hasBackupApi
      ? note.includes('backup available')
      : note.includes('VACUUM INTO')),
    `expected a backup capability note, got: ${probe.notes.join(' | ')}`,
  )
})
