import { test } from 'node:test'
import assert from 'node:assert/strict'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { LinguistRole } from '@proma/shared'
import { makeClock, makeEntropy, makeTempDir } from './test/service-testkit'
import { LinguistProjectService } from './project-service'
import {
  buildLinguistPromptContract,
  computeLinguistPromptContractHash,
} from './prompt-contract'
import { renderLinguistPrompt } from './prompt-renderer'

const root = makeTempDir()
const rolesRoot = join(
  dirname(fileURLToPath(import.meta.url)),
  '..', '..', '..', '..', '..', '..',
  'resources', 'linguist-roles',
)
const roles: LinguistRole[] = ['general', 'translator', 'reviewer', 'proofreader']

function setup() {
  const service = new LinguistProjectService({
    rootDir: join(root, 'linguist'),
    entropy: makeEntropy(`contract-${Date.now()}`),
    now: makeClock(),
    workspaceAllocator: () => `ws-${Date.now()}`,
  })
  service.init()
  const project = service.createProject({ name: `Contract ${Date.now()}`, sourceLocale: 'en', targetLocale: 'zh-CN' })
  return { service, project }
}

test('四角色的 canonical contract 可由 XML 与 Markdown renderer 等价表达', () => {
  const { service, project } = setup()
  try {
    for (const role of roles) {
      const built = buildLinguistPromptContract(
        { linguistProjectId: project.id, linguistRole: role },
        () => service,
        { rolesRoot },
      )
      assert.deepEqual(built.contract.layers.map((layer) => layer.kind), [
        'linguist_prompt_manifest',
        'linguist_prompt_status',
        'linguist_profile',
        'professional_quality_contract',
        'role_prompt',
        'project_digest',
      ])
      assert.equal(built.status.role, role)
      assert.equal(built.status.promptContractHash, computeLinguistPromptContractHash(built.contract))
      assert.ok(renderLinguistPrompt(built.contract, 'xml').length > 0)
      assert.ok(renderLinguistPrompt(built.contract, 'markdown').length > 0)
    }
  } finally {
    service.closeAll()
  }
})
