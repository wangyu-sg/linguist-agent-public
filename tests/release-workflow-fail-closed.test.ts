import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const root = join(import.meta.dir, '..')
const ciWorkflow = readFileSync(join(root, '.github/workflows/ci.yml'), 'utf8')
const releaseWorkflow = readFileSync(join(root, '.github/workflows/release.yml'), 'utf8')
const electronPackage = JSON.parse(
  readFileSync(join(root, 'apps/electron/package.json'), 'utf8'),
) as { scripts: Record<string, string> }

describe('AC-002 发布链 fail-closed', () => {
  test('Release 复用完整 CI，并让三个发布构建显式依赖验证成功', () => {
    expect(ciWorkflow).toContain('workflow_call:')
    expect(releaseWorkflow).toContain('uses: ./.github/workflows/ci.yml')
    expect(releaseWorkflow.match(/needs: validate/g)).toHaveLength(3)
  })

  test('macOS 三次重试全部失败时显式返回非零', () => {
    expect(releaseWorkflow.match(/packaging failed after 3 attempts/g)).toHaveLength(2)
    expect(releaseWorkflow.match(/exit 1/g)?.length ?? 0).toBeGreaterThanOrEqual(3)
  })

  test('关键资源复制失败会终止构建', () => {
    expect(electronPackage.scripts['build:resources']).toBe('cp -r resources dist/')
  })
})
