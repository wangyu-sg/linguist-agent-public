import { strict as assert } from "node:assert";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";
import { EventEmitter } from "node:events";
import { createTaskWorkspace } from "@linguist-agent/cat-data";
import { bindTaskDecision } from "../packages/cat-server/src/task_decision_binding.js";
import {
  formatTaskRuntimeScope,
  handleTaskWorkspaceRoute,
  taskAgentSessionId,
  type TaskAgentRuntimeRouteDeps,
} from "../packages/cat-server/src/routes/task_workspace_routes.js";
import { createTaskExtensionInteractionHost } from "../packages/cat-server/src/task_extension_interactions.js";

const root = await mkdtemp(join(tmpdir(), "la-task-workspace-routes-"));
const projectId = "project-one";
const autoTitleRequests: Array<{ projectId: string; taskId: string }> = [];
await mkdir(join(root, "data/projects", projectId, "batches/batch-one"), { recursive: true });
await writeFile(join(root, "data/projects", projectId, "batches/batch-one/batch.json"), JSON.stringify({
  projectId,
  batchId: "batch-one",
  sourceLanguage: "ja-JP",
  targetLanguage: "fr-FR",
  segments: [
    { index: 1, id: "row-1", source: "月亮会保守秘密。", target: "", rawSource: "月亮会保守秘密。", rawTarget: "", locked: false, status: "new", duplicateKey: "月亮会保守秘密。", placeholderCount: 0, unresolvedPlaceholderCount: 0 },
    { index: 2, id: "row-2", source: "已锁定。", target: "Locked.", rawSource: "已锁定。", rawTarget: "Locked.", locked: true, status: "confirmed", duplicateKey: "已锁定。", placeholderCount: 0, unresolvedPlaceholderCount: 0 },
  ],
}), "utf8");
await writeFile(join(root, "data/projects", projectId, "project.json"), JSON.stringify({
  scan: { assets: [{ relPath: "reference.txt" }] },
}), "utf8");

async function request(method: string, path: string, body: unknown = {}) {
  const url = new URL(path, "http://127.0.0.1");
  const parts = url.pathname.split("/").filter(Boolean);
  let output: { status: number; data: any } | undefined;
  const req = Object.assign(new EventEmitter(), { method }) as IncomingMessage;
  const handled = await handleTaskWorkspaceRoute(req, {} as never, url, parts, projectId, {
    repoRoot: root,
    json: (_res, status, data) => { output = { status, data }; },
    readBody: async () => body,
    scheduleAutoTitle: (input) => { autoTitleRequests.push(input); },
  });
  assert.equal(handled, true);
  assert.ok(output);
  return output;
}

const created = await request("POST", `/api/projects/${projectId}/tasks`, {
  taskId: "task-one",
  title: "审校任务",
  intent: "审校当前批次并交付。",
  kind: "review",
  batchId: "batch-one",
  segmentIds: ["row-1", "row-2"],
});
assert.equal(created.status, 201);
assert.equal(created.data.task.id, "task-one");
assert.equal(created.data.task.status, "draft");
assert.equal(created.data.task.scope.batchId, "batch-one");
assert.equal(created.data.task.scope.sourceLocale, "ja-JP");
assert.equal(created.data.task.scope.targetLocale, "fr-FR");
assert.equal(created.data.task.titleGeneration.status, "pending");
assert.deepEqual(autoTitleRequests, [{ projectId, taskId: "task-one" }]);
const invalidSegmentTask = await request("POST", `/api/projects/${projectId}/tasks`, {
  taskId: "task-outside",
  title: "越界任务",
  intent: "不应创建。",
  kind: "review",
  batchId: "batch-one",
  segmentIds: ["missing-row"],
});
assert.equal(invalidSegmentTask.status, 400);
assert.match(invalidSegmentTask.data.error, /missing-row/);
const unscopedSegmentTask = await request("POST", `/api/projects/${projectId}/tasks`, {
  title: "无批次句段",
  intent: "不应创建。",
  kind: "review",
  segmentIds: ["row-1"],
});
assert.equal(unscopedSegmentTask.status, 400);
assert.match(unscopedSegmentTask.data.error, /require batchId/);

const listed = await request("GET", `/api/projects/${projectId}/tasks`);
assert.equal(listed.status, 200);
assert.equal(listed.data.schemaVersion, 2);
assert.deepEqual(listed.data.tasks, [created.data.task]);
assert.deepEqual(listed.data.activeRuns, []);

const opened = await request("GET", `/api/projects/${projectId}/tasks/task-one`);
assert.equal(opened.status, 200);
assert.deepEqual(opened.data, created.data);

const renamed = await request("PATCH", `/api/projects/${projectId}/tasks/task-one`, { title: "审校并交付当前批次" });
assert.equal(renamed.status, 200);
assert.equal(renamed.data.task.title, "审校并交付当前批次");
assert.equal((await request("GET", `/api/projects/${projectId}/tasks/task-one`)).data.task.title, "审校并交付当前批次");
assert.equal((await request("PATCH", `/api/projects/${projectId}/tasks/task-one`, { title: "   " })).status, 400);
assert.equal((await request("PATCH", `/api/projects/${projectId}/tasks/task-one`, { title: "名".repeat(121) })).status, 400);

