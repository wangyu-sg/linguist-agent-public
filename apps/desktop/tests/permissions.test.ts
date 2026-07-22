import assert from "node:assert/strict";
import test from "node:test";
import {
  workspaceClient,
  WorkspaceAPIError,
  standaloneAgentSessionPrefix,
  taskAgentSessionId,
} from "../src/renderer/data/workspace-client.ts";
import { WorkspaceStore } from "../src/renderer/data/workspace-store.ts";
import { parseTaskWorkspaceSnapshot } from "../../../packages/cat-data/src/task_workspace_contract.ts";

const at = "2026-07-16T00:00:00.000Z";

function snapshot() {
  return parseTaskWorkspaceSnapshot({
    schemaVersion: 2,
    task: {
      id: "task-one",
      owner: { kind: "project", projectId: "project-one" },
      scope: { kind: "project", batchId: null, segmentIds: [], sourceLocale: null, targetLocale: null },
      title: "Permission task",
      intent: "Use one approved tool",
      kind: "general",
      status: "active",
      createdAt: at,
      updatedAt: at,
    },
    activeRunId: "run-one",
    eventCursor: "task-one:1",
    projectedAt: at,
    runs: [{
      id: "run-one",
      taskId: "task-one",
      mode: "single",
      status: "active",
      rootAgentThreadId: "run-one.main",
      updatedAt: at,
      stopAvailable: true,
      resumeAvailable: false,
    }],
    agentThreads: [{
      id: "run-one.main",
      taskId: "task-one",
      runId: "run-one",
      parentThreadId: null,
      identity: { kind: "main", roleId: "main", displayName: "Linguist Agent", roleLabel: "Main Agent", disclosureLabel: "Agent" },
      status: "active",
      canReceiveUserMessage: true,
      handoffSummary: null,
      latestActivityId: null,
      childThreadIds: [],
      createdAt: at,
      updatedAt: at,
    }],
    activities: [],
    artifacts: [],
    decisions: [],
  });
}

function request(overrides: Record<string, unknown> = {}) {
  return {
    requestId: "permission-one",
    toolName: "bash",
    domain: "bash",
    riskClass: "high",
    argsSummary: "pwd",
    sessionId: taskAgentSessionId("task-one"),
    projectId: "project-one",
    createdAt: at,
    expiresAt: "2099-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function standaloneRequest(taskId = "chat-one", overrides: Record<string, unknown> = {}) {
  return request({
    projectId: undefined,
    sessionId: `${standaloneAgentSessionPrefix(taskId)}0123456789ab`,
    ...overrides,
  });
}

function standaloneSnapshot() {
  return parseTaskWorkspaceSnapshot({
    schemaVersion: 2,
    task: {
      id: "chat-one",
      owner: { kind: "standalone" },
      scope: { kind: "standalone", fileGrantIds: [] },
      title: "Permission chat",
      intent: "Approve one trusted resource",
      kind: "general",
      status: "active",
      createdAt: at,
      updatedAt: at,
    },
    activeRunId: "run-chat",
    eventCursor: "chat-one:1",
    projectedAt: at,
    runs: [{
      id: "run-chat",
      taskId: "chat-one",
      mode: "single",
      status: "pending",
      rootAgentThreadId: "run-chat.main",
      updatedAt: at,
      stopAvailable: true,
      resumeAvailable: false,
    }],
    agentThreads: [{
      id: "run-chat.main",
      taskId: "chat-one",
      runId: "run-chat",
      parentThreadId: null,
      identity: { kind: "main", roleId: "main", displayName: "Linguist Agent", roleLabel: "Main Agent", disclosureLabel: "Agent" },
      status: "pending",
      canReceiveUserMessage: true,
      handoffSummary: null,
      latestActivityId: null,
      childThreadIds: [],
      createdAt: at,
      updatedAt: at,
    }],
    activities: [],
    artifacts: [],
    decisions: [],
  });
}

test("standalone permission recovery accepts only the selected Chat session", async () => {
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      linguist: {
        api: {
          request: async () => ({
            ok: true,
            status: 200,
            data: { requests: [
              standaloneRequest(),
              standaloneRequest("chat-two", { requestId: "other-chat" }),
              request({ requestId: "project-request" }),
            ] },
          }),
        },
      },
    },
  });
  try {
    const rows = await workspaceClient.listStandalonePermissionRequests("chat-one");
    assert.deepEqual(rows.map((row) => row.requestId), ["permission-one"]);
  } finally {
    if (previousWindow) Object.defineProperty(globalThis, "window", previousWindow);
    else Reflect.deleteProperty(globalThis, "window");
  }
});

