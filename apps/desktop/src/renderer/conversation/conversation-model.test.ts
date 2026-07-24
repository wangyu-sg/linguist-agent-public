import {
  artifactSummaryDuplicatesReply,
  buildConversationItems,
  conversationItemsForSegment,
  isPermissionAuditActivity,
  summarizeProcessActivities,
} from "./conversation-model.ts";
import type {
  TaskActivity,
  TaskArtifact,
  TaskWorkspaceSnapshot,
} from "../../../../../packages/cat-data/src/task_workspace_contract.ts";

const assert = {
  equal(actual: unknown, expected: unknown): void {
    if (actual !== expected) throw new Error(`Expected ${String(expected)}, received ${String(actual)}`);
  },
  deepEqual(actual: unknown, expected: unknown): void {
    const left = JSON.stringify(actual);
    const right = JSON.stringify(expected);
    if (left !== right) throw new Error(`Expected ${right}, received ${left}`);
  },
};

function test(name: string, run: () => void): void {
  try {
    run();
  } catch (cause) {
    throw new Error(name, { cause });
  }
}

const at = "2026-07-18T06:00:00.000Z";

function activity(overrides: Partial<TaskActivity> = {}): TaskActivity {
  return {
    id: "a1",
    taskId: "task-one",
    runId: "run-one",
    agentThreadId: "thread-main",
    seq: 1,
    type: "tool_action",
    status: "done",
    actor: { kind: "agent", id: "main", displayName: "Linguist Agent" },
    title: "Linguist Agent started tm_lookup",
    body: null,
    refs: { artifactIds: [], evidenceRefs: [], decisionIds: [] },
    createdAt: at,
    updatedAt: at,
    ...overrides,
  };
}

function snapshotWith(activities: TaskActivity[], artifacts: TaskArtifact[] = []): TaskWorkspaceSnapshot {
  return {
    task: { id: "task-one", intent: "测试", title: "测试" },
    runs: [],
    agentThreads: [],
    activities,
    artifacts,
    decisions: [],
  } as unknown as TaskWorkspaceSnapshot;
}

test("consecutive process activity collapses into one group regardless of tool kind, errors stay visible", () => {
  const items = buildConversationItems(snapshotWith([
    activity({ id: "a1", type: "tool_action", createdAt: "2026-07-18T06:00:01.000Z" }),
    activity({ id: "a2", type: "tool_action", createdAt: "2026-07-18T06:00:02.000Z" }),
    activity({ id: "a3", type: "evidence_read", createdAt: "2026-07-18T06:00:03.000Z" }),
    activity({ id: "a4", type: "error", createdAt: "2026-07-18T06:00:04.000Z" }),
    activity({ id: "a5", type: "tool_action", createdAt: "2026-07-18T06:00:05.000Z" }),
  ]));
  const groups = items.filter((item) => item.kind === "process");
  const singles = items.filter((item) => item.kind === "activity");
  assert.equal(groups.length, 2);
  const group = groups[0]!;
  if (group.kind !== "process") throw new Error("expected a process group");
  assert.equal(group.activities.length, 3);
  assert.deepEqual(group.activities.map((a) => a.id), ["a1", "a2", "a3"]);
  // 全部连续工作过程共用一条折叠行，错误仍独立可见。
  assert.equal(singles.length, 1);
  assert.deepEqual(singles.map((item) => item.kind === "activity" ? item.activity.id : ""), ["a4"]);
});

test("segment companion reuses the canonical conversation while keeping other segment activity out", () => {
  const items = buildConversationItems(snapshotWith([
    activity({ id: "a1", refs: { artifactIds: [], evidenceRefs: [], decisionIds: [], segmentIds: ["s1"] } }),
    activity({ id: "a2", refs: { artifactIds: [], evidenceRefs: [], decisionIds: [], segmentIds: ["s2"] } }),
    activity({ id: "a3", type: "final_response", body: "第一句答复", refs: { artifactIds: [], evidenceRefs: [], decisionIds: [], segmentIds: ["s1"] } }),
  ]));
  const segmentItems = conversationItemsForSegment(items, "s1");
  const process = segmentItems.find((item) => item.kind === "process");
  if (!process || process.kind !== "process") throw new Error("expected a segment process group");
  assert.deepEqual(process.activities.map((row) => row.id), ["a1"]);
  assert.equal(segmentItems.some((item) => item.kind === "activity" && item.activity.id === "a3"), true);
  assert.equal(JSON.stringify(segmentItems).includes("a2"), false);
});