const firstTurnText = `Review the imported batch. ${"Preserve this detail. ".repeat(20)}`.trim();
const createdWithFirstTurn = await request("POST", `/api/projects/${projectId}/tasks`, {
  taskId: "task-first-turn",
  title: "Review imported batch",
  intent: firstTurnText,
  initialMessage: firstTurnText,
  kind: "general",
  batchId: "batch-one",
});
assert.equal(createdWithFirstTurn.status, 201);
assert.equal(createdWithFirstTurn.data.task.status, "active");
assert.equal(createdWithFirstTurn.data.runs.length, 1);
assert.equal(createdWithFirstTurn.data.runs[0]?.status, "pending");
assert.equal(createdWithFirstTurn.data.activities[0]?.body, firstTurnText);
assert.equal(createdWithFirstTurn.data.eventCursor, "task-first-turn:3");
assert.deepEqual(autoTitleRequests, [
  { projectId, taskId: "task-one" },
  { projectId, taskId: "task-first-turn" },
], "each successfully created Task schedules exactly one title generation");

const listedWithActiveRun = await request("GET", `/api/projects/${projectId}/tasks`);
assert.deepEqual(listedWithActiveRun.data.activeRuns, [{
  taskId: "task-first-turn",
  runId: createdWithFirstTurn.data.activeRunId,
  status: createdWithFirstTurn.data.runs[0].status,
  updatedAt: createdWithFirstTurn.data.runs[0].updatedAt,
  stopAvailable: createdWithFirstTurn.data.runs[0].stopAvailable,
}]);

const runtimeCalls: Array<Record<string, unknown>> = [];
const specialistFollowUpCalls: Array<Record<string, unknown>> = [];
let runtimeBody: unknown = {};
function runtimeDeps(): TaskAgentRuntimeRouteDeps {
  return {
    requireString: (value, label) => {
      if (typeof value !== "string" || !value.trim()) throw new Error(`${label} is required.`);
      return value;
    },
    optionalString: (value) => typeof value === "string" && value.trim() ? value : undefined,
    sseHeaders: () => undefined,
    writeSse: (res, event) => { res.write(`${JSON.stringify(event)}\n`); },
    runAgentStreaming: async (runtimeProjectId, message, emit, options) => {
      runtimeCalls.push({ kind: "stream", projectId: runtimeProjectId, message, ...options });
      emit({ type: "turn_start", turnId: "turn-task-one" });
      return [{ role: "assistant", content: "Done." }];
    },
    stopAgent: async (input) => {
      runtimeCalls.push({ kind: "stop", ...input });
      return { stopped: 1 };
    },
    deliverMessage: async (input) => {
      runtimeCalls.push({ kind: "deliver", ...input });
      return { messageId: "queued-one", runId: input.runId ?? "turn-task-one", delivery: input.delivery, queuePosition: input.delivery === "follow_up" ? 1 : undefined };
    },
    messageQueue: {
      read: async (locator) => ({ schemaVersion: 1, taskId: locator.taskId, paused: false, pausedReason: null, messages: [], updatedAt: "2026-07-22T00:00:00.000Z" }),
      edit: async () => { throw new Error("not used"); },
      delete: async () => { throw new Error("not used"); },
      clear: async () => { throw new Error("not used"); },
      reorder: async () => { throw new Error("not used"); },
      pause: async () => { throw new Error("not used"); },
      resume: async () => { throw new Error("not used"); },
      retry: async () => { throw new Error("not used"); },
      steerNow: async () => { throw new Error("not used"); },
    },
    projectSessionInfo: async (runtimeProjectId, sessionId) => {
      runtimeCalls.push({ kind: "session", projectId: runtimeProjectId, sessionId });
      return { sessionId };
    },
    compactProjectAgentSession: async (runtimeProjectId, taskId, customInstructions, sessionId) => {
      runtimeCalls.push({ kind: "compact", projectId: runtimeProjectId, taskId, customInstructions, sessionId });
      return { sessionId, compacted: true };
    },
  };
}

async function runtimeRequest(method: string, path: string, body: unknown = {}) {
  const url = new URL(path, "http://127.0.0.1");
  const parts = url.pathname.split("/").filter(Boolean);
  const chunks: string[] = [];
  let ended = false;
  let output: { status: number; data: any } | undefined;
  runtimeBody = body;
  const res = {
    write: (chunk: string) => { chunks.push(String(chunk)); return true; },
    end: () => { ended = true; },
  } as unknown as ServerResponse;
  const handled = await handleTaskWorkspaceRoute({ method } as IncomingMessage, res, url, parts, projectId, {
    repoRoot: root,
    json: (_res, status, data) => { output = { status, data }; },
    readBody: async () => runtimeBody,
    agentRuntime: runtimeDeps(),
    specialistFollowUp: {
      start: async (input) => {
        specialistFollowUpCalls.push(input);
        return { taskId: input.taskId, runId: "follow-up-run", threadId: "follow-up-run.translator", roleId: "translator" };
      },
    },
  });
  assert.equal(handled, true);
  return { chunks, ended, output };
}

