import assert from "node:assert/strict";
import { mkdtemp, rename } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createEventBus } from "@earendil-works/pi-coding-agent";
import { createTaskWorkspace } from "@linguist-agent/cat-data";
import {
  completeTaskExtensionFatalFailure,
  commitTaskExtensionInteraction,
  createTaskExtensionInteractionHost,
  persistTaskExtensionFatalFallback,
  PI_ASK_STARTED_EVENT,
  PI_ASK_SUBMIT_EVENT,
  PI_ASK_SUBMIT_RESULT_EVENT,
  TaskExtensionFatalPersistenceError,
} from "../packages/cat-server/src/task_extension_interactions.js";

async function createActiveTask(root: string, projectId: string, taskId: string, runId: string) {
  const workspace = createTaskWorkspace(root);
  const created = await workspace.create({
    projectId,
    taskId,
    title: "Native interaction",
    intent: "Exercise the canonical Pi UI bridge.",
    kind: "general",
    scope: { batchId: "batch-one", segmentIds: ["segment-one"], sourceLocale: "zh-CN", targetLocale: "en-US" },
  });
  const now = "2026-07-16T01:00:00.000Z";
  await workspace.appendGenerated({
    projectId,
    taskId,
    runId,
    events: [
      {
        type: "run_upsert",
        agentThreadId: `${runId}.main`,
        run: {
          id: runId,
          taskId,
          mode: "single",
          status: "active",
          rootAgentThreadId: `${runId}.main`,
          startedAt: now,
          updatedAt: now,
          completedAt: null,
          stopAvailable: true,
          resumeAvailable: false,
        },
      },
      {
        type: "thread_upsert",
        agentThreadId: `${runId}.main`,
        thread: {
          id: `${runId}.main`,
          taskId,
          runId,
          parentThreadId: null,
          identity: { kind: "main", roleId: "linguist-agent", displayName: "Linguist Agent", roleLabel: "Main Agent", disclosureLabel: "Agent" },
          status: "active",
          canReceiveUserMessage: true,
          handoffSummary: null,
          latestActivityId: null,
          childThreadIds: [],
          createdAt: now,
          updatedAt: now,
        },
      },
    ],
  });
  return { workspace, scope: created.task.scope, threadId: `${runId}.main` };
}

async function completesWithin<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(message)), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

const root = await mkdtemp(join(tmpdir(), "la-task-extension-interactions-"));
const projectId = "project-one";
const taskId = "task-one";
const runId = "run-one";
const fallbackDelivery: string[] = [];
assert.equal(await completeTaskExtensionFatalFailure({
  fatalPersistence: { canonicalFailurePersisted: false, error: new Error("host append failed") },
  emitRaw: () => { fallbackDelivery.push("raw"); },
  persistFallback: async () => { fallbackDelivery.push("fallback"); },
}), "fallback");
assert.deepEqual(fallbackDelivery, ["fallback", "raw"], "the stream error is delivered only after fallback canonical persistence");
const canonicalDelivery: string[] = [];
assert.equal(await completeTaskExtensionFatalFailure({
  fatalPersistence: { canonicalFailurePersisted: true },
  emitRaw: () => { canonicalDelivery.push("raw"); },
  persistFallback: async () => { canonicalDelivery.push("fallback"); },
}), "canonical");
assert.deepEqual(canonicalDelivery, ["raw"], "raw emission is safe only after the host confirms canonical persistence");
await assert.rejects(
  completeTaskExtensionFatalFailure({
    fatalPersistence: { canonicalFailurePersisted: false, error: new Error("host append failed") },
    emitRaw: () => { throw new Error("raw emit must not run"); },
    persistFallback: async () => { throw new Error("fallback append failed"); },
  }),
  (error: unknown) => {
    assert.ok(error instanceof TaskExtensionFatalPersistenceError);
    assert.match(error.message, /could not be persisted/);
    assert.deepEqual(error.errors.map((entry) => entry instanceof Error ? entry.message : String(entry)), [
      "host append failed",
      "fallback append failed",
    ]);
    return true;
  },
  "failure of both canonical persistence paths must surface an explicit combined error",
);

const fallbackTaskId = "task-fatal-fallback";
const fallbackRunId = "run-fatal-fallback";
const fallbackTask = await createActiveTask(root, projectId, fallbackTaskId, fallbackRunId);
const fallbackHost = createTaskExtensionInteractionHost({
  repoRoot: root,
  projectId,
  taskId: fallbackTaskId,
  runId: fallbackRunId,
  agentThreadId: fallbackTask.threadId,
  createInteractionId: () => "native-ui:fatal-fallback",
  now: () => "2026-07-16T01:00:30.000Z",
});
const fallbackQuestion = fallbackHost.uiContext.confirm("Choose a fallback", "This answer must not survive a fatal bridge failure.");
await fallbackHost.flush();
const fallbackWaiting = await fallbackTask.workspace.open({ projectId, taskId: fallbackTaskId });
const fallbackNativeDecision = fallbackWaiting.decisions.find((decision) => decision.interactionId === "native-ui:fatal-fallback")!;
await fallbackTask.workspace.appendGenerated({
  projectId,
  taskId: fallbackTaskId,
  runId: fallbackRunId,
  events: [{
    type: "decision_upsert",
    agentThreadId: fallbackTask.threadId,
    decision: {
      ...fallbackNativeDecision,
      id: "canonical-approval",
      kind: "approval",
      interactionId: null,
      questionIndex: null,
      selectionMode: null,
      options: [{ id: "approve", label: "Approve", action: "approve", destructive: false }],
    },
  }],
});
const fallbackBefore = await fallbackTask.workspace.open({ projectId, taskId: fallbackTaskId });
const fallbackPersistOrder: string[] = [];
assert.equal(await completeTaskExtensionFatalFailure({
  fatalPersistence: { canonicalFailurePersisted: false, error: new Error("host append failed") },
  emitRaw: () => { fallbackPersistOrder.push("raw"); },
  persistFallback: async () => {
    await persistTaskExtensionFatalFallback({
      repoRoot: root,
      projectId,
      taskId: fallbackTaskId,
      runId: fallbackRunId,
      failedAt: "2026-07-16T01:00:31.000Z",
    });
    fallbackPersistOrder.push("canonical");
  },
}), "fallback");
assert.deepEqual(fallbackPersistOrder, ["canonical", "raw"]);
const fallbackFailed = await fallbackTask.workspace.open({ projectId, taskId: fallbackTaskId });
assert.equal(fallbackFailed.runs.find((run) => run.id === fallbackRunId)?.status, "failed");
assert.equal(fallbackFailed.runs.find((run) => run.id === fallbackRunId)?.stopAvailable, false);
assert.equal(fallbackFailed.runs.find((run) => run.id === fallbackRunId)?.resumeAvailable, false);
assert.equal(fallbackFailed.agentThreads.find((thread) => thread.id === fallbackTask.threadId)?.status, "failed");
assert.equal(fallbackFailed.decisions.find((decision) => decision.id === fallbackNativeDecision.id)?.status, "cancelled");
assert.equal(
  fallbackFailed.decisions.find((decision) => decision.id === "canonical-approval")?.status,
  "required",
  "fatal Package containment must not cancel an unrelated canonical approval",
);
const fallbackEvents = await fallbackTask.workspace.events({
  projectId,
  taskId: fallbackTaskId,
  runId: fallbackRunId,
  afterCursor: fallbackBefore.eventCursor,
});
assert.deepEqual(
  fallbackEvents.events.map((event) => event.type),
  ["run_upsert", "thread_upsert", "decision_upsert", "activity_append"],
  "Run, Thread, native Decision and failure Activity must be committed in one generated event page",
);
assert.deepEqual(fallbackEvents.events.at(-1)?.activity?.refs.decisionIds, [fallbackNativeDecision.id]);
await assert.rejects(
  commitTaskExtensionInteraction({
    repoRoot: root,
    projectId,
    taskId: fallbackTaskId,
    interactionId: "native-ui:fatal-fallback",
    body: { action: "submit", answers: [{ decisionId: fallbackNativeDecision.id, selectedOptionIds: ["yes"] }] },
  }),
  /not required|not active|no longer active|already resolved/i,
  "the failed Run must expose no answerable native interaction",
);
await fallbackHost.dispose();
assert.equal(await fallbackQuestion, false);

