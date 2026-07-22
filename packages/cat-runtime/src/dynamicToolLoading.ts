import type { ExtensionAPI, ToolInfo } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

export const CAPABILITY_SEARCH_TOOL = "capability_search";

export interface CapabilityActivation {
  query: string;
  addedToolNames: string[];
  matchedToolNames: string[];
  sources: Array<{ toolName: string; source: string; path: string }>;
}

export interface DynamicToolLoadingOptions {
  initialToolNames: readonly string[];
  /** Tools reserved for an LA server-owned bridge and never activated directly from a Package. */
  blockedToolNames?: readonly string[];
  onActivation?: (activation: CapabilityActivation) => void;
}

function terms(value: string): string[] {
  return [...new Set(value.toLocaleLowerCase().match(/[\p{L}\p{N}_.:/-]+/gu) ?? [])];
}

function sourceText(tool: ToolInfo): string {
  return [tool.sourceInfo.source, tool.sourceInfo.path, tool.sourceInfo.origin, tool.sourceInfo.scope]
    .filter((value): value is string => typeof value === "string")
    .join(" ");
}

export function rankCapabilityTools(tools: ToolInfo[], query: string, limit = 5): ToolInfo[] {
  const queryTerms = terms(query);
  if (!queryTerms.length) return [];
  const normalizedQuery = query.trim().toLocaleLowerCase();
  return tools
    .filter((tool) => tool.name !== CAPABILITY_SEARCH_TOOL)
    .map((tool) => {
      const name = tool.name.toLocaleLowerCase();
      const description = tool.description.toLocaleLowerCase();
      const source = sourceText(tool).toLocaleLowerCase();
      let score = name === normalizedQuery ? 100 : 0;
      for (const term of queryTerms) {
        if (name === term) score += 20;
        else if (name.includes(term)) score += 8;
        if (description.includes(term)) score += 4;
        if (source.includes(term)) score += 1;
      }
      return { tool, score };
    })
    .filter(({ score }) => score > 0)
    .sort((left, right) => right.score - left.score || left.tool.name.localeCompare(right.tool.name))
    .slice(0, Math.max(1, Math.min(10, limit)))
    .map(({ tool }) => tool);
}

/**
 * Pi-native deferred tool loading: all tools remain registered, while only the
 * General Core and this loader are initially active. Activation is additive so
 * Pi 0.80.9+ can preserve supported providers' prompt-cache prefix.
 */
export function createDynamicToolLoadingExtension(options: DynamicToolLoadingOptions) {
  return (pi: ExtensionAPI): void => {
    pi.registerTool({
      name: CAPABILITY_SEARCH_TOOL,
      label: "Capability Search",
      description: "Search all registered Pi and LA tools and add the tools needed for the current task. Use this when the active tool set lacks a capability.",
      parameters: Type.Object({
        query: Type.String({ description: "The capability or task to search for." }),
        limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 10, description: "Maximum tools to activate; defaults to 5." })),
      }),
      async execute(_toolCallId, params) {
        const blocked = new Set(options.blockedToolNames ?? []);
        const matches = rankCapabilityTools(
          pi.getAllTools().filter((tool) => !blocked.has(tool.name)),
          params.query,
          params.limit ?? 5,
        );
        if (!matches.length) {
          const activation: CapabilityActivation = {
            query: params.query,
            matchedToolNames: [],
            addedToolNames: [],
            sources: [],
          };
          return {
            content: [{ type: "text", text: `No registered capability matched: ${params.query}` }],
            details: activation,
          };
        }
        const active = pi.getActiveTools();
        const activeSet = new Set(active);
        const added = matches.map((tool) => tool.name).filter((name) => !activeSet.has(name));
        if (added.length) pi.setActiveTools([...new Set([...active, ...added])]);
        const activation: CapabilityActivation = {
          query: params.query,
          matchedToolNames: matches.map((tool) => tool.name),
          addedToolNames: added,
          sources: matches.map((tool) => ({
            toolName: tool.name,
            source: tool.sourceInfo.source,
            path: tool.sourceInfo.path,
          })),
        };
        options.onActivation?.(activation);
        return {
          content: [{
            type: "text",
            text: added.length
              ? `Activated capabilities: ${added.join(", ")}`
              : `Matching capabilities were already active: ${activation.matchedToolNames.join(", ")}`,
          }],
          details: activation,
        };
      },
    });

    pi.on("session_start", () => {
      const registered = new Set(pi.getAllTools().map((tool) => tool.name));
      const blocked = new Set(options.blockedToolNames ?? []);
      const initial = [...new Set([...options.initialToolNames, CAPABILITY_SEARCH_TOOL])]
        .filter((name) => registered.has(name) && !blocked.has(name));
      pi.setActiveTools(initial);
    });
  };
}