assert.equal(taskAgentSessionId("task-one"), "la-task-task-one");
assert.deepEqual(formatTaskRuntimeScope({ kind: "project", batchId: "batch-one", segmentIds: ["row-1", "row-2"], sourceLocale: "ja-JP", targetLocale: "fr-FR" }), [
  "Task batch: batch-one",
  "Task locale: ja-JP -> fr-FR",
  "Task segments: row-1, row-2",
]);
assert.deepEqual(formatTaskRuntimeScope({ kind: "project", segmentIds: [] }), [
  "Task batch: project-level",
  "Task locale: unscoped -> unscoped",
  "Task segments: not specified",
]);
const streamed = await runtimeRequest(
  "POST",
  `/api/projects/${projectId}/tasks/task-one/chat/stream?noTools=all&tools=bash&extensions=%2Ftmp%2Frogue-extension`,
  {
    message: "Review this",
    segmentId: "row-1",
    modelProvider: "deepseek",
    modelId: "deepseek-v4-flash",
    thinkingLevel: "high",
    assetPaths: ["reference.txt"],
    capabilityIds: ["research"],
  },
);
assert.equal(streamed.ended, true);
assert.match(streamed.chunks.join(""), /turn-task-one/);
assert.deepEqual(runtimeCalls.at(-1), {
  kind: "stream",
  projectId,
  message: "Review this",
  segmentId: "row-1",
  segmentSource: "月亮会保守秘密。",
  sessionId: "la-task-task-one",
  taskId: "task-one",
  taskScope: {
    kind: "project",
    batchId: "batch-one",
    segmentIds: ["row-1", "row-2"],
    sourceLocale: "ja-JP",
    targetLocale: "fr-FR",
  },
  modelProvider: "deepseek",
  modelId: "deepseek-v4-flash",
  thinkingLevel: "high",
  attachmentPaths: ["reference.txt"],
  attachmentRefs: ["asset:reference.txt"],
  capabilityIds: ["research"],
});
const delivered = await runtimeRequest("POST", `/api/projects/${projectId}/tasks/task-one/messages`, {
  message: "Run this after the current response.",
  delivery: "follow_up",
});
assert.equal(delivered.output?.status, 202);
assert.deepEqual(runtimeCalls.at(-1), {
  kind: "deliver",
  projectId,
  taskId: "task-one",
  runId: undefined,
  message: "Run this after the current response.",
  delivery: "follow_up",
});
const deliveryCallCount = runtimeCalls.length;
const invalidDeliveryBody = await runtimeRequest("POST", `/api/projects/${projectId}/tasks/task-one/messages`, null);
assert.equal(invalidDeliveryBody.output?.status, 400);
assert.equal(runtimeCalls.length, deliveryCallCount, "a non-object message body must fail before delivery");
const routeCallCount = runtimeCalls.length;
const mismatchedModelRoute = await runtimeRequest("POST", `/api/projects/${projectId}/tasks/task-one/chat/stream`, {
  message: "Must not start",
  modelProvider: "deepseek",
});
assert.equal(mismatchedModelRoute.output?.status, 400);
assert.equal(runtimeCalls.length, routeCallCount, "a partial model route must fail before model launch");
const unknownAsset = await runtimeRequest("POST", `/api/projects/${projectId}/tasks/task-one/chat/stream`, {
  message: "Must not start",
  assetPaths: ["missing.txt"],
});
assert.equal(unknownAsset.output?.status, 409);
assert.match(unknownAsset.output?.data.error, /Unknown Project asset/);
assert.equal(runtimeCalls.length, routeCallCount, "an unknown Project asset must fail before model launch");
const invalidThinkingLevel = await runtimeRequest("POST", `/api/projects/${projectId}/tasks/task-one/chat/stream`, {
  message: "Must not start",
  thinkingLevel: "turbo",
});
assert.equal(invalidThinkingLevel.output?.status, 400);
assert.match(invalidThinkingLevel.output?.data.error, /thinkingLevel is invalid/);
assert.equal(runtimeCalls.length, routeCallCount, "an invalid thinking level must fail before model launch");
const unavailableCapability = await runtimeRequest("POST", `/api/projects/${projectId}/tasks/task-one/chat/stream`, {
  message: "Must not start",
  capabilityIds: ["browser"],
});
assert.equal(unavailableCapability.output?.status, 409);
assert.equal(runtimeCalls.length, routeCallCount, "an unavailable native capability must fail before model launch");
await runtimeRequest(
  "POST",
  `/api/projects/${projectId}/tasks/task-first-turn/chat/stream`,
  { message: firstTurnText, runId: createdWithFirstTurn.data.runs[0].id },
);
assert.equal(runtimeCalls.at(-1)?.expectedRunId, createdWithFirstTurn.data.runs[0].id, "the first stream must carry its canonical pending Run id");
const runtimeCallCountBeforeOutsideSegment = runtimeCalls.length;
const outsideSegment = await runtimeRequest("POST", `/api/projects/${projectId}/tasks/task-one/chat/stream`, { message: "Review another row", segmentId: "missing-row", segmentSource: "forged" });
assert.equal(outsideSegment.output?.status, 409);
assert.match(outsideSegment.output?.data.error, /outside Task scope/);
assert.equal(runtimeCalls.length, runtimeCallCountBeforeOutsideSegment, "an out-of-scope segment must fail before model launch");