const { workspace, threadId } = await createActiveTask(root, projectId, taskId, runId);
let nextId = 0;
const host = createTaskExtensionInteractionHost({
  repoRoot: root,
  projectId,
  taskId,
  runId,
  agentThreadId: threadId,
  requestProvenance: {
    kind: "package_extension",
    transport: "pi-rpc-v1",
    packageSource: "npm:example-ui@1.0.0",
    packageName: "example-ui",
    packageVersion: "1.0.0",
    resourceId: "extension.ts",
    integrity: "sha256-example",
  },
  createInteractionId: () => `interaction-${++nextId}`,
  now: () => "2026-07-16T01:01:00.000Z",
});

const selection = host.uiContext.select("Choose tone", ["Formal", "Conversational"]);
await host.flush();
const waiting = await workspace.open({ projectId, taskId });
const selectionDecision = waiting.decisions.find((decision) => decision.interactionId === "interaction-1");
assert.equal(selectionDecision?.selectionMode, "single");
assert.equal(selectionDecision?.requestProvenance?.transport, "pi-rpc-v1");
assert.equal(selectionDecision?.requestProvenance?.packageName, "example-ui");
assert.deepEqual(selectionDecision?.options.map((option) => option.label), ["Formal", "Conversational"]);
assert.equal(waiting.runs.find((run) => run.id === runId)?.status, "awaiting_input");
assert.equal(waiting.agentThreads.find((thread) => thread.id === threadId)?.status, "awaiting_input");

let selectionSettled = false;
void selection.then(() => { selectionSettled = true; });
await Promise.resolve();
assert.equal(selectionSettled, false, "the Pi call must stay blocked while the canonical Decision is required");

await commitTaskExtensionInteraction({
  repoRoot: root,
  projectId,
  taskId,
  interactionId: "interaction-1",
  body: { action: "submit", answers: [{ decisionId: selectionDecision!.id, selectedOptionIds: ["option-2"] }] },
});
assert.equal(await selection, "Conversational", "the Pi call resumes only after the durable Decision commit");
assert.equal((await workspace.open({ projectId, taskId })).runs.find((run) => run.id === runId)?.status, "active");

host.uiContext.notify("Background cache is stale.", "warning");
host.uiContext.notify("Package request failed.", "error");
host.uiContext.notify("Temporary progress", "info");
host.uiContext.setStatus("package", "Working");
host.uiContext.setWidget("package", ["Transient widget"]);
host.uiContext.setTitle("Transient title");
host.uiContext.setEditorText("draft");
host.uiContext.pasteToEditor(" text");
assert.equal(host.uiContext.getEditorText(), "draft text");
await host.flush();
const notified = await workspace.open({ projectId, taskId });
assert.deepEqual(
  notified.activities.filter((activity) => activity.title === "Package warning" || activity.title === "Package error").map((activity) => [activity.title, activity.body]),
  [["Package warning", "Background cache is stale."], ["Package error", "Package request failed."]],
  "only warning/error notifications become canonical Activity",
);
assert.deepEqual(
  notified.activities.filter((activity) => activity.title === "Package warning" || activity.title === "Package error").map((activity) => [activity.type, activity.status]),
  [["progress", "done"], ["error", "error"]],
  "warning stays non-fatal while error is projected as an error",
);
assert.ok(notified.activities.some((activity) => activity.title === "Package UI diagnostic" && /setStatus/.test(activity.body)));

const confirmation = host.uiContext.confirm("Apply terminology?", "Use the approved glossary entry.");
await host.flush();
const confirmationDecision = (await workspace.open({ projectId, taskId })).decisions.find((decision) => decision.interactionId === "interaction-2")!;
await commitTaskExtensionInteraction({
  repoRoot: root,
  projectId,
  taskId,
  interactionId: "interaction-2",
  body: { action: "submit", answers: [{ decisionId: confirmationDecision.id, selectedOptionIds: ["yes"] }] },
});
assert.equal(await confirmation, true);

const inputResponse = host.uiContext.input("Name this artifact", "Short descriptive name");
await host.flush();
const inputDecision = (await workspace.open({ projectId, taskId })).decisions.find((decision) => decision.interactionId === "interaction-3")!;
await commitTaskExtensionInteraction({
  repoRoot: root,
  projectId,
  taskId,
  interactionId: "interaction-3",
  body: { action: "submit", answers: [{ decisionId: inputDecision.id, responseText: "Combat UI glossary" }] },
});
assert.equal(await inputResponse, "Combat UI glossary");

const edited = host.uiContext.editor("Revise the note", "Existing note");
await host.flush();
const editorDecision = (await workspace.open({ projectId, taskId })).decisions.find((decision) => decision.interactionId === "interaction-4")!;
await commitTaskExtensionInteraction({
  repoRoot: root,
  projectId,
  taskId,
  interactionId: "interaction-4",
  body: { action: "elaborate", answers: [{ decisionId: editorDecision.id, responseText: "Revised note" }] },
});
assert.equal(await edited, "Revised note");

const timedOut = host.uiContext.input("Temporary question", undefined, { timeout: 5 });
await host.flush();
assert.equal(await timedOut, undefined);
assert.equal((await workspace.open({ projectId, taskId })).decisions.find((decision) => decision.interactionId === "interaction-5")?.status, "cancelled");

const stoppedConfirmation = host.uiContext.confirm("Continue?", "This should be cancelled by Stop.");
await host.flush();
await host.prepareStop();
assert.equal(await stoppedConfirmation, false);
const stoppedSnapshot = await workspace.open({ projectId, taskId });
assert.equal(stoppedSnapshot.decisions.find((decision) => decision.interactionId === "interaction-6")?.status, "cancelled");
assert.equal(stoppedSnapshot.runs.find((run) => run.id === runId)?.status, "stopping");
assert.equal(stoppedSnapshot.agentThreads.find((thread) => thread.id === threadId)?.status, "stopping");

await host.dispose();

