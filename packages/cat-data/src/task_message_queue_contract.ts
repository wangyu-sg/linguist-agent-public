export const TASK_MESSAGE_QUEUE_SCHEMA_VERSION = 1 as const;

export type TaskQueuedMessageStatus = "queued" | "paused" | "failed";
export type TaskMessageQueuePausedReason = "user" | "interrupted" | "delivery_failed";

export interface TaskQueuedMessage {
  id: string;
  taskId: string;
  runId: string;
  text: string;
  delivery: "follow_up";
  status: TaskQueuedMessageStatus;
  error?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface TaskMessageQueue {
  schemaVersion: typeof TASK_MESSAGE_QUEUE_SCHEMA_VERSION;
  taskId: string;
  paused: boolean;
  pausedReason: TaskMessageQueuePausedReason | null;
  messages: TaskQueuedMessage[];
  updatedAt: string;
}

function nonEmptyString(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${label} must be a non-empty string.`);
  return value.trim();
}

function optionalError(value: unknown, label: string): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  return nonEmptyString(value, label);
}

function parseStatus(value: unknown, label: string): TaskQueuedMessageStatus {
  if (value === "queued" || value === "paused" || value === "failed") return value;
  throw new Error(`${label} is invalid.`);
}

function parsePausedReason(value: unknown, label: string): TaskMessageQueuePausedReason | null {
  if (value === null) return null;
  if (value === "user" || value === "interrupted" || value === "delivery_failed") return value;
  throw new Error(`${label} is invalid.`);
}

export function emptyTaskMessageQueue(taskId: string, updatedAt = new Date().toISOString()): TaskMessageQueue {
  return {
    schemaVersion: TASK_MESSAGE_QUEUE_SCHEMA_VERSION,
    taskId,
    paused: false,
    pausedReason: null,
    messages: [],
    updatedAt,
  };
}

export function parseTaskMessageQueue(value: unknown, taskId: string): TaskMessageQueue {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Task message queue must be an object.");
  const row = value as Record<string, unknown>;
  if (row.schemaVersion !== TASK_MESSAGE_QUEUE_SCHEMA_VERSION) throw new Error("Task message queue schemaVersion is unsupported.");
  if (row.taskId !== taskId) throw new Error(`Task message queue belongs to ${String(row.taskId)}, not ${taskId}.`);
  if (typeof row.paused !== "boolean") throw new Error("Task message queue paused must be boolean.");
  if (!Array.isArray(row.messages)) throw new Error("Task message queue messages must be an array.");
  const ids = new Set<string>();
  const messages = row.messages.map((value, index): TaskQueuedMessage => {
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`Task queued message ${index} must be an object.`);
    const message = value as Record<string, unknown>;
    const id = nonEmptyString(message.id, `Task queued message ${index}.id`);
    if (ids.has(id)) throw new Error(`Task queued message id ${id} is duplicated.`);
    ids.add(id);
    if (message.taskId !== taskId) throw new Error(`Task queued message ${id} belongs to another Task.`);
    if (message.delivery !== "follow_up") throw new Error(`Task queued message ${id} delivery must be follow_up.`);
    return {
      id,
      taskId,
      runId: nonEmptyString(message.runId, `Task queued message ${id}.runId`),
      text: nonEmptyString(message.text, `Task queued message ${id}.text`),
      delivery: "follow_up",
      status: parseStatus(message.status, `Task queued message ${id}.status`),
      error: optionalError(message.error, `Task queued message ${id}.error`),
      createdAt: nonEmptyString(message.createdAt, `Task queued message ${id}.createdAt`),
      updatedAt: nonEmptyString(message.updatedAt, `Task queued message ${id}.updatedAt`),
    };
  });
  const pausedReason = parsePausedReason(row.pausedReason, "Task message queue pausedReason");
  if (row.paused !== (pausedReason !== null)) throw new Error("Task message queue paused and pausedReason must agree.");
  if (row.paused && messages.length === 0) throw new Error("A paused Task message queue must contain a message.");
  if (row.paused && messages.some((message) => message.status === "queued")) {
    throw new Error("A paused Task message queue cannot contain an active queued message.");
  }
  if (!row.paused && messages.some((message) => message.status !== "queued")) {
    throw new Error("An active Task message queue can contain only queued messages.");
  }
  return {
    schemaVersion: TASK_MESSAGE_QUEUE_SCHEMA_VERSION,
    taskId,
    paused: row.paused,
    pausedReason,
    messages,
    updatedAt: nonEmptyString(row.updatedAt, "Task message queue updatedAt"),
  };
}
