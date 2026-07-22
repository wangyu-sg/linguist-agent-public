import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  NotificationPreferencesConflictError,
  notificationCandidateForTaskEvent,
  readNotificationPreferences,
  writeNotificationPreferences,
} from "../packages/cat-server/src/notification_preferences.js";

const root = await mkdtemp(join(tmpdir(), "la-notification-preferences-"));
try {
  const defaults = await readNotificationPreferences(root);
  assert.deepEqual(defaults, {
    schemaVersion: 1,
    enabled: true,
    categories: { waiting: true, failed: true, completed: true, permission: true },
    updatedAt: null,
  });

  const saved = await writeNotificationPreferences(root, {
    enabled: false,
    categories: { waiting: true, failed: false, completed: true, permission: false },
    expectedUpdatedAt: null,
  }, () => "2026-07-16T01:02:03.000Z");
  assert.equal(saved.updatedAt, "2026-07-16T01:02:03.000Z");
  assert.deepEqual(JSON.parse(await readFile(join(root, "data/settings/notifications.json"), "utf8")), saved);

  await assert.rejects(
    writeNotificationPreferences(root, {
      enabled: true,
      categories: { waiting: true, failed: true, completed: true, permission: true },
      expectedUpdatedAt: null,
    }),
    NotificationPreferencesConflictError,
  );
  await assert.rejects(
    writeNotificationPreferences(root, {
      enabled: true,
      categories: { waiting: true, failed: true, completed: true, permission: "yes" as never },
      expectedUpdatedAt: saved.updatedAt,
    }),
    /permission must be a boolean/,
  );

  const runBase = {
    id: "event-1",
    cursor: "task-1:1",
    seq: 1,
    taskId: "task-1",
    runId: "run-1",
    occurredAt: "2026-07-16T01:02:03.000Z",
  } as const;
  assert.deepEqual(notificationCandidateForTaskEvent("project-1", {
    ...runBase,
    type: "run_upsert",
    run: {
      id: "run-1",
      taskId: "task-1",
      mode: "single",
      status: "awaiting_input",
      rootAgentThreadId: "run-1.main",
      updatedAt: runBase.occurredAt,
      stopAvailable: true,
      resumeAvailable: false,
    },
  }), {
    id: "project-1:event-1",
    category: "waiting",
    projectId: "project-1",
    taskId: "task-1",
    runId: "run-1",
    occurredAt: runBase.occurredAt,
  });
  assert.equal(notificationCandidateForTaskEvent("project-1", {
    ...runBase,
    type: "activity_append",
    activity: {
      id: "run-1.permission.request-1",
      taskId: "task-1",
      runId: "run-1",
      agentThreadId: "run-1.main",
      seq: 1,
      type: "elicitation",
      status: "blocked",
      actor: { kind: "agent", id: "linguist-agent", displayName: "Linguist Agent" },
      title: "Permission required · web_search",
      refs: { artifactIds: [], evidenceRefs: [], decisionIds: [] },
      createdAt: runBase.occurredAt,
      updatedAt: runBase.occurredAt,
    },
  })?.category, "permission");
} finally {
  await rm(root, { recursive: true, force: true });
}

console.log("notification preference tests passed");
