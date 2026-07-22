import type { IncomingMessage, ServerResponse } from "node:http";

export interface AgentCatalogRouteDeps {
  json: (res: ServerResponse, status: number, data: unknown) => void;
  listAgentSkills: () => Promise<unknown[]>;
  listAgentPrompts: () => Promise<Array<{ name: string; path: string }>>;
  readModelDefaults: () => Promise<object>;
  listAgentToolMetadata: () => Promise<unknown[]> | unknown[];
  readAgentBridgeCatalog: () => Promise<unknown>;
  readNativeCapabilityCatalog: () => Promise<unknown>;
}

export async function handleAgentCatalogRoute(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  deps: AgentCatalogRouteDeps,
): Promise<boolean> {
  if (url.pathname === "/api/agent/skills" && req.method === "GET") {
    deps.json(res, 200, { skills: await deps.listAgentSkills(), prompts: await deps.listAgentPrompts() });
    return true;
  }
  if (url.pathname === "/api/agent/model-catalog" && req.method === "GET") {
    deps.json(res, 200, {
      ...(await deps.readModelDefaults()),
      projectOverride: { enabled: true, appliesOn: "next_turn" },
    });
    return true;
  }
  if (url.pathname === "/api/agent/tools" && req.method === "GET") {
    deps.json(res, 200, { tools: await deps.listAgentToolMetadata() });
    return true;
  }
  if (url.pathname === "/api/agent/bridges" && req.method === "GET") {
    deps.json(res, 200, await deps.readAgentBridgeCatalog());
    return true;
  }
  if (url.pathname === "/api/agent/native-capabilities" && req.method === "GET") {
    deps.json(res, 200, await deps.readNativeCapabilityCatalog());
    return true;
  }
  return false;
}
