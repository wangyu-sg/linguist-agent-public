import {
  parseTaskWorkspaceSnapshot,
  type TaskActiveRunSummary,
  type TaskKind,
  type TaskLocator,
  type TaskRecord,
  type TaskWorkspaceSnapshot,
} from "../../../../../packages/cat-data/src/task_workspace_contract.ts";
import type {
  TaskMessageQueue,
  TaskQueuedMessage,
} from "../../../../../packages/cat-data/src/task_message_queue_contract.ts";

export type { TaskMessageQueue, TaskQueuedMessage };

export type RuntimeStatus = Awaited<ReturnType<typeof window.linguist.runtime.status>>;
export type StreamState = Parameters<typeof window.linguist.api.subscribeTaskEvents>[2] extends ((state: infer State) => void) | undefined
  ? State
  : never;

export type BatchFormat = "phrase_mxliff" | "mqxliff" | "sdlxliff" | "xliff_1_2" | "xliff_2_0" | "csv_paste" | "xlsx_paste";
export type BatchWorkflowStage = "translate" | "edit" | "proof" | "delivery";

export interface BatchSegment {
  index: number;
  id: string;
  masterId?: string;
  resname?: string;
  contextNote?: string;
  source: string;
  target: string;
  originalTarget?: string;
  rawSource: string;
  rawTarget: string;
  locked: boolean;
  status: "new" | "draft" | "confirmed";
  duplicateKey: string;
  duplicateRole?: "unique" | "first" | "repeat";
  duplicateOrdinal?: number;
  duplicateGroupSize?: number;
  duplicateFirstSegmentId?: string;
  placeholderCount: number;
  unresolvedPlaceholderCount: number;
  unresolvedRuntimePlaceholderCount?: number;
  unresolvedTagPlaceholderCount?: number;
  unresolvedPlaceholders?: string[];
  unresolvedRuntimePlaceholders?: string[];
  unresolvedTagPlaceholders?: string[];
  confirmationLevel?: string;
  tuId?: string;
  updatedAt?: string;
  updateReason?: string;
  updateChangeType?: SegmentChangeType;
  updateEvidenceSources?: string[];
  [key: string]: unknown;
}

export type SegmentChangeType =
  | "translation"
  | "term"
  | "terminology"
  | "accuracy"
  | "consistency"
  | "style"
  | "fluency"
  | "user_approved"
  | "other";

export type SegmentTagTone = "fmt" | "num" | "named" | "newline";

export interface SegmentDetectedTag {
  literal: string;
  kind:
    | "xliff"
    | "phrase-format"
    | "game-format"
    | "placeholder-num"
    | "placeholder-named"
    | "escape"
    | "project-tag";
  id: string | null;
  index: number;
  pairKey: string;
  tone: SegmentTagTone;
  label: string;
}

export type SegmentRenderToken =
  | { kind: "text"; value: string }
  | { kind: "tag"; tag: SegmentDetectedTag };

export interface SegmentTagContract {
  text: {
    value: string;
    tags: SegmentDetectedTag[];
    tokens: SegmentRenderToken[];
    tagCount: number;
  };
  source: string;
  target: string;
  validation: {
    sourceTags: SegmentDetectedTag[];
    targetTags: SegmentDetectedTag[];
    missing: SegmentDetectedTag[];
    extra: SegmentDetectedTag[];
    missingKeys: string[];
    extraKeys: string[];
    blocked: boolean;
  };
  sourceTagChipRows: Array<{
    tag: SegmentDetectedTag;
    needed: number;
    present: number;
  }>;
}

// Wire mirror of packages/cat-data SegmentEvidenceSnapshot. Keeping the DTO at
// the renderer boundary avoids importing the Node-backed evidence builder.
export interface SegmentEvidenceSnapshot {
  projectId: string;
  batchId: string;
  segmentId: string;
  source: string;
  tmMatches: Array<{
    id: string;
    source: string;
    target: string;
    srcLang: string;
    tgtLang: string;
    origin: "reviewed" | "client_tm" | "mt" | "imported" | "unknown";
    quality?: number;
    project?: string;
    note?: string;
    sourceKind?: "client_import" | "customer_return" | "batch_confirm" | "manual" | "legacy";
    sourceBatchId?: string;
    sourceSegmentId?: string;
    createdAt?: string;
    updatedAt?: string;
    score: number;
    matchType: "exact" | "contains" | "fuzzy";
    effectiveAuthority?: "reviewed_tm" | "working_tm" | "client_tm" | "imported_tm" | "mt" | "unknown_tm";
  }>;
  termbaseMatches: Array<{
    id: string;
    source: string;
    target: string;
    srcLang: string;
    tgtLang: string;
    note?: string;
    conceptId?: number;
    fields?: Record<string, string[]>;
    sourceFile: string;
    sheetName?: string;
    rowNo: number;
    origin: "sdltb" | "tbx" | "table" | "manual";
    matchType: "exact" | "contains";
    resolution?: "preferred" | "override" | "conflict" | "overridden";
    conflictTargets?: string[];
    overriddenBy?: string;
  }>;
  glossaryMatches: Array<{
    id: string;
    source: string;
    target: string;
    note?: string;
    sourceFile: string;
    rowNo: number;
    matchType: "exact" | "contains";
  }>;
  cards: Array<{
    id: string;
    tab: "cat" | "rules" | "refs" | "preview";
    toolName: string;
    text: string;
    timestamp: string | null;
    isError: boolean;
  }>;
  summary: {
    tm: number;
    tmExact: number;
    tmFuzzy: number;
    termbase: number;
    glossary: number;
  };
}

export interface DuplicateSourceGroup {
  duplicateKey: string;
  source: string;
  count: number;
  segmentIds: string[];
  firstSegmentId: string;
}

export interface TagReport {
  totalSegments: number;
  placeholderSegments: number;
  masterMatchedSegments: number;
  masterUnmatchedSegments: number;
  replacedPlaceholders: number;
  unresolvedPlaceholders: number;
  unresolvedRuntimePlaceholders?: number;
  unresolvedTagPlaceholders?: number;
  tagCountMismatches: number;
}

export interface CatBatch {
  schemaVersion: 1;
  format: BatchFormat;
  projectId: string;
  batchId: string;
  sourceFile: string;
  masterFile?: string;
  sourceLanguage: string;
  targetLanguage: string;
  workflowStage?: BatchWorkflowStage;
  createdAt: string;
  updatedAt: string;
  tagReport?: TagReport;
  tagViews?: Record<string, SegmentTagContract>;
  duplicateSourceGroups?: DuplicateSourceGroup[];
  segments: BatchSegment[];
  [key: string]: unknown;
}

export interface SegmentUpdateResult {
  batchId: string;
  requestedSegmentId: string;
  changedSegmentIds: string[];
  skippedLockedIds: string[];
  skippedDuplicateIds: string[];
  propagated: boolean;
  duplicateGroupSize: number;
  target: string;
  status: BatchSegment["status"];
  segment: BatchSegment;
  batchUpdatedAt: string;
}

export interface SaveSegmentInput {
  target: string;
  confirm: boolean;
  expectedSegmentUpdatedAt: string | null;
}

export type SaveSegmentOutcome =
  | {
      kind: "saved";
      segment: BatchSegment;
      batchUpdatedAt: string;
      result: SegmentUpdateResult;
    }
  | {
      kind: "conflict";
      error: "segment_revision_conflict";
      currentSegment: BatchSegment;
      batchUpdatedAt: string;
    };

export interface BatchSummary {
  schemaVersion: 1;
  projectId: string;
  batchId: string;
  format: BatchFormat;
  sourceLanguage: string;
  targetLanguage: string;
  workflowStage?: BatchWorkflowStage;
  segments: number;
  confirmed: number;
  draft: number;
  new: number;
  locked: number;
  updatedAt: string;
}

export interface ProjectSummary {
  projectId: string;
  name: string;
  root: string;
  updatedAt: string;
  assetCount: number;
  batches: BatchSummary[];
}

export interface ProjectListResponse {
  projects: ProjectSummary[];
  diagnostics?: unknown[];
}

export type ProjectAssetKind = "workbook" | "document" | "memory" | "other";

export interface ProjectAssetItem {
  relPath: string;
  role: string;
  selectedRole: string;
  roleStatus: "inferred" | "confirmed";
  confidence: number;
  sizeBytes?: number;
  kind: ProjectAssetKind;
  reasons: string[];
  roleReasons: string[];
}

export interface ProjectAssetsCatalog {
  projectId: string;
  sourceLanguage?: string;
  targetLanguage?: string;
  assets: ProjectAssetItem[];
}

export interface ProjectAssetSearchHit {
  id: string;
  kind: string;
  relPath: string;
  lineNo?: number;
  source?: string;
  target?: string;
  text: string;
  detail?: string;
  role?: string;
  sheetName?: string;
}

export interface ProjectAssetSearchGroup {
  id: string;
  title: string;
  kind: string;
  count: number;
  hits: ProjectAssetSearchHit[];
}

export interface ProjectAssetSearchResponse {
  projectId: string;
  query: string;
  sources: Array<{
    id: string;
    kind: string;
    relPath: string;
    role?: string;
    text?: string;
    detail?: string;
    sizeBytes?: number;
  }>;
  hits: ProjectAssetSearchHit[];
  groups: ProjectAssetSearchGroup[];
}

export interface ProjectAssetReadResponse {
  relPath: string;
  text: string;
  truncated: boolean;
  skippedReason?: string;
}

export interface ProjectWorkbookSheetInfo {
  sheetName: string;
  rowCount: number;
  columnCount: number;
  headers: string[];
  mergedRanges: string[];
  columnWidths: number[];
  rowHeights: Record<string, number>;
}

export interface ProjectWorkbookPreview {
  projectId: string;
  assetPath: string;
  resolvedPath: string;
  engine?: string;
  sheets: ProjectWorkbookSheetInfo[];
}

