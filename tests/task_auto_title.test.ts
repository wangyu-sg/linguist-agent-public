import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { createTaskWorkspace, createWorkspace, type TaskTitleGeneration } from "@linguist-agent/cat-data";
import { catAgentSessionDir } from "@linguist-agent/cat-runtime";
import { createTaskAutoTitleCoordinator, syncExistingPiSessionTitle } from "../packages/cat-server/src/task_auto_title.js";

const root = await mkdtemp(join(tmpdir(), "la-task-auto-title-"));
const workspace = createTaskWorkspace(root, { now: () => "2026-07-16T08:00:00.000Z" });

await workspace.create({
  projectId: "project-one",
  taskId: "task-late-title",
  title: "接手这个项目，把剩余句段做完",
  intent: "接手这个项目，把剩余句段做完",
  kind: "general",
  autoTitle: true,
});

let releaseTitle!: (value: { title: string; usage: { totalTokens: number; costUSD: number; modelCalls: number } }) => void;
const delayedTitle = new Promise<{ title: string; usage: { totalTokens: number; costUSD: number; modelCalls: number } }>((resolve) => {
  releaseTitle = resolve;
});
let modelCalls = 0;
const synced: Array<{ projectId: string; taskId: string; title: string }> = [];
const coordinator = createTaskAutoTitleCoordinator({
  repoRoot: root,
  resolveModel: async () => ({ provider: "deepseek", modelId: "deepseek-v4-flash" }),
  generateTitle: async () => {
    modelCalls += 1;
    return delayedTitle;
  },
  syncSessionTitle: async (input) => { synced.push(input); },
  now: () => "2026-07-16T08:01:00.000Z",
  createAttemptId: () => "title-attempt-late",
});

const firstSchedule = coordinator.schedule({ projectId: "project-one", taskId: "task-late-title" });
const duplicateSchedule = coordinator.schedule({ projectId: "project-one", taskId: "task-late-title" });
while (modelCalls === 0) await new Promise<void>((resolve) => setImmediate(resolve));
assert.equal(modelCalls, 1, "concurrent schedules share one model title generation");
releaseTitle({ title: "继续未完成翻译", usage: { totalTokens: 24, costUSD: 0.0003, modelCalls: 1 } });
await Promise.all([firstSchedule, duplicateSchedule]);

const completed = await workspace.open({ projectId: "project-one", taskId: "task-late-title" });
assert.equal(completed.task.title, "继续未完成翻译");
assert.equal(completed.task.titleGeneration?.status, "generated");
assert.equal(completed.task.titleGeneration?.usage?.totalTokens, 24);
assert.equal(completed.task.titleGeneration?.usage?.costUSD, 0.0003);
assert.equal(completed.task.titleGeneration?.usage?.modelCalls, 1);
assert.deepEqual(synced, [{ projectId: "project-one", taskId: "task-late-title", title: "继续未完成翻译" }]);

await workspace.create({
  projectId: "project-one",
  taskId: "task-model-resolution-failed",
  title: "Keep provisional title",
  intent: "Keep working even when title model resolution fails.",
  kind: "general",
  autoTitle: true,
});
let generatedAfterResolutionFailure = false;
const resolutionFailure = createTaskAutoTitleCoordinator({
  repoRoot: root,
  resolveModel: async () => { throw new Error("Model settings unavailable"); },
  generateTitle: async () => {
    generatedAfterResolutionFailure = true;
    return undefined;
  },
  syncSessionTitle: async () => undefined,
  now: () => "2026-07-16T08:01:30.000Z",
});
await resolutionFailure.schedule({ projectId: "project-one", taskId: "task-model-resolution-failed" });
const resolutionFailedTask = await workspace.open({ projectId: "project-one", taskId: "task-model-resolution-failed" });
assert.equal(resolutionFailedTask.task.title, "Keep provisional title");
assert.equal(resolutionFailedTask.task.titleGeneration?.status, "failed");
assert.match(resolutionFailedTask.task.titleGeneration?.error ?? "", /Model settings unavailable/);
assert.equal(generatedAfterResolutionFailure, false, "model generation never starts when route resolution fails");

