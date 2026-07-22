import { createHash } from "node:crypto";
import { readBatch } from "./batch_workspace.js";
import { runDeliveryQaForScope, type DeliveryQaReport } from "./delivery_qa.js";
import { buildDeliveryReadinessReport, type DeliveryReadinessReport } from "./delivery_readiness.js";
import {
  appendQualityDecisionLedgerOnce,
  authorizeQualityLedgerExport,
  type QualityDecisionLedgerKind,
} from "./quality_decision_ledger.js";
import { createTaskWorkspace } from "./task_workspace.js";
import { requireProjectTaskScope } from "./task_workspace_contract.js";
import { syncTeamQualityDecisionLedger } from "./team_quality_decision_ledger.js";
import { mutateWorkflowArtifacts } from "./workflow_artifacts.js";
import { readCatWorkflowRun } from "./workflow_plan.js";

export type TeamDeliveryFindingSeverity = "blocker" | "warning" | "advisory";

export interface TeamDeliveryFindingRef {
  id: string;
  source: "delivery_qa" | "delivery_check" | "quality" | "file" | "task_scope";
  severity: TeamDeliveryFindingSeverity;
  code: string;
  segmentId?: string;
  evidenceRefs: string[];
}

export interface TeamDeliveryGateResult {
  schemaVersion: 1;
  authoritative: true;
  checkedAt: string;
  scope: {
    projectId: string;
    workflowId: string;
    batchId: string;
    taskId?: string;
    segmentIds: string[];
    batchSegmentCount: number;
    coversWholeBatch: boolean;
  };
  rawQa: DeliveryQaReport;
  readiness: DeliveryReadinessReport;
  findings: TeamDeliveryFindingRef[];
  authorization: Awaited<ReturnType<typeof authorizeQualityLedgerExport>>;
  modelPolicy: {
    mayExplain: true;
    mayProposeDecisions: true;
    mayCreateQa: false;
    mayAuthorizeExport: false;
  };
}

function issueRefs(
  source: TeamDeliveryFindingRef["source"],
  severity: TeamDeliveryFindingSeverity,
  code: string,
  segmentIds: string[],
): TeamDeliveryFindingRef[] {
  return (segmentIds.length ? segmentIds : [undefined]).map((segmentId) => ({
    id: `team-delivery:${source}:${code}:${segmentId ?? "batch"}`,
    source,
    severity,
    code,
    ...(segmentId ? { segmentId } : {}),
    evidenceRefs: [`${source}:${code}`],
  }));
}

function uniqueFindings(rows: TeamDeliveryFindingRef[]): TeamDeliveryFindingRef[] {
  return [...new Map(rows.map((row) => [row.id, row])).values()];
}

const DELIVERY_QA_QUALITY_MIRRORS: Readonly<Record<string, readonly string[]>> = {
  placeholder_mismatch: ["PLACEHOLDER_SIGNATURE_MISMATCH"],
  tag_mismatch: [
    "NATIVE_TAG_SIGNATURE_MISMATCH",
    "PROJECT_TAG_SIGNATURE_MISMATCH",
    "RICH_TEXT_SIGNATURE_MISMATCH",
    "UNDERLINE_SIGNATURE_MISMATCH",
  ],
  number_mismatch: ["NUMBER_MISMATCH"],
  icu_branch_mismatch: ["ICU_BRANCH_ARITY_MISMATCH"],
  newline_mismatch: ["HARD_NEWLINE_MISMATCH", "LITERAL_NEWLINE_MISMATCH"],
  source_equals_target: ["SOURCE_EQUALS_TARGET"],
  inconsistent_target: ["DUPLICATE_TARGET_MISMATCH"],
  duplicated_target: ["TARGET_SOURCE_INCONSISTENCY"],
  unpaired_symbol: ["UNPAIRED_SYMBOL"],
  unpaired_quote: ["UNPAIRED_QUOTE"],
  repeated_word: ["REPEATED_WORD"],
  double_space: ["DOUBLE_SPACE"],
  edge_whitespace: ["EDGE_WHITESPACE"],
  uppercase_token_mismatch: ["UPPERCASE_TOKEN_MISMATCH"],
  camelcase_token_mismatch: ["CAMELCASE_TOKEN_MISMATCH"],
  project_checklist: ["PROJECT_CHECKLIST"],
  spelling: ["SPELLING_UNKNOWN_WORD"],
};

