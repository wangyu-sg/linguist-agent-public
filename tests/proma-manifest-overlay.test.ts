import { describe, expect, test } from 'bun:test'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'

const SCRIPT = join(import.meta.dir, '../scripts/apply-la-electron-overlay.mjs')

interface Fixture {
  base: Record<string, unknown>
  overlay: Record<string, unknown>
}

function runOverlay(fixture: Fixture) {
  const root = mkdtempSync(join(tmpdir(), 'la-overlay-'))
  const base = join(root, 'base.json')
  const overlay = join(root, 'overlay.json')
  const output = join(root, 'output.json')
  writeFileSync(base, `${JSON.stringify(fixture.base, null, 2)}\n`)
  writeFileSync(overlay, `${JSON.stringify(fixture.overlay, null, 2)}\n`)
  const result = spawnSync(process.execPath, [SCRIPT, '--base', base, '--overlay', overlay, '--output', output], {
    encoding: 'utf8',
  })
  return { ...result, output }
}

describe('Electron manifest overlay', () => {
  test('只把登记的 LA 字段覆盖到上游 manifest', () => {
    const result = runOverlay({
      base: {
        version: '1.0.0',
        description: 'Proma',
        scripts: { build: 'upstream', keep: 'unchanged', remove: 'old' },
      },
      overlay: {
        schemaVersion: 1,
        operations: [
          { path: ['version'], value: '1.0.1', overwrite: true },
          { path: ['description'], expected: 'Proma', value: 'Linguist Agent' },
          { path: ['scripts', 'build'], expected: 'upstream', value: 'la-build' },
          { path: ['scripts', 'add'], value: 'la-only' },
          { path: ['scripts', 'remove'], expected: 'old', remove: true },
        ],
      },
    })

    expect(result.status).toBe(0)
    expect(JSON.parse(readFileSync(result.output, 'utf8'))).toEqual({
      version: '1.0.1',
      description: 'Linguist Agent',
      scripts: { build: 'la-build', keep: 'unchanged', add: 'la-only' },
    })
  })

  test('上游改变同一字段时以 OVERLAY_CONFLICT 失败', () => {
    const result = runOverlay({
      base: { scripts: { build: 'new-upstream' } },
      overlay: {
        schemaVersion: 1,
        operations: [
          { path: ['scripts', 'build'], expected: 'old-upstream', value: 'la-build' },
        ],
      },
    })

    expect(result.status).not.toBe(0)
    expect(result.stderr).toContain('OVERLAY_CONFLICT')
  })
})
