import assert from "node:assert/strict";
import type { IncomingMessage, ServerResponse } from "node:http";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createTaskWorkspace,
  executeLegacyTaskBackfill,
  executeRuntimeDataRollback,
  previewLegacyTaskBackfill,
  previewRuntimeDataRollback,
  TaskWorkspaceNotFoundError,
} from "@linguist-agent/cat-data";
import { handleStorageRoute } from "../packages/cat-server/src/routes/storage_routes.js";

const root = await mkdtemp(join(tmpdir(), "la-legacy-task-backfill-"));
const projectRoot = join(root, "data", "projects", "project-one");
await mkdir(join(projectRoot, "workflows"), { recursive: true });
await mkdir(join(projectRoot, "_pi_sessions"), { recursive: true });
await mkdir(join(root, "data", "assistant", "_pi_sessions"), { recursive: true });
await mkdir(join(root, "data", "evals", "private", "eval-one", "runs", "run-unlinked"), { recursive: true });

const chatPath = join(projectRoot, "chat.json");
const chat = [
  { ts: "2026-06-01T10:00:00.000Z", kind: "user", text: "Secret full user request", sessionId: "session-one" },
  { ts: "2026-06-01T10:00:01.000Z", kind: "tool", text: "tool_start batch_read\nfull args", toolCallId: "tool-1", sessionId: "session-one" },
  { ts: "2026-06-01T10:00:02.000Z", kind: "tool", text: "tool_end batch_read ok\nfull result", toolCallId: "tool-1", sessionId: "session-one" },
  { ts: "2026-06-01T10:00:03.000Z", kind: "assistant", text: "Secret full assistant response", sessionId: "session-one", usage: { inputTokens: 10, outputTokens: 4, totalTokens: 14, costUsd: 0.001 } },
  { ts: "2026-06-01T10:01:00.000Z", kind: "user", text: "Second full user request", sessionId: "session-one" },
  { ts: "2026-06-01T10:01:03.000Z", kind: "assistant", text: "Second full assistant response", sessionId: "session-one", usage: { inputTokens: 8, outputTokens: 3, totalTokens: 11, costUsd: 0.0008 } },
  { ts: "2026-06-02T10:00:00.000Z", kind: "user", text: "Incomplete session", sessionId: "session-incomplete" },
];
await writeFile(chatPath, JSON.stringify(chat, null, 2), "utf8");
await writeFile(join(projectRoot, "agent_events.jsonl"), [
  JSON.stringify({ kind: "turn_start", text: "not hidden" }),
  JSON.stringify({ kind: "thinking_delta", text: "NEVER IMPORT THIS THINKING" }),
].join("\n") + "\n", "utf8");
const completedWorkflow = {
  schemaVersion: 1,
  workflowId: "legacy-completed",
  projectId: "project-one",
  batchId: "batch-one",
  status: "completed",
  createdAt: "2026-06-03T10:00:00.000Z",
  updatedAt: "2026-06-03T10:05:00.000Z",
  plan: {
    projectId: "project-one",
    batchId: "batch-one",
    intent: "game_localization_team_run",
    inferred: false,
    userRequest: "Review the archived batch with Team",
    steps: [],
    approvalGates: [],
  },
  approvedStepIds: [],
  completedStepIds: [],
  teamSelectedRoleIds: ["loc_engineer_gate"],
  history: [
    { ts: "2026-06-03T10:00:00.000Z", kind: "created", message: "Workflow created." },
    { ts: "2026-06-03T10:05:00.000Z", kind: "completed", message: "Workflow completed." },
  ],
};
const readyWorkflow = {
  ...completedWorkflow,
  workflowId: "legacy-ready",
  status: "ready",
  createdAt: "2026-06-04T10:00:00.000Z",
  updatedAt: "2026-06-04T10:00:00.000Z",
  plan: { ...completedWorkflow.plan, userRequest: "Stale ready workflow" },
  teamSelectedRoleIds: [],
  history: [{ ts: "2026-06-04T10:00:00.000Z", kind: "created", message: "Workflow created." }],
};
await writeFile(join(projectRoot, "workflows", "legacy-completed.json"), JSON.stringify(completedWorkflow, null, 2), "utf8");
await writeFile(join(projectRoot, "workflows", "legacy-ready.json"), JSON.stringify(readyWorkflow, null, 2), "utf8");
await writeFile(join(projectRoot, "workflows", "malformed.json"), JSON.stringify({ workflowId: "malformed", projectId: "project-one", status: "running" }), "utf8");
await writeFile(join(projectRoot, "workflow_artifacts.json"), JSON.stringify({
  teamRolePasses: [{
    workflowId: "legacy-completed",
    roleId: "loc_engineer_gate",
    status: "completed",
    sessionId: "legacy-session",
    startedAt: "2026-06-03T10:00:30.000Z",
    completedAt: "2026-06-03T10:01:00.000Z",
    inputArtifactRefs: [],
    outputArtifactRefs: ["engineering-gate"],
    usage: { inputTokens: 10, outputTokens: 2, totalTokens: 12, costUsd: 0.001 },
    summary: "Mechanical gate passed.",
    transcriptRef: "RAW_TRANSCRIPT_SHOULD_NOT_BE_IMPORTED",
    subagentAsyncDir: "HIDDEN_ASYNC_DIR_SHOULD_NOT_BE_IMPORTED",
  }],
}), "utf8");
await writeFile(join(projectRoot, "_pi_sessions", "session-one.jsonl"), `${JSON.stringify({ type: "session" })}\n`, "utf8");
await writeFile(join(root, "data", "assistant", "_pi_sessions", "global.jsonl"), `${JSON.stringify({ type: "session" })}\n`, "utf8");
await writeFile(join(root, "data", "evals", "private", "eval-one", "runs", "run-unlinked", "run.json"), JSON.stringify({ runId: "run-unlinked", status: "completed" }), "utf8");

