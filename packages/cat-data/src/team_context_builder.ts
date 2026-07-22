import { readBatch } from "./batch_workspace.js";
import { compilePrompt } from "./prompt_compiler.js";
import { createTaskWorkspace } from "./task_workspace.js";
import { requireProjectTaskScope } from "./task_workspace_contract.js";
import { teamEvidenceToolsForScope, type TeamEvidenceToolName } from "./team_evidence_scope.js";
import type { TeamContextManifest, TeamRoleId } from "./team_workflow.js";
import { readCatWorkflowRun } from "./workflow_plan.js";
import { readWorkflowArtifacts } from "./workflow_artifacts.js";

export interface TeamRoleContextFinding {
  id: string;
  message: string;
}

export interface TeamRoleContextInput {
  roleId: TeamRoleId;
  workflowId: string;
  taskContext?: string;
  artifactRefs?: string[];
  hardConstraints?: string[];
  evidence?: string[];
  styleGuideRules?: string[];
  priorFindings?: TeamRoleContextFinding[];
  transcript?: string;
  includeTranscript?: boolean;
  allowedTools?: TeamEvidenceToolName[];
  tokenBudget?: number;
  coverage?: TeamContextManifest["coverage"];
}

export interface TeamRoleContext {
  prompt: string;
  manifest: TeamContextManifest;
}

export type TeamRoleContextPreparation =
  | {
      status: "ready";
      prompt: string;
      inputArtifactRefs: string[];
      manifest: TeamContextManifest;
      evidenceScope: {
        batchId?: string;
        segmentIds: string[];
        allowedTools: TeamEvidenceToolName[];
      };
    }
  | {
      status: "blocked";
      blockers: string[];
      manifest: TeamContextManifest;
    };

function bounded(value: string, limit = 800): string {
  const text = value.trim();
  return text.length <= limit ? text : `${text.slice(0, limit - 14)}... [truncated]`;
}

export function buildTeamRoleContext(input: TeamRoleContextInput): TeamRoleContext {
  const included = [...new Set(input.artifactRefs ?? [])];
  const omitted: string[] = [];
  if (input.taskContext) included.push("task_scope");
  if (input.hardConstraints?.length) included.push("hard_constraints");
  if (input.evidence?.length) included.push("evidence");
  if (input.styleGuideRules?.length) included.push("style_guide");
  if (input.priorFindings?.length) included.push("prior_findings");
  if (input.transcript && input.includeTranscript) included.push("transcript");
  else if (input.transcript) omitted.push("transcript");

  const compiled = compilePrompt({
    surface: "team_role",
    taskRecipe: [
      "# Role",
      input.roleId,
      "",
      "# Workflow",
      input.workflowId,
      "",
      "# Output authority",
      "Return role artifacts/proposals only. No Team child Agent may write CAT state, accept waivers, apply proposals, or export delivery files.",
      "Return the required JSON in the final assistant response. The runner persists it to the configured artifact path; do not request file-write permission or call intercom/contact_supervisor for persistence.",
      "Output exactly one strict JSON object with no Markdown fence or prose outside it. Every string must be valid JSON: escape embedded ASCII double quotes, or use unambiguous Unicode quotation marks inside natural-language text.",
      "Findings are issues or risks that need review. Severity must be blocker, major, minor, or advisory; advisory means an optional, non-blocking issue, not a positive audit observation. Put positive confirmations in summary.",
      "Each finding must use singular segmentId and evidenceRefs: { id?, segmentId?, severity, type: accuracy|terminology|style|genre|omission|format|constraint|query, message, proposedTarget?, evidenceRefs: string[] }.",
      "Each query must use singular segmentId and evidenceRefs: { id?, segmentId?, severity?, message, evidenceRefs: string[] }.",
    ].join("\n"),
    context: {
      task: input.taskContext,
      artifactRefs: input.artifactRefs,
      hardConstraints: input.hardConstraints,
      evidence: input.evidence,
      styleGuidance: input.styleGuideRules?.length
        ? ["Apply these as bounded guidance after hard constraints and project evidence; do not treat them as absolute authority.", ...input.styleGuideRules]
        : undefined,
      priorFindings: input.priorFindings?.map((item) => `${item.id}: ${item.message}`),
      transcript: input.includeTranscript ? input.transcript : undefined,
    },
    toolProfile: {
      allowedTools: input.allowedTools ?? [],
      blockedTools: ["read", "grep", "find", "ls", "write", "edit", "bash", "subagent", "segment_set_target", "proposal_apply", "delivery_export"],
      writeMode: "none",
      profileId: `team-role:${input.roleId}:scoped-evidence-v1`,
    },
    tokenBudget: input.tokenBudget,
  });
  for (const section of compiled.manifest.omittedSections) if (!omitted.includes(section)) omitted.push(section);
  if (compiled.manifest.omittedSections.includes("artifact_refs")) {
    for (const ref of input.artifactRefs ?? []) {
      const index = included.indexOf(ref);
      if (index >= 0) included.splice(index, 1);
      if (!omitted.includes(ref)) omitted.push(ref);
    }
  }
  return {
    prompt: compiled.effectivePrompt,
    manifest: {
      includedArtifactIds: [...new Set(included)],
      omittedArtifactIds: omitted,
      estimateScope: compiled.manifest.estimateScope,
      tokenEstimate: compiled.manifest.tokenEstimate,
      hardConstraintsPreserved: compiled.manifest.hardConstraintsPreserved,
      truncationReason: compiled.manifest.truncationReason,
      promptHash: compiled.manifest.promptHash,
      constitutionHash: compiled.manifest.constitutionHash,
      recipeHash: compiled.manifest.recipeHash,
      contextHash: compiled.manifest.contextHash,
      policyHash: compiled.manifest.policyHash,
      tokenBudget: compiled.manifest.tokenBudget,
      overBudget: compiled.manifest.overBudget,
      referenceIncluded: compiled.manifest.referenceIncluded,
      coverage: input.coverage,
    },
  };
}

