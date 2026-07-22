import { strict as assert } from "node:assert";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createCatWorkflowRun, createProjectManifest, createTaskWorkspace, DETERMINISTIC_TEAM_ROLE_IDS, readCatWorkflowRun, readWorkflowArtifacts, TEAM_ROLE_IDS } from "@linguist-agent/cat-data";
import { prepareTeamExecution, handleWorkflowRoute, preflightTeamWorkflowRun, startTeamWorkflowRun } from "../packages/cat-server/src/routes/workflow_routes.js";
import { createSingleTaskRunProjector } from "../packages/cat-server/src/single_task_run_projection.js";
import { createPrepareTeamExecutionTool } from "../packages/cat-server/src/main_team_host_tool.js";

const repoRoot = await mkdtemp(join(tmpdir(), "la-team-contract-"));
const batchDir = join(repoRoot, "data", "projects", "p1", "batches", "b1");
const sourceFile = join(batchDir, "fixture.csv");
await mkdir(batchDir, { recursive: true });
await writeFile(sourceFile, "SegmentID,Source,Target\ns1,\u5df2\u786e\u8ba4\u6587\u672c,Confirmed text\n", "utf8");
await createProjectManifest(repoRoot, batchDir, { projectId: "p1", sourceLanguage: "zh-CN", targetLanguage: "en-US" });
await writeFile(join(batchDir, "batch.json"), `${JSON.stringify({
  schemaVersion: 1,
  format: "csv_paste",
  projectId: "p1",
  batchId: "b1",
  sourceFile,
  sourceLanguage: "zh-CN",
  targetLanguage: "en-US",
  createdAt: "2026-07-11T00:00:00.000Z",
  updatedAt: "2026-07-11T00:00:00.000Z",
  tagReport: {
    totalSegments: 1,
    placeholderSegments: 0,
    masterMatchedSegments: 1,
    masterUnmatchedSegments: 0,
    replacedPlaceholders: 0,
    unresolvedPlaceholders: 0,
    unresolvedRuntimePlaceholders: 0,
    unresolvedTagPlaceholders: 0,
    tagCountMismatches: 0,
  },
  duplicateSourceGroups: [],
  segments: [{
    index: 1,
    id: "s1",
    source: "\u5df2\u786e\u8ba4\u6587\u672c",
    target: "Confirmed text",
    rawSource: "\u5df2\u786e\u8ba4\u6587\u672c",
    rawTarget: "Confirmed text",
    locked: false,
    status: "confirmed",
    duplicateKey: "\u5df2\u786e\u8ba4\u6587\u672c",
    placeholderCount: 0,
    unresolvedPlaceholderCount: 0,
  }],
})}\n`, "utf8");
await createCatWorkflowRun(repoRoot, {
  projectId: "p1",
  batchId: "b1",
  workflowId: "w1",
  intent: "game_localization_team_run",
  includeReadiness: false,
});

const responses: Array<{ status: number; data: unknown }> = [];
const deps = {
  repoRoot,
  json: (_res: unknown, status: number, data: unknown) => responses.push({ status, data }),
  readBody: async () => ({}),
  requireString: (value: unknown, label: string) => {
    if (typeof value !== "string" || !value) throw new Error(`${label} is required.`);
    return value;
  },
  optionalString: (value: unknown) => typeof value === "string" && value ? value : undefined,
  optionalStringArray: (value: unknown) => Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : undefined,
  optionalBoolean: (value: unknown) => value === undefined ? undefined : Boolean(value),
};
const route = ["api", "projects", "p1", "workflows", "w1"];

const taskWorkspace = createTaskWorkspace(repoRoot);
await taskWorkspace.create({
  projectId: "p1",
  taskId: "task-main-team",
  title: "Localize the imported batch",
  intent: "Prepare a safe game-localization pass.",
  kind: "translation",
  scope: { batchId: "b1", segmentIds: [], sourceLocale: "zh-CN", targetLocale: "en-US" },
});
const mainProjector = await createSingleTaskRunProjector({
  repoRoot,
  projectId: "p1",
  taskId: "task-main-team",
  runId: "run-main-team",
  userMessage: "Translate this batch.",
  startedAt: "2026-07-16T00:00:00.000Z",
  modelRoute: "test/main",
});
await mainProjector.flush();

const prepareTool = createPrepareTeamExecutionTool((reason) => prepareTeamExecution({
  projectId: "p1",
  taskId: "task-main-team",
  runId: "run-main-team",
  reason,
  deps,
}));
assert.deepEqual(Object.keys((prepareTool.parameters as { properties: object }).properties), ["reason"]);
const prepared = (await prepareTool.execute(
  "prepare-call",
  { reason: "A Translator should handle the pending segment while deterministic CAT gates protect delivery." },
  undefined,
  undefined,
  {} as never,
)).details;
const preparedAgain = await prepareTeamExecution({
  projectId: "p1",
  taskId: "task-main-team",
  runId: "run-main-team",
  reason: "Do not create a duplicate proposal.",
  deps,
});
assert.deepEqual(preparedAgain, prepared, "repeated preparation must return the existing pending proposal");
assert.equal(prepared.taskId, "task-main-team");
assert.equal(prepared.runId, "run-main-team", "Main preparation must upgrade the current Run instead of creating an overlapping Run");
assert.match(prepared.planHash, /^[0-9a-f]{64}$/);

