import type {
  ContextAnchorLocator,
  StageEvidenceRequiredness,
} from './stage-evidence'

export interface ContextTextSection {
  id: string
  anchorId: string
  text: string
}

export interface ContextMedia {
  id: string
  filename: string
  mimeType: string
  bytes: Uint8Array
  sha256: string
}

export interface ExtractedContextAnchor {
  id: string
  locator: ContextAnchorLocator
  label?: string
  textSectionId?: string
  mediaId?: string
}

export interface ContextExtractionWarning {
  code: string
  message: string
}

export interface ContextExtraction {
  textSections: ContextTextSection[]
  media: ContextMedia[]
  anchors: ExtractedContextAnchor[]
  warnings: ContextExtractionWarning[]
}

export interface ContextAnchor {
  id: string
  contextDocId: string
  locator: ContextAnchorLocator
  label?: string
  text?: string
  mediaContextDocId?: string
}

export type ContextEvidenceRelation =
  | { kind: 'asset'; assetId: string }
  | { kind: 'segment'; segmentId: string }

export interface ContextEvidenceLink {
  contextDocId: string
  anchorId?: string
  relation: ContextEvidenceRelation
  requiredness: StageEvidenceRequiredness
  mappingRevision: string
}
