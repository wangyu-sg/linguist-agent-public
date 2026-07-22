import { randomUUID } from "node:crypto";
import type { AgentSession } from "@earendil-works/pi-coding-agent";
import {
  createTaskQueuedMessage,
  createTaskWorkspace,
  readTaskMessageQueue,
  TaskWorkspaceConflictError,
  updateTaskMessageQueue,
  type TaskLocator,
  type TaskMessageQueue,
  type TaskMessageQueuePausedReason,
  type TaskQueuedMessage,
} from "@linguist-agent/cat-data";

export type TaskMessageDelivery = "steer" | "follow_up";

export interface AcceptedTaskMessageDelivery {
  messageId: string;
  runId: string;
  delivery: TaskMessageDelivery;
  queuePosition?: number;
}

export interface TaskMessageQueueSession {
  isStreaming: boolean;
  steer(text: string): Promise<void>;
  followUp(text: string): Promise<void>;
  clearQueue(): { steering: string[]; followUp: string[] };
  getSteeringMessages(): readonly string[];
  getFollowUpMessages(): readonly string[];
}

interface LiveTaskMessageQueue {
  locator: TaskLocator;
  runId: string;
  threadId: string;
  session: TaskMessageQueueSession;
  /** Stable durable ids aligned to Pi's FIFO follow-up queue. */
  followUpIds: string[];
  replacing: boolean;
  onChange?: (queue: TaskMessageQueue) => void;
}

type QueueOperation<T> = () => Promise<T>;

function locatorKey(locator: TaskLocator): string {
  return locator.kind === "standalone"
    ? `standalone\0${locator.taskId}`
    : `project\0${locator.projectId}\0${locator.taskId}`;
}

function boundedMessage(value: unknown): string {
  const text = value instanceof Error ? value.message : String(value);
  return text.length > 1_000 ? `${text.slice(0, 997)}...` : text;
}

function normalizeText(text: string): string {
  const normalized = text.trim();
  if (!normalized) throw new TaskWorkspaceConflictError("Queued message text must not be empty.");
  if (normalized.length > 200_000) throw new TaskWorkspaceConflictError("Queued message text is too large.");
  return normalized;
}

function updatedQueue(queue: TaskMessageQueue, patch: Partial<TaskMessageQueue>, now = new Date().toISOString()): TaskMessageQueue {
  return { ...queue, ...patch, updatedAt: now };
}

function updatedMessage(message: TaskQueuedMessage, patch: Partial<TaskQueuedMessage>, now = new Date().toISOString()): TaskQueuedMessage {
  return { ...message, ...patch, updatedAt: now };
}

/**
 * One server-owned queue adapter for standalone and Project Tasks. Pi remains
 * the delivery engine; this layer gives each follow-up a durable id so the UI
 * can edit, delete, reorder, pause, and retry without inventing renderer state.
 */
export class TaskMessageQueueCoordinator {
  private readonly live = new Map<string, LiveTaskMessageQueue>();
  private readonly operations = new Map<string, Promise<void>>();

  constructor(private readonly repoRoot: string) {}

  private async exclusive<T>(locator: TaskLocator, operation: QueueOperation<T>): Promise<T> {
    const key = locatorKey(locator);
    const previous = this.operations.get(key) ?? Promise.resolve();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const queued = previous.then(() => gate, () => gate);
    this.operations.set(key, queued);
    await previous.catch(() => undefined);
    try {
      return await operation();
    } finally {
      release();
      if (this.operations.get(key) === queued) this.operations.delete(key);
    }
  }

  private current(locator: TaskLocator, runId?: string): LiveTaskMessageQueue {
    const live = this.live.get(locatorKey(locator));
    if (!live || (runId && live.runId !== runId) || !live.session.isStreaming) {
      throw new TaskWorkspaceConflictError(`Task ${locator.taskId} has no active Pi turn ready for message delivery.`);
    }
    return live;
  }

