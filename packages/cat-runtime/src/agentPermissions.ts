import type { ToolCallEventResult } from "@earendil-works/pi-coding-agent";
import { catToolMetadataFor } from "@linguist-agent/cat-tools";

export type AgentPermissionMode = "ask" | "auto" | "full" | "custom";
export type AgentPermissionDecision = "auto" | "ask" | "deny";
export type AgentPermissionRiskClass = "low" | "medium" | "high" | "protected" | "non_picker";
export type AgentPermissionDomain =
  | "fileRead"
  | "fileWrite"
  | "webRead"
  | "bash"
  | "bridge"
  | "catProposalFirst"
  | "lockedSegments"
  | "keychainSecrets"
  | "appServerParent"
  | "sandboxBase";

export type EditableAgentPermissionDomain = Exclude<
  AgentPermissionDomain,
  "catProposalFirst" | "lockedSegments" | "keychainSecrets" | "appServerParent" | "sandboxBase"
>;

export type AgentPermissionRules = Partial<Record<EditableAgentPermissionDomain, AgentPermissionDecision>>;
export type PermissionUserDecision = "approve" | "deny";

export interface AgentPermissionPreset {
  id: AgentPermissionMode;
  label: string;
  description: string;
  rules: AgentPermissionRules;
}

export interface AgentPermissionDomainInfo {
  id: EditableAgentPermissionDomain;
  label: string;
  description: string;
  riskClass: AgentPermissionRiskClass;
  tools: string[];
}

export interface AgentPermissionPolicyEntry {
  domain: AgentPermissionDomain;
  decision: AgentPermissionDecision;
  riskClass: AgentPermissionRiskClass;
  serverEnforced: boolean;
  source: "preset" | "custom" | "hard-rail" | "cat-governance";
  locked?: boolean;
  label?: string;
  description?: string;
}

export interface AgentPermissionContract {
  mode: AgentPermissionMode;
  presets: AgentPermissionPreset[];
  customRules: AgentPermissionRules;
  domains: AgentPermissionDomainInfo[];
  effectivePolicy: AgentPermissionPolicyEntry[];
  hardRails: AgentPermissionPolicyEntry[];
}

export interface AgentPermissionRequest {
  requestId?: string;
  toolName: string;
  domain: EditableAgentPermissionDomain;
  riskClass: AgentPermissionRiskClass;
  argsSummary: string;
  sessionId?: string;
  projectId?: string;
}

export interface AgentPermissionUserDecision {
  decision: PermissionUserDecision;
  reason?: string;
}

export interface AgentToolPermissionDomainResolution {
  controlledBy: "permission" | "cat-governance";
  domain: EditableAgentPermissionDomain | "catProposalFirst";
  riskClass: AgentPermissionRiskClass;
  reason?: string;
}

const REDACTED_PREVIEW_VALUE = "[REDACTED]";
const CIRCULAR_PREVIEW_VALUE = "[Circular]";
const PREVIEW_LIMIT_VALUE = "[Preview limit]";

function sensitivePreviewKey(key: string): boolean {
  const normalized = key.toLowerCase().replace(/[^a-z0-9]/g, "");
  return normalized === "pwd"
    || normalized.endsWith("password")
    || normalized.endsWith("passwd")
    || normalized.endsWith("passphrase")
    || normalized === "token"
    || normalized.endsWith("token")
    || normalized === "tokenvalue"
    || normalized.endsWith("apikey")
    || normalized.includes("authorization")
    || normalized.includes("cookie")
    || normalized.includes("secret")
    || normalized.includes("credential")
    || normalized.endsWith("privatekey");
}

interface PreviewSanitizeState {
  maxJsonChars: number;
  remainingNodes: number;
  seen: WeakSet<object>;
}

