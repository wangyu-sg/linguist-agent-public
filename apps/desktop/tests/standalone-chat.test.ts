import assert from "node:assert/strict";
import test from "node:test";
import {
  parseTaskWorkspaceSnapshot,
  type TaskWorkspaceSnapshot,
} from "../../../packages/cat-data/src/task_workspace_contract.ts";
import { workspaceClient } from "../src/renderer/data/workspace-client.ts";
import { WorkspaceStore } from "../src/renderer/data/workspace-store.ts";

const at = "2026-07-20T00:00:00.000Z";

function standaloneSnapshot(taskId = "shared-task-id"): TaskWorkspaceSnapshot {
  return parseTaskWorkspaceSnapshot({
    schemaVersion: 2,
    task: {
      id: taskId,
      owner: { kind: "standalone" },
      scope: { kind: "standalone", fileGrantIds: [] },
      title: "A real projectless chat",
      intent: "General assistance",
      kind: "general",
      status: "draft",
      createdAt: at,
      updatedAt: at,
    },
    activeRunId: null,
    eventCursor: `${taskId}:0`,
    projectedAt: at,
    runs: [],
    agentThreads: [],
    activities: [],
    artifacts: [],
    decisions: [],
  });
}

test("standalone Chat owns its list, locator, message, and stop lifecycle", async () => {
  const originals = { ...workspaceClient };
  const snapshot = standaloneSnapshot();
  const subscriptions: unknown[] = [];
  const streamedMessages: unknown[] = [];
  const deliveredMessages: unknown[] = [];
  const stops: unknown[] = [];
  const compactions: unknown[] = [];
  const forks: unknown[] = [];
  const copied = standaloneSnapshot("copied-chat-id");

  workspaceClient.listChats = async () => ({ schemaVersion: 2, tasks: [snapshot.task], activeRuns: [] });
  workspaceClient.openChat = async (taskId) => taskId === copied.task.id ? copied : snapshot;
  workspaceClient.listStandalonePermissionRequests = async () => [];
  workspaceClient.createChat = async () => snapshot;
  workspaceClient.streamChatMessage = (input) => {
    streamedMessages.push(input);
    return () => undefined;
  };
  workspaceClient.sendChatMessage = async (taskId, input) => {
    deliveredMessages.push({ taskId, input });
    return {
      messageId: `message-${deliveredMessages.length}`,
      runId: "run-one",
      delivery: input.delivery === "follow_up" ? "follow_up" : "steer",
      queuePosition: deliveredMessages.length,
    };
  };
  workspaceClient.stopChat = async (taskId, input) => {
    stops.push({ taskId, input });
    return { stopped: 1, errors: [] };
  };
  workspaceClient.compactChat = async (taskId, input) => { compactions.push({ taskId, input }); return {}; };
  workspaceClient.forkChat = async (taskId, input) => {
    forks.push({ taskId, input });
    return { taskId, sourceThreadId: "thread-one", threadId: "thread-two", branchPointEntryId: "entry-one", branchPosition: "at", piSessionId: "pi-two" };
  };
  workspaceClient.copyChat = async () => copied;
  workspaceClient.subscribeTaskEvents = (locator, afterCursor) => {
    subscriptions.push({ locator, afterCursor });
    return () => undefined;
  };

  try {
    const store = new WorkspaceStore();
    await store.refreshChats();
    assert.deepEqual(store.getState().chats.map((task) => task.id), [snapshot.task.id]);

    await store.openChat(snapshot.task.id);
    assert.equal(store.getState().projectId, null);
    assert.equal(store.getState().task?.task.owner.kind, "standalone");
    assert.deepEqual(subscriptions, [{
      locator: { kind: "standalone", taskId: snapshot.task.id },
      afterCursor: snapshot.eventCursor,
    }]);

    const cancel = store.sendChat("Continue without a Project.", {
      delivery: "auto",
      modelProvider: "fixture",
      modelId: "selected-model",
      thinkingLevel: "medium",
    });
    assert.equal(typeof cancel, "function");
    store.sendChat("Adjust the current turn.", { delivery: "steer", agentThreadId: "thread-one" });
    store.sendChat("Run this after completion.", { delivery: "follow_up", agentThreadId: "thread-one" });
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.deepEqual(streamedMessages, [
      {
        taskId: snapshot.task.id,
        message: "Continue without a Project.",
        delivery: "auto",
        modelProvider: "fixture",
        modelId: "selected-model",
        thinkingLevel: "medium",
      },
    ]);
    assert.deepEqual(deliveredMessages, [
      {
        taskId: snapshot.task.id,
        input: { message: "Adjust the current turn.", delivery: "steer", agentThreadId: "thread-one" },
      },
      {
        taskId: snapshot.task.id,
        input: { message: "Run this after completion.", delivery: "follow_up", agentThreadId: "thread-one" },
      },
    ]);

    await store.stopTask("user stop");
    assert.deepEqual(stops, [{ taskId: snapshot.task.id, input: { reason: "user stop" } }]);
    await store.compactChat("Keep decisions.", "thread-one");
    assert.deepEqual(compactions, [{ taskId: snapshot.task.id, input: { customInstructions: "Keep decisions.", agentThreadId: "thread-one" } }]);
    assert.equal((await store.forkChat({ sourceThreadId: "thread-one", entryId: "entry-one", position: "at" })).threadId, "thread-two");
    assert.deepEqual(forks, [{ taskId: snapshot.task.id, input: { sourceThreadId: "thread-one", entryId: "entry-one", position: "at" } }]);
    await store.copyChat();
    assert.equal(store.getState().taskId, copied.task.id);
    store.close();
  } finally {
    Object.assign(workspaceClient, originals);
  }
});