  private notify(live: LiveTaskMessageQueue | undefined, queue: TaskMessageQueue): void {
    if (!live?.onChange) return;
    try { live.onChange(queue); } catch { /* A disconnected renderer does not own queue truth. */ }
  }

  async read(locator: TaskLocator): Promise<TaskMessageQueue> {
    return this.exclusive(locator, async () => {
      await createTaskWorkspace(this.repoRoot).open(locator);
      const current = await readTaskMessageQueue(this.repoRoot, locator);
      if (this.live.has(locatorKey(locator)) || !current.messages.some((message) => message.status === "queued")) return current;
      const now = new Date().toISOString();
      return updateTaskMessageQueue(this.repoRoot, locator, (queue) => updatedQueue(queue, {
        paused: true,
        pausedReason: "interrupted",
        messages: queue.messages.map((message) => message.status === "queued"
          ? updatedMessage(message, { status: "paused", error: null }, now)
          : message),
      }, now));
    });
  }

  async bindRun(input: {
    locator: TaskLocator;
    runId: string;
    threadId: string;
    session: AgentSession | TaskMessageQueueSession;
    onChange?: (queue: TaskMessageQueue) => void;
  }): Promise<TaskMessageQueue> {
    return this.exclusive(input.locator, async () => {
      const key = locatorKey(input.locator);
      if (this.live.has(key)) throw new TaskWorkspaceConflictError(`Task ${input.locator.taskId} already owns a live message queue.`);
      const live: LiveTaskMessageQueue = {
        locator: input.locator,
        runId: input.runId,
        threadId: input.threadId,
        session: input.session,
        followUpIds: [],
        replacing: false,
        onChange: input.onChange,
      };
      this.live.set(key, live);
      const queue = await updateTaskMessageQueue(this.repoRoot, input.locator, (current) => {
        if (!current.messages.some((message) => message.status === "queued")) return current;
        const now = new Date().toISOString();
        return updatedQueue(current, {
          paused: true,
          pausedReason: "interrupted",
          messages: current.messages.map((message) => message.status === "queued"
            ? updatedMessage(message, { status: "paused", error: null }, now)
            : message),
        }, now);
      });
      this.notify(live, queue);
      return queue;
    });
  }

  async finishRun(input: { locator: TaskLocator; runId: string; error?: unknown }): Promise<TaskMessageQueue> {
    return this.exclusive(input.locator, async () => {
      const key = locatorKey(input.locator);
      const live = this.live.get(key);
      if (!live || live.runId !== input.runId) return readTaskMessageQueue(this.repoRoot, input.locator);
      // A failed Pi turn may have already discarded its in-memory follow-up
      // queue. Treating an empty runtime queue as successful delivery would
      // lose the user's durable messages precisely on the failure path.
      if (!input.error) await this.syncPiQueueUnlocked(live, live.session.getFollowUpMessages());
      const queue = await updateTaskMessageQueue(this.repoRoot, input.locator, (current) => {
        const remaining = current.messages.some((message) => message.status === "queued");
        if (!remaining) return current;
        const now = new Date().toISOString();
        const error = input.error ? boundedMessage(input.error) : null;
        return updatedQueue(current, {
          paused: true,
          pausedReason: input.error ? "delivery_failed" : "interrupted",
          messages: current.messages.map((message) => message.status === "queued"
            ? updatedMessage(message, {
                status: input.error ? "failed" : "paused",
                error,
              }, now)
            : message),
        }, now);
      });
      this.live.delete(key);
      this.notify(live, queue);
      return queue;
    });
  }