const preparedSnapshot = await taskWorkspace.open({ projectId: "p1", taskId: "task-main-team" });
const preparedRun = preparedSnapshot.runs.find((row) => row.id === prepared.runId);
assert.equal(preparedSnapshot.runs.length, 1);
assert.equal(preparedRun?.mode, "team");
assert.equal(preparedRun?.status, prepared.status);
assert.equal(preparedSnapshot.decisions.filter((row) => row.id === prepared.decisionId && row.status === "required").length, 1);
assert.equal(preparedSnapshot.activities.filter((row) => row.title === "Team preflight").length, 1);
const preparedActivity = preparedSnapshot.activities.find((row) => row.title === "Team preflight");
assert.match(preparedActivity?.body ?? "", /A Translator should handle the pending segment/);
assert.doesNotMatch(preparedActivity?.body ?? "", /Do not create a duplicate proposal/);
const preparedWorkflow = await readCatWorkflowRun(repoRoot, "p1", prepared.runId);
assert.equal(preparedWorkflow.taskId, "task-main-team");
assert.equal(preparedWorkflow.status, "ready", "preparation must not start a Team role or advance the Workflow");

mainProjector.markTeamPrepared();
mainProjector.accept({
  type: "assistant_final",
  ts: "2026-07-16T00:01:00.000Z",
  text: "I prepared a Team plan for your approval.",
});
await mainProjector.flush();
const preparedAfterMainReply = await taskWorkspace.open({ projectId: "p1", taskId: "task-main-team" });
assert.equal(preparedAfterMainReply.runs.find((row) => row.id === prepared.runId)?.status, prepared.status, "Main's reply must not complete the waiting Team Run");
assert.equal(preparedAfterMainReply.activities.some((row) => row.title === "Team plan ready"), true);

await handleWorkflowRoute({ method: "POST" } as never, {} as never, [...route, "preflight"], "p1", deps);
const plan = responses.at(-1)?.data as { planHash: string; selectedRoleIds: string[]; readiness: { status: string } };
assert.equal(plan.readiness.status, "ready");
assert.ok(plan.selectedRoleIds.length > 0);
assert.match(plan.planHash, /^[0-9a-f]{64}$/);

await handleWorkflowRoute({ method: "GET", url: "/api/projects/p1/workflows/w1/events?after=0" } as never, {} as never, [...route, "events"], "p1", deps);
const eventPayload = responses.at(-1)?.data as { events: Array<{ cursor: number }>; nextCursor: number };
assert.equal(eventPayload.events.length > 0, true);
assert.equal(eventPayload.nextCursor, eventPayload.events.at(-1)?.cursor);

const decisionDeps = { ...deps, readBody: async () => ({ decision: "query", reason: "Need a screenshot before pre-LQA.", segmentId: "s1" }) };
await handleWorkflowRoute({ method: "POST" } as never, {} as never, [...route, "decisions"], "p1", decisionDeps);
assert.equal((await readWorkflowArtifacts(repoRoot, "p1")).teamDecisions.some((row) => row.workflowId === "w1" && row.decision === "query"), true);

const startDeps = { ...deps, readBody: async () => ({ planHash: plan.planHash, execute: false }) };
await assert.rejects(
  handleWorkflowRoute({ method: "POST" } as never, {} as never, [...route, "start"], "p1", { ...deps, readBody: async () => ({ execute: false }) }),
  /planHash is required/,
);
await handleWorkflowRoute({ method: "POST" } as never, {} as never, [...route, "start"], "p1", startDeps);
const start = responses.at(-1)?.data as { roleId: string };
assert.equal(start.roleId, plan.selectedRoleIds[0]);

await createCatWorkflowRun(repoRoot, {
  projectId: "p1",
  batchId: "b1",
  workflowId: "w2",
  intent: "game_localization_team_run",
  includeReadiness: false,
});
const engineDeps = {
  ...deps,
  readProjectAgentSettings: async () => ({
    teamRoleSettings: {
      profiles: TEAM_ROLE_IDS.map((roleId) => ({ roleId, enabled: DETERMINISTIC_TEAM_ROLE_IDS.has(roleId) })),
    },
  }),
};
const enginePlan = await preflightTeamWorkflowRun({ projectId: "p1", workflowId: "w2", project: false, deps: engineDeps });
assert.deepEqual(enginePlan.selectedRoleIds, ["loc_engineer_gate", "delivery_manager"]);
await startTeamWorkflowRun({
  projectId: "p1",
  workflowId: "w2",
  planHash: enginePlan.planHash,
  awaitUntilPause: true,
  deps: engineDeps,
});
assert.equal((await readCatWorkflowRun(repoRoot, "p1", "w2")).status, "completed");

console.log("team workflow contract tests passed");
