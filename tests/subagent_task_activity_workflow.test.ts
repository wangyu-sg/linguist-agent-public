import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createTaskWorkspace, defaultSubagentAsyncRoot } from "@linguist-agent/cat-data";
import { handleWorkflowRoute } from "../packages/cat-server/src/routes/workflow_routes.js";
import { verifiedPromptRequestBudget } from "./prompt_budget_fixture.js";

const root = await mkdtemp(join(tmpdir(), "la-subagent-workflow-"));
const taskId = "task-subagent-bridge";
const workflowId = "workflow-subagent-bridge";
const subagentRunId = `subagent-bridge-${Date.now()}`;
const asyncDir = join(defaultSubagentAsyncRoot(), subagentRunId);
const producerRunId = `subagent-producer-artifact-${Date.now()}`;
const producerAsyncDir = join(defaultSubagentAsyncRoot(), producerRunId);
const fixture = join(dirname(fileURLToPath(import.meta.url)), "fixtures", "pi-subagents-events.v1.jsonl");
process.env.LA_RUNTIME_CACHE_ROOT = join(root, "cache");
await mkdir(asyncDir, { recursive: true });
await writeFile(join(asyncDir, "events.jsonl"), await readFile(fixture, "utf8"), "utf8");
await writeFile(join(asyncDir, "status.json"), JSON.stringify({
  lifecycleArtifactVersion: 1,
  runId: subagentRunId,
  mode: "single",
  state: "running",
  agent: "la-team-editor",
  startedAt: 1783684800000,
  lastUpdate: 1783684801000,
  outputFile: join(asyncDir, "output-0.log"),
  steps: [{ agent: "la-team-editor", status: "running", model: "deepseek/deepseek-v4-flash" }],
}), "utf8");

try {
  await createTaskWorkspace(root).create({
    projectId: "project-one",
    taskId,
    title: "Subagent bridge",
    intent: "Trace a real Team role",
    kind: "review",
  });
  let body: Record<string, unknown> = { taskId, workflowId, intent: "game_localization_team_run", includeReadiness: false };
  const deps = {
    repoRoot: root,
    json: () => undefined,
    readBody: async () => body,
    requireString: (value: unknown, label: string) => {
      if (typeof value !== "string" || !value) throw new Error(`${label} is required.`);
      return value;
    },
    optionalString: (value: unknown) => typeof value === "string" && value ? value : undefined,
    optionalStringArray: (value: unknown) => Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : undefined,
    optionalBoolean: (value: unknown) => value === undefined ? undefined : Boolean(value),
    resolveModelPromptTokenBudget: async (provider, modelId) => verifiedPromptRequestBudget(provider, modelId),
  };
  assert.equal(await handleWorkflowRoute({ method: "POST" } as never, {} as never, ["api", "projects", "project-one", "workflows"], "project-one", deps), true);

  body = { roleId: "producer", execute: false };
  assert.equal(await handleWorkflowRoute(
    { method: "POST" } as never,
    {} as never,
    ["api", "projects", "project-one", "workflows", workflowId, "run-role"],
    "project-one",
    deps,
  ), true);
  let preparedSnapshot = await createTaskWorkspace(root).open({ projectId: "project-one", taskId });
  assert.equal(preparedSnapshot.activities.some((row) => row.type === "evidence_read" && row.tool?.name === "team_context_prepare"), true);
  assert.equal(preparedSnapshot.artifacts.some((row) => row.type === "evidence_pack" && row.title === "Producer context"), true);

  await mkdir(producerAsyncDir, { recursive: true });
  const producerOutput = join(producerAsyncDir, "output-0.log");
  await writeFile(producerOutput, JSON.stringify({
    summary: "Brief ready for review.",
    brief: {
      projectGoal: "Localize the selected task.",
      scope: ["Selected batch"],
      knownAssets: ["CAT batch"],
      missingInputs: [],
      risks: [],
      handoffNotes: ["Review before translation."],
    },
  }), "utf8");
  await writeFile(join(producerAsyncDir, "status.json"), JSON.stringify({
    lifecycleArtifactVersion: 1,
    runId: producerRunId,
    mode: "single",
    state: "complete",
    agent: "la-team-producer",
    startedAt: 1783684800000,
    endedAt: 1783684801000,
    outputFile: producerOutput,
    steps: [{ agent: "la-team-producer", status: "completed", model: "deepseek/deepseek-v4-flash" }],
  }), "utf8");
  body = { roleId: "producer", asyncDir: producerAsyncDir };
  assert.equal(await handleWorkflowRoute({ method: "POST" } as never, {} as never, [
    "api", "projects", "project-one", "workflows", workflowId, "role-status",
  ], "project-one", deps), true);
  preparedSnapshot = await createTaskWorkspace(root).open({ projectId: "project-one", taskId });
  const briefArtifact = preparedSnapshot.artifacts.find((row) => row.title === "Brief ready for review.");
  assert.ok(briefArtifact, "completed Team role artifacts must enter the canonical task");
  assert.equal(
    preparedSnapshot.decisions.some((row) => row.artifactId === briefArtifact.id && row.status === "required"),
    true,
    "every reviewable Team artifact must create a task decision instead of becoming passive inspector text",
  );

  body = { roleId: "editor", asyncDir };
  const roleStatusPath = ["api", "projects", "project-one", "workflows", workflowId, "role-status"];
  assert.equal(await handleWorkflowRoute({ method: "POST" } as never, {} as never, roleStatusPath, "project-one", deps), true);
  let snapshot = await createTaskWorkspace(root).open({ projectId: "project-one", taskId });
  assert.equal(snapshot.activities.some((row) => row.type === "evidence_read" && row.tool?.name === "tm_lookup"), true);
  assert.equal(snapshot.activities.some((row) => row.type === "tool_action" && row.tool?.name === "read"), true);
  assert.equal(snapshot.activities.some((row) => row.type === "evidence_read" && row.tool?.name === "read"), false);
  const activityCount = snapshot.activities.length;

  assert.equal(await handleWorkflowRoute({ method: "POST" } as never, {} as never, roleStatusPath, "project-one", deps), true);
  snapshot = await createTaskWorkspace(root).open({ projectId: "project-one", taskId });
  assert.equal(snapshot.activities.length, activityCount, "repeated role-status projection must be idempotent");
} finally {
  await rm(asyncDir, { recursive: true, force: true });
  await rm(producerAsyncDir, { recursive: true, force: true });
  await rm(root, { recursive: true, force: true });
}

console.log("subagent task activity workflow tests passed");
