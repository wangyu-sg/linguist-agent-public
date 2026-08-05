import { expect, test } from 'bun:test'
import { delimiter, join } from 'node:path'
import { withoutBunNodeShim } from './run-electron-builder'

test('Electron Builder 使用真实 Node，而不是 Bun 注入的 node shim', () => {
  const shim = join('private', 'tmp', 'bun-node-build')
  const node = join('opt', 'homebrew', 'bin')
  expect(withoutBunNodeShim([shim, node].join(delimiter))).toBe(node)
})
