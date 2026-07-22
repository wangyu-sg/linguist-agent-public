import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { join, resolve } from "node:path";
import {
  assertIsolatedRuntimeURL,
  loadAcceptanceConfig,
  redactId,
  resolveCredential,
  runtimeJSON,
} from "./electron-acceptance-lib.mjs";
import { prepareNativeCapabilityAgentDir } from "./prepare-native-capabilities.mjs";

const REPO_ROOT = resolve(import.meta.dirname, "../../..");
const TIMEOUT_MS = 180_000;

function argumentsFrom(argv) {
  const result = { port: 8799 };
  for (const argument of argv) {
    if (argument.startsWith("--config=")) result.configPath = resolve(argument.slice(9));
    else if (argument.startsWith("--out=")) result.outputDirectory = resolve(argument.slice(6));
    else if (argument.startsWith("--project=")) result.projectId = argument.slice(10);
    else if (argument.startsWith("--batch=")) result.batchId = argument.slice(8);
    else if (argument.startsWith("--segment=")) result.segmentId = argument.slice(10);
    else if (argument.startsWith("--port=")) result.port = Number(argument.slice(7));
    else throw new Error(`Unknown real Pi restart argument: ${argument}`);
  }
  if (!Number.isInteger(result.port) || result.port < 1024 || result.port > 65535 || result.port === 8787) {
    throw new Error("Restart acceptance port must be 1024-65535 and cannot be the managed port 8787.");
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

async function assertPortFree(port) {
  await new Promise((resolveFree, reject) => {
    const probe = createServer();
    probe.once("error", reject);
    probe.listen(port, "127.0.0.1", () => probe.close(resolveFree));
  }).catch((error) => {
    if (error?.code === "EADDRINUSE") {
      throw new Error(`Port ${port} is already in use. Stop the isolated acceptance runtime; managed port 8787 must remain untouched.`);
    }
    throw error;
  });
}

async function waitForHealth(runtimeURL, child, logs) {
  const deadline = Date.now() + 45_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`Isolated runtime exited before health was ready (code ${child.exitCode}). ${logs.slice(-3).join(" ")}`);
    }
    try {
      const response = await fetch(new URL("/api/health", `${runtimeURL}/`), { signal: AbortSignal.timeout(1_000) });
      if (response.ok) return await response.json();
    } catch {
      // The process has not bound the loopback socket yet.
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 100));
  }
  throw new Error(`Timed out waiting for the isolated runtime. ${logs.slice(-3).join(" ")}`);
}

