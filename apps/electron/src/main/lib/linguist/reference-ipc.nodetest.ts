import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, realpathSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { createLinguistReferenceIpc, type LinguistReferenceFilePicker } from './reference-ipc'
import { createLinguistProjectIpc } from './project-ipc'
import { PendingImportFileStore, PENDING_IMPORT_FILE_TTL_MS } from './pending-import-files'
import { INPUT, makeService, makeTempDir } from './test/service-testkit'

function picker(paths: string[] | null): { picker: LinguistReferenceFilePicker; calls: () => number } {
  let count = 0
  return {
    picker: async () => {
      count += 1
      return paths === null ? { canceled: true, filePaths: [] } : { canceled: false, filePaths: paths }
    },
    calls: () => count,
  }
}

test('PB-080 reference IPC: TM/TB 文件先成为候选，明确确认后才进入项目权威参考库', async () => {
  const service = makeService()
  try {
    const project = service.createProject(INPUT)
    const other = service.createProject({ ...INPUT, name: 'other' })
    const temp = makeTempDir()
    const tmPath = join(temp, 'memory.csv')
    const tbPath = join(temp, 'terms.csv')
    writeFileSync(tmPath, 'source,target\nHealth Potion,生命药水\n')
    writeFileSync(
      tbPath,
      'term,translation,status,case_sensitive,note\nPotion,药水,preferred,true,项目术语\nHealth Potion,生命药水,required,false,强制术语\n',
    )
    const ipc = createLinguistReferenceIpc({ getService: () => service }) as ReturnType<typeof createLinguistReferenceIpc> & {
      confirmImport: (input: unknown) => Promise<any>
      previewCandidate: (input: unknown) => Promise<any>
    }

    const tmCandidate = await ipc.import({ projectId: project.id, kind: 'tm' }, picker([tmPath]).picker)
    const termsCandidate = await ipc.import({ projectId: project.id, kind: 'terms' }, picker([tbPath]).picker)
    assert.equal(tmCandidate.ok, true)
    assert.equal(termsCandidate.ok, true)
    if (!tmCandidate.ok || !termsCandidate.ok || tmCandidate.data.cancelled || termsCandidate.data.cancelled) return
    assert.equal(tmCandidate.data.requiresConfirmation, true)
    assert.equal(termsCandidate.data.requiresConfirmation, true)

    // 解析结果在用户确认前不能进入 Agent 会读取的权威表。
    const listedTm = await ipc.queryTm({ projectId: project.id, query: 'Health', limit: 10, offset: 0 })
    assert.equal(listedTm.ok, true)
    if (listedTm.ok) assert.equal(listedTm.data.total, 0)
    const listedTerms = await ipc.queryTerms({ projectId: project.id, query: 'Potion', limit: 10, offset: 0 })
    assert.equal(listedTerms.ok, true)
    if (listedTerms.ok) assert.equal(listedTerms.data.total, 0)

    // 未确认候选可经 opaque token 在原生 Preview Tab 的同一三态契约中预览；
    // token 响应中不得泄漏 picker 临时目录或原始 bytes。
    assert.ok(!JSON.stringify(tmCandidate.data).includes(temp))
    const preview = await ipc.previewCandidate({
      projectId: project.id,
      kind: 'tm',
      candidateId: tmCandidate.data.candidateId,
      sourceSha256: tmCandidate.data.sourceSha256,
    })
    assert.equal(preview.ok, true)
    if (preview.ok) {
      assert.equal(preview.data.kind, 'text')
      assert.ok(preview.data.text.includes('Health Potion'))
    }

    const tm = await ipc.confirmImport({
      projectId: project.id,
      kind: 'tm',
      candidateId: tmCandidate.data.candidateId,
      sourceSha256: tmCandidate.data.sourceSha256,
    })
    const terms = await ipc.confirmImport({
      projectId: project.id,
      kind: 'terms',
      candidateId: termsCandidate.data.candidateId,
      sourceSha256: termsCandidate.data.sourceSha256,
    })
    assert.equal(tm.ok, true)
    assert.equal(terms.ok, true)
    if (tm.ok) assert.deepEqual({ imported: tm.data.imported, unchanged: tm.data.unchanged }, { imported: 1, unchanged: 0 })

    const confirmedTm = await ipc.queryTm({ projectId: project.id, query: 'Health', limit: 10, offset: 0 })
    assert.equal(confirmedTm.ok, true)
    if (confirmedTm.ok) assert.equal(confirmedTm.data.items[0]?.target, '生命药水')
    const confirmedTerms = await ipc.queryTerms({ projectId: project.id, query: 'Potion', limit: 10, offset: 0 })
    assert.equal(confirmedTerms.ok, true)
    if (confirmedTerms.ok) assert.deepEqual(confirmedTerms.data.items[0], {
      id: confirmedTerms.data.items[0]?.id,
      term: 'Potion',
      translation: '药水',
      status: 'preferred',
      caseSensitive: true,
      note: '项目术语',
    })
    const requiredTerms = await ipc.queryTerms({
      projectId: project.id,
      status: 'required',
      limit: 10,
      offset: 0,
    })
    assert.equal(requiredTerms.ok, true)
    if (requiredTerms.ok) {
      assert.deepEqual(
        requiredTerms.data.items.map(({ term, translation, status }) => ({ term, translation, status })),
        [{ term: 'Health Potion', translation: '生命药水', status: 'required' }],
      )
    }
    const isolated = await ipc.queryTm({ projectId: other.id, query: 'Health', limit: 10, offset: 0 })
    assert.equal(isolated.ok, true)
    if (isolated.ok) assert.equal(isolated.data.total, 0)
  } finally {
    service.closeAll()
  }
})