const piTaskId = "task-pi-ask";
const piRunId = "run-pi-ask";
const piTask = await createActiveTask(root, projectId, piTaskId, piRunId);
const events = createEventBus();
const submitPayloads: Array<Record<string, unknown>> = [];
events.on(PI_ASK_SUBMIT_EVENT, (value) => {
  const row = value as Record<string, unknown>;
  submitPayloads.push(row);
  events.emit(PI_ASK_SUBMIT_RESULT_EVENT, {
    version: 1,
    flowId: row.flowId,
    requestId: row.requestId,
    ok: true,
  });
});
const piAskHost = createTaskExtensionInteractionHost({
  repoRoot: root,
  projectId,
  taskId: piTaskId,
  runId: piRunId,
  agentThreadId: piTask.threadId,
  now: () => "2026-07-16T01:02:00.000Z",
});

events.emit(PI_ASK_STARTED_EVENT, {
  version: 1,
  flowId: "tool:before-bind",
  questions: [{ id: "ignored", prompt: "Not bound yet.", type: "single", options: [{ value: "yes", label: "Yes" }] }],
});
await piAskHost.flush();
assert.equal((await piTask.workspace.open({ projectId, taskId: piTaskId })).decisions.length, 0, "pi-ask cannot start before the Session EventBus is bound");
piAskHost.bindEvents(events);

events.emit(PI_ASK_STARTED_EVENT, {
  version: 1,
  flowId: "tool:ask-four",
  title: "Translation direction",
  questions: [
    {
      id: "tone",
      prompt: "Which tone should we use?",
      type: "single",
      options: [
        { value: "formal", label: "Formal", description: "Restrained production copy." },
        { value: "casual", label: "Casual" },
      ],
    },
    {
      id: "checks",
      prompt: "Which checks matter?",
      type: "multi",
      options: [{ value: "terms", label: "Terminology" }, { value: "voice", label: "Voice" }],
    },
    {
      id: "layout",
      prompt: "Choose the layout.",
      type: "preview",
      options: [
        { value: "compact", label: "Compact", preview: "Dense source/target rows" },
        { value: "relaxed", label: "Relaxed", preview: "More breathing room" },
      ],
    },
    {
      id: "constraint",
      prompt: "Any additional constraint?",
      type: "single",
      options: [{ value: "none", label: "No additional constraint" }],
    },
  ],
});
await piAskHost.flush();
const piInteractionId = "pi-ask:tool:ask-four";
const piWaiting = await piTask.workspace.open({ projectId, taskId: piTaskId });
const piQuestions = piWaiting.decisions.filter((decision) => decision.interactionId === piInteractionId);
assert.equal(piQuestions.length, 4);
assert.deepEqual(piQuestions.map((decision) => decision.selectionMode), ["single", "multiple", "single", "single"]);
assert.equal(piQuestions[0]?.options[0]?.description, "Restrained production copy.");
assert.equal(piQuestions[2]?.options[0]?.preview, "Dense source/target rows");
assert.equal(piQuestions.every((decision) => decision.options.at(-1)?.id === "freeform"), true);

const partial = await commitTaskExtensionInteraction({
  repoRoot: root,
  projectId,
  taskId: piTaskId,
  interactionId: piInteractionId,
  body: {
    action: "submit",
    answers: [
      { decisionId: piQuestions[0]!.id, selectedOptionIds: ["choice-1"] },
      { decisionId: piQuestions[1]!.id, selectedOptionIds: ["choice-1", "choice-2"], responseText: "Prioritize player-facing strings." },
    ],
  },
});
assert.equal(partial.pendingDecisionIds.length, 2);
assert.equal(submitPayloads.length, 0, "partial canonical answers must not resume pi-ask");
assert.equal(partial.snapshot.runs.find((run) => run.id === piRunId)?.status, "awaiting_input");

const completed = await commitTaskExtensionInteraction({
  repoRoot: root,
  projectId,
  taskId: piTaskId,
  interactionId: piInteractionId,
  body: {
    action: "submit",
    answers: [
      { decisionId: piQuestions[2]!.id, selectedOptionIds: ["choice-2"] },
      { decisionId: piQuestions[3]!.id, selectedOptionIds: ["freeform"], responseText: "Keep combat strings under 42 characters." },
    ],
  },
});
assert.equal(completed.pendingDecisionIds.length, 0);
assert.equal(submitPayloads.length, 1);
assert.equal(completed.snapshot.runs.find((run) => run.id === piRunId)?.status, "active");
assert.deepEqual(submitPayloads[0]?.response, {
  kind: "answer",
  mode: "submit",
  answers: {
    tone: { values: ["formal"] },
    checks: { values: ["terms", "voice"], note: "Prioritize player-facing strings." },
    layout: { values: ["relaxed"] },
    constraint: { values: [], customText: "Keep combat strings under 42 characters." },
  },
});

events.emit(PI_ASK_STARTED_EVENT, {
  version: 1,
  flowId: "tool:ask-elaborate",
  questions: [{ id: "scope", prompt: "Which scope?", type: "single", options: [{ value: "batch", label: "Whole batch" }] }],
});
await piAskHost.flush();
const elaborateId = "pi-ask:tool:ask-elaborate";
const elaborateDecision = (await piTask.workspace.open({ projectId, taskId: piTaskId })).decisions.find((decision) => decision.interactionId === elaborateId)!;
await commitTaskExtensionInteraction({
  repoRoot: root,
  projectId,
  taskId: piTaskId,
  interactionId: elaborateId,
  body: { action: "elaborate", answers: [{ decisionId: elaborateDecision.id, responseText: "Only player-facing rows need review." }] },
});
assert.deepEqual(submitPayloads[1]?.response, {
  kind: "answer",
  mode: "elaborate",
  answers: { scope: { values: [], note: "Only player-facing rows need review." } },
});

events.emit(PI_ASK_STARTED_EVENT, {
  version: 1,
  flowId: "tool:ask-cancel",
  questions: [{ id: "delivery", prompt: "Prepare delivery?", type: "single", options: [{ value: "yes", label: "Yes" }, { value: "no", label: "No" }] }],
});
await piAskHost.flush();
await commitTaskExtensionInteraction({
  repoRoot: root,
  projectId,
  taskId: piTaskId,
  interactionId: "pi-ask:tool:ask-cancel",
  body: { action: "cancel", reason: "Not yet." },
});
assert.deepEqual(submitPayloads[2]?.response, { kind: "cancel" });

await piAskHost.dispose();

