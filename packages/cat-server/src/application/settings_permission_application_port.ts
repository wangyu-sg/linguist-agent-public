import {
  buildAgentPermissionContract,
  normalizeAgentPermissionMode,
  normalizeAgentPermissionRules,
  type AgentPermissionAction,
  type AgentPermissionContract,
  type AgentPermissionMode,
  type AgentPermissionRequest,
  type AgentPermissionRules,
  type AgentPermissionUserDecision,
} from "@linguist-agent/cat-runtime";
import { strictApiJsonObject, strictApiObject, strictApiOptional, strictApiString } from "../strict_api_contract.js";

export type {
  AgentPermissionAction,
  AgentPermissionContract,
  AgentPermissionMode,
  AgentPermissionRequest,
  AgentPermissionRules,
  AgentPermissionUserDecision,
};

export interface AgentPermissionSettings {
  permissionMode?: AgentPermissionMode;
  permissionRules?: AgentPermissionRules;
}

const permissionPatchSchema = strictApiObject({
  mode: strictApiOptional(strictApiString({ minLength: 1, maxLength: 32 })),
  permissionMode: strictApiOptional(strictApiString({ minLength: 1, maxLength: 32 })),
  customRules: strictApiOptional(strictApiJsonObject()),
  permissionRules: strictApiOptional(strictApiJsonObject()),
}, { name: "agent permission patch" });

function validatePermissionRules(raw: unknown): AgentPermissionRules {
  if (raw === undefined) return {};
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("permissionRules must be an object.");
  const editable = new Set(["fileRead", "fileWrite", "webRead", "bash", "bridge"]);
  for (const key of Object.keys(raw)) {
    if (!editable.has(key)) throw new Error(`Unknown or locked permission domain: ${key}.`);
  }
  return normalizeAgentPermissionRules(raw);
}

export const settingsPermissionApplicationPort = {
  normalizePermissionPatch(body: Record<string, unknown>): AgentPermissionSettings {
    body = permissionPatchSchema.parse(body, "agent permission patch");
    const patch: AgentPermissionSettings = {};
    if ("mode" in body || "permissionMode" in body) patch.permissionMode = normalizeAgentPermissionMode(body.mode ?? body.permissionMode);
    if ("customRules" in body || "permissionRules" in body) patch.permissionRules = validatePermissionRules(body.customRules ?? body.permissionRules);
    return patch;
  },

  buildPermissionContract(settings: AgentPermissionSettings): AgentPermissionContract {
    return buildAgentPermissionContract({
      mode: settings.permissionMode ?? "auto",
      customRules: settings.permissionRules,
    });
  },
};
