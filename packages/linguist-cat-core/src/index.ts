/**
 * @linguist/cat-core — pure CAT domain model (PB-021).
 *
 * No Proma/Pi/Electron/Node-fs/SQLite/React imports. No runtime deps.
 * Dependency direction: cat-core <- formats <- store <- tools.
 */

export {
  DOMAIN_ERROR_CODES,
  DomainError,
  InvalidIdError,
  InvalidStateTransitionError,
  RevisionConflictError,
  SegmentLockedError,
  StaleProposalError,
  UnknownSegmentError,
  type DomainErrorCode,
} from './errors'

export { sha256Hex, type HashFn } from './hash'

export {
  ID_PATTERN,
  asAssetId,
  asProjectId,
  asProposalId,
  asQaFindingId,
  asSegmentId,
  createSeededEntropy,
  defaultEntropy,
  deriveAssetId,
  deriveProposalId,
  deriveQaFindingId,
  deriveSegmentId,
  deriveStableIdV2,
  fnv1a64,
  generateProjectId,
  parseStableId,
  type AssetId,
  type EntropySource,
  type ParsedStableId,
  type ProjectId,
  type ProposalId,
  type ProposalIssuanceId,
  type QaFindingId,
  type SegmentId,
  type StableIdField,
  type StableIdVersion,
} from './ids'

export {
  createProposalIssuance,
  type LinguistGenerationProvenance,
  type ProposalIssuance,
  type ProposalIssuanceInput,
} from './proposal-issuance'

export {
  archiveProject,
  createProject,
  type CreateProjectDeps,
  type CreateProjectInput,
  type LinguistProject,
} from './project'

export {
  normalizeWorkbookMappingProfiles,
  type LinguistWorkbookMappingProfile,
  type WorkbookMappingColumns,
  type WorkbookMappingColumnRole,
} from './workbook-mapping'

export {
  DEFAULT_WORKFLOW_STAGE,
  WORKFLOW_STAGES,
  confirmCurrentStage,
  nativeStatusForStage,
  normalizeWorkflowStage,
  recordCurrentStageDecision,
  unconfirmCurrentStage,
  type CurrentStageState,
  type WorkflowOutputStatusPolicy,
  type WorkflowStage,
  type WorkflowStageEvent,
  type WorkflowStageEventAction,
  type WorkflowStageDecision,
  type WorkflowStageMutationOptions,
  type WorkflowStageMutationResult,
} from './workflow'

export {
  DEFAULT_GLOSSARY_POLICY,
  normalizeGlossaryPolicy,
  type LinguistGlossaryPolicy,
} from './glossary-policy'

export {
  evaluateSegmentTermPolicy,
  type EvaluatedTermPolicyMatch,
  type SegmentTermPolicyEvaluation,
  type SegmentTermPolicyInput,
  type TermPolicyAdvisoryReason,
  type TermPolicyCandidate,
  type TermPolicyStatus,
} from './term-policy'

export {
  normalizeTagProfile,
  type LinguistTagCandidateKind,
  type LinguistTagCandidateStatus,
  type LinguistTagFamily,
  type LinguistTagFamilyClass,
  type LinguistTagProfile,
  type LinguistTagProfileCandidate,
} from './tag-profile'

export {
  compileTagFamilyRegex,
  pairingErrors,
  scanTags,
  scanTagTokens,
  tagGroupSignature,
  type TagScanOptions,
  type TagSpan,
  type TagToken,
  type TagTokenGroup,
  type TagTokenKind,
} from './tag-families'

export {
  activateTagProfileCandidate,
  saveTagProfileCandidate,
  scanUnknownTagPatterns,
  updateTagProfileEntry,
  validateTagProfileCandidate,
  type SaveTagProfileCandidateInput,
  type TagCandidateValidationResult,
  type UnknownTagExample,
  type UnknownTagPatternResult,
  type UnknownTagSample,
} from './unknown-tag-patterns'

export {
  FALLBACK_QA_ISSUE_MAPPING,
  QA_CODE_ISSUE_MAPPING,
  QA_FINDING_DISPOSITIONS,
  QA_FINDING_SEVERITIES,
  QA_ISSUE_TYPES,
  resolveQaIssueMapping,
  type QaIssueMapping,
} from './issue-type'

export { createAsset, type Asset, type CreateAssetInput } from './asset'

export {
  applyTargetEdit,
  assertRevision,
  assertSegmentEditable,
  compareSegments,
  lockSegment,
  sortSegments,
  unlockSegment,
  type ApplyTargetEditOptions,
  type Segment,
  type SegmentContext,
  type SegmentRevision,
  type SegmentRevisionSource,
  type SegmentStatus,
  type TargetEditResult,
} from './segment'

export {
  acceptProposal,
  createProposal,
  expireProposal,
  rejectProposal,
  reissueProposal,
  supersedeProposal,
  type AcceptProposalOptions,
  type AcceptProposalResult,
  type CreateProposalInput,
  type ProposalStatus,
  type ReissueProposalInput,
  type TranslationProposal,
} from './proposal'

export {
  QA_FINDING_TRANSITIONS,
  openQaFinding,
  transitionQaFinding,
  type OpenQaFindingInput,
  type QaFinding,
  type QaFindingDisposition,
  type QaFindingSeverity,
  type QaFindingStatus,
  type QaIssueType,
} from './qa-finding'

export {
  QA_RULE_CODES,
  runQa,
  type QaGlossaryConflict,
  type QaSegmentTerminology,
  type QaRuleCode,
  type QaRunOptions,
} from './qa-core'

export {
  DEFAULT_QA_PROFILE,
  QA_PROFILES,
  normalizeQaProfile,
  type QaProfile,
} from './qa-profile'

export {
  AUDIT_ONLY_EVIDENCE_PATTERNS,
  isAuditOnlyEvidenceSource,
  isCitableEvidenceSource,
} from './evidence'

export {
  createStageEvidenceBaseline,
  type CreateStageEvidenceBaselineInput,
  type ContextAnchor,
  type ContextAnchorLocator,
  type StageEvidenceBaseline,
  type StageEvidenceGap,
  type StageEvidenceGapCode,
  type StageEvidencePlan,
  type StageEvidencePurpose,
  type StageEvidenceRef,
  type StageEvidenceReceipt,
  type StageEvidenceRequiredness,
  type StageEvidenceRequirement,
  type StageEvidenceRole,
  type StageEvidenceScope,
  type VersionedStageEvidenceRef,
} from './stage-evidence'

export {
  analyzeBatchConsistency,
  BATCH_CONSISTENCY_CODES,
  buildBatchConsistencyPass,
  selectedConsistencyProposalInputs,
  type BatchConsistencyCandidateTarget,
  type BatchConsistencyCode,
  type BatchConsistencyDimensions,
  type BatchConsistencyFindingItem,
  type BatchConsistencyGroup,
  type BatchConsistencyGroupSegment,
  type BatchConsistencyPass,
  type ConsistencyRepairSelection,
} from './batch-consistency'

export {
  DETERMINISTIC_HARD_RULE_CODES,
  runDeterministicHardRules,
  type DeterministicHardRuleCode,
  type DeterministicHardRuleInput,
  type DeterministicHardRuleResult,
  type DeterministicHardRuleViolation,
  type ForbiddenTermRule,
  type RequiredTerminologyRule,
} from './hard-rules'