const taskA = await createActiveTask(root, projectId, "task-isolated-a", "run-isolated");
const taskB = await createActiveTask(root, projectId, "task-isolated-b", "run-isolated");
let isolatedBInteraction = 0;
const isolatedHostA = createTaskExtensionInteractionHost({
  repoRoot: root,
  projectId,
  taskId: "task-isolated-a",
  runId: "run-isolated",
  agentThreadId: taskA.threadId,
  createInteractionId: () => "shared-interaction",
});
const isolatedHostB = createTaskExtensionInteractionHost({
  repoRoot: root,
  projectId,
  taskId: "task-isolated-b",
  runId: "run-isolated",
  agentThreadId: taskB.threadId,
  createInteractionId: () => ++isolatedBInteraction === 1 ? "shared-interaction" : "aborted-interaction",
});
const isolatedA = isolatedHostA.uiContext.select("Task A", ["A1", "A2"]);
const isolatedB = isolatedHostB.uiContext.select("Task B", ["B1", "B2"]);
await Promise.all([isolatedHostA.flush(), isolatedHostB.flush()]);
let isolatedBSettled = false;
void isolatedB.then(() => { isolatedBSettled = true; });
await commitTaskExtensionInteraction({
  repoRoot: root,
  projectId,
  taskId: "task-isolated-a",
  interactionId: "shared-interaction",
  body: { action: "submit", answers: [{ decisionId: "shared-interaction.question-1", selectedOptionIds: ["option-2"] }] },
});
assert.equal(await isolatedA, "A2");
await Promise.resolve();
assert.equal(isolatedBSettled, false, "same Run/interaction ids in another Task must stay isolated");

const abort = new AbortController();
const aborted = isolatedHostB.uiContext.select("Abort this", ["Keep", "Cancel"], { signal: abort.signal });
await isolatedHostB.flush();
abort.abort();
assert.equal(await aborted, undefined);

await commitTaskExtensionInteraction({
  repoRoot: root,
  projectId,
  taskId: "task-isolated-b",
  interactionId: "shared-interaction",
  body: { action: "submit", answers: [{ decisionId: "shared-interaction.question-1", selectedOptionIds: ["option-1"] }] },
});
assert.equal(await isolatedB, "B1");
await Promise.all([isolatedHostA.dispose(), isolatedHostB.dispose()]);

const ackTask = await createActiveTask(root, projectId, "task-ack-timeout", "run-ack-timeout");
const ackEvents = createEventBus();
const fatalErrors: Error[] = [];
const ackHost = createTaskExtensionInteractionHost({
  repoRoot: root,
  projectId,
  taskId: "task-ack-timeout",
  runId: "run-ack-timeout",
  agentThreadId: ackTask.threadId,
  piAskSubmitTimeoutMs: 5,
  onFatalError: (error) => { fatalErrors.push(error); },
});
ackHost.bindEvents(ackEvents);
const siblingQuestion = ackHost.uiContext.confirm("Unrelated question", "This pending answer belongs to the same Run.");
await ackHost.flush();
const siblingDecision = (await ackTask.workspace.open({ projectId, taskId: "task-ack-timeout" })).decisions
  .find((decision) => decision.interactionId?.startsWith("native-ui:"))!;
await ackTask.workspace.appendGenerated({
  projectId,
  taskId: "task-ack-timeout",
  runId: "run-ack-timeout",
  events: [{
    type: "decision_upsert",
    agentThreadId: ackTask.threadId,
    decision: {
      ...siblingDecision,
      id: "ack-canonical-approval",
      kind: "approval",
      interactionId: null,
      questionIndex: null,
      selectionMode: null,
      options: [{ id: "approve", label: "Approve", action: "approve", destructive: false }],
    },
  }],
});
ackEvents.emit(PI_ASK_STARTED_EVENT, {
  version: 1,
  flowId: "tool:no-ack",
  questions: [{ id: "tone", prompt: "Choose tone.", type: "single", options: [{ value: "formal", label: "Formal" }] }],
});
await ackHost.flush();
const ackDecision = (await ackTask.workspace.open({ projectId, taskId: "task-ack-timeout" })).decisions.find((decision) => decision.interactionId === "pi-ask:tool:no-ack")!;
await assert.rejects(
  commitTaskExtensionInteraction({
    repoRoot: root,
    projectId,
    taskId: "task-ack-timeout",
    interactionId: "pi-ask:tool:no-ack",
    body: { action: "submit", answers: [{ decisionId: ackDecision.id, selectedOptionIds: ["choice-1"] }] },
  }),
  /timed out/,
);
const failedAck = await ackTask.workspace.open({ projectId, taskId: "task-ack-timeout" });
assert.equal(failedAck.runs.find((run) => run.id === "run-ack-timeout")?.status, "failed");
assert.equal(failedAck.runs.find((run) => run.id === "run-ack-timeout")?.resumeAvailable, false, "Retry must create a new Run");
assert.equal(failedAck.agentThreads.find((thread) => thread.id === ackTask.threadId)?.status, "failed");
assert.equal(
  failedAck.decisions.find((decision) => decision.interactionId?.startsWith("native-ui:"))?.status,
  "cancelled",
  "ack failure cancels every other required native interaction in the same Run",
);
assert.equal(
  failedAck.decisions.find((decision) => decision.id === "ack-canonical-approval")?.status,
  "required",
  "ack failure must not cancel an unrelated canonical approval",
);
assert.equal(failedAck.decisions.find((decision) => decision.id === ackDecision.id)?.status, "recorded");
const bridgeFailures = failedAck.activities.filter((activity) => activity.title === "Package interaction failed");
assert.equal(bridgeFailures.length, 1);
assert.equal(bridgeFailures[0]?.body, "The native Package response bridge did not acknowledge the committed answer.");
assert.equal(bridgeFailures[0]?.body?.includes("Formal"), false, "the durable failure must not persist customer answer text");
assert.equal(bridgeFailures[0]?.body?.includes("tool:no-ack"), false, "the durable failure must not persist the Package request id");
assert.equal(bridgeFailures[0]?.refs.decisionIds.includes(ackDecision.id), true, "the failure must link the recorded answer whose Package acknowledgement failed");
assert.equal(fatalErrors.length, 1, "fatal bridge failure must abort the owning Session through the injected callback");
await ackHost.dispose();
assert.equal(await siblingQuestion, false);
assert.equal(
  (await ackTask.workspace.open({ projectId, taskId: "task-ack-timeout" })).runs.find((run) => run.id === "run-ack-timeout")?.status,
  "failed",
  "disposing a failed host must not overwrite the Run with stopping",
);

const invalidStartedTask = await createActiveTask(root, projectId, "task-invalid-started", "run-invalid-started");
const invalidStartedEvents = createEventBus();
const invalidStartedFatalErrors: Error[] = [];
const invalidStartedHost = createTaskExtensionInteractionHost({
  repoRoot: root,
  projectId,
  taskId: "task-invalid-started",
  runId: "run-invalid-started",
  agentThreadId: invalidStartedTask.threadId,
  fatalContainmentTimeoutMs: 20,
  onFatalError: (error) => {
    invalidStartedFatalErrors.push(error);
    throw new Error("Session abort failed.");
  },
});
invalidStartedHost.bindEvents(invalidStartedEvents);
invalidStartedEvents.emit(PI_ASK_STARTED_EVENT, {
  version: 1,
  flowId: "tool:invalid-started",
  questions: [],
});
await assert.rejects(invalidStartedHost.flush(), /must contain 1-4 questions/);
assert.equal(invalidStartedFatalErrors.length, 1, "registration failure must abort through the shared fatal path");
const invalidStartedFailed = await invalidStartedTask.workspace.open({ projectId, taskId: "task-invalid-started" });
assert.equal(invalidStartedFailed.runs.find((run) => run.id === "run-invalid-started")?.status, "failed");
assert.equal(invalidStartedFailed.activities.filter((activity) => activity.title === "Package interaction failed").length, 1);
assert.deepEqual(invalidStartedFailed.activities.find((activity) => activity.title === "Package interaction failed")?.refs.decisionIds, []);
await invalidStartedHost.dispose();

