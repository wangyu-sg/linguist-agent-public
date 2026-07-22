import { readFileSync } from "node:fs";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import type { McpServerConfig, McpToolDescriptor } from "./policy.js";

export interface McpToolCallResult {
  contentText: string;
  raw: unknown;
}

function ensureStdioConfig(config: McpServerConfig): asserts config is McpServerConfig & { command: string } {
  if (config.transport !== "stdio") throw new Error(`MCP transport ${config.transport} is not supported by this client path yet`);
  if (!config.command) throw new Error(`MCP stdio server ${config.id} is missing command`);
}

let packageVersion: string | undefined;

function readMcpPackageVersion(): string {
  if (packageVersion) return packageVersion;
  try {
    const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as { version?: string };
    packageVersion = pkg.version ?? "0.0.0";
  } catch {
    packageVersion = "0.0.0";
  }
  return packageVersion;
}

async function withMcpClient<T>(config: McpServerConfig, fn: (client: Client) => Promise<T>): Promise<T> {
  ensureStdioConfig(config);
  const client = new Client({ name: "linguist-agent-mcp-bridge", version: readMcpPackageVersion() }, { capabilities: {} });
  const transport = new StdioClientTransport({
    command: config.command,
    args: config.args ?? [],
    cwd: config.cwd,
    env: config.env,
    stderr: "pipe",
  });
  try {
    await client.connect(transport);
    return await fn(client);
  } finally {
    await client.close().catch(() => undefined);
  }
}

export async function discoverMcpServerTools(config: McpServerConfig): Promise<McpToolDescriptor[]> {
  if (config.enabled === false) return [];
  return withMcpClient(config, async (client) => {
    const result = await client.listTools();
    return result.tools.map((tool) => ({
      serverId: config.id,
      serverLabel: config.label,
      rawToolName: tool.name,
      title: tool.title ?? tool.annotations?.title,
      description: tool.description,
      inputSchema: tool.inputSchema,
      annotations: tool.annotations,
    }));
  });
}

function textFromMcpResult(result: unknown): string {
  const content = (result && typeof result === "object" && "content" in result && Array.isArray(result.content)) ? result.content : [];
  return content
    .map((part) => part.type === "text" ? part.text : `[${part.type}]`)
    .join("\n")
    .trim();
}

export async function callMcpTool(config: McpServerConfig, rawToolName: string, args: Record<string, unknown>): Promise<McpToolCallResult> {
  return withMcpClient(config, async (client) => {
    const raw = await client.callTool({ name: rawToolName, arguments: args });
    return { raw, contentText: textFromMcpResult(raw) };
  });
}
