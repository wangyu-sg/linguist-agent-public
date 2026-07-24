import { createWorkspace, readJsonFile, workspacePath, writeJsonFile } from "./workspace.js";
import { listBatches, readBatch, type BatchSegment } from "./batch_workspace.js";
import { runDeliveryCheck, type DeliveryIssue } from "./delivery.js";
import { resolveAuthorityDecision, type AuthorityDecision, type AuthorityEvidence } from "./authority_policy.js";
import { compareFormattingSignatures } from "./format_signatures.js";
import { readProjectTagRuleContext, type ProjectTagRuleContext } from "./tag_rules.js";
import type { TeamCandidateTarget, TeamDecision, TeamRoleFinding, TeamRoleId, TeamRolePass } from "./team_workflow.js";
import type { DeliveryQaReport } from "./delivery_qa.js";
import { assertWorkflowEvalLegacyAllowed, workflowEvalPersistenceFor } from "./workflow_eval_storage.js";

export type RiskKind =
  | "tag"
  | "newline"
  | "literal_newline"
  | "rich_text"
  | "underline"
  | "native_tag"
  | "placeholder"
  | "number"
  | "source_target_identity"
  | "low_tm"
  | "term_conflict"
  | "style_guide"
  | "compound_term";

export interface RiskQueueItem {
  id: string;
  segmentId: string;
  risks: RiskKind[];
  reason: string;
  queueRank: number;
}

export type PhraseQaDisposition =
  | "fixed_true_issue"
  | "ignored_false_positive"
  | "retained_unconfirmed"
  | "retained_true_issue"
  | "unresolved";

export type PhraseQaFinalIgnoreState = "ignored" | "not_ignored" | "not_applicable";

export interface PhraseQaRow {
  id: string;
  segmentId: string;
  category: RiskKind | "phrase_qa";
  message: string;
  disposition: PhraseQaDisposition;
  finalIgnoreState: PhraseQaFinalIgnoreState;
  evidence: string;
}

export type BackfillState =
  | "pending"
  | "opened"
  | "current_read"
  | "current_mismatch"
  | "write_started"
  | "write_done"
  | "readback_verified"
  | "readback_failed"
  | "skipped_already_matching"
  | "blocked";

export type BackfillDecision = "confirmed" | "edited" | "skipped" | "uncertain";

export interface PlatformBackfillRow {
  id: string;
  segmentId: string;
  batch: string;
  state: BackfillState;
  decision: BackfillDecision;
  localProposal: string;
  phraseEvidence: string;
  readbackState: string;
}

export interface WorkflowAuthorityEvidence extends AuthorityEvidence {
  decisionKey?: string;
  segmentId?: string;
  batch?: string;
  evidenceSource?: "phrase_tm" | "phrase_tb" | "phrase_cat" | "style_guide" | "term_history" | "local_review" | "customer";
  ts?: string;
}

export interface WorkflowAuthorityDecision extends AuthorityDecision {
  decisionKey: string;
  segmentId?: string;
  source?: string;
}

export type BrowserAutomationOperation =
  | "backfill"
  | "readback"
  | "qa_run"
  | "qa_load_more"
  | "qa_ignore"
  | "reconnect";

export type BrowserAutomationCheckpointStatus =
  | "pending"
  | "observed"
  | "timeout"
  | "verified"
  | "failed"
  | "blocked";

export interface BrowserAutomationCheckpoint {
  id: string;
  operation: BrowserAutomationOperation;
  status: BrowserAutomationCheckpointStatus;
  checkpoint: string;
  observedAt: string;
  currentSegmentId?: string;
  lastVerifiedSegmentId?: string;
  currentQaRowCount?: number;
  previousQaRowCount?: number;
  hasLoadMore?: boolean;
  readbackState?: string;
  lastAction?: string;
  error?: string;
}

export type TeamRoleObjectArtifactType = "brief" | "engineering_gate" | "strategy" | "pre_lqa" | "delivery_gate";

