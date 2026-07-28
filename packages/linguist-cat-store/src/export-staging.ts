/**
 * PB-072 export staging: the persisted source template plus the current
 * Segment targets become a verified artifact under the owning project's
 * exports/ directory. Nothing ever writes back to source/.
 */

import { mkdirSync, renameSync, writeFileSync } from 'node:fs'
import { basename, extname, join } from 'node:path'
import {
  nativeStatusForStage,
  normalizeWorkflowStage,
  type LinguistProject,
  type Segment,
} from '@linguist/cat-core'
import {
  FormatExportError,
  FormatSegmentLostError,
  PHRASE_MXLIFF_ADAPTER_ID,
  SDLXLIFF_ADAPTER_ID,
  XLIFF_ADAPTER_ID,
  sha256Hex,
  type CatFormatAdapter,
} from '@linguist/cat-formats'
import { StoreNotFoundError } from './errors'
import type { ProjectDatabase } from './project-database'
import type { ExportRecord } from './repositories/exports'

const SEGMENT_PAGE_SIZE = 500

export interface StageAssetExportInput {
  project: LinguistProject
  projectDir: string
  db: ProjectDatabase
  assetId: string
  adapter: CatFormatAdapter
}

export interface StagedAssetExport {
  artifact: ExportRecord
  /** Main-process-only absolute staging path; never supplied by renderer input. */
  stagingPath: string
  /** Path relative to the project's own directory, always under exports/. */
  relativePath: string
  /** 原生 Save 对话框默认文件名；仅 basename，绝非源路径。 */
  suggestedFilename: string
  verifiedSegments: number
  verification: ExportVerification
}

export interface ExportVerification {
  verifiedSourceSegments: number
  verifiedTargetSegments: number
  verifiedNativeStatusSegments: number
  changedTargetSegments: number
  changedNativeStatusSegments: number
  tagsPreserved: boolean
}

/** Read all segments despite the repository's intentionally paged UI default. */
function readAssetSegments(db: ProjectDatabase, assetId: string): Segment[] {
  const segments: Segment[] = []
  for (let offset = 0; ; offset += SEGMENT_PAGE_SIZE) {
    const page = db.segments.query({ assetId, limit: SEGMENT_PAGE_SIZE, offset })
    segments.push(...page)
    if (page.length < SEGMENT_PAGE_SIZE) return segments
  }
}

function positionOf(segment: Pick<Segment, 'ordinal' | 'key'>): string {
  return `${segment.ordinal}\u0000${segment.key ?? ''}`
}

const XML_INLINE_FORMAT_IDS: ReadonlySet<string> = new Set([
  XLIFF_ADAPTER_ID,
  SDLXLIFF_ADAPTER_ID,
  PHRASE_MXLIFF_ADAPTER_ID,
])

const INLINE_TAG_PATTERN = /<\/?[\w:.-]+\b[^>]*\/?>/gu

function normalizeSerializedTag(tag: string): string {
  return tag
    .replace(/&quot;/gu, '"')
    .replace(/&apos;/gu, "'")
    .replace(/&lt;/gu, '<')
    .replace(/&gt;/gu, '>')
    .replace(/&amp;/gu, '&')
}

function tagCounts(values: readonly string[]): Map<string, number> {
  const counts = new Map<string, number>()
  for (const value of values) {
    for (const match of value.matchAll(INLINE_TAG_PATTERN)) {
      const tag = normalizeSerializedTag(match[0])
      counts.set(tag, (counts.get(tag) ?? 0) + 1)
    }
  }
  return counts
}

/**
 * 文本重新导入会把 `&lt;ph&gt;` 解码回 `<ph>`，单靠字符串相等无法证明
 * inline tag 仍是 XML 节点。对 XML 双语格式额外比较期望 tag multiset 与
 * 导出原始 XML 中真实 tag token；结合逐句文本/位置验证，可同时阻止转义、
 * 丢失和跨句移动。
 */
