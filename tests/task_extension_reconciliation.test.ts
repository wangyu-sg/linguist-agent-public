import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createTaskWorkspace,
  type TaskDecision,
  type TaskRunStatus,
} from "@linguist-agent/cat-data";
import { reconcileInterruptedTaskExtensionInteractions } from "../packages/cat-server/src/task_extension_reconciliation.js";

const root = await mkdtemp(join(tmpdir(), "la-task-extension-reconcile-"));
const projectId = "project-one";
const workspace = createTaskWorkspace(root);
const now = "2026-07-16T02:00:00.000Z";

async function createRun(input: {
  taskId: string;
  runId: string;
  status: TaskRunStatus;
  interactionId?: string;
  decisionStatus?: TaskDecision["status"];
}) {
  const initialSnapshot = await workspace.create({
    projectId,
    taskId: input.taskId,
    title: input.taskId,
    intent: "Exercise restart reconciliation.",
    kind: "general",
    scope: { batchId: "batch-one", segmentIds: [], sourceLocale: "zh-CN", targetLocale: "en-US" },
  });
  const threadId = `${input.runId}.main`;
  const decision: TaskDecision | undefined = input.interactionId ? {
    id: `${input.runId}.decision`,
    taskId: input.taskId,
    runId: input.runId,
    requestedByThreadId: threadId,
    artifactId: null,
    kind: "answer",
    status: input.decisionStatus ?? "required",
    prompt: "Choose a direction.",
    options: [{ id: "one", label: "One", action: "answer", destructive: false }],
    interactionId: input.interactionId,
    questionIndex: 0,
    selectionMode: "single",
    selectedOptionId: input.decisionStatus === "recorded" ? "one" : null,
    selectedOptionIds: input.decisionStatus === "recorded" ? ["one"] : [],
    responseText: null,
    reason: null,
    scope: initialSnapshot.task.scope,
    createdAt: now,
    decidedAt: input.decisionStatus === "recorded" ? now : null,
  } : undefined;
  const snapshot = await workspace.appendGenerated({
    projectId,
    taskId: input.taskId,
    runId: input.runId,
    events: [
      {
        type: "run_upsert",
        agentThreadId: threadId,
        run: {
          id: input.runId,
          taskId: input.taskId,
          mode: "single",
          status: input.status,
          rootAgentThreadId: threadId,
          startedAt: now,
          updatedAt: now,
          completedAt: input.status === "complete" ? now : null,
          stopAvailable: !["complete", "failed", "stopped"].includes(input.status),
          resumeAvailable: false,
        },
      },
      {
        type: "thread_upsert",
        agentThreadId: threadId,
        thread: {
          id: threadId,
          taskId: input.taskId,
          runId: input.runId,
          parentThreadId: null,
          identity: { kind: "main", roleId: "linguist-agent", displayName: "Linguist Agent", roleLabel: "Main Agent", disclosureLabel: "Agent" },
          status: input.status,
          canReceiveUserMessage: true,
          handoffSummary: null,
          latestActivityId: null,
          childThreadIds: [],
          createdAt: now,
          updatedAt: now,
        },
      },
      ...(decision ? [{ type: "decision_upsert" as const, agentThreadId: threadId, decision }] : []),
    ],
  });
  return { initialSnapshot, snapshot };
}

await createRun({ taskId: "task-required", runId: "run-required", status: "awaiting_input", interactionId: "native-ui:one" });
await createRun({ taskId: "task-recorded", runId: "run-recorded", status: "active", interactionId: "pi-ask:answered", decisionStatus: "recorded" });
const crashWindow = await createRun({
  taskId: "task-crash-window",
  runId: "run-crash-window",
  status: "awaiting_input",
  interactionId: "native-ui:crash-window",
});
// Emulate a process dying after the event page fsync but before snapshot.json
// was atomically replaced. The event log owns the pending interaction.
await writeFile(
  join(root, "data", "projects", projectId, "task_workspace", "tasks", "task-crash-window", "snapshot.json"),
  `${JSON.stringify(crashWindow.initialSnapshot, null, 2)}\n`,
  "utf8",
);
await createRun({ taskId: "task-broken-candidate", runId: "run-broken-candidate", status: "awaiting_input", interactionId: "native-ui:broken" });
await createRun({ taskId: "task-unrelated", runId: "run-unrelated", status: "awaiting_input", interactionId: "delivery-review:one" });
await createRun({ taskId: "task-irrelevant-history", runId: "run-irrelevant-history", status: "awaiting_input", interactionId: "delivery-review:two" });
await createRun({ taskId: "task-terminal", runId: "run-terminal", status: "complete", interactionId: "native-ui:finished", decisionStatus: "recorded" });
const pendingInitial = await workspace.create({
  projectId,
  taskId: "task-pending-not-started",
  title: "Pending",
  intent: "Do not spend until I continue.",
  kind: "general",
  initialMessage: "Do not spend until I continue.",
});
await workspace.create({
  projectId,
  taskId: "task-archived-history",
  title: "Archived",
  intent: "Archived tasks are not recovery candidates.",
  kind: "general",
  scope: { batchId: "batch-one", segmentIds: [], sourceLocale: "zh-CN", targetLocale: "en-US" },
});
await workspace.archive({ projectId, taskId: "task-archived-history" });
const requiredSnapshot = await workspace.open({ projectId, taskId: "task-required" });
await workspace.appendGenerated({
  projectId,
  taskId: "task-required",
  runId: "run-required",
  events: [{
    type: "decision_upsert",
    agentThreadId: "run-required.main",
    decision: {
      ...requiredSnapshot.decisions[0]!,
      id: "run-required.other-required",
      interactionId: "delivery-review:pending",
    },
  }],
});

