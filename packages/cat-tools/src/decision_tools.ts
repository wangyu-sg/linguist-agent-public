import { Type } from "@earendil-works/pi-ai";
import { defineTool } from "@earendil-works/pi-coding-agent";
import { readProjectGuidance, writeProjectGuidance, type ProjectGuidanceDecision, type CatWorkspace, type DecisionScope } from "@linguist-agent/cat-data";

// v1.8 — consolidated memory: let the agent distil durable CAT decisions (term choices, style
// rules, dup-group resolutions) into the project's consolidated-decision store. These are
// re-injected as recall context on every future turn (catRuntimeExtension). Recall, not
// citable evidence — term/terminology-authority writes still need returned TM/TB/glossary/asset sources.
const recordDecisionParameters = Type.Object({
  scope: Type.Union(
    [Type.Literal("term"), Type.Literal("style"), Type.Literal("tm"), Type.Literal("dup"), Type.Literal("general")],
    { description: "Decision category: term (terminology), style (voice/format), tm (TM/reuse policy), dup (duplicate-group resolution), general." },
  ),
  text: Type.String({ description: "The durable decision in one line, e.g. '怒X斩 → X Strike pattern; never 'X-style Slash'.'" }),
});

export function createRecordDecisionTool(workspace: CatWorkspace) {
  return defineTool<typeof recordDecisionParameters>({
    name: "record_decision",
    label: "Record Decision",
    description:
      "Save a durable, project-level CAT decision (terminology, style, TM-reuse, or duplicate-group rule) to the consolidated decision store. These steer every future turn as recall context.",
    promptSnippet: "record_decision: persist a durable term/style/dup decision for future turns.",
    promptGuidelines: [
      "Record a decision when the user confirms a terminology/style choice or you resolve a recurring ambiguity.",
      "Keep each decision to one concrete, reusable line. Do not record routine per-segment translations.",
      "This is recall context, not citable evidence; term/terminology-authority writes still require returned evidenceSources.",
    ],
    parameters: recordDecisionParameters,
    async execute(_id, params) {
      const decisions = await readProjectGuidance(workspace);
      const decision: ProjectGuidanceDecision = {
        id: `dec_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
        scope: params.scope as DecisionScope,
        text: params.text.trim(),
        createdAt: new Date().toISOString(),
        source: "agent",
      };
      await writeProjectGuidance(workspace, [...decisions, decision]);
      return {
        content: [{ type: "text" as const, text: `Recorded ${params.scope} decision: ${decision.text}` }],
        details: { decisionId: decision.id, total: decisions.length + 1 },
      };
    },
  });
}
