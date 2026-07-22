import assert from "node:assert/strict";
import {
  ActiveAgentRunRegistry,
  ActiveAgentRunResourceMutationError,
} from "../packages/cat-server/src/active_agent_runs.js";

let aborted = 0;
let disposed = 0;
const registry = new ActiveAgentRunRegistry(0);

const leaseRegistry = new ActiveAgentRunRegistry(0);
const pendingStart = leaseRegistry.acquireRunStartLease();
assert.equal(leaseRegistry.tryAcquireResourceMutationLease(), undefined);
pendingStart();
const releaseMutation = leaseRegistry.tryAcquireResourceMutationLease();
assert.ok(releaseMutation);
assert.throws(() => leaseRegistry.acquireRunStartLease(), ActiveAgentRunResourceMutationError);
assert.throws(
  () => leaseRegistry.register({ turnId: "mutation-race", scope: "project" }),
  ActiveAgentRunResourceMutationError,
);
releaseMutation();
releaseMutation();
const releasedStart = leaseRegistry.acquireRunStartLease();
releasedStart();
releasedStart();

registry.register({
  turnId: "turn-1",
  sessionId: "session-1",
  scope: "workflow_role",
  projectId: "proj",
  workflowId: "wf",
  roleId: "editor",
  session: {
    abort: async () => {
      aborted += 1;
    },
    dispose: () => {
      disposed += 1;
    },
  },
});
assert.throws(() => registry.register({
  turnId: "turn-1",
  scope: "project",
}), /already active/);

assert.equal(registry.list().length, 1);
assert.equal(registry.find({ projectId: "proj", workflowId: "wf", roleId: "editor" })?.turnId, "turn-1");
assert.deepEqual(registry.activeSessionIds({ projectId: "proj" }), ["session-1"]);

const stopped = await registry.stop({ projectId: "proj", workflowId: "wf", roleId: "editor", reason: "user stop" });
assert.equal(stopped.stopped, 1);
assert.equal(stopped.reason, "user stop");
assert.equal(aborted, 1);
assert.equal(disposed, 1);
assert.equal(registry.isStoppingOrStopped("turn-1"), true);

const duplicateStop = await registry.stop({ turnId: "turn-1", reason: "duplicate" });
assert.equal(duplicateStop.stopped, 0);
assert.equal(aborted, 1);
assert.equal(disposed, 1);

registry.unregister("turn-1");
assert.equal(registry.list().length, 0);

const noop = await registry.stop({ projectId: "missing" });
assert.equal(noop.stopped, 0);

const stoppedTaskRuns: string[] = [];
const stoppedTaskHooks: string[] = [];
for (const taskId of ["task-a", "task-b"]) {
  registry.register({
    turnId: `turn-${taskId}`,
    sessionId: `la-task-${taskId}`,
    scope: "project",
    projectId: "proj",
    taskId,
    beforeAbort: async () => { stoppedTaskHooks.push(taskId); },
    session: {
      abort: async () => { stoppedTaskRuns.push(taskId); },
      dispose: () => undefined,
    },
  });
}
const scopedTaskStop = await registry.stop({ projectId: "proj", taskId: "task-a" });
assert.equal(scopedTaskStop.stopped, 1);
assert.deepEqual(stoppedTaskHooks, ["task-a"]);
assert.deepEqual(stoppedTaskRuns, ["task-a"]);
assert.equal(registry.isStoppingOrStopped("turn-task-a"), true);
assert.equal(registry.isStoppingOrStopped("turn-task-b"), false);
registry.unregister("turn-task-a");
registry.unregister("turn-task-b");