const missingPersistenceTask = await createActiveTask(root, projectId, "task-missing-fatal-persistence", "run-missing-fatal-persistence");
const missingPersistenceEvents = createEventBus();
const missingPersistenceHost = createTaskExtensionInteractionHost({
  repoRoot: root,
  projectId,
  taskId: "task-missing-fatal-persistence",
  runId: "run-missing-fatal-persistence",
  agentThreadId: missingPersistenceTask.threadId,
  fatalContainmentTimeoutMs: 20,
});
missingPersistenceHost.bindEvents(missingPersistenceEvents);
const missingPersistenceTaskDir = join(
  root,
  "data",
  "projects",
  projectId,
  "task_workspace",
  "tasks",
  "task-missing-fatal-persistence",
);
const hiddenPersistenceTaskDir = `${missingPersistenceTaskDir}.offline`;
await rename(missingPersistenceTaskDir, hiddenPersistenceTaskDir);
try {
  missingPersistenceEvents.emit(PI_ASK_STARTED_EVENT, {
    version: 1,
    flowId: "tool:missing-fatal-persistence",
    questions: [],
  });
  await assert.rejects(missingPersistenceHost.flush(), /must contain 1-4 questions/);
  const persistence = await missingPersistenceHost.fatalPersistence();
  assert.equal(persistence?.canonicalFailurePersisted, false);
  assert.ok(persistence?.error instanceof Error, "the host must expose why canonical failure persistence did not succeed");
} finally {
  await rename(hiddenPersistenceTaskDir, missingPersistenceTaskDir);
}
assert.equal(
  (await missingPersistenceTask.workspace.open({ projectId, taskId: "task-missing-fatal-persistence" }))
    .runs.find((run) => run.id === "run-missing-fatal-persistence")?.status,
  "active",
  "a failed fatal append must not be reported as canonical persistence",
);
await missingPersistenceHost.dispose();

const conflictRetryTask = await createActiveTask(root, projectId, "task-fatal-conflict-retry", "run-fatal-conflict-retry");
const conflictRetryEvents = createEventBus();
let conflictRetryNowCalls = 0;
let conflictSiblingDecisionId = "";
let conflictSiblingDecision: Awaited<ReturnType<typeof conflictRetryTask.workspace.open>>["decisions"][number] | undefined;
let conflictBlockerRelease!: () => void;
const conflictBlockerGate = new Promise<void>((resolve) => { conflictBlockerRelease = resolve; });
let conflictBlockerStartedResolve!: () => void;
const conflictBlockerStarted = new Promise<void>((resolve) => { conflictBlockerStartedResolve = resolve; });
let conflictFatalAppendQueuedResolve!: () => void;
const conflictFatalAppendQueued = new Promise<void>((resolve) => { conflictFatalAppendQueuedResolve = resolve; });
let conflictBlockingAppend: Promise<unknown> | undefined;
conflictRetryEvents.on(PI_ASK_SUBMIT_EVENT, () => {
  conflictBlockingAppend = conflictRetryTask.workspace.appendGenerated({
    projectId,
    taskId: "task-fatal-conflict-retry",
    runId: "run-fatal-conflict-retry",
    beforeCommit: async () => {
      conflictBlockerStartedResolve();
      await conflictBlockerGate;
    },
    events: [{
      type: "activity_append",
      agentThreadId: conflictRetryTask.threadId,
      activity: {
        id: "run-fatal-conflict-retry.test-blocker",
        taskId: "task-fatal-conflict-retry",
        runId: "run-fatal-conflict-retry",
        agentThreadId: conflictRetryTask.threadId,
        seq: 0,
        type: "progress",
        status: "done",
        actor: { kind: "system", id: "test", displayName: "Test", agentThreadId: conflictRetryTask.threadId },
        title: "Hold fatal conflict append",
        body: null,
        tool: null,
        refs: { artifactIds: [], evidenceRefs: [], decisionIds: [] },
        createdAt: "2026-07-16T01:05:20.000Z",
        updatedAt: "2026-07-16T01:05:20.000Z",
      },
    }],
  });
});
const conflictRetryHost = createTaskExtensionInteractionHost({
  repoRoot: root,
  projectId,
  taskId: "task-fatal-conflict-retry",
  runId: "run-fatal-conflict-retry",
  agentThreadId: conflictRetryTask.threadId,
  piAskSubmitTimeoutMs: 5,
  fatalContainmentTimeoutMs: 1_000,
  now: () => `2026-07-16T01:05:${String(conflictRetryNowCalls++).padStart(2, "0")}.000Z`,
  onFatalError: () => {
    if (!conflictSiblingDecision) throw new Error("Conflict retry sibling Decision is unavailable.");
    const cancellation = conflictRetryTask.workspace.appendGenerated({
      projectId,
      taskId: "task-fatal-conflict-retry",
      runId: "run-fatal-conflict-retry",
      events: [{
        type: "decision_upsert",
        agentThreadId: conflictRetryTask.threadId,
        decision: {
          ...conflictSiblingDecision,
          status: "cancelled",
          reason: "Concurrent cancellation",
          decidedAt: "2026-07-16T01:05:30.000Z",
        },
      }],
    });
    conflictFatalAppendQueuedResolve();
    return cancellation.then(() => undefined);
  },
});
conflictRetryHost.bindEvents(conflictRetryEvents);
const conflictSibling = conflictRetryHost.uiContext.confirm("Concurrent sibling", "Cancel while fatal persistence is waiting.");
await conflictRetryHost.flush();
const conflictWaiting = await conflictRetryTask.workspace.open({ projectId, taskId: "task-fatal-conflict-retry" });
conflictSiblingDecision = conflictWaiting.decisions.find((decision) => decision.interactionId?.startsWith("native-ui:"));
conflictSiblingDecisionId = conflictSiblingDecision?.id ?? "";
conflictRetryEvents.emit(PI_ASK_STARTED_EVENT, {
  version: 1,
  flowId: "tool:fatal-conflict-retry",
  questions: [{ id: "scope", prompt: "Choose scope.", type: "single", options: [{ value: "batch", label: "Batch" }] }],
});
await conflictRetryHost.flush();
const conflictAskDecision = (await conflictRetryTask.workspace.open({ projectId, taskId: "task-fatal-conflict-retry" })).decisions
  .find((decision) => decision.interactionId === "pi-ask:tool:fatal-conflict-retry")!;
