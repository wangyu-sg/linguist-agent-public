import { expect, test } from 'bun:test'
import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

const REPO_ROOT = dirname(import.meta.dir)
const ROLES_ROOT = join(REPO_ROOT, 'resources', 'linguist-roles')
const ROLES = ['general', 'translator', 'reviewer', 'proofreader'] as const

test('四个岗位各有且只有一份 Markdown 真源', () => {
  for (const role of ROLES) {
    const path = join(ROLES_ROOT, `${role}.md`)
    expect(existsSync(path), `岗位 Prompt 不存在: ${role}`).toBe(true)
    const content = readFileSync(path, 'utf8')
    expect(content.startsWith('# ')).toBe(true)
    expect(content.length).toBeGreaterThan(80)
    expect(content.includes(homedir())).toBe(false)
    expect(/\b[A-Za-z]:[\\/]/.test(content)).toBe(false)
  }
})

test('岗位真源表达真实职业，不恢复旧 Critic / Auditor 流程', () => {
  const translator = readFileSync(join(ROLES_ROOT, 'translator.md'), 'utf8')
  const reviewer = readFileSync(join(ROLES_ROOT, 'reviewer.md'), 'utf8')
  const proofreader = readFileSync(join(ROLES_ROOT, 'proofreader.md'), 'utf8')

  expect(translator).toContain('正式译文')
  expect(translator).not.toContain('初稿生成')
  expect(translator).toContain('不要把结果称为')
  expect(reviewer).toContain('全部 Source 与当前 Target')
  expect(reviewer).not.toMatch(/candidateProposalId|Proposal Snapshot|pass \/ issues \/ abstain/)
  expect(proofreader).toContain('目标语校对')
})
