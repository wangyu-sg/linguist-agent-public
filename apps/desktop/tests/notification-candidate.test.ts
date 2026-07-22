import assert from "node:assert/strict";
import test from "node:test";
import { notificationCandidateForTaskEvent, parseNotificationCandidate } from "../src/renderer/data/notification-candidate.ts";

const base = {
  id: "event-1",
  taskId: "task-1",
  runId: "run-1",
  occurredAt: "2026-07-16T01:02:03.000Z",
};

test("task event notification candidates preserve canonical scope", () => {
  const candidate = notificationCandidateForTaskEvent("project-1", {
    ...base,
    type: "run_upsert",
    run: { status: "awaiting_input" },
  });
  assert.deepEqual(candidate, {
    id: "project-1:event-1",
    category: "waiting",
    projectId: "project-1",
    taskId: "task-1",
    runId: "run-1",
    occurredAt: base.occurredAt,
    title: "Linguist Agent 等待你的决定",
    body: "当前 Task 需要你的输入才能继续。",
  });
});

test("only blocked elicitation activities create permission notifications", () => {
  assert.equal(notificationCandidateForTaskEvent("project-1", {
    ...base,
    type: "activity_append",
    activity: { type: "elicitation", status: "blocked" },
  })?.category, "permission");
  assert.equal(notificationCandidateForTaskEvent("project-1", {
    ...base,
    type: "activity_append",
    activity: { type: "message", status: "complete" },
  }), null);
});

test("notification clicks accept only the scoped renderer projection", () => {
  const candidate = notificationCandidateForTaskEvent("project-1", {
    ...base,
    type: "run_upsert",
    run: { status: "failed" },
  });
  assert.ok(candidate);
  const withCopy = { ...candidate, title: "失败", body: "回到 Task 查看详情。" };
  assert.deepEqual(parseNotificationCandidate(withCopy), withCopy);
  assert.equal(parseNotificationCandidate({ ...withCopy, projectId: "" }), null);
});
