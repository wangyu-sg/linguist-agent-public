/**
 * Asset source blobs: the original imported bytes persisted under the
 * project source/ dir (plan §5.2 layout). Export treats them as the
 * template (plan §6.3 hard rule), so they must survive import — PB-024
 * left this as a gap (asset rows only, no blob writes).
 *
 * Layout: <projectDir>/source/<assetId><ext> — ext comes from the asset
 * row's originalFilename (the asset id is content+filename derived, so
 * assetId and ext are always 1:1 and the path is deterministic). Writes
 * are atomic (tmp file + rename in the same directory).
 */

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { extname, join } from 'node:path'
import type { Asset } from '@linguist/cat-core'
import { StoreNotFoundError } from './errors'

/** File name of an asset's source blob inside the project source/ dir. */
export function assetSourceFileName(asset: Asset): string {
  return `${asset.id}${extname(asset.originalFilename)}`
}

/** Persist a source blob atomically; returns the file name written. */
export function saveAssetSourceFile(
  sourceDir: string,
  fileName: string,
  bytes: Uint8Array,
): void {
  mkdirSync(sourceDir, { recursive: true })
  const tmp = join(sourceDir, `.${fileName}.tmp-${process.pid}-${tmpCounter++}`)
  writeFileSync(tmp, bytes)
  renameSync(tmp, join(sourceDir, fileName))
}

/** Read a source blob back; missing blob -> STORE_NOT_FOUND. */
export function readAssetSourceFile(sourceDir: string, fileName: string): Uint8Array {
  const path = join(sourceDir, fileName)
  if (!existsSync(path)) throw new StoreNotFoundError('asset source blob', path)
  return readFileSync(path)
}

let tmpCounter = 0