let stoppedSubagentRunId = "";
const stopOrder: string[] = [];
registry.register({
  turnId: "turn-2",
  scope: "workflow_role",
  projectId: "proj",
  workflowId: "wf",
  roleId: "translator",
  beforeAbort: async () => {
    stopOrder.push("beforeAbort");
  },
  session: {
    abort: async () => {
      stopOrder.push("abort");
    },
    dispose: () => {
      stopOrder.push("dispose");
    },
  },
  subagentRunId: "sub-run-1",
  subagent: {
    stop: async (runId) => {
      stopOrder.push("subagent");
      stoppedSubagentRunId = runId;
    },
  },
});
const subagentStopped = await registry.stop({ projectId: "proj", workflowId: "wf", roleId: "translator" });
assert.equal(subagentStopped.stopped, 1);
assert.equal(stoppedSubagentRunId, "sub-run-1");
assert.deepEqual(stopOrder, ["beforeAbort", "subagent", "abort", "dispose"]);
registry.unregister("turn-2");

const failedHookOrder: string[] = [];
registry.register({
  turnId: "turn-failed-before-abort",
  scope: "project",
  beforeAbort: async () => {
    failedHookOrder.push("beforeAbort");
    throw new Error("pending interaction cancellation failed");
  },
  session: {
    abort: async () => { failedHookOrder.push("abort"); },
    dispose: () => { failedHookOrder.push("dispose"); },
  },
});
const failedHookStop = await registry.stop({ turnId: "turn-failed-before-abort" });
assert.deepEqual(failedHookStop.errors, ["pending interaction cancellation failed"]);
assert.deepEqual(failedHookOrder, ["beforeAbort", "abort", "dispose"]);
registry.unregister("turn-failed-before-abort");

let racedChildAbort = 0;
registry.register({
  turnId: "turn-child-already-terminal",
  scope: "workflow_role",
  subagentRunId: "sub-run-already-terminal",
  session: {
    abort: async () => { racedChildAbort += 1; },
    dispose: () => undefined,
  },
  subagent: {
    stop: async () => { throw new Error("Async run 'sub-run-already-terminal' was not found in the active session."); },
  },
});
const racedStop = await registry.stop({ turnId: "turn-child-already-terminal" });
assert.deepEqual(racedStop.errors, [], "a child that finished before Stop is an idempotent success");
assert.equal(racedChildAbort, 1, "the owning Pi turn must still be aborted");
registry.unregister("turn-child-already-terminal");

let completedDispose = 0;
registry.register({
  turnId: "turn-3",
  scope: "private_eval",
  projectId: "proj",
  session: {
    abort: async () => assert.fail("completed runs must not be aborted"),
    dispose: () => { completedDispose += 1; },
  },
});
assert.equal(registry.complete({ scope: "private_eval", turnId: "turn-3" }), 1);
assert.equal(completedDispose, 1);
assert.equal(registry.find({ turnId: "turn-3" }), undefined);

let delayedSubagentDispose = 0;
const delayedRegistry = new ActiveAgentRunRegistry(5);
delayedRegistry.register({
  turnId: "turn-delayed-subagent",
  scope: "workflow_role",
  subagentRunId: "subagent-delayed",
  session: {
    abort: async () => assert.fail("naturally completed subagents must not be aborted"),
    dispose: () => { delayedSubagentDispose += 1; },
  },
});
assert.equal(delayedRegistry.complete({ turnId: "turn-delayed-subagent" }), 1);
assert.equal(delayedRegistry.list().length, 0);
assert.equal(delayedSubagentDispose, 0);
await new Promise((resolve) => setTimeout(resolve, 15));
assert.equal(delayedSubagentDispose, 1);

let naturalDispose = 0;
registry.register({
  turnId: "turn-4",
  scope: "project",
  session: {
    abort: async () => assert.fail("naturally completed runs must not be aborted"),
    dispose: () => { naturalDispose += 1; },
  },
});
registry.unregister("turn-4");
assert.equal(naturalDispose, 1);