export interface ProjectWorkbookRow {
  rowNo: number;
  cells: Array<{
    value: string;
    displayValue: string;
    mergedRef?: string;
    coveredBy?: string;
  }>;
}

export interface ProjectWorkbookSheetPage {
  projectId: string;
  assetPath: string;
  resolvedPath: string;
  engine?: string;
  sheetName: string;
  headers: string[];
  rows: ProjectWorkbookRow[];
  offset: number;
  limit: number;
  rowCount: number;
  columnCount: number;
  hasMore: boolean;
  mergedRanges: string[];
  columnWidths: number[];
  rowHeights: Record<string, number>;
}

export type AssetParseMode = "structured" | "mineru" | "dual" | "manual";

export interface AssetParsePreview {
  projectId: string;
  assetPath: string;
  resolvedPath?: string;
  mode: AssetParseMode;
  parser: "structured" | "mineru";
  status: "ready" | "unavailable" | "error";
  generatedAt: string;
  structuredSheets?: Array<{
    sheetName: string;
    role: string;
    action: string;
    authorityTier: string;
    rowCount: number;
    headers: string[];
    sampleRows: string[][];
    confidence: number;
    reason: string;
    warnings: string[];
  }>;
  mineruBlocks?: Array<{
    id: string;
    blockType: string;
    text: string;
    page?: number;
    confidence?: number;
    source: string;
  }>;
  warnings: string[];
  error?: string;
}

export interface AssetParseResult {
  projectId: string;
  assetPath: string;
  mode: AssetParseMode;
  generatedAt: string;
  structuredPreview?: AssetParsePreview;
  mineruPreview?: AssetParsePreview;
  comparison?: {
    structuredStatus: AssetParsePreview["status"];
    mineruStatus: AssetParsePreview["status"];
    structuredSheetCount: number;
    mineruBlockCount: number;
    structuredRowCount: number;
    mineruTableBlockCount: number;
    rowCountDelta?: number;
    warnings: string[];
  };
  warnings: string[];
}

export interface ProjectManifestSummary {
  projectId: string;
  projectName?: string;
  root: string;
  sourceLanguage: string;
  targetLanguage: string;
  updatedAt: string;
}

export interface CreateProjectInput {
  projectId?: string;
  rootPath: string;
  projectName: string;
  sourceLanguage: string;
  targetLanguage: string;
}

export interface CreateProjectResponse {
  manifest: ProjectManifestSummary;
  path: string;
}

export interface BatchResponse {
  batch: CatBatch;
  delivery: unknown;
}

export interface BatchSummaryResponse {
  summary: BatchSummary;
}

export interface BatchImportResponse {
  batch: CatBatch;
  path: string;
}

export interface QualityFindingDTO {
  id: string;
  batchId: string;
  segmentId: string;
  code: string;
  category: string;
  severity: "blocker" | "warning" | "info";
  confidence: "high" | "medium" | "low";
  authority: string;
  status: "open" | "ignored";
  source: string;
  target: string;
  message: string;
  expectedTarget?: string;
  sourceTerm?: string;
  evidenceSources: string[];
  ignoredReason?: string;
  ignoredAt?: string;
}

export interface QualityAuditReportDTO {
  schemaVersion: 1;
  projectId: string;
  batchId: string;
  checkedAt: string;
  status: "pass" | "warn" | "fail";
  summary: {
    checkedSegments: number;
    openBlockers: number;
    openWarnings: number;
    ignored: number;
    [key: string]: number;
  };
  findings: QualityFindingDTO[];
  [key: string]: unknown;
}

export interface DeliveryQaFindingDTO {
  id: string;
  type: string;
  severity: "blocker" | "warning" | "advisory";
  segmentId?: string;
  source?: string;
  target?: string;
  message: string;
  evidence: string[];
  relatedSegmentIds?: string[];
}

export interface DeliveryQaReportDTO {
  reportId: string;
  projectId: string;
  batchId?: string;
  workflowId?: string;
  generatedAt: string;
  findings: DeliveryQaFindingDTO[];
  summary: { blockers: number; warnings: number; advisories: number };
  [key: string]: unknown;
}

export interface ReviewedDeliveryQaReportDTO {
  reportId: string;
  reviewedAt: string;
  rawReport: DeliveryQaReportDTO;
  findings: Array<DeliveryQaFindingDTO & {
    reviewDecision: "fix_required" | "ignore_with_reason" | "query" | "accepted_risk";
    reviewReason: string;
    reviewedBy: "lead_linguist" | "user";
  }>;
}

export interface DeliveryIssueDTO {
  severity: "blocker" | "warning" | "waived";
  code: string;
  message: string;
  segmentIds: string[];
}

export interface DeliveryReportDTO {
  status: "pass" | "warn" | "fail";
  projectId: string;
  batchId: string;
  checkedAt: string;
  blockers: DeliveryIssueDTO[];
  waived: DeliveryIssueDTO[];
  warnings: DeliveryIssueDTO[];
  summary: Record<string, number>;
  [key: string]: unknown;
}

export interface DeliveryReadinessReportDTO {
  schemaVersion: 1;
  projectId: string;
  batchId: string;
  checkedAt: string;
  status: "pass" | "warn" | "fail";
  delivery: DeliveryReportDTO;
  quality: QualityAuditReportDTO;
  proposals: { sets: number; proposed: number; applied: number; skipped: number; rejected: number };
  files: Array<{ role: "source" | "master"; path: string; exists: boolean; size?: number; mtimeMs?: number; status: "pass" | "fail" }>;
  latestExport?: Record<string, unknown>;
  exportAuditCount: number;
  nextActions: string[];
}

export interface DeliveryExportResultDTO {
  projectId: string;
  batchId: string;
  format: "phrase_mxliff" | "phrase_bilingual_docx" | "mqxliff" | "sdlxliff" | "xliff" | "csv" | "xlsx";
  outputPath: string;
  updatedSegments: number;
  missingIds: string[];
  delivery: DeliveryReportDTO;
  auditId?: string;
  auditPath?: string;
  authorization?: {
    authorized: boolean;
    blockers: string[];
    unreviewedFindingIds: string[];
    waivedFindingIds: string[];
  };
}

export interface PrivateEvalSetDTO {
  evalSetId: string;
  label: string;
  sourceRoot: string;
  createdAt: string;
  assetPaths: string[];
  segmentCount: number;
  rubricPath: string;
}

export interface PrivateEvalUsageDTO {
  inputTokens?: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  costUsd?: number;
  modelCalls?: number;
}

export interface PrivateEvalRunDTO {
  runId: string;
  evalSetId: string;
  projectId?: string;
  taskId?: string;
  segmentCount?: number;
  mode: "single_agent" | "team_workflow";
  modelRoutes: Record<string, string>;
  thinkingLevel?: "minimal" | "low" | "medium" | "high" | "xhigh";
  resumedFromRunId?: string;
  checkpointOutputCount?: number;
  checkpointUsage?: PrivateEvalUsageDTO;
  startedAt: string;
  completedAt?: string;
  usage?: PrivateEvalUsageDTO;
  error?: string;
  status: "running" | "stopped" | "failed" | "completed";
}

export interface PrivateEvalRunOutputDTO {
  runId: string;
  evalSetId: string;
  segmentId: string;
  mode: PrivateEvalRunDTO["mode"];
  source: string;
  target?: string;
  notes?: string;
  status: "completed" | "failed";
  error?: string;
  usage?: PrivateEvalUsageDTO;
  [key: string]: unknown;
}

export type EvalDimensionDTO =
  | "adequacy"
  | "terminology"
  | "hard_constraints"
  | "function_strategy_fit"
  | "genre_voice_fit"
  | "styleguide_application"
  | "fluency_idiomaticity"
  | "overediting_risk"
  | "delivery_readiness";

export type PrivateEvalIssueTierDTO = "OK" | "A" | "B" | "C";
export type PrivateEvalBlindPreferenceDTO = "a" | "b" | "tie" | "both_fail";

export interface HumanScoreRowDTO {
  runId: string;
  segmentId: string;
  dimension: EvalDimensionDTO;
  score: 1 | 2 | 3 | 4 | 5;
  judge: "human:reviewer";
  issueTier: PrivateEvalIssueTierDTO;
  issueCategories: string[];
  accepted?: boolean;
  comment?: string;
}

export interface PrivateEvalBlindJudgmentInputDTO {
  pairId: string;
  preference: PrivateEvalBlindPreferenceDTO;
  issueTierA: PrivateEvalIssueTierDTO;
  issueTierB: PrivateEvalIssueTierDTO;
  issueCategoriesA: string[];
  issueCategoriesB: string[];
  comment?: string;
}

export interface PrivateEvalBlindJudgmentDTO extends PrivateEvalBlindJudgmentInputDTO {
  judgedAt: string;
}

export interface PrivateEvalBlindPairDTO {
  pairId: string;
  segmentId: string;
  source: string;
  candidateA: string;
  candidateB: string;
  referenceTarget?: string;
  reviewedTarget?: string;
  customerReturnTarget?: string;
  riskTypes: string[];
  tmRefs: string[];
  termRefs: string[];
  judgment?: PrivateEvalBlindJudgmentDTO;
  candidateARunId?: string;
  candidateBRunId?: string;
}

export interface PrivateEvalBlindReviewDTO {
  reviewId: string;
  evalSetId: string;
  seed: string;
  createdAt: string;
  total: number;
  judged: number;
  complete: boolean;
  pairs: PrivateEvalBlindPairDTO[];
  revealedRuns?: Array<{
    runId: string;
    mode: PrivateEvalRunDTO["mode"];
    modelRoute?: string;
    wins: number;
  }>;
}

export interface PrivateEvalBlindReviewSummaryDTO {
  reviewId: string;
  evalSetId: string;
  createdAt: string;
  total: number;
  judged: number;
  complete: boolean;
}

export interface PrivateEvalBlindReviewInputDTO {
  runIds: [string, string];
  seed: string;
  sampleSize?: number;
  reviewId?: string;
}

