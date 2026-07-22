// v1.8 — Consolidated memory ("Hindsight"-style): durable, curated CAT decisions distilled
// from work, recalled as agent context across sessions. Distinct from raw turn-capture memory
// (the gateway): these are the *consolidated* facts (term choices, style rules, dup-group
// resolutions) that should steer every future turn. File-based, gateway-independent.
//
// Boundary preserved: consolidated decisions are RECALL CONTEXT, not citable CAT evidence —
// term/terminology-authority writes still require returned TM/TB/glossary/asset evidenceSources.
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { workspacePath, type CatWorkspace } from "./workspace.js";

export type DecisionScope = "term" | "style" | "tm" | "dup" | "general";

export interface ProjectGuidanceDecision {
  id: string;
  scope: DecisionScope;
  text: string;
  createdAt: string;
  source?: string;
}

const DECISION_SCOPES = new Set<DecisionScope>(["term", "style", "tm", "dup", "general"]);

export function isProjectGuidanceDecision(value: unknown): value is ProjectGuidanceDecision {
  if (!value || typeof value !== "object") return false;
  const row = value as Record<string, unknown>;
  return typeof row.id === "string" && Boolean(row.id.trim())
    && typeof row.scope === "string" && DECISION_SCOPES.has(row.scope as DecisionScope)
    && typeof row.text === "string" && Boolean(row.text.trim())
    && typeof row.createdAt === "string" && Number.isFinite(Date.parse(row.createdAt))
    && (row.source === undefined || typeof row.source === "string");
}

function decisionsPath(workspace: CatWorkspace): string {
  return workspacePath(workspace, "agent_decisions.json");
}

export async function readProjectGuidance(workspace: CatWorkspace): Promise<ProjectGuidanceDecision[]> {
  try {
    const data = JSON.parse(await readFile(decisionsPath(workspace), "utf8")) as { decisions?: ProjectGuidanceDecision[] };
    return data.decisions ?? [];
  } catch {
    return [];
  }
}

export async function writeProjectGuidance(workspace: CatWorkspace, decisions: ProjectGuidanceDecision[]): Promise<ProjectGuidanceDecision[]> {
  const path = decisionsPath(workspace);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify({ decisions }, null, 2)}\n`, "utf8");
  return decisions;
}

// Compact recall block for the agent context. The cap is an operational
// default, not a claim that omitted decisions do not exist.
export function formatProjectGuidance(decisions: ProjectGuidanceDecision[], limit = 20): string {
  if (!decisions.length) return "";
  const visible = decisions.slice(-Math.max(1, limit));
  const lines = visible
    .map((decision) => `  - [${decision.scope}] ${decision.text}`);
  return [
    `Project guidance (latest ${visible.length} of ${decisions.length}; recall context, NOT citable evidence):`,
    decisions.length > visible.length ? "  - Older guidance is omitted from this turn context; use current CAT evidence before relying on an unlisted historical choice." : undefined,
    ...lines,
  ].filter((line): line is string => Boolean(line)).join("\n");
}
