import { defineTool } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

const tableValue = Type.Union([Type.String(), Type.Number(), Type.Boolean(), Type.Null()]);

const presentBlock = Type.Union([
  Type.Object({
    id: Type.String({ description: "Stable block identifier." }),
    type: Type.Literal("markdown"),
    markdown: Type.String({ description: "Markdown text. Raw HTML or executable markup is rejected by the host." }),
  }),
  Type.Object({
    id: Type.String({ description: "Stable block identifier." }),
    type: Type.Literal("table"),
    caption: Type.Optional(Type.String()),
    columns: Type.Array(Type.Object({
      key: Type.String(),
      label: Type.String(),
      align: Type.Optional(Type.Union([Type.Literal("left"), Type.Literal("center"), Type.Literal("right")])),
    }), { minItems: 1 }),
    rows: Type.Array(Type.Record(Type.String(), tableValue), { description: "One record per row; keys must be declared column keys." }),
  }),
  Type.Object({
    id: Type.String({ description: "Stable block identifier." }),
    type: Type.Literal("chart"),
    caption: Type.Optional(Type.String()),
    kind: Type.Union([Type.Literal("bar"), Type.Literal("line"), Type.Literal("pie")]),
    series: Type.Array(Type.Object({
      label: Type.String(),
      points: Type.Array(Type.Object({ label: Type.String(), value: Type.Number() }), { minItems: 1 }),
    }), { minItems: 1 }),
  }),
  Type.Object({
    id: Type.String({ description: "Stable block identifier." }),
    type: Type.Literal("diff"),
    label: Type.Optional(Type.String()),
    before: Type.Optional(Type.String()),
    after: Type.Optional(Type.String()),
    patch: Type.Optional(Type.String()),
  }),
  Type.Object({
    id: Type.String({ description: "Stable block identifier." }),
    type: Type.Literal("file_reference"),
    file: Type.Object({
      path: Type.String({ description: "Local path, never a URI." }),
      label: Type.String(),
      role: Type.Union([Type.Literal("source"), Type.Literal("output"), Type.Literal("reference")]),
      mimeType: Type.Optional(Type.String()),
      sha256: Type.Optional(Type.String()),
    }),
  }),
], { description: "A declarative content block. The host validates every block before it becomes a canonical Artifact." });

const presentParameters = Type.Object({
  title: Type.Optional(Type.String({ description: "Card title. Defaults to a generic visual answer title." })),
  blocks: Type.Array(presentBlock, {
    minItems: 1,
    description: "The declarative blocks of this visual answer. The host validates them and stores a new canonical Artifact the user sees as a timeline card.",
  }),
});

export function createPresentAnswerTool(options: {
  submitPresentation: (payload: unknown) => Promise<unknown>;
}) {
  return defineTool<typeof presentParameters>({
    name: "agent_present",
    label: "Present Visual Answer",
    description: "Render an answer as an inspectable card in the conversation timeline: markdown, tables, charts, diffs, and file references. The host validates the declarative blocks and stores a canonical Artifact.",
    promptSnippet: "Present answers as validated visual cards",
    promptGuidelines: [
      "Prefer a table block over a markdown table for comparisons, a chart block for numeric trends, and a diff block for before/after changes.",
      "Never emit raw HTML, JSX, or scripts: only the declarative block schema is accepted and the host rejects executable markup.",
      "Use agent_plan_update for the work plan; todo_list blocks are not presentable here.",
      "Keep the text answer as the primary channel; present a card when structure makes the answer easier to scan.",
    ],
    parameters: presentParameters,
    async execute(_id, params) {
      const result = await options.submitPresentation(params) as { artifactId?: unknown; version?: unknown } | undefined;
      const artifactId = typeof result?.artifactId === "string" ? result.artifactId : "unknown";
      const version = typeof result?.version === "number" ? result.version : "unknown";
      return {
        content: [{ type: "text" as const, text: `Visual answer presented (artifact ${artifactId}, version ${version}). It now renders as a card in the conversation timeline.` }],
        details: { artifactId, version },
      };
    },
  });
}
