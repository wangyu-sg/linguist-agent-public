import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  createTaskWorkspace,
  parseRichArtifactDocument,
  parseTaskArtifact,
} from "@linguist-agent/cat-data";
import { assertProductionToolCapabilities } from "@linguist-agent/cat-runtime";
import { parseAgentPlanUpdatePayload, updateAgentPlanArtifact } from "../packages/cat-server/src/general_agent_runs.ts";
import { parseServerToolRequest } from "../packages/cat-server/src/general_worker_rpc.ts";

const now = "2026-07-24T09:00:00.000Z";

async function taskWithActiveRun(root: string): Promise<void> {
  const workspace = createTaskWorkspace(root);
  await workspace.create({ owner: { kind: "standalone" }, taskId: "chat", title: "Plan", intent: "Track work", kind: "general" });
  await workspace.appendGenerated({ kind: "standalone", taskId: "chat", runId: "run", events: [{
    type: "run_upsert", agentThreadId: "run.main", occurredAt: now, run: {
      id: "run", taskId: "chat", mode: "single", status: "active", rootAgentThreadId: "run.main", planHash: null,
      estimatedCalls: 1, estimatedCallsBySource: { main: 1 }, startedAt: now, updatedAt: now, completedAt: null,
      stopAvailable: true, resumeAvailable: false,
    },
  }, {
    type: "thread_upsert", agentThreadId: "run.main", occurredAt: now, thread: {
      id: "run.main", taskId: "chat", runId: "run", parentThreadId: null,
      identity: { kind: "main", roleId: "linguist-agent", displayName: "Linguist Agent", roleLabel: "General Agent", disclosureLabel: "Agent" },
      status: "active", canReceiveUserMessage: true, handoffSummary: null, latestActivityId: null, childThreadIds: [], createdAt: now, updatedAt: now,
    },
  }] });
}

async function withTempTask(run: (root: string) => Promise<void>): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), "la-agent-plan-"));
  try {
    await taskWithActiveRun(root);
    await run(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

const fullPlan = {
  title: "Ship the release",
  items: [
    { id: "freeze-schema", text: "Freeze the todo schema", status: "completed" },
    { id: "wire-tool", text: "Wire the host tool", status: "in_progress" },
    { id: "ship-card", text: "Ship the Plan card", status: "pending" },
  ],
};

test("agent_plan is a canonical artifact type and unknown types stay rejected", () => {
  const artifact = parseTaskArtifact({
    id: "agent-plan:chat",
    taskId: "chat",
    runId: "run",
    type: "agent_plan",
    status: "reviewable",
    title: "Agent 工作计划",
    summary: "3 项工作计划，1 项已完成",
    scope: { kind: "standalone", fileGrantIds: [] },
    version: 1,
    provenance: { agentThreadId: "run.main", activityId: "a1", evidenceRefs: [], parentArtifactIds: [] },
    availableDecisions: [],
    content: {},
    createdAt: now,
    updatedAt: now,
  });
  assert.equal(artifact.type, "agent_plan");
  assert.throws(() => parseTaskArtifact({ ...JSON.parse(JSON.stringify(artifact)), type: "todo_list" }), /type/);
});

test("the plan payload is strictly validated", () => {
  assert.deepEqual(parseAgentPlanUpdatePayload(fullPlan), {
    title: "Ship the release",
    items: fullPlan.items,
  });
  assert.throws(() => parseAgentPlanUpdatePayload({ items: [] }), /empty/);
  assert.throws(() => parseAgentPlanUpdatePayload({ items: [{ id: "a", text: "x", status: "done" }] }), /status/);
  assert.throws(() => parseAgentPlanUpdatePayload({ items: [
    { id: "a", text: "x", status: "pending" },
    { id: "a", text: "y", status: "pending" },
  ] }), /unique/);
  assert.throws(() => parseAgentPlanUpdatePayload({ items: [{ id: "a", text: "x\0y", status: "pending" }] }), /NUL/);
  assert.throws(() => parseAgentPlanUpdatePayload({ items: fullPlan.items, unexpected: true }), /[Uu]nexpected|unknown/i);
});

test("update_agent_plan writes versioned artifacts and a plan activity inside the active run", async () => {
  await withTempTask(async (root) => {
    const first = await updateAgentPlanArtifact({ repoRoot: root, taskId: "chat", runId: "run", agentThreadId: "run.main", payload: fullPlan });
    assert.equal(first.artifactId, "agent-plan:chat");
    assert.equal(first.version, 1);
    const second = await updateAgentPlanArtifact({
      repoRoot: root,
      taskId: "chat",
      runId: "run",
      agentThreadId: "run.main",
      payload: { ...fullPlan, items: fullPlan.items.map((item) => item.id === "wire-tool" ? { ...item, status: "completed" } : item) },
    });
    assert.equal(second.version, 2);

    const workspace = createTaskWorkspace(root);
    const snapshot = await workspace.open({ kind: "standalone", taskId: "chat" });
    const artifact = snapshot.artifacts.find((entry) => entry.id === "agent-plan:chat");
    assert.ok(artifact, "the plan artifact is persisted");
    assert.equal(artifact.version, 2);
    assert.equal(artifact.type, "agent_plan");
    const document = parseRichArtifactDocument(artifact.content.document);
    const [block] = document.blocks;
    assert.equal(block.type, "todo_list");
    if (block.type !== "todo_list") return;
    assert.equal(block.items.length, 3);
    assert.equal(block.items.filter((item) => item.status === "completed").length, 2);

    const planActivities = snapshot.activities.filter((entry) => entry.type === "plan");
    assert.equal(planActivities.length, 2);
    assert.deepEqual(planActivities[1]!.refs.artifactIds, ["agent-plan:chat"]);
    assert.equal(planActivities[1]!.tool?.name, "agent_plan_update");
  });
});

test("plan updates reject a stale run", async () => {
  await withTempTask(async (root) => {
    await assert.rejects(
      updateAgentPlanArtifact({ repoRoot: root, taskId: "chat", runId: "old-run", agentThreadId: "run.main", payload: fullPlan }),
      /no longer active/,
    );
  });
});

test("agent_plan_update has reviewed capability metadata", () => {
  assert.doesNotThrow(() => assertProductionToolCapabilities(["agent_plan_update"]));
});

test("the worker server-tool bridge envelope is strictly parsed", () => {
  assert.deepEqual(parseServerToolRequest({ tool: "agent_plan_update", payload: fullPlan }), { tool: "agent_plan_update", payload: fullPlan });
  assert.throws(() => parseServerToolRequest({ tool: "bash", payload: {} }), /not registered/);
  assert.throws(() => parseServerToolRequest({ payload: {} }), /tool/);
});
