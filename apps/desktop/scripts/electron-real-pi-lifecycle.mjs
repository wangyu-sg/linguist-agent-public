import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import {
  assertIsolatedRuntimeURL,
  loadAcceptanceConfig,
  redactId,
  resolveCredential,
  runtimeJSON,
} from "./electron-acceptance-lib.mjs";

const TIMEOUT_MS = 180_000;

function argumentsFrom(argv) {
  const result = {};
  for (const argument of argv) {
    if (argument.startsWith("--config=")) result.configPath = resolve(argument.slice(9));
    else if (argument.startsWith("--out=")) result.outputDirectory = resolve(argument.slice(6));
    else if (argument.startsWith("--project=")) result.projectId = argument.slice(10);
    else if (argument.startsWith("--batch=")) result.batchId = argument.slice(8);
    else if (argument.startsWith("--segment=")) result.segmentId = argument.slice(10);
    else throw new Error(`Unknown real Pi lifecycle argument: ${argument}`);
  }
  return result;
}

async function requestJSON(runtimeURL, credential, method, path, body, timeoutMs = 30_000) {
  const response = await fetch(new URL(path, `${runtimeURL}/`), {
    method,
    headers: {
      authorization: `Bearer ${credential}`,
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const text = await response.text();
  let data = null;
  if (text) {
    try { data = JSON.parse(text); } catch { data = text; }
  }
  if (!response.ok) {
    const detail = data && typeof data === "object" && typeof data.error === "string" ? data.error : `HTTP ${response.status}`;
    throw new Error(`${method} ${path} failed: ${detail}`);
  }
  return data;
}

async function readChatSSE(runtimeURL, credential, path, body, timeoutMs = TIMEOUT_MS) {
  const response = await fetch(new URL(path, `${runtimeURL}/`), {
    method: "POST",
    headers: {
      authorization: `Bearer ${credential}`,
      "content-type": "application/json",
      accept: "text/event-stream",
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!response.ok || !response.body) throw new Error(`SSE ${path} returned HTTP ${response.status}.`);
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const events = [];
  let buffer = "";
  const consume = (line) => {
    if (!line.startsWith("data:")) return;
    const raw = line.slice(5).trim();
    if (raw) events.push(JSON.parse(raw));
  };
  for (;;) {
    const { done, value } = await reader.read();
    buffer += decoder.decode(value ?? new Uint8Array(), { stream: !done });
    let newline = buffer.indexOf("\n");
    while (newline >= 0) {
      consume(buffer.slice(0, newline).replace(/\r$/, ""));
      buffer = buffer.slice(newline + 1);
      newline = buffer.indexOf("\n");
    }
    if (done) break;
  }
  if (buffer.trim()) consume(buffer.replace(/\r$/, ""));
  return events;
}

function subscribeTaskEvents(runtimeURL, credential, path, afterCursor, onEvent) {
  const controller = new AbortController();
  let resolveConnected;
  const connected = new Promise((resolveConnection) => { resolveConnected = resolveConnection; });
  const completed = (async () => {
    const response = await fetch(new URL(`${path}?after=${encodeURIComponent(afterCursor)}`, `${runtimeURL}/`), {
      headers: { authorization: `Bearer ${credential}`, accept: "text/event-stream" },
      signal: controller.signal,
    });
    if (!response.ok || !response.body) throw new Error(`Task event SSE returned HTTP ${response.status}.`);
    resolveConnected();
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    const consume = (line) => {
      if (!line.startsWith("data:")) return;
      const raw = line.slice(5).trim();
      if (raw) onEvent(JSON.parse(raw));
    };
    for (;;) {
      const { done, value } = await reader.read();
      buffer += decoder.decode(value ?? new Uint8Array(), { stream: !done });
      let newline = buffer.indexOf("\n");
      while (newline >= 0) {
        consume(buffer.slice(0, newline).replace(/\r$/, ""));
        buffer = buffer.slice(newline + 1);
        newline = buffer.indexOf("\n");
      }
      if (done) break;
    }
  })().catch((error) => {
    if (!controller.signal.aborted) throw error;
  });
  return { connected, completed, close: () => controller.abort() };
}

async function waitForSnapshot(runtimeURL, credential, projectId, taskId, predicate, label) {
  const deadline = Date.now() + TIMEOUT_MS;
  let latest;
  while (Date.now() < deadline) {
    latest = await runtimeJSON(runtimeURL, credential, `/api/projects/${encodeURIComponent(projectId)}/tasks/${encodeURIComponent(taskId)}`);
    if (predicate(latest)) return latest;
    await new Promise((resolveWait) => setTimeout(resolveWait, 100));
  }
  throw new Error(`Timed out waiting for ${label}; latest cursor: ${latest?.eventCursor ?? "none"}.`);
}

async function waitUntil(predicate, label, timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((resolveWait) => setTimeout(resolveWait, 25));
  }
  throw new Error(`Timed out waiting for ${label}.`);
}

const options = argumentsFrom(process.argv.slice(2));
const config = await loadAcceptanceConfig(options.configPath);
const runtimeURL = assertIsolatedRuntimeURL(process.env.LA_ACCEPTANCE_RUNTIME_URL ?? config.runtimeURL ?? "");
const credential = await resolveCredential();
const projectId = options.projectId ?? config.scenarios?.cat1040?.projectId;
const batchId = options.batchId ?? config.scenarios?.cat1040?.batchId;
assert.ok(projectId && batchId, "The real Pi lifecycle pass requires an isolated project and batch.");
const batchResponse = await runtimeJSON(
  runtimeURL,
  credential,
  `/api/projects/${encodeURIComponent(projectId)}/batches/${encodeURIComponent(batchId)}`,
);
const segment = options.segmentId
  ? batchResponse.batch?.segments?.find((candidate) => candidate.id === options.segmentId)
  : batchResponse.batch?.segments?.find((candidate) => !candidate.locked);
assert.ok(segment, "The isolated batch has no usable segment.");

const taskId = `electron-real-pi-lifecycle-${randomUUID()}`;
const stopMessage = [
  "这是隔离的 Stop 验收，不写入 CAT。",
  "必须先调用 ask_user，提出恰好一个单选问题，询问是否继续检查当前句段。",
  "等待用户回答；不要在工具返回前给出最终回复，也不要调用其他工具。",
].join("\n");
const created = await requestJSON(
  runtimeURL,
  credential,
  "POST",
  `/api/projects/${encodeURIComponent(projectId)}/tasks`,
  {
    taskId,
    title: "Real Pi Stop and retry lifecycle",
    intent: "Prove pending interaction cancellation, Stop, cursor reconnect, and Retry as a new Run.",
    kind: "review",
    initialMessage: stopMessage,
    batchId,
    segmentIds: [segment.id],
    sourceLocale: batchResponse.batch.sourceLanguage,
    targetLocale: batchResponse.batch.targetLanguage,
  },
);
assert.ok(created.activeRunId, "Lifecycle Task creation did not reserve a Run.");

const stoppedRunId = created.activeRunId;
const pendingStream = readChatSSE(
  runtimeURL,
  credential,
  `/api/projects/${encodeURIComponent(projectId)}/tasks/${encodeURIComponent(taskId)}/chat/stream`,
  { message: stopMessage, runId: stoppedRunId, segmentId: segment.id },
);
const awaiting = await waitForSnapshot(
  runtimeURL,
  credential,
  projectId,
  taskId,
  (snapshot) => snapshot.decisions?.some((decision) => decision.runId === stoppedRunId && decision.status === "required" && decision.interactionId?.startsWith("pi-ask:")),
  "the pending pi-ask interaction",
);
const pendingDecisionIds = awaiting.decisions
  .filter((decision) => decision.runId === stoppedRunId && decision.status === "required" && decision.interactionId?.startsWith("pi-ask:"))
  .map((decision) => decision.id);
assert.ok(pendingDecisionIds.length >= 1 && pendingDecisionIds.length <= 4);

const stopResult = await requestJSON(
  runtimeURL,
  credential,
  "POST",
  `/api/projects/${encodeURIComponent(projectId)}/tasks/${encodeURIComponent(taskId)}/stop`,
  { reason: "Real Pi isolated Stop acceptance.", turnId: stoppedRunId },
);
assert.equal(stopResult.stopped, 1, "Stop did not target exactly one live Run.");
assert.deepEqual(stopResult.errors ?? [], [], "Stop reported an abort error.");
const pendingEvents = await pendingStream;
assert.equal(pendingEvents.some((event) => event.type === "assistant_final"), false, "A stopped pending interaction emitted a late final reply.");

const stopped = await waitForSnapshot(
  runtimeURL,
  credential,
  projectId,
  taskId,
  (snapshot) => snapshot.runs?.some((run) => run.id === stoppedRunId && run.status === "stopped"),
  "the stopped canonical Run",
);
assert.ok(pendingDecisionIds.every((id) => stopped.decisions.some((decision) => decision.id === id && decision.status === "cancelled")));
assert.equal(stopped.activities.some((activity) => activity.runId === stoppedRunId && activity.type === "final_response"), false);

const firstConnectionEvents = [];
let lastAcknowledgedCursor = null;
const firstConnection = subscribeTaskEvents(
  runtimeURL,
  credential,
  `/api/projects/${encodeURIComponent(projectId)}/tasks/${encodeURIComponent(taskId)}/events/stream`,
  stopped.eventCursor,
  (event) => {
    firstConnectionEvents.push(event);
    lastAcknowledgedCursor = event.cursor;
  },
);
await firstConnection.connected;

const retryMessage = "这是用户对刚才已停止工作的明确重试。不要调用工具；只用一句话确认当前句段仍在同一 Task 范围内，并说明这是新的 Run。";
const retryStream = readChatSSE(
  runtimeURL,
  credential,
  `/api/projects/${encodeURIComponent(projectId)}/tasks/${encodeURIComponent(taskId)}/chat/stream`,
  { message: retryMessage, segmentId: segment.id },
);
await waitUntil(() => lastAcknowledgedCursor !== null, "the first post-Stop Task event");
firstConnection.close();
await firstConnection.completed;

const reconnectEvents = [];
const reconnect = subscribeTaskEvents(
  runtimeURL,
  credential,
  `/api/projects/${encodeURIComponent(projectId)}/tasks/${encodeURIComponent(taskId)}/events/stream`,
  lastAcknowledgedCursor,
  (event) => reconnectEvents.push(event),
);
await reconnect.connected;
const retryChatEvents = await retryStream;
const retryError = retryChatEvents.find((event) => event.type === "error");
assert.equal(retryError, undefined, `Retry Run failed: ${retryError?.errorMessage ?? retryError?.text ?? "unknown"}`);
assert.ok(retryChatEvents.some((event) => event.type === "assistant_final"), "Retry has no assistant_final event.");

const retried = await waitForSnapshot(
  runtimeURL,
  credential,
  projectId,
  taskId,
  (snapshot) => snapshot.runs?.some((run) => run.id !== stoppedRunId && run.mode === "single" && run.status === "complete"),
  "the complete Retry Run",
);
const retryRun = retried.runs.find((run) => run.id !== stoppedRunId && run.mode === "single" && run.status === "complete");
assert.ok(retryRun && retryRun.id !== stoppedRunId, "Retry reused the stopped Run instead of creating a new Run.");
await waitUntil(
  () => reconnectEvents.some((event) => event.type === "run_upsert" && event.run?.id === retryRun.id && event.run.status === "complete"),
  "the terminal Retry event after reconnect",
);
reconnect.close();
await reconnect.completed;

const allStreamEvents = [...firstConnectionEvents, ...reconnectEvents];
assert.ok(allStreamEvents.length >= 2, "Reconnect proof contains too few canonical events.");
assert.equal(new Set(allStreamEvents.map((event) => event.cursor)).size, allStreamEvents.length, "Reconnect replayed an acknowledged cursor.");
assert.ok(allStreamEvents.every((event) => event.taskId === taskId), "Task SSE leaked another Task.");
for (let index = 1; index < allStreamEvents.length; index += 1) {
  assert.ok(allStreamEvents[index].seq > allStreamEvents[index - 1].seq, "Task SSE events are not strictly ordered.");
}

await new Promise((resolveWait) => setTimeout(resolveWait, 1_000));
const stable = await runtimeJSON(runtimeURL, credential, `/api/projects/${encodeURIComponent(projectId)}/tasks/${encodeURIComponent(taskId)}`);
assert.equal(stable.runs.find((run) => run.id === stoppedRunId)?.status, "stopped", "Late output reactivated the stopped Run.");
assert.equal(stable.runs.find((run) => run.id === retryRun.id)?.status, "complete");

const report = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  scope: {
    projectId: redactId(projectId),
    batchId: redactId(batchId),
    taskId: redactId(taskId),
    segmentId: redactId(segment.id),
  },
  proof: {
    stoppedRunId: redactId(stoppedRunId),
    stoppedStatus: "stopped",
    cancelledInteractionDecisions: pendingDecisionIds.length,
    lateReactivation: false,
    retryRunId: redactId(retryRun.id),
    retryCreatedNewRun: retryRun.id !== stoppedRunId,
    retryStatus: retryRun.status,
    firstConnectionEvents: firstConnectionEvents.length,
    reconnectEvents: reconnectEvents.length,
    uniqueOrderedEvents: allStreamEvents.length,
    taskIsolation: true,
  },
};

if (options.outputDirectory) {
  await mkdir(options.outputDirectory, { recursive: true });
  await writeFile(join(options.outputDirectory, "real-pi-lifecycle.json"), `${JSON.stringify(report, null, 2)}\n`);
}
console.log(JSON.stringify(report, null, 2));