  async deliver(input: {
    locator: TaskLocator;
    runId?: string;
    message: string;
    delivery: TaskMessageDelivery;
  }): Promise<AcceptedTaskMessageDelivery> {
    return this.exclusive(input.locator, async () => {
      const live = this.current(input.locator, input.runId);
      const text = normalizeText(input.message);
      if (input.delivery === "steer") {
        await live.session.steer(text);
        const messageId = await this.appendDeliveredMessage(live, text, "steer");
        return { messageId, runId: live.runId, delivery: "steer" };
      }
      const current = await readTaskMessageQueue(this.repoRoot, input.locator);
      if (current.paused) throw new TaskWorkspaceConflictError("The message queue is paused. Resume or clear it before adding another follow-up.");
      const queued = createTaskQueuedMessage({ taskId: input.locator.taskId, runId: live.runId, text });
      let queue = await updateTaskMessageQueue(this.repoRoot, input.locator, (state) => updatedQueue(state, {
        messages: [...state.messages, queued],
      }, queued.updatedAt));
      try {
        await live.session.followUp(text);
        live.followUpIds.push(queued.id);
      } catch (error) {
        const failedAt = new Date().toISOString();
        queue = await updateTaskMessageQueue(this.repoRoot, input.locator, (state) => updatedQueue(state, {
          paused: true,
          pausedReason: "delivery_failed",
          messages: state.messages.map((message) => {
            if (message.id === queued.id) return updatedMessage(message, { status: "failed", error: boundedMessage(error) }, failedAt);
            return message.status === "queued"
              ? updatedMessage(message, { status: "paused", error: null }, failedAt)
              : message;
          }),
        }, failedAt));
        await this.replacePiFollowUps(live, queue).catch(() => undefined);
        this.notify(live, queue);
        throw error;
      }
      this.notify(live, queue);
      return {
        messageId: queued.id,
        runId: live.runId,
        delivery: "follow_up",
        queuePosition: queue.messages.findIndex((message) => message.id === queued.id) + 1,
      };
    });
  }

  async edit(locator: TaskLocator, messageId: string, text: string): Promise<TaskMessageQueue> {
    return this.mutateAndReplace(locator, (queue) => {
      const index = queue.messages.findIndex((message) => message.id === messageId);
      if (index < 0) throw new TaskWorkspaceConflictError(`Queued message ${messageId} was not found.`);
      const now = new Date().toISOString();
      const messages = [...queue.messages];
      const wasFailed = messages[index]!.status === "failed";
      messages[index] = updatedMessage(messages[index]!, {
        text: normalizeText(text),
        ...(wasFailed ? { status: "paused" as const } : {}),
        error: null,
      }, now);
      const hasAnotherFailure = messages.some((message) => message.status === "failed");
      const canContinue = wasFailed && !hasAnotherFailure && this.live.has(locatorKey(locator));
      return updatedQueue(queue, {
        paused: canContinue ? false : queue.paused,
        pausedReason: canContinue ? null : wasFailed && !this.live.has(locatorKey(locator)) ? "interrupted" : queue.pausedReason,
        messages: canContinue
          ? messages.map((message) => message.status === "paused"
              ? updatedMessage(message, { status: "queued", error: null }, now)
              : message)
          : messages,
      }, now);
    });
  }

  async delete(locator: TaskLocator, messageId: string): Promise<TaskMessageQueue> {
    return this.mutateAndReplace(locator, (queue) => {
      if (!queue.messages.some((message) => message.id === messageId)) {
        throw new TaskWorkspaceConflictError(`Queued message ${messageId} was not found.`);
      }
      const deleted = queue.messages.find((message) => message.id === messageId)!;
      let messages = queue.messages.filter((message) => message.id !== messageId);
      const failureResolved = deleted.status === "failed"
        && queue.pausedReason === "delivery_failed"
        && !messages.some((message) => message.status === "failed");
      const canContinue = failureResolved && this.live.has(locatorKey(locator));
      if (canContinue) {
        const now = new Date().toISOString();
        messages = messages.map((message) => message.status === "paused"
          ? updatedMessage(message, { status: "queued", error: null }, now)
          : message);
      }
      return updatedQueue(queue, {
        messages,
        ...(messages.length === 0 || canContinue
          ? { paused: false, pausedReason: null }
          : failureResolved
            ? { paused: true, pausedReason: "interrupted" }
            : {}),
      });
    });
  }

