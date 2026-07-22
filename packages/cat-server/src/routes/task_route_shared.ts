import type { IncomingMessage, ServerResponse } from "node:http";
import {
  TASK_WORKSPACE_SCHEMA_VERSION,
  taskActiveRunSummary,
  type TaskLocator,
  type TaskRunEvent,
  type TaskWorkspace,
  type TaskWorkspaceSnapshot,
} from "@linguist-agent/cat-data";

export function taskListResponse(snapshots: readonly TaskWorkspaceSnapshot[]): {
  schemaVersion: typeof TASK_WORKSPACE_SCHEMA_VERSION;
  tasks: TaskWorkspaceSnapshot["task"][];
  activeRuns: NonNullable<ReturnType<typeof taskActiveRunSummary>>[];
} {
  return {
    schemaVersion: TASK_WORKSPACE_SCHEMA_VERSION,
    tasks: snapshots.map((snapshot) => snapshot.task),
    activeRuns: snapshots.flatMap((snapshot) => {
      const summary = taskActiveRunSummary(snapshot);
      return summary ? [summary] : [];
    }),
  };
}

export function validatedTaskTitle(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) throw new Error("title is required.");
  const title = value.trim();
  if (Array.from(title).length > 120) throw new Error("title must be 120 characters or fewer.");
  return title;
}

export async function streamCanonicalTaskEvents(input: {
  req: IncomingMessage;
  res: ServerResponse;
  url: URL;
  workspace: TaskWorkspace;
  locator: TaskLocator;
}): Promise<void> {
  const { req, res, url, workspace, locator } = input;
  const afterCursor = url.searchParams.get("after") ?? url.searchParams.get("afterCursor") ?? `${locator.taskId}:0`;
  const pending: TaskRunEvent[] = [];
  const sent = new Set<string>();
  let catchingUp = true;
  let closed = false;
  let unsubscribe: () => void = () => {};
  const close = () => {
    if (closed) return;
    closed = true;
    unsubscribe();
  };
  const writeEvent = (event: TaskRunEvent) => {
    if (closed || sent.has(event.cursor)) return;
    sent.add(event.cursor);
    try { res.write(`data: ${JSON.stringify(event)}\n\n`); } catch { close(); }
  };
  unsubscribe = workspace.subscribeEvents(locator, (events) => {
    if (catchingUp) pending.push(...events);
    else for (const event of events) writeEvent(event);
  });
  req.once("aborted", close);
  req.socket?.once("close", close);
  res.once?.("close", close);
  try {
    let batch = await workspace.eventsAfter({ ...locator, afterCursor, limit: 1_000 });
    if (closed) return;
    res.writeHead(200, {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    });
    res.flushHeaders?.();
    res.write(": connected\n\n");
    while (!closed) {
      for (const event of batch.events) writeEvent(event);
      if (!batch.hasMore) break;
      batch = await workspace.eventsAfter({ ...locator, afterCursor: batch.nextCursor, limit: 1_000 });
    }
    catchingUp = false;
    for (const event of pending.sort((left, right) => left.seq - right.seq)) writeEvent(event);
  } catch (error) {
    close();
    throw error;
  }
}