function requiresBatch(roleId: TeamRoleId): boolean {
  return ["loc_engineer_gate", "translator", "editor", "proofreader", "culturalization_reviewer", "pre_lqa_reviewer", "delivery_manager", "lead_linguist_final"].includes(roleId);
}

/**
 * The production Team context seam. Callers supply only stable identities;
 * this module owns scope validation, role input hydration, context budgeting,
 * and the exact child evidence-tool profile.
 */
export async function prepareTeamRoleContext(
  repoRoot: string,
  input: { projectId: string; workflowId: string; roleId: TeamRoleId },
): Promise<TeamRoleContextPreparation> {
  const workflow = await readCatWorkflowRun(repoRoot, input.projectId, input.workflowId);
  const blockers: string[] = [];
  if (workflow.projectId !== input.projectId) blockers.push("Workflow project scope does not match the requested project.");
  let taskScope: { batchId?: string | null; segmentIds: string[]; sourceLocale?: string | null; targetLocale?: string | null } | undefined;
  let taskKind: string | undefined;
  if (workflow.taskId) {
    try {
      const task = (await createTaskWorkspace(repoRoot).open({ projectId: input.projectId, taskId: workflow.taskId })).task;
      taskScope = requireProjectTaskScope(task.scope, "Team Task");
      taskKind = task.kind;
    } catch {
      blockers.push("The canonical Task linked to this workflow is unavailable.");
    }
  }
  if (taskScope?.batchId && workflow.batchId !== taskScope.batchId) blockers.push("Workflow batch scope does not match the canonical Task.");
  if (requiresBatch(input.roleId) && !workflow.batchId) blockers.push(`${input.roleId} requires a batch-scoped Team workflow.`);

  const batch = workflow.batchId ? await readBatch(repoRoot, input.projectId, workflow.batchId).catch(() => undefined) : undefined;
  if (workflow.batchId && !batch) blockers.push(`Batch ${workflow.batchId} is unavailable.`);
  const requestedSegmentIds = [...new Set(taskScope?.segmentIds ?? [])];
  const batchIds = new Set(batch?.segments.map((segment) => segment.id) ?? []);
  const missingSegmentIds = requestedSegmentIds.filter((segmentId) => !batchIds.has(segmentId));
  if (missingSegmentIds.length) blockers.push(`Task segment scope is stale: ${missingSegmentIds.join(", ")}.`);

  const empty = buildTeamRoleContext({ roleId: input.roleId, workflowId: input.workflowId });
  if (blockers.length) return { status: "blocked", blockers, manifest: empty.manifest };

  const segmentIds = requestedSegmentIds;
  const selected = batch?.segments.filter((segment) => !segmentIds.length || segmentIds.includes(segment.id)) ?? [];
  let allowedTools = teamEvidenceToolsForScope(workflow.batchId);
  if (segmentIds.length) allowedTools = allowedTools.filter((name) => name !== "batch_read" && name !== "evidence_pack");
  if (taskKind === "eval") allowedTools = [];
  const scopeLines = [
    `Project: ${input.projectId}`,
    `Workflow: ${input.workflowId}`,
    workflow.plan.userRequest ? `User request: ${workflow.plan.userRequest.trim()}` : undefined,
    workflow.batchId ? `Batch: ${workflow.batchId}` : "Batch: none (project-level role)",
    `Locale: ${taskScope?.sourceLocale ?? batch?.sourceLanguage ?? "unknown"} -> ${taskScope?.targetLocale ?? batch?.targetLanguage ?? "unknown"}`,
    batch ? `Batch coverage: ${selected.length}/${batch.segments.length} segment(s) in this Task scope.` : undefined,
    segmentIds.length ? `Allowed segment ids: ${segmentIds.join(", ")}` : undefined,
    batch && !segmentIds.length ? "Use batch_read in pages until all relevant rows have been inspected; do not infer unseen rows." : undefined,
    `Callable CAT evidence tools: ${allowedTools.join(", ") || "none"}. Project and batch identity are injected by the runtime and cannot be overridden.`,
    "Use tool results as evidence only when they directly support the current segment or decision. Tool trace alone is audit data.",
  ].filter((line): line is string => Boolean(line));
  if (segmentIds.length) {
    if (allowedTools.includes("constraint_pack")) scopeLines.push("In this exact segment scope, every constraint_pack call must include one of the allowed segment ids.");
    scopeLines.push("Scoped segment packet:");
    for (const segment of selected) {
      scopeLines.push([
        `[${segment.id}] locked=${segment.locked} status=${segment.status}`,
        `Source: ${segment.source}`,
        `Current target: ${segment.target || "(empty)"}`,
        segment.contextNote ? `Context: ${segment.contextNote}` : undefined,
      ].filter(Boolean).join("\n"));
    }
  }

  const artifacts = await readWorkflowArtifacts(repoRoot, input.projectId);
  const inScope = (segmentId: string | undefined): boolean => !segmentId || !segmentIds.length || segmentIds.includes(segmentId);
  const roleArtifacts = artifacts.teamRoleArtifacts.filter((row) => row.workflowId === input.workflowId);
  const candidates = artifacts.teamCandidateTargets.filter((row) => row.workflowId === input.workflowId && inScope(row.segmentId));
  const findings = artifacts.teamFindings.filter((row) => row.workflowId === input.workflowId && inScope(row.segmentId));
  const decisions = artifacts.teamDecisions.filter((row) => row.workflowId === input.workflowId && inScope(row.segmentId));
  const taskDecisions = workflow.taskId
    ? (await createTaskWorkspace(repoRoot).open({ projectId: input.projectId, taskId: workflow.taskId })).decisions.filter((row) => row.runId === input.workflowId)
    : [];
  const qaReports = artifacts.deliveryQaReports.filter((row) => row.workflowId === input.workflowId);
  const inputArtifactRefs = [
    ...roleArtifacts.map((row) => row.id),
    ...candidates.map((row) => row.id),
    ...findings.map((row) => row.id),
    ...decisions.map((row) => row.id),
    ...qaReports.map((row) => row.reportId),
  ];
  if (inputArtifactRefs.length) {
    scopeLines.push(allowedTools.includes("team_artifact_read")
      ? `Upstream handoff coverage: ${inputArtifactRefs.length} artifact(s), summarized below. Use team_artifact_read only when a summary is insufficient; if used, page until Next start is none.`
      : `Upstream handoff coverage: ${inputArtifactRefs.length} artifact(s), fully represented by the inline summaries below. No artifact-read tool is available in this scope.`);
  }
  if (taskDecisions.length) {
    scopeLines.push("User decisions for this workflow (server-authored; use recorded answers to resolve prior Agent queries):");
    scopeLines.push(...taskDecisions.map((row) => [
      `[${row.id}] kind=${row.kind} status=${row.status}`,
      row.selectedOptionId ? `option=${row.selectedOptionId}` : undefined,
      row.reason ? `reason=${row.reason.trim()}` : `prompt=${row.prompt.trim()}`,
    ].filter(Boolean).join(" · ")));
  }
  const inlineScopedArtifacts = segmentIds.length > 0;
  const evidence = [
    ...roleArtifacts.map((row) => `${row.id} · ${row.type} · ${bounded(row.summary ?? `${row.roleId} artifact`, 300)}`),
    ...(inlineScopedArtifacts
      ? candidates.map((row) => `${row.id} · candidate ${row.segmentId} from ${row.roleId}: ${row.target}`)
      : candidates.length ? [`${candidates.length} candidate target(s) exist for the batch; page team_artifact_read before reviewing them.`] : []),
    ...(inlineScopedArtifacts
      ? decisions.map((row) => `${row.id} · ${row.decision}${row.segmentId ? ` · ${row.segmentId}` : ""}: ${row.reason}`)
      : decisions.length ? [`${decisions.length} prior Team decision(s) exist for the batch; page team_artifact_read before relying on them.`] : []),
    ...qaReports.map((row) => `${row.reportId} · Delivery QA: ${row.summary.blockers} blocker(s), ${row.summary.warnings} warning(s), ${row.summary.advisories} advisory item(s).`),
    ...(!inlineScopedArtifacts && findings.length ? [`${findings.length} finding(s) exist for the batch; page team_artifact_read before deciding them.`] : []),
  ];
  const hardConstraints = [
    "Stay inside the server-authored project, batch, locale, and segment scope.",
    "Never alter locked rows or add/delete/corrupt required tags, placeholders, ICU branches, or newlines. Preserve numeric values unless the typed scope explicitly authorizes a unit/notation conversion; keep every difference visible to QA.",
    batch ? `Locked rows in scope: ${selected.filter((segment) => segment.locked).map((segment) => segment.id).join(", ") || "none"}.` : undefined,
    batch ? `Batch tag state: unresolved=${batch.tagReport.unresolvedPlaceholders}, count mismatches=${batch.tagReport.tagCountMismatches}.` : undefined,
  ].filter((line): line is string => Boolean(line));
  const context = buildTeamRoleContext({
    roleId: input.roleId,
    workflowId: input.workflowId,
    taskContext: scopeLines.join("\n"),
    artifactRefs: inputArtifactRefs,
    hardConstraints,
    evidence,
    priorFindings: inlineScopedArtifacts
      ? findings.map((row) => ({ id: row.id, message: `${row.severity} ${row.type}${row.segmentId ? ` · ${row.segmentId}` : ""}: ${row.message}` }))
      : undefined,
    allowedTools,
    coverage: {
      batchSegments: batch?.segments.length ?? 0,
      taskSegments: selected.length,
      inlineSegments: segmentIds.length ? selected.length : 0,
      requiresPaging: Boolean(batch && !segmentIds.length),
    },
  });
  return {
    status: "ready",
    prompt: context.prompt,
    inputArtifactRefs,
    manifest: context.manifest,
    evidenceScope: { batchId: workflow.batchId, segmentIds, allowedTools },
  };
}
