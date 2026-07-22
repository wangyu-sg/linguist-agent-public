import type { IncomingMessage, ServerResponse } from "node:http";

export interface ProjectAgentSettingsRouteDeps {
  json: (res: ServerResponse, status: number, data: unknown) => void;
  readBody: (req: IncomingMessage) => Promise<unknown>;
  readAgentSettings: (projectId: string) => Promise<unknown>;
  writeAgentSettings: (projectId: string, patch: Record<string, unknown>) => Promise<unknown>;
}

/** Project model/tool overrides only. Task execution lives under /tasks/:taskId. */
export async function handleProjectAgentSettingsRoute(
  req: IncomingMessage,
  res: ServerResponse,
  parts: string[],
  projectId: string,
  deps: ProjectAgentSettingsRouteDeps,
): Promise<boolean> {
  if (parts[3] !== "agent" || parts[4] !== "settings" || parts.length !== 5) return false;
  if (req.method === "GET") {
    deps.json(res, 200, await deps.readAgentSettings(projectId));
    return true;
  }
  if (req.method === "PUT") {
    const body = await deps.readBody(req) as Record<string, unknown>;
    deps.json(res, 200, await deps.writeAgentSettings(projectId, body));
    return true;
  }
  return false;
}
