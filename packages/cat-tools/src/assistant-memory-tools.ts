import { defineTool } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import {
  listAssistantMemories,
  proposeAssistantMemory,
  type AssistantMemoryEntry,
  type AssistantMemoryKind,
  type AssistantMemoryScope,
} from "@linguist-agent/cat-data";

const searchParameters = Type.Object({
  query: Type.String({ description: "Words or concepts to recall from memories that the user explicitly confirmed." }),
  limit: Type.Optional(Type.Number({ minimum: 1, maximum: 20, description: "Maximum results, default 8." })),
});

const proposeParameters = Type.Object({
  kind: Type.Union([
    Type.Literal("preference"),
    Type.Literal("fact"),
    Type.Literal("guidance"),
  ], { description: "The proposed memory category." }),
  text: Type.String({ description: "One specific fact, preference, or guidance item to propose for long-term recall." }),
});

function score(query: string, entry: AssistantMemoryEntry): number {
  const normalized = query.toLocaleLowerCase().trim();
  if (!normalized) return 0;
  const text = entry.text.toLocaleLowerCase();
  if (text.includes(normalized)) return 1;
  const terms = normalized.split(/[\s,.;:!?，。！？、；：]+/u).filter(Boolean);
  return terms.length ? terms.filter((term) => text.includes(term)).length / terms.length : 0;
}

export function createAssistantMemoryTools(options: {
  runtimeRoot: string;
  scope: AssistantMemoryScope;
  sourceTaskId: string;
  personalOnly?: boolean;
}) {
  return [
    defineTool<typeof searchParameters>({
      name: "assistant_memory_search",
      label: "Confirmed Memory Search",
      description: "Search only memories that the user explicitly confirmed. Memory is recall context, never citable client or CAT evidence.",
      promptSnippet: "Search explicitly confirmed long-term memory",
      promptGuidelines: [
        "Use this only when prior user-confirmed preferences, facts, or guidance may be relevant.",
        "Never present memory as project evidence. Current project assets and approved terminology have higher authority.",
      ],
      parameters: searchParameters,
      async execute(_id, params) {
        const entries = (await listAssistantMemories(options.runtimeRoot, options.scope, { status: "active" }))
          .map((entry) => ({ entry, score: score(params.query, entry) }))
          .filter((result) => result.score > 0)
          .sort((left, right) => right.score - left.score || right.entry.updatedAt.localeCompare(left.entry.updatedAt))
          .slice(0, params.limit ?? 8);
        const text = entries.length
          ? [
              "Explicitly confirmed memory (recall-only; not citable evidence):",
              ...entries.map(({ entry }) => `- [${entry.kind}] ${entry.text} (memory: ${entry.id}, source task: ${entry.source.taskId})`),
            ].join("\n")
          : "No matching confirmed memory was found.";
        return { content: [{ type: "text" as const, text }], details: { memoryIds: entries.map(({ entry }) => entry.id), scope: options.scope } };
      },
    }),
    defineTool<typeof proposeParameters>({
      name: "assistant_memory_propose",
      label: "Propose Memory",
      description: "Create a proposed long-term memory. The proposal is not recalled or shared until the user explicitly confirms it in Library.",
      promptSnippet: "Propose a memory for explicit user confirmation",
      promptGuidelines: [
        "Propose only durable preferences, facts, or guidance that would matter in a future Chat.",
        "Do not claim the memory was saved. Tell the user it is awaiting confirmation.",
        "Never store raw chat turns, secrets, credentials, routine translations, or unverified assumptions.",
      ],
      parameters: proposeParameters,
      async execute(_id, params) {
        const kind = params.kind as AssistantMemoryKind;
        if (options.personalOnly && options.scope.kind !== "personal") throw new Error("This runtime can propose Personal memory only.");
        if (options.scope.kind === "personal" && kind !== "preference" && !options.personalOnly) {
          throw new Error("A Project runtime may write only preference proposals to Personal memory; use Project memory for facts or guidance.");
        }
        const proposal = await proposeAssistantMemory(options.runtimeRoot, {
          scope: options.scope,
          kind,
          text: params.text,
          source: { taskId: options.sourceTaskId },
        });
        return {
          content: [{ type: "text" as const, text: `Memory proposal ${proposal.id} is awaiting explicit user confirmation. It is not active recall yet.` }],
          details: { memoryId: proposal.id, status: proposal.status, scope: proposal.scope },
        };
      },
    }),
  ];
}
