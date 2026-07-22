import type { AgentToolResult, ToolDefinition, ToolExecutionMode } from "@earendil-works/pi-coding-agent";
import { writePolicyEvidenceViolations } from "@linguist-agent/cat-data";
import { catToolMetadataFor, type CatToolMetadata } from "./tool_catalog.js";

const KEY_ALIASES: Record<string, string> = {
  batch_id: "batchId",
  change_type: "changeType",
  evidence_sources: "evidenceSources",
  master_xliff_path: "masterXliffPath",
  mxliff_path: "mxliffPath",
  project_id: "projectId",
  proposal_ids: "proposalIds",
  proposal_set_id: "proposalSetId",
  proposed_target: "proposedTarget",
  reject_unselected: "rejectUnselected",
  segment_id: "segmentId",
};

const PATH_KEYS = new Set([
  "assetPath",
  "file",
  "filePath",
  "inputPath",
  "masterXliffPath",
  "mxliffPath",
  "outputPath",
  "path",
  "root",
  "sourcePath",
]);

export interface CatToolPolicyDetails {
  access: CatToolMetadata["access"];
  allowedModes: CatToolMetadata["allowedModes"];
  executionMode: CatToolMetadata["executionMode"];
  mutatesProject: boolean;
  writesSegments: boolean;
  requiresEvidenceFor: string[];
  warnings: string[];
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizePathLikeValue(value: unknown): unknown {
  if (typeof value !== "string") return value;
  return value.startsWith("@") ? value.slice(1) : value;
}

export function prepareCatToolArguments(args: unknown): unknown {
  if (Array.isArray(args)) return args.map(prepareCatToolArguments);
  if (!isObject(args)) return args;
  const normalized: Record<string, unknown> = {};
  for (const [rawKey, rawValue] of Object.entries(args)) {
    const key = KEY_ALIASES[rawKey] ?? rawKey;
    const value = prepareCatToolArguments(rawValue);
    normalized[key] = PATH_KEYS.has(key) ? normalizePathLikeValue(value) : value;
  }
  return normalized;
}

export function catEvidenceViolations(params: unknown): string[] {
  return writePolicyEvidenceViolations(params);
}

function executionModeFor(metadata: CatToolMetadata): ToolExecutionMode {
  return metadata.executionMode;
}

function contentText(result: AgentToolResult<unknown>): string {
  return result.content
    .map((part) => ("text" in part && typeof part.text === "string" ? part.text : ""))
    .join("\n")
    .trim();
}

function policyGuidelines(metadata: CatToolMetadata): string[] {
  const lines = [
    `${metadata.name} is a ${metadata.access} CAT tool for modes: ${metadata.allowedModes.join(", ")}.`,
    `${metadata.name} runs ${metadata.executionMode}; do not batch it with unrelated ${metadata.executionMode === "sequential" ? "write/import/export" : "state-mutating"} work.`,
  ];
  if (metadata.requiresEvidenceFor?.length) {
    lines.push(
      `${metadata.name} requires returned evidenceSources for ${metadata.requiresEvidenceFor.join("/")}; tool trace alone is audit data, not evidence.`,
    );
  }
  if (metadata.writesSegments) {
    lines.push(`${metadata.name} writes segment targets only through LA guards; locked rows and unsafe tag changes must remain blocked.`);
  }
  if (metadata.access === "export") {
    lines.push(`${metadata.name} should run only after delivery_check has no blockers.`);
  }
  return lines;
}

function policySnippet(metadata: CatToolMetadata): string {
  return `${metadata.name}: ${metadata.description} [${metadata.access}, ${metadata.executionMode}]`;
}

function appendPolicyDetails(result: AgentToolResult<unknown>, metadata: CatToolMetadata, warnings: string[]): AgentToolResult<unknown> {
  const details = isObject(result.details) ? result.details : { value: result.details };
  return {
    ...result,
    details: {
      ...details,
      catPolicy: {
        access: metadata.access,
        allowedModes: metadata.allowedModes,
        executionMode: metadata.executionMode,
        mutatesProject: metadata.mutatesProject,
        writesSegments: metadata.writesSegments,
        requiresEvidenceFor: metadata.requiresEvidenceFor ?? [],
        warnings,
      } satisfies CatToolPolicyDetails,
    },
  };
}

export function applyCatToolPolicy<T extends ToolDefinition>(tool: T): T {
  const metadata = catToolMetadataFor(tool.name);
  if (!metadata) return tool;
  const originalPrepare = tool.prepareArguments;
  const originalExecute = tool.execute;
  const wrapped: ToolDefinition = {
    ...tool,
    executionMode: executionModeFor(metadata),
    promptSnippet: tool.promptSnippet ?? policySnippet(metadata),
    promptGuidelines: [...policyGuidelines(metadata), ...(tool.promptGuidelines ?? [])],
    prepareArguments(args: unknown) {
      const prepared = originalPrepare ? originalPrepare(args) : args;
      return prepareCatToolArguments(prepared);
    },
    async execute(toolCallId, params, signal, onUpdate, ctx) {
      const evidenceErrors = metadata.requiresEvidenceFor?.length ? catEvidenceViolations(params) : [];
      if (evidenceErrors.length) {
        throw new Error(`CAT evidence gate blocked ${metadata.name}: ${evidenceErrors.join("; ")}`);
      }
      const result = await originalExecute(toolCallId, params, signal, onUpdate, ctx);
      const warnings: string[] = [];
      if (!contentText(result)) warnings.push(`${metadata.name} returned an empty textual result`);
      if (metadata.mutatesProject && metadata.access !== "read") warnings.push(`${metadata.name} mutated project state`);
      return appendPolicyDetails(result, metadata, warnings);
    },
  };
  return wrapped as T;
}

export function applyCatToolPolicies<T extends ToolDefinition>(tools: T[]): T[] {
  return tools.map((tool) => applyCatToolPolicy(tool));
}
