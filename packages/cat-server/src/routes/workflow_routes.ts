import type { IncomingMessage, ServerResponse } from "node:http";
import { createHash, randomUUID } from "node:crypto";
import {
  beginStopCatWorkflowRun,
  buildRolePassFromSubagentStatus,
  prepareTeamRoleContext,
  CAT_WORKFLOW_INTENTS,
  completeCatWorkflowStep,
  createCatWorkflowRun,
  createTaskWorkspace,
  TaskWorkspaceConflictError,
  listSubagentAsyncStatuses,
  listCatWorkflowRuns,
  mutateWorkflowArtifacts,
  readCatWorkflowRun,
  readBatch,
  readProjectTagRuleContext,
  requireProjectTaskScope,
  readTeamRoleSettings,
  runDeterministicTeamEngineeringGate,
  runTeamDeliveryGate,
  readWorkflowArtifacts,
  workflowRunPath,
  writeJsonFile,
  runQaWriteGate,
  formatQaWriteGateBlockers,
  stopCatWorkflowRun,
  syncTeamQualityDecisionLedger,
  teamRoleDisplayName,
  teamRoleSessionId,
  teamRoleOutputContract,
  upsertTeamRolePass,
  validateTeamRoleOutputPresence,
  writeTeamRoleSettings,
  TEAM_ROLE_IDS,
  DETERMINISTIC_TEAM_ROLE_IDS,
  buildTeamRunPlan,
  type CatWorkflowIntent,
  type CatWorkflowRun,
  type DeliveryQaReport,
  type TeamCandidateTarget,
  type TeamDecision,
  type TeamRoleObjectArtifact,
  type TeamRoleId,
  type TeamRoleFinding,
  type TeamRoleOutputSignal,
  type TeamRolePass,
  type TeamRoleProfile,
  type TeamRoleSettings,
  type PromptRequestBudget,
  type TeamRunPlan,
  type TaskArtifact,
  type TaskDecision as TaskWorkspaceDecision,
  type TaskRun,
  type TaskRunEventDraft,
} from "@linguist-agent/cat-data";
import { bindTaskDecision } from "../task_decision_binding.js";
import { workflowApplicationPort } from "../application/workflow_application_port.js";
import { teamPackagePreflightBlockers, type TaskPackageRunResources } from "../task_package_profile.js";

export interface WorkflowRouteDeps {
  repoRoot: string;
  json: (res: ServerResponse, status: number, data: unknown) => void;
  readBody: (req: IncomingMessage) => Promise<unknown>;
  requireString: (value: unknown, label: string) => string;
  optionalString: (value: unknown) => string | undefined;
  optionalStringArray: (value: unknown) => string[] | undefined;
  optionalBoolean: (value: unknown) => boolean | undefined;
  stopActiveRuns?: (input: { projectId: string; workflowId: string; roleId?: TeamRoleId; reason?: string }) => Promise<unknown>;
  completeActiveRuns?: (input: { projectId: string; workflowId: string; roleId?: TeamRoleId; subagentRunId?: string }, error?: unknown) => number;
  spawnSubagentRun?: (projectId: string, workflowId: string, roleId: TeamRoleId, request: NonNullable<TeamRolePass["subagentSpawnRequest"]>) => Promise<unknown>;
  continueTeamRunsInBackground?: boolean;
  onTeamRolePass?: (input: { projectId: string; workflowId: string; roleId: TeamRoleId; pass: TeamRolePass }) => void | Promise<void>;
  readProjectAgentSettings?: (projectId: string) => Promise<{ teamRoleSettings?: TeamRoleSettings }>;
  writeProjectAgentSettings?: (projectId: string, patch: { teamRoleSettings?: TeamRoleSettings }) => Promise<unknown>;
  readTaskPackageRunResources?: (projectId: string, taskId: string) => Promise<TaskPackageRunResources>;
  resolveModelPromptTokenBudget?: (provider?: string, modelId?: string) => Promise<PromptRequestBudget | undefined>;
}

export async function projectCreatedWorkflowTask(
  run: CatWorkflowRun,
  deps: WorkflowRouteDeps,
  presentation?: { acknowledgementBody?: string; planBody?: string },
): Promise<void> {
  if (!run.taskId) return;
  const taskWorkspace = createTaskWorkspace(deps.repoRoot);
  const snapshot = await taskWorkspace.open({ projectId: run.projectId, taskId: run.taskId });
  if (snapshot.runs.some((row) => row.id === run.workflowId)) return;
  const runId = run.workflowId;
  const threadId = `${runId}.main`;
  const createdAt = run.updatedAt;
  const planBody = presentation?.planBody ?? run.plan.steps.map((step, index) => `${index + 1}. ${step.title}`).join("\n");
  const events = [
    {
      type: "run_upsert",
      agentThreadId: threadId,
      run: {
        id: runId,
        taskId: run.taskId,
        mode: run.plan.intent === "game_localization_team_run" ? "team" : "pipeline",
        status: "pending",
        rootAgentThreadId: threadId,
        planHash: null,
        estimatedCalls: null,
        startedAt: null,
        updatedAt: createdAt,
        completedAt: null,
        stopAvailable: false,
        resumeAvailable: false,
      },
    },
    {
      type: "thread_upsert",
      agentThreadId: threadId,
      thread: {
        id: threadId,
        taskId: run.taskId,
        runId,
        parentThreadId: null,
        identity: {
          kind: "main",
          roleId: "linguist-agent",
          displayName: "Linguist Agent",
          roleLabel: "Main Agent",
          disclosureLabel: "Agent",
        },
        status: "pending",
        canReceiveUserMessage: true,
        handoffSummary: null,
        latestActivityId: null,
        childThreadIds: [],
        createdAt,
        updatedAt: createdAt,
      },
    },
    {
      type: "activity_append",
      agentThreadId: threadId,
      activity: {
        id: `${runId}.acknowledgement`,
        taskId: run.taskId,
        runId,
        agentThreadId: threadId,
        seq: 1,
        type: "acknowledgement",
        status: "done",
        actor: { kind: "agent", id: "linguist-agent", displayName: "Linguist Agent", agentThreadId: threadId },
        title: "Task received",
        body: presentation?.acknowledgementBody ?? run.plan.userRequest ?? `Prepare ${run.plan.intent}.`,
        tool: null,
        refs: { artifactIds: [], evidenceRefs: [], decisionIds: [] },
        createdAt,
        updatedAt: createdAt,
      },
    },
    {
      type: "activity_append",
      agentThreadId: threadId,
      activity: {
        id: `${runId}.plan`,
        taskId: run.taskId,
        runId,
        agentThreadId: threadId,
        seq: 2,
        type: "plan",
        status: run.readiness?.status === "blocked" ? "blocked" : "done",
        actor: { kind: "agent", id: "linguist-agent", displayName: "Linguist Agent", agentThreadId: threadId },
        title: "Run plan prepared",
        body: planBody,
        tool: null,
        refs: { artifactIds: [], evidenceRefs: [], decisionIds: [] },
        createdAt,
        updatedAt: createdAt,
      },
    },
  ] satisfies TaskRunEventDraft[];
  await taskWorkspace.appendGenerated({ projectId: run.projectId, taskId: run.taskId, runId, events });
}

function workflowIntent(value: unknown): CatWorkflowIntent | undefined {
  const allowed = new Set<CatWorkflowIntent>(CAT_WORKFLOW_INTENTS);
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value === "string" && allowed.has(value as CatWorkflowIntent)) return value as CatWorkflowIntent;
  throw new Error(`Invalid workflow intent ${String(value)}.`);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const teamLaunchQueues = new Map<string, Promise<void>>();

async function withTeamLaunchLock<T>(
  repoRoot: string,
  projectId: string,
  workflowId: string,
  operation: () => Promise<T>,
): Promise<T> {
  const key = `${repoRoot}\u0000${projectId}\u0000${workflowId}`;
  const previous = teamLaunchQueues.get(key) ?? Promise.resolve();
  let release!: () => void;
  const gate = new Promise<void>((resolveGate) => { release = resolveGate; });
  const queued = previous.then(() => gate, () => gate);
  teamLaunchQueues.set(key, queued);
  await previous.catch(() => undefined);
  try {
    return await operation();
  } finally {
    release();
    if (teamLaunchQueues.get(key) === queued) teamLaunchQueues.delete(key);
  }
}

