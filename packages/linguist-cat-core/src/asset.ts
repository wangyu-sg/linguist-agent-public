/**
 * Asset — one imported bilingual file inside a project. Pure data.
 * `sourceSha256` anchors the asset to exact source bytes (CAS), so the
 * derived id is stable for re-imports of the same file.
 */

import { deriveAssetId, type AssetId, type ProjectId } from './ids'

export interface Asset {
  id: AssetId
  projectId: ProjectId
  /** Bilingual format identifier, e.g. 'phrase_mxliff' | 'mqxliff' | 'sdlxliff' | 'xliff' | 'csv' | 'xlsx'. */
  formatId: string
  originalFilename: string
  /** SHA-256 (hex) of the original source bytes. */
  sourceSha256: string
  segmentCount: number
  /** Adapter-owned, versioned import configuration. CAT Core intentionally does not parse it. */
  formatConfigJson?: string
}

export interface CreateAssetInput {
  projectId: ProjectId
  formatId: string
  originalFilename: string
  sourceSha256: string
  segmentCount: number
  formatConfigJson?: string
}

export function createAsset(input: CreateAssetInput): Asset {
  return {
    id: deriveAssetId(input.projectId, input.sourceSha256, input.originalFilename),
    projectId: input.projectId,
    formatId: input.formatId,
    originalFilename: input.originalFilename,
    sourceSha256: input.sourceSha256,
    segmentCount: input.segmentCount,
    ...(input.formatConfigJson === undefined ? {} : { formatConfigJson: input.formatConfigJson }),
  }
}
