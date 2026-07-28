import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { PROJECT_SUBDIRS, ProjectIndex } from './project-index'
import { StoreIndexCorruptError, StoreNotFoundError } from './errors'
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

  // metadata round-trips through project.json; PB-082: reads normalize the
  // absent qualityProfile of freshly created (pre-field) metadata to 'balanced'
  // PB-096: absent glossaryPolicy normalizes to 'prefer' the same way
  const meta = index.readProjectMeta(project.id)
  assert.deepEqual(meta, { ...project, qualityProfile: 'balanced', glossaryPolicy: 'prefer' })
  // …but the file on disk is NOT rewritten: the key stays absent (read-path normalization only)
  const rawMeta = JSON.parse(readFileSync(join(dir, 'project.json'), 'utf8')) as Record<string, unknown>
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

// ===== PB-082：qualityProfile 读写与向后兼容 =====

test('legacy project.json without qualityProfile reads as balanced (get/list/readProjectMeta)', () => {
  const root = makeTempDir()
  const index = new ProjectIndex(root, { now: makeClock() })
  const project = index.create(INPUT, { entropy: makeEntropy() })

  // create 不写该字段（默认 balanced）；磁盘文件保持无此键
  const rawMeta = JSON.parse(readFileSync(join(root, 'projects', project.id, 'project.json'), 'utf8')) as Record<string, unknown>
  assert.equal('qualityProfile' in rawMeta, false)
  const rawIndex = JSON.parse(readFileSync(join(root, 'projects.json'), 'utf8')) as { projects: Record<string, unknown>[] }
  assert.equal('qualityProfile' in rawIndex.projects[0]!, false)

  // 读取路径统一兜底为 'balanced'
  assert.equal(index.get(project.id).qualityProfile, 'balanced')
  assert.equal(index.list()[0]?.qualityProfile, 'balanced')
  assert.equal(index.readProjectMeta(project.id).qualityProfile, 'balanced')
})

test('setQualityProfile: round-trip writes both projects.json and project.json, bumps updatedAt', () => {
  const root = makeTempDir()
  const index = new ProjectIndex(root, { now: makeClock() })
  const project = index.create(INPUT, { entropy: makeEntropy() })

  const updated = index.setQualityProfile(project.id, 'best')
  assert.equal(updated.qualityProfile, 'best')
  assert.notEqual(updated.updatedAt, project.updatedAt)

  // 读回一致（三个读路径）
  assert.equal(index.get(project.id).qualityProfile, 'best')
  assert.equal(index.readProjectMeta(project.id).qualityProfile, 'best')
  // 两处落盘均携带新值
  const rawMeta = JSON.parse(readFileSync(join(root, 'projects', project.id, 'project.json'), 'utf8')) as Record<string, unknown>
  assert.equal(rawMeta.qualityProfile, 'best')
  const rawIndex = JSON.parse(readFileSync(join(root, 'projects.json'), 'utf8')) as { projects: Record<string, unknown>[] }
  assert.equal(rawIndex.projects[0]?.qualityProfile, 'best')

  // 可再改回（fast）
  assert.equal(index.setQualityProfile(project.id, 'fast').qualityProfile, 'fast')
  assert.equal(index.get(project.id).qualityProfile, 'fast')
})

test('setQualityProfile: unknown project id -> STORE_NOT_FOUND', () => {
  const index = new ProjectIndex(makeTempDir(), { now: makeClock() })
  assert.throws(() => index.setQualityProfile('prj-0000000000000000', 'fast'), (err: unknown) => {
    assert.ok(err instanceof StoreNotFoundError)
    assert.equal(err.code, 'STORE_NOT_FOUND')
    return true
  })
})

test('invalid stored qualityProfile values fall back to balanced instead of failing validation', () => {
  const root = makeTempDir()
  const index = new ProjectIndex(root, { now: makeClock() })
  const project = index.create(INPUT, { entropy: makeEntropy() })

  // 直接篡改磁盘文件为非法值（未知字面量与非字符串两种）
  const metaPath = join(root, 'projects', project.id, 'project.json')
  const meta = JSON.parse(readFileSync(metaPath, 'utf8')) as Record<string, unknown>
  meta.qualityProfile = 'turbo'
  writeFileSync(metaPath, `${JSON.stringify(meta, null, 2)}\n`, 'utf8')
  assert.equal(index.readProjectMeta(project.id).qualityProfile, 'balanced')

  meta.qualityProfile = 42
  writeFileSync(metaPath, `${JSON.stringify(meta, null, 2)}\n`, 'utf8')
  assert.equal(index.readProjectMeta(project.id).qualityProfile, 'balanced')

  // projects.json 里的非法值同样兜底（不抛 STORE_INDEX_CORRUPT）
  const indexPath = join(root, 'projects.json')
  const indexRaw = JSON.parse(readFileSync(indexPath, 'utf8')) as { projects: Record<string, unknown>[] }
  indexRaw.projects[0]!.qualityProfile = 'FAST'
  writeFileSync(indexPath, `${JSON.stringify(indexRaw, null, 2)}\n`, 'utf8')
  assert.equal(index.get(project.id).qualityProfile, 'balanced')
  assert.equal(index.list()[0]?.qualityProfile, 'balanced')
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
