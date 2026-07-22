import type { IncomingMessage, ServerResponse } from "node:http";

export async function handleHomeReplacementRoute(
  req: IncomingMessage,
  res: ServerResponse,
  parts: string[],
  deps: {
    json: (res: ServerResponse, status: number, data: unknown) => void;
    migratedTaskId: () => string | undefined;
  },
): Promise<boolean> {
  if (parts[0] !== "api" || parts[1] !== "home") return false;
  const taskId = deps.migratedTaskId();
  if (parts[2] === "chat" && parts.length === 3 && req.method === "GET") {
    deps.json(res, 200, { taskId: taskId ?? null });
    return true;
  }
  if (parts[2] === "chat" && (parts.length === 3 || parts[3] === "stream") && req.method === "POST") {
    deps.json(res, 410, {
      error: {
        code: "home_replaced",
        message: "The legacy Home Agent was replaced by canonical standalone Chats.",
        taskId: taskId ?? null,
        replacement: taskId ? `/api/tasks/${encodeURIComponent(taskId)}` : "/api/tasks",
      },
    });
    return true;
  }
  if (parts[2] === "stop" && req.method === "POST") {
    deps.json(res, 410, {
      error: {
        code: "home_replaced",
        message: "The legacy Home Agent has no running loop to stop.",
        taskId: taskId ?? null,
        replacement: taskId ? `/api/tasks/${encodeURIComponent(taskId)}` : "/api/tasks",
      },
    });
    return true;
  }
  return false;
}
