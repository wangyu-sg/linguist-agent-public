import { stat } from "node:fs/promises";
import { readBatch, type BatchSegment } from "./batch_workspace.js";
import { buildBatchConstraintPack, type BatchConstraintPack, type ConstraintKind } from "./constraint_pack.js";
import { runDeliveryCheck, type DeliveryIssue, type DeliveryReport } from "./delivery.js";
import { createTaskWorkspace } from "./task_workspace.js";
import { requireProjectTaskScope } from "./task_workspace_contract.js";
import type { TeamRoleObjectArtifact } from "./workflow_artifacts.js";
import { readCatWorkflowRun } from "./workflow_plan.js";

export interface TeamEngineeringGateIssue {
  code: string;
  message: string;
  segmentIds: string[];
  source: "scope" | "input" | "delivery" | "delivery_waiver" | "constraints";
}

export interface DeterministicTeamEngineeringGate {
  authority: "deterministic_cat_kernel";
  ready: boolean;
  blockers: string[];
  warnings: string[];
  formatRules: string[];
  artifact: TeamRoleObjectArtifact;
}

interface GateScope {
  projectId: string;
  workflowId: string;
  taskId?: string;
  batchId?: string;
  segmentIds: string[];
}

interface ConstraintSummary {
  scopedSegments: number;
  segmentsWithConstraints: number;
  blockerConstraints: number;
  warningConstraints: number;
  advisoryConstraints: number;
}

const NON_ENGINEERING_DELIVERY_CODES = new Set(["UNTRANSLATED_EDITABLE", "UNAPPLIED_PROPOSALS"]);
const RULE_KINDS: Array<[ConstraintKind, string]> = [
  ["tag_signature", "Preserve source tag signatures"],
  ["placeholder", "Preserve source placeholder and ICU signatures"],
  ["number", "Preserve source number tokens"],
  ["terminology", "Apply authoritative terminology constraints"],
  ["exact_tm", "Apply authoritative exact-TM constraints"],
  ["duplicate_group", "Keep duplicate-source siblings consistent"],
  ["voice", "Apply the confirmed voice profile as advisory guidance"],
];

function issueText(issue: TeamEngineeringGateIssue): string {
  const sample = issue.segmentIds.slice(0, 8).join(", ");
  return `${issue.code}: ${issue.message}${sample ? ` [${sample}${issue.segmentIds.length > 8 ? ", ..." : ""}]` : ""}`;
}

function addIssue(target: TeamEngineeringGateIssue[], issue: TeamEngineeringGateIssue): void {
  if (!target.some((row) => row.code === issue.code && row.segmentIds.join("\0") === issue.segmentIds.join("\0"))) target.push(issue);
}

function scopedDeliveryIssue(
  issue: DeliveryIssue,
  selected: Set<string>,
  isSubset: boolean,
  source: TeamEngineeringGateIssue["source"],
): TeamEngineeringGateIssue | undefined {
  if (NON_ENGINEERING_DELIVERY_CODES.has(issue.code)) return undefined;
  if (!isSubset) return { code: issue.code, message: issue.message, segmentIds: issue.segmentIds, source };
  if (!issue.segmentIds.length) return undefined;
  const segmentIds = issue.segmentIds.filter((id) => selected.has(id));
  return segmentIds.length ? { code: issue.code, message: issue.message, segmentIds, source } : undefined;
}

async function isFile(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isFile();
  } catch {
    return false;
  }
}

function selectedConstraintPack(pack: BatchConstraintPack, selected: Set<string>, isSubset: boolean): BatchConstraintPack["segments"] {
  return isSubset ? pack.segments.filter((row) => selected.has(row.segmentId)) : pack.segments;
}

function summarizeConstraints(segments: BatchConstraintPack["segments"]): ConstraintSummary {
  return segments.reduce<ConstraintSummary>((summary, row) => ({
    scopedSegments: summary.scopedSegments + 1,
    segmentsWithConstraints: summary.segmentsWithConstraints + (row.constraints.length ? 1 : 0),
    blockerConstraints: summary.blockerConstraints + row.summary.blockerConstraints,
    warningConstraints: summary.warningConstraints + row.summary.warningConstraints,
    advisoryConstraints: summary.advisoryConstraints + row.summary.advisoryConstraints,
  }), { scopedSegments: 0, segmentsWithConstraints: 0, blockerConstraints: 0, warningConstraints: 0, advisoryConstraints: 0 });
}

