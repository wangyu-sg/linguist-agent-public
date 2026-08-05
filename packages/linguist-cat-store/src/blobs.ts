/**
 * Project blob storage (PB-095): file bytes of project assets (context
 * docs, style-guide screenshots) persisted under the project blobs/ dir
 * (plan §5.2 layout; the dir has been scaffolded since PB-024 but had no
 * consumer until now).
 *
 * Layout: <projectDir>/blobs/<blobId><ext> — ext comes from the original
 * filename; the id is content-derived by the caller, so the path is
 * deterministic and collision-free per content. Writes are atomic
 * (tmp file + rename in the same directory), same convention as
 * asset-source.ts. Rows in cat.db only store the blobs/-relative path,
 * never an absolute path.
 */

import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { extname, join } from 'node:path'
import { StoreNotFoundError } from './errors'

/** File name of a project blob inside the project blobs/ dir. */
export function projectBlobFileName(blobId: string, originalFilename: string): string {
  return `${blobId}${extname(originalFilename)}`
}

/** Persist a blob atomically; writing the same name again overwrites idempotently. */
export function saveProjectBlob(blobsDir: string, fileName: string, bytes: Uint8Array): void {
  mkdirSync(blobsDir, { recursive: true })
  const tmp = join(blobsDir, `.${fileName}.tmp-${process.pid}-${tmpCounter++}`)
  writeFileSync(tmp, bytes)
  renameSync(tmp, join(blobsDir, fileName))
}

/** Read a blob back; missing blob -> STORE_NOT_FOUND. */
export function readProjectBlob(blobsDir: string, fileName: string): Uint8Array {
  const path = join(blobsDir, fileName)
  if (!existsSync(path)) throw new StoreNotFoundError('project blob', fileName)
  return readFileSync(path)
}

/** Best-effort blob removal（删除行后的清尾；文件缺失不视为失败）。 */
export function removeProjectBlob(blobsDir: string, fileName: string): void {
  try {
    rmSync(join(blobsDir, fileName), { force: true })
  } catch {
    // 清尾失败不掀翻删除流程（残留的孤儿 blob 无害）。
  }
}

let tmpCounter = 0
