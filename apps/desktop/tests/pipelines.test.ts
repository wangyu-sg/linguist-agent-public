import assert from "node:assert/strict";
import test from "node:test";
import {
  executeCanonicalPipelineAction,
  type CanonicalPipelineClient,
  type PipelineScope,
} from "../src/renderer/pipelines/pipeline-actions.ts";
import {
  buildPipelineSnapshotView,
  canonicalRunPresentation,
} from "../src/renderer/pipelines/pipeline-model.ts";
import {
  deliveryAuthority,
  exportFormatForBatch,
  readEvalComparison,
  readEvalScorecard,
} from "../src/renderer/pipelines/pipeline-content.ts";
import type { TaskWorkspaceSnapshot } from "../../../packages/cat-data/src/task_workspace_contract.ts";
import { workspaceClient } from "../src/renderer/data/workspace-client.ts";

const scope: PipelineScope = {
  projectId: "project-one",
  batchId: "batch-one",
  taskId: "task-one",
};

function client(overrides: Partial<CanonicalPipelineClient> = {}): CanonicalPipelineClient {
  const unexpected = async (): Promise<never> => { throw new Error("unexpected pipeline call"); };
  return {
    runQualityAudit: unexpected,
    runDeliveryQa: unexpected,
    reviewDeliveryQa: unexpected,
    recordQualityWaiver: unexpected,
    checkDeliveryReadiness: unexpected,
    exportDelivery: unexpected,
    ...overrides,
  };
}

test("quality audit stays on the selected canonical Task and delegates one server action", async () => {
  const calls: PipelineScope[] = [];
  const report = { schemaVersion: 1, projectId: scope.projectId, batchId: scope.batchId };
  const result = await executeCanonicalPipelineAction(scope, { kind: "quality-audit" }, client({
    runQualityAudit: async (input) => { calls.push(input); return report as never; },
  }));

  assert.deepEqual(calls, [scope]);
  assert.equal(result, report);
});

test("review, waiver, readiness, and export keep server authority and require explicit reasons", async () => {
  const calls: Array<{ name: string; scope: PipelineScope; input?: unknown }> = [];
  const canonical = client({
    runDeliveryQa: async (input) => { calls.push({ name: "delivery-qa", scope: input }); return {} as never; },
    reviewDeliveryQa: async (input, decision) => { calls.push({ name: "delivery-qa-review", scope: input, input: decision }); return {} as never; },
    recordQualityWaiver: async (input, decision) => { calls.push({ name: "quality-waiver", scope: input, input: decision }); return {}; },
    checkDeliveryReadiness: async (input) => { calls.push({ name: "delivery-readiness", scope: input }); return {} as never; },
    exportDelivery: async (input, request) => { calls.push({ name: "delivery-export", scope: input, input: request }); return { authorization: { authorized: false } } as never; },
  });

  await executeCanonicalPipelineAction(scope, { kind: "delivery-qa" }, canonical);
  await executeCanonicalPipelineAction(scope, {
    kind: "delivery-qa-review",
    input: { reportId: "report-one", findingId: "finding-one", decision: "accepted_risk", reason: "Customer approved this exception." },
  }, canonical);
  await executeCanonicalPipelineAction(scope, {
    kind: "quality-waiver",
    input: { segmentId: "segment-one", findingId: "quality-one", code: "NUMBER_MISMATCH", reason: "Intentional in the localized UI." },
  }, canonical);
  await executeCanonicalPipelineAction(scope, { kind: "delivery-readiness" }, canonical);
  await executeCanonicalPipelineAction(scope, { kind: "delivery-export", input: { format: "xliff" } }, canonical);

  assert.deepEqual(calls.map((call) => call.name), [
    "delivery-qa",
    "delivery-qa-review",
    "quality-waiver",
    "delivery-readiness",
    "delivery-export",
  ]);
  assert.ok(calls.every((call) => call.scope === scope));
  assert.equal("force" in (calls.at(-1)?.input as object), false);

  await assert.rejects(() => executeCanonicalPipelineAction(scope, {
    kind: "delivery-qa-review",
    input: { reportId: "report-one", findingId: "finding-one", decision: "accepted_risk", reason: "  " },
  }, canonical), /reason/i);
  await assert.rejects(() => executeCanonicalPipelineAction(scope, {
    kind: "quality-waiver",
    input: { segmentId: "segment-one", findingId: "quality-one", code: "NUMBER_MISMATCH", reason: "" },
  }, canonical), /reason/i);
  assert.equal(calls.length, 5);
});