function sanitizePreviewValue(value: unknown, state: PreviewSanitizeState, depth = 0): unknown {
  if (state.remainingNodes-- <= 0 || depth > 16) return PREVIEW_LIMIT_VALUE;
  if (typeof value === "string") {
    const trimmed = value.trim();
    if ((trimmed.startsWith("{") || trimmed.startsWith("[")) && trimmed.length > state.maxJsonChars) {
      return PREVIEW_LIMIT_VALUE;
    }
    if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
      try {
        return sanitizePreviewValue(JSON.parse(trimmed), state, depth + 1);
      } catch {
        return value;
      }
    }
    return value;
  }
  if (typeof value === "bigint") return value.toString();
  if (!value || typeof value !== "object") return value;
  if (state.seen.has(value)) return CIRCULAR_PREVIEW_VALUE;
  state.seen.add(value);
  try {
    if (Array.isArray(value)) {
      const result = value.slice(0, 200).map((entry) => sanitizePreviewValue(entry, state, depth + 1));
      if (value.length > 200) result.push(PREVIEW_LIMIT_VALUE);
      return result;
    }
    const result: Record<string, unknown> = Object.create(null);
    const keys = Object.keys(value).slice(0, 200);
    for (const key of keys) {
      if (sensitivePreviewKey(key)) {
        result[key] = REDACTED_PREVIEW_VALUE;
        continue;
      }
      try {
        result[key] = sanitizePreviewValue((value as Record<string, unknown>)[key], state, depth + 1);
      } catch {
        result[key] = "[Unavailable]";
      }
    }
    if (Object.keys(value).length > keys.length) result[PREVIEW_LIMIT_VALUE] = PREVIEW_LIMIT_VALUE;
    return result;
  } finally {
    state.seen.delete(value);
  }
}

/** A bounded, recursively redacted representation safe for logs, events, and permission UI. */
export function sensitivePreview(value: unknown, maxChars = 800): string {
  const limit = Math.max(0, Math.floor(maxChars));
  const sanitized = sanitizePreviewValue(value, {
    maxJsonChars: Math.max(16_384, limit * 16),
    remainingNodes: 2_000,
    seen: new WeakSet(),
  });
  let text: string;
  if (typeof sanitized === "string") {
    text = sanitized;
  } else {
    try {
      text = JSON.stringify(sanitized) ?? String(sanitized);
    } catch {
      text = String(sanitized);
    }
  }
  if (text.length <= limit) return text;
  const marker = "... [truncated]";
  if (limit <= marker.length) return marker.slice(0, limit);
  return `${text.slice(0, limit - marker.length)}${marker}`;
}

const EDITABLE_DOMAINS: AgentPermissionDomainInfo[] = [
  {
    id: "fileRead",
    label: "读文件 / 搜本地",
    description: "Read, list, grep, and inspect local files. Output remains advisory until CAT evidence records it.",
    riskClass: "low",
    tools: [
      "read", "read_file", "read_many_files", "grep", "find", "ls", "cat", "head", "tail", "tree", "stat", "wc",
      "document_parse", "document_search", "document_screenshot",
    ],
  },
  {
    id: "fileWrite",
    label: "写普通文件",
    description: "Generic file edits outside LA CAT data gates. Direct data/** writes still stay blocked by the harness.",
    riskClass: "medium",
    tools: ["edit", "write", "multi_edit", "apply_patch", "create_file"],
  },
  {
    id: "webRead",
    label: "联网读取",
    description: "Public web search/fetch style tools. Results are advisory until cited through CAT evidence/proposal paths.",
    riskClass: "medium",
    tools: ["web_search", "web_extract", "fetch_content", "get_search_content", "code_search", "web_fetch"],
  },
  {
    id: "bash",
    label: "bash / 命令",
    description: "Shell execution. CAT sessions still use the sandbox floor for data writes, credential reads, and egress.",
    riskClass: "high",
    tools: ["bash"],
  },
  {
    id: "bridge",
    label: "Bridge / MCP / browser",
    description: "External bridge tools including MCP and browser-style surfaces. Standing forbidden bridges stay blocked.",
    riskClass: "high",
    tools: ["mcp__", "mcp_bridge", "browser", "browser_automation", "weather"],
  },
];

const DOMAIN_BY_ID = new Map(EDITABLE_DOMAINS.map((domain) => [domain.id, domain]));

const REQUEST_APPROVAL_RULES: AgentPermissionRules = {
  fileRead: "auto",
  fileWrite: "ask",
  webRead: "ask",
  bash: "ask",
  bridge: "ask",
};

const AUTO_APPROVAL_RULES: AgentPermissionRules = {
  fileRead: "auto",
  fileWrite: "auto",
  webRead: "auto",
  bash: "ask",
  bridge: "ask",
};

