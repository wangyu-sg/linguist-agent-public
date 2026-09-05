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

test('旧格式项目副本与原 Pi Session：备份、恢复、新轮写回、verified 导出和重导', async () => {
  const { SessionManager } = await import('@earendil-works/pi-coding-agent')
  const { normalizeLegacyCatSessionFile } = await import('./legacy-cat-session')
  const { ensureStageEvidenceForSession } = await import('./stage-evidence-host')
  const { createEvidenceSubmissionObserver } = await import('./evidence-submission')
  const { createLinguistCatTools } = await import('@linguist/cat-tools')
  const project = await service.createProject({ name: 'Legacy copy', sourceLocale: 'en', targetLocale: 'zh-CN' })
  const session = createAgentSession('Legacy copy', undefined, undefined, undefined, undefined, undefined, { linguistProjectId: project.id, linguistProjectName: project.name, linguistRole: 'reviewer' })
  const source = Buffer.from('<xliff version="1.2"><file source-language="en" target-language="zh-CN" datatype="plaintext" original="old"><body><trans-unit id="old-1"><source>Hello {name}</source><target>你好 {name}</target></trans-unit></body></file></xliff>')
  const imported = await service.importAsset(project.id, { filename: 'old.xlf', bytes: source })
  let db = service.openProject(project.id)
  const segment = db.segments.query({ assetId: imported.assetId })[0]!
  const doc = db.contextDocs.insert({ kind: 'doc', originalFilename: 'old.txt', blobRelpath: 'blobs/old.txt', textExtract: '历史参考正文' })
  writeFileSync(join(db.blobsDir, 'old.txt'), '历史参考正文')
  db.contextDocs.setEvidenceLink({ contextDocId: doc.id, relation: { kind: 'segment', segmentId: segment.id }, requiredness: 'required', mappingRevision: 'old' })
  const discoveryScope = { roots: [], files: [], unavailable: [], hash: 'old-copy', managedEvidence: [{ ref: { kind: 'asset' as const, id: imported.assetId }, version: imported.sourceSha256 }, { ref: { kind: 'context-doc' as const, id: doc.id }, version: doc.id }] }
  const old = ensureStageEvidenceForSession({ session, db, discoveryScope, fallbackSegmentIds: [segment.id] })!
  db.segments.recordCurrentStageDecision(segment.id, 'editing', 0, 'unchanged', { actor: session.id })
  db.stageEvidence.recordReceipt({ stageRunId: old.stageRunId, sessionId: session.id, baselineHash: old.baseline.baselineHash, generationRunId: 'old', segmentIds: [segment.id], evidence: [{ ref: { kind: 'asset', id: imported.assetId }, anchorIds: [] }] })
  // 合成审查起点的持久化形状：旧 Plan 无决定边界，旧 Receipt 无 Provider 提交标记。
  const oldPlan = { ...old.plan }
  delete oldPlan.decisionEventBoundary
  delete oldPlan.ruleSetSnapshot
  db.catDb.db.prepare('UPDATE stage_evidence_states SET plan_json = ? WHERE stage_run_id = ?').run(JSON.stringify(oldPlan), old.stageRunId)
  const file = join(root, 'old-pi-session.jsonl')
  const originalSession = [
    { type: 'session', version: 3, id: session.id, timestamp: new Date(0).toISOString(), cwd: root },
    { type: 'message', id: 'old-entry', parentId: null, timestamp: new Date(1).toISOString(), message: { role: 'toolResult', toolName: 'cat_read_context_doc', toolCallId: 'old', isError: false, timestamp: 1, content: [{ type: 'text', text: 'CAT tool result. Structured data is available in details.' }], details: { docId: doc.id, text: '历史参考正文' } } },
  ].map(row => JSON.stringify(row)).join('\n') + '\n'
  writeFileSync(file, originalSession)
  const backup = service.backupProject(project.id)
  service.closeProject(project.id)
  try {
    db = service.openProject(project.id)
    assert.equal(db.segments.getById(segment.id)?.target, '你好 {name}')
    assert.equal(db.contextDocs.get(doc.id)?.textExtract, '历史参考正文')
    assert.equal(db.stageEvidence.getCompletion(old.stageRunId).decisions.pending, 1)
    assert.equal(db.stageEvidence.getPresentationCoverage(old.stageRunId).presented, 0)
    assert.equal(db.stageEvidence.listReceipts(old.stageRunId).length, 1, '旧回执保留，不提升资格')
    await normalizeLegacyCatSessionFile(file)
    const resumed = SessionManager.open(file, root, root)
    assert.equal(resumed.getSessionId(), session.id)
    assert.equal(resumed.getLeafId(), 'old-entry')
    assert.ok(JSON.stringify(resumed.buildSessionContext().messages).includes('历史参考正文'))
    assert.equal(readFileSync(`${file}.before-cat-content-v1`, 'utf8'), originalSession)
    const migrated = readFileSync(file, 'utf8')
    await normalizeLegacyCatSessionFile(file)
    assert.equal(readFileSync(file, 'utf8'), migrated)
    const state = ensureStageEvidenceForSession({ session, db, discoveryScope, fallbackSegmentIds: [segment.id], restart: true, toolCallId: 'new-round' })!
    assert.notEqual(state.stageRunId, old.stageRunId)
    const observer = createEvidenceSubmissionObserver(receipt => { db.stageEvidence.recordReceipt(receipt) }, error => { throw error })
    const tools = createLinguistCatTools({ resolveProject: () => ({ project, db }), sessionId: session.id, linguistRole: 'reviewer', stageEvidenceRunId: state.stageRunId, onEvidencePrepared: observer.prepare })
    for (const [name, params] of [['cat_get_translation_context', { segmentIds: [segment.id] }], ['cat_read_context_doc', { docId: doc.id }]] as const) {
      const result = await tools.find(tool => tool.name === name)!.execute(name, params as never, undefined, undefined, {} as never)
      // 这里验证持久化恢复；真实 HTTP 请求边界由同一默认集合的 Evidence 用例验证。
      observer.onPayload({ content: result.content })
      observer.onResponse({ status: 200 })
    }
    const edited = service.editSegment(project.id, segment.id, '您好 {name}', 0)
    assert.throws(() => service.editSegment(project.id, segment.id, '旧 revision', 0), /revision/i)
    db.segments.recordCurrentStageDecision(segment.id, 'editing', edited.revision, 'corrected', { actor: session.id })
    assert.equal(db.stageEvidence.getCompletion(state.stageRunId).status, 'complete')
    const destination = join(root, 'old-upgraded.xlf')
    await service.exportAssetToPath(project.id, imported.assetId, destination, 'verified', false)
    const reimport = await service.importAsset(project.id, { filename: 'old-upgraded.xlf', bytes: readFileSync(destination) })
    const roundtrip = db.segments.query({ assetId: reimport.assetId })
    assert.equal(roundtrip.length, 1)
    assert.equal(roundtrip[0]?.source, segment.source)
    assert.equal(roundtrip[0]?.target, '您好 {name}')
    assert.equal(roundtrip[0]?.key, segment.key)
    assert.deepEqual(db.readAssetSource(imported.assetId), source)
    service.closeProject(project.id)
    const backupDb = join(service.getProjectPaths(project.id).backupsDir, backup.backupName, 'cat.db')
    const backupBytes = readFileSync(backupDb)
    writeFileSync(backupDb, 'damaged backup')
    assert.throws(() => service.restoreProject(project.id, backup.backupName), /backup|integrity|hash/i)
    assert.equal(service.openProject(project.id).segments.getById(segment.id)?.target, '您好 {name}', '失败恢复不得留下半升级项目')
    writeFileSync(backupDb, backupBytes)
    service.restoreProject(project.id, backup.backupName)
    db = service.openProject(project.id)
    assert.equal(db.segments.getById(segment.id)?.target, '你好 {name}')
    assert.equal(db.contextDocs.get(doc.id)?.textExtract, '历史参考正文')
    assert.equal(db.stageEvidence.listReceipts(old.stageRunId).length, 1)
    assert.equal(SessionManager.open(file, root, root).getSessionId(), session.id)
  } finally { service.closeAll() }
})
