import type { IncomingMessage, ServerResponse } from "node:http";
import {
  settingsPermissionApplicationPort,
  type AgentPermissionAction,
  type AgentPermissionContract,
  type AgentPermissionRequest,
  type AgentPermissionUserDecision,
  type AgentPermissionSettings,
} from "../application/settings_permission_application_port.js";
import type { PermissionDecisionRegistry, PermissionRequestFilter } from "../permission_decisions.js";
import { strictApiObject, strictApiOptional, strictApiString } from "../strict_api_contract.js";

export interface AgentPermissionRouteDeps {
  json: (res: ServerResponse, status: number, data: unknown) => void;
  readBody: (req: IncomingMessage) => Promise<unknown>;
  requireString: (value: unknown, label: string) => string;
  optionalString: (value: unknown) => string | undefined;
  permissionDecisionRegistry: PermissionDecisionRegistry;
  readAgentPermissionContract: (projectId?: string) => Promise<AgentPermissionContract>;
  writeGlobalAgentPermissionSettings: (patch: AgentPermissionSettings) => Promise<AgentPermissionSettings>;
  writeProjectAgentPermissionSettings: (projectId: string, patch: AgentPermissionSettings) => Promise<AgentPermissionSettings>;
  persistPermissionDecision?: (request: AgentPermissionRequest, action: AgentPermissionAction, reason?: string) => Promise<void>;
}

const permissionDecisionSchema = strictApiObject({
  requestId: strictApiString({ minLength: 1, maxLength: 512 }),
  action: strictApiOptional(strictApiString({ minLength: 1, maxLength: 32 })),
  decision: strictApiOptional(strictApiString({ minLength: 1, maxLength: 32 })),
  reason: strictApiOptional(strictApiString({ maxLength: 8_000 })),
}, { name: "agent permission decision" });

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
    deps.json(res, 200, settingsPermissionApplicationPort.buildPermissionContract(
      await deps.writeGlobalAgentPermissionSettings(settingsPermissionApplicationPort.normalizePermissionPatch(body)),
    ));
    return true;
  }
  if (url.pathname === "/api/agent/permissions/pending" && req.method === "GET") {
    const filter: PermissionRequestFilter = {};
    for (const key of ["taskId", "runId", "projectId", "sessionId"] as const) {
      const value = deps.optionalString(url.searchParams.get(key));
      if (value) filter[key] = value;
    }
    deps.json(res, 200, { requests: deps.permissionDecisionRegistry.pending(filter) });
    return true;
  }
  if (url.pathname === "/api/agent/permissions/decision" && req.method === "POST") {
    const body = permissionDecisionSchema.parse(await deps.readBody(req), "agent permission decision");
    const requestId = deps.requireString(body.requestId, "requestId");
    const action = ["allow_once", "allow_conversation", "always_allow", "deny"].includes(String(body.action))
      ? body.action as AgentPermissionAction
      : undefined;
    const legacyDecision = body.decision === "approve" || body.decision === "deny" ? body.decision : undefined;
    if (!action && !legacyDecision) throw new Error("action must be allow_once, allow_conversation, always_allow, or deny.");
    const reason = deps.optionalString(body.reason);
    const decision: AgentPermissionUserDecision = action
      ? { action, ...(reason ? { reason } : {}) }
      : { decision: legacyDecision!, ...(reason ? { reason } : {}) };
    const result = deps.permissionDecisionRegistry.decide(requestId, decision);
    const effectiveAction = action ?? (legacyDecision === "approve" ? "allow_once" : "deny");
    const resourceScopeRejected = Boolean(
      result.ok
      && result.request?.kind === "pi_resource_trust"
      && effectiveAction !== "allow_once"
      && effectiveAction !== "deny",
    );
    if (result.ok && result.request && !resourceScopeRejected && deps.persistPermissionDecision) {
      await deps.persistPermissionDecision(result.request, effectiveAction, reason);
    }
    deps.json(res, result.ok ? resourceScopeRejected ? 400 : 200 : 404, result.ok
      ? resourceScopeRejected
        ? { ok: false, error: "Pi resource trust requires Trust this summary or deny." }
        : { ok: true, request: result.request }
      : { ok: false, error: "permission request not found" });
    return true;
  }
  if (parts[0] === "api" && parts[1] === "projects" && parts[2] && parts[3] === "agent" && parts[4] === "permissions" && req.method === "GET") {
    deps.json(res, 200, await deps.readAgentPermissionContract(decodeURIComponent(parts[2])));
    return true;
  }
  if (parts[0] === "api" && parts[1] === "projects" && parts[2] && parts[3] === "agent" && parts[4] === "permissions" && req.method === "PUT") {
    const body = await deps.readBody(req) as Record<string, unknown>;
    deps.json(res, 200, settingsPermissionApplicationPort.buildPermissionContract(
      await deps.writeProjectAgentPermissionSettings(
        decodeURIComponent(parts[2]),
        settingsPermissionApplicationPort.normalizePermissionPatch(body),
      ),
    ));
    return true;
  }
  return false;
}