export interface PrivateEvalComparisonDTO {
  markdown: string;
  reportPath: string;
}

export interface PrivateEvalLaunchInput {
  evalSetId: string;
  projectId: string;
  batchId: string;
  mode: "single_agent" | "team_workflow";
  modelRoutes?: Record<string, string>;
  thinkingLevel?: "minimal" | "low" | "medium" | "high" | "xhigh";
  segmentLimit?: number;
  resumedFromRunId?: string;
}

export interface PrivateEvalExecutionResponseDTO {
  run: PrivateEvalRunDTO;
  outputs: PrivateEvalRunOutputDTO[];
}

export interface TaskListResponse {
  schemaVersion: 2;
  tasks: TaskRecord[];
  /** Absent only when talking to an older local runtime during migration. */
  activeRuns?: TaskActiveRunSummary[];
}

export interface StandaloneFileGrantDTO {
  id: string;
  taskId: string;
  kind: "file" | "directory";
  realPath: string;
  access: "read" | "read_write";
  recursive: boolean;
  createdAt: string;
  fingerprint: string;
}

export interface MaintenancePlanDTO {
  schemaVersion: 1;
  mode: "preview";
  planHash: string;
  repository: { path: string; head: string; branch: string; dirty: boolean; changedPaths: string[]; packageLockSha256: string; headPackageLockSha256: string };
  current: { productVersion: string; piVersion: string; apiProtocolVersion: number };
  workingTree: { productVersion: string; piVersion: string; packageLockSha256: string };
  target: { piVersion: string };
  candidate: { strategy: "isolated_git_worktree"; root: string; branch: string };
  expectedChanges: string[];
  validationCommands: string[][];
  rollback: string;
  mutationsCurrentRuntime: false;
}

export interface MaintenanceCandidateDTO {
  schemaVersion: 1;
  status: "validated";
  planHash: string;
  candidateRoot: string;
  candidateBranch: string;
  disposition: "runtime_candidate" | "full_app_candidate";
  currentApiProtocolVersion: number;
  candidateApiProtocolVersion: number;
  commit: string;
  treeHash: string;
  reportSha256: string;
  changedPaths: string[];
  migration: { status: "not_run" | "completed"; summary: string; sessionId?: string };
  validation: Array<{ command: string[]; status: "passed"; durationMs: number }>;
  activationRequiresSecondApproval: true;
}

export interface MaintenanceJobDTO {
  status: "running" | "complete" | "failed";
  planHash: string;
  startedAt: string;
  completedAt?: string;
  candidate?: MaintenanceCandidateDTO;
  snapshot?: TaskWorkspaceSnapshot;
  error?: { code: string; message: string };
}

export type MaintenanceActivationHandoff = {
  action: "electron_runtime_installer";
  candidateBundleRoot: string;
  reportSha256: string;
  serverPerformedSwitch: false;
  rollback: string;
} | {
  action: "install_full_app_candidate";
  candidateAppPath: string;
  reportSha256: string;
  serverPerformedSwitch: false;
  reason: string;
};

export type AssistantLibraryScope = { kind: "personal" } | { kind: "project"; projectId: string };

export interface AssistantLibraryDocument {
  id: string;
  scope: AssistantLibraryScope;
  originalName: string;
  managedPath: string;
  sourceDigest: string;
  sizeBytes: number;
  extension: string;
  importedAt: string;
  updatedAt: string;
  blockCount: number;
  parserVersions: string[];
}

export interface AssistantLibraryCatalog {
  schemaVersion: 1;
  scope: AssistantLibraryScope;
  documents: AssistantLibraryDocument[];
  updatedAt: string;
}

export interface AssistantLibraryIndexReport {
  scope: AssistantLibraryScope;
  documents: AssistantLibraryDocument[];
  blocks: number;
  semanticState: "ready" | "lexical_only" | "blocked";
  embeddingModel?: string;
  message?: string;
}

export interface AssistantLibrarySearchReport {
  scope: AssistantLibraryScope;
  query: string;
  retrievalMode: "lexical" | "vector" | "hybrid";
  semanticState: { state: "ready" | "lexical_only" | "blocked"; embeddingModel?: string; message?: string };
  hits: Array<{
    blockId: string;
    documentId: string;
    scope: AssistantLibraryScope;
    originalName: string;
    managedPath: string;
    sourceDigest: string;
    text: string;
    lineNo: number;
    page?: number;
    sheet?: string;
    slide?: number;
    bbox?: [number, number, number, number];
    parserVersion?: string;
    retrievalMode: "lexical" | "vector" | "hybrid";
    score: number;
  }>;
}

export interface LocalEmbeddingCapabilityStatus {
  state: "missing" | "corrupt" | "ready";
  path: string;
  modelId: string;
  revision: string;
  dimensions: number;
  message?: string;
  lock?: { installedAt: string; files: Array<{ path: string; sha256: string; sizeBytes: number }> };
}

export interface ManagedDocumentCapabilityStatus {
  id: "python" | "ocr" | "mineru" | "office";
  label: string;
  tier: "core" | "labs";
  state: "missing" | "corrupt" | "unqualified" | "ready" | "unsupported";
  path: string;
  message?: string;
  lock?: { installedAt: string; packages: Array<{ name: string; version: string; sha256?: string }>; models: Array<{ name: string; revision: string }> };
}

export type ManagedDocumentCapabilityCatalog = Record<ManagedDocumentCapabilityStatus["id"], ManagedDocumentCapabilityStatus>;

export interface ManagedDocumentInstallPlan {
  schemaVersion: 1;
  capabilityId: ManagedDocumentCapabilityStatus["id"];
  label: string;
  tier: "core" | "labs";
  targetPath: string;
  prerequisiteIds: ManagedDocumentCapabilityStatus["id"][];
  runtime: { distribution: string; sha256: string; url: string };
  packages: Array<{ name: string; version: string; sha256?: string }>;
  models: Array<{ name: string; revision: string; files: string[] }>;
  networkHosts: string[];
  sourceFilesRemainReadOnly: true;
  lifecycleScriptsDisabled: true;
  planHash: string;
}

export type AssistantMemoryKind = "preference" | "fact" | "guidance";
export type AssistantMemoryStatus = "proposed" | "active" | "revoked";

export interface AssistantMemoryDTO {
  id: string;
  scope: AssistantLibraryScope;
  kind: AssistantMemoryKind;
  text: string;
  status: AssistantMemoryStatus;
  source: { taskId: string; activityId?: string; artifactId?: string };
  revision: number;
  createdAt: string;
  updatedAt: string;
  confirmedAt?: string;
  revokedAt?: string;
  history: Array<{
    revision: number;
    action: "proposed" | "confirmed" | "edited" | "revoked";
    actor: "agent" | "user" | "system";
    at: string;
    text: string;
    kind: AssistantMemoryKind;
    previousText?: string;
    previousKind?: AssistantMemoryKind;
  }>;
}

export interface CreateChatInput {
  title?: string;
  intent?: string;
}

export interface AcceptedChatMessage {
  messageId: string;
  runId: string;
  delivery: "start" | "steer" | "follow_up";
  queuePosition?: number;
}

export interface ChatForkResult {
  taskId: string;
  sourceThreadId: string;
  threadId: string;
  branchPointEntryId: string;
  branchPosition: "before" | "at";
  piSessionId: string;
}

export interface CreateTaskInput {
  title: string;
  intent: string;
  kind: TaskKind;
  initialMessage?: string;
  batchId?: string;
  segmentIds?: string[];
  sourceLocale?: string;
  targetLocale?: string;
  assetPaths?: string[];
}

export interface DecisionInteractionAnswer {
  decisionId: string;
  selectedOptionIds?: string[];
  responseText?: string;
}

export type DecisionInteractionInput =
  | { action: "submit" | "elaborate"; answers: DecisionInteractionAnswer[]; reason?: string }
  | { action: "cancel"; reason?: string };

export interface DecisionInteractionResult {
  interactionId: string;
  pendingDecisionIds: string[];
  snapshot: TaskWorkspaceSnapshot;
}

export interface TaskDecisionInput {
  optionId: string;
  reason: string;
}

export interface TaskDecisionResult {
  snapshot: TaskWorkspaceSnapshot;
  applyResult?: { applied: unknown[] };
}

export type TeamWorkflowAction = "start" | "resume";

export interface TeamWorkflowPreflightPlan {
  projectId: string;
  workflowId: string;
  batchId?: string;
  createdAt: string;
  forceAllRoles: boolean;
  readiness: { status: "ready" | "blocked"; blockers: string[]; notes: string[] };
  roles: Array<{
    roleId: string;
    enabled: boolean;
    reason: string;
    dependencies: string[];
    modelRoute?: string;
    estimatedCalls: number;
  }>;
  selectedRoleIds: string[];
  modelRoutes: Record<string, string>;
  estimatedCalls: number;
  planHash: string;
}

export interface TeamWorkflowActionResult {
  workflowId: string;
  roleId?: string;
  status?: string;
  message?: string;
}

export interface StopRunResult {
  stopped: number;
  reason?: string;
  errors: string[];
}

export interface SpecialistFollowUpInput {
  message: string;
  artifactId?: string;
  activityId?: string;
}

export interface SpecialistFollowUpResult {
  taskId: string;
  runId: string;
  threadId: string;
  roleId: string;
}

export type PiSettingScope = "global" | "project";
export type AgentPermissionMode = "ask" | "auto" | "full" | "custom";
export type AgentPermissionDecision = "auto" | "ask" | "deny";
export type AgentPermissionUserDecision = "approve" | "deny";

export interface AgentPermissionRequestDTO {
  requestId: string;
  toolName: string;
  domain: "fileRead" | "fileWrite" | "webRead" | "bash" | "bridge";
  riskClass: "low" | "medium" | "high" | "protected" | "non_picker";
  argsSummary: string;
  sessionId?: string;
  projectId?: string;
  createdAt: string;
  expiresAt: string;
}

