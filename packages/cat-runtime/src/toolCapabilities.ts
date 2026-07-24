import { catToolMetadataFor } from "@linguist-agent/cat-tools";

export type ToolFilesystemOperation = "read" | "list" | "search" | "write";
export type ToolPermissionDomain = "fileRead" | "fileWrite" | "webRead" | "bash" | "bridge";

export type ToolCapability =
  | {
      kind: "filesystem";
      operations: ToolFilesystemOperation[];
      scope: "workspace-or-explicit-grant";
    }
  | { kind: "network"; scope: "public-web" | "approved-bridge" }
  | { kind: "process"; scope: "sandboxed-shell" }
  | { kind: "assistant-data"; operations: Array<"read" | "propose"> }
  | { kind: "document"; operations: Array<"read" | "extract" | "stage-artifact"> }
  | { kind: "delegation"; scope: "server-owned" }
  | { kind: "user-interaction"; scope: "canonical-decision" }
  | { kind: "tool-registry"; operations: ["search", "activate-declared"] }
  | { kind: "cat-project-read"; scope: "server-governed" }
  | { kind: "cat-project-write"; scope: "proposal-gate-commit" }
  | { kind: "task-plan"; scope: "canonical-task-artifact" }
  | { kind: "task-present"; scope: "canonical-task-artifact" };

export interface ToolCapabilityManifest {
  schemaVersion: 1;
  toolName: string;
  authority: "permission" | "cat-governance";
  permissionDomain?: ToolPermissionDomain;
  riskClass: "low" | "medium" | "high" | "non-picker";
  mutatesProject: boolean;
  capabilities: ToolCapability[];
}

function manifest(
  toolName: string,
  permissionDomain: ToolPermissionDomain,
  riskClass: "low" | "medium" | "high",
  capabilities: ToolCapability[],
): ToolCapabilityManifest {
  return {
    schemaVersion: 1,
    toolName,
    authority: "permission",
    permissionDomain,
    riskClass,
    mutatesProject: false,
    capabilities,
  };
}

const FILE_READ = (toolName: string, operation: "read" | "list" | "search" = "read") => manifest(
  toolName,
  "fileRead",
  "low",
  [{ kind: "filesystem", operations: [operation], scope: "workspace-or-explicit-grant" }],
);
const FILE_WRITE = (toolName: string) => manifest(
  toolName,
  "fileWrite",
  "medium",
  [{ kind: "filesystem", operations: ["write"], scope: "workspace-or-explicit-grant" }],
);
const WEB_READ = (toolName: string) => manifest(
  toolName,
  "webRead",
  "medium",
  [{ kind: "network", scope: "public-web" }],
);
const BRIDGE = (toolName: string) => manifest(
  toolName,
  "bridge",
  "high",
  [{ kind: "network", scope: "approved-bridge" }],
);