export interface TeamRoleObjectArtifact {
  id: string;
  workflowId: string;
  roleId: TeamRoleId;
  type: TeamRoleObjectArtifactType;
  data: unknown;
  createdAt: string;
  summary?: string;
}

export interface WorkflowArtifacts {
  sourceLabel: string;
  workbookPreviews: unknown[];
  assetConflictDecisions: unknown[];
  reviewFindings: unknown[];
  backfillRows: PlatformBackfillRow[];
  phraseQaRows: PhraseQaRow[];
  authorityEvidenceRows: WorkflowAuthorityEvidence[];
  authorityDecisions: WorkflowAuthorityDecision[];
  browserAutomationChecks: BrowserAutomationCheckpoint[];
  riskQueue: RiskQueueItem[];
  teamRolePasses: TeamRolePass[];
  teamFindings: TeamRoleFinding[];
  teamDecisions: TeamDecision[];
  teamCandidateTargets: TeamCandidateTarget[];
  teamRoleArtifacts: TeamRoleObjectArtifact[];
  deliveryQaReports: DeliveryQaReport[];
}

export interface ProjectWorkflowArtifactsPayload extends WorkflowArtifacts {
  projectId: string;
  artifactPath: string;
}

const workflowArtifactMutationQueues = new Map<string, Promise<void>>();

async function withWorkflowArtifactMutationLock<T>(
  workspaceRoot: string,
  projectId: string,
  operation: () => Promise<T>,
): Promise<T> {
  const key = `${workspaceRoot}\u0000${projectId}`;
  const previous = workflowArtifactMutationQueues.get(key) ?? Promise.resolve();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const queued = previous.then(() => gate, () => gate);
  workflowArtifactMutationQueues.set(key, queued);
  await previous.catch(() => undefined);
  try {
    return await operation();
  } finally {
    release();
    if (workflowArtifactMutationQueues.get(key) === queued) workflowArtifactMutationQueues.delete(key);
  }
}

export function workflowArtifactsPath(workspaceRoot: string, projectId: string): string {
  return workspacePath(createWorkspace(workspaceRoot, projectId), "workflow_artifacts.json");
}

function workflowArtifactsStorageKey(projectId: string): string { return `artifacts/${projectId}`; }

export function emptyWorkflowArtifacts(projectId: string, artifactPath: string): ProjectWorkflowArtifactsPayload {
  return {
    projectId,
    artifactPath,
    sourceLabel: "Project workflow artifacts",
    workbookPreviews: [],
    assetConflictDecisions: [],
    reviewFindings: [],
    backfillRows: [],
    phraseQaRows: [],
    authorityEvidenceRows: [],
    authorityDecisions: [],
    browserAutomationChecks: [],
    riskQueue: [],
    teamRolePasses: [],
    teamFindings: [],
    teamDecisions: [],
    teamCandidateTargets: [],
    teamRoleArtifacts: [],
    deliveryQaReports: [],
  };
}

function authorityDecisionKey(row: WorkflowAuthorityEvidence): string {
  return row.decisionKey ?? row.segmentId ?? row.source ?? row.id;
}

function resolveWorkflowAuthorityDecisions(rows: WorkflowAuthorityEvidence[]): WorkflowAuthorityDecision[] {
  const groups = new Map<string, WorkflowAuthorityEvidence[]>();
  for (const row of rows) {
    const key = authorityDecisionKey(row);
    const bucket = groups.get(key) ?? [];
    bucket.push(row);
    groups.set(key, bucket);
  }
  return Array.from(groups.entries()).flatMap(([decisionKey, rowsForDecision]) => {
    const decision = resolveAuthorityDecision(rowsForDecision);
    if (!decision) return [];
    return [{
      ...decision,
      decisionKey,
      segmentId: rowsForDecision.find((row) => row.segmentId)?.segmentId,
      source: rowsForDecision.find((row) => row.source)?.source,
    }];
  }).sort((a, b) => a.decisionKey.localeCompare(b.decisionKey));
}

function numbers(value: string): string[] {
  return value.match(/\d+(?:[.,]\d+)?/g) ?? [];
}