test("pending permission recovery filters exact canonical Project and Task session", async () => {
  const requests: Array<{ method: string; path: string; body?: unknown }> = [];
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      linguist: {
        api: {
          request: async (input: { method: string; path: string; body?: unknown }) => {
            requests.push(input);
            if (input.path.endsWith("/pending")) return {
              ok: true,
              status: 200,
              data: { requests: [
                request(),
                request({ requestId: "other-project", projectId: "project-two" }),
                request({ requestId: "other-task", sessionId: "la-task-task-two" }),
                request({ requestId: "expired", expiresAt: "2000-01-01T00:00:00.000Z" }),
              ] },
            };
            return { ok: true, status: 200, data: { ok: true, request: request() } };
          },
        },
      },
    },
  });
  try {
    const rows = await workspaceClient.listTaskPermissionRequests("project-one", "task-one");
    assert.deepEqual(rows.map((row) => [row.requestId, row.status]), [
      ["permission-one", "pending"],
      ["expired", "expired"],
    ]);
    await workspaceClient.decidePermission("permission-one", "deny", "Not needed");
  } finally {
    if (previousWindow) Object.defineProperty(globalThis, "window", previousWindow);
    else Reflect.deleteProperty(globalThis, "window");
  }
  assert.equal(taskAgentSessionId("task-one"), "la-task-task-one");
  assert.deepEqual(requests.at(-1), {
    method: "POST",
    path: "/api/agent/permissions/decision",
    body: { requestId: "permission-one", decision: "deny", reason: "Not needed" },
  });
});

test("WorkspaceStore recovers and accepts live standalone permission requests", async () => {
  const originals = { ...workspaceClient };
  const current = standaloneSnapshot();
  const pending = { ...standaloneRequest(), status: "pending" as const };
  workspaceClient.openChat = async () => current;
  workspaceClient.listStandalonePermissionRequests = async () => [pending];
  workspaceClient.subscribeTaskEvents = () => () => undefined;

  try {
    const store = new WorkspaceStore();
    await store.openChat("chat-one");
    assert.deepEqual(store.getState().permissionRequests.map((row) => row.requestId), ["permission-one"]);
    store.acceptPermissionRequest(standaloneRequest("chat-two", { requestId: "wrong-chat" }));
    assert.equal(store.getState().permissionRequests.length, 1);
    store.acceptPermissionRequest(standaloneRequest("chat-one", { requestId: "permission-two" }));
    assert.deepEqual(store.getState().permissionRequests.map((row) => row.requestId), ["permission-two", "permission-one"]);
    store.close();
  } finally {
    Object.assign(workspaceClient, originals);
  }
});

test("WorkspaceStore recovers, filters stream requests, settles states, and clears on Stop", async () => {
  const originals = { ...workspaceClient };
  const current = snapshot();
  const pending = { ...request(), status: "pending" as const };
  workspaceClient.listTasks = async () => ({ schemaVersion: 2, tasks: [current.task] });
  workspaceClient.openTask = async () => current;
  workspaceClient.subscribeTaskEvents = () => () => undefined;
  workspaceClient.listTaskPermissionRequests = async () => [pending];
  workspaceClient.decidePermission = async () => ({ ok: true, request: pending });
  workspaceClient.stopTask = async () => ({});

  try {
    const store = new WorkspaceStore();
    await store.selectProject("project-one");
    await store.openTask("project-one", "task-one");
    assert.deepEqual(store.getState().permissionRequests.map((row) => row.requestId), ["permission-one"]);

    store.acceptPermissionRequest(request({ requestId: "wrong", sessionId: "la-task-task-two" }));
    assert.equal(store.getState().permissionRequests.length, 1);
    store.acceptPermissionRequest(request({ requestId: "permission-two", toolName: "web_search", domain: "webRead", riskClass: "medium" }));
    assert.deepEqual(store.getState().permissionRequests.map((row) => row.requestId), ["permission-two", "permission-one"]);

    await store.decidePermission("permission-two", "approve");
    assert.equal(store.getState().permissionRequests.find((row) => row.requestId === "permission-two")?.status, "approved");

    workspaceClient.decidePermission = async () => { throw new WorkspaceAPIError(404, { error: "permission request not found" }); };
    await store.decidePermission("permission-one", "deny");
    assert.equal(store.getState().permissionRequests.find((row) => row.requestId === "permission-one")?.status, "expired");

    await store.stopTask("user stop");
    assert.deepEqual(store.getState().permissionRequests, []);
    store.close();
  } finally {
    Object.assign(workspaceClient, originals);
  }
});

test("WorkspaceStore keeps a failed permission decision visible and retryable", async () => {
  const originals = { ...workspaceClient };
  const current = snapshot();
  const pending = { ...request(), status: "pending" as const };
  let attempts = 0;
  workspaceClient.listTasks = async () => ({ schemaVersion: 2, tasks: [current.task] });
  workspaceClient.openTask = async () => current;
  workspaceClient.subscribeTaskEvents = () => () => undefined;
  workspaceClient.listTaskPermissionRequests = async () => [pending];
  workspaceClient.decidePermission = async () => {
    attempts += 1;
    if (attempts === 1) throw new Error("runtime disconnected");
    return { ok: true, request: pending };
  };

  try {
    const store = new WorkspaceStore();
    await store.selectProject("project-one");
    await store.openTask("project-one", "task-one");
    await assert.rejects(() => store.decidePermission("permission-one", "approve"), /disconnected/);
    assert.equal(store.getState().permissionRequests[0]?.status, "error");
    await store.decidePermission("permission-one", "approve");
    assert.equal(store.getState().permissionRequests[0]?.status, "approved");
    store.close();
  } finally {
    Object.assign(workspaceClient, originals);
  }
});
