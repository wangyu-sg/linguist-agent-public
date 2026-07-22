import assert from "node:assert/strict";
import test from "node:test";
import { parseTaskWorkspaceSnapshot } from "../../../packages/cat-data/src/task_workspace_contract.ts";
import { workspaceClient } from "../src/renderer/data/workspace-client.ts";
import { WorkspaceStore } from "../src/renderer/data/workspace-store.ts";

const at = "2026-07-16T00:00:00.000Z";

function teamSnapshot(recorded = false) {
  return parseTaskWorkspaceSnapshot({
    schemaVersion: 2,
    task: {
      id: "task one",
      owner: { kind: "project", projectId: "project one" },
      scope: { kind: "project", batchId: null, segmentIds: [], sourceLocale: null, targetLocale: null },
      title: "Localize safely",
      intent: "Use specialists only after approval",
      kind: "translation",
      status: recorded ? "active" : "awaiting_input",
      createdAt: at,
      updatedAt: at,
    },
    activeRunId: "run one",
    eventCursor: recorded ? "task one:2" : "task one:1",
    projectedAt: at,
    runs: [{
      id: "run one",
      taskId: "task one",
      mode: "team",
      status: recorded ? "active" : "awaiting_input",
      rootAgentThreadId: "run one.main",
      planHash: "plan-one",
      estimatedCalls: 2,
      modelRoutes: { translator: "provider/model" },
      updatedAt: at,
      stopAvailable: recorded,
      resumeAvailable: false,
    }],
    agentThreads: [{
      id: "run one.main",
      taskId: "task one",
      runId: "run one",
      parentThreadId: null,
      identity: { kind: "main", roleId: "main", displayName: "Linguist Agent", roleLabel: "Main Agent", disclosureLabel: "Agent" },
      status: recorded ? "active" : "awaiting_input",
      canReceiveUserMessage: true,
      handoffSummary: null,
      latestActivityId: null,
      childThreadIds: [],
      createdAt: at,
      updatedAt: at,
    }],
    activities: [],
    artifacts: [],
    decisions: [{
      id: "decision one",
      taskId: "task one",
      runId: "run one",
      requestedByThreadId: "run one.main",
      kind: "approval",
      status: recorded ? "recorded" : "required",
      prompt: "Start the selected Team roles?",
      options: [
        { id: "start", label: "Start", action: "approve", destructive: false },
        { id: "change", label: "Change plan", action: "request_change", destructive: false },
      ],
      selectedOptionId: recorded ? "start" : null,
      reason: recorded ? "Approved." : null,
      scope: { kind: "project", batchId: null, segmentIds: [], sourceLocale: null, targetLocale: null },
      createdAt: at,
      decidedAt: recorded ? at : null,
    }],
  });
}

const plan = {
  projectId: "project one",
  workflowId: "run one",
  createdAt: at,
  forceAllRoles: false,
  readiness: { status: "ready" as const, blockers: [], notes: [] },
  roles: [],
  selectedRoleIds: ["translator"],
  modelRoutes: { translator: "provider/model" },
  estimatedCalls: 1,
  planHash: "plan-one",
};

test("workspace client uses canonical ordinary Decision and Team preflight/start/resume routes", async () => {
  const requests: Array<{ method: string; path: string; body?: unknown }> = [];
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      linguist: {
        api: {
          request: async (request: { method: string; path: string; body?: unknown }) => {
            requests.push(request);
            if (request.path.endsWith("/preflight")) return { ok: true, status: 200, data: plan };
            if (request.path.includes("/decisions/")) return { ok: true, status: 200, data: { snapshot: teamSnapshot() } };
            return { ok: true, status: 200, data: { workflowId: "run one" } };
          },
        },
      },
    },
  });
  try {
    await workspaceClient.commitTaskDecision("project one", "task one", "decision one", { optionId: "change", reason: "Need full review." });
    await workspaceClient.preflightTeamWorkflow("project one", "run one", true);
    await workspaceClient.runTeamWorkflow("project one", "run one", "start", "plan one", true);
    await workspaceClient.runTeamWorkflow("project one", "run one", "resume", "plan two", false);
  } finally {
    if (previousWindow) Object.defineProperty(globalThis, "window", previousWindow);
    else Reflect.deleteProperty(globalThis, "window");
  }

  assert.deepEqual(requests, [
    {
      method: "POST",
      path: "/api/projects/project%20one/tasks/task%20one/decisions/decision%20one",
      body: { optionId: "change", reason: "Need full review." },
    },
    {
      method: "POST",
      path: "/api/projects/project%20one/workflows/run%20one/preflight",
      body: { forceAllRoles: true },
    },
    {
      method: "POST",
      path: "/api/projects/project%20one/workflows/run%20one/start",
      body: { planHash: "plan one", forceAllRoles: true },
    },
    {
      method: "POST",
      path: "/api/projects/project%20one/workflows/run%20one/resume",
      body: { planHash: "plan two", forceAllRoles: false },
    },
  ]);
});

