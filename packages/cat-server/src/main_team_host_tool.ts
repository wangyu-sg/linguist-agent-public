import { Type } from "@earendil-works/pi-ai";
import { defineTool } from "@earendil-works/pi-coding-agent";
import type { PreparedTeamExecution } from "./routes/workflow_routes.js";

const parameters = Type.Object({
  reason: Type.String({
    minLength: 1,
    maxLength: 1_200,
    description: "Why bounded Specialist work is justified for the current canonical Task scope.",
  }),
}, { additionalProperties: false });

export function createPrepareTeamExecutionTool(
  prepare: (reason: string) => Promise<PreparedTeamExecution>,
) {
  return defineTool<typeof parameters, PreparedTeamExecution>({
    name: "prepare_team_execution",
    label: "Prepare Team",
    description: "Prepare a server-owned Team plan for the current Task and wait for user approval. The host selects roles, routes, calls, cost, scope, and plan hash; this tool never starts a Specialist.",
    promptSnippet: "prepare_team_execution: propose justified Specialist work without starting it.",
    promptGuidelines: [
      "Use only when bounded Specialist work materially improves the current Task outcome.",
      "Supply only the reason; never invent roles, routes, costs, scope, or approval state.",
      "After preparation, explain the proposal and wait for the user's canonical Decision.",
    ],
    parameters,
    executionMode: "sequential",
    async execute(_toolCallId, input, signal) {
      if (signal?.aborted) throw new Error("Team preparation was cancelled before it started.");
      const result = await prepare(input.reason);
      return {
        content: [{
          type: "text" as const,
          text: `Team plan prepared for approval (Run ${result.runId}). No Specialist has started.`,
        }],
        details: result,
      };
    },
  });
}
