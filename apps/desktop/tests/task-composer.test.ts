import assert from "node:assert/strict";
import test from "node:test";
import { workspaceClient } from "../src/renderer/data/workspace-client.ts";

test("Task Composer forwards only the canonical next-Run fields through the preload stream", () => {
  const originalWindow = globalThis.window;
  const calls: unknown[] = [];
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      linguist: {
        api: {
          streamTaskChat: (input: unknown) => {
            calls.push(input);
            return () => undefined;
          },
        },
      },
    },
  });
  try {
    const cancel = workspaceClient.streamTaskChat({
      projectId: "project-one",
      taskId: "task-one",
      message: "Review this batch.",
      segmentId: "row-1",
      modelProvider: "deepseek",
      modelId: "deepseek-v4-flash",
      thinkingLevel: "high",
      assetPaths: ["reference/style.md"],
      capabilityIds: ["research"],
    }, () => undefined);
    assert.equal(typeof cancel, "function");
    assert.deepEqual(calls, [{
      projectId: "project-one",
      taskId: "task-one",
      message: "Review this batch.",
      segmentId: "row-1",
      modelProvider: "deepseek",
      modelId: "deepseek-v4-flash",
      thinkingLevel: "high",
      assetPaths: ["reference/style.md"],
      capabilityIds: ["research"],
    }]);
  } finally {
    Object.defineProperty(globalThis, "window", { configurable: true, value: originalWindow });
  }
});

test("standalone Composer uses the native Pi-token stream instead of a fire-and-forget request", () => {
  const originalWindow = globalThis.window;
  const calls: unknown[] = [];
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      linguist: {
        api: {
          streamStandaloneChat: (input: unknown) => {
            calls.push(input);
            return () => undefined;
          },
        },
      },
    },
  });
  try {
    const cancel = workspaceClient.streamChatMessage({
      taskId: "chat-one",
      message: "Continue this without a Project.",
      delivery: "follow_up",
      agentThreadId: "thread-one",
      modelProvider: "deepseek",
      modelId: "deepseek-v4-flash",
      thinkingLevel: "high",
    }, () => undefined);
    assert.equal(typeof cancel, "function");
    assert.deepEqual(calls, [{
      taskId: "chat-one",
      message: "Continue this without a Project.",
      delivery: "follow_up",
      agentThreadId: "thread-one",
      modelProvider: "deepseek",
      modelId: "deepseek-v4-flash",
      thinkingLevel: "high",
    }]);
  } finally {
    Object.defineProperty(globalThis, "window", { configurable: true, value: originalWindow });
  }
});

test("Task session diagnostics stay paired to the canonical Project and Task route", async () => {
  const originalWindow = globalThis.window;
  const calls: unknown[] = [];
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      linguist: {
        api: {
          request: async (input: unknown) => {
            calls.push(input);
            return {
              ok: true,
              status: 200,
              data: { sessionDir: "/tmp/session", activeSessionId: "la-task-task/one", sessions: [] },
            };
          },
        },
      },
    },
  });
  try {
    await workspaceClient.fetchTaskAgentSession("project/one", "task/one");
    assert.deepEqual(calls, [{
      method: "GET",
      path: "/api/projects/project%2Fone/tasks/task%2Fone/session",
    }]);
  } finally {
    Object.defineProperty(globalThis, "window", { configurable: true, value: originalWindow });
  }
});

test("Project Task live delivery and queue management use the same canonical Task route family", async () => {
  const originalWindow = globalThis.window;
  const calls: unknown[] = [];
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      linguist: {
        api: {
          request: async (input: unknown) => {
            calls.push(input);
            return {
              ok: true,
              status: 200,
              data: { schemaVersion: 1, taskId: "task/one", paused: false, pausedReason: null, messages: [], updatedAt: "2026-07-22T00:00:00.000Z" },
            };
          },
        },
      },
    },
  });
  try {
    await workspaceClient.sendTaskMessage("project/one", "task/one", { message: "Adjust this now.", delivery: "steer" });
    await workspaceClient.fetchTaskMessageQueue({ kind: "project", projectId: "project/one", taskId: "task/one" });
    await workspaceClient.reorderTaskMessageQueue({ kind: "project", projectId: "project/one", taskId: "task/one" }, ["queued/one"]);
    assert.deepEqual(calls, [{
      method: "POST",
      path: "/api/projects/project%2Fone/tasks/task%2Fone/messages",
      body: { message: "Adjust this now.", delivery: "steer" },
    }, {
      method: "GET",
      path: "/api/projects/project%2Fone/tasks/task%2Fone/message-queue",
    }, {
      method: "POST",
      path: "/api/projects/project%2Fone/tasks/task%2Fone/message-queue/reorder",
      body: { messageIds: ["queued/one"] },
    }]);
  } finally {
    Object.defineProperty(globalThis, "window", { configurable: true, value: originalWindow });
  }
});

test("projectless Chat exposes the same durable queue route vocabulary", async () => {
  const originalWindow = globalThis.window;
  const calls: unknown[] = [];
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      linguist: {
        api: {
          request: async (input: unknown) => {
            calls.push(input);
            return {
              ok: true,
              status: 200,
              data: { schemaVersion: 1, taskId: "chat/one", paused: true, pausedReason: "user", messages: [], updatedAt: "2026-07-22T00:00:00.000Z" },
            };
          },
        },
      },
    },
  });
  try {
    const locator = { kind: "standalone" as const, taskId: "chat/one" };
    await workspaceClient.fetchTaskMessageQueue(locator);
    await workspaceClient.pauseTaskMessageQueue(locator);
    await workspaceClient.resumeTaskMessageQueue(locator);
    assert.deepEqual(calls, [{
      method: "GET",
      path: "/api/tasks/chat%2Fone/message-queue",
    }, {
      method: "POST",
      path: "/api/tasks/chat%2Fone/message-queue/pause",
      body: {},
    }, {
      method: "POST",
      path: "/api/tasks/chat%2Fone/message-queue/resume",
      body: {},
    }]);
  } finally {
    Object.defineProperty(globalThis, "window", { configurable: true, value: originalWindow });
  }
});