const conflictCommitResult = commitTaskExtensionInteraction({
  repoRoot: root,
  projectId,
  taskId: "task-fatal-conflict-retry",
  interactionId: "pi-ask:tool:fatal-conflict-retry",
  body: { action: "submit", answers: [{ decisionId: conflictAskDecision.id, selectedOptionIds: ["choice-1"] }] },
}).then(
  () => ({ error: undefined }),
  (error: unknown) => ({ error }),
);
const conflictStart = await completesWithin(Promise.race([
  conflictBlockerStarted.then(() => ({ started: true as const, error: undefined })),
  conflictCommitResult.then(({ error }) => ({ started: false as const, error })),
]), 2_000, "The conflict retry blocker did not start.");
assert.equal(
  conflictStart.started,
  true,
  `The Pi submit ended before the conflict blocker started: ${conflictStart.error instanceof Error ? conflictStart.error.message : String(conflictStart.error)}`,
);
await completesWithin(conflictFatalAppendQueued, 2_000, "The concurrent fatal cancellation was not queued.");
conflictBlockerRelease();
await conflictBlockingAppend;
const conflictCommit = await conflictCommitResult;
assert.match(conflictCommit.error instanceof Error ? conflictCommit.error.message : String(conflictCommit.error), /pi-ask submit .* timed out/);
const conflictPersistence = await conflictRetryHost.fatalPersistence();
assert.equal(conflictPersistence?.canonicalFailurePersisted, true, "fatal persistence must retry a canonical conflict once");
assert.equal(conflictPersistence?.error, undefined);
const conflictFailed = await conflictRetryTask.workspace.open({ projectId, taskId: "task-fatal-conflict-retry" });
assert.equal(conflictFailed.runs.find((run) => run.id === "run-fatal-conflict-retry")?.status, "failed");
assert.equal(conflictFailed.decisions.find((decision) => decision.id === conflictSiblingDecisionId)?.status, "cancelled");
assert.equal(conflictFailed.activities.filter((activity) => activity.title === "Package interaction failed").length, 1);
assert.equal(conflictRetryNowCalls, 4, "the conflict path must rebuild the failure events from a fresh snapshot");
await conflictRetryHost.dispose();
assert.equal(await conflictSibling, false);

const abortHangTask = await createActiveTask(root, projectId, "task-abort-hang", "run-abort-hang");
const abortHangEvents = createEventBus();
const abortHangHost = createTaskExtensionInteractionHost({
  repoRoot: root,
  projectId,
  taskId: "task-abort-hang",
  runId: "run-abort-hang",
  agentThreadId: abortHangTask.threadId,
  piAskSubmitTimeoutMs: 5,
  fatalContainmentTimeoutMs: 20,
  onFatalError: () => new Promise<void>(() => undefined),
});
abortHangHost.bindEvents(abortHangEvents);
abortHangEvents.emit(PI_ASK_STARTED_EVENT, {
  version: 1,
  flowId: "tool:abort-hang",
  questions: [{ id: "tone", prompt: "Choose tone.", type: "single", options: [{ value: "formal", label: "Formal" }] }],
});
await abortHangHost.flush();
const abortHangDecision = (await abortHangTask.workspace.open({ projectId, taskId: "task-abort-hang" })).decisions
  .find((decision) => decision.interactionId === "pi-ask:tool:abort-hang")!;
await assert.rejects(
  completesWithin(
    commitTaskExtensionInteraction({
      repoRoot: root,
      projectId,
      taskId: "task-abort-hang",
      interactionId: "pi-ask:tool:abort-hang",
      body: { action: "submit", answers: [{ decisionId: abortHangDecision.id, selectedOptionIds: ["choice-1"] }] },
    }),
    100,
    "A hanging Session abort must not strand the Decision request.",
  ),
  /pi-ask submit .* timed out/,
);
const abortHangFailed = await abortHangTask.workspace.open({ projectId, taskId: "task-abort-hang" });
assert.equal(abortHangFailed.runs.find((run) => run.id === "run-abort-hang")?.status, "failed");
assert.equal(abortHangFailed.activities.filter((activity) => activity.title === "Package interaction failed").length, 1);
await abortHangHost.dispose();

const appendHangTask = await createActiveTask(root, projectId, "task-append-hang", "run-append-hang");
const appendHangEvents = createEventBus();
let releaseAppendHang!: () => void;
const appendHangGate = new Promise<void>((resolve) => { releaseAppendHang = resolve; });
let appendHangStartedResolve!: () => void;
const appendHangStarted = new Promise<void>((resolve) => { appendHangStartedResolve = resolve; });
let blockingAppend: Promise<unknown> | undefined;
appendHangEvents.on(PI_ASK_SUBMIT_EVENT, () => {
  blockingAppend = appendHangTask.workspace.appendGenerated({
    projectId,
    taskId: "task-append-hang",
    runId: "run-append-hang",
    beforeCommit: async () => {
      appendHangStartedResolve();
      await appendHangGate;
    },
    events: [{
      type: "activity_append",
      agentThreadId: appendHangTask.threadId,
      activity: {
        id: "run-append-hang.test-blocker",
        taskId: "task-append-hang",
        runId: "run-append-hang",
        agentThreadId: appendHangTask.threadId,
        seq: 0,
        type: "progress",
        status: "done",
        actor: { kind: "system", id: "test", displayName: "Test", agentThreadId: appendHangTask.threadId },
        title: "Hold canonical append",
        body: null,
        tool: null,
        refs: { artifactIds: [], evidenceRefs: [], decisionIds: [] },
        createdAt: "2026-07-16T01:03:00.000Z",
        updatedAt: "2026-07-16T01:03:00.000Z",
      },
    }],
  });
});
let appendHangAbortCount = 0;
const appendHangHost = createTaskExtensionInteractionHost({
  repoRoot: root,
  projectId,
  taskId: "task-append-hang",
  runId: "run-append-hang",
  agentThreadId: appendHangTask.threadId,
  piAskSubmitTimeoutMs: 25,
  fatalContainmentTimeoutMs: 20,
  onFatalError: () => { appendHangAbortCount += 1; },
});
appendHangHost.bindEvents(appendHangEvents);
const appendHangSibling = appendHangHost.uiContext.confirm("Sibling question", "This must be released locally during fatal disposal.");
appendHangEvents.emit(PI_ASK_STARTED_EVENT, {
  version: 1,
  flowId: "tool:append-hang",
  questions: [{ id: "scope", prompt: "Choose scope.", type: "single", options: [{ value: "batch", label: "Batch" }] }],
});
await appendHangHost.flush();
const appendHangDecision = (await appendHangTask.workspace.open({ projectId, taskId: "task-append-hang" })).decisions
  .find((decision) => decision.interactionId === "pi-ask:tool:append-hang")!;
const appendHangCommit = commitTaskExtensionInteraction({
  repoRoot: root,
  projectId,
  taskId: "task-append-hang",
  interactionId: "pi-ask:tool:append-hang",
  body: { action: "submit", answers: [{ decisionId: appendHangDecision.id, selectedOptionIds: ["choice-1"] }] },
});
await completesWithin(appendHangStarted, 100, "The canonical append blocker did not start.");
await assert.rejects(
  completesWithin(appendHangCommit, 100, "A hanging canonical failure append must not strand the Decision request."),
  /pi-ask submit .* timed out/,
);
assert.equal(appendHangAbortCount, 1, "Session abort must start even while canonical failure persistence is blocked");
await completesWithin(
  appendHangHost.dispose(),
  100,
  "Fatal disposal must not wait on the canonical failure append lock.",
);
assert.equal(await appendHangSibling, false, "fatal disposal must release sibling generic UI locally");
releaseAppendHang();
await blockingAppend;
let appendHangFailed = await appendHangTask.workspace.open({ projectId, taskId: "task-append-hang" });
for (let attempt = 0; attempt < 100 && appendHangFailed.runs.find((run) => run.id === "run-append-hang")?.status !== "failed"; attempt += 1) {
  await new Promise((resolve) => setTimeout(resolve, 1));
  appendHangFailed = await appendHangTask.workspace.open({ projectId, taskId: "task-append-hang" });
}
assert.equal(appendHangFailed.runs.find((run) => run.id === "run-append-hang")?.status, "failed");
assert.equal(appendHangFailed.activities.filter((activity) => activity.title === "Package interaction failed").length, 1);

