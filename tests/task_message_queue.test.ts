import { strict as assert } from "node:assert";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createTaskQueuedMessage,
  createTaskWorkspace,
  readTaskMessageQueue,
  updateTaskMessageQueue,
} from "@linguist-agent/cat-data";
import { createSingleTaskRunProjector } from "../packages/cat-server/src/single_task_run_projection.js";
import { TaskMessageQueueCoordinator, type TaskMessageQueueSession } from "../packages/cat-server/src/task_message_queue.js";

class FakeQueueSession implements TaskMessageQueueSession {
  isStreaming = true;
  steeringMessages: string[] = [];
  followUpMessages: string[] = [];
  failNextFollowUp = false;

  async steer(text: string): Promise<void> { this.steeringMessages.push(text); }
  async followUp(text: string): Promise<void> {
    if (this.failNextFollowUp) {
      this.failNextFollowUp = false;
      throw new Error("Injected Pi follow-up replacement failure");
    }
    if (text.startsWith("/invalid")) throw new Error("Extension commands cannot be queued");
    this.followUpMessages.push(text.startsWith("/skill ") ? `Expanded skill: ${text.slice(7)}` : text);
  }
  clearQueue() {
    const result = { steering: [...this.steeringMessages], followUp: [...this.followUpMessages] };
    this.steeringMessages = [];
    this.followUpMessages = [];
    return result;
  }
  getSteeringMessages(): readonly string[] { return this.steeringMessages; }
  getFollowUpMessages(): readonly string[] { return this.followUpMessages; }
}

