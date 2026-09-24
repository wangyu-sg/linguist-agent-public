import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import type { LinguistProjectService } from './project-service'
import { importProjectResources } from './project-file-intake'

const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })))
})

describe('项目文件导入', () => {
  test('显式 Context XLSX 不要求双语列 mapping', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'linguist-context-xlsx-'))
    temporaryDirectories.push(directory)
    const filePath = join(directory, 'visual-brief.xlsx')
    await writeFile(filePath, new Uint8Array([1, 2, 3]))
    let mappingRequested = false
    const service = {
      assertProjectWritable() {},
      openProject() {
        return { assets: { listByProject: () => [] } }
      },
      getProject() {
        return { sourceLocale: 'en', targetLocale: 'zh-CN' }
      },
      async resolveWorkbookMapping() {
        mappingRequested = true
        return undefined
      },
      async importContextDoc() {
        return {
          id: 'ctx-brief',
          kind: 'doc' as const,
          originalFilename: 'visual-brief.xlsx',
          blobRelpath: 'blobs/ctx-brief.xlsx',
          sha256: 'a'.repeat(64),
          extractionWarnings: [],
          createdAt: '2026-08-28T00:00:00.000Z',
        }
      },
    } as unknown as LinguistProjectService

    const result = await importProjectResources(service, 'project-1', directory, {
      paths: [filePath], recursive: false, kind: 'context', dryRun: false,
    })

    expect(mappingRequested).toBe(false)
    expect(result.imported).toBe(1)
    expect(result.items[0]?.resourceId).toBe('ctx-brief')
  })
})
