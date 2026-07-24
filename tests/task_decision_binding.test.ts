import { strict as assert } from "node:assert";
import type { TaskDecision } from "@linguist-agent/cat-data";
import { bindTaskDecision, taskDecisionBindingIssue } from "../packages/cat-server/src/task_decision_binding.js";

const decision: TaskDecision = {
  id: "decision-one",
  taskId: "task-one",
  runId: "run-one",
  requestedByThreadId: "run-one.main",
  artifactId: "artifact-one",
  kind: "proposal_review",
  status: "required",
  prompt: "Apply this reviewed proposal?",
  options: [
    { id: "apply", label: "Apply", action: "apply", destructive: false },
    { id: "reject", label: "Reject", action: "reject", destructive: false },
  ],
  scope: { kind: "project", batchId: "batch-one", segmentIds: ["segment-one"], sourceLocale: "en", targetLocale: "zh" },
  createdAt: "2026-07-24T00:00:00.000Z",
  decidedAt: null,
};

const bound = bindTaskDecision(decision, {
  runPlanHash: "a".repeat(64),
  expiresAt: "2026-07-25T00:00:00.000Z",
});

assert.equal(taskDecisionBindingIssue(bound, { runPlanHash: "a".repeat(64), now: new Date("2026-07-24T12:00:00.000Z") }), null);
assert.equal(taskDecisionBindingIssue(decision, { runPlanHash: "a".repeat(64), now: new Date("2026-07-24T12:00:00.000Z") }), "missing");
assert.equal(taskDecisionBindingIssue({ ...bound, prompt: "Apply a different proposal?" }, { runPlanHash: "a".repeat(64), now: new Date("2026-07-24T12:00:00.000Z") }), "content_mismatch");
assert.equal(taskDecisionBindingIssue(bound, { runPlanHash: "b".repeat(64), now: new Date("2026-07-24T12:00:00.000Z") }), "plan_mismatch");
assert.equal(taskDecisionBindingIssue(bound, { runPlanHash: "a".repeat(64), now: new Date("2026-07-25T00:00:00.000Z") }), "expired");
assert.equal(taskDecisionBindingIssue({ ...bound, decisionBinding: { ...bound.decisionBinding!, schemaVersion: 99 as 1 } }, { runPlanHash: "a".repeat(64), now: new Date("2026-07-24T12:00:00.000Z") }), "schema_mismatch");

console.log("task_decision_binding.test.ts: ok");