  async clear(locator: TaskLocator): Promise<TaskMessageQueue> {
    return this.mutateAndReplace(locator, (queue) => updatedQueue(queue, {
      paused: false,
      pausedReason: null,
      messages: [],
    }));
  }

  async reorder(locator: TaskLocator, messageIds: string[]): Promise<TaskMessageQueue> {
    return this.mutateAndReplace(locator, (queue) => {
      const expected = new Set(queue.messages.map((message) => message.id));
      if (messageIds.length !== expected.size || new Set(messageIds).size !== expected.size || messageIds.some((id) => !expected.has(id))) {
        throw new TaskWorkspaceConflictError("Reorder must contain every queued message id exactly once.");
      }
      const byId = new Map(queue.messages.map((message) => [message.id, message]));
      return updatedQueue(queue, { messages: messageIds.map((id) => byId.get(id)!) });
    });
  }

  async pause(locator: TaskLocator, reason: TaskMessageQueuePausedReason = "user"): Promise<TaskMessageQueue> {
    return this.mutateAndReplace(locator, (queue) => {
      const now = new Date().toISOString();
      const hasFailure = queue.messages.some((message) => message.status === "failed");
      return updatedQueue(queue, {
        paused: queue.messages.length > 0,
        pausedReason: queue.messages.length > 0 ? hasFailure ? "delivery_failed" : reason : null,
        messages: queue.messages.map((message) => message.status === "queued"
          ? updatedMessage(message, { status: "paused", error: null }, now)
          : message),
      }, now);
    });
  }

  async resume(locator: TaskLocator): Promise<TaskMessageQueue> {
    this.current(locator);
    return this.mutateAndReplace(locator, (queue) => {
      if (queue.messages.some((message) => message.status === "failed")) {
        throw new TaskWorkspaceConflictError("Retry, edit, or delete failed queued messages before resuming the queue.");
      }
      const now = new Date().toISOString();
      return updatedQueue(queue, {
        paused: false,
        pausedReason: null,
        messages: queue.messages.map((message) => message.status === "paused"
          ? updatedMessage(message, { status: "queued", error: null }, now)
          : message),
      }, now);
    });
  }

  async retry(locator: TaskLocator, messageId: string): Promise<TaskMessageQueue> {
    this.current(locator);
    return this.mutateAndReplace(locator, (queue) => {
      const target = queue.messages.find((message) => message.id === messageId);
      if (!target) throw new TaskWorkspaceConflictError(`Queued message ${messageId} was not found.`);
      const now = new Date().toISOString();
      return updatedQueue(queue, {
        paused: false,
        pausedReason: null,
        // Pi queue replacement can fail after accepting only part of a list.
        // Retrying any failed item therefore resumes the whole durable queue
        // in its visible order instead of leaving hidden failed rows behind.
        messages: queue.messages.map((message) => updatedMessage(message, {
          status: "queued",
          error: null,
        }, now)),
      }, now);
    });
  }

