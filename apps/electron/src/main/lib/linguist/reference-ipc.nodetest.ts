import { test } from 'node:test'
import assert from 'node:assert/strict'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { createLinguistReferenceIpc, type LinguistReferenceFilePicker } from './reference-ipc'
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

test('PB-080 reference IPC: main-process picker imports TM and TB, then exposes project-scoped records', async () => {
  const service = makeService()
  try {
    const project = service.createProject(INPUT)
    const other = service.createProject({ ...INPUT, name: 'other' })
    const temp = makeTempDir()
    const tmPath = join(temp, 'memory.csv')
    const tbPath = join(temp, 'terms.csv')
    writeFileSync(tmPath, 'source,target\nHealth Potion,生命药水\n')
    writeFileSync(tbPath, 'term,translation,status,case_sensitive,note\nPotion,药水,preferred,true,项目术语\n')
    const ipc = createLinguistReferenceIpc({ getService: () => service })

    const tm = await ipc.import({ projectId: project.id, kind: 'tm' }, picker([tmPath]).picker)
    assert.equal(tm.ok, true)
    if (tm.ok) assert.deepEqual({ imported: tm.data.imported, unchanged: tm.data.unchanged }, { imported: 1, unchanged: 0 })
    const terms = await ipc.import({ projectId: project.id, kind: 'terms' }, picker([tbPath]).picker)
    assert.equal(terms.ok, true)

    const listedTm = await ipc.queryTm({ projectId: project.id, query: 'Health', limit: 10, offset: 0 })
    assert.equal(listedTm.ok, true)
    if (listedTm.ok) assert.equal(listedTm.data.items[0]?.target, '生命药水')
    const listedTerms = await ipc.queryTerms({ projectId: project.id, query: 'Potion', limit: 10, offset: 0 })
    assert.equal(listedTerms.ok, true)
    if (listedTerms.ok) assert.deepEqual(listedTerms.data.items[0], {
      id: listedTerms.data.items[0]?.id,
      term: 'Potion',
      translation: '药水',
      status: 'preferred',
      caseSensitive: true,
      note: '项目术语',
    })
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
