import type { IncomingMessage, ServerResponse } from "node:http";
import {
  createTaskWorkspace,
  TaskWorkspaceConflictError,
  type TaskLocator,
  type TaskMessageQueue,
} from "@linguist-agent/cat-data";
import { StrictApiInputError, strictApiArray, strictApiObject, strictApiString } from "../strict_api_contract.js";

export interface TaskMessageQueueRouteService {
  read(locator: TaskLocator): Promise<TaskMessageQueue>;
  edit(locator: TaskLocator, messageId: string, text: string): Promise<TaskMessageQueue>;
  delete(locator: TaskLocator, messageId: string): Promise<TaskMessageQueue>;
  clear(locator: TaskLocator): Promise<TaskMessageQueue>;
  reorder(locator: TaskLocator, messageIds: string[]): Promise<TaskMessageQueue>;
  pause(locator: TaskLocator, reason?: "user" | "interrupted" | "delivery_failed"): Promise<TaskMessageQueue>;
  resume(locator: TaskLocator): Promise<TaskMessageQueue>;
  retry(locator: TaskLocator, messageId: string): Promise<TaskMessageQueue>;
  steerNow(locator: TaskLocator, messageId: string): Promise<TaskMessageQueue>;
}

function messageId(parts: string[], index: number): string {
  let value = "";
  try {
    value = parts[index] ? decodeURIComponent(parts[index]!) : "";
  } catch {
    throw new TaskWorkspaceConflictError("Queued message id is not valid URL encoding.");
  }
  if (!value.trim()) throw new TaskWorkspaceConflictError("Queued message id is required.");
  return value;
}

const queueReorderSchema = strictApiObject({
  messageIds: strictApiArray(strictApiString({ minLength: 1 })),
}, { name: "Task message queue reorder" });
const queueEditSchema = strictApiObject({
  text: strictApiString({ minLength: 1 }),
}, { name: "Task queued message edit" });

/** Shared route vocabulary for standalone and Project Task queues. */
export async function handleTaskMessageQueueRoute(input: {
  req: IncomingMessage;
  res: ServerResponse;
  parts: string[];
  queueIndex: number;
  locator: TaskLocator;
  repoRoot: string;
  json: (res: ServerResponse, status: number, data: unknown) => void;
  readBody: (req: IncomingMessage) => Promise<unknown>;
  service?: TaskMessageQueueRouteService;
}): Promise<boolean> {
  const { req, res, parts, queueIndex, locator, service } = input;
  if (parts[queueIndex] !== "message-queue") return false;
  await createTaskWorkspace(input.repoRoot).open(locator);
  if (!service) throw new TaskWorkspaceConflictError("Task message queue runtime is unavailable.");

  if (parts.length === queueIndex + 1 && req.method === "GET") {
    input.json(res, 200, await service.read(locator));
    return true;
  }
  if (parts.length === queueIndex + 1 && req.method === "DELETE") {
    input.json(res, 200, await service.clear(locator));
    return true;
  }
  const action = parts[queueIndex + 1];
  if (parts.length === queueIndex + 2 && action === "pause" && req.method === "POST") {
    input.json(res, 200, await service.pause(locator, "user"));
    return true;
  }
  if (parts.length === queueIndex + 2 && action === "resume" && req.method === "POST") {
    input.json(res, 200, await service.resume(locator));
    return true;
  }
  if (parts.length === queueIndex + 2 && action === "reorder" && req.method === "POST") {
    let body: Record<string, unknown>;
    try {
      body = queueReorderSchema.parse(await input.readBody(req), "Task message queue reorder");
    } catch (error) {
      if (!(error instanceof StrictApiInputError)) throw error;
      input.json(res, error.status, { error: error.message, code: error.code });
      return true;
    }
    if (!Array.isArray(body.messageIds) || !body.messageIds.every((value) => typeof value === "string" && value.trim())) {
      input.json(res, 400, { error: "messageIds must be an array of non-empty strings." });
      return true;
    }
    input.json(res, 200, await service.reorder(locator, body.messageIds as string[]));
    return true;
  }
  if (!action) return false;
  const id = messageId(parts, queueIndex + 1);
  if (parts.length === queueIndex + 2 && req.method === "PATCH") {
    let body: Record<string, unknown>;
    try {
      body = queueEditSchema.parse(await input.readBody(req), "Task queued message edit");
    } catch (error) {
      if (!(error instanceof StrictApiInputError)) throw error;
      input.json(res, error.status, { error: error.message, code: error.code });
      return true;
    }
    if (typeof body.text !== "string" || !body.text.trim()) {
      input.json(res, 400, { error: "text is required." });
      return true;
    }
    input.json(res, 200, await service.edit(locator, id, body.text));
    return true;
  }
  if (parts.length === queueIndex + 2 && req.method === "DELETE") {
    input.json(res, 200, await service.delete(locator, id));
    return true;
  }
  const itemAction = parts[queueIndex + 2];
  if (parts.length === queueIndex + 3 && itemAction === "retry" && req.method === "POST") {
    input.json(res, 200, await service.retry(locator, id));
    return true;
  }
  if (parts.length === queueIndex + 3 && itemAction === "steer" && req.method === "POST") {
    input.json(res, 200, await service.steerNow(locator, id));
    return true;
  }
  return false;
}
