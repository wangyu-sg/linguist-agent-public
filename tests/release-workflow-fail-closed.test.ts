import { describe, expect, test } from 'bun:test'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const root = join(import.meta.dir, '..')
const ciWorkflow = readFileSync(join(root, '.github/workflows/ci.yml'), 'utf8')
const releaseWorkflow = readFileSync(join(root, '.github/workflows/release.yml'), 'utf8')
const autoReleaseWorkflow = readFileSync(join(root, '.github/workflows/auto-release.yml'), 'utf8')
const upstreamSyncWorkflow = readFileSync(join(root, '.github/workflows/upstream-sync.yml'), 'utf8')
const electronBuilderConfig = readFileSync(join(root, 'apps/electron/electron-builder.yml'), 'utf8')
const macInstallHelpPath = join(root, 'apps/electron/resources/macos-install-help.txt')
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

  test('上游同步先确定 LA 发布版本再生成基线文档', () => {
    const versionIndex = upstreamSyncWorkflow.indexOf('VERSION_OUTPUT="$(node scripts/release-version.mjs)"')
    const baselineIndex = upstreamSyncWorkflow.indexOf('node scripts/update-proma-baseline.mjs')

    expect(versionIndex).toBeGreaterThan(-1)
    expect(baselineIndex).toBeGreaterThan(versionIndex)
  })

  test('上游同步按登记策略解决冲突并验证 Host Seam', () => {
    expect(upstreamSyncWorkflow).toContain('git merge --no-commit --no-ff')
    expect(upstreamSyncWorkflow).toContain('node scripts/resolve-proma-conflicts.mjs')
    expect(upstreamSyncWorkflow).toContain('node scripts/apply-la-electron-overlay.mjs')
    expect(upstreamSyncWorkflow).toContain('node scripts/verify-host-seams.mjs')
    expect(upstreamSyncWorkflow).toContain('Resolver Error Code')
  })

  test('公开 Release 前删除未使用的差分资产', () => {
    expect(releaseWorkflow).toContain('endswith(".blockmap")')
    expect(releaseWorkflow).toContain('gh release delete-asset')
  })

  test('macOS 自动更新发布必须使用固定签名身份', () => {
    expect(releaseWorkflow).not.toContain('继续生成个人 Alpha 未签名产物')
    expect(releaseWorkflow.match(/test -n "\$MAC_CERTS"/g)).toHaveLength(2)
    expect(releaseWorkflow.match(/sudo security add-trusted-cert -d -r trustRoot/g)).toHaveLength(2)
    expect(releaseWorkflow.match(/security find-identity -v -p codesigning/g)).toHaveLength(2)
  })

  test('DMG 包含首次打开的解除隔离说明', () => {
    expect(electronBuilderConfig).toContain('path: resources/macos-install-help.txt')
    expect(existsSync(macInstallHelpPath)).toBe(true)
    if (!existsSync(macInstallHelpPath)) return
    expect(readFileSync(macInstallHelpPath, 'utf8')).toContain(
      'xattr -dr com.apple.quarantine "/Applications/Linguist Agent.app"',
    )
  })

  test('关键资源复制失败会终止构建', () => {
    expect(electronPackage.scripts['build:resources']).toContain("cpSync('resources', 'dist/resources', { recursive: true })")
    expect(electronPackage.scripts['build:resources']).not.toContain('|| true')
  })
})
