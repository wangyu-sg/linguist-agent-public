import { afterEach, expect, test } from 'bun:test'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { deliverDelegationInputs, preflightDelegationInputs } from './agent-collaboration-inputs'

const roots: string[] = []
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'collab-inputs-'))
  roots.push(root)
  const parentCwd = join(root, 'parent-cwd')
  const project = join(root, 'project')
  const childSessionDir = join(root, 'child-session')
  mkdirSync(parentCwd)
  mkdirSync(project)
  mkdirSync(childSessionDir)
  return { root, parentCwd, project, childSessionDir }
}

test('父子 cwd 不同：共享文件直接引用，私有文件只复制明确指定项并冻结版本', async () => {
  const { parentCwd, project, childSessionDir } = fixture()
  const shared = join(project, 'shared.txt')
  const privateFile = join(parentCwd, 'draft.txt')
  writeFileSync(shared, 'shared content')
  writeFileSync(privateFile, 'first version')
  writeFileSync(join(parentCwd, 'excluded.txt'), 'must not copy')
  const sharedHash = createHash('sha256').update('shared content').digest('hex')

  const result = await preflightDelegationInputs([
    { path: '../project/shared.txt' },
    { path: 'draft.txt' },
    { path: '../project/shared.txt', expectedSha256: sharedHash },
  ], {
    parentCwd,
    parentRoots: [parentCwd, project],
    childReadablePaths: [project],
  })
  expect(result.ready).toBe(true)
  const receipts = await deliverDelegationInputs(result.items, childSessionDir)
  expect(receipts[0]).toMatchObject({ state: 'referenced', usablePath: realpathSync(shared) })
  expect(receipts[0]?.sha256).toBeUndefined()
  expect(receipts[1]).toMatchObject({ state: 'snapshotted', requestedPath: 'draft.txt' })
  const snapshot = receipts[1]?.usablePath
  expect(snapshot).toBeDefined()
  expect(readFileSync(snapshot!, 'utf8')).toBe('first version')
  expect(receipts[1]?.sha256).toBe(createHash('sha256').update('first version').digest('hex'))
  expect(receipts[2]).toMatchObject({ state: 'snapshotted', sha256: sharedHash })
  expect(readdirSync(join(childSessionDir, 'delegation-inputs'))).toHaveLength(2)

  writeFileSync(privateFile, 'later version')
  expect(readFileSync(snapshot!, 'utf8')).toBe('first version')
})

test('缺失、指纹不符与越权 symlink 在创建子任务前被拦截', async () => {
  const { root, parentCwd } = fixture()
  const outside = join(root, 'outside.txt')
  writeFileSync(outside, 'secret')
  symlinkSync(outside, join(parentCwd, 'escape.txt'))
  writeFileSync(join(parentCwd, 'present.txt'), 'actual')
  const result = await preflightDelegationInputs([
    { path: 'missing.txt' },
    { path: 'optional.txt', required: false },
    { path: 'escape.txt' },
    { path: 'present.txt', expectedSha256: '0'.repeat(64) },
  ], {
    parentCwd,
    parentRoots: [parentCwd],
    childReadablePaths: [],
  })
  expect(result.ready).toBe(false)
  expect(result.items.map(item => item.receipt.state)).toEqual([
    'blocked-input', 'missing', 'blocked-input', 'blocked-input',
  ])
  expect(result.items[2]?.receipt.reason).toContain('授权')
  expect(result.items[3]?.receipt.reason).toContain('SHA-256')
  expect(existsSync(join(root, 'child-session', 'delegation-inputs'))).toBe(false)
})
