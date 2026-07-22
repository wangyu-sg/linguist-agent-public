import type { AgentRunOptions } from "@linguist-agent/cat-runtime";
import { hasAgentRunOptions } from "@linguist-agent/cat-runtime";

function splitValues(values: string[]): string[] {
  return values
    .flatMap((value) => value.split(/[,\n]/g))
    .map((value) => value.trim())
    .filter((value) => value.length > 0);
}

function listParam(params: URLSearchParams, ...names: string[]): string[] | undefined {
  const nameSet = new Set(names);
  const values = Array.from(params.entries())
    .filter(([name]) => nameSet.has(name))
    .map(([, value]) => value);
  const parsed = splitValues(values);
  return parsed.length > 0 ? Array.from(new Set(parsed)) : undefined;
}

function booleanParam(params: URLSearchParams, name: string): boolean | undefined {
  const value = params.get(name);
  if (value === null) return undefined;
  const normalized = value.trim().toLowerCase();
  if (normalized === "" || normalized === "true" || normalized === "1" || normalized === "yes" || normalized === "on") {
    return true;
  }
  if (normalized === "false" || normalized === "0" || normalized === "no" || normalized === "off") {
    return false;
  }
  throw new Error(`${name} must be a boolean query value`);
}

function noToolsParam(params: URLSearchParams): AgentRunOptions["noTools"] {
  const value = params.get("noTools")?.trim().toLowerCase();
  if (!value) return undefined;
  if (value === "all" || value === "builtin") return value;
  if (value === "true" || value === "1") return "all";
  throw new Error("noTools must be all or builtin");
}

function projectTrustOverride(params: URLSearchParams): boolean | undefined {
  const explicit = booleanParam(params, "projectTrustOverride");
  if (explicit !== undefined) return explicit;
  const approve = booleanParam(params, "approve");
  const noApprove = booleanParam(params, "noApprove");
  if (approve && noApprove) {
    throw new Error("approve and noApprove cannot both be true");
  }
  if (approve) return true;
  if (noApprove) return false;
  return undefined;
}

export function parseAgentRunOptionsFromUrl(url: URL): AgentRunOptions | undefined {
  const params = url.searchParams;
  const runOptions: AgentRunOptions = {
    noTools: noToolsParam(params),
    tools: listParam(params, "tools", "tool"),
    excludeTools: listParam(params, "excludeTools", "excludeTool"),
    additionalExtensionPaths: listParam(params, "extensions", "extension"),
    additionalSkillPaths: listParam(params, "skills", "skill"),
    additionalPromptTemplatePaths: listParam(params, "promptTemplates", "promptTemplate"),
    additionalThemePaths: listParam(params, "themes", "theme"),
    noExtensions: booleanParam(params, "noExtensions") || undefined,
    noSkills: booleanParam(params, "noSkills") || undefined,
    noPromptTemplates: booleanParam(params, "noPromptTemplates") || undefined,
    noThemes: booleanParam(params, "noThemes") || undefined,
    noContextFiles: booleanParam(params, "noContextFiles") || undefined,
    noSession: booleanParam(params, "noSession") || undefined,
    projectTrustOverride: projectTrustOverride(params),
  };
  return hasAgentRunOptions(runOptions) ? runOptions : undefined;
}