const followedUp = await runtimeRequest(
  "POST",
  `/api/projects/${projectId}/tasks/task-one/threads/source%2Etranslator/follow-up`,
  { message: "Check the voice again.", artifactId: "artifact-one", activityId: "activity-one" },
);
assert.equal(followedUp.output?.status, 202);
assert.deepEqual(specialistFollowUpCalls.at(-1), {
  projectId,
  taskId: "task-one",
  sourceThreadId: "source.translator",
  message: "Check the voice again.",
  artifactId: "artifact-one",
  activityId: "activity-one",
});
const emptyFollowUp = await runtimeRequest("POST", `/api/projects/${projectId}/tasks/task-one/threads/source%2Etranslator/follow-up`, { message: "  " });
assert.equal(emptyFollowUp.output?.status, 400);
const session = await runtimeRequest("GET", `/api/projects/${projectId}/tasks/task-one/session`);
assert.deepEqual(session.output, { status: 200, data: { sessionId: "la-task-task-one" } });
const compact = await runtimeRequest("POST", `/api/projects/${projectId}/tasks/task-one/compact`, { customInstructions: "Preserve decisions." });
assert.equal(compact.output?.status, 200);
assert.deepEqual(runtimeCalls.at(-1), {
  kind: "compact",
  projectId,
  taskId: "task-one",
  customInstructions: "Preserve decisions.",
  sessionId: "la-task-task-one",
});
const stoppedTask = await runtimeRequest("POST", `/api/projects/${projectId}/tasks/task-one/stop`, { reason: "user stop", turnId: "turn-task-one" });
assert.equal(stoppedTask.output?.status, 200);
assert.deepEqual(runtimeCalls.at(-1), {
  kind: "stop",
  projectId,
  taskId: "task-one",
  reason: "user stop",
  runId: "turn-task-one",
  mode: undefined,
});
const stoppedPendingTask = await runtimeRequest("POST", `/api/projects/${projectId}/tasks/task-first-turn/stop`, { reason: "stop pending" });
assert.equal(stoppedPendingTask.output?.status, 200);
assert.deepEqual(runtimeCalls.at(-1), {
  kind: "stop",
  projectId,
  taskId: "task-first-turn",
  reason: "stop pending",
  runId: createdWithFirstTurn.data.activeRunId,
  mode: "single",
});
const runtimeCallCount = runtimeCalls.length;
const missingTaskStream = await runtimeRequest("POST", `/api/projects/${projectId}/tasks/missing/chat/stream`, { message: "Never run" });
assert.deepEqual(missingTaskStream.output, { status: 404, data: { error: "Task missing was not found in project project-one." } });
assert.equal(runtimeCalls.length, runtimeCallCount, "a missing canonical Task must fail before starting the model runtime");

const initialProbe = await request("GET", `/api/projects/${projectId}/tasks/task-one/probe`);
assert.equal(initialProbe.status, 200);
assert.deepEqual(initialProbe.data, {
  schemaVersion: 2,
  kind: "project",
  projectId,
  taskId: "task-one",
  taskStatus: "draft",
  taskUpdatedAt: renamed.data.task.updatedAt,
  eventCursor: "task-one:0",
  projectedAt: renamed.data.projectedAt,
  activeRunId: null,
  activeRunStatus: null,
  activeRunUpdatedAt: null,
});

assert.equal((await request("POST", `/api/projects/${projectId}/tasks`, { title: "bad", intent: "bad", kind: "unknown" })).status, 400);
assert.equal((await request("POST", `/api/projects/${projectId}/tasks`, { title: "bad", intent: "bad", kind: "general", initialMessage: "  " })).status, 400);
assert.equal((await request("POST", `/api/projects/${projectId}/tasks`, { title: "bad", intent: "bad", kind: "general", segmentIds: [1] })).status, 400);
assert.equal((await request("POST", `/api/projects/${projectId}/tasks`, {
  title: "wrong locale",
  intent: "wrong locale",
  kind: "general",
  batchId: "batch-one",
  sourceLocale: "en-US",
  targetLocale: "zh-CN",
})).status, 400);
assert.equal((await request("GET", `/api/projects/${projectId}/tasks/missing`)).status, 404);
assert.equal((await request("GET", `/api/projects/${projectId}/tasks/task-one/events`)).status, 400);

