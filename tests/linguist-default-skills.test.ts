import { expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { LINGUIST_CAT_TOOL_NAMES } from '@linguist/cat-tools'
import { parseSkillVersion } from '../apps/electron/src/main/lib/config-paths'

const REPO_ROOT = dirname(import.meta.dir)
const SKILLS_ROOT = join(REPO_ROOT, 'apps', 'electron', 'default-skills')

const REQUIRED_TOOLS = {
  'localization-readiness': [
    'cat_project_summary',
    'cat_list_assets',
    'cat_scan_unknown_tag_patterns',
    'cat_list_term_conflicts',
  ],
  'translator-brief': [
    'cat_project_summary',
    'cat_list_assets',
    'cat_get_segments',
    'cat_get_translation_context',
    'cat_get_voice_context',
  ],
  'terminology-candidate-mining': [
    'cat_get_segments',
    'cat_search_terms',
    'cat_search_tm',
  ],
  'cultural-lqa': [
    'cat_project_summary',
    'cat_get_segments',
    'cat_get_translation_context',
    'cat_read_context_doc',
  ],
  'release-lqa': [
    'cat_project_summary',
    'cat_list_assets',
    'cat_get_segments',
    'cat_run_qa',
    'cat_get_qa_findings',
  ],
} as const

function readSkill(slug: keyof typeof REQUIRED_TOOLS): string {
  return readFileSync(join(SKILLS_ROOT, slug, 'SKILL.md'), 'utf8')
}

test('五个 Linguist Skill 以证据化 CAT 流程执行并有明确完成条件', () => {
  for (const [slug, tools] of Object.entries(REQUIRED_TOOLS)) {
    const content = readSkill(slug as keyof typeof REQUIRED_TOOLS)
    expect(content).toContain('group: linguist')
    expect(parseSkillVersion(join(SKILLS_ROOT, slug))).toBe('1.0.1')
    expect(content).toContain('## 执行')
    expect(content).toContain('完成条件：')
    expect(content).toContain('## 输出')
    expect(content).toContain('证据')
    expect(content).toMatch(/分页|覆盖/)
    for (const tool of tools) expect(content).toContain(`\`${tool}\``)
    const referencedTools = content.match(/\bcat_[a-z0-9_]+\b/g) ?? []
    for (const tool of referencedTools) expect(LINGUIST_CAT_TOOL_NAMES).toContain(tool)
  }
})

test('术语候选不排除有项目意义的纯数字且不得自动写库', () => {
  const content = readSkill('terminology-candidate-mining')
  expect(content).not.toContain('排除纯数字')
  expect(content).toContain('纯数字')
  expect(content).toContain('不得调用 `cat_upsert_terms`')
})

test('Release LQA 检查不会自行导出或冒充全量覆盖', () => {
  const content = readSkill('release-lqa')
  expect(content).toContain('不得调用 `cat_export_asset`')
  expect(content).toContain('未覆盖')
  expect(content).toContain('抽查')
})
