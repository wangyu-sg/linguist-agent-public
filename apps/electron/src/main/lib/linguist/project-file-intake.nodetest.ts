import assert from 'node:assert/strict'
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import { LINGUIST_IMPORT_MAX_BYTES } from '@proma/shared'
import { fixturePath, makeService, makeTempDir, INPUT } from './test/service-testkit'

const PHRASE_SPLIT = `<?xml version="1.0"?><xliff xmlns:m="http://www.memsource.com/mxlf/2.0" version="1.2"><file><body><group id="1" m:para-id="1"><context-group><context context-type="x-key">1001</context></context-group><trans-unit id="job:1" m:para-id="1"><source>获得{1}30%攻击速度{2}。</source></trans-unit></group></body></file></xliff>`
const PHRASE_MASTER = `<?xml version="1.0"?><xliff version="1.2"><file><body><trans-unit id="1001"><source>获得&lt;color=#ffffff&gt;30%攻击速度&lt;/color&gt;。</source></trans-unit></body></file></xliff>`

test('auto intake recognizes an unambiguous term/translation/status CSV as terminology', async () => {
  const service = makeService()
  try {
    const project = service.createProject(INPUT)
    const directory = makeTempDir()
    writeFileSync(
      join(directory, 'terms.csv'),
      'term,translation,status\nPotion,药水,required\n',
    )

    const result = await service.importResourcesFromPaths(project.id, directory, {
      paths: [directory],
      recursive: false,
      kind: 'auto',
      dryRun: false,
    })

    assert.deepEqual(
      result.items.map(({ filename, status, resourceKind }) => ({ filename, status, resourceKind })),
      [{ filename: 'terms.csv', status: 'imported', resourceKind: 'terms' }],
    )
    assert.equal(service.getProjectSummary(project.id).assetCount, 0)
    assert.deepEqual(
      service.queryTermReferences(project.id, { query: '', limit: 10, offset: 0 }).items
        .map(({ term, translation, status }) => ({ term, translation, status })),
      [{ term: 'Potion', translation: '药水', status: 'required' }],
    )
  } finally {
    service.closeAll()
  }
})

test('auto intake recognizes term/translation CSV as terminology with the default status', async () => {
  const service = makeService()
  try {
    const project = service.createProject(INPUT)
    const directory = makeTempDir()
    writeFileSync(join(directory, 'terms.csv'), 'term,translation\nPotion,药水\n')

    const result = await service.importResourcesFromPaths(project.id, directory, {
      paths: [directory],
      recursive: false,
      kind: 'auto',
      dryRun: false,
    })

    assert.equal(result.items[0]?.resourceKind, 'terms')
    assert.equal(result.items[0]?.status, 'imported')
    assert.deepEqual(
      service.queryTermReferences(project.id, { query: '', limit: 10, offset: 0 }).items
        .map(({ term, translation, status }) => ({ term, translation, status })),
      [{ term: 'Potion', translation: '药水', status: 'allowed' }],
    )
  } finally {
    service.closeAll()
  }
})

test('auto intake reports source/target CSV as a batch-or-TM choice instead of silently importing a batch', async () => {
  const service = makeService()
  try {
    const project = service.createProject(INPUT)
    const directory = makeTempDir()
    writeFileSync(join(directory, 'bilingual.csv'), 'source,target\nHello,你好\n')

    const result = await service.importResourcesFromPaths(project.id, directory, {
      paths: [directory],
      recursive: false,
      kind: 'auto',
      dryRun: false,
    })

    assert.deepEqual(
      result.items.map(({ filename, status, resourceKind, message }) => ({
        filename,
        status,
        resourceKind,
        message,
      })),
      [{
        filename: 'bilingual.csv',
        status: 'needs-input',
        resourceKind: undefined,
        message: 'CSV 只有 Source/Target，无法判断是批次还是翻译记忆；若是 TM，请在“TM / 术语库 / 句式管理”导入；若是批次，请补充 ID/Key 列，或让项目 Agent 明确按批次导入',
      }],
    )
    assert.equal(service.getProjectSummary(project.id).assetCount, 0)
    assert.equal(
      service.queryTmReferences(project.id, { query: '', limit: 10, offset: 0 }).total,
      0,
    )
  } finally {
    service.closeAll()
  }
})

test('auto intake keeps a CSV with explicit batch columns as a translation batch', async () => {
  const service = makeService()
  try {
    const project = service.createProject(INPUT)
    const sourcePath = fixturePath('mini_dialogue.csv')

    const result = await service.importResourcesFromPaths(project.id, makeTempDir(), {
      paths: [sourcePath],
      recursive: false,
      kind: 'auto',
      dryRun: false,
    })

    assert.deepEqual(
      result.items.map(({ filename, status, resourceKind }) => ({ filename, status, resourceKind })),
      [{ filename: 'mini_dialogue.csv', status: 'imported', resourceKind: 'batch' }],
    )
    assert.equal(service.getProjectSummary(project.id).assetCount, 1)
    assert.equal(service.queryTmReferences(project.id, { query: '', limit: 10, offset: 0 }).total, 0)
  } finally {
    service.closeAll()
  }
})