const workspace = createTaskWorkspace(root);
await workspace.append({
  projectId,
  taskId: "task-one",
  page: {
    schemaVersion: 2,
    taskId: "task-one",
    runId: "run-one",
    afterCursor: "task-one:0",
    nextCursor: "task-one:2",
    hasMore: false,
    events: [{
      id: "event-run-one",
      cursor: "task-one:1",
      seq: 1,
      taskId: "task-one",
      runId: "run-one",
      agentThreadId: "thread-main",
      type: "run_upsert",
      occurredAt: "2026-07-11T01:00:00.000Z",
      run: {
        id: "run-one",
        taskId: "task-one",
        mode: "single",
        status: "active",
        rootAgentThreadId: "thread-main",
        updatedAt: "2026-07-11T01:00:00.000Z",
        stopAvailable: true,
        resumeAvailable: false,
      },
    }, {
      id: "event-thread-main",
      cursor: "task-one:2",
      seq: 2,
      taskId: "task-one",
      runId: "run-one",
      agentThreadId: "thread-main",
      type: "thread_upsert",
      occurredAt: "2026-07-11T01:00:00.000Z",
      thread: {
        id: "thread-main",
        taskId: "task-one",
        runId: "run-one",
        parentThreadId: null,
        identity: {
          kind: "main",
          roleId: "linguist-agent",
          displayName: "Linguist Agent",
          roleLabel: "主 Agent",
          disclosureLabel: "Agent",
        },
        status: "active",
        canReceiveUserMessage: true,
        handoffSummary: null,
        latestActivityId: null,
        childThreadIds: [],
        createdAt: "2026-07-11T01:00:00.000Z",
        updatedAt: "2026-07-11T01:00:00.000Z",
      },
    }],
  },
});

const activeProbe = await request("GET", `/api/projects/${projectId}/tasks/task-one/probe`);
assert.equal(activeProbe.status, 200);
assert.equal(activeProbe.data.eventCursor, "task-one:2");
assert.equal(activeProbe.data.activeRunId, "run-one");
assert.equal(activeProbe.data.activeRunStatus, "active");

const batchDir = join(root, "data", "projects", projectId, "batches", "batch-one");
await mkdir(batchDir, { recursive: true });
await writeFile(join(batchDir, "batch.json"), `${JSON.stringify({
  schemaVersion: 1,
  format: "csv_paste",
  projectId,
  batchId: "batch-one",
  sourceFile: join(batchDir, "source.csv"),
  sourceLanguage: "zh-CN",
  targetLanguage: "en-US",
  createdAt: "2026-07-11T01:00:00.000Z",
  updatedAt: "2026-07-11T01:00:00.000Z",
  tagReport: { totalSegments: 2, placeholderSegments: 0, masterMatchedSegments: 2, masterUnmatchedSegments: 0, replacedPlaceholders: 0, unresolvedPlaceholders: 0, unresolvedRuntimePlaceholders: 0, unresolvedTagPlaceholders: 0, tagCountMismatches: 0 },
  duplicateSourceGroups: [],
  segments: [
    { index: 1, id: "row-1", source: "月亮会保守秘密。", target: "The moon keeps secrets.", rawSource: "月亮会保守秘密。", rawTarget: "The moon keeps secrets.", locked: false, status: "draft", duplicateKey: "月亮会保守秘密。", placeholderCount: 0, unresolvedPlaceholderCount: 0 },
    { index: 2, id: "row-2", source: "已锁定。", target: "Locked.", rawSource: "已锁定。", rawTarget: "Locked.", locked: true, status: "confirmed", duplicateKey: "已锁定。", placeholderCount: 0, unresolvedPlaceholderCount: 0 },
  ],
})}\n`, "utf8");
await workspace.appendGenerated({
  projectId,
  taskId: "task-one",
  runId: "run-one",
  events: [{
    type: "artifact_upsert",
    agentThreadId: "thread-main",
    artifact: {
      id: "artifact-row-1",
      taskId: "task-one",
      runId: "run-one",
      type: "segment_proposal",
      status: "reviewable",
      title: "Candidate · row-1",
      summary: "Editor candidate.",
      scope: { kind: "project", batchId: "batch-one", segmentIds: ["row-1"], sourceLocale: "zh-CN", targetLocale: "en-US" },
      version: 1,
      provenance: { agentThreadId: "thread-main", activityId: null, evidenceRefs: ["tm:row-1"], parentArtifactIds: [] },
      availableDecisions: ["apply", "reject", "request_change"],
      content: { segmentId: "row-1", target: "The moon will keep my secret." },
      createdAt: "2026-07-11T01:01:00.000Z",
      updatedAt: "2026-07-11T01:01:00.000Z",
    },
  }, {
    type: "decision_upsert",
    agentThreadId: "thread-main",
    decision: bindTaskDecision({
      id: "decision-row-1",
      taskId: "task-one",
      runId: "run-one",
      requestedByThreadId: "thread-main",
      artifactId: "artifact-row-1",
      kind: "proposal_review",
      status: "required",
      prompt: "Apply this candidate through CAT gates?",
      options: [
        { id: "apply", label: "Apply", action: "apply", destructive: false },
        { id: "reject", label: "Reject", action: "reject", destructive: false },
      ],
      selectedOptionId: null,
      reason: null,
      scope: { kind: "project", batchId: "batch-one", segmentIds: ["row-1"], sourceLocale: "zh-CN", targetLocale: "en-US" },
      createdAt: "2026-07-11T01:01:00.000Z",
      decidedAt: null,
    }, { expiresAt: "2030-01-01T00:00:00.000Z" }),
  }],
});

