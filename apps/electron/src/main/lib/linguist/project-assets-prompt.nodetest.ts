import { test } from 'node:test'
import assert from 'node:assert/strict'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { LinguistRole } from '@proma/shared'
import { makeClock, makeEntropy, makeTempDir } from './test/service-testkit'
import { LinguistProjectService } from './project-service'

const tempHome = makeTempDir()
process.env.HOME = tempHome
const binding = await import('./session-binding')
const assets = await import('./project-assets-prompt')
const ROLES_ROOT = join(
  dirname(fileURLToPath(import.meta.url)),
  '..', '..', '..', '..', '..', '..',
  'resources', 'linguist-roles',
)
const ROLES: LinguistRole[] = ['general', 'translator', 'reviewer', 'proofreader']

function setup() {
  const service = new LinguistProjectService({
    rootDir: join(tempHome, '.linguist-agent', 'linguist'),
    entropy: makeEntropy(`simple-prompt-${Date.now()}`),
    now: makeClock(),
    workspaceAllocator: () => `ws-${Date.now()}`,
  })
  service.init()
  const project = service.createProject({ name: `Prompt ${Date.now()}`, sourceLocale: 'en', targetLocale: 'zh-CN' })
  return { service, project }
}

test('普通会话不注入 Linguist Prompt', () => {
  const { service } = setup()
  try {
    assert.equal(assets.buildLinguistProjectAssetsPrompt(undefined, () => service), '')
  } finally {
    service.closeAll()
  }
})

test('四角色共享同一合同与项目摘要，只替换角色 Prompt', () => {
  const { service, project } = setup()
  try {
    for (const role of ROLES) {
      const session = binding.createLinguistProjectChatSession(service, { projectId: project.id, role })
      const built = assets.buildLinguistProjectAssetsPromptWithStatus(
        { linguistProjectId: project.id, linguistRole: session.linguistRole },
        () => service,
        { rolesRoot: ROLES_ROOT },
      )
      assert.equal(built.status.role, role)
      assert.deepEqual(built.status.fallbackLayers, [])
      assert.match(built.prompt, /继承当前 Proma Agent 的全部工具与能力/)
      assert.match(built.prompt, new RegExp(`role="${role}"`))
      assert.doesNotMatch(built.prompt, /execution_policy|independent_review|Proposal Snapshot/)
    }
  } finally {
    service.closeAll()
  }
})

test('角色 Markdown 缺失时标记 fallback 但仍生成可工作的 Prompt', () => {
  const { service, project } = setup()
  try {
    const built = assets.buildLinguistProjectAssetsPromptWithStatus(
      { linguistProjectId: project.id, linguistRole: 'proofreader' },
      () => service,
      { rolesRoot: join(ROLES_ROOT, 'missing') },
    )
    assert.deepEqual(built.status.fallbackLayers, ['role'])
    assert.match(built.prompt, /目标语校对与润色/)
  } finally {
    service.closeAll()
  }
})

test('通用专业合同保持简洁', () => {
  assert.ok(assets.LINGUIST_QUALITY_CONTRACT_PROMPT.length <= 1500)
})
