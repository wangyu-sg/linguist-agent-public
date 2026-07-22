import type { IncomingMessage, ServerResponse } from "node:http";
import {
  buildAgentPermissionContract,
  normalizeAgentPermissionMode,
  normalizeAgentPermissionRules,
  type AgentPermissionContract,
  type AgentPermissionMode,
  type AgentPermissionRules,
} from "@linguist-agent/cat-runtime";
import type { PermissionDecisionRegistry } from "../permission_decisions.js";

export interface AgentPermissionSettings {
  permissionMode?: AgentPermissionMode;
  permissionRules?: AgentPermissionRules;
}

export interface AgentPermissionRouteDeps {
  json: (res: ServerResponse, status: number, data: unknown) => void;
  readBody: (req: IncomingMessage) => Promise<unknown>;
  requireString: (value: unknown, label: string) => string;
  optionalString: (value: unknown) => string | undefined;
  permissionDecisionRegistry: PermissionDecisionRegistry;
  readAgentPermissionContract: (projectId?: string) => Promise<AgentPermissionContract>;
  writeGlobalAgentPermissionSettings: (patch: AgentPermissionSettings) => Promise<AgentPermissionSettings>;
  writeProjectAgentPermissionSettings: (projectId: string, patch: AgentPermissionSettings) => Promise<AgentPermissionSettings>;
}

function validatePermissionRules(raw: unknown): AgentPermissionRules {
  if (raw === undefined) return {};
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("permissionRules must be an object.");
  const editable = new Set(["fileRead", "fileWrite", "webRead", "bash", "bridge"]);
  for (const key of Object.keys(raw)) {
    if (!editable.has(key)) throw new Error(`Unknown or locked permission domain: ${key}.`);
  }
  return normalizeAgentPermissionRules(raw);
}

export function normalizeAgentPermissionPatch(body: Record<string, unknown>): AgentPermissionSettings {
  const patch: AgentPermissionSettings = {};
  if ("mode" in body || "permissionMode" in body) patch.permissionMode = normalizeAgentPermissionMode(body.mode ?? body.permissionMode);
  if ("customRules" in body || "permissionRules" in body) patch.permissionRules = validatePermissionRules(body.customRules ?? body.permissionRules);
  return patch;
}

function permissionContractFromSettings(settings: AgentPermissionSettings): AgentPermissionContract {
  return buildAgentPermissionContract({
    mode: settings.permissionMode ?? "auto",
    customRules: settings.permissionRules,
  });
}

export async function handleAgentPermissionRoute(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  parts: string[],
  deps: AgentPermissionRouteDeps,
): Promise<boolean> {
  if (url.pathname === "/api/agent/permissions" && req.method === "GET") {
    deps.json(res, 200, await deps.readAgentPermissionContract(deps.optionalString(url.searchParams.get("projectId"))));
    return true;
  }
  if (url.pathname === "/api/agent/permissions" && req.method === "PUT") {
    const body = await deps.readBody(req) as Record<string, unknown>;
    deps.json(res, 200, permissionContractFromSettings(await deps.writeGlobalAgentPermissionSettings(normalizeAgentPermissionPatch(body))));
    return true;
  }
  if (url.pathname === "/api/agent/permissions/pending" && req.method === "GET") {
    deps.json(res, 200, { requests: deps.permissionDecisionRegistry.pending() });
    return true;
  }
  if (url.pathname === "/api/agent/permissions/decision" && req.method === "POST") {
    const body = await deps.readBody(req) as Record<string, unknown>;
    const requestId = deps.requireString(body.requestId, "requestId");
    const decision = body.decision === "approve" || body.decision === "deny" ? body.decision : undefined;
    if (!decision) throw new Error("decision must be approve or deny.");
    const result = deps.permissionDecisionRegistry.decide(requestId, { decision, reason: deps.optionalString(body.reason) });
    deps.json(res, result.ok ? 200 : 404, result.ok ? { ok: true, request: result.request } : { ok: false, error: "permission request not found" });
    return true;
  }
  if (parts[0] === "api" && parts[1] === "projects" && parts[2] && parts[3] === "agent" && parts[4] === "permissions" && req.method === "GET") {
    deps.json(res, 200, await deps.readAgentPermissionContract(decodeURIComponent(parts[2])));
    return true;
  }
  if (parts[0] === "api" && parts[1] === "projects" && parts[2] && parts[3] === "agent" && parts[4] === "permissions" && req.method === "PUT") {
    const body = await deps.readBody(req) as Record<string, unknown>;
    deps.json(res, 200, permissionContractFromSettings(await deps.writeProjectAgentPermissionSettings(decodeURIComponent(parts[2]), normalizeAgentPermissionPatch(body))));
    return true;
  }
  return false;
}