const preview = await previewLegacyTaskBackfill(root);
assert.equal(preview.mode, "preview");
assert.equal(preview.summary.eligible, 3);
assert.equal(preview.summary.turns, 2);
assert.equal(preview.summary.workflows, 2);
const chatCandidate = preview.candidates.find((row) => row.sourceKind === "project_chat")!;
const workflowCandidate = preview.candidates.find((row) => row.workflowId === "legacy-completed")!;
const readyCandidate = preview.candidates.find((row) => row.workflowId === "legacy-ready")!;
assert.equal(chatCandidate.turnCount, 2);
assert.equal(chatCandidate.toolCalls, 1, "tool start/end must be one historical tool activity");
assert.equal(workflowCandidate.rolePasses, 1);
assert.equal(preview.recommendedCandidateIds.includes(workflowCandidate.candidateId), true, "terminal workflows should be recommended");
assert.equal(preview.recommendedCandidateIds.includes(readyCandidate.candidateId), false, "stale nonterminal workflows require explicit selection");
assert.equal(preview.observations.some((row) => row.kind === "hidden_reasoning_trace" && row.disposition === "excluded"), true);
assert.equal(preview.observations.some((row) => row.kind === "malformed_workflow" && row.disposition === "excluded"), true);
assert.equal(preview.observations.some((row) => row.kind === "unlinked_eval" && row.disposition === "excluded"), true);
assert.equal(preview.observations.some((row) => row.kind === "internal_pi_session"), true);
assert.equal(preview.observations.some((row) => row.kind === "malformed_chat_session"), true);
assert.doesNotMatch(JSON.stringify(preview), /Secret full user request|Secret full assistant response|NEVER IMPORT THIS THINKING/);

await writeFile(chatPath, `${JSON.stringify(chat)}\n`, "utf8");
await assert.rejects(
  executeLegacyTaskBackfill(root, { planHash: preview.planHash, selectedCandidateIds: preview.recommendedCandidateIds }),
  /plan changed/i,
);
await writeFile(chatPath, JSON.stringify(chat, null, 2), "utf8");

const current = await previewLegacyTaskBackfill(root);
const executed = await executeLegacyTaskBackfill(root, {
  planHash: current.planHash,
  selectedCandidateIds: [...current.recommendedCandidateIds, readyCandidate.candidateId],
});
assert.equal(executed.importedTaskIds.length, 3);
assert.ok(executed.backup);
const taskId = chatCandidate.taskId;
const snapshot = await createTaskWorkspace(root).open({ projectId: "project-one", taskId });
assert.equal(snapshot.task.status, "archived");
assert.equal(snapshot.task.title, "历史 Agent 对话 · 2026-06-01");
assert.equal(snapshot.runs.length, 2);
assert.equal(snapshot.runs.every((run) => run.status === "complete" && !run.stopAvailable && !run.resumeAvailable), true);
assert.equal(snapshot.activities.filter((row) => row.type === "message").length, 2);
assert.equal(snapshot.activities.filter((row) => row.type === "tool_action").length, 1);
assert.equal(snapshot.activities.filter((row) => row.type === "final_response").length, 2);
assert.equal(snapshot.activities.some((row) => row.body === "Secret full user request"), true);
assert.equal(snapshot.activities.some((row) => row.body === "Secret full assistant response"), true);
assert.equal(snapshot.activities.some((row) => row.body?.includes("tool_start batch_read") && row.body.includes("tool_end batch_read ok")), true);
assert.doesNotMatch(JSON.stringify(snapshot), /NEVER IMPORT THIS THINKING/);

