import { sha256Hex } from './hash'

export type StageEvidenceRef =
  | { kind: 'asset'; id: string }
  | { kind: 'context-doc'; id: string }
  | { kind: 'reference-import'; id: string }
  | { kind: 'style-rule'; id: string }
  | { kind: 'tech-constraint'; id: string }
  | { kind: 'voice-profile'; id: string }
  | { kind: 'workspace-attachment'; id: string }

export interface VersionedStageEvidenceRef {
  ref: StageEvidenceRef
  version: string
}

export interface CreateStageEvidenceBaselineInput {
  stageRunId: string
  discoveryScopeHash: string
  mappingRevision: string
  ruleSetRevision: string
  segmentIds: readonly string[]
  evidence: readonly VersionedStageEvidenceRef[]
}

export interface StageEvidenceBaseline {
  stageRunId: string
  evidenceSetHash: string
  discoveryScopeHash: string
  mappingRevision: string
  ruleSetRevision: string
  segmentScopeHash: string
  baselineHash: string
}

export type StageEvidenceRole = 'translator' | 'reviewer' | 'proofreader'
export type StageEvidenceRequiredness = 'required' | 'conditional' | 'optional'
export type StageEvidencePurpose =
  | 'source-authority'
  | 'target-baseline'
  | 'visual-fact'
  | 'terminology'
  | 'style'
  | 'character-voice'
  | 'technical-constraint'
  | 'client-feedback'
  | 'version-comparison'
  | 'external-verification'

export type StageEvidenceScope =
  | { kind: 'stage' }
  | { kind: 'assets'; assetIds: string[] }
  | { kind: 'segments'; segmentIds: string[] }

export interface StageEvidenceRequirement {
  evidence: VersionedStageEvidenceRef
  purpose: StageEvidencePurpose
  requiredness: StageEvidenceRequiredness
  scope: StageEvidenceScope
  anchorIds: string[]
  rationale: string
}

export interface StageEvidencePlan {
  stageRunId: string
  role: StageEvidenceRole
  stage: 'translation' | 'editing' | 'proofreading'
  assetIds: string[]
  segmentIds: string[]
  requirements: StageEvidenceRequirement[]
  /** 新轮次只接受此事件边界之后、同一 actor 的决定；旧记录缺省时不继承。 */
  decisionEventBoundary?: number
  startToolCallId?: string
}

export type EvidenceGapCode =
  | 'REQUIRED_RESOURCE_MISSING'
  | 'RESOURCE_IMPORT_FAILED'
  | 'RESOURCE_EXTRACTION_FAILED'
  | 'RESOURCE_MAPPING_AMBIGUOUS'
  | 'VERSION_CONFLICT'
  | 'UNMAPPED_CLIENT_VISIBLE_CONTENT'
  | 'REQUIRED_MEDIA_UNPRESENTED'
  | 'EVIDENCE_CHANGED_DURING_STAGE'

export interface EvidenceGap {
  id: string
  stageRunId?: string
  code: EvidenceGapCode
  severity: 'blocking' | 'warning'
  evidence?: StageEvidenceRef
  summary: string
  suggestedAction: string
  status: 'open' | 'resolved' | 'waived'
  createdAt: string
  resolvedAt?: string
  resolvedBy?: 'system' | 'agent' | 'user'
}

export type ContextAnchorLocator = (
  | { kind: 'sheet'; sheet: string; row?: number; cell?: string; rowKind?: 'header' | 'data' | 'skipped' }
  | { kind: 'page'; page: number }
  | { kind: 'paragraph'; index: number }
  | { kind: 'image'; mediaId: string; sheet?: string; row?: number; cell?: string; page?: number }
) & {
  /** text_extract 中正文的 UTF-16 半开区间，不包含系统定位前缀。 */
  textRange?: { start: number; end: number }
}

export interface StageEvidenceReceipt {
  id: string
  stageRunId: string
  baselineHash: string
  sessionId: string
  generationRunId: string
  toolCallId?: string
  segmentIds: string[]
  evidence: Array<{
    ref: StageEvidenceRef
    anchorIds: string[]
    /** 旧工具级记录没有此标记，不计入模型提交覆盖。 */
    submission?: 'provider-response-v1'
    version?: string
    visual?: boolean
    /** 实际提交的 UTF-16 半开区间，可跨页合并。 */
    textRange?: { start: number; end: number }
  }>
  presentedAt: string
}

const encoder = new TextEncoder()

function digest(value: unknown): string {
  return sha256Hex(encoder.encode(JSON.stringify(value)))
}

function refKey(item: VersionedStageEvidenceRef): string {
  return `${item.ref.kind}\u0000${item.ref.id}\u0000${item.version}`
}

/** 冻结证据事实与工作范围；Target Revision 继续由现有 Segment CAS 管理。 */
export function createStageEvidenceBaseline(
  input: CreateStageEvidenceBaselineInput,
): StageEvidenceBaseline {
  const evidenceSetHash = digest([...input.evidence].map(refKey).sort())
  const segmentScopeHash = digest([...new Set(input.segmentIds)].sort())
  const facts = {
    stageRunId: input.stageRunId,
    evidenceSetHash,
    discoveryScopeHash: input.discoveryScopeHash,
    mappingRevision: input.mappingRevision,
    ruleSetRevision: input.ruleSetRevision,
    segmentScopeHash,
  }
  return { ...facts, baselineHash: digest(facts) }
}