function verifySerializedInlineTags(
  adapter: CatFormatAdapter,
  bytes: Uint8Array,
  expected: readonly Segment[],
): boolean {
  if (!XML_INLINE_FORMAT_IDS.has(adapter.id)) return true
  let serialized: string
  try {
    serialized = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch (error) {
    throw new FormatExportError(adapter.id, 'exported XML is not valid UTF-8', { cause: error })
  }
  const required = tagCounts(expected.flatMap((segment) => [segment.source, segment.target]))
  const available = tagCounts([serialized])
  for (const [tag, count] of required) {
    if ((available.get(tag) ?? 0) < count) {
      throw new FormatExportError(
        adapter.id,
        'exported output lost inline tag structure even though reimported text matched',
      )
    }
  }
  return true
}

/**
 * Export is not complete until adapters can import its bytes and recover the
 * same effective text (target when present, otherwise source) at every
 * stable position. This catches a lossy adapter before it leaves staging.
 */
async function verifyReimport(
  adapter: CatFormatAdapter,
  project: LinguistProject,
  filename: string,
  originalBytes: Uint8Array,
  bytes: Uint8Array,
  expected: readonly Segment[],
): Promise<ExportVerification> {
  const original = await adapter.import({
    bytes: originalBytes,
    filename,
    sourceLocale: project.sourceLocale,
    targetLocale: project.targetLocale,
  })
  const reimported = await adapter.import({
    bytes,
    filename,
    sourceLocale: project.sourceLocale,
    targetLocale: project.targetLocale,
  })
  const byPosition = new Map<string, (typeof reimported.segments)[number]>()
  const originalByPosition = new Map<string, (typeof original.segments)[number]>()
  for (const segment of original.segments) {
    originalByPosition.set(positionOf(segment), segment)
  }
  for (const segment of reimported.segments) {
    const position = positionOf(segment)
    if (byPosition.has(position)) {
      throw new FormatExportError(adapter.id, 'reimported output has duplicate segment positions')
    }
    byPosition.set(position, segment)
  }
  const missing = expected.filter((segment) => !byPosition.has(positionOf(segment)))
  if (missing.length > 0) {
    throw new FormatSegmentLostError(adapter.id, missing.map((segment) => segment.id))
  }
  if (reimported.segments.length !== expected.length) {
    throw new FormatExportError(adapter.id, 'reimported output has an unexpected segment count')
  }
  let verifiedNativeStatusSegments = 0
  let changedTargetSegments = 0
  let changedNativeStatusSegments = 0
  for (const segment of expected) {
    const imported = byPosition.get(positionOf(segment))!
    const before = originalByPosition.get(positionOf(segment))
    if (before === undefined) {
      throw new FormatExportError(adapter.id, `original template differs at segment ${segment.id}`)
    }
    if (imported.source !== segment.source) {
      throw new FormatExportError(adapter.id, `reimported source differs at segment ${segment.id}`)
    }
    if (imported.target !== segment.target) {
      throw new FormatExportError(adapter.id, `reimported target differs at segment ${segment.id}`)
    }
    if (before.target !== segment.target) changedTargetSegments += 1
    const expectedNativeStatus = segment.currentStageState === 'confirmed'
      ? nativeStatusForStage(
          normalizeWorkflowStage(project.workflowStage),
          adapter.id,
          project.outputStatusPolicy,
        )
      : segment.importedNativeStatus
    if (expectedNativeStatus !== undefined) {
      verifiedNativeStatusSegments += 1
      if (imported.importedNativeStatus !== expectedNativeStatus) {
        throw new FormatExportError(
          adapter.id,
          `reimported native status differs at segment ${segment.id}`,
        )
      }
      if (before.importedNativeStatus !== expectedNativeStatus) changedNativeStatusSegments += 1
    }
  }
  const tagsPreserved = verifySerializedInlineTags(adapter, bytes, expected)
  return {
    verifiedSourceSegments: expected.length,
    verifiedTargetSegments: expected.length,
    verifiedNativeStatusSegments,
    changedTargetSegments,
    changedNativeStatusSegments,
    tagsPreserved,
  }
}

let temporaryFileCounter = 0

function writeAtomically(path: string, bytes: Uint8Array): void {
  const temporaryPath = `${path}.tmp-${process.pid}-${temporaryFileCounter++}`
  writeFileSync(temporaryPath, bytes)
  renameSync(temporaryPath, path)
}

/**
 * Generate, reimport-verify and stage one asset. The content digest is part
 * of the filename so an older artifact's metadata can never point at bytes
 * replaced by a later export with different content.
 */
export async function stageAssetExport(input: StageAssetExportInput): Promise<StagedAssetExport> {
  const asset = input.db.assets.get(input.assetId)
  if (asset === undefined) throw new StoreNotFoundError('asset', input.assetId)
  const segments = readAssetSegments(input.db, asset.id)
  const originalBytes = input.db.readAssetSource(asset.id)
  const bytes = await input.adapter.export({
    originalBytes,
    asset,
    segments,
    workflow: {
      stage: normalizeWorkflowStage(input.project.workflowStage),
      ...(input.project.outputStatusPolicy !== undefined
        ? { outputStatusPolicy: input.project.outputStatusPolicy }
        : {}),
    },
  })
  const verification = await verifyReimport(
    input.adapter,
    input.project,
    asset.originalFilename,
    originalBytes,
    bytes,
    segments,
  )

  const sha256 = sha256Hex(bytes)
  const filename = `${asset.id}-${sha256.slice(0, 16)}-${basename(asset.originalFilename)}`
  const relativePath = `exports/${filename}`
  const stagingPath = join(input.projectDir, relativePath)
  mkdirSync(join(input.projectDir, 'exports'), { recursive: true })
  writeAtomically(stagingPath, bytes)
  const artifact = input.db.exports.record({
    assetId: asset.id,
    path: relativePath,
    sha256,
    segmentCount: segments.length,
  })
  const original = basename(asset.originalFilename)
  const extension = extname(original)
  return {
    artifact,
    stagingPath,
    relativePath,
    suggestedFilename: `${basename(original, extension)}.translated.${input.project.targetLocale}${extension}`,
    verifiedSegments: segments.length,
    verification,
  }
}