function buildFormatRules(segments: BatchConstraintPack["segments"], batchSegments: BatchSegment[]): string[] {
  const rules = ["Preserve tag, placeholder, ICU branch, number, and required newline signatures; CAT apply and Delivery gates remain authoritative."];
  const locked = batchSegments.filter((segment) => segment.locked).map((segment) => segment.id);
  if (locked.length) rules.push(`Never edit ${locked.length} locked segment(s): ${locked.slice(0, 12).join(", ")}${locked.length > 12 ? ", ..." : ""}.`);
  for (const [kind, label] of RULE_KINDS) {
    const affected = segments.filter((row) => row.constraints.some((constraint) => constraint.kind === kind)).map((row) => row.segmentId);
    if (affected.length) rules.push(`${label} on ${affected.length} segment(s): ${affected.slice(0, 12).join(", ")}${affected.length > 12 ? ", ..." : ""}.`);
  }
  return rules;
}

function finish(
  scope: GateScope,
  checkedAt: string,
  blockers: TeamEngineeringGateIssue[],
  warnings: TeamEngineeringGateIssue[],
  formatRules: string[],
  constraintSummary?: ConstraintSummary,
  delivery?: DeliveryReport,
): DeterministicTeamEngineeringGate {
  const ready = blockers.length === 0;
  const blockerText = blockers.map(issueText);
  const warningText = warnings.map(issueText);
  const data = {
    schemaVersion: 1 as const,
    authority: "deterministic_cat_kernel" as const,
    checkedAt,
    scope,
    ready,
    blockers,
    warnings,
    formatRules,
    constraintSummary,
    delivery: delivery ? {
      checkedAt: delivery.checkedAt,
      rawStatus: delivery.status,
      rulesDigest: delivery.rulesDigest,
      ignoredNonEngineeringCodes: [...NON_ENGINEERING_DELIVERY_CODES],
    } : undefined,
  };
  return {
    authority: "deterministic_cat_kernel",
    ready,
    blockers: blockerText,
    warnings: warningText,
    formatRules,
    artifact: {
      id: `deterministic-engineering-gate:${scope.workflowId}`,
      workflowId: scope.workflowId,
      roleId: "loc_engineer_gate",
      type: "engineering_gate",
      data,
      createdAt: checkedAt,
      summary: ready
        ? `Deterministic localization engineering gate passed with ${warnings.length} warning(s).`
        : `Deterministic localization engineering gate blocked on ${blockers.length} issue(s).`,
    },
  };
}

/**
 * Authoritative Team localization-engineering gate. The caller supplies stable
 * identities only; linked Task/batch scope and all mechanical facts are read
 * from durable server state, so model output cannot weaken this result.
 */
