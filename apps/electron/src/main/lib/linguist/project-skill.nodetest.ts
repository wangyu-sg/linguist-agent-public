import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { LinguistRole } from '@proma/shared'
import {
  LINGUIST_ROLE_PROMPT_VERSION,
  resolveLinguistRolePrompt,
} from './project-skill'

const ROLES_ROOT = join(
  dirname(fileURLToPath(import.meta.url)),
  '..', '..', '..', '..', '..', '..',
  'resources', 'linguist-roles',
)
const ROLES: LinguistRole[] = ['general', 'translator', 'reviewer', 'proofreader']

test('四种岗位各有且只有一个 Markdown Prompt 真源', () => {
  assert.equal(LINGUIST_ROLE_PROMPT_VERSION, '1.0.0')
  for (const role of ROLES) {
    assert.equal(existsSync(join(ROLES_ROOT, `${role}.md`)), true)
    const resolved = resolveLinguistRolePrompt({ linguistRole: role }, ROLES_ROOT)
    assert.equal(resolved.role, role)
    assert.equal(resolved.roleLayer.source, 'bundle')
    assert.ok(resolved.roleLayer.content.length > 20)
    assert.deepEqual(resolved.fallbackLayers, [])
  }
})

test('角色资源缺失或默认岗位未指定时使用简短 fallback 并继续', () => {
  const missing = resolveLinguistRolePrompt({ linguistRole: 'reviewer' }, join(ROLES_ROOT, 'missing'))
  assert.equal(missing.roleLayer.source, 'fallback')
  assert.deepEqual(missing.fallbackLayers, ['role'])
  assert.match(missing.roleLayer.content, /全部 Source 与当前 Target/)

  const defaultRole = resolveLinguistRolePrompt({}, undefined)
  assert.equal(defaultRole.role, 'general')
  assert.equal(defaultRole.roleLayer.source, 'fallback')
})

test('Reviewer 与 Translator Prompt 不含旧候选门禁或低质量草稿定位', () => {
  const reviewer = resolveLinguistRolePrompt({ linguistRole: 'reviewer' }, ROLES_ROOT).roleLayer.content
  const translator = resolveLinguistRolePrompt({ linguistRole: 'translator' }, ROLES_ROOT).roleLayer.content
  assert.doesNotMatch(reviewer, /Proposal Snapshot|candidateProposalId|abstain/)
  assert.doesNotMatch(translator, /初稿生成/)
  assert.match(translator, /不要把结果称为/)
})
