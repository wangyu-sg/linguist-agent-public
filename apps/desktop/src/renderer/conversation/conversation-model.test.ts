import {
  artifactSummaryDuplicatesReply,
  buildConversationItems,
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

test("consecutive process activities collapse into one group, errors stay visible", () => {
  const items = buildConversationItems(snapshotWith([
    activity({ id: "a1", type: "tool_action", createdAt: "2026-07-18T06:00:01.000Z" }),
    activity({ id: "a2", type: "tool_action", createdAt: "2026-07-18T06:00:02.000Z" }),
    activity({ id: "a3", type: "evidence_read", createdAt: "2026-07-18T06:00:03.000Z" }),
    activity({ id: "a4", type: "error", createdAt: "2026-07-18T06:00:04.000Z" }),
    activity({ id: "a5", type: "tool_action", createdAt: "2026-07-18T06:00:05.000Z" }),
  ]));
  const groups = items.filter((item) => item.kind === "process");
  const singles = items.filter((item) => item.kind === "activity");
  assert.equal(groups.length, 3);
  const group = groups[0]!;
  if (group.kind !== "process") throw new Error("expected a process group");
  assert.equal(group.activities.length, 2);
  assert.deepEqual(group.activities.map((a) => a.id), ["a1", "a2"]);
  // 不同语义各自成摘要，错误仍独立可见。
  assert.equal(singles.length, 1);
  assert.deepEqual(singles.map((item) => item.kind === "activity" ? item.activity.id : ""), ["a4"]);
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
  const workedIndex = items.findIndex((item) => item.kind === "run" && item.phase === "status");
  const replyIndex = items.findIndex((item) => item.kind === "activity" && item.activity.id === "a2");
  assert.equal(workedIndex + 1, replyIndex);
  assert.equal(items[workedIndex]?.occurredAt, finalAt);
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