  async steerNow(locator: TaskLocator, messageId: string): Promise<TaskMessageQueue> {
    return this.exclusive(locator, async () => {
      const live = this.current(locator);
      const queue = await readTaskMessageQueue(this.repoRoot, locator);
      const targetIndex = queue.messages.findIndex((message) => message.id === messageId);
      const target = queue.messages[targetIndex];
      if (!target) throw new TaskWorkspaceConflictError(`Queued message ${messageId} was not found.`);
      const next = updatedQueue(queue, {
        messages: queue.messages.filter((message) => message.id !== messageId),
        ...(queue.messages.length === 1 ? { paused: false, pausedReason: null } : {}),
      });
      await updateTaskMessageQueue(this.repoRoot, locator, () => next);
      let steeringAccepted = false;
      try {
        await this.replacePiFollowUps(live, next);
        await live.session.steer(target.text);
        steeringAccepted = true;
        await this.appendDeliveredMessage(live, target.text, "steer");
      } catch (error) {
        // Once Pi accepts a steering message it must not be restored as
        // retryable: doing so could execute the same instruction twice merely
        // because canonical Activity persistence failed afterward.
        if (steeringAccepted) {
          this.notify(live, next);
          throw error;
        }
        const failedAt = new Date().toISOString();
        const restored = await updateTaskMessageQueue(this.repoRoot, locator, (current) => {
          const currentById = new Map(current.messages.map((message) => [message.id, message]));
          const originalIds = new Set(queue.messages.map((message) => message.id));
          const messages = queue.messages.map((original, index) => {
            if (index === targetIndex) {
              return updatedMessage(target, { status: "failed", error: boundedMessage(error) }, failedAt);
            }
            const candidate = currentById.get(original.id) ?? original;
            return candidate.status === "queued"
              ? updatedMessage(candidate, { status: "paused", error: null }, failedAt)
              : candidate;
          });
          for (const candidate of current.messages) {
            if (!originalIds.has(candidate.id)) messages.push(candidate);
          }
          return updatedQueue(current, {
            paused: true,
            pausedReason: "delivery_failed",
            messages,
          }, failedAt);
        });
        // Best effort: the durable queue is now paused, so clear any partial
        // Pi follow-up replacement before exposing the failure to the caller.
        await this.replacePiFollowUps(live, restored).catch(() => undefined);
        this.notify(live, restored);
        throw error;
      }
      this.notify(live, next);
      return next;
    });
  }

  async syncPiQueue(input: {
    locator: TaskLocator;
    runId: string;
    followUp: readonly string[];
  }): Promise<TaskMessageQueue> {
    // clearQueue()/followUp() emit synchronously while a replacement is still
    // in progress. Reject those intermediate snapshots before they can wait on
    // the per-Task lock and become stale-but-actionable afterward.
    const atEmission = this.live.get(locatorKey(input.locator));
    if (!atEmission || atEmission.runId !== input.runId || atEmission.replacing) {
      return readTaskMessageQueue(this.repoRoot, input.locator);
    }
    return this.exclusive(input.locator, async () => {
      const live = this.live.get(locatorKey(input.locator));
      if (!live || live.runId !== input.runId || live.replacing) return readTaskMessageQueue(this.repoRoot, input.locator);
      return this.syncPiQueueUnlocked(live, input.followUp);
    });
  }

  private async syncPiQueueUnlocked(live: LiveTaskMessageQueue, followUp: readonly string[]): Promise<TaskMessageQueue> {
    const trackedIds = [...live.followUpIds];
    const deliveredCount = trackedIds.length - followUp.length;
    const current = await readTaskMessageQueue(this.repoRoot, live.locator);
    // runId records where the user originally enqueued the instruction. A
    // paused queue can be resumed by a later Run, so Pi alignment must use the
    // stable FIFO ids rather than discarding cross-Run recovery candidates.
    const candidates = current.messages.filter((message) => message.status === "queued");
    const candidateIds = candidates.map((message) => message.id);
    const idsAligned = candidateIds.length === trackedIds.length
      && candidateIds.every((id, index) => id === trackedIds[index]);
    if (deliveredCount < 0 || !idsAligned) {
      const queue = await updateTaskMessageQueue(this.repoRoot, live.locator, (queue) => {
        const now = new Date().toISOString();
        return updatedQueue(queue, {
          paused: true,
          pausedReason: "delivery_failed",
          messages: queue.messages.map((message) => message.status === "queued"
            ? updatedMessage(message, {
                status: "failed",
                error: "Pi follow-up queue diverged from the durable Task queue.",
              }, now)
            : message),
        }, now);
      });
      await this.replacePiFollowUps(live, queue);
      this.notify(live, queue);
      return queue;
    }

    const delivered = candidates.slice(0, deliveredCount);
    // Projection precedes dequeue. If storage fails, Pi has delivered the
    // message but its durable id remains available for an idempotent retry at
    // the next queue event or finishRun instead of disappearing silently.
    for (const message of delivered) await this.appendDeliveredMessage(live, message.text, "follow_up", message.id);
    const deliveredIds = new Set(delivered.map((message) => message.id));
    const queue = deliveredIds.size
      ? await updateTaskMessageQueue(this.repoRoot, live.locator, (queue) => {
          const messages = queue.messages.filter((message) => !deliveredIds.has(message.id));
          return updatedQueue(queue, {
            messages,
            ...(messages.length === 0 ? { paused: false, pausedReason: null } : {}),
          });
        })
      : current;
    live.followUpIds = trackedIds.slice(deliveredCount);
    if (delivered.length) this.notify(live, queue);
    return queue;
  }