test('PB-080 reference IPC: archived project rejects before native picker', async () => {
  const service = makeService()
  try {
    const project = service.createProject(INPUT)
    service.archiveProject(project.id)
    const ipc = createLinguistReferenceIpc({ getService: () => service })
    const fake = picker([join(makeTempDir(), 'unused.tmx')])
    const result = await ipc.import({ projectId: project.id, kind: 'tm' }, fake.picker)
    assert.equal(result.ok, false)
    if (!result.ok) assert.equal(result.error.code, 'PROJECT_ARCHIVED')
    assert.equal(fake.calls(), 0)
  } finally {
    service.closeAll()
  }
})

test('reference candidate: forged binding, cancellation, and expiry never write TM/TB authority rows', async () => {
  const service = makeService()
  try {
    let now = 1_000
    const pendingFiles = new PendingImportFileStore(() => now)
    const project = service.createProject(INPUT)
    const other = service.createProject({ ...INPUT, name: 'other' })
    const temp = makeTempDir()
    const path = join(temp, 'memory.csv')
    writeFileSync(path, 'source,target\nHealth Potion,生命药水\n')
    const ipc = createLinguistReferenceIpc({ getService: () => service, pendingFiles })

    const staged = await ipc.import({ projectId: project.id, kind: 'tm' }, picker([path]).picker)
    assert.equal(staged.ok, true)
    if (!staged.ok || staged.data.cancelled || !staged.data.requiresConfirmation) return

    const forged = await ipc.confirmImport({
      projectId: other.id,
      kind: 'tm',
      candidateId: staged.data.candidateId,
      sourceSha256: staged.data.sourceSha256,
    })
    assert.equal(forged.ok, false)
    const beforeCancel = await ipc.queryTm({ projectId: project.id, limit: 10, offset: 0 })
    assert.equal(beforeCancel.ok, true)
    if (beforeCancel.ok) assert.equal(beforeCancel.data.total, 0)

    const cancelled = await ipc.cancelImport({
      projectId: project.id,
      kind: 'tm',
      candidateId: staged.data.candidateId,
      sourceSha256: staged.data.sourceSha256,
    })
    assert.equal(cancelled.ok, true)
    const afterCancel = await ipc.confirmImport({
      projectId: project.id,
      kind: 'tm',
      candidateId: staged.data.candidateId,
      sourceSha256: staged.data.sourceSha256,
    })
    assert.equal(afterCancel.ok, false)

    const expiring = await ipc.import({ projectId: project.id, kind: 'tm' }, picker([path]).picker)
    assert.equal(expiring.ok, true)
    if (!expiring.ok || expiring.data.cancelled || !expiring.data.requiresConfirmation) return
    now += PENDING_IMPORT_FILE_TTL_MS + 1
    const expired = await ipc.previewCandidate({
      projectId: project.id,
      kind: 'tm',
      candidateId: expiring.data.candidateId,
      sourceSha256: expiring.data.sourceSha256,
    })
    assert.equal(expired.ok, false)
    const afterExpiry = await ipc.queryTm({ projectId: project.id, limit: 10, offset: 0 })
    assert.equal(afterExpiry.ok, true)
    if (afterExpiry.ok) assert.equal(afterExpiry.data.total, 0)
  } finally {
    service.closeAll()
  }
})