const REVIEWED_NON_CAT_TOOLS: ToolCapabilityManifest[] = [
  ...["read", "read_file", "read_many_files", "cat", "head", "tail", "stat", "wc"].map((name) => FILE_READ(name)),
  ...["ls", "tree"].map((name) => FILE_READ(name, "list")),
  ...["grep", "find"].map((name) => FILE_READ(name, "search")),
  ...["edit", "write", "multi_edit", "apply_patch", "create_file"].map((name) => FILE_WRITE(name)),
  ...["web_search", "web_extract", "fetch_content", "get_search_content", "code_search", "web_fetch"].map(WEB_READ),
  manifest("bash", "bash", "high", [{ kind: "process", scope: "sandboxed-shell" }]),
  ...["mcp_bridge", "browser", "browser_automation", "weather"].map(BRIDGE),
  {
    schemaVersion: 1,
    toolName: "ask_user",
    authority: "cat-governance",
    riskClass: "non-picker",
    mutatesProject: false,
    capabilities: [{ kind: "user-interaction", scope: "canonical-decision" }],
  },
  ...["prepare_team_execution", "delegate_agent", "subagent", "wait"].map((toolName): ToolCapabilityManifest => ({
    schemaVersion: 1,
    toolName,
    authority: "cat-governance",
    riskClass: "non-picker",
    mutatesProject: false,
    capabilities: [{ kind: "delegation", scope: "server-owned" }],
  })),
  {
    schemaVersion: 1,
    toolName: "capability_search",
    authority: "cat-governance",
    riskClass: "non-picker",
    mutatesProject: false,
    capabilities: [{ kind: "tool-registry", operations: ["search", "activate-declared"] }],
  },
  {
    schemaVersion: 1,
    toolName: "assistant_memory_search",
    authority: "cat-governance",
    riskClass: "non-picker",
    mutatesProject: false,
    capabilities: [{ kind: "assistant-data", operations: ["read"] }],
  },
  {
    schemaVersion: 1,
    toolName: "assistant_memory_propose",
    authority: "cat-governance",
    riskClass: "non-picker",
    mutatesProject: false,
    capabilities: [{ kind: "assistant-data", operations: ["propose"] }],
  },
  ...["assistant_library_search", "assistant_library_list"].map((toolName): ToolCapabilityManifest => ({
    schemaVersion: 1,
    toolName,
    authority: "cat-governance",
    riskClass: "non-picker",
    mutatesProject: false,
    capabilities: [{ kind: "assistant-data", operations: ["read"] }],
  })),
  ...["document_parse", "document_search", "document_screenshot"].map((toolName): ToolCapabilityManifest => ({
    schemaVersion: 1,
    toolName,
    authority: "permission",
    permissionDomain: "fileRead",
    riskClass: "low",
    mutatesProject: false,
    capabilities: [
      {
        kind: "filesystem",
        operations: [toolName === "document_search" ? "search" : "read"],
        scope: "workspace-or-explicit-grant",
      },
      { kind: "document", operations: ["read", "extract", "stage-artifact"] },
    ],
  })),
  ...["document_extract_evidence", "document_extract_layout"].map((toolName): ToolCapabilityManifest => ({
    schemaVersion: 1,
    toolName,
    authority: "permission",
    permissionDomain: "fileRead",
    riskClass: "low",
    mutatesProject: false,
    capabilities: [{ kind: "document", operations: ["read", "extract", "stage-artifact"] }],
  })),
  {
    schemaVersion: 1,
    toolName: "office_document_operate",
    authority: "permission",
    permissionDomain: "fileWrite",
    riskClass: "medium",
    mutatesProject: false,
    capabilities: [{ kind: "document", operations: ["read", "extract", "stage-artifact"] }],
  },
  {
    schemaVersion: 1,
    toolName: "agent_plan_update",
    authority: "cat-governance",
    riskClass: "non-picker",
    mutatesProject: false,
    capabilities: [{ kind: "task-plan", scope: "canonical-task-artifact" }],
  },
  {
    schemaVersion: 1,
    toolName: "agent_present",
    authority: "cat-governance",
    riskClass: "non-picker",
    mutatesProject: false,
    capabilities: [{ kind: "task-present", scope: "canonical-task-artifact" }],
  },
];

const REVIEWED_BY_NAME = new Map(REVIEWED_NON_CAT_TOOLS.map((entry) => [entry.toolName, entry]));

function catManifest(toolName: string): ToolCapabilityManifest | undefined {
  const metadata = catToolMetadataFor(toolName);
  if (!metadata) return undefined;
  if (metadata.category === "bridge") return REVIEWED_BY_NAME.get(toolName);
  return {
    schemaVersion: 1,
    toolName,
    authority: "cat-governance",
    riskClass: "non-picker",
    mutatesProject: metadata.mutatesProject,
    capabilities: metadata.access === "read"
      ? [{ kind: "cat-project-read", scope: "server-governed" }]
      : [{ kind: "cat-project-write", scope: "proposal-gate-commit" }],
  };
}

/** Exact-name lookup only. Aliases and case variants require their own reviewed entry. */
export function resolveToolCapabilityManifest(toolName: string): ToolCapabilityManifest | undefined {
  return REVIEWED_BY_NAME.get(toolName) ?? catManifest(toolName);
}

export function assertProductionToolCapabilities(toolNames: readonly string[]): ToolCapabilityManifest[] {
  const uniqueNames = [...new Set(toolNames)];
  const missing = uniqueNames.filter((name) => !resolveToolCapabilityManifest(name)).sort();
  if (missing.length) {
    throw new Error(`TOOL_CAPABILITY_UNDECLARED: production tool registration denied for ${missing.join(", ")}.`);
  }
  return uniqueNames.map((name) => resolveToolCapabilityManifest(name)!);
}