const root = await mkdtemp(join(tmpdir(), "la-task-message-queue-"));
try {
  const locator = { kind: "standalone" as const, taskId: "queue-chat" };
  const workspace = createTaskWorkspace(root);
  await workspace.create({
    owner: { kind: "standalone" },
    taskId: locator.taskId,
    title: "Queue fixture",
    intent: "Exercise durable Pi follow-up controls.",
    kind: "general",
  });
  const runId = "queue-run";
  const projector = await createSingleTaskRunProjector({
    repoRoot: root,
    locator,
    taskId: locator.taskId,
    runId,
    userMessage: "Start the work.",
    startedAt: "2026-07-22T00:00:00.000Z",
    modelRoute: "fixture/model",
  });
  await projector.flush();

  const session = new FakeQueueSession();
  const coordinator = new TaskMessageQueueCoordinator(root);
  const changes: string[][] = [];
  await coordinator.bindRun({
    locator,
    runId,
    threadId: `${runId}.main`,
    session,
    onChange: (queue) => changes.push(queue.messages.map((message) => message.text)),
  });

  const first = await coordinator.deliver({ locator, runId, message: "First queued message", delivery: "follow_up" });
  const second = await coordinator.deliver({ locator, runId, message: "Second queued message", delivery: "follow_up" });
  assert.equal(first.queuePosition, 1);
  assert.equal(second.queuePosition, 2);
  assert.deepEqual(session.followUpMessages, ["First queued message", "Second queued message"]);

  let queue = await coordinator.edit(locator, first.messageId, "Edited first message");
  assert.deepEqual(queue.messages.map((message) => message.text), ["Edited first message", "Second queued message"]);
  assert.deepEqual(session.followUpMessages, ["Edited first message", "Second queued message"]);

  queue = await coordinator.reorder(locator, [second.messageId, first.messageId]);
  assert.deepEqual(queue.messages.map((message) => message.id), [second.messageId, first.messageId]);
  assert.deepEqual(session.followUpMessages, ["Second queued message", "Edited first message"]);

  queue = await coordinator.pause(locator, "user");
  assert.equal(queue.paused, true);
  assert.deepEqual(queue.messages.map((message) => message.status), ["paused", "paused"]);
  assert.deepEqual(session.followUpMessages, []);

  queue = await coordinator.resume(locator);
  assert.equal(queue.paused, false);
  assert.deepEqual(queue.messages.map((message) => message.status), ["queued", "queued"]);
  assert.deepEqual(session.followUpMessages, ["Second queued message", "Edited first message"]);

  queue = await coordinator.steerNow(locator, second.messageId);
  assert.deepEqual(queue.messages.map((message) => message.id), [first.messageId]);
  assert.deepEqual(session.steeringMessages, ["Second queued message"]);
  assert.deepEqual(session.followUpMessages, ["Edited first message"]);

  session.followUpMessages = [];
  queue = await coordinator.syncPiQueue({ locator, runId, followUp: [] });
  assert.deepEqual(queue.messages, []);
  const projected = await workspace.open(locator);
  assert.deepEqual(
    projected.activities.filter((activity) => activity.type === "message").map((activity) => activity.body),
    ["Start the work.", "Second queued message", "Edited first message"],
  );

  await coordinator.deliver({ locator, runId, message: "Wait behind a failed message", delivery: "follow_up" });
  await assert.rejects(
    coordinator.deliver({ locator, runId, message: "/invalid queued command", delivery: "follow_up" }),
    /Extension commands cannot be queued/,
  );
  queue = await readTaskMessageQueue(root, locator);
  const failedCommand = queue.messages[1]!;
  assert.equal(queue.pausedReason, "delivery_failed");
  assert.equal(failedCommand.status, "failed");
  assert.equal(queue.messages[0]?.status, "paused");
  assert.deepEqual(session.followUpMessages, [], "a failure pauses Pi's earlier follow-ups too");
  queue = await coordinator.edit(locator, failedCommand.id, "Recovered after editing");
  assert.equal(queue.paused, false, "editing the only failed row should continue a live queue");
  assert.deepEqual(queue.messages.map((message) => message.status), ["queued", "queued"]);
  assert.deepEqual(session.followUpMessages, ["Wait behind a failed message", "Recovered after editing"]);
  session.followUpMessages = [];
  await coordinator.syncPiQueue({ locator, runId, followUp: [] });

  const replacementOne = await coordinator.deliver({ locator, runId, message: "Replacement one", delivery: "follow_up" });
  const replacementTwo = await coordinator.deliver({ locator, runId, message: "Replacement two", delivery: "follow_up" });
  session.failNextFollowUp = true;
  await assert.rejects(
    coordinator.reorder(locator, [replacementTwo.messageId, replacementOne.messageId]),
    /Injected Pi follow-up replacement failure/,
  );
  queue = await readTaskMessageQueue(root, locator);
  assert.equal(queue.paused, true);
  assert.deepEqual(queue.messages.map((message) => message.status), ["failed", "failed"]);
  queue = await coordinator.retry(locator, queue.messages[0]!.id);
  assert.equal(queue.paused, false);
  assert.deepEqual(queue.messages.map((message) => message.status), ["queued", "queued"]);
  assert.deepEqual(session.followUpMessages, ["Replacement two", "Replacement one"]);
  await coordinator.clear(locator);

  const duplicateOne = await coordinator.deliver({ locator, runId, message: "Same text", delivery: "follow_up" });
  const duplicateTwo = await coordinator.deliver({ locator, runId, message: "Same text", delivery: "follow_up" });
  session.followUpMessages = ["Same text"];
  queue = await coordinator.syncPiQueue({ locator, runId, followUp: ["Same text"] });
  assert.deepEqual(queue.messages.map((message) => message.id), [duplicateTwo.messageId], "FIFO sync must retain the second duplicate id");
  assert.notEqual(duplicateOne.messageId, duplicateTwo.messageId);
  session.followUpMessages = [];
  await coordinator.syncPiQueue({ locator, runId, followUp: [] });

  const expanded = await coordinator.deliver({ locator, runId, message: "/skill inspect this", delivery: "follow_up" });
  assert.deepEqual(session.followUpMessages, ["Expanded skill: inspect this"]);
  queue = await coordinator.syncPiQueue({ locator, runId, followUp: session.followUpMessages });
  assert.deepEqual(queue.messages.map((message) => message.id), [expanded.messageId], "Pi prompt expansion must not look like queue divergence");
  session.followUpMessages = [];
  await coordinator.syncPiQueue({ locator, runId, followUp: [] });

  await coordinator.deliver({ locator, runId, message: "Keep this after interruption", delivery: "follow_up" });
  // A failed runtime can discard its in-memory Pi queue. Durable messages
  // must still survive instead of being mistaken for successfully delivered.
  session.followUpMessages = [];
  await coordinator.finishRun({ locator, runId, error: new Error("provider failed") });
  const persisted = await readTaskMessageQueue(root, locator);
  assert.equal(persisted.messages[0]?.text, "Keep this after interruption");
  assert.equal(persisted.messages[0]?.status, "failed");
  assert.equal(persisted.pausedReason, "delivery_failed");
  assert.ok(changes.length >= 8, "queue changes should remain observable without renderer ownership");
  projector.accept({
    type: "error",
    ts: "2026-07-22T00:09:00.000Z",
    errorMessage: "provider failed",
  });
  await projector.flush();

  const recoveryRunId = "queue-recovery-run";
  const recoveryProjector = await createSingleTaskRunProjector({
    repoRoot: root,
    locator,
    taskId: locator.taskId,
    runId: recoveryRunId,
    userMessage: "Continue after recovery.",
    startedAt: "2026-07-22T00:10:00.000Z",
    modelRoute: "fixture/model",
  });
  await recoveryProjector.flush();
  const recoverySession = new FakeQueueSession();
  await coordinator.bindRun({
    locator,
    runId: recoveryRunId,
    threadId: `${recoveryRunId}.main`,
    session: recoverySession,
  });
  queue = await coordinator.retry(locator, persisted.messages[0]!.id);
  assert.equal(queue.messages[0]?.runId, runId, "the queue keeps its original enqueue provenance");
  assert.deepEqual(recoverySession.followUpMessages, ["Keep this after interruption"]);
  recoverySession.followUpMessages = [];
  queue = await coordinator.syncPiQueue({ locator, runId: recoveryRunId, followUp: [] });
  assert.deepEqual(queue.messages, [], "a later Run can deliver a recovered durable follow-up");
  const recoveredProjection = await workspace.open(locator);
  assert.equal(
    recoveredProjection.activities.some((activity) => (
      activity.runId === recoveryRunId && activity.body === "Keep this after interruption"
    )),
    true,
  );
  await coordinator.finishRun({ locator, runId: recoveryRunId });

  const orphanLocator = { kind: "standalone" as const, taskId: "orphaned-queue" };
  await workspace.create({
    owner: { kind: "standalone" },
    taskId: orphanLocator.taskId,
    title: "Orphaned queue fixture",
    intent: "Recover queued state after a server restart.",
    kind: "general",
  });
  const orphaned = createTaskQueuedMessage({ taskId: orphanLocator.taskId, runId: "old-run", text: "Do not strand this" });
  await updateTaskMessageQueue(root, orphanLocator, (current) => ({
    ...current,
    messages: [orphaned],
    updatedAt: orphaned.updatedAt,
  }));
  const recovered = await coordinator.read(orphanLocator);
  assert.equal(recovered.paused, true);
  assert.equal(recovered.pausedReason, "interrupted");
  assert.equal(recovered.messages[0]?.status, "paused");

  console.log("Task message queue coordinator tests passed");
} finally {
  await rm(root, { recursive: true, force: true });
}