let failedAbort = 0;
registry.register({
  turnId: "turn-5",
  scope: "project",
  session: {
    abort: async () => { failedAbort += 1; throw new Error("abort failed"); },
    dispose: () => undefined,
  },
});
const failedStop = await registry.stop({ turnId: "turn-5" });
assert.deepEqual(failedStop.errors, ["abort failed"]);
assert.equal(failedAbort, 1);
registry.unregister("turn-5");

let releaseRacedAbort!: () => void;
const racedAbort = new Promise<void>((resolve) => { releaseRacedAbort = resolve; });
let racedDispose = 0;
registry.register({
  turnId: "turn-raced-complete",
  scope: "project",
  session: {
    abort: async () => racedAbort,
    dispose: () => { racedDispose += 1; },
  },
});
const racedCompletionStop = registry.stop({ turnId: "turn-raced-complete" });
await Promise.resolve();
assert.equal(registry.isStoppingOrStopped("turn-raced-complete"), true);
assert.equal(registry.complete({ turnId: "turn-raced-complete" }), 1);
releaseRacedAbort();
assert.equal((await racedCompletionStop).stopped, 1);
assert.equal(racedDispose, 1, "Stop/completion races must dispose the session exactly once");
assert.equal(registry.find({ turnId: "turn-raced-complete" }), undefined);

const boundedRegistry = new ActiveAgentRunRegistry(0, 5);
const boundedOrder: string[] = [];
boundedRegistry.register({
  turnId: "turn-bounded-stop",
  scope: "workflow_role",
  beforeAbort: async () => new Promise<void>(() => undefined),
  subagentRunId: "subagent-bounded-stop",
  subagent: {
    stop: async () => new Promise<void>(() => undefined),
  },
  session: {
    abort: async () => { boundedOrder.push("abort"); },
    dispose: () => { boundedOrder.push("dispose"); },
  },
});
const boundedStop = await boundedRegistry.stop({ turnId: "turn-bounded-stop" });
assert.equal(boundedStop.stopped, 1);
assert.deepEqual(boundedStop.errors, [
  "beforeAbort timed out within the 5ms Stop budget",
  "subagent stop timed out within the 5ms Stop budget",
]);
assert.deepEqual(boundedOrder, ["abort", "dispose"], "each timed-out control must yield to the next Stop step");
assert.equal(boundedRegistry.isStoppingOrStopped("turn-bounded-stop"), true);
boundedRegistry.unregister("turn-bounded-stop");

let boundedAbortDispose = 0;
boundedRegistry.register({
  turnId: "turn-bounded-abort",
  scope: "project",
  session: {
    abort: async () => new Promise<void>(() => undefined),
    dispose: () => { boundedAbortDispose += 1; },
  },
});
const boundedAbortStop = await boundedRegistry.stop({ turnId: "turn-bounded-abort" });
assert.deepEqual(boundedAbortStop.errors, ["session abort timed out within the 5ms Stop budget"]);
assert.equal(boundedAbortDispose, 1, "a timed-out abort must still dispose exactly once");
boundedRegistry.unregister("turn-bounded-abort");
assert.equal(boundedAbortDispose, 1);

let lateChildAbort = 0;
const parent = registry.register({
  turnId: "eval-parent",
  scope: "private_eval",
  session: { abort: async () => undefined, dispose: () => undefined },
});
await registry.stop({ turnId: parent.turnId, reason: "stop during child startup" });
const lateChild = registry.register({
  turnId: "eval-child-late",
  scope: "project",
  parentRunId: parent.turnId,
  session: { abort: async () => { lateChildAbort += 1; }, dispose: () => undefined },
});
await new Promise((resolve) => setTimeout(resolve, 0));
assert.equal(registry.isStoppingOrStopped(lateChild.turnId), true);
assert.equal(lateChildAbort, 1);
registry.unregister(lateChild.turnId);
registry.unregister(parent.turnId);
assert.equal(registry.list().length, 0, "all completed, stopped, raced, and failed-stop runs must be disposable without registry residue");

console.log("active_agent_runs tests passed");
