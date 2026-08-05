/**
 * PB-034 会话绑定 nodetest（node --test；真实服务 + 真实会话索引，无 mock）：
 *
 * - 绑定写入：项目内创建对话 → AgentSessionMeta 携带 linguistProjectId +
 *   项目名快照（Pi runtime），落盘 ~/.linguist-agent/agent-sessions.json；普通对话不携带；
 * - 冻结：updateAgentSessionMeta 无法改写绑定（含 any 断言绕过），
 *   「切换选中项目」（创建/操作其他项目）不影响已存在会话；
 * - 绑定异常阻断发送（主进程级）：checkLinguistSessionSendBlock ——
 *   orchestrator preflight 调用的同一函数；archived/missing/unavailable →
 *   TypedError，只有 active/未绑定放行；
 * - 项目缺失：目录被删 → status 'missing'（快照保留、project 缺省），会话不崩；
 * - 永久解绑：唯一专用 API 清除冻结绑定和 reviewer 角色，之后作为普通 Agent；
 * - list-for-project：按项目过滤 + updatedAt 降序；
 * - 重启恢复：同一 root 重建服务（closeAll → 新实例 init）后绑定仍在、
 *   归档/缺失状态重新求值。
 *
 * 引导纪律：agent-session-manager 在模块加载时经 config-paths 解析
 * ~/.linguist-agent（os.homedir() 每次动态读 HOME），因此必须先设 HOME 再动态
 * import——本文件顶层 await 顺序即为此安排（静态 import 会被提升）。
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import type { AgentSessionMeta } from '@proma/shared'
import { makeClock, makeEntropy, makeTempDir } from './test/service-testkit'
import { LinguistProjectService } from './project-service'
import { projectPaths } from './paths'

// —— 先建 tmp HOME，再动态 import 触达 config-paths 的模块 ——
const tempHome = makeTempDir()
process.env.HOME = tempHome

const binding = await import('./session-binding')
const executionScope = await import('./agent-execution-scope')
const sessionManager = await import('../agent-session-manager')

const LINGUIST_ROOT = join(tempHome, '.linguist-agent', 'linguist')

/** 每个服务实例独立熵源种子：同一 root 上项目 id 不得跨测试复用（STORE_PROJECT_EXISTS）。 */
let serviceSeq = 0

function makeServiceOnLinguistRoot(): LinguistProjectService {
  let workspaceSeq = 0
  const service = new LinguistProjectService({
    rootDir: LINGUIST_ROOT,
    entropy: makeEntropy(`pb-034-${++serviceSeq}`),
    now: makeClock(),
    workspaceAllocator: () => `ws-pb034-${serviceSeq}-${++workspaceSeq}`,
  })
  service.init()
  return service
}

const PROJECT_INPUT = { name: '绑定项目', sourceLocale: 'en', targetLocale: 'zh-CN' } as const

test('binding write: project chat carries frozen binding + name snapshot; normal chat does not', () => {
  const service = makeServiceOnLinguistRoot()
  const project = service.createProject({ ...PROJECT_INPUT })
  service.setQualityProfile(project.id, 'best')

  const meta = binding.createLinguistProjectChatSession(service, { projectId: project.id })
  assert.equal(meta.linguistProjectId, project.id)
  assert.equal(meta.linguistProjectName, '绑定项目')
  assert.equal(meta.linguistStrategy, 'best')
  assert.equal(meta.agentRuntime, 'pi')
  // 缺省标题保留 Proma 默认值，首轮消息完成后由统一 title pipeline 命名。
  assert.equal(meta.title, '新 Agent 会话')

  // 显式标题优先
  const titled = binding.createLinguistProjectChatSession(service, { projectId: project.id, title: '  术语讨论  ' })
  assert.equal(titled.title, '术语讨论')

  // 普通对话（侧栏新建路径）：绝不携带绑定字段
  const normal = sessionManager.createAgentSession('普通对话', undefined, undefined, undefined, 'pi')
  assert.equal(normal.linguistProjectId, undefined)
  assert.equal(normal.linguistProjectName, undefined)

  // 绑定已持久化到磁盘索引（重启存活的载体）
  const onDisk = JSON.parse(
    readFileSync(join(tempHome, '.linguist-agent', 'agent-sessions.json'), 'utf-8'),
  ) as { sessions: AgentSessionMeta[] }
  const persisted = onDisk.sessions.find((s) => s.id === meta.id)
  assert.equal(persisted?.linguistProjectId, project.id)
  assert.equal(persisted?.linguistProjectName, '绑定项目')
  assert.equal(persisted?.linguistStrategy, 'best')
  const persistedNormal = onDisk.sessions.find((s) => s.id === normal.id)
  assert.equal(persistedNormal && 'linguistProjectId' in persistedNormal, false)
  assert.equal(persistedNormal?.linguistStrategy, undefined)

  service.closeAll()
})

