import assert from "node:assert/strict";
import {
  TaskExecutionTimelineError,
  appendTaskExecutionSnapshot,
  appendTaskSessionConfigChange,
  assertTaskExecutionTimelineAppendOnly,
  parseTaskRunEventPage,
  type TaskExecutionSnapshot,
  type TaskRun,
} from "../packages/cat-data/src/task_workspace_contract.js";

const hash = (value: string): string => value.repeat(64).slice(0, 64);
const run: TaskRun = {
  id: "run-execution",
  taskId: "task-execution",
  mode: "single",
  status: "active",
  rootAgentThreadId: "run-execution.main",
  updatedAt: "2026-07-22T00:00:00.000Z",
  stopAvailable: true,
  resumeAvailable: false,
  executionSnapshots: [],
  configChanges: [],
};
const first: TaskExecutionSnapshot = {
  schemaVersion: 1,
  executionId: "run-execution.execution.1",
  runId: run.id,
  threadId: run.rootAgentThreadId,
  turnId: run.id,
  runtimeEpochId: "run-execution.epoch.1",
  configRevision: 1,
  providerId: "provider",
  modelId: "model-a",
  reasoningEffort: null,
  executionProfile: null,
  promptHash: hash("a"),
  toolManifestHash: hash("b"),
  resourceSnapshotHash: hash("c"),
  capabilityGrantHash: hash("d"),
  contextInputHash: hash("e"),
  createdAt: "2026-07-22T00:00:01.000Z",
};

const withFirst = appendTaskExecutionSnapshot(run, first);
assert.deepEqual(withFirst.executionSnapshots, [first]);
assert.deepEqual(run.executionSnapshots, [], "append must not mutate the prior Run");

const changed = appendTaskSessionConfigChange(withFirst, {
  schemaVersion: 1,
  changeId: "run-execution.config.2",
  runId: run.id,
  threadId: run.rootAgentThreadId,
  actor: "user",
  fromRevision: 1,
  toRevision: 2,
  changes: { modelId: { from: "model-a", to: "model-b" } },
  effectiveFrom: "next_turn",
  compatibility: "compatible",
  createdAt: "2026-07-22T00:00:02.000Z",
});
const second = { ...first, executionId: "run-execution.execution.2", turnId: "turn-2", configRevision: 2, modelId: "model-b", createdAt: "2026-07-22T00:00:03.000Z" };
const withSecond = appendTaskExecutionSnapshot(changed, second);
assert.deepEqual(withSecond.executionSnapshots, [first, second]);
const parsedPage = parseTaskRunEventPage({
  schemaVersion: 2,
  taskId: run.taskId,
  runId: run.id,
  afterCursor: `${run.taskId}:0`,
  nextCursor: `${run.taskId}:1`,
  hasMore: false,
  events: [{
    id: "event-execution-timeline",
    cursor: `${run.taskId}:1`,
    seq: 1,
    taskId: run.taskId,
    runId: run.id,
    agentThreadId: run.rootAgentThreadId,
    type: "run_upsert",
    occurredAt: second.createdAt,
    run: withSecond,
  }],
});
assert.equal(parsedPage.events[0]?.run?.executionSnapshots?.[1]?.modelId, "model-b");

assert.throws(
  () => appendTaskExecutionSnapshot({ ...withSecond, executionSnapshots: [{ ...first, modelId: "tampered" }, second] }, { ...second, executionId: "third" }),
  TaskExecutionTimelineError,
);
assert.throws(
  () => assertTaskExecutionTimelineAppendOnly(withSecond, { ...withSecond, executionSnapshots: [{ ...first, modelId: "tampered" }, second] }),
  /immutable and append-only/,
);
assert.throws(
  () => appendTaskSessionConfigChange(changed, { ...changed.configChanges![0]!, changeId: "skip", fromRevision: 2, toRevision: 4 }),
  /increment config revision by exactly one/,
);
assert.throws(
  () => appendTaskExecutionSnapshot({ ...run, executionSnapshots: undefined, configChanges: undefined }, first),
  /Legacy epoch is read-only/,
);
assert.throws(
  () => appendTaskExecutionSnapshot(changed, { ...second, runtimeEpochId: "run-execution.epoch.2" }),
  /compatible change must retain the runtime epoch/,
);

const restartChange = appendTaskSessionConfigChange(withSecond, {
  schemaVersion: 1,
  changeId: "run-execution.config.3",
  runId: run.id,
  threadId: run.rootAgentThreadId,
  actor: "system",
  fromRevision: 2,
  toRevision: 3,
  changes: { retrievalProfile: { from: "project", to: "project-plus-library" } },
  effectiveFrom: "new_runtime_epoch",
  compatibility: "requires_runtime_restart",
  createdAt: "2026-07-22T00:00:04.000Z",
});
const third = {
  ...second,
  executionId: "run-execution.execution.3",
  turnId: "turn-3",
  runtimeEpochId: "run-execution.epoch.2",
  configRevision: 3,
  resourceSnapshotHash: hash("f"),
  createdAt: "2026-07-22T00:00:05.000Z",
};
assert.equal(appendTaskExecutionSnapshot(restartChange, third).executionSnapshots?.[2]?.runtimeEpochId, "run-execution.epoch.2");
assert.throws(
  () => appendTaskExecutionSnapshot(restartChange, { ...third, runtimeEpochId: second.runtimeEpochId }),
  /must create a new runtime epoch/,
);

const compactionChange = appendTaskSessionConfigChange(withSecond, {
  schemaVersion: 1,
  changeId: "run-execution.config.compaction",
  runId: run.id,
  threadId: run.rootAgentThreadId,
  actor: "system",
  fromRevision: 2,
  toRevision: 3,
  changes: { reasoningEffort: { from: null, to: "high" } },
  effectiveFrom: "after_compaction",
  compatibility: "requires_compaction",
  createdAt: "2026-07-22T00:00:04.000Z",
});
assert.equal(appendTaskExecutionSnapshot(compactionChange, {
  ...third,
  runtimeEpochId: second.runtimeEpochId,
  reasoningEffort: "high",
}).executionSnapshots?.[2]?.reasoningEffort, "high");
assert.throws(
  () => appendTaskExecutionSnapshot(compactionChange, third),
  /must retain the runtime epoch/,
);

const forkChange = appendTaskSessionConfigChange(withSecond, {
  schemaVersion: 1,
  changeId: "run-execution.config.fork",
  runId: run.id,
  threadId: run.rootAgentThreadId,
  actor: "user",
  fromRevision: 2,
  toRevision: 3,
  changes: { permissionProfile: { from: "ask", to: "auto" } },
  effectiveFrom: "next_turn",
  compatibility: "requires_fork",
  createdAt: "2026-07-22T00:00:04.000Z",
});
assert.throws(
  () => appendTaskExecutionSnapshot(forkChange, third),
  /cannot create another execution snapshot in the same Run/,
);

process.stdout.write("execution snapshot tests passed\n");