function sameList(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function riskKindsForIssue(code: string): RiskKind[] {
  switch (code) {
    case "UNRESOLVED_PLACEHOLDER":
      return ["placeholder", "native_tag"];
    case "TAG_SIGNATURE_MISMATCH":
      return ["tag", "native_tag", "placeholder"];
    case "PROJECT_TAG_SIGNATURE_MISMATCH":
      return ["tag"];
    case "NATIVE_TAG_SIGNATURE_MISMATCH":
      return ["tag", "native_tag"];
    case "PLACEHOLDER_SIGNATURE_MISMATCH":
      return ["placeholder"];
    case "RICH_TEXT_SIGNATURE_MISMATCH":
      return ["rich_text"];
    case "UNDERLINE_SIGNATURE_MISMATCH":
      return ["underline", "rich_text"];
    case "HARD_NEWLINE_MISMATCH":
      return ["newline"];
    case "LITERAL_NEWLINE_MISMATCH":
      return ["literal_newline"];
    case "RICH_TEXT_PRESENT":
      return ["rich_text"];
    case "UNDERLINE_PRESENT":
      return ["underline", "rich_text"];
    case "NATIVE_TAG_PRESENT":
      return ["native_tag"];
    case "PLACEHOLDER_SAFETY_PRESENT":
      return ["placeholder"];
    case "DUPLICATE_TARGET_DIVERGENCE":
      return ["low_tm"];
    default:
      return [];
  }
}

function addRisk(risks: Set<RiskKind>, risk: RiskKind, condition: boolean): void {
  if (condition) risks.add(risk);
}

function segmentRisks(segment: BatchSegment, issueCodes: string[], ruleContext: ProjectTagRuleContext): RiskKind[] {
  const risks = new Set<RiskKind>();
  const formatting = compareFormattingSignatures(segment.source, segment.target, ruleContext, segment.originalTarget ?? segment.rawTarget);
  const formattingCodes = new Set(formatting.mismatches.map((item) => item.code));
  for (const code of issueCodes) {
    for (const risk of riskKindsForIssue(code)) risks.add(risk);
  }
  addRisk(risks, "placeholder", (segment.unresolvedPlaceholderCount ?? 0) > 0);
  addRisk(risks, "native_tag", (segment.unresolvedTagPlaceholderCount ?? 0) > 0);
  addRisk(risks, "newline", formattingCodes.has("HARD_NEWLINE_MISMATCH"));
  addRisk(risks, "literal_newline", formattingCodes.has("LITERAL_NEWLINE_MISMATCH"));
  addRisk(risks, "tag", formattingCodes.has("PROJECT_TAG_SIGNATURE_MISMATCH"));
  addRisk(risks, "source_target_identity", Boolean(segment.target.trim()) && segment.source.trim() === segment.target.trim());
  addRisk(risks, "number", !sameList(numbers(segment.source), numbers(segment.target)));
  return Array.from(risks);
}

function riskWeight(risk: RiskKind): number {
  switch (risk) {
    case "tag":
    case "native_tag":
    case "placeholder":
      return 100;
    case "newline":
    case "literal_newline":
      return 90;
    case "rich_text":
    case "underline":
      return 85;
    case "number":
      return 70;
    case "source_target_identity":
      return 60;
    case "term_conflict":
    case "compound_term":
    case "style_guide":
      return 55;
    default:
      return 25;
  }
}

function issueCodeBySegment(issues: DeliveryIssue[]): Map<string, string[]> {
  const bySegment = new Map<string, string[]>();
  for (const issue of issues) {
    for (const segmentId of issue.segmentIds) {
      const codes = bySegment.get(segmentId) ?? [];
      codes.push(issue.code);
      bySegment.set(segmentId, codes);
    }
  }
  return bySegment;
}

async function buildProjectRiskQueue(workspaceRoot: string, projectId: string): Promise<RiskQueueItem[]> {
  const batches = await listBatches(workspaceRoot, projectId);
  const ruleContext = await readProjectTagRuleContext(workspaceRoot, projectId);
  const rows: Array<RiskQueueItem & { weight: number; batchId: string; index: number }> = [];
  for (const { batchId } of batches) {
    const [batch, delivery] = await Promise.all([
      readBatch(workspaceRoot, projectId, batchId),
      runDeliveryCheck(workspaceRoot, projectId, batchId),
    ]);
    const codes = issueCodeBySegment([...delivery.blockers, ...delivery.warnings]);
    for (const segment of batch.segments) {
      if (segment.locked) continue;
      const issueCodes = codes.get(segment.id) ?? [];
      const risks = segmentRisks(segment, issueCodes, ruleContext);
      if (!risks.length) continue;
      const needsConfirmation = segment.status !== "confirmed" || issueCodes.length > 0;
      if (!needsConfirmation) continue;
      rows.push({
        id: `auto:${batchId}:${segment.id}`,
        segmentId: segment.id,
        risks,
        reason: [
          `${batchId} · ${segment.status}`,
          issueCodes.length ? `delivery: ${Array.from(new Set(issueCodes)).join(", ")}` : "risk-based confirmation",
        ].join(" · "),
        queueRank: 0,
        weight: Math.max(...risks.map(riskWeight)),
        batchId,
        index: segment.index,
      });
    }
  }
  return rows
    .sort((a, b) => b.weight - a.weight || a.batchId.localeCompare(b.batchId) || a.index - b.index)
    .map((row, index) => ({
      id: row.id,
      segmentId: row.segmentId,
      risks: row.risks,
      reason: row.reason,
      queueRank: index + 1,
    }));
}

export async function readWorkflowArtifacts(workspaceRoot: string, projectId: string): Promise<ProjectWorkflowArtifactsPayload> {
  const path = workflowArtifactsPath(workspaceRoot, projectId);
  const defaults = emptyWorkflowArtifacts(projectId, path);
  const persistence = workflowEvalPersistenceFor(workspaceRoot);
  const stored = persistence
    ? (await persistence.read(workflowArtifactsStorageKey(projectId)) ?? {}) as Partial<WorkflowArtifacts>
    : (await assertWorkflowEvalLegacyAllowed(workspaceRoot), await readJsonFile<Partial<WorkflowArtifacts>>(path, {}));
  const generatedRiskQueue = await buildProjectRiskQueue(workspaceRoot, projectId);
  const storedRiskQueue = stored.riskQueue ?? defaults.riskQueue;
  const mergedRiskQueue = [
    ...storedRiskQueue,
    ...generatedRiskQueue.filter((row) => !storedRiskQueue.some((storedRow) => storedRow.id === row.id)),
  ].map((row, index) => ({ ...row, queueRank: index + 1 }));
  const authorityEvidenceRows = stored.authorityEvidenceRows ?? defaults.authorityEvidenceRows;
  const authorityDecisions = resolveWorkflowAuthorityDecisions(authorityEvidenceRows);
  return {
    ...defaults,
    ...stored,
    authorityEvidenceRows,
    authorityDecisions,
    browserAutomationChecks: stored.browserAutomationChecks ?? defaults.browserAutomationChecks,
    riskQueue: mergedRiskQueue,
    teamRolePasses: stored.teamRolePasses ?? defaults.teamRolePasses,
    teamFindings: stored.teamFindings ?? defaults.teamFindings,
    teamDecisions: stored.teamDecisions ?? defaults.teamDecisions,
    teamCandidateTargets: stored.teamCandidateTargets ?? defaults.teamCandidateTargets,
    teamRoleArtifacts: stored.teamRoleArtifacts ?? defaults.teamRoleArtifacts,
    deliveryQaReports: stored.deliveryQaReports ?? defaults.deliveryQaReports,
    projectId,
    artifactPath: path,
  };
}

async function writeWorkflowArtifactsUnlocked(
  workspaceRoot: string,
  projectId: string,
  artifacts: WorkflowArtifacts,
): Promise<ProjectWorkflowArtifactsPayload> {
  const path = workflowArtifactsPath(workspaceRoot, projectId);
  const { projectId: _projectId, artifactPath: _artifactPath, ...stored } = artifacts as ProjectWorkflowArtifactsPayload;
  const value = {
    ...stored,
    authorityDecisions: resolveWorkflowAuthorityDecisions(artifacts.authorityEvidenceRows ?? []),
  };
  const persistence = workflowEvalPersistenceFor(workspaceRoot);
  if (persistence) await persistence.write(workflowArtifactsStorageKey(projectId), value);
  else { await assertWorkflowEvalLegacyAllowed(workspaceRoot); await writeJsonFile(path, value); }
  return readWorkflowArtifacts(workspaceRoot, projectId);
}

export async function writeWorkflowArtifacts(
  workspaceRoot: string,
  projectId: string,
  artifacts: WorkflowArtifacts,
): Promise<ProjectWorkflowArtifactsPayload> {
  return withWorkflowArtifactMutationLock(workspaceRoot, projectId, () =>
    writeWorkflowArtifactsUnlocked(workspaceRoot, projectId, artifacts));
}

/**
 * Serialize read-modify-write updates for one project ledger. All concurrent
 * producers must cross this seam so a role completion cannot erase another
 * role, decision, or QA artifact that landed at the same time.
 */
export async function mutateWorkflowArtifacts(
  workspaceRoot: string,
  projectId: string,
  mutate: (current: ProjectWorkflowArtifactsPayload) => WorkflowArtifacts | Promise<WorkflowArtifacts>,
): Promise<ProjectWorkflowArtifactsPayload> {
  return withWorkflowArtifactMutationLock(workspaceRoot, projectId, async () => {
    const current = await readWorkflowArtifacts(workspaceRoot, projectId);
    return writeWorkflowArtifactsUnlocked(workspaceRoot, projectId, await mutate(current));
  });
}

export async function upsertPhraseQaRow(
  workspaceRoot: string,
  projectId: string,
  row: Partial<PhraseQaRow> & { id: string },
): Promise<ProjectWorkflowArtifactsPayload> {
  return mutateWorkflowArtifacts(workspaceRoot, projectId, (current) => {
    const existing = current.phraseQaRows.find((candidate) => candidate.id === row.id);
    const nextRow: PhraseQaRow = {
      id: row.id,
      segmentId: row.segmentId ?? existing?.segmentId ?? "",
      category: row.category ?? existing?.category ?? "phrase_qa",
      message: row.message ?? existing?.message ?? "",
      disposition: row.disposition ?? existing?.disposition ?? "unresolved",
      finalIgnoreState: row.finalIgnoreState ?? existing?.finalIgnoreState ?? "not_ignored",
      evidence: row.evidence ?? existing?.evidence ?? "Manually updated in Platform Backfill.",
    };
    const phraseQaRows = current.phraseQaRows.some((candidate) => candidate.id === row.id)
      ? current.phraseQaRows.map((candidate) => candidate.id === row.id ? nextRow : candidate)
      : [...current.phraseQaRows, nextRow];
    return { ...current, phraseQaRows };
  });
}

export async function upsertPlatformBackfillRow(
  workspaceRoot: string,
  projectId: string,
  row: Partial<PlatformBackfillRow> & { id: string },
): Promise<ProjectWorkflowArtifactsPayload> {
  return mutateWorkflowArtifacts(workspaceRoot, projectId, (current) => {
    const existing = current.backfillRows.find((candidate) => candidate.id === row.id);
    const nextRow: PlatformBackfillRow = {
      id: row.id,
      segmentId: row.segmentId ?? existing?.segmentId ?? "",
      batch: row.batch ?? existing?.batch ?? "",
      state: row.state ?? existing?.state ?? "pending",
      decision: row.decision ?? existing?.decision ?? "uncertain",
      localProposal: row.localProposal ?? existing?.localProposal ?? "",
      phraseEvidence: row.phraseEvidence ?? existing?.phraseEvidence ?? "",
      readbackState: row.readbackState ?? existing?.readbackState ?? "",
    };
    const backfillRows = current.backfillRows.some((candidate) => candidate.id === row.id)
      ? current.backfillRows.map((candidate) => candidate.id === row.id ? nextRow : candidate)
      : [...current.backfillRows, nextRow];
    return { ...current, backfillRows };
  });
}

export async function upsertWorkflowAuthorityEvidence(
  workspaceRoot: string,
  projectId: string,
  row: Partial<WorkflowAuthorityEvidence> & { id: string; tier: WorkflowAuthorityEvidence["tier"]; label: string },
): Promise<ProjectWorkflowArtifactsPayload> {
  return mutateWorkflowArtifacts(workspaceRoot, projectId, (current) => {
    const existing = current.authorityEvidenceRows.find((candidate) => candidate.id === row.id);
    const nextRow: WorkflowAuthorityEvidence = {
      id: row.id,
      tier: row.tier,
      label: row.label,
      target: row.target ?? existing?.target,
      source: row.source ?? existing?.source,
      detail: row.detail ?? existing?.detail,
      decisionKey: row.decisionKey ?? existing?.decisionKey ?? row.segmentId ?? row.source ?? row.id,
      segmentId: row.segmentId ?? existing?.segmentId,
      batch: row.batch ?? existing?.batch,
      evidenceSource: row.evidenceSource ?? existing?.evidenceSource,
      ts: row.ts ?? existing?.ts ?? new Date().toISOString(),
    };
    const authorityEvidenceRows = current.authorityEvidenceRows.some((candidate) => candidate.id === row.id)
      ? current.authorityEvidenceRows.map((candidate) => candidate.id === row.id ? nextRow : candidate)
      : [...current.authorityEvidenceRows, nextRow];
    return { ...current, authorityEvidenceRows };
  });
}

export async function upsertBrowserAutomationCheckpoint(
  workspaceRoot: string,
  projectId: string,
  row: Partial<BrowserAutomationCheckpoint> & Pick<BrowserAutomationCheckpoint, "id" | "operation" | "status" | "checkpoint">,
): Promise<ProjectWorkflowArtifactsPayload> {
  return mutateWorkflowArtifacts(workspaceRoot, projectId, (current) => {
    const existing = current.browserAutomationChecks.find((candidate) => candidate.id === row.id);
    const nextRow: BrowserAutomationCheckpoint = {
      id: row.id,
      operation: row.operation,
      status: row.status,
      checkpoint: row.checkpoint,
      observedAt: row.observedAt ?? existing?.observedAt ?? new Date().toISOString(),
      currentSegmentId: row.currentSegmentId ?? existing?.currentSegmentId,
      lastVerifiedSegmentId: row.lastVerifiedSegmentId ?? existing?.lastVerifiedSegmentId,
      currentQaRowCount: row.currentQaRowCount ?? existing?.currentQaRowCount,
      previousQaRowCount: row.previousQaRowCount ?? existing?.previousQaRowCount,
      hasLoadMore: row.hasLoadMore ?? existing?.hasLoadMore,
      readbackState: row.readbackState ?? existing?.readbackState,
      lastAction: row.lastAction ?? existing?.lastAction,
      error: row.error ?? existing?.error,
    };
    const browserAutomationChecks = current.browserAutomationChecks.some((candidate) => candidate.id === row.id)
      ? current.browserAutomationChecks.map((candidate) => candidate.id === row.id ? nextRow : candidate)
      : [...current.browserAutomationChecks, nextRow];
    return { ...current, browserAutomationChecks };
  });
}

export async function upsertTeamRolePass(
  workspaceRoot: string,
  projectId: string,
  row: TeamRolePass,
): Promise<ProjectWorkflowArtifactsPayload> {
  return mutateWorkflowArtifacts(workspaceRoot, projectId, (current) => {
    const teamRolePasses = current.teamRolePasses.some((candidate) => candidate.workflowId === row.workflowId && candidate.roleId === row.roleId)
      ? current.teamRolePasses.map((candidate) => candidate.workflowId === row.workflowId && candidate.roleId === row.roleId ? row : candidate)
      : [...current.teamRolePasses, row];
    return { ...current, teamRolePasses };
  });
}