test('binding freeze: no metadata update can rewrite the binding; other projects do not affect it', () => {
  const service = makeServiceOnLinguistRoot()
  const projectA = service.createProject({ ...PROJECT_INPUT, name: '项目甲' })
  // 「切换选中项目」的真实效果只是操作另一个项目——不得影响已绑定会话
  const projectB = service.createProject({ ...PROJECT_INPUT, name: '项目乙' })

  const meta = binding.createLinguistProjectChatSession(service, { projectId: projectA.id })

  // 常规元数据更新（改标题）不影响绑定
  sessionManager.updateAgentSessionMeta(meta.id, { title: '新标题' })
  let current = sessionManager.getAgentSessionMeta(meta.id)
  assert.equal(current?.linguistProjectId, projectA.id)
  assert.equal(current?.linguistProjectName, '项目甲')

  // any 断言绕过类型白名单也无效（运行时强制保持原值）
  const malicious = { linguistProjectId: projectB.id, linguistProjectName: '项目乙' } as unknown as Parameters<
    typeof sessionManager.updateAgentSessionMeta
  >[1]
  sessionManager.updateAgentSessionMeta(meta.id, malicious)
  current = sessionManager.getAgentSessionMeta(meta.id)
  assert.equal(current?.linguistProjectId, projectA.id)
  assert.equal(current?.linguistProjectName, '项目甲')

  // 对项目乙的操作（归档）不改变会话绑定
  service.archiveProject(projectB.id)
  current = sessionManager.getAgentSessionMeta(meta.id)
  assert.equal(current?.linguistProjectId, projectA.id)

  service.closeAll()
})

test('execution scope: Linguist session uses project cwd and delete moves it to managed Trash', () => {
  const service = makeServiceOnLinguistRoot()
  const project = service.createProject({ ...PROJECT_INPUT, name: '工作目录项目' })
  const meta = binding.createLinguistProjectChatSession(service, { projectId: project.id })

  const scope = executionScope.resolveAgentExecutionScope(meta)
  assert.equal(scope.kind, 'linguist-project')
  assert.equal(
    scope.cwd,
    join(LINGUIST_ROOT, 'agent-workspaces', project.id, meta.id),
  )
  assert.equal(existsSync(join(scope.cwd, 'SESSION_MANIFEST.json')), true)

  sessionManager.deleteAgentSession(meta.id)
  assert.equal(existsSync(scope.cwd), false)
  const trashDir = join(LINGUIST_ROOT, 'trash', 'agent-workspaces', project.id)
  assert.equal(
    readdirSync(trashDir).some((name) => name.startsWith(`${meta.id}-`)),
    true,
  )
  service.closeAll()
})

test('explicit detach is the only path that permanently clears a frozen binding', () => {
  const service = makeServiceOnLinguistRoot()
  const project = service.createProject({ ...PROJECT_INPUT, name: '待解绑项目' })
  const meta = binding.createLinguistProjectChatSession(service, {
    projectId: project.id,
    role: 'reviewer',
  })

  const detached = sessionManager.detachAgentSessionLinguistBinding(meta.id)
  assert.equal(detached?.linguistProjectId, undefined)
  assert.equal(detached?.linguistProjectName, undefined)
  assert.equal(detached?.linguistSessionRole, undefined)
  assert.equal(sessionManager.getAgentSessionMeta(meta.id)?.linguistProjectId, undefined)
  assert.equal(binding.getLinguistSessionBinding(detached, service), null)
  assert.equal(binding.checkLinguistSessionSendBlock(detached, () => service), null)

  // 幂等：普通/未知会话不会被伪造为新绑定。
  assert.equal(sessionManager.detachAgentSessionLinguistBinding(meta.id)?.linguistProjectId, undefined)
  assert.equal(sessionManager.detachAgentSessionLinguistBinding(crypto.randomUUID()), null)

  service.closeAll()
})

