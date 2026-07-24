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
import {
  assertProductionToolCapabilities,
  buildAgentPermissionContract,
  prepareGeneralAgentSessionPlan,
} from "@linguist-agent/cat-runtime";
import { parseAgentPresentPayload, presentAgentAnswerArtifact } from "../packages/cat-server/src/general_agent_runs.ts";
import { parseServerToolRequest } from "../packages/cat-server/src/general_worker_rpc.ts";
import { routeGeneralServerTool } from "../packages/cat-server/src/general_worker_runtime.ts";

const now = "2026-07-24T09:00:00.000Z";

async function taskWithActiveRun(root: string): Promise<void> {
  const workspace = createTaskWorkspace(root);
  await workspace.create({ owner: { kind: "standalone" }, taskId: "chat", title: "Present", intent: "Present visual answers", kind: "general" });
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
  const root = await mkdtemp(join(tmpdir(), "la-agent-present-"));
  try {
    await taskWithActiveRun(root);
    await run(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

const presentation = {
  title: "Release comparison",
  blocks: [
    { id: "intro", type: "markdown", markdown: "# Findings\n\nTwo options compared." },
    {
      id: "comparison",
      type: "table",
      caption: "Options",
      columns: [{ key: "option", label: "Option" }, { key: "cost", label: "Cost", align: "right" }],
      rows: [{ option: "A", cost: 3 }, { option: "B", cost: 5 }],
    },
    {
      id: "trend",
      type: "chart",
      kind: "bar",
      series: [{ label: "Weekly", points: [{ label: "W1", value: 4 }, { label: "W2", value: 7 }] }],
    },
    { id: "change", type: "diff", label: "Config change", before: "old", after: "new" },
    { id: "source-file", type: "file_reference", file: { path: "/tmp/report.md", label: "report.md", role: "output" } },
  ],
};

test("agent_present is a canonical artifact type and unknown types stay rejected", () => {
  const artifact = parseTaskArtifact({
    id: "agent-present:chat:1",
    taskId: "chat",
    runId: "run",
    type: "agent_present",
    status: "reviewable",
    title: "Release comparison",
    summary: "5 个内容块",
    scope: { kind: "standalone", fileGrantIds: [] },
    version: 1,
    provenance: { agentThreadId: "run.main", activityId: "a1", evidenceRefs: [], parentArtifactIds: [] },
    availableDecisions: [],
    content: {},
    createdAt: now,
    updatedAt: now,
  });
  assert.equal(artifact.type, "agent_present");
  assert.throws(() => parseTaskArtifact({ ...JSON.parse(JSON.stringify(artifact)), type: "presentation" }), /type/);
});

test("the present payload is strictly validated", () => {
  const parsed = parseAgentPresentPayload(presentation);
  assert.equal(parsed.title, "Release comparison");
  assert.deepEqual(parsed.blocks.map((block) => block.type), ["markdown", "table", "chart", "diff", "file_reference"]);
  assert.throws(() => parseAgentPresentPayload({ blocks: [] }), /empty/);
  assert.throws(() => parseAgentPresentPayload({ title: "x" }), /blocks/);
  assert.throws(() => parseAgentPresentPayload({ blocks: [{ id: "t", type: "todo_list", items: [{ id: "a", text: "x", status: "pending" }] }] }), /not presentable/);
  assert.throws(() => parseAgentPresentPayload({ blocks: [{ id: "i", type: "image", file: { path: "/tmp/a.png", label: "a", role: "output" }, alt: "a" }] }), /not presentable/);
  assert.throws(() => parseAgentPresentPayload({ blocks: [{ id: "o", type: "page_overlay", page: 1, width: 10, height: 10, regions: [{ polygon: [[0, 0], [1, 1]] }] }] }), /not presentable/);
  assert.throws(() => parseAgentPresentPayload({ blocks: [{ id: "m", type: "markdown", markdown: "<script>alert(1)</script>" }] }), /executable|HTML/i);
  assert.throws(() => parseAgentPresentPayload({ ...presentation, unexpected: true }), /[Uu]nexpected|unknown/i);
  assert.throws(() => parseAgentPresentPayload({ blocks: [{ id: "t", type: "table", columns: [{ key: "a", label: "A" }], rows: [{ a: 1, b: 2 }] }] }), /unknown columns/);
});

test("present writes a new versioned artifact and an artifact_update activity inside the active run", async () => {
  await withTempTask(async (root) => {
    const first = await presentAgentAnswerArtifact({ repoRoot: root, taskId: "chat", runId: "run", agentThreadId: "run.main", payload: presentation });
    assert.match(first.artifactId, /^agent-present:chat:/);
    assert.equal(first.version, 1);
    const second = await presentAgentAnswerArtifact({ repoRoot: root, taskId: "chat", runId: "run", agentThreadId: "run.main", payload: { blocks: presentation.blocks } });
    assert.notEqual(second.artifactId, first.artifactId, "every present call creates a new artifact instead of versioning one");
    assert.equal(second.version, 1);

    const workspace = createTaskWorkspace(root);
    const snapshot = await workspace.open({ kind: "standalone", taskId: "chat" });
    const artifact = snapshot.artifacts.find((entry) => entry.id === first.artifactId);
    assert.ok(artifact, "the present artifact is persisted");
    assert.equal(artifact.type, "agent_present");
    assert.equal(artifact.status, "reviewable");
    const document = parseRichArtifactDocument(artifact.content.document);
    assert.equal(document.generator, "Linguist Agent · agent_present");
    assert.equal(document.title, "Release comparison");
    assert.equal(document.blocks.length, 5);
    const untitled = parseRichArtifactDocument(snapshot.artifacts.find((entry) => entry.id === second.artifactId)!.content.document);
    assert.equal(untitled.title, "Agent 可视化回答", "the server stamps a default title");

    const presentActivities = snapshot.activities.filter((entry) => entry.type === "artifact_update" && entry.tool?.name === "agent_present");
    assert.equal(presentActivities.length, 2);
    assert.deepEqual(presentActivities[0]!.refs.artifactIds, [first.artifactId]);
    assert.deepEqual(presentActivities[1]!.refs.artifactIds, [second.artifactId]);
  });
});

test("present rejects a stale run", async () => {
  await withTempTask(async (root) => {
    await assert.rejects(
      presentAgentAnswerArtifact({ repoRoot: root, taskId: "chat", runId: "old-run", agentThreadId: "run.main", payload: presentation }),
      /no longer active/,
    );
  });
});

test("agent_present has reviewed capability metadata", () => {
  assert.doesNotThrow(() => assertProductionToolCapabilities(["agent_present"]));
});

test("the worker server-tool bridge envelope is strictly parsed", () => {
  assert.deepEqual(parseServerToolRequest({ tool: "agent_present", payload: presentation }), { tool: "agent_present", payload: presentation });
  assert.throws(() => parseServerToolRequest({ tool: "bash", payload: {} }), /not registered/);
});

test("server tool requests route by tool name without silent fallback", async () => {
  const calls: string[] = [];
  const handlers = {
    agent_plan_update: async (_payload: unknown) => { calls.push("plan"); return "plan-ok"; },
    agent_present: async (_payload: unknown) => { calls.push("present"); return "present-ok"; },
  };
  assert.equal(await routeGeneralServerTool(handlers, { tool: "agent_present", payload: {} }), "present-ok");
  assert.equal(await routeGeneralServerTool(handlers, { tool: "agent_plan_update", payload: {} }), "plan-ok");
  assert.deepEqual(calls, ["present", "plan"]);
  await assert.rejects(routeGeneralServerTool({}, { tool: "agent_present", payload: {} }), /unavailable/);
});

test("agent_present is registered but not initial-active in Run-backed sessions", async () => {
  const root = await mkdtemp(join(tmpdir(), "la-present-plan-"));
  const agentDir = await mkdtemp(join(tmpdir(), "la-present-plan-agent-"));
  try {
    await createTaskWorkspace(root).create({ owner: { kind: "standalone" }, taskId: "present-chat", title: "Present Chat", intent: "Register the present tool.", kind: "general" });
    const plan = await prepareGeneralAgentSessionPlan({
      runtimeRoot: root,
      taskId: "present-chat",
      runId: "run-present",
      rootAgentThreadId: "run-present.main",
      agentDir,
      permissionContract: buildAgentPermissionContract({ mode: "ask" }),
      managedResources: { extensions: [], skills: [], prompts: [], themes: [] },
    });
    assert.equal(plan.registeredToolNames.includes("agent_present"), true, "the present tool is registered for Run-backed sessions");
    assert.equal(plan.initialActiveToolNames.includes("agent_present"), false, "the present tool activates explicitly via capability_search");
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(agentDir, { recursive: true, force: true });
  }
});
