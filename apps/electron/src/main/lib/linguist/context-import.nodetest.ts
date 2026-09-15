import test, { mock } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { electronMock } from '../test/electron-mock'
import { runLinguistContextImportWorker } from './cat-job-worker-client'

mock.module('electron', { namedExports: electronMock })
const { LinguistProjectService } = await import('./project-service')

test('Context 大批量导入时主线程持续响应，完成后可读，失败后释放写入守卫', async () => {
  const rootDir = mkdtempSync(join(tmpdir(), 'la-context-worker-'))
  const service = new LinguistProjectService({
    rootDir, applicationVersion: 'test', workspaceResolver: () => true,
  })
  service.init()
  let timer: ReturnType<typeof setInterval> | undefined
  try {
    const project = await service.createProject({
      name: '隔离导入', sourceLocale: 'en', targetLocale: 'zh-CN', promaWorkspaceId: 'fixture-workspace',
    })
    const db = service.openProject(project.id)
    const input = {
      filename: 'large.txt',
      bytes: new TextEncoder().encode(Array.from({ length: 20_000 }, (_, index) => `参考段落 ${index}`).join('\n')),
    }
    let ticks = 0
    let last = performance.now()
    let longestGap = 0
    timer = setInterval(() => {
      const now = performance.now()
      longestGap = Math.max(longestGap, now - last)
      last = now
      ticks++
      // 独立写连接的事务不阻塞主线程读取已提交快照。
      db.contextDocs.count()
    }, 10)
    const pending = service.importContextDoc(project.id, input)
    assert.throws(() => service.archiveProject(project.id), /正在导入/)
    await assert.rejects(service.importContextDoc(project.id, input), /正在导入/)
    const doc = await pending
    longestGap = Math.max(longestGap, performance.now() - last)
    clearInterval(timer)
    assert.ok(ticks >= 3, `导入期间主线程只响应 ${ticks} 次`)
    assert.ok(longestGap < 500, `导入阻塞主线程 ${Math.round(longestGap)}ms`)
    assert.equal(db.contextDocs.listAnchors(doc.id).length, 20_000)
    assert.equal(db.contextDocs.count(), 1)
    await assert.rejects(service.importContextDoc(project.id, {
      filename: 'broken.xlsx', bytes: new Uint8Array([1, 2, 3]),
    }))
    assert.equal(db.contextDocs.count(), 1)
    service.assertProjectWritable(project.id)
    service.archiveProject(project.id)
    await assert.rejects(runLinguistContextImportWorker({
      projectId: project.id, projectDir: service.getProjectPaths(project.id).projectDir, input,
    }), /archived/)
  } finally {
    clearInterval(timer)
    service.closeAll()
    rmSync(rootDir, { recursive: true, force: true })
  }
})
