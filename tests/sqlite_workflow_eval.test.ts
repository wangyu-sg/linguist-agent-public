import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { assertWorkflowEvalLegacyAllowed, createCatWorkflowRun, readCatWorkflowRun, readPrivateEvalRun, resetWorkflowEvalPersistenceForTests, updatePrivateEvalRun } from "@linguist-agent/cat-data";
import { activateWorkflowEvalSqliteCutover, prepareWorkflowEvalSqliteCutover } from "../packages/cat-server/src/workflow_eval_sqlite_cutover.js";

const root = await mkdtemp(join(tmpdir(), "la-workflow-eval-sqlite-"));
try {
  const projectRoot = join(root, "data", "projects", "proj");
  const evalRoot = join(root, "data", "evals", "private", "eval-1");
  await mkdir(join(projectRoot, "workflows"), { recursive: true });
  await mkdir(join(evalRoot, "runs", "run-1"), { recursive: true });
  await mkdir(join(evalRoot, "scorecards"), { recursive: true });
  await mkdir(join(evalRoot, "blind_reviews"), { recursive: true });
  await writeFile(join(projectRoot, "workflows", "workflow-1.json"), JSON.stringify({ projectId: "proj", workflowId: "workflow-1", taskId: "task-1", status: "stopped" }));
  await writeFile(join(projectRoot, "workflow_artifacts.json"), JSON.stringify({ teamRolePasses: [{ workflowId: "workflow-1", roleId: "translator", inputArtifactRefs: ["brief:1"], outputArtifactRefs: ["proposal:1"] }] }));
  await writeFile(join(evalRoot, "eval_set.json"), JSON.stringify({ evalSetId: "eval-1", label: "Synthetic", segmentCount: 1 }));
  await writeFile(join(evalRoot, "segments.jsonl"), `${JSON.stringify({ evalSetId: "eval-1", segmentId: "s1", source: "source" })}\n`);
  await writeFile(join(evalRoot, "runs", "run-1", "run.json"), JSON.stringify({ runId: "run-1", evalSetId: "eval-1", projectId: "proj", taskId: "task-1", status: "stopped" }));
  await writeFile(join(evalRoot, "runs", "run-1", "outputs.jsonl"), `${JSON.stringify({ runId: "run-1", segmentId: "s1", status: "completed", target: "target" })}\n`);
  await writeFile(join(evalRoot, "scorecards", "run-1.jsonl"), `${JSON.stringify({ runId: "run-1", segmentId: "s1", dimension: "adequacy", score: 5 })}\n`);
  await writeFile(join(evalRoot, "blind_reviews", "review-1.json"), JSON.stringify({ reviewId: "review-1", evalSetId: "eval-1", runIds: ["run-1", "run-2"], pairs: [] }));
  const authority = { assertOwned: async () => undefined };
  await assert.rejects(() => prepareWorkflowEvalSqliteCutover({ root, authority, activeRunCount: 1 }), /active/);
  const prepared = await prepareWorkflowEvalSqliteCutover({ root, authority, activeRunCount: 0 });
  assert.equal(prepared.status, "cutover");
  assert.equal(prepared.marker.records, 7);
  assert.equal((await prepared.repository.read("workflow/proj/workflow-1") as { taskId: string }).taskId, "task-1");
  assert.deepEqual(await prepared.repository.read("eval/eval-1/outputs/run-1"), [{ runId: "run-1", segmentId: "s1", status: "completed", target: "target" }]);
  assert.match(await readFile(prepared.markerPath, "utf8"), /eval-corpus-bytes/);
  activateWorkflowEvalSqliteCutover(prepared);
  await prepared.repository.write("workflow/proj/workflow-1", { projectId: "proj", workflowId: "workflow-1", taskId: "task-1", status: "completed" });
  assert.equal((await prepared.repository.read("workflow/proj/workflow-1") as { status: string }).status, "completed");
  const created = await createCatWorkflowRun(root, { projectId: "proj", intent: "check_assets", includeReadiness: false, workflowId: "workflow-2" });
  assert.equal((await readCatWorkflowRun(root, "proj", created.run.workflowId)).workflowId, "workflow-2");
  await updatePrivateEvalRun(root, { runId: "run-1", evalSetId: "eval-1", mode: "single_agent", modelRoutes: {}, startedAt: "2026-07-23T00:00:00.000Z", status: "completed" });
  assert.equal((await readPrivateEvalRun(root, "eval-1", "run-1")).status, "completed");
  prepared.close();
  resetWorkflowEvalPersistenceForTests(root);
  await assert.rejects(() => assertWorkflowEvalLegacyAllowed(root), /authoritative/);
  console.log("SQLite Workflow/Team/Private Eval tests passed");
} finally {
  await rm(root, { recursive: true, force: true });
}
