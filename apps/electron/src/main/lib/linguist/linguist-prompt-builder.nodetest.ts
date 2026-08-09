import assert from 'node:assert/strict'
import { dirname, join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import type { LinguistRole } from '@proma/shared'
import { makeClock, makeEntropy, makeTempDir } from './test/service-testkit'
import { LinguistProjectService } from './project-service'
import {
  buildLinguistProjectPrompt,
  buildLinguistPrompt,
  enforceTotalCharLimit,
  LINGUIST_PROMPT_MAX_CHARS,
} from './linguist-prompt-builder'

const root = makeTempDir()
const rolesRoot = join(
  dirname(fileURLToPath(import.meta.url)),
  '..', '..', '..', '..', '..', '..',
  'resources', 'linguist-roles',
)
const roles: LinguistRole[] = ['general', 'translator', 'reviewer', 'proofreader']

function setup() {
  const service = new LinguistProjectService({
    rootDir: join(root, `linguist-${Date.now()}`),
    entropy: makeEntropy(`prompt-${Date.now()}`),
    now: makeClock(),
    workspaceAllocator: () => `ws-${Date.now()}`,
  })
  service.init()
  const project = service.createProject({ name: 'Prompt Test', sourceLocale: 'en', targetLocale: 'zh-CN' })
  return { service, project }
}

test('四岗位使用同一简化 builder，缺文件回退且普通会话不注入', () => {
  const { service, project } = setup()
  try {
    assert.equal(buildLinguistProjectPrompt(undefined, () => service), '')
    for (const role of roles) {
      const built = buildLinguistPrompt(
        { linguistProjectId: project.id, linguistRole: role },
        () => service,
        { rolesRoot },
      )
      assert.equal(built.status.role, role)
      assert.equal(built.status.roleSource, 'bundle')
      assert.equal(built.status.projectDigestIncluded, true)
      assert.match(built.prompt, /cat_apply_translations/)
      assert.doesNotMatch(built.prompt, /linguist_prompt_manifest|fallback_layers|prompt_contract_hash/)
    }
    const fallback = buildLinguistPrompt(
      { linguistProjectId: project.id, linguistRole: 'proofreader' },
      () => service,
      { rolesRoot: join(rolesRoot, 'missing') },
    )
    assert.equal(fallback.status.roleSource, 'fallback')
    assert.match(fallback.prompt, /目标语校对与润色/)
  } finally {
    service.closeAll()
  }
})

test('XML 与 Markdown 只使用轻量外壳，总字符上限只裁 Project Digest', () => {
  const fixed = { role: 'translator' as const, rolePrompt: '完整岗位职责', digest: '资料'.repeat(20_000) }
  const xml = enforceTotalCharLimit(fixed, 'xml')
  const markdown = enforceTotalCharLimit(fixed, 'markdown')
  assert.ok(xml.length <= LINGUIST_PROMPT_MAX_CHARS)
  assert.ok(markdown.length <= LINGUIST_PROMPT_MAX_CHARS)
  assert.match(xml, /<linguist_prompt/)
  assert.match(markdown, /# Linguist Agent/)
  assert.match(xml, /完整岗位职责/)
  assert.match(markdown, /完整岗位职责/)
})

test('Project Digest 单段读取失败只跳过该段', () => {
  const { service, project } = setup()
  try {
    const db = service.openProject(project.id)
    db.voiceProfiles.upsert({ speaker: 'Hero', register: 'formal' })
    db.styleGuideRules.list = () => { throw new Error('fixture failure') }
    const built = buildLinguistPrompt(
      { linguistProjectId: project.id, linguistRole: 'translator' },
      () => service,
      { rolesRoot, renderer: 'markdown' },
    )
    assert.equal(built.status.projectDigestIncluded, true)
    assert.match(built.prompt, /Voice Profiles/)
    assert.doesNotMatch(built.prompt, /fixture failure/)
  } finally {
    service.closeAll()
  }
})
