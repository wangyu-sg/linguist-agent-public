/**
 * LinguistProjectService 导入管道（node --test）：xliff/csv/json 端到端、
 * 超限拒绝、不支持格式穿透、无路径 API 形状。bun 无 node:sqlite，
 * 本文件不被 bun test 拾取（*.nodetest.ts）。
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import {
  CatFormatRegistry,
  CSV_ADAPTER_ID,
  FormatUnsupportedError,
  JSON_ADAPTER_ID,
  sha256Hex,
  XLIFF_ADAPTER_ID,
  type CatFormatAdapter,
} from '@linguist/cat-formats'
import { assetSourceFileName } from '@linguist/cat-store'
import { LinguistImportTooLargeError } from './errors'
import { LinguistProjectService, MAX_IMPORT_BYTES } from './project-service'
import { INPUT, makeClock, makeEntropy, makeService, makeTempDir, readFixture } from './test/service-testkit'

test('import xliff end-to-end: detect → parse → asset/segments + source blob', async () => {
  const service = makeService()
  try {
    const project = service.createProject(INPUT)
    const bytes = readFixture('mini_game_ui.xliff')
    const result = await service.importAsset(project.id, { bytes, filename: 'mini_game_ui.xliff' })

    assert.equal(result.formatId, XLIFF_ADAPTER_ID)
    assert.ok(result.segmentCount > 0)
    assert.equal(result.sourceSha256, sha256Hex(bytes))
    assert.ok(Array.isArray(result.warnings))

    const db = service.openProject(project.id)
    const asset = db.assets.get(result.assetId)
    assert.ok(asset !== undefined)
    assert.equal(asset.segmentCount, result.segmentCount)
    assert.equal(asset.originalFilename, 'mini_game_ui.xliff')

    // source blob 持久化且经 sha256 校验往返一致
    const roundtrip = db.readAssetSource(result.assetId)
    assert.equal(sha256Hex(roundtrip), result.sourceSha256)
    assert.equal(roundtrip.byteLength, bytes.byteLength)
    const blobName = assetSourceFileName(asset)
    assert.ok(existsSync(join(service.getProjectPaths(project.id).sourceDir, blobName)))
  } finally {
    service.closeAll()
  }
})

test('import csv end-to-end', async () => {
  const service = makeService()
  try {
    const project = service.createProject(INPUT)
    const bytes = readFixture('mini_dialogue.csv')
    const result = await service.importAsset(project.id, { bytes, filename: 'mini_dialogue.csv' })
    assert.equal(result.formatId, CSV_ADAPTER_ID)
    assert.ok(result.segmentCount > 0)
    assert.equal(result.sourceSha256, sha256Hex(bytes))

    const db = service.openProject(project.id)
    assert.equal(db.assets.get(result.assetId)?.segmentCount, result.segmentCount)
  } finally {
    service.closeAll()
  }
})

test('new asset import returns unknown Tag evidence without activation; holdout gates activation', async () => {
  const service = makeService()
  try {
    const project = service.createProject(INPUT)
    const bytes = new TextEncoder().encode([
      'key,source,target',
      'a,"Use [Grm:Qty=1] now","使用 [Grm:Qty=1]"',
      'b,"Use [Grm:Qty=2] now","使用 [Grm:Qty=2]"',
      'c,"Translate [Damage]","翻译 [Damage]"',
    ].join('\n'))
    const imported = await service.importAsset(project.id, { bytes, filename: 'unknown-tags.csv' })
    const quantity = imported.unknownTagSummary.find((item) => item.patternShape === '[Grm:Qty={number}]')
    assert.ok(quantity)
    assert.equal(service.getProject(project.id).tagProfile, undefined, 'import must never activate a profile')
    const evidenceId = quantity.examples.find((item) => item.side === 'source')?.id
    assert.ok(evidenceId)
    const base = {
      name: 'Grm quantity',
      kind: 'standalone' as const,
      evidenceExampleIds: [evidenceId],
      confidence: 0.95,
      explanation: '客户数量指令',
    }

    const broad = service.saveTagProfileCandidate(project.id, { ...base, regex: '\\[[^\\]]+\\]' })
    assert.equal(broad.validation?.saveable, true)
    assert.equal(broad.validation?.valid, false)
    assert.equal(broad.validation?.activationReady, false)
    await assert.rejects(
      async () => service.updateTagProfile(project.id, broad.candidate!.id, 'activate'),
      /误报率|holdout/,
    )

    const narrow = service.saveTagProfileCandidate(project.id, { ...base, regex: '\\[Grm:Qty=\\d+\\]' })
    assert.equal(narrow.validation?.activationReady, true)
    const activated = service.updateTagProfile(project.id, narrow.candidate!.id, 'activate')
    assert.ok(activated.tagProfile.families.some((family) => family.id === narrow.candidate!.id))
  } finally {
    service.closeAll()
  }
})

test('import json end-to-end', async () => {
  const service = makeService()
  try {
    const project = service.createProject(INPUT)
    const bytes = readFixture('mini_items.json')
    const result = await service.importAsset(project.id, { bytes, filename: 'mini_items.json' })
    assert.equal(result.formatId, JSON_ADAPTER_ID)
    assert.ok(result.segmentCount > 0)
    assert.equal(result.sourceSha256, sha256Hex(bytes))

    const db = service.openProject(project.id)
    assert.equal(db.assets.get(result.assetId)?.segmentCount, result.segmentCount)
  } finally {
    service.closeAll()
  }
})

test('exact source duplicate is skipped before format parsing, including a renamed unsupported extension', async () => {
  const service = makeService()
  try {
    const project = service.createProject(INPUT)
    const bytes = readFixture('mini_game_ui.xliff')
    const first = await service.importAsset(project.id, { bytes, filename: 'source.xliff' })
    const duplicate = await service.importAsset(project.id, { bytes, filename: 'renamed.bin' })

    assert.equal(duplicate.status, 'skipped-duplicate')
    assert.equal(duplicate.assetId, first.assetId)
    assert.equal(duplicate.formatId, first.formatId)
    assert.equal(duplicate.sourceSha256, first.sourceSha256)
    assert.equal(service.openProject(project.id).assets.listByProject().length, 1)
  } finally {
    service.closeAll()
  }
})

test('unsupported format passes FormatUnsupportedError through (FORMAT_UNSUPPORTED)', async () => {
  const service = makeService()
  try {
    const project = service.createProject(INPUT)
    const garbage = new Uint8Array([0x00, 0x01, 0x02, 0x03, 0xff, 0xfe, 0xfd])
    await assert.rejects(
      () => service.importAsset(project.id, { bytes: garbage, filename: 'data.bin' }),
      (err: unknown) => {
        assert.ok(err instanceof FormatUnsupportedError)
        assert.equal(err.code, 'FORMAT_UNSUPPORTED')
        return true
      },
    )
  } finally {
    service.closeAll()
  }
})

test('oversize payload rejected before any parsing (IMPORT_TOO_LARGE), nothing persisted', async () => {
  const service = makeService()
  try {
    const project = service.createProject(INPUT)
    const bytes = new Uint8Array(MAX_IMPORT_BYTES + 1)
    await assert.rejects(
      () => service.importAsset(project.id, { bytes, filename: 'big.xliff' }),
      (err: unknown) => {
        assert.ok(err instanceof LinguistImportTooLargeError)
        assert.equal(err.code, 'IMPORT_TOO_LARGE')
        assert.equal(err.sizeBytes, MAX_IMPORT_BYTES + 1)
        assert.equal(err.limitBytes, MAX_IMPORT_BYTES)
        return true
      },
    )
    const db = service.openProject(project.id)
    assert.equal(db.assets.listByProject().length, 0)
  } finally {
    service.closeAll()
  }
})

test('API takes bytes+filename only: a path-like filename is metadata, never touched on disk', async () => {
  const service = makeService()
  try {
    const project = service.createProject(INPUT)
    const bytes = readFixture('mini_game_ui.xliff')
    // 磁盘上不存在该路径——若服务把 filename 当文件系统路径读取必然失败
    const weirdName = 'some/nested/dir/mini_game_ui.xliff'
    const result = await service.importAsset(project.id, { bytes, filename: weirdName })
    assert.equal(result.formatId, XLIFF_ADAPTER_ID)
    assert.ok(result.segmentCount > 0)

    const db = service.openProject(project.id)
    const asset = db.assets.get(result.assetId)
    assert.equal(asset?.originalFilename, weirdName)
    // source blob 文件名由 assetId + 扩展名构成，无路径穿越
    const blobName = assetSourceFileName(asset!)
    assert.ok(!blobName.includes('/') && !blobName.includes('\\'))
    assert.ok(existsSync(join(service.getProjectPaths(project.id).sourceDir, blobName)))
  } finally {
    service.closeAll()
  }
})

test('PB-110: blob written before asset row — a sha-lying adapter fails with zero asset rows and zero blobs', async () => {
  // 谎报 sourceSha256 的 adapter：旧次序会先插 asset 行再在 saveAssetSource
  // 抛 mismatch（行在、blob 缺）；新次序在插行之前拒绝，项目零残留。
  const lyingAdapter: CatFormatAdapter = {
    id: 'lying_sha',
    extensions: ['.lie'],
    detect: async (_bytes, filename) => (filename.endsWith('.lie') ? 1 : 0),
    import: async (input) => ({
      asset: {
        formatId: 'lying_sha',
        originalFilename: input.filename,
        sourceSha256: '0'.repeat(64), // 故意与真实字节 sha 不符
        segmentCount: 1,
      },
      segments: [{
        ordinal: 0,
        key: 'k0',
        source: 's',
        target: '',
        sourceLocale: input.sourceLocale,
        targetLocale: input.targetLocale,
        status: 'untranslated',
        locked: false,
        revision: 0,
        sourceHash: 'h0',
      }],
      warnings: [],
      originalBytes: input.bytes,
    }),
    export: async () => {
      throw new Error('never reached')
    },
  }
  const registry = new CatFormatRegistry().register(lyingAdapter)
  const rootDir = makeTempDir()
  let workspaceSeq = 0
  const service = new LinguistProjectService({
    rootDir,
    registry,
    entropy: makeEntropy('pb-110-import-order'),
    now: makeClock(),
    workspaceCreator: () => `ws-pb110-${++workspaceSeq}`,
  })
  service.init()
  try {
    const project = service.createProject(INPUT)
    await assert.rejects(
      () => service.importAsset(project.id, { bytes: new Uint8Array([1, 2, 3]), filename: 'bad.lie' }),
      (err: unknown) => (err as { code?: string }).code === 'STORE_ASSET_SOURCE_MISMATCH',
    )
    const db = service.openProject(project.id)
    assert.equal(db.assets.listByProject().length, 0, '次序调换后失败不得留下 asset 行')
    // mismatch 在一字节写盘之前抛出：source/ 目录即使已预建也必须为空
    const sourceDir = service.getProjectPaths(project.id).sourceDir
    if (existsSync(sourceDir)) {
      assert.deepEqual(readdirSync(sourceDir), [], 'mismatch 不得留下任何 source blob')
    }
    assert.equal(service.checkProjectHealth(project.id).healthy, true)
  } finally {
    service.closeAll()
  }
})
