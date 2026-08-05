/**
 * PB-034 会话绑定 IPC nodetest：createLinguistSessionIpc 全通道信封行为
 * （真实服务 + 真实会话索引；stub 不需要——通道无 picker）。
 *
 * 覆盖：createForProject（ok / PROJECT_NOT_FOUND / PROJECT_ARCHIVED /
 * INVALID_INPUT / PB-082 role=reviewer）、listForProject（轻量形状含 role /
 * 排序 / 未知项目空列表 / INVALID_INPUT）、getBinding（null / active /
 * archived / missing / unavailable / INVALID_INPUT）、detachBinding（永久解绑）、
 * 未类型化错误收敛 INTERNAL
 * （不泄露内部文本）。
 *
 * 引导纪律同 session-binding.nodetest.ts：先设 HOME 再动态 import。
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { rmSync } from 'node:fs'
import { join } from 'node:path'
import { LINGUIST_IPC_ERROR_CODES } from '@proma/shared'
import { makeClock, makeEntropy, makeTempDir } from './test/service-testkit'
import { LinguistProjectService } from './project-service'
import { projectPaths } from './paths'

const tempHome = makeTempDir()
process.env.HOME = tempHome

const { createLinguistSessionIpc, toRendererCopyResult } = await import('./session-ipc')
const binding = await import('./session-binding')

const service = new LinguistProjectService({
  rootDir: join(tempHome, '.linguist-agent', 'linguist'),
  entropy: makeEntropy('pb-034-ipc'),
  now: makeClock(),
})
service.init()

const ipc = createLinguistSessionIpc({
  getService: () => service,
  isSessionActive: () => false,
})
const INPUT = { name: 'IPC 绑定项目', sourceLocale: 'en', targetLocale: 'zh-CN' } as const

test('createForProject: happy path returns bound Pi session meta', async () => {
  const project = service.createProject({ ...INPUT })
  const result = await ipc.createForProject({ projectId: project.id })
  assert.ok(result.ok)
  if (!result.ok) return
  assert.equal(result.data.linguistProjectId, project.id)
  assert.equal(result.data.linguistProjectName, 'IPC 绑定项目')
  assert.equal(result.data.agentRuntime, 'pi')
  assert.equal(result.data.title, '新 Agent 会话')

  const titled = await ipc.createForProject({ projectId: project.id, title: '自定义标题' })
  assert.ok(titled.ok)
  if (titled.ok) assert.equal(titled.data.title, '自定义标题')
})

test('copy eligibility/copy: blank session creates an independent target binding', async () => {
  const sourceProject = service.createProject({ ...INPUT, name: 'IPC 复制源' })
  const targetProject = service.createProject({ ...INPUT, name: 'IPC 复制目标' })
  const source = binding.createLinguistProjectChatSession(service, {
    projectId: sourceProject.id,
    title: '复制测试',
  })

  const eligibility = await ipc.getCopyEligibility({ sessionId: source.id })
  assert.deepEqual(eligibility, { ok: true, data: { eligible: true, mode: 'blank' } })

  const copied = await ipc.copyToProject({
    sessionId: source.id,
    targetProjectId: targetProject.id,
  })
  assert.equal(copied.ok, true, JSON.stringify(copied))
  if (copied.ok) {
    assert.notEqual(copied.data.id, source.id)
    assert.equal(copied.data.title, '复制测试（副本）')
    assert.equal(copied.data.linguistProjectId, targetProject.id)
  }

  const invalid = await ipc.copyToProject({ sessionId: source.id, targetProjectId: 'bad' })
  assert.equal(invalid.ok, false)
  if (!invalid.ok) assert.equal(invalid.error.code, LINGUIST_IPC_ERROR_CODES.INVALID_INPUT)
})

test('copy result projection never exposes native ids or absolute paths', () => {
  const projected = toRendererCopyResult({
    id: 'copied',
    title: '副本',
    createdAt: 1,
    updatedAt: 1,
    sdkSessionId: 'native-id',
    piSessionFile: '/private/pi.jsonl',
    piEntryBindings: { assistant: 'entry-id' },
    forkSourceDir: '/private/source',
    forkSourceSdkSessionId: 'source-native-id',
    resumeAtMessageUuid: 'message-id',
    attachedDirectories: ['/private/dir'],
    attachedFiles: ['/private/file'],
  })

  for (const key of [
    'sdkSessionId',
    'piSessionFile',
    'piEntryBindings',
    'forkSourceDir',
    'forkSourceSdkSessionId',
    'resumeAtMessageUuid',
    'attachedDirectories',
    'attachedFiles',
  ]) {
    assert.equal(Object.hasOwn(projected, key), false, key)
  }
})

test('createForProject: unknown / malformed / archived project rejected with stable codes', async () => {
  const unknown = await ipc.createForProject({ projectId: 'prj-0123456789abcdef' })
  assert.equal(unknown.ok, false)
  if (!unknown.ok) assert.equal(unknown.error.code, LINGUIST_IPC_ERROR_CODES.PROJECT_NOT_FOUND)

  for (const bad of [
    { projectId: 'xyz' },
    { projectId: 42 },
    {},
    null,
    'prj-0123456789abcdef',
    { projectId: 'prj-0123456789abcdef', title: '' },
    { projectId: 'prj-0123456789abcdef', title: '   ' },
    { projectId: 'prj-0123456789abcdef', title: 'x'.repeat(121) },
    { projectId: 'prj-0123456789abcdef', title: 7 },
    // PB-082：role 只接受 'reviewer' 字面量
    { projectId: 'prj-0123456789abcdef', role: 'assistant' },
    { projectId: 'prj-0123456789abcdef', role: 'admin' },
    { projectId: 'prj-0123456789abcdef', role: 1 },
  ]) {
    const result = await ipc.createForProject(bad)
    assert.equal(result.ok, false, JSON.stringify(bad))
    if (!result.ok) assert.equal(result.error.code, LINGUIST_IPC_ERROR_CODES.INVALID_INPUT)
  }

  const project = service.createProject({ ...INPUT, name: 'IPC 归档项目' })
  service.archiveProject(project.id)
  const archived = await ipc.createForProject({ projectId: project.id })
  assert.equal(archived.ok, false)
  if (!archived.ok) assert.equal(archived.error.code, LINGUIST_IPC_ERROR_CODES.PROJECT_ARCHIVED)
})

test('listForProject: light wire shape, desc order, unknown project lists empty', async () => {
  const project = service.createProject({ ...INPUT, name: 'IPC 列表项目' })
  const first = binding.createLinguistProjectChatSession(service, { projectId: project.id, title: '一' })
  binding.createLinguistProjectChatSession(service, { projectId: project.id, title: '二' })
  // 把「一」顶到最新
  const { updateAgentSessionMeta } = await import('../agent-session-manager')
  updateAgentSessionMeta(first.id, { title: '一改' })

  const result = await ipc.listForProject({ projectId: project.id })
  assert.ok(result.ok)
  if (!result.ok) return
  assert.equal(result.data.length, 2)
  assert.deepEqual(
    result.data.map((s) => s.title),
    ['一改', '二'],
  )
  for (const entry of result.data) {
    assert.deepEqual(Object.keys(entry).sort(), ['createdAt', 'id', 'role', 'title', 'updatedAt'])
  }

  // PB-082：role 映射——缺省 'assistant'（不落库字面量），评审会话 'reviewer'
  assert.deepEqual(result.data.map((s) => s.role), ['assistant', 'assistant'])

  // 未知（但形状合法）项目：空列表而非错误——绑定存在会话侧，不触项目库
  const empty = await ipc.listForProject({ projectId: 'prj-0000000000000000' })
  assert.ok(empty.ok)
  if (empty.ok) assert.deepEqual(empty.data, [])

  const bad = await ipc.listForProject({ projectId: 'nope' })
  assert.equal(bad.ok, false)
  if (!bad.ok) assert.equal(bad.error.code, LINGUIST_IPC_ERROR_CODES.INVALID_INPUT)
})

test('createForProject with role=reviewer (PB-082): 写入冻结标记，列表映射 reviewer', async () => {
  const project = service.createProject({ ...INPUT, name: 'IPC 评审项目' })
  const created = await ipc.createForProject({
    projectId: project.id,
    title: '评审 prp-abcd1234',
    role: 'reviewer',
  })
  assert.ok(created.ok)
  if (!created.ok) return
  assert.equal(created.data.linguistSessionRole, 'reviewer')
  assert.equal(created.data.title, '评审 prp-abcd1234')

  const listed = await ipc.listForProject({ projectId: project.id })
  assert.ok(listed.ok)
  if (!listed.ok) return
  assert.deepEqual(
    listed.data.map((s) => [s.title, s.role] as const),
    [['评审 prp-abcd1234', 'reviewer']],
  )
})

test('createForProject with role=auditor: 写入盲审标记，列表可区分角色', async () => {
  const project = service.createProject({ ...INPUT, name: 'IPC 盲审项目' })
  const created = await ipc.createForProject({
    projectId: project.id,
    title: '项目独立审计',
    role: 'auditor',
  })
  assert.ok(created.ok)
  if (!created.ok) return
  assert.equal(created.data.linguistSessionRole, 'auditor')

  const listed = await ipc.listForProject({ projectId: project.id })
  assert.ok(listed.ok)
  if (listed.ok) assert.deepEqual(listed.data.map((session) => session.role), ['auditor'])
})

test('getBinding: null for unbound/unknown sessions; active/archived/missing resolved live', async () => {
  // 未绑定会话与未知会话 → binding null（正常分支）
  const { createAgentSession } = await import('../agent-session-manager')
  const unbound = createAgentSession('普通对话')
  const unboundResult = await ipc.getBinding({ sessionId: unbound.id })
  assert.ok(unboundResult.ok)
  if (unboundResult.ok) assert.equal(unboundResult.data.binding, null)

  const unknownResult = await ipc.getBinding({ sessionId: crypto.randomUUID() })
  assert.ok(unknownResult.ok)
  if (unknownResult.ok) assert.equal(unknownResult.data.binding, null)

  // active → archived → missing 全生命周期
  const project = service.createProject({ ...INPUT, name: 'IPC 状态项目' })
  const bound = binding.createLinguistProjectChatSession(service, { projectId: project.id })

  const active = await ipc.getBinding({ sessionId: bound.id })
  assert.ok(active.ok)
  if (active.ok) {
    assert.equal(active.data.binding?.status, 'active')
    assert.equal(active.data.binding?.projectName, 'IPC 状态项目')
    assert.equal(active.data.binding?.project?.id, project.id)
  }

  service.archiveProject(project.id)
  const archived = await ipc.getBinding({ sessionId: bound.id })
  assert.ok(archived.ok)
  if (archived.ok) {
    assert.equal(archived.data.binding?.status, 'archived')
    assert.ok(archived.data.binding?.project?.archivedAt)
  }

  rmSync(projectPaths(join(tempHome, '.linguist-agent', 'linguist'), project.id).projectDir, {
    recursive: true,
    force: true,
  })
  const missing = await ipc.getBinding({ sessionId: bound.id })
  assert.ok(missing.ok)
  if (missing.ok) {
    assert.equal(missing.data.binding?.status, 'missing')
    assert.equal(missing.data.binding?.projectName, 'IPC 状态项目')
    assert.equal(missing.data.binding?.project, undefined)
  }

  for (const bad of [{}, { sessionId: '' }, { sessionId: 1 }, null] as unknown[]) {
    const result = await ipc.getBinding(bad)
    assert.equal(result.ok, false, JSON.stringify(bad))
    if (!result.ok) assert.equal(result.error.code, LINGUIST_IPC_ERROR_CODES.INVALID_INPUT)
  }
})

test('getBinding reports unavailable and detachBinding permanently converts to ordinary Agent', async () => {
  const project = service.createProject({ ...INPUT, name: 'IPC 解绑项目' })
  const bound = binding.createLinguistProjectChatSession(service, {
    projectId: project.id,
    role: 'reviewer',
  })
  const unavailableIpc = createLinguistSessionIpc({
    isSessionActive: () => false,
    getService: () => {
      throw new Error('service unavailable')
    },
  })

  const unavailable = await unavailableIpc.getBinding({ sessionId: bound.id })
  assert.ok(unavailable.ok)
  if (unavailable.ok) {
    assert.equal(unavailable.data.binding?.status, 'unavailable')
    assert.equal(unavailable.data.binding?.projectName, 'IPC 解绑项目')
  }

  const detached = await ipc.detachBinding({ sessionId: bound.id })
  assert.ok(detached.ok)
  if (!detached.ok) return
  assert.equal(detached.data.detached, true)
  assert.equal(detached.data.session?.linguistProjectId, undefined)
  assert.equal(detached.data.session?.linguistProjectName, undefined)
  assert.equal(detached.data.session?.linguistSessionRole, undefined)

  const after = await ipc.getBinding({ sessionId: bound.id })
  assert.ok(after.ok)
  if (after.ok) assert.equal(after.data.binding, null)

  const again = await ipc.detachBinding({ sessionId: bound.id })
  assert.ok(again.ok)
  if (again.ok) assert.equal(again.data.detached, false)

  const unknown = await ipc.detachBinding({ sessionId: crypto.randomUUID() })
  assert.ok(unknown.ok)
  if (unknown.ok) {
    assert.equal(unknown.data.detached, false)
    assert.equal(unknown.data.session, null)
  }

  for (const bad of [{}, { sessionId: '' }, { sessionId: 1 }, null] as unknown[]) {
    const result = await ipc.detachBinding(bad)
    assert.equal(result.ok, false, JSON.stringify(bad))
    if (!result.ok) assert.equal(result.error.code, LINGUIST_IPC_ERROR_CODES.INVALID_INPUT)
  }
})

test('untyped service errors collapse to INTERNAL without leaking internals', async () => {
  const exploding = createLinguistSessionIpc({
    isSessionActive: () => false,
    getService: () => {
      throw new Error('secret internal detail')
    },
  })
  const project = service.createProject({ ...INPUT, name: 'INTERNAL 项目' })
  const result = await exploding.createForProject({ projectId: project.id })
  assert.equal(result.ok, false)
  if (!result.ok) {
    assert.equal(result.error.code, LINGUIST_IPC_ERROR_CODES.INTERNAL)
    assert.equal(result.error.message, 'Unexpected internal error.')
  }
})
