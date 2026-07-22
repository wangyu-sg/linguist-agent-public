import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  batchPath,
  createCatWorkflowRun,
  createTaskWorkspace,
  createWorkspace,
  prepareTeamRoleContext,
  writeJsonFile,
} from "@linguist-agent/cat-data";

const root = await mkdtemp(join(tmpdir(), "la-team-context-"));
const projectId = "project-1";
const batchId = "batch-1";
const batch = {
  schemaVersion: 1 as const,
  format: "csv_paste" as const,
  projectId,
  batchId,
  sourceFile: join(root, "private", "customer-source.csv"),
  sourceLanguage: "zh-CN",
  targetLanguage: "en-US",
  workflowStage: "translate" as const,
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
      id: "segment-1",
      source: "获得 {0} 颗勇者徽记",
      target: "",
      rawSource: "获得 {0} 颗勇者徽记",
      rawTarget: "",
      locked: false,
      status: "new" as const,
      duplicateKey: "获得 {0} 颗勇者徽记",
      placeholderCount: 1,
      unresolvedPlaceholderCount: 0,
      contextNote: "Reward toast",
    },
    {
      index: 2,
      id: "segment-secret",
      source: "未选中的客户机密句段",
      target: "Do not leak",
      rawSource: "未选中的客户机密句段",
      rawTarget: "Do not leak",
      locked: true,
      status: "confirmed" as const,
      duplicateKey: "未选中的客户机密句段",
      placeholderCount: 0,
      unresolvedPlaceholderCount: 0,
    },
  ],
};
await writeJsonFile(batchPath(createWorkspace(root, projectId), batchId), batch);

await createTaskWorkspace(root).create({
  projectId,
  taskId: "task-subset",
  title: "Translate selected row",
  intent: "translate",
  kind: "translation",
  scope: { batchId, segmentIds: ["segment-1"], sourceLocale: "zh-CN", targetLocale: "en-US" },
});
await createCatWorkflowRun(root, {
  projectId,
  taskId: "task-subset",
  batchId,
  workflowId: "workflow-subset",
  intent: "game_localization_team_run",
  userRequest: "Choose a professional default when ordinary linguistic context is missing.",
  includeReadiness: false,
});

const subset = await prepareTeamRoleContext(root, { projectId, workflowId: "workflow-subset", roleId: "translator" });
assert.equal(subset.status, "ready");
if (subset.status !== "ready") throw new Error(subset.blockers.join("; "));
assert.match(subset.prompt, /获得 \{0\} 颗勇者徽记/);
assert.match(subset.prompt, /Reward toast/);
assert.match(subset.prompt, /Choose a professional default when ordinary linguistic context is missing/);
assert.match(subset.prompt, /every constraint_pack call must include one of the allowed segment ids/);
assert.match(subset.prompt, /exactly one strict JSON object/);
assert.match(subset.prompt, /escape embedded ASCII double quotes/);
assert.doesNotMatch(subset.prompt, /未选中的客户机密句段|Do not leak/);
assert.doesNotMatch(subset.prompt, new RegExp(root.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
assert.equal(subset.evidenceScope.segmentIds.join(","), "segment-1");
assert.equal(subset.evidenceScope.allowedTools.includes("batch_read"), false);
assert.equal(subset.evidenceScope.allowedTools.includes("constraint_pack"), true);
assert.equal(subset.manifest.coverage?.taskSegments, 1);
assert.equal(subset.manifest.coverage?.inlineSegments, 1);
assert.equal(subset.manifest.coverage?.requiresPaging, false);
assert.equal(subset.manifest.hardConstraintsPreserved, true);

const repeated = await prepareTeamRoleContext(root, { projectId, workflowId: "workflow-subset", roleId: "translator" });
assert.equal(repeated.status, "ready");
if (repeated.status === "ready") {
  assert.equal(repeated.manifest.promptHash, subset.manifest.promptHash);
  assert.equal(repeated.manifest.contextHash, subset.manifest.contextHash);
}

await createTaskWorkspace(root).create({
  projectId,
  taskId: "task-batch",
  title: "Translate whole batch",
  intent: "translate",
  kind: "translation",
  scope: { batchId, segmentIds: [] },
});
await createCatWorkflowRun(root, {
  projectId,
  taskId: "task-batch",
  batchId,
  workflowId: "workflow-batch",
  intent: "game_localization_team_run",
  includeReadiness: false,
});
const wholeBatch = await prepareTeamRoleContext(root, { projectId, workflowId: "workflow-batch", roleId: "translator" });
assert.equal(wholeBatch.status, "ready");
if (wholeBatch.status === "ready") {
  assert.equal(wholeBatch.evidenceScope.allowedTools.includes("batch_read"), true);
  assert.equal(wholeBatch.manifest.coverage?.batchSegments, 2);
  assert.equal(wholeBatch.manifest.coverage?.taskSegments, 2);
  assert.equal(wholeBatch.manifest.coverage?.inlineSegments, 0);
  assert.equal(wholeBatch.manifest.coverage?.requiresPaging, true);
}

await createTaskWorkspace(root).create({
  projectId,
  taskId: "task-stale",
  title: "Stale segment",
  intent: "translate",
  kind: "translation",
  scope: { batchId, segmentIds: ["missing-segment"] },
});
await createCatWorkflowRun(root, {
  projectId,
  taskId: "task-stale",
  batchId,
  workflowId: "workflow-stale",
  intent: "game_localization_team_run",
  includeReadiness: false,
});
const stale = await prepareTeamRoleContext(root, { projectId, workflowId: "workflow-stale", roleId: "translator" });
assert.equal(stale.status, "blocked");
if (stale.status === "blocked") assert.match(stale.blockers.join("\n"), /missing-segment/);

batch.segments[0]!.source = "超长句段".repeat(16_000);
batch.segments[0]!.rawSource = batch.segments[0]!.source;
await writeJsonFile(batchPath(createWorkspace(root, projectId), batchId), batch);
const oversized = await prepareTeamRoleContext(root, { projectId, workflowId: "workflow-subset", roleId: "translator" });
assert.equal(oversized.status, "ready");
if (oversized.status === "ready") {
  assert.equal(oversized.manifest.overBudget, undefined, "large context is measured but not labelled against an invented default ceiling");
  assert.equal(oversized.manifest.hardConstraintsPreserved, true);
  assert.match(oversized.prompt, /超长句段/);
}

console.log("team context builder tests passed");