export interface TaskPermissionRequest extends AgentPermissionRequestDTO {
  status: "pending" | "approved" | "denied" | "expired" | "error";
  error?: string;
}

export interface PiSettingsField {
  path: string;
  section: string;
  type: "string" | "boolean" | "number" | "object" | "array";
  description: string;
  editable: boolean;
  restartRequired: boolean;
  options?: string[];
  globalOnly?: boolean;
  globalValue?: unknown;
  projectValue?: unknown;
  effectiveValue?: unknown;
  source: "project" | "global" | "default" | "unset";
}

export interface PiSettingsCatalog {
  docs: Record<string, string>;
  paths: { global: string; project: string; auth: string; models: string };
  sections: Array<{ id: string; label: string; fieldPaths: string[] }>;
  fields: PiSettingsField[];
  raw: { global: Record<string, unknown>; project: Record<string, unknown>; effective: Record<string, unknown> };
}

export interface PiProviderModel {
  id: string;
  name?: string | null;
  api?: string | null;
  provider: string;
  reasoning?: boolean | null;
  input?: string[] | null;
  contextWindow?: number | null;
  maxTokens?: number | null;
  available: boolean;
}

export interface PiProviderCatalog {
  docs: Record<string, string>;
  paths: { auth: string; models: string };
  defaults?: {
    provider?: string;
    modelId?: string;
    thinkingLevel?: AgentThinkingLevel;
  };
  totalModels: number;
  availableModels: number;
  providers: Array<{
    id: string;
    displayName: string;
    kind: "model" | "bridge";
    configured: boolean;
    authStatus: { configured?: boolean; source?: string; label?: string };
    apiKeyEnvVars?: string[];
    usesOAuth: boolean;
    keyLink: string;
    modelCount: number;
    availableModelCount: number;
    models: PiProviderModel[];
  }>;
}

export type AgentThinkingLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";

export interface AgentSessionSummary {
  id: string;
  path: string;
  firstMessage: string;
  displayName?: string | null;
  isProjectSession?: boolean;
  updatedAt?: string;
  messageCount?: number;
  contextTokens?: number | null;
  contextWindow?: number | null;
  contextPct?: number | null;
  tokenLabel?: string | null;
  compactionCount?: number;
  lastCompactionAt?: string;
  lastTokensBefore?: number;
  provider?: string;
  modelId?: string;
  thinkingLevel?: AgentThinkingLevel;
  inputTokens?: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  lastCost?: number;
}

export interface AgentSessionInfo {
  sessionDir: string;
  activeSessionId: string;
  sessions: AgentSessionSummary[];
  nextSessionMode?: "new";
}

export type PiAuthLoginStatus = "pending" | "completed" | "failed" | "cancelled";

export interface PiAuthLoginEvent {
  id: string;
  type: "auth" | "device_code" | "prompt" | "select" | "manual_code" | "progress";
  createdAt: string;
  answered?: boolean;
  url?: string;
  instructions?: string;
  userCode?: string;
  verificationUri?: string;
  intervalSeconds?: number;
  expiresInSeconds?: number;
  message?: string;
  placeholder?: string;
  allowEmpty?: boolean;
  options?: Array<{ id: string; label: string }>;
}

export interface PiAuthLoginSnapshot {
  docs: string;
  attemptId: string;
  provider: string;
  providerName: string;
  authType: "oauth";
  status: PiAuthLoginStatus;
  createdAt: string;
  updatedAt: string;
  message?: string;
  events: PiAuthLoginEvent[];
}

export interface PiProviderLogoutEnvelope {
  result: { docs: string; provider: string; loggedOut: boolean; message: string };
  catalog: PiProviderCatalog;
}

export interface AgentBridgeCatalog {
  policy: {
    noExtensions: boolean;
    customTools: boolean;
    mode: string;
    title: string;
    explanation: string;
    description: string;
  };
  summary: Array<{ label: string; value: number }>;
  bridges: Array<{
    id: string;
    label: string;
    kind: string;
    desiredToolName: string;
    purpose: string;
    status: "enabled" | "available_to_bridge" | "planned" | "blocked";
    statusLabel: string;
    configStatus: "configured" | "missing_credential" | "not_required" | "not_ready";
    configStatusLabel: string;
    configDetail: string;
    nextStep: string;
    bridgedToWeb: boolean;
  }>;
}

export type NativeComposerCapabilityId = "research" | "browser" | "computer" | "vision";

export interface AgentNativeCapabilityCatalog {
  schemaVersion: 1;
  capabilities: Array<{
    id: NativeComposerCapabilityId;
    label: string;
    description: string;
    packageName: string;
    version: string;
    source: string;
    activation: "on-demand" | "experimental";
    selectable: boolean;
    status: "ready" | "unavailable" | "setup_required" | "permission_required" | "consent_required";
    reason: string | null;
  }>;
}

export interface AgentPermissionContract {
  mode: AgentPermissionMode;
  presets: Array<{
    id: AgentPermissionMode;
    label: string;
    description: string;
    rules: Record<string, AgentPermissionDecision>;
  }>;
  customRules: Record<string, AgentPermissionDecision>;
  domains: Array<{
    id: string;
    label: string;
    description: string;
    riskClass: string;
    tools: string[];
  }>;
  effectivePolicy: Array<{
    domain: string;
    decision: AgentPermissionDecision;
    riskClass: string;
    source: string;
    locked: boolean;
    serverEnforced: boolean;
    label?: string | null;
  }>;
  hardRails: Array<{
    domain: string;
    decision: AgentPermissionDecision;
    riskClass: string;
    source: string;
    locked: boolean;
    serverEnforced: boolean;
    label?: string | null;
  }>;
}

export interface RuntimeHealthReport {
  status: string;
  versions: { la: string; piCodingAgent: string; piAi?: string | null; expectedPi: string };
  browserSessionPolicy: {
    noExtensions: boolean;
    customTools: boolean;
    builtinTools?: boolean;
    dataStoreWriteGuard?: boolean;
    nonCatToolResultsCitable?: boolean;
    toolSurface: string;
  };
  projectSessionPolicy: { strategy: string; storage: string };
  residentRuntime?: {
    label?: string;
    supported?: boolean;
    state?: string;
    pid?: number;
    port?: number;
    uptimeSec?: number;
    loopbackOnly?: boolean;
    autostartInstalled?: boolean;
    launchdRunning?: boolean;
    plistHasSecrets?: boolean;
    notes?: string[];
    lastError?: string | null;
  } | null;
  checks: Array<{ code: string; status: string; message: string; evidence?: unknown }>;
}

export interface PiPackagesCatalog {
  docs: string;
  paths: { global: string; project: string };
  entries: Array<{
    scope: PiSettingScope;
    index: number;
    source: string;
    sourceType: string;
    filtered: boolean;
  }>;
  configuredPackages?: Array<{
    source: string;
    scope: PiSettingScope;
    filtered: boolean;
    installedPath?: string | null;
  }>;
  resources?: {
    projectTrusted: boolean;
    defaultProjectTrust: string;
    skippedMissingSources: string[];
    counts: Record<string, { total: number; enabled: number; disabled: number }>;
    entries: Array<{
      type: string;
      path: string;
      enabled: boolean;
      source: string;
      scope: string;
      origin: string;
      baseDir?: string | null;
    }>;
  };
  risk: { requiresConfirmation: boolean; executesThirdPartyCode: boolean; message: string };
}

export interface CommunityPackageCatalogItem {
  name: string;
  version: string;
  description: string;
  keywords: string[];
  license: string | null;
  publisher: string | null;
  publishedAt: string | null;
  weeklyDownloads: number | null;
  monthlyDownloads?: number | null;
  npmUrl: string;
  piGalleryUrl: string;
  repositoryUrl: string | null;
}

export interface CommunityPackageCatalogPage {
  schemaVersion: 1;
  source: string;
  docs: string;
  fetchedAt: string;
  total: number;
  cursor: number;
  sourceCursor?: number;
  complete?: boolean;
  returned: number;
  nextCursor: number | null;
  stale: boolean;
  offline: boolean;
  refreshError?: string;
  items: CommunityPackageCatalogItem[];
}

export interface CapabilityDescriptor {
  schemaVersion: 1;
  package: { name: string; version: string; source: string; integrity: string; tarball: string; license: string | null; repository: string | null };
  tier: "core" | "labs";
  trust: "quarantined" | "approved";
  resources: { extensions: string[]; skills: string[]; prompts: string[]; themes: string[] };
  dependencyClosure: Array<{ path: string; name: string; version: string | null; integrity: string | null; license: string | null }>;
  lifecycleScripts: Array<{ packagePath: string; script: string; command: string }>;
  risks: Array<{ id: string; severity: "info" | "medium" | "high" | "critical"; detected: boolean; evidence: string[] }>;
  compatibility: { node: string | null; piPeers: Record<string, string>; runtime: "compatible" | "review_required"; notes: string[] };
  audit: { treeHash: string; archiveBytes: number; extractedBytes: number; fileCount: number; scannedTextFiles: number; createdAt: string };
}

export interface PackageInstallPreview {
  mode: "preview";
  planHash: string;
  descriptor: CapabilityDescriptor;
  requiredRiskIds: string[];
  expiresAt: string;
  docs: string;
}

export interface ManagedPackageRecord {
  packageName: string;
  version: string;
  installedAt: string;
  installPath: string;
  planHash: string;
  acceptedRiskIds: string[];
  descriptor: CapabilityDescriptor;
}

export interface ManagedPackageCatalog {
  docs: string;
  corePolicy: Array<{ name: string; version: string; reason: string }>;
  packages: ManagedPackageRecord[];
}

export interface PiKeybindingsCatalog {
  docs: string;
  path: string;
  reloadHint: string;
  actions: Array<{
    section: string;
    id: string;
    defaultKeys: string[];
    description: string;
    known: boolean;
    userKeys?: string[] | null;
    effectiveKeys: string[];
    customized: boolean;
  }>;
  conflicts: Array<{ key: string; actionIds: string[] }>;
}