test("pipeline view uses canonical Run status and operation ownership instead of artifact type guesses", () => {
  const timestamp = "2026-07-16T00:00:00.000Z";
  const snapshot = {
    runs: [
      { id: "quality-run", mode: "pipeline", status: "waiting", rootAgentThreadId: "quality-thread", updatedAt: timestamp },
      { id: "review-run", mode: "pipeline", status: "failed", rootAgentThreadId: "review-thread", updatedAt: "2026-07-16T00:01:00.000Z" },
      { id: "eval-run", mode: "eval", status: "stopping", rootAgentThreadId: "eval-thread", updatedAt: "2026-07-16T00:02:00.000Z" },
    ],
    agentThreads: [
      { id: "quality-thread", identity: { roleId: "quality_audit" } },
      { id: "review-thread", identity: { roleId: "delivery_qa" } },
      { id: "eval-thread", identity: { roleId: "linguist-agent" } },
    ],
    artifacts: [
      { id: "quality-artifact", runId: "quality-run", type: "qa_report", updatedAt: timestamp },
      { id: "review-artifact", runId: "review-run", type: "qa_report", updatedAt: "2026-07-16T00:01:00.000Z" },
      { id: "scorecard", runId: "eval-run", type: "eval_scorecard", updatedAt: "2026-07-16T00:02:00.000Z" },
      { id: "comparison", runId: "eval-run", type: "eval_comparison", updatedAt: "2026-07-16T00:03:00.000Z" },
    ],
    decisions: [],
  } as unknown as TaskWorkspaceSnapshot;

  const view = buildPipelineSnapshotView(snapshot);
  assert.equal(view.quality?.artifact.id, "quality-artifact");
  assert.equal(view.review?.artifact.id, "review-artifact");
  assert.equal(view.eval.scorecards[0]?.id, "scorecard");
  assert.equal(view.eval.comparisons[0]?.id, "comparison");
  assert.deepEqual(view.runs.map((row) => [row.run.id, row.operation, row.presentation.label]), [
    ["eval-run", "eval", "正在停止"],
    ["review-run", "delivery_qa", "失败"],
    ["quality-run", "quality_audit", "等待中"],
  ]);
  assert.deepEqual(canonicalRunPresentation("stopped"), { label: "已停止", tone: "stopped", terminal: true });
});

test("delivery authorization and Eval evidence come only from canonical artifact payloads", () => {
  const artifact = (type: string, content: Record<string, unknown>) => ({ type, content }) as never;
  assert.equal(deliveryAuthority(null), "unknown");
  assert.equal(deliveryAuthority(artifact("delivery_readiness", { status: "pass" })), "unknown");
  assert.equal(deliveryAuthority(artifact("delivery_export", { authorization: { authorized: true } })), "authorized");
  assert.equal(deliveryAuthority(artifact("delivery_export", { authorization: { authorized: false } })), "blocked_override");

  assert.equal(exportFormatForBatch("phrase_mxliff"), "phrase_mxliff");
  assert.equal(exportFormatForBatch("xliff_2_0"), "xliff");
  assert.equal(exportFormatForBatch("xlsx_paste"), "xlsx");

  assert.deepEqual(readEvalScorecard(artifact("eval_scorecard", {
    evalSetId: "set-one",
    runId: "run-one",
    rows: [{ runId: "run-one", segmentId: "s1", dimension: "adequacy", score: 4, judge: "human:reviewer", issueTier: "OK", issueCategories: [] }],
  }))?.rows.map((row) => [row.segmentId, row.dimension, row.score]), [["s1", "adequacy", 4]]);
  assert.deepEqual(readEvalComparison(artifact("eval_comparison", {
    evalSetId: "set-one",
    markdown: "# Comparison",
    reportPath: "/runtime/report.md",
  })), { evalSetId: "set-one", markdown: "# Comparison", reportPath: "/runtime/report.md" });
});

