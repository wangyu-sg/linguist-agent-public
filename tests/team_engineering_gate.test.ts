import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  batchPath,
  createCatWorkflowRun,
  createProjectManifest,
  createTaskWorkspace,
  createWorkspace,
  runDeterministicTeamEngineeringGate,
  readCatWorkflowRun,
  readWorkflowArtifacts,
  writeJsonFile,
} from "@linguist-agent/cat-data";
import { handleWorkflowRoute } from "../packages/cat-server/src/routes/workflow_routes.js";

const root = await mkdtemp(join(tmpdir(), "la-team-engineering-gate-"));
const customerRoot = join(root, "customer");
const sourceFile = join(customerRoot, "batch.csv");
await mkdir(customerRoot, { recursive: true });
await writeFile(sourceFile, "SegmentID,Source,Target\n", "utf8");
await createProjectManifest(root, customerRoot, { projectId: "project", sourceLanguage: "zh-CN", targetLanguage: "en-US" });

await writeJsonFile(batchPath(createWorkspace(root, "project"), "batch"), {
  schemaVersion: 1,
  format: "csv_paste",
  projectId: "project",
  batchId: "batch",
  sourceFile,
  sourceLanguage: "zh-CN",
  targetLanguage: "en-US",
  workflowStage: "translate",
  createdAt: "2026-07-11T00:00:00.000Z",
  updatedAt: "2026-07-11T00:00:00.000Z",
  tagReport: {
    totalSegments: 2,
    placeholderSegments: 1,
    masterMatchedSegments: 2,
    masterUnmatchedSegments: 0,
    replacedPlaceholders: 0,
    unresolvedPlaceholders: 0,
    unresolvedRuntimePlaceholders: 0,
    unresolvedTagPlaceholders: 0,
    tagCountMismatches: 0,
  },
  duplicateSourceGroups: [],
  segments: [
    {
      index: 1,
      id: "selected",
      source: "获得 {0} 颗宝石和 500 金币",
      target: "",
      rawSource: "获得 {0} 颗宝石和 500 金币",
      rawTarget: "",
      locked: false,
      status: "new",
      duplicateKey: "selected",
      placeholderCount: 1,
      unresolvedPlaceholderCount: 0,
    },
    {
      index: 2,
      id: "outside-locked",
      source: "客户锁定文本",
      target: "Changed locked target",
      rawSource: "客户锁定文本",
      rawTarget: "Original locked target",
      locked: true,
      status: "confirmed",
      duplicateKey: "outside-locked",
      placeholderCount: 0,
      unresolvedPlaceholderCount: 0,
    },
  ],
});

await createTaskWorkspace(root).create({
  projectId: "project",
  taskId: "task-subset",
  title: "Translate one row",
  intent: "translate",
  kind: "translation",
  scope: { batchId: "batch", segmentIds: ["selected"] },
});
await createCatWorkflowRun(root, {
  projectId: "project",
  taskId: "task-subset",
  batchId: "batch",
  workflowId: "workflow-subset",
  intent: "game_localization_team_run",
  includeReadiness: false,
});

