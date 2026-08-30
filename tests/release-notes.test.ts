import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { extractChangelogVersion } from '../scripts/generate-release-notes.mjs'

const root = join(import.meta.dir, '..')

const changelog = `# Changelog

## [Unreleased]

### Added

- 尚未发布

## [0.17.65] - 2026-08-30

### Fixed

- 修复应用内更新。

## [0.17.64] - 2026-08-29

### Changed

- 旧版本内容。

[Unreleased]: https://example.com/compare/v0.17.65...HEAD
[0.17.65]: https://example.com/compare/v0.17.64...v0.17.65
`

describe('Release notes', () => {
  test('按 Tag 提取包含版本标题的完整 Keep a Changelog 发布节', () => {
    expect(extractChangelogVersion(changelog, 'v0.17.65')).toBe(
      '## [0.17.65] - 2026-08-30\n\n### Fixed\n\n- 修复应用内更新。',
    )
  })

  test('提取最后一个版本时不包含底部版本链接定义', () => {
    expect(extractChangelogVersion(changelog, '0.17.64')).toBe(
      '## [0.17.64] - 2026-08-29\n\n### Changed\n\n- 旧版本内容。',
    )
  })

  test('版本缺失、重复或内容为空时拒绝生成', () => {
    expect(() => extractChangelogVersion(changelog, 'v9.9.9')).toThrow('缺少版本 9.9.9')
    expect(() => extractChangelogVersion(`${changelog}\n## [0.17.65] - 2026-08-30\n\n- 重复`, '0.17.65'))
      .toThrow('重复版本 0.17.65')
    expect(() => extractChangelogVersion('## [0.17.65] - 2026-08-30\n\n## [0.17.64] - 2026-08-29\n\n- 旧版本', '0.17.65'))
      .toThrow('版本 0.17.65 没有发布内容')
  })

  test('当前应用版本在真实 CHANGELOG 中有可发布版本节', () => {
    const packageJson = JSON.parse(
      readFileSync(join(root, 'apps/electron/package.json'), 'utf8'),
    ) as { version: string }
    const currentChangelog = readFileSync(join(root, 'CHANGELOG.md'), 'utf8')
    const releaseNotes = extractChangelogVersion(currentChangelog, `v${packageJson.version}`)

    expect(releaseNotes.startsWith(`## [${packageJson.version}] - `)).toBe(true)
  })
})