function mirroredQualityFindingKeys(report: DeliveryQaReport): Set<string> {
  return new Set(report.findings.flatMap((finding) =>
    (DELIVERY_QA_QUALITY_MIRRORS[finding.type] ?? []).map((code) => `${finding.segmentId ?? "batch"}\u0000${code}`),
  ));
}

function ledgerKind(source: TeamDeliveryFindingRef["source"]): QualityDecisionLedgerKind {
  return source === "quality" ? "quality_finding" : "delivery_finding";
}

function findingLogicalEventId(
  scope: { projectId: string; batchId: string; workflowId: string },
  finding: TeamDeliveryFindingRef,
): string {
  const state = {
    ...scope,
    findingId: finding.id,
    segmentId: finding.segmentId,
    kind: ledgerKind(finding.source),
    code: finding.code,
    severity: finding.severity,
    evidenceRefs: [...new Set(finding.evidenceRefs)].sort(),
  };
  return `deterministic-delivery-finding:${createHash("sha256").update(JSON.stringify(state)).digest("hex")}`;
}

/**
 * Run the authoritative Team Delivery gate from durable workflow/task scope.
 * The model-facing role may explain or propose decisions over this result, but
 * it cannot replace the raw QA or authorize export.
 */
export async function runTeamDeliveryGate(
  workspaceRoot: string,
  input: { projectId: string; workflowId: string },
): Promise<TeamDeliveryGateResult> {
  const workflow = await readCatWorkflowRun(workspaceRoot, input.projectId, input.workflowId);
  if (!workflow.batchId) throw new Error("Team Delivery gate requires a batch-scoped workflow.");
  const batch = await readBatch(workspaceRoot, input.projectId, workflow.batchId);
  let requestedSegmentIds: string[] = [];
  if (workflow.taskId) {
    const task = (await createTaskWorkspace(workspaceRoot).open({ projectId: input.projectId, taskId: workflow.taskId })).task;
    const taskScope = requireProjectTaskScope(task.scope, "Team Delivery Task");
    if (task.owner.kind !== "project" || task.owner.projectId !== input.projectId) throw new Error("Team Delivery task project owner does not match the workflow.");
    if (taskScope.batchId !== workflow.batchId) throw new Error("Team Delivery task batch scope does not match the workflow.");
    requestedSegmentIds = [...new Set(taskScope.segmentIds)];
  }
  const batchIds = new Set(batch.segments.map((segment) => segment.id));
  const missing = requestedSegmentIds.filter((segmentId) => !batchIds.has(segmentId));
  if (missing.length) throw new Error(`Team Delivery task segment scope is stale: ${missing.join(", ")}.`);
  const segmentIds = requestedSegmentIds.length ? requestedSegmentIds : batch.segments.map((segment) => segment.id);
  const coversWholeBatch = segmentIds.length === batch.segments.length && segmentIds.every((segmentId) => batchIds.has(segmentId));

  const [rawQa, readiness] = await Promise.all([
    runDeliveryQaForScope(workspaceRoot, {
      projectId: input.projectId,
      batchId: workflow.batchId,
      workflowId: input.workflowId,
      ...(requestedSegmentIds.length ? { segmentIds: requestedSegmentIds } : {}),
    }),
    buildDeliveryReadinessReport(workspaceRoot, input.projectId, workflow.batchId),
  ]);
  const mirroredQualityKeys = mirroredQualityFindingKeys(rawQa);
  const findings = uniqueFindings([
    ...rawQa.findings.map((finding): TeamDeliveryFindingRef => ({
      id: finding.id,
      source: "delivery_qa",
      severity: finding.severity,
      code: finding.type,
      ...(finding.segmentId ? { segmentId: finding.segmentId } : {}),
      evidenceRefs: finding.evidence,
    })),
    ...readiness.delivery.blockers.flatMap((issue) => issueRefs("delivery_check", "blocker", issue.code, issue.segmentIds)),
    ...readiness.delivery.warnings.flatMap((issue) => issueRefs("delivery_check", "warning", issue.code, issue.segmentIds)),
    ...readiness.quality.findings
      .filter((finding) => finding.status === "open" && !mirroredQualityKeys.has(`${finding.segmentId}\u0000${finding.code}`))
      .map((finding): TeamDeliveryFindingRef => ({
      id: finding.id,
      source: "quality",
      severity: finding.severity === "info" ? "advisory" : finding.severity,
      code: finding.code,
      segmentId: finding.segmentId,
      evidenceRefs: finding.evidenceSources,
      })),
    ...readiness.files.filter((file) => !file.exists).flatMap((file) => issueRefs("file", "blocker", `MISSING_${file.role.toUpperCase()}_FILE`, [])),
    ...(!coversWholeBatch ? issueRefs("task_scope", "blocker", "TASK_SCOPE_DOES_NOT_COVER_BATCH", []) : []),
  ]);

  await syncTeamQualityDecisionLedger(workspaceRoot, {
    projectId: input.projectId,
    batchId: workflow.batchId,
    workflowId: input.workflowId,
    deliveryQaFindings: rawQa.findings,
  });
  const supplementalFindings = findings.filter((finding) => finding.source !== "delivery_qa");
  await appendQualityDecisionLedgerOnce(workspaceRoot, supplementalFindings.map((finding) => ({
    projectId: input.projectId,
    batchId: workflow.batchId,
    workflowId: input.workflowId,
    segmentId: finding.segmentId,
    findingId: finding.id,
    code: finding.code,
    severity: finding.severity,
    kind: ledgerKind(finding.source),
    decision: "open",
    evidenceRefs: [...new Set(finding.evidenceRefs)].sort(),
    actor: "deterministic_delivery_gate",
    logicalEventId: findingLogicalEventId({ projectId: input.projectId, batchId: workflow.batchId!, workflowId: input.workflowId }, finding),
  })));
  const authorization = await authorizeQualityLedgerExport(workspaceRoot, {
    projectId: input.projectId,
    batchId: workflow.batchId,
    workflowId: input.workflowId,
    blockerFindingIds: findings.filter((finding) => finding.severity === "blocker").map((finding) => finding.id),
    unreviewedFindingIds: findings.map((finding) => finding.id),
    reason: coversWholeBatch ? undefined : "The current Team Task covers only part of the batch; batch export remains blocked.",
  });
  const checkedAt = new Date().toISOString();
  const modelPolicy = {
    mayExplain: true,
    mayProposeDecisions: true,
    mayCreateQa: false,
    mayAuthorizeExport: false,
  } as const;
  const scope = {
    projectId: input.projectId,
    workflowId: input.workflowId,
    batchId: workflow.batchId,
    ...(workflow.taskId ? { taskId: workflow.taskId } : {}),
    segmentIds,
    batchSegmentCount: batch.segments.length,
    coversWholeBatch,
  };
  const result: TeamDeliveryGateResult = {
    schemaVersion: 1,
    authoritative: true,
    checkedAt,
    scope,
    rawQa,
    readiness,
    findings,
    authorization,
    modelPolicy,
  };
  const artifact = {
    id: `${input.workflowId}:delivery-gate`,
    workflowId: input.workflowId,
    roleId: "delivery_manager" as const,
    type: "delivery_gate" as const,
    createdAt: checkedAt,
    summary: authorization.authorized
      ? "Deterministic Delivery gate authorizes export."
      : `Deterministic Delivery gate blocks export: ${authorization.blockers.length} blocker(s), ${authorization.unreviewedFindingIds.length} unreviewed finding(s).`,
    data: {
      schemaVersion: 1,
      authoritative: true,
      reportId: rawQa.reportId,
      scope: {
        batchId: scope.batchId,
        taskId: scope.taskId,
        taskSegmentCount: scope.segmentIds.length,
        batchSegmentCount: scope.batchSegmentCount,
        coversWholeBatch: scope.coversWholeBatch,
      },
      qaSummary: rawQa.summary,
      readiness: {
        status: readiness.status,
        deliveryStatus: readiness.delivery.status,
        qualityStatus: readiness.quality.status,
        missingFiles: readiness.files.filter((file) => !file.exists).length,
        openProposals: readiness.proposals.proposed,
        waivedDeliveryIssues: readiness.delivery.waived.length,
      },
      authorization: {
        authorized: authorization.authorized,
        blockers: authorization.blockers.length,
        unreviewedFindings: authorization.unreviewedFindingIds.length,
        waivedFindings: authorization.waivedFindingIds.length,
      },
      modelPolicy,
    },
  };
  await mutateWorkflowArtifacts(workspaceRoot, input.projectId, (current) => ({
    ...current,
    deliveryQaReports: [...current.deliveryQaReports.filter((report) => report.workflowId !== input.workflowId), rawQa],
    teamRoleArtifacts: current.teamRoleArtifacts.some((row) => row.id === artifact.id)
      ? current.teamRoleArtifacts.map((row) => row.id === artifact.id ? artifact : row)
      : [...current.teamRoleArtifacts, artifact],
  }));
  return result;
}
