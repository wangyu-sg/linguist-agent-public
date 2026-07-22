import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import {
  assertMcpToolPolicySafe,
  buildMcpBridgeCatalog,
  bridgeToolName,
  createMcpBridgeTool,
  createMcpToolPolicy,
  discoverMcpServerTools,
  parseMcpConfig,
  sanitizeMcpName,
  type McpServerConfig,
} from "@linguist-agent/cat-mcp";

const here = dirname(fileURLToPath(import.meta.url));
const fixtureServer = resolve(here, "fixtures/mcp_echo_server.ts");

assert.equal(sanitizeMcpName("Docs Server!"), "docs_server");
assert.equal(bridgeToolName("Docs Server!", "Read File"), "mcp__docs_server__read_file");

const configs = parseMcpConfig({
  servers: [
    {
      id: "echo",
      label: "Echo MCP",
      transport: "stdio",
      command: "node",
      args: ["--import", "tsx", fixtureServer],
      tools: {
        echo: {
          allowlistState: "allowlisted",
          mutationRisk: "read_only",
          evidenceBehavior: "reference_only",
        },
      },
    },
  ],
});
assert.equal(configs.length, 1);

const [config] = configs as [McpServerConfig];
const descriptors = await discoverMcpServerTools(config);
assert.equal(descriptors.length, 1);
assert.equal(descriptors[0].rawToolName, "echo");
assert.equal(descriptors[0].annotations?.readOnlyHint, true);
assert.equal(descriptors[0].annotations?.destructiveHint, false);

const discoveredPolicy = createMcpToolPolicy({ ...config, tools: undefined }, descriptors[0]);
assert.equal(discoveredPolicy.allowlistState, "discovered");
assert.equal(discoveredPolicy.mutationRisk, "read_only");
assert.equal(discoveredPolicy.catWriteEligible, false);
assert.equal(discoveredPolicy.traceVisible, true);
assert.doesNotThrow(() => assertMcpToolPolicySafe(discoveredPolicy));

const catalog = buildMcpBridgeCatalog(configs, descriptors);
assert.equal(catalog.servers[0].discoveredTools, 1);
assert.equal(catalog.tools[0].allowlistState, "allowlisted");
assert.equal(catalog.tools[0].bridgeToolName, "mcp__echo__echo");
assert.equal(catalog.tools[0].catWriteEligible, false);

assert.throws(
  () => assertMcpToolPolicySafe({ ...catalog.tools[0], mutationRisk: "external_mutation_possible" }),
  /allowlisted but not read-only/,
);

const tool = createMcpBridgeTool(config, catalog.tools[0]);
assert.equal(tool.name, "mcp__echo__echo");
const result = await tool.execute("call-1", { arguments: { message: "ok" } }, new AbortController().signal, undefined as never, undefined as never);
const text = result.content.map((part) => "text" in part ? part.text : "").join("\n");
assert.match(text, /MCP server: echo/);
assert.match(text, /echo:ok/);
assert.equal((result.details as { mcpPolicy: { catWriteEligible: boolean } }).mcpPolicy.catWriteEligible, false);

console.log("mcp_bridge_policy tests passed");
