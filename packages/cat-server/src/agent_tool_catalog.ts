import type { CatToolMetadata } from "@linguist-agent/cat-tools";
import {
  assertProductionToolCapabilities,
  resolveToolCapabilityManifest,
  type ToolCapability,
  type ToolPermissionDomain,
} from "@linguist-agent/cat-runtime";

export type AgentToolSource = "pi-inherited" | "pi-package" | "cat-native" | "builtin";

export interface AgentToolMetadata extends CatToolMetadata {
  source: AgentToolSource;
  capabilitySchemaVersion: 1;
  capabilityAuthority: "permission" | "cat-governance";
  permissionDomain?: ToolPermissionDomain;
  capabilities: ToolCapability[];
}

const ALL_MODES: CatToolMetadata["allowedModes"] = ["onboarding", "asset_intake", "translate", "edit", "proof", "delivery", "maintenance"];

export interface ResolvedAgentToolDefinition {
  name: string;
  description: string;
  sourceInfo?: {
    source?: string;
  };
}

export interface BuildAgentToolMetadataCatalogOptions {
  catTools: readonly CatToolMetadata[];
  /** Sorted, canonical names captured from the real Pi Main Run request shape. */
  activeToolNames: readonly string[];
  /** Tool definitions exposed by that same Pi Session before it is disposed. */
  tools: readonly ResolvedAgentToolDefinition[];
}

export interface LeasedAgentToolCatalog {
  list(): Promise<AgentToolMetadata[]>;
  invalidate(): void;
}

/**
 * Loading this catalog executes the same managed Extension modules as a Main
 * Run. Keep the load inside the shared resource lease and make invalidation
 * explicit so Settings cannot become a second, stale capability truth.
 */
export function createLeasedAgentToolCatalog(input: {
  acquireResourceRead: () => () => void;
  load: () => Promise<AgentToolMetadata[]>;
}): LeasedAgentToolCatalog {
  let pending: Promise<AgentToolMetadata[]> | undefined;
  const load = async (): Promise<AgentToolMetadata[]> => {
    const release = input.acquireResourceRead();
    try {
      return await input.load();
    } finally {
      release();
    }
  };
  return {
    async list() {
      pending ??= load();
      try {
        return await pending;
      } catch (error) {
        pending = undefined;
        throw error;
      }
    },
    invalidate() {
      pending = undefined;
    },
  };
}

function nonCatToolMetadata(tool: ResolvedAgentToolDefinition): AgentToolMetadata {
  const builtin = tool.sourceInfo?.source === "builtin";
  const manifest = resolveToolCapabilityManifest(tool.name);
  if (!manifest) throw new Error(`TOOL_CAPABILITY_UNDECLARED: production tool registration denied for ${tool.name}.`);
  return {
    name: tool.name,
    category: builtin ? "builtin" : "package",
    access: "read",
    allowedModes: ALL_MODES,
    executionMode: "parallel",
    mutatesProject: false,
    writesSegments: false,
    description: tool.description,
    source: builtin ? "builtin" : "pi-package",
    capabilitySchemaVersion: manifest.schemaVersion,
    capabilityAuthority: manifest.authority,
    permissionDomain: manifest.permissionDomain,
    capabilities: manifest.capabilities,
  };
}

function catToolWithCapabilities(tool: CatToolMetadata, description: string): AgentToolMetadata {
  const manifest = resolveToolCapabilityManifest(tool.name);
  if (!manifest) throw new Error(`TOOL_CAPABILITY_UNDECLARED: production tool registration denied for ${tool.name}.`);
  return {
    ...tool,
    description,
    source: "cat-native",
    capabilitySchemaVersion: manifest.schemaVersion,
    capabilityAuthority: manifest.authority,
    permissionDomain: manifest.permissionDomain,
    capabilities: manifest.capabilities,
  };
}

/**
 * Projects the Settings catalog from the same active-tool names and definitions
 * that Pi placed in the resolved Main Run. Inactive built-ins and unselected
 * global Extensions are intentionally absent.
 */
export function buildAgentToolMetadataCatalog(options: BuildAgentToolMetadataCatalogOptions): AgentToolMetadata[] {
  assertProductionToolCapabilities(options.activeToolNames);
  const catTools = new Map(options.catTools.map((tool) => [tool.name, tool]));
  const definitions = new Map(options.tools.map((tool) => [tool.name, tool]));
  const seen = new Set<string>();
  const result: AgentToolMetadata[] = [];

  for (const name of options.activeToolNames) {
    if (seen.has(name)) continue;
    seen.add(name);
    const definition = definitions.get(name);
    if (!definition) {
      throw new Error(`Active Main Run tool has no Pi definition: ${name}`);
    }
    const catTool = catTools.get(name);
    result.push(catTool
      ? catToolWithCapabilities(catTool, definition.description || catTool.description)
      : nonCatToolMetadata(definition));
  }

  return result;
}
