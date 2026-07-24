import { resolve } from "node:path";
import type { TaskMessageQueue, TaskQueuedMessage } from "./task_message_queue_contract.js";
import type { TaskLocator } from "./task_workspace_contract.js";
import type { TaskWorkspacePersistence } from "./task_workspace.js";

export interface TaskMessageQueuePersistence {
  key(locator: TaskLocator): string;
  read(locator: TaskLocator): Promise<TaskMessageQueue>;
  update(
    locator: TaskLocator,
    mutate: (current: TaskMessageQueue) => TaskMessageQueue | Promise<TaskMessageQueue>,
  ): Promise<TaskMessageQueue>;
}

export interface TaskAggregateStorageBackend {
  root: string;
  workspace: TaskWorkspacePersistence;
  messageQueue: TaskMessageQueuePersistence;
}

let installedBackend: Readonly<TaskAggregateStorageBackend> | null = null;
let blockedLegacyFileWriterRoot: string | null = null;

function canonicalRoot(root: string): string {
  return resolve(root);
}

function installedFor(root: string): Readonly<TaskAggregateStorageBackend> | null {
  if (!installedBackend) return null;
  if (installedBackend.root !== canonicalRoot(root)) {
    throw new Error("canonical Task aggregate storage is installed for another root.");
  }
  return installedBackend;
}

/**
 * Installs one process-lifetime Task aggregate backend before request handling.
 * Replacement is forbidden: a running process must never switch authorities.
 */
export function installTaskAggregateStorageBackend(input: TaskAggregateStorageBackend): void {
  if (installedBackend) throw new Error("canonical Task aggregate storage is already installed.");
  installedBackend = Object.freeze({
    root: canonicalRoot(input.root),
    workspace: input.workspace,
    messageQueue: input.messageQueue,
  });
}

/**
 * Permanently blocks the legacy Task file writers for one process/root after
 * the durable SQLite authority marker has been published.
 */
export function installLegacyTaskFileWriterBlock(root: string): void {
  if (blockedLegacyFileWriterRoot) {
    throw new Error("legacy Task file writer block is already installed.");
  }
  blockedLegacyFileWriterRoot = canonicalRoot(root);
}

export function assertLegacyTaskFileWriteAllowed(root: string): void {
  if (blockedLegacyFileWriterRoot === canonicalRoot(root)) {
    throw new Error("legacy Task file writer is read-only after SQLite authority cutover.");
  }
}

export function resolveTaskWorkspacePersistence(
  root: string,
  fallback: () => TaskWorkspacePersistence,
): TaskWorkspacePersistence {
  return installedFor(root)?.workspace ?? fallback();
}

export function resolveTaskMessageQueuePersistence(
  root: string,
  fallback: () => TaskMessageQueuePersistence,
): TaskMessageQueuePersistence {
  return installedFor(root)?.messageQueue ?? fallback();
}

export function taskAggregateStorageStatus(): {
  authority: "file-default" | "installed";
  root: string | null;
} {
  return installedBackend
    ? { authority: "installed", root: installedBackend.root }
    : { authority: "file-default", root: null };
}

export type { TaskQueuedMessage };