const workflowSnapshot = await createTaskWorkspace(root).open({ projectId: "project-one", taskId: workflowCandidate.taskId });
assert.equal(workflowSnapshot.task.status, "archived");
assert.equal(workflowSnapshot.task.scope.batchId, "batch-one");
assert.equal(workflowSnapshot.runs[0]?.mode, "team");
assert.equal(workflowSnapshot.runs[0]?.status, "complete");
assert.equal(workflowSnapshot.agentThreads.some((thread) => thread.identity.roleId === "loc_engineer_gate" && thread.identity.kind === "deterministic"), true);
assert.equal(workflowSnapshot.activities.some((activity) => activity.body === "Mechanical gate passed."), true);
assert.equal(workflowSnapshot.artifacts.some((artifact) => artifact.type === "evidence_pack" && artifact.status === "final"), true);
assert.doesNotMatch(JSON.stringify(workflowSnapshot), /RAW_TRANSCRIPT_SHOULD_NOT_BE_IMPORTED|HIDDEN_ASYNC_DIR_SHOULD_NOT_BE_IMPORTED/);
const linkedWorkflow = JSON.parse(await readFile(join(projectRoot, "workflows", "legacy-completed.json"), "utf8"));
assert.equal(linkedWorkflow.taskId, workflowCandidate.taskId);
assert.equal(linkedWorkflow.plan.taskId, workflowCandidate.taskId);
const untouchedReadyWorkflow = JSON.parse(await readFile(join(projectRoot, "workflows", "legacy-ready.json"), "utf8"));
assert.equal(untouchedReadyWorkflow.taskId, readyCandidate.taskId, "an explicitly selected stale Workflow should be archived and linked");
const readySnapshot = await createTaskWorkspace(root).open({ projectId: "project-one", taskId: readyCandidate.taskId });
assert.equal(readySnapshot.task.status, "archived");
assert.equal(readySnapshot.runs[0]?.status, "stopped", "a stale ready Workflow must not become resumable history");

const repeatedPlan = await previewLegacyTaskBackfill(root);
assert.equal(repeatedPlan.summary.alreadyImported, 3);
const repeated = await executeLegacyTaskBackfill(root, {
  planHash: repeatedPlan.planHash,
  selectedCandidateIds: [taskId],
});
assert.deepEqual(repeated.importedTaskIds, []);
assert.deepEqual(repeated.alreadyImportedTaskIds, [taskId]);
assert.equal(repeated.backup, undefined, "a no-op idempotent execution must not create another backup");

const rollback = await previewRuntimeDataRollback(root, executed.backup!.backupId);
await executeRuntimeDataRollback(root, { backupId: executed.backup!.backupId, planHash: rollback.planHash });
await assert.rejects(
  createTaskWorkspace(root).open({ projectId: "project-one", taskId }),
  (error: unknown) => error instanceof TaskWorkspaceNotFoundError,
);
await assert.rejects(
  createTaskWorkspace(root).open({ projectId: "project-one", taskId: workflowCandidate.taskId }),
  (error: unknown) => error instanceof TaskWorkspaceNotFoundError,
);
await assert.rejects(
  createTaskWorkspace(root).open({ projectId: "project-one", taskId: readyCandidate.taskId }),
  (error: unknown) => error instanceof TaskWorkspaceNotFoundError,
);
assert.equal(await readFile(chatPath, "utf8"), JSON.stringify(chat, null, 2));
assert.equal(JSON.parse(await readFile(join(projectRoot, "workflows", "legacy-completed.json"), "utf8")).taskId, undefined);
assert.equal((await previewLegacyTaskBackfill(root)).summary.eligible, 3);

const routeResponses: Array<{ status: number; data: unknown }> = [];
assert.equal(await handleStorageRoute(
  { method: "GET" } as IncomingMessage,
  {} as ServerResponse,
  ["api", "storage", "legacy-task-backfill", "preview"],
  {
    repoRoot: root,
    json: (_res, status, data) => routeResponses.push({ status, data }),
    readBody: async () => ({}),
  },
), true);
assert.equal(routeResponses.at(-1)?.status, 200);
assert.equal((routeResponses.at(-1)?.data as { summary: { eligible: number } }).summary.eligible, 3);
assert.equal(await handleStorageRoute(
  { method: "POST" } as IncomingMessage,
  {} as ServerResponse,
  ["api", "storage", "legacy-task-backfill", "execute"],
  {
    repoRoot: root,
    json: (_res, status, data) => routeResponses.push({ status, data }),
    readBody: async () => ({}),
  },
), true);
assert.equal(routeResponses.at(-1)?.status, 400);

assert.equal(await handleStorageRoute(
  { method: "POST" } as IncomingMessage,
  {} as ServerResponse,
  ["api", "storage", "legacy-task-backfill", "execute"],
  {
    repoRoot: root,
    json: (_res, status, data) => routeResponses.push({ status, data }),
    readBody: async () => ({
      planHash: (await previewLegacyTaskBackfill(root)).planHash,
      selectedCandidateIds: [],
    }),
    hasActiveRuns: () => true,
  },
), true);
assert.equal(routeResponses.at(-1)?.status, 409);
assert.match((routeResponses.at(-1)?.data as { error: string }).error, /Stop all active/i);

console.log("legacy task backfill tests passed");