await workspace.create({
  projectId: "project-one",
  taskId: "task-unclaimed",
  title: "Unclaimed title",
  intent: "Generate this title after a safe restart.",
  kind: "general",
  autoTitle: true,
});
await workspace.create({
  projectId: "project-one",
  taskId: "task-interrupted",
  title: "Interrupted title",
  intent: "Do not repeat an uncertain provider request.",
  kind: "general",
  autoTitle: true,
});
const interrupted = (await workspace.open({ projectId: "project-one", taskId: "task-interrupted" })).task.titleGeneration!;
await workspace.updateTitleGeneration({
  projectId: "project-one",
  taskId: "task-interrupted",
  expectedStatus: "pending",
  expectedAttemptId: null,
  generation: {
    ...interrupted,
    attemptId: "title-attempt-before-restart",
    startedAt: "2026-07-16T08:02:00.000Z",
    provider: "deepseek",
    modelId: "deepseek-v4-flash",
  },
});

let recoveryCalls = 0;
const recoveredSyncs: string[] = [];
const recovery = createTaskAutoTitleCoordinator({
  repoRoot: root,
  resolveModel: async () => ({ provider: "deepseek", modelId: "deepseek-v4-flash" }),
  generateTitle: async () => {
    recoveryCalls += 1;
    return { title: "Safely resumed title", usage: { totalTokens: 12, costUSD: 0.0001, modelCalls: 1 } };
  },
  syncSessionTitle: async ({ taskId }) => { recoveredSyncs.push(taskId); },
  now: () => "2026-07-16T08:03:00.000Z",
  createAttemptId: () => "title-attempt-after-restart",
});
assert.deepEqual(await recovery.recover(), { failed: 1, scheduled: 1 });
await recovery.waitForIdle();
assert.equal(recoveryCalls, 1, "restart only starts work that had no prior provider attempt");
assert.equal((await workspace.open({ projectId: "project-one", taskId: "task-unclaimed" })).task.titleGeneration?.status, "generated");
const failedGeneration = (await workspace.open({ projectId: "project-one", taskId: "task-interrupted" })).task.titleGeneration as TaskTitleGeneration;
assert.equal(failedGeneration.status, "failed");
assert.match(failedGeneration.error ?? "", /was not repeated/);
assert.deepEqual(recoveredSyncs.sort(), ["task-interrupted", "task-unclaimed"]);

const projectWorkspace = createWorkspace(root, "project-one");
const sessionDir = catAgentSessionDir(projectWorkspace);
const sessionId = "la-task-task-late-title";
const sessionManager = SessionManager.create(projectWorkspace.root, sessionDir, { id: sessionId });
sessionManager.appendSessionInfo("Temporary title");
sessionManager.appendMessage({
  role: "assistant",
  content: [{ type: "text", text: "Done." }],
  api: "openai-completions",
  provider: "test",
  model: "test",
  usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
  stopReason: "stop",
  timestamp: Date.now(),
});
await syncExistingPiSessionTitle({
  repoRoot: root,
  projectId: "project-one",
  sessionId,
  title: "继续未完成翻译",
});
const storedSession = (await SessionManager.list(projectWorkspace.root, sessionDir)).find((session) => session.id === sessionId)!;
const reopenedSession = SessionManager.open(storedSession.path, sessionDir, projectWorkspace.root);
assert.equal(reopenedSession.getSessionName(), "继续未完成翻译", "late completion updates an existing durable Pi session without a model call");
const entriesBeforeIdempotentSync = reopenedSession.getEntries().length;
await syncExistingPiSessionTitle({
  repoRoot: root,
  projectId: "project-one",
  sessionId,
  title: "继续未完成翻译",
  liveManager: reopenedSession,
});
assert.equal(reopenedSession.getEntries().length, entriesBeforeIdempotentSync);

console.log("task auto title tests passed");
