import assert from "node:assert/strict";
import test from "node:test";
import { parseTaskWorkspaceSnapshot, type TaskRunEvent } from "../../../packages/cat-data/src/task_workspace_contract.ts";
import { applyTaskEvent, taskEventNotice, TaskEventGapError } from "../src/renderer/data/task-events.ts";
import { workspaceClient } from "../src/renderer/data/workspace-client.ts";
import { WorkspaceStore } from "../src/renderer/data/workspace-store.ts";

const at = "2026-07-16T00:00:00.000Z";

function snapshot() {
  return parseTaskWorkspaceSnapshot({
    schemaVersion: 2,
    task: {
      id: "task-one",
      owner: { kind: "project", projectId: "project-one" },
      scope: { kind: "project", batchId: null, segmentIds: [], sourceLocale: null, targetLocale: null },
      title: "Localize the batch",
      intent: "Translate safely",
      kind: "translation",
      status: "active",
      createdAt: at,
      updatedAt: at,
    },
    activeRunId: "run-one",
    eventCursor: "task-one:2",
    projectedAt: at,
    runs: [{
      id: "run-one",
      taskId: "task-one",
      mode: "single",
      status: "active",
      rootAgentThreadId: "thread-one",
      updatedAt: at,
      stopAvailable: true,
      resumeAvailable: false,
    }],
    agentThreads: [{
      id: "thread-one",
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

function runEvent(taskId = "task-one", seq = 3): TaskRunEvent {
  const runId = taskId === "task-one" ? "run-one" : "run-two";
  const threadId = taskId === "task-one" ? "thread-one" : "thread-two";
  return {
    id: `${taskId}.${seq}`,
    cursor: `${taskId}:${seq}`,
    seq,
    taskId,
    runId,
    agentThreadId: threadId,
    type: "run_upsert",
    occurredAt: at,
    run: {
      id: runId,
      taskId,
      mode: "single",
      status: "awaiting_input",
      rootAgentThreadId: threadId,
      updatedAt: at,
      stopAvailable: true,
      resumeAvailable: false,
    },
  };
}

test("applies one canonical event and ignores a replayed cursor", () => {
  const updated = applyTaskEvent(snapshot(), runEvent());
  assert.equal(updated.eventCursor, "task-one:3");
  assert.equal(updated.runs[0]?.status, "awaiting_input");
  assert.strictEqual(applyTaskEvent(updated, runEvent()), updated);
});

test("ignores another Task and rejects an event gap", () => {
  const current = snapshot();
  assert.strictEqual(applyTaskEvent(current, runEvent("task-two")), current);
  assert.throws(() => applyTaskEvent(current, runEvent("task-one", 5)), TaskEventGapError);
});

test("keeps project loads independent and defers full Batch hydration until CAT needs it", async () => {
  const originals = { ...workspaceClient };
  const current = snapshot();
  let resolveProjects!: (value: Awaited<ReturnType<typeof workspaceClient.listProjects>>) => void;
  let resolveTasks!: (value: Awaited<ReturnType<typeof workspaceClient.listTasks>>) => void;
  const projects = new Promise<Awaited<ReturnType<typeof workspaceClient.listProjects>>>((resolve) => { resolveProjects = resolve; });
  const tasks = new Promise<Awaited<ReturnType<typeof workspaceClient.listTasks>>>((resolve) => { resolveTasks = resolve; });
  let onTaskEvent: ((event: unknown) => void) | undefined;
  let batchOpens = 0;
  let batchSummaryOpens = 0;

  workspaceClient.listProjects = () => projects;
  workspaceClient.listTasks = () => tasks;
  workspaceClient.openTask = async () => current;
  workspaceClient.openBatch = async () => {
    batchOpens += 1;
    return {
      batch: {
        schemaVersion: 1,
        format: "xlsx_paste",
        projectId: "project-one",
        batchId: "batch-one",
        sourceFile: "fixture.xlsx",
        sourceLanguage: "zh-CN",
        targetLanguage: "en-US",
        createdAt: at,
        updatedAt: at,
        segments: [],
      },
      delivery: null,
    };
  };
  workspaceClient.openBatchSummary = async () => {
    batchSummaryOpens += 1;
    return {
      summary: {
        schemaVersion: 1,
        projectId: "project-one",
        batchId: "batch-one",
        format: "xlsx_paste",
        sourceLanguage: "zh-CN",
        targetLanguage: "en-US",
        segments: 0,
        confirmed: 0,
        draft: 0,
        new: 0,
        locked: 0,
        updatedAt: at,
      },
    };
  };
  workspaceClient.subscribeTaskEvents = (_locator, _afterCursor, onEvent) => {
    onTaskEvent = onEvent;
    return () => undefined;
  };

  try {
    const store = new WorkspaceStore();
    const selecting = store.selectProject("project-one");
    const refreshing = store.refreshProjects();
    resolveTasks({ schemaVersion: 2, tasks: [current.task] });
    await selecting;
    assert.equal(store.getState().tasksState, "ready", "project refresh must not cancel Task loading");
    resolveProjects({ projects: [] });
    await refreshing;

    const batchScoped = parseTaskWorkspaceSnapshot({
      ...current,
      task: { ...current.task, scope: { ...current.task.scope, batchId: "batch-one" } },
    });
    workspaceClient.openTask = async () => batchScoped;
    await store.openTask("project-one", "task-one");
    assert.equal(batchOpens, 0, "opening a conversation Task must not fetch the full Batch payload");
    assert.equal(batchSummaryOpens, 0, "opening a conversation Task must not need a Batch summary request");
    assert.equal(store.getState().batch, null);
    assert.equal(store.getState().batchState, "idle");

    await store.ensureBatchLoaded();
    assert.equal(batchOpens, 1);
    assert.equal(store.getState().batch?.batch.batchId, "batch-one");

    onTaskEvent?.(runEvent());
    assert.equal(store.getState().tasks[0]?.status, "awaiting_input", "SSE snapshot updates must reach the sidebar Task row");
    store.close();
  } finally {
    Object.assign(workspaceClient, originals);
  }
});

test("background notification streams stay scoped to non-selected active Tasks", async () => {
  const originals = { ...workspaceClient };
  const current = snapshot();
  const otherTask = { ...current.task, id: "task-two", title: "Review another batch", updatedAt: "2026-07-16T00:01:00.000Z" };
  const subscriptions = new Map<string, (event: unknown) => void>();
  const opened: string[] = [];
  const notifications: unknown[] = [];
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      linguist: {
        api: {},
        system: {
          showNotification: async (candidate: unknown) => {
            notifications.push(candidate);
            return true;
          },
        },
      },
    },
  });
  workspaceClient.listTasks = async () => ({ schemaVersion: 2, tasks: [current.task, otherTask] });
  workspaceClient.openTask = async (_projectId, taskId) => {
    opened.push(taskId);
    return taskId === current.task.id ? current : parseTaskWorkspaceSnapshot({
      ...current,
      task: otherTask,
      activeRunId: "run-two",
      eventCursor: "task-two:2",
      runs: [{ ...current.runs[0]!, id: "run-two", taskId: "task-two", rootAgentThreadId: "thread-two" }],
      agentThreads: [{ ...current.agentThreads[0]!, id: "thread-two", taskId: "task-two", runId: "run-two" }],
    });
  };
  workspaceClient.subscribeTaskEvents = (locator, _afterCursor, onEvent) => {
    subscriptions.set(locator.taskId, onEvent);
    return () => subscriptions.delete(locator.taskId);
  };

  try {
    const store = new WorkspaceStore();
    store.setNotificationPreferences({
      schemaVersion: 1,
      enabled: true,
      categories: { waiting: true, failed: true, completed: true, permission: true },
      updatedAt: at,
    });
    await store.selectProject("project-one");
    await store.openTask("project-one", "task-one");
    await new Promise<void>((resolve) => setImmediate(resolve));

    assert.deepEqual(opened.sort(), ["task-one", "task-one", "task-two"]);
    assert.ok(subscriptions.has("task-two"), "the non-selected active Task keeps a canonical SSE subscription");
    subscriptions.get("task-two")?.(runEvent("task-two"));
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.equal(store.getState().taskId, "task-one", "a background event cannot retarget the active workspace");
    assert.equal((notifications[0] as { projectId?: string } | undefined)?.projectId, "project-one");
    assert.equal((notifications[0] as { taskId?: string } | undefined)?.taskId, "task-two");
    store.close();
    assert.equal(subscriptions.size, 0, "closing the store releases background SSE subscriptions");
  } finally {
    Object.assign(workspaceClient, originals);
    if (previousWindow) Object.defineProperty(globalThis, "window", previousWindow);
    else Reflect.deleteProperty(globalThis, "window");
  }
});

test("WorkspaceStore keeps canonical active Run summaries and lets the open snapshot replace them", async () => {
  const originals = { ...workspaceClient };
  const current = snapshot();
  workspaceClient.listTasks = async () => ({
    schemaVersion: 2,
    tasks: [current.task],
    activeRuns: [{
      taskId: current.task.id,
      runId: "run-stale-summary",
      status: "stopping",
      updatedAt: "2026-07-15T23:59:00.000Z",
      stopAvailable: false,
    }],
  });
  workspaceClient.openTask = async () => current;
  workspaceClient.listTaskPermissionRequests = async () => [];
  workspaceClient.subscribeTaskEvents = () => () => undefined;

  try {
    const store = new WorkspaceStore();
    await store.selectProject("project-one");
    assert.equal(store.getState().activeRunsByTaskId["task-one"]?.status, "stopping");

    await store.openTask("project-one", "task-one");
    assert.deepEqual(store.getState().activeRunsByTaskId["task-one"], {
      taskId: "task-one",
      runId: "run-one",
      status: "active",
      updatedAt: at,
      stopAvailable: true,
    });

    workspaceClient.openTask = async () => parseTaskWorkspaceSnapshot({ ...current, activeRunId: null });
    await store.openTask("project-one", "task-one");
    assert.equal(store.getState().activeRunsByTaskId["task-one"], undefined);
    store.close();
  } finally {
    Object.assign(workspaceClient, originals);
  }
});

test("Batch selection uses a latest-wins summary and defers the full CAT payload", async () => {
  const originals = { ...workspaceClient };
  const pending = new Map<string, (value: Awaited<ReturnType<typeof workspaceClient.openBatchSummary>>) => void>();
  let fullBatchOpens = 0;
  workspaceClient.openBatch = async () => {
    fullBatchOpens += 1;
    throw new Error("full Batch should be deferred");
  };
  workspaceClient.openBatchSummary = async (_projectId, batchId) => new Promise((resolve) => pending.set(batchId, resolve));
  const summary = (batchId: string) => ({
    summary: {
      schemaVersion: 1 as const,
      projectId: "project-one",
      batchId,
      format: "xliff_1_2" as const,
      sourceLanguage: "zh-CN",
      targetLanguage: "en-US",
      segments: batchId === "batch-two" ? 10_000 : 1_040,
      confirmed: 0,
      draft: 0,
      new: batchId === "batch-two" ? 10_000 : 1_040,
      locked: 0,
      updatedAt: at,
    },
  });

  try {
    const store = new WorkspaceStore();
    const first = store.openBatch("project-one", "batch-one");
    const second = store.openBatch("project-one", "batch-two");
    await Promise.resolve();
    pending.get("batch-two")?.(summary("batch-two"));
    await second;
    pending.get("batch-one")?.(summary("batch-one"));
    await first;
    assert.equal(store.getState().batchId, "batch-two");
    assert.equal(store.getState().batchSummary?.segments, 10_000);
    assert.equal(store.getState().batch, null);
    assert.equal(store.getState().batchState, "ready");
    assert.equal(fullBatchOpens, 0);

    workspaceClient.openBatchSummary = async () => { throw new Error("summary unavailable"); };
    await store.openBatch("project-one", "batch-three");
    assert.equal(store.getState().batchSummary, null);
    assert.equal(store.getState().batchState, "error");
    assert.equal(store.getState().error, "summary unavailable");
    store.close();
  } finally {
    Object.assign(workspaceClient, originals);
  }
});

test("a terminal Task event stream stays visible and a canonical refresh ignores stale callbacks", async () => {
  const originals = { ...workspaceClient };
  const current = snapshot();
  const subscriptions: Array<{ onState?: (state: { status: "connected" | "reconnecting" | "closed" | "error"; message?: string }) => void }> = [];
  let opens = 0;

  workspaceClient.openTask = async () => {
    opens += 1;
    return current;
  };
  workspaceClient.subscribeTaskEvents = (_locator, _afterCursor, _onEvent, onState) => {
    subscriptions.push({ onState });
    return () => undefined;
  };

  try {
    const store = new WorkspaceStore();
    await store.openTask("project-one", "task-one");
    subscriptions[0]?.onState?.({ status: "error", message: "runtime disconnected" });
    subscriptions[0]?.onState?.({ status: "closed" });

    assert.equal(store.getState().eventState, "error");
    assert.equal(store.getState().eventMessage, "runtime disconnected");
    assert.deepEqual(taskEventNotice(store.getState()), {
      live: "assertive",
      title: "Task 更新已中断",
      detail: "runtime disconnected",
      action: "刷新并重新连接",
    });

    await store.refreshTaskEvents();
    assert.equal(opens, 2, "recovery must fetch a fresh canonical Task snapshot");
    subscriptions[1]?.onState?.({ status: "connected" });
    subscriptions[0]?.onState?.({ status: "closed" });
    assert.equal(store.getState().eventState, "connected", "a replaced stream cannot overwrite the current connection");
    assert.equal(store.getState().eventMessage, null);
    store.close();
  } finally {
    Object.assign(workspaceClient, originals);
  }
});