await writeFile(
  join(root, "data", "projects", projectId, "task_workspace", "tasks", "task-irrelevant-history", "events.jsonl"),
  "{invalid event}\n{}\n",
  "utf8",
);
await writeFile(
  join(root, "data", "projects", projectId, "task_workspace", "tasks", "task-archived-history", "events.jsonl"),
  "{invalid event}\n{}\n",
  "utf8",
);
await writeFile(
  join(root, "data", "projects", projectId, "task_workspace", "tasks", "task-broken-candidate", "events.jsonl"),
  "{invalid event}\n{}\n",
  "utf8",
);
const corruptTaskRoot = join(root, "data", "projects", projectId, "task_workspace", "tasks", "task-corrupt-snapshot");
await mkdir(corruptTaskRoot, { recursive: true });
await writeFile(
  join(corruptTaskRoot, "snapshot.json"),
  "{\"interactionId\":\"native-ui:corrupt-candidate\"",
  "utf8",
);
const irrelevantCorruptTaskRoot = join(root, "data", "projects", projectId, "task_workspace", "tasks", "task-irrelevant-corrupt-snapshot");
await mkdir(irrelevantCorruptTaskRoot, { recursive: true });
await writeFile(join(irrelevantCorruptTaskRoot, "snapshot.json"), "{invalid unrelated snapshot}", "utf8");

const first = await reconcileInterruptedTaskExtensionInteractions({
  repoRoot: root,
  failedAt: "2026-07-16T02:05:00.000Z",
});
assert.equal(first.failedRuns, 4);
assert.deepEqual(first.runIds.sort(), ["run-crash-window", "run-recorded", "run-required", "run-unrelated"]);
assert.deepEqual(first.diagnostics.sort((left, right) => left.taskId.localeCompare(right.taskId)), [
  { projectId, taskId: "task-broken-candidate", code: "task_reconciliation_failed" },
  { projectId, taskId: "task-corrupt-snapshot", code: "task_snapshot_unreadable" },
  { projectId, taskId: "task-irrelevant-history", code: "task_reconciliation_failed" },
]);

const required = await workspace.open({ projectId, taskId: "task-required" });
assert.equal(required.runs.find((run) => run.id === "run-required")?.status, "failed");
assert.equal(required.runs.find((run) => run.id === "run-required")?.resumeAvailable, false);
assert.equal(required.agentThreads.find((thread) => thread.runId === "run-required")?.status, "failed");
assert.ok(required.decisions.every((decision) => decision.status === "cancelled"), "restart failure cancels every pending Decision owned by the failed Run");
assert.ok(required.decisions.every((decision) => decision.reason === "The runtime restarted before the Agent run completed."));
assert.equal(required.activities.filter((activity) => activity.id === "run-required.extension-runtime-restarted").length, 1);

const recorded = await workspace.open({ projectId, taskId: "task-recorded" });
assert.equal(recorded.runs.find((run) => run.id === "run-recorded")?.status, "failed");
assert.equal(recorded.decisions[0]?.status, "recorded", "a durable answer remains history even though Pi cannot resume it");

const recoveredCrashWindow = await workspace.open({ projectId, taskId: "task-crash-window" });
assert.equal(recoveredCrashWindow.runs.find((run) => run.id === "run-crash-window")?.status, "failed");
assert.equal(recoveredCrashWindow.decisions[0]?.status, "cancelled");

const unrelated = await workspace.open({ projectId, taskId: "task-unrelated" });
assert.equal(unrelated.runs.find((run) => run.id === "run-unrelated")?.status, "failed");
assert.equal(unrelated.decisions[0]?.status, "cancelled");

const stillPending = await workspace.open({ projectId, taskId: "task-pending-not-started" });
assert.equal(stillPending.runs[0]?.id, pendingInitial.runs[0]?.id);
assert.equal(stillPending.runs[0]?.status, "pending", "a Run that never started must remain explicitly continuable after restart");

const terminal = await workspace.open({ projectId, taskId: "task-terminal" });
assert.equal(terminal.runs.find((run) => run.id === "run-terminal")?.status, "complete");

const second = await reconcileInterruptedTaskExtensionInteractions({
  repoRoot: root,
  failedAt: "2026-07-16T02:06:00.000Z",
});
assert.equal(second.failedRuns, 0, "reconciliation must be idempotent");
assert.equal((await workspace.open({ projectId, taskId: "task-required" })).activities.filter((activity) => activity.id === "run-required.extension-runtime-restarted").length, 1);

console.log("task extension reconciliation tests passed");
