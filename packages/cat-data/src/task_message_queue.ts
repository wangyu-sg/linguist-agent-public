import { randomUUID } from "node:crypto";
import { join } from "node:path";
import type { TaskLocator } from "./task_workspace_contract.js";
import {
  emptyTaskMessageQueue,
  parseTaskMessageQueue,
  type TaskMessageQueue,
  type TaskQueuedMessage,
} from "./task_message_queue_contract.js";
import { taskWorkspaceDirectory } from "./task_workspace.js";
import { readJsonFile, writeJsonFile } from "./workspace.js";
import {
  assertLegacyTaskFileWriteAllowed,
  resolveTaskMessageQueuePersistence,
  type TaskMessageQueuePersistence,
} from "./task_aggregate_storage.js";

const mutationQueues = new Map<string, Promise<void>>();

function queuePath(repoRoot: string, locator: TaskLocator): string {
  return join(taskWorkspaceDirectory(repoRoot, locator), "message_queue.json");
}

export function createFileTaskMessageQueuePersistence(repoRoot: string): TaskMessageQueuePersistence {
  return {
    key: (locator) => queuePath(repoRoot, locator),
    async read(locator) {
      const raw = await readJsonFile<unknown | null>(queuePath(repoRoot, locator), null);
      return raw === null ? emptyTaskMessageQueue(locator.taskId) : parseTaskMessageQueue(raw, locator.taskId);
    },
    async update(locator, mutate) {
      assertLegacyTaskFileWriteAllowed(repoRoot);
      const path = queuePath(repoRoot, locator);
      const previous = mutationQueues.get(path) ?? Promise.resolve();
      let resolveMutation!: () => void;
      const gate = new Promise<void>((resolve) => { resolveMutation = resolve; });
      const queued = previous.then(() => gate, () => gate);
      mutationQueues.set(path, queued);
      await previous.catch(() => undefined);
      try {
        const raw = await readJsonFile<unknown | null>(path, null);
        const current = raw === null ? emptyTaskMessageQueue(locator.taskId) : parseTaskMessageQueue(raw, locator.taskId);
        const next = parseTaskMessageQueue(await mutate(current), locator.taskId);
        await writeJsonFile(path, next, { durability: "critical" });
        return next;
      } finally {
        resolveMutation();
        if (mutationQueues.get(path) === queued) mutationQueues.delete(path);
      }
    },
  };
}

export function readTaskMessageQueue(repoRoot: string, locator: TaskLocator): Promise<TaskMessageQueue> {
  return resolveTaskMessageQueuePersistence(
    repoRoot,
    () => createFileTaskMessageQueuePersistence(repoRoot),
  ).read(locator);
}

export function updateTaskMessageQueue(
  repoRoot: string,
  locator: TaskLocator,
  mutate: (current: TaskMessageQueue) => TaskMessageQueue | Promise<TaskMessageQueue>,
): Promise<TaskMessageQueue> {
  return resolveTaskMessageQueuePersistence(
    repoRoot,
    () => createFileTaskMessageQueuePersistence(repoRoot),
  ).update(locator, mutate);
}

export function createTaskQueuedMessage(input: {
  taskId: string;
  runId: string;
  text: string;
  now?: string;
  id?: string;
}): TaskQueuedMessage {
  const now = input.now ?? new Date().toISOString();
  const text = input.text.trim();
  if (!text) throw new Error("Queued message text must be a non-empty string.");
  return {
    id: input.id ?? `queued_${randomUUID()}`,
    taskId: input.taskId,
    runId: input.runId,
    text,
    delivery: "follow_up",
    status: "queued",
    error: null,
    createdAt: now,
    updatedAt: now,
  };
}