test("workspace client calls the canonical pipeline routes and never requests a force export", async () => {
  const requests: Array<{ method: string; path: string; body?: unknown }> = [];
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      linguist: {
        api: {
          request: async (request: { method: string; path: string; body?: unknown }) => {
            requests.push(request);
            return { ok: true, status: 200, data: request.path.includes("/runs") ? { run: { runId: "eval-one" }, outputs: [] } : {} };
          },
        },
      },
    },
  });
  try {
    await workspaceClient.runQualityAudit(scope);
    await workspaceClient.runDeliveryQa(scope);
    await workspaceClient.reviewDeliveryQa(scope, { reportId: "report-one", findingId: "finding-one", decision: "accepted_risk", reason: "Explicit exception." });
    await workspaceClient.recordQualityWaiver(scope, { segmentId: "s1", findingId: "q1", code: "NUMBER_MISMATCH", reason: "Intentional." });
    await workspaceClient.checkDeliveryReadiness(scope);
    await workspaceClient.exportDelivery(scope, { format: "xliff" });
    await workspaceClient.launchPrivateEval({ evalSetId: "eval-set", projectId: scope.projectId, batchId: scope.batchId, mode: "single_agent" });
    await workspaceClient.fetchPrivateEvalRunOutputs("eval-set", "run/one");
    await workspaceClient.createPrivateEvalBlindReview("eval-set", {
      runIds: ["single-run", "team-run"],
      seed: "review-seed",
      sampleSize: 12,
    });
    await workspaceClient.fetchPrivateEvalBlindReview("eval-set", "review/one");
    await workspaceClient.submitPrivateEvalBlindJudgments("eval-set", "review/one", [{
      pairId: "pair-one",
      preference: "a",
      issueTierA: "OK",
      issueTierB: "B",
      issueCategoriesA: [],
      issueCategoriesB: ["terminology"],
      comment: "A preserves the project term.",
    }]);
    await workspaceClient.writePrivateEvalScorecard("eval-set", "single-run", [{
      runId: "single-run",
      segmentId: "segment-one",
      dimension: "adequacy",
      score: 4,
      judge: "human:reviewer",
      issueTier: "OK",
      issueCategories: [],
      accepted: true,
      comment: "Meaning is preserved.",
    }]);
  } finally {
    if (previousWindow) Object.defineProperty(globalThis, "window", previousWindow);
    else Reflect.deleteProperty(globalThis, "window");
  }

  assert.deepEqual(requests.map((request) => [request.method, request.path]), [
    ["GET", "/api/projects/project-one/batches/batch-one/quality?taskId=task-one"],
    ["POST", "/api/projects/project-one/batches/batch-one/delivery-qa"],
    ["POST", "/api/projects/project-one/batches/batch-one/delivery-qa-review"],
    ["POST", "/api/projects/project-one/batches/batch-one/quality/waivers"],
    ["GET", "/api/projects/project-one/batches/batch-one/delivery-readiness?taskId=task-one"],
    ["POST", "/api/projects/project-one/batches/batch-one/export"],
    ["POST", "/api/evals/private/eval-set/runs"],
    ["GET", "/api/evals/private/eval-set/runs/run%2Fone/outputs"],
    ["POST", "/api/evals/private/eval-set/blind-reviews"],
    ["GET", "/api/evals/private/eval-set/blind-reviews/review%2Fone"],
    ["POST", "/api/evals/private/eval-set/blind-reviews/review%2Fone/judgments"],
    ["POST", "/api/evals/private/eval-set/scorecards"],
  ]);
  assert.deepEqual(requests[2]?.body, {
    taskId: "task-one",
    reportId: "report-one",
    decisions: [{ findingId: "finding-one", reviewDecision: "accepted_risk", reviewReason: "Explicit exception.", reviewedBy: "user" }],
  });
  assert.equal((requests[5]?.body as Record<string, unknown>).force, false);
  assert.deepEqual(requests[6]?.body, {
    execute: true,
    background: true,
    projectId: "project-one",
    batchId: "batch-one",
    mode: "single_agent",
  });
  assert.deepEqual(requests[8]?.body, {
    runIds: ["single-run", "team-run"],
    seed: "review-seed",
    sampleSize: 12,
  });
  assert.deepEqual(requests[10]?.body, {
    rows: [{
      pairId: "pair-one",
      preference: "a",
      issueTierA: "OK",
      issueTierB: "B",
      issueCategoriesA: [],
      issueCategoriesB: ["terminology"],
      comment: "A preserves the project term.",
    }],
  });
  assert.deepEqual(requests[11]?.body, {
    runId: "single-run",
    rows: [{
      runId: "single-run",
      segmentId: "segment-one",
      dimension: "adequacy",
      score: 4,
      judge: "human:reviewer",
      issueTier: "OK",
      issueCategories: [],
      accepted: true,
      comment: "Meaning is preserved.",
    }],
  });
});

test("workspace client reads the canonical Eval authoring state instead of creating renderer-owned review data", async () => {
  const requests: Array<{ method: string; path: string; body?: unknown }> = [];
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      linguist: {
        api: {
          request: async (request: { method: string; path: string; body?: unknown }) => {
            requests.push(request);
            return { ok: true, status: 200, data: { rows: [] } };
          },
        },
      },
    },
  });
  try {
    await workspaceClient.listPrivateEvalBlindReviews("set/one");
    await workspaceClient.fetchPrivateEvalScorecard("set/one", "run/one");
  } finally {
    if (previousWindow) Object.defineProperty(globalThis, "window", previousWindow);
    else Reflect.deleteProperty(globalThis, "window");
  }

  assert.deepEqual(requests, [
    { method: "GET", path: "/api/evals/private/set%2Fone/blind-reviews" },
    { method: "GET", path: "/api/evals/private/set%2Fone/scorecards/run%2Fone" },
  ]);
});