export async function runDeterministicTeamEngineeringGate(
  repoRoot: string,
  input: { projectId: string; workflowId: string },
): Promise<DeterministicTeamEngineeringGate> {
  const checkedAt = new Date().toISOString();
  const workflow = await readCatWorkflowRun(repoRoot, input.projectId, input.workflowId);
  const scope: GateScope = {
    projectId: input.projectId,
    workflowId: input.workflowId,
    taskId: workflow.taskId,
    batchId: workflow.batchId,
    segmentIds: [],
  };
  const blockers: TeamEngineeringGateIssue[] = [];
  const warnings: TeamEngineeringGateIssue[] = [];

  if (workflow.projectId !== input.projectId) {
    addIssue(blockers, { code: "SCOPE_PROJECT_MISMATCH", message: "Workflow project scope does not match the requested project.", segmentIds: [], source: "scope" });
  }
  if (!workflow.batchId) {
    addIssue(blockers, { code: "SCOPE_BATCH_MISSING", message: "Localization engineering requires a batch-scoped Team workflow.", segmentIds: [], source: "scope" });
    return finish(scope, checkedAt, blockers, warnings, []);
  }

  if (workflow.taskId) {
    try {
      const task = (await createTaskWorkspace(repoRoot).open({ projectId: input.projectId, taskId: workflow.taskId })).task;
      const taskScope = requireProjectTaskScope(task.scope, "Engineering Task");
      if (taskScope.batchId && taskScope.batchId !== workflow.batchId) {
        addIssue(blockers, { code: "SCOPE_TASK_BATCH_MISMATCH", message: "Canonical Task batch scope does not match the workflow batch.", segmentIds: [], source: "scope" });
      }
      scope.segmentIds = [...new Set(taskScope.segmentIds)];
    } catch {
      addIssue(blockers, { code: "SCOPE_TASK_UNAVAILABLE", message: "The canonical Task linked to this workflow is unavailable.", segmentIds: [], source: "scope" });
    }
  }

  const batch = await readBatch(repoRoot, input.projectId, workflow.batchId).catch(() => undefined);
  if (!batch) {
    addIssue(blockers, { code: "SCOPE_BATCH_UNAVAILABLE", message: "The workflow batch is unavailable.", segmentIds: [], source: "scope" });
    return finish(scope, checkedAt, blockers, warnings, []);
  }
  const batchIds = new Set(batch.segments.map((segment) => segment.id));
  const staleIds = scope.segmentIds.filter((segmentId) => !batchIds.has(segmentId));
  if (staleIds.length) {
    addIssue(blockers, { code: "SCOPE_SEGMENT_STALE", message: "Canonical Task segment scope contains rows that are no longer in the batch.", segmentIds: staleIds, source: "scope" });
  }
  if (blockers.length) return finish(scope, checkedAt, blockers, warnings, []);

  const isSubset = scope.segmentIds.length > 0;
  const selected = new Set(scope.segmentIds);
  const scopedBatchSegments = isSubset ? batch.segments.filter((segment) => selected.has(segment.id)) : batch.segments;

  if (!(await isFile(batch.sourceFile))) {
    addIssue(blockers, { code: "SOURCE_FILE_MISSING", message: "The imported batch source file is unavailable.", segmentIds: [], source: "input" });
  }
  if (batch.masterFile && !(await isFile(batch.masterFile))) {
    addIssue(blockers, { code: "MASTER_FILE_MISSING", message: "The imported batch master file is unavailable.", segmentIds: [], source: "input" });
  }
  const unresolved = scopedBatchSegments
    .filter((segment) => (segment.unresolvedPlaceholderCount ?? 0) > 0 || (segment.unresolvedRuntimePlaceholderCount ?? 0) > 0 || (segment.unresolvedTagPlaceholderCount ?? 0) > 0)
    .map((segment) => segment.id);
  if (unresolved.length) {
    addIssue(blockers, { code: "UNRESOLVED_PLACEHOLDER", message: "Scoped segments contain unresolved structural or runtime placeholders.", segmentIds: unresolved, source: "input" });
  }
  if (batch.tagReport.tagCountMismatches > 0) {
    addIssue(blockers, { code: "IMPORT_TAG_COUNT_MISMATCH", message: `${batch.tagReport.tagCountMismatches} imported segment(s) have source/master tag-count mismatches.`, segmentIds: [], source: "input" });
  }
  if (batch.tagReport.masterUnmatchedSegments > 0) {
    addIssue(warnings, { code: "MASTER_MAPPING_INCOMPLETE", message: `${batch.tagReport.masterUnmatchedSegments} segment(s) were not matched to the master file.`, segmentIds: [], source: "input" });
  }

  let delivery: DeliveryReport | undefined;
  try {
    delivery = await runDeliveryCheck(repoRoot, input.projectId, workflow.batchId);
    for (const row of delivery.blockers) {
      const issue = scopedDeliveryIssue(row, selected, isSubset, "delivery");
      if (issue) addIssue(blockers, issue);
    }
    for (const row of delivery.warnings) {
      const issue = scopedDeliveryIssue(row, selected, isSubset, "delivery");
      if (issue) addIssue(warnings, issue);
    }
    for (const row of delivery.waived) {
      const issue = scopedDeliveryIssue(row, selected, isSubset, "delivery_waiver");
      if (issue) addIssue(warnings, { ...issue, code: `WAIVED_${issue.code}`, message: `Explicit delivery-risk waiver remains active. ${issue.message}` });
    }
  } catch {
    addIssue(blockers, { code: "DELIVERY_CHECK_UNAVAILABLE", message: "The deterministic Delivery check could not be completed.", segmentIds: [], source: "delivery" });
  }

  let formatRules: string[] = [];
  let constraintSummary: ConstraintSummary | undefined;
  try {
    const pack = await buildBatchConstraintPack(repoRoot, { projectId: input.projectId, batchId: workflow.batchId, onlyFlagged: false });
    const constraintSegments = selectedConstraintPack(pack, selected, isSubset);
    constraintSummary = summarizeConstraints(constraintSegments);
    formatRules = buildFormatRules(constraintSegments, scopedBatchSegments);
  } catch {
    addIssue(blockers, { code: "CONSTRAINT_PACK_UNAVAILABLE", message: "The deterministic CAT constraint pack could not be compiled.", segmentIds: [], source: "constraints" });
  }

  return finish(scope, checkedAt, blockers, warnings, formatRules, constraintSummary, delivery);
}