const appliedDecision = await request("POST", `/api/projects/${projectId}/tasks/task-one/decisions/decision-row-1`, {
  optionId: "apply",
  reason: "Reviewed in the task artifact inspector.",
});
assert.equal(appliedDecision.status, 200);
assert.deepEqual(appliedDecision.data.applyResult.applied.length, 1);
assert.equal(appliedDecision.data.snapshot.decisions.find((row: { id: string }) => row.id === "decision-row-1").status, "recorded");
assert.equal(appliedDecision.data.snapshot.artifacts.find((row: { id: string }) => row.id === "artifact-row-1").status, "accepted");
const savedBatch = JSON.parse(await readFile(join(batchDir, "batch.json"), "utf8"));
assert.equal(savedBatch.segments[0].target, "The moon will keep my secret.");

await workspace.appendGenerated({
  projectId,
  taskId: "task-one",
  runId: "run-one",
  events: [{
    type: "artifact_upsert",
    agentThreadId: "thread-main",
    artifact: {
      id: "artifact-row-2",
      taskId: "task-one",
      runId: "run-one",
      type: "segment_proposal",
      status: "reviewable",
      title: "Candidate · row-2",
      summary: "Must remain locked.",
      scope: { kind: "project", batchId: "batch-one", segmentIds: ["row-2"], sourceLocale: "zh-CN", targetLocale: "en-US" },
      version: 1,
      provenance: { agentThreadId: "thread-main", activityId: null, evidenceRefs: [], parentArtifactIds: [] },
      availableDecisions: ["apply", "reject"],
      content: { segmentId: "row-2", target: "Changed locked target." },
      createdAt: "2026-07-11T01:02:00.000Z",
      updatedAt: "2026-07-11T01:02:00.000Z",
    },
  }, {
    type: "decision_upsert",
    agentThreadId: "thread-main",
    decision: bindTaskDecision({
      id: "decision-row-2",
      taskId: "task-one",
      runId: "run-one",
      requestedByThreadId: "thread-main",
      artifactId: "artifact-row-2",
      kind: "proposal_review",
      status: "required",
      prompt: "Apply locked candidate?",
      options: [{ id: "apply", label: "Apply", action: "apply", destructive: false }],
      selectedOptionId: null,
      reason: null,
      scope: { kind: "project", batchId: "batch-one", segmentIds: ["row-2"], sourceLocale: "zh-CN", targetLocale: "en-US" },
      createdAt: "2026-07-11T01:02:00.000Z",
      decidedAt: null,
    }, { expiresAt: "2030-01-01T00:00:00.000Z" }),
  }],
});
const lockedDecision = await request("POST", `/api/projects/${projectId}/tasks/task-one/decisions/decision-row-2`, {
  optionId: "apply",
  reason: "Attempt a locked-row write.",
});
assert.equal(lockedDecision.status, 409);
const afterLockedAttempt = await request("GET", `/api/projects/${projectId}/tasks/task-one`);
assert.equal(afterLockedAttempt.data.decisions.find((row: { id: string }) => row.id === "decision-row-2").status, "required");
assert.equal(JSON.parse(await readFile(join(batchDir, "batch.json"), "utf8")).segments[1].target, "Locked.");

const events = await request("GET", `/api/projects/${projectId}/tasks/task-one/events?runId=run-one&after=task-one%3A0&limit=10`);
assert.equal(events.status, 200);
assert.equal(events.data.events.length, 9);
assert.equal(events.data.nextCursor, "task-one:9");
assert.equal((await request("GET", `/api/projects/${projectId}/tasks/task-one/events?runId=run-one&limit=nope`)).status, 400);
assert.equal((await request("GET", `/api/projects/${projectId}/tasks/task-one/events?runId=run-one&after=missing`)).status, 409);
assert.equal((await request("POST", `/api/projects/${projectId}/tasks/task-one/events`, {})).status, 404, "clients cannot append authoritative events");