test("WorkspaceStore preflights latest planHash before Team start, full-plan change, and resume", async () => {
  const originals = { ...workspaceClient };
  const calls: string[] = [];
  const pending = teamSnapshot();
  workspaceClient.listTasks = async () => ({ schemaVersion: 2, tasks: [pending.task] });
  workspaceClient.openTask = async () => { calls.push("open"); return pending; };
  workspaceClient.subscribeTaskEvents = () => () => undefined;
  workspaceClient.preflightTeamWorkflow = async (_projectId, _workflowId, forceAllRoles) => {
    calls.push(`preflight:${forceAllRoles}`);
    return { ...plan, forceAllRoles, planHash: forceAllRoles ? "full-plan" : "adaptive-plan" };
  };
  workspaceClient.commitTaskDecision = async (_projectId, _taskId, _decisionId, input) => {
    calls.push(`decision:${input.optionId}:${input.reason}`);
    return { snapshot: teamSnapshot(true) };
  };
  workspaceClient.runTeamWorkflow = async (_projectId, _workflowId, action, planHash, forceAllRoles) => {
    calls.push(`run:${action}:${planHash}:${forceAllRoles}`);
    return { workflowId: "run one" };
  };

  try {
    const store = new WorkspaceStore();
    await store.selectProject("project one");
    await store.openTask("project one", "task one");
    calls.length = 0;

    await store.runTeamWorkflow("run one", "start");
    assert.deepEqual(calls, ["preflight:false", "run:start:adaptive-plan:false", "open"]);

    calls.length = 0;
    await store.runTeamWorkflow("run one", "start", {
      forceAllRoles: true,
      changeDecision: { decisionId: "decision one", optionId: "change", reason: "Need every configured role." },
    });
    assert.deepEqual(calls, [
      "preflight:true",
      "decision:change:Need every configured role.",
      "run:start:full-plan:true",
      "open",
    ]);

    calls.length = 0;
    await store.runTeamWorkflow("run one", "resume");
    assert.deepEqual(calls, ["preflight:false", "run:resume:adaptive-plan:false", "open"]);
    store.close();
  } finally {
    Object.assign(workspaceClient, originals);
  }
});

test("WorkspaceStore refuses blocked Team plans before any execution", async () => {
  const originals = { ...workspaceClient };
  const pending = teamSnapshot();
  let executed = false;
  workspaceClient.listTasks = async () => ({ schemaVersion: 2, tasks: [pending.task] });
  workspaceClient.openTask = async () => pending;
  workspaceClient.subscribeTaskEvents = () => () => undefined;
  workspaceClient.preflightTeamWorkflow = async () => ({
    ...plan,
    readiness: { status: "blocked", blockers: ["Missing model route"], notes: [] },
  });
  workspaceClient.runTeamWorkflow = async () => { executed = true; return { workflowId: "run one" }; };

  try {
    const store = new WorkspaceStore();
    await store.selectProject("project one");
    await store.openTask("project one", "task one");
    await assert.rejects(() => store.runTeamWorkflow("run one", "start"), /Missing model route/);
    assert.equal(executed, false);
    store.close();
  } finally {
    Object.assign(workspaceClient, originals);
  }
});