test('reviewer role (PB-082): 创建时写入冻结 linguistSessionRole 标记；缺省会话不写库', () => {
  const service = makeServiceOnLinguistRoot()
  const project = service.createProject({ ...PROJECT_INPUT, name: '评审角色项目' })

  // 缺省（普通助理会话）：不写 linguistSessionRole 字段
  const assistant = binding.createLinguistProjectChatSession(service, { projectId: project.id })
  assert.equal(assistant.linguistSessionRole, undefined)
  assert.equal('linguistSessionRole' in assistant, false)

  // role='reviewer'：写入标记并随绑定冻结
  const reviewer = binding.createLinguistProjectChatSession(service, {
    projectId: project.id,
    title: '评审 prp-123',
    role: 'reviewer',
  })
  assert.equal(reviewer.linguistSessionRole, 'reviewer')
  assert.equal(reviewer.linguistProjectId, project.id)
  assert.equal(reviewer.title, '评审 prp-123')

  // 落盘持久化（重启存活的载体）
  const onDisk = JSON.parse(
    readFileSync(join(tempHome, '.linguist-agent', 'agent-sessions.json'), 'utf-8'),
  ) as { sessions: AgentSessionMeta[] }
  assert.equal(onDisk.sessions.find((s) => s.id === reviewer.id)?.linguistSessionRole, 'reviewer')
  const persistedAssistant = onDisk.sessions.find((s) => s.id === assistant.id)
  assert.equal(persistedAssistant && 'linguistSessionRole' in persistedAssistant, false)

  // 冻结：常规更新与 any 断言绕过都无法改写角色标记
  sessionManager.updateAgentSessionMeta(reviewer.id, { title: '改标题' })
  assert.equal(sessionManager.getAgentSessionMeta(reviewer.id)?.linguistSessionRole, 'reviewer')
  const malicious = { linguistSessionRole: undefined } as unknown as Parameters<
    typeof sessionManager.updateAgentSessionMeta
  >[1]
  sessionManager.updateAgentSessionMeta(reviewer.id, malicious)
  assert.equal(sessionManager.getAgentSessionMeta(reviewer.id)?.linguistSessionRole, 'reviewer')

  const auditor = binding.createLinguistProjectChatSession(service, {
    projectId: project.id,
    title: '项目独立审计',
    role: 'auditor',
  })
  assert.equal(auditor.linguistSessionRole, 'auditor')
  sessionManager.updateAgentSessionMeta(auditor.id, { title: '盲审改标题' })
  assert.equal(sessionManager.getAgentSessionMeta(auditor.id)?.linguistSessionRole, 'auditor')

  service.closeAll()
})

test('archived project blocks send at main level (the same gate the orchestrator calls)', () => {
  const service = makeServiceOnLinguistRoot()
  const project = service.createProject({ ...PROJECT_INPUT })
  const meta = binding.createLinguistProjectChatSession(service, { projectId: project.id })
  const getService = () => service

  // 归档前放行
  assert.equal(binding.checkLinguistSessionSendBlock(meta, getService), null)
  // 未绑定会话永远放行
  assert.equal(binding.checkLinguistSessionSendBlock(undefined, getService), null)
  assert.equal(
    binding.checkLinguistSessionSendBlock(sessionManager.createAgentSession('普通'), getService),
    null,
  )

  service.archiveProject(project.id)

  // 归档后：主进程闸门返回 TypedError（orchestrator 以 preflight error 终止本轮）
  const block = binding.checkLinguistSessionSendBlock(meta, getService)
  assert.ok(block)
  assert.equal(block.code, 'linguist_project_archived')
  assert.equal(block.canRetry, false)
  assert.ok(block.message.includes('「绑定项目」'))
  assert.ok(block.message.includes('只读'))

  // getBinding 同步反映 archived（徽章/通告数据源）
  const info = binding.getLinguistSessionBinding(meta, service)
  assert.equal(info?.status, 'archived')
  assert.equal(info?.projectId, project.id)
  assert.equal(info?.projectName, '绑定项目')
  assert.equal(info?.project?.archivedAt !== undefined, true)

  service.closeAll()
})

