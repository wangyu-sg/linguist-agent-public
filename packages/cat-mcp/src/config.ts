import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { McpServerConfig, McpServerTransport } from "./policy.js";

export interface McpConfigFile {
  servers?: McpServerConfig[];
}

export const MCP_CONFIG_RELATIVE_PATH = ".pi/mcp-servers.json";

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function parseMcpConfig(raw: unknown): McpServerConfig[] {
  if (!isObject(raw)) return [];
  const servers = Array.isArray(raw.servers) ? raw.servers : [];
  return servers
    .filter(isObject)
    .map((server) => {
      const transport: McpServerTransport = server.transport === "streamable_http" ? "streamable_http" : "stdio";
      return {
        id: String(server.id ?? "").trim(),
        label: typeof server.label === "string" ? server.label : undefined,
        transport,
        enabled: server.enabled !== false,
        command: typeof server.command === "string" ? server.command : undefined,
        args: Array.isArray(server.args) ? server.args.map(String) : undefined,
        cwd: typeof server.cwd === "string" ? server.cwd : undefined,
        env: isObject(server.env) ? Object.fromEntries(Object.entries(server.env).map(([key, value]) => [key, String(value)])) : undefined,
        url: typeof server.url === "string" ? server.url : undefined,
        tools: isObject(server.tools) ? server.tools as McpServerConfig["tools"] : undefined,
      } satisfies McpServerConfig;
    })
    .filter((server) => Boolean(server.id));
}

export async function readMcpServerConfigs(repoRoot: string): Promise<McpServerConfig[]> {
  try {
    const raw = await readFile(join(repoRoot, MCP_CONFIG_RELATIVE_PATH), "utf8");
    return parseMcpConfig(JSON.parse(raw));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}
