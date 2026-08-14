import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const root = join(import.meta.dir, '..')
const ciWorkflow = readFileSync(join(root, '.github/workflows/ci.yml'), 'utf8')
const releaseWorkflow = readFileSync(join(root, '.github/workflows/release.yml'), 'utf8')
const autoReleaseWorkflow = readFileSync(join(root, '.github/workflows/auto-release.yml'), 'utf8')
const electronPackage = JSON.parse(
  readFileSync(join(root, 'apps/electron/package.json'), 'utf8'),
) as { scripts: Record<string, string> }

describe('AC-002 发布链 fail-closed', () => {
  test('Release 复用完整 CI，并让三个发布构建显式依赖验证成功', () => {
    expect(ciWorkflow).toContain('workflow_call:')
    expect(releaseWorkflow).toContain('uses: ./.github/workflows/ci.yml')
    expect(releaseWorkflow.match(/needs: validate/g)).toHaveLength(3)
  })

  test('所有平台成功且更新元数据齐全后才公开 Release', () => {
    expect(releaseWorkflow).toContain('needs: [build-mac-arm64, build-mac-x64, build-windows-x64, merge-mac-yml]')
    expect(releaseWorkflow).toContain("grep -Fx 'latest-mac.yml'")
    expect(releaseWorkflow).toContain("grep -Fx 'latest.yml'")
    expect(releaseWorkflow).toContain('--draft=false --latest')
    expect(releaseWorkflow).toContain("needs.merge-mac-yml.result == 'success'")
  })

  test('普通 main 提交只有显式声明 release 才创建安装包', () => {
    expect(autoReleaseWorkflow).toContain("grep -qi '\\[release\\]'")
  })

  test('公开 Release 前删除未使用的差分资产', () => {
    expect(releaseWorkflow).toContain('endswith(".blockmap")')
    expect(releaseWorkflow).toContain('gh release delete-asset')
  })

  test('关键资源复制失败会终止构建', () => {
    expect(electronPackage.scripts['build:resources']).toContain("cpSync('resources', 'dist/resources', { recursive: true })")
    expect(electronPackage.scripts['build:resources']).not.toContain('|| true')
  })
})
