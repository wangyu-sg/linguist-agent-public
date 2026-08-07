import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { PROJECT_SUBDIRS, ProjectIndex } from './project-index'
import {
  StoreIndexCorruptError,
  StoreNotFoundError,
  StoreProjectOrderConflictError,
} from './errors'
import { makeClock, makeEntropy, makeTempDir } from './testkit'

const INPUT = { name: 'Demo', sourceLocale: 'en', targetLocale: 'zh-CN', promaWorkspaceId: 'ws-1' }

test('create: scaffolds plan §5.2 layout and writes projects.json + project.json', () => {
  const root = makeTempDir()
  const index = new ProjectIndex(root, { now: makeClock() })
  const project = index.create(INPUT, { entropy: makeEntropy() })

  assert.match(project.id, /^prj-[0-9a-f]{16}$/)
  const dir = join(root, 'projects', project.id)
  for (const sub of PROJECT_SUBDIRS) {
    assert.ok(existsSync(join(dir, sub)), `missing subdir ${sub}`)
  }
  assert.ok(existsSync(join(root, 'projects.json')))
  assert.ok(existsSync(join(dir, 'project.json')))

  // metadata round-trips through project.json; absent glossaryPolicy normalizes to 'prefer'
  const meta = index.readProjectMeta(project.id)
  assert.deepEqual(meta, {
    ...project,
    glossaryPolicy: 'prefer',
  })
  // …but the file on disk is NOT rewritten (read-path normalization only)
  const rawMeta = JSON.parse(readFileSync(join(dir, 'project.json'), 'utf8')) as Record<string, unknown>
  assert.equal('executionPolicy' in rawMeta, false)
  assert.equal('qualityProfile' in rawMeta, false)
  assert.equal('glossaryPolicy' in rawMeta, false)

  // index content is exactly the project
  const raw = JSON.parse(readFileSync(join(root, 'projects.json'), 'utf8')) as { projects: unknown[] }
  assert.equal(raw.projects.length, 1)

  // atomic write leaves no tmp files behind
  assert.deepEqual(readdirSync(root).filter((f) => f.includes('.tmp')), [])
})

test('create: deterministic id with seeded entropy', () => {
  const a = new ProjectIndex(makeTempDir(), { now: makeClock() }).create(INPUT, { entropy: makeEntropy('same') })
  const b = new ProjectIndex(makeTempDir(), { now: makeClock() }).create(INPUT, { entropy: makeEntropy('same') })
  assert.equal(a.id, b.id)
})

test('get/list/update/archive', () => {
  const root = makeTempDir()
  const index = new ProjectIndex(root, { now: makeClock() })
  const project = index.create(INPUT, { entropy: makeEntropy() })

  assert.equal(index.list().length, 1)
  assert.equal(index.get(project.id).name, 'Demo')

  const updated = index.update(project.id, { name: 'Renamed' })
  assert.equal(updated.name, 'Renamed')
  assert.notEqual(updated.updatedAt, project.updatedAt)
  assert.equal(index.readProjectMeta(project.id).name, 'Renamed', 'project.json must be rewritten too')

  const archived = index.archive(project.id)
  assert.ok(archived.archivedAt !== undefined)
  assert.equal(index.list().length, 0, 'archived excluded by default')
  assert.equal(index.list({ includeArchived: true }).length, 1)
})

test('rename: updates projects.json and project.json through the existing metadata write path', () => {
  const root = makeTempDir()
  const index = new ProjectIndex(root, { now: makeClock() })
  const project = index.create(INPUT, { entropy: makeEntropy() })

  const renamed = index.rename(project.id, 'Renamed')

  assert.equal(renamed.name, 'Renamed')
  assert.equal(index.get(project.id).name, 'Renamed')
  assert.equal(index.readProjectMeta(project.id).name, 'Renamed')
})

test('rename: rolls project.json back when the index commit fails', () => {
  const root = makeTempDir()
  const index = new ProjectIndex(root, { now: makeClock() })
  const project = index.create(INPUT, { entropy: makeEntropy() })
  const internals = index as unknown as { writeIndex: () => void }
  internals.writeIndex = () => {
    throw new Error('simulated index failure')
  }

  assert.throws(() => index.rename(project.id, 'Half Renamed'), /simulated index failure/)
  assert.equal(index.get(project.id).name, 'Demo')
  assert.equal(index.readProjectMeta(project.id).name, 'Demo')
})

