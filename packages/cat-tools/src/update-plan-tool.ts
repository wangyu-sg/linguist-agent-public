import { defineTool } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

const planParameters = Type.Object({
  title: Type.Optional(Type.String({ description: "Plan title. Defaults to the Chat work plan." })),
  items: Type.Array(
    Type.Object({
      id: Type.String({ description: "Stable kebab-case item identifier; reuse it on every later update." }),
      text: Type.String({ description: "One concrete step or outcome." }),
      status: Type.Union([
        Type.Literal("pending"),
        Type.Literal("in_progress"),
        Type.Literal("completed"),
      ], { description: "Current item state." }),
    }),
    { minItems: 1, description: "The FULL current todo list. The host validates it and stores it as the next canonical plan version." },
  ),
});

export function createUpdatePlanTool(options: {
  submitPlan: (payload: unknown) => Promise<unknown>;
}) {
  return defineTool<typeof planParameters>({
    name: "agent_plan_update",
    label: "Update Work Plan",
    description: "Maintain one visible work plan for this Chat. Submit the full todo list; the host validates it and stores a new canonical version the user can watch in the timeline.",
    promptSnippet: "Maintain the canonical visible work plan",
    promptGuidelines: [
      "Keep exactly one plan per Chat: update item status as work proceeds instead of creating parallel plans.",
      "Reuse stable item ids across updates so progress reads as movement, not churn.",
      "The plan is a progress view, not evidence: CAT writes, QA, and delivery still pass their own gates.",
    ],
    parameters: planParameters,
    async execute(_id, params) {
      const result = await options.submitPlan(params) as { artifactId?: unknown; version?: unknown } | undefined;
      const artifactId = typeof result?.artifactId === "string" ? result.artifactId : "unknown";
      const version = typeof result?.version === "number" ? result.version : "unknown";
      return {
        content: [{ type: "text" as const, text: `Work plan updated (artifact ${artifactId}, version ${version}). It is now visible in the conversation timeline.` }],
        details: { artifactId, version },
      };
    },
  });
}
