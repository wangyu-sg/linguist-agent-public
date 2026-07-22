import assert from "node:assert/strict";
import test from "node:test";
import { parseNotificationCandidate, shouldPresentNotification } from "../src/notification-policy.mjs";

const candidate = {
  id: "project-1:event-1",
  category: "failed",
  projectId: "project-1",
  taskId: "task-1",
  runId: "run-1",
  occurredAt: "2026-07-16T01:02:03.000Z",
  title: "Task 失败",
  body: "审校当前批次",
};

test("notification candidates cross the preload boundary only after strict validation", () => {
  assert.deepEqual(parseNotificationCandidate(candidate), candidate);
  assert.equal(parseNotificationCandidate({ ...candidate, category: "marketing" }), null);
  assert.equal(parseNotificationCandidate({ ...candidate, taskId: "" }), null);
  assert.equal(parseNotificationCandidate({ ...candidate, body: 42 }), null);
});

test("foreground current Task is quiet while background or another Task is notified", () => {
  assert.equal(shouldPresentNotification(candidate, {
    windowFocused: true,
    presentedTask: { projectId: "project-1", taskId: "task-1" },
  }), false);
  assert.equal(shouldPresentNotification(candidate, {
    windowFocused: false,
    presentedTask: { projectId: "project-1", taskId: "task-1" },
  }), true);
  assert.equal(shouldPresentNotification(candidate, {
    windowFocused: true,
    presentedTask: { projectId: "project-1", taskId: "task-2" },
  }), true);
});
