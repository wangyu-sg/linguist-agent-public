/**
 * CatFormatAdapter — plan §6.1 bilingual format adapter contract.
 *
 * Adapters are pure byte transformers: bytes in, bytes out. No fs, no Node,
 * no Proma/Pi/Electron/React. They run in any JS runtime.
 *
 * Hard rules (plan §6.3) an adapter must honor:
 * - import records the SHA-256 of the original bytes (`asset.sourceSha256`);
 * - export uses the original bytes as the template and only writes target
 *   text into it — unmodified structure round-trips byte-stable;
 * - tags/placeholders/ids/order are never lost;
 * - failed segments are never silently skipped on export — throw
 *   `FormatExportError` / `FormatSegmentLostError` instead.
 *
 * Identity note: at import time the store has not assigned the asset yet, so
 * imported segments carry no `id`/`assetId`. Use `bindImportedSegments` once
 * the asset exists — ids are content-derived and stable across re-imports.
 */

import {
  deriveSegmentId,
  type Asset,
  type AssetId,
  type Segment,
  type WorkflowOutputStatusPolicy,
  type WorkflowStage,
} from '@linguist/cat-core'

/** Re-export so adapter authors can name the export-side asset type. */
export type CatAsset = Asset

/** A segment as produced by import: full Segment minus store-assigned identity. */
export type ImportedCatSegment = Omit<Segment, 'id' | 'assetId'>

/** Non-fatal import issue (e.g. a dropped comment, an ignored unknown node). */
export interface ImportWarning {
  /** Stable, adapter-scoped code, e.g. 'fake_tsv.empty_key'. */
  code: string
  message: string
  /** Segment key the warning relates to, when applicable. */
  segmentKey?: string
}

/** Asset-level facts established by import (store assigns id/projectId). */
export interface ImportedAssetInfo {
  /** Adapter id, e.g. 'phrase_mxliff' — becomes Asset.formatId. */
  formatId: string
  originalFilename: string
  /** SHA-256 (hex) of the original bytes — hard rule, plan §6.3. */
  sourceSha256: string
  segmentCount: number
  /** Adapter-owned, versioned import configuration. The store treats it as opaque. */
  formatConfigJson?: string
}

export interface ImportedCatAsset {
  asset: ImportedAssetInfo
  segments: ImportedCatSegment[]
  warnings: ImportWarning[]
  /** Echo of the exact bytes that were imported (template for later export). */
  originalBytes: Uint8Array
}

export interface CatFormatImportInput {
  bytes: Uint8Array
  filename: string
  sourceLocale: string
  targetLocale: string
  /** Persisted adapter configuration used when re-verifying an exported template. */
  formatConfigJson?: string
}

export interface CatFormatExportInput {
  /** Original imported bytes — export MUST treat them as the template. */
  originalBytes: Uint8Array
  asset: CatAsset
  segments: Segment[]
  /** 当前任务阶段；仅本轮已确认的句段可据此写回格式原生状态。 */
  workflow?: {
    stage: WorkflowStage
    outputStatusPolicy?: WorkflowOutputStatusPolicy
  }
}

/**
 * Plan §6.1 adapter interface (verbatim shape).
 *
 * `detect` returns a confidence score: 0 = "not mine", higher = more
 * confident. Adapters should weigh both the filename extension and the
 * actual bytes (magic/skeleton), never the extension alone.
 */
export interface CatFormatAdapter {
  id: string
  extensions: string[]
  detect(input: Uint8Array, filename: string): Promise<number>
  import(input: CatFormatImportInput): Promise<ImportedCatAsset>
  export(input: CatFormatExportInput): Promise<Uint8Array>
}

/**
 * Bind imported segments to a store-created asset: stamps `assetId` and
 * derives stable content-based segment ids (same asset + ordinal + key ->
 * same id across re-imports). Pure; does not mutate the input segments.
 */
export function bindImportedSegments(
  segments: readonly ImportedCatSegment[],
  assetId: AssetId,
): Segment[] {
  return segments.map((segment) => ({
    ...segment,
    currentStageState: segment.currentStageState ?? 'untouched',
    id: deriveSegmentId(assetId, segment.ordinal, segment.key),
    assetId,
  }))
}