test('dry-run does not report an oversized auto-classified batch as ready', async () => {
  const service = makeService()
  try {
    const project = service.createProject(INPUT)
    const sourcePath = join(makeTempDir(), 'oversized.csv')
    const bytes = new Uint8Array(LINGUIST_IMPORT_MAX_BYTES + 1)
    bytes.set(new TextEncoder().encode('key,source,target\nrow-1,Hello,你好\n'))
    writeFileSync(sourcePath, bytes)

    const result = await service.importResourcesFromPaths(project.id, makeTempDir(), {
      paths: [sourcePath],
      recursive: false,
      kind: 'auto',
      dryRun: true,
    })

    assert.equal(result.ready, 0)
    assert.equal(result.failed, 1)
    assert.deepEqual(
      result.items.map(({ status, resourceKind, message }) => ({ status, resourceKind, message })),
      [{ status: 'failed', resourceKind: 'batch', message: '导入失败（INVALID_ARGUMENT）' }],
    )
  } finally {
    service.closeAll()
  }
})

test('bulk intake imports an unrelated XLIFF beside a uniquely paired Phrase split/master', async () => {
  const service = makeService()
  try {
    const project = service.createProject(INPUT)
    const directory = makeTempDir()
    writeFileSync(join(directory, 'split.mxliff'), PHRASE_SPLIT)
    writeFileSync(join(directory, 'master.xliff'), PHRASE_MASTER)
    writeFileSync(
      join(directory, 'unrelated.xliff'),
      readFileSync(fixturePath('mini_game_ui.xliff')),
    )

    const result = await service.importResourcesFromPaths(project.id, directory, {
      paths: [directory],
      recursive: false,
      kind: 'auto',
      dryRun: false,
    })

    assert.equal(
      result.items.find((item) => item.filename === 'unrelated.xliff')?.status,
      'imported',
    )
    assert.deepEqual(
      { imported: result.imported, needsInput: result.needsInput, failed: result.failed },
      { imported: 3, needsInput: 0, failed: 0 },
    )
    assert.equal(service.getProjectSummary(project.id).assetCount, 2)
  } finally {
    service.closeAll()
  }
})

test('bulk intake rejects an archived project before producing per-file failures', async () => {
  const service = makeService()
  try {
    const project = service.createProject(INPUT)
    const directory = makeTempDir()
    writeFileSync(join(directory, 'batch.json'), '{"hello":"Hello"}')
    service.archiveProject(project.id)

    await assert.rejects(
      service.importResourcesFromPaths(project.id, directory, {
        paths: [directory],
        recursive: false,
        kind: 'auto',
        dryRun: false,
      }),
      (error: unknown) => (error as { code?: string }).code === 'PROJECT_ARCHIVED',
    )
  } finally {
    service.closeAll()
  }
})

test('bulk intake projects per-file errors without selected or managed absolute paths', async () => {
  const service = makeService()
  try {
    const project = service.createProject(INPUT)
    const directory = makeTempDir()
    const selectedPath = join(directory, 'batch.json')
    const internalDbPath = join(service.rootDir, 'projects', project.id, 'cat.db')
    writeFileSync(selectedPath, '{"hello":"Hello"}')
    service.importAsset = async () => {
      throw Object.assign(
        new Error(`database ${internalDbPath} failed while importing ${selectedPath}`),
        { code: 'STORE_SCHEMA_TOO_NEW' },
      )
    }

    const result = await service.importResourcesFromPaths(project.id, directory, {
      paths: [selectedPath],
      recursive: false,
      kind: 'auto',
      dryRun: false,
    })

    assert.equal(result.failed, 1)
    assert.equal(result.items[0]?.message, '导入失败（STORE_SCHEMA_TOO_NEW）')
    assert.equal(result.items[0]?.message?.includes(selectedPath), false)
    assert.equal(result.items[0]?.message?.includes(service.rootDir), false)
  } finally {
    service.closeAll()
  }
})

test('recursive bulk intake records an unreadable child and continues with its siblings', async () => {
  const service = makeService()
  const directory = makeTempDir()
  const blockedDirectory = join(directory, 'a-blocked')
  mkdirSync(blockedDirectory)
  chmodSync(blockedDirectory, 0o000)
  try {
    const project = service.createProject(INPUT)
    writeFileSync(join(directory, 'z-good.json'), '{"hello":"Hello"}')

    const result = await service.importResourcesFromPaths(project.id, directory, {
      paths: [directory],
      recursive: true,
      kind: 'auto',
      dryRun: false,
    })

    assert.deepEqual(
      result.items.map(({ filename, status }) => ({ filename, status })),
      [
        { filename: 'a-blocked', status: 'failed' },
        { filename: 'z-good.json', status: 'imported' },
      ],
    )
    assert.deepEqual(
      { imported: result.imported, failed: result.failed },
      { imported: 1, failed: 1 },
    )
    assert.equal(JSON.stringify(result).includes(directory), false)
  } finally {
    chmodSync(blockedDirectory, 0o700)
    service.closeAll()
  }
})