const singleQuestion = {
  id: "decision-interaction-one",
  taskId: "task-one",
  runId: "run-one",
  requestedByThreadId: "thread-main",
  artifactId: null,
  kind: "answer" as const,
  status: "required" as const,
  prompt: "Which tone should the Agent use?",
  options: [
    { id: "formal", label: "Formal", action: "answer" as const, destructive: false, description: "Restrained production copy.", preview: "Please proceed." },
    { id: "casual", label: "Casual", action: "answer" as const, destructive: false },
  ],
  interactionId: "native-ui:orphan",
  questionIndex: 0,
  selectionMode: "single" as const,
  selectedOptionId: null,
  selectedOptionIds: [],
  responseText: null,
  reason: null,
  scope: { kind: "project", batchId: "batch-one", segmentIds: ["row-1"], sourceLocale: "zh-CN", targetLocale: "en-US" },
  createdAt: "2026-07-11T01:03:00.000Z",
  decidedAt: null,
};
await workspace.appendGenerated({
  projectId,
  taskId: "task-one",
  runId: "run-one",
  events: [{ type: "decision_upsert", agentThreadId: "thread-main", decision: singleQuestion }],
});

const legacyInteractionBypass = await request(
  "POST",
  `/api/projects/${projectId}/tasks/task-one/decisions/${singleQuestion.id}`,
  { optionId: "formal", reason: "This must use the live interaction bridge." },
);
assert.equal(legacyInteractionBypass.status, 409, "the legacy Decision route must not bypass a live Package resolver");
assert.match(legacyInteractionBypass.data.error, /decision-interactions endpoint/);
const afterLegacyInteractionBypass = await request("GET", `/api/projects/${projectId}/tasks/task-one`);
assert.equal(
  afterLegacyInteractionBypass.data.decisions.find((row: { id: string }) => row.id === singleQuestion.id).status,
  "required",
  "the rejected legacy route must leave the native interaction pending",
);

const orphanInteraction = await request(
  "POST",
  `/api/projects/${projectId}/tasks/task-one/decision-interactions/native-ui%3Aorphan`,
  { action: "submit", answers: [{ decisionId: singleQuestion.id, selectedOptionIds: ["formal"] }] },
);
assert.equal(orphanInteraction.status, 409, "an App reconnect cannot answer a Package interaction without its live Pi resolver");
const afterOrphanAttempt = await request("GET", `/api/projects/${projectId}/tasks/task-one`);
assert.equal(afterOrphanAttempt.data.decisions.find((row: { id: string }) => row.id === singleQuestion.id).status, "required");

const liveInteractionHost = createTaskExtensionInteractionHost({
  repoRoot: root,
  projectId,
  taskId: "task-one",
  runId: "run-one",
  agentThreadId: "thread-main",
  createInteractionId: () => "native-ui:live-route",
});
const liveSelection = liveInteractionHost.uiContext.select("Choose live tone", ["Formal", "Casual"]);
await liveInteractionHost.flush();
const liveSnapshot = await request("GET", `/api/projects/${projectId}/tasks/task-one`);
const liveDecision = liveSnapshot.data.decisions.find((row: { interactionId?: string }) => row.interactionId === "native-ui:live-route");
const liveInteractionResponse = await request(
  "POST",
  `/api/projects/${projectId}/tasks/task-one/decision-interactions/native-ui%3Alive-route`,
  { action: "submit", answers: [{ decisionId: liveDecision.id, selectedOptionIds: ["option-2"] }] },
);
assert.equal(liveInteractionResponse.status, 200);
assert.equal(await liveSelection, "Casual", "the HTTP endpoint must resume the live Pi resolver only after canonical commit");
await liveInteractionHost.dispose();

const authorityDecision = {
  ...singleQuestion,
  id: "decision-interaction-authority",
  interactionId: "interaction-authority",
  kind: "approval" as const,
  options: [{ id: "approve", label: "Approve", action: "approve" as const, destructive: false }],
};
await workspace.appendGenerated({
  projectId,
  taskId: "task-one",
  runId: "run-one",
  events: [{ type: "decision_upsert", agentThreadId: "thread-main", decision: authorityDecision }],
});
const authorityBypass = await request(
  "POST",
  `/api/projects/${projectId}/tasks/task-one/decision-interactions/interaction-authority`,
  { action: "submit", answers: [{ decisionId: "decision-interaction-authority", selectedOptionIds: ["approve"] }] },
);
assert.equal(authorityBypass.status, 409, "native interaction answers must not bypass canonical approval/apply gates");

const isolatedTask = await workspace.create({
  projectId,
  taskId: "task-two",
  title: "Isolated interaction",
  intent: "Must not answer another Task's question.",
  kind: "general",
});
assert.equal(isolatedTask.task.id, "task-two");
const crossTaskInteraction = await request(
  "POST",
  `/api/projects/${projectId}/tasks/task-two/decision-interactions/interaction-one`,
  { action: "submit", answers: [{ decisionId: "decision-interaction-one", selectedOptionIds: ["formal"] }] },
);
assert.equal(crossTaskInteraction.status, 404);

const invalidTaskStream = await request("GET", `/api/projects/${projectId}/tasks/task-one/events/stream?after=missing`);
assert.equal(invalidTaskStream.status, 409);

