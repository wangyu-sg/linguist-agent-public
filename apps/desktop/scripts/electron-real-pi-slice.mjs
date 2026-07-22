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

const DEFAULT_TIMEOUT_MS = 180_000;
const TEAM_TIMEOUT_MS = 420_000;

function argumentsFrom(argv) {
  const result = {};
  for (const argument of argv) {
    if (argument.startsWith("--config=")) result.configPath = resolve(argument.slice(9));
    else if (argument.startsWith("--out=")) result.outputDirectory = resolve(argument.slice(6));
    else if (argument.startsWith("--project=")) result.projectId = argument.slice(10);
    else if (argument.startsWith("--batch=")) result.batchId = argument.slice(8);
    else if (argument.startsWith("--segment=")) result.segmentId = argument.slice(10);
    else if (argument === "--skip-team") result.skipTeam = true;
    else throw new Error(`Unknown real Pi slice argument: ${argument}`);
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
    const detail = data && typeof data === "object" && typeof data.error === "string"
      ? data.error
      : `HTTP ${response.status}`;
    throw new Error(`${method} ${path} failed: ${detail}`);
  }
  return data;
}

async function readSSE(runtimeURL, credential, path, body, timeoutMs = DEFAULT_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error(`SSE timed out after ${timeoutMs}ms.`)), timeoutMs);
  const events = [];
  try {
    const response = await fetch(new URL(path, `${runtimeURL}/`), {
      method: "POST",
      headers: {
        authorization: `Bearer ${credential}`,
        "content-type": "application/json",
        accept: "text/event-stream",
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    if (!response.ok || !response.body) {
      throw new Error(`SSE ${path} returned HTTP ${response.status}.`);
    }
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    const consume = (line) => {
      if (!line.startsWith("data:")) return;
      const raw = line.slice(5).trim();
      if (!raw) return;
      events.push(JSON.parse(raw));
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
  } finally {
    clearTimeout(timer);
  }
}

async function waitForSnapshot(runtimeURL, credential, projectId, taskId, predicate, label, timeoutMs = DEFAULT_TIMEOUT_MS) {
  const deadline = Date.now() + timeoutMs;
  let latest;
  while (Date.now() < deadline) {
    latest = await runtimeJSON(
      runtimeURL,
      credential,
      `/api/projects/${encodeURIComponent(projectId)}/tasks/${encodeURIComponent(taskId)}`,
    );
    if (predicate(latest)) return latest;
    await new Promise((resolveWait) => setTimeout(resolveWait, 200));
  }
  const statuses = (latest?.runs ?? []).map((run) => `${run.mode}/${run.status}`).join(", ") || "none";
  throw new Error(`Timed out waiting for ${label}; latest Run states: ${statuses}.`);
}

function interactionAnswer(decision) {
  if (decision.selectionMode === "freeform") {
    return { decisionId: decision.id, responseText: "采用轻快、清晰但不过度口语化的游戏语气。" };
  }
  const options = Array.isArray(decision.options) ? decision.options : [];
  const preferred = options.find((option) => /轻快|活泼|conversational|lively/i.test(option.label))
    ?? options.find((option) => option.id !== "freeform")
    ?? options[0];
  assert.ok(preferred, `Decision ${decision.id} has no selectable option.`);
  return {
    decisionId: decision.id,
    selectedOptionIds: [preferred.id],
    ...(preferred.id === "freeform" ? { responseText: "采用轻快、清晰但不过度口语化的游戏语气。" } : {}),
  };
}

function findRequiredInteraction(snapshot) {
  const grouped = new Map();
  for (const decision of snapshot.decisions ?? []) {
    if (decision.status !== "required" || typeof decision.interactionId !== "string") continue;
    const rows = grouped.get(decision.interactionId) ?? [];
    rows.push(decision);
    grouped.set(decision.interactionId, rows);
  }
  const entry = [...grouped.entries()].find(([interactionId]) => interactionId.startsWith("pi-ask:"));
  if (!entry) return null;
  return {
    interactionId: entry[0],
    decisions: entry[1].sort((left, right) => (left.questionIndex ?? 0) - (right.questionIndex ?? 0)),
  };
}

function runSummary(snapshot) {
  return (snapshot.runs ?? []).map((run) => ({
    id: redactId(run.id),
    mode: run.mode,
    status: run.status,
    stopAvailable: run.stopAvailable,
    packageNames: run.resourceManifest?.packages?.map((entry) => entry.name) ?? [],
    activeToolNames: run.resourceManifest?.activeToolNames ?? [],
  }));
}

const options = argumentsFrom(process.argv.slice(2));
const config = await loadAcceptanceConfig(options.configPath);
const runtimeURL = assertIsolatedRuntimeURL(process.env.LA_ACCEPTANCE_RUNTIME_URL ?? config.runtimeURL ?? "");
const credential = await resolveCredential();
const projectId = options.projectId ?? config.scenarios?.cat1040?.projectId;
const batchId = options.batchId ?? config.scenarios?.cat1040?.batchId;
assert.ok(projectId && batchId, "The real Pi slice requires an isolated project and batch.");

const health = await runtimeJSON(runtimeURL, credential, "/api/health", false);
for (const capability of ["native-extension-ui-v1", "run-resource-profile-v1", "task-workspace-v2"]) {
  assert.ok(health.capabilities?.includes(capability), `Runtime is missing ${capability}.`);
}
const batchResponse = await runtimeJSON(
  runtimeURL,
  credential,
  `/api/projects/${encodeURIComponent(projectId)}/batches/${encodeURIComponent(batchId)}`,
);
const segment = options.segmentId
  ? batchResponse.batch?.segments?.find((candidate) => candidate.id === options.segmentId)
  : batchResponse.batch?.segments?.find((candidate) => !candidate.locked);
assert.ok(segment, "The isolated batch has no usable segment.");

const taskId = `electron-real-pi-${randomUUID()}`;
const firstMessage = [
  "这是 Linguist Agent 的隔离验收任务，只处理当前一个句段，不写入 CAT，也不导出文件。",
  "第一步必须调用 ask_user，提出恰好一个单选问题，询问这条游戏文本应采用“严肃克制”还是“轻快活泼”的语气。",
  "收到回答后，调用 prepare_team_execution；理由是让受限的本地化 Specialist 只审校当前句段的语气、术语和标签。",
  "最后明确说明 Team 只是已准备并等待用户确认，不得自行开始 Specialist。",
].join("\n");
const created = await requestJSON(
  runtimeURL,
  credential,
  "POST",
  `/api/projects/${encodeURIComponent(projectId)}/tasks`,
  {
    taskId,
    title: "Real Pi native interaction slice",
    intent: "Prove native Package interaction, Team preparation, Specialist projection, and CAT continuity.",
    kind: "review",
    initialMessage: firstMessage,
    batchId,
    segmentIds: [segment.id],
    sourceLocale: batchResponse.batch.sourceLanguage,
    targetLocale: batchResponse.batch.targetLanguage,
  },
);
assert.ok(created.activeRunId, "Task creation did not reserve the initial canonical Run.");

const firstStream = readSSE(
  runtimeURL,
  credential,
  `/api/projects/${encodeURIComponent(projectId)}/tasks/${encodeURIComponent(taskId)}/chat/stream`,
  { message: firstMessage, runId: created.activeRunId, segmentId: segment.id },
);

const awaitingQuestion = await waitForSnapshot(
  runtimeURL,
  credential,
  projectId,
  taskId,
  (snapshot) => Boolean(findRequiredInteraction(snapshot)),
  "a canonical pi-ask Decision",
);
const interaction = findRequiredInteraction(awaitingQuestion);
assert.ok(interaction && interaction.decisions.length >= 1 && interaction.decisions.length <= 4);
await requestJSON(
  runtimeURL,
  credential,
  "POST",
  `/api/projects/${encodeURIComponent(projectId)}/tasks/${encodeURIComponent(taskId)}/decision-interactions/${encodeURIComponent(interaction.interactionId)}`,
  {
    action: "submit",
    answers: interaction.decisions.map(interactionAnswer),
    reason: "Real Pi isolated acceptance answer.",
  },
);

const firstEvents = await firstStream;
const firstError = firstEvents.find((event) => event.type === "error");
assert.equal(firstError, undefined, `Main Pi turn failed: ${firstError?.errorMessage ?? firstError?.text ?? "unknown"}`);
assert.ok(firstEvents.some((event) => event.type === "assistant_final"), "Main Pi turn has no assistant_final event.");

const afterMain = await waitForSnapshot(
  runtimeURL,
  credential,
  projectId,
  taskId,
  (snapshot) => snapshot.runs?.some((run) => run.id === created.activeRunId && (run.status === "awaiting_input" || run.status === "waiting" || run.status === "complete")),
  "the durable Main result",
);
const mainRun = afterMain.runs.find((run) => run.id === created.activeRunId);
assert.ok(mainRun?.resourceManifest, "The real Main Run has no resourceManifest.");
assert.ok(mainRun.resourceManifest.packages.some((entry) => entry.name === "@eko24ive/pi-ask"), "The Main Run manifest did not attest pi-ask.");
assert.ok(mainRun.resourceManifest.activeToolNames.includes("ask_user"), "The Main Run manifest did not attest ask_user.");
assert.ok(mainRun.resourceManifest.activeToolNames.includes("prepare_team_execution"), "The focused CAT Run did not attest prepare_team_execution.");

let afterTeam = afterMain;
let teamStarted = false;
let teamStartDecisionId = null;
if (!options.skipTeam) {
  const preparedRun = afterMain.runs.find((run) => run.id === created.activeRunId && run.mode === "team" && run.planHash);
  const startDecision = afterMain.decisions.find((decision) => (
    decision.runId === created.activeRunId
    && decision.status === "required"
    && decision.kind === "approval"
  ));
  assert.ok(preparedRun && startDecision, "Main did not leave a canonical Team proposal for user confirmation.");
  teamStartDecisionId = startDecision.id;
  const preflight = await requestJSON(
    runtimeURL,
    credential,
    "POST",
    `/api/projects/${encodeURIComponent(projectId)}/workflows/${encodeURIComponent(created.activeRunId)}/preflight`,
    { forceAllRoles: false },
  );
  assert.equal(preflight.readiness?.status, "ready", `Team preflight is blocked: ${preflight.readiness?.blockers?.join("; ") ?? "unknown"}`);
  assert.equal(preflight.planHash, preparedRun.planHash, "Team planHash changed between proposal and confirmation.");
  await requestJSON(
    runtimeURL,
    credential,
    "POST",
    `/api/projects/${encodeURIComponent(projectId)}/workflows/${encodeURIComponent(created.activeRunId)}/start`,
    { planHash: preflight.planHash, forceAllRoles: false, execute: true },
    90_000,
  );
  teamStarted = true;
  afterTeam = await waitForSnapshot(
    runtimeURL,
    credential,
    projectId,
    taskId,
    (snapshot) => snapshot.runs?.some((run) => (
      run.id === created.activeRunId
      && ["complete", "failed", "awaiting_input", "stopped"].includes(run.status)
      && !run.stopAvailable
    )),
    "the Team Run to reach a stable boundary",
    TEAM_TIMEOUT_MS,
  );
  const teamRun = afterTeam.runs.find((run) => run.id === created.activeRunId);
  assert.notEqual(teamRun?.status, "failed", "The real Team Run failed.");
  assert.ok(afterTeam.agentThreads.some((thread) => thread.runId === created.activeRunId && thread.identity.kind === "specialist"), "No canonical Specialist thread was projected.");
  assert.ok(afterTeam.artifacts.some((artifact) => artifact.runId === created.activeRunId), "No canonical Team Artifact was projected.");
}

const stableRun = afterTeam.runs.find((run) => run.id === created.activeRunId);
let focusedCatFollowUp = false;
if (stableRun?.status === "complete") {
  const followUpMessage = "结合当前句段的 source、现有 target 与可用证据，用两点说明这条译文的语气和标签是否安全；不要写入 CAT。";
  const followUpEvents = await readSSE(
    runtimeURL,
    credential,
    `/api/projects/${encodeURIComponent(projectId)}/tasks/${encodeURIComponent(taskId)}/chat/stream`,
    { message: followUpMessage, segmentId: segment.id },
  );
  const followUpError = followUpEvents.find((event) => event.type === "error");
  assert.equal(followUpError, undefined, `Focused CAT follow-up failed: ${followUpError?.errorMessage ?? followUpError?.text ?? "unknown"}`);
  assert.ok(followUpEvents.some((event) => event.type === "assistant_final"), "Focused CAT follow-up has no assistant_final event.");
  focusedCatFollowUp = true;
}

const finalSnapshot = await runtimeJSON(
  runtimeURL,
  credential,
  `/api/projects/${encodeURIComponent(projectId)}/tasks/${encodeURIComponent(taskId)}`,
);
if (teamStartDecisionId) {
  assert.ok(
    finalSnapshot.decisions.some((decision) => decision.id === teamStartDecisionId && decision.status === "recorded"),
    "The Team start approval was not durably recorded.",
  );
}
if (focusedCatFollowUp) {
  assert.ok(
    finalSnapshot.runs.some((run) => run.id !== created.activeRunId && run.mode === "single" && run.status === "complete"),
    "The focused CAT follow-up did not create a complete continuation Run in the same Task.",
  );
}
const report = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  runtime: {
    productVersion: health.productVersion,
    apiProtocolVersion: health.apiProtocolVersion,
    pi: health.pi,
    capabilities: [...health.capabilities].sort(),
  },
  scope: {
    projectId: redactId(projectId),
    batchId: redactId(batchId),
    taskId: redactId(taskId),
    segmentId: redactId(segment.id),
  },
  proof: {
    piAskQuestions: interaction.decisions.length,
    piAskResolved: finalSnapshot.decisions.filter((decision) => decision.interactionId === interaction.interactionId && decision.status === "recorded").length,
    teamStarted,
    teamApprovalRecorded: teamStartDecisionId
      ? finalSnapshot.decisions.some((decision) => decision.id === teamStartDecisionId && decision.status === "recorded")
      : false,
    focusedCatFollowUp,
    specialistThreads: finalSnapshot.agentThreads.filter((thread) => thread.identity.kind === "specialist").length,
    artifacts: finalSnapshot.artifacts.length,
    activities: finalSnapshot.activities.length,
    finalRunStates: runSummary(finalSnapshot),
  },
};

if (options.outputDirectory) {
  await mkdir(options.outputDirectory, { recursive: true });
  await writeFile(join(options.outputDirectory, "real-pi-slice.json"), `${JSON.stringify(report, null, 2)}\n`);
}
console.log(JSON.stringify(report, null, 2));
