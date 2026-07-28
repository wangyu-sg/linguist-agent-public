/**
 * PB-073 Native Save：renderer 只提交 project/asset id，主进程持有 staging
 * 文件并经原生 Save picker 复制到用户选定位置。node --test 以真实服务和
 * picker stub 验证该信任边界，不依赖 Electron GUI。
 */

import assert from 'node:assert/strict'
import { existsSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import {
  createLinguistExportIpc,
  type LinguistExportSavePickerOptions,
  type LinguistExportSavePicker,
} from './export-ipc'
import type { LinguistProjectService } from './project-service'
import { INPUT, makeService, makeTempDir, readFixture } from './test/service-testkit'

function makeIpc(service: LinguistProjectService) {
  return createLinguistExportIpc({ getService: () => service })
}

function makePicker(filePath: string | undefined): {
  picker: LinguistExportSavePicker
  calls: () => number
  lastOptions: () => LinguistExportSavePickerOptions | undefined
} {
  let calls = 0
  let options: LinguistExportSavePickerOptions | undefined
  const picker: LinguistExportSavePicker = async (nextOptions) => {
    calls += 1
    options = nextOptions
    return filePath === undefined
      ? { canceled: true }
      : { canceled: false, filePath }
  }
  return { picker, calls: () => calls, lastOptions: () => options }
}

async function makeImportedAsset(service: LinguistProjectService) {
  const project = service.createProject(INPUT)
  const imported = await service.importAsset(project.id, {
    bytes: readFixture('mini_dialogue.csv'),
    filename: 'mini_dialogue.csv',
  })
  return { project, imported }
}

function makeDeliveryReady(
  service: LinguistProjectService,
  projectId: string,
  assetId: string,
): void {
  const db = service.openProject(projectId)
  for (const segment of db.segments.query({ assetId, limit: 200 })) {
    if (segment.locked) continue
    const edited = segment.target === ''
      ? db.segments.applyTargetEdit(
          segment.id,
          `测试译文 ${segment.ordinal + 1}`,
          segment.revision,
        ).segment
      : segment
    db.segments.confirmCurrentStage(edited.id, 'translation', edited.revision)
  }
}

test('PB-073: stages, opens native Save picker, copies to user destination, and returns opaque artifact metadata', async () => {
  const service = makeService()
  try {
    const { project, imported } = await makeImportedAsset(service)
    makeDeliveryReady(service, project.id, imported.assetId)
    const destination = join(makeTempDir(), 'translated-dialogue.csv')
    const { picker, calls, lastOptions } = makePicker(destination)

    const result = await makeIpc(service).saveAsset({ projectId: project.id, assetId: imported.assetId }, picker)

    assert.equal(result.ok, true)
    if (!result.ok || result.data.cancelled) return
    assert.equal(calls(), 1)
    assert.deepEqual(lastOptions(), {
      title: '导出翻译资产',
      defaultPath: 'mini_dialogue.translated.zh-CN.csv',
    })
    assert.equal(result.data.filename, 'translated-dialogue.csv')
    assert.equal(result.data.verifiedSegments, imported.segmentCount)
    assert.equal(result.data.artifact.assetId, imported.assetId)
    assert.match(result.data.artifact.id, /^exp-[0-9a-f]{16}$/)
    assert.match(result.data.artifact.sha256, /^[0-9a-f]{64}$/)
    assert.equal(result.data.artifact.segmentCount, imported.segmentCount)
    assert.deepEqual(
      Object.keys(result.data.artifact).sort(),
      ['assetId', 'createdAt', 'id', 'segmentCount', 'sha256'],
    )
    assert.equal(existsSync(destination), true)
    assert.deepEqual(readFileSync(destination), readFileSync(join(service.getProjectPaths(project.id).projectDir, service.openProject(project.id).exports.listByAsset(imported.assetId)[0]!.path)))
  } finally {
    service.closeAll()
  }
})

test('AC-006: existing destinations fail closed without modifying the original bytes', async () => {
  const service = makeService()
  try {
    const { project, imported } = await makeImportedAsset(service)
    makeDeliveryReady(service, project.id, imported.assetId)
    const destination = join(makeTempDir(), 'mini_dialogue.csv')
    writeFileSync(destination, 'ORIGINAL')

    const result = await makeIpc(service).saveAsset(
      { projectId: project.id, assetId: imported.assetId },
      makePicker(destination).picker,
    )

    assert.equal(result.ok, false)
    if (!result.ok) {
      assert.equal(result.error.code, 'INVALID_INPUT')
      assert.match(result.error.message, /已存在/)
      assert.equal(result.error.message.includes(destination), false)
    }
    assert.equal(readFileSync(destination, 'utf8'), 'ORIGINAL')
  } finally {
    service.closeAll()
  }
})

test('AC-006: direct and symlinked destinations under managed data fail closed', async () => {
  const service = makeService()
  try {
    const { project, imported } = await makeImportedAsset(service)
    makeDeliveryReady(service, project.id, imported.assetId)
    const ipc = makeIpc(service)
    const direct = await ipc.saveAsset(
      { projectId: project.id, assetId: imported.assetId },
      makePicker(join(service.rootDir, 'blocked.csv')).picker,
    )
    assert.equal(direct.ok, false)
    if (!direct.ok) {
      assert.equal(direct.error.code, 'INVALID_INPUT')
      assert.match(direct.error.message, /受管数据目录/)
    }

    const alias = join(makeTempDir(), 'managed-alias')
    symlinkSync(service.rootDir, alias, process.platform === 'win32' ? 'junction' : 'dir')
    const aliased = await ipc.saveAsset(
      { projectId: project.id, assetId: imported.assetId },
      makePicker(join(alias, 'blocked.csv')).picker,
    )
    assert.equal(aliased.ok, false)
    if (!aliased.ok) {
      assert.equal(aliased.error.code, 'INVALID_INPUT')
      assert.match(aliased.error.message, /受管数据目录/)
    }
    assert.equal(existsSync(join(service.rootDir, 'blocked.csv')), false)
  } finally {
    service.closeAll()
  }
})

test('PB-073: cancellation is normal and never creates a user destination', async () => {
  const service = makeService()
  try {
    const { project, imported } = await makeImportedAsset(service)
    makeDeliveryReady(service, project.id, imported.assetId)
    const { picker, calls } = makePicker(undefined)

    const result = await makeIpc(service).saveAsset({ projectId: project.id, assetId: imported.assetId }, picker)

    assert.equal(result.ok, true)
    if (result.ok) assert.deepEqual(result.data, { cancelled: true })
    assert.equal(calls(), 1)
  } finally {
    service.closeAll()
  }
})

test('PB-073: invalid id, blocking QA and archived projects fail before native Save picker', async () => {
  const service = makeService()
  try {
    const { project, imported } = await makeImportedAsset(service)
    const { picker, calls } = makePicker(join(makeTempDir(), 'should-not-exist.csv'))
    const ipc = makeIpc(service)

    const invalid = await ipc.saveAsset({ projectId: project.id, assetId: 'bad' }, picker)
    assert.equal(invalid.ok, false)
    if (!invalid.ok) assert.equal(invalid.error.code, 'INVALID_INPUT')

    service.runQa(project.id)
    const blocked = await ipc.saveAsset({ projectId: project.id, assetId: imported.assetId }, picker)
    assert.equal(blocked.ok, false)
    if (!blocked.ok) assert.equal(blocked.error.code, 'EXPORT_BLOCKED_BY_QA')

    service.archiveProject(project.id)
    const archived = await ipc.saveAsset({ projectId: project.id, assetId: imported.assetId }, picker)
    assert.equal(archived.ok, false)
    if (!archived.ok) assert.equal(archived.error.code, 'PROJECT_ARCHIVED')
    assert.equal(calls(), 0)
  } finally {
    service.closeAll()
  }
})

test('PB-102: list reads the project exports/ directory and returns path-free display projection', async () => {
  const service = makeService()
  try {
    const { project, imported } = await makeImportedAsset(service)

    // 未导出过：exports/ 尚未创建，空列表是正常分支
    const empty = await makeIpc(service).list({ projectId: project.id })
    assert.equal(empty.ok, true)
    if (empty.ok) assert.deepEqual(empty.data, [])

    await service.stageExport(project.id, imported.assetId)

    const result = await makeIpc(service).list({ projectId: project.id })
    assert.equal(result.ok, true)
    if (!result.ok) return
    assert.equal(result.data.length, 1)
    const file = result.data[0]!
    assert.equal(file.assetId, imported.assetId)
    assert.match(file.filename, new RegExp(`^${imported.assetId}-[0-9a-f]{16}-`))
    assert.equal(file.sizeBytes > 0, true)
    assert.equal(typeof file.modifiedAt, 'number')
    // §7.4：投影绝不携带文件系统路径
    assert.deepEqual(Object.keys(file).sort(), ['assetId', 'filename', 'modifiedAt', 'sizeBytes'])
    assert.equal(file.filename.includes('/'), false)
  } finally {
    service.closeAll()
  }
})

test('PB-102: list validates projectId and maps unknown project to PROJECT_NOT_FOUND', async () => {
  const service = makeService()
  try {
    const ipc = makeIpc(service)

    const invalid = await ipc.list({ projectId: 'bad' })
    assert.equal(invalid.ok, false)
    if (!invalid.ok) assert.equal(invalid.error.code, 'INVALID_INPUT')

    const missing = await ipc.list({ projectId: 'prj-0000000000000000' })
    assert.equal(missing.ok, false)
    if (!missing.ok) assert.equal(missing.error.code, 'PROJECT_NOT_FOUND')
  } finally {
    service.closeAll()
  }
})

test('Prepare Delivery IPC: 返回无路径的预检报告，未就绪时不打开 Save picker', async () => {
  const service = makeService()
  try {
    const { project, imported } = await makeImportedAsset(service)
    const ipc = makeIpc(service)
    const prepared = await ipc.prepareAsset({
      projectId: project.id,
      assetId: imported.assetId,
    })
    assert.equal(prepared.ok, true)
    if (!prepared.ok) return
    assert.equal(prepared.data.preflight.ready, false)
    assert.equal(prepared.data.verification, undefined)
    assert.equal(JSON.stringify(prepared.data).includes(service.rootDir), false)

    const { picker, calls } = makePicker(join(makeTempDir(), 'must-not-exist.csv'))
    const save = await ipc.saveAsset(
      { projectId: project.id, assetId: imported.assetId },
      picker,
    )
    assert.equal(save.ok, false)
    if (!save.ok) assert.equal(save.error.code, 'DELIVERY_NOT_READY')
    assert.equal(calls(), 0)
  } finally {
    service.closeAll()
  }
})