test('reorderActive: persists the exact active order and preserves archived relative order', () => {
  const root = makeTempDir()
  const index = new ProjectIndex(root, { now: makeClock() })
  const activeA = index.create({ ...INPUT, name: 'Active A' }, { entropy: makeEntropy('active-a') })
  const archivedA = index.create({ ...INPUT, name: 'Archived A' }, { entropy: makeEntropy('archived-a') })
  const activeB = index.create({ ...INPUT, name: 'Active B' }, { entropy: makeEntropy('active-b') })
  const archivedB = index.create({ ...INPUT, name: 'Archived B' }, { entropy: makeEntropy('archived-b') })
  index.archive(archivedA.id)
  index.archive(archivedB.id)

  const reordered = index.reorderActive([activeB.id, activeA.id])

  assert.deepEqual(reordered.map((project) => project.id), [activeB.id, activeA.id])
  assert.deepEqual(
    index.list({ includeArchived: true }).map((project) => project.id),
    [activeB.id, activeA.id, archivedA.id, archivedB.id],
  )
})

test('reorderActive: rejects duplicate ids with a typed conflict and leaves the index unchanged', () => {
  const root = makeTempDir()
  const index = new ProjectIndex(root, { now: makeClock() })
  const activeA = index.create({ ...INPUT, name: 'Active A' }, { entropy: makeEntropy('active-a') })
  const activeB = index.create({ ...INPUT, name: 'Active B' }, { entropy: makeEntropy('active-b') })

  assert.throws(
    () => index.reorderActive([activeA.id, activeA.id]),
    (error: unknown) => {
      assert.ok(error instanceof StoreProjectOrderConflictError)
      assert.equal(error.code, 'PROJECT_ORDER_CONFLICT')
      return true
    },
  )
  assert.deepEqual(index.list().map((project) => project.id), [activeA.id, activeB.id])
})

test('reorderActive: rejects a missing active id and leaves the index unchanged', () => {
  const root = makeTempDir()
  const index = new ProjectIndex(root, { now: makeClock() })
  const activeA = index.create({ ...INPUT, name: 'Active A' }, { entropy: makeEntropy('active-a') })
  const activeB = index.create({ ...INPUT, name: 'Active B' }, { entropy: makeEntropy('active-b') })

  assert.throws(
    () => index.reorderActive([activeB.id]),
    StoreProjectOrderConflictError,
  )
  assert.deepEqual(index.list().map((project) => project.id), [activeA.id, activeB.id])
})

test('reorderActive: rejects unknown or archived ids and leaves the index unchanged', () => {
  const root = makeTempDir()
  const index = new ProjectIndex(root, { now: makeClock() })
  const activeA = index.create({ ...INPUT, name: 'Active A' }, { entropy: makeEntropy('active-a') })
  const activeB = index.create({ ...INPUT, name: 'Active B' }, { entropy: makeEntropy('active-b') })
  const archived = index.create({ ...INPUT, name: 'Archived' }, { entropy: makeEntropy('archived') })
  index.archive(archived.id)

  for (const invalidId of ['prj-0000000000000000', archived.id]) {
    assert.throws(
      () => index.reorderActive([activeB.id, invalidId]),
      StoreProjectOrderConflictError,
    )
  }
  assert.deepEqual(
    index.list({ includeArchived: true }).map((project) => project.id),
    [activeA.id, activeB.id, archived.id],
  )
})

test('remove: moves the complete project to recovery trash and removes the index entry', () => {
  const root = makeTempDir()
  const index = new ProjectIndex(root, { now: () => '2026-07-27T12:34:56.000Z' })
  const project = index.create(INPUT, { entropy: makeEntropy() })
  index.archive(project.id)

  const removed = index.remove(project.id)

  assert.equal(removed.project.id, project.id)
  assert.equal(removed.recoveryName, `${project.id}-2026-07-27T12-34-56.000Z`)
  assert.equal(existsSync(join(root, 'projects', project.id)), false)
  assert.ok(existsSync(join(root, 'trash', removed.recoveryName!, 'project.json')))
  assert.equal(index.list({ includeArchived: true }).length, 0)
  assert.throws(() => index.get(project.id), StoreNotFoundError)
})