const stopRaceTask = await createActiveTask(root, projectId, "task-submit-stop-race", "run-submit-stop-race");
const stopRaceEvents = createEventBus();
const stopRacePayloads: Array<Record<string, unknown>> = [];
let submitStartedResolve!: () => void;
const submitStarted = new Promise<void>((resolve) => { submitStartedResolve = resolve; });
stopRaceEvents.on(PI_ASK_SUBMIT_EVENT, (value) => {
  stopRacePayloads.push(value as Record<string, unknown>);
  submitStartedResolve();
});
let stopRaceFatalCount = 0;
const stopRaceHost = createTaskExtensionInteractionHost({
  repoRoot: root,
  projectId,
  taskId: "task-submit-stop-race",
  runId: "run-submit-stop-race",
  agentThreadId: stopRaceTask.threadId,
  piAskSubmitTimeoutMs: 1_000,
  onFatalError: () => { stopRaceFatalCount += 1; },
});
stopRaceHost.bindEvents(stopRaceEvents);
stopRaceEvents.emit(PI_ASK_STARTED_EVENT, {
  version: 1,
  flowId: "tool:submit-stop-race",
  questions: [{ id: "scope", prompt: "Choose scope.", type: "single", options: [{ value: "batch", label: "Whole batch" }] }],
});
await stopRaceHost.flush();
const stopRaceDecision = (await stopRaceTask.workspace.open({ projectId, taskId: "task-submit-stop-race" })).decisions
  .find((decision) => decision.interactionId === "pi-ask:tool:submit-stop-race")!;
const stopRaceCommit = commitTaskExtensionInteraction({
  repoRoot: root,
  projectId,
  taskId: "task-submit-stop-race",
  interactionId: "pi-ask:tool:submit-stop-race",
  body: { action: "submit", answers: [{ decisionId: stopRaceDecision.id, selectedOptionIds: ["choice-1"] }] },
});
await submitStarted;
const stopRaceStop = stopRaceHost.prepareStop("User stopped while the Package acknowledgement was pending.");
let stoppingRaceSnapshot = await stopRaceTask.workspace.open({ projectId, taskId: "task-submit-stop-race" });
for (let attempt = 0; attempt < 50 && stoppingRaceSnapshot.runs.find((run) => run.id === "run-submit-stop-race")?.status !== "stopping"; attempt += 1) {
  await new Promise((resolve) => setTimeout(resolve, 1));
  stoppingRaceSnapshot = await stopRaceTask.workspace.open({ projectId, taskId: "task-submit-stop-race" });
}
assert.equal(stoppingRaceSnapshot.runs.find((run) => run.id === "run-submit-stop-race")?.status, "stopping");
assert.equal(stopRacePayloads.length, 1, "Stop and submit must share one settlement and emit only the first Pi response");
const stopRacePayload = stopRacePayloads[0]!;
await completesWithin(
  Promise.all([stopRaceCommit, stopRaceStop]),
  100,
  "Stop must not wait for a missing Package acknowledgement.",
);
assert.equal(stopRacePayloads.length, 1);
assert.deepEqual(stopRacePayload.response, {
  kind: "answer",
  mode: "submit",
  answers: { scope: { values: ["batch"] } },
});
const stoppedRace = await stopRaceTask.workspace.open({ projectId, taskId: "task-submit-stop-race" });
assert.equal(stoppedRace.runs.find((run) => run.id === "run-submit-stop-race")?.status, "stopping");
assert.equal(stoppedRace.agentThreads.find((thread) => thread.id === stopRaceTask.threadId)?.status, "stopping");
assert.equal(stopRaceFatalCount, 0);
assert.equal(stoppedRace.activities.some((activity) => activity.title === "Package interaction failed"), false);
await stopRaceHost.dispose();

const staleRestoreTask = await createActiveTask(root, projectId, "task-stale-restore", "run-stale-restore");
const staleRestoreEvents = createEventBus();
const staleRestoreHost = createTaskExtensionInteractionHost({
  repoRoot: root,
  projectId,
  taskId: "task-stale-restore",
  runId: "run-stale-restore",
  agentThreadId: staleRestoreTask.threadId,
});
staleRestoreHost.bindEvents(staleRestoreEvents);
staleRestoreEvents.emit(PI_ASK_STARTED_EVENT, {
  version: 1,
  flowId: "tool:stale-restore",
  questions: [{ id: "tone", prompt: "Choose tone.", type: "single", options: [{ value: "formal", label: "Formal" }] }],
});
await staleRestoreHost.flush();
const staleRestoreWaiting = await staleRestoreTask.workspace.open({ projectId, taskId: "task-stale-restore" });
const staleRestoreDecision = staleRestoreWaiting.decisions.find((decision) => decision.interactionId === "pi-ask:tool:stale-restore")!;
let releaseConcurrentDecision!: () => void;
const concurrentDecisionGate = new Promise<void>((resolve) => { releaseConcurrentDecision = resolve; });
let concurrentDecisionStartedResolve!: () => void;
const concurrentDecisionStarted = new Promise<void>((resolve) => { concurrentDecisionStartedResolve = resolve; });
let concurrentDecisionAppend: Promise<unknown> | undefined;
staleRestoreEvents.on(PI_ASK_SUBMIT_EVENT, (value) => {
  const payload = value as Record<string, unknown>;
  concurrentDecisionAppend = staleRestoreTask.workspace.appendGenerated({
    projectId,
    taskId: "task-stale-restore",
    runId: "run-stale-restore",
    beforeCommit: async () => {
      concurrentDecisionStartedResolve();
      await concurrentDecisionGate;
    },
    events: [{
      type: "decision_upsert",
      agentThreadId: staleRestoreTask.threadId,
      decision: {
        id: "native-ui:concurrent.question-1",
        taskId: "task-stale-restore",
        runId: "run-stale-restore",
        requestedByThreadId: staleRestoreTask.threadId,
        artifactId: null,
        kind: "answer",
        status: "required",
        prompt: "Resolve the concurrent question.",
        options: [{ id: "yes", label: "Yes", action: "answer", destructive: false }],
        interactionId: "native-ui:concurrent",
        questionIndex: 0,
        selectionMode: "single",
        selectedOptionId: null,
        selectedOptionIds: [],
        responseText: null,
        reason: null,
        scope: staleRestoreWaiting.task.scope,
        createdAt: "2026-07-16T01:04:00.000Z",
        decidedAt: null,
      },
    }],
  });
  staleRestoreEvents.emit(PI_ASK_SUBMIT_RESULT_EVENT, {
    version: 1,
    flowId: payload.flowId,
    requestId: payload.requestId,
    ok: true,
  });
});
const staleRestoreCommit = commitTaskExtensionInteraction({
  repoRoot: root,
  projectId,
  taskId: "task-stale-restore",
  interactionId: "pi-ask:tool:stale-restore",
  body: { action: "submit", answers: [{ decisionId: staleRestoreDecision.id, selectedOptionIds: ["choice-1"] }] },
});
await completesWithin(concurrentDecisionStarted, 100, "The concurrent Decision append did not start.");
releaseConcurrentDecision();
await Promise.all([staleRestoreCommit, concurrentDecisionAppend]);
const staleRestoreResult = await staleRestoreTask.workspace.open({ projectId, taskId: "task-stale-restore" });
assert.equal(staleRestoreResult.decisions.find((decision) => decision.id === staleRestoreDecision.id)?.status, "recorded");
assert.equal(staleRestoreResult.decisions.find((decision) => decision.id === "native-ui:concurrent.question-1")?.status, "required");
assert.equal(
  staleRestoreResult.runs.find((run) => run.id === "run-stale-restore")?.status,
  "awaiting_input",
  "a stale answer snapshot must not overwrite a newer required Decision with active lifecycle",
);
await staleRestoreHost.dispose();