export type NotificationCategory = "waiting" | "failed" | "completed" | "permission";

export interface NotificationPreferences {
  schemaVersion: 1;
  enabled: boolean;
  categories: Record<NotificationCategory, boolean>;
  updatedAt: string | null;
}

export interface PiThemesCatalog {
  docs: string;
  selected: { global?: string | null; project?: string | null; effective: string; source: string };
  themes: Array<{
    id: string;
    name: string;
    scope: string;
    path?: string | null;
    valid: boolean;
    colorCount: number;
    missingTokens: string[];
    selected: boolean;
  }>;
}

export type ProjectGuidanceScope = "term" | "style" | "tm" | "dup" | "general";

/** Wire mirror of packages/cat-data ProjectGuidanceDecision. */
export interface ProjectGuidanceDecision {
  id: string;
  scope: ProjectGuidanceScope;
  text: string;
  createdAt: string;
  source?: string;
}

/** Wire mirror of packages/cat-data MemoryConfig. */
export interface ProjectMemoryConfig {
  enabled: boolean;
  gatewayUrl: string;
}

/**
 * Wire mirror of packages/cat-server projectMemoryStatus. Read-only display DTO;
 * unknown fields are preserved verbatim instead of being re-derived in the renderer.
 */
export interface ProjectMemoryStatus {
  status?: string;
  enabled?: boolean;
  gatewayUrl?: string;
  gatewayReachable?: boolean;
  toolsAvailable?: boolean;
  captureEnabled?: boolean;
  cacheSafety?: string;
  userIdStrategy?: string;
  semantic?: {
    state?: string;
    assetVectorIndex?: string;
    indexedBlocks?: number;
    embeddingModel?: string;
    backend?: string;
    provider?: string;
    dim?: number;
    builtAt?: string;
    message?: string;
  };
  nextAction?: string;
  [key: string]: unknown;
}

export class WorkspaceAPIError extends Error {
  readonly status: number;
  readonly data: unknown;

  constructor(status: number, data: unknown) {
    super(errorMessage(data, status));
    this.name = "WorkspaceAPIError";
    this.status = status;
    this.data = data;
  }
}

function errorMessage(data: unknown, status: number): string {
  if (data && typeof data === "object" && "error" in data) {
    if (typeof data.error === "string") return data.error;
    if (data.error && typeof data.error === "object" && "message" in data.error && typeof data.error.message === "string") return data.error.message;
  }
  return `Linguist Agent runtime returned HTTP ${status}.`;
}

function pathPart(value: string): string {
  return encodeURIComponent(value);
}

function taskApiPath(locator: TaskLocator): `/api/${string}` {
  return locator.kind === "standalone"
    ? `/api/tasks/${pathPart(locator.taskId)}`
    : `/api/projects/${pathPart(locator.projectId)}/tasks/${pathPart(locator.taskId)}`;
}

export function taskAgentSessionId(taskId: string): string {
  return `la-task-${taskId}`;
}

export function standaloneAgentSessionPrefix(taskId: string): string {
  const safeTask = taskId.replace(/[^A-Za-z0-9._-]+/g, "-").slice(0, 48) || "chat";
  return `la-chat-${safeTask}-`;
}

function permissionRequest(value: unknown): AgentPermissionRequestDTO | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  const domain = row.domain;
  const riskClass = row.riskClass;
  if (
    typeof row.requestId !== "string" || !row.requestId
    || typeof row.toolName !== "string" || !row.toolName
    || !["fileRead", "fileWrite", "webRead", "bash", "bridge"].includes(String(domain))
    || !["low", "medium", "high", "protected", "non_picker"].includes(String(riskClass))
    || typeof row.argsSummary !== "string"
    || typeof row.createdAt !== "string"
    || typeof row.expiresAt !== "string"
  ) return null;
  return row as unknown as AgentPermissionRequestDTO;
}

export function taskPermissionRequestFromStream(
  value: unknown,
  projectId: string,
  taskId: string,
): TaskPermissionRequest | null {
  const row = permissionRequest(value);
  if (!row || row.projectId !== projectId || row.sessionId !== taskAgentSessionId(taskId)) return null;
  return { ...row, status: Date.parse(row.expiresAt) <= Date.now() ? "expired" : "pending" };
}

export function standalonePermissionRequestFromStream(
  value: unknown,
  taskId: string,
): TaskPermissionRequest | null {
  const row = permissionRequest(value);
  if (
    !row
    || (typeof row.projectId === "string" && row.projectId.length > 0)
    || typeof row.sessionId !== "string"
    || !row.sessionId.startsWith(standaloneAgentSessionPrefix(taskId))
  ) return null;
  return { ...row, status: Date.parse(row.expiresAt) <= Date.now() ? "expired" : "pending" };
}

function withQuery(path: `/api/${string}`, values: Record<string, string | undefined>): `/api/${string}` {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(values)) if (value !== undefined) query.set(key, value);
  const suffix = query.toString();
  return (suffix ? `${path}?${suffix}` : path) as `/api/${string}`;
}

async function request<T>(method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE", path: `/api/${string}`, body?: unknown): Promise<T> {
  const response = await window.linguist.api.request<T>({ method, path, ...(body === undefined ? {} : { body }) });
  if (!response.ok) throw new WorkspaceAPIError(response.status, response.data);
  return response.data;
}