const FULL_ACCESS_RULES: AgentPermissionRules = {
  fileRead: "auto",
  fileWrite: "auto",
  webRead: "auto",
  bash: "auto",
  bridge: "auto",
};

export const AGENT_PERMISSION_PRESETS: AgentPermissionPreset[] = [
  {
    id: "ask",
    label: "请求批准",
    description: "读/搜自动；写入、联网、命令和 bridge 先询问。",
    rules: REQUEST_APPROVAL_RULES,
  },
  {
    id: "auto",
    label: "替我批准",
    description: "常规文件/联网自动；bash 和 bridge 先询问。",
    rules: AUTO_APPROVAL_RULES,
  },
  {
    id: "full",
    label: "完全访问",
    description: "通用工具尽量自动；CAT 改稿、apply、export 仍走 proposal-first。",
    rules: FULL_ACCESS_RULES,
  },
  {
    id: "custom",
    label: "自定义规则",
    description: "使用 Settings 里逐项开关；CAT 门和硬边界不可调。",
    rules: AUTO_APPROVAL_RULES,
  },
];

const PRESETS_BY_ID = new Map(AGENT_PERMISSION_PRESETS.map((preset) => [preset.id, preset]));

function presetRules(mode: AgentPermissionMode): AgentPermissionRules {
  if (mode === "custom") return AUTO_APPROVAL_RULES;
  return PRESETS_BY_ID.get(mode)?.rules ?? AUTO_APPROVAL_RULES;
}

function normalizeDecision(value: unknown): AgentPermissionDecision | undefined {
  return value === "auto" || value === "ask" || value === "deny" ? value : undefined;
}

export function normalizeAgentPermissionMode(value: unknown): AgentPermissionMode {
  return value === "ask" || value === "auto" || value === "full" || value === "custom" ? value : "auto";
}

export function normalizeAgentPermissionRules(value: unknown): AgentPermissionRules {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const rules: AgentPermissionRules = {};
  for (const domain of EDITABLE_DOMAINS) {
    const decision = normalizeDecision((value as Record<string, unknown>)[domain.id]);
    if (decision) rules[domain.id] = decision;
  }
  return rules;
}

export function buildAgentPermissionContract(input: {
  mode?: AgentPermissionMode;
  customRules?: AgentPermissionRules;
} = {}): AgentPermissionContract {
  const mode = input.mode ?? "auto";
  const base = presetRules(mode);
  const customRules = normalizeAgentPermissionRules(input.customRules ?? {});
  const effectiveRules: AgentPermissionRules = mode === "custom" ? { ...AUTO_APPROVAL_RULES, ...customRules } : base;
  const source = mode === "custom" ? "custom" : "preset";
  const effectivePolicy: AgentPermissionPolicyEntry[] = EDITABLE_DOMAINS.map((domain) => ({
    domain: domain.id,
    decision: effectiveRules[domain.id] ?? "ask",
    riskClass: domain.riskClass,
    serverEnforced: true,
    source,
    locked: false,
    label: domain.label,
    description: domain.description,
  }));
  const hardRails: AgentPermissionPolicyEntry[] = [
    {
      domain: "catProposalFirst",
      decision: "ask",
      riskClass: "non_picker",
      serverEnforced: false,
      source: "cat-governance",
      locked: true,
      label: "始终 proposal-first（不可调）",
      description: "CAT segment writes, proposal apply, delivery export, and Platform Backfill outward writes stay in CAT governance, not the autonomy picker.",
    },
    {
      domain: "lockedSegments",
      decision: "deny",
      riskClass: "protected",
      serverEnforced: true,
      source: "hard-rail",
      locked: true,
      label: "始终保护",
      description: "Locked client segments remain immutable.",
    },
    {
      domain: "keychainSecrets",
      decision: "deny",
      riskClass: "protected",
      serverEnforced: true,
      source: "hard-rail",
      locked: true,
      label: "始终保护",
      description: "Provider secrets stay in macOS Keychain and must not be written to repo files, plists, logs, or shell startup files.",
    },
    {
      domain: "appServerParent",
      decision: "deny",
      riskClass: "protected",
      serverEnforced: true,
      source: "hard-rail",
      locked: true,
      label: "始终保护",
      description: "The macOS app may run a one-shot installer, but must never own the long-lived Node server process.",
    },
    {
      domain: "sandboxBase",
      decision: "deny",
      riskClass: "protected",
      serverEnforced: true,
      source: "hard-rail",
      locked: true,
      label: "始终保护",
      description: "Base sandbox rails remain on: credential deny-read, data deny-write, env scrub, and exact-host egress validation.",
    },
  ];
  return {
    mode,
    presets: AGENT_PERMISSION_PRESETS,
    customRules,
    domains: EDITABLE_DOMAINS,
    effectivePolicy: [...effectivePolicy, ...hardRails],
    hardRails,
  };
}

