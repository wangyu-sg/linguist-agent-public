import assert from "node:assert/strict";
import test from "node:test";
import type { TaskRecord } from "../../../packages/cat-data/src/task_workspace_contract.ts";
import { WorkspaceStore } from "../src/renderer/data/workspace-store.ts";
import { sortSidebarTasks, statusPresentation, taskBucket } from "../src/renderer/workspace/sidebar-task-state.ts";

const task = (id: string, updatedAt: string): TaskRecord => ({
  id,
  owner: { kind: "project", projectId: "project-one" },
  scope: { kind: "project", batchId: null, segmentIds: [], sourceLocale: null, targetLocale: null },
  title: id,
  intent: id,
  kind: "general",
  status: "active",
  createdAt: updatedAt,
  updatedAt,
});

test("Sidebar never presents Task.status=active as a live Run without a canonical summary", () => {
  const row = task("historical-active", "2026-07-16T00:03:00.000Z");
  const state = { ...new WorkspaceStore().getState(), tasks: [row] };
  assert.deepEqual(statusPresentation(row, state), { label: "进行中", state: "neutral" });
  assert.equal(taskBucket(row, state), "recent");
});

test("Sidebar uses canonical active Run status and update time", () => {
  const latestRun = task("latest-run", "2026-07-16T00:00:00.000Z");
  const olderRun = task("older-run", "2026-07-16T00:02:00.000Z");
  const state = {
    ...new WorkspaceStore().getState(),
    tasks: [olderRun, latestRun],
    activeRunsByTaskId: {
      "latest-run": { taskId: "latest-run", runId: "run-latest", status: "active" as const, updatedAt: "2026-07-16T00:04:00.000Z", stopAvailable: true },
      "older-run": { taskId: "older-run", runId: "run-older", status: "active" as const, updatedAt: "2026-07-16T00:01:00.000Z", stopAvailable: true },
    },
  };
  assert.deepEqual(statusPresentation(latestRun, state), { label: "运行中", state: "running" });
  assert.equal(taskBucket(latestRun, state), "running");
  assert.deepEqual(sortSidebarTasks(state.tasks, state).map((row) => row.id), ["latest-run", "older-run"]);
});
