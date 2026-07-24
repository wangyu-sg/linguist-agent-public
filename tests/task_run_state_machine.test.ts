import assert from "node:assert/strict";
import {
  applyTaskRunEventPage,
  TASK_RUN_STATUSES,
  TaskRunTransitionError,
  canTransitionTaskRunStatus,
  transitionTaskRunStatus,
  type TaskRunEventPage,
  type TaskRunStatus,
  type TaskWorkspaceSnapshot,
} from "../packages/cat-data/src/task_workspace_contract.js";

const expected: Record<TaskRunStatus, readonly TaskRunStatus[]> = {
  pending: ["pending", "active", "awaiting_input", "waiting", "stopping", "stopped", "failed", "stale", "complete"],
  active: ["active", "awaiting_input", "waiting", "stopping", "stopped", "failed", "stale", "complete"],
  awaiting_input: ["awaiting_input", "active", "waiting", "stopping", "stopped", "failed", "stale", "complete"],
  waiting: ["waiting", "active", "awaiting_input", "stopping", "stopped", "failed", "stale", "complete"],
  stopping: ["stopping", "stopped", "failed", "stale", "complete"],
  stopped: ["stopped", "active", "awaiting_input", "waiting"],
  failed: ["failed", "active", "awaiting_input", "waiting"],
  stale: ["stale"],
  complete: ["complete"],
};

for (const from of TASK_RUN_STATUSES) {
  for (const to of TASK_RUN_STATUSES) {
    const allowed = expected[from].includes(to);
    assert.equal(canTransitionTaskRunStatus(from, to), allowed, `${from} -> ${to}`);
    if (allowed) {
      assert.equal(transitionTaskRunStatus(from, to), to);
    } else {
      assert.throws(
        () => transitionTaskRunStatus(from, to),
        (error) => error instanceof TaskRunTransitionError
          && error.code === "TASK_RUN_INVALID_STATE_TRANSITION"
          && error.from === from
          && error.to === to,
      );
    }
  }
}

assert.equal(transitionTaskRunStatus(undefined, "pending"), "pending");
assert.equal(transitionTaskRunStatus("waiting", "stopping"), "stopping");
assert.equal(transitionTaskRunStatus("stopping", "stopped"), "stopped");
assert.equal(transitionTaskRunStatus("complete", "complete"), "complete");
assert.throws(() => transitionTaskRunStatus("complete", "failed"), TaskRunTransitionError);
assert.equal(transitionTaskRunStatus("failed", "active"), "active");
assert.equal(transitionTaskRunStatus("stopped", "active"), "active");
assert.equal(transitionTaskRunStatus("stopped", "awaiting_input"), "awaiting_input");
assert.throws(() => transitionTaskRunStatus("stale", "active"), TaskRunTransitionError);

const timestamp = "2026-07-22T00:00:00.000Z";
const terminalSnapshot: TaskWorkspaceSnapshot = {
  schemaVersion: 2,
  task: {
    id: "task-state-machine",
    owner: { kind: "standalone" },
    scope: { kind: "standalone", fileGrantIds: [] },
    title: "State machine",
    intent: "Prove terminal Run authority.",
    kind: "general",
    status: "complete",
    createdAt: timestamp,
    updatedAt: timestamp,
  },
  activeRunId: null,
  eventCursor: "task-state-machine:1",
  projectedAt: timestamp,
  runs: [{
    id: "run-state-machine",
    taskId: "task-state-machine",
    mode: "single",
    status: "complete",
    rootAgentThreadId: "run-state-machine.main",
    updatedAt: timestamp,
    completedAt: timestamp,
    stopAvailable: false,
    resumeAvailable: false,
  }],
  agentThreads: [{
    id: "run-state-machine.main",
    taskId: "task-state-machine",
    runId: "run-state-machine",
    parentThreadId: null,
    identity: {
      kind: "main",
      roleId: "linguist-agent",
      displayName: "Linguist Agent",
      roleLabel: "Main Agent",
      disclosureLabel: "Agent",
    },
    status: "complete",
    canReceiveUserMessage: true,
    handoffSummary: null,
    latestActivityId: null,
    childThreadIds: [],
    createdAt: timestamp,
    updatedAt: timestamp,
  }],
  activities: [],
  artifacts: [],
  decisions: [],
};
const illegalReopenPage: TaskRunEventPage = {
  schemaVersion: 2,
  taskId: "task-state-machine",
  runId: "run-state-machine",
  afterCursor: "task-state-machine:1",
  nextCursor: "task-state-machine:2",
  hasMore: false,
  events: [{
    id: "event-illegal-reopen",
    cursor: "task-state-machine:2",
    seq: 2,
    taskId: "task-state-machine",
    runId: "run-state-machine",
    agentThreadId: "run-state-machine.main",
    type: "run_upsert",
    occurredAt: timestamp,
    run: {
      ...terminalSnapshot.runs[0],
      status: "active",
      completedAt: null,
      stopAvailable: true,
    },
  }],
};
assert.throws(
  () => applyTaskRunEventPage(terminalSnapshot, illegalReopenPage),
  TaskRunTransitionError,
);

process.stdout.write("Task Run state machine tests passed\n");
