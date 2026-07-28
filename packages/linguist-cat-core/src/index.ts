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
  fnv1a64,
  generateProjectId,
  type AssetId,
  type EntropySource,
  type ProjectId,
  type ProposalId,
  type QaFindingId,
  type SegmentId,
} from './ids'

export {
  archiveProject,
  createProject,
  type CreateProjectDeps,
  type CreateProjectInput,
  type LinguistProject,
} from './project'

export {
  DEFAULT_WORKFLOW_STAGE,
  WORKFLOW_STAGES,
  confirmCurrentStage,
  nativeStatusForStage,
  normalizeWorkflowStage,
  unconfirmCurrentStage,
  type CurrentStageState,
  type WorkflowOutputStatusPolicy,
  type WorkflowStage,
  type WorkflowStageEvent,
  type WorkflowStageEventAction,
  type WorkflowStageMutationOptions,
  type WorkflowStageMutationResult,
} from './workflow'

export {
  DEFAULT_QUALITY_PROFILE,
  QUALITY_PROFILE_POLICIES,
  normalizeQualityProfile,
  type LinguistQualityProfile,
  type LinguistQualityProfilePolicy,
} from './quality-profile'

export {
  DEFAULT_GLOSSARY_POLICY,
  normalizeGlossaryPolicy,
  type LinguistGlossaryPolicy,
} from './glossary-policy'

export {
  normalizeTagProfile,
  type LinguistTagFamily,
  type LinguistTagFamilyClass,
  type LinguistTagProfile,
} from './tag-profile'

export {
  compileTagFamilyRegex,
  pairingErrors,
  scanTagTokens,
  tagGroupSignature,
  type TagScanOptions,
  type TagSpan,
  type TagToken,
  type TagTokenGroup,
  type TagTokenKind,
} from './tag-families'

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
  INDEPENDENT_CRITIC_CATEGORIES,
  createIndependentCriticArtifact,
  independentCriticCandidateHash,
  independentCriticProfileHash,
  parseIndependentCriticArtifact,
  planIndependentCritic,
  targetedRepairScopeFromCriticArtifact,
  type CriticTargetedRepairScope,
  type IndependentCriticArtifact,
  type IndependentCriticCategory,
  type IndependentCriticFinding,
  type IndependentCriticFindingDraft,
  type IndependentCriticIdentity,
  type IndependentCriticPlan,
  type IndependentCriticRequest,
  type IndependentCriticSeverity,
  type IndependentCriticSubject,
} from './independent-critic'

export {
  BATCH_CONSISTENCY_CODES,
  buildBatchConsistencyPass,
  targetedRepairProposalInputs,
  type BatchConsistencyCode,
  type BatchConsistencyFindingItem,
  type BatchConsistencyGroup,
  type BatchConsistencyGroupSegment,
  type BatchConsistencyPass,
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