export const workspaceClient = {
  runtimeStatus: () => window.linguist.runtime.status(),

  fetchPiSettings: () => request<PiSettingsCatalog>("GET", "/api/pi/settings-catalog"),

  updatePiSetting: (scope: PiSettingScope, path: string, value: unknown, unset = false) => request<PiSettingsCatalog>(
    "PUT",
    "/api/pi/settings",
    { scope, path, value, unset },
  ),

  fetchPiProviders: () => request<PiProviderCatalog>("GET", "/api/pi/providers"),

  savePiProviderApiKey: (provider: string, apiKey: string) => request<PiProviderCatalog>(
    "POST",
    "/api/pi/auth/api-key",
    { provider, apiKey },
  ),

  startPiProviderLogin: (provider: string) => request<PiAuthLoginSnapshot>(
    "POST",
    "/api/pi/auth/login/start",
    { provider },
  ),

  fetchPiProviderLogin: (attemptId: string) => request<PiAuthLoginSnapshot>(
    "GET",
    `/api/pi/auth/login/status?attemptId=${encodeURIComponent(attemptId)}`,
  ),

  answerPiProviderLogin: (attemptId: string, eventId: string, value?: string) => request<PiAuthLoginSnapshot>(
    "POST",
    "/api/pi/auth/login/answer",
    { attemptId, eventId, ...(value === undefined ? {} : { value }) },
  ),

  cancelPiProviderLogin: (attemptId: string) => request<PiAuthLoginSnapshot>(
    "POST",
    "/api/pi/auth/login/cancel",
    { attemptId },
  ),

  logoutPiProviderAuth: (provider: string) => request<PiProviderLogoutEnvelope>(
    "POST",
    "/api/pi/auth/logout",
    { provider },
  ),

  fetchAgentBridges: () => request<AgentBridgeCatalog>("GET", "/api/agent/bridges"),

  fetchAgentNativeCapabilities: () => request<AgentNativeCapabilityCatalog>("GET", "/api/agent/native-capabilities"),

  fetchAgentPermissions: () => request<AgentPermissionContract>("GET", "/api/agent/permissions"),

  async listTaskPermissionRequests(projectId: string, taskId: string): Promise<TaskPermissionRequest[]> {
    const result = await request<{ requests?: unknown[] }>("GET", "/api/agent/permissions/pending");
    return (result.requests ?? [])
      .map((row) => taskPermissionRequestFromStream(row, projectId, taskId))
      .filter((row): row is TaskPermissionRequest => row !== null);
  },

  async listStandalonePermissionRequests(taskId: string): Promise<TaskPermissionRequest[]> {
    const result = await request<{ requests?: unknown[] }>("GET", "/api/agent/permissions/pending");
    return (result.requests ?? [])
      .map((row) => standalonePermissionRequestFromStream(row, taskId))
      .filter((row): row is TaskPermissionRequest => row !== null);
  },

  decidePermission: (
    requestId: string,
    decision: AgentPermissionUserDecision,
    reason?: string,
  ) => request<{ ok: true; request: AgentPermissionRequestDTO }>(
    "POST",
    "/api/agent/permissions/decision",
    { requestId, decision, ...(reason?.trim() ? { reason: reason.trim() } : {}) },
  ),

  updateAgentPermissions: (input: { mode: AgentPermissionMode; customRules?: Record<string, AgentPermissionDecision> }) => request<AgentPermissionContract>(
    "PUT",
    "/api/agent/permissions",
    input,
  ),

  fetchRuntimeHealth: () => request<RuntimeHealthReport>("GET", "/api/runtime/health"),

  fetchPiPackages: () => request<PiPackagesCatalog>("GET", "/api/pi/packages"),

  fetchCommunityPackageCatalog: (input: { query?: string; cursor?: number; limit?: number; refresh?: boolean } = {}) => {
    const search = new URLSearchParams();
    if (input.query?.trim()) search.set("q", input.query.trim());
    if (input.cursor !== undefined) search.set("cursor", String(input.cursor));
    if (input.limit !== undefined) search.set("limit", String(input.limit));
    if (input.refresh) search.set("refresh", "1");
    const suffix = search.size ? `?${search.toString()}` : "";
    return request<CommunityPackageCatalogPage>("GET", `/api/package-center/catalog${suffix}`);
  },

  fetchManagedPackages: () => request<ManagedPackageCatalog>("GET", "/api/package-center/installed"),

  previewManagedPackageInstall: (name: string, version: string) => request<PackageInstallPreview>(
    "POST",
    "/api/package-center/install/preview",
    { name, version },
  ),

  installManagedPackage: (input: { planHash: string; name: string; version: string; confirmedVersion: string; acceptedRiskIds: string[] }) => request<{ package: ManagedPackageRecord }>(
    "POST",
    "/api/package-center/install",
    input,
  ),

  fetchPiKeybindings: () => request<PiKeybindingsCatalog>("GET", "/api/pi/keybindings"),

  updatePiKeybindingAction: (input: { id: string; keys?: string[]; unset?: boolean }) => request<PiKeybindingsCatalog>(
    "PUT",
    "/api/pi/keybindings/action",
    input,
  ),

  fetchNotificationPreferences: () => request<NotificationPreferences>("GET", "/api/notifications/preferences"),

  updateNotificationPreferences: (input: {
    enabled: boolean;
    categories: Record<NotificationCategory, boolean>;
    expectedUpdatedAt: string | null;
  }) => request<NotificationPreferences>("PUT", "/api/notifications/preferences", input),

  fetchPiThemes: () => request<PiThemesCatalog>("GET", "/api/pi/themes"),

  updatePiThemeSelection: (theme: string, scope: PiSettingScope = "global") => request<PiThemesCatalog>(
    "PUT",
    "/api/pi/themes/selection",
    { scope, theme },
  ),

  fetchMemoryConfig: (projectId: string) => request<ProjectMemoryConfig>(
    "GET",
    `/api/projects/${pathPart(projectId)}/memory`,
  ),

  updateMemoryConfig: (projectId: string, input: { enabled?: boolean; gatewayUrl?: string }) => request<ProjectMemoryConfig>(
    "PUT",
    `/api/projects/${pathPart(projectId)}/memory`,
    input,
  ),

  fetchMemoryStatus: (projectId: string) => request<ProjectMemoryStatus>(
    "GET",
    `/api/projects/${pathPart(projectId)}/memory/status`,
  ),

  fetchMemoryGuidance: (projectId: string) => request<{ guidance: ProjectGuidanceDecision[] }>(
    "GET",
    `/api/projects/${pathPart(projectId)}/memory/guidance`,
  ),

  updateMemoryGuidance: (projectId: string, guidance: ProjectGuidanceDecision[]) => request<{ guidance: ProjectGuidanceDecision[] }>(
    "PUT",
    `/api/projects/${pathPart(projectId)}/memory/guidance`,
    { guidance },
  ),

  listProjects: () => request<ProjectListResponse>("GET", "/api/projects"),

  listProjectAssets: (projectId: string) => request<ProjectAssetsCatalog>(
    "GET",
    `/api/projects/${pathPart(projectId)}/assets`,
  ),

  searchProjectAssets: (projectId: string, query: string, limit = 40) => request<ProjectAssetSearchResponse>(
    "GET",
    `/api/projects/${pathPart(projectId)}/assets/search?q=${encodeURIComponent(query)}&limit=${limit}`,
  ),

  readProjectAsset: (projectId: string, assetPath: string, maxChars = 24_000) => request<ProjectAssetReadResponse>(
    "GET",
    `/api/projects/${pathPart(projectId)}/assets/read?path=${encodeURIComponent(assetPath)}&maxChars=${maxChars}`,
  ),

  previewProjectWorkbook: (projectId: string, assetPath: string) => request<ProjectWorkbookPreview>(
    "GET",
    `/api/projects/${pathPart(projectId)}/assets/workbook-preview?path=${encodeURIComponent(assetPath)}`,
  ),

  readProjectWorkbookRows: (
    projectId: string,
    assetPath: string,
    sheetName: string,
    offset = 0,
    limit = 200,
  ) => request<ProjectWorkbookSheetPage>(
    "GET",
    `/api/projects/${pathPart(projectId)}/assets/workbook-rows?path=${encodeURIComponent(assetPath)}&sheetName=${encodeURIComponent(sheetName)}&offset=${offset}&limit=${limit}`,
  ),

  parseProjectAsset: (projectId: string, assetPath: string, mode: AssetParseMode = "structured") => request<AssetParseResult>(
    "POST",
    `/api/projects/${pathPart(projectId)}/assets/parse-preview`,
    { assetPath, mode, maxSheets: 12, sampleRows: 5, purpose: "reference" },
  ),

  createProject: (input: CreateProjectInput) => request<CreateProjectResponse>("POST", "/api/projects", input),

  importBatch: (projectId: string, filePath: string) => request<BatchImportResponse>(
    "POST",
    `/api/projects/${pathPart(projectId)}/batches`,
    { filePath },
  ),

  openBatch: (projectId: string, batchId: string) => request<BatchResponse>(
    "GET",
    `/api/projects/${pathPart(projectId)}/batches/${pathPart(batchId)}`,
  ),

  openBatchSummary: (projectId: string, batchId: string) => request<BatchSummaryResponse>(
    "GET",
    `/api/projects/${pathPart(projectId)}/batches/${pathPart(batchId)}?responseMode=summary`,
  ),

  runQualityAudit: (scope: { projectId: string; batchId: string; taskId: string }) => request<QualityAuditReportDTO>(
    "GET",
    withQuery(`/api/projects/${pathPart(scope.projectId)}/batches/${pathPart(scope.batchId)}/quality`, { taskId: scope.taskId }),
  ),

  runDeliveryQa: (scope: { projectId: string; batchId: string; taskId: string }) => request<DeliveryQaReportDTO>(
    "POST",
    `/api/projects/${pathPart(scope.projectId)}/batches/${pathPart(scope.batchId)}/delivery-qa`,
    { taskId: scope.taskId },
  ),

  reviewDeliveryQa: (
    scope: { projectId: string; batchId: string; taskId: string },
    input: { reportId: string; findingId: string; decision: "fix_required" | "ignore_with_reason" | "query" | "accepted_risk"; reason: string },
  ) => request<ReviewedDeliveryQaReportDTO>(
    "POST",
    `/api/projects/${pathPart(scope.projectId)}/batches/${pathPart(scope.batchId)}/delivery-qa-review`,
    {
      taskId: scope.taskId,
      reportId: input.reportId,
      decisions: [{
        findingId: input.findingId,
        reviewDecision: input.decision,
        reviewReason: input.reason,
        reviewedBy: "user",
      }],
    },
  ),

  recordQualityWaiver: (
    scope: { projectId: string; batchId: string; taskId: string },
    input: { segmentId: string; findingId: string; code: string; reason: string },
  ) => request<unknown>(
    "POST",
    `/api/projects/${pathPart(scope.projectId)}/batches/${pathPart(scope.batchId)}/quality/waivers`,
    { ...input, taskId: scope.taskId, acceptedBy: "user" },
  ),

  checkDeliveryReadiness: (scope: { projectId: string; batchId: string; taskId: string }) => request<DeliveryReadinessReportDTO>(
    "GET",
    withQuery(`/api/projects/${pathPart(scope.projectId)}/batches/${pathPart(scope.batchId)}/delivery-readiness`, { taskId: scope.taskId }),
  ),

  exportDelivery: (
    scope: { projectId: string; batchId: string; taskId: string },
    input: { format: "phrase_mxliff" | "phrase_docx" | "mqxliff" | "sdlxliff" | "xliff" | "csv" | "xlsx"; outputPath?: string; role?: "T" | "E" | "P"; templateDocxPath?: string },
  ) => request<DeliveryExportResultDTO>(
    "POST",
    `/api/projects/${pathPart(scope.projectId)}/batches/${pathPart(scope.batchId)}/export`,
    { ...input, taskId: scope.taskId, force: false },
  ),

  fetchSegmentTagContract: (projectId: string, source: string, target: string) => request<SegmentTagContract>(
    "POST",
    "/api/cat/tag-tokens",
    { projectId, text: source, source, target },
  ),

  fetchSegmentEvidence: (projectId: string, batchId: string, segmentId: string) => request<SegmentEvidenceSnapshot>(
    "GET",
    `/api/projects/${pathPart(projectId)}/batches/${pathPart(batchId)}/segments/${pathPart(segmentId)}/evidence`,
  ),

  async saveSegment(
    projectId: string,
    batchId: string,
    segmentId: string,
    input: SaveSegmentInput,
  ): Promise<SaveSegmentOutcome> {
    const response = await window.linguist.api.request<Record<string, unknown>>({
      method: "POST",
      path: `/api/projects/${pathPart(projectId)}/batches/${pathPart(batchId)}/segments/${pathPart(segmentId)}`,
      body: {
        target: input.target,
        confirm: input.confirm,
        propagateDuplicates: false,
        reason: input.confirm ? "Electron CAT confirmation" : "Electron CAT draft autosave",
        changeType: input.confirm ? "user_approved" : "translation",
        responseMode: "segment",
        expectedSegmentUpdatedAt: input.expectedSegmentUpdatedAt,
      },
    });
    if (response.ok) return { kind: "saved", ...response.data } as Extract<SaveSegmentOutcome, { kind: "saved" }>;
    if (
      response.status === 409
      && response.data.error === "segment_revision_conflict"
      && "currentSegment" in response.data
      && "batchUpdatedAt" in response.data
    ) {
      return { kind: "conflict", ...response.data } as Extract<SaveSegmentOutcome, { kind: "conflict" }>;
    }
    throw new WorkspaceAPIError(response.status, response.data);
  },

  listTasks: (projectId: string) => request<TaskListResponse>(
    "GET",
    `/api/projects/${pathPart(projectId)}/tasks`,
  ),

  async openTask(projectId: string, taskId: string): Promise<TaskWorkspaceSnapshot> {
    return parseTaskWorkspaceSnapshot(await request<unknown>(
      "GET",
      `/api/projects/${pathPart(projectId)}/tasks/${pathPart(taskId)}`,
    ));
  },

  async createTask(projectId: string, input: CreateTaskInput): Promise<TaskWorkspaceSnapshot> {
    return parseTaskWorkspaceSnapshot(await request<unknown>(
      "POST",
      `/api/projects/${pathPart(projectId)}/tasks`,
      input,
    ));
  },

  listChats: () => request<TaskListResponse>("GET", "/api/tasks"),

  fetchLibrary: (scope: AssistantLibraryScope) => request<AssistantLibraryCatalog>(
    "GET",
    withQuery("/api/library", scope.kind === "personal" ? { scope: "personal" } : { scope: "project", projectId: scope.projectId }),
  ),

  importLibrary: (scope: AssistantLibraryScope, sourcePaths: string[], semantic = true) => request<AssistantLibraryIndexReport>(
    "POST",
    "/api/library/import",
    { scope: scope.kind, ...(scope.kind === "project" ? { projectId: scope.projectId } : {}), sourcePaths, semantic },
  ),

  reindexLibrary: (scope: AssistantLibraryScope, semantic = true) => request<AssistantLibraryIndexReport>(
    "POST",
    "/api/library/reindex",
    { scope: scope.kind, ...(scope.kind === "project" ? { projectId: scope.projectId } : {}), semantic },
  ),

  removeLibraryDocument: (scope: AssistantLibraryScope, documentId: string) => request<AssistantLibraryIndexReport>(
    "DELETE",
    `/api/library/documents/${pathPart(documentId)}`,
    { scope: scope.kind, ...(scope.kind === "project" ? { projectId: scope.projectId } : {}) },
  ),

  searchLibrary: (scope: AssistantLibraryScope, query: string, options: { includePersonal?: boolean; retrievalMode?: "lexical" | "vector" | "hybrid"; limit?: number } = {}) => request<AssistantLibrarySearchReport>(
    "GET",
    withQuery("/api/library/search", {
      scope: scope.kind,
      projectId: scope.kind === "project" ? scope.projectId : undefined,
      q: query,
      includePersonal: options.includePersonal === undefined ? undefined : String(options.includePersonal),
      retrievalMode: options.retrievalMode,
      limit: options.limit === undefined ? undefined : String(options.limit),
    }),
  ),

  fetchLocalEmbeddingCapability: () => request<LocalEmbeddingCapabilityStatus>("GET", "/api/capabilities/embeddings/multilingual-e5"),

  installLocalEmbeddingCapability: () => request<LocalEmbeddingCapabilityStatus>("POST", "/api/capabilities/embeddings/multilingual-e5/install", {}),

  fetchManagedDocumentCapabilities: () => request<ManagedDocumentCapabilityCatalog>("GET", "/api/capabilities/documents"),

  previewManagedDocumentCapabilityInstall: (capabilityId: ManagedDocumentCapabilityStatus["id"]) => request<ManagedDocumentInstallPlan>(
    "POST",
    `/api/capabilities/documents/${pathPart(capabilityId)}/preview`,
    {},
  ),

  installManagedDocumentCapability: (capabilityId: ManagedDocumentCapabilityStatus["id"], planHash: string) => request<ManagedDocumentCapabilityStatus>(
    "POST",
    `/api/capabilities/documents/${pathPart(capabilityId)}/install`,
    { planHash },
  ),

  extractDocumentEvidence: (input: { taskId: string; sourcePath: string; useOrientation?: boolean }) => request<unknown>(
    "POST",
    "/api/documents/evidence",
    input,
  ).then(parseTaskWorkspaceSnapshot),

  listAssistantMemories: (scope: AssistantLibraryScope) => request<{ scope: AssistantLibraryScope; memories: AssistantMemoryDTO[] }>(
    "GET",
    withQuery("/api/memories", scope.kind === "personal" ? { scope: "personal" } : { scope: "project", projectId: scope.projectId }),
  ),

  proposeAssistantMemory: (scope: AssistantLibraryScope, input: { kind: AssistantMemoryKind; text: string; source: { taskId: string; activityId?: string; artifactId?: string } }) => request<{ memory: AssistantMemoryDTO }>(
    "POST",
    "/api/memories",
    { scope: scope.kind, ...(scope.kind === "project" ? { projectId: scope.projectId } : {}), ...input },
  ),

  confirmAssistantMemory: (scope: AssistantLibraryScope, id: string) => request<{ memory: AssistantMemoryDTO }>(
    "POST",
    `/api/memories/${pathPart(id)}/confirm`,
    { scope: scope.kind, ...(scope.kind === "project" ? { projectId: scope.projectId } : {}) },
  ),

  editAssistantMemory: (scope: AssistantLibraryScope, id: string, input: { expectedRevision: number; text?: string; kind?: AssistantMemoryKind }) => request<{ memory: AssistantMemoryDTO }>(
    "PATCH",
    `/api/memories/${pathPart(id)}`,
    { scope: scope.kind, ...(scope.kind === "project" ? { projectId: scope.projectId } : {}), ...input },
  ),

  revokeAssistantMemory: (scope: AssistantLibraryScope, id: string) => request<{ memory: AssistantMemoryDTO }>(
    "DELETE",
    withQuery(`/api/memories/${pathPart(id)}`, scope.kind === "personal" ? { scope: "personal" } : { scope: "project", projectId: scope.projectId }),
  ),

  async openChat(taskId: string): Promise<TaskWorkspaceSnapshot> {
    return parseTaskWorkspaceSnapshot(await request<unknown>(
      "GET",
      `/api/tasks/${pathPart(taskId)}`,
    ));
  },

  listChatFileGrants: (taskId: string) => request<{ grants: StandaloneFileGrantDTO[] }>(
    "GET",
    `/api/tasks/${pathPart(taskId)}/file-grants`,
  ),

  createChatFileGrant: (taskId: string, input: { path: string; kind: "file" | "directory"; access: "read" | "read_write"; recursive?: boolean }) => request<{ grant: StandaloneFileGrantDTO; grants: StandaloneFileGrantDTO[] }>(
    "POST",
    `/api/tasks/${pathPart(taskId)}/file-grants`,
    input,
  ),

  setChatWorkingDirectory: (taskId: string, grantId: string) => request<TaskWorkspaceSnapshot>(
    "POST",
    `/api/tasks/${pathPart(taskId)}/working-directory`,
    { grantId },
  ),

  previewMaintenance: (taskId: string, input: { grantId: string; targetPiVersion: string }) => request<{ plan: MaintenancePlanDTO; snapshot: TaskWorkspaceSnapshot }>(
    "POST",
    `/api/tasks/${pathPart(taskId)}/maintenance/preview`,
    input,
  ),

  startMaintenanceBuild: (taskId: string, planHash: string) => request<{ job: MaintenanceJobDTO }>(
    "POST",
    `/api/tasks/${pathPart(taskId)}/maintenance/build`,
    { planHash },
  ),

  fetchMaintenanceBuild: (taskId: string) => request<{ job: MaintenanceJobDTO }>(
    "GET",
    `/api/tasks/${pathPart(taskId)}/maintenance/build`,
  ),

  approveMaintenanceActivation: (taskId: string, input: { reportSha256: string; confirmation: string }) => request<{ handoff: MaintenanceActivationHandoff }>(
    "POST",
    `/api/tasks/${pathPart(taskId)}/maintenance/activate`,
    input,
  ),

  async createChat(input: CreateChatInput = {}): Promise<TaskWorkspaceSnapshot> {
    return parseTaskWorkspaceSnapshot(await request<unknown>("POST", "/api/tasks", input));
  },

  async renameChat(taskId: string, title: string): Promise<TaskWorkspaceSnapshot> {
    return parseTaskWorkspaceSnapshot(await request<unknown>(
      "PATCH",
      `/api/tasks/${pathPart(taskId)}`,
      { title },
    ));
  },

  archiveChat: (taskId: string) => request<TaskWorkspaceSnapshot>(
    "POST",
    `/api/tasks/${pathPart(taskId)}/archive`,
    {},
  ).then(parseTaskWorkspaceSnapshot),

  restoreChat: (taskId: string) => request<TaskWorkspaceSnapshot>(
    "POST",
    `/api/tasks/${pathPart(taskId)}/restore`,
    {},
  ).then(parseTaskWorkspaceSnapshot),

  sendChatMessage: (
    taskId: string,
    input: { message: string; delivery?: "auto" | "steer" | "follow_up"; agentThreadId?: string; modelProvider?: string; modelId?: string; thinkingLevel?: AgentThinkingLevel },
  ) => request<AcceptedChatMessage>("POST", `/api/tasks/${pathPart(taskId)}/messages`, input),

  sendTaskMessage: (
    projectId: string,
    taskId: string,
    input: { message: string; delivery: "steer" | "follow_up" },
  ) => request<AcceptedChatMessage>("POST", `/api/projects/${pathPart(projectId)}/tasks/${pathPart(taskId)}/messages`, input),

  fetchTaskMessageQueue: (locator: TaskLocator) => request<TaskMessageQueue>(
    "GET",
    `${taskApiPath(locator)}/message-queue`,
  ),

  editTaskQueuedMessage: (locator: TaskLocator, messageId: string, text: string) => request<TaskMessageQueue>(
    "PATCH",
    `${taskApiPath(locator)}/message-queue/${pathPart(messageId)}`,
    { text },
  ),

  deleteTaskQueuedMessage: (locator: TaskLocator, messageId: string) => request<TaskMessageQueue>(
    "DELETE",
    `${taskApiPath(locator)}/message-queue/${pathPart(messageId)}`,
  ),

  clearTaskMessageQueue: (locator: TaskLocator) => request<TaskMessageQueue>(
    "DELETE",
    `${taskApiPath(locator)}/message-queue`,
  ),

  reorderTaskMessageQueue: (locator: TaskLocator, messageIds: string[]) => request<TaskMessageQueue>(
    "POST",
    `${taskApiPath(locator)}/message-queue/reorder`,
    { messageIds },
  ),

  pauseTaskMessageQueue: (locator: TaskLocator) => request<TaskMessageQueue>(
    "POST",
    `${taskApiPath(locator)}/message-queue/pause`,
    {},
  ),

  resumeTaskMessageQueue: (locator: TaskLocator) => request<TaskMessageQueue>(
    "POST",
    `${taskApiPath(locator)}/message-queue/resume`,
    {},
  ),

  retryTaskQueuedMessage: (locator: TaskLocator, messageId: string) => request<TaskMessageQueue>(
    "POST",
    `${taskApiPath(locator)}/message-queue/${pathPart(messageId)}/retry`,
    {},
  ),

  steerTaskQueuedMessage: (locator: TaskLocator, messageId: string) => request<TaskMessageQueue>(
    "POST",
    `${taskApiPath(locator)}/message-queue/${pathPart(messageId)}/steer`,
    {},
  ),

  streamChatMessage(
    input: { taskId: string; message: string; delivery?: "auto" | "steer" | "follow_up"; agentThreadId?: string; modelProvider?: string; modelId?: string; thinkingLevel?: AgentThinkingLevel },
    onEvent: (event: unknown) => void,
    onState?: (state: StreamState) => void,
  ): () => void {
    return window.linguist.api.streamStandaloneChat(input, onEvent, onState);
  },

  compactChat: (taskId: string, input: { customInstructions?: string; agentThreadId?: string } = {}) => request<unknown>(
    "POST",
    `/api/tasks/${pathPart(taskId)}/compact`,
    input,
  ),

  forkChat: (taskId: string, input: { sourceThreadId?: string; entryId?: string; position?: "before" | "at" } = {}) => request<ChatForkResult>(
    "POST",
    `/api/tasks/${pathPart(taskId)}/forks`,
    input,
  ),

  copyChat: (taskId: string, input: { title?: string; throughActivityId?: string } = {}) => request<unknown>(
    "POST",
    `/api/tasks/${pathPart(taskId)}/handoff`,
    input,
  ).then(parseTaskWorkspaceSnapshot),

  stopChat: (taskId: string, input: { reason?: string } = {}) => request<StopRunResult>(
    "POST",
    `/api/tasks/${pathPart(taskId)}/stop`,
    input,
  ),

  deleteProject: (projectId: string) => request<{ projectId: string; deleted: boolean; path: string }>(
    "DELETE",
    `/api/projects/${pathPart(projectId)}`,
  ),
  async renameTask(projectId: string, taskId: string, title: string): Promise<TaskWorkspaceSnapshot> {
    return parseTaskWorkspaceSnapshot(await request<unknown>(
      "PATCH",
      `/api/projects/${pathPart(projectId)}/tasks/${pathPart(taskId)}`,
      { title },
    ));
  },

  subscribeTaskEvents(
    locator: TaskLocator,
    afterCursor: string,
    onEvent: (event: unknown) => void,
    onState?: (state: StreamState) => void,
  ): () => void {
    return window.linguist.api.subscribeTaskEvents({ ...locator, afterCursor }, onEvent, onState);
  },

  streamTaskChat(
    input: {
      projectId: string;
      taskId: string;
      message: string;
      runId?: string;
      segmentId?: string;
      modelProvider?: string;
      modelId?: string;
      thinkingLevel?: AgentThinkingLevel;
      assetPaths?: string[];
      capabilityIds?: NativeComposerCapabilityId[];
    },
    onEvent: (event: unknown) => void,
    onState?: (state: StreamState) => void,
  ): () => void {
    return window.linguist.api.streamTaskChat(input, onEvent, onState);
  },

  fetchTaskAgentSession: (projectId: string, taskId: string) => request<AgentSessionInfo>(
    "GET",
    `/api/projects/${pathPart(projectId)}/tasks/${pathPart(taskId)}/session`,
  ),

  stopTask: (projectId: string, taskId: string, input: { reason?: string; turnId?: string } = {}) => request<StopRunResult>(
    "POST",
    `/api/projects/${pathPart(projectId)}/tasks/${pathPart(taskId)}/stop`,
    input,
  ),

  stopTeamWorkflow: (
    projectId: string,
    workflowId: string,
    input: { reason?: string; roleId?: string } = {},
  ) => request<StopRunResult>(
    "POST",
    `/api/projects/${pathPart(projectId)}/workflows/${pathPart(workflowId)}/${input.roleId ? "role-stop" : "stop"}`,
    input,
  ),

  startSpecialistFollowUp: (
    projectId: string,
    taskId: string,
    sourceThreadId: string,
    input: SpecialistFollowUpInput,
  ) => request<SpecialistFollowUpResult>(
    "POST",
    `/api/projects/${pathPart(projectId)}/tasks/${pathPart(taskId)}/threads/${pathPart(sourceThreadId)}/follow-up`,
    input,
  ),

  async commitDecisionInteraction(
    projectId: string,
    taskId: string,
    interactionId: string,
    input: DecisionInteractionInput,
  ): Promise<DecisionInteractionResult> {
    const result = await request<Omit<DecisionInteractionResult, "snapshot"> & { snapshot: unknown }>(
      "POST",
      `/api/projects/${pathPart(projectId)}/tasks/${pathPart(taskId)}/decision-interactions/${pathPart(interactionId)}`,
      input,
    );
    return { ...result, snapshot: parseTaskWorkspaceSnapshot(result.snapshot) };
  },

  async commitTaskDecision(
    projectId: string,
    taskId: string,
    decisionId: string,
    input: TaskDecisionInput,
  ): Promise<TaskDecisionResult> {
    const result = await request<Omit<TaskDecisionResult, "snapshot"> & { snapshot: unknown }>(
      "POST",
      `/api/projects/${pathPart(projectId)}/tasks/${pathPart(taskId)}/decisions/${pathPart(decisionId)}`,
      input,
    );
    return { ...result, snapshot: parseTaskWorkspaceSnapshot(result.snapshot) };
  },

  preflightTeamWorkflow: (projectId: string, workflowId: string, forceAllRoles = false) => request<TeamWorkflowPreflightPlan>(
    "POST",
    `/api/projects/${pathPart(projectId)}/workflows/${pathPart(workflowId)}/preflight`,
    { forceAllRoles },
  ),

  runTeamWorkflow: (
    projectId: string,
    workflowId: string,
    action: TeamWorkflowAction,
    planHash: string,
    forceAllRoles = false,
  ) => request<TeamWorkflowActionResult>(
    "POST",
    `/api/projects/${pathPart(projectId)}/workflows/${pathPart(workflowId)}/${action}`,
    { planHash, forceAllRoles },
  ),

  listPrivateEvalSets: () => request<{ rows: PrivateEvalSetDTO[] }>("GET", "/api/evals/private"),

  listPrivateEvalRuns: (evalSetId: string) => request<{ rows: PrivateEvalRunDTO[] }>(
    "GET",
    `/api/evals/private/${pathPart(evalSetId)}/runs`,
  ),

  fetchPrivateEvalRunOutputs: (evalSetId: string, runId: string) => request<{ rows: PrivateEvalRunOutputDTO[] }>(
    "GET",
    `/api/evals/private/${pathPart(evalSetId)}/runs/${pathPart(runId)}/outputs`,
  ),

  launchPrivateEval: (input: PrivateEvalLaunchInput) => request<PrivateEvalExecutionResponseDTO>(
    "POST",
    `/api/evals/private/${pathPart(input.evalSetId)}/runs`,
    {
      execute: true,
      background: true,
      projectId: input.projectId,
      batchId: input.batchId,
      mode: input.mode,
      ...(input.modelRoutes === undefined ? {} : { modelRoutes: input.modelRoutes }),
      ...(input.thinkingLevel === undefined ? {} : { thinkingLevel: input.thinkingLevel }),
      ...(input.segmentLimit === undefined ? {} : { segmentLimit: input.segmentLimit }),
      ...(input.resumedFromRunId === undefined ? {} : { resumedFromRunId: input.resumedFromRunId }),
    },
  ),

  stopPrivateEval: (evalSetId: string, runId: string, reason = "user stop") => request<{ stopped: number; errors: string[] }>(
    "POST",
    `/api/evals/private/${pathPart(evalSetId)}/runs/${pathPart(runId)}/stop`,
    { reason },
  ),

  listPrivateEvalBlindReviews: (evalSetId: string) => request<{ rows: PrivateEvalBlindReviewSummaryDTO[] }>(
    "GET",
    `/api/evals/private/${pathPart(evalSetId)}/blind-reviews`,
  ),

  createPrivateEvalBlindReview: (evalSetId: string, input: PrivateEvalBlindReviewInputDTO) => request<PrivateEvalBlindReviewDTO>(
    "POST",
    `/api/evals/private/${pathPart(evalSetId)}/blind-reviews`,
    input,
  ),

  fetchPrivateEvalBlindReview: (evalSetId: string, reviewId: string) => request<PrivateEvalBlindReviewDTO>(
    "GET",
    `/api/evals/private/${pathPart(evalSetId)}/blind-reviews/${pathPart(reviewId)}`,
  ),

  submitPrivateEvalBlindJudgments: (
    evalSetId: string,
    reviewId: string,
    rows: PrivateEvalBlindJudgmentInputDTO[],
  ) => request<PrivateEvalBlindReviewDTO>(
    "POST",
    `/api/evals/private/${pathPart(evalSetId)}/blind-reviews/${pathPart(reviewId)}/judgments`,
    { rows },
  ),

  fetchPrivateEvalScorecard: (evalSetId: string, runId: string) => request<{ rows: HumanScoreRowDTO[] }>(
    "GET",
    `/api/evals/private/${pathPart(evalSetId)}/scorecards/${pathPart(runId)}`,
  ),

  writePrivateEvalScorecard: (evalSetId: string, runId: string, rows: HumanScoreRowDTO[]) => request<{ path: string }>(
    "POST",
    `/api/evals/private/${pathPart(evalSetId)}/scorecards`,
    { runId, rows },
  ),

  fetchPrivateEvalComparison: (evalSetId: string) => request<PrivateEvalComparisonDTO>(
    "GET",
    `/api/evals/private/${pathPart(evalSetId)}/comparison`,
  ),
};