const subset = await runDeterministicTeamEngineeringGate(root, {
  projectId: "project",
  workflowId: "workflow-subset",
  // A caller cannot replace the gate with model-authored readiness; unknown
  // input is ignored because the module reads only durable scope and CAT facts.
  engineeringGate: { ready: false, blockers: ["model says blocked"] },
} as { projectId: string; workflowId: string });
assert.equal(subset.authority, "deterministic_cat_kernel");
assert.equal(subset.ready, true, "an untranslated row is expected before translation and must not block entry");
assert.equal(subset.blockers.some((row) => row.includes("UNTRANSLATED_EDITABLE") || row.includes("model says blocked")), false);
assert.equal(subset.blockers.some((row) => row.includes("LOCKED_TARGET_CHANGED")), false, "out-of-scope rows must not block a segment-scoped Task");
assert.equal(subset.formatRules.some((row) => row.includes("placeholder")), true);
assert.equal(subset.formatRules.some((row) => row.includes("number")), true);
assert.equal(subset.artifact.type, "engineering_gate");
assert.equal(subset.artifact.roleId, "loc_engineer_gate");
const subsetData = subset.artifact.data as {
  authority: string;
  ready: boolean;
  scope: { segmentIds: string[] };
  constraintSummary: { scopedSegments: number };
};
assert.equal(subsetData.authority, "deterministic_cat_kernel");
assert.equal(subsetData.ready, true);
assert.deepEqual(subsetData.scope.segmentIds, ["selected"]);
assert.equal(subsetData.constraintSummary.scopedSegments, 1);
assert.doesNotMatch(JSON.stringify(subset.artifact), new RegExp(root.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")), "artifact must not leak local source paths");

{
  const responses: Array<{ status: number; data: unknown }> = [];
  let spawned = 0;
  await handleWorkflowRoute({ method: "POST" } as never, {} as never, [
    "api", "projects", "project", "workflows", "workflow-subset", "run-role",
  ], "project", {
    repoRoot: root,
    json: (_res, status, data) => responses.push({ status, data }),
    readBody: async () => ({ roleId: "loc_engineer_gate", execute: true, engineeringGate: { ready: false, blockers: ["model override"] } }),
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
  assert.equal(spawned, 0, "the authoritative engineering gate must not spawn a model role");
  const artifacts = await readWorkflowArtifacts(root, "project");
  const pass = artifacts.teamRolePasses.find((row) => row.workflowId === "workflow-subset" && row.roleId === "loc_engineer_gate");
  assert.equal(pass?.status, "completed");
  assert.equal(pass?.modelId, "cat-kernel");
  assert.equal((artifacts.teamRoleArtifacts.find((row) => row.id === "deterministic-engineering-gate:workflow-subset")?.data as { authority: string }).authority, "deterministic_cat_kernel");
  assert.equal((await readCatWorkflowRun(root, "project", "workflow-subset")).completedStepIds.includes("loc_engineer_gate"), true);
}

await createTaskWorkspace(root).create({
  projectId: "project",
  taskId: "task-batch",
  title: "Translate batch",
  intent: "translate",
  kind: "translation",
  scope: { batchId: "batch", segmentIds: [] },
});
await createCatWorkflowRun(root, {
  projectId: "project",
  taskId: "task-batch",
  batchId: "batch",
  workflowId: "workflow-batch",
  intent: "game_localization_team_run",
  includeReadiness: false,
});
const wholeBatch = await runDeterministicTeamEngineeringGate(root, { projectId: "project", workflowId: "workflow-batch" });
assert.equal(wholeBatch.ready, false);
assert.equal(wholeBatch.blockers.some((row) => row.includes("LOCKED_TARGET_CHANGED") && row.includes("outside-locked")), true);
assert.equal(wholeBatch.blockers.some((row) => row.includes("UNTRANSLATED_EDITABLE")), false);

await createTaskWorkspace(root).create({
  projectId: "project",
  taskId: "task-stale",
  title: "Stale Task",
  intent: "translate",
  kind: "translation",
  scope: { batchId: "batch", segmentIds: ["missing-row"] },
});
await createCatWorkflowRun(root, {
  projectId: "project",
  taskId: "task-stale",
  batchId: "batch",
  workflowId: "workflow-stale",
  intent: "game_localization_team_run",
  includeReadiness: false,
});
const stale = await runDeterministicTeamEngineeringGate(root, { projectId: "project", workflowId: "workflow-stale" });
assert.equal(stale.ready, false);
assert.equal(stale.blockers.some((row) => row.includes("SCOPE_SEGMENT_STALE") && row.includes("missing-row")), true);

await rm(sourceFile);
const missingSource = await runDeterministicTeamEngineeringGate(root, { projectId: "project", workflowId: "workflow-subset" });
assert.equal(missingSource.ready, false);
assert.equal(missingSource.blockers.some((row) => row.includes("SOURCE_FILE_MISSING")), true);

console.log("deterministic Team engineering gate tests passed");
