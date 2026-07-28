import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { createAsset } from '@linguist/cat-core'
import { sha256Hex } from '@linguist/cat-formats'
import {
  StoreAssetSourceMismatchError,
  StoreNotFoundError,
  StoreReadOnlyError,
} from './errors'
import { CatStore } from './store'
import { assetSourceFileName } from './asset-source'
import { makeClock, makeEntropy, makeImportedAsset, makeTempDir } from './testkit'

const INPUT = { name: 'P', sourceLocale: 'en', targetLocale: 'zh-CN', promaWorkspaceId: 'ws' }

function setup(options: { filename?: string; bytes?: Uint8Array } = {}) {
  const rootDir = makeTempDir()
  const store = new CatStore({ rootDir, entropy: makeEntropy(), now: makeClock() })
  const project = store.createProject(INPUT)
  const bytes = options.bytes ?? new TextEncoder().encode('original file bytes \x00\x01 binary')
  const imported = makeImportedAsset({
    segmentCount: 1,
    filename: options.filename ?? 'strings.xliff',
    sourceSha256: sha256Hex(bytes),
  })
  const db = store.openProject(project.id)
  const { asset } = db.assets.insertImported(imported)
  return { store, project, db, asset, bytes }
}

test('asset source: save -> read roundtrip preserves exact bytes and returns source/ path', () => {
  const { store, project, db, asset, bytes } = setup()
  try {
    const relPath = db.saveAssetSource(asset.id, bytes)
    assert.equal(relPath, `source/${asset.id}.xliff`)
    const onDisk = join(store.index.projectDir(project.id), 'source', `${asset.id}.xliff`)
    assert.ok(existsSync(onDisk))
    assert.deepEqual(new Uint8Array(readFileSync(onDisk)), bytes)

    const readBack = db.readAssetSource(asset.id)
    assert.deepEqual(new Uint8Array(readBack), bytes)
  } finally {
    db.close()
  }
})

test('asset source: read of a missing blob -> STORE_NOT_FOUND', () => {
  const { db, asset } = setup()
  try {
    assert.throws(() => db.readAssetSource(asset.id), (err: unknown) => {
      assert.ok(err instanceof StoreNotFoundError)
      assert.equal(err.code, 'STORE_NOT_FOUND')
      return true
    })
  } finally {
    db.close()
  }
})

test('asset source: save/read for an unknown asset -> STORE_NOT_FOUND', () => {
  const { db, bytes } = setup()
  try {
    assert.throws(() => db.saveAssetSource('ast-0000000000000000', bytes), StoreNotFoundError)
    assert.throws(() => db.readAssetSource('ast-0000000000000000'), StoreNotFoundError)
  } finally {
    db.close()
  }
})

test('asset source: save with bytes that do not match sourceSha256 -> mismatch, nothing written', () => {
  const { store, project, db, asset } = setup()
  try {
    const wrong = new TextEncoder().encode('different bytes')
    assert.throws(
      () => db.saveAssetSource(asset.id, wrong),
      (err: unknown) => {
        assert.ok(err instanceof StoreAssetSourceMismatchError)
        assert.equal(err.code, 'STORE_ASSET_SOURCE_MISMATCH')
        return true
      },
    )
    const onDisk = join(store.index.projectDir(project.id), 'source', `${asset.id}.xliff`)
    assert.equal(existsSync(onDisk), false)
  } finally {
    db.close()
  }
})

test('asset source: read of a tampered blob -> STORE_ASSET_SOURCE_MISMATCH', () => {
  const { store, project, db, asset, bytes } = setup()
  try {
    db.saveAssetSource(asset.id, bytes)
    const onDisk = join(store.index.projectDir(project.id), 'source', `${asset.id}.xliff`)
    writeFileSync(onDisk, new TextEncoder().encode('corrupted'))
    assert.throws(() => db.readAssetSource(asset.id), StoreAssetSourceMismatchError)
  } finally {
    db.close()
  }
})

test('asset source: read-only handle rejects save but allows read', () => {
  const { store, project, db, asset, bytes } = setup()
  db.saveAssetSource(asset.id, bytes)
  db.close()

  const readOnly = store.openProject(project.id, { readOnly: true })
  try {
    assert.throws(
      () => readOnly.saveAssetSource(asset.id, bytes),
      (err: unknown) => {
        assert.ok(err instanceof StoreReadOnlyError)
        assert.equal(err.code, 'STORE_READ_ONLY')
        return true
      },
    )
    assert.deepEqual(new Uint8Array(readOnly.readAssetSource(asset.id)), bytes)
  } finally {
    readOnly.close()
  }
})

test('asset source: overwrite is idempotent; filename without extension yields bare assetId blob', () => {
  const { db, asset, bytes } = setup({ filename: 'noext' })
  try {
    assert.equal(assetSourceFileName(asset), asset.id)
    assert.equal(db.saveAssetSource(asset.id, bytes), `source/${asset.id}`)
    db.saveAssetSource(asset.id, bytes) // same bytes again: overwrite, no error
    assert.deepEqual(new Uint8Array(db.readAssetSource(asset.id)), bytes)
  } finally {
    db.close()
  }
})

test('PB-110 saveAssetSourceForImport: blob before the asset row; mismatch/read-only reject without writing', () => {
  const rootDir = makeTempDir()
  const store = new CatStore({ rootDir, entropy: makeEntropy(), now: makeClock() })
  const project = store.createProject(INPUT)
  const bytes = new TextEncoder().encode('blob-first import bytes')
  const imported = makeImportedAsset({
    segmentCount: 2,
    filename: 'blob-first.xliff',
    sourceSha256: sha256Hex(bytes),
  })
  const db = store.openProject(project.id)
  try {
    // 与 insertImported 内部同参推导 asset（id 内容寻址，必然一致）。
    const preview = createAsset({
      projectId: project.id,
      formatId: imported.asset.formatId,
      originalFilename: imported.asset.originalFilename,
      sourceSha256: imported.asset.sourceSha256,
      segmentCount: imported.asset.segmentCount,
    })
    // 行不在也能写 blob；写完读回仍要求行在场（readAssetSource → STORE_NOT_FOUND）。
    assert.equal(db.saveAssetSourceForImport(preview, bytes), `source/${preview.id}.xliff`)
    assert.throws(() => db.readAssetSource(preview.id), StoreNotFoundError)

    const { asset } = db.assets.insertImported(imported)
    assert.equal(asset.id, preview.id)
    assert.deepEqual(new Uint8Array(db.readAssetSource(asset.id)), bytes)

    // sha 与字节不符 → mismatch 且一字节不写
    const wrongSha = createAsset({
      projectId: project.id,
      formatId: imported.asset.formatId,
      originalFilename: 'other.xliff',
      sourceSha256: 'f'.repeat(64),
      segmentCount: 1,
    })
    assert.throws(() => db.saveAssetSourceForImport(wrongSha, bytes), StoreAssetSourceMismatchError)
    assert.equal(
      existsSync(join(store.index.projectDir(project.id), 'source', `${wrongSha.id}.xliff`)),
      false,
    )
  } finally {
    db.close()
  }

  // 只读句柄拒绝（归档项目的导入路径同理被服务层先行拒绝）
  const readOnly = store.openProject(project.id, { readOnly: true })
  try {
    const preview = createAsset({
      projectId: project.id,
      formatId: 'fake_tsv',
      originalFilename: 'ro.xliff',
      sourceSha256: sha256Hex(bytes),
      segmentCount: 1,
    })
    assert.throws(() => readOnly.saveAssetSourceForImport(preview, bytes), StoreReadOnlyError)
  } finally {
    readOnly.close()
  }
})