async function startRuntime({ port, agentDir }) {
  const runtimeURL = assertIsolatedRuntimeURL(`http://127.0.0.1:${port}`);
  const logs = [];
  const executable = join(REPO_ROOT, "node_modules", ".bin", "tsx");
  const child = spawn(executable, ["packages/cat-server/src/server.ts"], {
    cwd: REPO_ROOT,
    env: {
      ...process.env,
      LA_ELECTRON_ACCEPTANCE: "1",
      LA_SERVER_PORT: String(port),
      LA_NATIVE_CAPABILITY_AGENT_DIR: agentDir,
    },
    detached: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const collect = (chunk) => {
    for (const line of String(chunk).split(/\r?\n/)) {
      if (line.trim()) logs.push(line.trim().slice(0, 500));
    }
  };
  child.stdout.on("data", collect);
  child.stderr.on("data", collect);
  const health = await waitForHealth(runtimeURL, child, logs);
  return { child, health, logs, runtimeURL };
}

async function killRuntime(runtime) {
  if (!runtime || runtime.child.exitCode !== null) return;
  try {
    process.kill(-runtime.child.pid, "SIGKILL");
  } catch (error) {
    if (error?.code !== "ESRCH") throw error;
  }
  await new Promise((resolveExit) => runtime.child.once("exit", resolveExit));
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

const options = argumentsFrom(process.argv.slice(2));
const config = await loadAcceptanceConfig(options.configPath);
const credential = await resolveCredential();
const projectId = options.projectId ?? config.scenarios?.cat1040?.projectId;
const batchId = options.batchId ?? config.scenarios?.cat1040?.batchId;
assert.ok(projectId && batchId, "The real Pi restart pass requires an isolated project and batch.");
await assertPortFree(options.port);
const prepared = await prepareNativeCapabilityAgentDir();
let runtime = null;

try {
  runtime = await startRuntime({ port: options.port, agentDir: prepared.agentDir });
  assert.equal(runtime.health.apiProtocolVersion, 2);
  assert.equal(runtime.health.pi, "0.80.10");
  const batchResponse = await runtimeJSON(
    runtime.runtimeURL,
    credential,
    `/api/projects/${encodeURIComponent(projectId)}/batches/${encodeURIComponent(batchId)}`,
  );
  const segment = options.segmentId
    ? batchResponse.batch?.segments?.find((candidate) => candidate.id === options.segmentId)
    : batchResponse.batch?.segments?.find((candidate) => !candidate.locked);
  assert.ok(segment, "The isolated batch has no usable segment.");

  const taskId = `electron-real-pi-restart-${randomUUID()}`;
  const prompt = [
    "这是隔离的 runtime restart 验收，不写入 CAT。",
    "必须先调用 ask_user，提出恰好一个单选问题，询问是否继续检查当前句段。",
    "等待用户回答；不要在工具返回前给出最终回复，也不要调用其他工具。",
  ].join("\n");
  const created = await requestJSON(
    runtime.runtimeURL,
    credential,
    "POST",
    `/api/projects/${encodeURIComponent(projectId)}/tasks`,
    {
      taskId,
      title: "Real Pi runtime restart",
      intent: "Prove restart reconciliation and Retry without reviving an interrupted Run.",
      kind: "review",
      initialMessage: prompt,
      batchId,
      segmentIds: [segment.id],
      sourceLocale: batchResponse.batch.sourceLanguage,
      targetLocale: batchResponse.batch.targetLanguage,
    },
  );
  assert.ok(created.activeRunId, "Restart Task creation did not reserve a Run.");
  const interruptedRunId = created.activeRunId;
  const interruptedStream = readChatSSE(
    runtime.runtimeURL,
    credential,
    `/api/projects/${encodeURIComponent(projectId)}/tasks/${encodeURIComponent(taskId)}/chat/stream`,
    { message: prompt, runId: interruptedRunId, segmentId: segment.id },
  ).then((events) => ({ events }), (error) => ({ error }));
  const awaiting = await waitForSnapshot(
    runtime.runtimeURL,
    credential,
    projectId,
    taskId,
    (snapshot) => snapshot.decisions?.some((decision) => decision.runId === interruptedRunId && decision.status === "required" && decision.interactionId?.startsWith("pi-ask:")),
    "the pending pi-ask interaction before restart",
  );
  const decisionIds = awaiting.decisions
    .filter((decision) => decision.runId === interruptedRunId && decision.status === "required" && decision.interactionId?.startsWith("pi-ask:"))
    .map((decision) => decision.id);
  assert.ok(decisionIds.length >= 1 && decisionIds.length <= 4);

  await killRuntime(runtime);
  const interruptedResult = await interruptedStream;
  assert.equal(interruptedResult.events?.some((event) => event.type === "assistant_final") ?? false, false, "Interrupted Pi emitted a late final reply.");

  runtime = await startRuntime({ port: options.port, agentDir: prepared.agentDir });
  const reconciled = await waitForSnapshot(
    runtime.runtimeURL,
    credential,
    projectId,
    taskId,
    (snapshot) => snapshot.runs?.some((run) => run.id === interruptedRunId && run.status === "failed"),
    "restart reconciliation",
  );
  assert.ok(decisionIds.every((id) => reconciled.decisions.some((decision) => decision.id === id && decision.status === "cancelled")));
  const restartActivity = reconciled.activities.find((activity) => activity.id === `${interruptedRunId}.extension-runtime-restarted`);
  assert.equal(restartActivity?.type, "error");
  assert.match(restartActivity?.body ?? "", /Retry starts a new Run/);

  const retryMessage = "这是用户在 runtime 重启后的明确重试。不要调用工具；只用一句话确认当前句段仍在同一 Task 范围内，并说明这是新的 Run。";
  const retryEvents = await readChatSSE(
    runtime.runtimeURL,
    credential,
    `/api/projects/${encodeURIComponent(projectId)}/tasks/${encodeURIComponent(taskId)}/chat/stream`,
    { message: retryMessage, segmentId: segment.id },
  );
  const retryError = retryEvents.find((event) => event.type === "error");
  assert.equal(retryError, undefined, `Retry after restart failed: ${retryError?.errorMessage ?? retryError?.text ?? "unknown"}`);
  assert.ok(retryEvents.some((event) => event.type === "assistant_final"), "Retry after restart has no assistant_final event.");
  const retried = await waitForSnapshot(
    runtime.runtimeURL,
    credential,
    projectId,
    taskId,
    (snapshot) => snapshot.runs?.some((run) => run.id !== interruptedRunId && run.mode === "single" && run.status === "complete"),
    "the complete Retry Run after restart",
  );
  const retryRun = retried.runs.find((run) => run.id !== interruptedRunId && run.mode === "single" && run.status === "complete");
  assert.ok(retryRun && retryRun.id !== interruptedRunId);
  assert.equal(retried.runs.find((run) => run.id === interruptedRunId)?.status, "failed");

  const report = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    scope: {
      projectId: redactId(projectId),
      batchId: redactId(batchId),
      taskId: redactId(taskId),
      segmentId: redactId(segment.id),
    },
    runtime: {
      productVersion: runtime.health.productVersion,
      apiProtocolVersion: runtime.health.apiProtocolVersion,
      piVersion: runtime.health.pi,
      port: options.port,
    },
    proof: {
      interruptedRunId: redactId(interruptedRunId),
      interruptedStatus: "failed",
      cancelledInteractionDecisions: decisionIds.length,
      restartFailureActivity: Boolean(restartActivity),
      lateFinalResponse: false,
      retryRunId: redactId(retryRun.id),
      retryCreatedNewRun: retryRun.id !== interruptedRunId,
      retryStatus: retryRun.status,
      taskIsolation: retryRun.taskId === taskId,
    },
  };

  if (options.outputDirectory) {
    await mkdir(options.outputDirectory, { recursive: true });
    await writeFile(join(options.outputDirectory, "real-pi-restart.json"), `${JSON.stringify(report, null, 2)}\n`);
  }
  console.log(JSON.stringify(report, null, 2));
} finally {
  await killRuntime(runtime);
}
