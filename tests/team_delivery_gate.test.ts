import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  appendQualityDecisionLedger,
  batchPath,
  createCatWorkflowRun,
  createProjectManifest,
  createTaskWorkspace,
  createWorkspace,
  importCsvBatch,
  readBatch,
  readCatWorkflowRun,
  readQualityDecisionLedger,
  readWorkflowArtifacts,
  runTeamDeliveryGate,
  writeJsonFile,
} from "@linguist-agent/cat-data";
import { handleWorkflowRoute } from "../packages/cat-server/src/routes/workflow_routes.js";

async function createCsvProject(root: string, projectId: string, rows: string[]): Promise<void> {
  const customerRoot = join(root, "customer", projectId);
  await mkdir(customerRoot, { recursive: true });
  const csvPath = join(customerRoot, "batch.csv");
  await writeFile(csvPath, ["SegmentID,Source,Target,Status", ...rows].join("\n"), "utf8");
  await createProjectManifest(root, customerRoot, { projectId, sourceLanguage: "zh-CN", targetLanguage: "en-US" });
  await importCsvBatch(root, { projectId, csvPath, batchId: "b1" });
}

async function createTeamTask(
  root: string,
  input: { projectId: string; taskId: string; workflowId: string; segmentIds: string[]; taskBatchId?: string },
): Promise<void> {
  await createTaskWorkspace(root).create({
    projectId: input.projectId,
    taskId: input.taskId,
    title: input.taskId,
    intent: "Review delivery readiness",
    kind: "delivery",
    scope: { batchId: input.taskBatchId ?? "b1", segmentIds: input.segmentIds },
  });
  await createCatWorkflowRun(root, {
    projectId: input.projectId,
    taskId: input.taskId,
    batchId: "b1",
    workflowId: input.workflowId,
    intent: "game_localization_team_run",
    includeReadiness: false,
  });
}

const root = await mkdtemp(join(tmpdir(), "la-team-delivery-gate-"));
await createCsvProject(root, "blocked", [
  "s1,开始 {0},Start,draft",
  "s2,继续,Continue,draft",
]);
await createTeamTask(root, { projectId: "blocked", taskId: "task-whole", workflowId: "workflow-whole", segmentIds: [] });

const whole = await runTeamDeliveryGate(root, { projectId: "blocked", workflowId: "workflow-whole" });
assert.equal(whole.authoritative, true);
assert.equal(whole.scope.coversWholeBatch, true);
assert.deepEqual(whole.scope.segmentIds, ["s1", "s2"]);
assert.equal(whole.rawQa.workflowId, "workflow-whole");
assert.equal(whole.rawQa.findings.some((finding) => finding.segmentId === "s1" && finding.type === "placeholder_mismatch"), true);
assert.equal(whole.readiness.status, "fail");
assert.equal(whole.authorization.authorized, false);
assert.equal(whole.modelPolicy.mayCreateQa, false);
assert.equal(whole.modelPolicy.mayAuthorizeExport, false);

let artifacts = await readWorkflowArtifacts(root, "blocked");
assert.equal(artifacts.deliveryQaReports.filter((report) => report.workflowId === "workflow-whole").length, 1);
const wholeArtifact = artifacts.teamRoleArtifacts.find((artifact) => artifact.id === "workflow-whole:delivery-gate");
assert.equal(wholeArtifact?.type, "delivery_gate");
assert.equal((wholeArtifact?.data as { authoritative?: boolean }).authoritative, true);
let ledger = await readQualityDecisionLedger(root, "blocked");
assert.equal(ledger.some((event) => event.kind === "delivery_finding" && event.decision === "open"), true);
assert.equal(ledger.at(-1)?.kind, "export_authorization");
assert.equal(ledger.at(-1)?.decision, "blocked");

{
  const responses: Array<{ status: number; data: unknown }> = [];
  let spawned = 0;
  await handleWorkflowRoute({ method: "POST" } as never, {} as never, [
    "api", "projects", "blocked", "workflows", "workflow-whole", "run-role",
  ], "blocked", {
    repoRoot: root,
    json: (_res, status, data) => responses.push({ status, data }),
    readBody: async () => ({ roleId: "delivery_manager", execute: true, deliveryQa: { reportId: "model-forgery" } }),
    requireString: (value, label) => {
      if (typeof value !== "string" || !value) throw new Error(`${label} is required.`);
      return value;
    },
    optionalString: (value) => typeof value === "string" && value ? value : undefined,
    optionalStringArray: (value) => Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : undefined,
    optionalBoolean: (value) => value === undefined ? undefined : Boolean(value),
    spawnSubagentRun: async () => {
      spawned += 1;
      return {};
    },
  });
  assert.equal(responses.at(-1)?.status, 200);
  assert.equal(spawned, 0, "the authoritative Delivery gate must not spawn a model role");
  artifacts = await readWorkflowArtifacts(root, "blocked");
  const pass = artifacts.teamRolePasses.find((row) => row.workflowId === "workflow-whole" && row.roleId === "delivery_manager");
  assert.equal(pass?.status, "completed");
  assert.equal(pass?.modelId, "cat-kernel");
  assert.equal(artifacts.deliveryQaReports.some((report) => report.reportId === "model-forgery"), false);
  assert.equal((await readCatWorkflowRun(root, "blocked", "workflow-whole")).completedStepIds.includes("delivery_manager"), true);
}

