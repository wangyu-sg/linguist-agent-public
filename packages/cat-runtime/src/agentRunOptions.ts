import type { CreateAgentSessionOptions } from "@earendil-works/pi-coding-agent";

export type AgentRunNoToolsMode = "all" | "builtin";

export interface AgentRunOptions {
  noTools?: AgentRunNoToolsMode;
  tools?: string[];
  excludeTools?: string[];
  additionalExtensionPaths?: string[];
  additionalSkillPaths?: string[];
  additionalPromptTemplatePaths?: string[];
  additionalThemePaths?: string[];
  noExtensions?: boolean;
  noSkills?: boolean;
  noPromptTemplates?: boolean;
  noThemes?: boolean;
  noContextFiles?: boolean;
  projectTrustOverride?: boolean;
  noSession?: boolean;
}

function uniqueClean(values: Array<string | undefined> | undefined): string[] | undefined {
  const cleaned = (values ?? [])
    .map((value) => value?.trim() ?? "")
    .filter((value) => value.length > 0);
  if (cleaned.length === 0) return undefined;
  return Array.from(new Set(cleaned));
}

export function mergeAgentRunToolExcludes(
  baseExcludeTools: string[] | undefined,
  runExcludeTools: string[] | undefined,
): string[] | undefined {
  return uniqueClean([...(baseExcludeTools ?? []), ...(runExcludeTools ?? [])]);
}

export function applyAgentRunToolOptions(
  base: CreateAgentSessionOptions,
  runOptions: AgentRunOptions | undefined,
  baseExcludeTools?: string[],
): CreateAgentSessionOptions {
  const next: CreateAgentSessionOptions = { ...base };
  const tools = uniqueClean(runOptions?.tools);
  const excludeTools = mergeAgentRunToolExcludes(baseExcludeTools ?? base.excludeTools, runOptions?.excludeTools);

  if (tools) {
    next.tools = tools;
    delete next.noTools;
  } else if (runOptions?.noTools) {
    next.noTools = runOptions.noTools;
    delete next.tools;
  }

  if (excludeTools) {
    next.excludeTools = excludeTools;
  } else {
    delete next.excludeTools;
  }

  return next;
}

export function hasAgentRunOptions(runOptions: AgentRunOptions | undefined): boolean {
  if (!runOptions) return false;
  return Boolean(
    runOptions.noTools ||
      uniqueClean(runOptions.tools) ||
      uniqueClean(runOptions.excludeTools) ||
      uniqueClean(runOptions.additionalExtensionPaths) ||
      uniqueClean(runOptions.additionalSkillPaths) ||
      uniqueClean(runOptions.additionalPromptTemplatePaths) ||
      uniqueClean(runOptions.additionalThemePaths) ||
      runOptions.noExtensions ||
      runOptions.noSkills ||
      runOptions.noPromptTemplates ||
      runOptions.noThemes ||
      runOptions.noContextFiles ||
      runOptions.noSession ||
      runOptions.projectTrustOverride !== undefined,
  );
}
