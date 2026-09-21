import { afterEach, beforeEach, expect, test } from 'bun:test'
import { createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { writeJsonFileAtomic, writeTextFileAtomic } from '../safe-file'
import { PROJECT_BRIEF_PATH, readProjectBrief, readWorkspaceBriefSource, type ProjectBrief } from './project-brief'

let root: string
const identity = { projectId: 'synthetic-project', sourceLocale: 'zh-CN', targetLocale: 'en-US' }
const guide = 'Tutorial text uses concise imperatives.'
const version = createHash('sha256').update(guide).digest('hex')

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'la-brief-'))
  mkdirSync(join(root, '.linguist'))
  writeTextFileAtomic(join(root, 'guide.md'), guide)
})
afterEach(() => rmSync(root, { recursive: true, force: true }))

function fixture(): ProjectBrief {
  return {
    schemaVersion: 1,
    projectIdentity: identity,
    purpose: '合成教程与对白',
    sources: [{ ref: 'workspace-file:guide.md', version, coverage: 'complete', approvalProvenance: '用户提供的测试要求' }],
    requirements: [{ id: 'tutorial', statement: guide, appliesTo: { textTypes: ['tutorial'] }, strength: 'required', sourceRefs: [{ ref: 'workspace-file:guide.md', version, locator: 'line 1' }] }],
    referenceRoutes: [], unresolved: [],
  }
}
function read() {
  return readProjectBrief({ workspaceRoot: root, identity, resolveSource: ref => readWorkspaceBriefSource(root, ref) })
}

test('无简报正常返回；当前要求保留范围、来源、完整性声明且读取不写文件', () => {
  expect(read()).toBeUndefined()
  writeJsonFileAtomic(join(root, PROJECT_BRIEF_PATH), fixture())
  const before = readFileSync(join(root, PROJECT_BRIEF_PATH), 'utf8')
  const result = read()!
  expect(result.lines.join('\n')).toContain('[current:tutorial]')
  expect(result.lines.join('\n')).toContain('"textTypes":["tutorial"]')
  expect(result.lines.join('\n')).toContain('非批准/逐段完成证明')
  expect(result.lines.join('\n')).toContain(`sha256=${createHash('sha256').update(before).digest('hex')}`)
  expect(readFileSync(join(root, PROJECT_BRIEF_PATH), 'utf8')).toBe(before)
  expect(readdirSync(join(root, '.linguist'))).toEqual(['project-brief.json'])
})

test('原件变化后只抑制过期要求，不改派生原文件或其它有效条目', () => {
  const value = fixture()
  value.sources.push({ ref: 'workspace-file:other.md', version, coverage: 'complete' })
  value.requirements.push({ ...value.requirements[0]!, id: 'other', sourceRefs: [{ ref: 'workspace-file:other.md', version }] })
  writeTextFileAtomic(join(root, 'other.md'), guide)
  writeJsonFileAtomic(join(root, PROJECT_BRIEF_PATH), value)
  writeTextFileAtomic(join(root, 'guide.md'), 'Updated tutorial requirement.')
  const result = read()!
  expect(result.lines.find(line => line.startsWith('- [stale:tutorial]'))).not.toContain(guide)
  expect(result.lines.find(line => line.startsWith('- [current:other]'))).toContain(guide)
  expect(JSON.parse(readFileSync(join(root, PROJECT_BRIEF_PATH), 'utf8')).sources[0].version).toBe(version)
})

test('部分整理与未知来源不能变成完整有效基线', () => {
  const value = fixture()
  value.sources[0]!.coverage = 'partial'
  writeJsonFileAtomic(join(root, PROJECT_BRIEF_PATH), value)
  expect(read()!.lines.join('\n')).toContain('[partial:tutorial]')
  const unknown = readProjectBrief({ workspaceRoot: root, identity, resolveSource: () => undefined })!
  expect(unknown.lines.join('\n')).toContain('[unknown:tutorial]')
  expect(unknown.lines.join('\n')).toContain('未核实')
})

test('已有 projectRules 只存身份，正文使用当前 Store 版本', () => {
  const value = fixture()
  value.sources = [{ ref: 'style-rule:one', version: 'v2', coverage: 'complete' }]
  value.requirements = [{ id: 'one', appliesTo: { textTypes: ['tutorial'] }, strength: 'required', sourceRefs: [{ ref: 'style-rule:one', version: 'v2' }] }]
  writeJsonFileAtomic(join(root, PROJECT_BRIEF_PATH), value)
  const result = readProjectBrief({ workspaceRoot: root, identity, resolveSource: () => ({ version: 'v2', ruleText: 'Current rule text' }) })!
  expect(result.includedRuleRefs).toEqual(['style-rule:one'])
  expect(result.lines.join('\n')).toContain('Current rule text')
  value.requirements[0]!.statement = 'Duplicate editable copy'
  writeJsonFileAtomic(join(root, PROJECT_BRIEF_PATH), value)
  expect(() => read()).toThrow('只引用')
})

test('拒绝错项目、坏格式和越界简报/原件，不跟随外部符号链接', () => {
  const value = fixture()
  value.projectIdentity = { ...identity, projectId: 'other-project' }
  writeJsonFileAtomic(join(root, PROJECT_BRIEF_PATH), value)
  expect(() => read()).toThrow('身份或语言对不匹配')
  writeJsonFileAtomic(join(root, PROJECT_BRIEF_PATH), { schemaVersion: 9 })
  expect(() => read()).toThrow('格式无效')
  const outside = mkdtempSync(join(tmpdir(), 'la-brief-outside-'))
  try {
    writeJsonFileAtomic(join(outside, 'private.json'), fixture())
    rmSync(join(root, PROJECT_BRIEF_PATH))
    symlinkSync(join(outside, 'private.json'), join(root, PROJECT_BRIEF_PATH))
    expect(() => read()).toThrow('不在绑定工作区')
    symlinkSync(join(outside, 'private.json'), join(root, 'external.json'))
    expect(() => readWorkspaceBriefSource(root, 'workspace-file:external.json')).toThrow('不在绑定工作区')
    expect(() => readWorkspaceBriefSource(root, `workspace-file:${join(outside, 'private.json')}`)).toThrow('必须相对')
  } finally {
    rmSync(outside, { recursive: true, force: true })
  }
})