const activityRestoreTask = await createActiveTask(root, projectId, "task-activity-restore", "run-activity-restore");
const activityRestoreEvents = createEventBus();
const activityRestoreHost = createTaskExtensionInteractionHost({
  repoRoot: root,
  projectId,
  taskId: "task-activity-restore",
  runId: "run-activity-restore",
  agentThreadId: activityRestoreTask.threadId,
});
activityRestoreHost.bindEvents(activityRestoreEvents);
activityRestoreEvents.emit(PI_ASK_STARTED_EVENT, {
  version: 1,
  flowId: "tool:activity-restore",
  questions: [{ id: "tone", prompt: "Choose tone.", type: "single", options: [{ value: "formal", label: "Formal" }] }],
});
await activityRestoreHost.flush();
const activityRestoreWaiting = await activityRestoreTask.workspace.open({ projectId, taskId: "task-activity-restore" });
const activityRestoreDecision = activityRestoreWaiting.decisions.find((decision) => decision.interactionId === "pi-ask:tool:activity-restore")!;
let releaseConcurrentActivity!: () => void;
const concurrentActivityGate = new Promise<void>((resolve) => { releaseConcurrentActivity = resolve; });
let concurrentActivityStartedResolve!: () => void;
const concurrentActivityStarted = new Promise<void>((resolve) => { concurrentActivityStartedResolve = resolve; });
let concurrentActivityAppend: Promise<unknown> | undefined;
activityRestoreEvents.on(PI_ASK_SUBMIT_EVENT, (value) => {
  const payload = value as Record<string, unknown>;
  concurrentActivityAppend = activityRestoreTask.workspace.appendGenerated({
    projectId,
    taskId: "task-activity-restore",
    runId: "run-activity-restore",
    beforeCommit: async () => {
      concurrentActivityStartedResolve();
      await concurrentActivityGate;
    },
    events: [{
      type: "activity_append",
      agentThreadId: activityRestoreTask.threadId,
      activity: {
        id: "run-activity-restore.ask-user-complete",
        taskId: "task-activity-restore",
        runId: "run-activity-restore",
        agentThreadId: activityRestoreTask.threadId,
        seq: 0,
        type: "tool_action",
        status: "done",
        actor: { kind: "agent", id: "linguist-agent", displayName: "Linguist Agent", agentThreadId: activityRestoreTask.threadId },
        title: "Linguist Agent completed ask_user",
        body: null,
        tool: { name: "ask_user", effect: "execute", target: null, outcome: "completed" },
        refs: { artifactIds: [], evidenceRefs: [], decisionIds: [activityRestoreDecision.id] },
        createdAt: "2026-07-16T01:04:30.000Z",
        updatedAt: "2026-07-16T01:04:30.000Z",
      },
    }],
  });
  activityRestoreEvents.emit(PI_ASK_SUBMIT_RESULT_EVENT, {
    version: 1,
    flowId: payload.flowId,
    requestId: payload.requestId,
    ok: true,
  });
});
const activityRestoreCommit = commitTaskExtensionInteraction({
  repoRoot: root,
  projectId,
  taskId: "task-activity-restore",
  interactionId: "pi-ask:tool:activity-restore",
  body: { action: "submit", answers: [{ decisionId: activityRestoreDecision.id, selectedOptionIds: ["choice-1"] }] },
});
await completesWithin(concurrentActivityStarted, 100, "The concurrent Activity append did not start.");
releaseConcurrentActivity();
await Promise.all([activityRestoreCommit, concurrentActivityAppend]);
const activityRestoreResult = await activityRestoreTask.workspace.open({ projectId, taskId: "task-activity-restore" });
assert.equal(activityRestoreResult.decisions.find((decision) => decision.id === activityRestoreDecision.id)?.status, "recorded");
assert.equal(
  activityRestoreResult.runs.find((run) => run.id === "run-activity-restore")?.status,
  "active",
  "an unrelated Activity race must not strand the Run in awaiting_input after the Package answer is acknowledged",
);
await activityRestoreHost.dispose();

const orphanTask = await createActiveTask(root, projectId, "task-orphan", "run-orphan");
const orphanInteractionId = "orphan-interaction";
await orphanTask.workspace.appendGenerated({
  projectId,
  taskId: "task-orphan",
  runId: "run-orphan",
  events: [{
    type: "decision_upsert",
    agentThreadId: orphanTask.threadId,
    decision: {
      id: `${orphanInteractionId}.question-1`,
      taskId: "task-orphan",
      runId: "run-orphan",
      requestedByThreadId: orphanTask.threadId,
      artifactId: null,
      kind: "answer",
      status: "required",
      prompt: "This runtime no longer owns the request.",
      options: [{ id: "yes", label: "Yes", action: "answer", destructive: false }],
      interactionId: orphanInteractionId,
      questionIndex: 0,
      selectionMode: "single",
      selectedOptionId: null,
      selectedOptionIds: [],
      responseText: null,
      reason: null,
      scope: orphanTask.scope,
      createdAt: "2026-07-16T01:03:00.000Z",
      decidedAt: null,
    },
  }],
});
await assert.rejects(
  commitTaskExtensionInteraction({
    repoRoot: root,
    projectId,
    taskId: "task-orphan",
    interactionId: orphanInteractionId,
    body: { action: "submit", answers: [{ decisionId: `${orphanInteractionId}.question-1`, selectedOptionIds: ["yes"] }] },
  }),
  (error: unknown) => (error as { status?: number }).status === 409,
);
assert.equal(
  (await orphanTask.workspace.open({ projectId, taskId: "task-orphan" })).decisions.find((decision) => decision.interactionId === orphanInteractionId)?.status,
  "required",
  "an orphaned native response must not mutate canonical truth",
);

console.log("task extension interaction tests passed");
