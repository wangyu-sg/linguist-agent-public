import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const server = new McpServer({ name: "la-test-echo-mcp", version: "1.0.0" });

server.registerTool(
  "echo",
  {
    title: "Echo",
    description: "Return a test echo string.",
    inputSchema: { message: z.string() },
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
    },
  },
  async ({ message }) => ({
    content: [{ type: "text", text: `echo:${message}` }],
  }),
);

await server.connect(new StdioServerTransport());