test('missing project keeps history readable but blocks send until explicit detach', () => {
  const service = makeServiceOnLinguistRoot()
  const project = service.createProject({ ...PROJECT_INPUT, name: '将消失的项目' })
  const meta = binding.createLinguistProjectChatSession(service, { projectId: project.id })

  // 外部删除整个项目目录（用户手动删盘场景）
  rmSync(projectPaths(LINGUIST_ROOT, project.id).projectDir, { recursive: true, force: true })

  // 降级为 missing：快照项目名保留，project 元数据缺省
  const info = binding.getLinguistSessionBinding(meta, service)
  assert.equal(info?.status, 'missing')
  assert.equal(info?.projectName, '将消失的项目')
  assert.equal(info?.project, undefined)

  // 不崩全 App：会话索引与历史仍可读；发送必须 fail closed，不能静默退化。
  assert.equal(sessionManager.getAgentSessionMeta(meta.id)?.linguistProjectId, project.id)
  const block = binding.checkLinguistSessionSendBlock(meta, () => service)
  assert.equal(block?.code, 'linguist_project_missing')
  assert.equal(block?.canRetry, false)
  assert.ok(block?.message.includes('解除项目绑定'))
  assert.ok(sessionManager.listAgentSessions().length > 0)

  // 项目对话列表仍可用（绑定存在会话侧）
  assert.equal(binding.listLinguistProjectChatSessions(project.id).length, 1)

  service.closeAll()
})

test('project service resolution failure blocks send instead of silently becoming ordinary Agent', () => {
  const service = makeServiceOnLinguistRoot()
  const project = service.createProject({ ...PROJECT_INPUT, name: '服务异常项目' })
  const meta = binding.createLinguistProjectChatSession(service, { projectId: project.id })

  const block = binding.checkLinguistSessionSendBlock(meta, () => {
    throw new Error('service unavailable')
  })
  assert.equal(block?.code, 'linguist_project_unavailable')
  assert.equal(block?.canRetry, true)
  assert.ok(block?.message.includes('不会按普通 Agent 发送'))

  service.closeAll()
})

test('list-for-project filters by binding and sorts by updatedAt desc', () => {
  const service = makeServiceOnLinguistRoot()
  const projectA = service.createProject({ ...PROJECT_INPUT, name: '列表项目甲' })
  const projectB = service.createProject({ ...PROJECT_INPUT, name: '列表项目乙' })

  const a1 = binding.createLinguistProjectChatSession(service, { projectId: projectA.id, title: '甲-1' })
  const a2 = binding.createLinguistProjectChatSession(service, { projectId: projectA.id, title: '甲-2' })
  binding.createLinguistProjectChatSession(service, { projectId: projectB.id, title: '乙-1' })
  sessionManager.createAgentSession('普通对话')

  // 默认按创建序（a2 最新）；把 a1 的 updatedAt 顶到最新后验证降序重排
  sessionManager.updateAgentSessionMeta(a1.id, { title: '甲-1改' })
  const listed = binding.listLinguistProjectChatSessions(projectA.id)
  assert.deepEqual(
    listed.map((s) => s.id),
    [a1.id, a2.id],
  )
  assert.ok(listed[0]!.updatedAt >= listed[1]!.updatedAt)

  // 项目乙 / 无绑定项目互不影响
  assert.equal(binding.listLinguistProjectChatSessions(projectB.id).length, 1)
  assert.equal(binding.listLinguistProjectChatSessions('prj-0000000000000000').length, 0)

  service.closeAll()
})

test('resume after restart: bindings survive and states re-evaluate on a fresh service over the same root', () => {
  // 第一「进程」：创建项目 + 绑定会话
  const service1 = makeServiceOnLinguistRoot()
  const project = service1.createProject({ ...PROJECT_INPUT, name: '重启项目' })
  const meta = binding.createLinguistProjectChatSession(service1, { projectId: project.id })
  assert.equal(binding.getLinguistSessionBinding(meta, service1)?.status, 'active')
  service1.closeAll() // 退出时关闭全部句柄（index.ts before-quit 同一动作）

  // 第二「进程」：同一 linguist root + 同一 HOME（~/.linguist-agent/agent-sessions.json 未动）
  const service2 = makeServiceOnLinguistRoot()
  const afterRestart = sessionManager.getAgentSessionMeta(meta.id)
  assert.equal(afterRestart?.linguistProjectId, project.id)
  assert.equal(afterRestart?.linguistProjectName, '重启项目')
  assert.equal(binding.getLinguistSessionBinding(afterRestart, service2)?.status, 'active')

  // 重启后的状态变化（归档）在新一次解析中立即反映
  service2.archiveProject(project.id)
  assert.equal(binding.getLinguistSessionBinding(afterRestart, service2)?.status, 'archived')
  assert.ok(binding.checkLinguistSessionSendBlock(afterRestart, () => service2))

  // 重启后目录被删 → missing
  service2.closeAll()
  rmSync(projectPaths(LINGUIST_ROOT, project.id).projectDir, { recursive: true, force: true })
  const service3 = makeServiceOnLinguistRoot()
  assert.equal(binding.getLinguistSessionBinding(afterRestart, service3)?.status, 'missing')
  service3.closeAll()
})
