import test, { mock } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, renameSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { electronMock } from '../test/electron-mock'

// 独立 Node 测试进程，只隔离 Electron 外壳；Store、会话索引和工具均使用生产实现。
const root = mkdtempSync(join(tmpdir(), 'la-session-availability-'))
process.env.HOME = root
process.env.PROMA_DEV = '1'
Object.defineProperty(process, 'resourcesPath', { value: resolve('resources') })
mock.module('electron', { namedExports: electronMock })
const { initLinguistProjectService } = await import('./project-service')
const { createAgentSession, deleteAgentSession } = await import('../agent-session-manager')
const { resolveLinguistSessionCatTools } = await import('./session-cat-tools')
const { resolveLinguistAgentHostExtension } = await import('./agent-host-extension')
const { resolveLinguistDelegationMetadata } = await import('./delegation-host-extension')
const { validateLinguistTurnContextForAgentTurn } = await import('./turn-context-validator')
const service = initLinguistProjectService({ rootDir: join(root, 'linguist'), workspaceCreator: async () => 'fixture-workspace', workspaceResolver: () => true })

test('有效 Session 在 CAT 缺失、损坏、归档与恢复间保留宿主能力，CAT 每次重新校验', async () => {
  const project = await service.createProject({ name: 'Availability', sourceLocale: 'en', targetLocale: 'zh-CN' })
  const session = createAgentSession('Availability', undefined, undefined, undefined, undefined, undefined, { linguistProjectId: project.id, linguistProjectName: project.name, linguistRole: 'general' })
  const turnContext = { schemaVersion: 1, projectId: project.id, selectedSegmentIds: [], capturedAt: new Date().toISOString(), uiRevision: 1 }
  const paths = service.getProjectPaths(project.id)
  const bytes = readFileSync(paths.catDbPath)
  service.closeProject(project.id)
  renameSync(paths.catDbPath, `${paths.catDbPath}.backup`)
  try {
    // 修复前这里因 eager openProject 直接失败。
    const tools = resolveLinguistSessionCatTools(session, () => service)
    assert.equal(tools.length, 32)
    const list = tools.find(tool => tool.name === 'cat_project_summary')!
    const invoke = () => list.execute('availability', {} as never, undefined, undefined, {} as never)
    const host = resolveLinguistAgentHostExtension({ session, turnContext })
    assert.equal(host.composeTools({ baseTools: [], mcpServerNames: [], modelProvider: 'fixture', getModelId: () => 'fixture' }).overlayToolCount, 32)
    assert.match(host.promptOverlay, /当前无法读取/)
    await assert.rejects(invoke, /missing|unhealthy/)
    assert.equal(existsSync(paths.catDbPath), false, '缺失 DB 不得被重建')
    writeFileSync(paths.catDbPath, 'broken sqlite')
    assert.doesNotThrow(() => resolveLinguistAgentHostExtension({ session, turnContext }))
    await assert.rejects(invoke, /unhealthy|database/)
    assert.throws(() => validateLinguistTurnContextForAgentTurn({ ...turnContext, projectId: 'prj-0000000000000000' }, session, () => service), /binding/)
    renameSync(`${paths.catDbPath}.backup`, paths.catDbPath)
    const restored = await invoke()
    assert.ok(restored.details)
    assert.deepEqual(readFileSync(paths.catDbPath).subarray(0, 16), bytes.subarray(0, 16))
    // 已缓存的 DB 被原子替换时，不能继续从旧 handle 读取。
    renameSync(paths.catDbPath, `${paths.catDbPath}.backup`)
    writeFileSync(paths.catDbPath, 'replacement is corrupt')
    await assert.rejects(invoke, /unhealthy/)
    renameSync(`${paths.catDbPath}.backup`, paths.catDbPath)
    assert.ok((await invoke()).details)
    renameSync(paths.projectJsonPath, `${paths.projectJsonPath}.backup`)
    assert.doesNotThrow(() => resolveLinguistAgentHostExtension({ session, turnContext }))
    await assert.rejects(invoke, /unhealthy/)
    renameSync(`${paths.projectJsonPath}.backup`, paths.projectJsonPath)
    assert.ok((await invoke()).details)
    service.archiveProject(project.id)
    assert.ok((await invoke()).details)
    assert.equal(service.openProject(project.id).readOnly, true)
    assert.throws(() => service.openProject(project.id).segments.applyTargetEdit('missing', 'x', 0), /read-only/)
    const metadata = resolveLinguistDelegationMetadata(session, {})!
    assert.equal(metadata.role, 'general')
    assert.equal(metadata.scope, undefined, '通用研究委派不冻结空 CAT 范围')
    assert.throws(() => resolveLinguistDelegationMetadata(session, { linguistRole: 'reviewer' }), /没有 Segment/)
    deleteAgentSession(session.id)
    await assert.rejects(invoke, /no longer bound/)
  } finally { service.closeAll() }
})