test("documents and human messages break process groups", () => {
  const items = buildConversationItems(snapshotWith([
    activity({ id: "a1", type: "tool_action", createdAt: "2026-07-18T06:00:01.000Z" }),
    activity({ id: "a2", type: "final_response", body: "答复", createdAt: "2026-07-18T06:00:02.000Z" }),
    activity({ id: "a3", type: "tool_action", createdAt: "2026-07-18T06:00:03.000Z" }),
    activity({ id: "a4", type: "tool_action", createdAt: "2026-07-18T06:00:04.000Z" }),
  ]));
  const groups = items.filter((item) => item.kind === "process");
  assert.equal(groups.length, 2);
  const group = groups[1]!;
  if (group.kind !== "process") throw new Error("expected a process group");
  assert.equal(group.activities.length, 2);
  assert.equal(items.some((item) => item.kind === "process" && item.activities[0]?.id === "a1"), true);
});

test("process summaries use semantic tense, targets, and repeat counts", () => {
  const first = activity({
    id: "read-one",
    tool: { name: "read", effect: "read", target: "README.md" },
  });
  const second = activity({
    id: "read-two",
    tool: { name: "read", effect: "read", target: "PRODUCT.md" },
  });
  assert.deepEqual(summarizeProcessActivities([first, second]), {
    title: "已读取",
    detail: "README.md · PRODUCT.md",
    repeatCount: 2,
  });
  assert.equal(summarizeProcessActivities([{ ...first, status: "running" }], true).title, "正在读取");
});

test("terminal Worked divider appears immediately before the root final reply", () => {
  const finalAt = "2026-07-18T06:00:04.000Z";
  const snapshot = snapshotWith([
    activity({ id: "a1", type: "tool_action", createdAt: "2026-07-18T06:00:02.000Z" }),
    activity({ id: "a2", type: "final_response", body: "答复", createdAt: finalAt }),
  ]);
  snapshot.runs = [{
    id: "run-one",
    taskId: "task-one",
    mode: "single",
    status: "complete",
    rootAgentThreadId: "thread-main",
    startedAt: "2026-07-18T06:00:01.000Z",
    completedAt: "2026-07-18T06:00:05.000Z",
    updatedAt: "2026-07-18T06:00:05.000Z",
    stopAvailable: false,
    resumeAvailable: false,
  } as TaskWorkspaceSnapshot["runs"][number]];
  const items = buildConversationItems(snapshot);
  const groups = items.filter((item) => item.kind === "process");
  const workedIndex = items.findIndex((item) => item.kind === "run" && item.phase === "status");
  const replyIndex = items.findIndex((item) => item.kind === "activity" && item.activity.id === "a2");
  assert.equal(groups.length, 1);
  assert.equal(workedIndex + 1, replyIndex);
  assert.equal(items[workedIndex]?.occurredAt, finalAt);
});

test("a resumable Team Run is a first-class canonical recovery item", () => {
  const snapshot = snapshotWith([]);
  snapshot.runs = [{
    id: "team-recovery",
    taskId: "task-one",
    mode: "team",
    status: "stopped",
    rootAgentThreadId: "thread-main",
    startedAt: "2026-07-18T06:00:01.000Z",
    completedAt: "2026-07-18T06:00:06.000Z",
    updatedAt: "2026-07-18T06:00:06.000Z",
    stopAvailable: false,
    resumeAvailable: true,
  } as TaskWorkspaceSnapshot["runs"][number]];

  const items = buildConversationItems(snapshot);
  const recovery = items.find((item) => item.kind === "recovery");
  if (!recovery || recovery.kind !== "recovery") throw new Error("expected canonical recovery item");
  assert.equal(recovery.run.id, "team-recovery");
  assert.equal(items.some((item) => item.kind === "run" && item.phase === "status"), false);
});

test("a terminal Run collapses process activity split by intermediate Agent messages into one row", () => {
  const snapshot = snapshotWith([
    activity({ id: "tool-1", type: "tool_action", createdAt: "2026-07-18T06:00:02.000Z" }),
    activity({ id: "note", type: "message", body: "我继续检查。", createdAt: "2026-07-18T06:00:03.000Z" }),
    activity({ id: "tool-2", type: "evidence_read", createdAt: "2026-07-18T06:00:04.000Z" }),
    activity({ id: "reply", type: "final_response", body: "最终答复", createdAt: "2026-07-18T06:00:05.000Z" }),
  ]);
  snapshot.runs = [{
    id: "run-one",
    taskId: "task-one",
    mode: "single",
    status: "complete",
    rootAgentThreadId: "thread-main",
    startedAt: "2026-07-18T06:00:01.000Z",
    completedAt: "2026-07-18T06:00:06.000Z",
    updatedAt: "2026-07-18T06:00:06.000Z",
    stopAvailable: false,
    resumeAvailable: false,
  } as TaskWorkspaceSnapshot["runs"][number]];
  const items = buildConversationItems(snapshot);
  const groups = items.filter((item) => item.kind === "process");
  assert.equal(groups.length, 1);
  if (groups[0]?.kind !== "process") throw new Error("expected one process group");
  assert.deepEqual(groups[0].activities.map((row) => row.id), ["tool-1", "tool-2"]);
  const groupIndex = items.findIndex((item) => item.kind === "process");
  const workedIndex = items.findIndex((item) => item.kind === "run" && item.phase === "status");
  assert.equal(groupIndex + 1, workedIndex);
});

