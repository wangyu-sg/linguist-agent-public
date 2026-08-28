import { describe, expect, test } from 'bun:test'
import { buildReleaseNotes, normalizeUpstreamNotes, releaseNotesForCommit } from '../scripts/generate-release-notes.mjs'

describe('Release notes', () => {
  test('只接受明确编辑的公开更新日志', () => {
    expect(releaseNotesForCommit('chore(ci): trim tests')).toEqual([])
    expect(releaseNotesForCommit('fix(release): skip duplicate validation')).toEqual([])
    expect(releaseNotesForCommit('fix(agent): restore agent session tabs')).toEqual([])
    expect(releaseNotesForCommit('chore: internal', 'Release-Note: 新增项目批次视图\nRelease-Note: 改进窄窗口操作')).toEqual([
      '新增项目批次视图',
      '改进窄窗口操作',
    ])
    expect(releaseNotesForCommit('feat: internal', 'Release-Note: skip')).toEqual([])
  })

  test('上游升级展示真实 Proma Release 内容', () => {
    const notes = buildReleaseNotes({
      tag: 'v0.17.33',
      notes: [],
      previousBaseline: 'v0.17.15',
      currentBaseline: 'v0.17.26',
      upstreamNotes: '- 修复 Agent 列表性能',
    })
    expect(notes).toContain('Proma v0.17.26 更新')
    expect(notes).toContain('v0.17.15 → v0.17.26')
    expect(notes).toContain('修复 Agent 列表性能')
    expect(notes).not.toContain('自动构建与发布流程已完成')
  })

  test('上游说明移除重复标题和 Proma 安装包下载段', () => {
    const notes = normalizeUpstreamNotes('# Proma v0.17.26 更新\n\n## 新功能\n\n- 模糊搜索\n\n## 下载\n\n- Proma.dmg')
    expect(notes).toBe('#### 新功能\n\n- 模糊搜索')
  })
})