test('unknown project id -> STORE_NOT_FOUND', () => {
  const index = new ProjectIndex(makeTempDir(), { now: makeClock() })
  assert.throws(() => index.get('prj-0000000000000000'), (err: unknown) => {
    assert.ok(err instanceof StoreNotFoundError)
    assert.equal(err.code, 'STORE_NOT_FOUND')
    return true
  })
  assert.throws(() => index.update('prj-0000000000000000', { name: 'x' }), StoreNotFoundError)
  assert.throws(() => index.archive('prj-0000000000000000'), StoreNotFoundError)
  assert.throws(() => index.remove('prj-0000000000000000'), StoreNotFoundError)
})

test('corrupt projects.json -> STORE_INDEX_CORRUPT with a clear message', () => {
  const root = makeTempDir()
  writeFileSync(join(root, 'projects.json'), '{ not json', 'utf8')
  const index = new ProjectIndex(root, { now: makeClock() })
  assert.throws(() => index.list(), (err: unknown) => {
    assert.ok(err instanceof StoreIndexCorruptError)
    assert.equal(err.code, 'STORE_INDEX_CORRUPT')
    assert.match(err.message, /corrupt/)
    return true
  })
})

test('invalid index shape -> STORE_INDEX_CORRUPT', () => {
  const root = makeTempDir()
  writeFileSync(join(root, 'projects.json'), JSON.stringify({ schemaVersion: 1, projects: [{ bogus: true }] }), 'utf8')
  const index = new ProjectIndex(root, { now: makeClock() })
  assert.throws(() => index.list(), StoreIndexCorruptError)
})

test('workflow stage: new projects persist the selected stage and legacy projects read as translation', () => {
  const root = makeTempDir()
  const index = new ProjectIndex(root, { now: makeClock() })
  const project = index.create(
    { ...INPUT, workflowStage: 'editing', qaProfile: 'subtitle' },
    { entropy: makeEntropy() },
  )

  assert.equal(project.workflowStage, 'editing')
  assert.equal(index.readProjectMeta(project.id).workflowStage, 'editing')
  assert.equal(project.qaProfile, 'subtitle')

  const metaPath = join(root, 'projects', project.id, 'project.json')
  const meta = JSON.parse(readFileSync(metaPath, 'utf8')) as Record<string, unknown>
  delete meta.workflowStage
  delete meta.qaProfile
  writeFileSync(metaPath, `${JSON.stringify(meta, null, 2)}\n`, 'utf8')

  const indexPath = join(root, 'projects.json')
  const rawIndex = JSON.parse(readFileSync(indexPath, 'utf8')) as { projects: Record<string, unknown>[] }
  delete rawIndex.projects[0]?.workflowStage
  delete rawIndex.projects[0]?.qaProfile
  writeFileSync(indexPath, `${JSON.stringify(rawIndex, null, 2)}\n`, 'utf8')

  assert.equal(index.get(project.id).workflowStage, 'translation')
  assert.equal(index.readProjectMeta(project.id).workflowStage, 'translation')
  assert.equal(index.get(project.id).qaProfile, 'general')
  assert.equal(index.readProjectMeta(project.id).qaProfile, 'general')
  assert.equal('workflowStage' in meta, false, '兼容读取不得主动回写旧项目')
})

test('setWorkflowConfig: atomically updates stage and native output policy', () => {
  const root = makeTempDir()
  const index = new ProjectIndex(root, { now: makeClock() })
  const project = index.create(INPUT, { entropy: makeEntropy() })

  const updated = index.setWorkflowConfig(project.id, {
    workflowStage: 'proofreading',
    outputStatusPolicy: {
      sdlxliff: { proofreading: 'ApprovedTranslation' },
    },
    qaProfile: 'subtitle',
  })

  assert.equal(updated.workflowStage, 'proofreading')
  assert.equal(updated.outputStatusPolicy?.sdlxliff?.proofreading, 'ApprovedTranslation')
  assert.equal(index.readProjectMeta(project.id).workflowStage, 'proofreading')
  assert.equal(updated.qaProfile, 'subtitle')
})
