export type McpServerTransport = "stdio" | "streamable_http";
export type McpMutationRisk = "read_only" | "external_mutation_possible" | "cat_path_forbidden";
export type McpEvidenceBehavior = "advisory_until_cited" | "reference_only" | "non_cat";
export type McpAllowlistState = "discovered" | "allowlisted" | "blocked";

export interface McpServerConfig {
  id: string;
  label?: string;
  transport: McpServerTransport;
  enabled?: boolean;
  command?: string;
  args?: string[];
  cwd?: string;
  env?: Record<string, string>;
  url?: string;
  tools?: Record<string, Partial<Pick<McpToolPolicy, "accessClass" | "mutationRisk" | "evidenceBehavior" | "allowlistState" | "credentialProviderId">>>;
}

export interface McpToolDescriptor {
  serverId: string;
  serverLabel?: string;
  rawToolName: string;
  title?: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
  annotations?: {
    title?: string;
    readOnlyHint?: boolean;
    destructiveHint?: boolean;
    idempotentHint?: boolean;
    openWorldHint?: boolean;
  };
}

export interface McpToolPolicy {
  serverId: string;
  serverTransport: McpServerTransport;
  rawToolName: string;
  bridgeToolName: string;
  title: string;
  description: string;
  inputSchemaRef: string;
  accessClass: string;
  mutationRisk: McpMutationRisk;
  evidenceBehavior: McpEvidenceBehavior;
  readOnlyHint?: boolean;
  destructiveHint?: boolean;
  allowlistState: McpAllowlistState;
  credentialProviderId?: string;
  configWhenRegistered: "credential" | "none";
  auditTrail: string;
  traceVisible: true;
  catWriteEligible: false;
  testIds: string[];
}

export interface McpBridgeCatalog {
  servers: Array<{
    id: string;
    label: string;
    transport: McpServerTransport;
    enabled: boolean;
    discoveredTools: number;
    configuredTools: number;
  }>;
  tools: McpToolPolicy[];
}

export function sanitizeMcpName(value: string): string {
  const normalized = value.trim().toLowerCase().replace(/[^a-z0-9_]+/g, "_").replace(/^_+|_+$/g, "");
  return normalized || "unnamed";
}

export function bridgeToolName(serverId: string, rawToolName: string): string {
  return `mcp__${sanitizeMcpName(serverId)}__${sanitizeMcpName(rawToolName)}`.slice(0, 128);
}

function policyOverride(config: McpServerConfig, rawToolName: string) {
  return config.tools?.[rawToolName] ?? config.tools?.[sanitizeMcpName(rawToolName)] ?? {};
}

export function createMcpToolPolicy(config: McpServerConfig, descriptor: McpToolDescriptor): McpToolPolicy {
  const override = policyOverride(config, descriptor.rawToolName);
  const rawToolName = descriptor.rawToolName;
  const serverLabel = descriptor.serverLabel ?? config.label ?? config.id;
  const mutationRisk = override.mutationRisk ?? "read_only";
  return {
    serverId: config.id,
    serverTransport: config.transport,
    rawToolName,
    bridgeToolName: bridgeToolName(config.id, rawToolName),
    title: descriptor.title ?? descriptor.annotations?.title ?? rawToolName,
    description: descriptor.description ?? `MCP tool ${rawToolName} from ${serverLabel}.`,
    inputSchemaRef: `mcp://${config.id}/tools/${rawToolName}/input-schema`,
    accessClass: override.accessClass ?? "per_tool_declared",
    mutationRisk,
    evidenceBehavior: override.evidenceBehavior ?? "reference_only",
    readOnlyHint: descriptor.annotations?.readOnlyHint,
    destructiveHint: descriptor.annotations?.destructiveHint,
    allowlistState: override.allowlistState ?? "discovered",
    credentialProviderId: override.credentialProviderId,
    configWhenRegistered: override.credentialProviderId ? "credential" : "none",
    auditTrail: "MCP tools/call trace plus LA bridge metadata; annotations are hints, not enforcement.",
    traceVisible: true,
    catWriteEligible: false,
    testIds: [
      `mcp:${config.id}:${rawToolName}:trace-visible`,
      `mcp:${config.id}:${rawToolName}:cat-write-forbidden`,
      `mcp:${config.id}:${rawToolName}:${mutationRisk}`,
    ],
  };
}

export function buildMcpBridgeCatalog(configs: McpServerConfig[], descriptors: McpToolDescriptor[]): McpBridgeCatalog {
  const byServer = new Map<string, McpToolDescriptor[]>();
  for (const descriptor of descriptors) {
    const rows = byServer.get(descriptor.serverId) ?? [];
    rows.push(descriptor);
    byServer.set(descriptor.serverId, rows);
  }
  const tools = descriptors
    .map((descriptor) => {
      const config = configs.find((item) => item.id === descriptor.serverId);
      if (!config) return undefined;
      return createMcpToolPolicy(config, descriptor);
    })
    .filter((policy): policy is McpToolPolicy => Boolean(policy));
  return {
    servers: configs.map((config) => {
      const serverTools = byServer.get(config.id) ?? [];
      return {
        id: config.id,
        label: config.label ?? config.id,
        transport: config.transport,
        enabled: config.enabled !== false,
        discoveredTools: serverTools.length,
        configuredTools: Object.keys(config.tools ?? {}).length,
      };
    }),
    tools,
  };
}

export function assertMcpToolPolicySafe(policy: McpToolPolicy): void {
  if (!policy.traceVisible) throw new Error(`MCP tool ${policy.bridgeToolName} must be trace-visible`);
  if (policy.catWriteEligible) throw new Error(`MCP tool ${policy.bridgeToolName} cannot be CAT-write eligible in v2.16`);
  if (policy.allowlistState === "allowlisted" && policy.mutationRisk !== "read_only") {
    throw new Error(`MCP tool ${policy.bridgeToolName} is allowlisted but not read-only`);
  }
}
