import assert from "node:assert/strict";
import test from "node:test";
import type { PrivateEvalRunDTO } from "../src/renderer/data/workspace-client.ts";
import {
  buildBlindReviewInput,
  completedEvalRuns,
  parseIssueCategories,
} from "../src/renderer/pipelines/eval-write-model.ts";

function run(
  runId: string,
  mode: PrivateEvalRunDTO["mode"],
  status: PrivateEvalRunDTO["status"] = "completed",
  taskId = "task-one",
  projectId = "project-one",
): PrivateEvalRunDTO {
  return {
    runId,
    evalSetId: "set-one",
    projectId,
    taskId,
    mode,
    modelRoutes: {},
    startedAt: "2026-07-16T00:00:00.000Z",
    status,
  };
}

test("blind review input accepts exactly one completed Single and Team Run in the current Eval Task", () => {
  const runs = [
    run("single-complete", "single_agent"),
    run("team-complete", "team_workflow"),
    run("single-running", "single_agent", "running"),
    run("team-other-task", "team_workflow", "completed", "task-two"),
    run("team-other-project", "team_workflow", "completed", "task-one", "project-two"),
  ];

  assert.deepEqual(completedEvalRuns(runs, "set-one", "project-one", "task-one"), {
    single: [runs[0]],
    team: [runs[1]],
  });
  assert.deepEqual(buildBlindReviewInput(runs, "project-one", "task-one", {
    evalSetId: "set-one",
    singleRunId: "single-complete",
    teamRunId: "team-complete",
    seed: "  stable-seed  ",
    sampleSize: 10,
  }), {
    runIds: ["single-complete", "team-complete"],
    seed: "stable-seed",
    sampleSize: 10,
  });

  assert.throws(() => buildBlindReviewInput(runs, "project-one", "task-one", {
    evalSetId: "set-one",
    singleRunId: "single-running",
    teamRunId: "team-complete",
    seed: "seed",
  }), /已完成的 Single Agent Run/);
  assert.throws(() => buildBlindReviewInput(runs, "project-one", "task-one", {
    evalSetId: "set-one",
    singleRunId: "single-complete",
    teamRunId: "team-other-task",
    seed: "seed",
  }), /已完成的 Team Run/);
  assert.throws(() => buildBlindReviewInput(runs, "project-one", "task-one", {
    evalSetId: "set-one",
    singleRunId: "single-complete",
    teamRunId: "team-other-project",
    seed: "seed",
  }), /已完成的 Team Run/);
  assert.throws(() => buildBlindReviewInput(runs, "project-one", "task-one", {
    evalSetId: "set-one",
    singleRunId: "single-complete",
    teamRunId: "team-complete",
    seed: "seed",
    sampleSize: Number.POSITIVE_INFINITY,
  }), /正整数/);
});

test("Eval issue category input trims, de-duplicates, and accepts Chinese commas", () => {
  assert.deepEqual(parseIssueCategories(" terminology, fluency，terminology ,  "), ["terminology", "fluency"]);
});
