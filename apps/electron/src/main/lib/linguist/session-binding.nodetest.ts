import { test } from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import type { LinguistRole } from '@proma/shared'
import { makeClock, makeEntropy, makeTempDir } from './test/service-testkit'
import { LinguistProjectService } from './project-service'

const tempHome = makeTempDir()
process.env.HOME = tempHome
const binding = await import('./session-binding')
const sessionManager = await import('../agent-session-manager')

let sequence = 0
function setup() {
  const service = new LinguistProjectService({
    rootDir: join(tempHome, '.linguist-agent', 'linguist'),
    entropy: makeEntropy(`binding-${++sequence}`),
    now: makeClock(),
    workspaceAllocator: () => `ws-binding-${sequence}`,
  })
  service.init()
  const project = service.createProject({ name: `绑定项目 ${sequence}`, sourceLocale: 'en', targetLocale: 'zh-CN' })
  return { service, project }
}

test('四种岗位均可创建，缺省岗位是 general，工具能力不写入角色 metadata', () => {
  const { service, project } = setup()
  try {
    const roles: LinguistRole[] = ['general', 'translator', 'reviewer', 'proofreader']
    for (const role of roles) {
      const session = binding.createLinguistProjectChatSession(service, { projectId: project.id, role })
      assert.equal(session.linguistProjectId, project.id)
      assert.equal(session.linguistRole, role)
      assert.equal(session.linguistSessionRole, undefined)
    }
    const defaultSession = binding.createLinguistProjectChatSession(service, { projectId: project.id })
    assert.equal(defaultSession.linguistRole, 'general')
    assert.equal(defaultSession.title, '新 Agent 会话')
  } finally {
    service.closeAll()
  }
})

test('项目绑定冻结，但岗位可在同一会话中切换', () => {
  const { service, project } = setup()
  try {
    const session = binding.createLinguistProjectChatSession(service, { projectId: project.id, role: 'translator' })
    const changed = sessionManager.updateAgentSessionLinguistRole(session.id, 'reviewer')
    assert.equal(changed.linguistProjectId, project.id)
    assert.equal(changed.linguistRole, 'reviewer')
    const unchangedBinding = sessionManager.updateAgentSessionMeta(session.id, {
      workspaceId: 'ordinary-workspace',
    })
    assert.equal(unchangedBinding.linguistProjectId, project.id)
    assert.equal(unchangedBinding.linguistRole, 'reviewer')
  } finally {
    service.closeAll()
  }
})

test('归档或缺失项目只改变 CAT binding status；会话历史仍可解析和解绑', () => {
  const { service, project } = setup()
  try {
    const session = binding.createLinguistProjectChatSession(service, { projectId: project.id })
    service.archiveProject(project.id)
    assert.equal(binding.getLinguistSessionBinding(session, service)?.status, 'archived')
    const detached = sessionManager.detachAgentSessionLinguistBinding(session.id)
    assert.equal(detached?.linguistProjectId, undefined)
    assert.equal(detached?.linguistRole, undefined)
  } finally {
    service.closeAll()
  }
})

test('项目会话列表按 binding 过滤并包含当前岗位', () => {
  const { service, project } = setup()
  try {
    binding.createLinguistProjectChatSession(service, { projectId: project.id, role: 'translator', title: '翻译' })
    binding.createLinguistProjectChatSession(service, { projectId: project.id, role: 'proofreader', title: '校对' })
    const listed = binding.listLinguistProjectChatSessions(project.id)
    assert.equal(listed.length, 2)
    assert.deepEqual(new Set(listed.map((session) => session.linguistRole)), new Set(['translator', 'proofreader']))
  } finally {
    service.closeAll()
  }
})
