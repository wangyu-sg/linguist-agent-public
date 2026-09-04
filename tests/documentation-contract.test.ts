import { expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { LINGUIST_CAT_TOOL_NAMES } from '../packages/linguist-cat-tools/src/types'

const read = (file: string): string => readFileSync(new URL(`../${file}`, import.meta.url), 'utf8')

test('稳定文档不复制当前版本与测试总数，TODO 只保留未完成项', () => {
  for (const file of ['README.md', 'README.en.md', 'AGENTS.md', 'docs/HANDOFF.md']) {
    const source = read(file)
    expect(source, file).not.toMatch(/\bv?\d+\.\d+\.\d+\b|\b\d+\s*\/\s*\d+\b/)
    expect(source, file).toContain('CURRENT_FACTS_SIMPLE.md')
  }
  expect(read('TODO.md')).not.toMatch(/\[x\]/i)
  const status = read('docs/roadmap/SIMPLE_IMPLEMENTATION_STATUS.md')
  expect(status.split('\n').length).toBeLessThan(12)
  expect(status).toContain('CURRENT_FACTS_SIMPLE.md')
  expect(status).toContain('TODO.md')
})

test('当前事实的版本、Schema 和工具数量来自机器真源', () => {
  const baseline = JSON.parse(read('docs/architecture/proma-baseline.json'))
  const app = JSON.parse(read('apps/electron/package.json'))
  const schema = Number(read('packages/linguist-cat-store/src/schema.ts').match(/export const SCHEMA_VERSION = (\d+)/)![1])
  expect(baseline.product.linguistAgentVersion).toBe(app.version)
  expect(baseline.product.catSchema).toBe(schema)
  const facts = read('CURRENT_FACTS_SIMPLE.md')
  for (const [label, value] of [['App', app.version], ['Proma', baseline.upstream.tag], ['Proma commit', baseline.upstream.commit], ['CAT Schema', schema], ['CAT Tool Count', LINGUIST_CAT_TOOL_NAMES.length]]) {
    expect(facts).toContain(`| ${label} | \`${value}\` |`)
  }
})

test('中英文产品事实一致且不再否认公开发行', () => {
  for (const file of ['README.md', 'README.en.md']) {
    const source = read(file)
    for (const word of ['Agent', 'Chat', 'Linguist', 'General', 'Translator', 'Reviewer', 'Proofreader', 'Proma', 'resources/linguist-roles']) expect(source, file).toContain(word)
    for (const word of file === 'README.md' ? ['持久化用户消息', '新建项目会话', '委派子会话岗位固定', '作者本人安装与自动更新', '不承诺公众支持'] : ['persisted user message', 'new project session', 'child sessions have fixed roles', 'own installation and automatic updates', 'no public support']) expect(source, file).toContain(word)
  }
  for (const file of ['README.md', 'README.en.md', 'AGENTS.md', 'CURRENT_FACTS_SIMPLE.md', 'docs/HANDOFF.md', 'TODO.md', 'docs/release/KNOWN_LIMITATIONS.md']) expect(read(file), file).not.toMatch(/没有公[众开]发布计划|没有公开 Release|no public-release plan|公众发行（不在当前范围）/)
})
