import {
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
} from 'node:fs'
import { join } from 'node:path'
import type { ExportRecord } from '@linguist/cat-store'
import { LINGUIST_ASSET_ID_PATTERN } from '@proma/shared'
import { writeJsonFileAtomic } from '../safe-file'

const MANIFEST_DIRECTORY = '.export-manifests'
const SHA256_PATTERN = /^[0-9a-f]{64}$/
const REVISION_PATTERN = /^rev-[0-9a-f]{64}$/
const EXPORT_ID_PATTERN = /^(?:exp-[0-9a-f]{16}|exp_v2_[0-9a-f]{64})$/

export interface LinguistExportManifest {
  schemaVersion: 1
  artifactId: string
  assetId: string
  sha256: string
  sizeBytes: number
  createdAt: string
  verifiedAt: string
  projectRevision: string
}

function manifestDirectory(exportsDir: string): string {
  return join(exportsDir, MANIFEST_DIRECTORY)
}

function isManifest(value: unknown): value is LinguistExportManifest {
  if (typeof value !== 'object' || value === null) return false
  const record = value as Partial<LinguistExportManifest>
  return record.schemaVersion === 1
    && typeof record.artifactId === 'string'
    && EXPORT_ID_PATTERN.test(record.artifactId)
    && typeof record.assetId === 'string'
    && LINGUIST_ASSET_ID_PATTERN.test(record.assetId)
    && typeof record.sha256 === 'string'
    && SHA256_PATTERN.test(record.sha256)
    && typeof record.sizeBytes === 'number'
    && Number.isSafeInteger(record.sizeBytes)
    && record.sizeBytes >= 0
    && typeof record.createdAt === 'string'
    && typeof record.verifiedAt === 'string'
    && typeof record.projectRevision === 'string'
    && REVISION_PATTERN.test(record.projectRevision)
}

export function recordLinguistExportManifest(input: {
  exportsDir: string
  stagingPath: string
  artifact: ExportRecord
  projectRevision: string
}): LinguistExportManifest {
  const staging = lstatSync(input.stagingPath)
  if (staging.isSymbolicLink() || !staging.isFile()) {
    throw new Error('[Linguist export] staging 不是普通文件')
  }
  const directory = manifestDirectory(input.exportsDir)
  const existingDirectory = lstatSync(directory, { throwIfNoEntry: false })
  if (existingDirectory?.isSymbolicLink()) {
    throw new Error('[Linguist export] manifest 目录不能是符号链接')
  }
  mkdirSync(directory, { recursive: true })
  const manifest: LinguistExportManifest = {
    schemaVersion: 1,
    artifactId: input.artifact.id,
    assetId: input.artifact.assetId,
    sha256: input.artifact.sha256,
    sizeBytes: staging.size,
    createdAt: input.artifact.createdAt,
    verifiedAt: new Date().toISOString(),
    projectRevision: input.projectRevision,
  }
  writeJsonFileAtomic(
    join(directory, `${input.artifact.id}.json`),
    manifest,
    true,
  )
  return manifest
}

export function readLinguistExportManifests(
  exportsDir: string,
): Map<string, LinguistExportManifest> {
  const directory = manifestDirectory(exportsDir)
  const stat = lstatSync(directory, { throwIfNoEntry: false })
  if (stat === undefined || stat.isSymbolicLink() || !stat.isDirectory()) {
    return new Map()
  }
  const manifests = new Map<string, LinguistExportManifest>()
  for (const name of readdirSync(directory)) {
    if (!name.endsWith('.json') || !EXPORT_ID_PATTERN.test(name.slice(0, -5))) continue
    const path = join(directory, name)
    const file = lstatSync(path, { throwIfNoEntry: false })
    if (file === undefined || file.isSymbolicLink() || !file.isFile()) continue
    try {
      const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'))
      if (isManifest(parsed)) manifests.set(parsed.artifactId, parsed)
    } catch {
      // 损坏或并发替换的 manifest 不进入可信展示投影。
    }
  }
  return manifests
}