test('reference import: TM/TB 原件只保存一次受管 blob，并可通过 opaque id 预览', async () => {
  const service = makeService()
  try {
    const project = service.createProject(INPUT)
    const temp = makeTempDir()
    const tmPath = join(temp, 'memory.csv')
    const tbPath = join(temp, 'terms.csv')
    const tmBytes = new TextEncoder().encode('source,target\nHealth Potion,生命药水\n')
    const tbBytes = new TextEncoder().encode(
      'term,translation,status,case_sensitive\nPotion,药水,preferred,true\nHealth Potion,生命药水,required,false\n',
    )
    writeFileSync(tmPath, tmBytes)
    writeFileSync(tbPath, tbBytes)
    const references = createLinguistReferenceIpc({ getService: () => service })

    const tmCandidate = await references.import({ projectId: project.id, kind: 'tm' }, picker([tmPath]).picker)
    const termsCandidate = await references.import({ projectId: project.id, kind: 'terms' }, picker([tbPath]).picker)
    assert.equal(tmCandidate.ok, true)
    assert.equal(termsCandidate.ok, true)
    if (
      !tmCandidate.ok
      || !termsCandidate.ok
      || tmCandidate.data.cancelled
      || termsCandidate.data.cancelled
      || !tmCandidate.data.requiresConfirmation
      || !termsCandidate.data.requiresConfirmation
    ) return

    // 候选阶段不写项目 blobs/ 或参考库。
    const candidatePaths = service.getProjectPaths(project.id)
    assert.equal(readdirSync(candidatePaths.blobsDir).filter((name) => name.startsWith('ref-')).length, 0)

    const tm = await references.confirmImport({
      projectId: project.id,
      kind: 'tm',
      candidateId: tmCandidate.data.candidateId,
      sourceSha256: tmCandidate.data.sourceSha256,
    })
    const terms = await references.confirmImport({
      projectId: project.id,
      kind: 'terms',
      candidateId: termsCandidate.data.candidateId,
      sourceSha256: termsCandidate.data.sourceSha256,
    })
    assert.equal(tm.ok, true)
    assert.equal(terms.ok, true)
    if (!tm.ok || !terms.ok || tm.data.cancelled || terms.data.cancelled) return

    // 新的 source 字段只传 opaque metadata，绝不把主机路径带出服务边界。
    const tmSource = tm.data.source
    const termSource = terms.data.source
    assert.ok(tmSource)
    assert.ok(termSource)
    assert.equal(tmSource.filename, 'memory.csv')
    assert.equal(termSource.filename, 'terms.csv')
    assert.ok(!JSON.stringify(tmSource).includes(temp))
    assert.ok(!JSON.stringify(termSource).includes(temp))

    // 同一份 import file 只有一个 blob，不随其中的每条 TM/TB 记录重复落盘。
    const paths = service.getProjectPaths(project.id)
    const referenceBlobs = readdirSync(paths.blobsDir).filter((name) => name.startsWith('ref-'))
    assert.equal(referenceBlobs.length, 2)

    const tmPathInProject = service.resolveReferenceImportPreviewPath(project.id, tmSource.id)
    assert.equal(tmPathInProject.originalFilename, 'memory.csv')
    assert.deepEqual(new Uint8Array(readFileSync(tmPathInProject.sourcePath)), tmBytes)
    assert.ok(tmPathInProject.sourcePath.startsWith(realpathSync(paths.blobsDir)))

    const preview = createLinguistProjectIpc({
      getService: () => service,
      assetPreview: {
        readText: async (sourcePath) => ({ content: readFileSync(sourcePath, 'utf-8') }),
        convertDocxToHtml: async () => null,
        convertOfficeToHtml: async () => null,
        registerPreviewUrl: () => 'proma-file://should-not-be-used-for-csv',
      },
    })
    const rendered = await preview.previewReferenceImport({ projectId: project.id, importId: tmSource.id })
    assert.equal(rendered.ok, true)
    assert.ok(JSON.stringify(rendered.data).includes('Health Potion'))
    assert.ok(!JSON.stringify(rendered.data).includes(paths.blobsDir))

    // 已导入来源随对应 TM/TB 查询返回，ReferenceManager 不需要第二个列表 authority。
    const listed = await references.queryTm({ projectId: project.id, limit: 10, offset: 0 })
    assert.equal(listed.ok, true)
    if (listed.ok) {
      const sources = listed.data.imports
      assert.deepEqual(sources?.map(({ id }) => id), [tmSource.id])
    }
  } finally {
    service.closeAll()
  }
})