async function openTaskEventStream(after: string, taskId = "task-one") {
  const url = new URL(`/api/projects/${projectId}/tasks/${taskId}/events/stream?after=${encodeURIComponent(after)}`, "http://127.0.0.1");
  const parts = url.pathname.split("/").filter(Boolean);
  const requestEvents = new EventEmitter() as IncomingMessage;
  Object.assign(requestEvents, { method: "GET" });
  const chunks: string[] = [];
  const headers = new Map<string, string>();
  let statusCode = 0;
  let output: { status: number; data: any } | undefined;
  const response = {
    setHeader: (name: string, value: string) => { headers.set(name.toLowerCase(), String(value)); },
    writeHead: (status: number, values?: Record<string, string>) => {
      statusCode = status;
      for (const [name, value] of Object.entries(values ?? {})) headers.set(name.toLowerCase(), String(value));
    },
    flushHeaders: () => undefined,
    write: (chunk: string) => { chunks.push(String(chunk)); return true; },
    end: () => undefined,
  } as unknown as ServerResponse;
  await handleTaskWorkspaceRoute(requestEvents, response, url, parts, projectId, {
    repoRoot: root,
    json: (_res, status, data) => { output = { status, data }; },
    readBody: async () => ({}),
  });
  return { requestEvents, chunks, headers, statusCode, output };
}

const catchUpStream = await openTaskEventStream("task-one:0");
assert.equal(catchUpStream.statusCode, 200);
assert.match(catchUpStream.headers.get("content-type") ?? "", /text\/event-stream/);
assert.equal(catchUpStream.output, undefined);
const catchUpEvents = catchUpStream.chunks
  .flatMap((chunk) => chunk.split("\n"))
  .filter((line) => line.startsWith("data: "))
  .map((line) => JSON.parse(line.slice(6)) as { id: string; seq: number });
assert.equal(catchUpEvents.some((event) => event.id === "event-run-one"), true);
assert.equal(new Set(catchUpEvents.map((event) => event.id)).size, catchUpEvents.length, "catch-up must not duplicate events");
catchUpStream.requestEvents.emit("aborted");

const beforeLiveStream = await workspace.open({ projectId, taskId: "task-one" });
const liveStream = await openTaskEventStream(beforeLiveStream.eventCursor);
const afterLiveEvent = await workspace.appendGenerated({
  projectId,
  taskId: "task-one",
  runId: "run-one",
  events: [{
    id: "event-stream-live-one",
    type: "activity_append",
    agentThreadId: "thread-main",
    activity: {
      id: "activity-stream-live-one",
      taskId: "task-one",
      runId: "run-one",
      agentThreadId: "thread-main",
      seq: 0,
      type: "progress",
      status: "done",
      actor: { kind: "system", id: "runtime", displayName: "Runtime", agentThreadId: "thread-main" },
      title: "Live activity",
      body: null,
      tool: null,
      refs: { artifactIds: [], evidenceRefs: [], decisionIds: [] },
      createdAt: "2026-07-11T01:04:00.000Z",
      updatedAt: "2026-07-11T01:04:00.000Z",
    },
  }],
});
await new Promise((resolve) => setImmediate(resolve));
assert.equal(liveStream.chunks.some((chunk) => chunk.includes("event-stream-live-one")), true);
const chunkCountAtClose = liveStream.chunks.length;
liveStream.requestEvents.emit("aborted");
const reconnectStream = await openTaskEventStream(afterLiveEvent.eventCursor);
const isolatedBefore = await workspace.open({ projectId, taskId: "task-two" });
const isolatedStream = await openTaskEventStream(isolatedBefore.eventCursor, "task-two");
const isolatedChunkCount = isolatedStream.chunks.length;
await workspace.appendGenerated({
  projectId,
  taskId: "task-one",
  runId: "run-one",
  events: [{
    id: "event-stream-after-close",
    type: "activity_append",
    agentThreadId: "thread-main",
    activity: {
      id: "activity-stream-after-close",
      taskId: "task-one",
      runId: "run-one",
      agentThreadId: "thread-main",
      seq: 0,
      type: "progress",
      status: "done",
      actor: { kind: "system", id: "runtime", displayName: "Runtime", agentThreadId: "thread-main" },
      title: "After close",
      body: null,
      tool: null,
      refs: { artifactIds: [], evidenceRefs: [], decisionIds: [] },
      createdAt: "2026-07-11T01:04:01.000Z",
      updatedAt: "2026-07-11T01:04:01.000Z",
    },
  }],
});
await new Promise((resolve) => setImmediate(resolve));
assert.equal(liveStream.chunks.length, chunkCountAtClose, "closed streams must unsubscribe from Task events");
assert.equal(reconnectStream.chunks.some((chunk) => chunk.includes("event-stream-live-one")), false, "reconnect must resume after the acknowledged cursor");
assert.equal(reconnectStream.chunks.some((chunk) => chunk.includes("event-stream-after-close")), true, "reconnect must receive later events");
assert.equal(isolatedStream.chunks.length, isolatedChunkCount, "a Task stream must not receive another Task's events");
reconnectStream.requestEvents.emit("aborted");
isolatedStream.requestEvents.emit("aborted");

await rm(root, { recursive: true, force: true });
console.log("task workspace route tests passed");