function extractSubagentAsyncDir(value: unknown): string | undefined {
  if (!value || typeof value !== "object") return undefined;
  const root = value as Record<string, unknown>;
  const data = root.data && typeof root.data === "object" ? root.data as Record<string, unknown> : root;
  const details = data.details && typeof data.details === "object" ? data.details as Record<string, unknown> : undefined;
  return typeof details?.asyncDir === "string" ? details.asyncDir : undefined;
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function hasOwn(value: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function arrayRecords(value: unknown): Array<Record<string, unknown>> {
  return Array.isArray(value) ? value.flatMap((item) => record(item) ? [record(item)!] : []) : [];
}

function uniqueById<T extends { id: string }>(rows: T[]): T[] {
  return Array.from(new Map(rows.map((row) => [row.id, row])).values());
}

function uniqueByReportId<T extends { reportId: string }>(rows: T[]): T[] {
  return Array.from(new Map(rows.map((row) => [row.reportId, row])).values());
}

function roleOutputJson(text: string | undefined): Record<string, unknown> | undefined {
  if (!text) return undefined;
  const fenced = [...text.matchAll(/```(?:json)?\s*([\s\S]*?)```/gi)].map((match) => match[1]!.trim()).reverse();
  const candidates = [text.trim(), ...fenced];
  const lastBrace = text.lastIndexOf("}");
  if (lastBrace >= 0) {
    for (let start = text.indexOf("{"); start >= 0 && start < lastBrace; start = text.indexOf("{", start + 1)) {
      candidates.push(text.slice(start, lastBrace + 1));
    }
  }
  for (const candidate of candidates) {
    try {
      const parsed = record(JSON.parse(candidate));
      if (parsed) return parsed;
    } catch {
      // pi-subagents output logs include progress before the final JSON block.
    }
  }
  return undefined;
}

function findingSeverity(value: unknown): TeamRoleFinding["severity"] {
  return value === "blocker" || value === "major" || value === "minor" || value === "advisory" ? value : "advisory";
}

function validFindingSeverity(value: unknown): boolean {
  return value === "info" || findingSeverity(value) === value;
}

function findingType(value: unknown): TeamRoleFinding["type"] {
  return value === "accuracy" || value === "terminology" || value === "style" || value === "genre" || value === "omission" || value === "format" || value === "constraint" || value === "query" ? value : "query";
}

function teamDecision(value: unknown): TeamDecision["decision"] {
  return value === "accept" || value === "reject" || value === "query" || value === "accepted_risk" ? value : "query";
}

function queryMessage(row: Record<string, unknown>): string {
  for (const key of ["message", "question", "query"]) {
    if (typeof row[key] === "string" && row[key].trim()) return row[key].trim();
  }
  return "";
}

function isBlockingTeamQuery(finding: TeamRoleFinding): boolean {
  return finding.type === "query" && (finding.severity === "blocker" || finding.severity === "major");
}

function deliveryQaReport(value: unknown): DeliveryQaReport | undefined {
  const row = record(value);
  return typeof row?.reportId === "string" && row.reportId ? row as unknown as DeliveryQaReport : undefined;
}

interface ExpectedWorkflowQaScope {
  projectId: string;
  workflowId: string;
  batchId?: string;
}

function invalidDeliveryQaScopeReason(row: Record<string, unknown>, label: string, expected: ExpectedWorkflowQaScope | undefined): string | undefined {
  if (!expected) return undefined;
  if (row.projectId !== expected.projectId) return `${label}.projectId must match ${expected.projectId}`;
  if (row.workflowId !== expected.workflowId) return `${label}.workflowId must match ${expected.workflowId}`;
  if (expected.batchId !== undefined && row.batchId !== expected.batchId) return `${label}.batchId must match ${expected.batchId}`;
  return undefined;
}

function invalidDeliveryQaReason(value: unknown, expectedScope?: ExpectedWorkflowQaScope): string | undefined {
  const row = record(value);
  if (!row || typeof row.reportId !== "string" || !row.reportId.trim()) return "deliveryQa.reportId is required";
  if (typeof row.projectId !== "string" || !row.projectId.trim()) return "deliveryQa.projectId is required";
  if (row.batchId !== undefined && typeof row.batchId !== "string") return "deliveryQa.batchId must be a string";
  if (row.workflowId !== undefined && typeof row.workflowId !== "string") return "deliveryQa.workflowId must be a string";
  const scopeError = invalidDeliveryQaScopeReason(row, "deliveryQa", expectedScope);
  if (scopeError) return scopeError;
  if (typeof row.generatedAt !== "string" || !row.generatedAt.trim()) return "deliveryQa.generatedAt is required";
  if (!Array.isArray(row.findings)) return "deliveryQa.findings must be an array";
  const validSeverities = new Set(["blocker", "warning", "advisory"]);
  const findingIds = new Set<string>();
  for (const [index, item] of row.findings.entries()) {
    const finding = record(item);
    if (!finding) return `deliveryQa.findings[${index}] must be an object`;
    if (typeof finding.id !== "string" || !finding.id.trim()) return `deliveryQa.findings[${index}].id is required`;
    if (findingIds.has(finding.id)) return `deliveryQa.findings[${index}].id must be unique`;
    findingIds.add(finding.id);
    if (typeof finding.type !== "string" || !finding.type.trim()) return `deliveryQa.findings[${index}].type is required`;
    if (typeof finding.severity !== "string" || !validSeverities.has(finding.severity)) return `deliveryQa.findings[${index}].severity is invalid`;
    for (const field of ["segmentId", "source", "target"]) {
      const locationError = invalidOptionalStringField(finding, `deliveryQa.findings[${index}]`, field);
      if (locationError) return locationError;
    }
    if (typeof finding.message !== "string" || !finding.message.trim()) return `deliveryQa.findings[${index}].message is required`;
    const evidenceError = !Array.isArray(finding.evidence)
      ? `deliveryQa.findings[${index}].evidence must be an array of strings`
      : invalidStringArrayReason(finding.evidence, `deliveryQa.findings[${index}].evidence`);
    if (evidenceError) return evidenceError;
  }
  const summary = record(row.summary);
  if (!summary) return "deliveryQa.summary is required";
  for (const key of ["blockers", "warnings", "advisories"]) {
    if (typeof summary[key] !== "number") return `deliveryQa.summary.${key} must be a number`;
  }
  const expectedSummary = {
    blockers: row.findings.filter((finding) => record(finding)?.severity === "blocker").length,
    warnings: row.findings.filter((finding) => record(finding)?.severity === "warning").length,
    advisories: row.findings.filter((finding) => record(finding)?.severity === "advisory").length,
  };
  for (const [key, expected] of Object.entries(expectedSummary)) {
    if (summary[key] !== expected) return `deliveryQa.summary.${key} must equal ${expected}`;
  }
  return undefined;
}

function invalidStringArrayReason(value: unknown, label: string): string | undefined {
  return value !== undefined && (!Array.isArray(value) || value.some((item) => typeof item !== "string")) ? `${label} must be an array of strings` : undefined;
}

function invalidOptionalStringField(row: Record<string, unknown>, label: string, field: string): string | undefined {
  return row[field] !== undefined && row[field] !== null && typeof row[field] !== "string" ? `${label}.${field} must be a string` : undefined;
}

function duplicateOptionalIdReason(rows: Record<string, unknown>[], label: string): string | undefined {
  const seen = new Set<string>();
  for (const [index, row] of rows.entries()) {
    if (typeof row.id !== "string" || !row.id) continue;
    if (seen.has(row.id)) return `${label}[${index}].id must be unique`;
    seen.add(row.id);
  }
  return undefined;
}

function invalidRequiredStringArrayFields(row: Record<string, unknown>, label: string, fields: string[]): string | undefined {
  for (const field of fields) {
    if (!Array.isArray(row[field])) return `${label}.${field} must be an array of strings`;
    const error = invalidStringArrayReason(row[field], `${label}.${field}`);
    if (error) return error;
  }
  return undefined;
}

function invalidRequiredStringOrObjectArrayReason(value: unknown, label: string): string | undefined {
  if (!Array.isArray(value)) return `${label} must be an array`;
  const invalidIndex = value.findIndex((item) => {
    if (typeof item === "string") return !item.trim();
    const row = record(item);
    return !row || !Object.keys(row).length;
  });
  return invalidIndex >= 0
    ? `${label}[${invalidIndex}] must be a non-empty string or object`
    : undefined;
}

function invalidRequiredStringOrObjectArrayFields(row: Record<string, unknown>, label: string, fields: string[]): string | undefined {
  for (const field of fields) {
    const error = invalidRequiredStringOrObjectArrayReason(row[field], `${label}.${field}`);
    if (error) return error;
  }
  return undefined;
}

function invalidRequiredStrategyArrayFields(row: Record<string, unknown>, fields: string[]): string | undefined {
  for (const field of fields) {
    if (!Array.isArray(row[field])) return `strategy.${field} must be an array`;
    const invalidIndex = row[field].findIndex((item) =>
      !(typeof item === "string" && item.trim()) && !(record(item) && Object.keys(record(item)!).length));
    if (invalidIndex >= 0) return `strategy.${field}[${invalidIndex}] must be a non-empty string or object`;
  }
  return undefined;
}

const SEGMENT_FINDING_ROLES = new Set<TeamRoleId>(["editor", "proofreader", "culturalization_reviewer"]);
const REVIEWER_CANDIDATE_ROLES = new Set<TeamRoleId>(["editor", "proofreader", "culturalization_reviewer"]);
const ROLE_OUTPUT_SIGNAL_KEYS: Record<string, TeamRoleOutputSignal> = {
  brief: "brief",
  engineeringGate: "engineeringGate",
  strategy: "strategy",
  preLqaRisks: "preLqaRisks",
  findings: "findings",
  queries: "queries",
  candidateTargets: "candidateTargets",
  candidates: "candidateTargets",
  decisions: "decisions",
  deliveryQa: "deliveryQa",
  noIssues: "noIssues",
};

function unexpectedRoleOutputSignalReason(roleId: TeamRoleId, output: Record<string, unknown>): string | undefined {
  const allowed = new Set(teamRoleOutputContract(roleId).outputSignals);
  for (const [key, signal] of Object.entries(ROLE_OUTPUT_SIGNAL_KEYS)) {
    if (hasOwn(output, key) && !allowed.has(signal)) return `${key} is not allowed for ${roleId}`;
  }
  return undefined;
}

function invalidRoleObjectArtifactReason(output: Record<string, unknown>): string | undefined {
  if (hasOwn(output, "brief")) {
    const brief = record(output.brief);
    if (!brief) return "brief must be an object";
    if (typeof brief.projectGoal !== "string" || !brief.projectGoal.trim()) return "brief.projectGoal is required";
    const briefArrayError = invalidRequiredStringOrObjectArrayFields(brief, "brief", ["scope", "knownAssets", "missingInputs", "risks", "handoffNotes"]);
    if (briefArrayError) return briefArrayError;
  }
  if (hasOwn(output, "engineeringGate")) {
    const gate = record(output.engineeringGate);
    if (!gate) return "engineeringGate must be an object";
    if (typeof gate.ready !== "boolean") return "engineeringGate.ready must be a boolean";
    const gateArrayError = invalidRequiredStringArrayFields(gate, "engineeringGate", ["blockers", "warnings", "formatRules"]);
    if (gateArrayError) return gateArrayError;
    const blockerCount = Array.isArray(gate.blockers) ? gate.blockers.length : 0;
    if (gate.ready === false && blockerCount === 0) return "engineeringGate.blockers must include at least one blocker when ready is false";
    if (gate.ready === true && blockerCount > 0) return "engineeringGate.blockers must be empty when ready is true";
  }
  if (hasOwn(output, "strategy")) {
    const strategy = record(output.strategy);
    if (!strategy) return "strategy must be an object";
    const strategyArrayError = invalidRequiredStrategyArrayFields(strategy, ["authorityOrder", "voiceRules", "genreRules", "uiRules", "termRules", "queryRules", "mustNotDo"]);
    if (strategyArrayError) return strategyArrayError;
  }
  if (hasOwn(output, "preLqaRisks")) {
    const risks = Array.isArray(output.preLqaRisks) ? output.preLqaRisks : [];
    for (const [index, item] of risks.entries()) {
      const risk = record(item);
      if (!risk) return `preLqaRisks[${index}] must be an object`;
      const idError = invalidOptionalStringField(risk, `preLqaRisks[${index}]`, "id");
      if (idError) return idError;
      if (typeof risk.message !== "string" || !risk.message.trim()) return `preLqaRisks[${index}].message is required`;
      if (risk.segmentId !== undefined && typeof risk.segmentId !== "string") return `preLqaRisks[${index}].segmentId must be a string`;
      if (!validFindingSeverity(risk.severity)) return `preLqaRisks[${index}].severity is invalid`;
      const evidenceError = risk.evidenceRefs === undefined
        ? undefined
        : !Array.isArray(risk.evidenceRefs)
          ? `preLqaRisks[${index}].evidenceRefs must be an array of strings`
          : invalidStringArrayReason(risk.evidenceRefs, `preLqaRisks[${index}].evidenceRefs`);
      if (evidenceError) return evidenceError;
    }
    const duplicateRiskId = duplicateOptionalIdReason(arrayRecords(output.preLqaRisks), "preLqaRisks");
    if (duplicateRiskId) return duplicateRiskId;
  }
  return undefined;
}

function validateRoleOutputFields(roleId: TeamRoleId, output: Record<string, unknown>, expectedQaScope?: ExpectedWorkflowQaScope): string | undefined {
  if (typeof output.roleId === "string" && output.roleId !== roleId) return `roleId must match ${roleId}`;
  if (hasOwn(output, "summary") && typeof output.summary !== "string") return "summary must be a string";
  if (hasOwn(output, "reviewedDeliveryQa")) return "reviewedDeliveryQa is server/user-owned and is not accepted from model roles";
  const unexpectedSignal = unexpectedRoleOutputSignalReason(roleId, output);
  if (unexpectedSignal) return unexpectedSignal;
  for (const key of ["brief", "engineeringGate", "strategy"]) {
    if (hasOwn(output, key) && !record(output[key])) return `${key} must be an object`;
  }
  const roleObjectError = invalidRoleObjectArtifactReason(output);
  if (roleObjectError) return roleObjectError;
  if (hasOwn(output, "preLqaRisks") && !Array.isArray(output.preLqaRisks)) return "preLqaRisks must be an array";
  if (hasOwn(output, "noIssues") && typeof output.noIssues !== "boolean") return "noIssues must be a boolean";
  if (output.noIssues === true) {
    for (const key of ["findings", "queries", "candidateTargets", "candidates", "preLqaRisks", "decisions"]) {
      if (Array.isArray(output[key]) && output[key].length > 0) return `noIssues cannot be true with ${key}`;
    }
    if (hasOwn(output, "deliveryQa") || hasOwn(output, "reviewedDeliveryQa")) return "noIssues cannot be true with QA artifacts";
  }
  for (const key of ["findings", "queries", "candidateTargets", "candidates", "decisions"]) {
    if (hasOwn(output, key) && !Array.isArray(output[key])) return `${key} must be an array`;
    const badIndex = Array.isArray(output[key]) ? output[key].findIndex((item) => !record(item)) : -1;
    if (badIndex >= 0) return `${key}[${badIndex}] must be an object`;
  }
  for (const key of ["findings", "queries", "decisions"]) {
    const duplicateId = duplicateOptionalIdReason(arrayRecords(output[key]), key);
    if (duplicateId) return duplicateId;
  }
  for (const [index, row] of arrayRecords(output.findings).entries()) {
    const idError = invalidOptionalStringField(row, `findings[${index}]`, "id");
    if (idError) return idError;
    if (typeof row.message !== "string" || !row.message.trim()) return `findings[${index}].message is required`;
    if (SEGMENT_FINDING_ROLES.has(roleId) && (typeof row.segmentId !== "string" || !row.segmentId.trim())) return `findings[${index}].segmentId is required for ${roleId}`;
    if (!validFindingSeverity(row.severity)) return `findings[${index}].severity is invalid`;
    if (findingType(row.type) !== row.type) return `findings[${index}].type is invalid`;
    if (row.segmentId !== undefined && row.segmentId !== null && typeof row.segmentId !== "string") return `findings[${index}].segmentId must be a string`;
    if (row.proposedTarget !== undefined && row.proposedTarget !== null && typeof row.proposedTarget !== "string") return `findings[${index}].proposedTarget must be a string`;
    const evidenceError = row.evidenceRefs === undefined
      ? undefined
      : !Array.isArray(row.evidenceRefs)
        ? `findings[${index}].evidenceRefs must be an array of strings`
        : invalidStringArrayReason(row.evidenceRefs, `findings[${index}].evidenceRefs`);
    if (evidenceError) return evidenceError;
  }
  for (const [index, row] of arrayRecords(output.queries).entries()) {
    const idError = invalidOptionalStringField(row, `queries[${index}]`, "id");
    if (idError) return idError;
    if (!queryMessage(row)) return `queries[${index}].message is required`;
    if (row.segmentId !== undefined && row.segmentId !== null && typeof row.segmentId !== "string") return `queries[${index}].segmentId must be a string`;
    if (row.severity !== undefined && !validFindingSeverity(row.severity)) return `queries[${index}].severity is invalid`;
    const evidenceError = row.evidenceRefs === undefined
      ? undefined
      : !Array.isArray(row.evidenceRefs)
        ? `queries[${index}].evidenceRefs must be an array of strings`
        : invalidStringArrayReason(row.evidenceRefs, `queries[${index}].evidenceRefs`);
    if (evidenceError) return evidenceError;
  }
  const candidateTargetRows = arrayRecords(output.candidateTargets);
  const candidateAliasRows = arrayRecords(output.candidates);
  if (candidateTargetRows.length > 0 && candidateAliasRows.length > 0) return "candidateTargets and candidates cannot both be set";
  const candidateRows = candidateTargetRows.length ? candidateTargetRows : candidateAliasRows;
  const duplicateCandidateId = duplicateOptionalIdReason(candidateRows, "candidateTargets");
  if (duplicateCandidateId) return duplicateCandidateId;
  for (const [index, row] of candidateRows.entries()) {
    const idError = invalidOptionalStringField(row, `candidateTargets[${index}]`, "id");
    if (idError) return idError;
    if (typeof row.segmentId !== "string" || !row.segmentId.trim()) return `candidateTargets[${index}].segmentId is required`;
    if (typeof row.target !== "string" || !row.target.trim()) return `candidateTargets[${index}].target is required`;
    if (row.function !== undefined && row.function !== null && typeof row.function !== "string") return `candidateTargets[${index}].function must be a string`;
    if (row.notes !== undefined && row.notes !== null && typeof row.notes !== "string") return `candidateTargets[${index}].notes must be a string`;
    if (REVIEWER_CANDIDATE_ROLES.has(roleId) && (typeof row.notes !== "string" || !row.notes.trim())) {
      return `candidateTargets[${index}].notes is required for ${roleId}`;
    }
    const evidenceError = row.evidenceRefs === undefined
      ? undefined
      : !Array.isArray(row.evidenceRefs)
        ? `candidateTargets[${index}].evidenceRefs must be an array of strings`
        : invalidStringArrayReason(row.evidenceRefs, `candidateTargets[${index}].evidenceRefs`);
    if (evidenceError) return evidenceError;
  }
  for (const [index, row] of arrayRecords(output.decisions).entries()) {
    const idError = invalidOptionalStringField(row, `decisions[${index}]`, "id");
    if (idError) return idError;
    if (teamDecision(row.decision) !== row.decision) return `decisions[${index}].decision is invalid`;
    if (row.decision === "accepted_risk") return `decisions[${index}].accepted_risk requires an explicit user decision`;
    if (typeof row.reason !== "string" || !row.reason.trim()) return `decisions[${index}].reason is required`;
    const findingIds = row.findingIds;
    if (!Array.isArray(findingIds)) return `decisions[${index}].findingIds must be an array of strings`;
    const findingError = invalidStringArrayReason(findingIds, `decisions[${index}].findingIds`);
    if (findingError) return findingError;
    if (findingIds.length === 0) return `decisions[${index}].findingIds must include at least one finding id`;
    if (hasOwn(row, "finalTarget") && row.finalTarget !== null) {
      if (typeof row.finalTarget !== "string" || !row.finalTarget.trim()) return `decisions[${index}].finalTarget must be a string`;
      if (typeof row.segmentId !== "string" || !row.segmentId.trim()) return `decisions[${index}].segmentId is required with finalTarget`;
      if (row.decision !== "accept") return `decisions[${index}].decision must accept finalTarget`;
      const evidenceError = row.evidenceRefs === undefined
        ? undefined
        : !Array.isArray(row.evidenceRefs)
          ? `decisions[${index}].evidenceRefs must be an array of strings`
          : invalidStringArrayReason(row.evidenceRefs, `decisions[${index}].evidenceRefs`);
      if (evidenceError) return evidenceError;
    }
  }
  if (hasOwn(output, "deliveryQa")) {
    const deliveryQaError = invalidDeliveryQaReason(output.deliveryQa, expectedQaScope);
    if (deliveryQaError) return deliveryQaError;
  }
  return undefined;
}

type RoleOutputIngestResult =
  | { ok: true; artifactsWritten: boolean }
  | { ok: false; reason: string };

function invalidRoleOutputPass(rolePass: TeamRolePass, reason: string): TeamRolePass {
  return {
    ...rolePass,
    status: "failed",
    summary: `${rolePass.summary} Role output rejected: ${reason}`,
  };
}

function roleOutputRejectionReason(input: {
  roleId: TeamRoleId;
  output: Record<string, unknown>;
  summary: string;
  findings: TeamRoleFinding[];
  candidateTargets: TeamCandidateTarget[];
  decisions: TeamDecision[];
  deliveryQa?: DeliveryQaReport;
  knownFindingIds?: Set<string>;
  knownFindingSegments?: Map<string, string | undefined>;
  expectedQaScope?: ExpectedWorkflowQaScope;
}): string | undefined {
  const fieldError = validateRoleOutputFields(input.roleId, input.output, input.expectedQaScope);
  if (fieldError) return fieldError;
  if (input.knownFindingIds) {
    for (const [index, decision] of input.decisions.entries()) {
      const unknown = decision.findingIds.find((id) => !input.knownFindingIds?.has(id));
      if (unknown) return `decisions[${index}].findingIds contains unknown finding id ${unknown}`;
    }
  }
  if (input.knownFindingSegments) {
    for (const [index, decision] of input.decisions.entries()) {
      if (!decision.segmentId) continue;
      for (const findingId of decision.findingIds) {
        const linkedSegmentId = input.knownFindingSegments.get(findingId);
        if (linkedSegmentId && linkedSegmentId !== decision.segmentId) {
          return `decisions[${index}].findingIds references ${findingId} from segment ${linkedSegmentId}, not ${decision.segmentId}`;
        }
      }
    }
  }
  const validation = validateTeamRoleOutputPresence(input.roleId, {
    objectKeys: Object.entries(input.output)
      .filter(([, value]) => {
        const row = record(value);
        return !!row && Object.keys(row).length > 0;
      })
      .map(([key]) => key),
    arrayKeys: Object.entries(input.output)
      .filter(([, value]) => Array.isArray(value))
      .map(([key]) => key),
    preLqaRiskCount: Array.isArray(input.output.preLqaRisks) ? input.output.preLqaRisks.length : 0,
    hasSummary: !!input.summary,
    findingCount: input.findings.length,
    queryCount: input.findings.filter((row) => row.type === "query").length,
    candidateCount: input.candidateTargets.length,
    decisionCount: input.decisions.length,
    hasDeliveryQa: !!input.deliveryQa,
    hasReviewedDeliveryQa: false,
    hasNoIssues: input.output.noIssues === true,
  });
  return validation.ok ? undefined : validation.reason;
}

interface ScopedRoleOutputRef {
  label: string;
  segmentId: string;
  writesTarget: boolean;
  target?: string;
}

function scopedRoleOutputRefs(output: Record<string, unknown>): ScopedRoleOutputRef[] {
  const refs: ScopedRoleOutputRef[] = [];
  const add = (value: unknown, label: string, targetKey?: "target" | "proposedTarget" | "finalTarget") => {
    for (const [index, row] of arrayRecords(value).entries()) {
      if (typeof row.segmentId === "string") {
        const target = targetKey && typeof row[targetKey] === "string" ? row[targetKey] : undefined;
        refs.push({ label: `${label}[${index}]`, segmentId: row.segmentId, writesTarget: target !== undefined, target });
      }
    }
  };
  add(output.findings, "findings", "proposedTarget");
  add(output.queries, "queries");
  add(output.preLqaRisks, "preLqaRisks");
  add(output.candidateTargets, "candidateTargets", "target");
  add(output.candidates, "candidates", "target");
  add(output.decisions, "decisions", "finalTarget");
  const deliveryQa = record(output.deliveryQa);
  add(deliveryQa?.findings, "deliveryQa.findings");
  return refs;
}

async function scopedRoleOutputRejectionReason(input: {
  repoRoot: string;
  projectId: string;
  run: Awaited<ReturnType<typeof readCatWorkflowRun>>;
  output: Record<string, unknown>;
}): Promise<string | undefined> {
  const refs = scopedRoleOutputRefs(input.output);
  if (!refs.length) return undefined;
  let task: Awaited<ReturnType<ReturnType<typeof createTaskWorkspace>["open"]>>["task"] | undefined;
  if (input.run.taskId) {
    try {
      task = (await createTaskWorkspace(input.repoRoot).open({ projectId: input.projectId, taskId: input.run.taskId })).task;
    } catch (error) {
      return `canonical task scope is unavailable: ${error instanceof Error ? error.message : String(error)}`;
    }
  }
  const taskScope = task ? requireProjectTaskScope(task.scope, "Workflow Task") : undefined;
  const batchId = input.run.batchId ?? taskScope?.batchId ?? undefined;
  if (!batchId) return task ? `canonical task ${task.id} has segment output but no batch scope` : undefined;
  if (taskScope?.batchId && taskScope.batchId !== batchId) {
    return `canonical task ${task!.id} is scoped to batch ${taskScope.batchId}, not ${batchId}`;
  }
  let batch: Awaited<ReturnType<typeof readBatch>>;
  try {
    batch = await readBatch(input.repoRoot, input.projectId, batchId);
  } catch (error) {
    return `canonical batch scope is unavailable: ${error instanceof Error ? error.message : String(error)}`;
  }
  if (batch.projectId !== input.projectId || batch.batchId !== batchId) return `canonical batch ${batchId} does not match its durable scope`;
  const batchSegments = new Map(batch.segments.map((segment) => [segment.id, segment]));
  const ruleContext = refs.some((ref) => ref.writesTarget)
    ? await readProjectTagRuleContext(input.repoRoot, input.projectId)
    : undefined;
  const taskSegmentIds = taskScope?.segmentIds.length ? new Set(taskScope.segmentIds) : new Set(batchSegments.keys());
  const staleTaskSegmentId = taskScope?.segmentIds.find((segmentId) => !batchSegments.has(segmentId));
  if (task && staleTaskSegmentId) return `canonical task ${task.id} references segment ${staleTaskSegmentId} outside batch ${batchId}`;
  for (const ref of refs) {
    const segment = batchSegments.get(ref.segmentId);
    if (!segment) return `${ref.label}.segmentId ${ref.segmentId} is outside batch ${batchId}`;
    if (task && !taskSegmentIds.has(ref.segmentId)) return `${ref.label}.segmentId ${ref.segmentId} is outside task ${task.id} scope`;
    if (ref.writesTarget && segment.locked) return `${ref.label}.segmentId ${ref.segmentId} is locked`;
    if (ref.target !== undefined && ruleContext) {
      const gate = runQaWriteGate(segment, ref.target, ruleContext);
      if (!gate.ok) return `${ref.label}: ${formatQaWriteGateBlockers(ref.segmentId, gate.blockers)}`;
    }
  }
  return undefined;
}

function roleObjectArtifacts(input: {
  workflowId: string;
  roleId: TeamRoleId;
  output: Record<string, unknown>;
  summary: string;
}): TeamRoleObjectArtifact[] {
  const createdAt = new Date().toISOString();
  const row = (type: TeamRoleObjectArtifact["type"], data: unknown): TeamRoleObjectArtifact => ({
    id: `${input.workflowId}:${input.roleId}:${type}`,
    workflowId: input.workflowId,
    roleId: input.roleId,
    type,
    data,
    createdAt,
    summary: input.summary || undefined,
  });
  switch (input.roleId) {
    case "producer": {
      const data = record(input.output.brief);
      return data && Object.keys(data).length ? [row("brief", data)] : [];
    }
    case "loc_engineer_gate": {
      const data = record(input.output.engineeringGate);
      return data && Object.keys(data).length ? [row("engineering_gate", data)] : [];
    }
    case "lead_linguist_setup": {
      const data = record(input.output.strategy);
      return data && Object.keys(data).length ? [row("strategy", data)] : [];
    }
    case "pre_lqa_reviewer":
      return Array.isArray(input.output.preLqaRisks) ? [row("pre_lqa", input.output.preLqaRisks)] : [];
    default:
      return [];
  }
}

function blockedEngineeringGate(output: Record<string, unknown>): string[] {
  const gate = record(output.engineeringGate);
  return gate?.ready === false ? stringArray(gate.blockers) : [];
}

function knownWorkflowFindingIds(input: {
  workflowId: string;
  batchId?: string;
  artifacts: Awaited<ReturnType<typeof readWorkflowArtifacts>>;
  findings: TeamRoleFinding[];
  deliveryQa?: DeliveryQaReport;
}): Set<string> {
  const ids = new Set<string>();
  const add = (id: string | undefined) => { if (id) ids.add(id); };
  const matchesScope = (row: { workflowId?: string; batchId?: string }) => row.workflowId === input.workflowId || (!row.workflowId && !!input.batchId && row.batchId === input.batchId);
  input.findings.forEach((row) => add(row.id));
  input.deliveryQa?.findings.forEach((row) => add(row.id));
  input.artifacts.teamFindings.filter((row) => row.workflowId === input.workflowId).forEach((row) => add(row.id));
  input.artifacts.deliveryQaReports
    .filter(matchesScope)
    .flatMap((report) => report.findings)
    .forEach((row) => add(row.id));
  return ids;
}

function knownWorkflowFindingSegments(input: {
  workflowId: string;
  batchId?: string;
  artifacts: Awaited<ReturnType<typeof readWorkflowArtifacts>>;
  findings: TeamRoleFinding[];
  deliveryQa?: DeliveryQaReport;
}): Map<string, string | undefined> {
  const segments = new Map<string, string | undefined>();
  const add = (id: string | undefined, segmentId: string | undefined) => { if (id) segments.set(id, segmentId); };
  const matchesScope = (row: { workflowId?: string; batchId?: string }) => row.workflowId === input.workflowId || (!row.workflowId && !!input.batchId && row.batchId === input.batchId);
  input.findings.forEach((row) => add(row.id, row.segmentId));
  input.deliveryQa?.findings.forEach((row) => add(row.id, row.segmentId));
  input.artifacts.teamFindings.filter((row) => row.workflowId === input.workflowId).forEach((row) => add(row.id, row.segmentId));
  input.artifacts.deliveryQaReports
    .filter(matchesScope)
    .flatMap((report) => report.findings)
    .forEach((row) => add(row.id, row.segmentId));
  return segments;
}

function workflowQualityLedgerFindings(
  run: Awaited<ReturnType<typeof readCatWorkflowRun>>,
  artifacts: Awaited<ReturnType<typeof readWorkflowArtifacts>>,
) {
  const matchesQaScope = (row: { workflowId?: string; batchId?: string }) =>
    row.workflowId === run.workflowId || (!row.workflowId && !!run.batchId && row.batchId === run.batchId);
  return {
    teamFindings: artifacts.teamFindings.filter((row) => row.workflowId === run.workflowId),
    deliveryQaFindings: uniqueById(artifacts.deliveryQaReports.filter(matchesQaScope).flatMap((report) => report.findings)),
  };
}

function canonicalFindingId(
  value: string,
  artifacts: Awaited<ReturnType<typeof readWorkflowArtifacts>>,
): string {
  for (const report of artifacts.deliveryQaReports) {
    const finding = report.findings.find((row) => `${report.reportId}:${row.id}` === value);
    if (finding) return finding.id;
  }
  return value;
}

async function ingestCompletedRoleOutput(input: {
  projectId: string;
  workflowId: string;
  roleId: TeamRoleId;
  rolePass: TeamRolePass;
  asyncDir?: string;
  statusOutputFile?: string;
  repoRoot: string;
}): Promise<RoleOutputIngestResult> {
  if (input.rolePass.status !== "completed") return { ok: true, artifactsWritten: false };
  const configuredOutput = input.rolePass.subagentSpawnRequest?.params.output;
  const outputText = await workflowApplicationPort.readRoleOutput({
    repoRoot: input.repoRoot,
    asyncDir: input.asyncDir,
    configuredOutput,
    statusOutputFile: input.statusOutputFile,
  });
  const output = roleOutputJson(outputText);
  if (!output) return { ok: false, reason: "missing or invalid JSON" };
  const summary = typeof output.summary === "string" ? output.summary.trim() : "";
  const explicitFindings: TeamRoleFinding[] = arrayRecords(output.findings).map((row, index) => ({
    id: typeof row.id === "string" && row.id ? row.id : `${input.workflowId}:${input.roleId}:finding:${index}`,
    workflowId: input.workflowId,
    roleId: input.roleId,
    segmentId: typeof row.segmentId === "string" ? row.segmentId : undefined,
    severity: findingSeverity(row.severity),
    type: findingType(row.type),
    message: typeof row.message === "string" ? row.message : "",
    proposedTarget: typeof row.proposedTarget === "string" ? row.proposedTarget : undefined,
    evidenceRefs: stringArray(row.evidenceRefs),
  })).filter((row) => row.message);
  const queryFindings: TeamRoleFinding[] = arrayRecords(output.queries).map((row, index) => ({
    id: typeof row.id === "string" && row.id ? row.id : `${input.workflowId}:${input.roleId}:query:${index}`,
    workflowId: input.workflowId,
    roleId: input.roleId,
    segmentId: typeof row.segmentId === "string" ? row.segmentId : undefined,
    severity: findingSeverity(row.severity),
    type: "query" as const,
    message: queryMessage(row),
    evidenceRefs: stringArray(row.evidenceRefs),
  })).filter((row) => row.message);
  const findings = [...explicitFindings, ...queryFindings];
  const candidateTargetRows = arrayRecords(output.candidateTargets);
  const candidateAliasRows = arrayRecords(output.candidates);
  const candidateRows = candidateTargetRows.length ? candidateTargetRows : candidateAliasRows;
  const roleCandidateTargets: TeamCandidateTarget[] = candidateRows.map((row, index) => ({
    id: typeof row.id === "string" && row.id ? row.id : `${input.workflowId}:${input.roleId}:candidate:${index}`,
    workflowId: input.workflowId,
    segmentId: typeof row.segmentId === "string" ? row.segmentId : "",
    target: typeof row.target === "string" ? row.target : "",
    roleId: input.roleId,
    evidenceRefs: stringArray(row.evidenceRefs),
    function: typeof row.function === "string" ? row.function : undefined,
    notes: typeof row.notes === "string" ? row.notes : undefined,
  })).filter((row) => row.segmentId && row.target);
  const finalDecisionTargets: TeamCandidateTarget[] = input.roleId === "lead_linguist_final"
    ? arrayRecords(output.decisions).map((row, index) => ({
      id: typeof row.id === "string" && row.id ? `${row.id}:finalTarget` : `${input.workflowId}:${input.roleId}:final-target:${index}`,
      workflowId: input.workflowId,
      segmentId: typeof row.segmentId === "string" ? row.segmentId : "",
      target: typeof row.finalTarget === "string" ? row.finalTarget : "",
      roleId: input.roleId,
      evidenceRefs: stringArray(row.evidenceRefs),
    })).filter((row) => row.segmentId && row.target)
    : [];
  const candidateTargets: TeamCandidateTarget[] = [...roleCandidateTargets, ...finalDecisionTargets];
  const explicitDecisions: TeamDecision[] = arrayRecords(output.decisions).map((row, index) => ({
    id: typeof row.id === "string" && row.id ? row.id : `${input.workflowId}:${input.roleId}:decision:${index}`,
    workflowId: input.workflowId,
    segmentId: typeof row.segmentId === "string" ? row.segmentId : undefined,
    decision: teamDecision(row.decision),
    reason: typeof row.reason === "string" ? row.reason : "",
    findingIds: stringArray(row.findingIds),
    evidenceRefs: stringArray(row.evidenceRefs),
    decidedBy: "lead_linguist" as const,
  })).filter((row) => row.reason);
  const deliveryQa = deliveryQaReport(output.deliveryQa);
  const current = await readWorkflowArtifacts(input.repoRoot, input.projectId);
  const decisions = explicitDecisions.map((decision) => ({
    ...decision,
    findingIds: decision.findingIds.map((id) => canonicalFindingId(id, current)),
  }));
  const teamRoleArtifacts = roleObjectArtifacts({ workflowId: input.workflowId, roleId: input.roleId, output, summary });
  const artifactsWritten = findings.length > 0 || decisions.length > 0 || candidateTargets.length > 0 || teamRoleArtifacts.length > 0 || !!deliveryQa;
  // ponytail: brief/strategy/gate/pre-LQA objects count as valid until they get first-class artifact storage.
  const run = await readCatWorkflowRun(input.repoRoot, input.projectId, input.workflowId);
  const rejectionReason = roleOutputRejectionReason({
    roleId: input.roleId,
    output,
    summary,
    findings,
    candidateTargets,
    decisions,
    deliveryQa,
    knownFindingIds: knownWorkflowFindingIds({ workflowId: input.workflowId, batchId: run.batchId, artifacts: current, findings, deliveryQa }),
    knownFindingSegments: knownWorkflowFindingSegments({ workflowId: input.workflowId, batchId: run.batchId, artifacts: current, findings, deliveryQa }),
    expectedQaScope: { projectId: input.projectId, workflowId: input.workflowId, batchId: run.batchId },
  });
  if (rejectionReason) return { ok: false, reason: rejectionReason };
  const scopeRejectionReason = await scopedRoleOutputRejectionReason({
    repoRoot: input.repoRoot,
    projectId: input.projectId,
    run,
    output,
  });
  if (scopeRejectionReason) return { ok: false, reason: scopeRejectionReason };
  const engineeringGateBlockers = input.roleId === "loc_engineer_gate" ? blockedEngineeringGate(output) : [];
  const completedRolePass = summary ? { ...input.rolePass, summary } : input.rolePass;
  const blockingQueryFindings = queryFindings.filter(isBlockingTeamQuery);
  const waitingForUserAnswer = blockingQueryFindings.length > 0;
  const rolePassForLedger: TeamRolePass = engineeringGateBlockers.length
    ? {
      ...completedRolePass,
      status: "waiting",
      summary: `${completedRolePass.summary} Engineering gate blocked: ${engineeringGateBlockers.join("; ")}`,
    }
    : waitingForUserAnswer
      ? {
        ...completedRolePass,
        status: "waiting",
        summary: `${completedRolePass.summary} Waiting for user answer to ${blockingQueryFindings.length} Agent quer${blockingQueryFindings.length === 1 ? "y" : "ies"}.`,
      }
      : completedRolePass;
  if (run.batchId) {
    const existingQuality = workflowQualityLedgerFindings(run, current);
    await syncTeamQualityDecisionLedger(input.repoRoot, {
      projectId: input.projectId,
      batchId: run.batchId,
      workflowId: input.workflowId,
      teamFindings: uniqueById([...existingQuality.teamFindings, ...findings]),
      deliveryQaFindings: uniqueById([...existingQuality.deliveryQaFindings, ...(deliveryQa?.findings ?? [])]),
      decisions,
    });
  }
  await mutateWorkflowArtifacts(input.repoRoot, input.projectId, (latest) => {
    const teamRolePasses = latest.teamRolePasses.some((row) => row.workflowId === input.workflowId && row.roleId === input.roleId)
      ? latest.teamRolePasses.map((row) => row.workflowId === input.workflowId && row.roleId === input.roleId ? rolePassForLedger : row)
      : [...latest.teamRolePasses, rolePassForLedger];
    return {
      ...latest,
      teamRolePasses,
      teamFindings: uniqueById([...latest.teamFindings, ...findings]),
      teamDecisions: uniqueById([...latest.teamDecisions, ...decisions]),
      teamCandidateTargets: uniqueById([...latest.teamCandidateTargets, ...candidateTargets]),
      teamRoleArtifacts: uniqueById([...latest.teamRoleArtifacts, ...teamRoleArtifacts]),
      deliveryQaReports: deliveryQa ? uniqueByReportId([...latest.deliveryQaReports, deliveryQa]) : latest.deliveryQaReports,
    };
  });
  if (!engineeringGateBlockers.length && !waitingForUserAnswer && !run.completedStepIds.includes(input.roleId)) {
    await completeCatWorkflowStep(input.repoRoot, input.projectId, input.workflowId, input.roleId, `Completed team role ${input.roleId}.`);
  }
  return { ok: true, artifactsWritten };
}

async function runDeterministicEngineeringRole(input: {
  projectId: string;
  workflowId: string;
  deps: WorkflowRouteDeps;
}): Promise<{ status: number; data: unknown }> {
  const { projectId, workflowId, deps } = input;
  const gate = await runDeterministicTeamEngineeringGate(deps.repoRoot, { projectId, workflowId });
  const timestamp = gate.artifact.createdAt;
  const pass: TeamRolePass = {
    workflowId,
    roleId: "loc_engineer_gate",
    status: gate.ready ? "completed" : "waiting",
    sessionId: teamRoleSessionId(workflowId, "loc_engineer_gate"),
    modelProvider: "system",
    modelId: "cat-kernel",
    startedAt: timestamp,
    ...(gate.ready ? { completedAt: timestamp } : {}),
    inputArtifactRefs: [`deterministic-cat-scope:${workflowId}`],
    outputArtifactRefs: [gate.artifact.id],
    summary: gate.artifact.summary ?? (gate.ready ? "Deterministic engineering gate passed." : "Deterministic engineering gate blocked."),
    transcriptRef: `artifact:${gate.artifact.id}`,
  };
  const artifacts = await mutateWorkflowArtifacts(deps.repoRoot, projectId, (current) => ({
    ...current,
    teamRolePasses: current.teamRolePasses.some((row) => row.workflowId === workflowId && row.roleId === "loc_engineer_gate")
      ? current.teamRolePasses.map((row) => row.workflowId === workflowId && row.roleId === "loc_engineer_gate" ? pass : row)
      : [...current.teamRolePasses, pass],
    teamRoleArtifacts: uniqueById([...current.teamRoleArtifacts, gate.artifact]),
  }));
  if (gate.ready) {
    const run = await readCatWorkflowRun(deps.repoRoot, projectId, workflowId);
    if (!run.completedStepIds.includes("loc_engineer_gate")) {
      await completeCatWorkflowStep(deps.repoRoot, projectId, workflowId, "loc_engineer_gate", "Deterministic localization engineering gate passed.");
    }
  }
  await projectTeamRolePass(projectId, workflowId, "loc_engineer_gate", pass, deps);
  return { status: gate.ready ? 200 : 409, data: artifacts };
}

async function runDeterministicDeliveryRole(input: {
  projectId: string;
  workflowId: string;
  deps: WorkflowRouteDeps;
}): Promise<{ status: number; data: unknown }> {
  const { projectId, workflowId, deps } = input;
  const gate = await runTeamDeliveryGate(deps.repoRoot, { projectId, workflowId });
  const artifactId = `${workflowId}:delivery-gate`;
  const pass: TeamRolePass = {
    workflowId,
    roleId: "delivery_manager",
    status: "completed",
    sessionId: teamRoleSessionId(workflowId, "delivery_manager"),
    modelProvider: "system",
    modelId: "cat-kernel",
    startedAt: gate.checkedAt,
    completedAt: gate.checkedAt,
    inputArtifactRefs: [`deterministic-delivery-scope:${workflowId}`],
    outputArtifactRefs: [artifactId, `delivery-qa:${gate.rawQa.reportId}`],
    summary: gate.authorization.authorized
      ? "Deterministic Delivery gate completed and export is authorized."
      : `Deterministic Delivery gate completed; export remains blocked by ${gate.authorization.blockers.length} blocker(s) and ${gate.authorization.unreviewedFindingIds.length} unreviewed finding(s).`,
    transcriptRef: `artifact:${artifactId}`,
  };
  const artifacts = await mutateWorkflowArtifacts(deps.repoRoot, projectId, (current) => ({
    ...current,
    teamRolePasses: current.teamRolePasses.some((row) => row.workflowId === workflowId && row.roleId === "delivery_manager")
      ? current.teamRolePasses.map((row) => row.workflowId === workflowId && row.roleId === "delivery_manager" ? pass : row)
      : [...current.teamRolePasses, pass],
  }));
  const run = await readCatWorkflowRun(deps.repoRoot, projectId, workflowId);
  if (!run.completedStepIds.includes("delivery_manager")) {
    await completeCatWorkflowStep(deps.repoRoot, projectId, workflowId, "delivery_manager", "Deterministic Delivery gate completed.");
  }
  await projectTeamRolePass(projectId, workflowId, "delivery_manager", pass, deps);
  return { status: 200, data: artifacts };
}

async function runTeamRole(input: {
  projectId: string;
  workflowId: string;
  roleId: TeamRoleId;
  body: Record<string, unknown>;
  deps: WorkflowRouteDeps;
}): Promise<{ status: number; data: unknown }> {
  const { projectId, workflowId, roleId, body, deps } = input;
  if (roleId === "loc_engineer_gate" && deps.optionalBoolean(body.execute) === true) {
    return runDeterministicEngineeringRole({ projectId, workflowId, deps });
  }
  if (roleId === "delivery_manager" && deps.optionalBoolean(body.execute) === true) {
    return runDeterministicDeliveryRole({ projectId, workflowId, deps });
  }
  const profile = (await readEffectiveTeamRoleSettings(projectId, deps)).profiles.find((row) => row.roleId === roleId);
  const modelProvider = deps.optionalString(body.modelProvider) ?? profile?.provider;
  const modelId = deps.optionalString(body.modelId) ?? profile?.modelId;
  const forbiddenContextFields = ["task", "hardConstraints", "evidence", "styleGuideRules", "transcript", "includeTranscript", "tokenBudget", "inputArtifactRefs", "contextManifestRef"]
    .filter((field) => Object.prototype.hasOwnProperty.call(body, field));
  if (forbiddenContextFields.length) {
    throw new Error(`Team role context is server-authored; remove: ${forbiddenContextFields.join(", ")}.`);
  }
  const requestBudget = await deps.resolveModelPromptTokenBudget?.(modelProvider, modelId);
  const context = await prepareTeamRoleContext(deps.repoRoot, {
    projectId,
    workflowId,
    roleId,
    requestBudget,
    estimateToolSchemaTokens: workflowApplicationPort.estimateTeamToolSchemaTokens,
  });
  if (context.status === "blocked") {
    return { status: 409, data: { workflowId, roleId, status: "blocked", blockers: context.blockers, contextManifest: context.manifest } };
  }
  const prepared = await workflowApplicationPort.prepareTeamRoleRun({
    repoRoot: deps.repoRoot,
    projectId,
    workflowId,
    roleId,
    evidenceScope: context.evidenceScope,
    task: context.prompt,
    modelProvider,
    modelId,
    thinking: profile?.thinking,
    inputArtifactRefs: context.inputArtifactRefs,
    outputArtifactRefs: deps.optionalStringArray(body.outputArtifactRefs) ?? [],
    contextManifest: context.manifest,
  });
  let artifacts = await upsertTeamRolePass(deps.repoRoot, projectId, prepared.rolePass);
  await projectTeamRolePass(projectId, workflowId, roleId, prepared.rolePass, deps);
  if (deps.optionalBoolean(body.execute)) {
    if (!deps.spawnSubagentRun) throw new Error("run-role execute requires the server-owned Team child adapter.");
    const startedAfter = Date.now() - 5_000;
    const spawned = await deps.spawnSubagentRun(projectId, workflowId, roleId, prepared.rolePass.subagentSpawnRequest!);
    const asyncDir = extractSubagentAsyncDir(spawned);
    let latest = asyncDir
      ? await buildRolePassFromSubagentStatus({
          workflowId,
          roleId,
          sessionId: prepared.rolePass.sessionId,
          asyncDir,
          inputArtifactRefs: prepared.rolePass.inputArtifactRefs,
          outputArtifactRefs: prepared.rolePass.outputArtifactRefs,
          contextManifestRef: prepared.rolePass.contextManifestRef,
          contextManifest: prepared.rolePass.contextManifest,
          transcriptRef: prepared.rolePass.transcriptRef,
        }).catch(() => undefined)
      : undefined;
    if (!latest) {
      await sleep(750);
      const [row] = await listSubagentAsyncStatuses({ sinceMs: startedAfter, agent: workflowApplicationPort.roleAgentName(roleId) });
      if (row) {
        latest = await buildRolePassFromSubagentStatus({
          workflowId,
          roleId,
          sessionId: prepared.rolePass.sessionId,
          subagentRunId: row.status.runId,
          inputArtifactRefs: prepared.rolePass.inputArtifactRefs,
          outputArtifactRefs: prepared.rolePass.outputArtifactRefs,
          contextManifestRef: prepared.rolePass.contextManifestRef,
          contextManifest: prepared.rolePass.contextManifest,
          transcriptRef: prepared.rolePass.transcriptRef,
        });
      }
    }
    artifacts = await upsertTeamRolePass(deps.repoRoot, projectId, latest ? latest.rolePass : {
      ...prepared.rolePass,
      summary: [
        `Executed parent project-agent turn for ${prepared.rolePass.subagentSpawnRequest!.params.agent}.`,
        "No matching Team child async status was found, so the role remains waiting.",
        "Check the parent transcript and canonical Run activity for a blocked or failed child launch.",
      ].join(" "),
    });
    if (latest) {
      const ingest = await ingestCompletedRoleOutput({
        projectId,
        workflowId,
        roleId,
        rolePass: latest.rolePass,
        asyncDir: latest.asyncDir,
        statusOutputFile: latest.status.outputFile,
        repoRoot: deps.repoRoot,
      });
      if (!ingest.ok) await upsertTeamRolePass(deps.repoRoot, projectId, invalidRoleOutputPass(latest.rolePass, ingest.reason));
      if (latest.status.state === "complete" || latest.status.state === "failed") {
        deps.completeActiveRuns?.({ projectId, workflowId, roleId, subagentRunId: latest.status.runId }, latest.status.error);
      }
      artifacts = await readWorkflowArtifacts(deps.repoRoot, projectId);
    }
  }
  const projectedPass = artifacts.teamRolePasses.find((row) => row.workflowId === workflowId && row.roleId === roleId);
  if (projectedPass) await projectTeamRolePass(projectId, workflowId, roleId, projectedPass, deps);
  return { status: prepared.httpStatus, data: artifacts };
}

// A stopped role is intentionally resumable. Treating it as terminal silently
// skipped the interrupted specialist and advanced the Team graph to the next
// role when the user pressed Resume.
const TERMINAL_ROLE_STATUSES = new Set(["completed", "skipped"]);
const TERMINAL_TEAM_WORKFLOW_STATUSES = new Set(["completed", "cancelled", "stopping", "stopped", "failed"]);

function mergeTeamRoleProfiles(base: TeamRoleProfile[], overrides: TeamRoleSettings | undefined): TeamRoleProfile[] {
  const byRole = new Map((overrides?.profiles ?? []).map((profile) => [profile.roleId, profile]));
  const merged = base.map((profile) => ({ ...profile, ...(byRole.get(profile.roleId) ?? {}) }));
  const seen = new Set(merged.map((profile) => profile.roleId));
  for (const profile of overrides?.profiles ?? []) {
    if (!seen.has(profile.roleId)) merged.push(profile);
  }
  return merged;
}

async function readEffectiveTeamRoleSettings(projectId: string, deps: WorkflowRouteDeps): Promise<TeamRoleSettings> {
  const global = await readTeamRoleSettings(deps.repoRoot);
  const project = deps.readProjectAgentSettings ? (await deps.readProjectAgentSettings(projectId)).teamRoleSettings : undefined;
  const projectRoles = new Set((project?.profiles ?? []).map((profile) => profile.roleId));
  return {
    profiles: mergeTeamRoleProfiles(global.profiles, project),
    source: {
      scope: projectRoles.size ? "project" : "global",
      globalConfigured: true,
      projectConfigured: projectRoles.size > 0,
    },
    profileSources: Object.fromEntries(TEAM_ROLE_IDS.map((roleId) => [roleId, projectRoles.has(roleId) ? "project" : "global"])),
  };
}

async function buildWorkflowTeamRunPlan(
  projectId: string,
  workflowId: string,
  deps: WorkflowRouteDeps,
  forceAllRoles = false,
) {
  const run = await readCatWorkflowRun(deps.repoRoot, projectId, workflowId);
  const artifacts = await readWorkflowArtifacts(deps.repoRoot, projectId);
  const batch = run.batchId ? await readBatch(deps.repoRoot, projectId, run.batchId).catch(() => undefined) : undefined;
  const pendingSegments = batch?.segments.filter((segment) => !segment.target.trim() && !segment.locked).length ?? 0;
  const profiles = await readEffectiveTeamRoleSettings(projectId, deps);
  const engineeringGate = await runDeterministicTeamEngineeringGate(deps.repoRoot, { projectId, workflowId });
  let packageBlockers: string[] = [];
  if (run.taskId && deps.readTaskPackageRunResources) {
    try {
      const packageResources = await deps.readTaskPackageRunResources(projectId, run.taskId);
      packageBlockers = await teamPackagePreflightBlockers(packageResources.resolvedResources);
    } catch (error) {
      packageBlockers = [`Task Package profile cannot run in Team: ${error instanceof Error ? error.message : String(error)}`];
    }
  }
  return buildTeamRunPlan({
    projectId,
    workflowId,
    batchId: run.batchId,
    forceAllRoles,
    hasBrief: artifacts.teamRoleArtifacts.some((artifact) => artifact.workflowId === workflowId && artifact.type === "brief"),
    hasStrategy: artifacts.teamRoleArtifacts.some((artifact) => artifact.workflowId === workflowId && artifact.type === "strategy"),
    pendingSegments,
    hasCandidates: artifacts.teamCandidateTargets.some((candidate) => candidate.workflowId === workflowId),
    hasFindings: artifacts.teamFindings.some((finding) => finding.workflowId === workflowId),
    hasQueries: artifacts.teamFindings.some((finding) => finding.workflowId === workflowId && isBlockingTeamQuery(finding)),
    hasAttachments: artifacts.workbookPreviews.length > 0 || artifacts.assetConflictDecisions.length > 0,
    blockers: [
      ...(engineeringGate.ready ? [] : engineeringGate.blockers),
      ...packageBlockers,
    ],
    notes: engineeringGate.warnings,
    profiles: profiles.profiles,
  });
}

export async function preflightTeamWorkflowRun(input: {
  projectId: string;
  workflowId: string;
  forceAllRoles?: boolean;
  project?: boolean;
  deps: WorkflowRouteDeps;
}) {
  const plan = await buildWorkflowTeamRunPlan(input.projectId, input.workflowId, input.deps, input.forceAllRoles === true);
  if (input.project !== false) await projectTeamPreflight(input.projectId, input.workflowId, plan, input.deps);
  return plan;
}

export interface PreparedTeamExecution {
  taskId: string;
  runId: string;
  decisionId: string;
  status: "awaiting_input" | "waiting";
  planHash: string;
}

/**
 * Promote the current Main Run into the existing canonical Team workflow.
 * Reusing the Run is required because a Task cannot own two nonterminal Runs.
 */
export async function prepareTeamExecution(input: {
  projectId: string;
  taskId: string;
  runId: string;
  reason: string;
  deps: WorkflowRouteDeps;
}): Promise<PreparedTeamExecution> {
  const reason = input.reason.trim();
  if (!reason) throw new Error("prepare_team_execution reason is required.");
  if (reason.length > 1_200) throw new Error("prepare_team_execution reason must be 1200 characters or fewer.");

  const taskWorkspace = createTaskWorkspace(input.deps.repoRoot);
  const snapshot = await taskWorkspace.open({ projectId: input.projectId, taskId: input.taskId });
  const taskScope = requireProjectTaskScope(snapshot.task.scope, "Team Task");
  const run = snapshot.runs.find((row) => row.id === input.runId);
  if (!run) throw new Error(`Run ${input.runId} does not belong to Task ${input.taskId}.`);
  const batchId = taskScope.batchId;
  if (!batchId) throw new Error(`Task ${input.taskId} must have a Batch before Team execution can be prepared.`);

  let workflow: CatWorkflowRun | undefined;
  try {
    workflow = await readCatWorkflowRun(input.deps.repoRoot, input.projectId, input.runId);
  } catch (error) {
    if (!(error instanceof Error) || !error.message.includes("not found")) throw error;
  }
  if (workflow) {
    if (workflow.taskId !== input.taskId || workflow.batchId !== batchId || workflow.plan.intent !== "game_localization_team_run") {
      throw new Error(`Run ${input.runId} is already mapped to a different canonical Workflow scope.`);
    }
  }

  if (run.mode === "team" && (run.status === "awaiting_input" || run.status === "waiting")) {
    const decisionId = run.planHash ? `${run.id}.start.${run.planHash.slice(0, 16)}` : undefined;
    const decision = decisionId ? snapshot.decisions.find((row) => row.id === decisionId && row.runId === run.id && row.status === "required") : undefined;
    if (!workflow || !run.planHash || !decision) throw new Error(`Pending Team Run ${run.id} has no complete canonical proposal.`);
    return { taskId: input.taskId, runId: run.id, decisionId: decision.id, status: run.status, planHash: run.planHash };
  }
  if (run.mode !== "single" || run.status !== "active") {
    throw new Error(`Run ${input.runId} cannot prepare Team execution from ${run.mode}/${run.status}.`);
  }

  if (!workflow) {
    const created = await createCatWorkflowRun(input.deps.repoRoot, {
      projectId: input.projectId,
      taskId: input.taskId,
      batchId,
      workflowId: input.runId,
      intent: "game_localization_team_run",
      userRequest: reason,
      includeReadiness: true,
    });
    await projectCreatedWorkflowTask(created.run, input.deps);
  }

  const plan = await preflightTeamWorkflowRun({
    projectId: input.projectId,
    workflowId: input.runId,
    deps: input.deps,
  });
  const current = await taskWorkspace.open({ projectId: input.projectId, taskId: input.taskId });
  const projectedRun = current.runs.find((row) => row.id === input.runId);
  const decisionId = `${input.runId}.start.${plan.planHash.slice(0, 16)}`;
  if (!projectedRun || (projectedRun.status !== "awaiting_input" && projectedRun.status !== "waiting")) {
    throw new Error(`Team preflight did not leave Run ${input.runId} waiting for a canonical Decision.`);
  }
  if (!current.decisions.some((decision) => decision.id === decisionId && decision.status === "required")) {
    throw new Error(`Team preflight did not create required Decision ${decisionId}.`);
  }
  return {
    taskId: input.taskId,
    runId: input.runId,
    decisionId,
    status: projectedRun.status,
    planHash: plan.planHash,
  };
}

function teamEstimatedCallsBySource(run: TaskRun, plan: TeamRunPlan): Record<string, number> {
  const previous = run.estimatedCallsBySource
    ?? (run.mode === "single" && run.estimatedCalls != null ? { main: run.estimatedCalls } : {});
  return {
    ...Object.fromEntries(Object.entries(previous).filter(([source]) => !source.startsWith("specialist:"))),
    ...Object.fromEntries(plan.roles
      .filter((role) => role.enabled)
      .map((role) => [`specialist:${role.roleId}`, role.estimatedCalls])),
  };
}

async function projectTeamPreflight(
  projectId: string,
  workflowId: string,
  plan: Awaited<ReturnType<typeof buildWorkflowTeamRunPlan>>,
  deps: WorkflowRouteDeps,
): Promise<void> {
  const workflow = await readCatWorkflowRun(deps.repoRoot, projectId, workflowId);
  if (!workflow.taskId) return;
  const workspace = createTaskWorkspace(deps.repoRoot);
  const snapshot = await workspace.open({ projectId, taskId: workflow.taskId });
  const taskScope = requireProjectTaskScope(snapshot.task.scope, "Team Task");
  const taskRun = snapshot.runs.find((run) => run.id === workflowId);
  const mainThread = snapshot.agentThreads.find((thread) => thread.id === `${workflowId}.main`);
  if (!taskRun || !mainThread) return;
  const planKey = plan.planHash.slice(0, 16);
  const activityId = `${workflowId}.preflight.${planKey}`;
  const decisionId = `${workflowId}.start.${planKey}`;
  const existingDecision = snapshot.decisions.find((decision) => decision.id === decisionId);
  const now = plan.createdAt;
  const roleIsActive = (await readWorkflowArtifacts(deps.repoRoot, projectId)).teamRolePasses.some(
    (role) => role.workflowId === workflowId && ["queued", "running", "stopping"].includes(role.status),
  );
  const preserveActiveState = workflow.status === "in_progress" || workflow.status === "stopping" || roleIsActive;
  const preflightStatus = preserveActiveState ? taskRun.status : plan.readiness.status === "blocked" ? "waiting" : "awaiting_input";
  const selectedRoles = plan.roles.filter((role) => role.enabled);
  const roleThreadIds = selectedRoles.map((role) => `${workflowId}.${role.roleId}`);
  const estimatedCallsBySource = teamEstimatedCallsBySource(taskRun, plan);
  const events: TaskRunEventDraft[] = [
    {
      type: "run_upsert",
      agentThreadId: mainThread.id,
      run: {
        ...taskRun,
        mode: "team",
        status: preflightStatus,
        planHash: plan.planHash,
        estimatedCalls: Object.values(estimatedCallsBySource).reduce((sum, calls) => sum + calls, 0),
        estimatedCallsBySource,
        modelRoutes: plan.modelRoutes,
        updatedAt: now,
        stopAvailable: preserveActiveState ? taskRun.stopAvailable : false,
        resumeAvailable: preserveActiveState ? taskRun.resumeAvailable : plan.readiness.status === "ready",
      },
    },
    {
      type: "thread_upsert",
      agentThreadId: mainThread.id,
      thread: {
        ...mainThread,
        status: preflightStatus,
        childThreadIds: Array.from(new Set([...mainThread.childThreadIds, ...roleThreadIds])),
        updatedAt: now,
      },
    },
    ...selectedRoles.map((role): TaskRunEventDraft => {
      const threadId = `${workflowId}.${role.roleId}`;
      const acknowledgementId = `${threadId}.preflight.${planKey}`;
      const existingThread = snapshot.agentThreads.find((thread) => thread.id === threadId);
      const deterministicRole = DETERMINISTIC_TEAM_ROLE_IDS.has(role.roleId);
      return {
        type: "thread_upsert",
        agentThreadId: threadId,
        thread: {
          id: threadId,
          taskId: workflow.taskId!,
          runId: workflowId,
          parentThreadId: mainThread.id,
          identity: {
            kind: deterministicRole ? "deterministic" : "specialist",
            roleId: role.roleId,
            displayName: teamRoleDisplayName(role.roleId),
            roleLabel: teamRoleDisplayName(role.roleId),
            disclosureLabel: deterministicRole ? "System" : "Agent",
          },
          status: existingThread?.status ?? "waiting",
          canReceiveUserMessage: !deterministicRole,
          handoffSummary: existingThread?.handoffSummary ?? role.reason,
          latestActivityId: existingThread?.latestActivityId ?? acknowledgementId,
          childThreadIds: existingThread?.childThreadIds ?? [],
          createdAt: existingThread?.createdAt ?? now,
          updatedAt: now,
        },
      };
    }),
    ...selectedRoles.flatMap((role): TaskRunEventDraft[] => {
      const threadId = `${workflowId}.${role.roleId}`;
      const acknowledgementId = `${threadId}.preflight.${planKey}`;
      if (snapshot.activities.some((activity) => activity.id === acknowledgementId)) return [];
      const deterministicRole = DETERMINISTIC_TEAM_ROLE_IDS.has(role.roleId);
      const nextSeq = Math.max(0, ...snapshot.activities.filter((activity) => activity.agentThreadId === threadId).map((activity) => activity.seq)) + 1;
      const executionNote = deterministicRole
        ? "Deterministic CAT gate; no model call."
        : `Planned model route: ${role.modelRoute ?? "active project default"}; estimated calls: ${role.estimatedCalls}.`;
      return [{
        type: "activity_append",
        agentThreadId: threadId,
        activity: {
          id: acknowledgementId,
          taskId: workflow.taskId!,
          runId: workflowId,
          agentThreadId: threadId,
          seq: nextSeq,
          type: "acknowledgement",
          status: "pending",
          actor: {
            kind: deterministicRole ? "system" : "agent",
            id: role.roleId,
            displayName: teamRoleDisplayName(role.roleId),
            agentThreadId: threadId,
          },
          title: "Selected for Team run",
          body: `${role.reason}\n${executionNote}\nWaiting for Team plan confirmation.`,
          tool: null,
          refs: { artifactIds: [], evidenceRefs: [], decisionIds: [decisionId] },
          createdAt: now,
          updatedAt: now,
        },
      }];
    }),
    {
      type: "decision_upsert",
      agentThreadId: mainThread.id,
      decision: existingDecision ?? bindTaskDecision({
        id: decisionId,
        taskId: workflow.taskId,
        runId: workflowId,
        requestedByThreadId: mainThread.id,
        artifactId: null,
        kind: "approval",
        status: "required",
        prompt: plan.readiness.status === "blocked" ? plan.readiness.blockers.join("\n") : `Start ${plan.selectedRoleIds.length} selected Team roles?`,
        options: [
          { id: "start", label: "Start", action: "approve", destructive: false },
          { id: "change", label: "Change plan", action: "request_change", destructive: false },
        ],
        selectedOptionId: null,
        reason: null,
        scope: taskScope,
        // The Decision id is deterministic for a plan hash. Concurrent
        // preflight requests must therefore use a deterministic creation time
        // as well, otherwise the second idempotent upsert looks like a changed
        // canonical definition.
        createdAt: mainThread.createdAt,
        decidedAt: null,
      }, { runPlanHash: plan.planHash }),
    },
  ];
  if (!snapshot.activities.some((activity) => activity.id === activityId)) {
    const roleLines = plan.roles
      .filter((role) => role.enabled)
      .map((role) => `${teamRoleDisplayName(role.roleId)} — ${role.reason}`);
    events.push({
      type: "activity_append",
      agentThreadId: mainThread.id,
      activity: {
        id: activityId,
        taskId: workflow.taskId,
        runId: workflowId,
        agentThreadId: mainThread.id,
        seq: Math.max(0, ...snapshot.activities.filter((activity) => activity.runId === workflowId).map((activity) => activity.seq)) + 1,
        type: "plan",
        status: plan.readiness.status === "blocked" ? "blocked" : "done",
        actor: { kind: "agent", id: "linguist-agent", displayName: "Linguist Agent", agentThreadId: mainThread.id },
        title: "Team preflight",
        body: [
          workflow.plan.userRequest ? `Main requested Team: ${workflow.plan.userRequest}` : undefined,
          ...plan.readiness.notes,
          ...plan.readiness.blockers,
          ...roleLines,
        ].filter((line): line is string => Boolean(line)).join("\n"),
        tool: null,
        refs: { artifactIds: [], evidenceRefs: [], decisionIds: [decisionId] },
        createdAt: now,
        updatedAt: now,
      },
    });
  }
  await workspace.appendGenerated({ projectId, taskId: workflow.taskId, runId: workflowId, events });
}

async function projectTeamStart(
  projectId: string,
  workflowId: string,
  plan: Awaited<ReturnType<typeof buildWorkflowTeamRunPlan>>,
  deps: WorkflowRouteDeps,
): Promise<void> {
  const workflow = await readCatWorkflowRun(deps.repoRoot, projectId, workflowId);
  if (!workflow.taskId) return;
  await projectTeamPreflight(projectId, workflowId, plan, deps);
  const workspace = createTaskWorkspace(deps.repoRoot);
  const snapshot = await workspace.open({ projectId, taskId: workflow.taskId });
  const taskRun = snapshot.runs.find((run) => run.id === workflowId);
  const mainThread = snapshot.agentThreads.find((thread) => thread.id === `${workflowId}.main`);
  if (!taskRun || !mainThread) return;
  const planKey = plan.planHash.slice(0, 16);
  const decisionId = `${workflowId}.start.${planKey}`;
  const decision = snapshot.decisions.find((row) => row.id === decisionId);
  const activityId = `${workflowId}.started.${planKey}`;
  const now = new Date().toISOString();
  const estimatedCallsBySource = teamEstimatedCallsBySource(taskRun, plan);
  const events: TaskRunEventDraft[] = [
    {
      type: "run_upsert",
      agentThreadId: mainThread.id,
      run: {
        ...taskRun,
        status: "active",
        planHash: plan.planHash,
        estimatedCalls: Object.values(estimatedCallsBySource).reduce((sum, calls) => sum + calls, 0),
        estimatedCallsBySource,
        modelRoutes: plan.modelRoutes,
        startedAt: taskRun.startedAt ?? now,
        updatedAt: now,
        stopAvailable: true,
        resumeAvailable: false,
      },
    },
    {
      type: "thread_upsert",
      agentThreadId: mainThread.id,
      thread: { ...mainThread, status: "active", updatedAt: now },
    },
  ];
  if (decision) {
    events.push({
      type: "decision_upsert",
      agentThreadId: mainThread.id,
      decision: { ...decision, status: "recorded", selectedOptionId: "start", reason: "User confirmed the current Team preflight plan.", decidedAt: now },
    });
  }
  if (!snapshot.activities.some((activity) => activity.id === activityId)) {
    events.push({
      type: "activity_append",
      agentThreadId: mainThread.id,
      activity: {
        id: activityId,
        taskId: workflow.taskId,
        runId: workflowId,
        agentThreadId: mainThread.id,
        seq: Math.max(0, ...snapshot.activities.filter((activity) => activity.runId === workflowId).map((activity) => activity.seq)) + 1,
        type: "progress",
        status: "running",
        actor: { kind: "agent", id: "linguist-agent", displayName: "Linguist Agent", agentThreadId: mainThread.id },
        title: "Team run started",
        body: plan.selectedRoleIds.map(teamRoleDisplayName).join(" → "),
        tool: null,
        refs: { artifactIds: [], evidenceRefs: [], decisionIds: decision ? [decisionId] : [] },
        createdAt: now,
        updatedAt: now,
      },
    });
  }
  await workspace.appendGenerated({ projectId, taskId: workflow.taskId, runId: workflowId, events });
  await writeJsonFile(workflowRunPath(deps.repoRoot, projectId, workflowId), {
    ...workflow,
    status: "in_progress",
    updatedAt: now,
  });
}

async function projectTeamWorkflowOutcome(
  projectId: string,
  workflowId: string,
  outcome: "completed" | "blocked" | "failed",
  message: string,
  deps: WorkflowRouteDeps,
): Promise<void> {
  const workflow = await readCatWorkflowRun(deps.repoRoot, projectId, workflowId);
  const now = new Date().toISOString();
  const { currentStepId: _currentStepId, ...withoutCurrentStep } = workflow;
  await writeJsonFile(workflowRunPath(deps.repoRoot, projectId, workflowId), {
    ...withoutCurrentStep,
    ...(outcome === "completed" ? {} : { currentStepId: workflow.currentStepId }),
    status: outcome,
    updatedAt: now,
    history: [...workflow.history, {
      ts: now,
      kind: outcome === "completed" ? "completed" : outcome === "failed" ? "failed" : "note",
      message,
    }],
  });
  if (!workflow.taskId) return;
  const workspace = createTaskWorkspace(deps.repoRoot);
  const snapshot = await workspace.open({ projectId, taskId: workflow.taskId });
  const taskRun = snapshot.runs.find((run) => run.id === workflowId);
  const mainThread = snapshot.agentThreads.find((thread) => thread.id === `${workflowId}.main`);
  if (!taskRun || !mainThread) return;
  const taskStatus = outcome === "completed" ? "complete" : outcome === "failed" ? "failed" : "awaiting_input";
  await workspace.appendGenerated({
    projectId,
    taskId: workflow.taskId,
    runId: workflowId,
    events: [
      {
        type: "run_upsert",
        agentThreadId: mainThread.id,
        run: {
          ...taskRun,
          status: taskStatus,
          updatedAt: now,
          completedAt: outcome === "completed" ? now : taskRun.completedAt,
          stopAvailable: false,
          resumeAvailable: outcome !== "completed",
        },
      },
      {
        type: "thread_upsert",
        agentThreadId: mainThread.id,
        thread: { ...mainThread, status: taskStatus, updatedAt: now },
      },
      {
        type: "activity_append",
        agentThreadId: mainThread.id,
        activity: {
          id: `${workflowId}.${outcome}.${Date.now()}`,
          taskId: workflow.taskId,
          runId: workflowId,
          agentThreadId: mainThread.id,
          seq: 0,
          type: outcome === "completed" ? "final_response" : outcome === "failed" ? "error" : "elicitation",
          status: outcome === "completed" ? "done" : outcome === "failed" ? "error" : "pending",
          actor: { kind: "agent", id: "linguist-agent", displayName: "Linguist Agent", agentThreadId: mainThread.id },
          title: outcome === "completed" ? "Team run completed" : outcome === "failed" ? "Team run failed" : "Team run paused",
          body: message,
          tool: null,
          refs: { artifactIds: [], evidenceRefs: [], decisionIds: [] },
          createdAt: now,
          updatedAt: now,
        },
      },
    ],
  });
}

async function projectTeamRolePass(
  projectId: string,
  workflowId: string,
  roleId: TeamRoleId,
  pass: TeamRolePass,
  deps: WorkflowRouteDeps,
): Promise<void> {
  await deps.onTeamRolePass?.({ projectId, workflowId, roleId, pass });
  const workflow = await readCatWorkflowRun(deps.repoRoot, projectId, workflowId);
  if (!workflow.taskId) return;
  const workspace = createTaskWorkspace(deps.repoRoot);
  const snapshot = await workspace.open({ projectId, taskId: workflow.taskId });
  const mainThread = snapshot.agentThreads.find((thread) => thread.id === `${workflowId}.main`);
  if (!mainThread) return;
  const threadId = `${workflowId}.${roleId}`;
  const now = pass.completedAt ?? pass.startedAt ?? new Date().toISOString();
  const status = ({
    queued: "active",
    running: "active",
    waiting: "waiting",
    stopping: "stopping",
    stopped: "stopped",
    failed: "failed",
    completed: "complete",
    skipped: "complete",
  } as const)[pass.status];
  const existingThread = snapshot.agentThreads.find((thread) => thread.id === threadId);
  const deterministicRole = DETERMINISTIC_TEAM_ROLE_IDS.has(roleId);
  const activityId = `${threadId}.${pass.status}.${pass.subagentRunId ?? pass.startedAt ?? "prepared"}`.replace(/[^A-Za-z0-9._-]+/g, "-");
  const firstActivitySeq = Math.max(0, ...snapshot.activities.filter((activity) => activity.runId === workflowId).map((activity) => activity.seq)) + 1;
  const contextKey = pass.contextManifest?.contextHash ?? pass.contextManifest?.policyHash;
  const contextActivityId = contextKey ? `${threadId}.context.${contextKey.slice(0, 16)}` : undefined;
  const contextArtifactId = contextKey ? `team-context:${workflowId}:${roleId}:${contextKey.slice(0, 16)}` : undefined;
  const shouldProjectContext = Boolean(contextActivityId && contextArtifactId && !snapshot.activities.some((activity) => activity.id === contextActivityId));
  const traceEvents = pass.subagentAsyncDir && pass.subagentRunId
    ? await workflowApplicationPort.readTaskActivityDrafts({
        asyncDir: pass.subagentAsyncDir,
        subagentRunId: pass.subagentRunId,
        taskId: workflow.taskId,
        runId: workflowId,
        agentThreadId: threadId,
        roleId,
        displayName: teamRoleDisplayName(roleId),
        existingActivityIds: snapshot.activities.map((activity) => activity.id),
        firstSeq: firstActivitySeq + (shouldProjectContext ? 1 : 0),
        fallbackTimestamp: now,
      })
    : [];
  const taskRun = snapshot.runs.find((run) => run.id === workflowId);
  const usageSource = `specialist:${roleId}`;
  const totalTokens = pass.usage?.totalTokens
    ?? (pass.usage?.inputTokens !== undefined || pass.usage?.outputTokens !== undefined
      ? (pass.usage.inputTokens ?? 0) + (pass.usage.outputTokens ?? 0)
      : undefined);
  const taskUsage = pass.usage ? {
    inputTokens: pass.usage.inputTokens,
    cacheReadTokens: pass.usage.cacheReadTokens,
    cacheWriteTokens: pass.usage.cacheWriteTokens,
    outputTokens: pass.usage.outputTokens,
    totalTokens,
    costUSD: pass.usage.costUsd,
    modelCalls: deterministicRole ? 0 : pass.subagentRunId ? 1 : 0,
  } : undefined;
  const events: TaskRunEventDraft[] = [
    {
      type: "thread_upsert",
      agentThreadId: mainThread.id,
      thread: {
        ...mainThread,
        childThreadIds: Array.from(new Set([...mainThread.childThreadIds, threadId])),
        updatedAt: now,
      },
    },
    {
      type: "thread_upsert",
      agentThreadId: threadId,
      thread: {
        id: threadId,
        taskId: workflow.taskId,
        runId: workflowId,
        parentThreadId: mainThread.id,
        identity: {
          kind: deterministicRole ? "deterministic" : "specialist",
          roleId,
          displayName: teamRoleDisplayName(roleId),
          roleLabel: teamRoleDisplayName(roleId),
          disclosureLabel: deterministicRole ? "System" : "Agent",
        },
        status,
        canReceiveUserMessage: !deterministicRole,
        handoffSummary: status === "complete" ? pass.summary : existingThread?.handoffSummary ?? null,
        latestActivityId: existingThread?.latestActivityId ?? null,
        childThreadIds: [],
        createdAt: existingThread?.createdAt ?? now,
        updatedAt: now,
      },
    },
    ...(shouldProjectContext && contextActivityId && contextArtifactId ? [
      {
        type: "artifact_upsert" as const,
        agentThreadId: threadId,
        artifact: {
          id: contextArtifactId,
          taskId: workflow.taskId,
          runId: workflowId,
          type: "evidence_pack" as const,
          status: "final" as const,
          title: `${teamRoleDisplayName(roleId)} context`,
          summary: pass.contextManifest?.coverage
            ? `${pass.contextManifest.coverage.taskSegments}/${pass.contextManifest.coverage.batchSegments} segment(s) scoped${pass.contextManifest.coverage.requiresPaging ? "; paged CAT reads required" : ""}.`
            : "Server-authored scoped CAT context.",
          scope: snapshot.task.scope,
          version: 1,
          provenance: { agentThreadId: threadId, activityId: contextActivityId, evidenceRefs: pass.contextManifestRef ? [pass.contextManifestRef] : [], parentArtifactIds: [] },
          availableDecisions: [],
          content: { manifest: pass.contextManifest, contextManifestRef: pass.contextManifestRef ?? null },
          createdAt: now,
          updatedAt: now,
        },
      },
      {
        type: "activity_append" as const,
        agentThreadId: threadId,
        activity: {
          id: contextActivityId,
          taskId: workflow.taskId,
          runId: workflowId,
          agentThreadId: threadId,
          seq: firstActivitySeq,
          type: "evidence_read" as const,
          status: "done" as const,
          actor: { kind: "system" as const, id: "prompt-compiler", displayName: "Context Compiler", agentThreadId: threadId },
          title: `Prepared ${teamRoleDisplayName(roleId)} CAT context`,
          body: pass.contextManifest?.coverage
            ? [
                `Task scope: ${pass.contextManifest.coverage.taskSegments}/${pass.contextManifest.coverage.batchSegments} segment(s).`,
                `Inline: ${pass.contextManifest.coverage.inlineSegments}.`,
                pass.contextManifest.coverage.requiresPaging ? "The Agent must read the remaining scope through paged CAT tools." : "The scoped segment packet is complete.",
                pass.contextManifest.truncationReason ? `Omissions: ${pass.contextManifest.truncationReason}` : "No prompt-budget omissions.",
              ].join("\n")
            : "Server-authored scoped CAT context is ready.",
          tool: { name: "team_context_prepare", effect: "read" as const, target: workflow.batchId ?? projectId, outcome: "scoped" },
          refs: { artifactIds: [contextArtifactId], evidenceRefs: pass.contextManifestRef ? [pass.contextManifestRef] : [], decisionIds: [] },
          createdAt: now,
          updatedAt: now,
        },
      },
    ] : []),
    ...traceEvents,
    ...(taskUsage && taskRun && JSON.stringify(taskRun.usageBySource?.[usageSource]) !== JSON.stringify(taskUsage) ? [{
      type: "usage_update" as const,
      agentThreadId: mainThread.id,
      usageSource,
      usage: taskUsage,
    }] : []),
  ];
  if (!snapshot.activities.some((activity) => activity.id === activityId)) {
    events.push({
      type: "activity_append",
      agentThreadId: threadId,
      activity: {
        id: activityId,
        taskId: workflow.taskId,
        runId: workflowId,
        agentThreadId: threadId,
        seq: firstActivitySeq + (shouldProjectContext ? 1 : 0) + traceEvents.length,
        type: pass.status === "completed" || pass.status === "skipped" ? "handoff" : pass.status === "failed" ? "error" : "progress",
        status: pass.status === "failed" ? "error" : pass.status === "completed" || pass.status === "skipped" || pass.status === "stopped" ? "done" : pass.status === "waiting" ? "pending" : "running",
        actor: {
          kind: deterministicRole ? "system" : "agent",
          id: deterministicRole ? "cat-kernel" : roleId,
          displayName: deterministicRole ? "CAT Kernel" : teamRoleDisplayName(roleId),
          agentThreadId: threadId,
        },
        title: `${teamRoleDisplayName(roleId)} · ${pass.status}`,
        body: [pass.summary, pass.modelProvider && pass.modelId ? `${pass.modelProvider}/${pass.modelId}` : pass.modelId, pass.contextManifestRef].filter(Boolean).join("\n"),
        tool: deterministicRole ? { name: roleId, effect: "read", target: workflow.batchId ?? projectId, outcome: pass.status } : null,
        refs: { artifactIds: [], evidenceRefs: pass.contextManifestRef ? [pass.contextManifestRef] : [], decisionIds: [] },
        createdAt: now,
        updatedAt: now,
      },
    });
  }
  await workspace.appendGenerated({ projectId, taskId: workflow.taskId, runId: workflowId, events });
  const hasRoleQueries = (await readWorkflowArtifacts(deps.repoRoot, projectId)).teamFindings.some(
    (row) => row.workflowId === workflowId && row.roleId === roleId && isBlockingTeamQuery(row),
  );
  if (pass.status === "completed" || (deterministicRole && pass.status === "waiting") || (pass.status === "waiting" && hasRoleQueries)) {
    await projectTeamRoleArtifacts(projectId, workflowId, roleId, pass, activityId, deps);
  }
}

async function projectTeamRoleArtifacts(
  projectId: string,
  workflowId: string,
  roleId: TeamRoleId,
  pass: TeamRolePass,
  activityId: string,
  deps: WorkflowRouteDeps,
): Promise<void> {
  const workflow = await readCatWorkflowRun(deps.repoRoot, projectId, workflowId);
  if (!workflow.taskId) return;
  const workspace = createTaskWorkspace(deps.repoRoot);
  const snapshot = await workspace.open({ projectId, taskId: workflow.taskId });
  const taskScope = requireProjectTaskScope(snapshot.task.scope, "Team Task");
  const threadId = `${workflowId}.${roleId}`;
  const now = pass.completedAt ?? new Date().toISOString();
  const ledger = await readWorkflowArtifacts(deps.repoRoot, projectId);
  const artifacts: TaskArtifact[] = [
    ...ledger.teamRoleArtifacts
      .filter((row) => row.workflowId === workflowId && row.roleId === roleId)
      .map((row): TaskArtifact => ({
        id: `team-role:${row.id}`,
        taskId: workflow.taskId!,
        runId: workflowId,
        type: row.type === "delivery_gate" ? "delivery_readiness" : row.type === "engineering_gate" || row.type === "pre_lqa" ? "evidence_pack" : "file",
        status: "reviewable",
        title: row.summary ?? row.type.replaceAll("_", " "),
        summary: row.summary ?? null,
        scope: snapshot.task.scope,
        version: 1,
        provenance: { agentThreadId: threadId, activityId, evidenceRefs: pass.contextManifestRef ? [pass.contextManifestRef] : [], parentArtifactIds: [] },
        availableDecisions: ["approve", "request_change"],
        content: { type: row.type, data: row.data },
        createdAt: row.createdAt,
        updatedAt: now,
      })),
    ...ledger.teamCandidateTargets
      .filter((row) => row.workflowId === workflowId && row.roleId === roleId)
      .map((row): TaskArtifact => ({
        id: `team-candidate:${row.id}`,
        taskId: workflow.taskId!,
        runId: workflowId,
        type: "segment_proposal",
        status: "reviewable",
        title: `Segment ${row.segmentId}`,
        summary: row.notes ?? row.function ?? null,
        scope: { ...taskScope, segmentIds: [row.segmentId] },
        version: 1,
        provenance: { agentThreadId: threadId, activityId, evidenceRefs: row.evidenceRefs, parentArtifactIds: [] },
        availableDecisions: ["apply", "reject", "request_change"],
        content: { segmentId: row.segmentId, target: row.target, function: row.function ?? null, notes: row.notes ?? null },
        createdAt: now,
        updatedAt: now,
      })),
    ...ledger.teamFindings
      .filter((row) => row.workflowId === workflowId && row.roleId === roleId && !isBlockingTeamQuery(row))
      .map((row): TaskArtifact => ({
        id: `team-finding:${row.id}`,
        taskId: workflow.taskId!,
        runId: workflowId,
        type: "qa_finding",
        status: "reviewable",
        title: `${row.severity} · ${row.type}`,
        summary: row.message,
        scope: { ...taskScope, segmentIds: row.segmentId ? [row.segmentId] : taskScope.segmentIds },
        version: 1,
        provenance: { agentThreadId: threadId, activityId, evidenceRefs: row.evidenceRefs, parentArtifactIds: [] },
        availableDecisions: ["request_change", "waive"],
        content: { segmentId: row.segmentId ?? null, message: row.message, proposedTarget: row.proposedTarget ?? null },
        createdAt: now,
        updatedAt: now,
      })),
    ...ledger.teamFindings
      .filter((row) => row.workflowId === workflowId && row.roleId === roleId && isBlockingTeamQuery(row))
      .map((row): TaskArtifact => ({
        id: `team-query:${row.id}`,
        taskId: workflow.taskId!,
        runId: workflowId,
        type: "agent_query",
        status: "reviewable",
        title: "Agent query",
        summary: row.message,
        scope: { ...taskScope, segmentIds: row.segmentId ? [row.segmentId] : taskScope.segmentIds },
        version: 1,
        provenance: { agentThreadId: threadId, activityId, evidenceRefs: row.evidenceRefs, parentArtifactIds: [] },
        availableDecisions: ["answer"],
        content: { segmentId: row.segmentId ?? null, message: row.message, evidenceRefs: row.evidenceRefs },
        createdAt: now,
        updatedAt: now,
      })),
  ];
  if (roleId === "delivery_manager") {
    artifacts.push(...ledger.deliveryQaReports
      .filter((row) => row.workflowId === workflowId)
      .map((row): TaskArtifact => ({
        id: `team-delivery-qa:${row.reportId}`,
        taskId: workflow.taskId!,
        runId: workflowId,
        type: "qa_report",
        status: "reviewable",
        title: "Delivery QA",
        summary: `${row.summary.blockers} blocker(s), ${row.summary.warnings} warning(s)`,
        scope: snapshot.task.scope,
        version: 1,
        provenance: { agentThreadId: threadId, activityId, evidenceRefs: [], parentArtifactIds: [] },
        availableDecisions: ["request_change", "waive"],
        content: { report: row },
        createdAt: row.generatedAt,
        updatedAt: now,
      })));
  }
  const decisionLabel = (action: TaskWorkspaceDecision["options"][number]["action"]): string => ({
    answer: "Answer",
    approve: "Approve",
    reject: "Reject",
    request_change: "Request change",
    waive: "Waive",
    apply: "Apply through CAT gates",
    authorize_delivery: "Authorize delivery",
  })[action];
  const events: TaskRunEventDraft[] = [];
  const runPlanHash = snapshot.runs.find((run) => run.id === workflowId)?.planHash;
  let nextSeq = Math.max(0, ...snapshot.activities.filter((row) => row.runId === workflowId).map((row) => row.seq)) + 1;
  for (const artifact of artifacts) {
    events.push({ type: "artifact_upsert", agentThreadId: threadId, artifact });
    const decisionId = `task-decision:${artifact.id}`;
    const existingDecision = snapshot.decisions.find((row) => row.id === decisionId);
    const decision: TaskWorkspaceDecision | undefined = artifact.availableDecisions.length && !existingDecision ? bindTaskDecision({
      id: decisionId,
      taskId: workflow.taskId,
      runId: workflowId,
      requestedByThreadId: threadId,
      artifactId: artifact.id,
      kind: artifact.type === "segment_proposal" ? "proposal_review" : artifact.type === "qa_finding" ? "waiver" : artifact.type === "agent_query" ? "answer" : "approval",
      status: "required",
      prompt: artifact.type === "segment_proposal"
        ? `Review the candidate for segment ${requireProjectTaskScope(artifact.scope, "Team artifact").segmentIds[0] ?? artifact.title}.`
        : artifact.type === "agent_query"
          ? artifact.summary ?? "The Agent needs an answer before continuing."
          : `Review ${artifact.title}.`,
      options: artifact.availableDecisions.map((action) => ({ id: action, label: decisionLabel(action), action, destructive: action === "reject" })),
      selectedOptionId: null,
      reason: null,
      scope: artifact.scope,
      createdAt: now,
      decidedAt: null,
    }, { runPlanHash }) : undefined;
    if (decision) events.push({ type: "decision_upsert", agentThreadId: threadId, decision });
    const activityId = `artifact-reviewable:${artifact.id}:v${artifact.version}`;
    if (!snapshot.activities.some((row) => row.id === activityId)) {
      events.push({
        type: "activity_append",
        agentThreadId: threadId,
        activity: {
          id: activityId,
          taskId: workflow.taskId,
          runId: workflowId,
          agentThreadId: threadId,
          seq: nextSeq++,
          type: "artifact_update",
          status: "done",
          actor: { kind: "agent", id: roleId, displayName: teamRoleDisplayName(roleId), agentThreadId: threadId },
          title: artifact.title,
          body: artifact.summary ?? "Artifact ready for review.",
          tool: null,
          refs: { artifactIds: [artifact.id], evidenceRefs: artifact.provenance.evidenceRefs, decisionIds: decision ? [decision.id] : existingDecision ? [existingDecision.id] : [] },
          createdAt: now,
          updatedAt: now,
        },
      });
    }
  }
  if (events.length) await workspace.appendGenerated({ projectId, taskId: workflow.taskId, runId: workflowId, events });
}

async function projectTeamWorkflowStop(
  projectId: string,
  workflowId: string,
  reason: string | undefined,
  deps: WorkflowRouteDeps,
): Promise<void> {
  const workflow = await readCatWorkflowRun(deps.repoRoot, projectId, workflowId);
  if (!workflow.taskId) return;
  const workspace = createTaskWorkspace(deps.repoRoot);
  const snapshot = await workspace.open({ projectId, taskId: workflow.taskId });
  const taskRun = snapshot.runs.find((run) => run.id === workflowId);
  const mainThread = snapshot.agentThreads.find((thread) => thread.id === `${workflowId}.main`);
  if (!taskRun || !mainThread) return;
  const now = new Date().toISOString();
  const activityId = `${workflowId}.stopped`;
  const events: TaskRunEventDraft[] = [
    {
      type: "run_upsert",
      agentThreadId: mainThread.id,
      run: { ...taskRun, status: "stopped", updatedAt: now, completedAt: now, stopAvailable: false, resumeAvailable: true },
    },
    {
      type: "thread_upsert",
      agentThreadId: mainThread.id,
      thread: { ...mainThread, status: "stopped", updatedAt: now },
    },
    ...snapshot.agentThreads
      .filter((thread) => thread.runId === workflowId && thread.parentThreadId === mainThread.id && !["complete", "failed", "stopped"].includes(thread.status))
      .map((thread): TaskRunEventDraft => ({
        type: "thread_upsert",
        agentThreadId: thread.id,
        thread: { ...thread, status: "stopped", updatedAt: now },
      })),
  ];
  if (!snapshot.activities.some((activity) => activity.id === activityId)) {
    events.push({
      type: "activity_append",
      agentThreadId: mainThread.id,
      activity: {
        id: activityId,
        taskId: workflow.taskId,
        runId: workflowId,
        agentThreadId: mainThread.id,
        seq: Math.max(0, ...snapshot.activities.filter((activity) => activity.runId === workflowId).map((activity) => activity.seq)) + 1,
        type: "progress",
        status: "done",
        actor: { kind: "system", id: "runtime", displayName: "Runtime", agentThreadId: mainThread.id },
        title: "Team run stopped",
        body: reason ?? "Stopped by user.",
        tool: null,
        refs: { artifactIds: [], evidenceRefs: [], decisionIds: [] },
        createdAt: now,
        updatedAt: now,
      },
    });
  }
  await workspace.appendGenerated({ projectId, taskId: workflow.taskId, runId: workflowId, events });
}

async function projectTeamWorkflowStopping(
  projectId: string,
  workflowId: string,
  reason: string | undefined,
  deps: WorkflowRouteDeps,
): Promise<void> {
  const workflow = await readCatWorkflowRun(deps.repoRoot, projectId, workflowId);
  if (!workflow.taskId) return;
  const workspace = createTaskWorkspace(deps.repoRoot);
  const snapshot = await workspace.open({ projectId, taskId: workflow.taskId });
  const taskRun = snapshot.runs.find((run) => run.id === workflowId);
  const threads = snapshot.agentThreads.filter((thread) => thread.runId === workflowId);
  if (!taskRun || !threads.length || taskRun.status === "stopping") return;
  const now = new Date().toISOString();
  await workspace.appendGenerated({
    projectId,
    taskId: workflow.taskId,
    runId: workflowId,
    events: [{
      type: "run_upsert",
      agentThreadId: taskRun.rootAgentThreadId,
      run: { ...taskRun, status: "stopping", updatedAt: now, stopAvailable: false },
    }, ...threads
      .filter((thread) => !["complete", "failed", "stopped"].includes(thread.status))
      .map((thread): TaskRunEventDraft => ({
        type: "thread_upsert",
        agentThreadId: thread.id,
        thread: { ...thread, status: "stopping", handoffSummary: reason ?? thread.handoffSummary, updatedAt: now },
      }))],
  });
}

export async function stopTeamWorkflowRun(
  input: { projectId: string; workflowId: string; reason?: string },
  deps: WorkflowRouteDeps,
): Promise<unknown> {
  await withTeamLaunchLock(deps.repoRoot, input.projectId, input.workflowId, async () => {
    await beginStopCatWorkflowRun(deps.repoRoot, input.projectId, input.workflowId, input.reason);
    await projectTeamWorkflowStopping(input.projectId, input.workflowId, input.reason, deps);
  });
  const stopResult = await deps.stopActiveRuns?.({
    projectId: input.projectId,
    workflowId: input.workflowId,
    roleId: undefined,
    reason: input.reason,
  }) ?? { stopped: 0, reason: input.reason, errors: [] };
  await withTeamLaunchLock(deps.repoRoot, input.projectId, input.workflowId, async () => {
    const activePasses = (await readWorkflowArtifacts(deps.repoRoot, input.projectId)).teamRolePasses
      .filter((row) => row.workflowId === input.workflowId && ["queued", "running", "waiting", "stopping"].includes(row.status));
    for (const pass of activePasses) {
      const stoppedPass: TeamRolePass = {
        ...pass,
        status: "stopped",
        completedAt: new Date().toISOString(),
        summary: input.reason ? `Stopped by user: ${input.reason}` : "Stopped by user.",
      };
      await upsertTeamRolePass(deps.repoRoot, input.projectId, stoppedPass);
      await projectTeamRolePass(input.projectId, input.workflowId, pass.roleId, stoppedPass, deps);
    }
    await stopCatWorkflowRun(deps.repoRoot, input.projectId, input.workflowId, input.reason);
    await projectTeamWorkflowStop(input.projectId, input.workflowId, input.reason, deps);
  });
  return stopResult;
}

async function writeProjectTeamRoleSettings(projectId: string, settings: TeamRoleSettings, deps: WorkflowRouteDeps): Promise<TeamRoleSettings> {
  if (!deps.writeProjectAgentSettings) {
    await writeTeamRoleSettings(deps.repoRoot, settings);
    return readEffectiveTeamRoleSettings(projectId, deps);
  }
  const current = deps.readProjectAgentSettings ? (await deps.readProjectAgentSettings(projectId)).teamRoleSettings : undefined;
  const profiles = mergeTeamRoleProfiles(current?.profiles ?? [], settings);
  await deps.writeProjectAgentSettings(projectId, { teamRoleSettings: { profiles } });
  return readEffectiveTeamRoleSettings(projectId, deps);
}

async function skipDisabledTeamRoles(projectId: string, workflowId: string, artifacts: Awaited<ReturnType<typeof readWorkflowArtifacts>>, deps: WorkflowRouteDeps): Promise<Awaited<ReturnType<typeof readWorkflowArtifacts>>> {
  let current = artifacts;
  const profiles = (await readEffectiveTeamRoleSettings(projectId, deps)).profiles;
  for (const roleId of TEAM_ROLE_IDS) {
    const passes = current.teamRolePasses.filter((row) => row.workflowId === workflowId);
    if (passes.find((row) => row.status === "queued" || row.status === "running" || row.status === "stopping")) return current;
    const pass = passes.find((row) => row.roleId === roleId);
    if (pass && TERMINAL_ROLE_STATUSES.has(pass.status)) continue;
    const profile = profiles.find((row) => row.roleId === roleId);
    if (profile?.enabled !== false) continue;
    const skipped: TeamRolePass = {
      workflowId,
      roleId,
      status: "skipped",
      sessionId: teamRoleSessionId(workflowId, roleId),
      modelProvider: profile.provider,
      modelId: profile.modelId,
      thinking: profile.thinking,
      inputArtifactRefs: pass?.inputArtifactRefs ?? [],
      outputArtifactRefs: pass?.outputArtifactRefs ?? [],
      summary: "Skipped because this team role is disabled in Team Role Models settings.",
      transcriptRef: pass?.transcriptRef ?? `session:${teamRoleSessionId(workflowId, roleId)}`,
    };
    current = await upsertTeamRolePass(deps.repoRoot, projectId, skipped);
    const run = await readCatWorkflowRun(deps.repoRoot, projectId, workflowId);
    if (!run.completedStepIds.includes(roleId)) {
      await completeCatWorkflowStep(deps.repoRoot, projectId, workflowId, roleId, "Skipped disabled team role.");
    }
    current = await readWorkflowArtifacts(deps.repoRoot, projectId);
  }
  return current;
}

async function nextTeamRole(workflowId: string, artifacts: Awaited<ReturnType<typeof readWorkflowArtifacts>>, selectedRoleIds: TeamRoleId[] = TEAM_ROLE_IDS as unknown as TeamRoleId[]): Promise<TeamRoleId | undefined> {
  const passes = artifacts.teamRolePasses.filter((row) => row.workflowId === workflowId);
  const busy = passes.find((row) => row.status === "queued" || row.status === "running" || row.status === "stopping");
  if (busy) return undefined;
  return selectedRoleIds.find((roleId) => !TERMINAL_ROLE_STATUSES.has(passes.find((row) => row.roleId === roleId)?.status ?? "waiting"));
}

async function writeWorkflowRunTeamPlan(
  repoRoot: string,
  projectId: string,
  workflowId: string,
  planHash: string,
  selectedRoleIds: TeamRoleId[],
): Promise<void> {
  const run = await readCatWorkflowRun(repoRoot, projectId, workflowId);
  await writeJsonFile(workflowRunPath(repoRoot, projectId, workflowId), {
    ...run,
    teamPlanHash: planHash,
    teamSelectedRoleIds: selectedRoleIds,
    updatedAt: new Date().toISOString(),
  });
}

async function syncWorkflowRoleStatuses(projectId: string, workflowId: string, deps: WorkflowRouteDeps): Promise<Awaited<ReturnType<typeof readWorkflowArtifacts>>> {
  const artifacts = await readWorkflowArtifacts(deps.repoRoot, projectId);
  const workflow = await readCatWorkflowRun(deps.repoRoot, projectId, workflowId);
  if (TERMINAL_TEAM_WORKFLOW_STATUSES.has(workflow.status)) return artifacts;
  for (const row of artifacts.teamRolePasses.filter((pass) =>
    pass.workflowId === workflowId &&
    pass.subagentAsyncDir &&
    (pass.status === "queued" || pass.status === "running" || pass.status === "waiting" || pass.status === "stopping")
  )) {
    // A completed child that emitted queries is now waiting on the user, not
    // on another async status transition. Re-reading its old `complete`
    // status would silently turn it back into a completed role before Resume.
    if (row.status === "waiting" && artifacts.teamFindings.some((finding) =>
      finding.workflowId === workflowId && finding.roleId === row.roleId && isBlockingTeamQuery(finding)
    )) continue;
    const synced = await buildRolePassFromSubagentStatus({
      workflowId,
      roleId: row.roleId,
      sessionId: row.sessionId,
      asyncDir: row.subagentAsyncDir,
      inputArtifactRefs: row.inputArtifactRefs,
      outputArtifactRefs: row.outputArtifactRefs,
      contextManifestRef: row.contextManifestRef,
      contextManifest: row.contextManifest,
      transcriptRef: row.transcriptRef,
    }).catch(() => undefined);
    if (!synced) continue;
    await upsertTeamRolePass(deps.repoRoot, projectId, synced.rolePass);
    const ingest = await ingestCompletedRoleOutput({
      projectId,
      workflowId,
      roleId: row.roleId,
      rolePass: synced.rolePass,
      asyncDir: synced.asyncDir,
      statusOutputFile: synced.status.outputFile,
      repoRoot: deps.repoRoot,
    });
    let projectedPass: TeamRolePass;
    if (ingest.ok) {
      projectedPass = (await readWorkflowArtifacts(deps.repoRoot, projectId)).teamRolePasses.find(
        (pass) => pass.workflowId === workflowId && pass.roleId === row.roleId,
      ) ?? synced.rolePass;
    } else {
      projectedPass = invalidRoleOutputPass(synced.rolePass, ingest.reason);
      await upsertTeamRolePass(deps.repoRoot, projectId, projectedPass);
    }
    await projectTeamRolePass(projectId, workflowId, row.roleId, projectedPass, deps);
    if (synced.status.state === "complete" || synced.status.state === "failed") {
      deps.completeActiveRuns?.({ projectId, workflowId, roleId: row.roleId, subagentRunId: synced.status.runId }, synced.status.error);
    }
  }
  return readWorkflowArtifacts(deps.repoRoot, projectId);
}

export async function continueTeamWorkflowUntilPause(input: {
  projectId: string;
  workflowId: string;
  selectedRoleIds: TeamRoleId[];
  deps: WorkflowRouteDeps;
}): Promise<void> {
  const { projectId, workflowId, selectedRoleIds, deps } = input;
  while (true) {
    const workflow = await readCatWorkflowRun(deps.repoRoot, projectId, workflowId);
    if (TERMINAL_TEAM_WORKFLOW_STATUSES.has(workflow.status)) return;
    const state = await withTeamLaunchLock(deps.repoRoot, projectId, workflowId, async () => {
      const artifacts = await skipDisabledTeamRoles(projectId, workflowId, await syncWorkflowRoleStatuses(projectId, workflowId, deps), deps);
      const passes = artifacts.teamRolePasses.filter((row) => row.workflowId === workflowId && selectedRoleIds.includes(row.roleId));
      if (passes.some((row) => ["queued", "running", "stopping"].includes(row.status))) return { kind: "busy" } as const;
      const failed = passes.find((row) => row.status === "failed");
      if (failed) return { kind: "failed", message: failed.summary } as const;
      const taskSnapshot = workflow.taskId
        ? await createTaskWorkspace(deps.repoRoot).open({ projectId, taskId: workflow.taskId })
        : undefined;
      const blocked = passes.find((row) => {
        if (row.status !== "waiting") return false;
        if (DETERMINISTIC_TEAM_ROLE_IDS.has(row.roleId)) return true;
        const roleQueries = artifacts.teamFindings.filter((finding) =>
          finding.workflowId === workflowId && finding.roleId === row.roleId && isBlockingTeamQuery(finding)
        );
        if (!roleQueries.length) return true;
        return roleQueries.some((finding) => taskSnapshot?.decisions.find(
          (decision) => decision.id === `task-decision:team-query:${finding.id}`
        )?.status !== "recorded");
      });
      if (blocked) return { kind: "blocked", message: blocked.summary } as const;
      const roleId = await nextTeamRole(workflowId, artifacts, selectedRoleIds);
      if (!roleId) return { kind: "completed" } as const;
      const result = await runTeamRole({ projectId, workflowId, roleId, body: { execute: true }, deps });
      return result.status >= 400
        ? { kind: "failed", message: `Role ${roleId} failed to start.` } as const
        : { kind: "advanced" } as const;
    });
    if (state.kind === "busy") {
      await sleep(750);
      continue;
    }
    if (state.kind === "advanced") continue;
    if (state.kind === "completed") {
      await projectTeamWorkflowOutcome(projectId, workflowId, "completed", "All selected Team roles completed.", deps);
      return;
    }
    if (state.kind === "failed") {
      await projectTeamWorkflowOutcome(projectId, workflowId, "failed", state.message ?? "Team run failed.", deps);
      return;
    }
    await projectTeamWorkflowOutcome(projectId, workflowId, "blocked", state.message ?? "Team run blocked.", deps);
    return;
  }
}

const activeTeamContinuations = new Map<string, Promise<void>>();

function scheduleTeamWorkflowContinuation(input: Parameters<typeof continueTeamWorkflowUntilPause>[0]): void {
  const key = `${input.deps.repoRoot}\u0000${input.projectId}\u0000${input.workflowId}`;
  if (activeTeamContinuations.has(key)) return;
  const continuation = continueTeamWorkflowUntilPause(input)
    .catch((error) => projectTeamWorkflowOutcome(
      input.projectId,
      input.workflowId,
      "failed",
      error instanceof Error ? error.message : String(error),
      input.deps,
    ))
    .finally(() => activeTeamContinuations.delete(key));
  activeTeamContinuations.set(key, continuation);
}

export interface SpecialistFollowUpInput {
  projectId: string;
  taskId: string;
  sourceThreadId: string;
  message: string;
  artifactId?: string;
  activityId?: string;
}

export async function startSpecialistFollowUp(
  input: SpecialistFollowUpInput,
  deps: WorkflowRouteDeps,
): Promise<{ taskId: string; runId: string; threadId: string; roleId: TeamRoleId }> {
  const message = input.message.trim();
  if (!message) throw new TaskWorkspaceConflictError("Specialist follow-up message is required.");
  if (!deps.spawnSubagentRun) throw new TaskWorkspaceConflictError("Specialist follow-up requires the server-owned Team child adapter.");

  const workspace = createTaskWorkspace(deps.repoRoot);
  const snapshot = await workspace.open({ projectId: input.projectId, taskId: input.taskId });
  if (snapshot.activeRunId) throw new TaskWorkspaceConflictError(`Task ${input.taskId} already has active run ${snapshot.activeRunId}.`);
  const sourceThread = snapshot.agentThreads.find((thread) => thread.id === input.sourceThreadId);
  if (!sourceThread || sourceThread.identity.kind !== "specialist" || !sourceThread.canReceiveUserMessage) {
    throw new TaskWorkspaceConflictError(`Agent thread ${input.sourceThreadId} cannot receive a specialist follow-up.`);
  }
  if (!(TEAM_ROLE_IDS as readonly string[]).includes(sourceThread.identity.roleId)) {
    throw new TaskWorkspaceConflictError(`Agent thread ${input.sourceThreadId} does not identify a Team role.`);
  }
  const roleId = sourceThread.identity.roleId as TeamRoleId;
  if (DETERMINISTIC_TEAM_ROLE_IDS.has(roleId)) throw new TaskWorkspaceConflictError(`${roleId} is deterministic and cannot receive a model follow-up.`);

  const sourceWorkflow = await readCatWorkflowRun(deps.repoRoot, input.projectId, sourceThread.runId).catch(() => undefined);
  if (!sourceWorkflow || sourceWorkflow.taskId !== input.taskId) {
    throw new TaskWorkspaceConflictError(`Agent thread ${input.sourceThreadId} is not backed by a Task-linked Team workflow.`);
  }
  const artifact = input.artifactId ? snapshot.artifacts.find((row) => row.id === input.artifactId) : undefined;
  if (input.artifactId && !artifact) throw new TaskWorkspaceConflictError(`Artifact ${input.artifactId} is not in Task ${input.taskId}.`);
  const activity = input.activityId ? snapshot.activities.find((row) => row.id === input.activityId) : undefined;
  if (input.activityId && !activity) throw new TaskWorkspaceConflictError(`Activity ${input.activityId} is not in Task ${input.taskId}.`);

  const context = [
    `Target specialist: ${sourceThread.identity.displayName} (${roleId}).`,
    `User follow-up:\n${message}`,
    "This is a scoped follow-up, not a fresh full-role pass. Reuse the prior handoff and referenced Task artifacts first; read only the additional evidence needed to answer the question. Do not re-audit the full batch unless the user explicitly asks for it.",
    "Answer the user's requested explanation or conclusion in summary while preserving the role JSON contract. If no actionable issue exists, set noIssues to true and findings, queries, candidateTargets, and candidates must all be empty; positive confirmations are not findings.",
    sourceThread.handoffSummary ? `Previous handoff:\n${sourceThread.handoffSummary}` : undefined,
    artifact ? `Referenced artifact ${artifact.id} · ${artifact.title}\n${artifact.summary ?? ""}\n${JSON.stringify(artifact.content)}` : undefined,
    activity ? `Referenced activity ${activity.id} · ${activity.title}\n${activity.body}` : undefined,
  ].filter((line): line is string => Boolean(line)).join("\n\n");
  const created = await createCatWorkflowRun(deps.repoRoot, {
    projectId: input.projectId,
    taskId: input.taskId,
    batchId: sourceWorkflow.batchId ?? requireProjectTaskScope(snapshot.task.scope, "Specialist follow-up Task").batchId ?? undefined,
    workflowId: `specialist-followup-${randomUUID()}`,
    intent: "game_localization_team_run",
    userRequest: context,
    includeReadiness: false,
  });
  try {
    await projectCreatedWorkflowTask(created.run, deps, {
      acknowledgementBody: message,
      planBody: `1. Follow up with ${sourceThread.identity.displayName}`,
    });
  } catch (error) {
    await workflowApplicationPort.discardWorkflowFile(created.path).catch(() => undefined);
    throw error;
  }

  try {
    const profile = (await readEffectiveTeamRoleSettings(input.projectId, deps)).profiles.find((row) => row.roleId === roleId);
    const modelRoute = profile?.provider && profile.modelId ? `${profile.provider}/${profile.modelId}` : profile?.modelId;
    const planCore = {
      projectId: input.projectId,
      workflowId: created.run.workflowId,
      batchId: created.run.batchId,
      forceAllRoles: false,
      readiness: { status: "ready" as const, blockers: [], notes: [`User requested a scoped follow-up to ${sourceThread.identity.displayName}.`] },
      roles: [{ roleId, enabled: true, reason: "The user explicitly addressed this specialist from canonical Task history.", dependencies: [], modelRoute, estimatedCalls: 1 }],
      selectedRoleIds: [roleId],
      modelRoutes: modelRoute ? { [roleId]: modelRoute } : {},
      estimatedCalls: 1,
    };
    const plan: TeamRunPlan = {
      ...planCore,
      createdAt: new Date().toISOString(),
      planHash: createHash("sha256").update(JSON.stringify(planCore)).digest("hex"),
    };
    await writeWorkflowRunTeamPlan(deps.repoRoot, input.projectId, created.run.workflowId, plan.planHash, [roleId]);
    await projectTeamStart(input.projectId, created.run.workflowId, plan, deps);

    const threadId = `${created.run.workflowId}.${roleId}`;
    const now = new Date().toISOString();
    await workspace.appendGenerated({
      projectId: input.projectId,
      taskId: input.taskId,
      runId: created.run.workflowId,
      events: [{
        type: "activity_append",
        agentThreadId: threadId,
        activity: {
          id: `${threadId}.user-follow-up`,
          taskId: input.taskId,
          runId: created.run.workflowId,
          agentThreadId: threadId,
          seq: 0,
          type: "message",
          status: "done",
          actor: { kind: "human", id: "user", displayName: "You", agentThreadId: threadId },
          title: `Follow-up to ${sourceThread.identity.displayName}`,
          body: message,
          tool: null,
          refs: { artifactIds: artifact ? [artifact.id] : [], evidenceRefs: [], decisionIds: [] },
          createdAt: now,
          updatedAt: now,
        },
      }],
    });

    const result = await withTeamLaunchLock(deps.repoRoot, input.projectId, created.run.workflowId, () =>
      runTeamRole({ projectId: input.projectId, workflowId: created.run.workflowId, roleId, body: { execute: true }, deps }));
    if (result.status >= 400) throw new TaskWorkspaceConflictError(`${sourceThread.identity.displayName} follow-up failed to start.`);
    scheduleTeamWorkflowContinuation({ projectId: input.projectId, workflowId: created.run.workflowId, selectedRoleIds: [roleId], deps });
    return { taskId: input.taskId, runId: created.run.workflowId, threadId, roleId };
  } catch (error) {
    await projectTeamWorkflowOutcome(
      input.projectId,
      created.run.workflowId,
      "failed",
      error instanceof Error ? error.message : String(error),
      deps,
    ).catch(() => undefined);
    throw error;
  }
}

export async function startTeamWorkflowRun(input: {
  projectId: string;
  workflowId: string;
  planHash?: string;
  forceAllRoles?: boolean;
  execute?: boolean;
  awaitUntilPause?: boolean;
  modelProvider?: string;
  modelId?: string;
  deps: WorkflowRouteDeps;
}): Promise<{ status: number; data: unknown }> {
  const { projectId, workflowId, deps } = input;
  const started = await withTeamLaunchLock(deps.repoRoot, projectId, workflowId, async () => {
    const run = await readCatWorkflowRun(deps.repoRoot, projectId, workflowId);
    if (run.plan.intent !== "game_localization_team_run") throw new Error("workflow start/resume is only available for game_localization_team_run.");
    const plan = await preflightTeamWorkflowRun({ projectId, workflowId, forceAllRoles: input.forceAllRoles, project: false, deps });
    if (!input.planHash) throw new Error("planHash is required.");
    if (input.planHash !== plan.planHash) {
      throw new Error(`Team preflight planHash is stale. Expected ${plan.planHash}; received ${input.planHash}.`);
    }
    if (plan.readiness.status === "blocked") throw new Error(`Team preflight is blocked: ${plan.readiness.blockers.join("; ")}`);
    const selectedRoleIds = plan.selectedRoleIds;
    if (input.execute !== false && selectedRoleIds.some((roleId) => !DETERMINISTIC_TEAM_ROLE_IDS.has(roleId)) && !deps.spawnSubagentRun) {
      throw new Error("Team execution requires the server-owned Team child adapter before any role starts.");
    }
    const artifacts = await skipDisabledTeamRoles(projectId, workflowId, await syncWorkflowRoleStatuses(projectId, workflowId, deps), deps);
    const roleId = await nextTeamRole(workflowId, artifacts, selectedRoleIds);
    if (!roleId) {
      return { response: {
        status: 200,
        data: { workflowId, status: "waiting", message: "No runnable team role; a role may already be running or all roles are completed.", artifacts },
      } };
    }
    if (run.teamPlanHash !== plan.planHash || JSON.stringify(run.teamSelectedRoleIds) !== JSON.stringify(selectedRoleIds)) {
      await writeWorkflowRunTeamPlan(deps.repoRoot, projectId, workflowId, plan.planHash, selectedRoleIds);
    }
    const result = await runTeamRole({
      projectId,
      workflowId,
      roleId,
      body: {
        execute: input.execute === undefined ? true : input.execute,
        ...(input.modelProvider ? { modelProvider: input.modelProvider } : {}),
        ...(input.modelId ? { modelId: input.modelId } : {}),
      },
      deps,
    });
    if (result.status < 400) {
      await projectTeamStart(projectId, workflowId, plan, deps);
      return {
        response: { status: result.status, data: { workflowId, roleId, artifacts: result.data } },
        continuation: { projectId, workflowId, selectedRoleIds, deps },
      };
    }
    return { response: { status: result.status, data: { workflowId, roleId, artifacts: result.data } } };
  });
  if (started.continuation) {
    if (input.awaitUntilPause) await continueTeamWorkflowUntilPause(started.continuation);
    else if (deps.continueTeamRunsInBackground) scheduleTeamWorkflowContinuation(started.continuation);
  }
  return started.response;
}

export async function handleWorkflowRoute(
  req: IncomingMessage,
  res: ServerResponse,
  parts: string[],
  projectId: string,
  deps: WorkflowRouteDeps,
): Promise<boolean> {
  if (parts[3] !== "workflows") return false;

  if (parts.length === 4 && req.method === "GET") {
    deps.json(res, 200, { rows: await listCatWorkflowRuns(deps.repoRoot, projectId) });
    return true;
  }

  if (parts.length === 4 && req.method === "POST") {
    const body = await deps.readBody(req) as Record<string, unknown>;
    const taskId = deps.requireString(body.taskId, "taskId");
    const batchId = deps.optionalString(body.batchId);
    const taskWorkspace = createTaskWorkspace(deps.repoRoot);
    const task = (await taskWorkspace.open({ projectId, taskId })).task;
    const taskScope = requireProjectTaskScope(task.scope, "Workflow Task");
    if (taskScope.batchId && taskScope.batchId !== batchId) {
      throw new Error(`Task ${taskId} is scoped to batch ${taskScope.batchId}, not ${batchId ?? "an unscoped workflow"}.`);
    }
    const created = await createCatWorkflowRun(deps.repoRoot, {
      projectId,
      taskId,
      batchId,
      workflowId: deps.optionalString(body.workflowId),
      intent: workflowIntent(body.intent),
      userRequest: deps.optionalString(body.userRequest),
      includeReadiness: deps.optionalBoolean(body.includeReadiness),
      overwrite: deps.optionalBoolean(body.overwrite),
    });
    try {
      await projectCreatedWorkflowTask(created.run, deps);
    } catch (error) {
      if (body.overwrite !== true) await workflowApplicationPort.discardWorkflowFile(created.path).catch(() => undefined);
      throw error;
    }
    deps.json(res, 200, created);
    return true;
  }

  if (!parts[4]) return false;
  if (parts[4] === "team-role-settings" && req.method === "GET") {
    deps.json(res, 200, await readEffectiveTeamRoleSettings(projectId, deps));
    return true;
  }
  if (parts[4] === "team-role-settings" && req.method === "PUT") {
    deps.json(res, 200, await writeProjectTeamRoleSettings(projectId, await deps.readBody(req) as TeamRoleSettings, deps));
    return true;
  }
  const workflowId = decodeURIComponent(parts[4]);

  if (parts.length === 5 && req.method === "GET") {
    deps.json(res, 200, await readCatWorkflowRun(deps.repoRoot, projectId, workflowId));
    return true;
  }

  if (parts[5] === "preflight" && req.method === "POST") {
    const body = await deps.readBody(req) as Record<string, unknown>;
    const plan = await preflightTeamWorkflowRun({ projectId, workflowId, forceAllRoles: body.forceAllRoles === true, deps });
    deps.json(res, 200, plan);
    return true;
  }

  if (parts[5] === "events" && req.method === "GET") {
    const run = await readCatWorkflowRun(deps.repoRoot, projectId, workflowId);
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    const afterRaw = Number(url.searchParams.get("after") ?? "0");
    const after = Number.isInteger(afterRaw) && afterRaw >= 0 ? afterRaw : 0;
    const events = run.history.slice(after).map((event, index) => ({
      cursor: after + index + 1,
      event,
    }));
    deps.json(res, 200, {
      workflowId,
      cursor: after,
      nextCursor: after + events.length,
      events,
      done: ["completed", "cancelled", "stopped", "failed"].includes(run.status),
    });
    return true;
  }

  if (parts[5] === "decisions" && req.method === "POST") {
    const body = await deps.readBody(req) as Record<string, unknown>;
    const rawRows = Array.isArray(body.decisions) ? body.decisions : [body];
    const rows = rawRows.map((item, index) => {
      const row = record(item);
      if (!row) throw new Error(`decisions[${index}] must be an object.`);
      const reason = typeof row.reason === "string" ? row.reason.trim() : "";
      if (!reason) throw new Error(`decisions[${index}].reason is required.`);
      const decision = row.decision;
      if (decision !== "accept" && decision !== "reject" && decision !== "query" && decision !== "accepted_risk") {
        throw new Error(`decisions[${index}].decision is invalid.`);
      }
      if (row.findingIds !== undefined && (!Array.isArray(row.findingIds) || row.findingIds.some((value) => typeof value !== "string" || !value.trim()))) {
        throw new Error(`decisions[${index}].findingIds must be an array of non-empty strings.`);
      }
      const findingIds = Array.isArray(row.findingIds)
        ? [...new Set(row.findingIds.map((value) => (value as string).trim()))]
        : [];
      const segmentId = typeof row.segmentId === "string" && row.segmentId.trim() ? row.segmentId.trim() : undefined;
      return {
        id: typeof row.id === "string" && row.id.trim() ? row.id.trim() : `${workflowId}:user-decision:${Date.now()}:${index}`,
        workflowId,
        segmentId,
        decision,
        reason,
        findingIds,
        evidenceRefs: Array.isArray(row.evidenceRefs) ? row.evidenceRefs.filter((value): value is string => typeof value === "string") : [],
        decidedBy: "user" as const,
      } satisfies TeamDecision;
    });
    const run = await readCatWorkflowRun(deps.repoRoot, projectId, workflowId);
    const current = await readWorkflowArtifacts(deps.repoRoot, projectId);
    const scopeRejectionReason = await scopedRoleOutputRejectionReason({
      repoRoot: deps.repoRoot,
      projectId,
      run,
      output: { decisions: rows },
    });
    if (scopeRejectionReason) throw new Error(scopeRejectionReason);
    const knownFindingIds = knownWorkflowFindingIds({ workflowId, batchId: run.batchId, artifacts: current, findings: [] });
    const knownFindingSegments = knownWorkflowFindingSegments({ workflowId, batchId: run.batchId, artifacts: current, findings: [] });
    for (const [index, row] of rows.entries()) {
      for (const findingId of row.findingIds) {
        if (!knownFindingIds.has(findingId)) throw new Error(`decisions[${index}].findingIds contains unknown finding id ${findingId}.`);
        const findingSegmentId = knownFindingSegments.get(findingId);
        if (row.segmentId && findingSegmentId !== row.segmentId) {
          throw new Error(`decisions[${index}].findingIds references ${findingId} from segment ${findingSegmentId ?? "none"}, not ${row.segmentId}.`);
        }
      }
    }
    if (run.batchId) {
      await syncTeamQualityDecisionLedger(deps.repoRoot, {
        projectId,
        batchId: run.batchId,
        workflowId,
        ...workflowQualityLedgerFindings(run, current),
        decisions: rows,
      });
    }
    const updated = await mutateWorkflowArtifacts(deps.repoRoot, projectId, (current) => {
      const byId = new Map(current.teamDecisions.map((decision) => [decision.id, decision]));
      for (const row of rows) byId.set(row.id, row);
      return { ...current, teamDecisions: [...byId.values()] };
    });
    deps.json(res, 200, { workflowId, decisions: rows, artifacts: updated });
    return true;
  }

  if ((parts[5] === "stop" || parts[5] === "role-stop") && req.method === "POST") {
    const body = await deps.readBody(req) as Record<string, unknown>;
    const roleId = typeof body.roleId === "string" && (TEAM_ROLE_IDS as readonly string[]).includes(body.roleId) ? body.roleId as TeamRoleId : undefined;
    const reason = deps.optionalString(body.reason);
    if (parts[5] === "role-stop" && !roleId) throw new Error("roleId is required for role-stop.");
    if (!roleId) {
      deps.json(res, 200, await stopTeamWorkflowRun({ projectId, workflowId, reason }, deps));
      return true;
    }
    const stopResult = await deps.stopActiveRuns?.({ projectId, workflowId, roleId, reason }) ?? { stopped: 0, reason, errors: [] };
    const pass = (await readWorkflowArtifacts(deps.repoRoot, projectId)).teamRolePasses.find((row) => row.workflowId === workflowId && row.roleId === roleId);
    if (pass) {
      const stoppedPass: TeamRolePass = {
        ...pass,
        status: "stopped",
        completedAt: new Date().toISOString(),
        summary: reason ? `Stopped by user: ${reason}` : "Stopped by user.",
      };
      await upsertTeamRolePass(deps.repoRoot, projectId, stoppedPass);
      await projectTeamRolePass(projectId, workflowId, roleId, stoppedPass, deps);
    }
    // Team roles execute as a dependency chain. Stopping the current child
    // therefore pauses the owning workflow; otherwise the background
    // continuation can immediately launch the same or next role while the UI
    // still says that the user stopped it.
    await stopCatWorkflowRun(deps.repoRoot, projectId, workflowId, reason);
    await projectTeamWorkflowStop(projectId, workflowId, reason, deps);
    deps.json(res, 200, stopResult);
    return true;
  }

  if (parts[5] === "run-role" && req.method === "POST") {
    const body = await deps.readBody(req) as Record<string, unknown>;
    const roleId = deps.requireString(body.roleId, "roleId");
    if (!(TEAM_ROLE_IDS as readonly string[]).includes(roleId)) throw new Error(`Invalid team role ${roleId}.`);
    const result = await withTeamLaunchLock(deps.repoRoot, projectId, workflowId, () =>
      runTeamRole({ projectId, workflowId, roleId: roleId as TeamRoleId, body, deps }));
    deps.json(res, result.status, result.data);
    return true;
  }

  if ((parts[5] === "start" || parts[5] === "resume") && req.method === "POST") {
    const body = await deps.readBody(req) as Record<string, unknown>;
    const routeResult = await startTeamWorkflowRun({
      projectId,
      workflowId,
      planHash: deps.optionalString(body.planHash),
      forceAllRoles: body.forceAllRoles === true,
      execute: body.execute === undefined ? true : body.execute === true,
      modelProvider: deps.optionalString(body.modelProvider),
      modelId: deps.optionalString(body.modelId),
      deps,
    });
    deps.json(res, routeResult.status, routeResult.data);
    return true;
  }

  if (parts[5] === "role-status" && req.method === "POST") {
    const body = await deps.readBody(req) as Record<string, unknown>;
    const roleId = deps.requireString(body.roleId, "roleId");
    if (!(TEAM_ROLE_IDS as readonly string[]).includes(roleId)) throw new Error(`Invalid team role ${roleId}.`);
    const workflow = await readCatWorkflowRun(deps.repoRoot, projectId, workflowId);
    if (TERMINAL_TEAM_WORKFLOW_STATUSES.has(workflow.status)) {
      deps.json(res, 200, await readWorkflowArtifacts(deps.repoRoot, projectId));
      return true;
    }
    const existingPass = (await readWorkflowArtifacts(deps.repoRoot, projectId)).teamRolePasses.find((row) => row.workflowId === workflowId && row.roleId === roleId);
    const synced = await buildRolePassFromSubagentStatus({
      workflowId,
      roleId: roleId as TeamRoleId,
      sessionId: deps.optionalString(body.sessionId) ?? teamRoleSessionId(workflowId, roleId as TeamRoleId),
      subagentRunId: deps.optionalString(body.subagentRunId),
      asyncDir: deps.optionalString(body.asyncDir),
      inputArtifactRefs: deps.optionalStringArray(body.inputArtifactRefs) ?? existingPass?.inputArtifactRefs ?? [],
      outputArtifactRefs: deps.optionalStringArray(body.outputArtifactRefs) ?? existingPass?.outputArtifactRefs ?? [],
      contextManifestRef: existingPass?.contextManifestRef,
      contextManifest: existingPass?.contextManifest,
      transcriptRef: deps.optionalString(body.transcriptRef),
    });
    await upsertTeamRolePass(deps.repoRoot, projectId, synced.rolePass);
    const ingest = await ingestCompletedRoleOutput({
      projectId,
      workflowId,
      roleId: roleId as TeamRoleId,
      rolePass: synced.rolePass,
      asyncDir: synced.asyncDir,
      statusOutputFile: synced.status.outputFile,
      repoRoot: deps.repoRoot,
    });
    const projectedPass = ingest.ok ? synced.rolePass : invalidRoleOutputPass(synced.rolePass, ingest.reason);
    if (!ingest.ok) await upsertTeamRolePass(deps.repoRoot, projectId, projectedPass);
    await projectTeamRolePass(projectId, workflowId, roleId as TeamRoleId, projectedPass, deps);
    deps.json(res, 200, await readWorkflowArtifacts(deps.repoRoot, projectId));
    return true;
  }

  return false;
}
