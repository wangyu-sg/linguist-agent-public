import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createTaskWorkspace } from "@linguist-agent/cat-data";
import { createSingleTaskRunProjector, stopPendingSingleTaskRun } from "../packages/cat-server/src/single_task_run_projection.js";

const root = await mkdtemp(join(tmpdir(), "la-single-task-run-"));
try {
  const initialMessage = "Review the imported batch and keep every user instruction.";
  const initialTask = await createTaskWorkspace(root).create({
    projectId: "project-one",
    taskId: "task-preprojected",
    title: "Preprojected first turn",
    intent: initialMessage,
    kind: "review",
    scope: { batchId: "batch-one", segmentIds: [] },
    initialMessage,
  });
  const initialRun = initialTask.runs[0]!;
  const initialProjector = await createSingleTaskRunProjector({
    repoRoot: root,
    projectId: "project-one",
    taskId: initialTask.task.id,
    runId: initialRun.id,
    userMessage: initialMessage,
    startedAt: "2026-07-12T00:59:00.000Z",
    modelRoute: "deepseek/deepseek-v4-flash",
    preprojected: true,
  });
  await initialProjector.flush();
  const activatedInitialTask = await createTaskWorkspace(root).open({ projectId: "project-one", taskId: initialTask.task.id });
  assert.equal(activatedInitialTask.runs.length, 1, "activating the first turn must reuse its pending Run");
  assert.equal(activatedInitialTask.runs[0]?.id, initialRun.id);
  assert.equal(activatedInitialTask.runs[0]?.status, "active");
  assert.equal(activatedInitialTask.runs[0]?.startedAt, "2026-07-12T00:59:00.000Z");
  assert.deepEqual(
    activatedInitialTask.activities.filter((row) => row.type === "message").map((row) => row.body),
    [initialMessage],
    "activating a preprojected first turn must not append a duplicate human message",
  );

  const cancelledInitialTask = await createTaskWorkspace(root).create({
    projectId: "project-one",
    taskId: "task-pending-cancel",
    title: "Pending first turn",
    intent: "Keep the message but do not start yet.",
    kind: "general",
    initialMessage: "Keep the message but do not start yet.",
  });
  const cancelledRun = cancelledInitialTask.runs[0]!;
  assert.equal(await stopPendingSingleTaskRun({
    repoRoot: root,
    projectId: "project-one",
    taskId: cancelledInitialTask.task.id,
    runId: cancelledRun.id,
    reason: "user stop",
  }), true);
  const cancelled = await createTaskWorkspace(root).open({ projectId: "project-one", taskId: cancelledInitialTask.task.id });
  assert.equal(cancelled.activeRunId, null);
  assert.equal(cancelled.runs[0]?.status, "stopped");
  assert.equal(cancelled.activities.filter((row) => row.type === "message").length, 1);
  assert.equal(cancelled.activities.some((row) => row.id === `${cancelledRun.id}.stopped`), true);
  assert.equal(await stopPendingSingleTaskRun({
    repoRoot: root,
    projectId: "project-one",
    taskId: cancelledInitialTask.task.id,
    runId: cancelledRun.id,
  }), false, "pending cancellation must be idempotent and must not revive a terminal Run");
  const lateActivation = await createSingleTaskRunProjector({
    repoRoot: root,
    projectId: "project-one",
    taskId: cancelledInitialTask.task.id,
    runId: cancelledRun.id,
    userMessage: "Keep the message but do not start yet.",
    startedAt: "2026-07-12T00:59:30.000Z",
    modelRoute: "deepseek/deepseek-v4-flash",
    preprojected: true,
  });
  await assert.rejects(lateActivation.flush(), /no longer matches expected/, "a late stream must not reactivate a stopped pending Run");

  await createTaskWorkspace(root).create({
    projectId: "project-one",
    taskId: "task-one",
    title: "Single Agent task",
    intent: "Review the selected batch.",
    kind: "review",
    scope: { batchId: "batch-one", segmentIds: ["row-1"], sourceLocale: "zh-CN", targetLocale: "en-US" },
  });

  const userMessage = `Review this task. ${"Keep every instruction. ".repeat(50)}`.trim();
  const projector = await createSingleTaskRunProjector({
    repoRoot: root,
    projectId: "project-one",
    taskId: "task-one",
    runId: "turn-single-1",
    userMessage,
    startedAt: "2026-07-12T01:00:00.000Z",
    modelRoute: "deepseek/deepseek-v4-flash",
    focusedSegmentId: "row-1",
  });
  await projector.flush();
  const beforeResources = await createTaskWorkspace(root).open({ projectId: "project-one", taskId: "task-one" });
  assert.equal(beforeResources.runs.find((row) => row.id === "turn-single-1")?.resourceManifest, undefined);

  const resourceManifest = {
    profile: "main",
    packages: [{
      name: "@eko24ive/pi-ask",
      source: "npm:@eko24ive/pi-ask@1.1.0",
      version: "1.1.0",
      integrity: "sha512-dGVzdA==",
    }],
    activeToolNames: ["ask", "tm_lookup"],
    requestShapeHash: "request-shape-1",
    systemPromptHash: "system-prompt-1",
    toolSurfaceHash: "tool-surface-1",
    resourceIndexHash: "resource-index-1",
  };
  await projector.setResourceManifest(resourceManifest);
  projector.accept({ type: "tool_start", ts: "2026-07-12T01:00:01.000Z", toolCallId: "tool-1", toolName: "tm_lookup", argsPreview: "月亮" });
  projector.accept({ type: "tool_end", ts: "2026-07-12T01:00:02.000Z", toolCallId: "tool-1", toolName: "tm_lookup", resultPreview: "Evidence: tm:1" });
  projector.accept({
    type: "tool_start",
    ts: "2026-07-12T01:00:02.050Z",
    toolCallId: "tool-document",
    toolName: "document_parse",
    argsPreview: JSON.stringify({ path: "/project/locked.pdf", PASSWORD: "durable-doc-password", options: { apiKey: "durable-api-key" } }),
  });
  projector.accept({ type: "compaction_start", ts: "2026-07-12T01:00:02.100Z", reason: "context limit" });
  projector.accept({ type: "compaction_end", ts: "2026-07-12T01:00:02.200Z", tokensBefore: 12000, estimatedTokensAfter: 5000 });
  projector.accept({ type: "retry_start", ts: "2026-07-12T01:00:02.300Z", retryAttempt: 1, retryMaxAttempts: 2, reason: "provider busy" });
  projector.accept({ type: "retry_end", ts: "2026-07-12T01:00:02.400Z", retryAttempt: 1, retrySuccess: true });
  projector.accept({
    type: "permission_request",
    ts: "2026-07-12T01:00:02.500Z",
    permissionRequest: { requestId: "permission-1", toolName: "bash", domain: "bash", riskClass: "high", argsSummary: "run QA helper" },
  });
  projector.accept({
    type: "permission_request",
    ts: "2026-07-12T01:00:02.600Z",
    permissionRequest: {
      requestId: "permission-document",
      toolName: "document_parse",
      domain: "fileRead",
      riskClass: "medium",
      argsSummary: JSON.stringify({ path: "/project/locked.pdf", passphrase: "durable-permission-passphrase" }),
    },
  });
  const finalText = `Review complete. ${"Detailed result. ".repeat(80)}`.trim();
  projector.accept({ type: "assistant_final", ts: "2026-07-12T01:00:03.000Z", text: finalText, usage: { inputTokens: 100, outputTokens: 20, totalTokens: 120, costUsd: 0.001, modelCalls: 1 } });
  await projector.flush();

  const snapshot = await createTaskWorkspace(root).open({ projectId: "project-one", taskId: "task-one" });
  const run = snapshot.runs.find((row) => row.id === "turn-single-1");
  assert.equal(run?.mode, "single");
  assert.equal(run?.status, "complete");
  assert.equal(snapshot.agentThreads.find((row) => row.runId === run?.id)?.identity.roleId, "linguist-agent");
  const userActivity = snapshot.activities.find((row) => row.type === "message");
  assert.equal(userActivity?.actor.kind, "human");
  assert.equal(userActivity?.body, userMessage, "durable Task history must not truncate the user message");
  assert.deepEqual(userActivity?.refs.segmentIds, ["row-1"], "CAT-scoped messages must retain their canonical segment relation");
  assert.equal(snapshot.activities.some((row) => row.type === "evidence_read" && row.tool?.name === "tm_lookup" && row.status === "done"), true);
  const finalActivity = snapshot.activities.find((row) => row.type === "final_response");
  const resultArtifact = snapshot.artifacts.find((row) => row.content.kind === "agent_result");
  assert.equal(finalActivity?.body, finalText, "the complete Agent reply must remain in the primary conversation");
  assert.deepEqual(finalActivity?.refs.segmentIds, ["row-1"], "the response must remain linked to the focused CAT segment");
  assert.deepEqual(finalActivity?.refs.artifactIds, ["turn-single-1.result"]);
  assert.equal(resultArtifact?.type, "preview");
  assert.equal(resultArtifact?.status, "final");
  assert.equal(resultArtifact?.content.text, finalText);
  const documentActivity = snapshot.activities.find((row) => row.tool?.name === "document_parse");
  assert.match(documentActivity?.body ?? "", /\[REDACTED\]/);
  assert.equal(documentActivity?.body?.includes("durable-doc-password"), false);
  assert.equal(documentActivity?.body?.includes("durable-api-key"), false);
  assert.equal(documentActivity?.tool?.target?.includes("durable-doc-password"), false);
  assert.equal(snapshot.activities.some((row) => row.title === "Context compacted" && row.body?.includes("12000 tokens before")), true);
  assert.equal(snapshot.activities.some((row) => row.title === "Retry completed" && row.status === "done"), true);
  assert.equal(snapshot.activities.some((row) => row.type === "elicitation" && row.title.includes("bash") && row.status === "blocked"), true);
  const documentPermission = snapshot.activities.find((row) => row.id.includes("permission-document"));
  assert.match(documentPermission?.body ?? "", /\[REDACTED\]/);
  assert.equal(documentPermission?.body?.includes("durable-permission-passphrase"), false);
  assert.equal(run?.usage?.inputTokens, 100);
  assert.equal(run?.usage?.outputTokens, 20);
  assert.equal(run?.usage?.totalTokens, 120);
  assert.equal(run?.usage?.costUSD, 0.001);
  assert.equal(run?.usage?.modelCalls, 1);
  assert.equal(run?.usageBySource?.main?.totalTokens, 120);
  assert.equal(run?.usageBySource?.main?.costUSD, 0.001);
  assert.deepEqual(run?.estimatedCallsBySource, { main: 1 });
  assert.deepEqual(snapshot.usage, run?.usage, "Task total must be server-projected rather than recomputed by the client");
  assert.deepEqual(run?.resourceManifest, resourceManifest, "terminal lifecycle updates must preserve the resolved resources");
  await projector.setResourceManifest(resourceManifest);
  await assert.rejects(
    projector.setResourceManifest({ ...resourceManifest, activeToolNames: ["ask"] }),
    /resourceManifest cannot change after it is recorded/,
  );

  const followUpMessage = "Now summarize the unresolved decisions.";
  const followUpProjector = await createSingleTaskRunProjector({
    repoRoot: root,
    projectId: "project-one",
    taskId: "task-one",
    runId: "turn-single-2",
    userMessage: followUpMessage,
    startedAt: "2026-07-12T01:05:00.000Z",
    modelRoute: "deepseek/deepseek-v4-flash",
  });
  followUpProjector.accept({ type: "assistant_final", ts: "2026-07-12T01:05:01.000Z", text: "No unresolved decisions." });
  await followUpProjector.flush();
  const multiRunSnapshot = await createTaskWorkspace(root).open({ projectId: "project-one", taskId: "task-one" });
  assert.deepEqual(
    multiRunSnapshot.activities.filter((row) => row.type === "message").map((row) => row.body),
    [userMessage, followUpMessage],
    "one Task must retain the complete user conversation across Runs",
  );

  await createTaskWorkspace(root).create({
    projectId: "project-one",
    taskId: "task-stopped",
    title: "Stopped Single task",
    intent: "Stop safely.",
    kind: "general",
  });
  const stoppedProjector = await createSingleTaskRunProjector({
    repoRoot: root,
    projectId: "project-one",
    taskId: "task-stopped",
    runId: "turn-single-stopped",
    userMessage: "Start and stop.",
    startedAt: "2026-07-12T02:00:00.000Z",
    modelRoute: "deepseek/deepseek-v4-flash",
  });
  stoppedProjector.accept({ type: "stopped", ts: "2026-07-12T02:00:01.000Z", text: "Agent run stopped by user." });
  await stoppedProjector.flush();
  const stopped = await createTaskWorkspace(root).open({ projectId: "project-one", taskId: "task-stopped" });
  assert.equal(stopped.runs[0]?.status, "stopped");
  assert.equal(stopped.runs[0]?.stopAvailable, false);
  assert.equal(stopped.runs[0]?.resumeAvailable, true);
  assert.equal(stopped.activities.some((row) => row.id === "turn-single-stopped.stopped" && row.status === "blocked"), true);
} finally {
  await rm(root, { recursive: true, force: true });
}

console.log("single task run projection tests passed");
