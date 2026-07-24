import { latestAgentPlan, planProgress, planRingDashoffset } from "./plan-model.ts";
import type { TaskArtifact, TaskWorkspaceSnapshot } from "../../../../../packages/cat-data/src/task_workspace_contract.ts";

const assert = {
  equal(actual: unknown, expected: unknown): void {
    if (actual !== expected) throw new Error(`Expected ${String(expected)}, received ${String(actual)}`);
  },
  deepEqual(actual: unknown, expected: unknown): void {
    const left = JSON.stringify(actual);
    const right = JSON.stringify(expected);
    if (left !== right) throw new Error(`Expected ${right}, received ${left}`);
  },
};

function test(name: string, run: () => void): void {
  try {
    run();
  } catch (cause) {
    throw new Error(name, { cause });
  }
}

function planArtifact(version: number, items: Array<{ id: string; text: string; status: string }>): TaskArtifact {
  return {
    id: "agent-plan:chat",
    taskId: "chat",
    runId: "run",
    type: "agent_plan",
    status: "reviewable",
    title: "Agent 工作计划",
    summary: null,
    scope: { kind: "standalone", fileGrantIds: [] },
    version,
    provenance: { agentThreadId: "run.main", activityId: "a1", evidenceRefs: [], parentArtifactIds: [] },
    availableDecisions: [],
    content: {
      document: {
        schemaVersion: 1,
        title: "Agent 工作计划",
        createdAt: "2026-07-24T09:00:00.000Z",
        generator: "test",
        blocks: [{ id: "plan", type: "todo_list", items }],
      },
    },
    createdAt: "2026-07-24T09:00:00.000Z",
    updatedAt: "2026-07-24T09:00:00.000Z",
  } as TaskArtifact;
}

const items = [
  { id: "a", text: "第一步", status: "completed" as const },
  { id: "b", text: "第二步", status: "in_progress" as const },
  { id: "c", text: "第三步", status: "pending" as const },
];

test("latestAgentPlan picks the newest agent_plan version and parses todos", () => {
  const snapshot = {
    artifacts: [
      planArtifact(1, items),
      planArtifact(2, [...items, { id: "d", text: "第四步", status: "pending" }]),
    ],
  } as unknown as TaskWorkspaceSnapshot;
  const plan = latestAgentPlan(snapshot);
  if (!plan) throw new Error("expected a plan");
  assert.equal(plan.version, 2);
  assert.equal(plan.items.length, 4);
  assert.equal(plan.artifactId, "agent-plan:chat");
  assert.equal(latestAgentPlan(null), null);
  assert.equal(latestAgentPlan({ artifacts: [] } as unknown as TaskWorkspaceSnapshot), null);
});

test("planProgress follows the spec step order: first in_progress, else first pending, else all done", () => {
  assert.deepEqual(planProgress(items), { completed: 1, total: 3, currentStep: 2, allComplete: false });
  assert.deepEqual(
    planProgress([{ id: "a", text: "x", status: "pending" }]),
    { completed: 0, total: 1, currentStep: 1, allComplete: false },
  );
  const done = planProgress([{ id: "a", text: "x", status: "completed" }, { id: "b", text: "y", status: "completed" }]);
  assert.equal(done.allComplete, true);
  assert.equal(done.currentStep, 2);
});

test("planRingDashoffset maps completion onto a 100-unit ring", () => {
  assert.equal(planRingDashoffset({ completed: 0, total: 4, currentStep: 1, allComplete: false }), 100);
  assert.equal(planRingDashoffset({ completed: 2, total: 4, currentStep: 3, allComplete: false }), 50);
  assert.equal(planRingDashoffset({ completed: 4, total: 4, currentStep: 4, allComplete: true }), 0);
});