function lowerToolName(toolName: string): string {
  return toolName.trim().toLowerCase();
}

function toolInDomain(toolName: string, domain: AgentPermissionDomainInfo): boolean {
  const lower = lowerToolName(toolName);
  return domain.tools.some((tool) => (tool.endsWith("__") ? lower.startsWith(tool) : lower === tool));
}

export function resolveAgentToolPermissionDomain(toolName: string): AgentToolPermissionDomainResolution {
  const normalizedToolName = lowerToolName(toolName);
  if (normalizedToolName === "ask_user" || normalizedToolName === "prepare_team_execution") {
    return {
      controlledBy: "cat-governance",
      domain: "catProposalFirst",
      riskClass: "non_picker",
      reason: normalizedToolName === "ask_user"
        ? "ask_user is the canonical Task Decision interaction and must not create a second permission request."
        : "prepare_team_execution only creates a server-owned canonical Team proposal; its required Task Decision is the approval boundary.",
    };
  }
  const metadata = catToolMetadataFor(toolName);
  if (metadata && metadata.category !== "bridge") {
    return {
      controlledBy: "cat-governance",
      domain: "catProposalFirst",
      riskClass: "non_picker",
      reason: "CAT-native tools remain governed by proposal/evidence/write/delivery policy, not the autonomy picker.",
    };
  }
  for (const domain of EDITABLE_DOMAINS) {
    if (toolInDomain(toolName, domain)) {
      return {
        controlledBy: "permission",
        domain: domain.id,
        riskClass: domain.riskClass,
      };
    }
  }
  return {
    controlledBy: "permission",
    domain: "bridge",
    riskClass: "high",
    reason: "Unknown inherited or external tool is treated as high-impact bridge autonomy.",
  };
}

function argsSummary(input: unknown): string {
  return sensitivePreview(input, 320);
}

function policyEntryFor(contract: AgentPermissionContract, domain: EditableAgentPermissionDomain): AgentPermissionPolicyEntry {
  const domainInfo = DOMAIN_BY_ID.get(domain);
  return contract.effectivePolicy.find((entry) => entry.domain === domain) ?? {
    domain,
    decision: "ask",
    riskClass: domainInfo?.riskClass ?? "high",
    serverEnforced: true,
    source: "preset",
    locked: false,
    label: domainInfo?.label,
  };
}

export async function evaluateAgentToolPermissionCall(input: {
  toolName: string;
  input: unknown;
  contract: AgentPermissionContract;
  projectId?: string;
  sessionId?: string;
  requestDecision?: (request: AgentPermissionRequest) => Promise<AgentPermissionUserDecision>;
}): Promise<ToolCallEventResult | undefined> {
  const resolved = resolveAgentToolPermissionDomain(input.toolName);
  if (resolved.controlledBy === "cat-governance") return undefined;
  const domain = resolved.domain as EditableAgentPermissionDomain;
  const entry = policyEntryFor(input.contract, domain);
  if (entry.decision === "auto") return undefined;
  if (entry.decision === "deny") {
    return {
      block: true,
      reason: `Agent permission policy denied ${domain} for tool ${input.toolName}.`,
    };
  }
  if (!input.requestDecision) {
    return {
      block: true,
      reason: `Agent permission policy requires approval for ${domain} tool ${input.toolName}, but no permission decision channel is available.`,
    };
  }
  const decision = await input.requestDecision({
    toolName: input.toolName,
    domain,
    riskClass: resolved.riskClass,
    argsSummary: argsSummary(input.input),
    projectId: input.projectId,
    sessionId: input.sessionId,
  });
  if (decision.decision === "approve") return undefined;
  return {
    block: true,
    reason: decision.reason || `User denied ${domain} tool ${input.toolName}.`,
  };
}
