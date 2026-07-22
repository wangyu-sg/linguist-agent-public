import { Type } from "@earendil-works/pi-ai";
import { defineTool } from "@earendil-works/pi-coding-agent";
import { callMcpTool } from "./client.js";
import type { McpServerConfig, McpToolPolicy } from "./policy.js";
import { assertMcpToolPolicySafe } from "./policy.js";

const mcpBridgeParameters = Type.Object({
  arguments: Type.Optional(Type.Record(Type.String(), Type.Unknown(), { description: "MCP tool arguments." })),
});

export function createMcpBridgeTool(config: McpServerConfig, policy: McpToolPolicy) {
  assertMcpToolPolicySafe(policy);
  return defineTool<typeof mcpBridgeParameters, { mcpPolicy: McpToolPolicy; raw: unknown }>({
    name: policy.bridgeToolName,
    label: policy.title,
    description: policy.description,
    promptSnippet: `${policy.bridgeToolName}: call allowlisted read-only MCP tool ${policy.rawToolName}. It never writes CAT state.`,
    promptGuidelines: [
      "MCP output is bridge evidence/context only; it is not termbase/TM/Phrase authority by itself.",
      "Do not use MCP tools for segment, proposal, batch, delivery, or Phrase writes.",
      "If MCP output affects CAT reasoning, cite the result in a proposal or workflow decision and keep CAT write gates intact.",
    ],
    parameters: mcpBridgeParameters,
    executionMode: "parallel",
    async execute(_toolCallId, params) {
      if (policy.allowlistState !== "allowlisted") {
        throw new Error(`MCP tool ${policy.bridgeToolName} is discovered but not allowlisted.`);
      }
      const result = await callMcpTool(config, policy.rawToolName, params.arguments ?? {});
      const text = [
        `MCP server: ${policy.serverId}`,
        `MCP tool: ${policy.rawToolName}`,
        `Bridge tool: ${policy.bridgeToolName}`,
        `Mutation risk: ${policy.mutationRisk}`,
        `Evidence behavior: ${policy.evidenceBehavior}`,
        "",
        result.contentText || "No textual MCP result returned.",
      ].join("\n");
      return {
        content: [{ type: "text", text }],
        details: { mcpPolicy: policy, raw: result.raw },
      };
    },
  });
}