await createTeamTask(root, { projectId: "blocked", taskId: "task-subset", workflowId: "workflow-subset", segmentIds: ["s2"] });
const subset = await runTeamDeliveryGate(root, { projectId: "blocked", workflowId: "workflow-subset" });
assert.equal(subset.scope.coversWholeBatch, false);
assert.deepEqual(subset.scope.segmentIds, ["s2"]);
assert.equal(subset.rawQa.findings.some((finding) => finding.segmentId === "s1"), false);
assert.equal(subset.findings.some((finding) => finding.code === "TASK_SCOPE_DOES_NOT_COVER_BATCH"), true);
assert.equal(subset.authorization.authorized, false);
artifacts = await readWorkflowArtifacts(root, "blocked");
const subsetReport = artifacts.deliveryQaReports.find((report) => report.workflowId === "workflow-subset");
assert.ok(subsetReport);
assert.equal(subsetReport.findings.some((finding) => finding.segmentId === "s1"), false);

await createTeamTask(root, { projectId: "blocked", taskId: "task-stale", workflowId: "workflow-stale", segmentIds: ["missing"] });
await assert.rejects(runTeamDeliveryGate(root, { projectId: "blocked", workflowId: "workflow-stale" }), /segment scope is stale: missing/);
await createTeamTask(root, {
  projectId: "blocked",
  taskId: "task-wrong-batch",
  workflowId: "workflow-wrong-batch",
  segmentIds: [],
  taskBatchId: "b2",
});
await assert.rejects(runTeamDeliveryGate(root, { projectId: "blocked", workflowId: "workflow-wrong-batch" }), /task batch scope does not match/);

await createCsvProject(root, "spelling", ["s1,开始,Strat,draft"]);
await createTeamTask(root, { projectId: "spelling", taskId: "task-spelling", workflowId: "workflow-spelling", segmentIds: [] });
const spelling = await runTeamDeliveryGate(root, { projectId: "spelling", workflowId: "workflow-spelling" });
assert.equal(spelling.rawQa.findings.some((finding) => finding.type === "spelling"), true);
assert.equal(spelling.findings.filter((finding) => finding.segmentId === "s1" && finding.code === "spelling").length, 1);
assert.equal(spelling.findings.some((finding) => finding.code === "SPELLING_UNKNOWN_WORD"), false, "one spelling defect must require one decision, not duplicate Quality and Delivery waivers");

await createCsvProject(root, "waived", ["s1,继续,Continue,draft"]);
const waivedBatch = await readBatch(root, "waived", "b1");
waivedBatch.segments[0]!.target = " Continue ";
await writeJsonFile(batchPath(createWorkspace(root, "waived"), "b1"), waivedBatch);
await createTeamTask(root, { projectId: "waived", taskId: "task-waived", workflowId: "workflow-waived", segmentIds: [] });

const beforeDecision = await runTeamDeliveryGate(root, { projectId: "waived", workflowId: "workflow-waived" });
const edgeWhitespace = beforeDecision.rawQa.findings.find((finding) => finding.type === "edge_whitespace");
assert.ok(edgeWhitespace);
assert.equal(beforeDecision.authorization.authorized, false);
await runTeamDeliveryGate(root, { projectId: "waived", workflowId: "workflow-waived" });
ledger = await readQualityDecisionLedger(root, "waived");
assert.equal(ledger.filter((event) => event.kind === "export_authorization").length, 1, "an identical gate run must not append another authorization");
await appendQualityDecisionLedger(root, {
  projectId: "waived",
  batchId: "b1",
  workflowId: "workflow-waived",
  findingId: edgeWhitespace.id,
  kind: "team_decision",
  decision: "query",
  reason: "Model proposes asking whether whitespace is intentional.",
  actor: "delivery_manager",
});
const afterModelQuery = await runTeamDeliveryGate(root, { projectId: "waived", workflowId: "workflow-waived" });
assert.equal(afterModelQuery.authorization.authorized, false, "a model query must not authorize export");
await appendQualityDecisionLedger(root, {
  projectId: "waived",
  batchId: "b1",
  workflowId: "workflow-waived",
  findingId: edgeWhitespace.id,
  kind: "team_decision",
  decision: "accept",
  reason: "Model recommends accepting the finding.",
  actor: "delivery_manager",
});
const afterModelAccept = await runTeamDeliveryGate(root, { projectId: "waived", workflowId: "workflow-waived" });
assert.equal(afterModelAccept.authorization.authorized, false, "a model recommendation must not authorize export");
await appendQualityDecisionLedger(root, {
  projectId: "waived",
  batchId: "b1",
  workflowId: "workflow-waived",
  findingId: edgeWhitespace.id,
  kind: "delivery_waiver",
  decision: "accepted_risk",
  reason: "User confirmed the target whitespace is required by the client format.",
  actor: "user",
});
const afterWaiver = await runTeamDeliveryGate(root, { projectId: "waived", workflowId: "workflow-waived" });
assert.equal(afterWaiver.readiness.status, "warn", "raw readiness must keep a waived QA condition visible");
assert.equal(afterWaiver.findings.filter((finding) => finding.segmentId === "s1" && finding.code === "edge_whitespace").length, 1);
assert.equal(afterWaiver.findings.some((finding) => finding.code === "EDGE_WHITESPACE"), false, "a mirrored quality check must not require a second decision");
assert.equal(afterWaiver.authorization.authorized, true);
assert.equal(afterWaiver.authorization.waivedFindingIds.includes(edgeWhitespace.id), true);
await runTeamDeliveryGate(root, { projectId: "waived", workflowId: "workflow-waived" });
ledger = await readQualityDecisionLedger(root, "waived");
assert.equal(ledger.filter((event) => event.findingId === edgeWhitespace.id && event.decision === "open").length, 1);
assert.deepEqual(ledger.filter((event) => event.kind === "export_authorization").map((event) => event.decision), ["blocked", "authorized"]);
artifacts = await readWorkflowArtifacts(root, "waived");
assert.equal(artifacts.deliveryQaReports.filter((report) => report.workflowId === "workflow-waived").length, 1);

console.log("team delivery gate tests passed");