test("artifact summary that merely truncates the reply is flagged as duplicate", () => {
  const reply = activity({
    id: "r1",
    type: "final_response",
    body: "您说得对,context 里确实标了 research,但目前没有可用的网页搜索工具。",
    createdAt: "2026-07-18T06:00:02.000Z",
  });
  const duplicate = {
    id: "art-1",
    taskId: "task-one",
    runId: "run-one",
    type: "preview",
    status: "ready",
    title: "Agent result",
    summary: "您说得对,context 里确实标了 `research`,但目前没有可用的网页搜索工具… [truncated]",
    createdAt: "2026-07-18T06:00:03.000Z",
    updatedAt: "2026-07-18T06:00:03.000Z",
    scope: { segmentIds: [] },
    provenance: { agentThreadId: "thread-main", evidenceRefs: [], parentArtifactIds: [] },
  } as unknown as TaskArtifact;
  assert.equal(artifactSummaryDuplicatesReply(duplicate, [reply]), true);

  const independent = { ...duplicate, id: "art-2", summary: "句段 005 的术语证据包,含 3 条 TM 与 2 条术语。" } as TaskArtifact;
  assert.equal(artifactSummaryDuplicatesReply(independent, [reply]), false);
});

test("resolved permission audit lines stay out of chat while ordinary elicitation remains visible", () => {
  const permission = activity({
    id: "run-one.permission.request-one",
    type: "elicitation",
    status: "blocked",
    title: "Permission required · Trust Pi Extension executable code",
  });
  const ordinary = activity({
    id: "run-one.question.one",
    type: "elicitation",
    status: "blocked",
    title: "Choose a target locale",
  });
  assert.equal(isPermissionAuditActivity(permission), true);
  assert.equal(isPermissionAuditActivity(ordinary), false);
  const items = buildConversationItems(snapshotWith([permission, ordinary]));
  assert.equal(items.some((item) => item.kind === "process" && item.activities.some((row) => row.id === permission.id)), false);
  assert.equal(items.some((item) => item.kind === "process" && item.activities.some((row) => row.id === ordinary.id)), true);
});

test("model changes derive one inline divider from canonical execution snapshots", () => {
  const makeRun = (id: string, providerId: string | null, modelId: string | null, startedAt: string) => ({
    id,
    taskId: "task-one",
    mode: "single",
    status: "complete",
    rootAgentThreadId: "thread-main",
    stopAvailable: false,
    resumeAvailable: false,
    startedAt,
    updatedAt: startedAt,
    completedAt: startedAt,
    executionSnapshots: providerId && modelId ? [{
      schemaVersion: 1,
      executionId: `${id}-exec`,
      runId: id,
      threadId: "thread-main",
      turnId: `${id}-turn`,
      runtimeEpochId: `${id}-epoch`,
      configRevision: 1,
      providerId,
      modelId,
      reasoningEffort: null,
      executionProfile: "custom",
      promptHash: "p",
      toolManifestHash: "t",
      resourceSnapshotHash: "r",
      capabilityGrantHash: "c",
      contextInputHash: "x",
      createdAt: startedAt,
    }] : [],
  });
  const snapshot = {
    task: { id: "task-one", intent: "测试", title: "测试" },
    runs: [
      makeRun("run-one", "openai", "gpt-a", "2026-07-18T06:00:00.000Z"),
      makeRun("run-two", "openai", "gpt-b", "2026-07-18T07:00:00.000Z"),
      makeRun("run-three", "openai", "gpt-b", "2026-07-18T08:00:00.000Z"),
      makeRun("run-four", null, null, "2026-07-18T09:00:00.000Z"),
    ],
    agentThreads: [],
    activities: [],
    artifacts: [],
    decisions: [],
  } as unknown as TaskWorkspaceSnapshot;
  const items = buildConversationItems(snapshot);
  const changes = items.filter((item) => item.kind === "model-change");
  // 只在 gpt-a → gpt-b 处产生一条分割线;同模型与缺失快照都不产生。
  assert.equal(changes.length, 1);
  const change = changes[0]!;
  if (change.kind !== "model-change") throw new Error("expected a model-change item");
  assert.deepEqual(change.fromModel, { providerId: "openai", modelId: "gpt-a" });
  assert.deepEqual(change.toModel, { providerId: "openai", modelId: "gpt-b" });
  assert.equal(change.occurredAt, "2026-07-18T07:00:00.000Z");
  const startedTwo = items.find((item) => item.id === "run:run-two:started");
  if (!startedTwo) throw new Error("expected the run-two started boundary");
  assert.equal(items.indexOf(change) < items.indexOf(startedTwo), true);
});
