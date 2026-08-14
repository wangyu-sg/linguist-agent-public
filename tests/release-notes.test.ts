import { describe, expect, test } from 'bun:test'
import { buildReleaseNotes, releaseNoteForCommit } from '../scripts/generate-release-notes.mjs'

describe('Release notes', () => {
  test('过滤工程提交并保留用户可读变化', () => {
    expect(releaseNoteForCommit('chore(ci): trim tests')).toBeUndefined()
    expect(releaseNoteForCommit('fix(release): skip duplicate validation')).toBeUndefined()
    expect(releaseNoteForCommit('fix(agent): 修复会话恢复')).toBe('**修复**：修复会话恢复')
    expect(releaseNoteForCommit('chore: internal', 'Release-Note: 新增项目批次视图')).toBe('新增项目批次视图')
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
})
