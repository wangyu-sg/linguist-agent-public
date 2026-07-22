import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createTaskWorkspace } from "@linguist-agent/cat-data";
import { createEvalTaskRunProjector } from "../packages/cat-server/src/eval_task_run_projection.js";

const root = await mkdtemp(join(tmpdir(), "la-eval-task-run-"));
try {
  await createTaskWorkspace(root).create({ projectId: "project-one", taskId: "task-eval", title: "Blind quality comparison", intent: "Run a private evaluation.", kind: "eval" });
  const projector = await createEvalTaskRunProjector({
    repoRoot: root, projectId: "project-one", taskId: "task-eval", runId: "eval-run-one", evalSetId: "eval-set-one",
    mode: "single_agent", modelRoutes: { default: "deepseek/deepseek-v4-flash" }, startedAt: "2026-07-12T03:00:00.000Z", totalSegments: 2,
  });
  projector.output({
    runId: "eval-run-one", evalSetId: "eval-set-one", segmentId: "segment-1", mode: "single_agent",
    source: "开始游戏", target: "Start Game", notes: "", status: "completed",
  }, "2026-07-12T03:00:01.000Z");
  projector.complete({ inputTokens: 100, outputTokens: 20, totalTokens: 120, costUsd: 0.01, modelCalls: 7 }, "2026-07-12T03:00:02.000Z");
  await projector.flush();

  const snapshot = await createTaskWorkspace(root).open({ projectId: "project-one", taskId: "task-eval" });
  assert.equal(snapshot.runs[0]?.mode, "eval");
  assert.equal(snapshot.runs[0]?.status, "complete");
  assert.equal(snapshot.runs[0]?.usage?.totalTokens, 120);
  assert.equal(snapshot.runs[0]?.usage?.modelCalls, 7);
  assert.equal(snapshot.activities.some((row) => row.type === "progress" && row.body?.includes("1/2")), true);
  assert.equal(snapshot.artifacts[0]?.type, "eval_output");
  assert.equal(snapshot.artifacts[0]?.content.target, "Start Game");
  assert.equal(snapshot.artifacts[0]?.summary, null);

  await createTaskWorkspace(root).create({ projectId: "project-one", taskId: "task-eval-resume", title: "Resumed comparison", intent: "Resume partial projection.", kind: "eval" });
  const partialProjector = await createEvalTaskRunProjector({
    repoRoot: root, projectId: "project-one", taskId: "task-eval-resume", runId: "eval-run-resume", evalSetId: "eval-set-one",
    mode: "single_agent", modelRoutes: { default: "deepseek/deepseek-v4-flash" }, startedAt: "2026-07-12T03:00:00.000Z", totalSegments: 2,
  });
  partialProjector.output({ runId: "eval-run-resume", evalSetId: "eval-set-one", segmentId: "segment-1", mode: "single_agent", source: "开始", target: "Start", status: "completed" });
  partialProjector.fail(new Error("Connection error."));
  await partialProjector.flush();
  const resumedProjector = await createEvalTaskRunProjector({
    repoRoot: root, projectId: "project-one", taskId: "task-eval-resume", runId: "eval-run-resume", evalSetId: "eval-set-one",
    mode: "single_agent", modelRoutes: { default: "deepseek/deepseek-v4-flash" }, startedAt: "2026-07-12T03:00:00.000Z", totalSegments: 2,
  });
  resumedProjector.output({
    runId: "eval-run-resume", evalSetId: "eval-set-one", segmentId: "segment-2", mode: "single_agent",
    source: "继续", target: "Continue", status: "completed",
  }, "2026-07-12T03:00:03.000Z");
  resumedProjector.complete(undefined, "2026-07-12T03:00:04.000Z");
  await resumedProjector.flush();
  const resumedSnapshot = await createTaskWorkspace(root).open({ projectId: "project-one", taskId: "task-eval-resume" });
  assert.equal(resumedSnapshot.activities.some((row) => row.id === "eval-run-resume.complete" && row.body === "2/2 segments"), true);

  await createTaskWorkspace(root).create({ projectId: "project-one", taskId: "task-eval-team", title: "Visible Team eval", intent: "Show every specialist pass.", kind: "eval" });
  const teamProjector = await createEvalTaskRunProjector({
    repoRoot: root, projectId: "project-one", taskId: "task-eval-team", runId: "eval-run-team", evalSetId: "eval-set-one",
    mode: "team_workflow", modelRoutes: { default: "deepseek/deepseek-v4-flash" }, startedAt: "2026-07-12T03:05:00.000Z", totalSegments: 1,
  });
  teamProjector.role({
    type: "started", segmentId: "segment-1", roleId: "translator", callIndex: 1, roleAttempt: 1,
    modelRoute: "deepseek/deepseek-v4-flash", promptHash: "a".repeat(64),
  }, "2026-07-12T03:05:01.000Z");
  await teamProjector.flush();
  const runningTeam = await createTaskWorkspace(root).open({ projectId: "project-one", taskId: "task-eval-team" });
  assert.equal(runningTeam.agentThreads.find((row) => row.identity.roleId === "translator")?.status, "active");
  assert.equal(runningTeam.agentThreads.find((row) => row.id === "eval-run-team.main")?.childThreadIds.includes("eval-run-team.translator"), true);
  teamProjector.output({
    runId: "eval-run-team", evalSetId: "eval-set-one", segmentId: "segment-1", mode: "team_workflow",
    source: "开始", target: "Start", status: "completed",
    executionManifest: {
      adapter: "pi_role_sessions_team", roleIds: ["translator", "editor", "editor", "lead_linguist_final"],
      estimatedCalls: 3, actualCalls: 4, referenceIncluded: false, writeMode: "none",
      rolePromptHashes: [
        { roleId: "translator", promptHash: "a".repeat(64), modelRoute: "deepseek/deepseek-v4-flash" },
        { roleId: "editor", promptHash: "b".repeat(64), modelRoute: "deepseek/deepseek-v4-flash" },
        { roleId: "editor", promptHash: "c".repeat(64), modelRoute: "deepseek/deepseek-v4-flash" },
        { roleId: "lead_linguist_final", promptHash: "d".repeat(64), modelRoute: "deepseek/deepseek-v4-flash" },
      ],
    },
  }, "2026-07-12T03:05:02.000Z");
  teamProjector.complete({ modelCalls: 4 }, "2026-07-12T03:05:03.000Z");
  await teamProjector.flush();
  const completedTeam = await createTaskWorkspace(root).open({ projectId: "project-one", taskId: "task-eval-team" });
  assert.deepEqual(completedTeam.agentThreads.filter((row) => row.parentThreadId === "eval-run-team.main").map((row) => row.identity.roleId).sort(), ["editor", "lead_linguist_final", "translator"]);
  assert.equal(completedTeam.activities.filter((row) => row.actor.id === "editor").length, 2, "format repair must remain visible as a second Editor pass");
  assert.match(completedTeam.activities.find((row) => row.actor.id === "editor" && row.body?.includes("Follow-up"))?.body ?? "", /Follow-up pass 2/);
  assert.equal(completedTeam.artifacts[0]?.provenance.agentThreadId, "eval-run-team.lead_linguist_final");
  assert.match(completedTeam.artifacts[0]?.provenance.activityId ?? "", /lead_linguist_final\.completed$/);

  await createTaskWorkspace(root).create({ projectId: "project-one", taskId: "task-eval-canonical", title: "Canonical Team eval", intent: "Use the batch-level Team workflow.", kind: "eval" });
  const canonicalProjector = await createEvalTaskRunProjector({
    repoRoot: root, projectId: "project-one", taskId: "task-eval-canonical", runId: "eval-run-canonical", evalSetId: "eval-set-one",
    mode: "team_workflow", modelRoutes: { default: "opencode-go/deepseek-v4-flash" }, startedAt: "2026-07-12T03:06:00.000Z", totalSegments: 1,
  });
  canonicalProjector.role({ type: "started", segmentId: "batch", roleId: "translator", callIndex: 1, roleAttempt: 1, modelRoute: "opencode-go/deepseek-v4-flash", promptHash: "e".repeat(64) });
  canonicalProjector.role({ type: "completed", segmentId: "batch", roleId: "translator", callIndex: 1, roleAttempt: 1, modelRoute: "opencode-go/deepseek-v4-flash", promptHash: "e".repeat(64) });
  canonicalProjector.output({
    runId: "eval-run-canonical", evalSetId: "eval-set-one", segmentId: "segment-1", mode: "team_workflow", source: "开始", target: "Start", status: "completed",
    executionManifest: { adapter: "canonical_team_workflow", roleIds: ["translator"], estimatedCalls: 1, actualCalls: 1, referenceIncluded: false, writeMode: "none", rolePromptHashes: [{ roleId: "translator", promptHash: "e".repeat(64), modelRoute: "opencode-go/deepseek-v4-flash" }] },
  });
  canonicalProjector.complete({ modelCalls: 1 });
  await canonicalProjector.flush();
  const canonicalSnapshot = await createTaskWorkspace(root).open({ projectId: "project-one", taskId: "task-eval-canonical" });
  assert.equal(canonicalSnapshot.activities.filter((row) => row.actor.id === "translator").length, 1, "batch-level role completion must not be duplicated for every output segment");
  assert.equal(canonicalSnapshot.artifacts[0]?.provenance.agentThreadId, "eval-run-canonical.translator");

  await createTaskWorkspace(root).create({ projectId: "project-one", taskId: "task-eval-failed", title: "Failed comparison", intent: "Expose partial usage.", kind: "eval" });
  const failedProjector = await createEvalTaskRunProjector({
    repoRoot: root, projectId: "project-one", taskId: "task-eval-failed", runId: "eval-run-failed", evalSetId: "eval-set-one",
    mode: "team_workflow", modelRoutes: { default: "deepseek/deepseek-v4-flash" }, startedAt: "2026-07-12T03:10:00.000Z", totalSegments: 20,
  });
  failedProjector.fail(new Error("Editor output contract failed."), { inputTokens: 200, outputTokens: 80, totalTokens: 280, costUsd: 0.02, modelCalls: 4 }, "2026-07-12T03:10:02.000Z");
  await failedProjector.flush();
  const failedSnapshot = await createTaskWorkspace(root).open({ projectId: "project-one", taskId: "task-eval-failed" });
  assert.equal(failedSnapshot.runs[0]?.status, "failed");
  assert.equal(failedSnapshot.runs[0]?.usage?.modelCalls, 4);
  assert.equal(failedSnapshot.activities.some((row) => row.status === "error" && row.body?.includes("Editor output contract failed")), true);
} finally {
  await rm(root, { recursive: true, force: true });
}

console.log("eval task run projection tests passed");
