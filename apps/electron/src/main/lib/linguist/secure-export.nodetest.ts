import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { copyFileVerified, SecureExportError } from './secure-export'

test('secure export: overwrite defaults false; explicit overwrite is atomic and still refuses links/directories', () => {
  const root = mkdtempSync(join(tmpdir(), 'linguist-secure-export-'))
  try {
    const managedRoot = join(root, 'managed')
    const outputRoot = join(root, 'output')
    mkdirSync(managedRoot)
    mkdirSync(outputRoot)
    const sourcePath = join(managedRoot, 'source.bin')
    const destinationPath = join(outputRoot, 'delivery.bin')
    const bytes = Buffer.from('verified replacement')
    writeFileSync(sourcePath, bytes)
    writeFileSync(destinationPath, 'old')
    const expectedSha256 = createHash('sha256').update(bytes).digest('hex')

    assert.throws(
      () => copyFileVerified({ managedRoot, sourcePath, destinationPath, expectedSha256 }),
      SecureExportError,
    )
    const written = copyFileVerified({
      managedRoot,
      sourcePath,
      destinationPath,
      expectedSha256,
      overwrite: true,
    })
    assert.equal(written.sha256, expectedSha256)
    assert.deepEqual(readFileSync(destinationPath), bytes)

    const directory = join(outputRoot, 'directory')
    mkdirSync(directory)
    assert.throws(
      () => copyFileVerified({ managedRoot, sourcePath, destinationPath: directory, expectedSha256, overwrite: true }),
      SecureExportError,
    )
    const link = join(outputRoot, 'link')
    symlinkSync(destinationPath, link)
    assert.throws(
      () => copyFileVerified({ managedRoot, sourcePath, destinationPath: link, expectedSha256, overwrite: true }),
      SecureExportError,
    )
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