  private async mutateAndReplace(
    locator: TaskLocator,
    mutate: (queue: TaskMessageQueue) => TaskMessageQueue,
  ): Promise<TaskMessageQueue> {
    return this.exclusive(locator, async () => {
      const next = await updateTaskMessageQueue(this.repoRoot, locator, mutate);
      const live = this.live.get(locatorKey(locator));
      if (live) await this.replacePiFollowUps(live, next);
      this.notify(live, next);
      return next;
    });
  }

  private async replacePiFollowUps(live: LiveTaskMessageQueue, queue: TaskMessageQueue): Promise<void> {
    live.replacing = true;
    const steering = [...live.session.getSteeringMessages()];
    try {
      live.session.clearQueue();
      live.followUpIds = [];
      for (const message of steering) await live.session.steer(message);
      if (!queue.paused) {
        for (const message of queue.messages.filter((message) => message.status === "queued")) {
          await live.session.followUp(message.text);
          live.followUpIds.push(message.id);
        }
      }
    } catch (error) {
      // Never leave an accepted prefix running after the durable queue has
      // switched to failed/paused. Steering messages remain independent and
      // are restored best-effort after clearing the partial follow-ups.
      try {
        live.session.clearQueue();
        live.followUpIds = [];
        for (const message of steering) await live.session.steer(message);
      } catch { /* The durable failed queue remains the recovery authority. */ }
      const failedAt = new Date().toISOString();
      const failed = await updateTaskMessageQueue(this.repoRoot, live.locator, (current) => updatedQueue(current, {
        paused: true,
        pausedReason: "delivery_failed",
        messages: current.messages.map((message) => message.status === "queued"
          ? updatedMessage(message, { status: "failed", error: boundedMessage(error) }, failedAt)
          : message),
      }, failedAt));
      this.notify(live, failed);
      throw error;
    } finally {
      live.replacing = false;
    }
  }

  private async appendDeliveredMessage(
    live: LiveTaskMessageQueue,
    text: string,
    delivery: TaskMessageDelivery,
    queueMessageId?: string,
  ): Promise<string> {
    const messageId = queueMessageId ? `${queueMessageId}.delivered` : `message_${randomUUID()}`;
    const occurredAt = new Date().toISOString();
    const workspace = createTaskWorkspace(this.repoRoot);
    try {
      await workspace.appendGenerated({
        ...live.locator,
        runId: live.runId,
        events: [{
          type: "activity_append",
          agentThreadId: live.threadId,
          occurredAt,
          activity: {
            id: messageId,
            taskId: live.locator.taskId,
            runId: live.runId,
            agentThreadId: live.threadId,
            seq: 1,
            type: "message",
            status: "done",
            actor: { kind: "human", id: "user", displayName: "You", agentThreadId: live.threadId },
            title: delivery === "steer" ? "You · steer" : "You · follow up",
            body: text,
            tool: null,
            refs: { artifactIds: [], evidenceRefs: [], decisionIds: [], segmentIds: [] },
            createdAt: occurredAt,
            updatedAt: occurredAt,
          },
        }],
      });
    } catch (error) {
      const snapshot = await workspace.open(live.locator).catch(() => undefined);
      const existing = snapshot?.activities.find((activity) => activity.id === messageId);
      if (!existing
        || existing.type !== "message"
        || existing.runId !== live.runId
        || existing.agentThreadId !== live.threadId
        || existing.body !== text) throw error;
    }
    return messageId;
  }
}
