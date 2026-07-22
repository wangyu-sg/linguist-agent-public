import { createHash } from "node:crypto";

export interface CatRequestShapeTool {
  name: string;
  description?: string;
  parameters?: unknown;
}

export interface CatRequestShapeResource {
  kind: "skill" | "prompt" | "context";
  name: string;
  description?: string;
  path?: string;
}

export interface CatRequestShapeManifest {
  schemaVersion: 2;
  systemPromptHash: string;
  toolSurfaceHash: string;
  resourceIndexHash: string;
  requestShapeHash: string;
  systemPromptChars: number;
  activeToolCount: number;
  resourceCount: number;
  activeToolNames: string[];
}

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([, entry]) => entry !== undefined && typeof entry !== "function")
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => [key, canonical(entry)]),
  );
}

function stableJson(value: unknown): string {
  return JSON.stringify(canonical(value));
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function buildCatRequestShape(input: {
  systemPrompt: string;
  activeToolNames: string[];
  tools: CatRequestShapeTool[];
  resources: CatRequestShapeResource[];
}): CatRequestShapeManifest {
  const activeToolNames = [...new Set(input.activeToolNames)].sort();
  const active = new Set(activeToolNames);
  const tools = input.tools
    .filter((tool) => active.has(tool.name))
    .map((tool) => canonical({ name: tool.name, description: tool.description, parameters: tool.parameters }))
    .sort((left, right) => stableJson(left).localeCompare(stableJson(right)));
  const resources = input.resources
    .map((resource) => canonical(resource))
    .sort((left, right) => stableJson(left).localeCompare(stableJson(right)));
  const systemPromptHash = sha256(input.systemPrompt);
  const toolSurfaceHash = sha256(stableJson(tools));
  const resourceIndexHash = sha256(stableJson(resources));
  return {
    schemaVersion: 2,
    systemPromptHash,
    toolSurfaceHash,
    resourceIndexHash,
    requestShapeHash: sha256(stableJson({ systemPromptHash, toolSurfaceHash, resourceIndexHash })),
    systemPromptChars: input.systemPrompt.length,
    activeToolCount: activeToolNames.length,
    resourceCount: resources.length,
    activeToolNames,
  };
}

/**
 * Attest a Run that is implemented by more than one Pi request surface.
 * Team execution is the concrete example: the server-owned supervisor loads
 * the server-owned Team child transport, while each child loads a role prompt and the scoped CAT
 * evidence tools. Keeping the constituent hashes in the composite input makes
 * the top-level Run manifest change whenever either real surface changes,
 * without pretending that the supervisor alone describes the whole Run.
 */
export function combineCatRequestShapes(input: {
  scope: string;
  surfaces: Array<{ id: string; manifest: CatRequestShapeManifest }>;
}): CatRequestShapeManifest {
  const surfaces = [...input.surfaces]
    .map(({ id, manifest }) => ({ id, manifest }))
    .sort((left, right) => left.id.localeCompare(right.id));
  if (!surfaces.length) throw new Error("A composite request shape requires at least one surface.");
  const activeToolNames = [...new Set(surfaces.flatMap(({ manifest }) => manifest.activeToolNames))].sort();
  const component = (key: "systemPromptHash" | "toolSurfaceHash" | "resourceIndexHash") => sha256(stableJson({
    scope: input.scope,
    surfaces: surfaces.map(({ id, manifest }) => ({ id, hash: manifest[key] })),
  }));
  const systemPromptHash = component("systemPromptHash");
  const toolSurfaceHash = component("toolSurfaceHash");
  const resourceIndexHash = component("resourceIndexHash");
  return {
    schemaVersion: 2,
    systemPromptHash,
    toolSurfaceHash,
    resourceIndexHash,
    requestShapeHash: sha256(stableJson({ scope: input.scope, systemPromptHash, toolSurfaceHash, resourceIndexHash })),
    systemPromptChars: surfaces.reduce((total, { manifest }) => total + manifest.systemPromptChars, 0),
    activeToolCount: activeToolNames.length,
    resourceCount: surfaces.reduce((total, { manifest }) => total + manifest.resourceCount, 0),
    activeToolNames,
  };
}
