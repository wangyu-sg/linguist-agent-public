import { extname, join } from 'node:path'
import type { ContextAnchorLocator, ProjectId } from '@linguist/cat-core'
import { sha256Hex } from '@linguist/cat-formats'
import { ProjectDatabase, readProjectManifestFile, saveProjectBlob, type ContextDoc } from '@linguist/cat-store'
import { extractContext, formatContextExtractionText } from './context-extractor'
import { LinguistProjectArchivedError } from './errors'
import { isContextDocImageExtension } from './project-resource-parsers'
import type { ImportContextDocInput } from './project-service-types'

export interface ContextImportWorkerRequest {
  projectId: ProjectId
  projectDir: string
  input: ImportContextDocInput
}

/** 同一只读提取过程供预检和正式写入使用。 */
export async function prepareContextImport(input: ImportContextDocInput) {
  const sha256 = sha256Hex(input.bytes)
  const extension = extname(input.filename).toLowerCase()
  const kind: ContextDoc['kind'] = isContextDocImageExtension(extension) ? 'image' : 'doc'
  const extraction = await extractContext(input.bytes, input.filename)
  const textExtract = formatContextExtractionText(extraction)
  return { sha256, extension, kind, extraction, textExtract }
}

/** 抽取、关联和事务写入都在 CAT worker 内完成，主线程不搬运大表锚点。 */
export async function importContextInWorker({ projectId, projectDir, input }: ContextImportWorkerRequest): Promise<ContextDoc> {
  const { sha256, extension, kind, extraction, textExtract } = await prepareContextImport(input)
  const manifest = readProjectManifestFile(join(projectDir, 'project.json'))
  if (manifest.archivedAt !== undefined) throw new LinguistProjectArchivedError(projectId)
  const db = ProjectDatabase.open(join(projectDir, 'cat.db'), { projectId, trustedManifest: manifest })
  try {
    return db.catDb.transaction(`import Context extraction ${input.filename}`, () => {
      const blobName = `ctx-${sha256.slice(0, 16)}${extension}`
      saveProjectBlob(db.blobsDir, blobName, input.bytes)
      const doc = db.contextDocs.insert({
        kind,
        originalFilename: input.filename,
        blobRelpath: `blobs/${blobName}`,
        sha256,
        ...(input.note !== undefined ? { note: input.note } : {}),
        ...(textExtract !== undefined ? { textExtract } : {}),
        extractionWarnings: extraction.warnings,
      })
      const mediaDocIds = new Map<string, string>()
      for (const media of extraction.media) {
        if (kind === 'image' && media.sha256 === sha256) {
          mediaDocIds.set(media.id, doc.id)
          continue
        }
        const mediaExtension = extname(media.filename).toLowerCase()
        const mediaBlobName = `ctx-${media.sha256.slice(0, 16)}${mediaExtension}`
        saveProjectBlob(db.blobsDir, mediaBlobName, media.bytes)
        const mediaDoc = db.contextDocs.insert({
          kind: 'image',
          originalFilename: media.filename,
          blobRelpath: `blobs/${mediaBlobName}`,
          sha256: media.sha256,
          note: `从 ${input.filename} 提取的视觉附件`,
          parentContextDocId: doc.id,
        })
        mediaDocIds.set(media.id, mediaDoc.id)
      }
      const sections = new Map(extraction.textSections.map((section) => [section.id, section.text]))
      db.contextDocs.replaceExtraction(doc.id, extraction.anchors.map((anchor) => {
        const extractedMediaId = anchor.mediaId
          ?? (anchor.locator.kind === 'image' ? anchor.locator.mediaId : undefined)
        const mediaContextDocId = extractedMediaId === undefined
          ? undefined
          : mediaDocIds.get(extractedMediaId)
        if (extractedMediaId !== undefined && mediaContextDocId === undefined) {
          throw new Error(`Context extraction anchor ${anchor.id} references unknown media`)
        }
        const locator: ContextAnchorLocator = anchor.locator.kind === 'image'
          ? { ...anchor.locator, mediaId: mediaContextDocId as string }
          : anchor.locator
        return {
          id: anchor.id,
          locator,
          ...(anchor.label === undefined ? {} : { label: anchor.label }),
          ...(anchor.textSectionId === undefined ? {} : { text: sections.get(anchor.textSectionId) }),
          ...(mediaContextDocId === undefined ? {} : { mediaContextDocId }),
        }
      }))
      db.contextDocs.linkExtractionByExactText(doc.id, `exact-v1:${sha256}`)
      console.log(
        `[Linguist] 已导入 context 文档: 项目 ${projectId}（kind=${kind}，${input.bytes.length} 字节，媒体 ${extraction.media.length}）`,
      )
      return doc
    })
  } finally {
    db.close()
  }
}
